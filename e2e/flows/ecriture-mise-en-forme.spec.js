import { test, expect } from '@playwright/test'
import { relierApi, nouvelleCle } from './entree.js'

// Mode d'écriture mis en forme (façon Bear), le seul mode de l'éditeur : la
// syntaxe Markdown se replie hors de la ligne du curseur et les titres sont en
// vraie taille.

test.use({ locale: 'en-US' })

test.beforeEach(async ({ page }) => { await relierApi(page) })

const editeur = (page) => page.locator('.cm-content')
const ligne = (page, n) => page.locator('.cm-line').nth(n)

/** Largeur affichée de la première marque de syntaxe d'une ligne. */
const largeurMarque = (page, n) => ligne(page, n).locator('.cm-lp-cache, .cm-lp-marque').first()
  .evaluate((el) => el.getBoundingClientRect().width)

const taille = (page, n) => ligne(page, n).evaluate((el) => parseFloat(getComputedStyle(el).fontSize))

async function ouvrirEditeur(page) {
  // Une clé neuve ouvre la note d'accueil, vidée ensuite.
  await nouvelleCle(page)
  await expect(page.locator('.cm-lp-h1').first()).toBeVisible()
  await expect(editeur(page)).toBeVisible()
  await editeur(page).click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
}

test('la syntaxe se replie hors de la ligne active et les titres sont grands', async ({ page }) => {
  await ouvrirEditeur(page)
  await expect(page.locator('.cm-editor.cm-lp')).toBeVisible()
  await expect(page.locator('.cm-lineNumbers')).toHaveCount(0)

  await page.keyboard.type('# Title')
  await page.keyboard.press('Enter')
  await page.keyboard.type('**bold**')

  // Ligne 2 active : ses « ** » sont visibles (atténués), le « # » du titre est replié.
  await expect(ligne(page, 1).locator('.cm-lp-marque')).toHaveCount(2)
  expect(await largeurMarque(page, 1)).toBeGreaterThan(0)
  expect(await largeurMarque(page, 0)).toBe(0)
  await expect(ligne(page, 0)).toHaveText('# Title') // le texte reste du texte

  // Sur une autre ligne, plus aucun marqueur visible.
  await page.keyboard.press('Enter')
  await page.keyboard.type('Plain text')
  await expect(ligne(page, 1).locator('.cm-lp-cache')).toHaveCount(2)
  expect(await largeurMarque(page, 1)).toBe(0)
  await expect(ligne(page, 1).locator('.cm-lp-gras')).toHaveCSS('font-weight', '700')

  // Titre plus grand que le texte.
  expect(await taille(page, 0)).toBeGreaterThan((await taille(page, 2)) * 1.5)

  // Le curseur revient sur le titre : « # » réapparaît.
  await page.keyboard.press('ControlOrMeta+Home')
  expect(await largeurMarque(page, 0)).toBeGreaterThan(0)
})

test('une case à cocher écrit « - [x] » et la date dans le texte', async ({ page }) => {
  await ouvrirEditeur(page)
  await page.keyboard.type('- [ ] Buy bread')
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')
  await page.keyboard.type('Next')

  const caseTache = page.locator('.cm-lp-case')
  await expect(caseTache).toHaveAttribute('aria-checked', 'false')
  await caseTache.click()
  await expect(page.locator('.cm-lp-case')).toHaveAttribute('aria-checked', 'true')
  await expect(ligne(page, 0)).toHaveText(/^- \[x\] Buy bread ✅ \d{4}-\d{2}-\d{2}$/)
})
