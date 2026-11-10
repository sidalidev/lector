/**
 * Service de synchronisation iCloud pour Lector.
 * Gère l'init, push, pull, dirty tracking et migration.
 */
import fileSystem from './fileSystem';
import { mergeDocumentData, mergeGlobalData } from './syncMerge';

const SYNC_MIGRATED_KEY = 'lector-sync-migrated';
const DEVICE_ID_KEY = 'lector-device-id';
const DEBOUNCE_MS = 2000;
const POLL_INTERVAL_MS = 30000;

function generateDeviceId() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)];
  const platform = fileSystem.isElectron() ? 'desktop' : 'ios';
  return `${platform}-${id}`;
}

function hashFilePath(filePath) {
  // Garder le format hex padStart(8) pour compatibilité avec les fichiers sync existants
  let hash = 0;
  for (let i = 0; i < filePath.length; i++) {
    const ch = filePath.charCodeAt(i);
    hash = ((hash << 5) - hash) + ch;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

class SyncService {
  constructor() {
    this.enabled = false;
    this.deviceId = null;
    this.dirtyDocs = new Set();
    this.globalDirty = false;
    this._debounceTimers = new Map();
    this._globalDebounceTimer = null;
    this._pollTimer = null;
    this._listeners = new Set();
    this._initializing = false;
    this._initialized = false;
  }

  // --- Public API ---

  async initialize() {
    if (this._initialized || this._initializing) return;
    this._initializing = true;

    try {
      await fileSystem.ensurePlatform();

      // Check if iCloud / file system is available
      const available = await fileSystem.isAvailable();
      if (!available) {
        console.log('[Sync] File system not available, sync disabled');
        this._initializing = false;
        return;
      }

      // Device ID
      this.deviceId = localStorage.getItem(DEVICE_ID_KEY);
      if (!this.deviceId) {
        this.deviceId = generateDeviceId();
        localStorage.setItem(DEVICE_ID_KEY, this.deviceId);
      }

      // Ensure .lector directory exists
      await this._ensureSyncDir();

      this.enabled = true;
      this._initialized = true;

      // Migration if first time
      if (!localStorage.getItem(SYNC_MIGRATED_KEY)) {
        await this._migrate();
        localStorage.setItem(SYNC_MIGRATED_KEY, 'true');
      }

      // Initial pull
      await this.pullAll();

      // Setup polling
      this._pollTimer = setInterval(() => this.pullChanged(), POLL_INTERVAL_MS);

      // Electron: watch .lector/ directory for changes
      if (fileSystem.isElectron() && window.electron?.onSyncDirChanged) {
        window.electron.onSyncDirChanged(() => {
          this.pullChanged();
        });
      }

      console.log(`[Sync] Initialized, deviceId=${this.deviceId}`);
    } catch (err) {
      console.warn('[Sync] Init failed, sync disabled:', err.message);
      this.enabled = false;
    } finally {
      this._initializing = false;
    }
  }

  /**
   * Mark a document as dirty (needs push to iCloud).
   * Debounced: actual push happens after DEBOUNCE_MS of inactivity.
   */
  markDirty(filePath) {
    if (!this.enabled || !filePath) return;

    this.dirtyDocs.add(filePath);

    // Clear existing timer for this file
    const existing = this._debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);

    this._debounceTimers.set(filePath, setTimeout(() => {
      this._debounceTimers.delete(filePath);
      this._pushDocument(filePath);
    }, DEBOUNCE_MS));
  }

  /**
   * Mark global data as dirty (needs push to iCloud).
   */
  markGlobalDirty() {
    if (!this.enabled) return;

    this.globalDirty = true;

    if (this._globalDebounceTimer) clearTimeout(this._globalDebounceTimer);
    this._globalDebounceTimer = setTimeout(() => {
      this._globalDebounceTimer = null;
      this._pushGlobal();
    }, DEBOUNCE_MS);
  }

  /**
   * Pull all data from iCloud and merge with localStorage.
   */
  async pullAll() {
    if (!this.enabled) return;

    try {
      await this._pullGlobal();
      await this._pullAllDocuments();
      this._notifyListeners();
    } catch (err) {
      console.warn('[Sync] pullAll error:', err.message);
    }
  }

  /**
   * Pull only changed data (lighter operation for polling/focus).
   */
  async pullChanged() {
    if (!this.enabled) return;

    try {
      const globalChanged = await this._pullGlobal();
      // Pull only the current document if one is open
      let docChanged = false;
      const session = this._getCurrentSession();
      if (session?.filePath) {
        docChanged = await this._pullDocument(session.filePath);
      }
      // Only notify if data actually changed to avoid unnecessary re-renders
      if (globalChanged || docChanged) {
        this._notifyListeners();
      }
    } catch (err) {
      console.warn('[Sync] pullChanged error:', err.message);
    }
  }

  /**
   * Pull data for a specific document.
   */
  async pullDocument(filePath) {
    if (!this.enabled || !filePath) return;
    try {
      await this._pullDocument(filePath);
      this._notifyListeners();
    } catch (err) {
      console.warn('[Sync] pullDocument error:', err.message);
    }
  }

  /**
   * Register a listener for sync completion events.
   */
  onSyncComplete(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  /**
   * Cleanup on app close.
   */
  destroy() {
    if (this._pollTimer) clearInterval(this._pollTimer);
    for (const timer of this._debounceTimers.values()) clearTimeout(timer);
    if (this._globalDebounceTimer) clearTimeout(this._globalDebounceTimer);
  }

  // --- Internal methods ---

  async _ensureSyncDir() {
    try {
      await fileSystem.createSyncDir();
    } catch (err) {
      // Directory might already exist
      console.log('[Sync] createSyncDir:', err.message);
    }
  }

  _getCurrentSession() {
    try {
      return JSON.parse(localStorage.getItem('lector-last-session'));
    } catch { return null; }
  }

  _notifyListeners() {
    this._listeners.forEach(cb => {
      try { cb(); } catch (err) { console.warn('[Sync] listener error:', err); }
    });
  }

  // --- Document push/pull ---

  _buildDocumentData(filePath) {
    const scroll = this._jsonParse(localStorage.getItem(`lector-scroll-${filePath}`));

    return {
      version: 1,
      filePath,
      lastModified: new Date().toISOString(),
      deviceId: this.deviceId,
      scroll,
    };
  }

  _applyDocumentData(data) {
    if (!data?.filePath) return;
    const filePath = data.filePath;

    if (data.scroll) {
      localStorage.setItem(`lector-scroll-${filePath}`, JSON.stringify(data.scroll));
    }
  }

  async _pushDocument(filePath) {
    if (!this.enabled) return;
    this.dirtyDocs.delete(filePath);

    try {
      const localData = this._buildDocumentData(filePath);
      const hash = hashFilePath(filePath);
      const syncPath = `documents/${hash}.json`;

      await fileSystem.writeSyncFile(syncPath, JSON.stringify(localData, null, 2));
    } catch (err) {
      console.warn(`[Sync] Push doc failed (${filePath}):`, err.message);
    }
  }

  async _pullDocument(filePath) {
    const hash = hashFilePath(filePath);
    const syncPath = `documents/${hash}.json`;

    try {
      const content = await fileSystem.readSyncFile(syncPath);
      if (!content) return false;

      const remoteData = this._jsonParse(content);
      if (!remoteData || remoteData.filePath !== filePath) return false;

      // Skip if this device pushed it
      if (remoteData.deviceId === this.deviceId) return false;

      const localData = this._buildDocumentData(filePath);
      const merged = mergeDocumentData(localData, remoteData);

      if (merged) {
        this._applyDocumentData(merged);
        return true;
      }
      return false;
    } catch (err) {
      // File doesn't exist yet or read error, that's ok
      return false;
    }
  }

  async _pullAllDocuments() {
    try {
      const files = await fileSystem.listSyncFiles('documents');
      if (!files || files.length === 0) return;

      for (const file of files) {
        if (!file.name?.endsWith('.json')) continue;

        try {
          const content = await fileSystem.readSyncFile(`documents/${file.name}`);
          if (!content) continue;

          const remoteData = this._jsonParse(content);
          if (!remoteData?.filePath) continue;

          // Skip if same device
          if (remoteData.deviceId === this.deviceId) continue;

          const localData = this._buildDocumentData(remoteData.filePath);
          const merged = mergeDocumentData(localData, remoteData);

          if (merged) {
            this._applyDocumentData(merged);
          }
        } catch (err) {
          // Skip corrupted files
          console.warn('[Sync] Error reading sync file:', file.name, err.message);
        }
      }
    } catch (err) {
      // Directory doesn't exist yet
    }
  }

  // --- Global push/pull ---

  _buildGlobalData() {
    // Collect preferences
    const prefKeys = ['showSidebar', 'sidebarWidth', 'rightSidebarWidth', 'showRightSidebar'];
    const preferences = { lastModified: new Date().toISOString() };
    for (const key of prefKeys) {
      const val = localStorage.getItem(`lector-${key}`);
      if (val !== null) {
        try { preferences[key] = JSON.parse(val); } catch { preferences[key] = val; }
      }
    }

    return {
      version: 1,
      lastModified: new Date().toISOString(),
      deviceId: this.deviceId,
      preferences,
    };
  }

  _applyGlobalData(data) {
    if (!data) return;

    if (data.preferences) {
      const prefKeys = ['showSidebar', 'sidebarWidth', 'rightSidebarWidth', 'showRightSidebar'];
      for (const key of prefKeys) {
        if (data.preferences[key] !== undefined) {
          localStorage.setItem(`lector-${key}`, JSON.stringify(data.preferences[key]));
        }
      }
    }
  }

  async _pushGlobal() {
    if (!this.enabled) return;
    this.globalDirty = false;

    try {
      const localData = this._buildGlobalData();
      await fileSystem.writeSyncFile('global.json', JSON.stringify(localData, null, 2));
    } catch (err) {
      console.warn('[Sync] Push global failed:', err.message);
    }
  }

  async _pullGlobal() {
    try {
      const content = await fileSystem.readSyncFile('global.json');
      if (!content) return false;

      const remoteData = this._jsonParse(content);
      if (!remoteData) return false;

      // Skip if same device
      if (remoteData.deviceId === this.deviceId) return false;

      const localData = this._buildGlobalData();
      const merged = mergeGlobalData(localData, remoteData);

      if (merged) {
        this._applyGlobalData(merged);
        return true;
      }
      return false;
    } catch (err) {
      // File doesn't exist yet
      return false;
    }
  }

  // --- Migration ---

  async _migrate() {
    console.log('[Sync] Starting migration from localStorage to iCloud...');

    try {
      // Push global data
      await this._pushGlobal();

      // Find all document-specific data in localStorage
      const docPaths = new Set();

      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith('lector-scroll-')) {
          docPaths.add(key.replace('lector-scroll-', ''));
        }
      }

      // Push each document
      for (const filePath of docPaths) {
        await this._pushDocument(filePath);
      }

      console.log(`[Sync] Migration complete: ${docPaths.size} documents migrated`);
    } catch (err) {
      console.warn('[Sync] Migration error:', err.message);
    }
  }

  // --- Util ---

  _jsonParse(str) {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  }
}

export const syncService = new SyncService();
export default syncService;
