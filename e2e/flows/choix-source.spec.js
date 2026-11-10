import { test, expect } from '@playwright/test'
import { relierApi, navigateurVierge, nouvelleCle, seConnecter } from './entree.js'

// Entrée de l'app web : on se connecte avec ses 12 mots ou on crée sa clé.
// Jamais d'entrée ambiguë dans des notes sans clé, jamais de prénom demandé.

test.use({ locale: 'en-US' })

test.beforeEach(async ({ page }) => { await relierApi(page) })

test('premier passage : créer sa clé, la note de bienvenue s\'ouvre, puis on entre directement', async ({ page }) => {
  await navigateurVierge(page)
  await expect(page.getByRole('heading', { name: 'Lector' })).toBeVisible()
  await expect(page.getByTestId('entree-connexion')).toHaveText('Sign in')
  await expect(page.getByTestId('entree-creer')).toContainText('Create my key')

  await page.getByTestId('entree-creer').click()
  await expect(page.getByTestId('entree-mots').locator('.chaine-mot')).toHaveCount(12)
  // Formulaire repris par les gestionnaires de mots de passe (Proton Pass, Bitwarden…).
  const mots = await page.getByTestId('entree-mots').locator('.chaine-mot').allTextContents()
  await expect(page.locator('input[autocomplete="username"]')).toHaveValue('lector-sync-chain')
  await expect(page.locator('input[autocomplete="new-password"]')).toHaveValue(mots.join(' '))
  // Continuer seulement une fois la clé gardée (gestionnaire, copie ou écrite).
  await expect(page.getByTestId('entree-continuer')).toBeDisabled()
  await page.getByRole('button', { name: 'I wrote them down' }).click()
  await page.getByTestId('entree-continuer').click()

  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
  await page.reload()
  await expect(page.locator('.titlebar')).toBeVisible()
  await expect(page.locator('.onboarding')).toHaveCount(0)
  await expect(page.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toBeVisible()
})

test('des notes locales sans clé ne suffisent pas : l\'écran d\'entrée s\'affiche', async ({ page }) => {
  await navigateurVierge(page)
  await page.evaluate(() => localStorage.setItem('lector-source-type', 'browser'))
  await page.reload()
  await expect(page.getByTestId('entree-connexion')).toBeVisible()
  await expect(page.locator('.titlebar')).toHaveCount(0)
})

test('un autre navigateur se connecte avec les 12 mots et retrouve les notes', async ({ page, browser }) => {
  const mots = await nouvelleCle(page)
  await expect(page.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toBeVisible()

  const autre = await (await browser.newContext()).newPage()
  await relierApi(autre)
  await autre.goto('/')
  await seConnecter(autre, mots)
  await expect(autre.locator('.titlebar')).toBeVisible()
  await expect(autre.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toBeVisible()
})
