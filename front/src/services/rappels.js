// Tâches et rappels de toutes les notes du vault.
//
// Chaque appareil lit ses notes, trouve les tâches datées (taches/taches.js) et
// programme lui-même ses notifications LOCALES. Aucun serveur ne connaît un
// rappel : sur le relais, les notes restent des blocs chiffrés.
//   - Android et iOS : @capacitor/local-notifications (AlarmManager, aucun
//     service Google). Alarme inexacte par défaut ; exacte seulement si
//     l'utilisateur l'a demandée et que le système l'accorde.
//   - Ordinateur : le processus principal d'Electron tient les minuteurs et
//     affiche les notifications tant que l'app tourne, fenêtre fermée comprise.
//   - Web : API Notification, tant que l'onglet est ouvert.
// Aucun polling : on relit les notes à l'ouverture, au retour au premier plan,
// à la fin d'une synchro et après une écriture de Lector.

import fileSystem from './fileSystem'
import { analyserNote, rappelsAProgrammer, basculerTache, jourLocal, ligneTache, ajouterAInbox } from './taches/taches.js'
import { cheminDans } from '../utils/chemins'

const NOM_INBOX = 'Inbox.md'
const CLE_EXACT = 'lector-rappels-exacts'
const CANAL = 'reminders'
const MAX_DELAI_WEB = 24 * 60 * 60 * 1000 // un minuteur par jour au plus, réarmé à la relecture suivante
const PARALLELE = 4

const natif = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
const android = () => natif() && window.Capacitor?.getPlatform?.() === 'android'
const electron = () => typeof window !== 'undefined' && !!window.electron?.rappels
const estMarkdown = (nom) => /\.(md|markdown)$/i.test(nom || '')

let pluginNotif = null
async function notifications() {
  if (!pluginNotif) pluginNotif = (await import('@capacitor/local-notifications')).LocalNotifications
  return pluginNotif
}

// --- État partagé (vue Today, barre latérale) ---

let etat = { root: null, taches: [], pret: false, complet: true, maj: 0 }
const abonnes = new Set()

export function etatTaches() { return etat }
export function abonner(fn) {
  abonnes.add(fn)
  return () => abonnes.delete(fn)
}
function publier(partiel) {
  etat = { ...etat, ...partiel, maj: Date.now() }
  for (const fn of abonnes) { try { fn() } catch { /* abonné défaillant */ } }
}

// --- Lecture des notes ---

/** Contenu d'une note, ou null. Sur ordinateur, lecture sans ouvrir le document. */
export async function lireNote(chemin) {
  if (chemin?.startsWith('demo://')) {
    const { getDemoFile } = await import('./demoContent')
    const { getLocale } = await import('./i18n')
    return getDemoFile(getLocale(), chemin.replace('demo://', ''))?.content ?? null
  }
  if (fileSystem.isElectron() && !chemin?.startsWith('cloud://') && !chemin?.startsWith('browser://')) {
    return window.electron.readFileSilent(chemin)
  }
  return fileSystem.readFile(chemin)
}

function aplatir(noeuds, sortie = []) {
  for (const n of noeuds || []) {
    if (n.isDirectory) aplatir(n.children, sortie)
    else if (estMarkdown(n.name)) sortie.push(n.path)
  }
  return sortie
}

async function enParallele(elements, fn) {
  let i = 0
  const travailleur = async () => {
    while (i < elements.length) {
      const e = elements[i++]
      await fn(e)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLELE, elements.length) }, travailleur))
}

/**
 * Toutes les tâches du vault. `complet` est faux si une note n'a pas pu être lue :
 * on ne retire alors aucun rappel déjà programmé.
 */
export async function collecterTaches(root) {
  if (!root) return { taches: [], complet: false }

  if (fileSystem.isElectron() && window.electron?.taches && !root.includes('://')) {
    const r = await window.electron.taches.collecter(root)
    if (!r?.ok) return { taches: [], complet: false }
    return { taches: r.notes.flatMap((n) => analyserNote(n.content, n.path)), complet: r.complet !== false }
  }

  // Vault de la chaîne (navigateur, téléphone) : lu sur le relais, déchiffré ici.
  // Une note inchangée depuis la dernière lecture sort du cache de la session.
  if (root.startsWith('cloud://')) {
    const chaine = await import('./chaineWeb')
    try {
      const vault = await chaine.vaultWebChaine()
      const liste = (await vault.lister()).filter((d) => estMarkdown(d.chemin))
      const taches = []
      let complet = true
      await enParallele(liste, async (d) => {
        try {
          taches.push(...analyserNote(await vault.lireTexte(d.chemin), `cloud://${d.chemin}`))
        } catch {
          complet = false
        }
      })
      return { taches, complet }
    } catch (err) {
      await chaine.traiterErreurChaine(err)
      return { taches: [], complet: false }
    }
  }

  const chemins = aplatir(await fileSystem.listDirectoryFiles(root))
  const taches = []
  let complet = chemins.length > 0
  await enParallele(chemins, async (chemin) => {
    const contenu = await lireNote(chemin)
    if (typeof contenu !== 'string') { complet = false; return }
    taches.push(...analyserNote(contenu, chemin))
  })
  return { taches, complet }
}

// --- Relecture (une à la fois) ---

let enCours = null
let encore = false
let minuteurDiffere = null

/** Relit le vault, publie les tâches et reprogramme les rappels. */
export function actualiser(root) {
  if (!root) return Promise.resolve()
  if (enCours) {
    encore = root
    return enCours
  }
  enCours = (async () => {
    if (etat.root !== root) publier({ root, taches: [], pret: false })
    try {
      const { taches, complet } = await collecterTaches(root)
      if (etat.root !== root) return
      publier({ taches, pret: true, complet })
      // Démo : rien n'est persisté, rien n'est programmé.
      if (complet && !root.startsWith('demo://')) await programmer(rappelsAProgrammer(taches, Date.now()))
    } catch (err) {
      console.warn('[Lector] Reminders not refreshed:', err?.message || err)
      if (etat.root === root) publier({ pret: true })
    }
  })().finally(() => {
    enCours = null
    if (encore) {
      const r = encore
      encore = false
      actualiser(r)
    }
  })
  return enCours
}

/** Relecture regroupée après des écritures rapprochées (frappe, synchro). */
export function actualiserBientot(root, delai = 1500) {
  clearTimeout(minuteurDiffere)
  minuteurDiffere = setTimeout(() => actualiser(root), delai)
}

/** Oublie les tâches d'un vault fermé. */
export function oublier() {
  publier({ root: null, taches: [], pret: false, complet: true })
}

// --- Permissions ---

/** 'granted' | 'denied' | 'prompt' | 'unsupported' */
export async function etatPermission() {
  if (electron()) return 'granted'
  if (natif()) {
    try {
      const p = await (await notifications()).checkPermissions()
      return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'
    } catch { return 'unsupported' }
  }
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission === 'default' ? 'prompt' : Notification.permission
}

/** Demande l'autorisation (le texte qui dit pourquoi est affiché avant par l'appelant). */
export async function demanderPermission() {
  if (electron()) return 'granted'
  if (natif()) {
    try {
      const p = await (await notifications()).requestPermissions()
      return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'
    } catch { return 'unsupported' }
  }
  if (typeof Notification === 'undefined') return 'unsupported'
  const r = await Notification.requestPermission()
  return r === 'default' ? 'prompt' : r
}

/** Android 12+ : alarme à la minute près. 'granted' | 'off' | 'unsupported'. */
export async function etatExact() {
  if (!android()) return 'unsupported'
  try {
    const choisi = localStorage.getItem(CLE_EXACT) === '1'
    const s = await (await notifications()).checkExactNotificationSetting()
    return choisi && s.exact_alarm === 'granted' ? 'granted' : 'off'
  } catch { return 'unsupported' }
}

/** Ouvre le réglage système « Alarmes et rappels » ; Lector ne s'en sert que si l'utilisateur l'accorde. */
export async function demanderExact() {
  if (!android()) return 'unsupported'
  try { localStorage.setItem(CLE_EXACT, '1') } catch { /* stockage indisponible */ }
  try {
    const s = await (await notifications()).changeExactNotificationSetting()
    return s.exact_alarm === 'granted' ? 'granted' : 'off'
  } catch { return 'off' }
}

// --- Programmation ---

const minuteursWeb = new Map() // id → { minuteur, quand }

async function programmer(liste) {
  if (electron()) {
    await window.electron.rappels.programmer(liste)
    return
  }
  if (natif()) return programmerNatif(liste)
  programmerWeb(liste)
}

let canalCree = false
async function programmerNatif(liste) {
  const LN = await notifications()
  // Jamais de demande ici : sans permission, rien n'est programmé.
  if ((await LN.checkPermissions()).display !== 'granted') return
  if (android() && !canalCree) {
    await LN.createChannel({
      id: CANAL,
      name: 'Reminders',
      description: 'Tasks you gave a date or a time',
      importance: 4,
      visibility: 0, // écran verrouillé : sans le contenu
      vibration: true,
    })
    canalCree = true
  }
  const exact = (await etatExact()) === 'granted'
  const attendus = new Map(liste.map((r) => [r.id, r]))
  const { notifications: enAttente = [] } = await LN.getPending()
  const presents = new Set(enAttente.map((n) => n.id))
  // Lector ne programme que des rappels : tout ce qui n'est plus attendu part.
  const aRetirer = enAttente.filter((n) => !attendus.has(n.id)).map((n) => ({ id: n.id }))
  if (aRetirer.length) await LN.cancel({ notifications: aRetirer })
  const aAjouter = liste.filter((r) => !presents.has(r.id))
  if (!aAjouter.length) return
  await LN.schedule({
    notifications: aAjouter.map((r) => ({
      id: r.id,
      title: r.titre,
      body: r.note,
      schedule: { at: new Date(r.quand), allowWhileIdle: true },
      channelId: CANAL,
      smallIcon: 'ic_stat_lector',
      autoCancel: true,
      isExactNotification: exact,
      extra: { chemin: r.chemin, ligne: r.ligne, brut: r.brut },
    })),
  })
}

function programmerWeb(liste) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const attendus = new Map(liste.map((r) => [r.id, r]))
  for (const [id, m] of minuteursWeb) {
    if (!attendus.has(id)) { clearTimeout(m.minuteur); minuteursWeb.delete(id) }
  }
  for (const r of liste) {
    const delai = r.quand - Date.now()
    if (minuteursWeb.has(r.id) || delai <= 0 || delai > MAX_DELAI_WEB) continue
    const minuteur = setTimeout(() => {
      minuteursWeb.delete(r.id)
      try {
        const n = new Notification(r.titre, { body: r.note, tag: `lector-${r.id}` })
        n.onclick = () => {
          try { window.focus() } catch { /* fenêtre déjà au premier plan */ }
          signalerOuverture({ chemin: r.chemin, ligne: r.ligne, brut: r.brut })
          n.close()
        }
      } catch { /* notification refusée par le navigateur */ }
    }, delai)
    minuteursWeb.set(r.id, { minuteur, quand: r.quand })
  }
}

// --- Toucher une notification : ouvrir la note à la bonne ligne ---

const ecouteursOuverture = new Set()
let ouvertureEnAttente = null
let ecouteNatifPosee = false
let ecouteElectronPosee = false

function signalerOuverture(o) {
  if (!o?.chemin) return
  if (!ecouteursOuverture.size) { ouvertureEnAttente = o; return }
  for (const fn of ecouteursOuverture) fn(o)
}

/** Appelle fn({ chemin, ligne, brut }) quand l'utilisateur touche un rappel. */
export function ecouterOuverture(fn) {
  ecouteursOuverture.add(fn)
  if (natif() && !ecouteNatifPosee) {
    ecouteNatifPosee = true
    notifications().then((LN) => LN.addListener('localNotificationActionPerformed', (e) => {
      const x = e?.notification?.extra || {}
      signalerOuverture({ chemin: x.chemin, ligne: Number(x.ligne) || 1, brut: x.brut })
    })).catch(() => { /* plugin absent (web) */ })
  }
  if (electron() && !ecouteElectronPosee) {
    ecouteElectronPosee = true
    window.electron.rappels.onOuvrir((o) => signalerOuverture(o))
    window.electron.rappels.enAttente().then((o) => { if (o) signalerOuverture(o) }).catch(() => {})
  }
  if (ouvertureEnAttente) {
    const o = ouvertureEnAttente
    ouvertureEnAttente = null
    setTimeout(() => fn(o), 0)
  }
  return () => ecouteursOuverture.delete(fn)
}

// --- Écritures : cocher depuis Today, ajout rapide ---

/** Écrit une note par le même chemin que l'éditeur ; lève si l'écriture échoue. */
async function ecrireNote(chemin, contenu) {
  const r = await fileSystem.writeFile(chemin, contenu)
  // Ordinateur : false ; Android (SAF) : null. Le vault de la chaîne lève lui-même.
  if (r === false || (r === null && chemin.startsWith('content://'))) throw new Error('write failed')
}

/**
 * Coche ou décoche une tâche dans sa note (relue juste avant) et l'écrit par
 * le même chemin que l'éditeur. Renvoie { contenu, fait } ou null si la ligne
 * a changé entre-temps. Lève l'erreur d'écriture (casier plein, conflit...).
 */
export async function basculerDansNote(tache) {
  const contenu = await lireNote(tache.chemin)
  if (typeof contenu !== 'string') return null
  const r = basculerTache(contenu, tache.ligne, jourLocal(Date.now()), tache.brut)
  if (!r) return null
  await ecrireNote(tache.chemin, r.contenu)
  return r
}

/**
 * Inbox.md à la racine : { chemin, avant } (avant = null s'il n'existe pas),
 * ou { chemin: null } s'il faut le créer dans le dossier.
 * Une lecture qui échoue pour une autre raison que l'absence lève : on
 * n'écrase jamais une Inbox qu'on n'a pas pu lire.
 */
async function lireInbox(root) {
  if (root === 'cloud://') {
    const chaine = await import('./chaineWeb')
    const vault = await chaine.vaultWebChaine()
    try {
      return { chemin: cheminDans(root, NOM_INBOX), avant: await vault.lireTexte(NOM_INBOX) }
    } catch (err) {
      if ((err?.status === 404 && err.code === 'DOC_UNKNOWN') || err?.status === 410) return { chemin: cheminDans(root, NOM_INBOX), avant: null }
      await chaine.traiterErreurChaine(err)
      throw err
    }
  }
  if (fileSystem.isElectron() && !root.includes('://')) {
    const chemin = cheminDans(root, NOM_INBOX)
    return { chemin, avant: await window.electron.readFileSilent(chemin) }
  }
  // Navigateur, Android (SAF), iCloud : l'adresse d'un fichier vient de la liste du dossier.
  const liste = await fileSystem.listDirectoryFiles(root)
  const trouve = (liste || []).find((n) => !n.isDirectory && n.name === NOM_INBOX)
  if (!trouve) return { chemin: null, avant: null }
  const avant = await lireNote(trouve.path)
  if (typeof avant !== 'string') throw new Error('read failed')
  return { chemin: trouve.path, avant }
}

/**
 * Ajoute « - [ ] texte » (avec ⏰ ou 📅) à Inbox.md à la racine du vault,
 * créé s'il n'existe pas. Renvoie { chemin, contenu }.
 */
export async function ajouterTache(root, texte, quand = {}) {
  const ligne = ligneTache(texte, quand)
  if (!ligne || !root) return null
  const { chemin, avant } = await lireInbox(root)
  const contenu = ajouterAInbox(avant, ligne)
  if (chemin) {
    await ecrireNote(chemin, contenu)
    return { chemin, contenu }
  }
  const r = await fileSystem.createNewFile(root, NOM_INBOX, contenu)
  if (!r?.uri) throw new Error('create failed')
  return { chemin: r.uri, contenu }
}
