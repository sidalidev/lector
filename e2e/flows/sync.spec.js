import { test, expect } from '@playwright/test'
import { relierApi, nouvelleCle, seConnecter, navigateurVierge } from './entree.js'

// Écran Synchronisation dans le navigateur, contre l'API de test : créer une
// chaîne (12 mots, formulaire du gestionnaire de mots de passe, vérification),
// quitter, rejoindre, tout effacer, et les erreurs de saisie.

test.use({ locale: 'en-US' })

async function ouvrirSynchroDepuisLaPalette(page) {
  await page.keyboard.press('Meta+Shift+p')
  await page.locator('.command-palette-input').fill('sync')
  await page.locator('.command-palette-item', { hasText: 'Sync' }).first().click()
  await expect(page.locator('.panel h2')).toHaveText('Sync')
}

test.beforeEach(async ({ page }) => { await relierApi(page) })

test.describe('Synchronisation dans le navigateur', () => {
  test('créer sa clé : les documents vont dans le casier et reviennent au rechargement', async ({ page }) => {
    await nouvelleCle(page)
    // Premier document : chiffré ici, puis déposé dans le casier.
    await page.keyboard.press('Meta+Shift+p')
    await page.locator('.command-palette-input').fill('new file')
    await page.locator('.command-palette-item').first().click()
    await page.locator('.new-file-input').fill('Notes')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('.file-tree-item.file', { hasText: 'Notes' })).toBeVisible()

    await page.reload()
    await expect(page.locator('.titlebar')).toBeVisible()
    await expect(page.locator('.file-tree-item.file', { hasText: 'Notes' })).toBeVisible()

    // État : place utilisée, clé gardée (aucun rappel).
    await ouvrirSynchroDepuisLaPalette(page)
    await expect(page.locator('.chaine-quota')).toContainText('Documents: 2 (at most 20)')
    await expect(page.locator('.chaine-rappel')).toHaveCount(0)
  })

  test('hors ligne : la note est gardée puis envoyée au retour du réseau, rien n\'est perdu', async ({ page, context }) => {
    await nouvelleCle(page)
    await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
    // Les appels /v1 passent par Playwright (relierApi) : on les coupe aussi.
    const coupure = (route) => route.abort('internetdisconnected')
    await page.route('**/v1/**', coupure)
    await context.setOffline(true)
    await page.locator('.cm-content').click()
    await page.keyboard.press('ControlOrMeta+End')
    await page.keyboard.type('\nWritten on the train.')
    await expect(page.getByTestId('hors-ligne')).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.doc-save-error')).toHaveCount(0)

    await page.unroute('**/v1/**', coupure)
    await context.setOffline(false)
    await expect(page.getByTestId('hors-ligne')).toHaveCount(0, { timeout: 40_000 })
    await page.reload()
    await page.locator('.file-tree-item', { hasText: 'Welcome to Lector' }).click()
    await expect.poll(async () => {
      await page.locator('.document-view').evaluate((el) => { el.scrollTop = el.scrollHeight })
      return page.locator('.cm-content').textContent()
    }).toContain('Written on the train.')
  })

  test('quitter puis se reconnecter avec les 12 mots, enfin tout effacer', async ({ page }) => {
    const mots = await nouvelleCle(page)

    // Quitter sur ce navigateur : retour à l'écran d'entrée.
    await ouvrirSynchroDepuisLaPalette(page)
    await page.getByRole('button', { name: 'Leave the chain on this device' }).click()
    await page.getByRole('button', { name: 'Leave on this device' }).click()
    await expect(page.getByTestId('entree-connexion')).toBeVisible()

    // Se reconnecter (saisie masquée, comme un mot de passe).
    await page.getByTestId('entree-connexion').click()
    const champ = page.locator('input[autocomplete="current-password"]')
    await expect(champ).toHaveAttribute('type', 'password')
    await champ.fill(mots.join(' '))
    await page.getByTestId('entree-valider').click()
    await expect(page.locator('.titlebar')).toBeVisible()

    // Tout effacer : il faut taper le mot demandé.
    await ouvrirSynchroDepuisLaPalette(page)
    await page.getByRole('button', { name: 'Erase everything' }).click()
    await expect(page.locator('.panel-explication .panel-simple')).toContainText('it may be the only copy of your documents')
    const effacer = page.locator('form').getByRole('button', { name: 'Erase everything' })
    await expect(effacer).toBeDisabled()
    await page.getByPlaceholder('ERASE').fill('ERASE')
    await effacer.click()
    await expect(page.getByTestId('entree-connexion')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('lector-sync-saved'))).toBeNull()

    // Le casier n'existe plus : les mêmes mots n'ouvrent plus rien.
    await seConnecter(page, mots)
    await expect(page.getByRole('alert')).toContainText('No notes match these words')
  })

  test('se connecter : mots invalides et clé inconnue sont deux erreurs distinctes, jamais de création', async ({ page }) => {
    await navigateurVierge(page)
    await page.getByTestId('entree-connexion').click()
    const champ = page.getByTestId('entree-mots-saisie')
    const valider = page.getByTestId('entree-valider')

    await champ.fill(Array(12).fill('abandon').join(' '))
    await valider.click()
    await expect(page.getByRole('alert')).toContainText('do not form a valid key')

    await champ.fill('abandon fleur')
    await valider.click()
    await expect(page.getByRole('alert')).toContainText('Exactly 12 words are needed')

    await champ.fill(`${'abandon '.repeat(11)}fleur`)
    await valider.click()
    await expect(page.getByRole('alert')).toContainText('"fleur" is not in the list')

    // Mots valides, mais aucun casier ne leur correspond (404).
    await champ.fill(`${'abandon '.repeat(11)}about`)
    await valider.click()
    await expect(page.getByRole('alert')).toContainText('No notes match these words')
    await expect(page.locator('.titlebar')).toHaveCount(0)
  })
})
