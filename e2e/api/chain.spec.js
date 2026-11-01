// Tests API de la chaîne : un casier chiffré par chaîne, sans compte.
//
// Ils tournent contre l'API de test (port 3457) lancée par playwright.config.js
// sur une base SQLite jetable (back/.test-data/), jamais sur la base de
// développement ni sur la production. Les limites y sont basses (e2e/back-test.js)
// pour tester les trois 413 sans gros envois. Le chiffrement passe par le vrai
// module client (front/src/services/chaine/crypto.js) ; Prisma ne sert qu'à
// inspecter la base.

import { test, expect } from '@playwright/test'
import fs from 'fs'
import net from 'net'
import path from 'path'
import crypto from 'crypto'
import { execFileSync, spawn } from 'child_process'
import * as chaine from '../../front/src/services/chaine/crypto.js'
import { BACK, DONNEES, PORT_TEST, ENV_TEST } from '../back-test.js'

const { PrismaClient } = require(path.join(BACK, 'node_modules', '@prisma/client'))

const BASE = `http://localhost:${PORT_TEST}`
test.use({ baseURL: BASE })

const prisma = new PrismaClient({ datasourceUrl: ENV_TEST.DATABASE_URL })

const MAX_DOC = Number(ENV_TEST.CHAIN_MAX_DOC_BYTES)
const MAX_BLOC = MAX_DOC + 29
const QUOTA = Number(ENV_TEST.CHAIN_QUOTA_BYTES)
const MAX_DOCS = Number(ENV_TEST.CHAIN_MAX_DOCS)
const MTIME = '2026-10-19T08:00:00.000Z'
const HEURE = 60 * 60 * 1000
const JOUR = 24 * HEURE

// Textes qui ne doivent jamais apparaître dans le journal du serveur :
// preuves, secrets, 12 mots, ids de chaîne complets, pathEnc, contenus, chemins.
const marqueursJournal = []
// Textes en clair qui ne doivent jamais toucher le disque ni la base.
const marqueursClair = []

test.afterAll(async () => {
  await prisma.$disconnect()
})

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

async function nouvelleChaine() {
  const S = chaine.nouveauSecret()
  const mots = await chaine.toWords(S)
  marqueursJournal.push(Buffer.from(S).toString('hex'), mots.join(' '))
  const cles = await chaine.preparer(S)
  marqueursJournal.push(cles.preuve, cles.id)
  return { ...cles, S }
}

const enTetes = (cles, extra = {}) => ({
  'X-Lector-Chain-Id': cles.id,
  'X-Lector-Chain-Proof': cles.preuve,
  ...extra,
})

async function etat(request, cles) {
  const res = await request.get('/v1/chain', { headers: enTetes(cles) })
  expect(res.status()).toBe(200)
  return res.json()
}

async function casierNeuf(request) {
  const cles = await nouvelleChaine()
  const res = await request.post('/v1/chain', { headers: enTetes(cles) })
  expect(res.status()).toBe(201)
  return cles
}

/** Chiffre et dépose un document. Renvoie la réponse et les valeurs chiffrées. */
async function pousser(request, cles, chemin, contenu, extra = {}) {
  const octets = typeof contenu === 'string' ? new TextEncoder().encode(contenu) : contenu
  const doc = await chaine.chiffrerDocAvec(cles, chemin, octets)
  marqueursJournal.push(doc.pathEnc)
  const res = await request.put(`/v1/chain/docs/${doc.docId}`, {
    headers: enTetes(cles, {
      'Content-Type': 'application/octet-stream',
      'X-Lector-Path-Enc': doc.pathEnc,
      'X-Lector-Mtime': MTIME,
      ...extra,
    }),
    data: Buffer.from(doc.contentEnc),
  })
  return { res, ...doc }
}

/** En-tête de la marque de suppression chiffrée par le client (bloc d'empreinte `sha` supprimé). */
async function marque(cles, docId, sha = '') {
  return { 'X-Lector-Tomb-Enc': await chaine.chiffrerTombeAvec(cles, docId, sha) }
}

async function supprimer(request, cles, docId, sha, extra = {}) {
  return request.delete(`/v1/chain/docs/${docId}`, { headers: enTetes(cles, { ...(await marque(cles, docId, sha)), ...extra }) })
}

async function tirer(request, cles, docId) {
  const res = await request.get(`/v1/chain/docs/${docId}`, { headers: enTetes(cles) })
  expect(res.status()).toBe(200)
  const bloc = new Uint8Array(await res.body())
  const clair = await chaine.dechiffrerContenuAvec(cles, docId, bloc)
  const chemin = await chaine.dechiffrerCheminAvec(cles, docId, res.headers()['x-lector-path-enc'])
  return { texte: new TextDecoder().decode(clair), chemin, bloc, enTetes: res.headers() }
}

async function manifeste(request, cles) {
  const res = await request.get('/v1/chain/manifest', { headers: enTetes(cles) })
  expect(res.status()).toBe(200)
  return res.json()
}

const dossierCasier = (cles) => path.join(ENV_TEST.CHAIN_FILES_ROOT, cles.id)
const cheminBloc = (cles, docId) => path.join(dossierCasier(cles), docId.slice(0, 2), docId)

/** Tous les fichiers sous un dossier (vide s'il n'existe pas). */
function fichiersSous(dossier) {
  if (!fs.existsSync(dossier)) return []
  return fs.readdirSync(dossier, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
}

function contientOctets(fichiers, texte) {
  const aiguille = Buffer.from(texte)
  return fichiers.some((f) => fs.readFileSync(f).includes(aiguille))
}

function lancerVerificateur(args) {
  try {
    const sortie = execFileSync(process.execPath, ['scripts/verifier-chaine.js', ...args], {
      cwd: BACK, env: { ...process.env, ...ENV_TEST }, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, rapport: JSON.parse(sortie) }
  } catch (err) {
    return { code: err.status, rapport: err.stdout ? JSON.parse(err.stdout) : null }
  }
}

/** `request` dont les chemins relatifs visent le serveur `url` (les outils ci-dessus s'en servent tels quels). */
function vers(request, url) {
  const methode = (nom) => (chemin, options) => request[nom](url + chemin, options)
  return { get: methode('get'), post: methode('post'), put: methode('put'), delete: methode('delete') }
}

/**
 * Démarre un serveur de plus, avec sa propre base et son propre dossier
 * (back/.test-data/<nom>/), dans un Node ordinaire comme en production (sans
 * les options du chargeur de Playwright).
 */
async function lancerServeur(nom, port, env) {
  const dossier = path.join(DONNEES, nom)
  fs.rmSync(dossier, { recursive: true, force: true })
  fs.mkdirSync(dossier, { recursive: true })
  const { NODE_OPTIONS: _options, ...parent } = process.env
  const complet = {
    ...parent,
    ...ENV_TEST,
    ...env,
    PORT: String(port),
    DATABASE_URL: `file:${path.join(dossier, `${nom}.db`)}`,
    CHAIN_FILES_ROOT: path.join(dossier, 'chain'),
  }
  execFileSync(path.join(BACK, 'node_modules', '.bin', 'prisma'), ['db', 'push', '--skip-generate'], { cwd: BACK, env: complet, stdio: 'ignore' })
  const processus = spawn(process.execPath, ['index.js'], { cwd: BACK, env: complet, stdio: ['ignore', 'pipe', 'pipe'] })
  const serveur = {
    url: `http://localhost:${port}`,
    racine: complet.CHAIN_FILES_ROOT,
    base: new PrismaClient({ datasourceUrl: complet.DATABASE_URL }),
    journal: '',
    async arreter() {
      processus.kill()
      await serveur.base.$disconnect()
    },
  }
  processus.stdout.on('data', (d) => { serveur.journal += d })
  processus.stderr.on('data', (d) => { serveur.journal += d })
  await expect.poll(async () => {
    try { return (await fetch(`${serveur.url}/v1/health`)).status } catch { return 0 }
  }, { timeout: 15_000 }).toBe(200)
  return serveur
}

const etatAttendu = (cles, bytesUsed, docCount) => ({
  chainId: cles.id, bytesUsed, quotaBytes: QUOTA, maxDocBytes: MAX_DOC, maxDocs: MAX_DOCS, docCount,
})

// ---------------------------------------------------------------------------
// Création et authentification
// ---------------------------------------------------------------------------

test.describe('API Chaîne : création et preuve', () => {
  test('en-têtes absents ou mal formés : 400 partout, rien n\'est créé', async ({ request }) => {
    const cles = await nouvelleChaine()
    const routes = [
      ['post', '/v1/chain'], ['get', '/v1/chain'], ['delete', '/v1/chain'], ['get', '/v1/chain/manifest'],
      ['get', '/v1/chain/stream'], ['get', `/v1/chain/docs/${'0'.repeat(64)}`], ['put', `/v1/chain/docs/${'0'.repeat(64)}`],
    ]
    for (const [methode, route] of routes) {
      const sans = await request[methode](route)
      expect(sans.status(), `${methode} ${route}`).toBe(400)
      expect((await sans.json()).code).toBe('CHAIN_ID_INVALID')
      const sansPreuve = await request[methode](route, { headers: { 'X-Lector-Chain-Id': cles.id } })
      expect(sansPreuve.status(), `${methode} ${route}`).toBe(400)
      expect((await sansPreuve.json()).code).toBe('CHAIN_PROOF_MISSING')
    }
    for (const id of ['XYZ', cles.id.toUpperCase(), cles.id + '0']) {
      const r = await request.post('/v1/chain', { headers: enTetes(cles, { 'X-Lector-Chain-Id': id }) })
      expect((await r.json()).code).toBe('CHAIN_ID_INVALID')
    }
    for (const preuve of ['trop-courte', cles.preuve + 'A', cles.preuve.slice(0, 42) + '*']) {
      const r = await request.post('/v1/chain', { headers: enTetes(cles, { 'X-Lector-Chain-Proof': preuve }) })
      expect(r.status()).toBe(400)
      expect((await r.json()).code).toBe('CHAIN_PROOF_MISSING')
    }
    expect(await prisma.chain.count({ where: { id: cles.id } })).toBe(0)
  })

  test('création 201, idempotence 200, autre preuve 403, chaîne inconnue 404', async ({ request }) => {
    const cles = await nouvelleChaine()
    const avant = await request.get('/v1/chain', { headers: enTetes(cles) })
    expect(avant.status()).toBe(404)
    expect((await avant.json()).code).toBe('CHAIN_UNKNOWN')

    const cree = await request.post('/v1/chain', { headers: enTetes(cles) })
    expect(cree.status()).toBe(201)
    expect(await cree.json()).toEqual(etatAttendu(cles, 0, 0))

    const encore = await request.post('/v1/chain', { headers: enTetes(cles) })
    expect(encore.status()).toBe(200)
    expect(await encore.json()).toEqual(etatAttendu(cles, 0, 0))

    const autre = await nouvelleChaine()
    const usurpe = { 'X-Lector-Chain-Proof': autre.preuve }
    const vol = await request.post('/v1/chain', { headers: enTetes(cles, usurpe) })
    expect(vol.status()).toBe(403)
    expect((await vol.json()).code).toBe('CHAIN_PROOF_INVALID')
    for (const route of ['/v1/chain', '/v1/chain/manifest', '/v1/chain/stream']) {
      const r = await request.get(route, { headers: enTetes(cles, usurpe) })
      expect(r.status(), route).toBe(403)
      expect((await r.json()).code).toBe('CHAIN_PROOF_INVALID')
    }
    for (const route of ['/v1/chain', '/v1/chain/manifest', '/v1/chain/stream']) {
      const r = await request.get(route, { headers: enTetes(autre) })
      expect(r.status(), route).toBe(404)
      expect((await r.json()).code).toBe('CHAIN_UNKNOWN')
    }

    expect(await etat(request, cles)).toEqual(etatAttendu(cles, 0, 0))
    expect(await manifeste(request, cles)).toEqual({ ...etatAttendu(cles, 0, 0), docs: [] })

    // Le serveur ne garde que l'empreinte de la preuve.
    const ligne = await prisma.chain.findUnique({ where: { id: cles.id } })
    expect(ligne.proofHash).toBe(crypto.createHash('sha256').update(Buffer.from(cles.preuve, 'base64url')).digest('hex'))
    expect(JSON.stringify(ligne)).not.toContain(cles.preuve)
  })

  test('créations simultanées de la même chaîne : un seul 201, les autres 200', async ({ request }) => {
    const cles = await nouvelleChaine()
    const statuts = await Promise.all(Array.from({ length: 5 }, () => request.post('/v1/chain', { headers: enTetes(cles) }).then((r) => r.status())))
    expect(statuts.sort()).toEqual([200, 200, 200, 200, 201])
    expect(await prisma.chain.count({ where: { id: cles.id } })).toBe(1)
  })

  test('lastSeenAt : écrit au plus une fois par heure', async ({ request }) => {
    const cles = await casierNeuf(request)
    const recent = (await prisma.chain.findUnique({ where: { id: cles.id } })).lastSeenAt
    await etat(request, cles)
    await new Promise((r) => setTimeout(r, 200))
    expect((await prisma.chain.findUnique({ where: { id: cles.id } })).lastSeenAt).toEqual(recent)

    await prisma.chain.update({ where: { id: cles.id }, data: { lastSeenAt: new Date(Date.now() - 2 * HEURE) } })
    await etat(request, cles)
    await expect.poll(async () => (await prisma.chain.findUnique({ where: { id: cles.id } })).lastSeenAt.getTime())
      .toBeGreaterThan(Date.now() - 60_000)
  })
})

// ---------------------------------------------------------------------------
// Documents chiffrés : dépôt, lecture, pierres tombales, conditions
// ---------------------------------------------------------------------------

test.describe('API Chaîne : documents', () => {
  test('dépôt puis lecture d\'un autre appareil, le serveur ne voit que des blocs', async ({ request }) => {
    const cles = await casierNeuf(request)
    const texte = '# Journal intime\n\nMarqueur-contenu-7c1e : rien ne doit fuiter.\n'
    const chemin = 'Perso/Été/Journal-marqueur-chemin-91ab.md'
    marqueursJournal.push('Marqueur-contenu-7c1e', 'Journal-marqueur-chemin-91ab')
    marqueursClair.push('Marqueur-contenu-7c1e', 'Journal-marqueur-chemin-91ab')

    const { res, docId, pathEnc, contentEnc } = await pousser(request, cles, chemin, texte, { 'If-None-Match': '*', 'X-Lector-Device': 'mac-1' })
    expect(res.status()).toBe(200)
    const sha256 = crypto.createHash('sha256').update(contentEnc).digest('hex')
    expect(await res.json()).toEqual({ docId, sha256, size: contentEnc.length, bytesUsed: contentEnc.length })
    expect(res.headers().etag).toBe(sha256)
    expect(contentEnc.length).toBe(new TextEncoder().encode(texte).length + 29)

    // Un autre appareil (même S, donc mêmes clés) lit et déchiffre.
    const lu = await tirer(request, cles, docId)
    expect(lu.texte).toBe(texte)
    expect(lu.chemin).toBe(chemin)
    expect(lu.enTetes).toMatchObject({
      'etag': sha256,
      'x-lector-mtime': MTIME,
      'x-lector-path-enc': pathEnc,
      'content-type': 'application/octet-stream',
      'cache-control': 'no-store',
    })
    expect(lu.enTetes['access-control-expose-headers']).toBe('ETag,X-Lector-Path-Enc,X-Lector-Mtime')

    const m = await manifeste(request, cles)
    expect(m).toEqual({
      ...etatAttendu(cles, contentEnc.length, 1),
      docs: [{ docId, pathEnc, sha256, size: contentEnc.length, mtime: MTIME, deletedAt: null, tombEnc: null }],
    })

    // Sur disque et en base : aucun octet du clair, ni du contenu ni du chemin.
    const fichiers = fichiersSous(dossierCasier(cles))
    expect(fichiers).toEqual([cheminBloc(cles, docId)])
    expect(contientOctets(fichiers, 'Marqueur-contenu-7c1e')).toBe(false)
    expect(contientOctets(fichiers, 'Journal')).toBe(false)
    const ligne = await prisma.chainDoc.findFirst({ where: { chainId: cles.id } })
    expect(JSON.stringify(ligne)).not.toContain('Journal')
  })

  test('CORS : le web peut envoyer les en-têtes de la chaîne et lire ceux des blocs', async ({ request }) => {
    const r = await request.fetch('/v1/chain/manifest', {
      method: 'OPTIONS',
      headers: {
        'Origin': 'https://lector.dockerbop.fr',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'x-lector-chain-id,x-lector-chain-proof,x-lector-path-enc,if-match',
      },
    })
    expect(r.status()).toBe(204)
    expect(r.headers()['access-control-allow-headers']).toBe('x-lector-chain-id,x-lector-chain-proof,x-lector-path-enc,if-match')
  })

  test('pierres tombales : suppression, manifeste, 410, résurrection', async ({ request }) => {
    const cles = await casierNeuf(request)
    const garde = await pousser(request, cles, 'A/garde.md', '# Garde')
    const jete = await pousser(request, cles, 'A/jete.md', '# Jeté')
    const { docId, pathEnc } = jete
    const shaJete = (await jete.res.json()).sha256
    const tailleGarde = garde.contentEnc.length

    // Sans marque de suppression (ou avec une marque mal formée) : refusé.
    const sansMarque = await request.delete(`/v1/chain/docs/${docId}`, { headers: enTetes(cles) })
    expect(sansMarque.status()).toBe(400)
    expect((await sansMarque.json()).code).toBe('TOMB_ENC_INVALID')
    const marqueFausse = await request.delete(`/v1/chain/docs/${docId}`, { headers: enTetes(cles, { 'X-Lector-Tomb-Enc': 'AgEC' }) })
    expect(marqueFausse.status()).toBe(400)
    expect((await marqueFausse.json()).code).toBe('TOMB_ENC_INVALID')

    const laMarque = await marque(cles, docId, shaJete)
    const suppr = await request.delete(`/v1/chain/docs/${docId}`, { headers: enTetes(cles, laMarque) })
    expect(suppr.status()).toBe(204)

    const m = await manifeste(request, cles)
    expect(m.bytesUsed).toBe(tailleGarde)
    expect(m.docCount).toBe(1)
    const tombe = m.docs.find((d) => d.docId === docId)
    expect(tombe).toMatchObject({ pathEnc, sha256: '', size: 0, tombEnc: laMarque['X-Lector-Tomb-Enc'] })
    expect(tombe.deletedAt).toBeTruthy()
    // La marque se vérifie côté client : bon document, bon bloc, bonne chaîne.
    expect(await chaine.verifierTombeAvec(cles, docId, tombe.tombEnc, shaJete)).toBe(true)
    // Le chemin d'une pierre tombale reste déchiffrable par un appareil sans historique.
    expect(await chaine.dechiffrerCheminAvec(cles, docId, tombe.pathEnc)).toBe('A/jete.md')
    expect(m.docs.find((d) => d.docId === garde.docId)).toMatchObject({ deletedAt: null, tombEnc: null })

    const lu = await request.get(`/v1/chain/docs/${docId}`, { headers: enTetes(cles) })
    expect(lu.status()).toBe(410)
    expect((await lu.json()).code).toBe('DOC_DELETED')
    expect(fs.existsSync(cheminBloc(cles, docId))).toBe(false)

    // Deuxième suppression : 204 sans rien changer. Document inconnu : 404.
    expect((await request.delete(`/v1/chain/docs/${docId}`, { headers: enTetes(cles, laMarque) })).status()).toBe(204)
    expect((await manifeste(request, cles)).docs.find((d) => d.docId === docId).tombEnc).toBe(laMarque['X-Lector-Tomb-Enc'])
    const inconnu = await supprimer(request, cles, '0'.repeat(64), '')
    expect(inconnu.status()).toBe(404)
    expect((await inconnu.json()).code).toBe('DOC_UNKNOWN')
    const absent = await request.get(`/v1/chain/docs/${'0'.repeat(64)}`, { headers: enTetes(cles) })
    expect(absent.status()).toBe(404)
    expect((await absent.json()).code).toBe('DOC_UNKNOWN')

    // Résurrection : une pierre tombale compte comme « absent » pour If-None-Match, la marque disparaît.
    const revient = await pousser(request, cles, 'A/jete.md', '# Revenu', { 'If-None-Match': '*' })
    expect(revient.res.status()).toBe(200)
    expect((await tirer(request, cles, docId)).texte).toBe('# Revenu')
    const apres = await manifeste(request, cles)
    expect(apres.docs.find((d) => d.docId === docId)).toMatchObject({ deletedAt: null, tombEnc: null })
    expect(apres.docCount).toBe(2)
    expect(apres.bytesUsed).toBe(tailleGarde + revient.contentEnc.length)
  })

  test('If-Match et If-None-Match : 412 CONFLICT au lieu d\'écraser en silence', async ({ request }) => {
    const cles = await casierNeuf(request)
    const chemin = 'Conflit.md'

    const v1 = await pousser(request, cles, chemin, 'version 1', { 'If-None-Match': '*' })
    expect(v1.res.status()).toBe(200)
    const sha1 = (await v1.res.json()).sha256

    // Création alors que le document existe : 412.
    const creation = await pousser(request, cles, chemin, 'autre création', { 'If-None-Match': '*' })
    expect(creation.res.status()).toBe(412)
    expect(await creation.res.json()).toMatchObject({ code: 'CONFLICT', current: sha1 })

    const v2 = await pousser(request, cles, chemin, 'version 2', { 'If-Match': sha1 })
    expect(v2.res.status()).toBe(200)
    const sha2 = (await v2.res.json()).sha256

    // Un appareil resté sur la version 1 : refusé, le serveur garde la version 2.
    const perime = await pousser(request, cles, chemin, 'version 1 modifiée', { 'If-Match': sha1 })
    expect(perime.res.status()).toBe(412)
    expect(await perime.res.json()).toMatchObject({ code: 'CONFLICT', current: sha2 })
    expect((await tirer(request, cles, v2.docId)).texte).toBe('version 2')

    // Forme HTTP avec guillemets, et « * » (n'importe quelle version existante).
    const v3 = await pousser(request, cles, chemin, 'version 3', { 'If-Match': `"${sha2}"` })
    expect(v3.res.status()).toBe(200)
    const v4 = await pousser(request, cles, chemin, 'version 4', { 'If-Match': '*' })
    expect(v4.res.status()).toBe(200)
    const sha4 = (await v4.res.json()).sha256

    const inconnu = await pousser(request, cles, 'Inconnu.md', 'x', { 'If-Match': sha4 })
    expect(inconnu.res.status()).toBe(412)
    expect((await inconnu.res.json()).current).toBeNull()

    const supprPerimee = await supprimer(request, cles, v2.docId, sha1, { 'If-Match': sha1 })
    expect(supprPerimee.status()).toBe(412)
    expect((await supprPerimee.json()).current).toBe(sha4)
    expect((await supprimer(request, cles, v2.docId, sha4, { 'If-Match': sha4 })).status()).toBe(204)

    // Après la suppression : If-Match échoue, If-None-Match: * recrée.
    expect((await pousser(request, cles, chemin, 'v5', { 'If-Match': sha4 })).res.status()).toBe(412)
    expect((await pousser(request, cles, chemin, 'v5', { 'If-None-Match': '*' })).res.status()).toBe(200)
  })

  test('formats refusés : docId, enveloppe, pathEnc, X-Lector-Mtime, clair déguisé', async ({ request }) => {
    const cles = await casierNeuf(request)
    const doc = await chaine.chiffrerDocAvec(cles, 'Formats.md', new TextEncoder().encode('# Formats'))
    const base = enTetes(cles, { 'Content-Type': 'application/octet-stream', 'X-Lector-Path-Enc': doc.pathEnc })
    const put = (docId, data, extra = {}) => request.put(`/v1/chain/docs/${docId}`, { headers: { ...base, ...extra }, data })
    const corps = Buffer.from(doc.contentEnc)
    const code = async (r) => [r.status(), (await r.json()).code]

    expect(await code(await put('abc', corps))).toEqual([400, 'DOC_ID_INVALID'])
    expect(await code(await put(doc.docId.toUpperCase(), corps))).toEqual([400, 'DOC_ID_INVALID'])
    expect(await code(await request.get('/v1/chain/docs/pas-un-id', { headers: enTetes(cles) }))).toEqual([400, 'DOC_ID_INVALID'])
    expect(await code(await request.delete('/v1/chain/docs/pas-un-id', { headers: enTetes(cles, await marque(cles, doc.docId)) }))).toEqual([400, 'DOC_ID_INVALID'])

    // Enveloppe vide, trop courte, mauvaise version.
    expect(await code(await put(doc.docId, Buffer.alloc(0)))).toEqual([400, 'ENVELOPE_INVALID'])
    expect(await code(await put(doc.docId, Buffer.alloc(28, 1)))).toEqual([400, 'ENVELOPE_INVALID'])
    const v2 = Buffer.from(corps); v2[0] = 2
    expect(await code(await put(doc.docId, v2))).toEqual([400, 'ENVELOPE_INVALID'])

    // pathEnc absent, pas en base64url, trop long, mauvaise version, trop court.
    const sansChemin = { ...base }; delete sansChemin['X-Lector-Path-Enc']
    expect(await code(await request.put(`/v1/chain/docs/${doc.docId}`, { headers: sansChemin, data: corps }))).toEqual([400, 'PATH_ENC_INVALID'])
    expect(await code(await put(doc.docId, corps, { 'X-Lector-Path-Enc': 'pas*du+base64' }))).toEqual([400, 'PATH_ENC_INVALID'])
    expect(await code(await put(doc.docId, corps, { 'X-Lector-Path-Enc': 'A'.repeat(1501) }))).toEqual([400, 'PATH_ENC_INVALID'])
    const cheminV2 = Buffer.from(doc.pathEnc, 'base64url'); cheminV2[0] = 2
    expect(await code(await put(doc.docId, corps, { 'X-Lector-Path-Enc': cheminV2.toString('base64url') }))).toEqual([400, 'PATH_ENC_INVALID'])
    expect(await code(await put(doc.docId, corps, { 'X-Lector-Path-Enc': Buffer.alloc(29, 1).toString('base64url') }))).toEqual([400, 'PATH_ENC_INVALID'])

    expect(await code(await put(doc.docId, corps, { 'X-Lector-Mtime': 'pas-une-date' }))).toEqual([400, 'MTIME_INVALID'])
    // Une date que la base ne sait pas ranger (hors des années 0 à 9999) : refusée avant toute écriture.
    for (const date of ['+010000-01-01T00:00:00.000Z', '-000001-12-31T00:00:00.000Z']) {
      expect(await code(await put(doc.docId, corps, { 'X-Lector-Mtime': date }))).toEqual([400, 'MTIME_INVALID'])
    }

    // Du clair déguisé (premier octet 0x01 puis du Markdown) : refusé.
    const clair = Buffer.concat([Buffer.from([1]), Buffer.from('# Mon document secret, envoyé en clair par un client bogué.\n')])
    expect(await code(await put(doc.docId, clair))).toEqual([400, 'ENVELOPE_INVALID'])

    // Rien de tout cela n'a laissé de ligne fantôme ni consommé de place.
    expect(await prisma.chainDoc.count({ where: { chainId: cles.id } })).toBe(0)
    expect(await etat(request, cles)).toEqual(etatAttendu(cles, 0, 0))
    expect(fichiersSous(dossierCasier(cles))).toEqual([])

    // Sans X-Lector-Mtime : la date du serveur.
    const sansDate = await put(doc.docId, corps)
    expect(sansDate.status()).toBe(200)
    const mtime = (await manifeste(request, cles)).docs[0].mtime
    expect(Math.abs(Date.parse(mtime) - Date.now())).toBeLessThan(60_000)

    // Les deux bornes de la plage passent.
    for (const date of ['0000-01-01T00:00:00.000Z', '9999-12-31T23:59:59.999Z']) {
      expect((await put(doc.docId, corps, { 'X-Lector-Mtime': date })).status()).toBe(200)
      expect((await manifeste(request, cles)).docs[0].mtime).toBe(date)
    }
  })

  test('panne de la base pendant un dépôt : l\'ancien bloc reste servi sous son empreinte, aucun fichier en trop', async ({ request }) => {
    const cles = await casierNeuf(request)
    const v1 = await pousser(request, cles, 'Panne/doc.md', '# Version 1', { 'If-None-Match': '*' })
    expect(v1.res.status()).toBe(200)
    const sha1 = (await v1.res.json()).sha256
    const avant = await etat(request, cles)

    // Toute écriture d'une ligne de ce casier échoue, comme une base pleine ou verrouillée.
    const operations = ['INSERT', 'UPDATE']
    for (const op of operations) {
      await prisma.$executeRawUnsafe(`CREATE TRIGGER panne_${op} BEFORE ${op} ON "ChainDoc" WHEN NEW."chainId" = '${cles.id}' BEGIN SELECT RAISE(ABORT, 'simulated failure'); END`)
    }
    try {
      const v2 = await pousser(request, cles, 'Panne/doc.md', '# Version 2, plus longue que la première', { 'If-Match': sha1 })
      expect(v2.res.status()).toBe(500)
      const neuf = await pousser(request, cles, 'Panne/neuf.md', '# Neuf', { 'If-None-Match': '*' })
      expect(neuf.res.status()).toBe(500)
    } finally {
      for (const op of operations) await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS panne_${op}`)
    }

    const lu = await tirer(request, cles, v1.docId)
    expect(lu.texte).toBe('# Version 1')
    expect(lu.enTetes.etag).toBe(sha1)
    expect(fichiersSous(dossierCasier(cles))).toEqual([cheminBloc(cles, v1.docId)])
    expect(await etat(request, cles)).toEqual(avant)
    const verif = await request.get('/v1/chain/verify', { headers: enTetes(cles) })
    expect(await verif.json()).toMatchObject({ blocs: 1, empreintesFausses: 0, orphelins: 0, ok: true })
  })
})

// ---------------------------------------------------------------------------
// Quota : trois 413 distincts
// ---------------------------------------------------------------------------

test.describe('API Chaîne : quota', () => {
  test('DOC_TOO_LARGE au-delà de la limite par document, accepté juste à la limite', async ({ request }) => {
    const cles = await casierNeuf(request)
    const doc = await chaine.chiffrerDocAvec(cles, 'Gros.md', new TextEncoder().encode('# Gros'))
    const put = (data) => request.put(`/v1/chain/docs/${doc.docId}`, {
      headers: enTetes(cles, { 'Content-Type': 'application/octet-stream', 'X-Lector-Path-Enc': doc.pathEnc }),
      data,
    })
    const gros = crypto.randomBytes(MAX_BLOC + 1); gros[0] = 1
    const trop = await put(gros)
    expect(trop.status()).toBe(413)
    expect(await trop.json()).toMatchObject({ code: 'DOC_TOO_LARGE', maxDocBytes: MAX_DOC })
    expect(fichiersSous(dossierCasier(cles))).toEqual([])
    expect((await etat(request, cles)).bytesUsed).toBe(0)

    const limite = await chaine.chiffrerContenuAvec(cles, doc.docId, crypto.randomBytes(MAX_DOC))
    expect(limite.length).toBe(MAX_BLOC)
    expect((await put(Buffer.from(limite))).status()).toBe(200)
    expect(await etat(request, cles)).toEqual(etatAttendu(cles, MAX_BLOC, 1))
  })

  test('QUOTA_EXCEEDED : bloc refusé sans trace, bytesUsed exact après re-dépôt et suppression', async ({ request }) => {
    const cles = await casierNeuf(request)
    const tailles = new Map()
    const verifierCompteur = async () => {
      const attendu = [...tailles.values()].reduce((n, t) => n + t, 0)
      expect(await etat(request, cles)).toEqual(etatAttendu(cles, attendu, tailles.size))
      return attendu
    }
    const deposer = async (chemin, contenu) => {
      const d = await pousser(request, cles, chemin, contenu)
      if (d.res.status() === 200) tailles.set(d.docId, d.contentEnc.length)
      return d
    }

    // Trois blocs pleins : 3 x (64 Kio + 29) tiennent dans 256 Kio, pas quatre.
    const [d1, d2, d3] = [await deposer('Q/1.md', crypto.randomBytes(MAX_DOC)), await deposer('Q/2.md', crypto.randomBytes(MAX_DOC)), await deposer('Q/3.md', crypto.randomBytes(MAX_DOC))]
    for (const d of [d1, d2, d3]) expect(d.res.status()).toBe(200)
    expect(await verifierCompteur()).toBe(3 * MAX_BLOC)

    const d4 = await deposer('Q/4.md', crypto.randomBytes(MAX_DOC))
    expect(d4.res.status()).toBe(413)
    expect(await d4.res.json()).toMatchObject({ code: 'QUOTA_EXCEEDED', bytesUsed: 3 * MAX_BLOC, quotaBytes: QUOTA, size: MAX_BLOC })
    expect(fs.existsSync(cheminBloc(cles, d4.docId))).toBe(false)
    expect(await prisma.chainDoc.count({ where: { chainId: cles.id, docId: d4.docId } })).toBe(0)
    await verifierCompteur()

    // Re-dépôt de même taille : rien ne compte double.
    expect((await deposer('Q/2.md', crypto.randomBytes(MAX_DOC))).res.status()).toBe(200)
    await verifierCompteur()
    // Re-dépôt plus petit : la place est rendue, et le quatrième tient.
    expect((await deposer('Q/1.md', '# Court')).res.status()).toBe(200)
    await verifierCompteur()
    expect((await deposer('Q/4.md', crypto.randomBytes(MAX_DOC))).res.status()).toBe(200)
    await verifierCompteur()

    // Un re-dépôt qui grossit au-delà du quota est refusé : l'ancienne version reste.
    const grossi = await deposer('Q/1.md', crypto.randomBytes(MAX_DOC))
    expect(grossi.res.status()).toBe(413)
    expect((await grossi.res.json()).code).toBe('QUOTA_EXCEEDED')
    expect((await tirer(request, cles, d1.docId)).texte).toBe('# Court')
    await verifierCompteur()

    // La suppression libère la place du bloc.
    const sha2 = (await manifeste(request, cles)).docs.find((d) => d.docId === d2.docId).sha256
    expect((await supprimer(request, cles, d2.docId, sha2)).status()).toBe(204)
    tailles.delete(d2.docId)
    await verifierCompteur()
    expect((await deposer('Q/1.md', crypto.randomBytes(MAX_DOC))).res.status()).toBe(200)
    const total = await verifierCompteur()
    expect(total).toBe(3 * MAX_BLOC)

    // Le manifeste et le vérificateur disent la même chose.
    const m = await manifeste(request, cles)
    expect(m.bytesUsed).toBe(m.docs.filter((d) => !d.deletedAt).reduce((n, d) => n + d.size, 0))
    const { code, rapport } = lancerVerificateur(['--chain', cles.id])
    expect(code).toBe(0)
    expect(rapport.rapports[0]).toMatchObject({ blocs: 3, octets: total, orphelins: 0, ok: true })
  })

  test('TOO_MANY_DOCS : nombre de documents plafonné, une suppression libère une place', async ({ request }) => {
    const cles = await casierNeuf(request)
    const docs = []
    for (let i = 0; i < MAX_DOCS; i++) {
      const d = await pousser(request, cles, `N/${i}.md`, `# ${i}`)
      expect(d.res.status()).toBe(200)
      docs.push({ ...d, sha256: (await d.res.json()).sha256 })
    }
    const trop = await pousser(request, cles, 'N/de-trop.md', '# De trop')
    expect(trop.res.status()).toBe(413)
    expect(await trop.res.json()).toMatchObject({ code: 'TOO_MANY_DOCS', docCount: MAX_DOCS, maxDocs: MAX_DOCS })
    expect(fs.existsSync(cheminBloc(cles, trop.docId))).toBe(false)

    // Réécrire un document existant reste possible.
    expect((await pousser(request, cles, 'N/0.md', '# Zéro modifié')).res.status()).toBe(200)

    expect((await supprimer(request, cles, docs[1].docId, docs[1].sha256)).status()).toBe(204)
    expect((await etat(request, cles)).docCount).toBe(MAX_DOCS - 1)
    expect((await pousser(request, cles, 'N/de-trop.md', '# De trop')).res.status()).toBe(200)
    // Ressusciter une pierre tombale compte comme un nouveau document.
    const retour = await pousser(request, cles, 'N/1.md', '# Un')
    expect(retour.res.status()).toBe(413)
    expect((await retour.res.json()).code).toBe('TOO_MANY_DOCS')
    expect((await etat(request, cles)).docCount).toBe(MAX_DOCS)
  })

  test('dépôts parallèles : le quota tient (réservation atomique)', async ({ request }) => {
    const cles = await casierNeuf(request)
    const docs = await Promise.all(Array.from({ length: 6 }, (_, i) => chaine.chiffrerDocAvec(cles, `P/${i}.md`, crypto.randomBytes(MAX_DOC))))
    const reponses = await Promise.all(docs.map((d) => request.put(`/v1/chain/docs/${d.docId}`, {
      headers: enTetes(cles, { 'Content-Type': 'application/octet-stream', 'X-Lector-Path-Enc': d.pathEnc }),
      data: Buffer.from(d.contentEnc),
    })))
    const statuts = reponses.map((r) => r.status())
    const places = Math.floor(QUOTA / MAX_BLOC)
    expect(statuts.filter((s) => s === 200)).toHaveLength(places)
    expect(statuts.filter((s) => s === 413)).toHaveLength(6 - places)
    expect(await etat(request, cles)).toEqual(etatAttendu(cles, places * MAX_BLOC, places))
    expect(fichiersSous(dossierCasier(cles))).toHaveLength(places)
    expect(await prisma.chainDoc.count({ where: { chainId: cles.id } })).toBe(places)
  })
})

// ---------------------------------------------------------------------------
// Tout effacer, nouvelle chaîne, purge
// ---------------------------------------------------------------------------

test.describe('API Chaîne : effacement et purge', () => {
  test('tout effacer : 204, puis 404 partout, disque et base vides ; nouvelle chaîne intacte', async ({ request }) => {
    const ancienne = await casierNeuf(request)
    const a = await pousser(request, ancienne, 'Notes/a.md', '# A')
    await pousser(request, ancienne, 'Notes/b.md', '# B')
    const sha = (await a.res.json()).sha256
    expect((await supprimer(request, ancienne, a.docId, sha)).status()).toBe(204)

    // « Nouvelle chaîne » côté client : créer, recopier, puis effacer l'ancienne.
    const nouvelle = await casierNeuf(request)
    expect((await pousser(request, nouvelle, 'Notes/b.md', '# B')).res.status()).toBe(200)

    const efface = await request.delete('/v1/chain', { headers: enTetes(ancienne) })
    expect(efface.status()).toBe(204)
    for (const [methode, route] of [['get', '/v1/chain'], ['get', '/v1/chain/manifest'], ['delete', '/v1/chain'], ['get', `/v1/chain/docs/${a.docId}`]]) {
      const r = await request[methode](route, { headers: enTetes(ancienne) })
      expect(r.status(), `${methode} ${route}`).toBe(404)
      expect((await r.json()).code).toBe('CHAIN_UNKNOWN')
    }
    expect((await pousser(request, ancienne, 'Notes/c.md', '# C')).res.status()).toBe(404)
    expect(fs.existsSync(dossierCasier(ancienne))).toBe(false)
    expect(await prisma.chain.count({ where: { id: ancienne.id } })).toBe(0)
    expect(await prisma.chainDoc.count({ where: { chainId: ancienne.id } })).toBe(0)

    // La nouvelle chaîne n'a rien perdu.
    const m = await manifeste(request, nouvelle)
    expect(m.docs).toHaveLength(1)
    expect((await tirer(request, nouvelle, m.docs[0].docId)).texte).toBe('# B')

    // Recréer un casier avec le même S après effacement : autorisé, vide.
    const recree = await request.post('/v1/chain', { headers: enTetes(ancienne) })
    expect(recree.status()).toBe(201)
    expect(await manifeste(request, ancienne)).toEqual({ ...etatAttendu(ancienne, 0, 0), docs: [] })
  })

  test('purge quotidienne : pierres tombales de plus de 30 jours, casiers inactifs depuis 180 jours', async ({ request }) => {
    process.env.CHAIN_FILES_ROOT = ENV_TEST.CHAIN_FILES_ROOT
    const { purger } = require(path.join(BACK, 'services', 'casiers.js'))

    const inactif = await casierNeuf(request)
    await pousser(request, inactif, 'Vieux.md', '# Vieux')
    // Inactif depuis 179 jours : encore gardé.
    const presque = await casierNeuf(request)
    const actif = await casierNeuf(request)
    const garde = await pousser(request, actif, 'Garde.md', '# Garde')
    const vieille = await pousser(request, actif, 'Vieille.md', '# Vieille')
    const recente = await pousser(request, actif, 'Recente.md', '# Récente')
    expect((await supprimer(request, actif, vieille.docId, (await vieille.res.json()).sha256)).status()).toBe(204)
    expect((await supprimer(request, actif, recente.docId, (await recente.res.json()).sha256)).status()).toBe(204)

    await prisma.chainDoc.update({
      where: { chainId_docId: { chainId: actif.id, docId: vieille.docId } },
      data: { deletedAt: new Date(Date.now() - 31 * JOUR) },
    })
    await prisma.chain.update({ where: { id: inactif.id }, data: { lastSeenAt: new Date(Date.now() - 181 * JOUR) } })
    await prisma.chain.update({ where: { id: presque.id }, data: { lastSeenAt: new Date(Date.now() - 179 * JOUR) } })
    // Dossier de casier sans ligne en base (effacement dont le disque a résisté).
    const fantome = path.join(ENV_TEST.CHAIN_FILES_ROOT, crypto.randomBytes(16).toString('hex'))
    fs.mkdirSync(path.join(fantome, 'ab'), { recursive: true })
    fs.writeFileSync(path.join(fantome, 'ab', 'a'.repeat(64)), crypto.randomBytes(64))

    const bilan = await purger(prisma)
    expect(bilan.pierresTombales).toBeGreaterThanOrEqual(1)
    expect(bilan.casiers).toBeGreaterThanOrEqual(1)
    expect(bilan.fantomes).toBeGreaterThanOrEqual(1)
    expect(fs.existsSync(fantome)).toBe(false)

    expect(await prisma.chain.count({ where: { id: inactif.id } })).toBe(0)
    expect(await prisma.chainDoc.count({ where: { chainId: inactif.id } })).toBe(0)
    expect(fs.existsSync(dossierCasier(inactif))).toBe(false)
    expect((await request.get('/v1/chain', { headers: enTetes(inactif) })).status()).toBe(404)
    expect(await prisma.chain.count({ where: { id: presque.id } })).toBe(1)

    const m = await manifeste(request, actif)
    expect(m.docs.map((d) => d.docId).sort()).toEqual([garde.docId, recente.docId].sort())
    expect(m.docs.find((d) => d.docId === recente.docId).deletedAt).toBeTruthy()
  })

  test('purge : un casier redevenu actif entre la liste des inactifs et l\'effacement est gardé', async ({ request }) => {
    process.env.CHAIN_FILES_ROOT = ENV_TEST.CHAIN_FILES_ROOT
    const { purger } = require(path.join(BACK, 'services', 'casiers.js'))

    const parti = await casierNeuf(request)
    const revenu = await casierNeuf(request)
    const doc = await pousser(request, revenu, 'Revenu.md', '# Revenu')
    expect(doc.res.status()).toBe(200)
    await prisma.chain.updateMany({ where: { id: { in: [parti.id, revenu.id] } }, data: { lastSeenAt: new Date(Date.now() - 200 * JOUR) } })

    // Un appareil de `revenu` se reconnecte juste après la lecture des casiers inactifs.
    const surChain = (table) => new Proxy(table, {
      get: (cible, methode) => (methode !== 'findMany' ? cible[methode].bind(cible) : async (...args) => {
        const liste = await cible.findMany(...args)
        await cible.updateMany({ where: { id: revenu.id }, data: { lastSeenAt: new Date() } })
        return liste
      }),
    })
    const espion = new Proxy(prisma, { get: (cible, nom) => (nom === 'chain' ? surChain(cible.chain) : cible[nom]) })
    await purger(espion)

    expect(await prisma.chain.count({ where: { id: parti.id } })).toBe(0)
    expect(await prisma.chain.count({ where: { id: revenu.id } })).toBe(1)
    expect((await tirer(request, revenu, doc.docId)).texte).toBe('# Revenu')
  })
})

// ---------------------------------------------------------------------------
// Flux temps réel
// ---------------------------------------------------------------------------

test.describe('API Chaîne : flux', () => {
  test('SSE par chaîne : put et delete avec docId et appareil, rien d\'une autre chaîne, fermé à l\'effacement', async ({ request }) => {
    const cles = await casierNeuf(request)
    const autre = await casierNeuf(request)

    const arret = new AbortController()
    const flux = await fetch(`${BASE}/v1/chain/stream`, { headers: enTetes(cles), signal: arret.signal })
    expect(flux.status).toBe(200)
    expect(flux.headers.get('content-type')).toContain('text/event-stream')
    const lecteur = flux.body.getReader()
    let tampon = ''
    let fini = false
    const attendre = async (motif) => {
      const limite = Date.now() + 5000
      while (!motif.test(tampon) && !fini) {
        if (Date.now() > limite) throw new Error(`SSE : ${motif} non reçu`)
        const { value, done } = await lecteur.read()
        if (done) { fini = true; break }
        tampon += new TextDecoder().decode(value)
      }
    }
    await attendre(/: connected/)

    // Une écriture sur une autre chaîne n'arrive pas ici.
    expect((await pousser(request, autre, 'Ailleurs.md', '# Ailleurs')).res.status()).toBe(200)

    marqueursJournal.push('Marqueur-SSE-0b7e')
    marqueursClair.push('Marqueur-SSE-0b7e')
    const doc = await pousser(request, cles, 'Secret/Marqueur-SSE-0b7e.md', '# SSE', { 'X-Lector-Device': 'appareil-a' })
    const sha = (await doc.res.json()).sha256
    await attendre(/"kind":"put"/)
    expect((await supprimer(request, cles, doc.docId, sha, { 'X-Lector-Device': 'pas un identifiant valide' })).status()).toBe(204)
    await attendre(/"kind":"delete"/)

    const evenements = [...tampon.matchAll(/event: vault-change\ndata: (.+)\n\n/g)].map((m) => JSON.parse(m[1]))
    expect(evenements).toEqual([
      { kind: 'put', docId: doc.docId, actorDevice: 'appareil-a' },
      { kind: 'delete', docId: doc.docId, actorDevice: null },
    ])
    for (const secret of ['Marqueur-SSE-0b7e', doc.pathEnc, cles.preuve, sha]) expect(tampon).not.toContain(secret)

    // Tout effacer ferme le flux : à la reconnexion, l'appareil apprend que la chaîne n'existe plus.
    expect((await request.delete('/v1/chain', { headers: enTetes(cles) })).status()).toBe(204)
    await attendre(/jamais/)
    expect(fini).toBe(true)
    arret.abort()
    expect((await fetch(`${BASE}/v1/chain/stream`, { headers: enTetes(cles) })).status).toBe(404)
  })

  test('flux : 10 par IP au plus, puis 503 STREAM_CAPACITY ; une autre IP passe', async ({ request }) => {
    const cles = await casierNeuf(request)
    const arrets = []
    const ouvrir = (ip) => {
      const arret = new AbortController()
      arrets.push(arret)
      return fetch(`${BASE}/v1/chain/stream`, { headers: enTetes(cles, { 'X-Forwarded-For': ip }), signal: arret.signal })
    }
    try {
      for (let i = 0; i < 10; i++) expect((await ouvrir('198.51.100.60')).status).toBe(200)
      const refus = await ouvrir('198.51.100.60')
      expect(refus.status).toBe(503)
      expect((await refus.json()).code).toBe('STREAM_CAPACITY')
      expect((await ouvrir('198.51.100.61')).status).toBe(200)
    } finally {
      for (const arret of arrets) arret.abort()
    }
  })

  test('flux jamais lu : coupé au-delà de 64 Kio en attente ; à l\'effacement, un lecteur bloqué est coupé et un lecteur sain reçoit une fin propre', async () => {
    const express = require(path.join(BACK, 'node_modules', 'express'))
    const flux = require(path.join(BACK, 'services', 'fluxChaine.js'))
    const chainId = crypto.randomBytes(16).toString('hex')
    const reponses = []
    const app = express()
    app.get('/s', (req, res) => {
      if (flux.ouvrir(chainId, res, req.query.ip)) reponses.push(res)
      else res.status(503).end()
    })
    const serveur = app.listen(0, '127.0.0.1')
    await new Promise((ok) => serveur.once('listening', ok))
    const sockets = []
    // Ouvre un flux par un socket brut ; un lecteur « lent » ne lit plus rien après l'en-tête.
    const brancher = (ip) => new Promise((ok) => {
      const s = net.connect(serveur.address().port, '127.0.0.1')
      sockets.push(s)
      s.write(`GET /s?ip=${ip} HTTP/1.1\r\nHost: x\r\n\r\n`)
      s.once('data', () => {
        if (ip === 'lent') s.pause()
        ok({ s, res: reponses.at(-1) })
      })
    })
    const evenement = { kind: 'put', docId: 'f'.repeat(64), actorDevice: 'A'.repeat(64) }
    const tour = () => new Promise((ok) => setImmediate(ok))
    try {
      const lents = [await brancher('lent'), await brancher('lent'), await brancher('lent')]
      const sain = await brancher('sain')
      let recu = ''
      sain.s.on('data', (d) => { recu += d })

      for (let i = 0; i < 20_000 && lents.some((l) => !l.res.destroyed); i++) {
        flux.diffuser(chainId, evenement)
        if (i % 20 === 0) await tour()
      }
      for (const l of lents) expect(l.res.destroyed).toBe(true)
      expect(sain.res.destroyed).toBe(false)

      // Lecteur bloqué avec moins de 64 Kio en attente : l'effacement le coupe sans attendre qu'il lise.
      const bloque = await brancher('lent')
      while (!bloque.res.writableLength) {
        flux.diffuser(chainId, evenement)
        await tour()
      }
      flux.fermer(chainId)
      expect(bloque.res.destroyed).toBe(true)
      // Le lecteur sain reçoit la fin de la réponse (dernier morceau vide), sans coupure.
      await expect.poll(() => recu.endsWith('\r\n0\r\n\r\n')).toBe(true)
    } finally {
      for (const s of sockets) s.destroy()
      serveur.close()
    }
  })
})

// ---------------------------------------------------------------------------
// Vérification du casier
// ---------------------------------------------------------------------------

test.describe('API Chaîne : vérification', () => {
  test('verifier-chaine.js : compteurs, orphelins, blocs manquants, fantômes, --recount', async ({ request }) => {
    const cles = await casierNeuf(request)
    const a = await pousser(request, cles, 'V/a.md', '# A')
    await pousser(request, cles, 'V/b.md', '# B')
    const total = (await etat(request, cles)).bytesUsed

    let r = lancerVerificateur(['--chain', cles.id])
    expect(r.code).toBe(0)
    expect(r.rapport).toMatchObject({ chaines: 1, problemes: 0 })
    expect(r.rapport.rapports[0]).toMatchObject({
      chain: cles.id.slice(0, 8), blocs: 2, octets: total, blocsManquants: 0, empreintesFausses: 0,
      blocsSuspects: 0, orphelins: 0, compteurs: { bytesUsed: total, docCount: 2 }, ok: true,
    })
    expect(JSON.stringify(r.rapport)).not.toContain(cles.id)
    const parRoute = await request.get('/v1/chain/verify', { headers: enTetes(cles) })
    expect(parRoute.status()).toBe(200)
    expect(await parRoute.json()).toMatchObject({ blocs: 2, ok: true })

    // Dérive du compteur et fichier orphelin (écriture interrompue).
    await prisma.chain.update({ where: { id: cles.id }, data: { bytesUsed: { increment: 7 }, docCount: { increment: 1 } } })
    const orphelin = path.join(dossierCasier(cles), 'ff', 'f'.repeat(64))
    fs.mkdirSync(path.dirname(orphelin), { recursive: true })
    fs.writeFileSync(orphelin, crypto.randomBytes(100))
    r = lancerVerificateur(['--chain', cles.id])
    expect(r.code).toBe(1)
    expect(r.rapport.rapports[0]).toMatchObject({
      orphelins: 1, compteurs: { bytesUsed: total + 7, docCount: 3 }, attendu: { bytesUsed: total, docCount: 2 }, ok: false,
    })

    r = lancerVerificateur(['--chain', cles.id, '--recount'])
    expect(r.code).toBe(0)
    expect(r.rapport.rapports[0]).toMatchObject({ orphelins: 0, compteurs: { bytesUsed: total, docCount: 2 }, ok: true })
    expect(fs.existsSync(orphelin)).toBe(false)
    expect(await etat(request, cles)).toEqual(etatAttendu(cles, total, 2))

    // Bloc disparu du disque : signalé, et la lecture répond 404.
    fs.rmSync(cheminBloc(cles, a.docId))
    r = lancerVerificateur(['--chain', cles.id])
    expect(r.code).toBe(1)
    expect(r.rapport.rapports[0].blocsManquants).toBe(1)
    expect((await request.get(`/v1/chain/docs/${a.docId}`, { headers: enTetes(cles) })).status()).toBe(404)

    // Dossier de casier sans chaîne en base.
    const fantome = crypto.randomBytes(16).toString('hex')
    fs.mkdirSync(path.join(ENV_TEST.CHAIN_FILES_ROOT, fantome, 'aa'), { recursive: true })
    r = lancerVerificateur(['--all'])
    expect(r.rapport.fantomes).toContain(fantome.slice(0, 8))
    fs.rmSync(path.join(ENV_TEST.CHAIN_FILES_ROOT, fantome), { recursive: true })

    expect(lancerVerificateur([]).code).toBe(2)
    expect(lancerVerificateur(['--chain', 'pas-un-id']).code).toBe(2)
    expect(lancerVerificateur(['--chain', crypto.randomBytes(16).toString('hex')]).code).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Écritures en rafale : serveur et dossier à part. Le scénario de bout en bout,
// lancé en parallèle, lit tous les fichiers du dossier du serveur principal :
// des fichiers qui apparaissent et disparaissent sans cesse le gêneraient.
// ---------------------------------------------------------------------------

test.describe('API Chaîne : écritures en rafale (serveur à part)', () => {
  let serveur

  test.beforeAll(async () => {
    serveur = await lancerServeur('rafale', PORT_TEST + 2, {})
  })

  test.afterAll(async () => {
    await serveur?.arreter()
  })

  test('tout effacer pendant que d\'autres appareils déposent : 204, plus rien en base ni sur le disque', async ({ request }) => {
    const r = vers(request, serveur.url)
    for (let essai = 0; essai < 5; essai++) {
      const cles = await casierNeuf(r)
      const docs = await Promise.all(Array.from({ length: 8 }, (_, i) => chaine.chiffrerDocAvec(cles, `Efface/${i}.md`, crypto.randomBytes(16 * 1024))))
      let arret = false
      const ecrire = async (d) => {
        while (!arret) {
          const res = await fetch(`${serveur.url}/v1/chain/docs/${d.docId}`, {
            method: 'PUT',
            headers: enTetes(cles, { 'Content-Type': 'application/octet-stream', 'X-Lector-Path-Enc': d.pathEnc }),
            body: d.contentEnc,
          })
          await res.arrayBuffer()
        }
      }
      const ecrivains = docs.map(ecrire)
      await new Promise((ok) => setTimeout(ok, 150))
      const efface = await r.delete('/v1/chain', { headers: enTetes(cles) })
      arret = true
      await Promise.all(ecrivains)
      expect(efface.status(), `essai ${essai}`).toBe(204)
      expect(await serveur.base.chain.count({ where: { id: cles.id } })).toBe(0)
      expect(await serveur.base.chainDoc.count({ where: { chainId: cles.id } })).toBe(0)
      expect(fichiersSous(path.join(serveur.racine, cles.id))).toEqual([])
    }
  })

  test('pierres tombales : au plus maxDocs par casier, les plus anciennes partent d\'abord', async ({ request }) => {
    const r = vers(request, serveur.url)
    const cles = await casierNeuf(r)
    const supprimes = []
    for (let i = 0; i < MAX_DOCS + 5; i++) {
      const d = await pousser(r, cles, `Tombes/${i}.md`, `# ${i}`)
      expect(d.res.status()).toBe(200)
      expect((await supprimer(r, cles, d.docId, (await d.res.json()).sha256)).status()).toBe(204)
      supprimes.push(d.docId)
    }
    const m = await manifeste(r, cles)
    expect(m).toMatchObject({ bytesUsed: 0, docCount: 0 })
    expect(m.docs).toHaveLength(MAX_DOCS)
    expect(await serveur.base.chainDoc.count({ where: { chainId: cles.id } })).toBe(MAX_DOCS)
    const restes = m.docs.map((d) => d.docId)
    expect(restes).not.toContain(supprimes[0])
    expect(restes).toContain(supprimes.at(-1))
  })
})

// ---------------------------------------------------------------------------
// Anti-abus : second serveur avec les limiteurs actifs
// ---------------------------------------------------------------------------

test.describe('API Chaîne : anti-abus (CHAIN_RATE_LIMITS=on)', () => {
  const PORT_ABUS = PORT_TEST + 1
  const BASE_ABUS = `http://localhost:${PORT_ABUS}`
  const MAX_CHAINES_ABUS = 30
  let serveur

  test.beforeAll(async () => {
    serveur = await lancerServeur('abus', PORT_ABUS, { CHAIN_RATE_LIMITS: 'on', CHAIN_MAX_CHAINS: String(MAX_CHAINES_ABUS) })
  })

  test.afterAll(async () => {
    await serveur?.arreter()
  })

  const depuis = (ip, cles, extra = {}) => ({ headers: enTetes(cles, { 'X-Forwarded-For': ip, ...extra }) })

  test('création : 5 casiers par IP et par heure, la reprise idempotente passe toujours', async ({ request }) => {
    const casiers = []
    for (let i = 0; i < 5; i++) {
      const cles = await nouvelleChaine()
      const r = await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.7', cles))
      expect(r.status()).toBe(201)
      casiers.push(cles)
    }
    const sixieme = await nouvelleChaine()
    const limite = await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.7', sixieme))
    expect(limite.status()).toBe(429)
    expect((await limite.json()).code).toBe('CHAIN_CREATE_LIMITED')
    expect((await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.7', casiers[0]))).status()).toBe(200)
    expect((await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.8', sixieme))).status()).toBe(201)
  })

  test('preuves fausses : 10 par (IP, chaîne) puis 429, la bonne preuve passe toujours', async ({ request }) => {
    const cible = await nouvelleChaine()
    const voisine = await nouvelleChaine()
    for (const cles of [cible, voisine]) {
      expect((await request.post(`${BASE_ABUS}/v1/chain`, depuis('203.0.113.9', cles))).status()).toBe(201)
    }
    const fausse = { 'X-Lector-Chain-Proof': voisine.preuve }
    for (let i = 0; i < 10; i++) {
      const r = await request.get(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.20', cible, fausse))
      expect(r.status()).toBe(403)
      expect((await r.json()).code).toBe('CHAIN_PROOF_INVALID')
    }
    const bloque = await request.get(`${BASE_ABUS}/v1/chain/manifest`, depuis('198.51.100.20', cible, fausse))
    expect(bloque.status()).toBe(429)
    expect((await bloque.json()).code).toBe('CHAIN_PROOF_LIMITED')
    // La création avec une autre preuve passe par le même compteur.
    expect((await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.20', cible, fausse))).status()).toBe(429)

    // Jamais de blocage par chaîne seule : la bonne preuve passe, même depuis
    // cette IP ; une autre IP et une autre chaîne gardent leur propre compteur.
    expect((await request.get(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.20', cible))).status()).toBe(200)
    expect((await request.get(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.21', cible, fausse))).status()).toBe(403)
    const autreChaine = { 'X-Lector-Chain-Proof': cible.preuve }
    expect((await request.get(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.20', voisine, autreChaine))).status()).toBe(403)
  })

  test('créations en rafale depuis une IP : exactement 5, les autres 429', async ({ request }) => {
    const lot = await Promise.all(Array.from({ length: 30 }, () => nouvelleChaine()))
    const statuts = await Promise.all(lot.map(async (cles) => (await request.post(`${BASE_ABUS}/v1/chain`, depuis('198.51.100.30', cles))).status()))
    expect(statuts.filter((s) => s === 201)).toHaveLength(5)
    expect(statuts.filter((s) => s === 429)).toHaveLength(25)
  })

  test('IPv6 : toutes les adresses d\'un même /64 comptent comme une seule IP', async ({ request }) => {
    const creer = async (ip) => (await request.post(`${BASE_ABUS}/v1/chain`, depuis(ip, await nouvelleChaine()))).status()
    for (let i = 1; i <= 5; i++) expect(await creer(`2001:db8:5:6::${i}`)).toBe(201)
    expect(await creer('2001:db8:5:6:ffff:1:2:3')).toBe(429)
    expect(await creer('2001:db8:5:7::1')).toBe(201)
  })

  test('plafond global de casiers : jamais dépassé, même en rafale depuis des IP différentes', async ({ request }) => {
    const avant = await serveur.base.chain.count()
    const places = MAX_CHAINES_ABUS - avant
    expect(places).toBeGreaterThan(0)
    const lot = await Promise.all(Array.from({ length: places + 10 }, () => nouvelleChaine()))
    const statuts = await Promise.all(lot.map(async (cles, i) => (await request.post(`${BASE_ABUS}/v1/chain`, depuis(`192.0.2.${i + 1}`, cles))).status()))
    expect(await serveur.base.chain.count()).toBe(MAX_CHAINES_ABUS)
    expect(statuts.filter((s) => s === 201)).toHaveLength(places)
    expect(statuts.filter((s) => s === 503)).toHaveLength(10)
  })

  test('journal du second serveur : ni IP, ni preuve, ni id complet', async () => {
    const journalAbus = serveur.journal
    expect(journalAbus).toContain('[Lector API]')
    expect(journalAbus).toMatch(/\[chain [0-9a-f]{8}\] invalid proof/)
    for (const ip of ['198.51.100.', '203.0.113.', '192.0.2.', '2001:db8']) expect(journalAbus).not.toContain(ip)
    for (const marqueur of marqueursJournal) {
      expect(journalAbus, `« ${marqueur} » trouvé dans le journal`).not.toContain(marqueur)
    }
  })
})

// ---------------------------------------------------------------------------
// Limite anti-partage : serveur à part, limiteurs actifs, fenêtre raccourcie
// ---------------------------------------------------------------------------

test.describe('API Chaîne : limite anti-partage (réseaux lecteurs)', () => {
  const FENETRE_MS = 6000
  let serveur

  test.beforeAll(async () => {
    // Seuil par défaut (8) : CHAIN_READ_NETWORKS_MAX n'est pas fixé.
    serveur = await lancerServeur('reseaux', PORT_TEST + 3, { CHAIN_RATE_LIMITS: 'on', CHAIN_READ_NETWORKS_WINDOW_MS: String(FENETRE_MS) })
  })

  test.afterAll(async () => {
    await serveur?.arreter()
  })

  const depuis = (ip, cles, extra = {}) => ({ headers: enTetes(cles, { 'X-Forwarded-For': ip, ...extra }) })
  const lire = async (request, ip, cles, route = '/v1/chain/manifest') => request.get(`${serveur.url}${route}`, depuis(ip, cles))

  async function casier(request) {
    const cles = await nouvelleChaine()
    expect((await request.post(`${serveur.url}/v1/chain`, depuis('192.0.2.1', cles))).status()).toBe(201)
    return cles
  }

  test('8 réseaux lisent, le 9e reçoit 429, un réseau déjà vu passe encore, puis la fenêtre expire', async ({ request }) => {
    const cles = await casier(request)
    const r = vers(request, serveur.url)
    const doc = await pousser(r, cles, 'Partage.md', '# Partage')
    expect(doc.res.status()).toBe(200)

    for (let i = 0; i < 8; i++) {
      expect((await lire(request, `198.18.${i}.7`, cles)).status(), `réseau ${i}`).toBe(200)
    }
    // Une autre adresse d'un /24 déjà vu : même réseau.
    expect((await lire(request, '198.18.0.200', cles, `/v1/chain/docs/${doc.docId}`)).status()).toBe(200)

    const refus = await lire(request, '198.18.8.7', cles)
    expect(refus.status()).toBe(429)
    const corps = await refus.json()
    expect(corps.code).toBe('CHAIN_READ_LIMITED')
    expect(corps.error).toMatch(/too many different networks/)
    expect(Number(refus.headers()['retry-after'])).toBeGreaterThan(0)
    // Toutes les lectures du nouveau réseau sont refusées, flux et blocs compris.
    expect((await lire(request, '198.18.8.8', cles, `/v1/chain/docs/${doc.docId}`)).status()).toBe(429)
    expect((await lire(request, '198.18.8.9', cles, '/v1/chain')).status()).toBe(429)

    // Un réseau déjà vu continue.
    expect((await lire(request, '198.18.3.99', cles)).status()).toBe(200)
    // Les écritures ne sont pas concernées.
    const ecrit = await request.put(`${serveur.url}/v1/chain/docs/${doc.docId}`, {
      headers: enTetes(cles, { 'X-Forwarded-For': '198.18.21.7', 'Content-Type': 'application/octet-stream', 'X-Lector-Path-Enc': doc.pathEnc }),
      data: Buffer.from((await chaine.chiffrerDocAvec(cles, 'Partage.md', new TextEncoder().encode('# Partage 2'))).contentEnc),
    })
    expect(ecrit.status()).toBe(200)
    // Une autre chaîne a son propre compte.
    const autre = await casier(request)
    expect((await lire(request, '198.18.22.7', autre)).status()).toBe(200)

    // La fenêtre passée, les réseaux sortent du compte : un nouveau réseau passe.
    await new Promise((ok) => setTimeout(ok, FENETRE_MS + 500))
    expect((await lire(request, '198.18.23.7', cles)).status()).toBe(200)
  })

  test('IPv6 : les adresses d\'un même /48 comptent pour un réseau ; une fausse preuve ne compte pas', async ({ request }) => {
    const cles = await casier(request)
    const voisine = await nouvelleChaine()
    expect((await lire(request, '2001:db8:aaaa:1::1', cles)).status()).toBe(200)
    expect((await lire(request, '2001:db8:aaaa:ffff:1:2:3:4', cles)).status()).toBe(200)
    // Des preuves fausses depuis 30 réseaux : 403, sans user le budget de la chaîne.
    for (let i = 0; i < 30; i++) {
      const r = await request.get(`${serveur.url}/v1/chain`, depuis(`203.0.113.${i}`, cles, { 'X-Lector-Chain-Proof': voisine.preuve }))
      expect(r.status()).toBe(403)
    }
    // Le /48 compte pour un : 7 réseaux IPv4 de plus passent, le suivant est refusé.
    for (let i = 0; i < 7; i++) expect((await lire(request, `198.19.${i}.1`, cles)).status(), `réseau ${i}`).toBe(200)
    expect((await lire(request, '198.19.7.1', cles)).status()).toBe(429)
    expect((await lire(request, '2001:db8:aaaa:42::9', cles)).status()).toBe(200)
    expect((await lire(request, '2001:db8:bbbb::1', cles)).status()).toBe(429)
    // L'effacement oublie le compte : recréé avec le même S, le casier repart de zéro.
    expect((await request.delete(`${serveur.url}/v1/chain`, depuis('2001:db8:aaaa:1::1', cles))).status()).toBe(204)
    expect((await request.post(`${serveur.url}/v1/chain`, depuis('192.0.2.2', cles))).status()).toBe(201)
    expect((await lire(request, '2001:db8:bbbb::1', cles)).status()).toBe(200)
  })

  test('journal : le refus est noté une fois par chaîne, sans adresse ni réseau', async () => {
    const journal = serveur.journal
    const refus = journal.match(/\[chain [0-9a-f]{8}\] read refused: too many networks today/g) || []
    expect(refus.length).toBe(2)
    for (const ip of ['198.18.', '198.19.', '203.0.113.', '2001:db8', '192.0.2.', '/24', '/48']) expect(journal).not.toContain(ip)
    for (const marqueur of marqueursJournal) {
      expect(journal, `« ${marqueur} » trouvé dans le journal`).not.toContain(marqueur)
    }
  })
})

// ---------------------------------------------------------------------------
// Journal et disque du serveur de test (en dernier : tous les marqueurs sont connus)
// ---------------------------------------------------------------------------

test.describe('API Chaîne : journal et disque', () => {
  test('journal du serveur : aucun contenu, chemin, pathEnc, preuve, secret, 12 mots, IP ni id complet', async () => {
    // Laisse le temps au flux d'écriture du serveur de se vider.
    await new Promise((r) => setTimeout(r, 300))
    const texte = fs.readFileSync(path.join(DONNEES, 'serveur.log'), 'utf8')
    expect(texte).toContain('[Lector API]')
    expect(texte).toMatch(/\[chain [0-9a-f]{8}\] (created|invalid proof|erased)/)
    expect(marqueursJournal.length).toBeGreaterThan(50)
    for (const marqueur of marqueursJournal) {
      expect(texte, `« ${marqueur} » trouvé dans le journal`).not.toContain(marqueur)
    }
    for (const ip of ['127.0.0.1', '::1', '::ffff:']) expect(texte).not.toContain(ip)
  })

  test('aucun clair sur le disque ni dans la base', async () => {
    const fichiers = [...fichiersSous(ENV_TEST.CHAIN_FILES_ROOT), ENV_TEST.DATABASE_URL.slice('file:'.length)]
    expect(marqueursClair.length).toBeGreaterThan(0)
    for (const marqueur of marqueursClair) {
      expect(contientOctets(fichiers, marqueur), `« ${marqueur} » trouvé sur le disque`).toBe(false)
    }
  })
})
