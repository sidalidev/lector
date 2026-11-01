// Cycle de vie des casiers : état public, effacement complet, purge quotidienne.

const stockage = require('./stockageChaine')
const { casiersFantomes } = require('./verificationChaine')
const {
  TAILLE_MAX_DOC, QUOTA_OCTETS, MAX_DOCS, DUREE_PIERRES_TOMBALES_MS, DUREE_INACTIVITE_MS, resumeErreur,
} = require('./chaine')

const JOUR_MS = 24 * 60 * 60 * 1000

/** Ce que voit un appareil de sa chaîne : occupation et limites. */
function etatCasier(chain) {
  return {
    chainId: chain.id,
    bytesUsed: chain.bytesUsed,
    quotaBytes: QUOTA_OCTETS,
    maxDocBytes: TAILLE_MAX_DOC,
    maxDocs: MAX_DOCS,
    docCount: chain.docCount,
  }
}

/**
 * Efface un casier : la ligne Chain d'abord, qui emporte ses documents
 * (cascade) et fait échouer tout dépôt encore en vol, puis le dossier disque.
 * `condition` restreint l'effacement (purge : casier toujours inactif).
 * Renvoie true si le casier a été effacé. Un dossier qui aurait résisté n'a
 * plus de ligne Chain : la purge quotidienne le reprend.
 */
async function effacerCasier(prisma, chainId, condition = {}) {
  const { count } = await prisma.chain.deleteMany({ where: { id: chainId, ...condition } })
  if (count) await stockage.supprimerTout(chainId)
  return count > 0
}

/**
 * Supprime les pierres tombales de plus de 30 jours, les casiers sans aucune
 * requête depuis CHAIN_INACTIVE_DAYS jours (180 par défaut) et les dossiers de casier sans ligne Chain. Renvoie
 * les nombres supprimés.
 */
async function purger(prisma, maintenant = Date.now()) {
  const { count: pierresTombales } = await prisma.chainDoc.deleteMany({
    where: { deletedAt: { lt: new Date(maintenant - DUREE_PIERRES_TOMBALES_MS) } },
  })
  // La condition est reprise à l'effacement : un casier redevenu actif entre la liste et sa suppression reste.
  const inactif = { lastSeenAt: { lt: new Date(maintenant - DUREE_INACTIVITE_MS) } }
  const inactifs = await prisma.chain.findMany({ where: inactif, select: { id: true } })
  let casiers = 0
  for (const { id } of inactifs) {
    if (await effacerCasier(prisma, id, inactif)) casiers += 1
  }
  const fantomes = await casiersFantomes(prisma)
  for (const id of fantomes) await stockage.supprimerTout(id)
  return { pierresTombales, casiers, fantomes: fantomes.length }
}

/** Lance la purge au démarrage puis toutes les 24 heures. */
function demarrerPurge(prisma) {
  const tour = async () => {
    try {
      const { pierresTombales, casiers, fantomes } = await purger(prisma)
      if (pierresTombales || casiers || fantomes) {
        console.log(`[purge] ${pierresTombales} tombstones, ${casiers} inactive chains, ${fantomes} orphan folders removed`)
      }
    } catch (err) {
      console.error('[purge] error:', resumeErreur(err))
    }
  }
  tour()
  setInterval(tour, JOUR_MS).unref()
}

module.exports = { etatCasier, effacerCasier, purger, demarrerPurge }
