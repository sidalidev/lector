import { test, expect } from '@playwright/test'

// Clés API personnelles dans le navigateur : enregistrées chiffrées sur
// l'appareil, jamais affichées en entier ; le chat et la voix renvoient vers
// cet écran quand la clé manque. Aucun appel aux services externes ici.

test.use({ locale: 'en-US' })

test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('lector-keys')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.goto('/?demo')
  await expect(page.locator('h1').first()).toBeVisible()
})

async function ouvrirCles(page) {
  await page.keyboard.press('Meta+Shift+p')
  await page.locator('.command-palette-input').fill('api keys')
  await page.locator('.command-palette-item', { hasText: 'API keys' }).first().click()
  await expect(page.locator('.panel h2')).toHaveText('API keys')
}

test.describe('Clés API', () => {
  test('enregistrer puis effacer une clé : seuls ses 4 derniers caractères s\'affichent', async ({ page }) => {
    await ouvrirCles(page)
    const carte = page.locator('.cles-carte').filter({ hasText: 'Anthropic' })
    await expect(carte).toContainText('No key yet')

    await carte.locator('input').fill('sk-ant-test-0000-wxyz')
    await carte.getByRole('button', { name: 'Save' }).click()
    await expect(carte).toContainText('Key saved, ending in wxyz')
    await expect(carte).not.toContainText('sk-ant-test')
    await expect(carte.locator('input')).toHaveValue('')

    // Rien en clair dans le stockage local.
    const fuite = await page.evaluate(() => Object.values(localStorage).some((v) => v.includes('wxyz')))
    expect(fuite).toBe(false)

    await carte.getByRole('button', { name: 'Erase' }).click()
    await expect(carte).toContainText('No key yet')
  })

  test('sans clé, le chat propose d\'en ajouter une', async ({ page }) => {
    await page.locator('.mobile-fab-chat').click()
    const gate = page.locator('.chat-gate')
    await expect(gate).toContainText('Anthropic API key')
    await gate.getByRole('button', { name: 'Add a key' }).click()
    await expect(page.locator('.panel h2')).toHaveText('API keys')
  })
})
