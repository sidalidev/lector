// Tests des appels directs à Anthropic et ElevenLabs (front/src/services/fournisseurs/),
// chargés comme le fait le processus principal, contre un fetch simulé : en-têtes,
// corps, repli de refus, codes d'erreur. Aucun appel réseau. Lancer : npm run test:chaine

const assert = require('node:assert/strict')
const { test } = require('node:test')
const { chargerFournisseurs } = require('./chaine-modules')

/** fetch simulé : enregistre les requêtes et répond avec `reponses` dans l'ordre. */
function fetchSimule(...reponses) {
  const requetes = []
  const fetch = async (url, init = {}) => {
    requetes.push({ url, init, corps: init.body ? JSON.parse(init.body) : null })
    const r = reponses[Math.min(requetes.length - 1, reponses.length - 1)]
    if (r instanceof Error) throw r
    return new Response(typeof r.corps === 'string' ? r.corps : JSON.stringify(r.corps), { status: r.status || 200 })
  }
  return { fetch, requetes }
}

const reponseTexte = (texte, extra = {}) => ({ corps: { content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: texte }], stop_reason: 'end_turn', ...extra } })

test('Anthropic : en-têtes, corps, texte de la réponse', async () => {
  const { anthropic } = await chargerFournisseurs()
  const s = fetchSimule(reponseTexte('Bonjour'))
  const texte = await anthropic.demanderMessages({
    fetch: s.fetch, cle: 'cle-test', modele: 'claude-haiku-5-5', effort: 'low', system: 'Contexte', messages: [{ role: 'user', content: 'Salut' }],
  })
  assert.equal(texte, 'Bonjour')
  const { url, init, corps } = s.requetes[0]
  assert.equal(url, 'https://api.anthropic.com/v1/messages')
  assert.equal(init.headers['x-api-key'], 'cle-test')
  assert.ok(init.headers['anthropic-version'])
  assert.equal(init.headers['anthropic-dangerous-direct-browser-access'], 'true', 'appel depuis une page web')
  assert.deepEqual(
    { model: corps.model, system: corps.system, effort: corps.output_config?.effort, fallbacks: corps.fallbacks },
    { model: 'claude-haiku-5-5', system: 'Contexte', effort: 'low', fallbacks: undefined },
  )
  assert.ok(corps.max_tokens > 0)

  // Depuis Electron : pas d'en-tête de navigateur. Modèle sans effort : paramètre omis.
  const e = fetchSimule(reponseTexte('ok'))
  await anthropic.demanderMessages({ fetch: e.fetch, cle: 'k', modele: 'claude-haiku-4-5', effort: 'high', messages: [{ role: 'user', content: 'a' }], navigateur: false })
  assert.equal(e.requetes[0].init.headers['anthropic-dangerous-direct-browser-access'], undefined)
  assert.equal(e.requetes[0].corps.output_config, undefined)
})

test('Anthropic : repli de refus par défaut, retiré si le compte ne l\'accepte pas ; refus signalé', async () => {
  const { anthropic } = await chargerFournisseurs()
  const s = fetchSimule({ status: 400, corps: { type: 'error', error: { type: 'invalid_request_error', message: 'Unexpected value(s) for the `anthropic-beta` header.' } } }, reponseTexte('sans repli'))
  assert.equal(await anthropic.demanderMessages({ fetch: s.fetch, cle: 'k', messages: [{ role: 'user', content: 'a' }] }), 'sans repli')
  assert.equal(s.requetes[0].corps.model, anthropic.MODELE_PAR_DEFAUT)
  assert.equal(s.requetes[0].corps.fallbacks, 'default')
  assert.ok(s.requetes[0].init.headers['anthropic-beta'])
  assert.equal(s.requetes[1].corps.fallbacks, undefined)
  assert.equal(s.requetes[1].init.headers['anthropic-beta'], undefined)

  const r = fetchSimule(reponseTexte('', { stop_reason: 'refusal' }))
  await assert.rejects(anthropic.demanderMessages({ fetch: r.fetch, cle: 'k', messages: [] }), (e) => e.code === 'REFUSED')
})

test('Anthropic : codes d\'erreur lisibles, jamais d\'appel sans clé', async () => {
  const { anthropic } = await chargerFournisseurs()
  const appel = (reponse) => anthropic.demanderMessages({ fetch: fetchSimule(reponse).fetch, cle: 'k', modele: 'claude-haiku-5-5', messages: [] })
  await assert.rejects(appel({ status: 401, corps: {} }), (e) => e.code === 'API_KEY_INVALID')
  await assert.rejects(appel({ status: 429, corps: {} }), (e) => e.code === 'RATE_LIMITED')
  await assert.rejects(appel({ status: 529, corps: {} }), (e) => e.code === 'UNAVAILABLE')
  await assert.rejects(appel(new TypeError('fetch failed')), (e) => e.code === 'NETWORK')
  const s = fetchSimule(reponseTexte('x'))
  await assert.rejects(anthropic.demanderMessages({ fetch: s.fetch, cle: null, messages: [] }), (e) => e.code === 'NO_API_KEY')
  assert.equal(s.requetes.length, 0)
})

test('Anthropic : liste des modèles du compte', async () => {
  const { anthropic } = await chargerFournisseurs()
  const s = fetchSimule({ corps: { data: [{ id: 'claude-opus-5-5', display_name: 'Claude Opus 5.5' }, { id: 'autre-modele' }] } })
  assert.deepEqual(await anthropic.listerModeles({ fetch: s.fetch, cle: 'k' }), [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5', short: 'Opus 5.5' }])
  assert.match(s.requetes[0].url, /^https:\/\/api\.anthropic\.com\/v1\/models/)
  assert.ok(anthropic.MODELES_DE_REPLI.some((m) => m.id === anthropic.MODELE_PAR_DEFAUT))
})

test('ElevenLabs : voix, synthèse, vérification de la clé', async () => {
  const { elevenlabs } = await chargerFournisseurs()
  const v = fetchSimule({ corps: { voices: [{ voice_id: 'v1', name: 'Rachel', category: 'premade', labels: {}, settings: { secret: 1 } }] } })
  assert.deepEqual(await elevenlabs.listerVoix({ fetch: v.fetch, cle: 'xi' }), [{ voice_id: 'v1', name: 'Rachel', category: 'premade', labels: {} }])
  assert.equal(v.requetes[0].init.headers['xi-api-key'], 'xi')

  const s = fetchSimule({ corps: 'ID3' })
  const audio = await elevenlabs.synthetiser({ fetch: s.fetch, cle: 'xi', texte: 'Bonjour', voix: 'v1' })
  assert.ok(audio instanceof Uint8Array)
  assert.equal(Buffer.from(audio).toString(), 'ID3')
  assert.equal(s.requetes[0].url, 'https://api.elevenlabs.io/v1/text-to-speech/v1')
  assert.deepEqual(s.requetes[0].corps, { text: 'Bonjour', model_id: 'eleven_multilingual_v2' })

  await assert.rejects(elevenlabs.synthetiser({ fetch: s.fetch, cle: 'xi', texte: 'x'.repeat(5001), voix: 'v1' }), (e) => e.code === 'TEXT_TOO_LONG')
  await assert.rejects(elevenlabs.verifierCle({ fetch: fetchSimule({ status: 401, corps: {} }).fetch, cle: 'xi' }), (e) => e.code === 'API_KEY_INVALID')
  await assert.rejects(elevenlabs.listerVoix({ fetch: v.fetch, cle: '' }), (e) => e.code === 'NO_API_KEY')
})
