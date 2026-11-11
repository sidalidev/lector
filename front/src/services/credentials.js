// Les 12 mots de la chaîne dans le gestionnaire de mots de passe (web et mobile).
//
// API Credential Management : PasswordCredential n'existe que dans les
// navigateurs Chromium et y déclenche le gestionnaire intégré. Les extensions
// (Proton Pass, Bitwarden) et Safari réagissent plutôt à un vrai formulaire
// soumis : l'écran de la chaîne en affiche un à côté de ce module. Sur Electron,
// S reste dans le processus principal et ce module ne sert pas.
//
// Les mots ne passent jamais par le presse-papiers.
//
// Android (Capacitor) : la WebView n'a pas l'API Credential Management, le
// plugin natif Credentials passe par le Credential Manager du système, qui
// transmet au gestionnaire choisi (Proton Pass, Bitwarden...).

// @capacitor/core n'est importé qu'en natif : le navigateur ne le télécharge pas.

/** Identifiant de l'entrée, le même partout (formulaire compris) pour que le gestionnaire la retrouve. */
export const ID_CHAINE = 'lector-sync-chain'
const NOM_CHAINE = 'Lector sync chain'

/** Renvoyé par recupererDepuisGestionnaire quand l'utilisateur a fermé la fenêtre : rien à afficher. */
export const ANNULE = 'annule'

let pluginNatif = null

/** Vrai dans l'app Android (Capacitor), où le plugin natif remplace navigator.credentials. */
export function estNatif() {
  return typeof window !== 'undefined'
    && window.Capacitor?.isNativePlatform?.() === true
    && window.Capacitor?.getPlatform?.() === 'android'
}

// Ne rend rien : une promesse résolue avec un plugin Capacitor (un Proxy) le
// prendrait pour un « thenable » et ne se résoudrait jamais.
async function chargerNatif() {
  if (!pluginNatif) {
    const { registerPlugin } = await import('@capacitor/core')
    pluginNatif = registerPlugin('Credentials')
  }
}

/** Vrai si le navigateur sait enregistrer un mot de passe par l'API (Chromium). */
export function estDisponible() {
  if (estNatif()) return true
  return typeof window !== 'undefined'
    && typeof window.PasswordCredential === 'function'
    && typeof navigator !== 'undefined'
    && !!navigator.credentials?.store
}

/**
 * Propose d'enregistrer les 12 mots. Renvoie true si le navigateur a pris la
 * demande, false si l'API manque ou a été refusée (l'interface montre alors le
 * formulaire et la fiche de secours).
 */
export async function enregistrerDansGestionnaire(mots) {
  if (!estDisponible()) return false
  const password = Array.isArray(mots) ? mots.join(' ') : String(mots || '')
  if (estNatif()) {
    try {
      await chargerNatif()
      const r = await pluginNatif.store({ password })
      return r?.saved === true
    } catch {
      return false
    }
  }
  try {
    await navigator.credentials.store(new window.PasswordCredential({ id: ID_CHAINE, name: NOM_CHAINE, password }))
    return true
  } catch {
    return false
  }
}

/**
 * Demande au gestionnaire les 12 mots enregistrés. Renvoie le texte, null si
 * rien n'est disponible, ou ANNULE si l'utilisateur a fermé la fenêtre (Android).
 */
export async function recupererDepuisGestionnaire() {
  if (estNatif()) {
    try {
      await chargerNatif()
      const r = await pluginNatif.get()
      if (r?.cancelled) return ANNULE
      return typeof r?.password === 'string' && r.password ? r.password : null
    } catch {
      return null
    }
  }
  if (typeof navigator === 'undefined' || !navigator.credentials?.get) return null
  try {
    const c = await navigator.credentials.get({ password: true, mediation: 'optional' })
    return c && typeof c.password === 'string' && c.password ? c.password : null
  } catch {
    return null
  }
}
