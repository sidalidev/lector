// Mode d'écriture mis en forme (façon Bear) pour l'éditeur CodeMirror 6.
//
// Extension CodeMirror pure, sans React : MarkdownEditor (vault) et la page
// d'un document partagé l'utilisent telle quelle. Les décorations ne touchent
// jamais au document (co-écriture Yjs comprise) : seuls la case à cocher et
// Cmd+B / Cmd+I écrivent, comme une frappe ordinaire.
//
// Le choix « Show Markdown syntax » (mode source brut) est mémorisé dans
// localStorage et appliqué à chaud à tous les éditeurs ouverts.

import { EditorView, ViewPlugin, keymap } from '@codemirror/view'
import { Compartment, Prec } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'
import { construireDecorations } from './decorations.js'
import { basculerCase, entourer } from './commandes.js'
import { syntaxeVisible, EVENEMENT_SYNTAXE } from './reglage.js'
import './livePreview.css'

export { syntaxeVisible, afficherSyntaxe, basculerSyntaxe } from './reglage.js'

const apercu = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = construireDecorations(view.state, view.visibleRanges, { focus: view.hasFocus })
  }

  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
      || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = construireDecorations(u.state, u.view.visibleRanges, { focus: u.view.hasFocus })
    }
  }
}, {
  decorations: (p) => p.decorations,
  eventHandlers: {
    mousedown(e, view) {
      const cible = e.target instanceof Element ? e.target : null
      // Case à cocher : on écrit dans le texte sans déplacer le curseur.
      const caseTache = cible?.closest('.cm-lp-case')
      if (caseTache) {
        e.preventDefault()
        if (view.state.readOnly) return true
        const spec = basculerCase(view.state, view.posAtDOM(caseTache))
        if (spec) view.dispatch(spec)
        return true
      }
      // Lien : Cmd/Ctrl+clic ouvre, le clic simple place le curseur.
      const lien = (e.metaKey || e.ctrlKey) && cible?.closest('[data-lp-href]')
      if (lien) {
        e.preventDefault()
        window.open(lien.getAttribute('data-lp-href'), '_blank', 'noopener,noreferrer')
        return true
      }
      return false
    },
  },
})

// Raccourcis d'écriture, dans les deux modes. stopPropagation : Cmd+B ne doit
// pas aussi replier la barre latérale de l'application.
const raccourcis = Prec.high(keymap.of([
  { key: 'Mod-b', run: (v) => { if (v.state.readOnly) return false; v.dispatch(entourer(v.state, '**')); return true }, stopPropagation: true },
  { key: 'Mod-i', run: (v) => { if (v.state.readOnly) return false; v.dispatch(entourer(v.state, '_')); return true }, stopPropagation: true },
]))

/** Le mode mis en forme seul (sans bascule). */
export const livePreview = () => [
  apercu,
  EditorView.editorAttributes.of({ class: 'cm-lp' }),
  EditorView.contentAttributes.of({ 'data-mode': 'live-preview' }),
]

/**
 * Mode d'écriture de l'éditeur : mis en forme par défaut, `source` (numéros de
 * ligne, pliage…) quand l'utilisateur a choisi « Show Markdown syntax ».
 * Suit le réglage à chaud.
 */
export function modeEcriture({ source = [] } = {}) {
  const mode = new Compartment()
  const pour = (visible) => (visible ? source : livePreview())
  const suivre = ViewPlugin.fromClass(class {
    constructor(view) {
      this.ecouter = (e) => view.dispatch({ effects: mode.reconfigure(pour(e.detail)) })
      window.addEventListener(EVENEMENT_SYNTAXE, this.ecouter)
    }

    destroy() { window.removeEventListener(EVENEMENT_SYNTAXE, this.ecouter) }
  })
  return [mode.of(pour(syntaxeVisible())), suivre, raccourcis]
}
