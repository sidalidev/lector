#!/usr/bin/env node
// Vérifie les casiers de la chaîne : blocs présents et intègres, compteurs de
// quota (bytesUsed, docCount) égaux à la somme des lignes vivantes, aucun
// fichier orphelin, aucun dossier de casier sans ligne en base.
//
// Usage (sur le VPS, dans le conteneur de l'API) :
//   node scripts/verifier-chaine.js --all
//   node scripts/verifier-chaine.js --chain <id de chaîne, 32 hex>
//   node scripts/verifier-chaine.js --all --recount
//
// Sans --recount : lecture seule. Avec --recount : recalcule les compteurs,
// supprime les fichiers orphelins et, avec --all, les dossiers fantômes. À
// lancer quand aucune synchro n'écrit (API arrêtée :
// docker compose run --rm lector-api node scripts/verifier-chaine.js --all --recount).
//
// Affiche un rapport JSON (ids de chaîne réduits à 8 caractères) et sort avec
// le code 1 si un problème reste, 2 en cas d'erreur d'utilisation.

const prisma = require('../services/prisma')
const stockage = require('../services/stockageChaine')
const { RE_CHAIN_ID, resumeErreur } = require('../services/chaine')
const { verifierChaine, reparerChaine, casiersFantomes } = require('../services/verificationChaine')

function lireArguments(argv) {
  const recount = argv.includes('--recount')
  const i = argv.indexOf('--chain')
  if (i !== -1 && RE_CHAIN_ID.test(argv[i + 1] || '')) return { chainId: argv[i + 1], recount }
  if (argv.includes('--all')) return { tous: true, recount }
  return null
}

async function main() {
  const args = lireArguments(process.argv.slice(2))
  if (!args) {
    console.error('Usage: node scripts/verifier-chaine.js --chain <32 hex> | --all [--recount]')
    process.exit(2)
  }
  const ids = args.tous
    ? (await prisma.chain.findMany({ select: { id: true }, orderBy: { createdAt: 'asc' } })).map((c) => c.id)
    : [args.chainId]

  let problemes = 0
  const rapports = []
  for (const id of ids) {
    if (args.recount) await reparerChaine(prisma, id)
    const rapport = await verifierChaine(prisma, id)
    if (!rapport) {
      console.error('Unknown chain')
      process.exit(2)
    }
    if (!rapport.ok) problemes += 1
    rapports.push(rapport)
  }

  let fantomes = []
  if (args.tous) {
    fantomes = await casiersFantomes(prisma)
    if (args.recount) {
      for (const id of fantomes) await stockage.supprimerTout(id)
      fantomes = await casiersFantomes(prisma)
    }
    problemes += fantomes.length
  }

  console.log(JSON.stringify({
    chaines: rapports.length,
    problemes,
    fantomes: fantomes.map((id) => id.slice(0, 8)),
    rapports,
  }, null, 2))
  process.exitCode = problemes ? 1 : 0
}

main()
  .catch((err) => {
    console.error(resumeErreur(err))
    process.exitCode = 2
  })
  .finally(() => prisma.$disconnect())
