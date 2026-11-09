// Client d'un salon de co-écriture (docs/collab-design.md § 5).
//
// Deux Y.Doc : `doc`, ce que la personne voit et modifie, et `miroir`, ce que
// le relais est censé détenir (tout ce qui a été reçu, plus nos mises à jour
// une fois acquittées). À chaque (re)connexion, on envoie la différence entre
// les deux : rien de ce qui a été tapé hors ligne ne se perd, même après la
// fermeture de l'onglet si l'appelant persiste l'état (onSauver).
//
// Tout ce qui part est chiffré (crypto.js) ; le relais ne voit que des
// enveloppes opaques. Module ES sans DOM : le WebSocket est injecté.

import * as Y from "yjs";
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from "y-protocols/awareness";
import { NATURES, chiffrerMessage, dechiffrerMessage, empreinteProprietaire, octetsVersBase64url } from "./crypto.js";

export const VERSION_PROTOCOLE = 1;

/** Codes de fermeture du relais (docs/collab-design.md § 5.2). */
export const FERMETURES = Object.freeze({
  TRAME: 4400,
  PREUVE: 4403,
  INCONNU: 4404,
  DELAI: 4408,
  TROP_GROS: 4413,
  LIMITE: 4429,
  PLEIN: 4503,
});

/** États exposés à l'interface. */
export const STATUTS = Object.freeze({
  CONNEXION: "connexion",
  EN_LIGNE: "en-ligne",
  HORS_LIGNE: "hors-ligne",
  ARRETE: "arrete", // salon arrêté par le propriétaire (ou inconnu)
  REFUSE: "refuse", // preuve refusée : lien d'un autre salon
  PLEIN: "plein", // quota du salon atteint : les modifications restent ici
});

const RECUL_MIN_MS = 1000;
const RECUL_MAX_MS = 30_000;
const DELAI_SAUVEGARDE_MS = 300;

/** Adresse WebSocket du relais à partir de l'origine HTTP(S) du serveur. */
export function urlRelais(serverUrl) {
  return `${String(serverUrl).replace(/\/$/, "").replace(/^http/, "ws")}/v1/collab`;
}

/** Vrai si les deux documents ont exactement le même contenu Yjs (éléments et suppressions). */
function memesEtats(a, b) {
  return Y.equalSnapshots(Y.snapshot(a), Y.snapshot(b));
}

export class SalonCollab {
  /**
   * @param {object} o
   * @param {{id:string, preuve:string, cleEnc:CryptoKey}} o.salon  préparé par preparerSalon(K)
   * @param {Y.Doc} o.doc
   * @param {import('y-protocols/awareness').Awareness} [o.presence]
   * @param {string} o.url                    wss://…/v1/collab
   * @param {Function} [o.WebSocket]
   * @param {Uint8Array|null} [o.secretProprietaire]  O : présent chez le propriétaire seulement
   * @param {{serveur?:Uint8Array, seq?:number}} [o.etat]  miroir et numéro sauvés
   * @param {(statut:string, detail?:object) => void} [o.onStatut]
   * @param {(etat:{local:Uint8Array, serveur:Uint8Array, seq:number}) => void} [o.onSauver]
   */
  constructor({ salon, doc, presence = null, url, WebSocket = globalThis.WebSocket, secretProprietaire = null, etat = {}, onStatut, onSauver }) {
    this.salon = salon;
    this.doc = doc;
    this.presence = presence;
    this.url = url;
    this.WS = WebSocket;
    this.secretProprietaire = secretProprietaire;
    this.onStatut = onStatut || (() => {});
    this.onSauver = onSauver || null;

    this.miroir = new Y.Doc({ gc: doc.gc });
    if (etat.serveur?.length) Y.applyUpdate(this.miroir, etat.serveur);
    this.seq = Number.isInteger(etat.seq) ? etat.seq : 0;

    this.ws = null;
    this.synchro = false; // vrai après le welcome : les mises à jour partent au fil de l'eau
    this.enAttente = []; // mises à jour envoyées, pas encore acquittées (dans l'ordre)
    this.incomplet = false; // un message reçu n'a pas pu être déchiffré : pas de compactage
    this.statut = STATUTS.HORS_LIGNE;
    this.arret = false;
    this.recul = RECUL_MIN_MS;
    this.minuterie = null;
    this.minuterieSauvegarde = null;
    this.fileEnvoi = Promise.resolve();
    this.fileRecu = Promise.resolve();

    this._surMaj = (maj, origine) => {
      if (origine === this) return;
      this._planifierSauvegarde();
      if (this.synchro) this._envoyerDoc(maj);
    };
    this._surPresence = ({ added, updated, removed }, origine) => {
      if (origine === this) {
        // Quelqu'un de nouveau : il ne connaît pas encore notre curseur.
        if (added.length) this._envoyerPresence([this.doc.clientID]);
        return;
      }
      if (origine !== "local") return;
      this._envoyerPresence([...added, ...updated, ...removed]);
    };
    this._surEnLigne = () => {
      if (this.statut === STATUTS.HORS_LIGNE) this._reconnecterBientot(0);
    };
    doc.on("update", this._surMaj);
    presence?.on("update", this._surPresence);
    globalThis.addEventListener?.("online", this._surEnLigne);
  }

  _changerStatut(statut, detail) {
    if (this.statut === statut && !detail) return;
    this.statut = statut;
    this.onStatut(statut, detail);
  }

  /** Ouvre la connexion (et la rouvre ensuite tout seul jusqu'à fermer()). */
  connecter() {
    if (this.arret || this.ws) return;
    this._changerStatut(STATUTS.CONNEXION);
    let ws;
    try {
      ws = new this.WS(this.url);
    } catch {
      this._perdu();
      return;
    }
    this.ws = ws;
    ws.onopen = async () => {
      const hello = { t: "hello", v: VERSION_PROTOCOLE, room: this.salon.id, proof: this.salon.preuve, since: this.seq };
      if (this.secretProprietaire) hello.owner = await empreinteProprietaire(this.secretProprietaire);
      if (this.ws === ws) ws.send(JSON.stringify(hello));
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      const texte = typeof ev.data === "string" ? ev.data : null;
      if (!texte) return;
      let trame;
      try {
        trame = JSON.parse(texte);
      } catch {
        return;
      }
      this.fileRecu = this.fileRecu.then(() => this._recevoir(ws, trame)).catch(() => {});
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this._fermee(ev.code);
    };
    ws.onerror = () => {};
  }

  async _recevoir(ws, trame) {
    if (this.ws !== ws || !trame || typeof trame.t !== "string") return;
    switch (trame.t) {
      case "welcome":
        return this._accueil(trame);
      case "up":
        if (!Number.isInteger(trame.s)) return;
        await this._appliquerDistant(trame.d);
        this.seq = Math.max(this.seq, trame.s);
        this._planifierSauvegarde();
        return;
      case "ack": {
        const maj = this.enAttente.shift();
        if (maj) Y.applyUpdate(this.miroir, maj, this);
        if (Number.isInteger(trame.s)) this.seq = Math.max(this.seq, trame.s);
        if (this.statut === STATUTS.PLEIN) this._changerStatut(STATUTS.EN_LIGNE);
        this._planifierSauvegarde();
        return;
      }
      case "aw":
        return this._appliquerPresence(trame.d);
      case "compact?":
        return this._compacter();
      case "error":
        if (trame.code === "QUOTA_EXCEEDED") {
          // La mise à jour refusée reste dans doc : elle repartira avec la différence à la reconnexion.
          this.enAttente.shift();
          this._changerStatut(STATUTS.PLEIN);
        }
        return;
      default:
    }
  }

  async _accueil(trame) {
    const entrees = Array.isArray(trame.entries) ? trame.entries : [];
    for (const e of entrees) {
      if (!e || !Number.isInteger(e.s)) continue;
      await this._appliquerDistant(e.d);
    }
    if (Number.isInteger(trame.seq)) this.seq = Math.max(this.seq, trame.seq);
    // Synchrone jusqu'à synchro = true : aucune modification locale ne peut se glisser entre les deux.
    this.enAttente = [];
    const diff = memesEtats(this.doc, this.miroir) ? null : Y.encodeStateAsUpdate(this.doc, Y.encodeStateVector(this.miroir));
    this.synchro = true;
    this.recul = RECUL_MIN_MS;
    if (diff) this._envoyerDoc(diff);
    this._changerStatut(STATUTS.EN_LIGNE);
    if (this.presence?.getLocalState()) this._envoyerPresence([this.doc.clientID]);
    this._planifierSauvegarde();
  }

  async _appliquerDistant(texte) {
    let maj;
    try {
      maj = await dechiffrerMessage(this.salon, NATURES.DOC, texte);
    } catch {
      this.incomplet = true; // message d'une autre clé ou abîmé : ignoré
      return;
    }
    Y.applyUpdate(this.doc, maj, this);
    Y.applyUpdate(this.miroir, maj, this);
  }

  async _appliquerPresence(texte) {
    if (!this.presence) return;
    try {
      applyAwarenessUpdate(this.presence, await dechiffrerMessage(this.salon, NATURES.PRESENCE, texte), this);
    } catch {
      // présence illisible : ignorée
    }
  }

  _envoyer(fabriquer) {
    const ws = this.ws;
    this.fileEnvoi = this.fileEnvoi
      .then(async () => {
        const trame = await fabriquer();
        if (!trame || this.ws !== ws || ws.readyState !== 1) return false;
        ws.send(JSON.stringify(trame));
        return true;
      })
      .catch(() => false);
    return this.fileEnvoi;
  }

  _envoyerDoc(maj) {
    const ws = this.ws;
    this._envoyer(async () => {
      const d = await chiffrerMessage(this.salon, NATURES.DOC, maj);
      if (this.ws !== ws || !this.synchro) return null;
      this.enAttente.push(maj);
      return { t: "up", d };
    });
  }

  _envoyerPresence(clients) {
    if (!this.presence || !this.synchro) return;
    const maj = encodeAwarenessUpdate(this.presence, clients);
    this._envoyer(async () => ({ t: "aw", d: await chiffrerMessage(this.salon, NATURES.PRESENCE, maj) }));
  }

  _compacter() {
    if (this.incomplet || this.enAttente.length) return;
    const upto = this.seq;
    const etat = Y.encodeStateAsUpdate(this.miroir);
    this._envoyer(async () => ({ t: "compact", upto, d: await chiffrerMessage(this.salon, NATURES.DOC, etat) }));
  }

  _fermee(code) {
    this.ws = null;
    this.synchro = false;
    this.enAttente = [];
    if (this.presence) {
      // Les curseurs des autres disparaissent : on ne les voit plus.
      const autres = [...this.presence.getStates().keys()].filter((id) => id !== this.doc.clientID);
      removeAwarenessStates(this.presence, autres, this);
    }
    if (code === FERMETURES.INCONNU) {
      this.arret = true;
      this._changerStatut(STATUTS.ARRETE);
      return;
    }
    if (code === FERMETURES.PREUVE) {
      this.arret = true;
      this._changerStatut(STATUTS.REFUSE);
      return;
    }
    if (code === FERMETURES.LIMITE || code === FERMETURES.PLEIN) this.recul = RECUL_MAX_MS;
    this._perdu();
  }

  _perdu() {
    this.ws = null;
    if (this.arret) return;
    if (this.statut !== STATUTS.PLEIN) this._changerStatut(STATUTS.HORS_LIGNE);
    this._reconnecterBientot(this.recul);
    this.recul = Math.min(RECUL_MAX_MS, this.recul * 2);
  }

  _reconnecterBientot(ms) {
    clearTimeout(this.minuterie);
    if (this.arret) return;
    this.minuterie = setTimeout(() => {
      this.minuterie = null;
      this.connecter();
    }, ms);
  }

  _planifierSauvegarde() {
    if (!this.onSauver || this.minuterieSauvegarde) return;
    this.minuterieSauvegarde = setTimeout(() => {
      this.minuterieSauvegarde = null;
      this.sauverMaintenant();
    }, DELAI_SAUVEGARDE_MS);
  }

  /** État à persister : document local, miroir du relais, dernier numéro reçu. */
  etat() {
    return { local: Y.encodeStateAsUpdate(this.doc), serveur: Y.encodeStateAsUpdate(this.miroir), seq: this.seq };
  }

  sauverMaintenant() {
    clearTimeout(this.minuterieSauvegarde);
    this.minuterieSauvegarde = null;
    try {
      this.onSauver?.(this.etat());
    } catch {
      // stockage indisponible : la copie en mémoire reste
    }
  }

  /** Coupe la connexion sans rien effacer (tests de coupure, mise en veille). */
  couper() {
    const ws = this.ws;
    if (ws) {
      this.ws = null;
      try {
        ws.close();
      } catch {
        // déjà fermée
      }
      this._fermee(1006);
    }
  }

  /** Ferme pour de bon : retire notre curseur chez les autres, sauve, n'essaie plus. */
  async fermer() {
    if (this.presence && this.synchro) {
      removeAwarenessStates(this.presence, [this.doc.clientID], "local");
      await this.fileEnvoi;
    }
    this.arret = true;
    clearTimeout(this.minuterie);
    this.doc.off("update", this._surMaj);
    this.presence?.off("update", this._surPresence);
    globalThis.removeEventListener?.("online", this._surEnLigne);
    if (this.onSauver) this.sauverMaintenant();
    const ws = this.ws;
    this.ws = null;
    this.synchro = false;
    try {
      ws?.close(1000);
    } catch {
      // déjà fermée
    }
  }
}

/**
 * Arrête un partage (propriétaire) : ouvre une connexion dédiée, envoie stop
 * avec O, attend la fermeture 4404. Résout true si le salon n'existe plus
 * (arrêté maintenant ou déjà), false si le relais n'a pas pu être joint.
 */
export function arreterSalon({ salon, secretProprietaire, url, WebSocket = globalThis.WebSocket, delaiMs = 10_000 }) {
  return new Promise((resolve) => {
    let fini = false;
    let ws;
    const finir = (ok) => {
      if (fini) return;
      fini = true;
      clearTimeout(minuterie);
      try {
        ws?.close();
      } catch {
        // déjà fermée
      }
      resolve(ok);
    };
    const minuterie = setTimeout(() => finir(false), delaiMs);
    try {
      ws = new WebSocket(url);
    } catch {
      finir(false);
      return;
    }
    ws.onopen = () => {
      ws.send(JSON.stringify({ t: "hello", v: VERSION_PROTOCOLE, room: salon.id, proof: salon.preuve, since: 0 }));
    };
    ws.onmessage = (ev) => {
      let trame;
      try {
        trame = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (trame?.t === "welcome") ws.send(JSON.stringify({ t: "stop", owner: octetsVersBase64url(secretProprietaire) }));
    };
    ws.onclose = (ev) => finir(ev.code === FERMETURES.INCONNU);
    ws.onerror = () => {};
  });
}

/**
 * Remplace le contenu d'un Y.Text par `nouveau` en une seule modification
 * minimale (préfixe et suffixe communs gardés) : un fichier changé hors de
 * l'éditeur partagé devient une modification comme une autre (§ 9).
 */
export function appliquerTexte(ytext, nouveau, origine = "fichier") {
  const ancien = ytext.toString();
  if (ancien === nouveau) return false;
  let debut = 0;
  const max = Math.min(ancien.length, nouveau.length);
  while (debut < max && ancien.charCodeAt(debut) === nouveau.charCodeAt(debut)) debut++;
  let fin = 0;
  while (
    fin < max - debut &&
    ancien.charCodeAt(ancien.length - 1 - fin) === nouveau.charCodeAt(nouveau.length - 1 - fin)
  ) fin++;
  ytext.doc.transact(() => {
    const aRetirer = ancien.length - debut - fin;
    if (aRetirer > 0) ytext.delete(debut, aRetirer);
    const aInserer = nouveau.slice(debut, nouveau.length - fin);
    if (aInserer) ytext.insert(debut, aInserer);
  }, origine);
  return true;
}
