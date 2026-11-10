import { test, expect } from '@playwright/test'

// Premier lancement : un seul écran, la note d'accueil s'ouvre tout de suite,
// et un utilisateur qui a déjà une source ne voit jamais l'onboarding.

test.use({ locale: 'en-US' })

async function appareilVierge(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    const opfs = await navigator.storage.getDirectory()
    try { await opfs.removeEntry('Lector Vault', { recursive: true }) } catch {}
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('lector-browser-vault')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.reload()
}

test('Start : dossier créé, note de bienvenue ouverte, aucun écran de synchro', async ({ page }) => {
  await appareilVierge(page)
  await expect(page.getByRole('heading', { name: 'Your notes, yours' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'I already use Lector' })).toBeVisible()
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.getByRole('heading', { name: 'Sync your devices?' })).toHaveCount(0)

  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
  await expect(page.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toBeVisible()

  // Ensuite, plus jamais d'onboarding.
  await page.reload()
  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
  await expect(page.locator('.onboarding')).toHaveCount(0)
})

test('un dossier Lector Vault existant est proposé', async ({ page }) => {
  await appareilVierge(page)
  await page.getByRole('button', { name: 'Start' }).click()
  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')

  await page.evaluate(() => { localStorage.removeItem('lector-source-type'); localStorage.removeItem('lector-last-session') })
  await page.reload()
  await page.getByRole('button', { name: 'Open Lector Vault' }).click()
  // Le premier lancement est passé : pas de second écran, le dossier s'ouvre.
  await expect(page.locator('.titlebar')).toBeVisible()
  await expect(page.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toHaveCount(1)
})

test("un utilisateur d'avant l'onboarding ne le voit pas", async ({ page }) => {
  await appareilVierge(page)
  await page.evaluate(() => localStorage.setItem('lector-source-type', 'file'))
  await page.reload()
  await expect(page.locator('.titlebar')).toBeVisible()
  await expect(page.locator('.onboarding')).toHaveCount(0)
})
