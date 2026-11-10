import { test, expect } from '@playwright/test'

// Bypass le source picker pour tous les tests
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('lector-source-type', 'file')
  })
  await page.reload()
  await page.waitForSelector('.titlebar', { timeout: 5000 })
})

test.describe('Lector : bases de l\'app', () => {
  test('charge la page sans erreur', async ({ page }) => {
    await expect(page.locator('.app')).toBeVisible()
  })

  test('affiche le titlebar avec "Lector"', async ({ page }) => {
    const title = page.locator('.titlebar-title')
    await expect(title).toContainText('Lector')
  })

  test("l'interface reste en anglais, sans bouton de langue", async ({ page }) => {
    // Un ancien choix « fr » enregistré n'a plus d'effet.
    await page.evaluate(() => { localStorage.clear(); localStorage.setItem('locale', 'fr'); localStorage.setItem('lector-locale', '"fr"') })
    await page.goto('/?demo')
    await expect(page.locator('.cm-lp-h1').first()).toHaveText(/Welcome to Lector/)
    await page.locator('.mobile-fab-center').click()
    await expect(page.locator('.lang-compact-btn')).toHaveCount(0)
  })

  test('la palette ouvre À propos : version, principes, crédits', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    await page.locator('.command-palette-input').fill('about')
    await page.locator('.command-palette-item', { hasText: 'About Lector' }).first().click()
    const panneau = page.locator('.apropos')
    await expect(panneau.locator('h2')).toHaveText('Lector')
    await expect(panneau).toContainText(/Version \d+\.\d+\.\d+/)
    await expect(panneau).toContainText('SIL Open Font License')
  })

  test('une ancienne licence locale est effacée au démarrage', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('lector-license', JSON.stringify({ tier: 'pro' }))
      localStorage.setItem('lector-cloud-jwt', 'ancien')
    })
    await page.reload()
    await page.waitForSelector('.titlebar', { timeout: 5000 })
    const restes = await page.evaluate(() => [localStorage.getItem('lector-license'), localStorage.getItem('lector-cloud-jwt')])
    expect(restes).toEqual([null, null])
  })
})
