#!/usr/bin/env node
// Lance l'API sur une base SQLite de test toute neuve (tests Playwright de la
// chaîne, e2e/api/chain.spec.js). Jamais sur la base de développement ni sur la
// production : le script refuse de tourner si DATABASE_URL ou CHAIN_FILES_ROOT
// ne pointent pas dans back/.test-data/.
//
// 1. efface back/.test-data/ ;
// 2. crée le schéma avec `prisma db push` sur la base de test ;
// 3. démarre index.js en recopiant toute la sortie dans .test-data/serveur.log
//    (les tests vérifient que ni contenu, ni chemin, ni preuve, ni secret, ni
//    IP, ni id de chaîne complet n'y apparaissent).

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const BACK = path.resolve(__dirname, '..')
const DONNEES = path.join(BACK, '.test-data')

const url = process.env.DATABASE_URL || ''
if (process.env.NODE_ENV !== 'test' || !url.startsWith('file:') || !path.resolve(url.slice(5)).startsWith(DONNEES + path.sep)) {
  console.error('[serveur-test] Refusé : NODE_ENV=test et DATABASE_URL=file:<back/.test-data/...> sont obligatoires.')
  process.exit(1)
}
if (!path.resolve(process.env.CHAIN_FILES_ROOT || '').startsWith(DONNEES + path.sep)) {
  console.error('[serveur-test] Refusé : CHAIN_FILES_ROOT doit pointer dans back/.test-data/.')
  process.exit(1)
}

fs.rmSync(DONNEES, { recursive: true, force: true })
fs.mkdirSync(DONNEES, { recursive: true })

execFileSync(path.join(BACK, 'node_modules', '.bin', 'prisma'), ['db', 'push', '--skip-generate'], {
  cwd: BACK,
  env: process.env,
  stdio: ['ignore', 'ignore', 'inherit'],
})

// Copie de la sortie dans un fichier, en plus de la console.
const journal = fs.createWriteStream(path.join(DONNEES, 'serveur.log'), { flags: 'a' })
for (const flux of [process.stdout, process.stderr]) {
  const ecrire = flux.write.bind(flux)
  flux.write = (morceau, ...reste) => {
    journal.write(morceau)
    return ecrire(morceau, ...reste)
  }
}

require(path.join(BACK, 'index.js'))
