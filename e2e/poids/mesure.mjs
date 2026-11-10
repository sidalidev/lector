// Poids réel du premier affichage de l'app web, mesuré sur front/dist.
// Sert front/dist comme nginx en prod (/app/ et /d/<id>), ouvre la page dans
// Chrome sans fenêtre et additionne le gzip de chaque fichier téléchargé.
// Usage : node e2e/poids/mesure.mjs (après npm run build)
//         LENT=1 node e2e/poids/mesure.mjs   avec un réseau mobile simulé (4G lente)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const DIST = join(dirname(fileURLToPath(import.meta.url)), '../../front/dist')
const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
}

// Même découpage que deploy/nginx.conf.
function fichier(url) {
  const chemin = decodeURIComponent(new URL(url, 'http://x').pathname)
  if (chemin.startsWith('/app/')) return chemin.slice(5) || 'index.html'
  let m = chemin.match(/^\/d\/(assets\/.+|[^/]+\.(svg|png|webmanifest))$/)
  if (m) return m[1]
  if (/^\/d\/[0-9a-f]{32}$/.test(chemin)) return 'index.html'
  if (chemin === '/' || chemin.startsWith('/assets/')) return chemin.slice(1) || 'index.html'
  return chemin.slice(1)
}

export async function servir() {
  const serveur = createServer(async (req, res) => {
    const nom = fichier(req.url)
    try {
      const p = join(DIST, nom)
      if (!(await stat(p)).isFile()) throw new Error()
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream' })
      res.end(await readFile(p))
    } catch {
      // Comme try_files : l'app répond aux chemins inconnus de /app/.
      if (req.url.startsWith('/app/')) {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end(await readFile(join(DIST, 'index.html')))
      } else { res.writeHead(404); res.end() }
    }
  })
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  return { serveur, base: `http://127.0.0.1:${serveur.address().port}` }
}

// Ouvre une page et rend la liste des fichiers téléchargés avec leur poids gzip.
export async function mesurer(navigateur, url, attendre) {
  const page = await navigateur.newPage()
  if (process.env.LENT) {
    // 4G lente : 1,6 Mbit/s descendant, 150 ms de latence (profil « Fast 3G » de Chrome).
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 })
  }
  const fichiers = []
  page.on('response', async (r) => {
    try {
      const corps = await r.body()
      const u = new URL(r.url())
      const type = extname(u.pathname) || '.html'
      fichiers.push({
        chemin: u.pathname, type, brut: corps.length, gzip: gzipSync(corps, { level: 9 }).length,
        texte: type === '.js' ? corps.toString('utf8') : '',
      })
    } catch { /* redirection ou corps absent */ }
  })
  const debut = Date.now()
  await page.goto(url)
  if (attendre) await page.waitForSelector(attendre, { timeout: 15000 })
  const affichage = Date.now() - debut
  await page.waitForLoadState('networkidle')
  // Les réponses arrivent par événements : on laisse finir leur lecture.
  await page.waitForTimeout(200)
  await page.close()
  const somme = (f) => fichiers.filter(f).reduce((s, x) => s + x.gzip, 0)
  return {
    fichiers,
    affichage,
    js: somme((x) => x.type === '.js'),
    css: somme((x) => x.type === '.css'),
    polices: somme((x) => /\.(woff2?|ttf)$/.test(x.type)),
    total: somme(() => true),
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { serveur, base } = await servir()
  const navigateur = await chromium.launch({ channel: 'chrome' })
  for (const [nom, chemin, sel] of [
    ['/app/', '/app/', '.onboarding-title, .onboarding h1, .titlebar'],
    ['/d/', '/d/0123456789abcdef0123456789abcdef', '#root > *'],
  ]) {
    const r = await mesurer(navigateur, base + chemin, sel)
    console.log(`\n${nom}  JS ${(r.js / 1024).toFixed(1)} Ko gzip · CSS ${(r.css / 1024).toFixed(1)} Ko · polices ${(r.polices / 1024).toFixed(1)} Ko · total ${(r.total / 1024).toFixed(1)} Ko · affichage ${r.affichage} ms`)
    for (const f of r.fichiers.sort((a, b) => b.gzip - a.gzip)) console.log(`  ${(f.gzip / 1024).toFixed(1).padStart(7)} Ko  ${f.chemin}`)
  }
  await navigateur.close()
  serveur.close()
}
