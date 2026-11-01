// Surveille le vault et appelle onChange (avec un délai d'apaisement) quand un
// fichier suivi change ; l'appelant lance alors une synchro. Les dossiers et
// fichiers cachés (.lector-sync, .git...), node_modules et les .tmp sont ignorés.

const path = require('path')
const chokidar = require('chokidar')

/**
 * @param {string} vaultRoot
 * @param {object} o
 * @param {() => void} o.onChange
 * @param {(kind: string, relPath: string) => void} [o.log]
 * @param {(relPath: string) => boolean} [o.filtre]  fichiers dont le changement déclenche une synchro
 * @param {number} [o.debounceMs]
 */
function watch(vaultRoot, { onChange, log, filtre = () => true, debounceMs = 2000 }) {
  const watcher = chokidar.watch(vaultRoot, {
    ignored: (p) => {
      const rel = path.relative(vaultRoot, p)
      if (!rel || rel.startsWith('..')) return false
      const segments = rel.split(path.sep)
      if (segments.some((s) => s.startsWith('.') || s === 'node_modules')) return true
      return p.endsWith('.tmp')
    },
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  let timer = null
  const triggerSync = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; onChange() }, debounceMs)
  }
  const surFichier = (kind) => (p) => {
    const rel = path.relative(vaultRoot, p).split(path.sep).join('/')
    if (!filtre(rel)) return
    log && log(kind, rel)
    triggerSync()
  }

  watcher.on('add', surFichier('add'))
  watcher.on('change', surFichier('change'))
  watcher.on('unlink', surFichier('unlink'))
  watcher.on('error', (err) => { log && log('error', String(err)) })

  return {
    // Une synchro en attente ne part plus après l'arrêt.
    close: () => {
      if (timer) { clearTimeout(timer); timer = null }
      return watcher.close()
    },
    flush: () => { if (timer) { clearTimeout(timer); timer = null; onChange() } },
  }
}

module.exports = { watch }
