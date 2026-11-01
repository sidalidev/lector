// Vérification d'un casier : cohérence entre la base, le disque et les
// compteurs de quota. Utilisée par GET /v1/chain/verify et par
// scripts/verifier-chaine.js.
//
// Le serveur ne peut pas déchiffrer : il vérifie la présence, la taille,
// l'empreinte et la version de chaque bloc. blocsSuspects est une alarme
// (bloc qui ressemble à du clair), pas une preuve.

const fs = require('fs/promises')
const stockage = require('./stockageChaine')
const { sha256Hex, prefixe, VERSION_ENVELOPPE } = require('./chaine')

// Au-dessous de 1 Kio, l'entropie mesurée sur un bloc aléatoire reste sous
// 7,5 bits par octet par simple manque d'échantillons : pas de test d'entropie.
const TAILLE_MIN_ENTROPIE = 1024
const SEUIL_ENTROPIE = 7.5
// Un chiffré aléatoire de 32 octets n'est presque jamais de l'UTF-8 valide.
const TAILLE_MIN_UTF8 = 32
// Version + IV : ce qui précède le chiffré dans l'enveloppe.
const ENTETE = 13

function entropie(octets) {
  const compte = new Array(256).fill(0)
  for (const o of octets) compte[o]++
  let h = 0
  for (const c of compte) {
    if (!c) continue
    const p = c / octets.length
    h -= p * Math.log2(p)
  }
  return h
}

function estUtf8Valide(octets) {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(octets)
    return true
  } catch {
    return false
  }
}

/** Heuristique contre un client bogué qui enverrait du clair dans un bloc. */
function estSuspect(bloc) {
  if (bloc.length >= TAILLE_MIN_ENTROPIE && entropie(bloc) < SEUIL_ENTROPIE) return true
  const corps = bloc.subarray(ENTETE)
  return corps.length >= TAILLE_MIN_UTF8 && estUtf8Valide(corps)
}

/** Blocs vivants d'un casier en base. */
function blocsVivants(prisma, chainId) {
  return prisma.chainDoc.findMany({
    where: { chainId, deletedAt: null },
    select: { docId: true, sha256: true, size: true },
  })
}

/** Fichiers du casier qui ne correspondent à aucun bloc vivant (écriture interrompue, reste d'un crash). */
async function fichiersOrphelins(chainId, vivants) {
  const connus = new Set(vivants.map((d) => d.docId))
  return (await stockage.listerFichiers(chainId)).filter((f) => !connus.has(f.nom))
}

/** Rapport d'un casier, ou null s'il n'existe pas. */
async function verifierChaine(prisma, chainId) {
  const chain = await prisma.chain.findUnique({ where: { id: chainId } })
  if (!chain) return null
  const vivants = await blocsVivants(prisma, chainId)
  const rapport = {
    chain: prefixe(chainId),
    blocs: vivants.length,
    octets: 0,
    blocsManquants: 0,
    empreintesFausses: 0,
    versionsInconnues: 0,
    blocsSuspects: 0,
    orphelins: (await fichiersOrphelins(chainId, vivants)).length,
    compteurs: { bytesUsed: chain.bytesUsed, docCount: chain.docCount },
    attendu: { bytesUsed: vivants.reduce((n, d) => n + d.size, 0), docCount: vivants.length },
  }
  for (const d of vivants) {
    let bloc
    try {
      bloc = await stockage.lireBloc(chainId, d.docId)
    } catch (err) {
      if (err.code === 'ENOENT') { rapport.blocsManquants += 1; continue }
      throw err
    }
    rapport.octets += bloc.length
    if (bloc.length !== d.size || sha256Hex(bloc) !== d.sha256) rapport.empreintesFausses += 1
    if (bloc[0] !== VERSION_ENVELOPPE) rapport.versionsInconnues += 1
    if (estSuspect(bloc)) rapport.blocsSuspects += 1
  }
  rapport.ok = rapport.blocsManquants === 0 && rapport.empreintesFausses === 0
    && rapport.versionsInconnues === 0 && rapport.blocsSuspects === 0 && rapport.orphelins === 0
    && rapport.compteurs.bytesUsed === rapport.attendu.bytesUsed
    && rapport.compteurs.docCount === rapport.attendu.docCount
  return rapport
}

/**
 * Répare un casier : compteurs recalculés depuis les lignes vivantes (une
 * seule requête, atomique dans SQLite) et fichiers orphelins supprimés.
 * À lancer quand aucune synchro n'écrit, sinon un dépôt en cours peut être
 * pris pour un orphelin.
 */
async function reparerChaine(prisma, chainId) {
  await prisma.$executeRaw`
    UPDATE "Chain" SET
      "bytesUsed" = (SELECT COALESCE(SUM("size"), 0) FROM "ChainDoc" WHERE "chainId" = ${chainId} AND "deletedAt" IS NULL),
      "docCount" = (SELECT COUNT(*) FROM "ChainDoc" WHERE "chainId" = ${chainId} AND "deletedAt" IS NULL)
    WHERE "id" = ${chainId}`
  for (const f of await fichiersOrphelins(chainId, await blocsVivants(prisma, chainId))) {
    await fs.rm(f.chemin, { recursive: true, force: true })
  }
}

/** Dossiers de casier sur le disque sans ligne Chain en base. */
async function casiersFantomes(prisma) {
  const surDisque = await stockage.listerCasiers()
  const connus = new Set((await prisma.chain.findMany({ select: { id: true } })).map((c) => c.id))
  return surDisque.filter((id) => !connus.has(id))
}

module.exports = { verifierChaine, reparerChaine, casiersFantomes, entropie, estSuspect }
