import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ordinateur sans trousseau sécurisé (Linux sans libsecret) : les clés API sont
// rangées en clair dans un fichier lisible par l'utilisateur seul. L'écran des
// clés le dit, et n'annonce jamais un chiffrement par le trousseau du système.
// Le vrai processus principal tourne sur un dossier de données jetable ; son
// safeStorage est rendu indisponible.

let app
let page
let donnees

test.beforeAll(async () => {
  donnees = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-cles-'))
  app = await _electron.launch({
    args: [path.join(__dirname, 'electron-harnais.cjs')],
    env: { ...process.env, LECTOR_TEST_USER_DATA: donnees },
  })
  await app.evaluate(({ safeStorage }) => { safeStorage.isEncryptionAvailable = () => false })
  page = await app.firstWindow()
  await page.waitForFunction(() => !!window.electron, null, { timeout: 20000 })
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(donnees, { recursive: true, force: true })
})

test('sans trousseau, l\'écran des clés dit que la clé n\'est pas chiffrée par le système', async () => {
  // Premier lancement sur un cache Vite froid : la démo se compile à la demande.
  test.setTimeout(120000)
  expect(await page.evaluate(() => window.electron.keys.get('anthropic'))).toMatchObject({ present: false, secure: false })

  // Le clic déclenche des imports dynamiques ; Playwright croit à une
  // navigation sous Electron et l'attend sans fin.
  await page.locator('.source-card-demo').click({ noWaitAfter: true })
  await expect(page.locator('h1').first()).toBeVisible()
  await page.keyboard.press('Meta+Shift+p')
  await page.locator('.command-palette-input').fill('api keys')
  await page.locator('.command-palette-item', { hasText: 'API keys' }).first().click()
  const panneau = page.locator('.panel')
  await expect(panneau.locator('h2')).toHaveText(/API keys|Clés API/)

  await expect(panneau).toContainText(/no secure keychain|pas de trousseau sécurisé/)
  await expect(panneau).not.toContainText(/encrypted by the system keychain|chiffrée par le trousseau du système/)
})
