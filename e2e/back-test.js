// Environnement de l'API de test (base SQLite jetable dans back/.test-data/).
// Partagé par playwright.config.js (démarrage du serveur) et par les tests qui
// inspectent la base et les fichiers. Le serveur n'appelle aucun service
// externe : aucune clé n'est nécessaire.

const path = require('path')

const BACK = path.resolve(__dirname, '..', 'back')
const DONNEES = path.join(BACK, '.test-data')
const PORT_TEST = 3457

const ENV_TEST = {
  NODE_ENV: 'test',
  PORT: String(PORT_TEST),
  DATABASE_URL: `file:${path.join(DONNEES, 'test.db')}`,
  CHAIN_FILES_ROOT: path.join(DONNEES, 'chain'),
  // Les tests créent des dizaines de casiers depuis la même IP.
  CHAIN_RATE_LIMITS: 'off',
  // Limites basses pour tester les trois 413 sans envoyer de gros corps :
  // 64 Kio de clair par document, 256 Kio par casier (trois blocs pleins),
  // 20 documents par casier.
  CHAIN_MAX_DOC_BYTES: String(64 * 1024),
  CHAIN_QUOTA_BYTES: String(256 * 1024),
  CHAIN_MAX_DOCS: '20',
  // Co-écriture : compactage rapide pour le tester sur la vraie base.
  COLLAB_COMPACT_AFTER: '20',
}

module.exports = { BACK, DONNEES, PORT_TEST, ENV_TEST }
