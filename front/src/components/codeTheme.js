// Coloration du code aux couleurs de la charte, en clair et en sombre.
// On garde la structure du thème One Light de Prism et on remplace chaque
// couleur par un jeton CSS (index.css) : le thème suit le mode du système.
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism'

const parTeinte = [
  [230, 4, 'var(--code-comment)'],
  [230, 6, 'var(--code-comment)'],
  [230, 1, 'var(--code-comment)'],
  [230, 8, 'var(--code-text)'],
  [35, null, 'var(--code-number)'],
  [301, null, 'var(--code-keyword)'],
  [5, null, 'var(--code-tag)'],
  [119, null, 'var(--code-string)'],
  [221, null, 'var(--code-function)'],
  [198, null, 'var(--code-string)'],
  [344, null, 'var(--code-tag)'],
]

function jeton(couleur) {
  const m = /^hsla?\((\d+),\s*(\d+)%/.exec(couleur)
  if (!m) return 'var(--code-text)'
  const teinte = Number(m[1])
  const saturation = Number(m[2])
  const trouve = parTeinte.find(([t, s]) => t === teinte && (s === null || s === saturation))
  return trouve ? trouve[2] : 'var(--code-text)'
}

const codeTheme = {}
for (const [selecteur, regles] of Object.entries(oneLight)) {
  const copie = { ...regles }
  if (copie.color && copie.color !== 'inherit') copie.color = jeton(copie.color)
  if (copie.background && /^hsl/.test(copie.background)) {
    copie.background = selecteur.includes('selection') ? 'var(--highlight)' : 'transparent'
  }
  codeTheme[selecteur] = copie
}

export const lineNumberStyle = { color: 'var(--code-comment)' }

export default codeTheme
