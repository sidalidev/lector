import { test, expect } from '@playwright/test'

// Au démarrage, la restauration de session est asynchrone (le navigateur lit
// sa chaîne dans IndexedDB). Une source choisie entre-temps reste affichée :
// le choix de la source ne revient pas par-dessus.

test.use({ locale: 'en-US' })

test('la démo choisie pendant la restauration de session reste affichée', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())

  // Restauration lente : le module de la chaîne du navigateur arrive 1,5 s plus tard.
  let retarde = false
  await page.route(/\/src\/services\/chaineWeb\.js/, async (route) => {
    retarde = true
    await new Promise((r) => setTimeout(r, 1500))
    await route.continue()
  })
  await page.reload()

  await page.locator('.source-card-demo').click()
  await expect(page.locator('h1').first()).toContainText('Welcome to Lector')
  await expect.poll(() => retarde).toBe(true)
  // Bien après la fin de la restauration : toujours la démo, pas le choix de la source.
  await page.waitForTimeout(2500)
  await expect(page.locator('.source-card-demo')).toHaveCount(0)
  await expect(page.locator('h1').first()).toContainText('Welcome to Lector')
})
