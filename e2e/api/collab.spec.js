import { test, expect } from '@playwright/test'
import fs from 'fs'
import path from 'path'
import * as Y from 'yjs'
import { PORT_TEST, DONNEES } from '../back-test.js'
import { nouvelleCle, nouveauSecretProprietaire, preparerSalon } from '../../front/src/services/collab/crypto.js'
import { SalonCollab, STATUTS, arreterSalon, urlRelais } from '../../front/src/services/collab/salon.js'

// Relais de co-écriture sur la vraie API (SQLite via Prisma) : rattrapage,
// compactage, arrêt, et rien de lisible dans la base.

const URL_RELAIS = urlRelais(`http://localhost:${PORT_TEST}`)

async function attendre(condition, message, delaiMs = 10_000) {
  const fin = Date.now() + delaiMs
  while (!(await condition())) {
    if (Date.now() > fin) throw new Error(`Délai dépassé : ${message}`)
    await new Promise((r) => setTimeout(r, 20))
  }
}

async function client(K, O = null) {
  const doc = new Y.Doc()
  const c = new SalonCollab({ salon: await preparerSalon(K), doc, url: URL_RELAIS, secretProprietaire: O })
  c.connecter()
  return { doc, c, texte: doc.getText('md') }
}

test('rattrapage après compactage, arrêt définitif, base sans texte en clair', async () => {
  const K = nouvelleCle()
  const O = nouveauSecretProprietaire()
  const sid = await client(K, O)
  await attendre(() => sid.c.statut === STATUTS.EN_LIGNE, 'en ligne')
  for (let i = 0; i < 60; i++) {
    sid.texte.insert(sid.texte.length, `Réplique numéro ${i}.\n`)
    await new Promise((r) => setTimeout(r, 3))
  }
  await attendre(() => sid.c.enAttente.length === 0, 'tout acquitté')

  const lea = await client(K)
  await attendre(() => lea.texte.toString() === sid.texte.toString(), 'rattrapage')
  expect(lea.texte.toString()).toContain('Réplique numéro 59.')

  const base = fs.readFileSync(path.join(DONNEES, 'test.db')).toString('latin1')
  expect(base.includes('Réplique')).toBe(false)
  expect(base.includes('plique num')).toBe(false)

  expect(await arreterSalon({ salon: await preparerSalon(K), secretProprietaire: O, url: URL_RELAIS })).toBe(true)
  await attendre(() => lea.c.statut === STATUTS.ARRETE && sid.c.statut === STATUTS.ARRETE, 'arrêt')
  const retour = await client(K, O)
  await attendre(() => retour.c.statut === STATUTS.ARRETE, 'le salon ne renaît pas')
  for (const x of [sid, lea, retour]) await x.c.fermer()
})

test('le premier message doit être hello ; une trame invalide ferme la connexion', async () => {
  const fermeture = await new Promise((resolve) => {
    const ws = new WebSocket(URL_RELAIS)
    ws.onopen = () => ws.send(JSON.stringify({ t: 'up', d: 'AQ' }))
    ws.onclose = (ev) => resolve(ev.code)
  })
  expect(fermeture).toBe(4400)
})
