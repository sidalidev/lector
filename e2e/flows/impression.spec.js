import { test, expect } from '@playwright/test'

// Export d'un dossier en fenêtre d'impression : le texte des documents est
// échappé avant d'être mis en forme. Une balise écrite dans un document reste
// du texte ; un lien ne garde que http, https, mailto ou un chemin relatif.

const PIEGE = `# Titre <img src=x onerror="window.__pwn=1">

**gras** et [ok](https://exemple.test/page) et [relatif](notes/a.md)

[piège](javascript:window.__pwn=1) [espaces](  java\tscript:window.__pwn=1) [guillemet](x" onmouseover="window.__pwn=1)

![image](x" onerror="window.__pwn=1) ![donnée](data:image/png;base64,AAAA)

<script>window.__pwn=1</script>`

test('le markdown d\'un dossier exporté pour impression ne peut pas devenir du HTML actif', async ({ page }) => {
  await page.goto('/')
  const r = await page.evaluate(async (texte) => {
    const { markdownVersHtmlImpression, echapperHtml } = await import('/src/utils/impression.js')
    const div = document.createElement('div')
    div.innerHTML = markdownVersHtmlImpression(texte)
    const elements = [...div.querySelectorAll('*')]
    return {
      balises: [...new Set(elements.map((e) => e.tagName.toLowerCase()))].sort(),
      evenements: elements.flatMap((e) => [...e.attributes].map((a) => a.name)).filter((n) => n.startsWith('on')),
      liens: [...div.querySelectorAll('a')].map((a) => a.getAttribute('href')),
      images: [...div.querySelectorAll('img')].map((i) => i.getAttribute('src')),
      titre: div.querySelector('h1').textContent,
      echappe: echapperHtml('<b>"x"</b>'),
    }
  }, PIEGE)
  expect(r.balises).toEqual(['a', 'h1', 'img', 'p', 'strong'])
  expect(r.evenements).toEqual([])
  // Un guillemet reste dans la valeur de l'attribut, sans en sortir.
  expect(r.liens).toEqual(['https://exemple.test/page', 'notes/a.md', '#', '#', 'x" onmouseover="window.__pwn=1'])
  expect(r.images).toEqual(['x" onerror="window.__pwn=1', 'data:image/png;base64,AAAA'])
  expect(r.titre).toBe('Titre <img src=x onerror="window.__pwn=1">')
  expect(r.echappe).toBe('&lt;b&gt;&quot;x&quot;&lt;/b&gt;')
  expect(await page.evaluate(() => window.__pwn)).toBeUndefined()
})
