const { Router } = require('express')
const crypto = require('crypto')

const router = Router()

// All connected SSE clients (each is an Express response).
const clients = new Set()

// GET /v1/releases/stream: SSE feed of release events.
// Public (no auth): the only thing pushed is "a new version is live", which is
// already discoverable from /releases/latest-*.yml.
router.get('/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',  // disable proxy buffering
  })
  res.flushHeaders?.()
  // Public endpoint: without a cap, opening connections in a loop would
  // exhaust the process file descriptors.
  if (clients.size >= 500) {
    res.write(`: server busy\n\n`)
    return res.end()
  }
  res.write(`: connected ${new Date().toISOString()}\n\n`)
  clients.add(res)

  // Heartbeat every 25s to keep proxies happy
  const beat = setInterval(() => {
    try { res.write(`: ping\n\n`) } catch {}
  }, 25_000)

  req.on('close', () => {
    clearInterval(beat)
    clients.delete(res)
  })
})

// POST /v1/releases/notify: called by hand after a desktop release.
// Body: { version, platform?, channel? }
// Broadcasts a "release" event to all connected SSE clients.
router.post('/notify', (req, res) => {
  const auth = req.headers['authorization'] || ''
  const m = /^Bearer\s+(.+)$/i.exec(auth)
  const token = m ? m[1] : null
  const expected = process.env.RELEASE_NOTIFY_TOKEN
  if (!expected) {
    return res.status(503).json({ error: 'RELEASE_NOTIFY_TOKEN not configured on server' })
  }
  const tokenBuf = Buffer.from(token || '')
  const expectedBuf = Buffer.from(expected)
  const match = tokenBuf.length === expectedBuf.length &&
    crypto.timingSafeEqual(tokenBuf, expectedBuf)
  if (!match) {
    return res.status(401).json({ error: 'Invalid token' })
  }

  const payload = {
    version: req.body?.version || 'unknown',
    platform: req.body?.platform || 'all',
    channel: req.body?.channel || 'stable',
    at: new Date().toISOString(),
  }
  const data = `event: release\ndata: ${JSON.stringify(payload)}\n\n`

  let n = 0
  for (const client of clients) {
    try { client.write(data); n++ } catch {}
  }
  return res.json({ ok: true, broadcastTo: n, payload })
})

module.exports = router
