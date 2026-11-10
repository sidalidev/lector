// Présence dans un document partagé : où est le curseur de chacun, qui a écrit
// quoi. Utilisé par la page /d/ et par la note partagée de l'application.

import * as Y from 'yjs'

/** Position (index dans le texte) du curseur de `client`, ou null. */
export function positionDe(presence, doc, client) {
  const curseur = presence.getStates().get(client)?.cursor
  if (!curseur?.head) return null
  try {
    const abs = Y.createAbsolutePositionFromRelativePosition(Y.createRelativePositionFromJSON(curseur.head), doc)
    return abs ? abs.index : null
  } catch {
    return null
  }
}

/**
 * Suit le curseur de `client` : `aller(index)` à chaque mouvement. S'arrête
 * (et appelle `surFin`) dès que je fais défiler, tape ou touche l'écran, ou
 * quand la personne s'en va. Renvoie la fonction d'arrêt.
 */
export function suivre({ presence, doc, client, aller, surFin }) {
  let fini = false
  const arreter = () => {
    if (fini) return
    fini = true
    presence.off('change', maj)
    for (const e of EVENEMENTS) window.removeEventListener(e, arreter, true)
    surFin?.()
  }
  function maj() {
    if (!presence.getStates().has(client)) return arreter()
    const p = positionDe(presence, doc, client)
    if (p != null) aller(p)
  }
  presence.on('change', maj)
  const EVENEMENTS = ['wheel', 'keydown', 'touchstart']
  // Après ce clic : un clic sur le prénom ne doit pas arrêter le suivi qu'il lance.
  setTimeout(() => { if (!fini) for (const e of EVENEMENTS) window.addEventListener(e, arreter, true) }, 0)
  maj()
  return arreter
}

/**
 * Note qui a écrit : chaque mise à jour Yjs porte l'identifiant de ses
 * auteurs, traduit en prénom par la présence. `prendre()` rend les prénoms
 * depuis le dernier appel.
 */
export function suivreAuteurs(doc, presence, monNom) {
  const noms = new Map()
  const retenirNoms = () => {
    for (const [client, etat] of presence.getStates()) if (etat?.user?.name) noms.set(client, etat.user.name)
  }
  retenirNoms()
  presence.on('change', retenirNoms)
  let auteurs = new Set()
  const surMaj = (maj, origine, _doc, tr) => {
    if (tr?.local) { if (monNom) auteurs.add(monNom); return }
    try {
      for (const s of Y.decodeUpdate(maj).structs) {
        const nom = s.id.client === doc.clientID ? monNom : noms.get(s.id.client)
        if (nom) auteurs.add(nom)
      }
    } catch { /* mise à jour illisible : sans auteur */ }
  }
  doc.on('update', surMaj)
  return {
    prendre() { const a = [...auteurs]; auteurs = new Set(); return a },
    arreter() { doc.off('update', surMaj); presence.off('change', retenirNoms) },
  }
}
