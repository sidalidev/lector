// Vault « cloud:// » du navigateur (docs/CHAINE.md § 6.5).
//
// Pas de disque local : l'arbre vient du manifeste du casier dont on déchiffre
// les pathEnc, la lecture télécharge puis déchiffre un bloc, l'écriture chiffre
// puis dépose avec If-Match (le dernier écrit ne gagne pas en silence : le
// serveur répond 412 si le document a changé ailleurs). Markdown seulement.
//
// Module ES pur (client et clés injectés), testé dans synchro.test.mjs.

import { ErreurChaine, MAX_DOC_BYTES_DEFAUT, estQuota } from "./client.js";
import {
  SURCOUT_ENVELOPPE,
  chiffrerCheminAvec,
  chiffrerContenuAvec,
  chiffrerTombeAvec,
  dechiffrerCheminAvec,
  dechiffrerContenuAvec,
  docIdAvec,
  estDocIdValide,
  sha256Hex,
} from "./crypto.js";
import { estMarkdown, nomDeConflit } from "./synchro.js";
import { estErreurReseau } from "./attente.js";

/** Prévient l'interface du nombre de notes qui attendent le réseau. */
function signalerAttente(n) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lector-attente", { detail: { n } }));
}

/** Notes qui attendent le réseau (pas celles refusées faute de place, qui attendent l'utilisateur). */
const attendentLeReseau = (entrees) => entrees.filter((e) => !e.refus).length;

const egaux = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

export class VaultWebChaine {
  /**
   * @param {object} o
   * @param {import('./client.js').ClientChaine} o.client
   * @param {{id, preuve, cleEnc, cleMac}} o.cles
   */
  constructor({ client, cles, attente = null }) {
    this.client = client;
    this.cles = cles;
    // Écritures faites sans réseau, chiffrées, envoyées au retour (attente.js).
    this.attente = attente;
    this.envoi = null;
    this.derniereListe = null;
    // docId → empreinte du bloc LU (ou écrit) par cette session : c'est la base
    // d'une écriture. lister() ne la change pas : si un autre appareil modifie le
    // document après sa lecture ici, l'écriture répond 412 au lieu d'écraser.
    this.lus = new Map();
    this.connus = new Map(); // docId → empreinte vue dans le dernier manifeste
    this.clairs = new Map(); // docId → { sha256, clair } : cache de la session, jamais écrit ailleurs qu'en mémoire
    this.indechiffrables = 0;
    this.serveur = null; // { bytesUsed, quotaBytes, maxDocBytes, maxDocs } du dernier manifeste
  }

  /** Liste les documents markdown vivants : [{ chemin, docId, size, mtime }]. */
  async lister() {
    let man;
    try {
      man = await this.client.manifeste();
    } catch (err) {
      // Hors ligne : la dernière liste connue, plus les notes créées depuis.
      if (!estErreurReseau(err) || !this.derniereListe) throw err;
      return this._avecAttente(this.derniereListe);
    }
    this.serveur = {
      bytesUsed: man.bytesUsed ?? null,
      quotaBytes: man.quotaBytes ?? null,
      maxDocBytes: man.maxDocBytes ?? null,
      maxDocs: man.maxDocs ?? null,
    };
    const docs = (man.docs || []).filter((d) => estDocIdValide(d.docId));
    const sortie = [];
    this.indechiffrables = 0;
    await Promise.all(
      docs.map(async (d) => {
        this.connus.set(d.docId, d.deletedAt ? "" : d.sha256);
        if (d.deletedAt) return;
        let chemin;
        try {
          chemin = await dechiffrerCheminAvec(this.cles, d.docId, d.pathEnc);
        } catch {
          this.indechiffrables++;
          return;
        }
        if (!estMarkdown(chemin)) return;
        sortie.push({ chemin, docId: d.docId, size: Math.max(0, (d.size || 0) - SURCOUT_ENVELOPPE), mtime: d.mtime });
      }),
    );
    sortie.sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
    this.derniereListe = sortie;
    return this._avecAttente(sortie);
  }

  /** La liste, avec les notes qui n'existent encore que dans la file d'attente. */
  async _avecAttente(liste) {
    if (!this.attente) return liste;
    const enAttente = await this.attente.toutes().catch(() => []);
    const connus = new Set(liste.map((d) => d.docId));
    const ajouts = enAttente.filter((e) => !connus.has(e.docId))
      .map((e) => ({ chemin: e.chemin, docId: e.docId, size: Math.max(0, e.bloc.length - SURCOUT_ENVELOPPE), mtime: e.mtime }));
    if (!ajouts.length) return liste;
    return [...liste, ...ajouts].sort((a, b) => (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0));
  }

  /**
   * Contenu clair d'un document (octets). Sert le cache de la session quand le
   * dernier manifeste annonce le même bloc que celui déjà déchiffré.
   */
  async lire(chemin) {
    const docId = await docIdAvec(this.cles, chemin);
    const enCache = this.clairs.get(docId);
    if (enCache && this.connus.get(docId) === enCache.sha256) return enCache.clair;
    // Version gardée hors ligne, pas encore envoyée : c'est la plus récente.
    const enAttente = this.attente && (await this.attente.lire(docId).catch(() => null));
    if (enAttente) return dechiffrerContenuAvec(this.cles, docId, enAttente.bloc);
    const r = await this.client.lire(docId);
    const clair = await dechiffrerContenuAvec(this.cles, docId, r.bloc);
    const sha256 = await sha256Hex(r.bloc);
    this.lus.set(docId, sha256);
    this.connus.set(docId, sha256);
    this.clairs.set(docId, { sha256, clair });
    return clair;
  }

  async lireTexte(chemin) {
    return new TextDecoder("utf-8").decode(await this.lire(chemin));
  }

  /**
   * Empreinte attendue côté serveur pour une écriture : celle du bloc lu ou écrit
   * par cette session, sinon celle du dernier manifeste, sinon on le relit.
   * '' = le document n'existe pas (création).
   */
  async _attendu(docId) {
    if (this.lus.has(docId)) return this.lus.get(docId);
    if (this.connus.has(docId)) return this.connus.get(docId);
    const man = await this.client.manifeste();
    const d = (man.docs || []).find((x) => x.docId === docId);
    return d && !d.deletedAt ? d.sha256 : "";
  }

  /**
   * Dernière version du casier, SANS en faire la base des écritures : la note
   * affichée ne la prend que si rien n'attend d'être enregistré (voir adopter).
   * null si une version d'ici attend encore d'être envoyée.
   */
  async relire(chemin) {
    const docId = await docIdAvec(this.cles, chemin);
    if (this.attente && (await this.attente.lire(docId).catch(() => null))) return null;
    const r = await this.client.lire(docId);
    const clair = await dechiffrerContenuAvec(this.cles, docId, r.bloc);
    const sha256 = await sha256Hex(r.bloc);
    this.connus.set(docId, sha256);
    this.clairs.set(docId, { sha256, clair });
    return { texte: new TextDecoder("utf-8").decode(clair), sha256 };
  }

  /** La note affichée repart de cette version du casier : les écritures suivantes la remplacent. */
  async adopter(chemin, sha256) {
    this.lus.set(await docIdAvec(this.cles, chemin), sha256);
  }

  /** Le casier a changé pour ce document (flux) : la prochaine lecture le retélécharge. */
  oublierVersion(docId) {
    this.connus.delete(docId);
  }

  /**
   * Relit le manifeste et renvoie les docId dont le bloc a changé depuis le
   * précédent (événements du flux manqués pendant une veille ou une coupure).
   */
  async changementsManques() {
    const avant = new Map(this.connus);
    if (!avant.size) return [];
    await this.lister();
    const changes = [];
    for (const [docId, sha] of this.connus) if (avant.get(docId) !== sha) changes.push(docId);
    for (const docId of avant.keys()) if (!this.connus.has(docId)) changes.push(docId);
    return changes;
  }

  async docIdDe(chemin) {
    return docIdAvec(this.cles, chemin);
  }

  /**
   * Empreinte sur laquelle repose une écriture gardée sur l'appareil : celle de
   * la version précédente gardée, sinon celle lue ou vue par cette session.
   * undefined = inconnue (relue au moment de l'envoi).
   */
  _base(docId, avant) {
    if (avant) return avant.inconnu ? undefined : avant.attendu;
    if (this.lus.has(docId)) return this.lus.get(docId);
    if (this.connus.has(docId)) return this.connus.get(docId);
    return undefined;
  }

  /** Garde une version chiffrée sur l'appareil (file d'attente), relue par lire() et lister(). */
  async _garder({ docId, chemin, bloc, pathEnc, mtime, sha256, clair }, base, refus = null) {
    await this.attente.garder({ docId, chemin, bloc, pathEnc, mtime, attendu: base ?? null, inconnu: base === undefined, date: Date.now(), ...(refus ? { refus } : {}) });
    this.clairs.set(docId, { sha256, clair });
    // Refusée : le casier garde l'ancienne version, qui reste la base de la prochaine écriture.
    if (!refus) this.connus.set(docId, sha256);
    signalerAttente(attendentLeReseau(await this.attente.toutes()));
  }

  /**
   * Chiffre et dépose. Lève ErreurChaine 400 NOT_MARKDOWN pour un autre type de
   * fichier, 413 (DOC_TOO_LARGE, QUOTA_EXCEEDED, TOO_MANY_DOCS) quand le casier
   * refuse la place : avec une file d'attente, la note reste alors sur
   * l'appareil (relue, listée) jusqu'à sa prochaine écriture ou au prochain
   * démarrage, jamais perdue.
   *
   * 412 (modifiée ailleurs depuis sa lecture) : levée telle quelle, sauf avec
   * { surConflit: "copie" } : la version d'ici part dans « nom (conflict …).md »,
   * la note garde celle du casier, et la réponse vaut { conflit: { copie, texte } }
   * (texte = version du casier, à afficher).
   */
  async ecrire(chemin, contenu, { surConflit = null } = {}) {
    if (!estMarkdown(chemin)) throw new ErreurChaine(400, "NOT_MARKDOWN", "");
    const docId = await docIdAvec(this.cles, chemin);
    const clair = typeof contenu === "string" ? new TextEncoder().encode(contenu) : new Uint8Array(contenu);
    // maxDocBytes limite le clair (le bloc fait SURCOUT_ENVELOPPE octets de plus).
    const max = typeof this.serveur?.maxDocBytes === "number" ? this.serveur.maxDocBytes : MAX_DOC_BYTES_DEFAUT;
    if (clair.length > max && !this.attente) throw new ErreurChaine(413, "DOC_TOO_LARGE", "");
    const bloc = await chiffrerContenuAvec(this.cles, docId, clair);
    const pathEnc = await chiffrerCheminAvec(this.cles, docId, chemin);
    const mtime = new Date().toISOString();
    const sha256 = await sha256Hex(bloc);
    const version = { docId, chemin, bloc, pathEnc, mtime, sha256, clair };
    // Une version refusée faute de place est remplacée par celle-ci ; une version
    // plus ancienne qui attend le réseau, on essaie d'abord de la faire partir.
    let avant = this.attente ? await this.attente.lire(docId) : null;
    const remplaceRefus = !!avant?.refus;
    if (remplaceRefus) await this.attente.oublier(docId);
    else if (avant) {
      await this.envoyerEnAttente().catch(() => {});
      avant = await this.attente.lire(docId);
    }
    if (clair.length > max) {
      await this._garder(version, this._base(docId, avant), "DOC_TOO_LARGE");
      throw new ErreurChaine(413, "DOC_TOO_LARGE", "");
    }
    try {
      if (avant && !remplaceRefus) throw new TypeError("toujours hors ligne");
      let attendu = remplaceRefus ? this._base(docId, avant) : undefined;
      if (attendu === undefined) attendu = await this._attendu(docId);
      const r = await this.client.deposer(docId, { bloc, pathEnc, mtime, attendu: attendu || null });
      this.lus.set(docId, sha256);
      this.connus.set(docId, sha256);
      this.clairs.set(docId, { sha256, clair });
      return r;
    } catch (err) {
      if (err?.status === 412 && surConflit === "copie") return this._conflit(chemin, docId, clair);
      if (this.attente && estQuota(err)) {
        // Casier plein ou note trop grosse pour le serveur : gardée ici, pas perdue.
        await this._garder(version, this._base(docId, avant), err.code || "QUOTA_EXCEEDED");
        throw err;
      }
      if (!this.attente || !estErreurReseau(err)) throw err;
      // Hors ligne : gardé chiffré sur l'appareil, envoyé au retour du réseau.
      // La base reste la version lue avant la coupure (If-Match au moment de l'envoi).
      await this._garder(version, this._base(docId, avant));
      return { enAttente: true };
    }
  }

  /**
   * 412 sur la note ouverte : la version d'ici devient une copie de conflit,
   * la note reprend celle du casier. Supprimée ailleurs : la note est recréée.
   */
  async _conflit(chemin, docId, clair) {
    let distant = null;
    try {
      const r = await this.client.lire(docId);
      distant = { clair: await dechiffrerContenuAvec(this.cles, docId, r.bloc), sha256: await sha256Hex(r.bloc) };
    } catch (err) {
      if (!(err instanceof ErreurChaine) || (err.status !== 404 && err.status !== 410)) throw err;
    }
    if (!distant) {
      this.lus.set(docId, "");
      this.connus.set(docId, "");
      return this.ecrire(chemin, clair);
    }
    this.lus.set(docId, distant.sha256);
    this.connus.set(docId, distant.sha256);
    this.clairs.set(docId, distant);
    const texte = new TextDecoder("utf-8").decode(distant.clair);
    if (egaux(distant.clair, clair)) return { conflit: null };
    const copie = await this._nomLibre(nomDeConflit(chemin));
    await this.ecrire(copie, clair);
    return { conflit: { copie, texte } };
  }

  /** Premier nom libre : « x.md », sinon « x 2.md », « x 3.md »… */
  async _nomLibre(chemin) {
    await this.lister().catch(() => {});
    const tige = chemin.replace(/\.md$/i, "");
    for (let n = 1; ; n++) {
      const essai = n === 1 ? chemin : `${tige} ${n}.md`;
      if (!this.connus.get(await docIdAvec(this.cles, essai))) return essai;
    }
  }

  /**
   * Envoie les notes gardées hors ligne. Une note modifiée ailleurs pendant la
   * coupure n'est jamais écrasée : la version d'ici devient « … (offline copy).md ».
   * Renvoie le nombre de notes envoyées ; lève une erreur réseau si la connexion manque encore.
   */
  envoyerEnAttente({ refus = false } = {}) {
    if (!this.attente) return Promise.resolve(0);
    if (this.envoi) return this.envoi;
    this.envoi = (async () => {
      let envoyes = 0;
      for (const e of await this.attente.toutes()) {
        // Refusée faute de place : retentée au démarrage ou à sa prochaine écriture.
        if (e.refus && (!refus || e.refus === "DOC_TOO_LARGE")) continue;
        let attendu = e.inconnu ? undefined : e.attendu;
        try {
          if (attendu === undefined) {
            const man = await this.client.manifeste();
            const d = (man.docs || []).find((x) => x.docId === e.docId);
            attendu = d && !d.deletedAt ? d.sha256 : null;
          }
          await this.client.deposer(e.docId, { bloc: e.bloc, pathEnc: e.pathEnc, mtime: e.mtime, attendu: attendu || null });
          const sha = await sha256Hex(e.bloc);
          this.lus.set(e.docId, sha);
          this.connus.set(e.docId, sha);
        } catch (err) {
          if (estErreurReseau(err)) throw err;
          if (err?.status !== 412 && err?.status !== 409) continue; // refus (place, taille) : la note reste sur l'appareil
          const clair = await dechiffrerContenuAvec(this.cles, e.docId, e.bloc);
          await this.attente.oublier(e.docId);
          this.clairs.delete(e.docId);
          await this.ecrire(e.chemin.replace(/\.md$/i, "") + " (offline copy).md", clair);
          envoyes++;
          continue;
        }
        await this.attente.oublier(e.docId);
        envoyes++;
      }
      return envoyes;
    })().finally(async () => {
      this.envoi = null;
      signalerAttente(attendentLeReseau(await this.attente.toutes().catch(() => [])));
    });
    return this.envoi;
  }

  /** Supprime avec If-Match : 412 si le document a changé ailleurs depuis sa lecture. */
  async supprimer(chemin) {
    const docId = await docIdAvec(this.cles, chemin);
    const base = await this._attendu(docId);
    await this.client.supprimer(docId, await chiffrerTombeAvec(this.cles, docId, base || ""), base || null);
    this.lus.set(docId, "");
    this.connus.set(docId, "");
    this.clairs.delete(docId);
  }
}

/** Arbre imbriqué pour la barre latérale à partir de la liste plate de lister(). */
export function construireArbre(liste, prefixe = "cloud://") {
  const racine = [];
  const dossiers = new Map();
  for (const d of liste) {
    const parts = d.chemin.split("/").filter(Boolean);
    let freres = racine;
    let acc = "";
    for (let i = 0; i < parts.length - 1; i++) {
      acc = acc ? `${acc}/${parts[i]}` : parts[i];
      let dossier = dossiers.get(acc);
      if (!dossier) {
        dossier = { name: parts[i], path: `${prefixe}${acc}`, isDirectory: true, children: [] };
        freres.push(dossier);
        dossiers.set(acc, dossier);
      }
      freres = dossier.children;
    }
    freres.push({ name: parts[parts.length - 1], path: `${prefixe}${d.chemin}`, isDirectory: false, size: d.size, mtime: d.mtime });
  }
  const trier = (noeuds) => {
    noeuds.sort((a, b) => (a.isDirectory !== b.isDirectory ? (a.isDirectory ? -1 : 1) : a.name.localeCompare(b.name)));
    for (const n of noeuds) if (n.children) trier(n.children);
  };
  trier(racine);
  return racine;
}
