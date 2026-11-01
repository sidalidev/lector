// Tout effacer, navigateur et mobile : effacerDonneesLocales vide le stockage
// local de l'app (clés API de « lector-keys », clés de chaîne, autres bases,
// localStorage, sessionStorage, caches, service workers), sans jamais lever.
// Lancer : npm run test:chaine

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effacerDonneesLocales, BASES_CONNUES } from '../effacementLocal.js'

function stockage(entrees) {
  const m = new Map(Object.entries(entrees))
  return { clear: () => m.clear(), get taille() { return m.size } }
}

function indexedDBSimule(noms, { databases = true, bloque = [] } = {}) {
  const bases = new Set(noms)
  const idb = {
    bases,
    deleteDatabase(nom) {
      const req = {}
      setTimeout(() => {
        if (bloque.includes(nom)) return req.onblocked?.()
        bases.delete(nom)
        req.onsuccess?.()
      }, 0)
      return req
    },
  }
  if (databases) idb.databases = async () => [...bases].map((name) => ({ name, version: 1 }))
  return idb
}

test('vide les bases IndexedDB, localStorage, sessionStorage, caches et service workers', async () => {
  const idb = indexedDBSimule(['lector-keys', 'lector-chaine', 'autre-base'])
  const local = stockage({ 'lector-history': '[]', 'highlights-/a.md': '[]' })
  const session = stockage({ x: '1' })
  const caches = new Map([['v1', {}], ['v2', {}]])
  let desinscrits = 0
  const env = {
    indexedDB: idb,
    localStorage: local,
    sessionStorage: session,
    caches: { keys: async () => [...caches.keys()], delete: async (k) => caches.delete(k) },
    navigator: { serviceWorker: { getRegistrations: async () => [{ unregister: async () => { desinscrits++; return true } }] } },
  }
  const efface = await effacerDonneesLocales(env)
  assert.equal(idb.bases.size, 0)
  assert.equal(local.taille, 0)
  assert.equal(session.taille, 0)
  assert.equal(caches.size, 0)
  assert.equal(desinscrits, 1)
  for (const attendu of ['indexedDB:lector-keys', 'indexedDB:lector-chaine', 'indexedDB:autre-base', 'localStorage', 'sessionStorage', 'cache:v1', 'cache:v2', 'serviceWorker']) {
    assert.ok(efface.includes(attendu), attendu)
  }
})

test('sans indexedDB.databases() (anciens moteurs) : les bases connues sont quand même effacées', async () => {
  const idb = indexedDBSimule(['lector-keys', 'lector-chaine'], { databases: false })
  await effacerDonneesLocales({ indexedDB: idb })
  assert.deepEqual([...idb.bases], [])
  assert.deepEqual(BASES_CONNUES, ['lector-keys', 'lector-chaine'])
})

test('une base encore ouverte ou un stockage interdit ne bloque ni ne fait lever', async () => {
  const idb = indexedDBSimule(['lector-keys'], { bloque: ['lector-keys'] })
  const env = {
    indexedDB: idb,
    get localStorage() { throw new Error('SecurityError') },
    sessionStorage: { clear() { throw new Error('SecurityError') } },
    caches: { keys: async () => { throw new Error('indisponible') } },
  }
  const efface = await effacerDonneesLocales(env)
  assert.ok(efface.includes('indexedDB:lector-keys'), 'suppression différée à la fermeture de la connexion')
  assert.ok(!efface.includes('localStorage'))
  assert.ok(!efface.includes('sessionStorage'))
})
