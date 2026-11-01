import { t } from '../services/i18n'

// Codes d'erreur (anglais, stables) vers des messages traduits : l'interface
// n'affiche jamais le texte brut d'un serveur ou d'un service.

const traduit = (cle) => {
  const v = t(cle)
  return v === cle ? null : v
}

/** Erreur de la chaîne de sync : { code, detail } ou code seul. */
export function messageChaine(r) {
  const code = typeof r === 'string' ? r : r?.code
  if (!code) return t('cloud.chain.err.UNKNOWN')
  if (code === 'UNKNOWN_WORD' && r?.detail) return t('cloud.chain.err.UNKNOWN_WORD_detail', { mot: r.detail })
  const precis = traduit(`cloud.chain.err.${code}`)
  if (precis) return precis
  const http = /^HTTP_(\d{3})$/.exec(code)
  if (http) return t('cloud.chain.err.HTTP', { status: http[1] })
  return t('cloud.chain.err.UNKNOWN_code', { code })
}

/** Erreur d'un service externe (Anthropic, ElevenLabs) : NO_API_KEY, API_KEY_INVALID... */
export function messageCle(code) {
  return traduit(`keys.err.${code}`) || t('keys.err.API_ERROR')
}

/** Vrai si l'erreur se règle dans l'écran des clés API. */
export const besoinDeCle = (code) => code === 'NO_API_KEY' || code === 'API_KEY_INVALID'
