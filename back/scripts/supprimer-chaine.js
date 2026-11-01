#!/usr/bin/env node
// Supprime une chaîne signalée (abus) : la ligne Chain, ses documents
// (cascade) et le dossier de ses blocs chiffrés. Le contenu n'est jamais lu,
// le serveur ne sait pas le déchiffrer.
//
// Usage (sur le VPS, dans le conteneur de l'API) :
//   docker compose exec lector-api node scripts/supprimer-chaine.js <id>
//
// <id> : l'identifiant complet (32 hex) ou son début (8 hex au moins, la forme
// des journaux). Un début qui désigne plusieurs chaînes est refusé. Le script
// montre la chaîne trouvée et demande de retaper son identifiant court avant
// d'effacer. Sort avec 0 si la chaîne est effacée, 1 si rien n'est fait, 2 en
// cas d'erreur d'utilisation.

const readline = require('node:readline/promises')
const prisma = require('../services/prisma')
const { effacerCasier } = require('../services/casiers')
const { resumeErreur } = require('../services/chaine')

const RE_DEBUT_ID = /^[0-9a-f]{8,32}$/

async function main() {
  const saisie = String(process.argv[2] || '').trim().toLowerCase()
  if (!RE_DEBUT_ID.test(saisie)) {
    console.error('Usage: node scripts/supprimer-chaine.js <chain id, 8 to 32 hex>')
    process.exitCode = 2
    return
  }

  const trouvees = await prisma.chain.findMany({
    where: { id: { startsWith: saisie } },
    select: { id: true, createdAt: true, lastSeenAt: true, bytesUsed: true, docCount: true },
    take: 2,
  })
  if (trouvees.length === 0) {
    console.error('No chain matches this identifier.')
    process.exitCode = 1
    return
  }
  if (trouvees.length > 1) {
    console.error('Several chains match this identifier: give more characters.')
    process.exitCode = 2
    return
  }

  const chaine = trouvees[0]
  const court = chaine.id.slice(0, 8)
  console.log(`Chain ${court}…`)
  console.log(`  created:   ${chaine.createdAt.toISOString()}`)
  console.log(`  last seen: ${chaine.lastSeenAt ? chaine.lastSeenAt.toISOString() : 'never'}`)
  console.log(`  documents: ${chaine.docCount}, ${chaine.bytesUsed} bytes (encrypted)`)

  if (!process.stdin.isTTY) {
    console.error('Interactive confirmation required: run this script in a terminal.')
    process.exitCode = 1
    return
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  const reponse = (await rl.question(`Type ${court} to delete this chain for good, anything else to cancel: `)).trim()
  rl.close()
  if (reponse !== court) {
    console.log('Cancelled, nothing deleted.')
    process.exitCode = 1
    return
  }

  const efface = await effacerCasier(prisma, chaine.id)
  console.log(efface ? `Chain ${court} deleted.` : `Chain ${court} was already gone.`)
  process.exitCode = efface ? 0 : 1
}

main()
  .catch((err) => {
    console.error(resumeErreur(err))
    process.exitCode = 2
  })
  .finally(() => prisma.$disconnect())
