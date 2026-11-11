// Retour haptique d'une action qui compte (cocher une tâche, en ajouter une).
// Android : performHapticFeedback sur la vue, qui suit le réglage « Retour
// haptique » du système et ne demande aucune permission. Ailleurs : rien.

// @capacitor/core n'est importé qu'en natif : le navigateur ne le télécharge pas.
// Le plugin reste dans une variable : une promesse résolue avec un plugin
// Capacitor (un Proxy) le prendrait pour un « thenable » et ne se résoudrait jamais.
let plugin = null
let chargement = null

/** type : 'confirm' (cocher, ajouter) ou 'tick' (décocher). */
export function haptique(type = 'confirm') {
  try {
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'android') {
      if (!chargement) chargement = import('@capacitor/core').then(({ registerPlugin }) => { plugin = registerPlugin('Haptique') })
      chargement.then(() => plugin.jouer({ type })).catch(() => {})
    }
  } catch { /* pas de retour haptique ici */ }
}
