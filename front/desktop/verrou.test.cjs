// Verrou de la chaîne sur ordinateur (docs/CHAINE.md § 10 et 11) : sans Touch ID
// ni confirmation, un script dans le renderer ne peut ni tirer de nouveaux mots
// pour une chaîne existante, ni renouveler la chaîne, ni effacer le casier.
// Lancer : npm run test:chaine

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { pathToFileURL } = require('node:url')

const { ChaineDesktop } = require('./chaine-desktop')

const URL_SERVEUR = 'http://serveur.test'

test('Nouvelle chaîne et tout effacer exigent le verrou ouvert', async (t) => {
  const { creerServeurSimule } = await import(pathToFileURL(path.join(__dirname, '../src/services/chaine/serveur-simule.mjs')).href)
  const serveur = creerServeurSimule()
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-verrou-'))
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }))
  fs.writeFileSync(path.join(vaultPath, 'a.md'), '# A')

  let creds = { vaultPath, serverUrl: URL_SERVEUR, deviceId: randomUUID() }
  let verrou = false
  const chaine = new ChaineDesktop({
    getCreds: () => creds,
    saveCreds: (c) => { creds = c },
    fetchImpl: serveur.fetch,
    arreterSynchro: async () => {},
    demarrerSynchro: async () => {},
    verrouOuvert: () => verrou,
    serverUrlParDefaut: URL_SERVEUR,
  })

  // Créer sa première chaîne ne demande pas le verrou : les mots s'affichent une fois.
  assert.equal((await chaine.preparer()).ok, true)
  assert.equal((await chaine.creer()).ok, true)
  const id = creds.chainId

  // Verrou fermé : ni nouveaux mots, ni renouvellement, ni effacement.
  const prep = await chaine.preparer()
  assert.equal(prep.code, 'LOCKED')
  assert.equal(prep.mots, undefined, 'aucun mot sans le verrou')
  assert.equal((await chaine.renouveler()).code, 'LOCKED')
  assert.equal((await chaine.effacerTout('DELETE')).code, 'LOCKED')
  assert.equal(creds.chainId, id)
  assert.equal(creds.chainPendingSecret, undefined)
  assert.equal(serveur.etat.chaines.size, 1, 'le casier est intact')

  // Verrou ouvert : tout passe.
  verrou = true
  const neuve = await chaine.preparer()
  assert.equal(neuve.mots.length, 12)
  assert.equal((await chaine.renouveler()).ok, true)
  assert.notEqual(creds.chainId, id)
  assert.equal(serveur.etat.chaines.has(id), false)
  assert.equal((await chaine.effacerTout('DELETE')).ok, true)
  assert.equal(serveur.etat.chaines.size, 0)
})
