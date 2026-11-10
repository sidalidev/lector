import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffLignes } from './diffLignes.js'
import { aEclaircir } from '../services/historique.js'

test('diffLignes : ajout, retrait et lignes communes', () => {
  const d = diffLignes('a\nb\nc', 'a\nx\nc\nd')
  assert.deepEqual(d, [
    { type: 'egal', texte: 'a' },
    { type: 'retrait', texte: 'b' },
    { type: 'ajout', texte: 'x' },
    { type: 'egal', texte: 'c' },
    { type: 'ajout', texte: 'd' },
  ])
  assert.deepEqual(diffLignes('same', 'same'), [{ type: 'egal', texte: 'same' }])
})

test('historique : tout pendant 24 h, une par heure ensuite', () => {
  const H = 3600 * 1000
  const maintenant = 100 * 24 * H
  const versions = [
    { id: 1, date: maintenant - 1000 },
    { id: 2, date: maintenant - 2000 },
    { id: 3, date: maintenant - 30 * H - 10 },
    { id: 4, date: maintenant - 30 * H - 20 },
    { id: 5, date: maintenant - 40 * 24 * H },
  ]
  assert.deepEqual(aEclaircir(versions, maintenant), [4])
})
