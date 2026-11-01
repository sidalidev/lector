// Appels directs à l'API ElevenLabs (lecture à voix haute) avec la clé
// personnelle de l'utilisateur. Module ES pur, fetch et clé injectés, partagé
// entre le navigateur (tts.js) et le processus principal d'Electron.

import { ErreurFournisseur, codeHttp } from './erreur.js'

export const API_ELEVENLABS = 'https://api.elevenlabs.io'
const MODELE_VOIX = 'eleven_multilingual_v2'
const TEXTE_MAX = 5000

async function appeler(fetch, url, init) {
  let res
  try {
    res = await fetch(url, init)
  } catch (err) {
    throw new ErreurFournisseur('NETWORK', err?.message)
  }
  if (!res.ok) throw new ErreurFournisseur(codeHttp(res.status), `HTTP ${res.status}`, res.status)
  return res
}

function exigerCle(cle) {
  if (!cle) throw new ErreurFournisseur('NO_API_KEY', 'No ElevenLabs API key')
}

/** GET /v1/voices : [{ voice_id, name, category, labels }]. */
export async function listerVoix({ fetch, cle }) {
  exigerCle(cle)
  const res = await appeler(fetch, `${API_ELEVENLABS}/v1/voices`, { headers: { 'xi-api-key': cle } })
  const data = await res.json()
  return (data?.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, category: v.category, labels: v.labels }))
}

/** POST /v1/text-to-speech/:voix : audio MP3 en octets. */
export async function synthetiser({ fetch, cle, texte, voix }) {
  exigerCle(cle)
  if (!texte || !voix) throw new ErreurFournisseur('API_ERROR', 'Text and voice required')
  if (texte.length > TEXTE_MAX) throw new ErreurFournisseur('TEXT_TOO_LONG', `Text longer than ${TEXTE_MAX} characters`)
  const res = await appeler(fetch, `${API_ELEVENLABS}/v1/text-to-speech/${encodeURIComponent(voix)}`, {
    method: 'POST',
    headers: { 'xi-api-key': cle, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text: texte, model_id: MODELE_VOIX }),
  })
  return new Uint8Array(await res.arrayBuffer())
}

/** Vérifie une clé (GET /v1/user). */
export async function verifierCle({ fetch, cle }) {
  exigerCle(cle)
  await appeler(fetch, `${API_ELEVENLABS}/v1/user`, { headers: { 'xi-api-key': cle } })
}
