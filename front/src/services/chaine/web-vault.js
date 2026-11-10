// Vault « cloud:// » du navigateur (docs/CHAINE.md § 6.5).
//
// Pas de disque local : l'arbre vient du manifeste du casier dont on déchiffre
// les pathEnc, la lecture télécharge puis déchiffre un bloc, l'écriture chiffre
// puis dépose avec If-Match (le dernier écrit ne gagne pas en silence : le
// serveur répond 412 si le document a changé ailleurs). Markdown seulement.
//
// Module ES pur (client et clés injectés), testé dans synchro.test.mjs.

import { ErreurChaine, MAX_DOC_BYTES_DEFAUT } from "./client.js";
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
import { estMarkdown } from "./synchro.js";
import { estErreurReseau } from "./attente.js";

/** Prévient l'interface du nombre de notes qui attendent le réseau. */
function signalerAttente(n) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("lector-attente", { detail: { n } }));
}

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
   * Chiffre et dépose. Lève ErreurChaine 400 NOT_MARKDOWN pour un autre type de
   * fichier, 413 DOC_TOO_LARGE au-delà de la limite du serveur, 412 si le
   * document a changé ailleurs depuis sa lecture.
   */
  async ecrire(chemin, contenu) {
    if (!estMarkdown(chemin)) throw new ErreurChaine(400, "NOT_MARKDOWN", "");
    const docId = await docIdAvec(this.cles, chemin);
    const clair = typeof contenu === "string" ? new TextEncoder().encode(contenu) : new Uint8Array(contenu);
    // maxDocBytes limite le clair (le bloc fait SURCOUT_ENVELOPPE octets de plus).
    const max = typeof this.serveur?.maxDocBytes === "number" ? this.serveur.maxDocBytes : MAX_DOC_BYTES_DEFAUT;
    if (clair.length > max) throw new ErreurChaine(413, "DOC_TOO_LARGE", "");
    const bloc = await chiffrerContenuAvec(this.cles, docId, clair);
    const pathEnc = await chiffrerCheminAvec(this.cles, docId, chemin);
    const mtime = new Date().toISOString();
    const sha256 = await sha256Hex(bloc);
    // Une version plus ancienne attend déjà : on essaie d'abord de la faire partir.
    if (this.attente && (await this.attente.lire(docId))) await this.envoyerEnAttente().catch(() => {});
    try {
      if (this.attente && (await this.attente.lire(docId))) throw Object.assign(new TypeError("toujours hors ligne"), {});
      const r = await this.client.deposer(docId, { bloc, pathEnc, mtime, attendu: (await this._attendu(docId)) || null });
      this.lus.set(docId, sha256);
      this.connus.set(docId, sha256);
      this.clairs.set(docId, { sha256, clair });
      return r;
    } catch (err) {
      if (!this.attente || !estErreurReseau(err)) throw err;
      // Hors ligne : gardé chiffré sur l'appareil, envoyé au retour du réseau.
      // La base reste la version lue avant la coupure (If-Match au moment de l'envoi).
      const avant = await this.attente.lire(docId);
      const base = avant ? (avant.inconnu ? undefined : avant.attendu)
        : this.lus.has(docId) ? this.lus.get(docId) : this.connus.has(docId) ? this.connus.get(docId) : undefined;
      await this.attente.garder({ docId, chemin, bloc, pathEnc, mtime, attendu: base ?? null, inconnu: base === undefined, date: Date.now() });
      this.clairs.set(docId, { sha256, clair });
      this.connus.set(docId, sha256);
      signalerAttente((await this.attente.toutes()).length);
      return { enAttente: true };
    }
  }

  /**
   * Envoie les notes gardées hors ligne. Une note modifiée ailleurs pendant la
   * coupure n'est jamais écrasée : la version d'ici devient « … (offline copy).md ».
   * Renvoie le nombre de notes envoyées ; lève une erreur réseau si la connexion manque encore.
   */
  envoyerEnAttente() {
    if (!this.attente) return Promise.resolve(0);
    if (this.envoi) return this.envoi;
    this.envoi = (async () => {
      let envoyes = 0;
      for (const e of await this.attente.toutes()) {
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
          if (err?.status !== 412 && err?.status !== 409) continue; // refus (place, taille) : la note reste en attente
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
      signalerAttente((await this.attente.toutes().catch(() => [])).length);
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
