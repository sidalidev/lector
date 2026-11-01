const prisma = require('../services/prisma')
const {
  RE_CHAIN_ID, RE_APPAREIL, decoderPreuve, empreintePreuve, egalTempsConstant, prefixe, resumeErreur,
} = require('../services/chaine')
const { preuves, clePreuve } = require('../services/limiteurs')
const { reseauxLecteurs } = require('../services/reseauxLecteurs')

const HEURE_MS = 60 * 60 * 1000

/**
 * Lit l'identité présentée par les en-têtes X-Lector-Chain-Id (32 hex) et
 * X-Lector-Chain-Proof (P en base64url). Répond 400 et renvoie null si elle
 * est absente ou mal formée.
 */
function lireIdentite(req, res) {
  const chainId = String(req.headers['x-lector-chain-id'] || '')
  if (!RE_CHAIN_ID.test(chainId)) {
    res.status(400).json({ error: 'Invalid or missing X-Lector-Chain-Id', code: 'CHAIN_ID_INVALID' })
    return null
  }
  const preuve = decoderPreuve(String(req.headers['x-lector-chain-proof'] || ''))
  if (!preuve) {
    res.status(400).json({ error: 'Invalid or missing X-Lector-Chain-Proof', code: 'CHAIN_PROOF_MISSING' })
    return null
  }
  return { chainId, empreinte: empreintePreuve(preuve) }
}

/**
 * Compare l'empreinte présentée à celle du casier, à temps constant. Une
 * preuve fausse est comptée par couple (IP, chaîne) ; la bonne passe toujours.
 * Répond 403 ou 429 et renvoie false en cas d'échec.
 */
function preuveAcceptee(req, res, chain, empreinte) {
  if (egalTempsConstant(empreinte, chain.proofHash)) return true
  const cle = clePreuve(req.ip, chain.id)
  if (preuves.estLimite(cle)) {
    res.status(429).json({ error: 'Too many invalid proofs, try again later', code: 'CHAIN_PROOF_LIMITED' })
    return false
  }
  preuves.compter(cle)
  console.warn(`[chain ${prefixe(chain.id)}] invalid proof`)
  res.status(403).json({ error: 'Invalid chain proof', code: 'CHAIN_PROOF_INVALID' })
  return false
}

/** lastSeenAt sert à la purge des casiers abandonnés : une écriture par heure au plus. */
function noterPassage(chain) {
  const limite = new Date(Date.now() - HEURE_MS)
  if (chain.lastSeenAt > limite) return
  prisma.chain.updateMany({ where: { id: chain.id, lastSeenAt: { lt: limite } }, data: { lastSeenAt: new Date() } })
    .catch((err) => console.error(`[chain ${prefixe(chain.id)}] lastSeenAt not updated:`, resumeErreur(err)))
}

/**
 * Limite anti-partage (services/reseauxLecteurs.js) : une lecture depuis un
 * nouveau réseau, quand la chaîne a déjà été lue depuis trop de réseaux
 * distincts en 24 heures, répond 429. Rien n'est journalisé de l'adresse.
 * Répond 429 et renvoie false en cas de refus.
 */
function lectureAdmise(req, res, chain) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return true
  const verdict = reseauxLecteurs.lecture(chain.id, req.ip)
  if (verdict.ok) return true
  if (verdict.premierRefus) console.warn(`[chain ${prefixe(chain.id)}] read refused: too many networks today`)
  res.set('Retry-After', String(Math.ceil(verdict.reessayerDansMs / 1000)))
  res.status(429).json({
    error: 'This chain is being read from too many different networks today. Devices already in use keep syncing; try this one again later.',
    code: 'CHAIN_READ_LIMITED',
  })
  return false
}

/**
 * Seule authentification du serveur : l'id de la chaîne et sa preuve.
 * Attache req.chain (ligne Chain) et req.actorDevice (X-Lector-Device ou null,
 * jamais stocké : il sert à filtrer les échos du flux).
 */
async function requireChain(req, res, next) {
  try {
    const identite = lireIdentite(req, res)
    if (!identite) return
    const chain = await prisma.chain.findUnique({ where: { id: identite.chainId } })
    if (!chain) return res.status(404).json({ error: 'Unknown chain', code: 'CHAIN_UNKNOWN' })
    if (!preuveAcceptee(req, res, chain, identite.empreinte)) return
    noterPassage(chain)
    if (!lectureAdmise(req, res, chain)) return
    const appareil = String(req.headers['x-lector-device'] || '')
    req.chain = chain
    req.actorDevice = RE_APPAREIL.test(appareil) ? appareil : null
    next()
  } catch (err) {
    console.error('[chain] authentication error:', resumeErreur(err))
    return res.status(500).json({ error: 'Internal error' })
  }
}

module.exports = { requireChain, lireIdentite, preuveAcceptee }
