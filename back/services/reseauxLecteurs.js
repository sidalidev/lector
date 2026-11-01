// Limite anti-partage, en mémoire seulement.
//
// Une chaîne sert aux appareils d'une même personne : un Mac, un téléphone qui
// change d'adresse en 4G, le Wi-Fi d'un lieu de travail. Ces appareils lisent
// depuis une poignée de réseaux par jour. Une chaîne dont les 12 mots
// circulent entre inconnus (pour s'en servir comme casier de partage) lit au
// contraire depuis des dizaines de réseaux.
//
// Pour chaque chaîne, on compte donc les réseaux distincts qui ont lu dans les
// dernières 24 heures (fenêtre glissante). Au-delà de CHAIN_READ_NETWORKS_MAX
// (8 par défaut), les lectures d'un nouveau réseau répondent 429
// CHAIN_READ_LIMITED ; les réseaux déjà vus continuent.
//
// Vie privée :
// - un réseau est le préfixe de l'adresse (/24 en IPv4, /48 en IPv6), jamais
//   l'adresse elle-même ;
// - ce préfixe n'est gardé que sous forme d'empreinte HMAC-SHA256 avec un sel
//   aléatoire tiré au démarrage et remplacé toutes les 24 heures : une fois le
//   sel oublié, une empreinte ne se relie plus à aucun réseau ;
// - tout vit dans une Map du processus : rien sur le disque, rien dans les
//   journaux, tout disparaît au redémarrage ;
// - seules les requêtes à la bonne preuve sont comptées : sans P, personne ne
//   peut user le budget d'une chaîne.
//
// CHAIN_RATE_LIMITS=off la désactive (tests), comme les autres limiteurs.
// CHAIN_READ_NETWORKS_WINDOW_MS change la durée de la fenêtre et de la
// rotation du sel (24 heures par défaut ; les tests la raccourcissent).

const crypto = require('crypto')
const { entierEnv } = require('./chaine')

const JOUR_MS = 24 * 60 * 60 * 1000
// Mémoire bornée : au plus MAX_RESEAUX empreintes par chaîne (on n'en ajoute
// plus au-delà) et MAX_CHAINES_SUIVIES chaînes, les moins récentes oubliées d'abord.
const MAX_CHAINES_SUIVIES = 20000

/**
 * Préfixe réseau d'une adresse : /24 en IPv4 (y compris ::ffff:a.b.c.d), /48
 * en IPv6. Renvoie le texte tel quel s'il n'est pas une adresse reconnue.
 */
function prefixeReseau(ip) {
  const adresse = String(ip || '').split('%')[0]
  if (adresse.includes('.')) {
    const v4 = adresse.slice(adresse.lastIndexOf(':') + 1).split('.')
    if (v4.length === 4) return `${v4.slice(0, 3).join('.')}.0/24`
    return adresse
  }
  if (!adresse.includes(':')) return adresse
  const [gauche, droite] = adresse.split('::')
  const debut = gauche ? gauche.split(':') : []
  const fin = droite ? droite.split(':') : []
  const groupes = droite === undefined ? debut : [...debut, ...Array(Math.max(0, 8 - debut.length - fin.length)).fill('0'), ...fin]
  return `${groupes.slice(0, 3).map((g) => (parseInt(g, 16) || 0).toString(16)).join(':')}::/48`
}

/**
 * @param {object} o
 * @param {number} o.max        réseaux distincts admis par chaîne et par fenêtre
 * @param {number} o.fenetreMs  durée de la fenêtre glissante et de la rotation du sel
 * @param {boolean} [o.actif]
 * @param {() => number} [o.maintenant]
 */
function creerCompteurReseaux({ max, fenetreMs, actif = true, maintenant = Date.now }) {
  const parChaine = new Map() // chainId → Map(empreinte → dernière lecture)
  const signales = new Map() // chainId → date du dernier refus noté dans le journal (une fois par fenêtre)
  let sel = crypto.randomBytes(32)
  let ancienSel = null
  let rotation = maintenant() + fenetreMs

  // Nouveau sel toutes les `fenetreMs`. L'ancien reste une fenêtre de plus :
  // un réseau vu juste avant la rotation est encore reconnu juste après.
  function tourner(t) {
    if (t < rotation) return
    ancienSel = t < rotation + fenetreMs ? sel : null
    sel = crypto.randomBytes(32)
    rotation = t < rotation + fenetreMs ? rotation + fenetreMs : t + fenetreMs
  }

  const empreinte = (cle, reseau) => crypto.createHmac('sha256', cle).update(reseau).digest('base64url').slice(0, 22)

  /** Retire les réseaux sortis de la fenêtre. Renvoie la Map de la chaîne, ou undefined. */
  function recents(chainId, t) {
    const vus = parChaine.get(chainId)
    if (!vus) return undefined
    for (const [h, derniere] of vus) if (t - derniere >= fenetreMs) vus.delete(h)
    if (vus.size) return vus
    parChaine.delete(chainId)
    return undefined
  }

  function retenir(chainId, vus) {
    parChaine.delete(chainId)
    parChaine.set(chainId, vus)
    while (parChaine.size > MAX_CHAINES_SUIVIES) parChaine.delete(parChaine.keys().next().value)
  }

  return {
    /**
     * Une lecture de la chaîne depuis l'adresse `ip`. Renvoie { ok: true }, ou
     * { ok: false, reessayerDansMs, premierRefus } quand un nouveau réseau
     * dépasse le plafond. Seule l'empreinte du préfixe est retenue.
     */
    lecture(chainId, ip) {
      if (!actif) return { ok: true }
      const t = maintenant()
      tourner(t)
      const reseau = prefixeReseau(ip)
      const h = empreinte(sel, reseau)
      let vus = recents(chainId, t)
      if (vus) {
        let connu = vus.delete(h)
        if (!connu && ancienSel) connu = vus.delete(empreinte(ancienSel, reseau))
        if (connu) {
          vus.set(h, t)
          retenir(chainId, vus)
          return { ok: true }
        }
        if (vus.size >= max) {
          const plusAncienne = Math.min(...vus.values())
          const dernier = signales.get(chainId)
          const premierRefus = dernier === undefined || t - dernier >= fenetreMs
          if (premierRefus) {
            signales.delete(chainId)
            signales.set(chainId, t)
            while (signales.size > MAX_CHAINES_SUIVIES) signales.delete(signales.keys().next().value)
          }
          return { ok: false, reessayerDansMs: Math.max(1000, plusAncienne + fenetreMs - t), premierRefus }
        }
      } else {
        vus = new Map()
      }
      vus.set(h, t)
      retenir(chainId, vus)
      return { ok: true }
    },

    /** Oublie une chaîne (effacée). */
    oublier(chainId) {
      parChaine.delete(chainId)
      signales.delete(chainId)
    },

    /** Nombre de réseaux comptés pour une chaîne (tests). */
    taille(chainId) {
      return recents(chainId, maintenant())?.size || 0
    },
  }
}

const reseauxLecteurs = creerCompteurReseaux({
  max: entierEnv('CHAIN_READ_NETWORKS_MAX', 8),
  fenetreMs: entierEnv('CHAIN_READ_NETWORKS_WINDOW_MS', JOUR_MS),
  actif: process.env.CHAIN_RATE_LIMITS !== 'off',
})

module.exports = { reseauxLecteurs, creerCompteurReseaux, prefixeReseau }
