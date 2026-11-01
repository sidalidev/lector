// Synchronisation chiffrée d'un vault local avec le casier d'une chaîne
// (docs/CHAINE.md § 6, 7 et 11).
//
// Module ES pur : le vault et le client sont injectés. Il sert au processus
// principal d'Electron (desktop/sync-manager.js et chaine-desktop.js) ; les
// tests (synchro.test.mjs) le font tourner contre un serveur simulé.
//
// Interface du vault (synchrone ou asynchrone, tout est attendu) :
//   scanManifest()                     → { cheminRelatif: { sha256, size, mtime } }  (empreinte du CLAIR)
//   readClear(chemin)                  → octets du fichier
//   writeClear(chemin, octets, mtime, attendu)
//   remove(chemin, attendu)
//   absent(chemin)                     → vrai si rien n'existe à ce chemin sur le disque
// `attendu` : empreinte du clair vue par la synchro, ou null pour un fichier qui
// ne doit pas exister. Si le disque a changé depuis (l'utilisateur vient
// d'enregistrer), le vault ne touche à rien et lève une erreur de code ECHANGED.
// Sur un disque insensible à la casse (macOS, Windows), absent("notes.md") est
// faux quand « Notes.md » existe : les deux noms y désignent le même fichier.
//
// Base locale (fichier <vault>/.lector-sync/chaine.json) :
//   { version: 2, chainId, docs: { chemin: { docId, sha256Clair, sha256Bloc, size, mtime, horsDisque? } } }
// Deux empreintes : celle du clair (comparée au disque) et celle du bloc chiffré
// (comparée au manifeste du serveur). Rien de dérivé du clair ne part au serveur.
// Une base d'une autre version est ignorée et reconstruite. `horsDisque` : la
// version d'un document est connue mais un autre fichier occupe son nom (même
// nom à la casse près, sur un disque qui ne la distingue pas) ; ce document
// n'est jamais supprimé d'ici.
//
// Seuls les fichiers markdown voyagent, dans les deux sens : un fichier local
// d'un autre type n'est jamais lu, envoyé ni supprimé ; un bloc dont le chemin
// déchiffré n'est pas markdown n'est jamais écrit sur le disque.

import { ErreurChaine, MAX_DOC_BYTES_DEFAUT, estChaineInconnue, estQuota } from "./client.js";
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
  verifierTombeAvec,
} from "./crypto.js";

export const VERSION_BASE = 2;

// Nombre maximal de passes pendant un renouvellement avant d'abandonner, si
// d'autres appareils écrivent sans arrêt dans l'ancien casier.
const TOURS_MAX = 5;

/** Vrai pour un fichier .md ou .markdown (casse indifférente) hors de tout dossier ou fichier caché. */
export function estMarkdown(chemin) {
  if (typeof chemin !== "string" || !/\.(md|markdown)$/i.test(chemin)) return false;
  return !chemin.split("/").some((segment) => segment.startsWith("."));
}

/** Base vide pour une chaîne. */
export function baseVide(chainId) {
  return { version: VERSION_BASE, chainId, docs: {} };
}

/** Nom de la copie de conflit : « nom (conflict AAAA-MM-JJ-HH-MM).ext ». */
export function nomDeConflit(chemin, date = new Date()) {
  const point = chemin.lastIndexOf(".");
  const slash = chemin.lastIndexOf("/");
  const aExtension = point > slash + 1;
  const tige = aExtension ? chemin.slice(0, point) : chemin;
  const ext = aExtension ? chemin.slice(point) : "";
  const ts = date.toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return `${tige} (conflict ${ts})${ext}`;
}

/** Empreinte du contenu d'un manifeste : change dès qu'un document est déposé ou supprimé. */
export function signatureDe(man) {
  return (man.docs || [])
    .map((d) => `${d.docId}:${d.sha256}:${d.deletedAt || ""}`)
    .sort()
    .join("|");
}

/** Vrai si un cycle a changé quelque chose sur le disque ou sur le serveur. */
function aBouge(ops) {
  return ops.put.length + ops.get.length + ops.del.length + ops.removeLocal.length + ops.conflict.length + ops.relancer.length > 0;
}

// Fichier local qu'on ne peut pas écrire (nom interdit sous Windows, fichier
// verrouillé, chemin refusé par le vault, lien symbolique) : on saute ce
// fichier, les autres continuent.
const CODES_ECRITURE = new Set(["EINVAL", "EPERM", "EBUSY", "EACCES", "ENAMETOOLONG", "EINVALIDPATH", "ESYMLINK"]);
const estErreurEcriture = (err) => !!err && CODES_ECRITURE.has(err.code);
const estBlocIllisible = (err) => /^Bloc (illisible|invalide)/.test(String(err?.message || ""));
const fini = (n) => typeof n === "number" && Number.isFinite(n);

/** Deux chemins de même clé ne diffèrent que par la casse (ou la forme Unicode). */
const cleCasse = (chemin) => chemin.normalize("NFC").toLowerCase();

/** Limite du clair d'un document : celle du serveur, sinon la valeur par défaut. */
const maxDocDe = (man) => (fini(man.maxDocBytes) ? man.maxDocBytes : MAX_DOC_BYTES_DEFAUT);

/**
 * Place disponible d'après le manifeste, pour ne pas envoyer ce qui serait
 * refusé. Le serveur reste juge : un 413 arrête les envois du cycle.
 * maxDocBytes limite le clair : un bloc peut faire SURCOUT_ENVELOPPE octets de plus.
 */
function budgetDe(man) {
  const vivants = (man.docs || []).filter((d) => !d.deletedAt).length;
  return {
    octetsLibres: fini(man.quotaBytes) ? man.quotaBytes - (man.bytesUsed || 0) : Infinity,
    docsLibres: fini(man.maxDocs) ? man.maxDocs - vivants : Infinity,
    maxBloc: maxDocDe(man) + SURCOUT_ENVELOPPE,
    plein: false,
  };
}

/** Réserve la place d'un bloc de `taille` octets qui en remplace `ancienne` (0 = nouveau document). */
function reserver(budget, taille, ancienne) {
  if (taille > budget.maxBloc) return "tropGros";
  const nouveau = ancienne === 0;
  if (budget.plein || taille - ancienne > budget.octetsLibres || (nouveau && budget.docsLibres < 1)) return "quota";
  budget.octetsLibres -= taille - ancienne;
  if (nouveau) budget.docsLibres -= 1;
  return "ok";
}

function liberer(budget, taille) {
  budget.octetsLibres += taille;
  budget.docsLibres += 1;
}

/** 413 du serveur : document trop gros, ou casier plein (on n'envoie plus rien pendant ce cycle). */
function noterRefus(budget, ops, err, chemin, log) {
  if (err.code === "DOC_TOO_LARGE") {
    ops.tropGros.push(chemin);
    log("too-large", chemin);
  } else {
    budget.plein = true;
    ops.quota.push(chemin);
    log("quota", chemin);
  }
}

function etatServeur(man, budget) {
  return {
    bytesUsed: fini(man.quotaBytes) && fini(budget.octetsLibres) ? man.quotaBytes - budget.octetsLibres : man.bytesUsed ?? null,
    quotaBytes: man.quotaBytes ?? null,
    maxDocBytes: maxDocDe(man),
    maxDocs: man.maxDocs ?? null,
  };
}

/** Chiffre et dépose un document. `attendu` : empreinte du bloc remplacé, ou null pour une création. */
async function deposer(client, cles, docId, chemin, clair, mtime, attendu) {
  const bloc = await chiffrerContenuAvec(cles, docId, clair);
  const pathEnc = await chiffrerCheminAvec(cles, docId, chemin);
  await client.deposer(docId, { bloc, pathEnc, mtime, attendu: attendu || null });
  return sha256Hex(bloc);
}

/**
 * Pierre tombale authentifiée : la marque chiffrée porte le docId et l'empreinte
 * du bloc supprimé, envoyée aussi en If-Match (412 si le document a changé).
 */
async function supprimerServeur(client, cles, docId, shaBloc) {
  const tombEnc = await chiffrerTombeAvec(cles, docId, shaBloc || "");
  await client.supprimer(docId, tombEnc, shaBloc || null);
}

/** Télécharge et déchiffre un bloc. Lève une erreur « Bloc illisible » si l'authentification échoue. */
async function telecharger(client, cles, docId) {
  const r = await client.lire(docId);
  const sha256Bloc = await sha256Hex(r.bloc);
  const clair = await dechiffrerContenuAvec(cles, docId, r.bloc);
  return { clair, sha256Bloc, mtime: r.mtime };
}

const entreeBase = async (docId, clair, sha256Bloc, mtime) => ({
  docId,
  sha256Clair: await sha256Hex(clair),
  sha256Bloc,
  size: clair.length,
  mtime: mtime || new Date().toISOString(),
});

/**
 * Un cycle de synchronisation à trois voies.
 *
 * @param {object} o
 * @param {object} o.vault        voir l'en-tête du fichier
 * @param {import('./client.js').ClientChaine} o.client
 * @param {{id, preuve, cleEnc, cleMac}} o.cles  résultat de preparer(S)
 * @param {object|null} o.base    contenu de chaine.json : base de cette chaîne, d'une
 *   autre chaîne (après un renouvellement, elle guide l'adoption) ou null
 * @param {(type: string, cible: string) => void} [o.log]
 * @param {AbortSignal} [o.signal]  arrêt de la synchro : le cycle s'interrompt
 *   avant sa prochaine écriture (disque ou serveur) et lève l'erreur du signal
 * @returns {Promise<{ops, base, adoption: boolean, signature: string, serveur: object}>}
 */
export async function synchroniserChaine({ vault, client, cles, base, log = () => {}, signal }) {
  const arreter = () => signal?.throwIfAborted();
  const baseValide = !!(base && base.version === VERSION_BASE && base.docs);
  const memeChaine = baseValide && base.chainId === cles.id;
  const docsBase = memeChaine ? base.docs : {};
  // Adoption (§ 6.3) : cet appareil arrive sur cette chaîne avec un vault déjà
  // rempli. La base d'une chaîne précédente dit qui a bougé depuis.
  const ancienneBase = baseValide && !memeChaine ? base.docs : null;

  const local = await vault.scanManifest();
  const man = await client.manifeste();
  arreter();
  const budget = budgetDe(man);

  // Base indexée par docId (le chemin sert de clé dans le fichier, le docId ici).
  const B_ = new Map();
  for (const [chemin, b] of Object.entries(docsBase)) {
    if (b && estDocIdValide(b.docId) && estMarkdown(chemin)) B_.set(b.docId, { ...b, chemin });
  }

  // Fichier renommé seulement par la casse sur un disque qui ne la distingue pas :
  // « Notes.md » sur le disque, « notes.md » dans la base, et le disque répond
  // que « notes.md » existe encore. C'est le même fichier, donc le même
  // document (son chemin reste celui de la base) : ni nouveau document, ni
  // pierre tombale.
  const renommables = new Map(); // clé de casse → chemin de la base absent du scan (null si ambigu)
  for (const [chemin, b] of Object.entries(docsBase)) {
    if (!b || b.horsDisque || !estDocIdValide(b.docId) || !estMarkdown(chemin) || Object.hasOwn(local, chemin)) continue;
    const cle = cleCasse(chemin);
    renommables.set(cle, renommables.has(cle) ? null : chemin);
  }
  async function cheminDeBase(disque) {
    const chemin = renommables.get(cleCasse(disque));
    if (!chemin) return null;
    try {
      return (await vault.absent(chemin)) ? null : chemin;
    } catch {
      return null;
    }
  }

  // Disque indexé par docId, markdown seulement. Le docId du chemin est mis en
  // cache dans la base. `disque` : nom du fichier sur le disque, `chemin` : celui du document.
  const L_ = new Map();
  for (const [disque, e] of Object.entries(local)) {
    if (!estMarkdown(disque)) continue;
    let chemin = disque;
    let docId = docsBase[disque]?.docId;
    if (!estDocIdValide(docId)) {
      const deBase = await cheminDeBase(disque);
      if (deBase) {
        chemin = deBase;
        docId = docsBase[deBase].docId;
      } else {
        try {
          docId = await docIdAvec(cles, disque);
        } catch {
          log("invalid-path", disque);
          continue;
        }
      }
    }
    // Deux noms sur le disque qui donnent le même chemin normalisé (NFC et NFD) : on garde le premier.
    if (L_.has(docId)) {
      log("duplicate", disque);
      continue;
    }
    L_.set(docId, { ...e, chemin, disque });
  }

  // Serveur indexé par docId. Le chemin d'un document inconnu vient du déchiffrement de pathEnc.
  const S_ = new Map();
  for (const d of man.docs || []) if (estDocIdValide(d.docId)) S_.set(d.docId, d);
  const cheminsServeur = new Map();
  const indechiffrables = new Set();
  const horsFormat = new Map();
  for (const [docId, d] of S_) {
    if (L_.has(docId) || B_.has(docId) || d.deletedAt) continue;
    try {
      const chemin = await dechiffrerCheminAvec(cles, docId, d.pathEnc);
      if (estMarkdown(chemin)) cheminsServeur.set(docId, chemin);
      else horsFormat.set(docId, chemin);
    } catch {
      indechiffrables.add(docId);
      log("undecryptable", docId);
    }
  }

  const ops = {
    put: [],
    get: [],
    del: [],
    removeLocal: [],
    conflict: [],
    relancer: [],
    indechiffrables: [],
    horsFormat: [],
    tropGros: [],
    quota: [],
    tombesRefusees: [],
    manquants: [],
    sautes: [], // documents que le disque refuse (nom interdit, verrouillé, lien symbolique, nom occupé)
  };
  const plan = [];
  const nouvelle = {};
  const garder = (docId) => {
    const B = B_.get(docId);
    if (!B) return;
    const { chemin, ...reste } = B;
    nouvelle[chemin] = reste;
  };

  for (const docId of new Set([...L_.keys(), ...S_.keys(), ...B_.keys()])) {
    const L = L_.get(docId);
    const S = S_.get(docId);
    const B = B_.get(docId);
    const sTomb = !!(S && S.deletedAt);
    const sVivant = !!(S && !S.deletedAt);

    if (indechiffrables.has(docId)) {
      ops.indechiffrables.push(docId);
      garder(docId);
      continue;
    }
    if (horsFormat.has(docId)) {
      // Déposé par un autre client : jamais écrit ici, jamais supprimé.
      ops.horsFormat.push(horsFormat.get(docId));
      log("not-markdown", horsFormat.get(docId));
      continue;
    }
    const chemin = L?.chemin ?? B?.chemin ?? cheminsServeur.get(docId);
    if (!chemin) continue; // pierre tombale d'un document que cet appareil n'a jamais eu

    if (!L && B?.horsDisque) {
      // Version connue sans fichier à son nom : jamais supprimée d'ici, écrite
      // quand le nom se libère, recopiée en conflit si elle change.
      if (sVivant) plan.push({ type: "get", docId, chemin });
      continue;
    }

    const localModifie = !!L && (!B || L.sha256 !== B.sha256Clair);
    const serveurModifie = sVivant && (!B || S.sha256 !== B.sha256Bloc);

    if (L && !S && !B) plan.push({ type: "put", docId, chemin, attendu: null });
    else if (!L && sVivant && !B) plan.push({ type: "get", docId, chemin });
    else if (!L && B && sVivant) {
      // Supprimé ici. Si le serveur n'a pas bougé, on propage ; sinon sa version gagne.
      plan.push(serveurModifie ? { type: "get", docId, chemin } : { type: "del", docId, chemin, attendu: S.sha256, taille: S.size });
    } else if (L && sTomb) {
      // Supprimé ailleurs. Local inchangé ET marque de suppression authentique
      // pour le bloc que cet appareil connaissait : on le retire. Sinon (local
      // modifié, adoption, marque absente, fausse ou rejouée sur une autre
      // version) : rien n'est supprimé ici, le document est renvoyé. Le serveur
      // ne peut donc pas faire effacer un fichier local en posant deletedAt.
      const marqueValide = !!B && !localModifie && (await verifierTombeAvec(cles, docId, S.tombEnc, B.sha256Bloc));
      if (marqueValide) plan.push({ type: "removeLocal", docId, chemin });
      else {
        if (B && !localModifie) {
          ops.tombesRefusees.push(chemin);
          log("tomb-unverified", chemin);
        }
        plan.push({ type: "put", docId, chemin, attendu: null });
      }
    } else if (L && sVivant) {
      if (!localModifie && !serveurModifie) garder(docId);
      else if (localModifie && !serveurModifie) plan.push({ type: "put", docId, chemin, attendu: S.sha256 });
      else if (!localModifie && serveurModifie) plan.push({ type: "get", docId, chemin });
      else plan.push({ type: "comparer", docId, chemin, sansBase: !B });
    } else if (L && !S && B) {
      // Le serveur ne connaît plus ce document (pierre tombale purgée ou perte) : on le renvoie.
      plan.push({ type: "put", docId, chemin, attendu: null });
    }
    // !L et pas de bloc vivant : rien à faire, l'entrée disparaît de la base.
  }

  const loc = (docId) => L_.get(docId);
  const serv = (docId) => S_.get(docId);
  const tailleServeur = (docId) => (serv(docId) && !serv(docId).deletedAt ? serv(docId).size || 0 : 0);

  // Noms pris sur le disque, par clé de casse : un téléchargement ne prend
  // jamais la place du fichier d'un autre document.
  const occupants = new Map();
  for (const L of L_.values()) occupants.set(cleCasse(L.disque), L);

  // Toute écriture, sur le disque ou sur le serveur, passe d'abord par arreter().
  const ecrire = async (chemin, octets, mtime, attendu) => {
    arreter();
    await vault.writeClear(chemin, octets, mtime, attendu);
  };

  /** Envoie si la place le permet ; sinon le note et renvoie false. */
  async function envoyer(docId, chemin, clair, mtime, attendu) {
    const place = reserver(budget, clair.length + SURCOUT_ENVELOPPE, tailleServeur(docId));
    if (place !== "ok") {
      ops[place].push(chemin);
      log(place === "tropGros" ? "too-large" : "quota", chemin);
      return false;
    }
    arreter();
    const sha256Bloc = await deposer(client, cles, docId, chemin, clair, mtime, attendu);
    nouvelle[chemin] = await entreeBase(docId, clair, sha256Bloc, mtime);
    return true;
  }

  /** Écrit la version du casier à côté du fichier local, sous un nom de copie de conflit. */
  async function ecrireCopie(chemin, clair, mtime) {
    const nomCopie = nomDeConflit(chemin);
    await ecrire(nomCopie, clair, mtime, null);
    log("conflict-saved", nomCopie);
    return nomCopie;
  }

  /** Envoie une copie de conflit à tous les appareils. */
  async function envoyerCopie(nomCopie, clair, mtime) {
    await envoyer(await docIdAvec(cles, nomCopie), nomCopie, clair, mtime || new Date().toISOString(), null);
  }

  // Ordre : retraits locaux (un document renommé ailleurs libère son nom avant
  // l'arrivée du nouveau), téléchargements, suppressions (elles libèrent de la
  // place), envois, puis comparaisons.
  const ordre = { removeLocal: 0, get: 1, del: 2, put: 3, comparer: 4 };
  plan.sort((a, b) => ordre[a.type] - ordre[b.type]);

  for (const op of plan) {
    const { docId, chemin } = op;
    arreter();
    try {
      if (op.type === "get") {
        const L = loc(docId);
        if (!L && !(await vault.absent(chemin))) await nomOccupe(op);
        else {
          const t = await telecharger(client, cles, docId);
          const mtime = t.mtime || serv(docId)?.mtime;
          const disque = L?.disque ?? chemin;
          await ecrire(disque, t.clair, mtime, L ? L.sha256 : null);
          nouvelle[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, mtime);
          occupants.set(cleCasse(disque), { sha256: nouvelle[chemin].sha256Clair });
          ops.get.push(chemin);
          log("pulled", chemin);
        }
      } else if (op.type === "del") {
        if (await vault.absent(chemin)) {
          arreter();
          await supprimerServeur(client, cles, docId, op.attendu);
          liberer(budget, op.taille || 0);
          ops.del.push(chemin);
          log("deleted-server", chemin);
        } else {
          // Le disque a encore un fichier à ce nom (même nom à la casse près,
          // derrière un lien symbolique, recréé depuis le scan) : pas de pierre tombale.
          garder(docId);
          log("kept-on-disk", chemin);
        }
      } else if (op.type === "removeLocal") {
        const L = loc(docId);
        await vault.remove(L.disque, L.sha256);
        occupants.delete(cleCasse(L.disque));
        ops.removeLocal.push(chemin);
        log("removed-local", chemin);
      } else if (op.type === "put") {
        const L = loc(docId);
        const clair = await vault.readClear(L.disque);
        if (await envoyer(docId, chemin, clair, L.mtime || new Date().toISOString(), op.attendu)) {
          ops.put.push(chemin);
          log("pushed", chemin);
        } else garder(docId);
      } else if (op.type === "comparer") {
        await comparer(op);
      }
    } catch (err) {
      if (estChaineInconnue(err) || signal?.aborted) throw err;
      if (op.type === "del" && err instanceof ErreurChaine && (err.status === 404 || err.status === 410)) {
        // Déjà parti du serveur.
        ops.del.push(chemin);
      } else if (err?.code === "ECHANGED" || (err instanceof ErreurChaine && (err.status === 412 || err.status === 410))) {
        // Quelqu'un a écrit entre le manifeste et notre requête, ou l'utilisateur
        // vient d'enregistrer le fichier : on relance un cycle au lieu d'écraser.
        ops.relancer.push(chemin);
        garder(docId);
        log("conflict-retry", chemin);
      } else if (err instanceof ErreurChaine && err.status === 404) {
        // Bloc annoncé vivant par le manifeste mais introuvable sur le serveur
        // (disque du serveur abîmé, restauration) : signalé, sans relance.
        ops.manquants.push(chemin);
        garder(docId);
        log("missing-on-server", chemin);
      } else if (estQuota(err)) {
        noterRefus(budget, ops, err, chemin, log);
        garder(docId);
      } else if (estBlocIllisible(err)) {
        // Jamais de suppression locale sur une erreur de déchiffrement.
        ops.indechiffrables.push(chemin);
        garder(docId);
        log("undecryptable", chemin);
      } else if (estErreurEcriture(err)) {
        ops.sautes.push(chemin);
        garder(docId);
        log(err.code === "EINVALIDPATH" ? "invalid-path" : `skipped-${op.type}-write`, chemin);
      } else {
        throw err;
      }
    }
  }

  // Le nom d'un document à télécharger est déjà pris sur le disque : par le
  // fichier d'un autre document dont le nom ne diffère que par la casse (macOS,
  // Windows), ou par un fichier apparu depuis le scan. Rien n'est écrasé : la
  // version du casier devient une copie de conflit si elle diffère, et la base
  // la retient sans fichier (horsDisque) pour ne pas la recopier à chaque cycle.
  async function nomOccupe({ docId, chemin }) {
    const voisin = occupants.get(cleCasse(chemin));
    const B = B_.get(docId);
    if (!voisin || (B?.horsDisque && B.sha256Bloc === serv(docId).sha256)) {
      garder(docId);
      if (!voisin) {
        ops.sautes.push(chemin);
        log("skipped-get-write", chemin);
      }
      return;
    }
    const t = await telecharger(client, cles, docId);
    const mtime = t.mtime || serv(docId).mtime;
    if ((await sha256Hex(t.clair)) !== voisin.sha256) {
      const nomCopie = await ecrireCopie(chemin, t.clair, mtime);
      await envoyerCopie(nomCopie, t.clair, mtime);
      ops.conflict.push(chemin);
      log("conflict-pushed", chemin);
    }
    nouvelle[chemin] = { ...(await entreeBase(docId, t.clair, t.sha256Bloc, mtime)), horsDisque: true };
  }

  // Les deux côtés ont changé (ou pas de base) : on télécharge et on compare les clairs.
  async function comparer({ docId, chemin, sansBase }) {
    const t = await telecharger(client, cles, docId);
    const local = loc(docId);
    const shaServeurClair = await sha256Hex(t.clair);
    if (shaServeurClair === local.sha256) {
      // Même contenu des deux côtés : pas un conflit, on met juste la base à jour.
      nouvelle[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, local.mtime);
      return;
    }
    const ancien = sansBase && ancienneBase ? (ancienneBase[chemin] ?? ancienneBase[chemin.normalize("NFC")])?.sha256Clair : null;
    if (ancien && local.sha256 === ancien) {
      // Seul le serveur a bougé depuis la chaîne précédente : on prend sa version.
      await ecrire(local.disque, t.clair, t.mtime, local.sha256);
      nouvelle[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, t.mtime);
      ops.get.push(chemin);
      log("pulled", chemin);
      return;
    }
    const clair = await vault.readClear(local.disque);
    if (ancien && shaServeurClair === ancien) {
      // Seul le local a bougé : il part tel quel.
      if (await envoyer(docId, chemin, clair, local.mtime, t.sha256Bloc)) {
        ops.put.push(chemin);
        log("pushed", chemin);
      } else nouvelle[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, t.mtime);
      return;
    }
    // Vrai conflit : on garde le local, la version du serveur devient une copie de conflit, partout.
    const nomCopie = await ecrireCopie(chemin, t.clair, t.mtime);
    // Si la place manque, la base retient la version du serveur : le local repartira au prochain cycle.
    if (!(await envoyer(docId, chemin, clair, local.mtime, t.sha256Bloc))) {
      nouvelle[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, t.mtime);
    }
    await envoyerCopie(nomCopie, t.clair, t.mtime);
    ops.conflict.push(chemin);
    log("conflict-pushed", chemin);
  }

  return {
    ops,
    adoption: !memeChaine,
    base: { version: VERSION_BASE, chainId: cles.id, docs: nouvelle },
    signature: signatureDe(man),
    serveur: etatServeur(man, budget),
  };
}

/**
 * Envoie tout le vault (markdown) vers un casier : création d'une chaîne ou
 * renouvellement. Reprise possible : un document déjà envoyé à l'identique
 * (d'après la base) n'est pas renvoyé, et un bloc envoyé par cet appareil dont
 * le fichier a disparu est supprimé. Un bloc que la base ne connaît pas a été
 * déposé par un autre appareil entré dans la chaîne entre-temps : il n'est ni
 * supprimé ni écrasé, la synchro qui suit le compare au fichier local.
 *
 * @returns {Promise<{base, envoyes: number, tropGros: string[], quota: string[], serveur: object}>}
 *   `quota` : documents non envoyés faute de place (l'envoi est alors incomplet).
 */
export async function envoyerTout({
  vault,
  client,
  cles,
  base = null,
  onProgress = () => {},
  sauverBase = null,
  frequenceSauvegarde = 20,
  log = () => {},
}) {
  const local = await vault.scanManifest();
  const man = await client.manifeste();
  const budget = budgetDe(man);
  const docs = base && base.version === VERSION_BASE && base.chainId === cles.id && base.docs ? base.docs : {};
  const S_ = new Map();
  for (const d of man.docs || []) if (estDocIdValide(d.docId)) S_.set(d.docId, d);

  const locaux = [];
  const ids = new Set();
  const entrees = Object.entries(local)
    .filter(([chemin]) => estMarkdown(chemin))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [chemin, L] of entrees) {
    let docId;
    try {
      docId = await docIdAvec(cles, chemin);
    } catch {
      log("invalid-path", chemin);
      continue;
    }
    if (ids.has(docId)) {
      log("duplicate", chemin);
      continue;
    }
    ids.add(docId);
    locaux.push({ chemin, L, docId });
  }

  for (const [chemin, B] of Object.entries(docs)) {
    const S = S_.get(B?.docId);
    if (!S || S.deletedAt || S.sha256 !== B.sha256Bloc || ids.has(B.docId)) continue;
    let absent = false;
    try {
      absent = await vault.absent(chemin);
    } catch {
      // indéterminé : rien n'est supprimé
    }
    if (!absent) continue;
    try {
      await supprimerServeur(client, cles, B.docId, S.sha256);
      liberer(budget, S.size || 0);
      log("deleted-server", chemin);
    } catch (err) {
      // Déjà parti, ou changé par un autre appareil entre-temps : on n'y touche plus.
      if (estChaineInconnue(err) || !(err instanceof ErreurChaine && (err.status === 404 || err.status === 412))) throw err;
    }
  }

  const total = locaux.length;
  const gardes = {};
  const ops = { tropGros: [], quota: [] };
  let fait = 0;
  onProgress(0, total);
  const faireBase = () => ({ version: VERSION_BASE, chainId: cles.id, docs: { ...gardes } });

  for (const { chemin, L, docId } of locaux) {
    const S = S_.get(docId);
    const vivant = !!(S && !S.deletedAt);
    const B = docs[chemin];
    const notreBloc = vivant && B?.docId === docId && B.sha256Bloc === S.sha256;
    try {
      if (notreBloc && B.sha256Clair === L.sha256) {
        gardes[chemin] = B;
      } else if (vivant && !notreBloc) {
        // Bloc que la base ne connaît pas : envoyé ici juste avant une coupure
        // (même clair, il est gardé tel quel), ou déposé par un autre appareil
        // (jamais écrasé : la synchro qui suit fera la copie de conflit).
        const t = await telecharger(client, cles, docId);
        if ((await sha256Hex(t.clair)) === L.sha256) gardes[chemin] = await entreeBase(docId, t.clair, t.sha256Bloc, L.mtime);
        else log("skipped-foreign", chemin);
      } else {
        const clair = await vault.readClear(chemin);
        const place = reserver(budget, clair.length + SURCOUT_ENVELOPPE, vivant ? S.size || 0 : 0);
        if (place !== "ok") {
          ops[place].push(chemin);
          log(place === "tropGros" ? "too-large" : "quota", chemin);
        } else {
          const sha256Bloc = await deposer(client, cles, docId, chemin, clair, L.mtime, vivant ? S.sha256 : null);
          gardes[chemin] = await entreeBase(docId, clair, sha256Bloc, L.mtime);
          log("pushed", chemin);
        }
      }
    } catch (err) {
      if (estChaineInconnue(err)) throw err;
      if (estQuota(err)) noterRefus(budget, ops, err, chemin, log);
      // Un autre appareil vient d'écrire ou de supprimer ce document : la synchro qui suit le compare.
      else if (err instanceof ErreurChaine && [404, 410, 412].includes(err.status)) log("conflict-retry", chemin);
      else if (estBlocIllisible(err)) log("undecryptable", chemin);
      else if (estErreurEcriture(err)) log(err.code === "EINVALIDPATH" ? "invalid-path" : "skipped-put-write", chemin);
      else throw err;
    }
    fait++;
    onProgress(fait, total);
    if (sauverBase && fait % frequenceSauvegarde === 0) await sauverBase(faireBase());
  }

  const nouvelle = faireBase();
  if (sauverBase) await sauverBase(nouvelle);
  return { base: nouvelle, envoyes: Object.keys(gardes).length, tropGros: ops.tropGros, quota: ops.quota, serveur: etatServeur(man, budget) };
}

/**
 * Synchronise jusqu'à un cycle sans aucun changement : le disque reflète alors
 * le casier, dont on renvoie la signature. `perdus` : documents illisibles ou
 * absents du serveur, qu'aucun appareil ne peut plus récupérer de ce casier.
 */
async function synchroStable({ vault, client, cles, base, log }) {
  let b = base;
  for (let tour = 0; tour < TOURS_MAX; tour++) {
    const r = await synchroniserChaine({ vault, client, cles, base: b, log });
    b = r.base;
    if (!aBouge(r.ops)) return { base: b, signature: r.signature, perdus: new Set([...r.ops.indechiffrables, ...r.ops.manquants]) };
  }
  throw new ErreurChaine(409, "ROTATION_UNSTABLE", "");
}

/**
 * Documents markdown vivants de l'ancien casier qui ne sont ni dans le nouveau
 * (base) ni sur le disque : effacer l'ancien casier les perdrait (nom refusé
 * par le système, fichier verrouillé...).
 */
async function nonRecopies({ vault, cles, man, base, perdus }) {
  const copies = new Set(Object.keys(base.docs).map((c) => c.normalize("NFC")));
  const manquants = [];
  for (const d of man.docs || []) {
    if (d.deletedAt || !estDocIdValide(d.docId)) continue;
    let chemin;
    try {
      chemin = await dechiffrerCheminAvec(cles, d.docId, d.pathEnc);
    } catch {
      continue;
    }
    if (!estMarkdown(chemin) || perdus.has(chemin) || copies.has(chemin.normalize("NFC"))) continue;
    let ici = false;
    try {
      ici = !(await vault.absent(chemin));
    } catch {
      // indéterminé : compté comme manquant
    }
    if (!ici) manquants.push(chemin);
  }
  return manquants;
}

/**
 * Nouvelle chaîne (§ 11.1) : tout passe de l'ancien casier à un nouveau, puis
 * l'ancien est effacé. Les autres appareils reçoivent alors 404 CHAIN_UNKNOWN
 * et rejoignent la nouvelle chaîne avec ses 12 mots.
 *
 * 1. synchronisation complète avec l'ancien casier (jusqu'à un cycle sans changement) ;
 * 2. création du nouveau casier et envoi de tout le vault ;
 * 3. nouvelle lecture du manifeste de l'ancien : si un autre appareil y a écrit
 *    entre-temps, on récupère et on renvoie, jusqu'à stabilité ;
 * 4. l'ancien casier est effacé, seulement si le nouveau a tout reçu et que
 *    chaque document de l'ancien est dans le nouveau ou sur le disque ; sinon
 *    409 ROTATION_INCOMPLETE (corps : { missing: [chemins] }), rien n'est effacé.
 *
 * Reprise : si l'ancien casier n'existe déjà plus (renouvellement interrompu
 * après l'étape 4, ou effacé ailleurs), le vault local fait foi.
 *
 * @param {{client, cles}} o.ancien
 * @param {{client, cles}} o.nouveau
 * @param {object|null} o.base  base de l'ancienne chaîne
 */
export async function renouvelerChaine({ vault, ancien, nouveau, base = null, onProgress = () => {}, log = () => {} }) {
  let suivi = null;
  try {
    suivi = await synchroStable({ vault, client: ancien.client, cles: ancien.cles, base, log });
  } catch (err) {
    if (!estChaineInconnue(err)) throw err;
  }

  await nouveau.client.creer();
  let resultat = null;
  const toutEnvoyer = async () => {
    resultat = await envoyerTout({ vault, client: nouveau.client, cles: nouveau.cles, base: resultat?.base ?? null, onProgress, log });
  };
  await toutEnvoyer();

  let manAncien = null;
  for (let tour = 0; suivi; tour++) {
    try {
      manAncien = await ancien.client.manifeste();
    } catch (err) {
      if (!estChaineInconnue(err)) throw err;
      suivi = null;
      break;
    }
    if (signatureDe(manAncien) === suivi.signature) break;
    if (tour >= TOURS_MAX) throw new ErreurChaine(409, "ROTATION_UNSTABLE", "");
    suivi = await synchroStable({ vault, client: ancien.client, cles: ancien.cles, base: suivi.base, log });
    await toutEnvoyer();
  }

  if (resultat.quota.length > 0) {
    // Le nouveau casier n'a pas tout reçu : on le retire et l'ancien reste la chaîne.
    await nouveau.client.effacerTout().catch(() => {});
    throw new ErreurChaine(413, "QUOTA_EXCEEDED", "");
  }
  if (suivi) {
    const manquants = await nonRecopies({ vault, cles: ancien.cles, man: manAncien, base: resultat.base, perdus: suivi.perdus });
    if (manquants.length > 0) {
      for (const chemin of manquants) log("not-copied", chemin);
      throw new ErreurChaine(409, "ROTATION_INCOMPLETE", JSON.stringify({ code: "ROTATION_INCOMPLETE", missing: manquants }));
    }
    try {
      await ancien.client.effacerTout();
    } catch (err) {
      if (!estChaineInconnue(err)) throw err;
    }
  }
  return { base: resultat.base, envoyes: resultat.envoyes, tropGros: resultat.tropGros, serveur: resultat.serveur };
}
