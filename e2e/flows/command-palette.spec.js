import { test, expect } from '@playwright/test'

test.use({ locale: 'en-US' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => {
    localStorage.setItem('lector-source-type', 'file')
  })
  await page.reload()
  await page.waitForSelector('.titlebar', { timeout: 5000 })
})

test.describe('Command Palette', () => {
  test('ouvre avec Cmd+Shift+P', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await expect(palette).toBeVisible()
  })

  test('contient la commande Clés API', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await expect(palette).toBeVisible()

    await palette.locator('.command-palette-input').fill('api keys')

    const item = palette.locator('.command-palette-item')
    await expect(item.first()).toBeVisible()
    await expect(item.first()).toContainText(/API keys/)
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

  test('la commande Clés API ouvre son écran', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    const palette = page.locator('.command-palette')
    await palette.locator('.command-palette-input').fill('api keys')
    await page.locator('.command-palette-item', { hasText: 'API keys' }).first().click()

    const panneau = page.locator('.panel')
    await expect(panneau.locator('h2')).toHaveText('API keys')
    await expect(panneau).toContainText('On the web, any script on the page can read it')
  })

  test('ferme avec Escape', async ({ page }) => {
    await page.keyboard.press('Meta+Shift+p')
    await expect(page.locator('.command-palette')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.locator('.command-palette')).not.toBeVisible()
  })
})
