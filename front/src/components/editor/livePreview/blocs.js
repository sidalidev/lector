// Blocs rendus dans l'éditeur mis en forme : les tableaux.
//
// Un bloc s'affiche rendu tant que le curseur n'y est pas ; un clic dessus y
// place le curseur et rend le Markdown éditable. Les décorations de bloc
// doivent venir d'un StateField (pas d'un ViewPlugin) : CodeMirror en a besoin
// pour calculer les hauteurs avant le dessin.

import { Decoration, EditorView, WidgetType } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'

// --- Focus de l'éditeur, connu de l'état (sans focus : tout est rendu) ---
const effetFocus = StateEffect.define()
const champFocus = StateField.define({
  create: () => false,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(effetFocus)) v = e.value
    return v
  },
})
const suiviFocus = EditorView.focusChangeEffect.of((_state, focus) => effetFocus.of(focus))

// --- Repérage des blocs ---
/** Tableaux du document : [{ type, from, to, texte }]. */
export function trouverBlocs(state) {
  const arbre = ensureSyntaxTree(state, state.doc.length, 100) || syntaxTree(state)
  const doc = state.doc
  const blocs = []
  arbre.iterate({
    enter(n) {
      if (n.name === 'Table') {
        const from = doc.lineAt(n.from).from
        const to = doc.lineAt(n.to).to
        blocs.push({ type: 'table', from, to, texte: doc.sliceString(from, to) })
        return false
      }
      // Un bloc de code reste du code : pas de tableau à chercher dedans.
      if (n.name === 'FencedCode') return false
      return undefined
    },
  })
  return blocs
}

// --- Tableau GFM → HTML (texte échappé, mise en forme en ligne minimale) ---
const echapper = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function enLigne(s) {
  const codes = []
  let h = echapper(s).replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000` })
  h = h
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
    .replace(/(^|[^*\w])\*([^*]+)\*(?!\*)|(^|[^_\w])_([^_]+)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`)
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
  return h.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`)
}

function cellules(ligne) {
  let l = ligne.trim()
  if (l.startsWith('|')) l = l.slice(1)
  if (l.endsWith('|') && !l.endsWith('\\|')) l = l.slice(0, -1)
  const res = []
  let courant = ''
  for (let i = 0; i < l.length; i++) {
    if (l[i] === '\\' && l[i + 1] === '|') { courant += '|'; i++; continue }
    if (l[i] === '|') { res.push(courant.trim()); courant = ''; continue }
    courant += l[i]
  }
  res.push(courant.trim())
  return res
}

/** HTML d'un tableau GFM (en-tête, alignements, corps). */
export function tableauHtml(texte) {
  const lignes = texte.split('\n').filter((l) => l.trim())
  if (lignes.length < 2) return ''
  const entete = cellules(lignes[0])
  const aligns = cellules(lignes[1]).map((c) => {
    const g = c.startsWith(':'); const d = c.endsWith(':')
    return g && d ? 'center' : d ? 'right' : g ? 'left' : ''
  })
  const attr = (i) => (aligns[i] ? ` style="text-align:${aligns[i]}"` : '')
  const corps = lignes.slice(2).map((l) => {
    const c = cellules(l)
    return `<tr>${entete.map((_, i) => `<td${attr(i)}>${enLigne(c[i] ?? '')}</td>`).join('')}</tr>`
  }).join('')
  return `<table><thead><tr>${entete.map((c, i) => `<th${attr(i)}>${enLigne(c)}</th>`).join('')}</tr></thead><tbody>${corps}</tbody></table>`
}

class TableauWidget extends WidgetType {
  constructor(texte) { super(); this.texte = texte }
  eq(autre) { return autre.texte === this.texte }
  get estimatedHeight() { return 40 * Math.max(1, this.texte.split('\n').length - 1) }
  toDOM() {
    const el = document.createElement('div')
    el.className = 'cm-lp-bloc cm-lp-tableau'
    el.innerHTML = tableauHtml(this.texte)
    return el
  }
  ignoreEvent() { return false }
}

// --- Champ des décorations de bloc ---
function decorer(state, blocs) {
  const focus = state.field(champFocus)
  const deco = []
  for (const b of blocs) {
    const touche = focus && state.selection.ranges.some((r) => r.from <= b.to && r.to >= b.from)
    if (touche) continue
    deco.push(Decoration.replace({ widget: new TableauWidget(b.texte), block: true }).range(b.from, b.to))
  }
  return Decoration.set(deco)
}

const champBlocs = StateField.define({
  create(state) {
    const blocs = trouverBlocs(state)
    return { blocs, deco: decorer(state, blocs) }
  },
  update(v, tr) {
    const focusChange = tr.effects.some((e) => e.is(effetFocus))
    if (!tr.docChanged && !tr.selection && !focusChange) return v
    const blocs = tr.docChanged ? trouverBlocs(tr.state) : v.blocs
    return { blocs, deco: decorer(tr.state, blocs) }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
})

export const blocsRendus = () => [champFocus, suiviFocus, champBlocs]
