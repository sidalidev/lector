// Scénarios de bout en bout de la chaîne (docs/CHAINE-TESTS.md) : vrais clients
// (Electron sans fenêtre, vault web) contre le serveur de test.
//
// Le scénario vit dans e2e/chaine/bout-en-bout.test.cjs et tourne dans un
// processus Node ordinaire, comme le processus principal d'Electron : sous le
// chargeur de Playwright, l'import() natif des modules ES de la chaîne casse
// (crypto.js y est déjà compilé en CommonJS par chain.spec.js). Ce fichier
// se contente de le lancer une fois le serveur de test démarré.

import { test, expect } from '@playwright/test'
import path from 'path'
import { spawnSync } from 'child_process'

test('chaîne de bout en bout : création, deux ordinateurs, navigateur, markdown seulement, quota, renouvellement, tout effacer', async () => {
  test.setTimeout(120_000)
  const r = spawnSync(process.execPath, ['--test', '--test-reporter=spec', path.join(__dirname, '..', 'chaine', 'bout-en-bout.test.cjs')], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0' },
    timeout: 110_000,
  })
  const sortie = `${r.stdout || ''}${r.stderr || ''}`
  console.log(sortie)
  expect(r.status, sortie).toBe(0)
})
