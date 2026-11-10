// Réglages et secrets de la synchro sur Electron, dans userData/cloud-secrets.dat,
// chiffrés par safeStorage (Trousseau macOS, DPAPI, libsecret). Sans chiffrement
// système (Linux sans libsecret), le JSON est écrit en clair en mode 0600 et un
// avertissement est journalisé ; l'interface le signale (isEncrypted).
//
// Forme : { vaultPath, serverUrl, deviceId, chainSecret, chainId, chainPendingSecret, chainSaved }
//   deviceId            UUID tiré au hasard, sert seulement à reconnaître ses propres échos
//   chainSecret         S en hex (jamais envoyé au renderer)
//   chainPendingSecret  S d'une création ou d'un renouvellement en cours, pour reprendre après une coupure
//   chainSaved          vrai quand l'utilisateur a confirmé avoir sauvegardé ses 12 mots

const fs = require('fs')
const path = require('path')
const { randomUUID } = require('crypto')

const CHAMPS = ['vaultPath', 'serverUrl', 'deviceId', 'chainSecret', 'chainId', 'chainPendingSecret', 'chainSaved']
// Fichiers des versions précédentes : identifiants d'appareils, drapeau « compte vu en chaîne »,
// préférences d'envoi (versions avec compte), clés API personnelles (fonctions retirées).
const ANCIENS_FICHIERS = ['cloud-device-ids.json', 'cloud-chaine-vue.json', 'reader-prefs.json', 'api-keys.dat']
const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

let _dossier = null
let _filePath = null
let _safeStorage = null
let _logger = console.error

function init({ userDataPath, safeStorage, logger }) {
  _dossier = userDataPath
  _filePath = path.join(userDataPath, 'cloud-secrets.dat')
  _safeStorage = safeStorage
  if (logger) _logger = logger
}

function _isEncryptionAvailable() {
  try { return !!_safeStorage && _safeStorage.isEncryptionAvailable() } catch { return false }
}

/** Ne garde que les champs connus ; un fichier d'une version avec compte ne garde que le dossier et le serveur. */
function normaliser(brut) {
  const ancien = 'jwt' in brut || 'email' in brut
  const source = ancien ? { vaultPath: brut.vaultPath, serverUrl: brut.serverUrl } : brut
  const creds = {}
  for (const k of CHAMPS) if (source[k] !== undefined && source[k] !== null) creds[k] = source[k]
  if (!RE_UUID.test(String(creds.deviceId || ''))) creds.deviceId = randomUUID()
  return creds
}

/**
 * Réglages enregistrés, toujours un objet (avec un deviceId). Un fichier d'une
 * version précédente est réécrit sans ses champs morts : les chaînes liées à un
 * compte n'existent pas sur un serveur sans compte, seul le vault local compte.
 */
function load() {
  if (!_filePath || !fs.existsSync(_filePath)) return normaliser({})
  try {
    const raw = fs.readFileSync(_filePath)
    const json = _isEncryptionAvailable() && raw.length > 0 && raw[0] !== 0x7B /* '{' */
      ? _safeStorage.decryptString(raw)
      : raw.toString('utf8')
    const brut = JSON.parse(json)
    const creds = normaliser(brut)
    if (JSON.stringify(creds) !== JSON.stringify(brut)) save(creds)
    return creds
  } catch (err) {
    _logger('[cloud-store] load failed: ' + err.message)
    return normaliser({})
  }
}

function save(creds) {
  if (!_filePath) throw new Error('cloud-store not initialized')
  const propre = {}
  for (const k of CHAMPS) if (creds[k] !== undefined && creds[k] !== null) propre[k] = creds[k]
  const json = JSON.stringify(propre, null, 2)
  let blob
  if (_isEncryptionAvailable()) {
    blob = _safeStorage.encryptString(json)
  } else {
    _logger('[cloud-store] WARNING: safeStorage unavailable, saving sync settings in plain text (mode 0600)')
    blob = Buffer.from(json, 'utf8')
  }
  const tmp = _filePath + '.tmp'
  fs.writeFileSync(tmp, blob, { mode: 0o600 })
  fs.renameSync(tmp, _filePath)
}

function clear() {
  if (_filePath && fs.existsSync(_filePath)) {
    try { fs.unlinkSync(_filePath) } catch (err) { _logger('[cloud-store] clear failed: ' + err.message) }
  }
}

/** Supprime les fichiers laissés par les versions avec compte (au mieux). */
function nettoyerAnciensFichiers() {
  if (!_dossier) return
  for (const nom of ANCIENS_FICHIERS) {
    try { fs.unlinkSync(path.join(_dossier, nom)) } catch {}
  }
}

// Vrai si les réglages (et le secret de chaîne) sont chiffrés par le système.
function isEncrypted() { return _isEncryptionAvailable() }

module.exports = { init, load, save, clear, isEncrypted, nettoyerAnciensFichiers }
