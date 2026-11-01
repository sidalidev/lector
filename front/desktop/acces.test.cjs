// Accès du renderer au disque (acces.js) sur de vrais dossiers temporaires :
// dossiers ouverts par l'utilisateur, vault, extensions, liens symboliques,
// remontée par « .. », préfixe trompeur, persistance.
// Lancer : npm run test:chaine

const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { after, test } = require('node:test')

const { Acces } = require('./acces')

const bacs = []
after(() => bacs.forEach((b) => fs.rmSync(b, { recursive: true, force: true })))

function bac() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lector-acces-')))
  bacs.push(base)
  const notes = path.join(base, 'notes')
  const voisin = path.join(base, 'notes-voisin')
  const vault = path.join(base, 'vault')
  for (const d of [notes, voisin, vault, path.join(notes, 'sous')]) fs.mkdirSync(d)
  fs.writeFileSync(path.join(notes, 'a.md'), '# a')
  fs.writeFileSync(path.join(voisin, 'b.md'), '# b')
  const acces = new Acces({ fichier: path.join(base, 'acces.json'), dossiersFixes: () => [vault, null] })
  acces.autoriser(notes)
  return { base, notes, voisin, vault, acces }
}

const MD = ['.md', '.markdown']

test('un fichier du dossier ouvert est permis, avec son extension', () => {
  const { notes, acces } = bac()
  assert.equal(acces.verifier(path.join(notes, 'a.md'), MD), path.join(notes, 'a.md'))
  assert.equal(acces.verifier(path.join(notes, 'sous', 'neuf.MD'), MD), path.join(notes, 'sous', 'neuf.MD'))
  assert.equal(acces.verifier(notes), notes)
  assert.equal(acces.verifier(path.join(notes, 'demarrage.sh'), MD), null)
  assert.equal(acces.verifier(path.join(notes, 'absent', 'c.md'), MD), null)
})

test('rien hors des dossiers ouverts : voisin au même préfixe, « .. », chemin absolu, entrée invalide', () => {
  const { notes, voisin, acces } = bac()
  assert.equal(acces.verifier(path.join(voisin, 'b.md'), MD), null)
  assert.equal(acces.verifier(path.join(notes, '..', 'notes-voisin', 'b.md'), MD), null)
  assert.equal(acces.verifier('/etc/hosts'), null)
  assert.equal(acces.verifier(path.dirname(notes)), null)
  for (const invalide of [null, undefined, '', 42, `${notes}/a\0.md`]) assert.equal(acces.verifier(invalide), null)
})

test('un lien symbolique est jugé sur sa cible', () => {
  const { notes, voisin, acces } = bac()
  fs.symlinkSync(voisin, path.join(notes, 'lien-dehors'))
  fs.symlinkSync(path.join(notes, 'sous'), path.join(notes, 'lien-dedans'))
  assert.equal(acces.verifier(path.join(notes, 'lien-dehors', 'b.md'), MD), null)
  assert.equal(acces.verifier(path.join(notes, 'lien-dehors', 'nouveau.md'), MD), null)
  assert.equal(acces.verifier(path.join(notes, 'lien-dedans', 'c.md'), MD), path.join(notes, 'sous', 'c.md'))
})

test('le vault est toujours permis, sans être enregistré', () => {
  const { base, vault, acces } = bac()
  assert.equal(acces.verifier(path.join(vault, 'x.md'), MD), path.join(vault, 'x.md'))
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(base, 'acces.json'), 'utf-8')).racines, [path.join(base, 'notes')])
})

test('les dossiers ouverts survivent au redémarrage, le plus récent en tête, sans doublon', () => {
  const { base, notes, voisin, acces } = bac()
  acces.autoriser(voisin)
  acces.autoriser(path.join(notes, '.'))
  const relu = new Acces({ fichier: path.join(base, 'acces.json') })
  assert.deepEqual(relu.dossiers, [notes, voisin])
  assert.equal(relu.verifier(path.join(voisin, 'b.md'), MD), path.join(voisin, 'b.md'))
  assert.deepEqual(new Acces({ fichier: path.join(base, 'absent.json') }).dossiers, [])
})
