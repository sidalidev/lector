import { test, expect } from '@playwright/test'

// Un document markdown venu d'ailleurs ne doit jamais exécuter de script dans
// l'origine de Lector : HTML brut affiché en texte, CSP stricte.
// Les documents sont servis à la place du contenu de démo, ouvert comme
// n'importe quel document.

test.use({ locale: 'en-US' })

const PIEGE = `# Hostile

Normal paragraph.

<iframe srcdoc="<script>parent.__pwn=(parent.__pwn||0)+1</script>"></iframe>

<img src="x" onerror="window.__pwn=(window.__pwn||0)+1">

<a href="javascript:window.__pwn=(window.__pwn||0)+1">trap link</a>

[markdown trap](javascript:window.__pwn=(window.__pwn||0)+1)

<script>window.__pwn=(window.__pwn||0)+1</script>

<style>.cm-content{display:none}</style>

<object data="x.swf"></object><embed src="x.swf"><form action="https://evil.invalid/"><input name="q"></form>

<link rel="stylesheet" href="https://evil.invalid/x.css">

<base href="https://evil.invalid/">

<div id="voile" style="position:fixed;inset:0;z-index:9999;background:red">veil</div>

<span id="couleur" style="color: rgb(200, 0, 0)">red text</span>

<details><summary>More</summary>Hidden part</details>

Press <kbd>Ctrl</kbd> for H<sub>2</sub>O and <mark>marked</mark> text.

## Second section

[to the section](#second-section)

| a | b |
|---|---|
| 1 | 2 |

- [x] done task

Dollars stay plain text: $x^2$

\`\`\`javascript
const x = 1
\`\`\`
`

const DOCS = [
  { name: 'Hostile.md', content: PIEGE },
]

const MODULE = `const DOCS = ${JSON.stringify(DOCS)};
export function getDemoFiles() { return DOCS }
export function getDemoFile(locale, name) { return DOCS.find(f => f.name === name) || DOCS[0] }
`

async function ouvrirDemo(page) {
  await page.goto('/?demo')
  await expect(page.locator('.cm-lp-h1').first()).toContainText('Hostile')
}

test.beforeEach(async ({ page }) => {
  // Le module de démo (source en développement, morceau construit sinon).
  await page.route(/demoContent[^/]*\.js(\?.*)?$/, (route) =>
    route.fulfill({ contentType: 'application/javascript', body: MODULE }))
  await page.goto('/')
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await ouvrirDemo(page)
})

test.describe('Rendu sûr des documents', () => {
  test('le HTML brut d\'un document reste du texte et ne lance aucun script', async ({ page }) => {
    // L'éditeur n'interprète jamais le HTML d'une note : il l'affiche tel quel.
    // Fenêtre haute : CodeMirror ne dessine que les lignes visibles.
    await page.setViewportSize({ width: 1200, height: 4000 })
    const contenu = page.locator('.cm-content')
    await expect(contenu).toContainText('const x = 1')
    await expect(contenu).toContainText('<script>')
    await page.locator('[data-lp-href]', { hasText: 'to the section' }).click()
    await page.getByText('markdown trap').click({ modifiers: ['ControlOrMeta'] })
    await page.waitForTimeout(500)

    const etat = await page.evaluate(() => {
      const doc = document.querySelector('.cm-content')
      return {
        pwn: window.__pwn ?? 0,
        dangereux: doc.querySelectorAll('iframe, script, style, object, embed, form, base, link, img[onerror]').length,
        evenements: [...doc.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.name.startsWith('on'))).length,
        liensJs: [...doc.querySelectorAll('[data-lp-href]')].filter((a) => /javascript:/i.test(a.getAttribute('data-lp-href'))).length,
        feuilleExterne: document.querySelectorAll('link[href*="evil.invalid"]').length,
        baseExterne: document.querySelectorAll('base[href*="evil.invalid"]').length,
        voile: !!document.getElementById('voile'),
      }
    })
    expect(etat).toEqual({ pwn: 0, dangereux: 0, evenements: 0, liensJs: 0, feuilleExterne: 0, baseExterne: 0, voile: false })

    // Ce dont Lector a besoin reste là, mis en forme.
    await expect(page.locator('.katex')).toHaveCount(0)
    await expect(contenu).toContainText('Dollars stay plain text: $x^2$')
    await expect(contenu.locator('.cm-lp-tableau td').first()).toHaveText('1')
    await expect(contenu.locator('.cm-lp-case')).toHaveCount(1)
    await expect(contenu.locator('[role="heading"][aria-level="2"]')).toContainText('Second section')
    await expect(contenu.locator('[data-lp-href="#second-section"]')).toHaveCount(1)
  })

  test('une CSP stricte bloque tout script en ligne injecté', async ({ page }) => {
    const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).not.toContain("'unsafe-eval'")
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)

    const resultat = await page.evaluate(async () => {
      let violation = null
      document.addEventListener('securitypolicyviolation', (e) => { violation = e.violatedDirective }, { once: true })
      const s = document.createElement('script')
      s.textContent = 'window.__csp = 1'
      document.body.appendChild(s)
      await new Promise((r) => setTimeout(r, 100))
      return { execute: window.__csp ?? 0, violation }
    })
    expect(resultat.execute).toBe(0)
    expect(resultat.violation).toMatch(/^script-src/)
  })
})

test('aucune police ni aucun script ne vient d\'un tiers au lancement', async ({ page }) => {
  const tiers = []
  page.on('request', (req) => {
    const { hostname } = new URL(req.url())
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') tiers.push(req.url())
  })
  await page.reload()
  await ouvrirDemo(page)
  const polices = await page.evaluate(async () => {
    await document.fonts.ready
    return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, ''))
  })
  expect(polices).toEqual(expect.arrayContaining(['Figtree', 'Bricolage Grotesque']))
  expect(tiers).toEqual([])
})
