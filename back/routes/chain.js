// Routes de la chaîne : un casier chiffré de bout en bout par chaîne, sans compte.
//
// Le serveur range des blocs opaques sous des docId opaques. Il ne voit ni le
// contenu, ni les chemins, ni les titres, et ne journalise ni preuve, ni
// pathEnc, ni corps, ni IP. Ce routeur est monté AVANT express.json() :
// PUT /docs/:docId lit un corps binaire.

const express = require('express')
const prisma = require('../services/prisma')
const stockage = require('../services/stockageChaine')
const flux = require('../services/fluxChaine')
const { requireChain, lireIdentite, preuveAcceptee } = require('../middleware/requireChain')
const { creations, cleIp } = require('../services/limiteurs')
const { reseauxLecteurs } = require('../services/reseauxLecteurs')
const { etatCasier, effacerCasier } = require('../services/casiers')
const { verifierChaine, estSuspect } = require('../services/verificationChaine')
const {
  RE_DOC_ID, TAILLE_MAX_DOC, TAILLE_MAX_BLOC, QUOTA_OCTETS, MAX_DOCS, MAX_CHAINES, DUREE_PIERRES_TOMBALES_MS,
  MAX_PIERRES_TOMBALES, sha256Hex, prefixe, resumeErreur, erreurPathEnc, erreurTombEnc, erreurEnveloppe, sousVerrou,
} = require('../services/chaine')

const router = express.Router()
const brut = express.raw({ type: () => true, limit: TAILLE_MAX_BLOC })

// Rien de ce qui sort d'ici ne doit rester dans un cache.
router.use((_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

function erreurInterne(res, contexte, err) {
  console.error(`[chain/${contexte}] error:`, resumeErreur(err))
  if (!res.headersSent) res.status(500).json({ error: 'Internal error' })
}

const cleDoc = (chainId, docId) => ({ chainId_docId: { chainId, docId } })

function lireDocId(req, res) {
  const { docId } = req.params
  if (RE_DOC_ID.test(docId)) return docId
  res.status(400).json({ error: 'Invalid docId', code: 'DOC_ID_INVALID' })
  return null
}

/**
 * X-Lector-Mtime (ISO) : maintenant s'il est absent, null s'il est invalide
 * ou hors des années 0 à 9999 (la base refuserait de l'écrire).
 */
function lireMtime(req) {
  const valeur = req.headers['x-lector-mtime']
  if (valeur === undefined) return new Date()
  const date = new Date(String(valeur))
  const annee = date.getUTCFullYear()
  return annee >= 0 && annee <= 9999 ? date : null
}

/** Valeurs d'un en-tête If-Match ou If-None-Match (guillemets et W/ retirés), ou null s'il est absent. */
function lireEtiquettes(req, nom) {
  const valeur = req.headers[nom]
  if (valeur === undefined) return null
  return String(valeur).split(',')
    .map((t) => t.trim().replace(/^W\//, '').replace(/^"(.*)"$/, '$1').toLowerCase())
    .filter(Boolean)
}

/**
 * If-Match : l'empreinte du bloc actuel doit y figurer (ou '*' avec un bloc
 * vivant). If-None-Match : l'inverse ; « If-None-Match: * » demande une
 * création. shaActuel vaut null sans bloc vivant (absent ou pierre tombale).
 */
function conditionsRemplies(req, shaActuel) {
  const correspond = (etiquettes) => shaActuel !== null && (etiquettes.includes('*') || etiquettes.includes(shaActuel))
  const siCorrespond = lireEtiquettes(req, 'if-match')
  if (siCorrespond && !correspond(siCorrespond)) return false
  const siAucun = lireEtiquettes(req, 'if-none-match')
  return !(siAucun && correspond(siAucun))
}

function conflit(res, shaActuel) {
  return res.status(412).json({ error: 'Document changed on the server', code: 'CONFLICT', current: shaActuel })
}

// ---------------------------------------------------------------------------
// Casier
// ---------------------------------------------------------------------------

// POST /v1/chain : crée le casier de la chaîne présentée par les en-têtes.
// Idempotent : même id et même preuve renvoient 200 (reprise après coupure).
router.post('/', async (req, res) => {
  try {
    const identite = lireIdentite(req, res)
    if (!identite) return
    const { chainId, empreinte } = identite
    const ip = cleIp(req.ip)
    // Une création à la fois : sans cela, des requêtes parallèles passeraient
    // toutes la limite par IP et le plafond global avant que la première compte.
    const { existante, chain, refus } = await sousVerrou('chain:create', async () => {
      const existante = await prisma.chain.findUnique({ where: { id: chainId } })
      if (existante) return { existante }
      if (creations.estLimite(ip)) return { refus: 'limite' }
      if (await prisma.chain.count() >= MAX_CHAINES) return { refus: 'plein' }
      const chain = await prisma.chain.create({ data: { id: chainId, proofHash: empreinte } })
      creations.compter(ip)
      return { chain }
    })
    if (existante) {
      if (preuveAcceptee(req, res, existante, empreinte)) res.json(etatCasier(existante))
      return
    }
    if (refus === 'limite') {
      return res.status(429).json({ error: 'Too many chains created, try again later', code: 'CHAIN_CREATE_LIMITED' })
    }
    if (refus === 'plein') {
      console.warn('[chain] capacity reached, creation refused')
      return res.status(503).json({ error: 'Server is full, try again later', code: 'CHAIN_CAPACITY' })
    }
    console.log(`[chain ${prefixe(chainId)}] created`)
    return res.status(201).json(etatCasier(chain))
  } catch (err) {
    return erreurInterne(res, 'create', err)
  }
})

// GET /v1/chain : occupation et limites du casier.
router.get('/', requireChain, (req, res) => res.json(etatCasier(req.chain)))

// DELETE /v1/chain : tout effacer. Les autres appareils reçoivent ensuite 404 CHAIN_UNKNOWN.
router.delete('/', requireChain, async (req, res) => {
  try {
    await effacerCasier(prisma, req.chain.id)
    flux.fermer(req.chain.id)
    reseauxLecteurs.oublier(req.chain.id)
    console.log(`[chain ${prefixe(req.chain.id)}] erased`)
    return res.status(204).end()
  } catch (err) {
    return erreurInterne(res, 'erase', err)
  }
})

// GET /v1/chain/manifest : documents vivants et pierres tombales de moins de 30 jours.
router.get('/manifest', requireChain, async (req, res) => {
  try {
    const limite = new Date(Date.now() - DUREE_PIERRES_TOMBALES_MS)
    const docs = await prisma.chainDoc.findMany({
      where: { chainId: req.chain.id, OR: [{ deletedAt: null }, { deletedAt: { gte: limite } }] },
      select: { docId: true, pathEnc: true, sha256: true, size: true, mtime: true, deletedAt: true, tombEnc: true },
      orderBy: { docId: 'asc' },
    })
    return res.json({ ...etatCasier(req.chain), docs })
  } catch (err) {
    return erreurInterne(res, 'manifest', err)
  }
})

// GET /v1/chain/verify : cohérence du casier (blocs, empreintes, compteurs).
router.get('/verify', requireChain, async (req, res) => {
  try {
    const rapport = await verifierChaine(prisma, req.chain.id)
    if (!rapport) return res.status(404).json({ error: 'Unknown chain', code: 'CHAIN_UNKNOWN' })
    return res.json(rapport)
  } catch (err) {
    return erreurInterne(res, 'verify', err)
  }
})

// GET /v1/chain/stream : flux SSE des écritures de la chaîne. Lu par fetch avec
// les en-têtes, jamais avec la preuve dans l'URL (elle finirait dans les journaux d'accès).
router.get('/stream', requireChain, (req, res) => {
  if (!flux.ouvrir(req.chain.id, res, cleIp(req.ip))) {
    return res.status(503).json({ error: 'Too many open streams', code: 'STREAM_CAPACITY' })
  }
})

// ---------------------------------------------------------------------------
// Documents chiffrés
// ---------------------------------------------------------------------------

/** Réponse 413 ou 404 quand la réservation de place a échoué pour le casier `casier`. */
async function refusDePlace(casier, nouveau, taille) {
  const chain = await prisma.chain.findUnique({ where: { id: casier.id } })
  // Effacé, ou effacé puis recréé avec le même id pendant le dépôt.
  if (!chain || chain.createdAt.getTime() !== casier.createdAt.getTime()) {
    return { status: 404, corps: { error: 'Unknown chain', code: 'CHAIN_UNKNOWN' } }
  }
  if (nouveau && chain.docCount >= MAX_DOCS) {
    return { status: 413, corps: { error: 'Too many documents in this chain', code: 'TOO_MANY_DOCS', docCount: chain.docCount, maxDocs: MAX_DOCS } }
  }
  return { status: 413, corps: { error: 'Storage quota exceeded', code: 'QUOTA_EXCEEDED', bytesUsed: chain.bytesUsed, quotaBytes: QUOTA_OCTETS, size: taille } }
}

/**
 * Dépose un bloc. Il est d'abord écrit à côté de sa place (fichier
 * temporaire). La réservation de place (mise à jour conditionnelle des
 * compteurs) et la ligne du document passent ensuite dans une seule
 * transaction : deux dépôts parallèles ne dépassent pas le quota ensemble,
 * et un casier effacé entre-temps fait tout échouer. Le bloc ne remplace
 * l'ancien qu'après la transaction ; sinon le fichier temporaire est supprimé
 * et rien n'a changé, ni sur le disque, ni en base.
 */
async function deposer(req, docId, { bloc, sha256, pathEnc, mtime }) {
  const chainId = req.chain.id
  const actuel = await prisma.chainDoc.findUnique({ where: cleDoc(chainId, docId) })
  const vivant = Boolean(actuel && !actuel.deletedAt)
  const shaActuel = vivant ? actuel.sha256 : null
  if (!conditionsRemplies(req, shaActuel)) return { conflit: shaActuel }

  const delta = bloc.length - (vivant ? actuel.size : 0)
  const ajout = vivant ? 0 : 1
  // createdAt : le casier lu à l'authentification, pas un casier effacé puis
  // recréé avec le même id entre-temps (l'effacement a emporté le fichier temporaire).
  const place = { id: chainId, createdAt: req.chain.createdAt }
  if (delta > 0) place.bytesUsed = { lte: QUOTA_OCTETS - delta }
  if (ajout) place.docCount = { lt: MAX_DOCS }

  const temp = await stockage.preparerBloc(chainId, docId, bloc)
  try {
    const [chain] = await prisma.$transaction([
      prisma.chain.update({ where: place, data: { bytesUsed: { increment: delta }, docCount: { increment: ajout } } }),
      prisma.chainDoc.upsert({
        where: cleDoc(chainId, docId),
        create: { chainId, docId, pathEnc, sha256, size: bloc.length, mtime },
        update: { pathEnc, sha256, size: bloc.length, mtime, deletedAt: null, tombEnc: null },
      }),
    ])
    // Après la transaction, le renommage n'échoue que si l'effacement du
    // casier a emporté le fichier temporaire : la ligne est partie avec lui.
    await stockage.installerBloc(temp, chainId, docId)
    return { ligne: { docId, sha256, size: bloc.length, bytesUsed: chain.bytesUsed } }
  } catch (err) {
    await stockage.abandonnerBloc(temp)
    // P2025 : place ou nombre de documents insuffisants, ou casier effacé entre-temps.
    if (err.code === 'P2025') return { refus: await refusDePlace(req.chain, !vivant, bloc.length) }
    throw err
  }
}

// PUT /v1/chain/docs/:docId : dépôt d'un bloc chiffré.
// En-têtes : X-Lector-Path-Enc, X-Lector-Mtime, If-Match ou If-None-Match: *.
router.put('/docs/:docId', requireChain, brut, async (req, res) => {
  try {
    const docId = lireDocId(req, res)
    if (!docId) return
    const pathEnc = req.headers['x-lector-path-enc']
    const erreurChemin = erreurPathEnc(pathEnc)
    if (erreurChemin) return res.status(400).json({ error: erreurChemin, code: 'PATH_ENC_INVALID' })
    const mtime = lireMtime(req)
    if (!mtime) return res.status(400).json({ error: 'Invalid X-Lector-Mtime', code: 'MTIME_INVALID' })

    const bloc = req.body
    const erreurBloc = erreurEnveloppe(bloc)
    if (erreurBloc) return res.status(400).json({ error: erreurBloc, code: 'ENVELOPE_INVALID' })
    // Garde-fou contre un client bogué qui enverrait du clair : un chiffré
    // AES-GCM n'est pas de l'UTF-8 valide et a une entropie proche de 8 bits
    // par octet. Un faux positif est négligeable (moins d'une chance sur
    // 10 millions pour 32 octets) et disparaît au nouvel essai (nouvel IV).
    if (estSuspect(bloc)) return res.status(400).json({ error: 'Block looks like plaintext', code: 'ENVELOPE_INVALID' })

    const sha256 = sha256Hex(bloc)
    const resultat = await sousVerrou(`${req.chain.id}:${docId}`, () => deposer(req, docId, { bloc, sha256, pathEnc, mtime }))
    if (resultat.conflit !== undefined) return conflit(res, resultat.conflit)
    if (resultat.refus) return res.status(resultat.refus.status).json(resultat.refus.corps)
    flux.diffuser(req.chain.id, { kind: 'put', docId, actorDevice: req.actorDevice })
    res.set('ETag', sha256)
    return res.json(resultat.ligne)
  } catch (err) {
    return erreurInterne(res, 'put', err)
  }
})

// GET /v1/chain/docs/:docId : bloc brut. ETag = SHA-256 du bloc (sans guillemets).
router.get('/docs/:docId', requireChain, async (req, res) => {
  try {
    const docId = lireDocId(req, res)
    if (!docId) return
    const chainId = req.chain.id
    // Sous le verrou du document : la ligne et le bloc lus vont ensemble.
    const lu = await sousVerrou(`${chainId}:${docId}`, async () => {
      const ligne = await prisma.chainDoc.findUnique({ where: cleDoc(chainId, docId) })
      if (!ligne || ligne.deletedAt) return { ligne }
      try {
        return { ligne, bloc: await stockage.lireBloc(chainId, docId) }
      } catch (err) {
        if (err.code === 'ENOENT') return { ligne, manquant: true }
        throw err
      }
    })
    if (!lu.ligne) return res.status(404).json({ error: 'Unknown document', code: 'DOC_UNKNOWN' })
    if (lu.ligne.deletedAt) {
      return res.status(410).json({ error: 'Document deleted', code: 'DOC_DELETED', deletedAt: lu.ligne.deletedAt })
    }
    if (lu.manquant) {
      console.error(`[chain ${prefixe(chainId)}] block missing on disk`)
      return res.status(404).json({ error: 'Block missing on the server', code: 'DOC_UNKNOWN' })
    }
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(lu.bloc.length),
      'ETag': lu.ligne.sha256,
      'X-Lector-Path-Enc': lu.ligne.pathEnc,
      'X-Lector-Mtime': lu.ligne.mtime.toISOString(),
    })
    return res.end(lu.bloc)
  } catch (err) {
    return erreurInterne(res, 'get', err)
  }
})

/**
 * Au-delà de MAX_PIERRES_TOMBALES, les plus anciennes pierres tombales du
 * casier sont supprimées, comme par la purge à 30 jours. Une ligne
 * ressuscitée entre-temps (deletedAt remis à null) n'est pas touchée.
 */
async function limiterPierresTombales(chainId) {
  const enTrop = await prisma.chainDoc.findMany({
    where: { chainId, deletedAt: { not: null } },
    orderBy: { deletedAt: 'desc' },
    skip: MAX_PIERRES_TOMBALES,
    select: { id: true },
  })
  if (!enTrop.length) return
  await prisma.chainDoc.deleteMany({ where: { id: { in: enTrop.map((d) => d.id) }, deletedAt: { not: null } } })
}

// DELETE /v1/chain/docs/:docId : pierre tombale de 30 jours (le pathEnc est
// gardé) avec la marque de suppression chiffrée par le client
// (X-Lector-Tomb-Enc) ; le bloc est effacé du disque et sa place rendue.
// Au plus MAX_PIERRES_TOMBALES par casier, les plus anciennes partent d'abord.
// If-Match facultatif. Déjà supprimé : 204 sans rien changer.
router.delete('/docs/:docId', requireChain, async (req, res) => {
  try {
    const docId = lireDocId(req, res)
    if (!docId) return
    const tombEnc = req.headers['x-lector-tomb-enc']
    const erreurMarque = erreurTombEnc(tombEnc)
    if (erreurMarque) return res.status(400).json({ error: erreurMarque, code: 'TOMB_ENC_INVALID' })

    const chainId = req.chain.id
    const resultat = await sousVerrou(`${chainId}:${docId}`, async () => {
      const actuel = await prisma.chainDoc.findUnique({ where: cleDoc(chainId, docId) })
      if (!actuel) return { absent: true }
      if (actuel.deletedAt) return { deja: true }
      if (!conditionsRemplies(req, actuel.sha256)) return { conflit: actuel.sha256 }
      await prisma.$transaction([
        prisma.chainDoc.update({
          where: cleDoc(chainId, docId),
          data: { deletedAt: new Date(), sha256: '', size: 0, tombEnc },
        }),
        prisma.chain.update({
          where: { id: chainId },
          data: { bytesUsed: { decrement: actuel.size }, docCount: { decrement: 1 } },
        }),
      ])
      await stockage.supprimerBloc(chainId, docId)
      await limiterPierresTombales(chainId)
      return {}
    })
    if (resultat.absent) return res.status(404).json({ error: 'Unknown document', code: 'DOC_UNKNOWN' })
    if (resultat.conflit !== undefined) return conflit(res, resultat.conflit)
    if (!resultat.deja) flux.diffuser(chainId, { kind: 'delete', docId, actorDevice: req.actorDevice })
    return res.status(204).end()
  } catch (err) {
    return erreurInterne(res, 'delete', err)
  }
})

// Erreurs de lecture du corps (taille) en JSON plutôt qu'en page HTML.
router.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Document too large', code: 'DOC_TOO_LARGE', maxDocBytes: TAILLE_MAX_DOC })
  }
  return erreurInterne(res, 'body', err)
})

module.exports = router
