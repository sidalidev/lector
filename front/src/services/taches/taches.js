// Tâches et rappels écrits dans les notes, en Markdown lisible sans Lector.
//
// Syntaxe (compatible Obsidian, plugins Tasks et Reminder) :
//   - [ ] Call the bank ⏰ 2026-11-03 14:30     rappel à 14 h 30
//   - [ ] Pay rent 📅 2026-11-05                échéance, rappel à 9 h ce jour-là
//   - [x] Send the form ✅ 2026-11-02           faite le 2 novembre
//
// Les dates sont des heures « murales » : 14:30 veut dire 14 h 30 là où se
// trouve l'appareil, comme dans Obsidian. Aucun fuseau n'est écrit dans le
// fichier, et chaque appareil programme ses notifications lui-même.
//
// Module pur : ni DOM, ni réseau, ni fichier. Testé par taches.test.mjs.

/** Heure du rappel d'une échéance sans heure (📅). */
export const HEURE_ECHEANCE = 9

// Préfixe de liste (citation et callout compris), case, puis au moins un caractère.
const LIGNE_TACHE = /^((?:[ \t]*>[ \t]?)*[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[)([ xX])(\][ \t]+)(\S.*)$/
// L'heure est prise large (« 25:00 », « 9:5 ») pour qu'une heure fausse annule le rappel au lieu de tomber sur 9 h.
const RAPPEL = /⏰️?[ \t]*(\d{4})-(\d{2})-(\d{2})(?:[ \tT]+(\d+):(\d+))?(?![\d:])/u
const ECHEANCE = /📅️?[ \t]*(\d{4})-(\d{2})-(\d{2})(?!\d)/u
const FAITE = /✅️?[ \t]*(\d{4})-(\d{2})-(\d{2})(?!\d)/u
const FAITE_PARTOUT = /[ \t]*✅️?[ \t]*\d{4}-\d{2}-\d{2}(?!\d)/gu
// Champs retirés du titre affiché (les autres emojis de Tasks restent visibles).
const CHAMPS = /[ \t]*(?:⏰️?[ \t]*\d{4}-\d{2}-\d{2}(?:[ \tT]+\d+:\d+)?|📅️?[ \t]*\d{4}-\d{2}-\d{2}|✅️?[ \t]*\d{4}-\d{2}-\d{2})(?![\d:])/gu
// Identifiant de bloc d'Obsidian en fin de ligne : la date de fin se place avant.
const ID_BLOC = /([ \t]+\^[A-Za-z0-9-]+)$/

const DEBUT_GENERE = '<!-- lector-generated -->'
const FIN_GENERE = '<!-- /lector-generated -->'

const deux = (n) => String(n).padStart(2, '0')

/** 'AAAA-MM-JJ' du jour local de `date`. */
export function jourLocal(date) {
  const d = date instanceof Date ? date : new Date(date)
  return `${d.getFullYear()}-${deux(d.getMonth() + 1)}-${deux(d.getDate())}`
}

/** 'AAAA-MM-JJ' n jours après `jour` (calendrier local, sans souci d'heure d'été). */
export function ajouterJours(jour, n) {
  const [a, m, j] = jour.split('-').map(Number)
  return jourLocal(new Date(a, m - 1, j + n, 12))
}

function dateValide(a, m, j) {
  if (m < 1 || m > 12 || j < 1 || j > 31) return false
  const d = new Date(a, m - 1, j, 12)
  return d.getFullYear() === a && d.getMonth() === m - 1 && d.getDate() === j
}

/**
 * Instant (ms) de l'heure murale a-m-j h:min dans le fuseau de l'appareil, ou
 * null si la date n'existe pas. Une heure sautée au passage à l'heure d'été
 * (2:30 un dimanche de mars) tombe juste après le saut, comme le fait Date.
 */
export function instantLocal(a, m, j, h = 0, min = 0) {
  if (!dateValide(a, m, j) || h < 0 || h > 23 || min < 0 || min > 59) return null
  return new Date(a, m - 1, j, h, min, 0, 0).getTime()
}

function lireJour(match) {
  if (!match) return null
  const [a, m, j] = [Number(match[1]), Number(match[2]), Number(match[3])]
  return dateValide(a, m, j) ? `${match[1]}-${match[2]}-${match[3]}` : null
}

/** Analyse une ligne ; null si ce n'est pas une tâche. */
export function analyserLigne(ligne) {
  const brut = ligne.endsWith('\r') ? ligne.slice(0, -1) : ligne
  const m = LIGNE_TACHE.exec(brut)
  if (!m) return null
  const reste = m[4]
  const fait = m[2] !== ' '

  let rappel = null
  let heure = null
  let jourRappel = null
  const r = RAPPEL.exec(reste)
  if (r) {
    const [a, mo, j] = [Number(r[1]), Number(r[2]), Number(r[3])]
    const avecHeure = r[4] !== undefined
    const heureLisible = !avecHeure || (r[4].length <= 2 && r[5].length === 2)
    const h = avecHeure ? Number(r[4]) : HEURE_ECHEANCE
    const mi = avecHeure ? Number(r[5]) : 0
    rappel = heureLisible ? instantLocal(a, mo, j, h, mi) : null
    if (rappel !== null) {
      heure = `${deux(h)}:${deux(mi)}`
      jourRappel = lireJour(r)
    }
  }
  const echeance = lireJour(ECHEANCE.exec(reste))
  if (rappel === null && echeance) {
    const [a, mo, j] = echeance.split('-').map(Number)
    rappel = instantLocal(a, mo, j, HEURE_ECHEANCE, 0)
  }
  const texte = reste.replace(CHAMPS, '').replace(ID_BLOC, '').trim()

  return {
    brut,
    fait,
    texte: texte || reste.trim(),
    rappel,                         // ms, ou null
    heure,                          // 'HH:mm' si ⏰ valide, sinon null
    jour: jourRappel || echeance,   // jour qui classe la tâche dans Today
    echeance,
    faitLe: lireJour(FAITE.exec(reste)),
  }
}

/**
 * Toutes les tâches d'une note : [{ chemin, ligne (1 = première ligne du fichier), ... }].
 * Ignore le bloc de code (``` et ~~~), l'en-tête YAML et le bloc lector-generated.
 */
export function analyserNote(contenu, chemin = '') {
  const lignes = String(contenu ?? '').split('\n')
  const taches = []
  let clotureCode = null
  let dansGenere = false
  let enTete = lignes[0]?.replace(/\r$/, '') === '---'
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i].replace(/\r$/, '')
    if (enTete) {
      if (i > 0 && (ligne === '---' || ligne === '...')) enTete = false
      continue
    }
    if (dansGenere) {
      if (ligne.includes(FIN_GENERE)) dansGenere = false
      continue
    }
    if (clotureCode === null && ligne.includes(DEBUT_GENERE)) {
      dansGenere = !ligne.includes(FIN_GENERE)
      continue
    }
    const cloture = /^[ \t]*(?:>[ \t]?)*[ \t]*(`{3,}|~{3,})/.exec(ligne)
    if (cloture) {
      const marque = cloture[1]
      if (clotureCode === null) clotureCode = marque
      else if (marque[0] === clotureCode[0] && marque.length >= clotureCode.length) clotureCode = null
      continue
    }
    if (clotureCode !== null) continue
    const t = analyserLigne(ligne)
    if (t) taches.push({ chemin, ligne: i + 1, ...t })
  }
  return taches
}

/**
 * Coche ou décoche la tâche de la ligne `ligne` (1 = première ligne).
 * Cocher ajoute « ✅ AAAA-MM-JJ » (comme le plugin Tasks), décocher le retire.
 * `attendu` : texte de la ligne vu par l'interface. Si le fichier a bougé entre
 * temps, la ligne est cherchée ailleurs ; introuvable ou en double, rien n'est
 * changé (null). Le reste du fichier, fins de ligne comprises, ne bouge pas.
 * Renvoie { contenu, fait, ligne } ou null.
 */
export function basculerTache(contenu, ligne, aujourdhui, attendu) {
  const lignes = String(contenu ?? '').split('\n')
  let i = ligne - 1
  const propre = (k) => lignes[k]?.replace(/\r$/, '')
  if (attendu !== undefined && propre(i) !== attendu) {
    const trouves = []
    lignes.forEach((_, k) => { if (propre(k) === attendu) trouves.push(k) })
    if (trouves.length !== 1) return null
    i = trouves[0]
  }
  if (i < 0 || i >= lignes.length) return null
  const fin = lignes[i].endsWith('\r') ? '\r' : ''
  const brut = propre(i)
  const m = LIGNE_TACHE.exec(brut)
  if (!m) return null
  // Une tâche dans un bloc de code n'est pas une tâche.
  if (!analyserNote(contenu).some((t) => t.ligne === i + 1)) return null

  let nouvelle
  const fait = m[2] === ' '
  if (fait) {
    let reste = m[4].replace(FAITE_PARTOUT, '')
    const id = ID_BLOC.exec(reste)
    const date = `✅ ${aujourdhui}`
    reste = id ? `${reste.slice(0, id.index).trimEnd()} ${date}${id[1]}` : `${reste.trimEnd()} ${date}`
    nouvelle = `${m[1]}x${m[3]}${reste}`
  } else {
    nouvelle = `${m[1]} ${m[3]}${m[4].replace(FAITE_PARTOUT, '').trimEnd()}`
  }
  lignes[i] = nouvelle + fin
  return { contenu: lignes.join('\n'), fait, ligne: i + 1 }
}

/**
 * Vue Today : tâches ouvertes en retard, du jour et des 7 jours suivants,
 * plus celles cochées aujourd'hui (pour pouvoir les décocher).
 * Tri : instant du rappel, puis note, puis ligne.
 */
export function vueAujourdhui(taches, maintenant = Date.now()) {
  const aujourdhui = jourLocal(maintenant)
  const limite = ajouterJours(aujourdhui, 7)
  const enRetard = []
  const duJour = []
  const aVenir = []
  for (const t of taches) {
    if (!t.jour) continue
    if (t.fait) {
      if (t.faitLe === aujourdhui && t.jour <= limite) duJour.push(t)
      continue
    }
    if (t.jour < aujourdhui) enRetard.push(t)
    else if (t.jour === aujourdhui) duJour.push(t)
    else if (t.jour <= limite) aVenir.push(t)
  }
  const ordre = (a, b) => (a.fait - b.fait)
    || ((a.rappel ?? 0) - (b.rappel ?? 0))
    || (a.chemin < b.chemin ? -1 : a.chemin > b.chemin ? 1 : 0)
    || (a.ligne - b.ligne)
  return { enRetard: enRetard.sort(ordre), aujourdhui: duJour.sort(ordre), aVenir: aVenir.sort(ordre) }
}

/** Entier positif 31 bits stable (FNV-1a), pour l'identifiant d'une notification. */
export function empreinte31(texte) {
  let h = 0x811c9dc5
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 1) || 1
}

/**
 * Rappels à confier au système : tâches ouvertes dont l'heure est à venir,
 * les `max` plus proches (iOS en garde 64 au plus).
 * [{ id, quand (ms), titre, note, chemin, ligne, brut }]
 */
export function rappelsAProgrammer(taches, maintenant = Date.now(), max = 50) {
  const vus = new Set()
  return taches
    .filter((t) => !t.fait && t.rappel !== null && t.rappel > maintenant)
    .sort((a, b) => a.rappel - b.rappel || (a.chemin < b.chemin ? -1 : 1) || a.ligne - b.ligne)
    .map((t) => {
      let id = empreinte31(`${t.chemin}\n${t.brut}\n${t.rappel}`)
      while (vus.has(id)) id = (id % 0x7ffffffe) + 1
      vus.add(id)
      return { id, quand: t.rappel, titre: t.texte, note: nomDeNote(t.chemin), chemin: t.chemin, ligne: t.ligne, brut: t.brut }
    })
    .slice(0, max)
}

/** Nom affiché d'une note : dernier segment du chemin, sans .md. */
export function nomDeNote(chemin) {
  let c = String(chemin || '')
  try { c = decodeURIComponent(c) } catch { /* chemin déjà lisible */ }
  return (c.split(/[/\\:]/).pop() || '').replace(/\.(md|markdown)$/i, '')
}

/**
 * Ligne d'une nouvelle tâche. Date et heure : ⏰ ; date seule : 📅 (rappel à 9 h).
 * Le texte tient sur une ligne.
 */
export function ligneTache(texte, { date, heure } = {}) {
  const propre = String(texte || '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  if (!propre) return null
  let ligne = `- [ ] ${propre}`
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    ligne += heure && /^\d{2}:\d{2}$/.test(heure) ? ` ⏰ ${date} ${heure}` : ` 📅 ${date}`
  }
  return ligne
}

/**
 * Contenu de Inbox.md après ajout de `ligne` : créé avec un titre s'il n'existe
 * pas, sinon la ligne s'ajoute à la fin du texte (avant un bloc lector-generated).
 */
export function ajouterAInbox(existant, ligne) {
  if (existant == null || existant === '') return `# Inbox\n\n${ligne}\n`
  const crlf = existant.includes('\r\n')
  const nl = crlf ? '\r\n' : '\n'
  const debut = existant.indexOf(DEBUT_GENERE)
  const avant = debut === -1 ? existant : existant.slice(0, debut)
  const apres = debut === -1 ? '' : existant.slice(debut)
  const corps = avant.replace(/[\r\n]+$/, '')
  return `${corps}${nl}${ligne}${nl}${apres ? nl + apres : ''}`
}
