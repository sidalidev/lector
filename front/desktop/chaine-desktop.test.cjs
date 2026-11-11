// Tests du côté Electron (processus principal) contre le serveur simulé, sur de
// vrais dossiers temporaires : création et reprise, état, verrou de l'export,
// rejoindre, synchro chiffrée par SyncManager (markdown seulement, quota, flux),
// renouvellement, abandon, tout effacer, quitter, stockage des réglages ;
// disque réel : casse des noms, liens symboliques, chemins refusés,
// fichier modifié pendant un cycle ; arrêt de SyncManager et relances espacées.
// Lancer : npm run test:chaine

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { test } = require('node:test')
const { pathToFileURL } = require('node:url')

const { ChaineDesktop } = require('./chaine-desktop')
const { SyncManager, chargerBaseChaine } = require('./sync-manager')
const { chargerChaine } = require('./chaine-modules')
const { Vault } = require('./vault/vault')
const { maintainFormatsReadme } = require('./vault/formats-readme')
const cloudStore = require('./cloud-store')

const URL_SERVEUR = 'http://serveur.test'
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

async function serveurSimule(options) {
  const m = await import(pathToFileURL(path.join(__dirname, '../src/services/chaine/serveur-simule.mjs')).href)
  return m.creerServeurSimule(options)
}

function dossier(fichiers = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-desktop-'))
  for (const [c, t] of Object.entries(fichiers)) {
    fs.mkdirSync(path.dirname(path.join(d, c)), { recursive: true })
    fs.writeFileSync(path.join(d, c), t)
  }
  return d
}
const lire = (d, c) => fs.readFileSync(path.join(d, c), 'utf8')
const existe = (d, c) => fs.existsSync(path.join(d, c))

async function attendre(condition, delai = 5000) {
  const fin = Date.now() + delai
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error('Délai dépassé')
    await new Promise((r) => setTimeout(r, 20))
  }
}

/** Un Electron simulé : ses réglages (comme cloud-secrets.dat), sa ChaineDesktop, son SyncManager. */
function poste(serveur, vaultPath) {
  const p = {
    creds: { vaultPath, serverUrl: URL_SERVEUR, deviceId: randomUUID() },
    fetch: serveur.fetch,
    verrou: false,
    evenements: [],
    arrets: 0,
    demarrages: 0,
    sm: null,
    ops: null,
    async synchroniser() {
      p.sm = new SyncManager({
        vaultPath, serverUrl: URL_SERVEUR, chainSecret: p.creds.chainSecret, deviceId: p.creds.deviceId, fetchImpl: (...a) => p.fetch(...a), flux: false,
      })
      p.sm.on('error', () => {})
      p.sm.on('sync-complete', (e) => { p.ops = e.ops })
      p.ops = null
      try { await p.sm._syncOnce() } catch (err) { if (!p.sm._handleFatal(err)) throw err }
      return { ...p.sm.getStatus(), ops: p.ops }
    },
  }
  p.chaine = new ChaineDesktop({
    getCreds: () => p.creds,
    saveCreds: (c) => { p.creds = c },
    fetchImpl: (...a) => p.fetch(...a),
    arreterSynchro: async () => { p.arrets++ },
    demarrerSynchro: async () => { p.demarrages++ },
    verrouOuvert: () => p.verrou,
    stockageSur: () => true,
    emettre: (e) => p.evenements.push(e),
    serverUrlParDefaut: URL_SERVEUR,
  })
  return p
}

/** fetch qui échoue sur les dépôts au-delà du n-ième (coupure réseau en plein envoi). */
function fragile(serveur, n) {
  let depots = 0
  return async (url, init = {}) => {
    if ((init.method || 'GET') === 'PUT' && ++depots > n) throw new TypeError('fetch failed')
    return serveur.fetch(url, init)
  }
}

test('Electron : création, export sous verrou, rejoindre, synchro, renouvellement, tout effacer', async (t) => {
  const serveur = await serveurSimule()
  const dA = dossier({ 'Pro/Notes.md': '# Notes\nsecret\n', 'Été/Idée.md': 'idée', 'Images/photo.png': PNG })
  const dB = dossier({ 'B hors ligne.md': 'écrit sur B', 'local.txt': 'reste ici' })
  t.after(() => { for (const d of [dA, dB]) fs.rmSync(d, { recursive: true, force: true }) })
  const A = poste(serveur, dA)
  const B = poste(serveur, dB)

  // --- Création depuis A ---
  const prep = await A.chaine.preparer()
  assert.equal(prep.ok, true, JSON.stringify(prep))
  assert.equal(prep.mots.length, 12)
  assert.match(prep.code, /^lector-chaine:[A-Za-z0-9_-]{22}$/)
  assert.equal(prep.envoi.fichiers, 2, 'seul le markdown partira')
  const r = await A.chaine.creer()
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(r.envoyes, 2)
  assert.match(A.creds.chainSecret, /^[0-9a-f]{32}$/)
  assert.equal(A.creds.chainPendingSecret, undefined)
  assert.equal(A.creds.chainSaved, false)
  assert.equal(chargerBaseChaine(dA).chainId, A.creds.chainId)
  assert.ok(A.evenements.some((e) => e.type === 'chain-progress' && e.phase === 'estimate' && e.fichiers === 2 && e.quotaBytes > 0))
  assert.ok(A.evenements.some((e) => e.type === 'chain-progress' && e.phase === 'upload' && e.fait === e.total && e.total === 2))
  assert.equal(A.demarrages, 1)

  // L'état renvoyé au renderer ne contient jamais S.
  const etat = await A.chaine.etat()
  assert.equal(etat.hasChain, true)
  assert.equal(etat.serveur.docCount, 2)
  assert.equal(etat.saved, false)
  assert.equal(JSON.stringify(etat).includes(A.creds.chainSecret), false)
  assert.equal((await A.chaine.marquerSauvegardee()).ok, true)
  assert.equal((await A.chaine.etat()).saved, true)

  // Export : refusé verrou fermé, mêmes 12 mots que ceux notés à la création.
  assert.equal((await A.chaine.exporter()).code, 'LOCKED')
  A.verrou = true
  const ex = await A.chaine.exporter()
  assert.deepEqual(ex.mots, prep.mots)
  assert.equal(ex.code, prep.code)

  // --- B, sans chaîne : aucun appel réseau ---
  const avant = serveur.etat.journal.length
  const eB = await B.chaine.etat()
  assert.deepEqual([eB.ok, eB.hasChain, eB.pending], [true, false, null])
  assert.equal(serveur.etat.journal.length, avant)

  // --- B rejoint : mots invalides, mots d'une autre chaîne, puis les bons ---
  const faux = [...ex.mots]
  faux[11] = faux[11] === 'abandon' ? 'ability' : 'abandon'
  assert.equal((await B.chaine.rejoindre(faux.join(' '))).code, 'CHECKSUM')
  assert.equal((await B.chaine.rejoindre('abandon '.repeat(11) + 'about')).code, 'CHAIN_UNKNOWN')
  assert.equal(B.creds.chainSecret, undefined, 'rien n\'est gardé')
  assert.equal(serveur.etat.chaines.size, 1, 'rejoindre ne crée jamais de casier')
  assert.equal((await B.chaine.rejoindre(ex.mots.join(' '))).ok, true)
  assert.equal(B.creds.chainId, A.creds.chainId)
  assert.equal((await B.synchroniser()).state, 'idle')
  assert.equal(lire(dB, 'Été/Idée.md'), 'idée')
  assert.equal(existe(dB, 'Images/photo.png'), false, 'les images ne voyagent pas')
  await A.synchroniser()
  assert.equal(lire(dA, 'B hors ligne.md'), 'écrit sur B')
  assert.equal(existe(dA, 'local.txt'), false)
  assert.equal(lire(dB, 'local.txt'), 'reste ici')

  // Modification chiffrée de bout en bout.
  fs.writeFileSync(path.join(dA, 'Pro/Notes.md'), 'v2 depuis A')
  await A.synchroniser()
  await B.synchroniser()
  assert.equal(lire(dB, 'Pro/Notes.md'), 'v2 depuis A')
  assert.equal(serveur.toutLeStockage().includes(Buffer.from('v2 depuis A')), false)
  const v = await A.chaine.verifier()
  assert.deepEqual([v.ok, v.verification.blocs, v.verification.illisibles, v.verification.horsFormat, v.verification.ok], [true, 3, 0, 0, true])

  // --- Nouvelle chaîne depuis A : B est arrêté sans rien perdre, puis rejoint ---
  const ancienId = A.creds.chainId
  const neuve = await A.chaine.preparer()
  const rot = await A.chaine.renouveler()
  assert.equal(rot.ok, true, JSON.stringify(rot))
  assert.notEqual(A.creds.chainId, ancienId)
  assert.equal(serveur.etat.chaines.has(ancienId), false)
  assert.equal(A.creds.chainSaved, false, 'de nouveaux mots à sauvegarder')
  fs.writeFileSync(path.join(dB, 'pendant.md'), 'écrit pendant la rotation')
  const sB = await B.synchroniser()
  assert.deepEqual([sB.state, sB.lastErrorCode], ['chain-unknown', 'CHAIN_UNKNOWN'])
  assert.equal((await B.chaine.etat()).code, 'CHAIN_UNKNOWN')
  assert.ok(B.creds.chainSecret, 'S n\'est pas effacé automatiquement')
  assert.equal(lire(dB, 'pendant.md'), 'écrit pendant la rotation')
  assert.equal((await B.chaine.rejoindre(neuve.mots.join(' '))).ok, true)
  await B.synchroniser()
  await A.synchroniser()
  assert.equal(lire(dA, 'pendant.md'), 'écrit pendant la rotation')
  assert.deepEqual(fs.readdirSync(dA, { recursive: true }).filter((f) => String(f).includes('conflict')), [], 'aucun conflit à l\'adoption')

  // --- Tout effacer : casier vidé, cet appareil oublie S, le vault local reste ---
  assert.equal((await A.chaine.effacerTout('oui')).code, 'CONFIRM_REQUIRED')
  assert.equal((await A.chaine.effacerTout('DELETE')).ok, true)
  assert.equal(A.creds.chainSecret, undefined)
  assert.equal(A.creds.vaultPath, dA)
  assert.equal(serveur.etat.chaines.size, 0)
  assert.equal(lire(dA, 'Pro/Notes.md'), 'v2 depuis A')
  assert.equal((await B.synchroniser()).state, 'chain-unknown')
})

test('Création coupée : reprise sans renvoyer, ou abandon qui retire le casier', async (t) => {
  const serveur = await serveurSimule()
  // 30 documents : la base locale est enregistrée tous les 20 envois.
  const dA = dossier(Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`doc${String(i).padStart(2, '0')}.md`, `contenu ${i}`])))
  const dC = dossier({ 'x.md': 'X', 'y.md': 'Y' })
  t.after(() => { for (const d of [dA, dC]) fs.rmSync(d, { recursive: true, force: true }) })
  const A = poste(serveur, dA)

  await A.chaine.preparer()
  A.fetch = fragile(serveur, 25)
  const coupe = await A.chaine.creer()
  assert.deepEqual([coupe.ok, coupe.code], [false, 'NETWORK'])
  assert.ok(A.creds.chainPendingSecret)
  assert.equal(A.creds.chainSecret, undefined)
  assert.equal((await A.chaine.etat()).pending, 'create')
  assert.equal((await A.chaine.preparer()).code, 'RESUME_REQUIRED')
  A.fetch = serveur.fetch
  const avant = serveur.etat.journal.length
  const repris = await A.chaine.creer()
  assert.equal(repris.ok, true, JSON.stringify(repris))
  // 25 documents sont arrivés : 20 notés dans la base, 5 reconnus à leur contenu. Seuls les 5 autres partent.
  assert.equal(serveur.etat.journal.slice(avant).filter((x) => x.methode === 'PUT').length, 5, 'les 25 documents déjà arrivés ne repartent pas')
  assert.equal(repris.envoyes, 30)
  assert.equal(serveur.verification(A.creds.chainId).ok, true)

  const C = poste(serveur, dC)
  await C.chaine.preparer()
  C.fetch = fragile(serveur, 0)
  assert.equal((await C.chaine.creer()).code, 'NETWORK')
  C.fetch = serveur.fetch
  assert.equal(serveur.etat.chaines.size, 2)
  const ab = await C.chaine.abandonner()
  assert.deepEqual([ab.ok, ab.promoted], [true, false])
  assert.equal(C.creds.chainPendingSecret, undefined)
  assert.equal(serveur.etat.chaines.size, 1, 'le casier inachevé est retiré')
  assert.equal((await C.chaine.abandonner()).code, 'NOTHING_PENDING')
})

test('Renouvellement coupé : reprise ; abandon après l\'effacement de l\'ancien casier : le nouveau devient la chaîne', async (t) => {
  const serveur = await serveurSimule()
  const dA = dossier({ 'a.md': 'A', 'b.md': 'B' })
  t.after(() => fs.rmSync(dA, { recursive: true, force: true }))
  const A = poste(serveur, dA)
  await A.chaine.preparer()
  assert.equal((await A.chaine.creer()).ok, true)
  const premier = A.creds.chainId
  A.verrou = true

  await A.chaine.preparer()
  A.fetch = fragile(serveur, 1)
  assert.equal((await A.chaine.renouveler()).code, 'NETWORK')
  A.fetch = serveur.fetch
  assert.equal(A.creds.chainId, premier, 'l\'ancienne chaîne reste celle de l\'appareil')
  assert.equal((await A.chaine.etat()).pending, 'rotate')
  assert.equal(A.demarrages, 2, 'la synchro reprend sur l\'ancienne chaîne')
  const repris = await A.chaine.renouveler()
  assert.equal(repris.ok, true, JSON.stringify(repris))
  assert.equal(serveur.etat.chaines.has(premier), false)
  const deuxieme = A.creds.chainId

  // Coupure juste après l'effacement de l'ancien casier : l'abandon promeut le nouveau.
  await A.chaine.preparer()
  const { client } = await A.chaine._chaine(A.chaine._attente.hex)
  await client.creer()
  A.creds = { ...A.creds, chainPendingSecret: A.chaine._attente.hex }
  const { client: ancien } = await A.chaine._chaine(A.creds.chainSecret)
  await ancien.effacerTout()
  const ab = await A.chaine.abandonner()
  assert.deepEqual([ab.ok, ab.promoted], [true, true])
  assert.notEqual(A.creds.chainId, deuxieme)
  assert.equal(A.creds.chainPendingSecret, undefined)
  assert.equal(serveur.etat.chaines.has(A.creds.chainId), true)
})

test('Quitter : S oublié, vault et casier intacts', async (t) => {
  const serveur = await serveurSimule()
  const dA = dossier({ 'a.md': 'A' })
  t.after(() => fs.rmSync(dA, { recursive: true, force: true }))
  const A = poste(serveur, dA)
  await A.chaine.preparer()
  await A.chaine.creer()
  const id = A.creds.chainId
  assert.equal((await A.chaine.quitter()).ok, true)
  assert.deepEqual([A.creds.chainSecret, A.creds.chainId, A.creds.vaultPath], [undefined, undefined, dA])
  assert.equal(serveur.etat.chaines.has(id), true)
  assert.equal(lire(dA, 'a.md'), 'A')
})

test('Lien avec l\'interface : mots donnés une fois par chaîne ; chaîne reçue de l\'interface sans dossier imposé', async (t) => {
  const serveur = await serveurSimule()
  const dA = dossier({ 'a.md': 'A' })
  t.after(() => fs.rmSync(dA, { recursive: true, force: true }))
  const A = poste(serveur, dA)
  // Sans chaîne : rien à donner.
  assert.equal((await A.chaine.motsPourInterface()).code, 'NO_SECRET')
  await A.chaine.preparer()
  await A.chaine.creer()
  const r = await A.chaine.motsPourInterface()
  assert.equal(r.ok, true)
  assert.equal(r.chainId, A.creds.chainId)
  assert.equal(r.mots.split(' ').length, 12)
  // Une autre chaîne ne marque rien ; la bonne, oui : les mots ne sont plus donnés.
  assert.equal(A.chaine.marquerInterfaceConnectee('autre').ok, false)
  assert.equal(A.chaine.marquerInterfaceConnectee(A.creds.chainId).ok, true)
  assert.equal((await A.chaine.motsPourInterface()).code, 'ALREADY_CONNECTED')
  // Un Mac neuf, sans dossier, reçoit la chaîne de l'interface : il la garde, sans synchroniser.
  const B = poste(serveur, undefined)
  delete B.creds.vaultPath
  const g = await B.chaine.garderDepuisInterface(r.mots)
  assert.equal(g.ok, true)
  assert.equal(B.creds.chainId, A.creds.chainId)
  assert.equal(B.creds.interfaceChainId, A.creds.chainId)
  assert.equal(B.demarrages, 0)
  assert.equal((await B.chaine.motsPourInterface()).code, 'ALREADY_CONNECTED')
  // Un Mac qui a déjà cette chaîne : rien ne change.
  assert.equal((await A.chaine.garderDepuisInterface(r.mots)).memeChaine, true)
  // Une autre chaîne : il garde la sienne et le signale ; passerSurChaine l'adopte, sans effacer l'ancien casier.
  const D = poste(serveur, undefined)
  delete D.creds.vaultPath
  await D.chaine.preparer()
  D.creds.vaultPath = dossier({})
  await D.chaine.creer()
  delete D.creds.vaultPath
  const motsD = (await D.chaine.motsPourInterface()).mots
  const idA = A.creds.chainId
  const h = await A.chaine.garderDepuisInterface(motsD)
  assert.deepEqual([h.ok, h.code, h.chainId], [false, 'HAS_CHAIN', D.creds.chainId])
  assert.equal(A.creds.chainId, idA)
  assert.equal((await A.chaine.passerSurChaine('pas des mots')).ok, false)
  assert.equal(A.creds.chainId, idA)
  const p = await A.chaine.passerSurChaine(motsD)
  assert.equal(p.ok, true)
  assert.deepEqual([A.creds.chainId, A.creds.interfaceChainId, A.creds.vaultPath], [D.creds.chainId, D.creds.chainId, dA])
  assert.equal(serveur.etat.chaines.has(idA), true)
  // Mots invalides : rien n'est gardé.
  const C = poste(serveur, undefined)
  assert.equal((await C.chaine.garderDepuisInterface('pas des mots')).ok, false)
  assert.equal(C.creds.chainSecret, undefined)
})

test('SyncManager : markdown seulement, casier plein signalé une fois, flux temps réel, casier disparu', async (t) => {
  const dA = dossier({ 'a.md': 'a'.repeat(100), 'b.md': 'b'.repeat(100), 'photo.png': PNG })
  const dB = dossier()
  t.after(() => { for (const d of [dA, dB]) fs.rmSync(d, { recursive: true, force: true }) })
  // Place exacte pour LECTOR-FORMATS.md (écrit au démarrage de la synchro), a.md et b.md.
  maintainFormatsReadme(dA)
  const quotaBytes = fs.statSync(path.join(dA, 'LECTOR-FORMATS.md')).size + 29 + 2 * (100 + 29)
  const serveur = await serveurSimule({ quotaBytes })
  const A = poste(serveur, dA)
  await A.chaine.preparer()
  assert.equal((await A.chaine.creer()).ok, true)
  A.verrou = true
  const { code } = await A.chaine.exporter()
  const B = poste(serveur, dB)
  assert.equal((await B.chaine.rejoindre(code)).ok, true)

  fs.writeFileSync(path.join(dA, 'c.md'), 'c'.repeat(100))
  const sm = new SyncManager({ vaultPath: dA, serverUrl: URL_SERVEUR, chainSecret: A.creds.chainSecret, deviceId: A.creds.deviceId, fetchImpl: serveur.fetch })
  const quotas = []
  const blocages = []
  sm.on('quota', (e) => quotas.push(e))
  sm.on('chain-block', (e) => blocages.push(e))
  sm.on('error', () => {})
  await sm.start()
  t.after(() => sm.stop())
  let st = sm.getStatus()
  assert.deepEqual([st.state, st.quotaFull, st.quotaPending, st.skipped], ['running', true, 1, 1])
  assert.equal(st.server.quotaBytes, quotaBytes)
  await sm._syncOnce()
  assert.equal(quotas.length, 1, 'un seul événement tant que le casier reste plein')

  // Un autre appareil supprime un document : le flux réveille A, qui suit et envoie c.md.
  await B.synchroniser()
  fs.unlinkSync(path.join(dB, 'a.md'))
  await B.synchroniser()
  await attendre(() => !existe(dA, 'a.md') && !sm.getStatus().quotaFull)
  st = sm.getStatus()
  assert.equal(st.quotaPending, 0)
  await B.synchroniser()
  assert.equal(lire(dB, 'c.md'), 'c'.repeat(100))
  assert.equal(existe(dA, 'photo.png'), true)

  // Le casier disparaît (effacé ailleurs) : la boucle s'arrête sans rien toucher.
  const { client } = await B.chaine._chaine(B.creds.chainSecret)
  await client.effacerTout()
  await attendre(() => sm.getStatus().state === 'chain-unknown')
  assert.deepEqual(blocages, [{ state: 'chain-unknown', code: 'CHAIN_UNKNOWN' }])
  assert.equal(lire(dA, 'b.md'), 'b'.repeat(100))
})

/** Une chaîne créée par A, que B rejoint ; les deux vaults sont synchronisés. `avant(vA)` prépare le vault de A. */
async function deuxPostes(t, serveur, fichiersA = {}, fichiersB = {}, avant = () => {}) {
  const A = poste(serveur, dossier(fichiersA))
  const B = poste(serveur, dossier(fichiersB))
  t.after(() => { for (const p of [A, B]) fs.rmSync(p.creds.vaultPath, { recursive: true, force: true }) })
  avant(A.creds.vaultPath)
  await A.chaine.preparer()
  assert.equal((await A.chaine.creer()).ok, true)
  A.verrou = true
  assert.equal((await B.chaine.rejoindre((await A.chaine.exporter()).code)).ok, true)
  await B.synchroniser()
  await A.synchroniser()
  return { A, B, vA: A.creds.vaultPath, vB: B.creds.vaultPath }
}

/** Dépose un document comme un autre client (navigateur, Linux, ancienne version). */
async function deposerDirect(p, chemin, texte) {
  const { client, cles } = await p.chaine._chaine(p.creds.chainSecret)
  const { crypto } = await chargerChaine()
  const doc = await crypto.chiffrerDocAvec(cles, chemin, Buffer.from(texte))
  await client.deposer(doc.docId, { bloc: doc.contentEnc, pathEnc: doc.pathEnc, mtime: new Date() })
  return doc.docId
}

const markdownSur = (d) => fs.readdirSync(d, { recursive: true }).map(String).filter((f) => f.endsWith('.md') && !f.startsWith('.')).sort()

// Le dossier temporaire du système distingue-t-il la casse ? (non sur macOS et Windows par défaut)
const casseInsensible = (() => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-casse-'))
  fs.writeFileSync(path.join(d, 'a'), '')
  const r = fs.existsSync(path.join(d, 'A'))
  fs.rmSync(d, { recursive: true, force: true })
  return r
})()

test('Vault : écriture et retrait seulement si le fichier est encore celui vu par la synchro ; jamais à travers un lien', (t) => {
  const d = dossier({ 'Doc.md': 'v1', 'Pro/Plan.md': 'plan' })
  const dehors = dossier({ 'Journal.md': 'dehors' })
  t.after(() => { for (const x of [d, dehors]) fs.rmSync(x, { recursive: true, force: true }) })
  fs.symlinkSync(dehors, path.join(d, 'Lien'))
  const v = new Vault(d)
  const sha = (s) => require('node:crypto').createHash('sha256').update(s).digest('hex')

  assert.throws(() => v.writeClear('Doc.md', Buffer.from('v2'), null, sha('autre')), { code: 'ECHANGED' })
  assert.throws(() => v.writeClear('Doc.md', Buffer.from('v2'), null, null), { code: 'ECHANGED' })
  assert.throws(() => v.remove('Doc.md', sha('autre')), { code: 'ECHANGED' })
  assert.equal(lire(d, 'Doc.md'), 'v1')
  v.writeClear('Doc.md', Buffer.from('v2'), null, sha('v1'))
  assert.equal(lire(d, 'Doc.md'), 'v2')
  v.remove('Pro/Plan.md', sha('plan'))
  assert.equal(existe(d, 'Pro'), false, 'le dossier vidé est retiré')

  assert.throws(() => v.writeClear('Lien/Journal.md', Buffer.from('écrasé')), { code: 'ESYMLINK' })
  assert.throws(() => v.writeClear('Lien/Nouveau.md', Buffer.from('x')), { code: 'ESYMLINK' })
  assert.throws(() => v.readClear('Lien/Journal.md'), { code: 'ESYMLINK' })
  assert.throws(() => v.remove('Lien/Journal.md'), { code: 'ESYMLINK' })
  assert.deepEqual(fs.readdirSync(dehors), ['Journal.md'])
  assert.equal(lire(dehors, 'Journal.md'), 'dehors')
  assert.equal(v.absent('Lien/Journal.md'), false, 'le fichier derrière le lien existe pour la synchro')
  assert.throws(() => v.writeClear('a\\..\\..\\x.md', Buffer.from('x')), { code: 'EINVALIDPATH' })
  assert.throws(() => v.absent('../x.md'), { code: 'EINVALIDPATH' })
  assert.deepEqual(fs.readdirSync(d).filter((n) => n.endsWith('.tmp')), [], 'aucun fichier temporaire laissé')
})

test('Lien symbolique dans le vault : jamais suivi, rien n\'est écrit dehors ni supprimé sur les autres appareils', async (t) => {
  const serveur = await serveurSimule()
  const dehors = dossier({ 'Journal.md': 'journal de A, hors du vault' })
  const ailleurs = dossier()
  t.after(() => { for (const x of [dehors, ailleurs]) fs.rmSync(x, { recursive: true, force: true }) })
  // Chez A, Pro est un lien vers un dossier de travail hors du vault ; chez B, un vrai dossier.
  const { A, B, vA, vB } = await deuxPostes(t, serveur, { 'Notes/x.md': 'x' }, { 'Pro/Journal.md': 'journal de B', 'Pro/Plan.md': 'plan de B' },
    (vA) => fs.symlinkSync(dehors, path.join(vA, 'Pro')))
  for (let i = 0; i < 2; i++) {
    await A.synchroniser()
    await B.synchroniser()
  }
  assert.deepEqual(fs.readdirSync(dehors), ['Journal.md'])
  assert.equal(lire(dehors, 'Journal.md'), 'journal de A, hors du vault')
  assert.deepEqual([lire(vB, 'Pro/Journal.md'), lire(vB, 'Pro/Plan.md')], ['journal de B', 'plan de B'])

  // Un dossier déjà synchronisé, déplacé puis remplacé par un lien : pas de pierre tombale.
  fs.renameSync(path.join(vA, 'Notes'), path.join(ailleurs, 'Notes'))
  fs.symlinkSync(path.join(ailleurs, 'Notes'), path.join(vA, 'Notes'))
  const s = await A.synchroniser()
  assert.deepEqual(s.ops.del, [])
  await B.synchroniser()
  assert.equal(lire(vB, 'Notes/x.md'), 'x')
  assert.equal(serveur.verification(A.creds.chainId).blocs, 3)
})

test('Chemin refusé par le vault (antislash, « .. ») : ce document est sauté, la création et la synchro continuent', { skip: process.platform === 'win32' && 'nom de fichier impossible sous Windows' }, async (t) => {
  const serveur = await serveurSimule()
  const { A, B, vA, vB } = await deuxPostes(t, serveur, { 'a\\..\\x.md': 'nom étrange', 'Bon local.md': 'ok' })
  assert.deepEqual(markdownSur(vB), ['Bon local.md'])
  await deposerDirect(A, 'b\\..\\..\\y.md', 'refusé partout')
  await deposerDirect(A, 'Bon.md', 'bon')
  const s = await B.synchroniser()
  assert.deepEqual([s.lastErrorCode, s.ops.get, s.notWritten], [null, ['Bon.md'], 1], 'signalé, sans arrêter le cycle')
  assert.equal(lire(vB, 'Bon.md'), 'bon')
  assert.deepEqual(markdownSur(vB), ['Bon local.md', 'Bon.md'])
  const sA = await A.synchroniser()
  assert.deepEqual([sA.lastErrorCode, sA.notWritten], [null, 2], 'son fichier au nom étrange et celui déposé ailleurs')
  assert.equal(lire(vA, 'a\\..\\x.md'), 'nom étrange')
})

test('Disque insensible à la casse : renommage de casse et adoption sans perte', { skip: !casseInsensible && 'disque sensible à la casse' }, async (t) => {
  const serveur = await serveurSimule()
  const { A, B, vA, vB } = await deuxPostes(t, serveur, { 'notes.md': '# Mes notes\n' })
  fs.renameSync(path.join(vA, 'notes.md'), path.join(vA, 'Notes.md'))
  for (let i = 0; i < 2; i++) {
    const s = await A.synchroniser()
    assert.deepEqual([s.ops.put, s.ops.del], [[], []])
    await B.synchroniser()
  }
  assert.deepEqual(markdownSur(vA), ['Notes.md'])
  assert.equal(lire(vA, 'Notes.md'), '# Mes notes\n')
  assert.equal(lire(vB, 'notes.md'), '# Mes notes\n')

  // Un autre client dépose readme.md ; C arrive avec son propre README.md, jamais synchronisé.
  await deposerDirect(A, 'readme.md', 'contenu Linux\n')
  const C = poste(serveur, dossier({ 'README.md': 'texte de C\n' }))
  t.after(() => fs.rmSync(C.creds.vaultPath, { recursive: true, force: true }))
  assert.equal((await C.chaine.rejoindre((await A.chaine.exporter()).code)).ok, true)
  const s = await C.synchroniser()
  assert.deepEqual([s.ops.put, s.ops.conflict], [['README.md'], ['readme.md']])
  const vC = C.creds.vaultPath
  assert.equal(lire(vC, 'README.md'), 'texte de C\n')
  const copie = markdownSur(vC).find((c) => c.startsWith('readme (conflict '))
  assert.equal(lire(vC, copie), 'contenu Linux\n')
  const encore = await C.synchroniser()
  assert.deepEqual([encore.ops.del, encore.ops.conflict, encore.ops.get], [[], [], []])
})

test('Fichier enregistré pendant un cycle : ni écrasé par le téléchargement, copie de conflit au cycle suivant', async (t) => {
  const serveur = await serveurSimule()
  const { A, B, vA, vB } = await deuxPostes(t, serveur, { 'Doc.md': 'v1' })
  fs.writeFileSync(path.join(vA, 'Doc.md'), 'v2 de A')
  await A.synchroniser()
  // L'utilisateur de B enregistre pendant que la v2 se télécharge.
  B.fetch = async (url, init = {}) => {
    const res = await serveur.fetch(url, init)
    if ((init.method || 'GET') === 'GET' && url.includes('/docs/')) fs.writeFileSync(path.join(vB, 'Doc.md'), 'saisie de B')
    return res
  }
  const s = await B.synchroniser()
  B.fetch = serveur.fetch
  assert.deepEqual([s.ops.get, s.ops.relancer], [[], ['Doc.md']])
  assert.equal(lire(vB, 'Doc.md'), 'saisie de B')
  assert.deepEqual((await B.synchroniser()).ops.conflict, ['Doc.md'])
  const copie = markdownSur(vB).find((c) => c.startsWith('Doc (conflict '))
  assert.equal(lire(vB, copie), 'v2 de A')
  await A.synchroniser()
  assert.equal(lire(vA, 'Doc.md'), 'saisie de B')
})

/** fetch du serveur simulé, ralenti, qui compte les requêtes. */
function compteur(serveur, delai = 0) {
  const f = async (url, init = {}) => {
    f.requetes.push(`${init.method || 'GET'} ${new URL(url).pathname}`)
    if (delai) await new Promise((r) => setTimeout(r, delai))
    return serveur.fetch(url, init)
  }
  f.requetes = []
  return f
}

test('SyncManager.stop() pendant le démarrage ou un cycle : plus rien n\'est écrit, installé ni relancé', async (t) => {
  const serveur = await serveurSimule()
  const { A, B, vB } = await deuxPostes(t, serveur, { 'a.md': 'a' })
  const lent = compteur(serveur, 150)
  const nouveau = () => new SyncManager({ vaultPath: vB, serverUrl: URL_SERVEUR, chainSecret: B.creds.chainSecret, deviceId: B.creds.deviceId, fetchImpl: lent })

  // Quitter pendant le premier cycle de start().
  fs.writeFileSync(path.join(A.creds.vaultPath, 'pendant.md'), 'pendant')
  await A.synchroniser()
  const sm = nouveau()
  sm.on('error', () => {})
  t.after(() => sm.stop())
  const demarrage = sm.start()
  await new Promise((r) => setTimeout(r, 50))
  await sm.stop()
  await demarrage
  assert.deepEqual([sm.state, sm.watcher, sm.pollTimer, sm.fluxCtrl], ['stopped', null, null, null])
  assert.equal(existe(vB, 'pendant.md'), false, 'le téléchargement en cours ne s\'écrit pas après stop()')
  const apres = lent.requetes.length
  fs.writeFileSync(path.join(vB, 'nouveau.md'), 'écrit après stop')
  sm.triggerSync()
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(lent.requetes.length, apres, 'aucune requête après stop()')

  // Arrêt pendant un cycle alors qu'un autre était demandé : pas de relance.
  const sm2 = nouveau()
  sm2.on('error', () => {})
  const cycle = sm2._syncOnce()
  sm2.triggerSync()
  await new Promise((r) => setTimeout(r, 50))
  await sm2.stop()
  await cycle
  const n = lent.requetes.length
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(lent.requetes.length, n)
  assert.equal(existe(vB, 'pendant.md'), false)
  assert.equal(serveur.verification(A.creds.chainId).blocs, 2, 'nouveau.md n\'est jamais parti')
})

test('SyncManager : un cycle à relancer repart après un délai croissant, un bloc absent du serveur n\'est pas relancé', async (t) => {
  const serveur = await serveurSimule()
  const { A, B, vA } = await deuxPostes(t, serveur, { 'a.md': 'a' })
  const lancer = async (fetchImpl) => {
    const sm = new SyncManager({ vaultPath: vA, serverUrl: URL_SERVEUR, chainSecret: A.creds.chainSecret, deviceId: A.creds.deviceId, fetchImpl, flux: false })
    sm.on('error', () => {})
    await sm.start()
    await new Promise((r) => setTimeout(r, 1500))
    await sm.stop()
    return fetchImpl.requetes.filter((r) => r.endsWith('/manifest')).length
  }

  // Chaque dépôt répond 412 (un autre appareil écrit sans cesse) : 1 s, puis 2 s...
  fs.writeFileSync(path.join(vA, 'b.md'), 'b')
  const conflits = compteur({
    fetch: async (url, init = {}) => (init.method === 'PUT'
      ? new Response(JSON.stringify({ error: 'Document changed on the server', code: 'CONFLICT' }), { status: 412 })
      : serveur.fetch(url, init)),
  })
  assert.ok(await lancer(conflits) <= 3)

  // Bloc annoncé vivant mais absent du disque du serveur : 404 au GET.
  fs.unlinkSync(path.join(vA, 'b.md'))
  await A.synchroniser()
  const perdu = await deposerDirect(B, 'Perdu.md', 'x')
  const manquant = compteur({
    fetch: async (url, init = {}) => ((init.method || 'GET') === 'GET' && url.endsWith(`/docs/${perdu}`)
      ? new Response(JSON.stringify({ error: 'Block missing on the server', code: 'DOC_UNKNOWN' }), { status: 404 })
      : serveur.fetch(url, init)),
  })
  assert.equal(await lancer(manquant), 1)
})

/** safeStorage simulé : « chiffre » en inversant les octets, pour vérifier qu'aucun secret n'est écrit en clair. */
const safeStorageSimule = (disponible) => ({
  isEncryptionAvailable: () => disponible,
  encryptString: (s) => Buffer.from([0x00, ...Buffer.from(s, 'utf8').map((o) => o ^ 0xff)]),
  decryptString: (b) => Buffer.from(b.subarray(1).map((o) => o ^ 0xff)).toString('utf8'),
})

test('cloud-store : un ancien fichier perd ses champs morts, deviceId aléatoire, anciens fichiers supprimés', (t) => {
  const d = dossier({ 'cloud-device-ids.json': '{}', 'cloud-chaine-vue.json': '{}', 'reader-prefs.json': '{}' })
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  cloudStore.init({ userDataPath: d, safeStorage: safeStorageSimule(false), logger: () => {} })
  assert.match(cloudStore.load().deviceId, /^[0-9a-f-]{36}$/, 'sans fichier : réglages vierges')

  const ancien = { jwt: 'eyJ.x.y', email: 'a@example.test', deviceId: 'cm123', deviceName: 'Mac', vaultPath: '/v', serverUrl: 'https://s.test', chainSecret: 'ab'.repeat(16), chainId: 'cd'.repeat(16) }
  fs.writeFileSync(path.join(d, 'cloud-secrets.dat'), JSON.stringify(ancien))
  const creds = cloudStore.load()
  assert.deepEqual(Object.keys(creds).sort(), ['deviceId', 'serverUrl', 'vaultPath'])
  assert.match(creds.deviceId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  const surDisque = fs.readFileSync(path.join(d, 'cloud-secrets.dat'), 'utf8')
  assert.equal(/jwt|email|deviceName|chainSecret/.test(surDisque), false, 'réécrit sans les champs morts')
  assert.deepEqual(cloudStore.load(), creds, 'stable au rechargement')

  cloudStore.nettoyerAnciensFichiers()
  assert.deepEqual(fs.readdirSync(d).sort(), ['cloud-secrets.dat'])

  cloudStore.init({ userDataPath: d, safeStorage: safeStorageSimule(true), logger: () => {} })
  cloudStore.save({ ...creds, chainSecret: 'ef'.repeat(16), chainSaved: true, jwt: 'jamais' })
  assert.equal(fs.readFileSync(path.join(d, 'cloud-secrets.dat')).includes(Buffer.from('ef'.repeat(16))), false, 'S chiffré sur le disque')
  const relu = cloudStore.load()
  assert.deepEqual([relu.chainSecret, relu.chainSaved, relu.jwt], ['ef'.repeat(16), true, undefined])
  assert.equal(cloudStore.isEncrypted(), true)
})

test('cloud-store : les fichiers des versions précédentes sont supprimés, clés API comprises', (t) => {
  const d = dossier()
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  const anciens = ['cloud-device-ids.json', 'cloud-chaine-vue.json', 'reader-prefs.json', 'api-keys.dat']
  for (const nom of anciens) fs.writeFileSync(path.join(d, nom), 'x')
  cloudStore.init({ userDataPath: d, safeStorage: safeStorageSimule(true), logger: () => {} })
  cloudStore.nettoyerAnciensFichiers()
  for (const nom of anciens) assert.equal(fs.existsSync(path.join(d, nom)), false, nom)
})

test('Tout effacer : dossier local à la corbeille seulement si la case est cochée', async (t) => {
  const serveur = await serveurSimule()
  const dA = dossier({ 'a.md': 'A' })
  const dB = dossier({ 'b.md': 'B' })
  const dC = dossier({ 'c.md': 'C' })
  t.after(() => { for (const d of [dA, dB, dC]) fs.rmSync(d, { recursive: true, force: true }) })

  // Ordre observé : effacement du casier, puis corbeille.
  const journal = []
  const equiper = (p, corbeille) => {
    const fetchServeur = p.fetch
    p.fetch = async (url, init = {}) => {
      if ((init.method || 'GET') === 'DELETE') journal.push('casier')
      return fetchServeur(url, init)
    }
    p.chaine.d.mettreALaCorbeille = corbeille
  }
  const creer = async (p) => {
    await p.chaine.preparer()
    assert.equal((await p.chaine.creer()).ok, true)
    p.verrou = true
  }

  // Case décochée : rien à la corbeille, le vault reste le vault.
  const A = poste(serveur, dA)
  await creer(A)
  equiper(A, async () => { throw new Error('ne doit pas être appelée') })
  journal.length = 0
  assert.deepEqual(await A.chaine.effacerTout('DELETE'), { ok: true, trashed: false })
  assert.deepEqual(journal, ['casier'])
  assert.equal(A.creds.vaultPath, dA)
  assert.equal(lire(dA, 'a.md'), 'A')

  // Case cochée : le dossier part à la corbeille après le casier.
  const B = poste(serveur, dB)
  await creer(B)
  const corbeille = []
  equiper(B, async (d) => { journal.push('corbeille'); corbeille.push(d) })
  journal.length = 0
  assert.deepEqual(await B.chaine.effacerTout('DELETE', { localFolder: true }), { ok: true, trashed: true })
  assert.deepEqual(journal, ['casier', 'corbeille'])
  assert.deepEqual(corbeille, [dB])
  assert.equal(B.creds.vaultPath, undefined)
  assert.equal(B.creds.chainSecret, undefined)

  // Corbeille refusée : le reste est effacé, le dossier reste le vault, l'écran le dit.
  const C = poste(serveur, dC)
  await creer(C)
  equiper(C, async () => { throw Object.assign(new Error('refus'), { code: 'TRASH_REFUSED' }) })
  const r = await C.chaine.effacerTout('DELETE', { localFolder: true })
  assert.deepEqual(r, { ok: true, trashed: false, trashError: 'TRASH_REFUSED' })
  assert.equal(C.creds.chainSecret, undefined)
  assert.equal(C.creds.vaultPath, dC)
  assert.equal(serveur.etat.chaines.size, 0)

  // Verrou fermé : rien n'est effacé, ni casier ni dossier.
  const D = poste(serveur, dA)
  await creer(D)
  D.verrou = false
  equiper(D, async () => { throw new Error('ne doit pas être appelée') })
  journal.length = 0
  assert.equal((await D.chaine.effacerTout('DELETE', { localFolder: true })).code, 'LOCKED')
  assert.deepEqual(journal, [])
})
