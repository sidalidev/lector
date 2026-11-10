// Règles du service worker (public : front/src/sw.js, assemblé au build par
// vite.config.js). Module pur, testé sous Node (swRegles.test.mjs).
//
// Trois réponses possibles pour une requête :
// - 'ignorer'    : le service worker ne s'en mêle pas, rien n'est mis en cache
//                  (API /v1, relais, autres pages du site, autres origines) ;
// - 'navigation' : ouverture de l'app (/ ou /d/<id>) : réseau d'abord, la
//                  coquille en cache seulement hors ligne. `rafraichir` : la
//                  réponse remplace la coquille (jamais pour /d/<id>) ;
// - 'fichier'    : fichier de la coquille (nommé par son contenu, ou icône,
//                  manifeste) : cache d'abord, sous la clé `cle`.

const FICHIERS_RACINE = new Set(['favicon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'apple-touch-icon.png', 'manifest.webmanifest'])

export function regle({ methode, url, scope, mode }) {
  const ignorer = { action: 'ignorer' }
  if (methode !== 'GET') return ignorer
  const u = new URL(url)
  const s = new URL(scope)
  if (u.origin !== s.origin || !u.pathname.startsWith(s.pathname)) return ignorer
  // API et relais : jamais en cache, quel que soit le chemin de l'app.
  if (/^\/v1(\/|$)/.test(u.pathname)) return ignorer
  const rel = u.pathname.slice(s.pathname.length)
  if (/^v1(\/|$)/.test(rel)) return ignorer

  if (mode === 'navigate') {
    if (rel === '' || rel === 'index.html') return { action: 'navigation', rafraichir: true }
    if (/^d\/[0-9a-f]{32}\/?$/.test(rel)) return { action: 'navigation', rafraichir: false }
    return ignorer
  }

  // Page partagée : ses fichiers relatifs (/d/assets/…) sont ceux de l'app.
  const partage = rel.match(/^d\/(assets\/[^/]+|[^/]+\.(?:svg|png|webmanifest))$/)
  const chemin = partage ? partage[1] : rel
  if (/^assets\/[^/]+$/.test(chemin) || FICHIERS_RACINE.has(chemin)) {
    return { action: 'fichier', cle: s.href + chemin, enregistrer: chemin.startsWith('assets/') }
  }
  return ignorer
}

// Ce que le service worker garde à l'installation : la coquille (index.html,
// sous la clé du scope), le JS et le CSS, les polices latines et les icônes.
// Le reste des polices (latin étendu, arabe) vient du réseau, puis du cache.
export function aPrecacher(fichiers) {
  const garder = (f) => /^assets\/[^/]+\.(js|css)$/.test(f)
    || (/\.woff2$/.test(f) && f.includes('-latin-') && !f.includes('-latin-ext-'))
    || FICHIERS_RACINE.has(f)
  return ['', ...fichiers.filter(garder)]
}
