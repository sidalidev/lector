// Clés API personnelles : Anthropic (questions, fiches) et ElevenLabs (voix).
//
// Electron : la clé est chiffrée par safeStorage dans le processus principal,
// qui fait lui-même les appels ; elle ne revient jamais au renderer (getKey y
// renvoie toujours null, utiliser hasKey ou keyStatus).
// Web et mobile : IndexedDB « lector-keys », chaque clé chiffrée en AES-GCM par
// une CryptoKey non exportable rangée dans la même base. Un script qui tournerait
// sur la page pourrait s'en servir, pas l'emporter : l'écran le dit.
// Jamais de localStorage, jamais de journal.

import { listerModeles } from './fournisseurs/anthropic.js'
import { verifierCle } from './fournisseurs/elevenlabs.js'

export const SERVICES = ['anthropic', 'elevenlabs']

/** Événement window émis après chaque changement (detail.service). */
export const EVENEMENT_CLES = 'lector-keys-changed'

const BASE = 'lector-keys'
const MAGASIN = 'cles'
const CLE_MAITRESSE = 'kek'

const pont = () => (typeof window !== 'undefined' ? window.electron?.keys || null : null)

function verifierService(service) {
  if (!SERVICES.includes(service)) throw new Error(`Unknown service: ${service}`)
}

// --- IndexedDB ---

function ouvrir() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(MAGASIN)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function transaction(mode, fn) {
  const db = await ouvrir()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(MAGASIN, mode)
      const req = fn(tx.objectStore(MAGASIN))
      tx.oncomplete = () => resolve(req?.result)
      tx.onerror = () => reject(tx.error)
      tx.onabort = () => reject(tx.error)
    })
  } finally {
    db.close()
  }
}

let maitresse = null

/** Clé AES-GCM non exportable, tirée au premier usage et gardée dans la même base. */
function cleMaitresse() {
  if (!maitresse) {
    maitresse = (async () => {
      const existante = await transaction('readonly', (s) => s.get(CLE_MAITRESSE))
      if (existante) return existante
      const neuve = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
      await transaction('readwrite', (s) => s.put(neuve, CLE_MAITRESSE))
      return neuve
    })()
    maitresse.catch(() => { maitresse = null })
  }
  return maitresse
}

async function lireWeb(service) {
  const entree = await transaction('readonly', (s) => s.get(service))
  if (!entree) return null
  try {
    const clair = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: entree.iv }, await cleMaitresse(), entree.chiffre)
    return new TextDecoder().decode(clair)
  } catch {
    return null
  }
}

async function ecrireWeb(service, valeur) {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const chiffre = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await cleMaitresse(), new TextEncoder().encode(valeur))
  await transaction('readwrite', (s) => s.put({ iv, chiffre }, service))
}

function annoncer(service) {
  try { window.dispatchEvent(new CustomEvent(EVENEMENT_CLES, { detail: { service } })) } catch { /* hors navigateur */ }
}

const indice = (valeur) => (valeur ? valeur.slice(-4) : null)

// --- API ---

/** La clé en clair, pour un appel direct (web et mobile). Toujours null sur Electron. */
export async function getKey(service) {
  verifierService(service)
  if (pont()) return null
  return lireWeb(service)
}

/** Enregistre la clé (une valeur vide l'efface). */
export async function setKey(service, value) {
  verifierService(service)
  const valeur = String(value ?? '').trim()
  if (!valeur) return clearKey(service)
  if (pont()) {
    const r = await pont().set(service, valeur)
    if (!r?.ok) throw new Error(r?.error || 'Key not saved')
  } else {
    await ecrireWeb(service, valeur)
  }
  annoncer(service)
}

export async function clearKey(service) {
  verifierService(service)
  if (pont()) await pont().clear(service)
  else await transaction('readwrite', (s) => s.delete(service))
  annoncer(service)
}

/**
 * { present, hint } : hint = les 4 derniers caractères, pour que l'écran
 * reconnaisse la clé sans l'afficher. secure = chiffrée par le système (Electron).
 */
export async function keyStatus(service) {
  verifierService(service)
  if (pont()) {
    const r = await pont().get(service)
    return { present: !!r?.present, hint: r?.hint || null, secure: r?.secure !== false }
  }
  const valeur = await lireWeb(service)
  return { present: !!valeur, hint: indice(valeur), secure: true }
}

export async function hasKey(service) {
  return (await keyStatus(service)).present
}

/**
 * Vérifie la clé enregistrée auprès du service : { ok: true } ou
 * { ok: false, code } (NO_API_KEY, API_KEY_INVALID, NETWORK...).
 */
export async function testKey(service) {
  verifierService(service)
  if (pont()) return pont().test(service)
  try {
    const cle = await lireWeb(service)
    if (service === 'anthropic') await listerModeles({ fetch: (...a) => fetch(...a), cle })
    else await verifierCle({ fetch: (...a) => fetch(...a), cle })
    return { ok: true }
  } catch (err) {
    return { ok: false, code: err?.code || 'API_ERROR' }
  }
}

/** S'abonne aux changements de clés ; renvoie la fonction de désabonnement. */
export function onKeysChanged(callback) {
  const handler = (e) => callback(e.detail?.service)
  window.addEventListener(EVENEMENT_CLES, handler)
  return () => window.removeEventListener(EVENEMENT_CLES, handler)
}
