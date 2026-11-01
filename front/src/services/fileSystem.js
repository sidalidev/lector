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
    // Mode demo : contenu embarqué, aucun compte ni fichier requis
    if (filePath?.startsWith('demo://')) {
      const { getDemoFile } = await import('./demoContent');
      const { getLocale } = await import('./i18n');
      const name = filePath.replace('demo://', '');
      const file = getDemoFile(getLocale(), name);
      const data = {
        content: file.content,
        fileName: file.name,
        filePath: `demo://${file.name}`,
        dirPath: 'demo://',
        type: 'markdown',
      };
      this._emit('fileOpened', data);
      return data;
    }
    // Mode hosted : fetch le fichier depuis le serveur
    if (filePath?.startsWith('hosted://')) {
      const parts = filePath.replace('hosted://', '').split('/')
      const hostedId = parts[0]
      const fileName = parts.slice(1).join('/')
      try {
        const res = await fetch(`/formation/${hostedId}/docs/${encodeURIComponent(fileName)}`)
        const content = await res.text()
        const data = {
          content,
          fileName,
          filePath,
          dirPath: `hosted://${hostedId}`,
          type: fileName.toLowerCase().endsWith('.md') ? 'markdown' : 'text',
        }
        this._emit('fileOpened', data)
        return data
      } catch (err) {
        console.error('openFileByPath hosted error:', err)
        return null
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

        let type = 'text';
        if (lowerName.endsWith('.md')) type = 'markdown';
        if (lowerName.endsWith('.srt')) type = 'srt';
        let content;
        content = await iCloud.readFile(filePath);

        // Convertir SRT en markdown lisible
        if (type === 'srt' && content) {
          content = this._srtToMarkdown(content, fileName);
          type = 'markdown';
        }

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
    // Mode demo : liste embarquée
    if (dirPath?.startsWith('demo://')) {
      const { getDemoFiles } = await import('./demoContent');
      const { getLocale } = await import('./i18n');
      return getDemoFiles(getLocale()).map(f => ({
        name: f.name,
        path: `demo://${f.name}`,
        isDirectory: false,
      }));
    }
    // Mode hosted : fetch le manifest
    if (dirPath?.startsWith('hosted://')) {
      const hostedId = dirPath.replace('hosted://', '')
      try {
        const res = await fetch(`/formation/${hostedId}/manifest.json`)
        const manifest = await res.json()
        return (manifest.files || []).map(f => ({
          name: f,
          path: `hosted://${hostedId}/${f}`,
          isDirectory: false,
        }))
      } catch { return [] }
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
    // Mode hosted
    if (filePath?.startsWith('hosted://')) {
      const parts = filePath.replace('hosted://', '').split('/')
      const hostedId = parts[0]
      const fileName = parts.slice(1).join('/')
      try {
        const res = await fetch(`/formation/${hostedId}/docs/${encodeURIComponent(fileName)}`)
        return await res.text()
      } catch { return null }
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
    if (basePath?.startsWith('cloud://')) return null;
    // Mode hosted : charger les médias depuis le serveur
    if (basePath && basePath.startsWith('hosted://')) {
      const hostedId = basePath.replace('hosted://', '')
      const url = `/formation/${hostedId}/docs/${encodeURIComponent(relativePath)}`
      try {
        const res = await fetch(url)
        if (!res.ok) return null
        const blob = await res.blob()
        return URL.createObjectURL(blob)
      } catch (err) {
        console.warn('[FileSystem] readLocalMedia hosted failed:', relativePath, err)
        return null
      }
    }
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

  // ========== Export Operations ==========

  async exportPdf(fileName) {
    if (this.isElectron()) {
      return window.electron.exportPdf(fileName);
    }
    window.print();
  }

  /**
   * Exporte tout un dossier en un seul document.
   * Retourne le contenu markdown concaténé de tous les .md du dossier (trié par nom).
   */
  async readFolderAsMarkdown(dirPath) {
    await this.ensurePlatform();

    if (this.isElectron()) {
      // Sur Electron, lister directement les fichiers du dossier
      const tree = await window.electron.listDirectoryFiles(dirPath);
      if (!tree || tree.length === 0) return null;

      const mdFiles = [];
      const extractMd = (items) => {
        const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
        for (const item of sorted) {
          if (!item.isDirectory && item.name.endsWith('.md')) {
            mdFiles.push({ name: item.name, path: item.path });
          }
          if (item.isDirectory && item.children) {
            extractMd(item.children);
          }
        }
      };
      extractMd(tree);

      if (mdFiles.length === 0) return null;

      const parts = [];
      for (const file of mdFiles) {
        try {
          const content = await window.electron.readFileSilent(file.path);
          if (content) {
            const cleanContent = content.replace(/\n*---\n<!-- lector-generated -->[\s\S]*<!-- \/lector-generated -->/g, '');
            parts.push(cleanContent.trim());
          }
        } catch (err) {
          console.warn(`[FileSystem] Failed to read ${file.name}:`, err.message);
        }
      }
      return parts.length > 0 ? parts.join('\n\n---\n\n') : null;
    }

    // Capacitor / web fallback
    const tree = await this.listDirectoryFiles(dirPath);
    if (!tree) return null;

    const mdFiles = [];
    const extractMd = (items, parentPath) => {
      const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
      for (const item of sorted) {
        const fullPath = parentPath ? `${parentPath}/${item.name}` : item.name;
        if (!item.isDirectory && item.name.endsWith('.md')) {
          mdFiles.push({ name: item.name, path: item.path || fullPath });
        }
        if (item.isDirectory && item.children) {
          extractMd(item.children, fullPath);
        }
      }
    };
    extractMd(tree, '');

    // Lire chaque fichier et concaténer
    const parts = [];
    for (const file of mdFiles) {
      try {
        let content;
        if (this.isElectron()) {
          content = await window.electron.readFileSilent(file.path);
        } else if (this.isCapacitor()) {
          const { iCloudService: iCloud } = await initCapacitor();
          content = await iCloud.readFile(file.path);
        }
        if (content) {
          // Retirer le bloc lector-generated pour l'export
          const cleanContent = content.replace(/\n*---\n<!-- lector-generated -->[\s\S]*<!-- \/lector-generated -->/g, '');
          parts.push(cleanContent.trim());
        }
      } catch (err) {
        console.warn(`[FileSystem] Failed to read ${file.name}:`, err.message);
      }
    }

    return parts.join('\n\n---\n\n');
  }

  async exportFileEpub(filePath, subFolder) {
    if (this.isElectron()) {
      return window.electron.exportFileEpub?.(filePath, subFolder);
    }
    console.warn('exportFileEpub not available on this platform');
  }

  // ========== SRT → Markdown ==========

  _srtToMarkdown(srtContent, fileName) {
    // Extraire le texte pur du SRT (sans timestamps ni numéros de séquence)
    const lines = srtContent.split('\n');
    const textLines = [];
    let currentParagraph = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Ignorer les numéros de séquence et les timestamps
      if (/^\d+$/.test(trimmed)) continue;
      if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) continue;
      if (!trimmed) {
        // Ligne vide = fin de sous-titre, on continue le paragraphe
        continue;
      }
      currentParagraph.push(trimmed);
    }

    // Joindre tout le texte et découper en paragraphes (~200 mots)
    const fullText = currentParagraph.join(' ').replace(/\s+/g, ' ');
    const words = fullText.split(' ');
    const paragraphs = [];
    for (let i = 0; i < words.length; i += 200) {
      paragraphs.push(words.slice(i, i + 200).join(' '));
    }

    const title = fileName.replace(/\.srt$/i, '').replace(/ - +- +\d{4}-\d{2}-\d{2}.*$/, '');

    return `# 🎬 ${title}\n\n> *Source : fichier SRT (transcription vidéo), lecture seule*\n\n---\n\n${paragraphs.join('\n\n')}`;
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
