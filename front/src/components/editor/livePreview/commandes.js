// Commandes d'écriture du mode mis en forme : case à cocher, gras, italique.
// Pures (EditorState → spec de transaction) : testées sous Node.

import { EditorSelection } from '@codemirror/state'
import { basculerTache, jourLocal } from '../../../services/taches/taches.js'

/** Remplacement d'un caractère (la case) puis un seul bloc inséré ou retiré (la date). */
function differences(avant, apres, decalage) {
  let debut = 0
  while (debut < avant.length && debut < apres.length && avant[debut] === apres[debut]) debut++
  if (debut === avant.length && debut === apres.length) return []
  const changes = []
  if (debut < avant.length && debut < apres.length) {
    changes.push({ from: decalage + debut, to: decalage + debut + 1, insert: apres[debut] })
    avant = avant.slice(debut + 1)
    apres = apres.slice(debut + 1)
    decalage += debut + 1
    debut = 0
    while (debut < avant.length && debut < apres.length && avant[debut] === apres[debut]) debut++
  }
  let fin = 0
  while (
    fin < avant.length - debut && fin < apres.length - debut
    && avant[avant.length - 1 - fin] === apres[apres.length - 1 - fin]
  ) fin++
  if (avant.length - fin > debut || apres.length - fin > debut) {
    changes.push({ from: decalage + debut, to: decalage + avant.length - fin, insert: apres.slice(debut, apres.length - fin) })
  }
  return changes
}

/**
 * Coche ou décoche la tâche de la ligne qui contient `pos`, avec la logique des
 * tâches Lector : cocher ajoute « ✅ AAAA-MM-JJ », décocher le retire.
 * Renvoie une spec de transaction minimale (seuls les caractères qui changent),
 * ou null si la ligne n'est pas une tâche. `aujourdhui` : pour les tests.
 */
export function basculerCase(state, pos, aujourdhui = jourLocal(new Date())) {
  const ligne = state.doc.lineAt(pos)
  const r = basculerTache(ligne.text, 1, aujourdhui)
  if (!r) return null
  // Plus petite différence : la co-écriture (Yjs) ne voit passer que « x » et la date.
  return { changes: differences(ligne.text, r.contenu, ligne.from), userEvent: 'input.toggle' }
}

/**
 * Entoure chaque sélection de `marque` (« ** », « _ »), ou la retire si elle y
 * est déjà (autour ou dedans). Curseur seul : insère la paire et se place au milieu.
 */
export function entourer(state, marque) {
  const n = marque.length
  return state.update(state.changeByRange((r) => {
    const texte = state.sliceDoc(r.from, r.to)
    const avant = state.sliceDoc(r.from - n, r.from)
    const apres = state.sliceDoc(r.to, r.to + n)
    if (avant === marque && apres === marque) {
      return {
        changes: [{ from: r.from - n, to: r.from }, { from: r.to, to: r.to + n }],
        range: EditorSelection.range(r.from - n, r.to - n),
      }
    }
    if (!r.empty && texte.length >= 2 * n && texte.startsWith(marque) && texte.endsWith(marque)) {
      return {
        changes: { from: r.from, to: r.to, insert: texte.slice(n, -n) },
        range: EditorSelection.range(r.from, r.to - 2 * n),
      }
    }
    return {
      changes: [{ from: r.from, insert: marque }, { from: r.to, insert: marque }],
      range: EditorSelection.range(r.from + n, r.to + n),
    }
  }), { userEvent: 'input.format', scrollIntoView: true })
}
