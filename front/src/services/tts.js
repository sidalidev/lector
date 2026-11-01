// Lecture à voix haute par ElevenLabs, avec la clé personnelle de l'utilisateur.
// Web et mobile : appel direct depuis la page. Electron : par le processus
// principal, qui garde la clé. Sans clé, les appels lèvent une erreur de code
// NO_API_KEY (l'interface propose l'écran des clés API).
import { hashString } from './constants'
import { getKey } from './apiKeys'
import { listerVoix, synthetiser } from './fournisseurs/elevenlabs.js'
import { ErreurFournisseur } from './fournisseurs/erreur.js'

// Cache mémoire LRU pour éviter les re-synthèses (max 50 entrées)
const MAX_CACHE = 50
const audioCache = new Map()

const pont = () => (typeof window !== 'undefined' ? window.electron?.tts || null : null)
const fetchPage = (...a) => fetch(...a)

/** Réponse { ok, ... } du processus principal vers une valeur ou une ErreurFournisseur. */
function deballer(r, champ) {
  if (r?.ok) return r[champ]
  throw new ErreurFournisseur(r?.code || 'API_ERROR', r?.error)
}

const ttsService = {
  async fetchVoices() {
    if (pont()) return deballer(await pont().voices(), 'voices')
    return listerVoix({ fetch: fetchPage, cle: await getKey('elevenlabs') })
  },

  async synthesize(text, voiceId) {
    const cacheKey = `${voiceId}-${hashString(text)}`
    if (audioCache.has(cacheKey)) return audioCache.get(cacheKey)

    const octets = pont()
      ? deballer(await pont().synthesize(text, voiceId), 'audio')
      : await synthetiser({ fetch: fetchPage, cle: await getKey('elevenlabs'), texte: text, voix: voiceId })
    const blob = new Blob([octets], { type: 'audio/mpeg' })
    // Éviction LRU si cache plein
    if (audioCache.size >= MAX_CACHE) {
      const oldest = audioCache.keys().next().value
      audioCache.delete(oldest)
    }
    audioCache.set(cacheKey, blob)
    return blob
  },

  clearCache() {
    audioCache.clear()
  },
}

export default ttsService
