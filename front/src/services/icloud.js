import { registerPlugin } from '@capacitor/core';

const ICloud = registerPlugin('ICloud');

/**
 * Service iCloud pour Lector
 * Gère la synchronisation des fichiers Markdown avec iCloud Drive
 */
class ICloudService {
  constructor() {
    this.available = null;
    this.listeners = new Set();
  }

  /**
   * Vérifie si iCloud est disponible
   */
  async isAvailable() {
    if (this.available !== null) return this.available;

    try {
      const result = await ICloud.isAvailable();
      this.available = result.available;
      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Liste les fichiers dans un dossier iCloud
   * @param {string} path - Chemin relatif dans le container iCloud
   */
  async listFiles(path = '') {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    const result = await ICloud.listFiles({ path });
    return result.files;
  }

  /**
   * Lit le contenu d'un fichier
   * @param {string} path - Chemin du fichier
   */
  async readFile(path) {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    const result = await ICloud.readFile({ path });
    return result.content;
  }

  /**
   * Lit un fichier binaire (image/vidéo) et retourne un data URI base64
   * Déclenche automatiquement le téléchargement iCloud si nécessaire
   * @param {string} path - Chemin du fichier
   */
  async readFileBase64(path) {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    const result = await ICloud.readFileBase64({ path });
    return result.data;
  }

  /**
   * Écrit du contenu dans un fichier
   * @param {string} path - Chemin du fichier
   * @param {string} content - Contenu à écrire
   */
  async writeFile(path, content) {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    await ICloud.writeFile({ path, content });
  }

  /**
   * Supprime un fichier ou dossier
   * @param {string} path - Chemin à supprimer
   */
  async deleteFile(path) {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    await ICloud.deleteFile({ path });
  }

  /**
   * Crée un dossier
   * @param {string} path - Chemin du dossier
   */
  async createFolder(path) {
    if (!await this.isAvailable()) {
      throw new Error('iCloud not available');
    }

    await ICloud.createFolder({ path });
  }

  /**
   * Récupère l'arborescence complète des fichiers .md
   */
  async getFileTree(path = '') {
    const files = await this.listFiles(path);
    const tree = [];

    // Dossiers à ignorer
    const ignoredDirs = ['node_modules', '.git', '.svn', 'dist', 'build', '.next', '__pycache__', '.cache', 'coverage'];

    for (const file of files) {
      if (file.isDirectory) {
        // Ignorer certains dossiers
        if (ignoredDirs.includes(file.name)) {
          continue;
        }
        const children = await this.getFileTree(file.path);
        // N'inclure le dossier que s'il contient des fichiers .md ou des sous-dossiers avec des .md
        if (children.length > 0) {
          tree.push({
            ...file,
            children
          });
        }
      } else if (file.name.endsWith('.md') || file.name.endsWith('.mid') || file.name.endsWith('.midi')) {
        tree.push(file);
      }
    }

    return tree;
  }

  /**
   * Observe les changements de fichiers
   * Note: Pour une vraie observation, il faudrait utiliser NSMetadataQuery côté natif
   */
  onFilesChanged(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notifyListeners() {
    this.listeners.forEach(cb => cb());
  }
}

export const iCloudService = new ICloudService();
export default iCloudService;
