// Limites du relais de co-écriture (docs/collab-design.md § 6).
// Chaque valeur se règle par une variable d'environnement.

const { entierEnv } = require('../chaine')

const JOUR_MS = 24 * 60 * 60 * 1000

function lireConfig(surcharges = {}) {
  return {
    // Octets chiffrés gardés par salon (journal + instantané).
    quotaOctets: entierEnv('COLLAB_ROOM_QUOTA_BYTES', 10 * 1024 * 1024),
    // Taille d'une trame WebSocket (JSON, base64url compris).
    maxTrame: entierEnv('COLLAB_MAX_FRAME_BYTES', 1024 * 1024),
    maxPersonnes: entierEnv('COLLAB_MAX_PEERS', 16),
    creationsParHeure: entierEnv('COLLAB_CREATE_PER_HOUR', 20),
    connexionsParIp: entierEnv('COLLAB_CONN_PER_IP', 32),
    maxSalons: entierEnv('COLLAB_MAX_ROOMS', 10000),
    dureeInactiviteMs: entierEnv('COLLAB_INACTIVE_DAYS', 90) * JOUR_MS,
    dureeArretesMs: 365 * JOUR_MS,
    // Trames par connexion : TRAMES_MAX par fenêtre de 10 s.
    tramesMax: entierEnv('COLLAB_FRAMES_PER_10S', 300),
    fenetreTramesMs: 10_000,
    // Premier message (hello) attendu dans ce délai.
    delaiHelloMs: 10_000,
    // Compactage demandé au-delà de ce nombre de messages depuis l'instantané…
    compacterApres: entierEnv('COLLAB_COMPACT_AFTER', 200),
    // … ou quand le journal dépasse deux fois l'instantané plus cette marge.
    margeCompactage: 64 * 1024,
    pingMs: 30_000,
    limitesActives: process.env.CHAIN_RATE_LIMITS !== 'off',
    ...surcharges,
  }
}

module.exports = { lireConfig, JOUR_MS }
