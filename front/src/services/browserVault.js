/**
 * Vault du navigateur : un dossier de fichiers Markdown, sans serveur.
 *
 * Deux racines possibles, même API (FileSystemDirectoryHandle) :
 * - « Lector Vault » dans le stockage privé de l'origine (OPFS), créé par
 *   « Create my Lector folder » : tous les navigateurs récents ;
 * - un dossier du disque choisi par l'utilisateur (showDirectoryPicker),
 *   par exemple un vault Obsidian : Chrome et Edge seulement.
 *
 * Les chemins sont « browser://dossier/note.md ». La poignée du dossier choisi
 * est gardée dans IndexedDB ; la permission se redemande après un rechargement
 * quand le navigateur l'a oubliée (un clic de l'utilisateur, jamais en silence).
 */

export const RACINE = 'browser://'
export const NOM_VAULT = 'Lector Vault'

const BASE = 'lector-browser-vault'
const MAGASIN = 'poignees'
const CLE = 'racine'

let racine = null // FileSystemDirectoryHandle ouvert pour cette session

function ouvrirBase() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(BASE, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(MAGASIN)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function lirePoignee() {
  try {
    const db = await ouvrirBase()
    return await new Promise((resolve) => {
      const req = db.transaction(MAGASIN, 'readonly').objectStore(MAGASIN).get(CLE)
      req.onsuccess = () => resolve(req.result || null)
      req.onerror = () => resolve(null)
    })
  } catch { return null }
}

async function ecrirePoignee(valeur) {
  const db = await ouvrirBase()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(MAGASIN, 'readwrite')
    tx.objectStore(MAGASIN).put(valeur, CLE)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Le navigateur sait-il créer le dossier privé (OPFS) ? */
export function peutCreer() {
  return typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory
}

/** Le navigateur sait-il ouvrir un dossier du disque ? */
export function peutChoisir() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

async function dossierPrive(creer) {
  const opfs = await navigator.storage.getDirectory()
  return opfs.getDirectoryHandle(NOM_VAULT, { create: creer })
}

async function permission(poignee, demander) {
  if (!poignee.queryPermission) return 'granted'
  const opts = { mode: 'readwrite' }
  let etat = await poignee.queryPermission(opts)
  if (etat !== 'granted' && demander) etat = await poignee.requestPermission(opts)
  return etat
}

/**
 * Le vault déjà connu de ce navigateur, sans rien demander :
 * { nom, type: 'prive' | 'disque', pret } ou null.
 * `pret` faux : le dossier du disque attend un clic pour retrouver sa permission.
 */
export async function connu() {
  const enregistre = await lirePoignee()
  if (enregistre?.type === 'disque' && enregistre.poignee) {
    try {
      const etat = await permission(enregistre.poignee, false)
      return { nom: enregistre.poignee.name, type: 'disque', pret: etat === 'granted' }
    } catch { return null }
  }
  if (peutCreer()) {
    try {
      await dossierPrive(false)
      return { nom: NOM_VAULT, type: 'prive', pret: true }
    } catch { /* pas encore créé */ }
  }
  return null
}

/**
 * Ouvre le vault connu pour cette session. `demander` : appelé depuis un clic,
 * peut afficher la demande de permission du navigateur. Vrai si c'est ouvert.
 */
export async function ouvrir({ demander = false } = {}) {
  const enregistre = await lirePoignee()
  if (enregistre?.type === 'disque' && enregistre.poignee) {
    if ((await permission(enregistre.poignee, demander)) !== 'granted') return false
    racine = enregistre.poignee
    return true
  }
  if (!peutCreer()) return false
  try {
    racine = await dossierPrive(false)
    return true
  } catch { return false }
}

/** Crée (ou rouvre) « Lector Vault » dans le stockage du navigateur. */
export async function creer() {
  let existait = false
  try { await dossierPrive(false); existait = true } catch { /* nouveau */ }
  racine = await dossierPrive(true)
  await ecrirePoignee({ type: 'prive' })
  // Demande au navigateur de ne pas effacer ce stockage pour faire de la place.
  try { await navigator.storage.persist?.() } catch { /* facultatif */ }
  return { existait }
}

/** Ouvre un dossier du disque choisi par l'utilisateur. null s'il renonce. */
export async function choisir() {
  let poignee
  try {
    poignee = await window.showDirectoryPicker({ id: 'lector-vault', mode: 'readwrite', startIn: 'documents' })
  } catch (err) {
    if (err?.name === 'AbortError') return null
    throw err
  }
  if ((await permission(poignee, true)) !== 'granted') return null
  racine = poignee
  await ecrirePoignee({ type: 'disque', poignee })
  return { nom: poignee.name }
}

function segments(chemin) {
  const rel = String(chemin || '').replace(RACINE, '')
  const parts = rel.split('/').filter(Boolean)
  if (parts.some((p) => p === '..' || p === '.')) throw new Error('Invalid path')
  return parts
}

async function assurerRacine() {
  if (racine) return racine
  if (await ouvrir()) return racine
  throw Object.assign(new Error('Vault not open'), { code: 'VAULT_CLOSED' })
}

async function dossierDe(parts, creer = false) {
  let d = await assurerRacine()
  for (const p of parts) d = await d.getDirectoryHandle(p, { create: creer })
  return d
}

const estMarkdown = (nom) => /\.(md|markdown)$/i.test(nom)

/** Arbre du dossier : dossiers et fichiers Markdown, les cachés sont ignorés. */
export async function lister(chemin = RACINE) {
  const parts = segments(chemin)
  const dossier = await dossierDe(parts)
  const base = RACINE + parts.map((p) => p + '/').join('')
  const entrees = []
  for await (const [nom, poignee] of dossier.entries()) {
    if (nom.startsWith('.')) continue
    if (poignee.kind === 'directory') {
      entrees.push({ name: nom, path: base + nom, isDirectory: true, children: await lister(base + nom) })
    } else if (estMarkdown(nom)) {
      entrees.push({ name: nom, path: base + nom, isDirectory: false })
    }
  }
  return entrees.sort((a, b) => (a.isDirectory === b.isDirectory ? a.name.localeCompare(b.name) : a.isDirectory ? -1 : 1))
}

export async function lire(chemin) {
  const parts = segments(chemin)
  const nom = parts.pop()
  const dossier = await dossierDe(parts)
  const fichier = await (await dossier.getFileHandle(nom)).getFile()
  return fichier.text()
}

export async function ecrire(chemin, contenu) {
  const parts = segments(chemin)
  const nom = parts.pop()
  if (!nom) throw new Error('Invalid path')
  const dossier = await dossierDe(parts, true)
  const poignee = await dossier.getFileHandle(nom, { create: true })
  const flux = await poignee.createWritable()
  await flux.write(contenu)
  await flux.close()
  return { success: true }
}

export async function existe(chemin) {
  try {
    const parts = segments(chemin)
    const nom = parts.pop()
    await (await dossierDe(parts)).getFileHandle(nom)
    return true
  } catch { return false }
}

export async function supprimer(chemin) {
  const parts = segments(chemin)
  const nom = parts.pop()
  await (await dossierDe(parts)).removeEntry(nom)
  return { success: true }
}

export async function creerDossier(chemin) {
  await dossierDe(segments(chemin), true)
  return { success: true }
}

/** Dossier parent d'un chemin browser://, racine comprise. */
export function parent(chemin) {
  const parts = segments(chemin)
  parts.pop()
  return RACINE + parts.join('/')
}
