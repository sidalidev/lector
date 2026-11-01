// Chaîne de sync dans le navigateur et dans la vue web mobile (docs/CHAINE.md § 6.5, 9 et 10).
//
// Le web peut créer une chaîne (les 12 mots sont affichés une seule fois) ou
// en rejoindre une. Il ne garde jamais S : après preparer(S), seules des clés
// WebCrypto NON EXPORTABLES sont rangées dans IndexedDB (base « lector-chaine »),
// avec l'identifiant et la preuve. Un script qui tournerait sur la page pourrait
// utiliser les clés sur place, pas emporter S.
//
// Un seul VaultWebChaine par session, pour que l'empreinte du bloc lu serve de
// base à l'écriture (412 si le document a changé ailleurs entre-temps).

import { ErreurChaine, estChaineInconnue, estLectureLimitee } from './chaine/client.js'
import { clientDe, lireSaisie, nouvelleChaine, preparer } from './chaine/service.js'
import { VaultWebChaine, construireArbre } from './chaine/web-vault.js'
import { effacerDonneesLocales } from './effacementLocal.js'

// Même origine dans un navigateur ; l'app mobile sert ses pages en local et parle au serveur public.
const NATIF = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
export const SERVER = !NATIF && typeof location !== 'undefined' && /^https?:$/.test(location.protocol)
  ? `${location.protocol}//${location.host}`
  : 'https://lector.dockerbop.fr'

const BASE = 'lector-chaine'
const MAGASIN = 'cles'
const ENTREE = 'courante'
const VERSION_ENTREE = 2

/** Événement window : l'interface doit ouvrir l'écran de la chaîne (detail.code : CHAIN_UNKNOWN, NO_CHAIN, CHAIN_READ_LIMITED). */
export const EVENEMENT_CHAINE = 'lector-chaine-requise'

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

let cache // undefined = pas encore lu, null = aucune clé
let session = null // { chainId, vault }

/**
 * { id, preuve, cleEnc, cleMac } ou null. Une entrée d'une version précédente
 * (liée à un compte) est effacée : elle ne correspond à aucun casier actuel.
 */
export async function clesWeb() {
  if (cache !== undefined) return cache
  let entree = null
  try {
    entree = await transaction('readonly', (s) => s.get(ENTREE))
  } catch {
    entree = null
  }
  if (entree && entree.version !== VERSION_ENTREE) {
    await oublierCles()
    entree = null
  }
  cache = entree?.chainId && entree.cleEnc && entree.cleMac
    ? { id: entree.chainId, preuve: entree.preuve, cleEnc: entree.cleEnc, cleMac: entree.cleMac }
    : null
  return cache
}

/** Vrai si ce navigateur a une chaîne. */
export async function aUneChaine() {
  return !!(await clesWeb())
}

async function enregistrer(cles) {
  // CryptoKey est clonable dans IndexedDB ; elle reste non exportable.
  await transaction('readwrite', (s) => s.put({
    version: VERSION_ENTREE,
    chainId: cles.id,
    preuve: cles.preuve,
    cleEnc: cles.cleEnc,
    cleMac: cles.cleMac,
  }, ENTREE))
  cache = { id: cles.id, preuve: cles.preuve, cleEnc: cles.cleEnc, cleMac: cles.cleMac }
  session = null
}

async function oublierCles() {
  cache = null
  session = null
  try { await transaction('readwrite', (s) => s.delete(ENTREE)) } catch { /* rien à effacer */ }
}

const client = (cles) => clientDe(cles, { serverUrl: SERVER })

/** Signale à l'application qu'il faut ouvrir l'écran de la chaîne. */
export function signalerChaine(code) {
  try { window.dispatchEvent(new CustomEvent(EVENEMENT_CHAINE, { detail: { code } })) } catch { /* hors navigateur */ }
}

const echec = (err) => ({
  ok: false,
  code: err?.code || (err?.status ? `HTTP_${err.status}` : (err instanceof TypeError ? 'NETWORK' : 'UNKNOWN')),
  error: err?.message || String(err),
  detail: err?.detail || null,
})

/**
 * État pour l'interface, même forme que sur Electron :
 * { ok, hasChain, chainId, serveur: { bytesUsed, quotaBytes, maxDocBytes, maxDocs, docCount } }.
 * Casier inconnu (renouvelé ou effacé ailleurs) : les clés sont oubliées, { ok: false, code: 'CHAIN_UNKNOWN' }.
 */
export async function etatChaineWeb() {
  const cles = await clesWeb()
  if (!cles) return { ok: true, web: true, hasChain: false, chainId: null }
  try {
    const e = await client(cles).etat()
    return {
      ok: true,
      web: true,
      hasChain: true,
      chainId: cles.id,
      serveur: { bytesUsed: e.bytesUsed, quotaBytes: e.quotaBytes, maxDocBytes: e.maxDocBytes, maxDocs: e.maxDocs, docCount: e.docCount },
    }
  } catch (err) {
    if (estChaineInconnue(err)) {
      await oublierCles()
      return { ok: false, web: true, hasChain: false, code: 'CHAIN_UNKNOWN' }
    }
    return { ...echec(err), web: true, hasChain: true, chainId: cles.id }
  }
}

/**
 * Crée une chaîne depuis ce navigateur : nouveau S, casier créé, clés gardées.
 * Renvoie les 12 mots et le code une seule fois : l'interface les montre puis les oublie.
 */
export async function creerWeb() {
  const n = await nouvelleChaine()
  try {
    const cles = await preparer(n.S)
    await client(cles).creer()
    await enregistrer(cles)
    return { ok: true, chainId: cles.id, mots: n.mots, code: n.code }
  } catch (err) {
    return echec(err)
  } finally {
    n.S.fill(0)
  }
}

/**
 * Rejoint une chaîne avec les 12 mots ou le code. Rien n'est gardé si la saisie
 * est invalide (codes EMPTY, UNKNOWN_WORD, CHECKSUM, WORD_COUNT, INVALID_CODE)
 * ou si aucune chaîne ne correspond (CHAIN_UNKNOWN). Ne crée jamais de casier.
 */
export async function rejoindreWeb(saisie) {
  let S
  try {
    ({ S } = await lireSaisie(saisie))
    const cles = await preparer(S)
    await client(cles).etat()
    await enregistrer(cles)
    return { ok: true, chainId: cles.id }
  } catch (err) {
    return echec(err)
  } finally {
    S?.fill(0)
  }
}

/** Quitte la chaîne sur ce navigateur (efface les clés). Le casier et les autres appareils ne changent pas. */
export async function quitterWeb() {
  await oublierCles()
  return { ok: true }
}

/**
 * Efface tout le casier sur le serveur, puis les clés de la chaîne, puis tout
 * le stockage local de l'app (clés API de « lector-keys », localStorage,
 * sessionStorage, autres bases IndexedDB, caches) : voir effacementLocal.js.
 * Renvoie { ok: true, local: [ce qui a été effacé] }.
 */
export async function effacerToutWeb() {
  const cles = await clesWeb()
  if (!cles) return { ok: false, code: 'NO_CHAIN' }
  try {
    await client(cles).effacerTout()
  } catch (err) {
    if (!estChaineInconnue(err)) return echec(err)
  }
  await oublierCles()
  const local = await effacerDonneesLocales()
  return { ok: true, local }
}

/**
 * Vault « cloud:// » de cette session. Lève ErreurChaine 409 NO_CHAIN quand ce
 * navigateur n'a pas de chaîne.
 */
export async function vaultWebChaine() {
  const cles = await clesWeb()
  if (!cles) throw new ErreurChaine(409, 'NO_CHAIN', '')
  if (session?.chainId !== cles.id) session = { chainId: cles.id, vault: new VaultWebChaine({ client: client(cles), cles }) }
  return session.vault
}

/**
 * Erreur de la chaîne qui demande une action de l'utilisateur : on agit et on
 * la signale à l'application. Renvoie true si traitée. Les refus de place et
 * de format (413, NOT_MARKDOWN) restent à l'appelant, qui affiche un message.
 */
export async function traiterErreurChaine(err) {
  if (estChaineInconnue(err)) {
    // Sans le casier, les clés ne servent plus à rien : on les oublie.
    await oublierCles()
    signalerChaine('CHAIN_UNKNOWN')
    return true
  }
  if (err?.code === 'NO_CHAIN') {
    signalerChaine('NO_CHAIN')
    return true
  }
  if (estLectureLimitee(err)) {
    // Limite anti-partage : rien n'est oublié, l'écran de la chaîne dit
    // pourquoi les documents ne s'affichent pas. Une fois par 10 minutes au
    // plus : la liste et les lectures échouent ensemble.
    if (Date.now() - dernierSignalLimite > 10 * 60 * 1000) {
      dernierSignalLimite = Date.now()
      signalerChaine('CHAIN_READ_LIMITED')
    }
    return true
  }
  return false
}

let dernierSignalLimite = 0

export { construireArbre }
