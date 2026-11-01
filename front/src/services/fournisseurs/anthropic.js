// Appels directs à l'API Anthropic avec la clé personnelle de l'utilisateur.
//
// Module ES pur, fetch et clé injectés : il sert au navigateur et à la vue web
// mobile (claude.js) comme au processus principal d'Electron (main.js, qui
// garde la clé et appelle par net.fetch). La clé n'est jamais journalisée.

import { ErreurFournisseur, codeHttp } from './erreur.js'

export const API_ANTHROPIC = 'https://api.anthropic.com'
const VERSION_API = '2026-10-21'
const MAX_TOKENS = 16000

export const MODELE_PAR_DEFAUT = 'claude-opus-5-5'

/** Liste figée, quand /v1/models n'est pas joignable. */
export const MODELES_DE_REPLI = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', short: 'Opus' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', short: 'Sonnet' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', short: 'Haiku' },
]

function entetes(cle, navigateur) {
  const h = { 'x-api-key': cle, 'anthropic-version': VERSION_API, 'content-type': 'application/json' }
  // Exigé par l'API pour un appel depuis une page web (CORS) ; inutile depuis Electron.
  if (navigateur) h['anthropic-dangerous-direct-browser-access'] = 'true'
  return h
}

// Les modèles qui acceptent output_config.effort, et ceux qui proposent un
// modèle de repli côté serveur quand leurs filtres refusent une demande.
const accepteEffort = (modele) => /^claude-(opus|sonnet|haiku|fable|mythos)-(5|4-[6-9])/.test(modele)
const avecRepli = (modele) => /^claude-(opus-5|fable-5|sonnet-5-5)/.test(modele)

/**
 * POST /v1/messages. Renvoie le texte de la réponse. Lève ErreurFournisseur :
 * NO_API_KEY, API_KEY_INVALID, BILLING, MODEL_UNKNOWN, RATE_LIMITED,
 * UNAVAILABLE, API_ERROR, REFUSED, NETWORK.
 *
 * @param {object} o
 * @param {Function} o.fetch
 * @param {string} o.cle
 * @param {string} [o.modele]
 * @param {'low'|'medium'|'high'} [o.effort]
 * @param {string} [o.system]
 * @param {{role: 'user'|'assistant', content: string}[]} o.messages
 * @param {boolean} [o.navigateur]  vrai pour un appel depuis une page web
 */
export async function demanderMessages({ fetch, cle, modele, effort, system, messages, navigateur = true }) {
  if (!cle) throw new ErreurFournisseur('NO_API_KEY', 'No Anthropic API key')
  const corps = { model: modele || MODELE_PAR_DEFAUT, max_tokens: MAX_TOKENS, messages }
  if (system) corps.system = system
  if (effort && accepteEffort(corps.model)) corps.output_config = { effort }
  let repli = avecRepli(corps.model)
  for (;;) {
    const h = entetes(cle, navigateur)
    if (repli) h['anthropic-beta'] = 'server-side-fallback-2026-07-01'
    let res
    try {
      res = await fetch(`${API_ANTHROPIC}/v1/messages`, {
        method: 'POST',
        headers: h,
        body: JSON.stringify(repli ? { ...corps, fallbacks: 'default' } : corps),
      })
    } catch (err) {
      throw new ErreurFournisseur('NETWORK', err?.message)
    }
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      const message = data?.error?.message || `HTTP ${res.status}`
      // Repli côté serveur indisponible pour ce compte : même demande sans lui.
      if (repli && res.status === 400 && /fallback|anthropic-beta/i.test(message)) {
        repli = false
        continue
      }
      throw new ErreurFournisseur(codeHttp(res.status), message, res.status)
    }
    if (data?.stop_reason === 'refusal') throw new ErreurFournisseur('REFUSED', 'The model declined this request')
    return (data?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('')
  }
}

/** GET /v1/models : [{ id, label, short }] des modèles Claude de ce compte. */
export async function listerModeles({ fetch, cle, navigateur = true }) {
  if (!cle) throw new ErreurFournisseur('NO_API_KEY', 'No Anthropic API key')
  let res
  try {
    res = await fetch(`${API_ANTHROPIC}/v1/models?limit=100`, { headers: entetes(cle, navigateur) })
  } catch (err) {
    throw new ErreurFournisseur('NETWORK', err?.message)
  }
  if (!res.ok) throw new ErreurFournisseur(codeHttp(res.status), `HTTP ${res.status}`, res.status)
  const data = await res.json()
  return (data?.data || [])
    .filter((m) => typeof m.id === 'string' && m.id.startsWith('claude-'))
    .map((m) => ({ id: m.id, label: m.display_name || m.id, short: (m.display_name || m.id).replace(/^Claude\s+/, '') }))
}
