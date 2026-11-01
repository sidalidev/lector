// Serveur simulé, en mémoire, du casier de chaîne (contrat /v1/chain de
// docs/CHAINE.md) : sans compte, avec quota et tous les codes d'erreur. Réservé
// aux tests : il expose une fonction fetch(url, init) qui renvoie de vraies
// Response, flux temps réel compris.
//
// Ce n'est pas le serveur de production (back/) : il suit le contrat pour que
// les clients puissent être testés sans lui.

import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (octets) => createHash("sha256").update(octets).digest("hex");
const RE_ID = /^[0-9a-f]{32}$/;
const RE_DOC_ID = /^[0-9a-f]{64}$/;
const RE_PREUVE = /^[A-Za-z0-9_-]{43}$/;
const RE_B64URL = /^[A-Za-z0-9_-]+$/;
const TRENTE_JOURS = 30 * 24 * 3600 * 1000;
const SURCOUT = 29;

const b64urlVersOctets = (texte) => Buffer.from(texte.replace(/-/g, "+").replace(/_/g, "/"), "base64");

function json(status, corps, entetes = {}) {
  return new Response(JSON.stringify(corps), { status, headers: { "content-type": "application/json", ...entetes } });
}
const erreur = (status, code, extra = {}, entetes = {}) => json(status, { error: code, code, ...extra }, entetes);
const vide = () => new Response(null, { status: 204 });

/** X-Lector-Mtime comme le serveur : maintenant s'il est absent, null s'il est invalide ou hors des années 0 à 9999. */
function lireMtime(valeur) {
  if (valeur === null) return new Date();
  const date = new Date(valeur);
  const annee = date.getUTCFullYear();
  return annee >= 0 && annee <= 9999 ? date : null;
}

/**
 * @param {object} [o]
 * @param {number} [o.quotaBytes]       place par casier
 * @param {number} [o.maxDocBytes]      taille maximale du clair d'un document (le bloc fait 29 octets de plus)
 * @param {number} [o.maxDocs]          documents vivants par casier
 * @param {number} [o.creationsMax]     créations de casier acceptées (anti-abus)
 * @param {number} [o.preuvesFaussesMax] preuves fausses tolérées par casier avant 429
 * @param {number} [o.chainesMax]       casiers au total avant 503 CHAIN_CAPACITY
 *
 * etat.lecturesLimitees = true simule la limite anti-partage : toute lecture
 * (GET) à la bonne preuve répond 429 CHAIN_READ_LIMITED, comme pour un appareil
 * sur un nouveau réseau quand la chaîne a déjà été lue depuis trop de réseaux.
 */
export function creerServeurSimule({
  quotaBytes = 20 * 1024 * 1024,
  maxDocBytes = 512 * 1024,
  maxDocs = 5000,
  creationsMax = Infinity,
  preuvesFaussesMax = 10,
  chainesMax = Infinity,
} = {}) {
  const chaines = new Map(); // chainId → { proofHash, bytesUsed, docCount }
  const blocs = new Map(); // `${chainId}:${docId}` → { pathEnc, octets, sha256, size, mtime, deletedAt, tombEnc }
  const journal = []; // { methode, chemin, entetes }
  const evenements = []; // { chainId, kind, docId, actorDevice }
  const flux = new Set(); // { chainId, controller }
  const echecsPreuve = new Map(); // chainId → preuves fausses
  let creations = 0;
  let suppressions = 0; // ordre des pierres tombales, même posées dans la même milliseconde

  const etat = { chaines, blocs, journal, evenements, flux, lecturesLimitees: false };

  function preuveValide(preuve, empreinte) {
    const a = Buffer.from(sha256(b64urlVersOctets(preuve)), "hex");
    const b = Buffer.from(empreinte, "hex");
    return a.length === b.length && timingSafeEqual(a, b);
  }

  const etatDe = (id) => {
    const c = chaines.get(id);
    return { chainId: id, bytesUsed: c.bytesUsed, quotaBytes, maxDocBytes, maxDocs, docCount: c.docCount };
  };
  const blocsDe = (id) =>
    [...blocs.entries()].filter(([k]) => k.startsWith(`${id}:`)).map(([k, v]) => ({ docId: k.slice(id.length + 1), ...v }));

  /** En-têtes de chaîne : { id, preuve } ou une réponse d'erreur. */
  function lireEntetes(h) {
    const id = h.get("x-lector-chain-id") || "";
    const preuve = h.get("x-lector-chain-proof") || "";
    if (!RE_ID.test(id)) return { reponse: erreur(400, "CHAIN_ID_INVALID") };
    if (!RE_PREUVE.test(preuve)) return { reponse: erreur(400, "CHAIN_PROOF_MISSING") };
    return { id, preuve };
  }

  /** Garde des routes d'un casier existant. La bonne preuve n'est jamais bloquée. */
  function garde(h) {
    const e = lireEntetes(h);
    if (e.reponse) return e;
    const c = chaines.get(e.id);
    if (!c) return { reponse: erreur(404, "CHAIN_UNKNOWN") };
    if (!preuveValide(e.preuve, c.proofHash)) {
      const n = echecsPreuve.get(e.id) || 0;
      if (n >= preuvesFaussesMax) return { reponse: erreur(429, "CHAIN_PROOF_LIMITED") };
      echecsPreuve.set(e.id, n + 1);
      return { reponse: erreur(403, "CHAIN_PROOF_INVALID") };
    }
    return { id: e.id, chaine: c };
  }

  function publier(chainId, evt) {
    evenements.push({ chainId, ...evt });
    const texte = new TextEncoder().encode(`event: vault-change\ndata: ${JSON.stringify(evt)}\n\n`);
    for (const f of flux) if (f.chainId === chainId) f.controller.enqueue(texte);
  }

  function fermerFlux(filtre = () => true) {
    for (const f of [...flux]) {
      if (!filtre(f)) continue;
      flux.delete(f);
      try {
        f.controller.close();
      } catch {
        // déjà fermé
      }
    }
  }

  function ouvrirFlux(chainId, signal) {
    let entree;
    const corps = new ReadableStream({
      start(controller) {
        entree = { chainId, controller };
        flux.add(entree);
        controller.enqueue(new TextEncoder().encode(": connected\n\n"));
        signal?.addEventListener("abort", () => fermerFlux((f) => f === entree), { once: true });
      },
      cancel() {
        flux.delete(entree);
      },
    });
    return new Response(corps, { status: 200, headers: { "content-type": "text/event-stream" } });
  }

  async function corps(init) {
    const b = init?.body;
    if (b == null) return Buffer.alloc(0);
    if (typeof b === "string") return Buffer.from(b, "utf8");
    if (b instanceof ArrayBuffer) return Buffer.from(b);
    if (ArrayBuffer.isView(b)) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    throw new Error("Corps non géré par le serveur simulé");
  }

  async function fetch(url, init = {}) {
    const u = new URL(url, "http://serveur.test");
    const methode = (init.method || "GET").toUpperCase();
    const h = new Headers(init.headers || {});
    const p = u.pathname;
    journal.push({ methode, chemin: p, entetes: Object.fromEntries(h.entries()) });
    const acteur = h.get("x-lector-device") || null;

    if (p === "/v1/chain" && methode === "POST") {
      const e = lireEntetes(h);
      if (e.reponse) return e.reponse;
      const existante = chaines.get(e.id);
      if (existante) {
        return preuveValide(e.preuve, existante.proofHash) ? json(200, etatDe(e.id)) : erreur(403, "CHAIN_PROOF_INVALID");
      }
      if (creations >= creationsMax) return erreur(429, "CHAIN_CREATE_LIMITED");
      if (chaines.size >= chainesMax) return erreur(503, "CHAIN_CAPACITY");
      creations++;
      chaines.set(e.id, { proofHash: sha256(b64urlVersOctets(e.preuve)), bytesUsed: 0, docCount: 0 });
      return json(201, etatDe(e.id));
    }

    if (!p.startsWith("/v1/chain")) return erreur(404, "NOT_FOUND");
    const g = garde(h);
    if (g.reponse) return g.reponse;
    const { id, chaine } = g;
    if (etat.lecturesLimitees && methode === "GET") return erreur(429, "CHAIN_READ_LIMITED", {}, { "retry-after": "3600" });

    if (p === "/v1/chain" && methode === "GET") return json(200, etatDe(id));
    if (p === "/v1/chain" && methode === "DELETE") {
      for (const k of [...blocs.keys()]) if (k.startsWith(`${id}:`)) blocs.delete(k);
      chaines.delete(id);
      fermerFlux((f) => f.chainId === id);
      return vide();
    }
    if (p === "/v1/chain/manifest" && methode === "GET") {
      const limite = Date.now() - TRENTE_JOURS;
      const docs = blocsDe(id)
        .filter((b) => !b.deletedAt || Date.parse(b.deletedAt) >= limite)
        .map((b) => ({ docId: b.docId, pathEnc: b.pathEnc, sha256: b.sha256, size: b.size, mtime: b.mtime, deletedAt: b.deletedAt, tombEnc: b.tombEnc }));
      return json(200, { ...etatDe(id), docs });
    }
    if (p === "/v1/chain/stream" && methode === "GET") return ouvrirFlux(id, init.signal);

    const m = /^\/v1\/chain\/docs\/([^/]+)$/.exec(p);
    if (!m) return erreur(404, "NOT_FOUND");
    const docId = m[1];
    if (!RE_DOC_ID.test(docId)) return erreur(400, "DOC_ID_INVALID");
    const cle = `${id}:${docId}`;
    const existant = blocs.get(cle);
    const vivant = !!existant && !existant.deletedAt;

    if (methode === "GET") {
      if (!existant) return erreur(404, "DOC_UNKNOWN");
      if (!vivant) return erreur(410, "DOC_DELETED");
      return new Response(existant.octets, {
        status: 200,
        headers: {
          "content-type": "application/octet-stream",
          etag: `"${existant.sha256}"`,
          "x-lector-mtime": existant.mtime,
          "x-lector-path-enc": existant.pathEnc,
        },
      });
    }

    if (methode === "PUT") {
      const octets = await corps(init);
      const pathEnc = h.get("x-lector-path-enc") || "";
      const mtime = lireMtime(h.get("x-lector-mtime"));
      if (!RE_B64URL.test(pathEnc) || pathEnc.length > 1500 || b64urlVersOctets(pathEnc)[0] !== 1) return erreur(400, "PATH_ENC_INVALID");
      if (octets.length < SURCOUT || octets[0] !== 1) return erreur(400, "ENVELOPE_INVALID");
      if (!mtime) return erreur(400, "MTIME_INVALID");
      const siCorrespond = h.get("if-match");
      if (h.get("if-none-match") === "*" && vivant) return erreur(412, "CONFLICT");
      if (siCorrespond !== null && (!vivant || siCorrespond.replace(/"/g, "") !== existant.sha256)) return erreur(412, "CONFLICT");
      if (octets.length > maxDocBytes + SURCOUT) return erreur(413, "DOC_TOO_LARGE", { maxDocBytes });
      const delta = octets.length - (vivant ? existant.size : 0);
      if (chaine.bytesUsed + delta > quotaBytes) return erreur(413, "QUOTA_EXCEEDED", { bytesUsed: chaine.bytesUsed, quotaBytes });
      if (!vivant && chaine.docCount >= maxDocs) return erreur(413, "TOO_MANY_DOCS", { maxDocs });
      const bloc = {
        pathEnc,
        octets: Buffer.from(octets),
        sha256: sha256(octets),
        size: octets.length,
        mtime: mtime.toISOString(),
        deletedAt: null,
        tombEnc: null,
      };
      blocs.set(cle, bloc);
      chaine.bytesUsed += delta;
      if (!vivant) chaine.docCount++;
      publier(id, { kind: "put", docId, actorDevice: acteur });
      return json(200, { docId, sha256: bloc.sha256, size: bloc.size, bytesUsed: chaine.bytesUsed });
    }

    if (methode === "DELETE") {
      const tombEnc = h.get("x-lector-tomb-enc") || "";
      if (!RE_B64URL.test(tombEnc) || b64urlVersOctets(tombEnc)[0] !== 1) return erreur(400, "TOMB_ENC_INVALID");
      if (!existant) return erreur(404, "DOC_UNKNOWN");
      if (!vivant) return vide();
      const siCorrespond = h.get("if-match");
      if (siCorrespond !== null && siCorrespond.replace(/"/g, "") !== existant.sha256) return erreur(412, "CONFLICT");
      blocs.set(cle, { ...existant, octets: Buffer.alloc(0), sha256: "", size: 0, deletedAt: new Date().toISOString(), tombEnc, rang: ++suppressions });
      chaine.bytesUsed -= existant.size;
      chaine.docCount--;
      // Au plus maxDocs pierres tombales par casier : les plus anciennes partent d'abord.
      const tombes = blocsDe(id).filter((b) => b.deletedAt).sort((a, b) => b.rang - a.rang);
      for (const b of tombes.slice(maxDocs)) blocs.delete(`${id}:${b.docId}`);
      publier(id, { kind: "delete", docId, actorDevice: acteur });
      return vide();
    }
    return erreur(404, "NOT_FOUND");
  }

  /** Tous les octets stockés (blocs et chemins chiffrés), pour chercher une fuite de clair. */
  function toutLeStockage() {
    const morceaux = [];
    for (const [k, b] of blocs) morceaux.push(Buffer.from(k), b.octets, b64urlVersOctets(b.pathEnc || ""));
    return Buffer.concat(morceaux);
  }

  /** Contrôle d'un casier : blocs vivants bien formés et compteurs justes. */
  function verification(chainId) {
    const vivants = blocsDe(chainId).filter((b) => !b.deletedAt);
    const c = chaines.get(chainId);
    const r = {
      blocs: vivants.length,
      octets: vivants.reduce((s, b) => s + b.size, 0),
      empreintesFausses: vivants.filter((b) => sha256(b.octets) !== b.sha256).length,
      versionsInconnues: vivants.filter((b) => b.octets[0] !== 1).length,
      bytesUsed: c?.bytesUsed ?? null,
      docCount: c?.docCount ?? null,
    };
    r.ok = !!c && r.empreintesFausses === 0 && r.versionsInconnues === 0 && r.octets === r.bytesUsed && r.blocs === r.docCount;
    return r;
  }

  return { fetch, etat, toutLeStockage, verification, couperFlux: () => fermerFlux() };
}
