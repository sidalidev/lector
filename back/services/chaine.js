// Outils communs de la chaîne côté serveur : formats, limites, empreintes.
//
// Le serveur ne déchiffre jamais rien : il vérifie seulement des formats,
// compare des empreintes et range des blocs opaques.

const crypto = require('crypto')

const RE_CHAIN_ID = /^[0-9a-f]{32}$/
const RE_DOC_ID = /^[0-9a-f]{64}$/
const RE_BASE64URL = /^[A-Za-z0-9_-]+$/
// Identifiant d'installation (X-Lector-Device) : opaque, jamais stocké.
const RE_APPAREIL = /^[A-Za-z0-9_-]{1,64}$/

// Enveloppe : version (1 octet) ‖ IV (12 octets) ‖ chiffré ‖ étiquette (16 octets).
const VERSION_ENVELOPPE = 1
const SURCOUT_ENVELOPPE = 29

function entierEnv(nom, defaut) {
  const valeur = Number(process.env[nom])
  return Number.isInteger(valeur) && valeur > 0 ? valeur : defaut
}

// Limites d'un casier. Un bloc fait au plus TAILLE_MAX_DOC octets de clair
// plus l'enveloppe ; QUOTA_OCTETS borne la somme des blocs vivants.
const TAILLE_MAX_DOC = entierEnv('CHAIN_MAX_DOC_BYTES', 512 * 1024)
const TAILLE_MAX_BLOC = TAILLE_MAX_DOC + SURCOUT_ENVELOPPE
const QUOTA_OCTETS = entierEnv('CHAIN_QUOTA_BYTES', 20 * 1024 * 1024)
const MAX_DOCS = entierEnv('CHAIN_MAX_DOCS', 5000)
// Coupe-circuit global : au-delà, plus aucune création de casier.
const MAX_CHAINES = entierEnv('CHAIN_MAX_CHAINS', 10000)

// pathEnc : 1500 caractères base64url au plus (environ 1125 octets, assez pour
// un chemin de 1024 octets plus l'enveloppe).
const TAILLE_MAX_PATH_ENC = 1500
const TAILLE_MAX_TOMB_ENC = 400

const JOUR_MS = 24 * 60 * 60 * 1000
// Pierres tombales gardées 30 jours, puis supprimées par la purge quotidienne.
const DUREE_PIERRES_TOMBALES_MS = 30 * JOUR_MS
// Et MAX_DOCS par casier au plus : au-delà, les plus anciennes partent d'abord.
// Sans cette borne, PUT puis DELETE en boucle feraient grossir la base hors quota.
const MAX_PIERRES_TOMBALES = MAX_DOCS
// Un casier sans aucune requête depuis CHAIN_INACTIVE_DAYS jours (180 par
// défaut, environ 6 mois) est effacé par la purge.
const JOURS_INACTIVITE = entierEnv('CHAIN_INACTIVE_DAYS', 180)
const DUREE_INACTIVITE_MS = JOURS_INACTIVITE * JOUR_MS

function sha256Hex(octets) {
  return crypto.createHash('sha256').update(octets).digest('hex')
}

/** Décode du base64url sans remplissage, ou renvoie null si le texte n'en est pas. */
function decoderBase64url(texte) {
  if (typeof texte !== 'string' || !texte.length || !RE_BASE64URL.test(texte)) return null
  if (texte.length % 4 === 1) return null
  const octets = Buffer.from(texte, 'base64url')
  // Refuse les encodages non canoniques (bits de remplissage non nuls).
  if (octets.toString('base64url') !== texte) return null
  return octets
}

/** La preuve P fait 32 octets, soit 43 caractères base64url. Renvoie ses octets ou null. */
function decoderPreuve(texte) {
  if (typeof texte !== 'string' || texte.length !== 43) return null
  const octets = decoderBase64url(texte)
  return octets && octets.length === 32 ? octets : null
}

/** Empreinte stockée par le serveur : hex(SHA-256(P)). */
function empreintePreuve(octetsPreuve) {
  return sha256Hex(octetsPreuve)
}

/** Comparaison à temps constant de deux chaînes hex de même longueur. */
function egalTempsConstant(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

/** Les 8 premiers caractères d'un id de chaîne : seule forme admise dans les journaux. */
function prefixe(chainId) {
  return String(chainId).slice(0, 8)
}

/**
 * Ce qu'un journal peut dire d'une erreur : son code ou son nom. Jamais le
 * message, qui peut citer un chemin disque (id complet) ou les arguments
 * d'une requête Prisma (pathEnc).
 */
function resumeErreur(err) {
  return (err && (err.code || err.name)) || 'Error'
}

/** Vérifie une enveloppe base64url (pathEnc, tombEnc). Renvoie un message d'erreur ou null. */
function erreurEnveloppeTexte(nom, texte, tailleMax) {
  if (typeof texte !== 'string' || !texte.length) return `${nom} missing`
  if (texte.length > tailleMax) return `${nom} too long`
  const octets = decoderBase64url(texte)
  if (!octets) return `${nom} is not base64url`
  // Le clair fait au moins 1 octet, donc l'enveloppe au moins 30.
  if (octets.length < SURCOUT_ENVELOPPE + 1) return `${nom} too short`
  if (octets[0] !== VERSION_ENVELOPPE) return `${nom} has an unknown version`
  return null
}

function erreurPathEnc(pathEnc) {
  return erreurEnveloppeTexte('X-Lector-Path-Enc', pathEnc, TAILLE_MAX_PATH_ENC)
}

/**
 * Marque de suppression (X-Lector-Tomb-Enc). Le serveur ne peut pas la lire :
 * il la garde avec la pierre tombale et les autres appareils la vérifient
 * avant de supprimer un fichier local.
 */
function erreurTombEnc(tombEnc) {
  return erreurEnveloppeTexte('X-Lector-Tomb-Enc', tombEnc, TAILLE_MAX_TOMB_ENC)
}

/** Vérifie l'enveloppe d'un bloc. Renvoie un message d'erreur ou null. */
function erreurEnveloppe(octets) {
  if (!Buffer.isBuffer(octets)) return 'Binary body expected'
  if (octets.length < SURCOUT_ENVELOPPE) return 'Block too short'
  if (octets[0] !== VERSION_ENVELOPPE) return 'Block has an unknown version'
  return null
}

/** Exécute fn seul pour une clé donnée (évite deux écritures concurrentes du même document). */
const fileAttente = new Map()
function sousVerrou(cle, fn) {
  const precedent = fileAttente.get(cle) || Promise.resolve()
  const suivant = precedent.catch(() => {}).then(fn)
  const fin = suivant.catch(() => {})
  fileAttente.set(cle, fin)
  fin.then(() => {
    if (fileAttente.get(cle) === fin) fileAttente.delete(cle)
  })
  return suivant
}

module.exports = {
  RE_CHAIN_ID,
  RE_DOC_ID,
  RE_APPAREIL,
  VERSION_ENVELOPPE,
  TAILLE_MAX_DOC,
  TAILLE_MAX_BLOC,
  QUOTA_OCTETS,
  MAX_DOCS,
  MAX_CHAINES,
  DUREE_PIERRES_TOMBALES_MS,
  MAX_PIERRES_TOMBALES,
  JOURS_INACTIVITE,
  DUREE_INACTIVITE_MS,
  entierEnv,
  sha256Hex,
  decoderPreuve,
  empreintePreuve,
  egalTempsConstant,
  prefixe,
  resumeErreur,
  erreurPathEnc,
  erreurTombEnc,
  erreurEnveloppe,
  sousVerrou,
}
