// Historique des versions d'une note, gardé sur cet appareil (IndexedDB
// « lector-historique »). Rien ne part sur le réseau.
//
// Une version : { id, doc, date, texte, auteurs: [prénoms] }. `doc` : chemin
// de la note dans le vault, ou id du salon pour un document partagé ouvert par lien.
//
// Une version par tranche de 5 minutes d'écriture ; ensuite on éclaircit :
// tout pendant 24 h, une par heure pendant 7 jours, une par jour au-delà,
// 300 au plus par note.

const BASE = 'lector-historique'
const VERSIONS = 'versions'
const TRANCHE = 5 * 60 * 1000
const HEURE = 3600 * 1000
const JOUR = 24 * HEURE
const MAX = 300

let promesse = null
const memoire = []
let prochainId = 1

function base() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!promesse) {
    promesse = new Promise((resolve) => {
      try {
        const req = indexedDB.open(BASE, 1)
        req.onupgradeneeded = () => {
          const s = req.result.createObjectStore(VERSIONS, { keyPath: 'id', autoIncrement: true })
          s.createIndex('doc', 'doc')
        }
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => resolve(null)
        req.onblocked = () => resolve(null)
      } catch {
        resolve(null)
      }
    })
  }
  return promesse
}

function requete(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error) })
}

/** Versions d'une note, la plus récente d'abord. */
export async function lister(doc) {
  const db = await base()
  const liste = db
    ? await requete(db.transaction(VERSIONS).objectStore(VERSIONS).index('doc').getAll(doc))
    : memoire.filter((v) => v.doc === doc)
  return liste.sort((a, b) => b.date - a.date)
}

async function ecrire(versions, effacer = []) {
  const db = await base()
  if (!db) {
    for (const v of versions) {
      const i = memoire.findIndex((m) => m.id === v.id)
      if (i >= 0) memoire[i] = v
      else memoire.push({ ...v, id: v.id ?? prochainId++ })
    }
    for (const id of effacer) { const i = memoire.findIndex((m) => m.id === id); if (i >= 0) memoire.splice(i, 1) }
    return
  }
  await new Promise((resolve, reject) => {
    const tx = db.transaction(VERSIONS, 'readwrite')
    const s = tx.objectStore(VERSIONS)
    for (const v of versions) s.put(v)
    for (const id of effacer) s.delete(id)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error)
  })
}

/** Ids des versions à oublier (liste triée de la plus récente à la plus ancienne). */
export function aEclaircir(versions, maintenant = Date.now()) {
  const garder = new Set()
  const casesVues = new Set()
  for (const v of versions) {
    const age = maintenant - v.date
    if (age < JOUR) { garder.add(v.id); continue }
    const casier = age < 7 * JOUR ? `h${Math.floor(v.date / HEURE)}` : `j${Math.floor(v.date / JOUR)}`
    if (!casesVues.has(casier)) { casesVues.add(casier); garder.add(v.id) }
  }
  const gardees = versions.filter((v) => garder.has(v.id)).slice(0, MAX)
  const ids = new Set(gardees.map((v) => v.id))
  return versions.filter((v) => !ids.has(v.id)).map((v) => v.id)
}

/**
 * Note un état de la note. `avant` : le texte d'avant la première modification,
 * gardé comme première version s'il n'y en a pas encore.
 */
export async function noter(doc, texte, { auteurs = [], avant = null, maintenant = Date.now() } = {}) {
  if (!doc || typeof texte !== 'string') return
  try {
    const versions = await lister(doc)
    const derniere = versions[0]
    if (derniere?.texte === texte) return
    const nouvelles = []
    if (!derniere && avant != null && avant !== texte) {
      nouvelles.push({ doc, date: maintenant - 1, texte: avant, auteurs: [] })
    }
    if (derniere?.ouverte && maintenant - (derniere.debut ?? derniere.date) < TRANCHE) {
      // Même tranche de 5 minutes : la version courante s'allonge.
      nouvelles.push({ ...derniere, texte, date: maintenant, auteurs: [...new Set([...derniere.auteurs, ...auteurs])] })
    } else {
      if (derniere?.ouverte) nouvelles.push({ ...derniere, ouverte: false })
      nouvelles.push({ doc, date: maintenant, texte, auteurs: [...new Set(auteurs)], ouverte: true, debut: maintenant })
    }
    await ecrire(nouvelles)
    const toutes = await lister(doc)
    const vieilles = aEclaircir(toutes, maintenant)
    if (vieilles.length) await ecrire([], vieilles)
  } catch {
    // Historique indisponible : la note, elle, est enregistrée.
  }
}

/** Oublie l'historique d'une note (note supprimée, tout effacer). */
export async function oublier(doc) {
  const versions = await lister(doc)
  await ecrire([], versions.map((v) => v.id))
}

/** Ferme la tranche en cours : la prochaine modification fera une nouvelle version (avant une restauration). */
export async function fermerTranche(doc) {
  const [derniere] = await lister(doc)
  if (derniere?.ouverte) await ecrire([{ ...derniere, ouverte: false }])
}
