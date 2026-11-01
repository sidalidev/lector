#!/usr/bin/env node
// Contrôle de bout en bout de l'app web dans un vrai navigateur (Google Chrome
// installé, sans fenêtre) contre le vrai serveur de test, avec un ordinateur
// (ChaineDesktop et SyncManager réels) dans la même chaîne (docs/CHAINE-TESTS.md).
//
// Lancer : node e2e/chaine-navigateur.cjs
// Le script démarre l'API de test (:3457, base jetable de back/.test-data/) et
// Vite (:5174) s'ils ne répondent pas déjà, et arrête ce qu'il a démarré. La
// page croit parler à sa propre origine : ses appels /v1 sont routés vers l'API
// de test, comme derrière le proxy de production. Toute autre adresse hors de
// localhost est bloquée. Après une modification du front, relancer Vite s'il
// tournait déjà : la page et le script pourraient sinon charger deux versions
// des modules.

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { randomUUID } = require('node:crypto')
const { pathToFileURL } = require('node:url')
const { chromium } = require('playwright-core')
const { BACK, ENV_TEST, PORT_TEST } = require('./back-test.js')

const RACINE = path.resolve(__dirname, '..')
const { ChaineDesktop } = require(path.join(RACINE, 'front/desktop/chaine-desktop.js'))
const { SyncManager } = require(path.join(RACINE, 'front/desktop/sync-manager.js'))

const API = `http://localhost:${PORT_TEST}`
const PORT_WEB = 5174
const WEB = `http://localhost:${PORT_WEB}`

const DOCS = {
  ['Carnet/Été indien.md'.normalize('NFD')]: '# Été indien\n\nMARQUEUR-WEB-UN : premier paragraphe.\n',
  'Carnet/Sous-dossier/Liste.md': '# Liste\n\n- MARQUEUR-WEB-DEUX\n',
  'Accueil.md': '# Accueil\n\nMARQUEUR-WEB-TROIS\n',
  'Images/photo.png': Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]),
}
const MARKDOWN = Object.keys(DOCS).filter((c) => c.endsWith('.md')).map((c) => c.normalize('NFC')).sort()

// --- Serveurs ---

async function repond(url) {
  try { return (await fetch(url)).ok } catch { return false }
}

async function attendre(condition, delai, message) {
  const fin = Date.now() + delai
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error(message)
    await new Promise((r) => setTimeout(r, 250))
  }
}

const lances = []

/** Démarre un serveur s'il ne répond pas déjà à `url`. */
async function demarrer(nom, url, commande, args, options) {
  if (await repond(url)) return
  // Groupe de processus à part : npx lance Vite dans un processus enfant, arrêté avec lui.
  const p = spawn(commande, args, { ...options, detached: true, stdio: 'ignore' })
  lances.push(p)
  await attendre(() => repond(url), 60_000, `${nom} ne répond pas sur ${url}`)
}

function arreterServeurs() {
  for (const p of lances) {
    try { process.kill(-p.pid) } catch {}
  }
}

// --- Ordinateur A ---

function ordinateur(vaultPath) {
  const p = { vaultPath, creds: { vaultPath, serverUrl: API, deviceId: randomUUID() } }
  p.chaine = new ChaineDesktop({
    getCreds: () => p.creds,
    saveCreds: (c) => { p.creds = c },
    fetchImpl: fetch,
    arreterSynchro: async () => {},
    demarrerSynchro: async () => {},
    verrouOuvert: () => true,
    serverUrlParDefaut: API,
  })
  p.synchroniser = async () => {
    const sm = new SyncManager({ vaultPath, serverUrl: API, chainSecret: p.creds.chainSecret, deviceId: p.creds.deviceId, fetchImpl: fetch, flux: false })
    sm.on('error', () => {})
    let ops = null
    sm.on('sync-complete', (e) => { ops = e.ops })
    try { await sm._syncOnce() } catch (err) { if (!sm._handleFatal(err)) throw err }
    return { ...sm.getStatus(), ops }
  }
  return p
}

// --- Page ---

/** Entrée IndexedDB de la chaîne : champs et exportabilité des clés, ou null. */
function lireEntree(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const req = indexedDB.open('lector-chaine', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('cles')
    req.onerror = () => reject(req.error)
    req.onsuccess = () => {
      const g = req.result.transaction('cles', 'readonly').objectStore('cles').get('courante')
      g.onsuccess = () => {
        const e = g.result
        req.result.close()
        resolve(e ? { champs: Object.keys(e).sort(), encExportable: e.cleEnc.extractable, macExportable: e.cleMac.extractable, chainId: e.chainId } : null)
      }
    }
  }))
}

/** Exécute fn(fs) dans la page, avec le module fileSystem de l'app. */
function avecFileSystem(page, fn) {
  return page.evaluate(`(async () => {
    const { default: fs } = await import('/src/services/fileSystem.js')
    return (${fn.toString()})(fs)
  })()`)
}

async function ouvrirSynchroDepuisLaPalette(page) {
  await page.keyboard.press('Meta+Shift+p')
  await page.locator('.command-palette-input').fill('sync')
  await page.locator('.command-palette-item', { hasText: 'Sync' }).first().click()
  await page.locator('.panel h2', { hasText: 'Sync' }).waitFor()
}

async function main() {
  await demarrer('API de test', `${API}/v1/health`, process.execPath, ['scripts/serveur-test.js'], { cwd: BACK, env: { ...process.env, ...ENV_TEST } })
  await demarrer('Vite', WEB, 'npx', ['vite', '--port', String(PORT_WEB), '--strictPort'], { cwd: path.join(RACINE, 'front') })

  const dossierA = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-nav-'))
  for (const [c, t] of Object.entries(DOCS)) {
    fs.mkdirSync(path.dirname(path.join(dossierA, c)), { recursive: true })
    fs.writeFileSync(path.join(dossierA, c), t)
  }
  const A = ordinateur(dossierA)

  const navigateur = await chromium.launch({ channel: 'chrome', headless: true })
  const contexte = await navigateur.newContext({ locale: 'en-US' })
  // Rien ne sort de la machine ; les appels /v1 de la page vont à l'API de test.
  const ecritures = []
  await contexte.route((url) => url.hostname !== 'localhost', (r) => r.abort())
  await contexte.route('**/v1/**', async (route) => {
    const u = new URL(route.request().url())
    if (route.request().method() === 'PUT') ecritures.push(u.pathname)
    await route.fulfill({ response: await route.fetch({ url: API + u.pathname + u.search }) })
  })
  // Signaux « chaîne requise » émis par l'app (EVENEMENT_CHAINE de chaineWeb.js).
  await contexte.addInitScript(() => {
    window.__signaux = []
    window.addEventListener('lector-chaine-requise', (e) => window.__signaux.push(e.detail.code))
  })
  const page = await contexte.newPage()
  const erreurs = []
  page.on('pageerror', (e) => erreurs.push(String(e)))
  const resultats = {}

  try {
    await page.goto(WEB)
    await page.evaluate(async () => {
      localStorage.clear()
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase('lector-chaine')
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    })
    await page.reload()
    await page.locator('.onboarding-primary').waitFor({ timeout: 60_000 })

    // 1. Sans chaîne : arbre vide, l'app est priée d'ouvrir l'écran Synchronisation.
    const sansChaine = await avecFileSystem(page, async (fs) => ({ arbre: await fs.listDirectoryFiles('cloud://'), signaux: [...window.__signaux] }))
    assert.deepEqual(sansChaine, { arbre: [], signaux: ['NO_CHAIN'] })
    resultats.sansChaine = 'arbre vide, signal NO_CHAIN'

    // 2. Créer depuis le navigateur : 12 mots affichés une fois, formulaire et API du gestionnaire de mots de passe.
    const creer = page.getByRole('button', { name: 'Protect and sync' })
    if (!(await creer.isVisible())) {
      await page.locator('.onboarding-primary').click()
      await page.getByRole('button', { name: 'Set up sync' }).click()
    }
    await creer.click()
    const elementsMots = page.locator('.chaine-mots .chaine-mot')
    await elementsMots.first().waitFor({ timeout: 20_000 })
    const mots = await elementsMots.allTextContents()
    assert.equal(mots.length, 12)
    assert.equal(await page.locator('#lector-sync-chain[autocomplete="username"]').inputValue(), 'lector-sync-chain')
    assert.equal(await page.locator('input[autocomplete="new-password"]').inputValue(), mots.join(' '))
    resultats.passwordCredential = await page.evaluate(() => typeof window.PasswordCredential === 'function')
    await page.getByRole('button', { name: 'Save in my password manager' }).click()
    await page.getByText('If nothing was offered', { exact: false }).waitFor({ timeout: 10_000 })
    resultats.gestionnaire = 'formulaire soumis, navigator.credentials.store appelé sans erreur'

    await page.getByLabel('I saved them').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Check', exact: true }).waitFor()
    const champs = page.locator('.chaine-champ')
    assert.equal(await champs.count(), 3)
    for (let k = 0; k < 3; k++) {
      const n = Number((await champs.nth(k).locator('span').textContent()).match(/\d+/)[0])
      await champs.nth(k).locator('input').fill(mots[n - 1])
    }
    await page.getByRole('button', { name: 'Check', exact: true }).click()
    await page.getByText('Your chain is ready.', { exact: false }).waitFor()
    await page.getByRole('button', { name: 'Open my documents' }).click()
    await page.locator('.titlebar').waitFor()

    // 3. IndexedDB : identifiant, preuve et clés non exportables ; ni S ni les mots.
    const entree = await lireEntree(page)
    assert.deepEqual(entree.champs, ['chainId', 'cleEnc', 'cleMac', 'preuve', 'version'])
    assert.equal(entree.encExportable, false)
    assert.equal(entree.macExportable, false)
    resultats.indexedDB = entree.champs

    // 4. L'ordinateur A rejoint la chaîne créée sur le web et envoie son markdown (pas l'image).
    assert.deepEqual(await A.chaine.rejoindre(mots.join(' ')), { ok: true, chainId: entree.chainId })
    const sA = await A.synchroniser()
    assert.deepEqual(sA.ops.put.map((c) => c.normalize('NFC')).sort(), MARKDOWN)
    assert.equal(sA.skipped, 1)

    // 5. Rechargement : l'app démarre sur cloud://, l'arbre vient des chemins déchiffrés.
    await page.reload()
    await page.getByText('Accueil', { exact: true }).first().waitFor({ timeout: 20_000 })
    const barre = (await page.evaluate(() => document.body.innerText)).normalize('NFC')
    for (const nom of ['Carnet', 'Accueil']) assert.ok(barre.includes(nom), `barre latérale : ${nom}`)
    assert.ok(!barre.includes('photo'), 'l\'image ne voyage pas')
    await page.getByText('Carnet', { exact: true }).first().click()
    await page.getByText('Sous-dossier', { exact: true }).first().waitFor({ timeout: 10_000 })
    await page.getByText('Accueil', { exact: true }).first().click()
    await page.getByText('MARQUEUR-WEB-TROIS', { exact: false }).first().waitFor({ timeout: 10_000 })
    assert.ok((await page.evaluate(() => document.body.innerText)).normalize('NFC').includes('Été indien'))
    if (process.env.CAPTURE) await page.screenshot({ path: process.env.CAPTURE })
    resultats.documentAffiche = true

    // 6. Lecture et écriture chiffrées par fileSystem (le chemin réel de l'app web) ; markdown seulement.
    const lu = await avecFileSystem(page, async (fs) => {
      const accueil = await fs.openFileByPath('cloud://Accueil.md')
      await fs.writeFile('cloud://Carnet/Écrit dans le navigateur.md', '# Web\n\nMARQUEUR-WEB-QUATRE\n')
      let refus = null
      try { await fs.writeFile('cloud://photo.png', 'x') } catch (err) { refus = { status: err.status, code: err.code } }
      return { accueil: accueil?.content, refus }
    })
    assert.ok(lu.accueil.includes('MARQUEUR-WEB-TROIS'))
    assert.deepEqual(lu.refus, { status: 400, code: 'NOT_MARKDOWN' })
    assert.deepEqual((await A.synchroniser()).ops.get, ['Carnet/Écrit dans le navigateur.md'])
    assert.equal(fs.readFileSync(path.join(dossierA, 'Carnet/Écrit dans le navigateur.md'), 'utf8'), '# Web\n\nMARQUEUR-WEB-QUATRE\n')
    resultats.recuParA = true

    // 7. Écriture sur une version périmée (lecture, A modifie, écriture) : 412, rien d'écrasé.
    await avecFileSystem(page, (fs) => fs.openFileByPath('cloud://Accueil.md'))
    fs.writeFileSync(path.join(dossierA, 'Accueil.md'), '# Accueil\n\nMARQUEUR-WEB-TROIS modifié sur A\n')
    await A.synchroniser()
    const perime = await avecFileSystem(page, async (fs) => {
      try { await fs.writeFile('cloud://Accueil.md', 'version périmée du navigateur'); return { ecrit: true } } catch (err) { return { status: err.status, code: err.code } }
    })
    assert.deepEqual(perime, { status: 412, code: 'CONFLICT' })
    await A.synchroniser()
    assert.equal(fs.readFileSync(path.join(dossierA, 'Accueil.md'), 'utf8'), '# Accueil\n\nMARQUEUR-WEB-TROIS modifié sur A\n')
    resultats.ecriturePerimee = perime

    // 8. Vérification du casier (preuve exigée) : 4 blocs, tous intègres.
    const service = await import(pathToFileURL(path.join(RACINE, 'front/src/services/chaine/service.js')).href)
    const clesA = await service.clesDepuisHex(A.creds.chainSecret)
    const v = await (await fetch(`${API}/v1/chain/verify`, { headers: { 'X-Lector-Chain-Id': clesA.id, 'X-Lector-Chain-Proof': clesA.preuve } })).json()
    assert.equal(v.ok, true)
    assert.equal(v.blocs, 4)
    resultats.verify = { ok: v.ok, blocs: v.blocs }

    // 9. A renouvelle la chaîne : le navigateur reçoit 404, oublie ses clés, n'écrit plus rien.
    const neuve = await A.chaine.preparer()
    const rot = await A.chaine.renouveler()
    assert.equal(rot.ok, true, JSON.stringify(rot))
    const avant = ecritures.length
    const arbreInconnu = await avecFileSystem(page, async (fs) => {
      window.__signaux.length = 0
      return { arbre: await fs.listDirectoryFiles('cloud://'), signaux: [...window.__signaux] }
    })
    assert.deepEqual(arbreInconnu, { arbre: [], signaux: ['CHAIN_UNKNOWN'] })
    assert.equal(await lireEntree(page), null)
    await page.getByText('This chain no longer exists', { exact: false }).first().waitFor({ timeout: 10_000 })
    const fuite = await avecFileSystem(page, async (fs) => {
      try { await fs.writeFile('cloud://Fuite.md', 'MARQUEUR-WEB-FUITE'); return null } catch (err) { return err.code }
    })
    assert.equal(fuite, 'NO_CHAIN')
    assert.equal(ecritures.length, avant, 'aucun dépôt après la disparition de la chaîne')
    resultats.chaineRenouvelee = 'clés oubliées, écran « chaîne inconnue », aucune écriture'

    // 10. Rejoindre depuis l'écran avec les nouveaux mots (champ masqué, comme un mot de passe).
    await page.getByRole('button', { name: 'Join with the new words' }).click()
    const champ = page.locator('input[autocomplete="current-password"]')
    assert.equal(await champ.getAttribute('type'), 'password')
    await champ.fill(neuve.mots.join(' '))
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await page.locator('.panel').waitFor({ state: 'detached', timeout: 10_000 })
    await page.getByText('Accueil', { exact: true }).first().waitFor({ timeout: 10_000 })
    assert.equal((await lireEntree(page)).chainId, rot.chainId)
    resultats.rejointNouvelleChaine = true

    // 11. Tout effacer depuis le navigateur : A s'arrête sans rien perdre, et ce
    // navigateur oublie tout ce que Lector y gardait (clés API, localStorage).
    await page.evaluate(() => new Promise((resolve, reject) => {
      localStorage.setItem('lector-history', '["temoin"]')
      const req = indexedDB.open('lector-keys', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('cles')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const tx = req.result.transaction('cles', 'readwrite')
        tx.objectStore('cles').put({ temoin: true }, 'temoin')
        tx.oncomplete = () => { req.result.close(); resolve() }
        tx.onerror = () => reject(tx.error)
      }
    }))
    await ouvrirSynchroDepuisLaPalette(page)
    await page.getByRole('button', { name: 'Erase everything' }).click()
    await page.getByPlaceholder('ERASE').fill('ERASE')
    await page.locator('form').getByRole('button', { name: 'Erase everything' }).click()
    // L'app repart de zéro : retour au choix de la source.
    await page.locator('.onboarding').waitFor({ timeout: 15_000 })
    assert.equal(await lireEntree(page), null)
    const restes = await page.evaluate(() => new Promise((resolve, reject) => {
      const req = indexedDB.open('lector-keys', 1)
      req.onupgradeneeded = () => req.result.createObjectStore('cles')
      req.onerror = () => reject(req.error)
      req.onsuccess = () => {
        const g = req.result.transaction('cles', 'readonly').objectStore('cles').get('temoin')
        g.onsuccess = () => {
          req.result.close()
          resolve({ cle: g.result ?? null, historique: localStorage.getItem('lector-history'), sauvegarde: localStorage.getItem('lector-sync-saved') })
        }
      }
    }))
    assert.deepEqual(restes, { cle: null, historique: null, sauvegarde: null })
    const avantEffacement = fs.readFileSync(path.join(dossierA, 'Accueil.md'), 'utf8')
    const sFin = await A.synchroniser()
    assert.deepEqual([sFin.state, sFin.lastErrorCode], ['chain-unknown', 'CHAIN_UNKNOWN'])
    assert.equal(fs.readFileSync(path.join(dossierA, 'Accueil.md'), 'utf8'), avantEffacement)
    const clesNeuves = await service.clesDepuisHex(A.creds.chainSecret)
    const etat = await fetch(`${API}/v1/chain`, { headers: { 'X-Lector-Chain-Id': clesNeuves.id, 'X-Lector-Chain-Proof': clesNeuves.preuve } })
    assert.equal(etat.status, 404)
    resultats.toutEffacer = 'casier supprimé, stockage du navigateur vidé, A arrêté, fichiers de A intacts'

    assert.deepEqual(erreurs, [])
    console.log(JSON.stringify({ ok: true, ...resultats }, null, 2))
  } finally {
    await navigateur.close()
    fs.rmSync(dossierA, { recursive: true, force: true })
    arreterServeurs()
  }
}

main().catch((err) => {
  console.error('ÉCHEC :', err && err.stack ? err.stack : err)
  arreterServeurs()
  process.exit(1)
})
