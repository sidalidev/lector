import { test, expect } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createServer, request as requeteHttp } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, extname } from 'node:path'
import { PORT_TEST } from '../back-test.js'

// Service worker de l'app web : il n'existe qu'au build, donc ce test construit
// l'app dans un dossier jetable et la sert comme nginx en production (/, /d/<id>,
// /sw.js), l'API de test derrière /v1. Après une première visite, l'app
// s'ouvre hors ligne ; /v1 et /d/<id> ne sont jamais mis en cache.

test.use({ locale: 'en-US' })
test.describe.configure({ mode: 'serial' })

// Pas d'import.meta : le test reste en CommonJS, comme back-test.js.
const FRONT = join(__dirname, '../../front')
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' }
const ID = '0123456789abcdef0123456789abcdef'

let dist, serveur, base, contexte, page

function fichier(chemin) {
  if (chemin === '/' || new RegExp(`^/d/[0-9a-f]{32}$`).test(chemin)) return 'index.html'
  const m = chemin.match(/^\/d\/(assets\/.+|[^/]+\.(svg|png|webmanifest))$/)
  return m ? m[1] : chemin.slice(1)
}

test.beforeAll(async ({ browser }) => {
  dist = mkdtempSync(join(tmpdir(), 'lector-sw-'))
  execFileSync('npx', ['vite', 'build', '--outDir', dist, '--emptyOutDir', '--logLevel', 'error'], { cwd: FRONT, stdio: 'inherit', timeout: 120_000 })
  serveur = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x')
    if (pathname.startsWith('/v1/')) {
      const amont = requeteHttp({ host: 'localhost', port: PORT_TEST, path: req.url, method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers)
        r.pipe(res)
      })
      amont.on('error', () => { res.writeHead(502); res.end() })
      req.pipe(amont)
      return
    }
    try {
      const p = join(dist, fichier(decodeURIComponent(pathname)))
      if (!(await stat(p)).isFile()) throw new Error()
      const sansCache = /\.(html)$/.test(p) || p.endsWith('sw.js')
      res.writeHead(200, { 'content-type': TYPES[extname(p)] || 'application/octet-stream', ...(sansCache ? { 'cache-control': 'no-cache' } : {}) })
      res.end(await readFile(p))
    } catch {
      res.writeHead(404); res.end()
    }
  })
  await new Promise((r) => serveur.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${serveur.address().port}`
  contexte = await browser.newContext()
  page = await contexte.newPage()
})

test.afterAll(async () => {
  await contexte?.close()
  serveur?.closeAllConnections?.()
  serveur?.close()
  if (dist) rmSync(dist, { recursive: true, force: true })
})

/** Clés de tous les caches de l'origine. */
const clesEnCache = () => page.evaluate(async () => {
  const urls = []
  for (const nom of await caches.keys()) for (const r of await (await caches.open(nom)).keys()) urls.push(r.url)
  return urls
})

test('première visite : clé créée, service worker actif, la coquille en cache sans /v1 ni /d/<id>', async () => {
  await page.goto(base + '/')
  await page.getByTestId('entree-creer').click()
  await page.getByRole('button', { name: 'I wrote them down' }).click()
  await page.getByTestId('entree-continuer').click()
  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
  await page.evaluate(() => navigator.serviceWorker.ready)

  // Page contrôlée par le service worker : les appels /v1 passent par lui.
  await page.reload()
  await expect(page.locator('.file-tree-item', { hasText: 'Welcome to Lector' })).toBeVisible()
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  await page.locator('.file-tree-item', { hasText: 'Welcome to Lector' }).click()
  await expect(page.locator('.cm-lp-h1').first()).toContainText('Welcome to Lector')
  expect(await page.evaluate(async () => (await fetch('/v1/health')).ok)).toBe(true)

  // Une page partagée s'ouvre par la coquille, sans entrer dans le cache.
  const partage = await contexte.newPage()
  await partage.goto(`${base}/d/${ID}`)
  await expect(partage.locator('#root > *').first()).toBeVisible()
  await partage.close()

  const cles = await clesEnCache()
  expect(cles.length).toBeGreaterThan(10)
  expect(cles).toContain(base + '/')
  expect(cles.filter((u) => /\/v1(\/|$)/.test(new URL(u).pathname))).toEqual([])
  expect(cles.filter((u) => /\/d\/[0-9a-f]{32}/.test(u))).toEqual([])
})

test('hors ligne : un rechargement affiche quand même l\'app, et /v1 n\'est jamais servi par le cache', async () => {
  // Hors ligne pour la page, et le serveur arrêté : rien ne vient du réseau.
  await contexte.setOffline(true)
  serveur.closeAllConnections()
  await new Promise((r) => serveur.close(r))

  await page.reload()
  await expect(page.locator('.titlebar, .onboarding').first()).toBeVisible()
  await expect(page.locator('.titlebar')).toBeVisible()
  const api = await page.evaluate(async () => {
    try { return (await fetch('/v1/health')).status } catch { return 'échec réseau' }
  })
  expect(api).toBe('échec réseau')

  // La page partagée s'ouvre aussi (sans son document, qui vient du relais).
  const partage = await contexte.newPage()
  await partage.goto(`${base}/d/${ID}`)
  await expect(partage.locator('#root > *').first()).toBeVisible()
  await partage.close()
})
