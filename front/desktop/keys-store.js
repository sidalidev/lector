// Clés API personnelles (anthropic, elevenlabs) sur Electron, dans
// userData/api-keys.dat, chiffrées par safeStorage. Seul le processus principal
// les lit : il fait les appels lui-même et ne renvoie au renderer que leur
// présence et leurs 4 derniers caractères. Sans chiffrement système, le JSON est
// écrit en clair en mode 0600 et l'interface le signale.

const fs = require('fs')
const path = require('path')

const SERVICES = ['anthropic', 'elevenlabs']

let _filePath = null
let _safeStorage = null
let _logger = console.error

function init({ userDataPath, safeStorage, logger }) {
  _filePath = path.join(userDataPath, 'api-keys.dat')
  _safeStorage = safeStorage
  if (logger) _logger = logger
}

function chiffrementDisponible() {
  try { return !!_safeStorage && _safeStorage.isEncryptionAvailable() } catch { return false }
}

function verifierService(service) {
  if (!SERVICES.includes(service)) throw new Error(`Unknown service: ${service}`)
}

function lireTout() {
  if (!_filePath || !fs.existsSync(_filePath)) return {}
  try {
    const raw = fs.readFileSync(_filePath)
    const json = chiffrementDisponible() && raw.length > 0 && raw[0] !== 0x7B /* '{' */
      ? _safeStorage.decryptString(raw)
      : raw.toString('utf8')
    return JSON.parse(json) || {}
  } catch (err) {
    _logger('[keys-store] load failed: ' + err.message)
    return {}
  }
}

function ecrireTout(cles) {
  if (!_filePath) throw new Error('keys-store not initialized')
  const json = JSON.stringify(cles)
  let blob
  if (chiffrementDisponible()) blob = _safeStorage.encryptString(json)
  else {
    _logger('[keys-store] WARNING: safeStorage unavailable, saving API keys in plain text (mode 0600)')
    blob = Buffer.from(json, 'utf8')
  }
  const tmp = _filePath + '.tmp'
  fs.writeFileSync(tmp, blob, { mode: 0o600 })
  fs.renameSync(tmp, _filePath)
}

/** La clé en clair : pour le processus principal seulement. */
function lire(service) {
  verifierService(service)
  return lireTout()[service] || null
}

/** Ce que le renderer peut savoir : { present, hint, secure }. */
function statut(service) {
  const cle = lire(service)
  return { present: !!cle, hint: cle ? cle.slice(-4) : null, secure: chiffrementDisponible() }
}

function enregistrer(service, valeur) {
  verifierService(service)
  const cle = String(valeur ?? '').trim()
  const cles = lireTout()
  if (cle) cles[service] = cle
  else delete cles[service]
  ecrireTout(cles)
}

function effacer(service) {
  enregistrer(service, '')
}

module.exports = { init, lire, statut, enregistrer, effacer, SERVICES }
