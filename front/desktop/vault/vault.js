// Accès disque du vault synchronisé.
// Les fichiers restent en clair sur le disque (le chiffrement au repos est celui
// du système : FileVault, BitLocker, LUKS). Le dossier `.lector-sync/` à la
// racine garde la base de synchronisation (chaine.json).
//
// La synchro ne lit, n'écrit et ne retire jamais un fichier en passant par un
// lien symbolique, et n'écrit jamais hors du vault. Une écriture ou un retrait
// peut exiger que le fichier soit encore celui que la synchro a vu (`attendu`) :
// sinon rien n'est touché et l'erreur ECHANGED remonte.

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const META_DIR = '.lector-sync'

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Erreur avec un code que la synchro reconnaît. */
function erreur(code, message) {
  return Object.assign(new Error(message), { code })
}

function safeJoin(root, rel) {
  if (typeof rel !== 'string' || !rel.length) throw erreur('EINVALIDPATH', 'Empty path')
  if (path.isAbsolute(rel) || rel.split(/[\\/]/).some((s) => s === '..')) {
    throw erreur('EINVALIDPATH', 'Invalid path')
  }
  const full = path.resolve(root, rel)
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw erreur('EINVALIDPATH', 'Path escapes vault root')
  }
  return full
}

/** Empreinte du fichier en `full` : null s'il n'existe pas, '' si c'est autre chose qu'un fichier. */
function empreinteSurDisque(full) {
  let st
  try { st = fs.lstatSync(full) } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return null
    throw err
  }
  return st.isFile() ? sha256Hex(fs.readFileSync(full)) : ''
}

const changeSurDisque = (relPath) => erreur('ECHANGED', `File changed on disk during sync: ${relPath}`)

// Remplacement atomique tmp → fichier. Sous Windows, renommer par-dessus un
// fichier ouvert ailleurs (un éditeur, l'antivirus qui lit le .tmp tout juste
// écrit) échoue en EPERM/EBUSY/EACCES là où rename(2) réussit sous POSIX : on
// réessaie quelques fois ; en cas d'échec durable, le .tmp est retiré et
// l'erreur remonte pour que l'appelant saute ce seul fichier.
function atomicReplace(tmp, full) {
  for (let i = 0; ; i++) {
    try { fs.renameSync(tmp, full); return }
    catch (err) {
      if (i >= 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) {
        try { fs.unlinkSync(tmp) } catch {}
        throw err
      }
    }
  }
}

class Vault {
  constructor(rootPath) {
    this.root = path.resolve(rootPath)
  }

  metaDir() { return path.join(this.root, META_DIR) }

  ensure() {
    fs.mkdirSync(this.metaDir(), { recursive: true })
  }

  // Chemin absolu d'un fichier du vault. Ni lui ni aucun dossier entre la
  // racine et lui ne peut être un lien symbolique : on ne les suit jamais.
  _chemin(relPath) {
    const full = safeJoin(this.root, relPath)
    let courant = this.root
    for (const segment of path.relative(this.root, full).split(path.sep)) {
      courant = path.join(courant, segment)
      let st
      try { st = fs.lstatSync(courant) } catch (err) {
        if (err.code === 'ENOENT' || err.code === 'ENOTDIR') break
        throw err
      }
      if (st.isSymbolicLink()) throw erreur('ESYMLINK', `Symbolic link in vault path: ${relPath}`)
    }
    return full
  }

  // Parcourt le vault : [{ relPath, fullPath, size, mtime }]. Les fichiers et
  // dossiers cachés (.lector-sync, .git...) et node_modules sont ignorés, comme
  // les liens symboliques (ni fichier ni dossier pour readdir).
  walk() {
    const out = []
    const recurse = (dir, rel) => {
      let entries
      try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules') continue
        const full = path.join(dir, e.name)
        const r = rel ? `${rel}/${e.name}` : e.name
        if (e.isDirectory()) recurse(full, r)
        else if (e.isFile()) {
          const st = fs.statSync(full)
          out.push({ relPath: r, fullPath: full, size: st.size, mtime: st.mtime })
        }
      }
    }
    recurse(this.root, '')
    return out
  }

  // Manifeste en mémoire du contenu clair. `filtre(relPath)` choisit les
  // fichiers lus : les autres ne sont jamais ouverts (ni hachés), seulement
  // comptés dans this.ignores.
  scanManifest(filtre = () => true) {
    const out = {}
    this.ignores = 0
    for (const it of this.walk()) {
      if (!filtre(it.relPath)) {
        this.ignores++
        continue
      }
      const buf = fs.readFileSync(it.fullPath)
      out[it.relPath] = {
        sha256: sha256Hex(buf),
        size: buf.length,
        mtime: it.mtime.toISOString(),
      }
    }
    return out
  }

  // Écrit un fichier en clair (atomique). `attendu` : empreinte du fichier tel
  // que la synchro l'a vu, null s'il ne devait pas exister (undefined : pas de
  // contrôle). Le fichier temporaire, caché et au nom court, est créé en
  // exclusivité : un lien posé à sa place fait échouer l'écriture.
  writeClear(relPath, buffer, mtime, attendu) {
    const full = this._chemin(relPath)
    if (attendu !== undefined && empreinteSurDisque(full) !== attendu) throw changeSurDisque(relPath)
    const dossier = path.dirname(full)
    fs.mkdirSync(dossier, { recursive: true })
    const reel = fs.realpathSync(dossier)
    const racine = fs.realpathSync(this.root)
    if (reel !== racine && !reel.startsWith(racine + path.sep)) throw erreur('ESYMLINK', `Path leaves the vault: ${relPath}`)
    const tmp = path.join(dossier, `.lector-${crypto.randomBytes(6).toString('hex')}.tmp`)
    fs.writeFileSync(tmp, buffer, { flag: 'wx' })
    atomicReplace(tmp, full)
    if (mtime) {
      try {
        const t = mtime instanceof Date ? mtime : new Date(mtime)
        fs.utimesSync(full, t, t)
      } catch {} // au mieux : la synchro compare des empreintes, pas des dates
    }
  }

  readClear(relPath) {
    return fs.readFileSync(this._chemin(relPath))
  }

  // Vrai si rien n'existe à ce chemin, selon le système : sur un disque
  // insensible à la casse (macOS, Windows), « notes.md » existe quand
  // « Notes.md » est là ; un fichier derrière un lien symbolique existe aussi.
  absent(relPath) {
    try {
      fs.lstatSync(safeJoin(this.root, relPath))
      return false
    } catch (err) {
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return true
      throw err
    }
  }

  // Le vault tel que le voit la synchro (interface de synchro.js), réduit aux
  // fichiers que `filtre` accepte.
  vue(filtre) {
    return {
      scanManifest: () => this.scanManifest(filtre),
      readClear: (rel) => this.readClear(rel),
      writeClear: (rel, octets, mtime, attendu) => this.writeClear(rel, octets, mtime, attendu),
      remove: (rel, attendu) => this.remove(rel, attendu),
      absent: (rel) => this.absent(rel),
    }
  }

  // Retire un fichier, seulement s'il est encore `attendu` (undefined : pas de contrôle).
  remove(relPath, attendu) {
    const full = this._chemin(relPath)
    const actuel = empreinteSurDisque(full)
    if (actuel === null) return
    if (attendu !== undefined && actuel !== attendu) throw changeSurDisque(relPath)
    fs.unlinkSync(full)
    // Au mieux : retire les dossiers parents devenus vides, jusqu'à la racine.
    let dir = path.dirname(full)
    while (dir.startsWith(this.root + path.sep)) {
      try { fs.rmdirSync(dir) } catch { break }
      dir = path.dirname(dir)
    }
  }
}

module.exports = { Vault }
