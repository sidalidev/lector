// Page « Détails techniques » du site (front/landing/sync/index.html), tirée
// de docs/CHAINE.md : c'est elle que l'app et le kit de secours ouvrent
// (Explication.jsx). HTML statique, polices du système, aucune ressource
// d'un autre site.
//
//   node tools/page-sync.mjs          réécrit la page après un changement de docs/CHAINE.md
//
// Le test textes-publics.test.mjs échoue tant que la page n'est pas à jour.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeSlug from 'rehype-slug'

const RACINE = join(dirname(fileURLToPath(import.meta.url)), '..')
export const SOURCE = join(RACINE, 'docs/CHAINE.md')
export const PAGE = join(RACINE, 'front/landing/sync/index.html')

/** La page complète pour le markdown de docs/CHAINE.md. */
export function pageSync(markdown) {
  const corps = renderToStaticMarkup(
    createElement(Markdown, { remarkPlugins: [remarkGfm], rehypePlugins: [rehypeSlug] }, markdown),
  )
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lector | How sync works</title>
  <meta name="description" content="Technical specification of Lector sync: end-to-end encryption, no account, what the server sees.">
  <style>
@font-face { font-family: 'Figtree'; src: url('/fonts/figtree.woff') format('woff'); font-weight: 300 900; font-display: swap; }
    @font-face { font-family: 'Bricolage Grotesque'; src: url('/fonts/bricolage-grotesque.woff') format('woff'); font-weight: 200 800; font-display: swap; }
    /* Charte « Miel du Champsaur » */
    :root {
      --cream: #FBF7EF;
      --paper: #F3EDE1;
      --ink: #1F2A22;
      --ink-light: #4A5A4F;
      --line: #E5DCCB;
      --caramel: #8A5A12;
      --miel: #E9A23B;
      --font-sans: 'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-serif: 'Bricolage Grotesque', 'Figtree', -apple-system, BlinkMacSystemFont, sans-serif;
      --font-mono: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: var(--font-sans); background: var(--cream); color: var(--ink); line-height: 1.7; padding: 2rem 1rem 4rem; }
    main { max-width: 760px; margin: 0 auto; }
    h1, h2, h3 { font-family: var(--font-serif); font-weight: 700; letter-spacing: -0.02em; line-height: 1.25; }
    h1 { font-size: 2.2rem; margin-bottom: 1rem; }
    h2 { font-size: 1.5rem; margin: 2.5rem 0 0.75rem; color: var(--caramel); }
    h3 { font-size: 1.2rem; margin: 1.75rem 0 0.5rem; }
    p, ul, ol, table, pre { margin-bottom: 1rem; }
    ul, ol { padding-left: 1.5rem; }
    li { margin-bottom: 0.3rem; }
    a { color: var(--caramel); }
    code { font-family: var(--font-mono); font-size: 0.85em; background: var(--paper); padding: 0.1em 0.3em; border-radius: 6px; overflow-wrap: anywhere; }
    pre { background: var(--paper); padding: 1rem; border-radius: 14px; overflow-x: auto; }
    pre code { background: none; padding: 0; overflow-wrap: normal; }
    table { display: block; overflow-x: auto; border-collapse: collapse; font-size: 0.9rem; }
    th, td { border: 1px solid var(--line); padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
    th { background: var(--paper); }
    .resume { font-size: 0.95rem; color: var(--ink-light); border-left: 4px solid var(--miel); padding-left: 1rem; margin-bottom: 2rem; }
    .retour { display: inline-block; margin-bottom: 1.5rem; text-decoration: none; font-size: 0.9rem; }
    @media (prefers-color-scheme: dark) {
      :root { color-scheme: dark; --cream: #12201A; --paper: #1C2E26; --ink: #F3EEE3; --ink-light: #9FB3A8; --line: #2B4237; --caramel: #F0B456; }
    }
  </style>
</head>
<body>
  <main>
    <a class="retour" href="/">&larr; Lector</a>
    <p class="resume" lang="en">How Lector sync works, in detail. In short: no account; twelve words generated on your device derive every key; each Markdown file and its path are encrypted on the device (AES-256-GCM) before they leave it; the server keeps only encrypted blocks and cannot read them. The full specification below is in French.</p>
${corps}
  </main>
</body>
</html>
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(dirname(PAGE), { recursive: true })
  writeFileSync(PAGE, pageSync(readFileSync(SOURCE, 'utf8')))
  console.log(`${PAGE} written from ${SOURCE}`)
}
