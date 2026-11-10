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
import { construireDecorations, lignesActives, ADRESSE_OUVRABLE } from './decorations.js'
import { blocsRendus } from './blocs.js'
import { optionsApercu } from './options.js'
import { basculerCase, entourer } from './commandes.js'
import { syntaxeVisible, EVENEMENT_SYNTAXE } from './reglage.js'
import './livePreview.css'

export { syntaxeVisible, afficherSyntaxe, basculerSyntaxe } from './reglage.js'
export { optionsApercu } from './options.js'

const decorationsDe = (view) => construireDecorations(view.state, view.visibleRanges, {
  focus: view.hasFocus,
  resoudreImage: view.state.facet(optionsApercu).resoudreImage,
})

// Identifiant d'ancre d'un titre, comme GitHub : « Mon titre ! » → mon-titre
export const ancre = (texte) => texte.trim().toLowerCase()
  .replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s/g, '-')

/** Ouvre un lien : #titre dans la note, l'hôte d'abord, sinon le navigateur. */
function ouvrirLien(view, href) {
  if (href.startsWith('#')) {
    const cible = decodeURIComponent(href.slice(1)).toLowerCase()
    for (let n = 1; n <= view.state.doc.lines; n++) {
      const l = view.state.doc.line(n)
      const m = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(l.text)
      if (m && ancre(m[1].replace(/\*\*|__|`/g, '')) === cible) {
        view.dispatch({ effects: EditorView.scrollIntoView(l.from, { y: 'start', yMargin: 24 }) })
        return
      }
    }
    return
  }
  if (view.state.facet(optionsApercu).ouvrirLien?.(href)) return
  if (ADRESSE_OUVRABLE.test(href)) window.open(href, '_blank', 'noopener,noreferrer')
}

const apercu = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = decorationsDe(view)
  }

  update(u) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged
      || syntaxTree(u.startState) !== syntaxTree(u.state)) {
      this.decorations = decorationsDe(u.view)
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
      // Bloc rendu (tableau, diagramme) ou image : le clic y place le curseur,
      // le Markdown réapparaît pour l'éditer.
      const bloc = cible?.closest('.cm-lp-bloc, .cm-lp-image')
      if (bloc) {
        e.preventDefault()
        const pos = view.posAtDOM(bloc)
        view.focus()
        view.dispatch({ selection: { anchor: pos }, scrollIntoView: false })
        return true
      }
      // Lien mis en forme : le clic l'ouvre, comme dans Bear. Sur la ligne en
      // cours d'écriture (syntaxe visible), le clic place le curseur ; Cmd/Ctrl+clic ouvre toujours.
      const lien = e.button === 0 && cible?.closest('[data-lp-href]')
      if (lien) {
        const ligne = view.state.doc.lineAt(view.posAtDOM(lien)).number
        const enEcriture = lignesActives(view.state, view.hasFocus).has(ligne)
        if (!enEcriture || e.metaKey || e.ctrlKey) {
          e.preventDefault()
          ouvrirLien(view, lien.getAttribute('data-lp-href'))
          return true
        }
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
  blocsRendus(),
  // Chaque ligne prend le sens de son texte (arabe à droite, le reste à gauche).
  EditorView.perLineTextDirection.of(true),
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
