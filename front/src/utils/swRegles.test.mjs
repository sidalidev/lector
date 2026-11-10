// Règles du service worker : l'API n'est jamais mise en cache, /d/<id> non
// plus, la coquille s'ouvre hors ligne. Lancer : npm run test:chaine
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { regle, aPrecacher } from './swRegles.js'

const SCOPE = 'https://lector.sidali.dev/'
const r = (url, mode = 'cors', methode = 'GET', scope = SCOPE) => regle({ methode, url, scope, mode })

test('/v1 (API, relais, flux) : toujours ignoré, quelle que soit la méthode ou le scope', () => {
  for (const url of ['https://lector.sidali.dev/v1/chain/abc/manifest', 'https://lector.sidali.dev/v1/health', 'https://lector.sidali.dev/v1', 'https://lector.sidali.dev/v1/collab/0123?x=1']) {
    for (const mode of ['cors', 'navigate', 'same-origin']) {
      for (const methode of ['GET', 'PUT', 'POST', 'DELETE']) assert.equal(r(url, mode, methode).action, 'ignorer', `${methode} ${url} ${mode}`)
    }
  }
  assert.equal(regle({ methode: 'GET', url: 'http://127.0.0.1:9/app/v1/health', scope: 'http://127.0.0.1:9/app/', mode: 'cors' }).action, 'ignorer')
})

test('/d/<id> : ouvert par la coquille, jamais enregistré', () => {
  assert.deepEqual(r('https://lector.sidali.dev/d/0123456789abcdef0123456789abcdef', 'navigate'), { action: 'navigation', rafraichir: false })
  assert.deepEqual(r('https://lector.sidali.dev/', 'navigate'), { action: 'navigation', rafraichir: true })
  // Ses fichiers relatifs sont ceux de l'app, sous la même clé.
  assert.equal(r('https://lector.sidali.dev/d/assets/App-abc.js').cle, 'https://lector.sidali.dev/assets/App-abc.js')
  assert.equal(r('https://lector.sidali.dev/d/manifest.webmanifest').cle, 'https://lector.sidali.dev/manifest.webmanifest')
})

test('fichiers de la coquille : cache d\'abord, clé sans paramètre', () => {
  assert.deepEqual(r('https://lector.sidali.dev/assets/index-abc.js?v=1'), { action: 'fichier', cle: 'https://lector.sidali.dev/assets/index-abc.js', enregistrer: true })
  assert.deepEqual(r('https://lector.sidali.dev/favicon.svg'), { action: 'fichier', cle: 'https://lector.sidali.dev/favicon.svg', enregistrer: false })
})

test('le reste du site et les autres origines : ignorés', () => {
  for (const url of ['https://lector.sidali.dev/privacy', 'https://lector.sidali.dev/sync/', 'https://lector.sidali.dev/download/Lector.dmg', 'https://lector.sidali.dev/releases/latest-mac.yml', 'https://lector.sidali.dev/api/latest-ios.json', 'https://lector.sidali.dev/fonts/figtree.woff2', 'https://www.youtube.com/embed/x', 'https://lector.sidali.dev/sw.js']) {
    assert.equal(r(url).action, 'ignorer', url)
    assert.equal(r(url, 'navigate').action, 'ignorer', url)
  }
})

test('précache : coquille, JS, CSS, polices latines et icônes ; ni latin étendu ni arabe', () => {
  const liste = aPrecacher(['index.html', 'assets/App-a.js', 'assets/App-a.css', 'assets/Figtree-latin-x.woff2', 'assets/Figtree-latin-ext-y.woff2', 'assets/jetbrains-mono-latin-wght-normal-z.woff2', 'assets/noto-naskh-arabic-arabic-wght-normal-w.woff2', 'favicon.svg', 'sw.js'])
  assert.deepEqual(liste, ['', 'assets/App-a.js', 'assets/App-a.css', 'assets/Figtree-latin-x.woff2', 'assets/jetbrains-mono-latin-wght-normal-z.woff2', 'favicon.svg'])
})
