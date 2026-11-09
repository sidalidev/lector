const express = require('express')
const cors = require('cors')
const prisma = require('./services/prisma')
const { resumeErreur } = require('./services/chaine')
const chainRouter = require('./routes/chain')
const releasesRouter = require('./routes/releases')
const { routeSecurityTxt } = require('./routes/securityTxt')
const { demarrerPurge } = require('./services/casiers')
const { creerRelais } = require('./services/collab/relais')
const { creerStockagePrisma } = require('./services/collab/stockagePrisma')

const app = express()
const PORT = process.env.PORT || 3456

app.disable('x-powered-by')
// Un ETag n'a de sens que sur un bloc (son SHA-256), posé par la route elle-même.
app.set('etag', false)

// Derrière Traefik en prod : req.ip doit venir de X-Forwarded-For (1 saut de
// confiance), sinon toutes les requêtes partagent l'IP de Traefik et les
// limiteurs par IP deviendraient globaux.
app.set('trust proxy', 1)

// CORS ouvert : Electron (file://), Capacitor et le web appellent l'API.
// Seuls les en-têtes dont les clients ont besoin sont exposés.
app.use(cors({ exposedHeaders: ['ETag', 'X-Lector-Path-Enc', 'X-Lector-Mtime'] }))

// Chaîne : montée avant express.json(), PUT /docs/:docId lit un corps binaire.
app.use('/v1/chain', chainRouter)

app.use(express.json())
app.use('/v1/releases', releasesRouter)

app.get('/v1/health', (_req, res) => res.json({ ok: true }))
app.get('/.well-known/security.txt', routeSecurityTxt)

// Dernier filet : le gestionnaire par défaut d'Express journalise la pile, dont
// le message d'un JSON invalide cite le début du corps. Ici, rien du corps.
app.use((err, _req, res, _next) => {
  const status = err.status || err.statusCode || 500
  if (status >= 500) console.error('[api] error:', resumeErreur(err))
  res.status(status).json({ error: status >= 500 ? 'Internal error' : 'Invalid request' })
})

const serveur = app.listen(PORT, () => {
  console.log(`[Lector API] http://localhost:${PORT}`)
  demarrerPurge(prisma)
})

// Co-écriture : relais WebSocket aveugle sur /v1/collab (docs/collab-design.md).
// Même confiance dans le proxy qu'Express (trust proxy 1) pour l'IP des limites.
creerRelais({ stockage: creerStockagePrisma(prisma), confianceProxy: true }).attacher(serveur).demarrerPurge()
