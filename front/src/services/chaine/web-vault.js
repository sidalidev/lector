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

export class VaultWebChaine {
  /**
   * @param {object} o
   * @param {import('./client.js').ClientChaine} o.client
   * @param {{id, preuve, cleEnc, cleMac}} o.cles
   */
  constructor({ client, cles }) {
    this.client = client;
    this.cles = cles;
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
    const man = await this.client.manifeste();
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
    return sortie;
  }

  /**
   * Contenu clair d'un document (octets). Sert le cache de la session quand le
   * dernier manifeste annonce le même bloc que celui déjà déchiffré.
   */
  async lire(chemin) {
    const docId = await docIdAvec(this.cles, chemin);
    const enCache = this.clairs.get(docId);
    if (enCache && this.connus.get(docId) === enCache.sha256) return enCache.clair;
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
    const r = await this.client.deposer(docId, {
      bloc,
      pathEnc,
      mtime: new Date().toISOString(),
      attendu: (await this._attendu(docId)) || null,
    });
    const sha256 = await sha256Hex(bloc);
    this.lus.set(docId, sha256);
    this.connus.set(docId, sha256);
    this.clairs.set(docId, { sha256, clair });
    return r;
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
