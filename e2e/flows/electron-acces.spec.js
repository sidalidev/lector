import { test, expect, _electron } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Ordinateur : le pont IPC ne lit et n'écrit que dans les dossiers que
// l'utilisateur a ouverts lui-même (ou le vault), et seulement le type de
// fichier attendu. Le vrai processus principal tourne sur un dossier de
// données jetable, avec un dossier déjà ouvert dans une session précédente.

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64')

let app
let page
let base
let racine
let dehors

test.beforeAll(async () => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lector-acces-')))
  const donnees = path.join(base, 'donnees')
  racine = path.join(base, 'notes')
  dehors = path.join(base, 'ailleurs')
  for (const d of [donnees, racine, dehors]) fs.mkdirSync(d)
  fs.writeFileSync(path.join(racine, 'image.png'), PNG)
  fs.writeFileSync(path.join(racine, 'secret.txt'), 'texte')
  fs.writeFileSync(path.join(racine, 'page.html'), '<p>ok</p>')
  fs.writeFileSync(path.join(dehors, 'prive.md'), '# prive')
  fs.writeFileSync(path.join(dehors, 'image.png'), PNG)
  fs.writeFileSync(path.join(dehors, 'page.html'), '<p>prive</p>')
  fs.symlinkSync(dehors, path.join(racine, 'lien'))
  fs.writeFileSync(path.join(donnees, 'acces.json'), JSON.stringify({ racines: [racine] }))

  app = await _electron.launch({
    args: [path.join(__dirname, 'electron-harnais.cjs')],
    env: { ...process.env, LECTOR_TEST_USER_DATA: donnees },
  })
  page = await app.firstWindow()
  await page.waitForFunction(() => !!window.electron, null, { timeout: 20000 })
})

test.afterAll(async () => {
  await app?.close()
  fs.rmSync(base, { recursive: true, force: true })
})

test('la fenêtre est isolée : bac à sable, contexte isolé, pas de Node', async () => {
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return { sandbox: p.sandbox, contextIsolation: p.contextIsolation, nodeIntegration: p.nodeIntegration }
  })
  expect(prefs).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false })
  expect(await page.evaluate(() => [typeof window.process, typeof window.require, typeof window.electron.fetchUrl])).toEqual(['undefined', 'undefined', 'undefined'])
  expect(await page.evaluate(() => window.electron.getHomePath())).toBe(os.homedir())
})

test('lecture et écriture refusées hors des dossiers ouverts', async () => {
  const r = await page.evaluate(async ({ racine, dehors }) => {
    const e = window.electron
    return {
      hosts: await e.readFileSilent('/etc/hosts'),
      mdDehors: await e.readFileSilent(dehors + '/prive.md'),
      ecritDehors: await e.saveFile(dehors + '/pirate.md', 'x'),
      ecritParLien: await e.saveFile(racine + '/lien/pirate2.md', 'x'),
      ecritScript: await e.saveFile(racine + '/demarrage.sh', 'x'),
      imageDehors: await e.readLocalFile('../ailleurs/image.png', racine),
      texte: await e.readLocalFile('secret.txt', racine),
      htmlDehors: await e.resolveLocalHtml('lien/page.html', racine),
      racineDehors: await e.setRootDir(dehors),
      listeDehors: await e.listDirectoryFiles(dehors),
      syncDehors: await e.writeSyncFile(dehors + '/x.json', '{}'),
    }
  }, { racine, dehors })
  expect(r).toEqual({
    hosts: null,
    mdDehors: null,
    ecritDehors: false,
    ecritParLien: false,
    ecritScript: false,
    imageDehors: null,
    texte: null,
    htmlDehors: null,
    racineDehors: false,
    listeDehors: [],
    syncDehors: false,
  })
  expect(fs.readdirSync(dehors).sort()).toEqual(['image.png', 'page.html', 'prive.md'])
  expect(fs.existsSync(path.join(racine, 'demarrage.sh'))).toBe(false)

  const statut = (chemin) => app.evaluate(async ({ net }, url) => (await net.fetch(url)).status,
    `lector-local://serve/${encodeURIComponent(chemin)}`)
  expect(await statut('/etc/hosts')).toBe(404)
  expect(await statut(path.join(dehors, 'page.html'))).toBe(404)
  expect(await statut(path.join(racine, 'page.html'))).toBe(200)
})

test('un dossier ouvert reste utilisable : markdown et images', async () => {
  const r = await page.evaluate(async ({ racine }) => {
    const e = window.electron
    const ecrit = await e.saveFile(racine + '/note.md', '# ok')
    return {
      ecrit,
      lu: await e.readFileSilent(racine + '/note.md'),
      image: (await e.readLocalFile('image.png', racine))?.slice(0, 22),
      html: (await e.resolveLocalHtml('page.html', racine))?.startsWith('lector-local://serve/'),
      racine: await e.setRootDir(racine),
      liste: (await e.listDirectoryFiles(racine)).map((f) => f.name),
    }
  }, { racine })
  expect(r).toEqual({ ecrit: true, lu: '# ok', image: 'data:image/png;base64,', html: true, racine: true, liste: ['note.md'] })
})
