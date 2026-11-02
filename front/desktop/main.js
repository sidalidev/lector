const { app, BrowserWindow, ipcMain, dialog, Menu, shell, protocol, net, safeStorage, systemPreferences, powerMonitor, nativeTheme, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const { execFile } = require('child_process');
const { exportFolderToEpub, exportFileToEpub } = require('./epubExport');
const cloudStore = require('./cloud-store');
const keysStore = require('./keys-store');
const { SyncManager } = require('./sync-manager');
const { ChaineDesktop } = require('./chaine-desktop');
const { chargerFournisseurs } = require('./chaine-modules');
const { Acces, verifierDans } = require('./acces');

// Debug log to file (delayed until app is ready)
let logFile = null;
let logBytes = 0;
const LOG_MAX_BYTES = 5 * 1024 * 1024; // cap the active log; roll once → ≤ ~10 MB on disk
function debugLog(msg) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  console.log(msg);
  if (logFile) {
    try {
      const len = Buffer.byteLength(line);
      if (logBytes + len > LOG_MAX_BYTES) {
        // Roll to a single previous file so a logging loop can't fill the disk.
        try { fs.renameSync(logFile, logFile + '.1'); } catch (e) { try { fs.unlinkSync(logFile); } catch (e2) {} }
        logBytes = 0;
      }
      fs.appendFileSync(logFile, line);
      logBytes += len;
    } catch (e) {}
  }
}

debugLog('App starting...');
debugLog('isPackaged: ' + app.isPackaged);
debugLog('__dirname: ' + __dirname);

let autoUpdater;
try {
  autoUpdater = require('electron-updater').autoUpdater;
  debugLog('electron-updater loaded');
} catch (err) {
  debugLog('electron-updater failed: ' + err.message);
}

// Configure auto-updater
if (autoUpdater) {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => debugLog('AutoUpdater: checking…'));
  autoUpdater.on('update-available', (info) => debugLog('AutoUpdater: update-available v' + info?.version));
  autoUpdater.on('update-not-available', (info) => debugLog('AutoUpdater: up to date (server v' + info?.version + ')'));
  autoUpdater.on('error', (err) => debugLog('AutoUpdater error: ' + (err?.message || String(err))));
  autoUpdater.on('download-progress', (p) => debugLog(`AutoUpdater: downloading ${Math.round(p.percent)}%`));

  autoUpdater.on('update-downloaded', (info) => {
    const version = info.version || 'unknown';
    debugLog('Update downloaded: ' + version);
    pendingUpdateVersion = version;
    createAppMenu();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('update-ready', version);
    }
  });
}

let mainWindow;
let fileToOpen = null;
let recentFiles = [];
let dirWatcher = null;
let fileWatcher = null;
let syncWatcher = null;
let currentOpenFilePath = null;
let pendingUpdateVersion = null; // Track if an update is downloaded and waiting
const MAX_RECENT_FILES = 10;

// --- Lector Vault : synchro du vault par la chaîne (lector.dockerbop.fr) ---
let syncManager = null;
let cloudCreds = {}; // cloud-store : { vaultPath, serverUrl, deviceId, chainSecret, chainId, chainPendingSecret, chainSaved }
let cloudShuttingDown = false;

// Directories to always skip during recursive scans
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', '.nuxt',
  '__pycache__', '.venv', 'venv', '.env', 'env', '.cache', '.turbo',
  'coverage', '.nyc_output', '.parcel-cache', '.webpack', 'vendor',
  'bower_components', '.idea', '.vscode', '.DS_Store', 'tmp', '.tmp',
]);

function shouldSkipDir(name) {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

// Ce que le renderer peut lire ou écrire par IPC, et où (acces.js).
let acces = null;
const MARKDOWN = ['.md', '.markdown'];
const IMAGES = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'];
const VIDEOS = ['.mp4', '.webm', '.mov'];
const HTML = ['.html', '.htm'];
// Fichiers servis aux pages HTML locales intégrées (lector-local://).
const TYPES_INTEGRES = [...HTML, '.js', '.mjs', '.css', '.json', ...IMAGES, ...VIDEOS, '.woff', '.woff2', '.ttf'];
// Conteneur iCloud de Lector et son dossier .lector (positions de lecture).
const ICLOUD_DOCUMENTS = path.join(app.getPath('home'), 'Library/Mobile Documents/iCloud~com~lector~app/Documents');
const DOSSIER_SYNC = path.join(ICLOUD_DOCUMENTS, '.lector');

// Fichier ouvert par l'utilisateur lui-même (boîte de dialogue, double-clic,
// menu, glisser-déposer) : son dossier devient accessible au renderer.
function ouvrirFichierUtilisateur(filePath) {
  acces.autoriser(path.dirname(filePath));
  loadFile(filePath);
}

// Load recent files from storage
function loadRecentFiles() {
  try {
    const configPath = path.join(app.getPath('userData'), 'recent-files.json');
    if (fs.existsSync(configPath)) {
      recentFiles = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (e) {
    recentFiles = [];
  }
}

// Save recent files to storage
function saveRecentFiles() {
  try {
    const configPath = path.join(app.getPath('userData'), 'recent-files.json');
    fs.writeFileSync(configPath, JSON.stringify(recentFiles));
  } catch (e) {
    console.error('Failed to save recent files:', e);
  }
}

// Add file to recent files
let dockMenuUpdatePending = false;
function addToRecentFiles(filePath) {
  // Remove if already exists
  recentFiles = recentFiles.filter(f => f !== filePath);
  // Add to beginning
  recentFiles.unshift(filePath);
  // Keep only MAX_RECENT_FILES
  recentFiles = recentFiles.slice(0, MAX_RECENT_FILES);
  // Save immediately
  saveRecentFiles();
  // Debounce dock menu update (expensive operation)
  if (!dockMenuUpdatePending) {
    dockMenuUpdatePending = true;
    setImmediate(() => {
      dockMenuUpdatePending = false;
      updateDockMenu();
    });
  }
  // Also add to system recent documents
  app.addRecentDocument(filePath);
}

// Handle file open from command line or double-click
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();

      const filePath = commandLine.find(arg => arg.endsWith('.md'));
      if (filePath && fs.existsSync(filePath)) {
        ouvrirFichierUtilisateur(filePath);
      }
    }
  });
}

function createWindow() {
  debugLog('Creating window...');
  try {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    // Fond de la charte avant la première image : crème miel ou sapin nuit.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12201A' : '#FBF7EF',
    icon: path.join(__dirname, 'build/icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      sandbox: true,
      // Le préchargement n'a pas de module Node : le dossier personnel lui est passé ici.
      additionalArguments: [`--lector-home=${app.getPath('home')}`],
    },
  });

  debugLog('Window created, loading content...');

  if (!app.isPackaged) {
    debugLog('Dev mode - loading localhost');
    mainWindow.loadURL('http://localhost:5173');
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html');
    debugLog('Prod mode - loading: ' + indexPath);
    debugLog('File exists: ' + fs.existsSync(indexPath));
    mainWindow.loadFile(indexPath);
  }

  mainWindow.once('ready-to-show', () => {
    debugLog('Window ready to show');
    mainWindow.show();
  });

  // Forward renderer logs to main process
  mainWindow.webContents.on('console-message', (event) => {
    const msg = event.message || (typeof event === 'string' ? event : '');
    if (msg.includes('[Sync]') || msg.includes('[Verovio]') || msg.includes('Verovio') || msg.includes('error') || msg.includes('Error')) {
      debugLog('RENDERER: ' + msg);
    }
  });

  // Open DevTools on Cmd+Shift+I in dev mode (not auto-opened to avoid perf hit)
  if (!app.isPackaged) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.meta && input.shift && input.key === 'i') {
        mainWindow.webContents.toggleDevTools();
      }
    });
  }

  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription) => {
    debugLog('Failed to load: ' + errorDescription);
  });

  // Jamais de navigation dans la fenêtre (fichier déposé, lien, script) ; un
  // lien web vers un autre site s'ouvre dans le navigateur système.
  const origine = (u) => { try { return new URL(u).origin; } catch { return null; } };
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault();
    if (/^https?:\/\//i.test(url) && origine(url) !== origine(mainWindow.webContents.getURL())) {
      shell.openExternal(url);
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  // Load file passed via CLI/double-click after page is ready
  mainWindow.webContents.on('did-finish-load', () => {
    if (fileToOpen) {
      setTimeout(() => {
        ouvrirFichierUtilisateur(fileToOpen);
        fileToOpen = null;
      }, 500);
    }
    // Re-broadcast a pending update banner: the original send may have happened
    // before the renderer's IPC listener was attached (race), so the banner
    // never appeared. Resending here guarantees it always lands.
    if (pendingUpdateVersion) {
      mainWindow.webContents.send('update-ready', pendingUpdateVersion);
    }
  });

  // Context menu (right-click)
  mainWindow.webContents.on('context-menu', (event, params) => {
    const contextMenu = Menu.buildFromTemplate([
      { role: 'copy', label: 'Copy', enabled: params.selectionText.length > 0 },
      { role: 'selectAll', label: 'Select all' },
      { type: 'separator' },
      {
        label: 'Search the web',
        enabled: params.selectionText.length > 0,
        click: () => {
          const { shell } = require('electron');
          shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(params.selectionText)}`);
        }
      },
    ]);
    contextMenu.popup();
  });
  } catch (err) {
    debugLog('Error in createWindow: ' + err.message + '\n' + err.stack);
  }
}

function loadFile(filePath) {
  if (mainWindow && !mainWindow.isDestroyed() && fs.existsSync(filePath)) {
    const fileName = path.basename(filePath);
    const dirPath = path.dirname(filePath);

    // Async read pour ne pas bloquer le main process
    fs.promises.readFile(filePath, 'utf-8').then(content => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('file-opened', {
          content,
          fileName,
          filePath,
          dirPath,
        });
      }
    });

    mainWindow.setTitle(`${fileName} - Lector`);
    watchCurrentFile(filePath);

    // Add to recent files
    addToRecentFiles(filePath);
  }
}

function isSrtFile(fp) {
  return fp.endsWith('.srt');
}

function srtToMarkdown(srtContent, fileName) {
  const lines = srtContent.split('\n');
  const textParts = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^\d+$/.test(trimmed)) continue;
    if (/^\d{2}:\d{2}:\d{2}/.test(trimmed)) continue;
    if (!trimmed) continue;
    textParts.push(trimmed);
  }
  const fullText = textParts.join(' ').replace(/\s+/g, ' ');
  const words = fullText.split(' ');
  const paragraphs = [];
  for (let i = 0; i < words.length; i += 200) {
    paragraphs.push(words.slice(i, i + 200).join(' '));
  }
  const title = fileName.replace(/\.srt$/i, '').replace(/ - +- +\d{4}-\d{2}-\d{2}.*$/, '');
  return `# 🎬 ${title}\n\n> *Source: SRT file (video transcript), read only*\n\n---\n\n${paragraphs.join('\n\n')}`;
}

function isSupportedFile(fp) {
  return fp.endsWith('.md') || fp.endsWith('.srt');
}

function isReferenceFile(fp) {
  return fp.endsWith('.srt');
}

// Update dock menu with recent files
function updateDockMenu() {
  if (process.platform !== 'darwin') return;

  // Don't filter with fs.existsSync here - it's slow and blocks
  // Files that don't exist will just fail gracefully when clicked
  const recentMenuItems = recentFiles.slice(0, 10).map(filePath => ({
    label: path.basename(filePath),
    click: () => {
      if (mainWindow) {
        ouvrirFichierUtilisateur(filePath);
      }
    }
  }));

  const dockMenu = Menu.buildFromTemplate([
    {
      label: 'New file',
      click: () => {
        if (mainWindow) {
          mainWindow.webContents.send('new-file');
        }
      }
    },
    {
      label: 'Open…',
      click: async () => {
        const result = await dialog.showOpenDialog(mainWindow, {
          properties: ['openFile'],
          filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
        });
        if (!result.canceled && result.filePaths.length > 0) {
          ouvrirFichierUtilisateur(result.filePaths[0]);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Recent files',
      submenu: recentMenuItems.length > 0 ? recentMenuItems : [{ label: 'No recent files', enabled: false }]
    },
    { type: 'separator' },
    {
      label: 'Clear recent files',
      click: () => {
        recentFiles = [];
        saveRecentFiles();
        app.clearRecentDocuments();
        updateDockMenu();
      }
    }
  ]);

  app.dock.setMenu(dockMenu);
}

// Create application menu
function createAppMenu() {
  const template = [
    {
      label: app.name,
      submenu: [
        { label: 'About Lector', click: () => mainWindow?.webContents.send('menu-shortcut', 'about') },
        ...(pendingUpdateVersion ? [
          { type: 'separator' },
          {
            label: `Restart to update (v${pendingUpdateVersion})`,
            click: () => {
              if (autoUpdater) autoUpdater.quitAndInstall();
            }
          },
        ] : [
          { type: 'separator' },
          {
            label: 'Check for updates…',
            click: () => {
              if (autoUpdater && app.isPackaged) {
                autoUpdater.checkForUpdatesAndNotify().catch(() => {});
              }
            }
          },
        ]),
        { type: 'separator' },
        { role: 'services', label: 'Services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Lector' },
        { role: 'hideOthers', label: 'Hide others' },
        { role: 'unhide', label: 'Show all' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Lector' }
      ]
    },
    {
      label: 'File',
      submenu: [
        {
          label: 'New task',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu-shortcut', 'new-task'),
        },
        { type: 'separator' },
        {
          label: 'Open file…',
          accelerator: 'CmdOrCtrl+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openFile'],
              filters: [
                { name: 'Documents', extensions: ['md', 'markdown'] },
              ],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              ouvrirFichierUtilisateur(result.filePaths[0]);
            }
          }
        },
        {
          label: 'Open folder…',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: async () => {
            const result = await dialog.showOpenDialog(mainWindow, {
              properties: ['openDirectory'],
            });
            if (!result.canceled && result.filePaths.length > 0) {
              acces.autoriser(result.filePaths[0]);
              mainWindow.webContents.send('set-root-dir', result.filePaths[0]);
              watchDirectory(result.filePaths[0]);
            }
          }
        },
        {
          label: 'Open recent',
          submenu: recentFiles.length > 0
            ? recentFiles.filter(f => fs.existsSync(f)).map(filePath => ({
                label: path.basename(filePath),
                click: () => ouvrirFichierUtilisateur(filePath)
              }))
            : [{ label: 'No recent files', enabled: false }]
        },
        { type: 'separator' },
        { role: 'close', label: 'Close window' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { role: 'selectAll', label: 'Select all' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Command palette',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow?.webContents.send('menu-shortcut', 'command-palette'),
        },
        {
          label: 'Quick open',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow?.webContents.send('menu-shortcut', 'quick-open'),
        },
        { type: 'separator' },
        {
          label: 'Refresh',
          accelerator: 'CmdOrCtrl+R',
          click: () => mainWindow?.webContents.send('menu-shortcut', 'refresh-files'),
        },
        { role: 'forceReload', label: 'Reload app', accelerator: 'CmdOrCtrl+Shift+R' },
        { role: 'toggleDevTools', label: 'Developer tools' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Actual size' },
        { role: 'zoomIn', label: 'Zoom in' },
        { role: 'zoomOut', label: 'Zoom out' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Full screen' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize', label: 'Minimize' },
        { role: 'zoom', label: 'Zoom' },
        { type: 'separator' },
        { role: 'front', label: 'Bring all to front' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// Watch currently open file for external changes
function watchCurrentFile(filePath) {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
  if (!filePath || !fs.existsSync(filePath)) return;
  currentOpenFilePath = filePath;

  let debounceTimer = null;
  try {
    fileWatcher = fs.watch(filePath, (eventType) => {
      if (eventType !== 'change') return;
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        if (!fs.existsSync(filePath)) return;
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            mainWindow.webContents.send('file-changed', { filePath, content });
        } catch (e) {
          debugLog('File watch read error: ' + e.message);
        }
      }, 250);
    });
  } catch (e) {
    debugLog('File watch error: ' + e.message);
  }
}

// Watch directory for file changes and notify renderer
function watchDirectory(dirPath) {
  if (dirWatcher) {
    dirWatcher.close();
    dirWatcher = null;
  }
  if (!dirPath || !fs.existsSync(dirPath)) return;
  // Synchro active sur ce dossier : son propre watcher suit les changements.
  if (syncManager && syncManager.state === 'running' && cloudCreds && path.resolve(dirPath) === path.resolve(cloudCreds.vaultPath)) {
    debugLog('watchDirectory skipped (Cloud sync active for this vault)');
    return;
  }

  let debounceTimer = null;
  try {
    dirWatcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      // Only care about supported files or directories
      const ext = path.extname(filename).toLowerCase();
      const isSupported = filename.endsWith('.md') || filename.endsWith('.mid') || filename.endsWith('.midi') || ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'].includes(ext);
      if (!isSupported && eventType !== 'rename') return;
      // Ignore hidden/ignored dirs
      const parts = filename.split(path.sep);
      if (parts.some(p => p.startsWith('.') || IGNORED_DIRS.has(p))) return;

      // Debounce to avoid flooding
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('dir-changed', dirPath);
        }
      }, 300);
    });
  } catch (e) {
    debugLog('Watch error: ' + e.message);
  }
}

app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady() && mainWindow) {
    ouvrirFichierUtilisateur(filePath);
  } else {
    fileToOpen = filePath;
  }
});

// Register custom protocol for serving local HTML files in iframes
protocol.registerSchemesAsPrivileged([{
  scheme: 'lector-local',
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}]);

app.whenReady().then(() => {
  // Handle lector-local:// protocol: serves local files for iframe embeds
  // Seulement dans les dossiers ouverts par l'utilisateur, et seulement les
  // types d'une page web : une page intégrée ne lit rien d'autre sur le disque.
  protocol.handle('lector-local', (request) => {
    try {
      const url = new URL(request.url);
      // Path is encoded in the hostname + pathname: lector-local://serve/<encoded-path>
      const filePath = acces?.verifier(decodeURIComponent(url.pathname.slice(1)), TYPES_INTEGRES);
      if (!filePath || !fs.existsSync(filePath)) {
        return new Response('Not found', { status: 404 });
      }
      return net.fetch(pathToFileURL(filePath).href);
    } catch (err) {
      debugLog(`lector-local protocol error: ${err.message}`);
      return new Response('Error', { status: 500 });
    }
  });

  // Setup log file now that app is ready
  logFile = path.join(app.getPath('userData'), 'lector-debug.log');
  try {
    logBytes = fs.statSync(logFile).size;
    // Self-heal a previously-ballooned log (e.g. the old 401 retry-loop).
    if (logBytes > LOG_MAX_BYTES) { fs.truncateSync(logFile, 0); logBytes = 0; }
  } catch (e) { logBytes = 0; }
  debugLog('App ready, userData path: ' + app.getPath('userData'));

  // Réglages de la synchro et clés API, chiffrés par safeStorage. Les fichiers
  // des versions avec compte sont supprimés.
  cloudStore.init({ userDataPath: app.getPath('userData'), safeStorage, logger: debugLog });
  keysStore.init({ userDataPath: app.getPath('userData'), safeStorage, logger: debugLog });
  cloudStore.nettoyerAnciensFichiers();
  cloudCreds = cloudStore.load();

  // Load recent files and create menus
  loadRecentFiles();
  const fichierAcces = path.join(app.getPath('userData'), 'acces.json');
  const premierLancement = !fs.existsSync(fichierAcces);
  acces = new Acces({ fichier: fichierAcces, dossiersFixes: () => [cloudCreds.vaultPath, ICLOUD_DOCUMENTS] });
  // Mise à jour depuis une version sans cette liste : les dossiers des fichiers récents restent ouverts.
  if (premierLancement) recentFiles.forEach((f) => acces.autoriser(path.dirname(f)));
  createAppMenu();
  updateDockMenu();

  // Check for updates (only in production)
  if (app.isPackaged && autoUpdater) {
    const checkForUpdates = () => {
      autoUpdater.checkForUpdatesAndNotify().catch(err => {
        debugLog('Auto-update check failed: ' + err.message);
      });
    };
    // Check on launch
    checkForUpdates();
    // Re-check every 4 hours (safety net if SSE is disconnected)
    setInterval(checkForUpdates, 4 * 60 * 60 * 1000);

    // Realtime release notifications via SSE: trigger an immediate update check
    // when the server announces a new release.
    // Use Electron's net.request (Chromium stack) so the SSE honors the OS keychain.
    const SSE_URL = (process.env.LECTOR_RELEASES_URL || 'https://lector.dockerbop.fr') + '/v1/releases/stream';
    const connectSSE = () => {
      try {
        const req = net.request({ method: 'GET', url: SSE_URL });
        req.setHeader('Accept', 'text/event-stream');
        req.on('response', (res) => {
          if (res.statusCode !== 200) {
            debugLog('Releases SSE non-200: ' + res.statusCode);
            setTimeout(connectSSE, 30_000);
            return;
          }
          debugLog('Releases SSE connected');
          let buf = '';
          res.on('data', (chunk) => {
            buf += chunk.toString('utf8');
            let idx;
            while ((idx = buf.indexOf('\n\n')) !== -1) {
              const block = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              if (/event:\s*release/.test(block)) {
                debugLog('Release event received → checking for updates');
                checkForUpdates();
              }
            }
          });
          res.on('end', () => { debugLog('Releases SSE closed, reconnecting'); setTimeout(connectSSE, 5_000); });
          res.on('error', (err) => { debugLog('Releases SSE error: ' + err.message); setTimeout(connectSSE, 30_000); });
        });
        req.on('error', (err) => { debugLog('Releases SSE req error: ' + err.message); setTimeout(connectSSE, 30_000); });
        req.end();
      } catch (err) {
        debugLog('Releases SSE setup failed: ' + err.message);
        setTimeout(connectSSE, 60_000);
      }
    };
    connectSSE();
  }

  const args = process.argv.slice(1);
  let filePath = args.find(arg => isSupportedFile(arg) && fs.existsSync(arg));

  if (filePath) {
    fileToOpen = filePath;
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// Re-encrypt the cloud vault before exit (if sync was running).
app.on('before-quit', async (e) => {
  if (!syncManager || cloudShuttingDown) return;
  if (syncManager.state !== 'running' && syncManager.state !== 'starting') return;
  e.preventDefault();
  cloudShuttingDown = true;
  debugLog('before-quit: stopping SyncManager…');
  try { await syncManager.stop(); } catch (err) { debugLog('SyncManager.stop error: ' + err.message); }
  debugLog('before-quit: SyncManager stopped, exiting.');
  app.exit(0);
});

// IPC Handlers

// Set root directory from renderer (starts watcher + notifies)
// Seulement un dossier déjà ouvert par l'utilisateur (ou le vault).
ipcMain.handle('set-root-dir', async (event, dirPath) => {
  if (acces.verifier(dirPath) && fs.statSync(dirPath, { throwIfNoEntry: false })?.isDirectory()) {
    mainWindow.webContents.send('set-root-dir', dirPath);
    watchDirectory(dirPath);
    return true;
  }
  return false;
});

ipcMain.handle('open-file-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [
      { name: 'Documents', extensions: ['md', 'markdown'] },
    ],
  });

  if (!result.canceled && result.filePaths.length > 0) {
    ouvrirFichierUtilisateur(result.filePaths[0]);
    return true;
  }
  return false;
});

ipcMain.handle('open-folder-dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
  });
  if (!result.canceled && result.filePaths.length > 0) {
    acces.autoriser(result.filePaths[0]);
    mainWindow.webContents.send('set-root-dir', result.filePaths[0]);
    watchDirectory(result.filePaths[0]);
    return true;
  }
  return false;
});

// ----- Premier lancement : « Lector Vault » dans Documents -----
// Le dossier proposé est celui de la synchro s'il existe déjà, sinon
// Documents/Lector Vault. L'adopter l'ouvre dans la barre latérale et en fait
// le dossier que la synchro utilisera (tant qu'aucune chaîne n'est en place).
const NOM_VAULT = 'Lector Vault';

function estDossier(p) {
  try { return !!p && fs.statSync(p).isDirectory(); } catch { return false; }
}

function suggestionVault() {
  const parDefaut = path.join(app.getPath('documents'), NOM_VAULT);
  const existant = [cloudCreds.vaultPath, parDefaut].find(estDossier);
  const chemin = existant || parDefaut;
  return { path: chemin, name: path.basename(chemin), exists: !!existant };
}

function adopterVault(dossier) {
  acces.autoriser(dossier);
  if (!cloudCreds.chainSecret && cloudCreds.vaultPath !== dossier) {
    saveCloudCreds({ ...cloudCreds, vaultPath: dossier });
  }
  mainWindow.webContents.send('set-root-dir', dossier);
  watchDirectory(dossier);
}

ipcMain.handle('vault:suggest', () => suggestionVault());

ipcMain.handle('vault:create', () => {
  try {
    const { path: dossier, exists } = suggestionVault();
    if (!exists) fs.mkdirSync(dossier, { recursive: true });
    adopterVault(dossier);
    return { ok: true, path: dossier, created: !exists };
  } catch (err) {
    debugLog('vault:create error: ' + err.message);
    return { ok: false, code: err.code || 'CREATE_FAILED' };
  }
});

ipcMain.handle('vault:choose', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose your notes folder',
    buttonLabel: 'Use this folder',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  adopterVault(result.filePaths[0]);
  return { ok: true, path: result.filePaths[0] };
});

ipcMain.handle('read-local-file', async (event, relativePath, basePath) => {
  try {
    // Nettoyer le chemin relatif (enlever ./ au début si présent)
    let cleanPath = relativePath;
    if (cleanPath.startsWith('./')) {
      cleanPath = cleanPath.slice(2);
    }
    // Décoder les caractères URL encodés (%20 -> espace, etc.)
    cleanPath = decodeURIComponent(cleanPath);

    // Images et vidéos d'un dossier ouvert, rien d'autre.
    const fullPath = acces.verifier(path.resolve(basePath, cleanPath), [...IMAGES, ...VIDEOS]);
    if (!fullPath || !fs.existsSync(fullPath)) return null;
    const ext = path.extname(fullPath).toLowerCase();
    const base64 = fs.readFileSync(fullPath).toString('base64');
    if (VIDEOS.includes(ext)) return `data:video/${ext.slice(1)};base64,${base64}`;
    const mimeType = ext === '.svg' ? 'image/svg+xml' : `image/${ext.slice(1)}`;
    return `data:${mimeType};base64,${base64}`;
  } catch (error) {
    console.error('Error reading local file:', error);
    return null;
  }
});

ipcMain.handle('resolve-local-html', async (event, relativePath, basePath) => {
  try {
    let cleanPath = relativePath;
    if (cleanPath.startsWith('./')) cleanPath = cleanPath.slice(2);
    cleanPath = decodeURIComponent(cleanPath);
    const fullPath = acces.verifier(path.resolve(basePath, cleanPath), HTML);
    if (fullPath && fs.existsSync(fullPath)) {
      return `lector-local://serve/${encodeURIComponent(fullPath)}`;
    }
    return null;
  } catch (error) {
    console.error('Error resolving local HTML:', error);
    return null;
  }
});

ipcMain.handle('open-local-md-file', async (event, relativePath, basePath) => {
  try {
    const fullPath = path.resolve(basePath, relativePath);

    if (acces.verifier(fullPath) && fs.existsSync(fullPath) && isSupportedFile(fullPath)) {
      loadFile(fullPath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error opening local file:', error);
    return false;
  }
});

// Le préchargement ne transmet que les chemins de fichiers réellement déposés.
ipcMain.handle('open-dropped-file', async (event, filePath) => {
  try {
    if (fs.existsSync(filePath) && isSupportedFile(filePath)) {
      ouvrirFichierUtilisateur(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error opening dropped file:', error);
    return false;
  }
});

// List markdown files in directory (recursive)
ipcMain.handle('list-directory-files', async (event, dirPath) => {
  try {
    if (!acces.verifier(dirPath)) return [];
    const files = [];
    const fsPromises = require('fs').promises;

    async function scanDir(dir, relativePath = '') {
      const entries = await fsPromises.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
        if (!entry.isDirectory() && entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);
        const relPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          files.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            isDirectory: true,
            children: []
          });
          await scanDir(fullPath, relPath);
        } else if (isSupportedFile(entry.name)) {
          files.push({
            name: entry.name,
            path: fullPath,
            relativePath: relPath,
            isDirectory: false,
            isReference: isReferenceFile(entry.name),
          });
        }
      }
    }

    await scanDir(dirPath);

    // Build tree structure
    const tree = [];
    const pathMap = {};

    // First pass: create all nodes
    files.forEach(file => {
      pathMap[file.relativePath] = file;
    });

    // Second pass: build tree
    files.forEach(file => {
      const parentPath = file.relativePath.split('/').slice(0, -1).join('/');
      if (parentPath && pathMap[parentPath]) {
        pathMap[parentPath].children.push(file);
      } else {
        tree.push(file);
      }
    });

    // Sort: folders first, then alphabetically
    const sortItems = (items) => {
      items.sort((a, b) => {
        if (a.isDirectory && !b.isDirectory) return -1;
        if (!a.isDirectory && b.isDirectory) return 1;
        return a.name.localeCompare(b.name);
      });
      items.forEach(item => {
        if (item.children) sortItems(item.children);
      });
    };

    sortItems(tree);

    // Remove empty directories (no .md descendants)
    const pruneEmpty = (items) => {
      return items.filter(item => {
        if (item.isDirectory) {
          item.children = pruneEmpty(item.children);
          return item.children.length > 0;
        }
        return true;
      });
    };

    return pruneEmpty(tree);
  } catch (error) {
    console.error('Error listing directory:', error);
    return [];
  }
});

// Cache for knowledge graph
let graphCache = { dirPath: null, data: null, timestamp: 0 };
const GRAPH_CACHE_TTL = 300000; // 5 minutes

function buildGraphForDir(dirPath) {
  const nodes = [];
  const links = [];
  const fileMap = {};

  function collectFiles(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
      if (!entry.isDirectory() && entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectFiles(fullPath);
      } else if (entry.name.endsWith('.md')) {
        const name = entry.name.replace('.md', '');
        const folder = path.relative(dirPath, path.dirname(fullPath)).split(path.sep)[0] || '';
        fileMap[name.toLowerCase()] = fullPath;
        nodes.push({ id: fullPath, name, folder });
      }
    }
  }

  collectFiles(dirPath);

  const nodeIds = new Set(nodes.map(n => n.id));
  for (const node of nodes) {
    try {
      const content = fs.readFileSync(node.id, 'utf-8');
      const wikiLinks = [...content.matchAll(/\[\[([^\]]+)\]\]/g)].map(m => m[1].split('|')[0].trim());
      const mdLinks = [...content.matchAll(/\[([^\]]*)\]\(([^)]+\.md)\)/g)].map(m => m[2]);

      for (const link of wikiLinks) {
        const target = fileMap[link.toLowerCase()];
        if (target && target !== node.id) {
          links.push({ source: node.id, target });
        }
      }
      for (const link of mdLinks) {
        const resolved = path.resolve(path.dirname(node.id), decodeURIComponent(link));
        if (nodeIds.has(resolved) && resolved !== node.id) {
          links.push({ source: node.id, target: resolved });
        }
      }
    } catch (e) { /* skip */ }
  }

  const result = { nodes, links };
  graphCache = { dirPath, data: result, timestamp: Date.now() };
  return result;
}

// Build knowledge graph IPC
ipcMain.handle('build-knowledge-graph', async (event, dirPath) => {
  if (!acces.verifier(dirPath)) return { nodes: [], links: [] };
  if (graphCache.dirPath === dirPath && Date.now() - graphCache.timestamp < GRAPH_CACHE_TTL && graphCache.data) {
    return graphCache.data;
  }
  try {
    return buildGraphForDir(dirPath);
  } catch (error) {
    console.error('Error building knowledge graph:', error);
    return { nodes: [], links: [] };
  }
});

// Remove diacritics for accent-insensitive search
function normalizeSearch(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Search across all .md files
ipcMain.handle('search-all-files', async (event, dirPath, query) => {
  try {
    if (!query || query.length < 2 || !acces.verifier(dirPath)) return { results: [], fileCount: 0 };
    const results = [];
    let fileCount = 0;
    const q = normalizeSearch(query);

    function searchDir(dir) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory() && shouldSkipDir(entry.name)) continue;
        if (!entry.isDirectory() && entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          searchDir(fullPath);
        } else if (entry.name.endsWith('.md')) {
          fileCount++;
          try {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const matchingLines = [];
            for (let i = 0; i < lines.length; i++) {
              if (normalizeSearch(lines[i]).includes(q)) {
                matchingLines.push({ line: i + 1, text: lines[i].trim().slice(0, 150) });
                if (matchingLines.length >= 15) break;
              }
            }
            if (matchingLines.length > 0) {
              results.push({
                filePath: fullPath,
                fileName: entry.name.replace('.md', ''),
                matches: matchingLines,
              });
            }
          } catch (e) { /* skip */ }
        }
      }
    }

    searchDir(dirPath);
    return { results: results.slice(0, 50), fileCount };
  } catch (error) {
    console.error('Error searching files:', error);
    return [];
  }
});

// Open file by path
ipcMain.handle('open-file-by-path', async (event, filePath) => {
  try {
    if (acces.verifier(filePath) && fs.existsSync(filePath) && isSupportedFile(filePath)) {
      loadFile(filePath);
      return true;
    }
    return false;
  } catch (error) {
    console.error('Error opening file:', error);
    return false;
  }
});

// Export to PDF: uses a hidden BrowserWindow to render the full document
ipcMain.handle('export-pdf', async (event, fileName) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: fileName.replace('.md', '.pdf'),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (result.canceled) return false;

    // Extract the document HTML and computed styles from the renderer
    const { html, styles } = await mainWindow.webContents.executeJavaScript(`
      (() => {
        const docContent = document.querySelector('.document-content');
        if (!docContent) return { html: '', styles: '' };
        // Clone to remove interactive elements
        const clone = docContent.cloneNode(true);
        // Remove interactive/UI elements that shouldn't be in PDF
        clone.querySelectorAll(
          '.doc-ai-actions, .quiz-generate-btn, .regenerate-btn, ' +
          '.reading-time-badge, .loading-badge, .metadata-badge, ' +
          '.doc-metadata, .keyword-chip, .doc-keywords, ' +
          '.mindmap-toggle, .doc-mindmap, .inline-quiz-section'
        ).forEach(el => el.remove());
        // Collect all stylesheets
        const styleSheets = [];
        for (const sheet of document.styleSheets) {
          try {
            for (const rule of sheet.cssRules) {
              styleSheets.push(rule.cssText);
            }
          } catch (e) {}
        }
        return {
          html: clone.innerHTML,
          styles: styleSheets.join('\\n')
        };
      })();
    `);

    if (!html) {
      console.error('No document content found for PDF export');
      return false;
    }

    const fullHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="script-src 'none'">
<style>
${styles}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: white; width: 100%; }
.document-content {
  max-width: 100% !important; width: 100% !important;
  margin: 0 auto; padding: 24px 40px;
  font-family: Georgia, 'Times New Roman', serif;
  font-size: 15px; line-height: 1.75; color: #2d2a26;
}
h1 { font-size: 24px; font-weight: 700; margin: 1.5em 0 0.5em; border-bottom: 2px solid #d4a574; padding-bottom: 6px; }
h2 { font-size: 20px; font-weight: 600; margin: 1.3em 0 0.4em; color: #4a3f35; }
h3 { font-size: 17px; font-weight: 600; margin: 1em 0 0.3em; }
p { margin: 0.6em 0; }
ul, ol { margin: 0.5em 0; padding-left: 1.5em; }
li { margin: 0.2em 0; }
strong { color: #2d2a26; }
a { color: #8b6b4b; text-decoration: none; }
blockquote { border-left: 4px solid #E9A23B; margin: 1em 0; padding: 0.5em 1em; color: #4A5A4F; background: #F3EDE1; border-radius: 0 14px 14px 0; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
th, td { border: 1px solid #e8e4df; padding: 6px 12px; text-align: left; font-size: 14px; }
th { background: #f5f3f0; font-weight: 600; }
code { background: #f5f3f0; padding: 2px 5px; border-radius: 3px; font-size: 13px; font-family: 'SF Mono', Menlo, monospace; }
pre { background: #f5f3f0; padding: 12px 16px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
img { max-width: 100% !important; height: auto !important; border-radius: 8px; }
hr { border: none; border-top: 1px solid #e8e4df; margin: 1.5em 0; }
@media print { h1 { page-break-before: always; } h1:first-child { page-break-before: avoid; } }
</style>
</head><body><article class="document-content">${html}</article></body></html>`;

    // Write HTML to temp file (data: URLs truncate large documents)
    const tmpHtmlPath = path.join(app.getPath('temp'), '__lector-pdf-export.html');
    fs.writeFileSync(tmpHtmlPath, fullHtml, 'utf-8');

    // Fenêtre cachée pour le rendu PDF (pas offscreen : cause des bugs de rendu)
    const pdfWindow = new BrowserWindow({
      width: 800,
      height: 1200,
      show: false,
      // webSecurity reste coupé pour lire les images locales du document ;
      // aucun script ne peut s'exécuter dans cette fenêtre.
      webPreferences: { webSecurity: false, javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
    });
    pdfWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    pdfWindow.webContents.on('will-navigate', (e) => e.preventDefault());

    await pdfWindow.loadFile(tmpHtmlPath);

    // Attendre que la page soit vraiment chargée
    await new Promise((resolve) => {
      pdfWindow.webContents.on('did-finish-load', () => setTimeout(resolve, 300));
    });

    const pdfData = await pdfWindow.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { top: 1, bottom: 1, left: 1, right: 1 }
    });

    pdfWindow.close();

    // Clean up temp file
    try { fs.unlinkSync(tmpHtmlPath); } catch (e) {}

    fs.writeFileSync(result.filePath, pdfData);
    return true;
  } catch (error) {
    console.error('Error exporting PDF:', error);
    return false;
  }
});

// CLI Claude installé localement : la voie par défaut quand il existe.
const CLAUDE_DIRS = [path.join(require('os').homedir(), '.local/bin'), '/usr/local/bin', '/opt/homebrew/bin'];

function findClaudeBin() {
  const dirs = [...CLAUDE_DIRS, ...String(process.env.PATH || '').split(path.delimiter).filter(Boolean)];
  for (const dir of dirs) {
    const p = path.join(dir, process.platform === 'win32' ? 'claude.exe' : 'claude');
    try {
      if (fs.existsSync(p)) return p;
    } catch (e) {}
  }
  return null;
}

ipcMain.handle('claude-check', async () => {
  return { available: !!findClaudeBin() };
});

// Claude CLI: run prompt via stdin
ipcMain.handle('claude-prompt', async (event, prompt, options = {}) => {
  const { spawn } = require('child_process');

  return new Promise((resolve) => {
    const claudeBin = findClaudeBin() || 'claude';
    const cleanEnv = { ...process.env, PATH: [process.env.PATH, ...CLAUDE_DIRS].filter(Boolean).join(path.delimiter) };
    delete cleanEnv.CLAUDECODE;

    // Modèle et effort configurables, sans outils (réponse texte pure)
    const model = options?.model || 'claude-opus-5-5'
    const effort = options?.effort || 'high'
    const args = ['-p', '--model', model, '--effort', effort, '--tools', '', '-']

    const child = spawn(claudeBin, args, {
      env: cleanEnv,
      timeout: 300000,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('close', (code) => {
      if (code === 0) {
        console.log('[Claude] Success, output length:', stdout.length);
        resolve({ success: true, result: stdout.trim() });
      } else {
        console.error('[Claude] Failed, code:', code, 'stderr:', stderr.slice(0, 200));
        resolve({ success: false, error: stderr || `Claude exited with code ${code}` });
      }
    });

    child.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    // Send prompt via stdin
    child.stdin.write(prompt);
    child.stdin.end();
  });
});

// ========== Sync (.lector/) IPC Handlers ==========

// Create .lector/ sync directories (le seul dossier .lector permis est celui du conteneur iCloud de Lector)
ipcMain.handle('create-sync-dir', async (event, basePath) => {
  try {
    if (typeof basePath !== 'string' || path.resolve(basePath) !== DOSSIER_SYNC) return false;
    if (!fs.existsSync(basePath)) {
      fs.mkdirSync(basePath, { recursive: true });
    }
    const docsPath = path.join(basePath, 'documents');
    if (!fs.existsSync(docsPath)) {
      fs.mkdirSync(docsPath, { recursive: true });
    }
    // Start watching the sync directory
    watchSyncDirectory(basePath);
    return true;
  } catch (err) {
    debugLog('create-sync-dir error: ' + err.message);
    return false;
  }
});

// Read a sync file
ipcMain.handle('read-sync-file', async (event, fullPath) => {
  try {
    const fichier = verifierDans(fullPath, [DOSSIER_SYNC], ['.json']);
    if (fichier && fs.existsSync(fichier)) {
      return fs.readFileSync(fichier, 'utf-8');
    }
    return null;
  } catch (err) {
    debugLog('read-sync-file error: ' + err.message);
    return null;
  }
});

// Write a sync file
ipcMain.handle('write-sync-file', async (event, fullPath, content) => {
  try {
    const fichier = verifierDans(fullPath, [DOSSIER_SYNC], ['.json']);
    if (!fichier || typeof content !== 'string') return false;
    fs.writeFileSync(fichier, content, 'utf-8');
    return true;
  } catch (err) {
    debugLog('write-sync-file error: ' + err.message);
    return false;
  }
});

// List files in a sync directory
ipcMain.handle('list-sync-files', async (event, dirPath) => {
  try {
    if (!verifierDans(dirPath, [DOSSIER_SYNC]) || !fs.existsSync(dirPath)) return [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries
      .filter(e => !e.isDirectory() && e.name.endsWith('.json'))
      .map(e => ({ name: e.name, path: path.join(dirPath, e.name) }));
  } catch (err) {
    debugLog('list-sync-files error: ' + err.message);
    return [];
  }
});

// Watch .lector/ directory for changes from other devices
function watchSyncDirectory(syncDirPath) {
  if (syncWatcher) {
    syncWatcher.close();
    syncWatcher = null;
  }
  if (!syncDirPath || !fs.existsSync(syncDirPath)) return;

  let debounceTimer = null;
  try {
    syncWatcher = fs.watch(syncDirPath, { recursive: true }, (eventType, filename) => {
      if (!filename || !filename.endsWith('.json')) return;

      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('sync-dir-changed');
        }
      }, 500);
    });
  } catch (e) {
    debugLog('Sync watch error: ' + e.message);
  }
}

// Install update and restart
ipcMain.handle('install-update', () => {
  if (autoUpdater) {
    autoUpdater.quitAndInstall();
  }
});

// Read file content (silent: no navigation, just returns content). Markdown d'un dossier ouvert seulement.
ipcMain.handle('read-file-silent', async (event, filePath) => {
  try {
    const fichier = acces.verifier(filePath, MARKDOWN);
    if (!fichier || !fs.existsSync(fichier)) return null;
    return fs.readFileSync(fichier, 'utf-8');
  } catch (error) {
    console.error('Error reading file:', error);
    return null;
  }
});

// Save file content. Markdown d'un dossier ouvert seulement : jamais un script,
// une configuration ni un fichier hors de ces dossiers.
ipcMain.handle('save-file', async (event, filePath, content) => {
  try {
    const fichier = acces.verifier(filePath, MARKDOWN);
    if (!fichier || typeof content !== 'string') return false;
    fs.writeFileSync(fichier, content, 'utf-8');
    return true;
  } catch (error) {
    console.error('Error saving file:', error);
    return false;
  }
});

// --- Tâches et rappels ---
// Le renderer lit les tâches (ce handler lui donne les notes qui en contiennent)
// et confie ici les rappels à venir. Le processus principal tient les minuteurs
// et affiche les notifications tant que l'app tourne, fenêtre fermée comprise.
// Rien ne sort de l'ordinateur.

const LIGNE_CASE = /^[ \t>]*(?:[-*+]|\d{1,9}[.)])[ \t]+\[[ xX]\][ \t]+\S/m;
const MAX_NOTES_TACHES = 10000;
const MAX_OCTETS_NOTE = 2 * 1024 * 1024;

ipcMain.handle('taches:collecter', async (event, racine) => {
  try {
    const dossier = acces.verifier(racine);
    if (!dossier || !fs.statSync(dossier).isDirectory()) return { ok: false };
    const notes = [];
    let vues = 0;
    let complet = true;
    const parcourir = async (dir) => {
      let entrees;
      try { entrees = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { complet = false; return; }
      for (const e of entrees) {
        if (e.isSymbolicLink() || e.name.startsWith('.')) continue;
        const chemin = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!shouldSkipDir(e.name)) await parcourir(chemin);
          continue;
        }
        if (!e.isFile() || !MARKDOWN.includes(path.extname(e.name).toLowerCase())) continue;
        if (++vues > MAX_NOTES_TACHES) { complet = false; return; }
        try {
          const st = await fs.promises.stat(chemin);
          if (st.size > MAX_OCTETS_NOTE) continue;
          const content = await fs.promises.readFile(chemin, 'utf-8');
          if (LIGNE_CASE.test(content)) notes.push({ path: chemin, content });
        } catch { complet = false; }
      }
    };
    await parcourir(dossier);
    return { ok: true, notes, complet };
  } catch (error) {
    debugLog('taches:collecter failed: ' + error.message);
    return { ok: false };
  }
});

let rappels = [];               // [{ id, quand, titre, note, chemin, ligne, brut }]
let minuteurRappels = null;
const rappelsSonnes = new Set(); // ids déjà affichés pendant cette session
const notificationsVivantes = new Set(); // gardées en mémoire jusqu'au clic (macOS)
let ouvertureRappel = null;      // rappel touché avant que la fenêtre soit prête

function texteCourt(v, max) {
  return typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').slice(0, max) : '';
}

function ouvrirDepuisRappel(r) {
  const cible = { chemin: r.chemin, ligne: r.ligne, brut: r.brut };
  if (!mainWindow || mainWindow.isDestroyed()) {
    ouvertureRappel = cible; // la fenêtre neuve la demande au démarrage
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (mainWindow.webContents.isLoading()) ouvertureRappel = cible;
  else mainWindow.webContents.send('rappels:ouvrir', cible);
}

function sonner(r) {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title: r.titre, body: r.note });
  notificationsVivantes.add(n);
  n.on('click', () => { notificationsVivantes.delete(n); ouvrirDepuisRappel(r); });
  n.on('close', () => notificationsVivantes.delete(n));
  n.show();
}

// Affiche les rappels échus (y compris pendant une mise en veille), puis
// arme un seul minuteur pour le prochain, plafonné à un jour.
function armerRappels() {
  clearTimeout(minuteurRappels);
  minuteurRappels = null;
  const maintenant = Date.now();
  for (const r of rappels) {
    if (r.quand <= maintenant && !rappelsSonnes.has(r.id)) {
      rappelsSonnes.add(r.id);
      sonner(r);
    }
  }
  rappels = rappels.filter((r) => r.quand > maintenant);
  if (!rappels.length) return;
  const prochain = Math.min(...rappels.map((r) => r.quand));
  minuteurRappels = setTimeout(armerRappels, Math.min(Math.max(prochain - maintenant, 0), 24 * 60 * 60 * 1000));
}

ipcMain.handle('rappels:programmer', (event, liste) => {
  if (!Array.isArray(liste)) return false;
  // D'abord ce qui était dû avant ce nouveau calendrier (retour de veille).
  armerRappels();
  rappels = liste.slice(0, 100).flatMap((r) => {
    if (!r || !Number.isInteger(r.id) || !Number.isFinite(r.quand)) return [];
    if (!acces.verifier(r.chemin, MARKDOWN)) return [];
    return [{
      id: r.id,
      quand: r.quand,
      titre: texteCourt(r.titre, 300) || 'Reminder',
      note: texteCourt(r.note, 200),
      chemin: r.chemin,
      ligne: Number.isInteger(r.ligne) && r.ligne > 0 ? r.ligne : 1,
      brut: texteCourt(r.brut, 2000),
    }];
  });
  armerRappels();
  return true;
});

ipcMain.handle('rappels:en-attente', () => {
  const o = ouvertureRappel;
  ouvertureRappel = null;
  return o;
});

app.whenReady().then(() => powerMonitor.on('resume', () => armerRappels()));

// Window opacity
ipcMain.handle('set-window-opacity', (event, opacity) => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setOpacity(Math.max(0.3, Math.min(1, opacity)));
  }
});

// YouTube transcript via yt-dlp
ipcMain.handle('yt-dlp-transcript', async (event, videoId) => {
  // L'identifiant entre dans un chemin et une URL : rien d'autre qu'un identifiant YouTube.
  if (typeof videoId !== 'string' || !/^[\w-]{6,20}$/.test(videoId)) return { ok: false, error: 'Invalid video id' }
  const os = require('os')
  const tmpDir = os.tmpdir()
  const outPath = path.join(tmpDir, `lector-yt-${videoId}`)
  const ytUrl = `https://www.youtube.com/watch?v=${videoId}`

  try {
    // Titre + sous-titres en un seul appel yt-dlp
    // On demande fr uniquement (auto-generated ou manual)
    const title = await new Promise((resolve) => {
      execFile('yt-dlp', ['--get-title', '--no-warnings', ytUrl], { timeout: 15000 }, (err, stdout) => {
        resolve(err ? videoId : stdout.trim())
      })
    })

    // Nettoyer les anciens fichiers
    const dir = path.dirname(outPath)
    const prefix = path.basename(outPath)
    try {
      fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.srv1')).forEach(f => fs.unlinkSync(path.join(dir, f)))
    } catch {}

    // Extraire les sous-titres FR (auto + manual)
    await new Promise((resolve) => {
      execFile('yt-dlp', [
        '--write-auto-sub', '--write-sub',
        '--sub-lang', 'fr',
        '--sub-format', 'srv1',
        '--skip-download',
        '--no-warnings',
        '-o', outPath,
        ytUrl,
      ], { timeout: 30000 }, () => resolve())
    })

    // Chercher le fichier généré
    const files = fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.srv1'))

    // Si pas de FR, essayer EN
    if (files.length === 0) {
      await new Promise((resolve) => {
        execFile('yt-dlp', [
          '--write-auto-sub', '--write-sub',
          '--sub-lang', 'en',
          '--sub-format', 'srv1',
          '--skip-download',
          '--no-warnings',
          '-o', outPath,
          ytUrl,
        ], { timeout: 30000 }, () => resolve())
      })
      files.push(...fs.readdirSync(dir).filter(f => f.startsWith(prefix) && f.endsWith('.srv1')))
    }

    let xml = ''
    let lang = 'fr'
    if (files.length > 0) {
      const subFile = path.join(dir, files[0])
      xml = fs.readFileSync(subFile, 'utf-8')
      const langMatch = files[0].match(/\.(\w{2,3})\.srv1$/)
      if (langMatch) lang = langMatch[1]
      try { fs.unlinkSync(subFile) } catch {}
    }

    if (!xml) return { ok: false, error: 'No subtitles found for this video' }

    return { ok: true, xml, title, lang }
  } catch (err) {
    return { ok: false, error: err.message }
  }
})

// Export EPUB d'un fichier, enregistré où l'utilisateur le choisit
ipcMain.handle('export-file-epub', async (event, filePath) => {
  try {
    if (!acces.verifier(filePath, MARKDOWN)) return { success: false, error: 'Path not allowed' };
    const fileName = path.basename(filePath, '.md');
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${fileName}.epub`,
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });
    if (result.canceled) return { success: false, canceled: true };

    const exportResult = await exportFileToEpub(filePath, result.filePath);
    shell.showItemInFolder(result.filePath);
    return exportResult;
  } catch (error) {
    console.error('EPUB export error:', error);
    return { success: false, error: error.message };
  }
});

// Export EPUB d'un dossier
ipcMain.handle('export-folder-epub', async (event, folderPath) => {
  try {
    if (!acces.verifier(folderPath)) return { success: false, error: 'Path not allowed' };
    const folderName = path.basename(folderPath);
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: `${folderName}.epub`,
      filters: [{ name: 'EPUB', extensions: ['epub'] }],
    });

    if (result.canceled) return { success: false, canceled: true };

    const exportResult = await exportFolderToEpub(folderPath, result.filePath);

    // Optionally reveal in Finder
    shell.showItemInFolder(result.filePath);

    return exportResult;
  } catch (error) {
    console.error('EPUB export error:', error);
    return { success: false, error: error.message };
  }
});

// ====== Lector Vault : synchro par la chaîne, clés API ======
//
// Sans compte : la chaîne est la seule identité. Toute la cryptographie tourne
// ici, dans le processus principal ; le renderer reçoit les 12 mots et le code
// seulement pour les afficher (création, ou « Ajouter un appareil » verrou
// ouvert), jamais S. Les clés API restent aussi ici : le main fait les appels.

const DEFAULT_SERVER_URL = 'https://lector.dockerbop.fr';

// Pile réseau de Chromium : les requêtes suivent les certificats du système.
const systemFetch = (url, opts) => net.fetch(url, opts);

function saveCloudCreds(creds) {
  cloudCreds = creds;
  cloudStore.save(creds);
}

function sendCloudEvent(event) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('cloud:event', event);
}

function attachSyncManagerForwarders(sm) {
  sm.on('status', (status) => sendCloudEvent({ type: 'status', status }));
  sm.on('sync-complete', (payload) => sendCloudEvent({ type: 'sync-complete', ...payload }));
  sm.on('error', (err) => {
    const cause = err?.cause?.message || err?.cause?.code;
    const msg = err?.message || String(err);
    const display = cause && cause !== msg ? `${msg}: ${cause}` : msg;
    debugLog('SyncManager error: ' + display + (err?.stack ? '\n' + err.stack : ''));
    sendCloudEvent({ type: 'error', message: display, code: sm.lastErrorCode });
  });
  sm.on('vault-event', (e) => sendCloudEvent({ type: 'vault-event', ...e }));
  // Casier plein : un seul événement à l'entrée dans cet état.
  sm.on('quota', (e) => sendCloudEvent({ type: 'quota', ...e }));
  // Casier renouvelé ou effacé ailleurs : synchro arrêtée sans rien toucher, l'écran propose de rejoindre.
  sm.on('chain-block', (e) => sendCloudEvent({ type: 'chain-block', ...e }));
  sm.on('log', (msg) => debugLog('SyncManager: ' + msg));
}

async function startSyncManager() {
  if (syncManager) return syncManager;
  if (!cloudCreds.chainSecret || !cloudCreds.vaultPath) return null;
  syncManager = new SyncManager({
    vaultPath: cloudCreds.vaultPath,
    serverUrl: cloudCreds.serverUrl || DEFAULT_SERVER_URL,
    chainSecret: cloudCreds.chainSecret, // S reste dans le processus principal
    deviceId: cloudCreds.deviceId,
    fetchImpl: systemFetch,
  });
  attachSyncManagerForwarders(syncManager);
  await syncManager.start();
  return syncManager;
}

async function stopSyncManager() {
  if (!syncManager) return;
  const sm = syncManager;
  syncManager = null;
  try { await sm.stop(); } catch (err) { debugLog('SyncManager.stop error: ' + err.message); }
  sm.removeAllListeners();
}

ipcMain.handle('cloud:status', () => ({
  // Jamais S lui-même : seulement le fait qu'il est là (docs/CHAINE.md § 10).
  hasChain: !!cloudCreds.chainSecret,
  chainId: cloudCreds.chainId || null,
  chainPending: cloudCreds.chainPendingSecret ? (cloudCreds.chainSecret ? 'rotate' : 'create') : null,
  chainSaved: !!cloudCreds.chainSaved,
  vaultPath: cloudCreds.vaultPath || null,
  serverUrl: cloudCreds.serverUrl || DEFAULT_SERVER_URL,
  sync: syncManager ? syncManager.getStatus() : null,
  secureStorage: cloudStore.isEncrypted(),
}));

ipcMain.handle('cloud:select-vault', async () => {
  if (!mainWindow) return { ok: false, error: 'No window' };
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose the Lector Vault folder',
    defaultPath: cloudCreds.vaultPath || path.join(app.getPath('home'), 'lector-vault'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { ok: false, canceled: true };
  const vaultPath = result.filePaths[0];
  const autreDossier = vaultPath !== cloudCreds.vaultPath;
  saveCloudCreds({ ...cloudCreds, vaultPath });
  if (autreDossier && syncManager) {
    await stopSyncManager();
    try { await startSyncManager(); } catch (err) { debugLog('cloud:select-vault restart error: ' + err.message); }
  }
  return { ok: true, vaultPath };
});

ipcMain.handle('cloud:start-sync', async () => {
  try {
    if (!cloudCreds.chainSecret) return { ok: false, code: 'NO_SECRET', error: 'No chain on this device' };
    if (!cloudCreds.vaultPath) return { ok: false, code: 'NO_VAULT', error: 'No vault selected' };
    if (syncManager && syncManager.state === 'running') return { ok: true, alreadyRunning: true };
    await stopSyncManager();
    await startSyncManager();
    return { ok: true };
  } catch (err) {
    debugLog('cloud:start-sync error: ' + err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('cloud:stop-sync', async () => {
  await stopSyncManager();
  return { ok: true };
});

// ----- Verrou avant d'afficher les 12 mots, de renouveler la chaîne ou de tout effacer -----
// Touch ID sur un Mac qui l'a ; ailleurs, une confirmation explicite dans
// l'écran ouvre le verrou 60 s (les mots sont masqués ensuite).
let cloudAuthExpiresAt = 0;
const TOUCH_ID_TTL_MS = 5 * 60 * 1000;
const CONFIRM_TTL_MS = 60 * 1000;

function canTouchId() {
  if (process.platform !== 'darwin') return false;
  try { return systemPreferences.canPromptTouchID(); } catch { return false; }
}

ipcMain.handle('cloud:auth-status', () => {
  const unlocked = Date.now() < cloudAuthExpiresAt;
  return { unlocked, expiresAt: unlocked ? cloudAuthExpiresAt : 0, canTouchId: canTouchId() };
});

ipcMain.handle('cloud:lock', () => {
  cloudAuthExpiresAt = 0;
  return { ok: true };
});

ipcMain.handle('cloud:auth-touchid', async () => {
  if (!canTouchId()) return { ok: false, code: 'TOUCH_ID_UNAVAILABLE', error: 'Touch ID not available' };
  try {
    await systemPreferences.promptTouchID('unlock your Lector sync chain');
    cloudAuthExpiresAt = Date.now() + TOUCH_ID_TTL_MS;
    return { ok: true, expiresAt: cloudAuthExpiresAt };
  } catch (err) {
    return { ok: false, code: 'TOUCH_ID_FAILED', error: err.message || 'Touch ID prompt failed' };
  }
});

ipcMain.handle('cloud:auth-confirm', () => {
  if (canTouchId()) return { ok: false, code: 'TOUCH_ID_REQUIRED', error: 'Use Touch ID on this Mac' };
  cloudAuthExpiresAt = Date.now() + CONFIRM_TTL_MS;
  return { ok: true, expiresAt: cloudAuthExpiresAt };
});

// ----- Chaîne de sync (docs/CHAINE.md) -----
const chaineDesktop = new ChaineDesktop({
  getCreds: () => cloudCreds,
  saveCreds: saveCloudCreds,
  fetchImpl: systemFetch,
  arreterSynchro: stopSyncManager,
  demarrerSynchro: async () => {
    try { await startSyncManager(); } catch (err) { debugLog('Sync start error: ' + err.message); }
  },
  verrouOuvert: () => Date.now() < cloudAuthExpiresAt,
  stockageSur: () => cloudStore.isEncrypted(),
  emettre: sendCloudEvent,
  log: debugLog,
  serverUrlParDefaut: DEFAULT_SERVER_URL,
  effacerClesApi: () => { for (const service of keysStore.SERVICES) keysStore.effacer(service); },
  mettreALaCorbeille: corbeilleVault,
});

// « Tout effacer », case cochée : le dossier du vault part à la corbeille du
// système, jamais de suppression définitive. Refuse tout dossier qui est, ou
// qui contient, la racine, le dossier personnel, les données de l'app ou l'app
// elle-même (par exemple /Users ou ~/Library), et tout ce qui n'est pas un
// dossier. Les liens symboliques sont résolus avant la comparaison.
function reel(p) {
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}

function contientOuEgal(parent, enfant) {
  const rel = path.relative(parent, enfant);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

async function corbeilleVault(dossier) {
  const refus = (message) => Object.assign(new Error(message), { code: 'TRASH_REFUSED' });
  if (!dossier) throw refus('Refusing to move this folder');
  const cible = reel(path.resolve(String(dossier)));
  if (path.parse(cible).root === cible) throw refus('Refusing to move this folder');
  const proteges = [app.getPath('home'), app.getPath('userData'), app.getAppPath(), path.dirname(app.getPath('exe'))].map(reel);
  if (proteges.some((p) => contientOuEgal(cible, p))) throw refus('Refusing to move this folder');
  if (!fs.statSync(cible).isDirectory()) throw refus('Not a folder');
  // Les watchers du vault ne doivent pas suivre le dossier dans la corbeille
  // ni signaler au renderer un dossier qui n'existe plus à son ancien chemin.
  if (dirWatcher) { try { dirWatcher.close(); } catch {} dirWatcher = null; }
  if (syncWatcher) { try { syncWatcher.close(); } catch {} syncWatcher = null; }
  if (fileWatcher && currentOpenFilePath && contientOuEgal(cible, reel(currentOpenFilePath))) {
    try { fileWatcher.close(); } catch {}
    fileWatcher = null;
  }
  await shell.trashItem(cible);
}

ipcMain.handle('cloud:chain-state', () => chaineDesktop.etat());
ipcMain.handle('cloud:chain-prepare', () => chaineDesktop.preparer());
ipcMain.handle('cloud:chain-create', () => chaineDesktop.creer());
ipcMain.handle('cloud:chain-join', (event, saisie) => chaineDesktop.rejoindre(saisie));
ipcMain.handle('cloud:chain-saved', () => chaineDesktop.marquerSauvegardee());
ipcMain.handle('cloud:chain-export', () => chaineDesktop.exporter());
ipcMain.handle('cloud:chain-verify', () => chaineDesktop.verifier());
ipcMain.handle('cloud:chain-rotate', () => chaineDesktop.renouveler());
ipcMain.handle('cloud:chain-abandon', () => chaineDesktop.abandonner());
ipcMain.handle('cloud:chain-erase', (event, confirmation, options) => chaineDesktop.effacerTout(confirmation, { localFolder: options?.localFolder === true }));
ipcMain.handle('cloud:chain-leave', () => chaineDesktop.quitter());

// ----- Clés API personnelles (Anthropic, ElevenLabs) -----
// La clé ne revient jamais au renderer : keys:get ne donne que sa présence et
// ses 4 derniers caractères, et les appels partent d'ici par net.fetch.
const echecFournisseur = (err) => ({ code: err?.code || 'API_ERROR', error: err?.message || String(err) });

ipcMain.handle('keys:get', (event, service) => {
  try { return keysStore.statut(service); } catch { return { present: false, hint: null, secure: cloudStore.isEncrypted() }; }
});

ipcMain.handle('keys:set', (event, service, value) => {
  try {
    keysStore.enregistrer(service, value);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('keys:clear', (event, service) => {
  try {
    keysStore.effacer(service);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('keys:test', async (event, service) => {
  try {
    const { anthropic, elevenlabs } = await chargerFournisseurs();
    const cle = keysStore.lire(service);
    if (service === 'anthropic') await anthropic.listerModeles({ fetch: systemFetch, cle, navigateur: false });
    else await elevenlabs.verifierCle({ fetch: systemFetch, cle });
    return { ok: true };
  } catch (err) {
    return { ok: false, ...echecFournisseur(err) };
  }
});

async function demanderAnthropic({ system, messages, model, effort }) {
  try {
    const { anthropic } = await chargerFournisseurs();
    const result = await anthropic.demanderMessages({
      fetch: systemFetch,
      cle: keysStore.lire('anthropic'),
      modele: model,
      effort,
      system,
      messages: Array.isArray(messages) ? messages : [],
      navigateur: false,
    });
    return { success: true, result };
  } catch (err) {
    return { success: false, ...echecFournisseur(err) };
  }
}

ipcMain.handle('ai:ask', (event, req = {}) => demanderAnthropic(req));
ipcMain.handle('ai:generate', (event, prompt, options = {}) =>
  demanderAnthropic({ messages: [{ role: 'user', content: String(prompt || '') }], model: options.model, effort: options.effort }));
ipcMain.handle('ai:models', async () => {
  try {
    const { anthropic } = await chargerFournisseurs();
    return { ok: true, models: await anthropic.listerModeles({ fetch: systemFetch, cle: keysStore.lire('anthropic'), navigateur: false }) };
  } catch (err) {
    return { ok: false, ...echecFournisseur(err) };
  }
});

ipcMain.handle('tts:voices', async () => {
  try {
    const { elevenlabs } = await chargerFournisseurs();
    return { ok: true, voices: await elevenlabs.listerVoix({ fetch: systemFetch, cle: keysStore.lire('elevenlabs') }) };
  } catch (err) {
    return { ok: false, ...echecFournisseur(err) };
  }
});

ipcMain.handle('tts:synthesize', async (event, text, voiceId) => {
  try {
    const { elevenlabs } = await chargerFournisseurs();
    const audio = await elevenlabs.synthetiser({ fetch: systemFetch, cle: keysStore.lire('elevenlabs'), texte: String(text || ''), voix: voiceId });
    return { ok: true, audio };
  } catch (err) {
    return { ok: false, ...echecFournisseur(err) };
  }
});

// Synchro au démarrage si cet appareil a une chaîne et un vault.
app.whenReady().then(() => {
  // Au tour suivant : les réglages sont chargés dans le bloc whenReady principal.
  setTimeout(async () => {
    if (cloudCreds.chainSecret && cloudCreds.vaultPath) {
      debugLog('Starting vault sync at boot');
      try { await startSyncManager(); }
      catch (err) { debugLog('Boot sync failed: ' + err.message); }
    }
  }, 500);

  // Sortie de veille : macOS suspend les sockets en veille profonde, ce qui
  // laisse le flux et le watcher à moitié morts. On reconstruit la synchro.
  powerMonitor.on('resume', async () => {
    if (!syncManager) return;
    debugLog('System resumed from sleep: restarting sync');
    await stopSyncManager();
    try { await startSyncManager(); }
    catch (err) { debugLog('Resume restart failed: ' + err.message); }
  });
});
