import { test, expect } from '@playwright/test'

// Un document markdown venu d'ailleurs ne doit jamais exécuter de script dans
// l'origine de Lector : HTML brut assaini, Mermaid en mode strict, CSP stricte.
// Les documents sont servis à la place du contenu de démo, ouvert comme
// n'importe quel document.

test.use({ locale: 'en-US' })

const PIEGE = `# Hostile

Normal paragraph.

<iframe srcdoc="<script>parent.__pwn=(parent.__pwn||0)+1</script>"></iframe>

<img src="x" onerror="window.__pwn=(window.__pwn||0)+1">

<a href="javascript:window.__pwn=(window.__pwn||0)+1">trap link</a>

<script>window.__pwn=(window.__pwn||0)+1</script>

<style>.document-content{display:none}</style>

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

When $a \\ne 0$, math still renders: $$x^2$$

\`\`\`javascript
const x = 1
\`\`\`
`

const MERMAID = `# Diagram

\`\`\`mermaid
flowchart TD
  A["Expand the diagram"] --> B[Next]
  click A href "javascript:window.__pwn=(window.__pwn||0)+1"
\`\`\`
`

const DOCS = [
  { name: 'Hostile.md', content: PIEGE },
  { name: 'Diagram.md', content: MERMAID },
]

const MODULE = `const DOCS = ${JSON.stringify(DOCS)};
export function getDemoFiles() { return DOCS }
export function getDemoFile(locale, name) { return DOCS.find(f => f.name === name) || DOCS[0] }
`

async function ouvrirDemo(page) {
  await page.locator('.source-card-demo').click()
  await expect(page.locator('h1').first()).toContainText('Hostile')
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
  test('le HTML brut d\'un document ne lance aucun script et garde ce que Lector affiche', async ({ page }) => {
    const contenu = page.locator('.document-content')
    await expect(contenu.locator('.katex').first()).toBeAttached({ timeout: 10000 })
    await page.getByText('trap link').evaluate((a) => a.click())
    await page.waitForTimeout(500)

    const etat = await page.evaluate(() => {
      const doc = document.querySelector('.document-content')
      const voile = document.getElementById('voile')
      return {
        pwn: window.__pwn ?? 0,
        dangereux: doc.querySelectorAll('iframe, script, style, object, embed, form, base, link').length,
        evenements: [...doc.querySelectorAll('*')].filter((el) => [...el.attributes].some((a) => a.name.startsWith('on'))).length,
        liensJs: [...doc.querySelectorAll('a')].filter((a) => /^\s*javascript:/i.test(a.getAttribute('href') || '')).length,
        feuilleExterne: document.querySelectorAll('link[href*="evil.invalid"]').length,
        baseExterne: document.querySelectorAll('base[href*="evil.invalid"]').length,
        voileFixe: voile ? getComputedStyle(voile).position === 'fixed' : false,
        couleur: getComputedStyle(document.getElementById('couleur')).color,
      }
    })
    expect(etat).toEqual({
      pwn: 0,
      dangereux: 0,
      evenements: 0,
      liensJs: 0,
      feuilleExterne: 0,
      baseExterne: 0,
      voileFixe: false,
      couleur: 'rgb(200, 0, 0)',
    })

    // Ce dont Lector a besoin reste là.
    await expect(contenu.locator('.katex').first()).toBeVisible()
    await expect(contenu.locator('details summary')).toHaveText('More')
    await expect(contenu.locator('kbd')).toHaveText('Ctrl')
    await expect(contenu.locator('sub')).toHaveText('2')
    await expect(contenu.locator('mark')).toHaveText('marked')
    await expect(contenu.locator('table td').first()).toHaveText('1')
    await expect(contenu.locator('li input[type="checkbox"][disabled]')).toHaveCount(1)
    await expect(contenu.locator('h2#second-section[data-header-id]')).toHaveCount(1)
    await expect(contenu.locator('[data-source-line]').first()).toBeAttached()
    await expect(contenu.locator('pre').filter({ hasText: 'const x = 1' })).toBeVisible()
    await expect(contenu.locator('a[href="#second-section"]')).toHaveCount(1)
  })

  test('un lien javascript: dans un diagramme Mermaid ne s\'exécute pas au clic', async ({ page }) => {
    await page.locator('.file-tree-item', { hasText: 'Diagram' }).click()
    const svg = page.locator('.document-content .mermaid-svg svg')
    await expect(svg).toBeVisible({ timeout: 15000 })
    await expect(svg).toContainText('Expand the diagram')

    const liens = await svg.evaluate((el) => [...el.querySelectorAll('a')]
      .map((a) => a.getAttribute('href') || a.getAttribute('xlink:href') || ''))
    expect(liens.filter((h) => /javascript:/i.test(h))).toEqual([])

    const url = page.url()
    await svg.locator('text=Expand the diagram').click()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => window.__pwn ?? 0)).toBe(0)
    expect(page.url()).toBe(url)
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
  expect(polices).toEqual(expect.arrayContaining(['Figtree', 'Bricolage Grotesque', 'Literata Variable']))
  expect(tiers).toEqual([])
})

// Sons de guitare : le lecteur est un fichier de l'app et les sons sont lus
// comme des données, deux choses que la CSP laisse passer (servis ici sans réseau).
test('la guitare se charge sous la CSP', async ({ page }) => {
  const echantillons = new Int16Array(64).map((_, i) => Math.round(8000 * Math.sin(i / 3)))
  const entete = Buffer.alloc(44)
  entete.write('RIFF', 0); entete.writeUInt32LE(36 + echantillons.byteLength, 4); entete.write('WAVE', 8)
  entete.write('fmt ', 12); entete.writeUInt32LE(16, 16); entete.writeUInt16LE(1, 20); entete.writeUInt16LE(1, 22)
  entete.writeUInt32LE(8000, 24); entete.writeUInt32LE(16000, 28); entete.writeUInt16LE(2, 32); entete.writeUInt16LE(16, 34)
  entete.write('data', 36); entete.writeUInt32LE(echantillons.byteLength, 40)
  const wav = Buffer.concat([entete, Buffer.from(echantillons.buffer)]).toString('base64')
  await page.route('https://surikov.github.io/**', (route) => {
    const nom = route.request().url().split('/').pop().replace('.js', '')
    route.fulfill({
      contentType: 'application/javascript',
      body: `console.log('load _tone_${nom}');\nvar _tone_${nom}={\n\tzones:[\n\t\t{\n\t\t\tmidi:24\n\t\t\t,originalPitch:4000\n\t\t\t,keyRangeLow:0\n\t\t\t,keyRangeHigh:127\n\t\t\t,loopStart:0\n\t\t\t,loopEnd:0\n\t\t\t,sampleRate:8000\n\t\t\t,ahdsr:true\n\t\t\t,file:'${wav}'\n\t\t\t//_tone.N_Gtr_\n\t\t}\n\t]\n};\n`,
    })
  })
  const pret = await page.evaluate(async () => {
    const guitare = await import('/src/services/guitarAudio.js')
    await guitare.initGuitarAudio(new AudioContext())
    return guitare.isGuitarAudioReady()
  })
  expect(pret).toBe(true)
})
