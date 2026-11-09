// Relais aveugle de co-écriture : WebSocket sur /v1/collab (docs/collab-design.md § 5 et 6).
//
// Le relais range et fait suivre des enveloppes chiffrées qu'il ne peut pas
// ouvrir. Il ne connaît ni la clé du document, ni le texte, ni les prénoms, ni
// les curseurs. Il vérifie des formats, des empreintes et des limites.
//
// Journaux : des compteurs et au plus les 8 premiers caractères d'un id de
// salon. Jamais une trame, une preuve, un secret ou une adresse IP.

const { WebSocketServer } = require('ws')
const { sha256Hex, egalTempsConstant, prefixe, resumeErreur, sousVerrou } = require('../chaine')
const { preuves, cleIp, clePreuve } = require('../limiteurs')
const { lireConfig } = require('./config')

const CHEMIN = '/v1/collab'
const VERSION_PROTOCOLE = 1
const RE_SALON = /^[0-9a-f]{32}$/
const RE_EMPREINTE = /^[0-9a-f]{64}$/
const RE_BASE64URL = /^[A-Za-z0-9_-]+$/
const VERSION_ENVELOPPE = 1
// version + IV + au moins un bloc complété de 64 octets + étiquette
const TAILLE_MIN_ENVELOPPE = 1 + 12 + 64 + 16
const HEURE_MS = 60 * 60 * 1000

const FERMETURES = { TRAME: 4400, PREUVE: 4403, INCONNU: 4404, DELAI: 4408, TROP_GROS: 4413, LIMITE: 4429, PLEIN: 4503 }

/** Décode une preuve P (32 octets en base64url, 43 caractères) ou renvoie null. */
function decoderOctets(texte, taille) {
  if (typeof texte !== 'string' || !RE_BASE64URL.test(texte)) return null
  const octets = Buffer.from(texte, 'base64url')
  if (octets.length !== taille || octets.toString('base64url') !== texte) return null
  return octets
}

/** Décode une enveloppe chiffrée (champ d). Renvoie un Buffer ou null. */
function decoderEnveloppe(texte, tailleMax) {
  if (typeof texte !== 'string' || !texte.length || texte.length > tailleMax || !RE_BASE64URL.test(texte)) return null
  const octets = Buffer.from(texte, 'base64url')
  if (octets.length < TAILLE_MIN_ENVELOPPE || octets[0] !== VERSION_ENVELOPPE) return null
  if (octets.toString('base64url') !== texte) return null
  return octets
}

/**
 * Adresse du client. Derrière Traefik (1 saut de confiance, comme Express) :
 * la dernière valeur de X-Forwarded-For. L'adresse ne sert qu'aux limites, en mémoire.
 */
function adresseClient(req, confianceProxy) {
  if (confianceProxy) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean)
    if (xff.length) return xff[xff.length - 1]
  }
  return req.socket.remoteAddress || ''
}

/** Compteur à fenêtre glissante par clé (créations de salons par réseau). */
function compteurFenetre(max, fenetreMs, actif) {
  const coups = new Map()
  return {
    accepter(cle) {
      if (!actif) return true
      const t = Date.now()
      const liste = (coups.get(cle) || []).filter((x) => t - x < fenetreMs)
      if (liste.length >= max) {
        coups.set(cle, liste)
        return false
      }
      liste.push(t)
      coups.delete(cle)
      coups.set(cle, liste)
      while (coups.size > 10000) coups.delete(coups.keys().next().value)
      return true
    },
  }
}

/**
 * @param {object} o
 * @param {object} o.stockage            stockageMemoire ou stockagePrisma
 * @param {object} [o.config]            surcharges de lireConfig()
 * @param {boolean} [o.confianceProxy]   lire l'IP dans X-Forwarded-For (prod)
 * @param {(trame:string) => void} [o.espion]  tests : chaque trame reçue ou émise
 */
function creerRelais({ stockage, config: surcharges = {}, confianceProxy = false, espion = null }) {
  const config = lireConfig(surcharges)
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxTrame, perMessageDeflate: false })
  const salons = new Map() // id → Set des connexions authentifiées
  const parIp = new Map() // cleIp → connexions ouvertes
  const creations = compteurFenetre(config.creationsParHeure, HEURE_MS, config.limitesActives)
  const tailleMaxD = Math.ceil((config.maxTrame * 4) / 3)

  const envoyer = (ws, trame) => {
    if (ws.readyState !== 1) return
    const texte = JSON.stringify(trame)
    espion?.(texte)
    ws.send(texte)
  }
  const fermer = (ws, code) => {
    try {
      ws.close(code)
    } catch {
      ws.terminate()
    }
  }
  const diffuser = (id, sauf, trame) => {
    for (const autre of salons.get(id) || []) if (autre !== sauf) envoyer(autre, trame)
  }

  async function toucher(etat) {
    const t = Date.now()
    if (t - new Date(etat.salon.lastSeenAt).getTime() < HEURE_MS) return
    etat.salon.lastSeenAt = new Date(t)
    await stockage.toucher(etat.id, etat.salon.lastSeenAt)
  }

  // --- hello ---------------------------------------------------------------

  async function accueillir(ws, etat, trame) {
    const { room: id, proof, since, owner } = trame
    if (trame.v !== VERSION_PROTOCOLE || !RE_SALON.test(String(id))) return fermer(ws, FERMETURES.TRAME)
    const preuve = decoderOctets(proof, 32)
    if (!preuve) return fermer(ws, FERMETURES.TRAME)
    if (owner !== undefined && !RE_EMPREINTE.test(String(owner))) return fermer(ws, FERMETURES.TRAME)
    const depuis = Number.isInteger(since) && since >= 0 ? since : 0

    const cle = clePreuve(etat.ip, id)
    if (config.limitesActives && preuves.estLimite(cle)) return fermer(ws, FERMETURES.LIMITE)

    await sousVerrou(`collab:${id}`, async () => {
      if (await stockage.estArrete(id)) return fermer(ws, FERMETURES.INCONNU)
      let salon = await stockage.lireSalon(id)
      const proofHash = sha256Hex(preuve)
      if (!salon) {
        // Seul le propriétaire (owner présent) crée un salon. Un invité reçoit « inconnu ».
        if (!owner) return fermer(ws, FERMETURES.INCONNU)
        if ((await stockage.compterSalons()) >= config.maxSalons) return fermer(ws, FERMETURES.PLEIN)
        if (!creations.accepter(cleIp(etat.ip))) return fermer(ws, FERMETURES.LIMITE)
        salon = await stockage.creerSalon({ id, proofHash, ownerHash: owner })
        if (!salon) return fermer(ws, FERMETURES.INCONNU)
        console.log(`[collab] room ${prefixe(id)} created`)
      } else if (!egalTempsConstant(salon.proofHash, proofHash)) {
        if (config.limitesActives) preuves.compter(cle)
        return fermer(ws, FERMETURES.PREUVE)
      }
      const presents = salons.get(id) || new Set()
      if (presents.size >= config.maxPersonnes) return fermer(ws, FERMETURES.LIMITE)
      if (ws.readyState !== 1) return
      etat.id = id
      etat.salon = salon
      presents.add(ws)
      salons.set(id, presents)
      const entrees = await stockage.entrees(id, depuis)
      envoyer(ws, {
        t: 'welcome',
        seq: salon.lastSeq,
        entries: entrees.map((e) => ({ s: e.s, d: Buffer.from(e.d).toString('base64url') })),
        peers: presents.size - 1,
      })
      await toucher(etat)
    })
  }

  // --- messages d'un client authentifié ------------------------------------

  async function mettreAJour(ws, etat, d) {
    const octets = decoderEnveloppe(d, tailleMaxD)
    if (!octets) return fermer(ws, FERMETURES.TRAME)
    await sousVerrou(`collab:${etat.id}`, async () => {
      const salon = await stockage.lireSalon(etat.id)
      if (!salon) return fermer(ws, FERMETURES.INCONNU)
      etat.salon = salon
      if (salon.bytesUsed + octets.length > config.quotaOctets) {
        envoyer(ws, { t: 'error', code: 'QUOTA_EXCEEDED' })
        envoyer(ws, { t: 'compact?' })
        return
      }
      const s = salon.lastSeq + 1
      await stockage.ajouter(etat.id, s, octets)
      salon.lastSeq = s
      salon.bytesUsed += octets.length
      envoyer(ws, { t: 'ack', s })
      diffuser(etat.id, ws, { t: 'up', s, d })
      await toucher(etat)
      // Journal trop long : l'auteur de ce message est prié d'envoyer un instantané.
      const messages = s - salon.baseSeq
      if (messages > config.compacterApres || salon.bytesUsed > config.quotaOctets / 2 + config.margeCompactage) {
        envoyer(ws, { t: 'compact?' })
      }
    })
  }

  async function compacter(ws, etat, trame) {
    const octets = decoderEnveloppe(trame.d, tailleMaxD)
    if (!octets || !Number.isInteger(trame.upto)) return fermer(ws, FERMETURES.TRAME)
    await sousVerrou(`collab:${etat.id}`, async () => {
      const salon = await stockage.lireSalon(etat.id)
      if (!salon) return fermer(ws, FERMETURES.INCONNU)
      // Rien à gagner, ou un numéro qui n'existe pas : ignoré.
      if (trame.upto <= salon.baseSeq || trame.upto > salon.lastSeq) return
      await stockage.compacter(etat.id, trame.upto, octets)
      etat.salon = await stockage.lireSalon(etat.id)
    })
  }

  async function arreter(ws, etat, trame) {
    const secret = decoderOctets(trame.owner, 32)
    if (!secret) return fermer(ws, FERMETURES.TRAME)
    await sousVerrou(`collab:${etat.id}`, async () => {
      const salon = await stockage.lireSalon(etat.id)
      if (!salon) return fermer(ws, FERMETURES.INCONNU)
      if (!egalTempsConstant(salon.ownerHash, sha256Hex(secret))) {
        if (config.limitesActives) preuves.compter(clePreuve(etat.ip, etat.id))
        envoyer(ws, { t: 'error', code: 'NOT_OWNER' })
        return
      }
      await stockage.arreter(etat.id)
      console.log(`[collab] room ${prefixe(etat.id)} stopped by its owner`)
      // Tout le monde reçoit la même réponse qu'un salon qui n'a jamais existé.
      for (const autre of salons.get(etat.id) || []) fermer(autre, FERMETURES.INCONNU)
      salons.delete(etat.id)
    })
  }

  async function traiter(ws, etat, texte) {
    let trame
    try {
      trame = JSON.parse(texte)
    } catch {
      return fermer(ws, FERMETURES.TRAME)
    }
    if (!trame || typeof trame !== 'object' || typeof trame.t !== 'string') return fermer(ws, FERMETURES.TRAME)
    if (!etat.id) {
      if (trame.t !== 'hello' || etat.hello) return fermer(ws, FERMETURES.TRAME)
      etat.hello = true
      clearTimeout(etat.minuterieHello)
      return accueillir(ws, etat, trame)
    }
    switch (trame.t) {
      case 'up':
        return mettreAJour(ws, etat, trame.d)
      case 'aw': {
        // Présence : relayée telle quelle, jamais gardée.
        if (!decoderEnveloppe(trame.d, tailleMaxD)) return fermer(ws, FERMETURES.TRAME)
        return diffuser(etat.id, ws, { t: 'aw', d: trame.d })
      }
      case 'compact':
        return compacter(ws, etat, trame)
      case 'stop':
        return arreter(ws, etat, trame)
      default:
        return fermer(ws, FERMETURES.TRAME)
    }
  }

  // --- connexions -----------------------------------------------------------

  wss.on('connection', (ws, req) => {
    const ip = adresseClient(req, confianceProxy)
    const cle = cleIp(ip)
    const ouvertes = (parIp.get(cle) || 0) + 1
    if (config.limitesActives && ouvertes > config.connexionsParIp) return fermer(ws, FERMETURES.LIMITE)
    parIp.set(cle, ouvertes)

    const etat = { ip, id: null, salon: null, hello: false, trames: [], file: Promise.resolve() }
    etat.minuterieHello = setTimeout(() => {
      if (!etat.id) fermer(ws, FERMETURES.DELAI)
    }, config.delaiHelloMs)

    ws.on('message', (donnees, binaire) => {
      if (binaire) return fermer(ws, FERMETURES.TRAME)
      if (config.limitesActives) {
        const t = Date.now()
        etat.trames = etat.trames.filter((x) => t - x < config.fenetreTramesMs)
        if (etat.trames.length >= config.tramesMax) {
          envoyer(ws, { t: 'error', code: 'RATE_LIMITED' })
          return fermer(ws, FERMETURES.LIMITE)
        }
        etat.trames.push(t)
      }
      const texte = donnees.toString('utf8')
      espion?.(texte)
      // Une connexion traite ses trames dans l'ordre (les acquittements aussi).
      etat.file = etat.file
        .then(() => traiter(ws, etat, texte))
        .catch((err) => {
          console.error('[collab] error:', resumeErreur(err))
          fermer(ws, 1011)
        })
    })
    ws.on('close', () => {
      clearTimeout(etat.minuterieHello)
      const n = (parIp.get(cle) || 1) - 1
      if (n > 0) parIp.set(cle, n)
      else parIp.delete(cle)
      if (etat.id) {
        const presents = salons.get(etat.id)
        presents?.delete(ws)
        if (presents && !presents.size) salons.delete(etat.id)
      }
    })
    ws.on('error', () => {})
  })

  // Connexions mortes (téléphone en veille, réseau coupé) : ping toutes les 30 s.
  const battement = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws._lectorMort) {
        ws.terminate()
        continue
      }
      ws._lectorMort = true
      ws.once('pong', () => {
        ws._lectorMort = false
      })
      try {
        ws.ping()
      } catch {
        // déjà fermée
      }
    }
  }, config.pingMs)
  battement.unref?.()

  return {
    /** Branche le relais sur un serveur HTTP (upgrade sur /v1/collab seulement). */
    attacher(serveur) {
      serveur.on('upgrade', (req, socket, tete) => {
        let chemin
        try {
          chemin = new URL(req.url, 'http://x').pathname
        } catch {
          chemin = ''
        }
        if (chemin !== CHEMIN) return socket.destroy()
        wss.handleUpgrade(req, socket, tete, (ws) => wss.emit('connection', ws, req))
      })
      return this
    },
    /** Supprime les salons inactifs et oublie les arrêts anciens. */
    async purger(maintenant = Date.now()) {
      return stockage.purger({
        inactifAvant: new Date(maintenant - config.dureeInactiviteMs),
        arretesAvant: new Date(maintenant - config.dureeArretesMs),
      })
    },
    demarrerPurge() {
      const tour = async () => {
        try {
          const { inactifs, oublies } = await this.purger()
          if (inactifs || oublies) console.log(`[collab] purge: ${inactifs} inactive rooms, ${oublies} old stop marks removed`)
        } catch (err) {
          console.error('[collab] purge error:', resumeErreur(err))
        }
      }
      tour()
      setInterval(tour, 24 * HEURE_MS).unref()
      return this
    },
    fermer() {
      clearInterval(battement)
      for (const ws of wss.clients) ws.terminate()
      wss.close()
    },
    _salons: salons,
  }
}

module.exports = { creerRelais, FERMETURES, CHEMIN, adresseClient }
