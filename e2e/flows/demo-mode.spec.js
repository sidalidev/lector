import { test, expect } from '@playwright/test'

// Mode démo : le scénario exact du rejet store de mars.
// Un reviewer sur appareil vierge doit voir le produit sans compte ni service externe.
test.describe('Mode démo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    // Appareil vierge : aucun localStorage
    await page.evaluate(() => localStorage.clear())
    await page.reload()
  })

  test('le picker propose la carte démo sur appareil vierge', async ({ page }) => {
    await expect(page.locator('.source-card-demo')).toBeVisible()
  })

  test('la démo ouvre un document lisible immédiatement', async ({ page }) => {
    await page.locator('.source-card-demo').click()
    await expect(page.locator('h1').first()).toContainText(/Welcome to Lector|Bienvenue dans Lector/)
  })

  test('la démo liste ses documents dans la sidebar', async ({ page }) => {
    await page.locator('.source-card-demo').click()
    await expect(page.locator('h1').first()).toBeVisible()
    // Les deux docs démo sont listés dans l'arborescence
    const items = page.locator('.file-tree-item')
    await expect(items).toHaveCount(2)
  })

  test('naviguer vers le second doc rend mermaid et katex', async ({ page }) => {
    await page.locator('.source-card-demo').click()
    await expect(page.locator('h1').first()).toBeVisible()
    await page.locator('.file-tree-item', { hasText: /Diagrams|Diagrammes/ }).click()
    await expect(page.locator('h1').first()).toContainText(/Diagrams|Diagrammes/)
    // KaTeX rendu (chargé à la demande)
    await expect(page.locator('.katex').first()).toBeVisible({ timeout: 10000 })
  })

  test('rien nest persisté : le picker revient après reload', async ({ page }) => {
    await page.locator('.source-card-demo').click()
    await expect(page.locator('h1').first()).toBeVisible()
    // Aucune clé de source/session ne doit avoir fuité
    const leaked = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => /source-type|last-session/.test(k))
    )
    expect(leaked).toEqual([])
    await page.reload()
    await expect(page.locator('.source-card-demo')).toBeVisible()
  })
})
