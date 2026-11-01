// Scénarios de bout en bout de la chaîne de sync (docs/CHAINE-TESTS.md).
//
// Lancé par e2e/api/chain-bout-en-bout.spec.js, qui démarre le serveur de test,
// ou à la main quand l'API de test tourne déjà sur :3457 :
//   node --test e2e/chaine/bout-en-bout.test.cjs
// Processus Node ordinaire, comme le processus principal d'Electron : les
// modules ES de la chaîne y sont chargés par import() natif (sous le chargeur
// de Playwright, crypto.js déjà compilé en CommonJS par chain.spec.js casse cet
// import()).
//
// Les vrais clients contre le vrai serveur de test (base SQLite jetable dans
// back/.test-data/, limites basses de e2e/back-test.js : 64 Kio de clair par
// document, 256 Kio et 20 documents par casier) :
//  - ordinateurs : ChaineDesktop et SyncManager du processus principal
//    d'Electron (front/desktop/), sur de vrais dossiers, sans lancer Electron ;
//  - navigateur : VaultWebChaine (front/src/services/chaine/web-vault.js), le
//    module de l'app web, piloté en Node.
// Puis lecture directe de la base SQLite, des blocs et du journal du serveur.

const { test, describe, after } = require('node:test')
const { expect } = require('@playwright/test')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomBytes, randomUUID } = require('crypto')
const { execFileSync } = require('child_process')
const { pathToFileURL } = require('url')
const { BACK, DONNEES, PORT_TEST, ENV_TEST } = require('../back-test.js')

const { PrismaClient } = require(path.join(BACK, 'node_modules', '@prisma/client'))
const RACINE = path.resolve(__dirname, '..', '..')
const { ChaineDesktop } = require(path.join(RACINE, 'front/desktop/chaine-desktop.js'))
const { SyncManager, chargerBaseChaine, sauverBaseChaine } = require(path.join(RACINE, 'front/desktop/sync-manager.js'))
const { chargerChaine } = require(path.join(RACINE, 'front/desktop/chaine-modules.js'))

const SERVEUR = `http://localhost:${PORT_TEST}`
const MAX_DOC = Number(ENV_TEST.CHAIN_MAX_DOC_BYTES)
const SURCOUT = 29
const prisma = new PrismaClient({ datasourceUrl: ENV_TEST.DATABASE_URL })

const importer = (relatif) => import(pathToFileURL(path.join(RACINE, relatif)).href)

// node:test enchaîne les tests d'un fichier dans l'ordre : chaque scénario
// s'appuie sur l'état laissé par le test précédent.
const dossiersTemporaires = []
after(async () => {
  await prisma.$disconnect()
  for (const d of dossiersTemporaires) fs.rmSync(d, { recursive: true, force: true })
})

// Secrets et identifiants qui ne doivent jamais apparaître dans le journal du serveur.
const secretsJournal = []

// ---------------------------------------------------------------------------
// Outils
// ---------------------------------------------------------------------------

/** Dossier temporaire rempli. Les noms sont écrits tels quels (NFD compris). */
function dossier(fichiers = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-e2e-'))
  dossiersTemporaires.push(d)
  for (const [c, contenu] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(d, c)), { recursive: true })
    fs.writeFileSync(path.join(d, c), contenu)
  }
  return d
}

/** Fichiers visibles d'un vault, clés en NFC (hors dossiers et fichiers cachés). */
function contenuVault(d) {
  const sortie = {}
  for (const e of fs.readdirSync(d, { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue
    const rel = path.relative(d, path.join(e.parentPath ?? e.path, e.name)).split(path.sep).join('/')
    if (rel.split('/').some((s) => s.startsWith('.'))) continue
    sortie[rel.normalize('NFC')] = fs.readFileSync(path.join(d, rel))
  }
  return sortie
}

/** Les seuls fichiers qui voyagent : markdown visible. */
function markdownDe(d) {
  return Object.fromEntries(Object.entries(contenuVault(d)).filter(([c]) => /\.(md|markdown)$/i.test(c)))
}

function memesFichiers(a, b) {
  expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort())
  for (const [c, octets] of Object.entries(a)) expect(Buffer.compare(b[c], octets), c).toBe(0)
}

const lire = (ordi, c) => fs.readFileSync(path.join(ordi.vaultPath, c), 'utf8')
const existe = (ordi, c) => fs.existsSync(path.join(ordi.vaultPath, c))

async function attendre(condition, delai = 10_000) {
  const fin = Date.now() + delai
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error('Délai dépassé')
    await new Promise((r) => setTimeout(r, 50))
  }
}

/** fetch qui garde la trace de chaque requête : { methode, chemin, status }. */
function journalise(fetchImpl = fetch) {
  const requetes = []
  const f = async (url, init = {}) => {
    const res = await fetchImpl(url, init)
    const u = new URL(url)
    requetes.push({ methode: init.method || 'GET', chemin: u.pathname + u.search, status: res.status })
    return res
  }
  f.requetes = requetes
  return f
}

/**
 * Un ordinateur : réglages (comme cloud-secrets.dat), ChaineDesktop et
 * SyncManager réels. Le même SyncManager sert tant que la chaîne ne change pas.
 */
function ordinateur(nom, vaultPath, creds = { vaultPath, serverUrl: SERVEUR, deviceId: randomUUID() }) {
  const p = {
    nom,
    vaultPath,
    creds,
    fetch: journalise(),
    quotas: [],
    sm: null,
    ops: null,
    /** Un cycle de synchro, comme la boucle d'Electron (sans watcher ni flux). */
    async synchroniser() {
      if (!p.sm || p.sm.chainSecret !== p.creds.chainSecret) {
        p.sm = new SyncManager({
          vaultPath, serverUrl: SERVEUR, chainSecret: p.creds.chainSecret, deviceId: p.creds.deviceId, fetchImpl: (...a) => p.fetch(...a), flux: false,
        })
        p.sm.on('error', () => {})
        p.sm.on('quota', (e) => p.quotas.push(e))
        p.sm.on('sync-complete', (e) => { p.ops = e.ops })
      }
      p.ops = null
      try { await p.sm._syncOnce() } catch (err) { if (!p.sm._handleFatal(err)) throw err }
      return { ...p.sm.getStatus(), ops: p.ops }
    },
  }
  p.chaine = new ChaineDesktop({
    getCreds: () => p.creds,
    saveCreds: (c) => { p.creds = c },
    fetchImpl: (...a) => p.fetch(...a),
    arreterSynchro: async () => {},
    demarrerSynchro: async () => {},
    verrouOuvert: () => true,
    stockageSur: () => true,
    serverUrlParDefaut: SERVEUR,
  })
  return p
}

/** Clés et client du casier d'un secret en hex, pour les contrôles. */
async function chaineDe(hex, fetchImpl = fetch) {
  const { service } = await chargerChaine()
  const cles = await service.clesDepuisHex(hex)
  return { cles, client: service.clientDe(cles, { serverUrl: SERVEUR, fetch: fetchImpl }) }
}

/** Tous les fichiers sous un dossier (vide s'il n'existe pas). */
function fichiersSous(d) {
  if (!fs.existsSync(d)) return []
  return fs.readdirSync(d, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.join(e.parentPath ?? e.path, e.name))
}

const dossierCasier = (chainId) => path.join(ENV_TEST.CHAIN_FILES_ROOT, chainId)

/**
 * Contenu d'un fichier, ou null s'il a disparu depuis le listage : les tests
 * de l'API tournent en parallèle sur le même serveur, et leurs dépôts (fichier
 * temporaire puis renommage) ou suppressions vont et viennent.
 */
function lireSiPresent(f) {
  try {
    return fs.readFileSync(f)
  } catch (err) {
    if (err.code === 'ENOENT') return null
    throw err
  }
}

/** Cherche des textes (UTF-8 NFC et NFD) ou des octets dans des fichiers. Renvoie ce qui est trouvé. */
function chercher(fichiers, aiguilles) {
  const trouves = []
  for (const f of fichiers) {
    const octets = lireSiPresent(f)
    if (!octets) continue
    for (const a of aiguilles) {
      const formes = Buffer.isBuffer(a) ? [a] : [...new Set([a.normalize('NFC'), a.normalize('NFD')])].map((t) => Buffer.from(t))
      for (const forme of formes) {
        if (octets.includes(forme)) trouves.push({ fichier: path.relative(DONNEES, f), aiguille: String(a).slice(0, 40) })
      }
    }
  }
  return trouves
}

/** Fichiers de la base SQLite (base, journal éventuel). */
const fichiersBase = () => fs.readdirSync(DONNEES).filter((n) => n.startsWith('test.db')).map((n) => path.join(DONNEES, n))

const JOURNAL = path.join(DONNEES, 'serveur.log')

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

/** Retient S, les 12 mots, la preuve et l'id complet d'une chaîne pour le contrôle du journal. */
async function retenirSecrets(hex, mots) {
  const { cles } = await chaineDe(hex)
  secretsJournal.push(hex, cles.preuve, cles.id)
  if (mots) secretsJournal.push(mots.join(' '))
}

// Octets reconnaissables d'une image et d'un PDF : ils ne doivent jamais quitter le disque.
const SIGNATURE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG = Buffer.concat([SIGNATURE_PNG, Buffer.from('MARQUEUR-PNG'), randomBytes(2000)])
const PDF = Buffer.from('%PDF-1.4\n% MARQUEUR-PDF\n1 0 obj << >> endobj\n%%EOF\n')

// ---------------------------------------------------------------------------
// Scénario 1 : une chaîne, deux ordinateurs et un navigateur
// ---------------------------------------------------------------------------

const IDEE = 'Été/Idée à creuser.md'.normalize('NFC')
const IDEE_NFD = IDEE.normalize('NFD') // comme macOS peut le rendre
const REUNION = 'Projets Kerguelen/Clients Tromelin/Réunion budget.md'
const ECRIT_B = 'Écrit sur B.md'
const DOCS_A = {
  'Lecture du soir.md': '# Lecture du soir\nMARQUEUR-CONTENU-UN : le serveur ne doit jamais lire ceci.\n',
  [IDEE_NFD]: '# Idée\nMARQUEUR-CONTENU-DEUX : écrire une préface, relire « Été ».\n',
  [REUNION]: '# Réunion\nMARQUEUR-CONTENU-TROIS : 12 000 euros, à confirmer.\n',
  'Images/photo.png': PNG,
  'Annexes/plan.pdf': PDF,
  'Notes brutes.txt': 'MARQUEUR-TEXTE-BRUT\n',
  '.obsidian/workspace.md': 'MARQUEUR-CACHE\n',
  '.obsidian/app.json': '{ "MARQUEUR-CACHE": true }\n',
}
const MD_A = ['Lecture du soir.md', IDEE, REUNION]
const texteA = (c) => DOCS_A[c] ?? DOCS_A[c.normalize('NFD')]
const DOCS_B = {
  [ECRIT_B]: '# B\nMARQUEUR-CONTENU-B\n',
  'Schémas/croquis.png': Buffer.concat([SIGNATURE_PNG, randomBytes(500)]),
  'local.txt': 'reste ici\n',
}
const TEXTES_INTERDITS = [
  'Lecture du soir', 'Idée à creuser', 'Réunion budget', 'Projets Kerguelen', 'Clients Tromelin', 'Écrit sur B',
  'Depuis le navigateur', 'Limite web', 'Pendant le renouvellement', 'croquis', 'fuite.png', 'photo.png', 'plan.pdf',
  'MARQUEUR-CONTENU-UN', 'MARQUEUR-CONTENU-DEUX', 'MARQUEUR-CONTENU-TROIS', 'MARQUEUR-CONTENU-B', 'MARQUEUR-CONTENU-WEB',
  'MARQUEUR-PNG', 'MARQUEUR-PDF', 'MARQUEUR-TEXTE-BRUT', 'MARQUEUR-CACHE', 'MARQUEUR-HORS-FORMAT', 'MARQUEUR-VERSION-A', 'MARQUEUR-VERSION-B',
  'MARQUEUR-TEMPS-REEL', 'What Lector renders', SIGNATURE_PNG, Buffer.from('%PDF-'),
]

describe('Bout en bout : une chaîne, deux ordinateurs et un navigateur', () => {
  const etat = {}

  test('A crée la chaîne : seul le markdown visible part, chiffré', async () => {
    const A = ordinateur('Mac A', dossier(DOCS_A))
    etat.A = A
    const blocsAttendus = MD_A.map((c) => Buffer.byteLength(texteA(c)) + SURCOUT)
    const total = blocsAttendus.reduce((s, t) => s + t, 0)

    const prep = await A.chaine.preparer()
    expect(prep, JSON.stringify(prep)).toMatchObject({ ok: true, envoi: { fichiers: 3, octets: total } })
    expect(prep.mots).toHaveLength(12)
    expect(prep.code).toMatch(/^lector-chaine:[A-Za-z0-9_-]{22}$/)
    etat.mots = prep.mots
    etat.code = prep.code

    const r = await A.chaine.creer()
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, envoyes: 3, tropGros: [], quota: [] })
    expect(A.creds.chainSecret).toMatch(/^[0-9a-f]{32}$/)
    expect(A.creds).toMatchObject({ chainId: r.chainId, chainSaved: false })
    expect(A.creds.chainPendingSecret).toBeUndefined()
    await retenirSecrets(A.creds.chainSecret, prep.mots)

    // Côté serveur : une ligne et un bloc par fichier markdown, rien d'autre.
    expect(await prisma.chain.findUnique({ where: { id: r.chainId } })).toMatchObject({ docCount: 3, bytesUsed: total })
    expect(await prisma.chainDoc.count({ where: { chainId: r.chainId } })).toBe(3)
    const blocs = fichiersSous(dossierCasier(r.chainId))
    expect(blocs.map((f) => fs.statSync(f).size).sort()).toEqual([...blocsAttendus].sort())
    for (const f of blocs) expect(fs.readFileSync(f)[0]).toBe(0x01)
    expect(chercher(blocs, [SIGNATURE_PNG, Buffer.from('%PDF-'), 'MARQUEUR-PNG', 'MARQUEUR-PDF', 'MARQUEUR-TEXTE-BRUT', 'MARQUEUR-CACHE'])).toEqual([])

    // Les chemins déchiffrés avec les clés de la chaîne : les trois .md, aucun autre.
    const { crypto } = await chargerChaine()
    const { cles, client } = await chaineDe(A.creds.chainSecret)
    const man = await client.manifeste()
    const chemins = await Promise.all(man.docs.map((d) => crypto.dechiffrerCheminAvec(cles, d.docId, d.pathEnc)))
    expect(chemins.sort()).toEqual([...MD_A].sort())

    // La synchro suivante n'a rien à faire ; les autres fichiers restent, ignorés.
    const s = await A.synchroniser()
    expect(s).toMatchObject({ state: 'idle', lastErrorCode: null, skipped: 3, notMarkdown: 0, quotaFull: false })
    expect(s.ops.put.length + s.ops.get.length + s.ops.del.length + s.ops.removeLocal.length + s.ops.conflict.length).toBe(0)
    for (const c of ['Images/photo.png', 'Annexes/plan.pdf', '.obsidian/workspace.md']) expect(existe(A, c), c).toBe(true)
  })

  test('B rejoint par les 12 mots : saisie fausse refusée sans requête, chaîne inconnue refusée, puis synchro dans les deux sens', async () => {
    const { A } = etat
    const B = ordinateur('PC B', dossier(DOCS_B))
    etat.B = B
    const { service } = await chargerChaine()
    const { MOTS } = await importer('front/src/services/chaine/bip39-english.js')

    // Dernier mot changé sur un bit de la somme de contrôle : refus local, aucune requête.
    const faux = [...etat.mots]
    faux[11] = MOTS[MOTS.indexOf(faux[11]) ^ 1]
    expect(await B.chaine.rejoindre(faux.join(' '))).toMatchObject({ ok: false, code: 'CHECKSUM' })
    expect(B.fetch.requetes).toEqual([])

    // 12 mots valides d'une chaîne jamais créée : 404, rien n'est gardé ni créé.
    const inconnue = await service.nouvelleChaine()
    await retenirSecrets(service.secretVersHex(inconnue.S), inconnue.mots)
    expect(await B.chaine.rejoindre(inconnue.mots.join(' '))).toMatchObject({ ok: false, code: 'CHAIN_UNKNOWN' })
    expect(B.creds.chainSecret).toBeUndefined()
    expect(await prisma.chain.findUnique({ where: { id: inconnue.id } })).toBeNull()
    expect(B.fetch.requetes).toEqual([{ methode: 'GET', chemin: '/v1/chain', status: 404 }])

    // Les mots tels qu'on les recopie : majuscules, virgules, espaces en trop.
    const saisie = '  ' + etat.mots.map((m) => m.toUpperCase()).join(',  ') + ' '
    expect(await B.chaine.rejoindre(saisie)).toEqual({ ok: true, chainId: A.creds.chainId })
    expect(B.creds).toMatchObject({ chainSecret: A.creds.chainSecret, chainSaved: true })

    // Adoption : B reçoit les 3 documents de A et envoie le sien, jamais ses autres fichiers.
    const sB = await B.synchroniser()
    expect(sB).toMatchObject({ state: 'idle', skipped: 2 })
    expect(sB.ops.get.sort()).toEqual([...MD_A].sort())
    expect(sB.ops.put).toEqual([ECRIT_B])
    expect(sB.ops.conflict).toEqual([])
    expect((await A.synchroniser()).ops.get).toEqual([ECRIT_B])

    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
    expect(Object.keys(markdownDe(B.vaultPath))).toContain(IDEE)
    for (const c of ['Images/photo.png', 'Annexes/plan.pdf', 'Notes brutes.txt']) expect(existe(B, c), c).toBe(false)
    for (const c of ['Schémas/croquis.png', 'local.txt']) expect(existe(A, c), c).toBe(false)
    expect(lire(B, 'local.txt')).toBe('reste ici\n')
    expect(await prisma.chainDoc.count({ where: { chainId: A.creds.chainId, deletedAt: null } })).toBe(4)
  })

  test('A supprime un document : pierre tombale authentifiée, B le retire', async () => {
    const { A, B } = etat
    fs.unlinkSync(path.join(A.vaultPath, 'Lecture du soir.md'))
    expect((await A.synchroniser()).ops.del).toEqual(['Lecture du soir.md'])

    const { crypto } = await chargerChaine()
    const { cles, client } = await chaineDe(A.creds.chainSecret)
    const docId = await crypto.docIdAvec(cles, 'Lecture du soir.md')
    const tombe = (await client.manifeste()).docs.find((d) => d.docId === docId)
    expect(tombe).toMatchObject({ sha256: '', size: 0 })
    expect(tombe.deletedAt).toBeTruthy()
    expect(tombe.tombEnc).toBeTruthy()
    await expect(client.lire(docId)).rejects.toMatchObject({ status: 410, code: 'DOC_DELETED' })
    expect(fichiersSous(dossierCasier(A.creds.chainId))).toHaveLength(3)

    expect((await B.synchroniser()).ops.removeLocal).toEqual(['Lecture du soir.md'])
    expect(existe(B, 'Lecture du soir.md')).toBe(false)
    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
  })

  test('les deux modifient le même document : copie de conflit, aucune version perdue', async () => {
    const { A, B } = etat
    fs.writeFileSync(path.join(A.vaultPath, ECRIT_B), '# B\nMARQUEUR-VERSION-A\n')
    fs.writeFileSync(path.join(B.vaultPath, ECRIT_B), '# B\nMARQUEUR-VERSION-B\n')
    expect((await A.synchroniser()).ops.put).toEqual([ECRIT_B])
    expect((await B.synchroniser()).ops.conflict).toEqual([ECRIT_B])
    const copie = Object.keys(markdownDe(B.vaultPath)).find((c) => c.startsWith('Écrit sur B (conflict '))
    expect(copie).toBeTruthy()
    etat.copie = copie
    expect(lire(B, ECRIT_B)).toBe('# B\nMARQUEUR-VERSION-B\n')
    expect(lire(B, copie)).toBe('# B\nMARQUEUR-VERSION-A\n')

    expect((await A.synchroniser()).ops.get.sort()).toEqual([ECRIT_B, copie].sort())
    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
  })

  test('un bloc d\'un autre type, déposé par un client bogué, n\'est jamais écrit sur le disque', async () => {
    const { A, B } = etat
    const { crypto } = await chargerChaine()
    const { cles, client } = await chaineDe(A.creds.chainSecret)
    const deposes = []
    for (const [chemin, octets] of [['Images/fuite.png', PNG], ['notes.txt', Buffer.from('MARQUEUR-HORS-FORMAT\n')]]) {
      const doc = await crypto.chiffrerDocAvec(cles, chemin, octets)
      const r = await client.deposer(doc.docId, { bloc: doc.contentEnc, pathEnc: doc.pathEnc, mtime: new Date(), attendu: null })
      deposes.push({ docId: doc.docId, sha256: r.sha256 })
    }

    for (const ordi of [B, A]) {
      const s = await ordi.synchroniser()
      expect(s.ops.horsFormat.sort(), ordi.nom).toEqual(['Images/fuite.png', 'notes.txt'])
      expect(s.notMarkdown).toBe(2)
      expect(s.ops.get.length + s.ops.put.length + s.ops.del.length).toBe(0)
      expect(existe(ordi, 'Images/fuite.png') || existe(ordi, 'notes.txt'), ordi.nom).toBe(false)
    }
    // La synchro ne les supprime pas non plus : la vérification les signale.
    expect(await prisma.chainDoc.count({ where: { chainId: A.creds.chainId, deletedAt: null } })).toBe(6)
    expect(await A.chaine.verifier()).toMatchObject({ ok: true, verification: { blocs: 6, horsFormat: 2, illisibles: 0, ok: false } })

    for (const d of deposes) await client.supprimer(d.docId, await crypto.chiffrerTombeAvec(cles, d.docId, d.sha256))
    expect((await A.chaine.verifier()).verification).toMatchObject({ blocs: 4, horsFormat: 0, ok: true })
  })

  test('navigateur : rejoint par le code du QR, lit, écrit ; markdown seulement, limite par document, 412', async () => {
    const { A } = etat
    const { service, crypto } = await chargerChaine()
    const { VaultWebChaine, construireArbre } = await importer('front/src/services/chaine/web-vault.js')

    // Même logique que rejoindreWeb : saisie lue localement, seules les clés préparées sont gardées.
    const { S, id } = await service.lireSaisie(etat.code)
    expect(id).toBe(A.creds.chainId)
    const cles = await crypto.preparer(S)
    S.fill(0)
    expect(cles.cleEnc.extractable).toBe(false)
    expect(cles.cleMac.extractable).toBe(false)
    const W = journalise()
    const vw = new VaultWebChaine({ client: service.clientDe(cles, { serverUrl: SERVEUR, fetch: W }), cles })

    const chezA = markdownDe(A.vaultPath)
    const liste = await vw.lister()
    expect(liste.map((d) => d.chemin)).toEqual(Object.keys(chezA).sort())
    expect(vw.serveur).toMatchObject({ maxDocBytes: MAX_DOC })
    expect(construireArbre(liste).filter((n) => n.isDirectory).map((n) => n.name).sort()).toEqual(['Projets Kerguelen', 'Été'].sort())
    for (const d of liste) {
      expect(Buffer.compare(Buffer.from(await vw.lire(d.chemin)), chezA[d.chemin]), d.chemin).toBe(0)
      expect(d.size).toBe(chezA[d.chemin].length)
    }

    await vw.ecrire('Depuis le navigateur.md', '# Web\nMARQUEUR-CONTENU-WEB\n')
    expect((await A.synchroniser()).ops.get).toEqual(['Depuis le navigateur.md'])
    expect(lire(A, 'Depuis le navigateur.md')).toBe('# Web\nMARQUEUR-CONTENU-WEB\n')

    // Refus locaux, sans aucune requête : autre type de fichier, document trop gros.
    const avant = W.requetes.length
    await expect(vw.ecrire('photo.png', 'x')).rejects.toMatchObject({ status: 400, code: 'NOT_MARKDOWN' })
    await expect(vw.ecrire('Trop gros.md', 'x'.repeat(MAX_DOC + 1))).rejects.toMatchObject({ status: 413, code: 'DOC_TOO_LARGE' })
    expect(W.requetes.length).toBe(avant)
    // Juste à la limite : accepté par le client et par le serveur.
    await vw.ecrire('Limite web.md', 'w'.repeat(MAX_DOC))
    expect((await A.synchroniser()).ops.get).toEqual(['Limite web.md'])
    expect(fs.statSync(path.join(A.vaultPath, 'Limite web.md')).size).toBe(MAX_DOC)

    // Écriture sur une version périmée : 412, la version de A n'est pas écrasée.
    fs.appendFileSync(path.join(A.vaultPath, 'Depuis le navigateur.md'), 'ajout sur A\n')
    await A.synchroniser()
    await expect(vw.ecrire('Depuis le navigateur.md', 'version périmée')).rejects.toMatchObject({ status: 412, code: 'CONFLICT' })
    await vw.lister()
    expect(await vw.lireTexte('Depuis le navigateur.md')).toBe('# Web\nMARQUEUR-CONTENU-WEB\najout sur A\n')
    // Relu, il s'écrit normalement.
    await vw.ecrire('Depuis le navigateur.md', '# Web\nMARQUEUR-CONTENU-WEB\nrelu puis écrit\n')
    await A.synchroniser()
    expect(lire(A, 'Depuis le navigateur.md')).toBe('# Web\nMARQUEUR-CONTENU-WEB\nrelu puis écrit\n')
    etat.requetesWeb = W.requetes

    expect((await etat.B.synchroniser()).ops.get.sort()).toEqual(['Depuis le navigateur.md', 'Limite web.md'])
    memesFichiers(markdownDe(A.vaultPath), markdownDe(etat.B.vaultPath))
  })

  test('temps réel : le flux du serveur réveille A dès que B écrit', async () => {
    const { A, B } = etat
    const sm = new SyncManager({ vaultPath: A.vaultPath, serverUrl: SERVEUR, chainSecret: A.creds.chainSecret, deviceId: A.creds.deviceId, fetchImpl: fetch })
    sm.on('error', () => {})
    await sm.start()
    try {
      expect(sm.getStatus()).toMatchObject({ state: 'running', lastErrorCode: null })
      // LECTOR-FORMATS.md, écrit au démarrage, voyage comme tout markdown.
      expect(existe(A, 'LECTOR-FORMATS.md')).toBe(true)

      const texte = '# Réunion\nMARQUEUR-TEMPS-REEL\n'
      fs.writeFileSync(path.join(B.vaultPath, REUNION), texte)
      const sB = await B.synchroniser()
      expect(sB.ops.put).toEqual([REUNION])
      expect(sB.ops.get).toEqual(['LECTOR-FORMATS.md'])
      // Sans flux, A ne verrait le changement qu'à la synchro périodique (30 s).
      await attendre(() => lire(A, REUNION) === texte)
      await attendre(() => !sm.getStatus().syncing)
    } finally {
      await sm.stop()
    }
    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
  })

  test('redémarrage avec une base locale de version 1 : ignorée, rien n\'est supprimé sur le serveur', async () => {
    const { A, B } = etat
    const base = chargerBaseChaine(B.vaultPath)
    expect(base).toMatchObject({ version: 2, chainId: B.creds.chainId })
    // Pendant que l'app est fermée : un fichier disparaît du disque et la base revient à l'ancien format.
    fs.unlinkSync(path.join(B.vaultPath, IDEE))
    sauverBaseChaine(B.vaultPath, { ...base, version: 1, generation: 1 })

    // Redémarrage : nouveaux ChaineDesktop et SyncManager, mêmes réglages.
    const B2 = ordinateur('PC B, redémarré', B.vaultPath, { ...B.creds })
    const s = await B2.synchroniser()
    expect(s.state).toBe('idle')
    // Une base de version 1 crue ferait supprimer le document du serveur. Ignorée, il revient.
    expect(s.ops.del).toEqual([])
    expect(s.ops.get).toEqual([IDEE])
    expect(s.ops.put).toEqual([])
    expect(s.ops.conflict).toEqual([])
    expect(lire(B2, IDEE)).toBe(texteA(IDEE))
    expect(chargerBaseChaine(B.vaultPath)).toMatchObject({ version: 2, chainId: B.creds.chainId })
    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
    B2.fetch.requetes.unshift(...B.fetch.requetes)
    etat.B = B2
  })

  test('serveur : ni contenu, ni chemin, ni secret (blocs, base SQLite, journal, URL) ; vérifications', async () => {
    const { A, B } = etat
    const chainId = A.creds.chainId
    const vivants = Object.keys(markdownDe(A.vaultPath)).length
    expect(await prisma.chainDoc.count({ where: { chainId, deletedAt: null } })).toBe(vivants)

    // Seulement le dossier de ce casier : les tests de l'API, en parallèle sur le
    // même serveur, créent et effacent d'autres dossiers pendant le parcours.
    const blocs = fichiersSous(dossierCasier(chainId))
    expect(blocs.length).toBe(vivants)
    for (const octets of blocs.map(lireSiPresent).filter(Boolean)) expect(octets[0]).toBe(0x01)
    expect(chercher(blocs, TEXTES_INTERDITS)).toEqual([])
    expect(chercher(fichiersBase(), TEXTES_INTERDITS)).toEqual([])
    expect(chercher([JOURNAL], [...TEXTES_INTERDITS, ...secretsJournal])).toEqual([])
    expect(fs.readFileSync(JOURNAL, 'utf8')).toContain('[Lector API]')

    // Aucune requête n'a porté la preuve ni l'identifiant dans son URL.
    const { cles } = await chaineDe(A.creds.chainSecret)
    for (const r of [...A.fetch.requetes, ...B.fetch.requetes, ...etat.requetesWeb]) {
      expect(r.chemin.includes(cles.preuve) || r.chemin.includes(cles.id), r.chemin).toBe(false)
    }

    // Lignes ChainDoc : identifiants opaques et enveloppes seulement.
    for (const ligne of await prisma.chainDoc.findMany({ where: { chainId } })) {
      expect(ligne.docId).toMatch(/^[0-9a-f]{64}$/)
      expect(Buffer.from(ligne.pathEnc, 'base64url')[0]).toBe(0x01)
      expect(JSON.stringify(ligne)).not.toMatch(/Lecture|Idée|Réunion|Kerguelen|Tromelin|navigateur|Écrit|LECTOR-FORMATS/)
    }

    const sansPreuve = await fetch(`${SERVEUR}/v1/chain/verify`, { headers: { 'X-Lector-Chain-Id': chainId } })
    expect(sansPreuve.status).toBe(400)
    expect((await sansPreuve.json()).code).toBe('CHAIN_PROOF_MISSING')
    const r = await fetch(`${SERVEUR}/v1/chain/verify`, { headers: { 'X-Lector-Chain-Id': chainId, 'X-Lector-Chain-Proof': cles.preuve } })
    expect(r.status).toBe(200)
    const v = await r.json()
    expect(v).toMatchObject({
      chain: chainId.slice(0, 8), blocs: vivants, blocsManquants: 0, empreintesFausses: 0, versionsInconnues: 0, blocsSuspects: 0, orphelins: 0, ok: true,
    })
    expect(v.compteurs).toEqual(v.attendu)

    const script = lancerVerificateur(['--chain', chainId])
    expect(script.code).toBe(0)
    expect(script.rapport).toMatchObject({ chaines: 1, problemes: 0 })
    expect(script.rapport.rapports[0]).toMatchObject({ chain: chainId.slice(0, 8), blocs: vivants, ok: true })
    expect(lancerVerificateur([]).code).toBe(2)
  })

  test('nouvelle chaîne depuis A : l\'ancien id répond 404, B s\'arrête sans rien perdre puis rejoint', async () => {
    const { A, B } = etat
    const ancienId = A.creds.chainId
    const ancienHex = A.creds.chainSecret
    const ancien = await chaineDe(ancienHex)
    const nombre = Object.keys(markdownDe(A.vaultPath)).length

    const neuve = await A.chaine.preparer()
    expect(neuve.envoi.fichiers).toBe(nombre)
    const rot = await A.chaine.renouveler()
    expect(rot, JSON.stringify(rot)).toMatchObject({ ok: true, envoyes: nombre, tropGros: [] })
    expect(rot.chainId).not.toBe(ancienId)
    expect(A.creds).toMatchObject({ chainId: rot.chainId, chainSaved: false })
    expect(A.creds.chainPendingSecret).toBeUndefined()
    await retenirSecrets(A.creds.chainSecret, neuve.mots)

    // L'ancien casier a disparu : ligne, blocs, dossier.
    expect(await prisma.chain.findUnique({ where: { id: ancienId } })).toBeNull()
    expect(await prisma.chainDoc.count({ where: { chainId: ancienId } })).toBe(0)
    expect(fs.existsSync(dossierCasier(ancienId))).toBe(false)
    await expect(ancien.client.manifeste()).rejects.toMatchObject({ status: 404, code: 'CHAIN_UNKNOWN' })
    expect(await prisma.chainDoc.count({ where: { chainId: rot.chainId, deletedAt: null } })).toBe(nombre)

    // B, resté sur l'ancienne chaîne : synchro arrêtée, fichiers intacts, S gardé.
    fs.writeFileSync(path.join(B.vaultPath, 'Pendant le renouvellement.md'), 'écrit sur B pendant le renouvellement\n')
    const avant = contenuVault(B.vaultPath)
    const sB = await B.synchroniser()
    expect([sB.state, sB.lastErrorCode]).toEqual(['chain-unknown', 'CHAIN_UNKNOWN'])
    expect(await B.chaine.etat()).toMatchObject({ ok: false, code: 'CHAIN_UNKNOWN', hasChain: true })
    expect(B.creds).toMatchObject({ chainSecret: ancienHex, chainId: ancienId })
    memesFichiers(avant, contenuVault(B.vaultPath))

    // B rejoint avec les nouveaux mots : adoption, son document part, aucun conflit.
    expect(await B.chaine.rejoindre(neuve.mots.join(' '))).toEqual({ ok: true, chainId: rot.chainId })
    const sB2 = await B.synchroniser()
    expect(sB2.state).toBe('idle')
    expect(sB2.ops.put).toEqual(['Pendant le renouvellement.md'])
    expect(sB2.ops.get).toEqual([])
    expect(sB2.ops.conflict).toEqual([])
    expect((await A.synchroniser()).ops.get).toEqual(['Pendant le renouvellement.md'])
    memesFichiers(markdownDe(A.vaultPath), markdownDe(B.vaultPath))
    expect(Object.keys(markdownDe(A.vaultPath)).filter((c) => c.includes('(conflict '))).toEqual([etat.copie])
  })

  test('tout effacer depuis A : casier détruit, B prévenu par le flux, aucun fichier local touché', async () => {
    const { A, B } = etat
    const chainId = A.creds.chainId
    const chezA = contenuVault(A.vaultPath)
    const chezB = contenuVault(B.vaultPath)
    const sm = new SyncManager({ vaultPath: B.vaultPath, serverUrl: SERVEUR, chainSecret: B.creds.chainSecret, deviceId: B.creds.deviceId, fetchImpl: fetch })
    const blocages = []
    sm.on('chain-block', (e) => blocages.push(e))
    sm.on('error', () => {})
    await sm.start()
    try {
      expect(sm.getStatus().state).toBe('running')
      expect(await A.chaine.effacerTout('oui')).toMatchObject({ ok: false, code: 'CONFIRM_REQUIRED' })
      expect(await A.chaine.effacerTout('DELETE')).toEqual({ ok: true, trashed: false })

      expect(await prisma.chain.findUnique({ where: { id: chainId } })).toBeNull()
      expect(await prisma.chainDoc.count({ where: { chainId } })).toBe(0)
      expect(fs.existsSync(dossierCasier(chainId))).toBe(false)
      expect(A.creds.chainSecret).toBeUndefined()
      expect(A.creds.chainId).toBeUndefined()
      expect(A.creds.vaultPath).toBe(A.vaultPath)
      expect(chargerBaseChaine(A.vaultPath)).toBeNull()
      memesFichiers(chezA, contenuVault(A.vaultPath))

      // Le serveur ferme le flux de B ; à la reconnexion, 404 : B s'arrête.
      await attendre(() => sm.getStatus().state === 'chain-unknown')
      expect(blocages).toEqual([{ state: 'chain-unknown', code: 'CHAIN_UNKNOWN' }])
    } finally {
      await sm.stop()
    }
    memesFichiers(chezB, contenuVault(B.vaultPath))
    expect(lancerVerificateur(['--chain', chainId]).code).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Scénario 2 : un appareil dont la chaîne n'existe plus
// ---------------------------------------------------------------------------

describe('Bout en bout : chaîne inconnue', () => {
  test('casier disparu pendant que l\'appareil était éteint : arrêt sans rien écrire, rien n\'est recréé', async () => {
    const { service } = await chargerChaine()
    const n = await service.nouvelleChaine()
    const hex = service.secretVersHex(n.S)
    await retenirSecrets(hex, n.mots)
    const D = ordinateur('Mac D', dossier({ 'Carnet.md': '# Carnet\n' }))
    D.creds = { ...D.creds, chainSecret: hex, chainId: n.id, chainSaved: true }

    const s = await D.synchroniser()
    expect([s.state, s.lastErrorCode]).toEqual(['chain-unknown', 'CHAIN_UNKNOWN'])
    expect(D.fetch.requetes).toEqual([{ methode: 'GET', chemin: '/v1/chain/manifest', status: 404 }])
    expect(lire(D, 'Carnet.md')).toBe('# Carnet\n')
    expect(chargerBaseChaine(D.vaultPath)).toBeNull()
    expect(await D.chaine.etat()).toMatchObject({ ok: false, code: 'CHAIN_UNKNOWN', hasChain: true })
    // Ni la synchro ni l'état ne recréent le casier, et S n'est pas effacé.
    expect(await prisma.chain.findUnique({ where: { id: n.id } })).toBeNull()
    expect(D.creds.chainSecret).toBe(hex)
  })
})

// ---------------------------------------------------------------------------
// Scénario 3 : quota du casier et limite par document
// ---------------------------------------------------------------------------

/** fetch dont le manifeste annonce plus de place qu'il n'y en a (manifeste périmé, autre appareil plus rapide). */
function manifesteOptimiste(fetchImpl = fetch) {
  return async (url, init = {}) => {
    const res = await fetchImpl(url, init)
    if (!new URL(url).pathname.endsWith('/v1/chain/manifest') || !res.ok) return res
    const man = await res.json()
    return new Response(JSON.stringify({ ...man, quotaBytes: man.quotaBytes * 10 }), { status: res.status, headers: res.headers })
  }
}

describe('Bout en bout : quota', () => {
  const BLOC_Q = 60_000 + SURCOUT
  const QUOTA = Number(ENV_TEST.CHAIN_QUOTA_BYTES)

  test('casier plein et document trop gros : signalés, jamais fatals ; un 413 du serveur non plus ; une suppression libère la place', async () => {
    const fichiers = {
      'gros.md': 'g'.repeat(MAX_DOC + 1),
      'limite.md': 'l'.repeat(MAX_DOC),
      'Images/grande.png': Buffer.concat([SIGNATURE_PNG, randomBytes(300_000)]),
    }
    for (let i = 1; i <= 5; i++) fichiers[`q${i}.md`] = String(i).repeat(60_000)
    const Q = ordinateur('Mac Q', dossier(fichiers))

    // limite.md (64 Kio + 29) et trois blocs de 60 000 + 29 tiennent dans 256 Kio ; q4 et q5 attendent.
    const plein = MAX_DOC + SURCOUT + 3 * BLOC_Q
    expect(plein).toBeLessThanOrEqual(QUOTA)
    expect(plein + BLOC_Q).toBeGreaterThan(QUOTA)

    const prep = await Q.chaine.preparer()
    expect(prep.envoi.fichiers).toBe(7)
    const r = await Q.chaine.creer()
    expect(r, JSON.stringify(r)).toMatchObject({ ok: true, envoyes: 4, tropGros: ['gros.md'], quota: ['q4.md', 'q5.md'] })
    await retenirSecrets(Q.creds.chainSecret, prep.mots)
    const chainId = Q.creds.chainId
    expect(await prisma.chain.findUnique({ where: { id: chainId } })).toMatchObject({ bytesUsed: plein, docCount: 4 })
    expect(fichiersSous(dossierCasier(chainId))).toHaveLength(4)

    // Deux cycles : état lisible, un seul événement « casier plein », aucune requête vouée au refus.
    const avant = Q.fetch.requetes.length
    await Q.synchroniser()
    const s = await Q.synchroniser()
    expect(s).toMatchObject({ state: 'idle', lastErrorCode: null, quotaFull: true, quotaPending: 2, tooLarge: 1, skipped: 1 })
    expect(s.ops.quota).toEqual(['q4.md', 'q5.md'])
    expect(s.ops.tropGros).toEqual(['gros.md'])
    expect(Q.quotas).toHaveLength(1)
    expect(Q.quotas[0]).toMatchObject({ pending: 2, quotaBytes: QUOTA })
    expect(Q.fetch.requetes.slice(avant).filter((x) => x.methode === 'PUT')).toEqual([])

    // Manifeste trop optimiste : le serveur répond 413, le cycle cesse d'envoyer et se termine normalement.
    Q.fetch = journalise(manifesteOptimiste())
    const s413 = await Q.synchroniser()
    expect(s413).toMatchObject({ state: 'idle', lastErrorCode: null, quotaFull: true })
    expect(s413.ops.quota).toEqual(['q4.md', 'q5.md'])
    expect(Q.fetch.requetes.filter((x) => x.methode === 'PUT').map((x) => x.status)).toEqual([413])
    expect(await prisma.chain.findUnique({ where: { id: chainId } })).toMatchObject({ bytesUsed: plein, docCount: 4 })
    expect(await prisma.chainDoc.count({ where: { chainId } })).toBe(4)
    expect(fichiersSous(dossierCasier(chainId))).toHaveLength(4)

    // L'utilisateur supprime deux documents : la place revient, ceux qui attendaient partent.
    Q.fetch = journalise()
    fs.unlinkSync(path.join(Q.vaultPath, 'q1.md'))
    fs.unlinkSync(path.join(Q.vaultPath, 'q2.md'))
    const s2 = await Q.synchroniser()
    expect(s2).toMatchObject({ state: 'idle', quotaFull: false, quotaPending: 0, tooLarge: 1 })
    expect(s2.ops.del.sort()).toEqual(['q1.md', 'q2.md'])
    expect(s2.ops.put.sort()).toEqual(['q4.md', 'q5.md'])
    expect(await prisma.chain.findUnique({ where: { id: chainId } })).toMatchObject({ bytesUsed: plein, docCount: 4 })
    for (const c of ['gros.md', 'Images/grande.png', 'q3.md', 'q4.md', 'q5.md', 'limite.md']) expect(existe(Q, c), c).toBe(true)

    const v = lancerVerificateur(['--chain', chainId])
    expect(v.code).toBe(0)
    expect(v.rapport.rapports[0].compteurs).toEqual({ bytesUsed: plein, docCount: 4 })
    expect(chercher(fichiersSous(dossierCasier(chainId)), [SIGNATURE_PNG])).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Scénario 4 : cas limites qui faisaient perdre des documents
// ---------------------------------------------------------------------------

/** Le dossier temporaire distingue-t-il la casse ? (non sur macOS et Windows par défaut) */
const casseInsensible = (() => {
  const d = dossier({ a: '' })
  return fs.existsSync(path.join(d, 'A'))
})()

/** Chaîne créée par un premier ordinateur ; renvoie les mots et le vault web de la chaîne. */
async function nouvelleChaineDe(ordi) {
  const prep = await ordi.chaine.preparer()
  expect(await ordi.chaine.creer()).toMatchObject({ ok: true })
  await retenirSecrets(ordi.creds.chainSecret, prep.mots)
  const { VaultWebChaine } = await importer('front/src/services/chaine/web-vault.js')
  const { cles, client } = await chaineDe(ordi.creds.chainSecret)
  return { mots: prep.mots, web: new VaultWebChaine({ client, cles }) }
}

const versions = (ordi, prefixe) => Object.entries(markdownDe(ordi.vaultPath)).filter(([c]) => c.startsWith(prefixe)).map(([, o]) => o.toString()).sort()

describe('Bout en bout : aucune perte dans les cas limites', () => {
  test('reprise d\'une création après qu\'un autre ordinateur a rejoint : rien du sien n\'est supprimé ni écrasé', async () => {
    const O1 = ordinateur('Mac O1', dossier({ 'Commun.md': 'version O1\n', 'A.md': 'a\n' }))
    const prep = await O1.chaine.preparer()
    // L'envoi est coupé au premier dépôt ; les 12 mots sont déjà affichés.
    O1.fetch = journalise(async (url, init = {}) => {
      if (init.method === 'PUT') throw new TypeError('fetch failed')
      return fetch(url, init)
    })
    expect(await O1.chaine.creer()).toMatchObject({ ok: false, code: 'NETWORK' })
    await retenirSecrets(O1.creds.chainPendingSecret, prep.mots)
    const O2 = ordinateur('PC O2', dossier({ 'Commun.md': 'version O2\n', 'Seulement O2.md': 'travail de O2\n' }))
    expect(await O2.chaine.rejoindre(prep.mots.join(' '))).toMatchObject({ ok: true })
    expect((await O2.synchroniser()).ops.put.sort()).toEqual(['Commun.md', 'Seulement O2.md'])

    O1.fetch = journalise()
    expect(await O1.chaine.creer()).toMatchObject({ ok: true, envoyes: 1 })
    expect(O1.fetch.requetes.filter((r) => r.methode === 'DELETE')).toEqual([])
    expect(O1.fetch.requetes.filter((r) => r.methode === 'PUT').map((r) => r.status)).toEqual([200])
    await O1.synchroniser()
    await O2.synchroniser()
    expect(lire(O2, 'Seulement O2.md')).toBe('travail de O2\n')
    expect(versions(O1, 'Commun')).toEqual(['version O1\n', 'version O2\n'])
    memesFichiers(markdownDe(O1.vaultPath), markdownDe(O2.vaultPath))
  })

  test('suppression pendant qu\'un autre appareil écrit : If-Match, la nouvelle version survit partout', async () => {
    const A = ordinateur('Mac A2', dossier({ 'Doc.md': 'v1\n' }))
    const { mots, web } = await nouvelleChaineDe(A)
    const C = ordinateur('PC C', dossier())
    expect(await C.chaine.rejoindre(mots.join(' '))).toMatchObject({ ok: true })
    await C.synchroniser()
    await web.lister()
    await web.lire('Doc.md')

    // A supprime Doc.md ; le navigateur enregistre une v2 juste après la lecture du manifeste par A.
    fs.unlinkSync(path.join(A.vaultPath, 'Doc.md'))
    let ecrit = false
    A.fetch = journalise(async (url, init = {}) => {
      const res = await fetch(url, init)
      if (!ecrit && new URL(url).pathname === '/v1/chain/manifest') {
        ecrit = true
        await web.ecrire('Doc.md', 'v2 du navigateur\n')
      }
      return res
    })
    const sA = await A.synchroniser()
    expect([sA.ops.del, sA.ops.relancer]).toEqual([[], ['Doc.md']])
    expect(A.fetch.requetes.filter((r) => r.methode === 'DELETE').map((r) => r.status)).toEqual([412])
    expect((await C.synchroniser()).ops.removeLocal).toEqual([])
    expect(lire(C, 'Doc.md')).toBe('v2 du navigateur\n')
    A.fetch = journalise()
    expect((await A.synchroniser()).ops.get).toEqual(['Doc.md'])
    expect(lire(A, 'Doc.md')).toBe('v2 du navigateur\n')

    // Le navigateur supprime à partir d'une version périmée : 412, la version de A reste.
    fs.writeFileSync(path.join(A.vaultPath, 'Doc.md'), 'v3 de A\n')
    await A.synchroniser()
    await expect(web.supprimer('Doc.md')).rejects.toMatchObject({ status: 412, code: 'CONFLICT' })
    expect(await prisma.chainDoc.count({ where: { chainId: A.creds.chainId, deletedAt: null } })).toBe(1)
  })

  test('nouvelle chaîne : l\'ancien casier reste tant qu\'un de ses documents n\'a pas pu être écrit sur l\'ordinateur', async () => {
    const A = ordinateur('Mac A3', dossier({ 'Notes.md': 'notes\n' }))
    const { web } = await nouvelleChaineDe(A)
    // Le navigateur dépose un nom que le système de fichiers de l'ordinateur refuse.
    const etrange = 'Brouillon\\..\\x.md'
    await web.ecrire(etrange, 'seulement dans le casier\n')
    expect((await A.synchroniser()).lastErrorCode).toBeNull()
    const ancienId = A.creds.chainId

    await A.chaine.preparer()
    expect(await A.chaine.renouveler()).toMatchObject({ ok: false, code: 'ROTATION_INCOMPLETE' })
    expect(await prisma.chain.findUnique({ where: { id: ancienId } })).not.toBeNull()
    expect(A.creds).toMatchObject({ chainId: ancienId })
    await web.lister()
    expect(await web.lireTexte(etrange)).toBe('seulement dans le casier\n')

    // Une fois le document retiré du casier, la reprise aboutit.
    await web.supprimer(etrange)
    expect(await A.chaine.renouveler()).toMatchObject({ ok: true, envoyes: 1 })
    expect(await prisma.chain.findUnique({ where: { id: ancienId } })).toBeNull()
    await retenirSecrets(A.creds.chainSecret)
  })

  test('disque insensible à la casse : renommage de casse et document au nom voisin, sans perte', { skip: !casseInsensible && 'disque sensible à la casse' }, async () => {
    const A = ordinateur('Mac A4', dossier({ 'notes.md': '# Notes\n' }))
    const { mots, web } = await nouvelleChaineDe(A)
    const B = ordinateur('Mac B4', dossier())
    expect(await B.chaine.rejoindre(mots.join(' '))).toMatchObject({ ok: true })
    await B.synchroniser()

    fs.renameSync(path.join(A.vaultPath, 'notes.md'), path.join(A.vaultPath, 'Notes.md'))
    for (let i = 0; i < 2; i++) {
      const s = await A.synchroniser()
      expect([s.ops.put, s.ops.del]).toEqual([[], []])
      await B.synchroniser()
    }
    expect(lire(A, 'Notes.md')).toBe('# Notes\n')
    expect(lire(B, 'notes.md')).toBe('# Notes\n')
    expect(await prisma.chainDoc.count({ where: { chainId: A.creds.chainId, deletedAt: null } })).toBe(1)

    // Le navigateur crée readme.md pendant que B a son propre README.md, jamais synchronisé.
    await web.ecrire('readme.md', 'écrit dans le navigateur\n')
    fs.writeFileSync(path.join(B.vaultPath, 'README.md'), 'texte de B\n')
    const sB = await B.synchroniser()
    expect([sB.ops.put, sB.ops.conflict]).toEqual([['README.md'], ['readme.md']])
    expect(lire(B, 'README.md')).toBe('texte de B\n')
    expect(versions(B, 'readme (conflict ')).toEqual(['écrit dans le navigateur\n'])
    const encore = await B.synchroniser()
    expect([encore.ops.del, encore.ops.conflict, encore.ops.get]).toEqual([[], [], []])
    await web.lister()
    expect(await web.lireTexte('readme.md')).toBe('écrit dans le navigateur\n')
  })

  test('journal du serveur : ni secret, ni preuve, ni id complet de ces chaînes', () => {
    expect(chercher([JOURNAL], secretsJournal)).toEqual([])
  })
})
