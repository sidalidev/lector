// Anti-abus en mémoire. Sans compte, ce sont les seules défenses hors quota :
//
// - creations : casiers créés par IP (CHAIN_CREATE_PER_HOUR, 5 par heure) ;
// - preuves : preuves fausses par couple (IP, chaîne), 10 par 15 minutes.
//
// Une adresse IPv6 compte pour son /64 (cleIp).
//
// Jamais de blocage par chaîne seule : sinon n'importe qui connaissant un id
// gèlerait la synchro de son propriétaire en envoyant de fausses preuves. La
// bonne preuve passe toujours (P fait 256 bits, la force brute est exclue).
// CHAIN_RATE_LIMITS=off les désactive (tests).

const MAX_CLES = 10000

function creerLimiteur(max, fenetreMs) {
  const actif = process.env.CHAIN_RATE_LIMITS !== 'off'
  const coups = new Map() // clé → [horodatages]
  const recents = (cle) => {
    const maintenant = Date.now()
    const liste = (coups.get(cle) || []).filter((t) => maintenant - t < fenetreMs)
    if (liste.length) coups.set(cle, liste)
    else coups.delete(cle)
    return liste
  }
  return {
    estLimite: (cle) => actif && recents(cle).length >= max,
    compter: (cle) => {
      if (!actif) return
      const liste = recents(cle)
      liste.push(Date.now())
      coups.delete(cle)
      coups.set(cle, liste)
      // Mémoire bornée : on oublie les clés les moins récentes.
      while (coups.size > MAX_CLES) coups.delete(coups.keys().next().value)
    },
  }
}

const HEURE_MS = 60 * 60 * 1000
const QUINZE_MINUTES_MS = 15 * 60 * 1000

const creationsParHeure = Number(process.env.CHAIN_CREATE_PER_HOUR)
const creations = creerLimiteur(Number.isInteger(creationsParHeure) && creationsParHeure > 0 ? creationsParHeure : 5, HEURE_MS)
const preuves = creerLimiteur(10, QUINZE_MINUTES_MS)

/**
 * Clé d'une adresse pour les limites par IP. Une adresse IPv6 compte pour son
 * /64 : un seul abonné en a souvent des milliards.
 */
function cleIp(ip) {
  const adresse = String(ip || '').split('%')[0]
  // IPv4, ou IPv4 dans IPv6 (::ffff:198.51.100.7).
  if (!adresse.includes(':') || adresse.includes('.')) return adresse
  const [gauche, droite] = adresse.split('::')
  const debut = gauche ? gauche.split(':') : []
  const fin = droite ? droite.split(':') : []
  const groupes = droite === undefined ? debut : [...debut, ...Array(8 - debut.length - fin.length).fill('0'), ...fin]
  return `${groupes.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`
}

/** Clé du limiteur de preuves : le couple (IP, chaîne). */
function clePreuve(ip, chainId) {
  return `${cleIp(ip)}|${chainId}`
}

module.exports = { creations, preuves, cleIp, clePreuve }
