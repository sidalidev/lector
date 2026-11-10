import { expect } from '@playwright/test'
import { PORT_TEST } from '../back-test.js'

// Entrée de l'app web : la clé de 12 mots tient lieu de compte.

const API = `http://localhost:${PORT_TEST}`

/** Envoie les appels /v1 vers l'API de test. */
export async function relierApi(page) {
  await page.route('**/v1/**', async (route) => {
    const url = new URL(route.request().url())
    try {
      const reponse = await route.fetch({ url: API + url.pathname + url.search })
      await route.fulfill({ response: reponse })
    } catch {
      // Page fermée pendant l'appel (fin du test) : rien à répondre.
      await route.abort().catch(() => {})
    }
  })
}

/** Navigateur vierge : ni clé, ni notes locales. */
export async function navigateurVierge(page) {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    for (const nom of ['lector-chaine', 'lector-browser-vault', 'lector-historique']) {
      await new Promise((resolve) => {
        const req = indexedDB.deleteDatabase(nom)
        req.onsuccess = req.onerror = req.onblocked = () => resolve()
      })
    }
    try { await (await navigator.storage.getDirectory()).removeEntry('Lector Vault', { recursive: true }) } catch {}
  })
  await page.reload()
}

/** Crée une clé depuis l'écran d'entrée et entre dans l'app. Renvoie les 12 mots. */
export async function nouvelleCle(page) {
  await navigateurVierge(page)
  await page.getByTestId('entree-creer').click()
  const mots = page.getByTestId('entree-mots').locator('.chaine-mot')
  await expect(mots).toHaveCount(12)
  const liste = await mots.allTextContents()
  await page.getByRole('button', { name: 'I wrote them down' }).click()
  await page.getByTestId('entree-continuer').click()
  await expect(page.locator('.titlebar')).toBeVisible()
  return liste
}

/** Se connecte avec les 12 mots depuis l'écran d'entrée. */
export async function seConnecter(page, mots) {
  await page.getByTestId('entree-connexion').click()
  await page.getByTestId('entree-mots-saisie').fill(Array.isArray(mots) ? mots.join(' ') : mots)
  await page.getByTestId('entree-valider').click()
}
