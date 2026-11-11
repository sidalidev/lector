// Icône du dossier synchronisé (macOS) : posée par le système dans « Icon\r »,
// sans toucher aux notes ; une icône posée par quelqu'un d'autre est gardée.
// Dossiers temporaires seulement. Lancer : npm run test:chaine

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')
const { poserIcone, aUneIconePerso } = require('./icone-dossier')

const mac = process.platform === 'darwin'

test('icône Lector posée sur un dossier sans icône, notes intactes', { skip: !mac && 'macOS seulement' }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-icone-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.writeFileSync(path.join(d, 'note.md'), '# Note\n')
  const avant = fs.statSync(path.join(d, 'note.md')).mtimeMs
  assert.equal(await poserIcone(d), 'posee')
  assert.equal(aUneIconePerso(d), true)
  assert.equal(fs.readFileSync(path.join(d, 'note.md'), 'utf8'), '# Note\n')
  assert.equal(fs.statSync(path.join(d, 'note.md')).mtimeMs, avant)
  // Déjà posée par le Mac : rien à refaire.
  assert.equal(await poserIcone(d, { dejaPosee: true }), 'deja')
})

test('icône personnalisée posée par quelqu\'un d\'autre : gardée', { skip: !mac && 'macOS seulement' }, async (t) => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lector-icone-'))
  t.after(() => fs.rmSync(d, { recursive: true, force: true }))
  fs.writeFileSync(path.join(d, 'Icon\r'), '')
  assert.equal(await poserIcone(d), 'autre')
  assert.equal(fs.readFileSync(path.join(d, 'Icon\r'), 'utf8'), '')
})

test('dossier absent : rien n\'est fait', async () => {
  assert.equal(await poserIcone(path.join(os.tmpdir(), 'lector-icone-absent-' + Date.now())), 'indisponible')
})
