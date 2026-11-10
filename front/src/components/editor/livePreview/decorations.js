// Décorations du mode d'écriture mis en forme (façon Bear / Live Preview).
//
// Principe : le document n'est jamais modifié, seul l'affichage change. La
// syntaxe Markdown reste dans le DOM (lecteurs d'écran, copier-coller, Yjs) :
// elle est seulement repliée à zéro (classe `cm-lp-cache`) sur les lignes où
// n'est ni le curseur ni la sélection, et atténuée (`cm-lp-marque`) sur ces
// lignes-là pour pouvoir l'éditer.
//
// Tout passe par l'arbre syntaxique de @codemirror/lang-markdown, et seulement
// sur les plages visibles : aucune expression régulière sur le document entier.
//
// Module pur (pas de DOM) : testé par livePreview.test.mjs sous Node.

import { Decoration, WidgetType } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'

const CACHE = Decoration.mark({ class: 'cm-lp-cache' })
const MARQUE = Decoration.mark({ class: 'cm-lp-marque' })
const GRAS = Decoration.mark({ class: 'cm-lp-gras' })
const ITALIQUE = Decoration.mark({ class: 'cm-lp-italique' })
const BARRE = Decoration.mark({ class: 'cm-lp-barre' })
const CODE_EN_LIGNE = Decoration.mark({ class: 'cm-lp-code-en-ligne' })
const PUCE = Decoration.mark({ class: 'cm-lp-puce' })
const FAIT = Decoration.mark({ class: 'cm-lp-fait' })

const ligne = (classe) => Decoration.line({ class: classe })
// role="heading" : les lecteurs d'écran (et le sommaire du navigateur) y voient des titres.
const TITRES = [1, 2, 3, 4, 5, 6].map((n) => Decoration.line({
  class: `cm-lp-titre cm-lp-h${n}`,
  attributes: { role: 'heading', 'aria-level': String(n) },
}))
const CITATION = ligne('cm-lp-citation')
const SEPARATEUR = ligne('cm-lp-hr')
const CODE = ligne('cm-lp-bloc-code')
const CODE_DEBUT = ligne('cm-lp-bloc-code cm-lp-bloc-code-debut')
const CODE_FIN = ligne('cm-lp-bloc-code cm-lp-bloc-code-fin')
const CODE_SEUL = ligne('cm-lp-bloc-code cm-lp-bloc-code-debut cm-lp-bloc-code-fin')

const lien = (href) => Decoration.mark({
  class: 'cm-lp-lien',
  attributes: href && !ADRESSE_INTERDITE.test(href) ? { 'data-lp-href': href } : {},
})

// Seules ces adresses s'ouvrent dans le navigateur : pas de javascript:, data:…
export const ADRESSE_OUVRABLE = /^(https?:\/\/|mailto:)/i
// Jamais cliquables. Les autres (note voisine, #titre) sont confiées à l'hôte.
const ADRESSE_INTERDITE = /^\s*(javascript|data|vbscript|file):/i

/** Image d'une note. Une image locale est résolue par l'hôte (optionsApercu). */
export class ImageWidget extends WidgetType {
  constructor(src, alt, resoudre) {
    super()
    this.src = src
    this.alt = alt
    this.resoudre = resoudre
  }

  eq(autre) { return autre.src === this.src && autre.alt === this.alt }

  get estimatedHeight() { return 240 }

  toDOM(view) {
    const el = document.createElement('span')
    el.className = 'cm-lp-image'
    const img = document.createElement('img')
    img.alt = this.alt
    img.loading = 'lazy'
    img.decoding = 'async'
    img.onload = () => view.requestMeasure()
    const absente = () => {
      el.classList.add('cm-lp-image-absente')
      el.textContent = this.alt || this.src
    }
    img.onerror = absente
    const directe = /^(https?:|data:image\/|blob:)/i.test(this.src)
    const url = directe ? this.src : this.resoudre?.(this.src)
    if (url && typeof url.then === 'function') {
      url.then((u) => { if (u) img.src = u; else absente() }, absente)
    } else if (url) {
      img.src = url
    } else {
      absente()
      return el
    }
    el.appendChild(img)
    return el
  }

  ignoreEvent() { return false }
}

/** Case à cocher d'une tâche. `<span role="checkbox">` plutôt qu'un <input> : stylable partout. */
export class CaseWidget extends WidgetType {
  constructor(cochee) {
    super()
    this.cochee = cochee
  }

  eq(autre) { return autre.cochee === this.cochee }

  toDOM() {
    const el = document.createElement('span')
    el.className = 'cm-lp-case' + (this.cochee ? ' cm-lp-case-cochee' : '')
    el.setAttribute('role', 'checkbox')
    el.setAttribute('aria-checked', String(this.cochee))
    el.setAttribute('aria-label', this.cochee ? 'Done' : 'To do')
    return el
  }

  // false : le clic passe par le gestionnaire mousedown de l'extension (index.js).
  ignoreEvent() { return false }
}

/**
 * Lignes où la syntaxe doit rester visible : celles que touche une sélection
 * (curseur compris), et seulement si l'éditeur a le focus. Sans focus, tout le
 * document est affiché mis en forme, comme une page.
 */
export function lignesActives(state, focus) {
  const actives = new Set()
  if (!focus) return actives
  for (const r of state.selection.ranges) {
    const debut = state.doc.lineAt(r.from).number
    const fin = state.doc.lineAt(r.to).number
    for (let n = debut; n <= fin; n++) actives.add(n)
  }
  return actives
}

/**
 * Décorations des plages `plages` ([{ from, to }], en pratique
 * view.visibleRanges). Renvoie un DecorationSet.
 */
export function construireDecorations(state, plages, { focus = true, resoudreImage = null } = {}) {
  const doc = state.doc
  const actives = lignesActives(state, focus)
  const active = (pos) => actives.has(doc.lineAt(pos).number)
  const deco = []
  const vus = new Set()

  // Marque de syntaxe : repliée hors de la ligne active, atténuée dessus.
  const syntaxe = (from, to) => {
    if (to > from) deco.push((active(from) ? MARQUE : CACHE).range(from, to))
  }
  // Marque suivie de son espace (« # », « > ») : l'espace part avec elle.
  const syntaxeEtEspace = (from, to) => {
    const suivant = doc.sliceString(to, to + 1)
    syntaxe(from, suivant === ' ' || suivant === '\t' ? to + 1 : to)
  }
  // Une classe de ligne pour chaque ligne de [from, to] qui touche la plage visible.
  const lignes = (from, to, plage, choisir) => {
    const premiere = doc.lineAt(from)
    const derniere = doc.lineAt(to)
    const debut = doc.lineAt(Math.max(from, plage.from)).number
    const fin = doc.lineAt(Math.min(to, plage.to)).number
    for (let n = debut; n <= fin; n++) {
      const l = doc.line(n)
      deco.push(choisir(n, premiere.number, derniere.number).range(l.from))
    }
  }

  const arbre = syntaxTree(state)
  for (const plage of plages) {
    arbre.iterate({
      from: plage.from,
      to: plage.to,
      enter: (n) => {
        // Un nœud à cheval sur deux plages n'est traité qu'une fois.
        const cle = `${n.name}:${n.from}:${n.to}`
        if (vus.has(cle)) return
        vus.add(cle)

        switch (n.name) {
          case 'ATXHeading1': case 'ATXHeading2': case 'ATXHeading3':
          case 'ATXHeading4': case 'ATXHeading5': case 'ATXHeading6':
            deco.push(TITRES[Number(n.name.slice(-1)) - 1].range(doc.lineAt(n.from).from))
            break
          case 'SetextHeading1': case 'SetextHeading2': {
            // Le texte du titre seulement : la ligne de soulignement reste atténuée.
            const marque = n.node.getChild('HeaderMark')
            const fin = marque ? doc.lineAt(marque.from).number - 1 : doc.lineAt(n.to).number
            for (let k = doc.lineAt(n.from).number; k <= fin; k++) {
              deco.push(TITRES[n.name === 'SetextHeading1' ? 0 : 1].range(doc.line(k).from))
            }
            break
          }
          case 'HeaderMark':
            if (n.node.parent?.name.startsWith('Setext')) deco.push(MARQUE.range(n.from, n.to))
            else syntaxeEtEspace(n.from, n.to)
            break
          case 'StrongEmphasis': deco.push(GRAS.range(n.from, n.to)); break
          case 'Emphasis': deco.push(ITALIQUE.range(n.from, n.to)); break
          case 'Strikethrough': deco.push(BARRE.range(n.from, n.to)); break
          case 'EmphasisMark':
          case 'StrikethroughMark':
            syntaxe(n.from, n.to)
            break
          case 'InlineCode': deco.push(CODE_EN_LIGNE.range(n.from, n.to)); break
          case 'CodeMark':
            // Clôtures d'un bloc de code : toujours visibles, atténuées.
            if (n.node.parent?.name === 'InlineCode') syntaxe(n.from, n.to)
            else deco.push(MARQUE.range(n.from, n.to))
            break
          case 'CodeInfo': deco.push(MARQUE.range(n.from, n.to)); break
          case 'FencedCode': case 'CodeBlock':
            lignes(n.from, n.to, plage, (k, premiere, derniere) =>
              premiere === derniere ? CODE_SEUL : k === premiere ? CODE_DEBUT : k === derniere ? CODE_FIN : CODE)
            return false
          case 'Link': case 'Autolink': {
            const url = n.node.getChild('URL')
            const href = url ? doc.sliceString(url.from, url.to) : ''
            deco.push(lien(href).range(n.from, n.to))
            break
          }
          case 'Image': {
            if (active(n.from)) break
            const url = n.node.getChild('URL')
            const src = url ? doc.sliceString(url.from, url.to).replace(/^<|>$/g, '') : ''
            const texte = doc.sliceString(n.from, n.to)
            const alt = /^!\[([^\]]*)\]/.exec(texte)?.[1] ?? ''
            if (!src) break
            deco.push(Decoration.replace({ widget: new ImageWidget(src, alt, resoudreImage) }).range(n.from, n.to))
            return false
          }
          case 'LinkMark': case 'LinkTitle':
            // Les crochets d'une image restent visibles : seule la syntaxe des liens se replie.
            if (n.node.parent?.name !== 'Image') syntaxe(n.from, n.to)
            break
          case 'URL': {
            const parent = n.node.parent?.name
            if (parent === 'Link') syntaxe(n.from, n.to)
            else if (parent !== 'Autolink' && parent !== 'Image') {
              // Adresse nue (GFM) : lisible et cliquable telle quelle.
              deco.push(lien(doc.sliceString(n.from, n.to)).range(n.from, n.to))
            }
            break
          }
          case 'Blockquote':
            lignes(n.from, n.to, plage, () => CITATION)
            break
          case 'QuoteMark':
            syntaxeEtEspace(n.from, n.to)
            break
          case 'HorizontalRule':
            if (active(n.from)) deco.push(MARQUE.range(n.from, n.to))
            else {
              deco.push(SEPARATEUR.range(doc.lineAt(n.from).from))
              deco.push(CACHE.range(n.from, n.to))
            }
            break
          case 'ListMark': {
            const liste = n.node.parent?.parent?.name
            const tache = n.node.nextSibling?.name === 'Task'
            if (tache) syntaxeEtEspace(n.from, n.to)
            else if (liste === 'BulletList') deco.push((active(n.from) ? MARQUE : PUCE).range(n.from, n.to))
            else deco.push(MARQUE.range(n.from, n.to))
            break
          }
          case 'TaskMarker': {
            const cochee = /x/i.test(doc.sliceString(n.from, n.to))
            if (!active(n.from)) {
              deco.push(Decoration.widget({ widget: new CaseWidget(cochee), side: -1 }).range(n.from))
            }
            syntaxeEtEspace(n.from, n.to)
            if (cochee) {
              const tache = n.node.parent
              const debut = Math.min(doc.lineAt(n.from).to, n.to + 1)
              const fin = Math.min(tache.to, doc.lineAt(n.from).to)
              if (fin > debut) deco.push(FAIT.range(debut, fin))
            }
            break
          }
        }
      },
    })
  }
  return Decoration.set(deco, true)
}
