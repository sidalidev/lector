// Budget de poids de l'app web : échoue si le premier affichage de /app/
// télécharge plus de JS que prévu, ou si mermaid, d3 ou KaTeX reviennent :
// ils sont retirés de l'app. Mesuré sur front/dist (npm run build d'abord),
// dans Chrome sans fenêtre, comme servi par nginx en prod.
// Lancer : npm run test:poids
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { servir, mesurer } from './mesure.mjs'

// Ko gzip de JS au premier affichage.
const BUDGET_APP = 150
const BUDGET_PARTAGE = 200

// Signatures dans le code construit (chaînes que la minification garde).
const INTERDITS = {
  mermaid: /mermaidAPI/,
  katex: /KaTeX parse error/,
  d3: /Invalid format: /,
}

let serveur, base, navigateur
before(async () => {
  ;({ serveur, base } = await servir())
  navigateur = await chromium.launch({ channel: 'chrome' })
})
after(async () => {
  await navigateur?.close()
  serveur?.close()
})

const ko = (o) => Math.round(o / 102.4) / 10

test(`/app/ : moins de ${BUDGET_APP} Ko de JS au premier affichage, sans mermaid, KaTeX ni d3`, async () => {
  const r = await mesurer(navigateur, `${base}/app/`, '.onboarding-title')
  assert.ok(ko(r.js) < BUDGET_APP, `JS initial ${ko(r.js)} Ko gzip > ${BUDGET_APP} Ko : ${r.fichiers.filter((f) => f.type === '.js').map((f) => `${f.chemin} ${ko(f.gzip)}`).join(', ')}`)
  for (const [nom, signe] of Object.entries(INTERDITS)) {
    const coupable = r.fichiers.find((f) => f.type === '.js' && signe.test(f.texte))
    assert.equal(coupable, undefined, `${nom} téléchargé au démarrage (${coupable?.chemin})`)
  }
})

test("/app/?demo : une note n'apporte ni mermaid, ni KaTeX, ni d3", async () => {
  const r = await mesurer(navigateur, `${base}/app/?demo`, '.cm-lp-h1')
  for (const [nom, signe] of Object.entries(INTERDITS)) {
    const coupable = r.fichiers.find((f) => f.type === '.js' && signe.test(f.texte))
    assert.equal(coupable, undefined, `${nom} téléchargé pour la note d'accueil (${coupable?.chemin})`)
  }
})

test(`/d/ : moins de ${BUDGET_PARTAGE} Ko de JS pour l'éditeur partagé`, async () => {
  const r = await mesurer(navigateur, `${base}/d/0123456789abcdef0123456789abcdef`, '#root > *')
  assert.ok(ko(r.js) < BUDGET_PARTAGE, `JS de /d/ ${ko(r.js)} Ko gzip > ${BUDGET_PARTAGE} Ko`)
})
