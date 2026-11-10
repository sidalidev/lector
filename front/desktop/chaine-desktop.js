// Opérations de chaîne du processus principal d'Electron (docs/CHAINE.md § 6.4, 10 et 11).
//
// Sans compte : la chaîne est l'identité. S est rangé dans creds.chainSecret
// (hex), donc dans cloud-secrets.dat chiffré par safeStorage (Trousseau macOS,
// DPAPI, libsecret). Le renderer ne reçoit jamais S : il reçoit hasChain, et
// les 12 mots ou le code seulement pour les afficher, à la création ou quand
// le verrou (Touch ID ou confirmation) est ouvert. Nouvelle chaîne et tout
// effacer exigent aussi le verrou : un script dans le renderer ne peut ni faire
// passer la chaîne sur des mots qu'il connaît, ni effacer le casier.
//
// Les dépendances sont injectées (main.js) pour que ce module se teste en Node
// sans Electron (chaine-desktop.test.cjs).

const { Vault } = require('./vault/vault')
const { chargerChaine } = require('./chaine-modules')
const { chargerBaseChaine, sauverBaseChaine, effacerBaseChaine, codeErreur } = require('./sync-manager')

const DUREE_ATTENTE_MS = 30 * 60 * 1000 // un S tiré mais pas encore utilisé expire après 30 min

// Réponse d'erreur au renderer : { ok: false, code, error, detail }. Le code est
// traduit par l'interface. detail : le mot inconnu (UNKNOWN_WORD), ou les
// documents qui empêchent d'effacer l'ancien casier (ROTATION_INCOMPLETE).
function echec(err) {
  return { ok: false, code: codeErreur(err) || 'UNKNOWN', error: err?.message || String(err), detail: err?.detail || err?.details?.missing || null }
}

// Champs de chaîne effacés quand cet appareil quitte sa chaîne.
const SANS_CHAINE = { chainSecret: undefined, chainId: undefined, chainPendingSecret: undefined, chainSaved: undefined }

const verrouille = () => ({ ok: false, code: 'LOCKED', error: 'Locked' })

class ChaineDesktop {
  /**
   * @param {object} d
   * @param {() => object} d.getCreds
   * @param {(creds: object) => void} d.saveCreds
   * @param {Function} d.fetchImpl
   * @param {() => Promise<void>} d.arreterSynchro
   * @param {() => Promise<void>} d.demarrerSynchro
   * @param {() => boolean} d.verrouOuvert
   * @param {() => boolean} [d.stockageSur]  vrai si safeStorage chiffre vraiment
   * @param {(evt: object) => void} [d.emettre]
   * @param {(msg: string) => void} [d.log]
   * @param {(dossier: string) => Promise<void>} [d.mettreALaCorbeille]  shell.trashItem, jamais de suppression définitive
   * @param {string} d.serverUrlParDefaut
   */
  constructor(d) {
    this.d = d
    this._attente = null // { hex, expire } : S tiré par preparer(), pas encore utilisé
    this._occupe = false
  }

  _creds() { return this.d.getCreds() || {} }

  /** Fusionne `modif` dans les creds ; une valeur undefined retire le champ. */
  _sauver(modif) {
    const suite = { ...this._creds(), ...modif }
    for (const k of Object.keys(suite)) if (suite[k] === undefined) delete suite[k]
    this.d.saveCreds(suite)
    return suite
  }

  _serverUrl(c) { return (c.serverUrl || this.d.serverUrlParDefaut).replace(/\/$/, '') }

  /** Clés et client du casier d'un secret en hex. */
  async _chaine(hex) {
    const { service } = await chargerChaine()
    const c = this._creds()
    const cles = await service.clesDepuisHex(hex)
    return { cles, client: service.clientDe(cles, { serverUrl: this._serverUrl(c), deviceId: c.deviceId || null, fetch: this.d.fetchImpl }) }
  }

  _log(m) { try { this.d.log?.(m) } catch {} }
  _emettre(evt) { try { this.d.emettre?.(evt) } catch {} }

  // Une seule opération lourde à la fois (création, renouvellement...).
  async _exclusif(fn) {
    if (this._occupe) return { ok: false, code: 'BUSY', error: 'Operation already running' }
    this._occupe = true
    try { return await fn() } catch (err) { this._log('Chain: ' + (err?.code || err?.message || err)); return echec(err) } finally { this._occupe = false }
  }

  _secretEnAttente(c) {
    if (c.chainPendingSecret) return c.chainPendingSecret // reprise après coupure, prioritaire
    if (this._attente && this._attente.expire > Date.now()) return this._attente.hex
    return null
  }

  /** Vault réduit aux fichiers markdown, comme le voit la synchro. */
  async _vault(vaultPath) {
    const { synchro } = await chargerChaine()
    const vault = new Vault(vaultPath)
    vault.ensure()
    return vault.vue(synchro.estMarkdown)
  }

  /** Ce qui partira à la création : nombre de fichiers markdown et taille des blocs chiffrés. */
  async _estimer(vaultPath) {
    if (!vaultPath) return null
    const { synchro, crypto } = await chargerChaine()
    const fichiers = new Vault(vaultPath).walk().filter((f) => synchro.estMarkdown(f.relPath))
    return { fichiers: fichiers.length, octets: fichiers.reduce((s, f) => s + f.size + crypto.SURCOUT_ENVELOPPE, 0) }
  }

  /**
   * État de cet appareil, et du casier s'il a une chaîne :
   * { ok, hasChain, chainId, saved, pending: 'create'|'rotate'|null, vaultPath, stockageSur,
   *   serveur: { bytesUsed, quotaBytes, maxDocBytes, maxDocs, docCount } }.
   * Casier inconnu (renouvelé ou effacé ailleurs) : { ok: false, code: 'CHAIN_UNKNOWN' },
   * sans rien effacer ici (l'écran propose de rejoindre ou de créer).
   */
  async etat() {
    const c = this._creds()
    const etat = {
      ok: true,
      hasChain: !!c.chainSecret,
      chainId: c.chainId || null,
      saved: !!c.chainSaved,
      pending: c.chainPendingSecret ? (c.chainSecret ? 'rotate' : 'create') : null,
      vaultPath: c.vaultPath || null,
      stockageSur: this.d.stockageSur ? !!this.d.stockageSur() : true,
    }
    if (!c.chainSecret) return etat
    try {
      const { client } = await this._chaine(c.chainSecret)
      const e = await client.etat()
      return { ...etat, serveur: { bytesUsed: e.bytesUsed, quotaBytes: e.quotaBytes, maxDocBytes: e.maxDocBytes, maxDocs: e.maxDocs, docCount: e.docCount } }
    } catch (err) {
      return { ...etat, ...echec(err) }
    }
  }

  /**
   * Tire un nouveau S (création ou nouvelle chaîne) et renvoie les 12 mots à
   * noter, le code du QR, et ce que la création enverra (envoi : { fichiers, octets }).
   * Pour une nouvelle chaîne (cet appareil en a déjà une), verrou ouvert seulement.
   */
  async preparer() {
    try {
      const c = this._creds()
      if (c.chainSecret && !this.d.verrouOuvert()) return verrouille()
      // Une opération coupée se reprend (ou s'abandonne) avec son propre secret :
      // tirer un nouveau S afficherait des mots qui ne serviraient pas.
      if (c.chainPendingSecret) return { ok: false, code: 'RESUME_REQUIRED', error: 'An operation must be resumed or abandoned first' }
      const { service } = await chargerChaine()
      const n = await service.nouvelleChaine()
      this._attente = { hex: service.secretVersHex(n.S), expire: Date.now() + DUREE_ATTENTE_MS }
      n.S.fill(0)
      return { ok: true, mots: n.mots, code: n.code, envoi: await this._estimer(c.vaultPath) }
    } catch (err) { return echec(err) }
  }

  /**
   * Crée le casier avec le S préparé (ou reprend une création coupée) et y
   * envoie tout le markdown du vault. Faute de place, l'envoi est partiel :
   * la chaîne est créée quand même, et la synchro signale ce qui attend.
   */
  creer() {
    return this._exclusif(async () => {
      const c = this._creds()
      if (!c.vaultPath) return { ok: false, code: 'NO_VAULT', error: 'No vault selected' }
      if (c.chainSecret) return { ok: false, code: 'HAS_CHAIN', error: 'This device already has a chain' }
      const hex = this._secretEnAttente(c)
      if (!hex) return { ok: false, code: 'NO_SECRET', error: 'No prepared chain secret' }
      const { synchro } = await chargerChaine()
      const { client, cles } = await this._chaine(hex)

      const etatServeur = await client.creer()
      // Le casier existe : le secret est gardé pour reprendre l'envoi après une coupure.
      this._sauver({ chainPendingSecret: hex })
      this._emettre({ type: 'chain-progress', phase: 'estimate', ...(await this._estimer(c.vaultPath)), quotaBytes: etatServeur.quotaBytes, maxDocBytes: etatServeur.maxDocBytes })
      const r = await synchro.envoyerTout({
        vault: await this._vault(c.vaultPath),
        client,
        cles,
        base: chargerBaseChaine(c.vaultPath),
        sauverBase: (b) => sauverBaseChaine(c.vaultPath, b),
        onProgress: (fait, total) => this._emettre({ type: 'chain-progress', phase: 'upload', fait, total }),
      })
      this._sauver({ chainSecret: hex, chainId: cles.id, chainPendingSecret: undefined, chainSaved: false })
      this._attente = null
      await this.d.demarrerSynchro()
      return { ok: true, chainId: cles.id, envoyes: r.envoyes, tropGros: r.tropGros, quota: r.quota, serveur: r.serveur }
    })
  }

  /**
   * Rejoindre avec les 12 mots ou le code. Mots invalides : codes de saisie
   * (CHECKSUM, UNKNOWN_WORD...) ; aucune chaîne avec ces mots : CHAIN_UNKNOWN.
   * Rien n'est gardé dans ces deux cas, et aucun casier n'est jamais créé ici.
   */
  rejoindre(saisie) {
    return this._exclusif(async () => {
      const c = this._creds()
      if (c.chainPendingSecret) return { ok: false, code: 'RESUME_REQUIRED', error: 'An operation must be resumed or abandoned first' }
      const { service } = await chargerChaine()
      const { S, id } = await service.lireSaisie(saisie)
      const hex = service.secretVersHex(S)
      S.fill(0)
      const { client } = await this._chaine(hex)
      await client.etat()
      await this.d.arreterSynchro()
      // L'utilisateur a saisi ou scanné le secret : il l'a donc sous la main.
      this._sauver({ chainSecret: hex, chainId: id, chainSaved: true })
      // La première synchro fait l'adoption : chaine.json ne connaît pas cette chaîne.
      if (c.vaultPath) await this.d.demarrerSynchro()
      return { ok: true, chainId: id }
    })
  }

  /** L'utilisateur a confirmé avoir sauvegardé ses 12 mots (quiz réussi). */
  marquerSauvegardee() {
    if (!this._creds().chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' }
    this._sauver({ chainSaved: true })
    return { ok: true }
  }

  /** 12 mots et code d'appairage (QR) pour ajouter un appareil. Uniquement verrou ouvert. */
  async exporter() {
    try {
      if (!this.d.verrouOuvert()) return verrouille()
      const c = this._creds()
      if (!c.chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' }
      const { service } = await chargerChaine()
      const S = service.hexVersSecret(c.chainSecret)
      try {
        return { ok: true, ...(await service.exporterChaine(S)) }
      } finally { S.fill(0) }
    } catch (err) { return echec(err) }
  }

  /**
   * Vérifie le casier : blocs, octets, place, et que chaque bloc se lit avec les
   * clés de cet appareil et porte un chemin markdown.
   */
  async verifier() {
    try {
      const c = this._creds()
      if (!c.chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' }
      const { crypto, synchro } = await chargerChaine()
      const { client, cles } = await this._chaine(c.chainSecret)
      const man = await client.manifeste()
      const vivants = (man.docs || []).filter((d) => !d.deletedAt)
      let illisibles = 0
      let horsFormat = 0
      for (const d of vivants) {
        try {
          if (!synchro.estMarkdown(await crypto.dechiffrerCheminAvec(cles, d.docId, d.pathEnc))) horsFormat++
        } catch {
          illisibles++
        }
      }
      return {
        ok: true,
        verification: {
          blocs: vivants.length,
          octets: vivants.reduce((s, d) => s + (d.size || 0), 0),
          bytesUsed: man.bytesUsed,
          quotaBytes: man.quotaBytes,
          maxDocBytes: man.maxDocBytes,
          maxDocs: man.maxDocs,
          illisibles,
          horsFormat,
          ok: illisibles === 0 && horsFormat === 0,
        },
      }
    } catch (err) { return echec(err) }
  }

  /**
   * Nouvelle chaîne (§ 11.1) avec le S préparé, ou reprise d'un renouvellement
   * coupé, verrou ouvert. Tout passe dans un nouveau casier, puis l'ancien est
   * effacé : les autres appareils devront rejoindre avec les nouveaux 12 mots.
   */
  renouveler() {
    return this._exclusif(async () => {
      if (!this.d.verrouOuvert()) return verrouille()
      const c = this._creds()
      if (!c.vaultPath) return { ok: false, code: 'NO_VAULT', error: 'No vault selected' }
      if (!c.chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' }
      const hexNouveau = this._secretEnAttente(c)
      if (!hexNouveau) return { ok: false, code: 'NO_SECRET', error: 'No prepared chain secret' }
      const { synchro } = await chargerChaine()
      const ancien = await this._chaine(c.chainSecret)
      const nouveau = await this._chaine(hexNouveau)

      await this.d.arreterSynchro()
      this._sauver({ chainPendingSecret: hexNouveau })
      let r
      try {
        r = await synchro.renouvelerChaine({
          vault: await this._vault(c.vaultPath),
          ancien,
          nouveau,
          base: chargerBaseChaine(c.vaultPath),
          onProgress: (fait, total) => this._emettre({ type: 'chain-progress', phase: 'upload', fait, total }),
        })
      } catch (err) {
        // Faute de place, le nouveau casier a été retiré : rien à reprendre. Sinon
        // le secret reste en attente pour une reprise. L'ancienne chaîne reprend.
        if (err?.code === 'QUOTA_EXCEEDED') this._sauver({ chainPendingSecret: undefined })
        try { await this.d.demarrerSynchro() } catch {}
        throw err
      }
      sauverBaseChaine(c.vaultPath, r.base)
      this._sauver({ chainSecret: hexNouveau, chainId: nouveau.cles.id, chainPendingSecret: undefined, chainSaved: false })
      this._attente = null
      await this.d.demarrerSynchro()
      return { ok: true, chainId: nouveau.cles.id, envoyes: r.envoyes, tropGros: r.tropGros }
    })
  }

  /**
   * Abandonne une création ou un renouvellement coupé : le casier en cours est
   * effacé et le secret oublié. Si l'ancien casier d'un renouvellement n'existe
   * déjà plus, le nouveau EST la chaîne : il devient celle de l'appareil.
   */
  abandonner() {
    return this._exclusif(async () => {
      const c = this._creds()
      if (!c.chainPendingSecret) return { ok: false, code: 'NOTHING_PENDING', error: 'Nothing to abandon' }
      const { client: module } = await chargerChaine()
      const enCours = await this._chaine(c.chainPendingSecret)
      if (c.chainSecret) {
        const ancien = await this._chaine(c.chainSecret)
        try {
          await ancien.client.etat()
        } catch (err) {
          if (!module.estChaineInconnue(err)) throw err
          this._sauver({ chainSecret: c.chainPendingSecret, chainId: enCours.cles.id, chainPendingSecret: undefined, chainSaved: false })
          this._attente = null
          await this.d.arreterSynchro()
          if (c.vaultPath) await this.d.demarrerSynchro()
          return { ok: true, promoted: true, chainId: enCours.cles.id }
        }
      }
      try {
        await enCours.client.effacerTout()
      } catch (err) {
        if (err?.status !== 404) throw err
      }
      this._sauver({ chainPendingSecret: undefined })
      this._attente = null
      if (c.chainSecret && c.vaultPath) await this.d.demarrerSynchro()
      return { ok: true, promoted: false }
    })
  }

  /**
   * Tout effacer, verrou ouvert et `confirmation` = 'DELETE', dans cet ordre :
   * 1. le casier entier disparaît du serveur ;
   * 2. cet appareil oublie S (cloud-secrets.dat) et la base de synchro du vault ;
   * 3. si `options.localFolder`, le dossier du vault part à la corbeille du
   *    système (jamais de suppression définitive) et n'est plus le vault.
   * Sans la case, le vault local reste intact.
   * Renvoie { ok: true, trashed } ; trashError si la corbeille a refusé
   * (le reste est effacé quand même).
   */
  effacerTout(confirmation, options = {}) {
    return this._exclusif(async () => {
      if (confirmation !== 'DELETE') return { ok: false, code: 'CONFIRM_REQUIRED', error: 'Confirmation required' }
      if (!this.d.verrouOuvert()) return verrouille()
      const c = this._creds()
      if (!c.chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' }
      const { client } = await this._chaine(c.chainSecret)
      await this.d.arreterSynchro()
      try {
        await client.effacerTout()
      } catch (err) {
        if (err?.status !== 404) {
          try { await this.d.demarrerSynchro() } catch {}
          throw err
        }
      }
      this._sauver(SANS_CHAINE)
      if (c.vaultPath) effacerBaseChaine(c.vaultPath)
      this._attente = null
      if (!options?.localFolder || !c.vaultPath || !this.d.mettreALaCorbeille) return { ok: true, trashed: false }
      try {
        await this.d.mettreALaCorbeille(c.vaultPath)
      } catch (err) {
        this._log('Chain erase: folder not moved to the Trash: ' + (err?.message || err))
        return { ok: true, trashed: false, trashError: err?.code || 'TRASH_FAILED' }
      }
      this._sauver({ vaultPath: undefined })
      return { ok: true, trashed: true }
    })
  }

  /**
   * Quitte la chaîne sur cet appareil seulement : S oublié, synchro arrêtée,
   * vault local et casier intacts. La base locale est gardée pour une
   * éventuelle adoption plus tard.
   */
  quitter() {
    return this._exclusif(async () => {
      await this.d.arreterSynchro()
      this._sauver(SANS_CHAINE)
      this._attente = null
      return { ok: true }
    })
  }
}

module.exports = { ChaineDesktop }
