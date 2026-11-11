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

    // Navigateur : rien de natif n'est importé (@capacitor/core, iCloud). Le
    // pont natif de Capacitor pose window.Capacitor avant le code de l'app.
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.()) {
      const { Capacitor: Cap } = await initCapacitor();
      if (Cap && Cap.isNativePlatform()) {
        this.platform = 'capacitor';
        return 'capacitor';
      }
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
    // Vaults du navigateur (cloud://, browser://) : basePath est le dossier de la note.
    const schema = basePath?.match(/^(cloud|browser):\/\//)?.[0];
    if (schema) {
      const parts = basePath.slice(schema.length).split('/').filter(Boolean);
      if (relativePath.startsWith('/')) parts.length = 0;
      for (const part of relativePath.split('/')) {
        if (part === '..') parts.pop();
        else if (part && part !== '.') parts.push(part);
      }
      return this.openFileByPath(schema + parts.join('/'));
    }
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

  async writeFile(filePath, content, options = {}) {
    await this.ensurePlatform();
    if (filePath?.startsWith('browser://')) {
      const bv = await import('./browserVault');
      return bv.ecrire(filePath, content);
    }
    // Lector Vault (navigateur) : chiffré ici, déposé avec If-Match (412 si
    // modifié ailleurs ; { surConflit: 'copie' } en fait une copie de conflit).
    // Markdown seulement : un autre type est refusé (ErreurChaine 400
    // NOT_MARKDOWN) ; un document trop gros (413) reste sur l'appareil.
    if (filePath?.startsWith('cloud://')) {
      const chaine = await import('./chaineWeb');
      try {
        const vault = await chaine.vaultWebChaine();
        return await vault.ecrire(filePath.replace('cloud://', ''), content, options);
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

  /**
   * Read a local media file (image/video) relative to a base path.
   * Returns a data URI string (data:mime;base64,...) or null.
   */
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
