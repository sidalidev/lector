// Restauration de la session sur ordinateur (Electron) et mobile (Capacitor).
// Chargé à la demande par App.jsx, jamais dans le navigateur : le code est
// celui qui vivait dans restoreSession, déplacé tel quel.
import fileSystem from './fileSystem'
import { t } from './i18n'

const SESSION_KEY = 'lector-last-session'
const SOURCE_TYPE_KEY = 'lector-source-type'

/**
 * Ordinateur avec une chaîne : on démarre toujours sur le vault synchronisé.
 * Rend true si la session est restaurée.
 */
export async function restaurerChaineOrdinateur({ sourceChoisie, setRootDirPath, setShowSourcePicker }) {
  if (fileSystem.isElectron() && window.electron?.cloud?.status) {
    try {
      const cs = await window.electron.cloud.status();
      if (cs?.hasChain && cs?.vaultPath && !sourceChoisie.current) {
        await window.electron.setRootDir(cs.vaultPath);
        setRootDirPath(cs.vaultPath);
        setShowSourcePicker(false);
        try {
          const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
          if (session?.filePath && session.filePath.startsWith(cs.vaultPath)) {
            await fileSystem.openFileByPath(session.filePath);
          }
        } catch {}
        return true;
      }
    } catch {}
  }
  return false
}

/** Source choisie au premier lancement (iCloud, dossier Android, dossier ou fichier sur ordinateur). */
export async function restaurerSessionNative({ setRootDirPath, setShowSourcePicker }) {
  const sourceType = localStorage.getItem(SOURCE_TYPE_KEY);

  // No source type saved → show picker
  if (!sourceType) {
    setShowSourcePicker(true);
    return;
  }

  // Capacitor/iOS
  if (fileSystem.isCapacitor()) {
    if (sourceType === 'icloud') {
      const available = await fileSystem.isAvailable();
      if (!available) {
        // iCloud coupé depuis (déconnexion, réglages) → retour au picker
        // plutôt qu'un écran vide sans issue
        localStorage.removeItem(SOURCE_TYPE_KEY);
        setShowSourcePicker(true);
        return;
      }
      if (available) {
        setRootDirPath('icloud://');
        setShowSourcePicker(false);

        // Créer le document de bienvenue au premier lancement
        if (!localStorage.getItem('lector-welcome-created')) {
          try {
            const welcomePath = `icloud://${t('welcome.fileName')}.md`
            await fileSystem.writeFile(welcomePath, t('welcome.content'))
            localStorage.setItem('lector-welcome-created', '1')
            await fileSystem.openFileByPath(welcomePath)
          } catch { /* ignore: ne pas bloquer le démarrage */ }
        } else {
          try {
            const session = JSON.parse(localStorage.getItem(SESSION_KEY));
            if (session?.filePath) {
              await fileSystem.openFileByPath(session.filePath);
            }
          } catch { /* ignore */ }
        }
      }
    } else if (sourceType === 'folder') {
      // Android SAF : restaurer le rootDirPath depuis la session
      try {
        const session = JSON.parse(localStorage.getItem(SESSION_KEY))
        // Accès rendu (réglages, autre appareil restauré) : l'écran du dossier revient.
        const { accesAndroid } = await import('./vaultSetup')
        if (session?.rootDirPath?.startsWith('content://') && !(await accesAndroid(session.rootDirPath))) {
          localStorage.removeItem(SOURCE_TYPE_KEY)
          setShowSourcePicker(true)
          return
        }
        if (session?.rootDirPath) {
          setRootDirPath(session.rootDirPath)
          setShowSourcePicker(false)
          if (session?.filePath) {
            await fileSystem.openFileByPath(session.filePath)
          }
        } else {
          // Pas de session → re-picker
          localStorage.removeItem(SOURCE_TYPE_KEY)
          setShowSourcePicker(true)
        }
      } catch {
        localStorage.removeItem(SOURCE_TYPE_KEY)
        setShowSourcePicker(true)
      }
    }
    return;
  }

  // Electron
  if (fileSystem.isElectron() && window.electron) {
    if (sourceType === 'icloud') {
      // Lector Vault is the only desktop source now: drop legacy iCloud auto-open.
      localStorage.removeItem(SOURCE_TYPE_KEY);
      setShowSourcePicker(true);
      return;
    } else if (sourceType === 'folder') {
      try {
        const session = JSON.parse(localStorage.getItem(SESSION_KEY));
        // IPC sets rootDirPath via onRootDirSet listener + starts watcher.
        // Refusé si le dossier n'existe plus ou n'a jamais été ouvert par l'utilisateur : on le redemande.
        if (session?.rootDirPath && await window.electron.setRootDir(session.rootDirPath)) {
          setShowSourcePicker(false);
          if (session.filePath) {
            await fileSystem.openFileByPath(session.filePath);
          }
        } else {
          setShowSourcePicker(true);
        }
      } catch {
        setShowSourcePicker(true);
      }
    } else if (sourceType === 'file') {
      try {
        const session = JSON.parse(localStorage.getItem(SESSION_KEY));
        if (session?.filePath && await fileSystem.openFileByPath(session.filePath)) {
          setShowSourcePicker(false);
        } else {
          setShowSourcePicker(true);
        }
      } catch {
        setShowSourcePicker(true);
      }
    }
  }
}
