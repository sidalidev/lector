// Écritures en attente du réseau (navigateur, vault « cloud:// »).
//
// Sans réseau, une note enregistrée est gardée ici, déjà chiffrée (bloc et
// chemin chiffrés, jamais le texte en clair), puis déposée au retour de la
// connexion. Une entrée par document : la dernière version remplace la
// précédente. IndexedDB « lector-attente » ; une Map en mémoire sans IndexedDB.

const BASE = 'lector-attente'
const MAGASIN = 'ecritures'

let promesse = null
const memoire = new Map()

function base() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  if (!promesse) {
    promesse = new Promise((resolve) => {
      try {
        const req = indexedDB.open(BASE, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(MAGASIN)
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

async function operation(mode, fn) {
  const db = await base()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(MAGASIN, mode)
    const req = fn(tx.objectStore(MAGASIN))
    tx.oncomplete = () => resolve(req && 'result' in req ? req.result : undefined)
    tx.onerror = () => reject(tx.error)
  })
}

/** File d'attente d'une chaîne : { lire, garder, oublier, toutes }. */
export function fileDAttente(chainId) {
  const k = (docId) => `${chainId}:${docId}`
  return {
    async lire(docId) {
      if (!(await base())) return memoire.get(k(docId))
      return operation('readonly', (s) => s.get(k(docId)))
    },
    async garder(entree) {
      const e = { ...entree, chainId }
      if (!(await base())) { memoire.set(k(e.docId), e); return }
      await operation('readwrite', (s) => s.put(e, k(e.docId)))
    },
    async oublier(docId) {
      if (!(await base())) { memoire.delete(k(docId)); return }
      await operation('readwrite', (s) => s.delete(k(docId)))
    },
    async toutes() {
      if (!(await base())) return [...memoire.values()].filter((e) => e.chainId === chainId)
      const tout = await operation('readonly', (s) => s.getAll())
      return (tout || []).filter((e) => e.chainId === chainId)
    },
  }
}

/** File en mémoire seulement (tests). */
export function fileEnMemoire() {
  const m = new Map()
  return {
    lire: async (docId) => m.get(docId),
    garder: async (e) => { m.set(e.docId, e) },
    oublier: async (docId) => { m.delete(docId) },
    toutes: async () => [...m.values()],
  }
}

/** Vrai si l'erreur vient du réseau (hors ligne, serveur injoignable), pas d'un refus du serveur. */
export function estErreurReseau(err) {
  if (!err) return false
  if (err.name === 'TypeError' || err.name === 'AbortError') return true
  return typeof err.status === 'number' && (err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504)
    && err.code !== 'STREAM_CAPACITY'
}
