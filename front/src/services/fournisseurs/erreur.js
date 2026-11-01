// Erreurs des services externes (Anthropic, ElevenLabs), communes au navigateur et à Electron.

/** Erreur d'un service externe (texte ou voix), avec un code que l'interface traduit. */
export class ErreurFournisseur extends Error {
  constructor(code, message, status = null) {
    super(message || code)
    this.name = 'ErreurFournisseur'
    this.code = code
    this.status = status
  }
}

/** Code d'interface pour un statut HTTP d'API externe. */
export function codeHttp(status) {
  if (status === 401 || status === 403) return 'API_KEY_INVALID'
  if (status === 402) return 'BILLING'
  if (status === 404) return 'MODEL_UNKNOWN'
  if (status === 429) return 'RATE_LIMITED'
  if (status >= 500) return 'UNAVAILABLE'
  return 'API_ERROR'
}
