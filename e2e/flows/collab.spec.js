import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import { DONNEES } from '../back-test.js'

// Co-écriture dans le navigateur (docs/collab-design.md § 8), contre le relais
// de l'API de test (proxy /v1 de Vite, WebSocket compris) : deux contextes de
// navigateur sans compte ni vault écrivent ensemble, l'un coupe le réseau puis
// revient, l'invitée télécharge sa copie, le propriétaire arrête le partage.

test.use({ locale: 'en-US' })

const TEXTE = '# The Lighthouse\n\nINT. KITCHEN - NIGHT\n'

/** Crée un partage depuis une page de l'app (module chargé par Vite) et renvoie le lien. */
async function creerPartage(page) {
  await page.goto('/')
  return page.evaluate(async (texte) => {
    const { creerPartage } = await import('/src/services/collab/partage.js')
    const r = await creerPartage({ texte, titre: 'The Lighthouse' })
    if (!r.enLigne) throw new Error('relais injoignable')
    return r.lien
  }, TEXTE)
}

async function entrer(page, lien, nom) {
  await page.goto(lien)
  await page.getByTestId('collab-nom').fill(nom)
  await page.getByRole('button', { name: 'Continue' }).click()
  await expect(page.getByTestId('collab-statut')).toHaveAttribute('data-statut', 'en-ligne')
}

const editeur = (page) => page.locator('.cm-content')

/** Texte du document affiché, sans les étiquettes des curseurs distants. */
const texteDe = (page) => page.evaluate(() => {
  const copie = document.querySelector('.cm-content').cloneNode(true)
  copie.querySelectorAll('.cm-ySelectionCaret, .cm-ySelectionInfo, .cm-widgetBuffer').forEach((n) => n.remove())
  return [...copie.querySelectorAll('.cm-line')].map((l) => l.textContent).join('\n')
})

/** Place le curseur à la fin du document et tape. */
async function taperALaFin(page, texte) {
  await editeur(page).click()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(texte, { delay: 5 })
}

test('deux navigateurs écrivent ensemble, survivent à une coupure, puis le partage s’arrête', async ({ browser }) => {
  test.setTimeout(90_000)
  const ctxSid = await browser.newContext()
  const ctxLea = await browser.newContext()
  const sid = await ctxSid.newPage()
  const lea = await ctxLea.newPage()

  const lien = await creerPartage(sid)
  expect(lien).toMatch(/\/d\/[0-9a-f]{32}#[A-Za-z0-9_-]{43}$/)

  // Le propriétaire ouvre son lien : il garde la main (Partager, Arrêter).
  await entrer(sid, lien, 'Sid')
  await expect(sid.getByText('You shared this document')).toBeVisible()
  await expect(editeur(sid)).toContainText('INT. KITCHEN - NIGHT')

  // L'invitée : aucun compte, aucun vault, le document s'ouvre.
  await entrer(lea, lien, 'Lea')
  await expect(editeur(lea)).toContainText('INT. KITCHEN - NIGHT')
  expect(lea.url()).not.toContain('#') // la clé ne reste pas dans la barre d'adresse
  await expect(lea.getByTestId('collab-personnes')).toContainText('Sid')
  await expect(sid.getByTestId('collab-personnes')).toContainText('Lea')

  // Les deux écrivent en même temps.
  await Promise.all([taperALaFin(sid, '\nSid writes here.'), taperALaFin(lea, '\nLea answers.')])
  for (const page of [sid, lea]) {
    await expect(editeur(page)).toContainText('Sid writes here.')
    await expect(editeur(page)).toContainText('Lea answers.')
  }
  expect(await texteDe(sid)).toBe(await texteDe(lea))
  // Curseur distant avec le prénom.
  await expect(sid.locator('.cm-ySelectionCaret').first()).toBeAttached()
  await expect(sid.locator('.cm-ySelectionInfo', { hasText: 'Lea' })).toBeAttached()

  // Le relais ne garde que du chiffré : ni le texte ni les prénoms dans sa base ou son journal.
  const base = fs.readFileSync(path.join(DONNEES, 'test.db')).toString('latin1')
  const journal = fs.readFileSync(path.join(DONNEES, 'serveur.log'), 'utf8')
  for (const mot of ['KITCHEN', 'Lighthouse', 'Lea answers', 'Sid writes']) {
    expect(base.includes(mot), `base : ${mot}`).toBe(false)
    expect(journal.includes(mot), `journal : ${mot}`).toBe(false)
  }

  // Coupure réseau chez Lea : chacun écrit, puis tout se rejoint.
  await ctxLea.setOffline(true)
  await lea.evaluate(() => window.dispatchEvent(new Event('offline')))
  await expect(lea.getByTestId('collab-statut')).toHaveAttribute('data-statut', 'hors-ligne', { timeout: 40_000 })
  await taperALaFin(lea, '\nWritten on the train.')
  await taperALaFin(sid, '\nMeanwhile at home.')
  await lea.waitForTimeout(300)
  await expect(editeur(sid)).not.toContainText('Written on the train.')
  await ctxLea.setOffline(false)
  await expect(lea.getByTestId('collab-statut')).toHaveAttribute('data-statut', 'en-ligne', { timeout: 40_000 })
  for (const page of [sid, lea]) {
    await expect(editeur(page)).toContainText('Written on the train.')
    await expect(editeur(page)).toContainText('Meanwhile at home.')
  }
  expect(await texteDe(sid)).toBe(await texteDe(lea))

  // Rechargée sans le fragment : la copie et la clé sont dans ce navigateur.
  await lea.reload()
  await expect(lea.getByTestId('collab-statut')).toHaveAttribute('data-statut', 'en-ligne')
  await expect(editeur(lea)).toContainText('Written on the train.')

  // Télécharger en .md.
  const [telechargement] = await Promise.all([lea.waitForEvent('download'), lea.getByTestId('collab-telecharger').click()])
  expect(telechargement.suggestedFilename()).toBe('The Lighthouse.md')
  const contenu = fs.readFileSync(await telechargement.path(), 'utf8')
  expect(contenu).toContain('INT. KITCHEN - NIGHT')
  expect(contenu).toContain('Written on the train.')

  // Arrêter le partage : Lea est coupée, garde sa copie, le lien ne marche plus.
  await sid.getByRole('button', { name: 'Share' }).click()
  await expect(sid.getByTestId('collab-lien')).toHaveValue(lien)
  sid.once('dialog', (d) => d.accept())
  await sid.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(sid.getByTestId('collab-bandeau')).toContainText('Sharing stopped')
  await expect(lea.getByTestId('collab-bandeau')).toContainText('The owner stopped sharing')
  await expect(editeur(lea)).toContainText('Written on the train.')
  await expect(editeur(lea)).toHaveAttribute('contenteditable', 'false')

  const tom = await (await browser.newContext()).newPage()
  await tom.goto(lien)
  await tom.getByTestId('collab-nom').fill('Tom')
  await tom.getByRole('button', { name: 'Continue' }).click()
  await expect(tom.getByTestId('collab-bandeau')).toContainText('The owner stopped sharing')
  await expect(editeur(tom)).toHaveText('')

  await ctxSid.close()
  await ctxLea.close()
})

test('un lien abîmé est refusé sans rien charger', async ({ page }) => {
  await page.goto('/d/0123456789abcdef0123456789abcdef#pas-une-cle')
  await expect(page.getByText('This link is incomplete or damaged')).toBeVisible()
})

test("Partager depuis l'app web : lien, QR, ouverture par l'invité, arrêt", async ({ browser }) => {
  const app = await (await browser.newContext()).newPage()
  await app.goto('/')
  await app.locator('.onboarding-primary').first().click()
  await app.getByRole('button', { name: 'Not now' }).click()
  await app.locator('.file-tree-item').first().click()
  await app.getByTestId('collab-partager').click()
  await app.getByTestId('collab-creer').click()
  const lien = await app.getByTestId('collab-lien').inputValue()
  expect(lien).toMatch(/\/d\/[0-9a-f]{32}#[A-Za-z0-9_-]{43}$/)
  await expect(app.getByRole('img', { name: 'Link to this shared document' })).toBeVisible()

  const invite = await (await browser.newContext()).newPage()
  await entrer(invite, lien, 'Lea')
  await expect(editeur(invite)).toContainText('Welcome to Lector')

  app.once('dialog', (d) => d.accept())
  await app.getByRole('button', { name: 'Stop sharing' }).click()
  await expect(app.getByRole('status')).toContainText('Sharing stopped')
  await expect(invite.getByTestId('collab-bandeau')).toContainText('The owner stopped sharing')
  // Partager à nouveau : nouvelle clé, nouveau lien.
  await app.getByTestId('collab-creer').click()
  expect(await app.getByTestId('collab-lien').inputValue()).not.toBe(lien)
})
