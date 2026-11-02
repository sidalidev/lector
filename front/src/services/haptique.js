// Retour haptique d'une action qui compte (cocher une tâche, en ajouter une).
// Android : performHapticFeedback sur la vue, qui suit le réglage « Retour
// haptique » du système et ne demande aucune permission. Ailleurs : rien.

import { registerPlugin } from '@capacitor/core'

let plugin = null

/** type : 'confirm' (cocher, ajouter) ou 'tick' (décocher). */
export function haptique(type = 'confirm') {
  try {
    if (window.Capacitor?.isNativePlatform?.() && window.Capacitor.getPlatform?.() === 'android') {
      if (!plugin) plugin = registerPlugin('Haptique')
      plugin.jouer({ type }).catch(() => {})
    }
  } catch { /* pas de retour haptique ici */ }
}
