// Note du vault partagée, ouverte dans l'application (docs/collab-design.md § 9).
//
// L'éditeur de l'app se branche sur le salon : on écrit à plusieurs dans la
// note elle-même, avec les curseurs des autres. Le texte du salon est écrit
// dans le fichier (chemin d'enregistrement habituel) ; un fichier changé
// ailleurs (autre appareil de la chaîne) devient une modification du salon.
//
// Chargé seulement quand la note ouverte est partagée : Yjs et la liaison
// CodeMirror ne pèsent rien sur les autres notes.

import * as Y from 'yjs'
import { keymap } from '@codemirror/view'
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next'
import { ouvrirSession, stockage } from './partage.js'
import { appliquerTexte } from './salon.js'

/** Les personnes présentes, moi exclu : [{ client, nom, couleur }]. */
function autresPersonnes(presence, moi) {
  const liste = []
  for (const [client, etat] of presence.getStates()) {
    if (client === moi || !etat?.user?.name) continue
    liste.push({ client, nom: etat.user.name, couleur: etat.user.color })
  }
  return liste.sort((a, b) => a.nom.localeCompare(b.nom))
}

/**
 * Relie l'éditeur au salon `enregistrement`. Renvoie les extensions CodeMirror,
 * le texte partagé et de quoi suivre les présents. `fermer()` à la fin.
 */
export async function relier(enregistrement, { onStatut, onPersonnes } = {}) {
  const profil = stockage.lireProfil() || stockage.ecrireProfil('Owner')
  const session = await ouvrirSession(enregistrement, { profil, onStatut })
  const annuler = new Y.UndoManager(session.texte)
  const majPersonnes = () => onPersonnes?.(autresPersonnes(session.presence, session.doc.clientID))
  session.presence.on('change', majPersonnes)
  majPersonnes()
  return {
    texte: () => session.texte.toString(),
    extensions: [keymap.of(yUndoManagerKeymap), yCollab(session.texte, session.presence, { undoManager: annuler })],
    appliquerFichier: (texte) => appliquerTexte(session.texte, texte),
    async fermer() {
      session.presence.off('change', majPersonnes)
      session.client.sauverMaintenant()
      await session.fermer()
    },
  }
}
