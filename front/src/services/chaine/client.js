// Client HTTP du casier d'une chaîne : routes /v1/chain (docs/CHAINE.md).
//
// Module ES sans DOM : il sert au navigateur (chaineWeb.js), au processus
// principal d'Electron (import dynamique depuis desktop/) et aux tests Node.
// Le fetch est injecté : net.fetch dans Electron, fetch du navigateur, ou le
// serveur simulé des tests.
//
// Aucun compte : chaque requête porte l'identifiant public de la chaîne et la
// preuve P (jamais S, jamais les clés), plus l'identifiant aléatoire de
// l'appareil qui sert seulement à reconnaître ses propres échos dans le flux.

/**
 * Limite par document (taille du clair) quand le serveur ne l'annonce pas :
 * la valeur par défaut du serveur (CHAIN_MAX_DOC_BYTES). Une longue note fait
 * rarement plus de 400 Ko ; au-delà, le document reste sur l'appareil.
 */
export const MAX_DOC_BYTES_DEFAUT = 512 * 1024;

/** Erreur HTTP d'une route de chaîne, avec le code renvoyé par le serveur (CHAIN_UNKNOWN, QUOTA_EXCEEDED...). */
export class ErreurChaine extends Error {
  constructor(status, code, corps = "") {
    super(`HTTP ${status}${code ? ` ${code}` : ""}`);
    this.name = "ErreurChaine";
    this.status = status;
    this.code = code || null;
    this.corps = corps;
    this.details = lireJson(corps);
  }
}

function lireJson(texte) {
  try {
    const j = JSON.parse(texte);
    return j && typeof j === "object" ? j : null;
  } catch {
    return null;
  }
}

/** Extrait le code d'erreur d'un corps de réponse (JSON { code } ou { error: 'CODE' }). */
export function codeDuCorps(texte) {
  const j = lireJson(texte);
  if (!j) return null;
  if (typeof j.code === "string") return j.code;
  if (typeof j.error === "string" && /^[A-Z][A-Z0-9_]{3,}$/.test(j.error)) return j.error;
  return null;
}

/** La chaîne n'existe pas (ou plus) sur le serveur : renouvelée ou effacée ailleurs, ou mots d'une autre chaîne. */
export function estChaineInconnue(err) {
  return !!err && err.status === 404 && err.code === "CHAIN_UNKNOWN";
}

/**
 * Lecture refusée par la limite anti-partage (429 CHAIN_READ_LIMITED) : la
 * chaîne a été lue depuis trop de réseaux distincts en 24 heures et celui-ci
 * est nouveau. Les appareils déjà vus continuent ; celui-ci réessaiera plus tard.
 */
export function estLectureLimitee(err) {
  return !!err && err.status === 429 && err.code === "CHAIN_READ_LIMITED";
}

/** Refus de place : QUOTA_EXCEEDED, DOC_TOO_LARGE ou TOO_MANY_DOCS. */
export function estQuota(err) {
  return !!err && err.status === 413;
}

const RECUL_MIN_MS = 1000;
const RECUL_MAX_MS = 30_000;

/** Attend `ms`, ou moins si le signal est interrompu. */
function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const minuterie = setTimeout(fin, ms);
    function fin() {
      clearTimeout(minuterie);
      signal?.removeEventListener("abort", fin);
      resolve();
    }
    signal?.addEventListener("abort", fin, { once: true });
  });
}

const sansGuillemets = (etag) => (etag ? etag.replace(/^W\//, "").replace(/"/g, "") : null);

export class ClientChaine {
  /**
   * @param {object} o
   * @param {string} [o.serverUrl]  https://lector.dockerbop.fr, ou '' pour la même origine
   * @param {string} o.chainId      identifiant public (32 hex)
   * @param {string} o.preuve       P en base64url
   * @param {string|null} [o.deviceId]  UUID aléatoire de cette installation
   * @param {Function} [o.fetch]
   */
  constructor({ serverUrl = "", chainId, preuve, deviceId = null, fetch = (...a) => globalThis.fetch(...a) }) {
    if (!chainId || !preuve) throw new Error("Chaîne non préparée : identifiant et preuve requis");
    this.serverUrl = String(serverUrl || "").replace(/\/$/, "");
    this.chainId = chainId;
    this.preuve = preuve;
    this.deviceId = deviceId;
    this.fetch = fetch;
  }

  async _requete(methode, chemin, { octets, entetes = {}, signal } = {}) {
    const h = { ...entetes, "X-Lector-Chain-Id": this.chainId, "X-Lector-Chain-Proof": this.preuve };
    if (this.deviceId) h["X-Lector-Device"] = this.deviceId;
    if (octets !== undefined) h["content-type"] = "application/octet-stream";
    const res = await this.fetch(`${this.serverUrl}${chemin}`, { method: methode, headers: h, body: octets, signal });
    if (res.ok) return res;
    const texte = await res.text().catch(() => "");
    throw new ErreurChaine(res.status, codeDuCorps(texte), texte);
  }

  async _json(methode, chemin, options) {
    const res = await this._requete(methode, chemin, options);
    return res.status === 204 ? null : res.json();
  }

  /** POST /v1/chain : crée le casier (idempotent avec la même preuve). Renvoie l'état. */
  creer() {
    return this._json("POST", "/v1/chain");
  }

  /** GET /v1/chain : { chainId, bytesUsed, quotaBytes, maxDocBytes, maxDocs, docCount }. */
  etat() {
    return this._json("GET", "/v1/chain");
  }

  /** DELETE /v1/chain : efface le casier entier (blocs, pierres tombales, chaîne). */
  async effacerTout() {
    await this._requete("DELETE", "/v1/chain");
  }

  /** GET /v1/chain/manifest : état du casier et docs (pierres tombales de moins de 30 jours incluses). */
  manifeste() {
    return this._json("GET", "/v1/chain/manifest");
  }

  /**
   * PUT /v1/chain/docs/:docId. `attendu` : empreinte du bloc que l'on croit
   * remplacer, ou null pour une création. Le serveur répond 412 CONFLICT si
   * le document a changé entre-temps.
   */
  deposer(docId, { bloc, pathEnc, mtime, attendu = null }) {
    const entetes = {
      "X-Lector-Path-Enc": pathEnc,
      "X-Lector-Mtime": mtime instanceof Date ? mtime.toISOString() : String(mtime || new Date().toISOString()),
    };
    if (attendu) entetes["If-Match"] = attendu;
    else entetes["If-None-Match"] = "*";
    return this._json("PUT", `/v1/chain/docs/${docId}`, { octets: bloc, entetes });
  }

  /** GET /v1/chain/docs/:docId : { bloc, pathEnc, mtime, sha256 }. */
  async lire(docId) {
    const res = await this._requete("GET", `/v1/chain/docs/${docId}`);
    return {
      bloc: new Uint8Array(await res.arrayBuffer()),
      pathEnc: res.headers.get("x-lector-path-enc"),
      mtime: res.headers.get("x-lector-mtime"),
      sha256: sansGuillemets(res.headers.get("etag")),
    };
  }

  /**
   * DELETE /v1/chain/docs/:docId avec la marque de suppression chiffrée (pierre
   * tombale de 30 jours). `attendu` : empreinte du bloc que l'on croit supprimer ;
   * le serveur répond 412 CONFLICT si le document a changé entre-temps.
   */
  async supprimer(docId, tombEnc, attendu = null) {
    const entetes = { "X-Lector-Tomb-Enc": tombEnc };
    if (attendu) entetes["If-Match"] = attendu;
    await this._requete("DELETE", `/v1/chain/docs/${docId}`, { entetes });
  }

  /**
   * GET /v1/chain/stream, lu par fetch (les en-têtes ne vont jamais dans l'URL).
   * Appelle onEvenement({ kind, docId, actorDevice }) pour chaque vault-change
   * venu d'un autre appareil. Se reconnecte avec un recul de 1 s à 30 s ; un
   * 403 ou un 404 arrête le flux (onErreur le reçoit). La promesse se résout
   * quand le signal est interrompu ou sur une erreur définitive.
   */
  async flux(onEvenement, { signal, onErreur } = {}) {
    let recul = RECUL_MIN_MS;
    while (!signal?.aborted) {
      try {
        const res = await this._requete("GET", "/v1/chain/stream", { entetes: { accept: "text/event-stream" }, signal });
        await this._lireEvenements(res.body, onEvenement, () => {
          recul = RECUL_MIN_MS;
        });
      } catch (err) {
        if (signal?.aborted) return;
        if (err instanceof ErreurChaine && (err.status === 403 || err.status === 404)) {
          onErreur?.(err);
          return;
        }
      }
      if (signal?.aborted) return;
      await pause(recul, signal);
      recul = Math.min(recul * 2, RECUL_MAX_MS);
    }
  }

  async _lireEvenements(corps, onEvenement, surDonnees) {
    const lecteur = corps.getReader();
    const decodeur = new TextDecoder();
    let tampon = "";
    for (;;) {
      const { value, done } = await lecteur.read();
      if (done) return;
      surDonnees();
      tampon += decodeur.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let fin;
      while ((fin = tampon.indexOf("\n\n")) !== -1) {
        this._traiterBloc(tampon.slice(0, fin), onEvenement);
        tampon = tampon.slice(fin + 2);
      }
    }
  }

  _traiterBloc(bloc, onEvenement) {
    let type = "message";
    const donnees = [];
    for (const ligne of bloc.split("\n")) {
      if (ligne.startsWith("event:")) type = ligne.slice(6).trim();
      else if (ligne.startsWith("data:")) donnees.push(ligne.slice(5).trim());
    }
    if (type !== "vault-change" || donnees.length === 0) return;
    const evt = lireJson(donnees.join("\n"));
    if (!evt || (this.deviceId && evt.actorDevice === this.deviceId)) return;
    onEvenement(evt);
  }
}
