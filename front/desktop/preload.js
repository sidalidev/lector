const { contextBridge, ipcRenderer, webUtils } = require('electron');

// Bac à sable : pas de module Node ici, le dossier personnel vient du processus principal.
const HOME = (process.argv.find((a) => a.startsWith('--lector-home=')) || '').slice('--lector-home='.length);

// Chemins des fichiers que l'utilisateur a réellement déposés (un script de la
// page ne peut pas fabriquer un File qui pointe sur le disque) : seuls ceux-là
// s'ouvrent par glisser-déposer, ce qui rend leur dossier accessible.
const deposes = new Set();

contextBridge.exposeInMainWorld('electron', {
  getHomePath: () => HOME,
  openFileDialog: () => ipcRenderer.invoke('open-file-dialog'),
  openFolderDialog: () => ipcRenderer.invoke('open-folder-dialog'),
  setRootDir: (dirPath) => ipcRenderer.invoke('set-root-dir', dirPath),
  readLocalFile: (relativePath, basePath) => ipcRenderer.invoke('read-local-file', relativePath, basePath),
  resolveLocalHtml: (relativePath, basePath) => ipcRenderer.invoke('resolve-local-html', relativePath, basePath),
  openLocalMdFile: (relativePath, basePath) => ipcRenderer.invoke('open-local-md-file', relativePath, basePath),
  openDroppedFile: (filePath) => (deposes.has(filePath) ? ipcRenderer.invoke('open-dropped-file', filePath) : Promise.resolve(false)),
  getPathForFile: (file) => {
    const chemin = webUtils.getPathForFile(file);
    if (chemin) deposes.add(chemin);
    return chemin;
  },
  listDirectoryFiles: (dirPath) => ipcRenderer.invoke('list-directory-files', dirPath),
  searchAllFiles: (dirPath, query) => ipcRenderer.invoke('search-all-files', dirPath, query),
  openFileByPath: (filePath) => ipcRenderer.invoke('open-file-by-path', filePath),
  exportPdf: (fileName) => ipcRenderer.invoke('export-pdf', fileName),
  readFileSilent: (filePath) => ipcRenderer.invoke('read-file-silent', filePath),
  saveFile: (filePath, content) => ipcRenderer.invoke('save-file', filePath, content),
  onFileOpened: (callback) => {
    ipcRenderer.on('file-opened', (event, data) => callback(data));
  },
  onRootDirSet: (callback) => {
    ipcRenderer.on('set-root-dir', (event, dirPath) => callback(dirPath));
  },
  onDirChanged: (callback) => {
    const handler = (event, dirPath) => callback(dirPath);
    ipcRenderer.on('dir-changed', handler);
    return handler;
  },
  removeDirChangedListener: (handler) => {
    if (handler) ipcRenderer.removeListener('dir-changed', handler);
  },
  onFileChanged: (callback) => {
    ipcRenderer.on('file-changed', (event, data) => callback(data));
  },
  // Sync (.lector/) operations
  createSyncDir: (basePath) => ipcRenderer.invoke('create-sync-dir', basePath),
  readSyncFile: (fullPath) => ipcRenderer.invoke('read-sync-file', fullPath),
  writeSyncFile: (fullPath, content) => ipcRenderer.invoke('write-sync-file', fullPath, content),
  listSyncFiles: (dirPath) => ipcRenderer.invoke('list-sync-files', dirPath),
  onSyncDirChanged: (callback) => {
    ipcRenderer.on('sync-dir-changed', () => callback());
  },
  onUpdateReady: (callback) => {
    ipcRenderer.on('update-ready', (event, version) => callback(version));
  },
  onMenuShortcut: (callback) => {
    const handler = (_event, name) => callback(name);
    ipcRenderer.on('menu-shortcut', handler);
    return () => ipcRenderer.removeListener('menu-shortcut', handler);
  },
  installUpdate: () => ipcRenderer.invoke('install-update'),

  // --- Tâches et rappels : notes qui contiennent des cases, notifications locales ---
  taches: {
    collecter: (racine) => ipcRenderer.invoke('taches:collecter', racine),
  },
  rappels: {
    programmer: (liste) => ipcRenderer.invoke('rappels:programmer', liste),
    enAttente: () => ipcRenderer.invoke('rappels:en-attente'),
    onOuvrir: (callback) => {
      const handler = (_event, cible) => callback(cible);
      ipcRenderer.on('rappels:ouvrir', handler);
      return () => ipcRenderer.removeListener('rappels:ouvrir', handler);
    },
  },

  // --- Premier lancement : le dossier des notes (Documents/Lector Vault) ---
  vault: {
    suggest: () => ipcRenderer.invoke('vault:suggest'),
    create: () => ipcRenderer.invoke('vault:create'),
    choose: () => ipcRenderer.invoke('vault:choose'),
  },

  // --- Lector Vault : synchro par la chaîne (aucun compte) ---
  // S ne traverse jamais ce pont : le renderer ne voit que hasChain, et les 12
  // mots ou le code seulement pour les afficher (docs/CHAINE.md § 10).
  cloud: {
    status: () => ipcRenderer.invoke('cloud:status'),
    selectVault: () => ipcRenderer.invoke('cloud:select-vault'),
    startSync: () => ipcRenderer.invoke('cloud:start-sync'),
    stopSync: () => ipcRenderer.invoke('cloud:stop-sync'),
    authStatus: () => ipcRenderer.invoke('cloud:auth-status'),
    authTouchId: () => ipcRenderer.invoke('cloud:auth-touchid'),
    authConfirm: () => ipcRenderer.invoke('cloud:auth-confirm'),
    lock: () => ipcRenderer.invoke('cloud:lock'),
    chainState: () => ipcRenderer.invoke('cloud:chain-state'),
    chainPrepare: () => ipcRenderer.invoke('cloud:chain-prepare'),
    chainCreate: () => ipcRenderer.invoke('cloud:chain-create'),
    chainJoin: (saisie) => ipcRenderer.invoke('cloud:chain-join', saisie),
    chainSaved: () => ipcRenderer.invoke('cloud:chain-saved'),
    chainExport: () => ipcRenderer.invoke('cloud:chain-export'),
    chainVerify: () => ipcRenderer.invoke('cloud:chain-verify'),
    chainRotate: () => ipcRenderer.invoke('cloud:chain-rotate'),
    chainAbandon: () => ipcRenderer.invoke('cloud:chain-abandon'),
    chainErase: (confirmation, options) => ipcRenderer.invoke('cloud:chain-erase', confirmation, { localFolder: options?.localFolder === true }),
    chainLeave: () => ipcRenderer.invoke('cloud:chain-leave'),
    onEvent: (callback) => {
      const handler = (_event, evt) => callback(evt);
      ipcRenderer.on('cloud:event', handler);
      return () => ipcRenderer.removeListener('cloud:event', handler);
    },
  },
});
