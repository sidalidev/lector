// Flux temps réel par chaîne (SSE). Chaque écriture est annoncée aux appareils
// de la même chaîne ; X-Lector-Device permet à l'auteur d'ignorer son écho.

const MAX_PAR_CHAINE = 20
const MAX_PAR_IP = 10
const MAX_TOTAL = 500
const PING_MS = 25_000
// Un lecteur qui laisse plus que cela en attente est coupé : sans cette borne,
// un flux jamais lu ferait grossir la mémoire du serveur à chaque écriture. Il
// se reconnecte, et la synchro suivante rattrape ce qu'il a manqué.
const TAMPON_MAX = 64 * 1024

const abonnes = new Map() // chainId → Set<res>
const parIp = new Map() // clé d'IP → flux ouverts
let total = 0

function ecrire(res, texte) {
  if (res.writableEnded || res.destroyed) return
  if (res.writableLength > TAMPON_MAX) res.destroy()
  else res.write(texte)
}

/**
 * Ouvre le flux d'une chaîne sur `res` pour la clé d'IP `ip`. Renvoie false
 * sans rien écrire si une limite de connexions est atteinte (l'appelant
 * répond alors lui-même).
 */
function ouvrir(chainId, res, ip) {
  const liste = abonnes.get(chainId) || new Set()
  const ouvertsIp = parIp.get(ip) || 0
  if (total >= MAX_TOTAL || liste.size >= MAX_PAR_CHAINE || ouvertsIp >= MAX_PAR_IP) return false
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
  res.flushHeaders?.()
  ecrire(res, ': connected\n\n')
  liste.add(res)
  abonnes.set(chainId, liste)
  parIp.set(ip, ouvertsIp + 1)
  total += 1

  const ping = setInterval(() => ecrire(res, ': ping\n\n'), PING_MS)
  res.on('close', () => {
    clearInterval(ping)
    if (liste.delete(res)) {
      total -= 1
      const reste = parIp.get(ip) - 1
      if (reste) parIp.set(ip, reste)
      else parIp.delete(ip)
    }
    if (!liste.size && abonnes.get(chainId) === liste) abonnes.delete(chainId)
  })
  return true
}

/** Annonce { kind: 'put' | 'delete', docId, actorDevice } aux appareils de la chaîne. */
function diffuser(chainId, evenement) {
  const liste = abonnes.get(chainId)
  if (!liste) return
  const message = `event: vault-change\ndata: ${JSON.stringify(evenement)}\n\n`
  for (const res of liste) ecrire(res, message)
}

/**
 * Ferme tous les flux d'une chaîne effacée : à la reconnexion, les appareils
 * reçoivent 404. Un lecteur qui n'a pas tout lu est coupé net : sa fin
 * attendrait derrière le tampon, et la connexion resterait ouverte.
 */
function fermer(chainId) {
  for (const res of abonnes.get(chainId) || []) {
    res.end()
    if (res.writableLength) res.destroy()
  }
}

module.exports = { ouvrir, diffuser, fermer }
