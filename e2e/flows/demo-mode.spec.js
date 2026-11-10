import { test, expect } from '@playwright/test'

// Mode démo (?demo) : contenu embarqué, rien n'est persisté. Sert aux captures
// et de repli au premier lancement quand aucun dossier ne peut être créé
// (iOS sans iCloud Drive, navigateur sans stockage de fichiers).
test.describe('Mode démo', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.evaluate(() => localStorage.clear())
    await page.goto('/?demo')
  })

  test('la démo ouvre un document lisible immédiatement', async ({ page }) => {
    await expect(page.locator('.cm-lp-h1').first()).toContainText(/Welcome to Lector/)
  })

  test('la démo liste ses documents dans la sidebar', async ({ page }) => {
    await expect(page.locator('.cm-lp-h1').first()).toBeVisible()
    await expect(page.locator('.file-tree-item')).toHaveCount(3)
  })

  test('naviguer vers le doc des diagrammes rend mermaid dans la note', async ({ page }) => {
    await expect(page.locator('.cm-lp-h1').first()).toBeVisible()
    await page.locator('.file-tree-item', { hasText: /Diagrams/ }).click()
    await expect(page.locator('.cm-lp-h1').first()).toContainText(/Diagrams/)
    await expect(page.locator('.mermaid-svg svg').first()).toBeVisible({ timeout: 15000 })
    // Les formules ne sont pas rendues : $…$ reste du texte.
    await expect(page.locator('.katex')).toHaveCount(0)
  })

  test("rien n'est persisté : le premier lancement revient sans ?demo", async ({ page }) => {
    await expect(page.locator('.cm-lp-h1').first()).toBeVisible()
    const leaked = await page.evaluate(() =>
      Object.keys(localStorage).filter(k => /source-type|last-session/.test(k))
    )
    expect(leaked).toEqual([])
    await page.goto('/')
    await expect(page.getByTestId('entree-connexion')).toBeVisible()
  })
})
