import { test, expect } from '@playwright/test'
import { relierApi, nouvelleCle } from './entree.js'

test.use({ locale: 'en-US' })

test.beforeEach(async ({ page }) => {
  await relierApi(page)
  await nouvelleCle(page)
})

test.describe('Command Palette', () => {
  test('ouvre avec Cmd+Shift+P', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await expect(palette).toBeVisible()
  })

  test("ne propose que l'édition et la lecture : aucune fonction retirée", async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    const input = palette.locator('.command-palette-input')
    for (const recherche of ['api keys', 'flashcards', 'youtube', 'read aloud', 'ruler', 'auto-scroll', 'highlights', 'learn']) {
      await input.fill(recherche)
      await expect(palette.locator('.command-palette-empty'), recherche).toBeVisible()
    }
  })

  test('aucune commande verrouillée, ni licence ni Kindle', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await expect(palette.locator('.command-palette-item').first()).toBeVisible()
    await expect(palette.locator('.command-palette-item.locked')).toHaveCount(0)

    const input = palette.locator('.command-palette-input')
    for (const recherche of ['licen', 'kindle']) {
      await input.fill(recherche)
      await expect(palette.locator('.command-palette-empty')).toBeVisible()
    }
  })

  test('la commande About ouvre son écran', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await palette.locator('.command-palette-input').fill('about')
    await page.locator('.command-palette-item', { hasText: 'About Lector' }).first().click()
    await expect(page.locator('.apropos h2')).toHaveText('Lector')
  })

  test('ferme avec Escape', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    await expect(page.locator('.command-palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.command-palette')).not.toBeVisible()
  })
})
