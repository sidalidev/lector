// Fonctions de l'éditeur offertes au reste de l'application (services/editeurCourant.js) :
// aller à une ligne, ligne en haut de l'écran, recherche dans la note.

import { Decoration, EditorView } from '@codemirror/view'
import { StateEffect, StateField } from '@codemirror/state'

// --- Surlignages : résultats de recherche et ligne signalée ---
const effetRecherche = StateEffect.define()
const effetSignal = StateEffect.define()

const RESULTAT = Decoration.mark({ class: 'cm-recherche' })
const COURANT = Decoration.mark({ class: 'cm-recherche cm-recherche-courante' })
const SIGNAL = Decoration.line({ class: 'cm-ligne-signalee' })

const champSurlignage = StateField.define({
  create: () => ({ resultats: [], courant: -1, signal: null }),
  update(v, tr) {
    let { resultats, courant, signal } = v
    if (tr.docChanged) {
      resultats = resultats.map((r) => ({ from: tr.changes.mapPos(r.from), to: tr.changes.mapPos(r.to) }))
      if (signal != null) signal = tr.changes.mapPos(signal)
    }
    for (const e of tr.effects) {
      if (e.is(effetRecherche)) ({ resultats, courant } = e.value)
      if (e.is(effetSignal)) signal = e.value
    }
    return resultats === v.resultats && courant === v.courant && signal === v.signal ? v : { resultats, courant, signal }
  },
  provide: (f) => EditorView.decorations.from(f, (v) => {
    const deco = v.resultats.filter((r) => r.to > r.from).map((r, i) => (i === v.courant ? COURANT : RESULTAT).range(r.from, r.to))
    if (v.signal != null) deco.push(SIGNAL.range(v.signal))
    return Decoration.set(deco, true)
  }),
})

export const surlignages = () => champSurlignage

// Recherche insensible aux accents : « eleve » trouve « élève ».
const sansAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '')

/** Positions [début, fin] dans `texte` de chaque correspondance de `regex` (sur le texte sans accents). */
export function correspondances(texte, regex) {
  // Table : index dans le texte sans accents → index dans le texte d'origine.
  const vers = []
  let sans = ''
  for (let i = 0; i < texte.length; i++) {
    const s = sansAccents(texte[i])
    for (let k = 0; k < s.length; k++) vers.push(i)
    sans += s
  }
  vers.push(texte.length)
  const res = []
  regex.lastIndex = 0
  let m
  while ((m = regex.exec(sans)) !== null) {
    if (!m[0].length) { regex.lastIndex++; continue }
    res.push({ from: vers[m.index], to: vers[m.index + m[0].length - 1] + 1 })
  }
  return res
}

export function creerApi(view) {
  let minuteurSignal = null
  const signaler = (pos) => {
    clearTimeout(minuteurSignal)
    view.dispatch({ effects: effetSignal.of(pos) })
    minuteurSignal = setTimeout(() => { if (view.dom.isConnected) view.dispatch({ effects: effetSignal.of(null) }) }, 1800)
  }

  return {
    allerALigne(n, { signal = true, haut = false } = {}) {
      const doc = view.state.doc
      if (!n || n < 1) return false
      const ligne = doc.line(Math.min(n, doc.lines))
      view.dispatch({ effects: EditorView.scrollIntoView(ligne.from, { y: haut ? 'start' : 'center', yMargin: 24 }) })
      if (signal) signaler(ligne.from)
      return true
    },

    ligneEnHaut() {
      const scroller = view.scrollDOM.closest('.document-view') || view.scrollDOM
      const haut = scroller.getBoundingClientRect().top - view.documentTop + 80
      const bloc = view.lineBlockAtHeight(Math.max(0, haut))
      return view.state.doc.lineAt(bloc.from).number
    },

    allerAPosition(pos) {
      const p = Math.max(0, Math.min(pos, view.state.doc.length))
      view.dispatch({ effects: EditorView.scrollIntoView(p, { y: 'center' }) })
    },

    // Remplace le texte par une seule modification minimale (annulable, et
    // transmise aux co-auteurs comme une frappe dans une note partagée).
    remplacerTexte(texte) {
      const ancien = view.state.doc.toString()
      if (ancien === texte) return
      let debut = 0
      const max = Math.min(ancien.length, texte.length)
      while (debut < max && ancien.charCodeAt(debut) === texte.charCodeAt(debut)) debut++
      let fin = 0
      while (fin < max - debut && ancien.charCodeAt(ancien.length - 1 - fin) === texte.charCodeAt(texte.length - 1 - fin)) fin++
      view.dispatch({ changes: { from: debut, to: ancien.length - fin, insert: texte.slice(debut, texte.length - fin) } })
    },

    ecrireALaFin() {
      const fin = view.state.doc.length
      view.focus()
      view.dispatch({ selection: { anchor: fin }, scrollIntoView: true })
    },

    chercher(regex) {
      const resultats = regex ? correspondances(view.state.doc.toString(), regex) : []
      view.dispatch({ effects: effetRecherche.of({ resultats, courant: resultats.length ? 0 : -1 }) })
      return resultats.length
    },

    montrerResultat(i) {
      const { resultats } = view.state.field(champSurlignage)
      const r = resultats[i]
      if (!r) return
      view.dispatch({
        effects: [effetRecherche.of({ resultats, courant: i }), EditorView.scrollIntoView(r.from, { y: 'center' })],
      })
    },

    effacerRecherche() {
      if (!view.dom.isConnected) return
      view.dispatch({ effects: effetRecherche.of({ resultats: [], courant: -1 }) })
    },
  }
}
