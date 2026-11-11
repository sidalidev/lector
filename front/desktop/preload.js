// Pont minimal entre la web app (dans la fenêtre) et la synchro du Mac.
// Bac à sable : pas de module Node. Exposé seulement à l'origine de l'app
// (passée par main.js) : une autre page, une iframe ou la page hors ligne n'y
// ont pas accès, et main.js revérifie l'origine à chaque appel.
const { contextBridge, ipcRenderer } = require('electron')

const ORIGINE = (process.argv.find((a) => a.startsWith('--lector-origine=')) || '').slice('--lector-origine='.length)

if (ORIGINE && window.location.origin === ORIGINE) {
  contextBridge.exposeInMainWorld('lectorDesktop', {
    /** Les 12 mots de la chaîne de ce Mac, une seule fois par chaîne : { ok, mots, chainId } ou { ok: false }. */
    motsDeLaChaine: () => ipcRenderer.invoke('bureau:mots'),
    /** L'interface est connectée à la chaîne de ce Mac. */
    chaineConnectee: (chainId) => ipcRenderer.invoke('bureau:connectee', chainId),
    /** L'utilisateur a créé sa clé ou s'est connecté : ce Mac garde la même chaîne (s'il n'en a pas). */
    garderChaine: (mots) => ipcRenderer.invoke('bureau:garder', mots),
  })
}
