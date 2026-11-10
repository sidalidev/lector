// Service worker de l'app web : elle s'ouvre tout de suite, et hors ligne.
// Assemblé au build par vite.config.js (plugin lector-sw) : les règles de
// utils/swRegles.js sont collées avant ce fichier, FICHIERS et VERSION sont
// remplis avec la liste du build. Jamais enregistré en développement, ni dans
// Electron ni dans Capacitor (main.jsx).
//
// - Ouverture de l'app (/ ou /d/<id>) : réseau d'abord, donc un nouveau
//   déploiement est pris au premier rechargement ; la coquille en cache ne
//   sert que si le réseau ne répond pas.
// - Fichiers nommés par leur contenu (assets/) : cache d'abord, ils ne
//   changent jamais sous le même nom.
// - /v1 (API, relais) et tout le reste : le service worker ne s'en mêle pas.

/* global FICHIERS, VERSION, regle, aPrecacher */
const CACHE = `lector-${VERSION}`

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // cache: 'reload' : jamais une copie périmée du cache HTTP.
    await cache.addAll(aPrecacher(FICHIERS).map((f) => new Request(new URL(f, self.registration.scope), { cache: 'reload' })))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const nom of await caches.keys()) {
      if (nom.startsWith('lector-') && nom !== CACHE) await caches.delete(nom)
    }
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const scope = self.registration.scope
  const r = regle({ methode: req.method, url: req.url, scope, mode: req.mode })
  if (r.action === 'ignorer') return

  if (r.action === 'navigation') {
    e.respondWith((async () => {
      try {
        const rep = await fetch(req)
        if (r.rafraichir && rep.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(scope, rep.clone())
        }
        return rep
      } catch {
        return (await caches.match(scope, { cacheName: CACHE })) || Response.error()
      }
    })())
    return
  }

  e.respondWith((async () => {
    const enCache = await caches.match(r.cle, { cacheName: CACHE })
    if (enCache) return enCache
    const rep = await fetch(req)
    if (r.enregistrer && rep.ok) {
      const cache = await caches.open(CACHE)
      await cache.put(r.cle, rep.clone())
    }
    return rep
  })())
})
