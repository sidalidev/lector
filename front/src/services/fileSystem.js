/**
 * Service de fichiers unifié pour Lector
 * Détecte automatiquement la plateforme (Electron ou Capacitor/iOS)
 * et utilise le backend approprié
 */

// Import dynamique pour éviter les erreurs sur Electron
let Capacitor = null;
let iCloudService = null;
let FilePickerPlugin = null;

// Initialisation lazy pour Capacitor
async function initCapacitor() {
  if (Capacitor === null) {
    try {
      const cap = await import('@capacitor/core');
      Capacitor = cap.Capacitor;
      const icloud = await import('./icloud');
      iCloudService = icloud.iCloudService;
      FilePickerPlugin = cap.registerPlugin('FilePicker');
    } catch (err) {
      Capacitor = { isNativePlatform: () => false };
    }
  }
  return { Capacitor, iCloudService, FilePickerPlugin };
}

class FileSystemService {
  constructor() {
    this.platform = null;
    this.platformPromise = this.detectPlatform();
    this.listeners = {
      fileOpened: new Set(),
      rootDirSet: new Set(),
      fileChanged: new Set(),
    };
  }

  async detectPlatform() {
    if (typeof window !== 'undefined' && window.electron) {
      this.platform = 'electron';
      return 'electron';
    }

    const { Capacitor: Cap } = await initCapacitor();

    if (Cap && Cap.isNativePlatform()) {
      this.platform = 'capacitor';
      return 'capacitor';
    }

    this.platform = 'web';
    return 'web';
  }

  // Synchronous check (after init)
  getPlatform() {
    return this.platform;
  }

  /** 'electron', 'ios', 'android' ou 'web'. */
  async getPlatformType() {
    await this.ensurePlatform();
    if (this.isElectron()) return 'electron';
    if (this.isCapacitor()) {
      const { Capacitor: Cap } = await initCapacitor();
      return Cap?.getPlatform?.() || 'web';
    }
    return 'web';
  }

  isElectron() {
    // Quick sync check for Electron
    if (this.platform === null) {
      return typeof window !== 'undefined' && !!window.electron;
    }
    return this.platform === 'electron';
  }

  isCapacitor() {
    // Quick sync check même si la platform n'est pas encore résolue
    if (this.platform === null) {
      return typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()
    }
    return this.platform === 'capacitor';
  }

  async ensurePlatform() {
    if (this.platform === null) {
      await this.platformPromise;
    }
  }

  // ========== Event Listeners ==========

  onFileOpened(callback) {
    if (this.isElectron() && window.electron?.onFileOpened) {
      window.electron.onFileOpened(callback);
    }
    this.listeners.fileOpened.add(callback);
    return () => this.listeners.fileOpened.delete(callback);
  }

  onRootDirSet(callback) {
    if (this.isElectron() && window.electron?.onRootDirSet) {
      window.electron.onRootDirSet(callback);
    }
    this.listeners.rootDirSet.add(callback);
    return () => this.listeners.rootDirSet.delete(callback);
  }

  onFileChanged(callback) {
    if (this.isElectron() && window.electron?.onFileChanged) {
      window.electron.onFileChanged(callback);
    }
    this.listeners.fileChanged.add(callback);
    return () => this.listeners.fileChanged.delete(callback);
  }

  _emit(event, data) {
    this.listeners[event]?.forEach(cb => cb(data));
  }

  // ========== File Operations ==========

  async isAvailable() {
    await this.ensurePlatform();
    if (this.isElectron()) {
      return true;
    }
    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return await iCloud.isAvailable();
    }
    return false;
  }

  async openFileDialog() {
    await this.ensurePlatform();
    if (this.isElectron()) {
      return window.electron.openFileDialog();
    }
    if (this.isCapacitor()) {
      const { FilePickerPlugin: picker } = await initCapacitor();
      if (!picker) return null;
      try {
        const result = await picker.pickFile();
        if (result.cancelled) return null;
        // Emit fileOpened event so App.jsx receives it
        this._emit('fileOpened', result);
        return result;
      } catch (err) {
        console.error('openFileDialog error:', err);
        return null;
      }
    }
  }

  async openFolderDialog() {
    await this.ensurePlatform();
    if (this.isElectron()) {
      return window.electron.openFolderDialog();
    }
    if (this.isCapacitor()) {
      // Android : SAF folder picker via FilePickerPlugin
      const { FilePickerPlugin: picker, iCloudService: iCloud } = await initCapacitor();
      if (picker) {
        try {
          const result = await picker.pickFolder();
          if (result.cancelled) return null;
          // result.path = content:// URI du dossier
          this._emit('rootDirSet', result.path);
          return { success: true, path: result.path };
        } catch (err) {
          console.error('openFolderDialog Android error:', err);
          // Fallback iOS : iCloud
        }
      }
      // iOS avec iCloud
      const available = await iCloud.isAvailable();
      if (available) {
        this._emit('rootDirSet', 'icloud://');
        return { success: true, path: 'icloud://' };
      }
    }
  }

  async openFileByPath(filePath) {
    await this.ensurePlatform();
    // Vault du navigateur (dossier privé ou dossier du disque choisi)
    if (filePath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      try {
        const content = await bv.lire(filePath);
        const fileName = filePath.split('/').pop();
        const lower = fileName.toLowerCase();
        const data = {
          content,
          fileName,
          filePath,
          dirPath: bv.parent(filePath),
          type: lower.endsWith('.md') || lower.endsWith('.markdown') ? 'markdown' : 'text',
        };
        this._emit('fileOpened', data);
        return data;
      } catch (err) {
        console.error('openFileByPath browser error:', err);
        return null;
      }
    }
    // Lector Vault (navigateur) : le bloc est téléchargé puis déchiffré ici.
    if (filePath?.startsWith('cloud://')) {
      const relPath = filePath.replace('cloud://', '');
      const chaine = await import('./chaineWeb');
      try {
        const vault = await chaine.vaultWebChaine();
        const content = await vault.lireTexte(relPath);
        const fileName = relPath.split('/').pop();
        const lower = fileName.toLowerCase();
        const type = lower.endsWith('.md') || lower.endsWith('.markdown') ? 'markdown' : 'text';
        const data = {
          content,
          fileName,
          filePath,
          dirPath: 'cloud://',
          type,
        };
        this._emit('fileOpened', data);
        return data;
      } catch (err) {
        await chaine.traiterErreurChaine(err);
        console.error('openFileByPath cloud error:', err);
        return null;
      }
    }
    if (this.isElectron()) {
      return window.electron.openFileByPath(filePath);
    }
    if (this.isCapacitor()) {
      try {
        // Android SAF : content:// URIs
        if (filePath?.startsWith('content://')) {
          const { FilePickerPlugin: picker } = await initCapacitor();
          if (picker) {
            const result = await picker.readFile({ uri: filePath });
            // Extraire le nom du fichier depuis l'URI
            const segments = filePath.split('%2F');
            const rawName = segments[segments.length - 1] || 'document';
            const fileName = decodeURIComponent(rawName);
            const data = {
              content: result.content,
              fileName,
              filePath,
              dirPath: '',
              type: result.type || (fileName.toLowerCase().endsWith('.md') ? 'markdown' : 'text'),
            };
            this._emit('fileOpened', data);
            return data;
          }
        }

        // iOS iCloud
        const { iCloudService: iCloud } = await initCapacitor();
        const fileName = filePath.split('/').pop();
        const lowerName = fileName.toLowerCase();

        const type = /\.(md|markdown)$/.test(lowerName) ? 'markdown' : 'text';
        const content = await iCloud.readFile(filePath);

        const data = {
          content,
          fileName,
          filePath,
          dirPath: filePath.substring(0, filePath.lastIndexOf('/')),
          type,
        };
        this._emit('fileOpened', data);
        return data;
      } catch (error) {
        console.error('Error opening file:', error);
        throw error;
      }
    }
  }

  async openLocalMdFile(relativePath, basePath) {
    if (this.isElectron()) {
      return window.electron.openLocalMdFile(relativePath, basePath);
    }
    if (this.isCapacitor()) {
      // Résoudre le chemin relatif
      const fullPath = this._resolvePath(basePath, relativePath);
      return this.openFileByPath(fullPath);
    }
  }

  async listDirectoryFiles(dirPath) {
    await this.ensurePlatform();
    if (dirPath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      try { return await bv.lister(dirPath); } catch (err) {
        console.error('listDirectoryFiles browser error:', err);
        return [];
      }
    }
    // Lector Vault (navigateur) : l'arbre vient du déchiffrement des chemins
    // du casier (le serveur ne les connaît pas).
    if (dirPath === 'cloud://' || dirPath?.startsWith('cloud://')) {
      const chaine = await import('./chaineWeb');
      try {
        const vault = await chaine.vaultWebChaine();
        return chaine.construireArbre(await vault.lister());
      } catch (err) {
        if (!(await chaine.traiterErreurChaine(err))) console.error('listDirectoryFiles cloud error:', err);
        return [];
      }
    }
    if (this.isElectron()) {
      return window.electron.listDirectoryFiles(dirPath);
    }
    if (this.isCapacitor()) {
      // Android SAF : content:// URIs
      if (dirPath?.startsWith('content://')) {
        const { FilePickerPlugin: picker } = await initCapacitor();
        if (picker) {
          try {
            const result = await picker.listFiles({ uri: dirPath });
            // result.files peut être un array natif ou une string JSON
            const files = result.files
            if (Array.isArray(files)) return files
            if (typeof files === 'string') return JSON.parse(files)
            return []
          } catch (err) {
            console.error('listDirectoryFiles SAF error:', err);
            return [];
          }
        }
      }
      // iOS iCloud
      const { iCloudService: iCloud } = await initCapacitor();
      const path = dirPath === 'icloud://' ? '' : dirPath;
      const tree = await iCloud.getFileTree(path);
      return tree;
    }
    return [];
  }

  async getFileTree(dirPath = '') {
    await this.ensurePlatform();
    if (this.isElectron()) {
      // Electron n'a pas cette méthode, on utilise listDirectoryFiles récursivement
      return this._buildTreeElectron(dirPath);
    }
    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.getFileTree(dirPath);
    }
    return [];
  }

  async _buildTreeElectron(dirPath) {
    const files = await window.electron.listDirectoryFiles(dirPath);
    const tree = [];
    for (const file of files) {
      if (file.isDirectory) {
        const children = await this._buildTreeElectron(file.path);
        tree.push({ ...file, children });
      } else if (file.name.endsWith('.md')) {
        tree.push(file);
      }
    }
    return tree;
  }

  async readFile(filePath) {
    await this.ensurePlatform();
    if (filePath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      try { return await bv.lire(filePath); } catch { return null; }
    }
    // Lector Vault (navigateur) : recherche, ouverture rapide et contexte du chat
    // lisent le texte déchiffré (mis en cache pour la session).
    if (filePath?.startsWith('cloud://')) {
      const chaine = await import('./chaineWeb');
      try {
        const vault = await chaine.vaultWebChaine();
        return await vault.lireTexte(filePath.replace('cloud://', ''));
      } catch (err) {
        await chaine.traiterErreurChaine(err);
        return null;
      }
    }
    if (this.isElectron()) {
      const result = await window.electron.openFileByPath(filePath);
      return result?.content;
    }
    if (this.isCapacitor()) {
      // Android SAF : content:// URIs
      if (filePath?.startsWith('content://')) {
        const { FilePickerPlugin: picker } = await initCapacitor();
        if (picker) {
          try {
            const result = await picker.readFile({ uri: filePath });
            return result?.content;
          } catch (err) {
            console.error('readFile SAF error:', err);
            return null;
          }
        }
      }
      // iOS iCloud
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.readFile(filePath);
    }
  }

  async writeFile(filePath, content) {
    await this.ensurePlatform();
    if (filePath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      return bv.ecrire(filePath, content);
    }
    // Lector Vault (navigateur) : chiffré ici, déposé avec If-Match (412 si
    // modifié ailleurs). Markdown seulement : un autre type est refusé
    // (ErreurChaine 400 NOT_MARKDOWN), comme un document trop gros (413).
    if (filePath?.startsWith('cloud://')) {
      const chaine = await import('./chaineWeb');
      try {
        const vault = await chaine.vaultWebChaine();
        return await vault.ecrire(filePath.replace('cloud://', ''), content);
      } catch (err) {
        await chaine.traiterErreurChaine(err);
        console.error('writeFile cloud error:', err);
        throw err;
      }
    }
    if (this.isElectron()) {
      return window.electron.saveFile?.(filePath, content);
    }
    if (this.isCapacitor()) {
      // Android SAF : content:// URIs
      if (filePath?.startsWith('content://')) {
        const { FilePickerPlugin: picker } = await initCapacitor();
        if (picker) {
          try {
            return await picker.writeFile({ uri: filePath, content });
          } catch (err) {
            console.error('writeFile SAF error:', err);
            return null;
          }
        }
      }
      // iOS iCloud
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.writeFile(filePath, content);
    }
  }

  // Créer un nouveau fichier dans un dossier SAF (Android) ou iCloud (iOS)
  async createNewFile(dirPath, fileName, content = '') {
    await this.ensurePlatform()
    if (dirPath?.startsWith('browser://')) {
      const bv = await import('./browserVault')
      const uri = dirPath.endsWith('://') ? `${dirPath}${fileName}` : `${dirPath}/${fileName}`
      await bv.ecrire(uri, content)
      return { uri, fileName, success: true }
    }
    if (this.isElectron()) {
      const filePath = `${dirPath}/${fileName}`
      await window.electron.saveFile?.(filePath, content)
      return { uri: filePath, fileName, success: true }
    }
    if (this.isCapacitor()) {
      // Android SAF
      if (dirPath?.startsWith('content://')) {
        const { FilePickerPlugin: picker } = await initCapacitor()
        if (picker) {
          try {
            return await picker.createFile({ parentUri: dirPath, fileName, content })
          } catch (err) {
            console.error('createNewFile SAF error:', err)
            return null
          }
        }
      }
      // iOS iCloud
      const { iCloudService: iCloud } = await initCapacitor()
      const filePath = dirPath === 'icloud://' ? fileName : `${dirPath}/${fileName}`
      await iCloud.writeFile(filePath, content)
      return { uri: filePath, fileName, success: true }
    }
    return null
  }

  async deleteFile(filePath) {
    await this.ensurePlatform();
    if (filePath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      return bv.supprimer(filePath);
    }
    if (this.isElectron()) {
      return window.electron.deleteFile?.(filePath);
    }
    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.deleteFile(filePath);
    }
  }

  async createFolder(folderPath) {
    await this.ensurePlatform();
    if (folderPath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      return bv.creerDossier(folderPath);
    }
    if (this.isElectron()) {
      return window.electron.createFolder?.(folderPath);
    }
    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.createFolder(folderPath);
    }
  }

  /**
   * Read a local media file (image/video) relative to a base path.
   * Returns a data URI string (data:mime;base64,...) or null.
   */
  /**
   * Resolve a local HTML file to a lector-local:// URL for iframe embedding.
   * Returns a URL string or null.
   */
  async resolveLocalHtml(relativePath, basePath) {
    await this.ensurePlatform();
    if (this.isElectron()) {
      return window.electron.resolveLocalHtml(relativePath, basePath);
    }
    return null;
  }

  async readLocalMedia(relativePath, basePath) {
    await this.ensurePlatform();
    // Lector Vault (navigateur) : seuls les fichiers markdown voyagent entre
    // appareils, les médias relatifs ne sont jamais disponibles ici.
    if (basePath?.startsWith('cloud://') || basePath?.startsWith('browser://')) return null;
    if (this.isElectron()) {
      return window.electron.readLocalFile(relativePath, basePath);
    }
    if (this.isCapacitor()) {
      try {
        const { iCloudService: iCloud } = await initCapacitor();
        // basePath on Capacitor is a relative iCloud path like "Apprentissage"
        const fullPath = this._resolvePath(basePath, relativePath);
        return await iCloud.readFileBase64(fullPath);
      } catch (err) {
        console.warn('[FileSystem] readLocalMedia failed:', relativePath, err);
        return null;
      }
    }
    return null;
  }

  // ========== Sync Operations (.lector/ directory) ==========

  /**
   * Get the base path for the .lector sync directory.
   * On Electron: iCloud container / Documents / .lector /
   * On Capacitor: .lector/ relative to iCloud root
   */
  _getSyncBasePath() {
    if (this.isElectron()) {
      const homePath = window.electron?.getHomePath();
      if (homePath) {
        return `${homePath}/Library/Mobile Documents/iCloud~com~lector~app/Documents/.lector`;
      }
      return null;
    }
    if (this.isCapacitor()) {
      return '.lector';
    }
    return null;
  }

  /**
   * Ensure the .lector sync directory (and documents/ sub-directory) exist.
   */
  async createSyncDir() {
    await this.ensurePlatform();

    if (this.isElectron()) {
      const basePath = this._getSyncBasePath();
      if (basePath) {
        await window.electron.createSyncDir(basePath);
      }
      return;
    }

    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      try {
        await iCloud.createFolder('.lector');
        await iCloud.createFolder('.lector/documents');
      } catch (err) {
        // Might already exist
      }
    }
  }

  /**
   * Read a file from the .lector sync directory.
   * @param {string} relativePath - Path relative to .lector/ (e.g., 'global.json' or 'documents/abc123.json')
   */
  async readSyncFile(relativePath) {
    await this.ensurePlatform();

    if (this.isElectron()) {
      const basePath = this._getSyncBasePath();
      if (!basePath) return null;
      return window.electron.readSyncFile(`${basePath}/${relativePath}`);
    }

    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.readFile(`.lector/${relativePath}`);
    }

    return null;
  }

  /**
   * Write a file to the .lector sync directory.
   * @param {string} relativePath - Path relative to .lector/
   * @param {string} content - JSON string to write
   */
  async writeSyncFile(relativePath, content) {
    await this.ensurePlatform();

    if (this.isElectron()) {
      const basePath = this._getSyncBasePath();
      if (!basePath) return;
      return window.electron.writeSyncFile(`${basePath}/${relativePath}`, content);
    }

    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      return iCloud.writeFile(`.lector/${relativePath}`, content);
    }
  }

  /**
   * List files in a .lector sync sub-directory.
   * @param {string} relativePath - Path relative to .lector/ (e.g., 'documents')
   */
  async listSyncFiles(relativePath) {
    await this.ensurePlatform();

    if (this.isElectron()) {
      const basePath = this._getSyncBasePath();
      if (!basePath) return [];
      return window.electron.listSyncFiles(`${basePath}/${relativePath}`);
    }

    if (this.isCapacitor()) {
      const { iCloudService: iCloud } = await initCapacitor();
      try {
        return iCloud.listFiles(`.lector/${relativePath}`);
      } catch {
        return [];
      }
    }

    return [];
  }

  // ========== Utility ==========

  _resolvePath(basePath, relativePath) {
    // Gérer les chemins relatifs (../folder/file.md)
    if (relativePath.startsWith('/')) {
      return relativePath;
    }

    const baseParts = basePath.split('/').filter(Boolean);
    const relativeParts = relativePath.split('/');

    for (const part of relativeParts) {
      if (part === '..') {
        baseParts.pop();
      } else if (part !== '.') {
        baseParts.push(part);
      }
    }

    return baseParts.join('/');
  }

  getPathForFile(file) {
    if (this.isElectron()) {
      return window.electron.getPathForFile?.(file);
    }
    return null;
  }

  async openDroppedFile(filePath) {
    if (this.isElectron()) {
      return window.electron.openDroppedFile(filePath);
    }
    return this.openFileByPath(filePath);
  }
}

export const fileSystem = new FileSystemService();

/** 'electron', 'ios', 'android' ou 'web'. */
export const getPlatformType = () => fileSystem.getPlatformType();

export default fileSystem;
