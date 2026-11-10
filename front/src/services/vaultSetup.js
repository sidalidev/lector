/**
 * Premier lancement : où vivent les notes.
 *
 * Une seule question, une réponse par plateforme :
 * - ordinateur : Documents/Lector Vault (créé par le processus principal) ;
 * - Android : le dossier choisi dans le sélecteur du système (SAF), sans
 *   aucune permission de stockage, Lector ne voit que ce dossier ;
 * - iOS : le dossier « Lector » d'iCloud Drive ;
 * - navigateur : « Lector Vault » dans le stockage du navigateur, ou un dossier
 *   du disque là où le navigateur sait l'ouvrir.
 *
 * Chaque fonction rend { rootDirPath, sourceType, name } ou null si
 * l'utilisateur renonce, et lève une erreur avec un `code` sinon.
 */

import fileSystem from './fileSystem'
import { t } from './i18n'

const NOM_VAULT = 'Lector Vault'

let pickerAndroid = null
async function picker() {
  if (!pickerAndroid) {
    const { registerPlugin } = await import('@capacitor/core')
    pickerAndroid = registerPlugin('FilePicker')
  }
  return pickerAndroid
}

function erreur(code) {
  return Object.assign(new Error(code), { code })
}

/** Dossiers Android dont Lector garde l'accès (le plus récent d'abord). */
async function dossiersAndroid() {
  try {
    const r = await (await picker()).persistedFolders()
    const liste = Array.isArray(r?.folders) ? r.folders : (typeof r?.folders === 'string' ? JSON.parse(r.folders) : [])
    return liste.sort((a, b) => (b.time || 0) - (a.time || 0))
  } catch { return [] }
}

/** Android : Lector ne garde que le dossier des notes, rend les autres. */
async function garderSeulement(uri) {
  const p = await picker()
  for (const d of await dossiersAndroid()) {
    if (d.path !== uri) { try { await p.releaseFolder({ uri: d.path }) } catch { /* déjà rendu */ } }
  }
}

/** Android : l'accès à ce dossier est-il toujours accordé ? */
export async function accesAndroid(uri) {
  return (await dossiersAndroid()).some((d) => d.path === uri)
}

export async function plateforme() {
  return fileSystem.getPlatformType()
}

/**
 * Ce que l'écran propose : { platform, name, path, exists, canChoose, canCreate }.
 * `exists` : un dossier de notes est déjà là, le bouton principal l'ouvre.
 */
export async function suggestion() {
  const platform = await plateforme()
  if (platform === 'electron') {
    const s = await window.electron.vault.suggest()
    return { platform, name: s.name, path: s.path, exists: !!s.exists, canChoose: true, canCreate: true }
  }
  if (platform === 'android') {
    const dossiers = await dossiersAndroid()
    const d = dossiers.find((x) => x.name === NOM_VAULT) || dossiers[0]
    return { platform, name: d?.name || NOM_VAULT, path: d?.path || null, exists: !!d, canChoose: true, canCreate: true }
  }
  if (platform === 'ios') {
    return { platform, name: 'Lector', path: null, exists: false, canChoose: false, canCreate: true }
  }
  const bv = await import('./browserVault')
  const connu = await bv.connu().catch(() => null)
  return {
    platform,
    name: connu?.nom || NOM_VAULT,
    path: null,
    exists: !!connu,
    canChoose: bv.peutChoisir(),
    canCreate: bv.peutCreer() || !!connu,
  }
}

/** Bouton principal : crée « Lector Vault » ou ouvre celui qui existe déjà. */
export async function creer(sugg) {
  const platform = sugg?.platform || await plateforme()
  if (platform === 'electron') {
    const r = await window.electron.vault.create()
    if (!r?.ok) throw erreur(r?.code || 'CREATE_FAILED')
    return { rootDirPath: r.path, sourceType: 'folder', name: r.path.split(/[\\/]/).pop() }
  }
  if (platform === 'android') {
    let r
    if (sugg?.exists && sugg.path && await accesAndroid(sugg.path)) {
      r = { path: sugg.path, name: sugg.name }
    } else {
      r = await (await picker()).pickVault({
        create: true,
        hint: t('onboarding.android.toast'),
        confirmHint: t('onboarding.android.confirmToast'),
      })
      if (!r || r.cancelled) return null
    }
    await garderSeulement(r.path)
    return { rootDirPath: r.path, sourceType: 'folder', name: r.name }
  }
  if (platform === 'ios') {
    if (!(await fileSystem.isAvailable())) throw erreur('ICLOUD_UNAVAILABLE')
    return { rootDirPath: 'icloud://', sourceType: 'icloud', name: 'Lector' }
  }
  const bv = await import('./browserVault')
  const connu = await bv.connu().catch(() => null)
  if (connu) {
    if (!(await bv.ouvrir({ demander: true }))) return null
    return { rootDirPath: bv.RACINE, sourceType: 'browser', name: connu.nom }
  }
  if (!bv.peutCreer()) throw erreur('BROWSER_UNSUPPORTED')
  await bv.creer()
  return { rootDirPath: bv.RACINE, sourceType: 'browser', name: NOM_VAULT }
}

/** Lien secondaire : un dossier qui existe déjà (un vault Obsidian, par exemple). */
export async function choisir() {
  const platform = await plateforme()
  if (platform === 'electron') {
    const r = await window.electron.vault.choose()
    if (!r?.ok) return null
    return { rootDirPath: r.path, sourceType: 'folder', name: r.path.split(/[\\/]/).pop() }
  }
  if (platform === 'android') {
    const r = await (await picker()).pickVault({ create: false })
    if (!r || r.cancelled) return null
    await garderSeulement(r.path)
    return { rootDirPath: r.path, sourceType: 'folder', name: r.name }
  }
  if (platform === 'ios') return null
  const bv = await import('./browserVault')
  const r = await bv.choisir()
  if (!r) return null
  return { rootDirPath: bv.RACINE, sourceType: 'browser', name: r.nom }
}

const estMarkdown = (nom) => /\.(md|markdown)$/i.test(nom || '')

function contientMarkdown(arbre) {
  return (arbre || []).some((e) => (e.isDirectory ? contientMarkdown(e.children) : estMarkdown(e.name)))
}

/**
 * Un dossier sans aucune note reçoit le document de bienvenue, pour apprendre
 * en lisant. Un dossier qui a déjà des notes n'est jamais touché.
 * Rend le chemin du document créé, ou null.
 */
export async function bienvenue(rootDirPath) {
  try {
    const arbre = await fileSystem.listDirectoryFiles(rootDirPath)
    if (contientMarkdown(arbre)) return null
    const nom = `${t('welcome.fileName')}.md`
    // Vault de la chaîne (navigateur) : écrire le document, c'est le créer.
    if (rootDirPath === 'cloud://') {
      await fileSystem.writeFile(`cloud://${nom}`, t('welcome.content'))
      return `cloud://${nom}`
    }
    const r = await fileSystem.createNewFile(rootDirPath, nom, t('welcome.content'))
    if (r?.uri) return r.uri
    if (rootDirPath === 'icloud://') return `icloud://${nom}`
    return null
  } catch {
    return null
  }
}

/**
 * Après « Set up sync » sur le web ou un téléphone, les notes du dossier
 * suivent dans la chaîne. Un chemin déjà présent dans la chaîne n'est jamais
 * écrasé ; le document de bienvenue intact reste local.
 * Rend { copies, echecs }.
 */
export async function copierVersChaine(source) {
  const aplatir = (arbre, prefixe = '') => (arbre || []).flatMap((e) =>
    e.isDirectory ? aplatir(e.children, `${prefixe}${e.name}/`) : [{ ...e, rel: `${prefixe}${e.name}` }])
  const dejaLa = new Set(aplatir(await fileSystem.listDirectoryFiles('cloud://')).map((e) => e.rel))
  const fichiers = aplatir(await fileSystem.listDirectoryFiles(source)).filter((e) => estMarkdown(e.name))
  let copies = 0
  let echecs = 0
  for (const f of fichiers) {
    if (dejaLa.has(f.rel)) continue
    try {
      const contenu = await fileSystem.readFile(f.path)
      if (typeof contenu !== 'string' || contenu === t('welcome.content')) continue
      await fileSystem.writeFile(`cloud://${f.rel}`, contenu)
      copies++
    } catch {
      echecs++
    }
  }
  return { copies, echecs }
}
