import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { PORT_TEST } from '../back-test.js'

// App Mac « hybride » : la fenêtre affiche la web app (ici le serveur Vite
// local), la synchro du dossier tourne dans le processus principal contre
// l'API de test. Données jetables : un dossier de données et un vault
// temporaires, un trousseau simulé (main.js). Jamais les données de l'utilisateur.

test.use({ locale: 'en-US' })
test.describe.configure({ mode: 'serial' })
test.setTimeout(120_000)

const RACINE = path.join(__dirname, '../..')
const API = `http://localhost:${PORT_TEST}`
const APP = 'http://localhost:5173/'
const CHAINE = path.join(RACINE, 'front/src/services/chaine')
const charger = (f) => import(pathToFileURL(path.join(CHAINE, f)).href)

const temporaire = (nom) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `lector-mac-${nom}-`)))

// LECTOR_TEST_APP_BINARY : l'app construite (release/mac-universal/Lector.app/Contents/MacOS/Lector)
// au lieu de `electron .`, pour la même suite sur le paquet signé.
const BINAIRE = process.env.LECTOR_TEST_APP_BINARY

async function lancer(donnees, env = {}, args = []) {
  const app = await _electron.launch({
    ...(BINAIRE ? { executablePath: BINAIRE } : {}),
    args: BINAIRE ? args : [RACINE, ...args],
    env: { ...process.env, LECTOR_TEST_USER_DATA: donnees, LECTOR_APP_URL: APP, LECTOR_SERVER_URL: API, LECTOR_UPDATE_URL: 'http://localhost:9/releases', ...env },
  })
  const page = args.includes('--lector-hidden') ? null : await app.firstWindow()
  return { app, page }
}

/** Une installation existante : chaîne créée sur l'API de test, dossier, cloud-secrets.dat. */
async function installationExistante(fichiers = {}) {
  const service = await charger('service.js')
  const n = await service.nouvelleChaine()
  const hex = service.secretVersHex(n.S)
  await service.clientDe(await service.clesDepuisHex(hex), { serverUrl: API }).creer()
  const donnees = temporaire('donnees')
  const vault = temporaire('vault')
  for (const [nom, texte] of Object.entries(fichiers)) fs.writeFileSync(path.join(vault, nom), texte)
  fs.writeFileSync(path.join(donnees, 'cloud-secrets.dat'), JSON.stringify({
    vaultPath: vault, serverUrl: API, deviceId: randomUUID(), chainSecret: hex, chainId: n.id,
  }))
  return { hex, id: n.id, donnees, vault }
}

/** Chemins en clair des documents vivants du casier. */
async function cheminsDuCasier(hex) {
  const service = await charger('service.js')
  const crypto = await charger('crypto.js')
  const cles = await service.clesDepuisHex(hex)
  const client = service.clientDe(cles, { serverUrl: API })
  const man = await client.manifeste()
  const chemins = []
  for (const d of man.docs.filter((x) => !x.deletedAt)) chemins.push(await crypto.dechiffrerCheminAvec(cles, d.docId, d.pathEnc))
  return chemins
}

async function attendre(condition, delai = 60_000) {
  const fin = Date.now() + delai
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error('Délai dépassé')
    await new Promise((r) => setTimeout(r, 300))
  }
}

test('installation existante : l\'interface s\'ouvre connectée, le dossier et le casier se synchronisent dans les deux sens', async () => {
  // Une chaîne déjà créée par ce Mac, avec son dossier, comme dans cloud-secrets.dat.
  const { hex, id, donnees, vault } = await installationExistante({ 'Deja la.md': '# Already here\n' })
  const n = { id }

  const { app, page } = await lancer(donnees)
  try {
    // Aucun écran d'entrée : la web app s'est connectée avec la chaîne du Mac.
    await expect(page.locator('.titlebar')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('entree-connexion')).toHaveCount(0)
    await expect(page.locator('.file-tree-item', { hasText: 'Deja la' })).toBeVisible({ timeout: 60_000 })
    expect((await app.evaluate(() => global.__lectorTest.creds())).interfaceChainId).toBe(n.id)
    // Icône Lector sur le dossier (fichier caché « Icon\r » posé par le Finder), notes intactes.
    await attendre(() => fs.existsSync(path.join(vault, 'Icon\r')), 15_000)
    expect(fs.readFileSync(path.join(vault, 'Deja la.md'), 'utf8')).toBe('# Already here\n')

    // Dossier → casier.
    fs.writeFileSync(path.join(vault, 'Depuis le Mac.md'), '# From the Mac\n')
    await attendre(async () => (await cheminsDuCasier(hex)).includes('Depuis le Mac.md'))

    // Casier → dossier : une note créée dans l'interface arrive dans le dossier.
    await page.locator('.sidebar-new-btn').click()
    await page.getByPlaceholder('File name...').fill('Depuis le web')
    await page.getByPlaceholder('File name...').press('Enter')
    await expect(page.locator('.cm-lp-h1').first()).toContainText('Depuis le web', { timeout: 30_000 })
    await attendre(() => fs.existsSync(path.join(vault, 'Depuis le web.md')))

    // Ouverture à la connexion activée d'office : un dossier est en synchro.
    expect(await app.evaluate(() => global.__lectorTest.ouvertureAuDemarrage())).toBe(true)

    // Fenêtre fermée : l'app reste, la synchro continue.
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
    await attendre(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 0, 10_000)
    fs.writeFileSync(path.join(vault, 'Fenetre fermee.md'), '# Window closed\n')
    await attendre(async () => (await cheminsDuCasier(hex)).includes('Fenetre fermee.md'))
    // Le Dock rouvre la fenêtre.
    await app.evaluate(({ app: a }) => a.emit('activate'))
    await attendre(async () => (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)) === 1, 10_000)
  } finally {
    await app.close()
  }
})

test('installation neuve : écran d\'entrée, clé créée, le Mac la garde ; « Keep a folder in sync » démarre la synchro', async () => {
  const donnees = temporaire('donnees')
  const vault = temporaire('vault')
  const { app, page } = await lancer(donnees)
  try {
    await expect(page.getByTestId('entree-creer')).toBeVisible({ timeout: 60_000 })
    // Pas de gestionnaire de mots de passe dans l'app : copier ou noter les mots.
    await page.getByTestId('entree-creer').click()
    await expect(page.getByTestId('entree-mots').locator('.chaine-mot')).toHaveCount(12)
    await expect(page.getByTestId('entree-gestionnaire')).toHaveCount(0)
    await expect(page.getByTestId('entree-copier')).toBeVisible()
    await page.getByRole('button', { name: 'I wrote them down' }).click()
    await page.getByTestId('entree-continuer').click()
    await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector', { timeout: 60_000 })

    // Le Mac a reçu la chaîne, sans dossier en synchro.
    await attendre(async () => (await app.evaluate(() => global.__lectorTest.creds())).hasChain)
    const c = await app.evaluate(() => global.__lectorTest.creds())
    expect(c.vaultPath).toBe(null)
    expect(c.interfaceChainId).toBe(c.chainId)
    // Sans dossier en synchro, pas d'ouverture à la connexion.
    expect(await app.evaluate(() => global.__lectorTest.ouvertureAuDemarrage())).toBe(false)

    // « Keep a folder in sync » (sans la boîte de dialogue) : la note d'accueil arrive.
    await app.evaluate((_e, d) => global.__lectorTest.adopterDossier(d), vault)
    await attendre(() => fs.existsSync(path.join(vault, 'Welcome to Lector.md')))
    expect((await app.evaluate(() => global.__lectorTest.synchro())).lastSyncAt).toBeTruthy()
    // Dossier en synchro : ouverture à la connexion activée ; le choix de l'utilisateur reste.
    expect(await app.evaluate(() => global.__lectorTest.ouvertureAuDemarrage())).toBe(true)
    await app.evaluate(() => global.__lectorTest.choisirOuverture(false))
    expect(await app.evaluate(() => global.__lectorTest.ouvertureAuDemarrage())).toBe(false)
  } finally {
    await app.close()
  }
})

test('« Use the key of this window for the folder » : le dossier part dans le casier de la clé de la fenêtre, l\'ancien reste', async () => {
  const { hex, donnees, vault } = await installationExistante({ 'Note.md': '# Note\n' })
  const autre = await installationExistante()
  const service = await charger('service.js')
  const motsAutre = (await service.exporterChaine(service.hexVersSecret(autre.hex))).mots.join(' ')
  const { app, page } = await lancer(donnees)
  try {
    await expect(page.locator('.titlebar')).toBeVisible({ timeout: 60_000 })
    await attendre(async () => (await cheminsDuCasier(hex)).includes('Note.md'))
    // La fenêtre a utilisé une autre clé : le Mac garde la sienne et propose de passer dessus.
    expect(await page.evaluate((m) => window.lectorDesktop.garderChaine(m), motsAutre)).toEqual({ ok: false, code: 'HAS_CHAIN' })
    expect(await app.evaluate(() => global.__lectorTest.cleDeLaFenetreEnAttente())).toBe(true)
    const r = await app.evaluate(() => global.__lectorTest.utiliserCleDeLaFenetre())
    expect(r.ok).toBe(true)
    expect((await app.evaluate(() => global.__lectorTest.creds())).chainId).toBe(autre.id)
    await attendre(async () => (await cheminsDuCasier(autre.hex)).includes('Note.md'))
    // L'ancien casier n'est pas effacé.
    expect(await cheminsDuCasier(hex)).toContain('Note.md')
  } finally {
    await app.close()
  }
})

test('lancée à la connexion : pas de fenêtre, la synchro du dossier tourne ; le Dock ouvre la fenêtre', async () => {
  const { hex, donnees, vault } = await installationExistante()
  const { app } = await lancer(donnees, {}, ['--lector-hidden'])
  try {
    await attendre(async () => !!(await app.evaluate(() => global.__lectorTest?.synchro()?.lastSyncAt)))
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(0)
    fs.writeFileSync(path.join(vault, 'En arriere-plan.md'), '# Background\n')
    await attendre(async () => (await cheminsDuCasier(hex)).includes('En arriere-plan.md'))
    await app.evaluate(({ app: a }) => a.emit('activate'))
    const page = await app.firstWindow()
    await expect(page.locator('.titlebar')).toBeVisible({ timeout: 60_000 })
  } finally {
    await app.close()
  }
})

test('liens : un autre site s\'ouvre dans le navigateur du système, /d/<id> reste dans l\'app', async () => {
  const { app, page } = await lancer(temporaire('donnees'))
  try {
    await expect(page.getByTestId('entree-creer')).toBeVisible({ timeout: 60_000 })
    await app.evaluate(({ shell }) => {
      global.__ouverts = []
      shell.openExternal = async (u) => { global.__ouverts.push(u) }
    })
    await page.evaluate(() => { window.open('https://example.com/ailleurs', '_blank') })
    await page.evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.org/lien'; document.body.appendChild(a); a.click() })
    await attendre(async () => (await app.evaluate(() => global.__ouverts.length)) === 2, 10_000)
    expect(await app.evaluate(() => global.__ouverts)).toEqual(['https://example.com/ailleurs', 'https://example.org/lien'])
    expect(page.url()).toBe(APP)
    expect(app.windows().length).toBe(1)

    // Le pont n'existe que pour l'interface, avec le moins possible.
    expect(await page.evaluate(() => Object.keys(window.lectorDesktop).sort())).toEqual(['chaineConnectee', 'garderChaine', 'motsDeLaChaine'])
    expect(await page.evaluate(() => typeof window.electron)).toBe('undefined')

    await page.evaluate(() => { location.href = '/d/0123456789abcdef0123456789abcdef' })
    await page.waitForURL(/\/d\/0123456789abcdef0123456789abcdef$/)
    expect(await app.evaluate(() => global.__ouverts.length)).toBe(2)
  } finally {
    await app.close()
  }
})

test('première ouverture sans réseau : page « hors ligne » avec « Try Again »', async () => {
  const { app, page } = await lancer(temporaire('donnees'), { LECTOR_APP_URL: 'http://localhost:9/' })
  try {
    await expect(page.getByRole('heading', { name: 'You are offline' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('link', { name: 'Try Again' })).toHaveAttribute('href', 'http://localhost:9/')
    expect(await page.evaluate(() => typeof window.lectorDesktop)).toBe('undefined')
  } finally {
    await app.close()
  }
})
