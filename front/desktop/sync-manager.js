// Synchro du vault sur Electron, dans le processus principal.
//
// Chiffrement avant envoi, déchiffrement après réception, docId = HMAC du chemin
// (front/src/services/chaine/synchro.js). Le secret S (hex) ne sort jamais du
// processus principal. Le vault local reste en clair sur le disque, et seuls
// les fichiers markdown voyagent : les autres ne sont ni lus ni touchés.
//
// Une synchro part au démarrage, à chaque changement d'un fichier markdown,
// toutes les 30 s et dès qu'un autre appareil annonce un changement dans le flux.
// Un cycle à relancer (écriture concurrente) repart après un délai qui double
// à chaque fois, de 1 s à 30 s. stop() interrompt le cycle en cours avant sa
// prochaine écriture : après stop(), plus rien n'est écrit ni relancé.

const fs = require('fs')
const path = require('path')
const { EventEmitter } = require('events')

const { Vault } = require('./vault/vault')
const { watch } = require('./vault/watcher')
const { maintainFormatsReadme } = require('./vault/formats-readme')
const { chargerChaine } = require('./chaine-modules')

const POLL_MS = 30_000
const RELANCE_MIN_MS = 1000
const ARRET_MAX_MS = 5000

// --- Base locale de la chaîne : <vault>/.lector-sync/chaine.json ---

function cheminBaseChaine(vaultPath) {
  return path.join(path.resolve(vaultPath), '.lector-sync', 'chaine.json')
}

function chargerBaseChaine(vaultPath) {
  try { return JSON.parse(fs.readFileSync(cheminBaseChaine(vaultPath), 'utf8')) } catch { return null }
}

function sauverBaseChaine(vaultPath, base) {
  const fichier = cheminBaseChaine(vaultPath)
  fs.mkdirSync(path.dirname(fichier), { recursive: true })
  const tmp = fichier + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(base, null, 2))
  fs.renameSync(tmp, fichier)
}

function effacerBaseChaine(vaultPath) {
  try { fs.unlinkSync(cheminBaseChaine(vaultPath)) } catch {}
}

// Réponses du serveur qui arrêtent la boucle : l'utilisateur doit agir
// (rejoindre la nouvelle chaîne, ou en créer une depuis un appareil qui a ses documents).
const BLOCAGES = {
  CHAIN_UNKNOWN: 'chain-unknown', // casier renouvelé ou effacé ailleurs
  CHAIN_PROOF_INVALID: 'chain-proof', // le secret de cet appareil ne correspond plus
}

const RE_RESEAU = /fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|socket|ERR_INTERNET|ERR_NAME/i

/** Code lisible par l'interface : code du serveur, HTTP_<statut>, NETWORK ou UNKNOWN. */
function codeErreur(err) {
  if (!err) return null
  if (typeof err.code === 'string' && /^[A-Z][A-Z0-9_]+$/.test(err.code)) return err.code
  if (err.status) return `HTTP_${err.status}`
  if (RE_RESEAU.test(`${err.message || ''} ${err.cause?.code || ''} ${err.cause?.message || ''}`)) return 'NETWORK'
  return 'UNKNOWN'
}

class SyncManager extends EventEmitter {
  /**
   * @param {object} o
   * @param {string} o.vaultPath
   * @param {string} o.serverUrl
   * @param {string} o.chainSecret  S en hex
   * @param {string|null} [o.deviceId]  UUID de cette installation (filtre des échos du flux)
   * @param {Function} o.fetchImpl
   * @param {boolean} [o.flux]  écouter le flux temps réel du casier
   */
  constructor({ vaultPath, serverUrl, chainSecret, deviceId = null, fetchImpl, flux = true }) {
    super()
    if (!chainSecret) throw new Error('SyncManager needs a chain secret')
    this.vaultPath = path.resolve(vaultPath)
    this.serverUrl = serverUrl
    this.chainSecret = chainSecret // hex, jamais émis vers le renderer
    this.deviceId = deviceId
    this.fetchImpl = fetchImpl
    this.avecFlux = flux

    this.vault = new Vault(this.vaultPath)
    this.watcher = null
    this.pollTimer = null
    this.fluxCtrl = null
    this.syncing = false
    this.pendingSync = false
    this.lastSyncAt = null
    this.lastError = null
    this.lastErrorCode = null
    this.undecryptable = 0
    this.notMarkdown = 0
    this.tooLarge = 0
    this.notWritten = 0
    this.skipped = 0
    this.quotaFull = false
    this.quotaPending = 0
    this.server = null
    this._cles = null
    this._client = null
    this._annulation = new AbortController() // interrompu par stop(), renouvelé par start()
    this._enCours = null // promesse du cycle en cours
    this._relance = null // minuterie du prochain essai d'un cycle à relancer
    this._recul = 0
    this.state = 'idle' // idle | starting | running | stopped | chain-unknown | chain-proof
  }

  _emitStatus() {
    this.emit('status', this.getStatus())
  }

  /**
   * État pour l'interface. undecryptable : blocs illisibles ; notMarkdown : blocs
   * d'un autre type déposés par un autre client ; tooLarge : fichiers au-delà de
   * la limite par document ; notWritten : documents que le disque refuse (nom
   * interdit ou invalide, fichier verrouillé, lien symbolique, nom déjà pris) ;
   * skipped : fichiers locaux d'un autre type (jamais envoyés) ; quotaFull /
   * quotaPending : casier plein, documents en attente.
   */
  getStatus() {
    return {
      state: this.state,
      vaultPath: this.vaultPath,
      syncing: this.syncing,
      lastSyncAt: this.lastSyncAt,
      lastError: this.lastError,
      lastErrorCode: this.lastErrorCode,
      undecryptable: this.undecryptable,
      notMarkdown: this.notMarkdown,
      tooLarge: this.tooLarge,
      notWritten: this.notWritten,
      skipped: this.skipped,
      quotaFull: this.quotaFull,
      quotaPending: this.quotaPending,
      server: this.server,
    }
  }

  async start() {
    if (this.state === 'running' || this.state === 'starting') return
    const annulation = new AbortController()
    this._annulation = annulation
    const arrete = () => annulation.signal.aborted
    this.state = 'starting'
    this._emitStatus()

    this.vault.ensure()
    try { maintainFormatsReadme(this.vaultPath) } catch (err) { this._recordError(err) }

    try {
      await this._syncOnce()
    } catch (err) {
      if (this._handleFatal(err)) return
      this._recordError(err)
    }

    // stop() pendant le premier cycle : rien n'est installé, la synchro reste arrêtée.
    const { synchro } = await chargerChaine()
    if (arrete()) return
    this.watcher = watch(this.vaultPath, {
      onChange: () => this._scheduleSync(),
      filtre: synchro.estMarkdown,
      log: (kind, p) => this.emit('vault-event', { kind, path: p }),
    })
    this.pollTimer = setInterval(() => this._scheduleSync(), POLL_MS)
    if (this.avecFlux) await this._ecouterFlux()
    if (arrete()) { this._stopLoop(); return }

    this.state = 'running'
    this._emitStatus()
  }

  // Flux temps réel : un changement venu d'un autre appareil déclenche une synchro.
  async _ecouterFlux() {
    await this._preparer()
    this.fluxCtrl = new AbortController()
    this._client
      .flux(() => this._scheduleSync(), {
        signal: this.fluxCtrl.signal,
        onErreur: (err) => { if (!this._handleFatal(err)) this._recordError(err) },
      })
      .catch((err) => this._recordError(err))
  }

  // Une même erreur qui se répète (hors ligne, casier plein) n'est émise qu'une fois.
  _recordError(err) {
    const code = codeErreur(err)
    const message = err?.message || String(err)
    const nouvelle = code !== this.lastErrorCode || message !== this.lastError
    this.lastError = message
    this.lastErrorCode = code
    if (nouvelle) this.emit('error', err)
    this._emitStatus()
  }

  // Erreurs qui arrêtent la boucle. Renvoie true si l'erreur a été prise en charge.
  _handleFatal(err) {
    const etat = err?.status ? BLOCAGES[err.code] : null
    if (!etat) return false
    this._handleChainBlock(etat, err.code)
    return true
  }

  _scheduleSync() {
    this._syncOnce().catch((err) => {
      if (this._handleFatal(err)) return
      this._recordError(err)
    })
  }

  // Déclencheur externe (réveil, autre appareil), même effet que le watcher.
  triggerSync() { this._scheduleSync() }

  // Un cycle. Rien ne part après stop() ; un cycle demandé pendant un autre est
  // fait juste après, quand la boucle tourne (voir _suite).
  _syncOnce() {
    const { signal } = this._annulation
    if (signal.aborted) return Promise.resolve()
    if (this.syncing) { this.pendingSync = true; return Promise.resolve() }
    clearTimeout(this._relance)
    this._relance = null
    this.syncing = true
    this._emitStatus()
    this._enCours = this._cycle(signal)
    return this._enCours
  }

  async _cycle(signal) {
    let relancer = false
    try {
      const ops = await this._syncChaine(signal)
      relancer = ops.relancer.length > 0
      this.lastSyncAt = new Date().toISOString()
      this.lastError = null
      this.lastErrorCode = null
      const summary = `put=${ops.put.length} get=${ops.get.length} del=${ops.del.length} removeLocal=${ops.removeLocal.length} conflict=${ops.conflict.length} quota=${ops.quota.length} tooLarge=${ops.tropGros.length}`
      this.emit('log', `Sync complete: ${summary}`)
      this.emit('sync-complete', { lastSyncAt: this.lastSyncAt, ops })
    } catch (err) {
      if (!signal.aborted) throw err // arrêt demandé : le cycle s'interrompt sans erreur
    } finally {
      this.syncing = false
      this._emitStatus()
      if (!signal.aborted) this._suite(relancer)
    }
  }

  // Après un cycle de la boucle : un changement arrivé pendant le cycle repart
  // tout de suite ; un cycle à relancer (écriture concurrente) repart après un
  // délai qui double à chaque fois (1 s, 2 s... 30 s), remis à zéro par un
  // cycle sans relance. Hors de la boucle (cycle lancé seul), rien ne repart.
  _suite(relancer) {
    if (this.state !== 'running' && this.state !== 'starting') return
    this._recul = relancer ? Math.min(this._recul * 2 || RELANCE_MIN_MS, POLL_MS) : 0
    if (this.pendingSync) {
      this.pendingSync = false
      setImmediate(() => this._scheduleSync())
    } else if (relancer) {
      this._relance = setTimeout(() => { this._relance = null; this._scheduleSync() }, this._recul)
      this._relance.unref?.()
    }
  }

  async _preparer() {
    if (this._client) return
    const { service } = await chargerChaine()
    this._cles = await service.clesDepuisHex(this.chainSecret)
    this._client = service.clientDe(this._cles, { serverUrl: this.serverUrl, deviceId: this.deviceId, fetch: this.fetchImpl })
  }

  async _syncChaine(signal) {
    await this._preparer()
    const { synchro } = await chargerChaine()
    const r = await synchro.synchroniserChaine({
      vault: this.vault.vue(synchro.estMarkdown),
      client: this._client,
      cles: this._cles,
      base: chargerBaseChaine(this.vaultPath),
      log: (action, p) => this.emit('vault-event', { kind: `sync-${action}`, path: action === 'undecryptable' ? null : p }),
      signal,
    })
    signal.throwIfAborted() // arrêté pendant le cycle : la base n'est pas réécrite
    sauverBaseChaine(this.vaultPath, r.base)
    const { ops } = r
    this.skipped = this.vault.ignores
    this.undecryptable = ops.indechiffrables.length
    this.notMarkdown = ops.horsFormat.length
    this.tooLarge = ops.tropGros.length
    this.notWritten = ops.sautes.length
    this.server = r.serveur
    // Casier plein : un seul événement à l'entrée dans cet état, pas un par cycle.
    const plein = ops.quota.length > 0
    if (plein && !this.quotaFull) this.emit('quota', { pending: ops.quota.length, ...r.serveur })
    this.quotaFull = plein
    this.quotaPending = ops.quota.length
    return ops
  }

  _stopLoop() {
    clearTimeout(this._relance)
    this._relance = null
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null }
    if (this.watcher) { this.watcher.close().catch(() => {}); this.watcher = null }
    if (this.fluxCtrl) { this.fluxCtrl.abort(); this.fluxCtrl = null }
  }

  // Le casier a disparu ou le secret ne correspond plus : on s'arrête sans rien
  // toucher au disque, l'utilisateur rejoint la nouvelle chaîne ou en crée une.
  _handleChainBlock(etat, code) {
    this.state = etat
    this.lastError = code
    this.lastErrorCode = code
    this._annulation.abort()
    this._stopLoop()
    this.emit('log', `Chain: ${code}, sync stopped until the user acts`)
    this._emitStatus()
    this.emit('chain-block', { state: etat, code })
  }

  async stop() {
    const actif = this.state === 'running' || this.state === 'starting'
    this._annulation.abort()
    this.pendingSync = false
    this._stopLoop()
    // Le cycle en cours s'interrompt avant sa prochaine écriture ; on l'attend (5 s au plus).
    if (this.syncing) {
      let minuterie
      await Promise.race([this._enCours.catch(() => {}), new Promise((r) => { minuterie = setTimeout(r, ARRET_MAX_MS) })])
      clearTimeout(minuterie)
    }
    if (!actif) return
    this.state = 'stopped'
    this._emitStatus()
  }
}

module.exports = { SyncManager, chargerBaseChaine, sauverBaseChaine, effacerBaseChaine, codeErreur }
