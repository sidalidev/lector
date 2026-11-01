import { test, expect } from '@playwright/test'
import { PORT_TEST } from '../back-test.js'

// Écran Synchronisation dans le navigateur, contre l'API de test : créer une
// chaîne (12 mots, formulaire du gestionnaire de mots de passe, vérification),
// quitter, rejoindre, tout effacer, et les erreurs de saisie.

test.use({ locale: 'en-US' })

const API = `http://localhost:${PORT_TEST}`

// Le serveur de développement n'a pas de proxy : les appels /v1 partent vers l'API de test.
async function relierApi(page) {
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    const reponse = await route.fetch({ url: API + url.pathname + url.search })
    await route.fulfill({ response: reponse })
  })
}

async function ouvrirSynchro(page) {
  await page.locator('.source-card-featured').click()
  await expect(page.locator('.panel h2')).toHaveText('Sync')
}

async function ouvrirSynchroDepuisLaPalette(page) {
  await page.keyboard.press('Meta+Shift+p')
  await page.locator('.command-palette-input').fill('sync')
  await page.locator('.command-palette-item', { hasText: 'Sync' }).first().click()
  await expect(page.locator('.panel h2')).toHaveText('Sync')
}

/** Crée une chaîne et renvoie ses 12 mots, lus à l'écran. */
async function creerChaine(page) {
  await ouvrirSynchro(page)
  await page.getByRole('button', { name: 'Protect and sync' }).click()
  const mots = page.locator('.chaine-mots .chaine-mot')
  await expect(mots).toHaveCount(12)
  return mots.allTextContents()
}

/** Répond à la vérification : trois mots demandés au hasard. */
async function repondreQuiz(page, mots, { faux = false } = {}) {
  const champs = page.locator('.chaine-champ')
  await expect(champs).toHaveCount(3)
  for (let k = 0; k < 3; k++) {
    const libelle = await champs.nth(k).locator('span').textContent()
    const n = Number(libelle.match(/\d+/)[0])
    await champs.nth(k).locator('input').fill(faux && k === 0 ? 'zoo' : mots[n - 1])
  }
  await page.getByRole('button', { name: 'Check', exact: true }).click()
}

test.beforeEach(async ({ page }) => {
  await relierApi(page)
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase('lector-chaine')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    })
  })
  await page.reload()
})

test.describe('Synchronisation dans le navigateur', () => {
  test('sans chaîne : créer ou rejoindre, avec l\'explication en trois étages', async ({ page }) => {
    await ouvrirSynchro(page)
    await expect(page.getByRole('button', { name: 'Protect and sync' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Join', exact: true })).toBeVisible()
    await expect(page.locator('.panel-explication summary')).toHaveText('Why?')
    // Détails techniques : la page du site de Lector (docs/CHAINE.md), pas un dépôt encore privé.
    await expect(page.locator('.panel-explication a')).toHaveAttribute('href', 'https://lector.dockerbop.fr/sync/')
  })

  test('créer : 12 mots, formulaire du gestionnaire, vérification, puis les documents', async ({ page }) => {
    const mots = await creerChaine(page)

    // Formulaire repris par les gestionnaires de mots de passe.
    await expect(page.locator('#lector-sync-chain[autocomplete="username"]')).toHaveValue('lector-sync-chain')
    await expect(page.locator('input[autocomplete="new-password"]')).toHaveValue(mots.join(' '))
    // Sur le web, la chaîne existe déjà : pas de retour en arrière.
    await expect(page.getByRole('button', { name: 'Back' })).toHaveCount(0)

    // Kit de secours : les 12 mots, le code en QR et la page « Pour un proche », imprimés sans dépendance.
    await page.evaluate(() => { window.__impressions = 0; window.print = () => { window.__impressions++ } })
    await page.getByRole('button', { name: 'Print the recovery kit' }).click()
    const kit = page.locator('.kit-secours')
    await expect(kit.locator('.kit-mots li')).toHaveCount(12)
    await expect(kit.locator('.kit-mots')).toContainText(mots[11])
    await expect(kit.locator('svg.kit-qr-image')).toHaveCount(1)
    await expect(kit.locator('h1').nth(1)).toHaveText('For a loved one')
    await expect.poll(() => page.evaluate(() => window.__impressions)).toBe(1)

    const continuer = page.getByRole('button', { name: 'Continue' })
    await expect(continuer).toBeDisabled()
    await page.getByLabel('I saved them').check()
    await continuer.click()

    await repondreQuiz(page, mots, { faux: true })
    await expect(page.getByRole('alert')).toContainText('does not match')

    await repondreQuiz(page, mots)
    await expect(page.getByText('Your chain is ready.')).toBeVisible()
    await page.getByRole('button', { name: 'Open my documents' }).click()
    await expect(page.locator('.panel')).toHaveCount(0)
    await expect(page.locator('.titlebar')).toBeVisible()

    // Premier document : chiffré ici, puis déposé dans le casier.
    await page.locator('.empty-files-cta').click()
    await page.locator('.new-file-input').fill('Notes')
    await page.getByRole('button', { name: 'Create', exact: true }).click()
    await expect(page.locator('.file-tree-item.file', { hasText: 'Notes' })).toBeVisible()

    // Au redémarrage, l'app ouvre directement le vault de la chaîne, relu depuis le casier.
    await page.reload()
    await expect(page.locator('.titlebar')).toBeVisible()
    await expect(page.locator('.source-card-featured')).toHaveCount(0)
    await expect(page.locator('.file-tree-item.file', { hasText: 'Notes' })).toBeVisible()

    // État : place utilisée, sauvegarde confirmée (aucun rappel).
    await ouvrirSynchroDepuisLaPalette(page)
    await expect(page.locator('.chaine-quota')).toContainText('Documents: 1 (at most 20)')
    await expect(page.locator('.chaine-rappel')).toHaveCount(0)
  })

  test('quitter puis rejoindre avec les 12 mots, enfin tout effacer', async ({ page }) => {
    const mots = await creerChaine(page)
    await page.getByLabel('I saved them').check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await page.getByRole('button', { name: 'Check later' }).click()
    await page.getByRole('button', { name: 'Open my documents' }).click()

    // Mots non confirmés : rappel discret dans l'état.
    await ouvrirSynchroDepuisLaPalette(page)
    await expect(page.locator('.chaine-rappel')).toBeVisible()

    // Quitter sur ce navigateur : retour au choix de la source.
    await page.getByRole('button', { name: 'Leave the chain on this device' }).click()
    await page.getByRole('button', { name: 'Leave on this device' }).click()
    await expect(page.getByRole('button', { name: 'Protect and sync' })).toBeVisible()

    // Rejoindre avec les mots (saisie masquée, comme un mot de passe).
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    const champ = page.locator('input[autocomplete="current-password"]')
    await expect(champ).toHaveAttribute('type', 'password')
    await champ.fill(mots.join(' '))
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page.locator('.panel')).toHaveCount(0)

    // Tout effacer : il faut taper le mot demandé.
    await ouvrirSynchroDepuisLaPalette(page)
    await expect(page.locator('.chaine-rappel')).toHaveCount(0)
    await page.getByRole('button', { name: 'Erase everything' }).click()
    // Le navigateur n'a pas de dossier : le casier est peut-être la seule copie des documents.
    await expect(page.locator('.panel-explication .panel-simple')).toContainText('it may be the only copy of your documents')
    const effacer = page.locator('form').getByRole('button', { name: 'Erase everything' })
    await expect(effacer).toBeDisabled()
    await page.getByPlaceholder('ERASE').fill('ERASE')
    await effacer.click()
    // Le stockage local est vidé et l'app repart sur le choix de la source.
    await expect(page.locator('.source-picker')).toBeVisible()
    expect(await page.evaluate(() => localStorage.getItem('lector-sync-saved'))).toBeNull()

    // Le casier n'existe plus : les mêmes mots ne rejoignent plus rien.
    await ouvrirSynchro(page)
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await page.locator('input[autocomplete="current-password"]').fill(mots.join(' '))
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('No chain matches these words')
  })

  test('rejoindre : mots invalides et chaîne inconnue sont deux erreurs distinctes, jamais de création', async ({ page }) => {
    await ouvrirSynchro(page)
    await page.getByRole('button', { name: 'Join', exact: true }).click()
    const champ = page.locator('input[autocomplete="current-password"]')
    const rejoindre = page.getByRole('button', { name: 'Join', exact: true })

    await champ.fill(Array(12).fill('abandon').join(' '))
    await rejoindre.click()
    await expect(page.getByRole('alert')).toContainText('do not form a valid key')

    await champ.fill('abandon fleur')
    await rejoindre.click()
    await expect(page.getByRole('alert')).toContainText('Exactly 12 words are needed')

    await champ.fill(`${'abandon '.repeat(11)}fleur`)
    await rejoindre.click()
    await expect(page.getByRole('alert')).toContainText('"fleur" is not in the list')

    // Mots valides, mais aucun casier ne leur correspond (404).
    await champ.fill(`${'abandon '.repeat(11)}about`)
    await rejoindre.click()
    await expect(page.getByRole('alert')).toContainText('No chain matches these words')
    await expect(page.getByRole('button', { name: 'Protect and sync' })).toHaveCount(0)
  })
})
