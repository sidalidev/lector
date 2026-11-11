// Chargé seulement sur ordinateur et mobile (App.jsx) ; @capacitor/core n'est
// importé que sur mobile.
import fileSystem from './fileSystem';

let OTAUpdate = null;
let AppUpdate = null;

// iOS: the web bundle is updated over the air (OTAUpdatePlugin.swift).
// Android: the whole signed APK, from GitHub Releases (AppUpdatePlugin.java).
// Les plugins restent dans des variables : une promesse résolue avec un plugin
// Capacitor (un Proxy) le prendrait pour un « thenable » et ne se résoudrait jamais.
async function chargerPlugins() {
  if (!OTAUpdate) {
    const { registerPlugin } = await import('@capacitor/core');
    OTAUpdate = registerPlugin('OTAUpdate');
    AppUpdate = registerPlugin('AppUpdate');
  }
}

function isAndroid() {
  return window.Capacitor?.getPlatform?.() === 'android';
}

const ANDROID_INTERVAL_MS = 24 * 60 * 60 * 1000;
const ANDROID_LAST_CHECK_KEY = 'lector-app-update-last-check';

function readLastCheck() {
  try { return Number(localStorage.getItem(ANDROID_LAST_CHECK_KEY)) || 0; } catch { return 0; }
}

function writeLastCheck(ms) {
  try { localStorage.setItem(ANDROID_LAST_CHECK_KEY, String(ms)); } catch { /* storage unavailable */ }
}

class OTAService {
  constructor() {
    this.listeners = new Set();
    /** True when the ready update is a new APK (button "Install") rather than a reload. */
    this.isAppUpdate = false;
  }

  async initialize() {
    await fileSystem.ensurePlatform();

    if (fileSystem.isElectron()) {
      // Electron: listen for auto-update ready event
      if (window.electron?.onUpdateReady) {
        window.electron.onUpdateReady((version) => this._notify(version));
      }
    } else if (fileSystem.isCapacitor() && isAndroid()) {
      // Android: check at launch, then once a day (and when the app comes back after a day).
      this.isAppUpdate = true;
      this._checkAndroid(true);
      this._androidTimer = setInterval(() => this._checkAndroid(false), ANDROID_INTERVAL_MS);
      const handleVisibility = () => {
        if (document.visibilityState === 'visible') this._checkAndroid(false);
      };
      document.addEventListener('visibilitychange', handleVisibility);
      this._cleanupVisibility = () => document.removeEventListener('visibilitychange', handleVisibility);
    } else if (fileSystem.isCapacitor()) {
      // iOS: OTA for the web bundle only
      // Allowed by Apple (Section 3.3.2: interpreted JS/CSS/HTML content)
      this._checkForUpdates();

      const handleVisibility = () => {
        if (document.visibilityState === 'visible') {
          this._checkForUpdates();
        }
      };
      document.addEventListener('visibilitychange', handleVisibility);
      this._cleanupVisibility = () => document.removeEventListener('visibilitychange', handleVisibility);
    }
  }

  /**
   * Never blocking, never a message when offline or on failure: the banner only
   * shows once the APK is downloaded and verified (signature, SHA-256, certificate).
   */
  async _checkAndroid(atLaunch) {
    if (this._androidChecking) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    const now = Date.now();
    if (!atLaunch && now - readLastCheck() < ANDROID_INTERVAL_MS) return;
    this._androidChecking = true;
    try {
      await chargerPlugins();
      const result = await AppUpdate.checkForUpdate();
      writeLastCheck(Date.now());
      if (result?.updateAvailable && result.ready && result.version) {
        this._notify(result.version);
      }
    } catch {
      // offline, no release yet, or refused: silent
    } finally {
      this._androidChecking = false;
    }
  }

  async _checkForUpdates() {
    try {
      await chargerPlugins();
      const plugin = OTAUpdate;
      const result = await plugin.checkForUpdate();

      if (result.updateAvailable) {
        console.log(`OTA: Update available v${result.version}, downloading...`);
        const dl = await plugin.downloadUpdate({ url: result.url, version: result.version });
        if (dl.success) {
          console.log(`OTA: v${result.version} ready`);
          this._notify(result.version);
        }
      }
    } catch (err) {
      console.warn('OTA check failed:', err);
    }
  }

  async installUpdate() {
    await fileSystem.ensurePlatform();

    if (fileSystem.isElectron()) {
      window.electron?.installUpdate();
    } else if (fileSystem.isCapacitor() && isAndroid()) {
      // Opens the system install screen (or the "Install unknown apps" setting the first time).
      try {
        await chargerPlugins();
        await AppUpdate.installUpdate();
      } catch { /* the banner stays, the user can try again */ }
    } else if (fileSystem.isCapacitor()) {
      try {
        await chargerPlugins();
        await OTAUpdate.applyUpdate();
      } catch (err) {
        console.error('OTA apply failed:', err);
      }
    }
  }

  onUpdateReady(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  _notify(version) {
    this.listeners.forEach(cb => cb(version));
  }

  destroy() {
    this._cleanupVisibility?.();
    if (this._androidTimer) clearInterval(this._androidTimer);
    this.listeners.clear();
  }
}

export default new OTAService();
