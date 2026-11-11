// Icône Lector sur le dossier synchronisé (comme Proton Drive), posée par le
// Finder lui-même : NSWorkspace setIcon:forFile:options: par osascript (JXA),
// sans dépendance. macOS range l'icône dans un fichier caché « Icon\r » du
// dossier : aucune note n'est touchée, et la synchro ne transporte que le
// markdown. Une icône personnalisée posée par quelqu'un d'autre est gardée.

const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

// Dans l'app installée, l'image est hors de l'archive asar (asarUnpack du
// package.json) : osascript ne lit pas dans une archive.
const ICONE = path.join(__dirname, '../public/icon-512.png').replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`)

const SCRIPT = `function run(argv) {
  ObjC.import('AppKit')
  const image = $.NSImage.alloc.initWithContentsOfFile(argv[0])
  if (!image || image.isNil()) return 'no-image'
  return $.NSWorkspace.sharedWorkspace.setIconForFileOptions(image, argv[1], 0) ? 'ok' : 'refused'
}`

/** Vrai si le dossier a déjà une icône personnalisée (fichier caché « Icon\r »). */
function aUneIconePerso(dossier) {
  return fs.existsSync(path.join(dossier, 'Icon\r'))
}

/**
 * Pose l'icône Lector sur `dossier`. `dejaPosee` : le Mac l'y a déjà mise.
 * Rend 'posee', 'deja', 'autre' (icône de quelqu'un d'autre, gardée) ou
 * 'indisponible' (hors macOS, dossier absent, refus du système).
 */
function poserIcone(dossier, { dejaPosee = false, icone = ICONE } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'darwin' || !dossier || !fs.existsSync(dossier)) return resolve('indisponible')
    if (aUneIconePerso(dossier)) return resolve(dejaPosee ? 'deja' : 'autre')
    execFile('osascript', ['-l', 'JavaScript', '-e', SCRIPT, icone, dossier], { timeout: 15000 }, (err, sortie) => {
      resolve(!err && String(sortie).trim() === 'ok' ? 'posee' : 'indisponible')
    })
  })
}

module.exports = { poserIcone, aUneIconePerso, ICONE }
