// Lector sur Mac, façon Proton Drive :
// - la fenêtre affiche la web app en ligne (https://lector.sidali.dev/), dans
//   une session à elle ; son service worker l'ouvre tout de suite, même hors
//   ligne ;
// - en arrière-plan, un dossier de notes .md reste synchronisé avec le casier
//   de la chaîne, dans les deux sens (sync-manager.js), fenêtre fermée comprise ;
// - un pont minimal (preload.js, window.lectorDesktop) relie les deux : la web
//   app se connecte avec la chaîne de ce Mac, ou lui transmet la sienne.
//
// Variables de test (jamais utilisées par l'app installée en temps normal) :
//   LECTOR_TEST_USER_DATA  dossier de données jetable (et trousseau simulé)
//   LECTOR_APP_URL         adresse de l'interface (serveur Vite local)
//   LECTOR_SERVER_URL      relais de la synchro (API de test)
//   LECTOR_UPDATE_URL      flux des mises à jour

const { app, BrowserWindow, ipcMain, dialog, Menu, shell, net, safeStorage, powerMonitor, nativeTheme, Notification, session, screen } = require('electron')
const path = require('path')
const fs = require('fs')
const cloudStore = require('./cloud-store')
const { SyncManager } = require('./sync-manager')
const { ChaineDesktop } = require('./chaine-desktop')
const { poserIcone } = require('./icone-dossier')

if (process.env.LECTOR_TEST_USER_DATA) {
  app.setPath('userData', process.env.LECTOR_TEST_USER_DATA)
  // Trousseau simulé : un test ne touche jamais au Trousseau de l'utilisateur.
  app.commandLine.appendSwitch('use-mock-keychain')
}

const URL_APP = process.env.LECTOR_APP_URL || 'https://lector.sidali.dev/'
const ORIGINE_APP = new URL(URL_APP).origin
const URL_MISES_A_JOUR = process.env.LECTOR_UPDATE_URL || 'https://lector.sidali.dev/releases'
const SERVEUR_PAR_DEFAUT = process.env.LECTOR_SERVER_URL || 'https://lector.dockerbop.fr'
const PARTITION = 'persist:lector'
const SIX_HEURES = 6 * 60 * 60 * 1000

// --- Journal (userData/lector-debug.log, 5 Mo au plus, une rotation) ---
let logFile = null
let logBytes = 0
const LOG_MAX_BYTES = 5 * 1024 * 1024
function debugLog(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log(msg)
  if (!logFile) return
  try {
    const len = Buffer.byteLength(line)
    if (logBytes + len > LOG_MAX_BYTES) {
      try { fs.renameSync(logFile, logFile + '.1') } catch { try { fs.unlinkSync(logFile) } catch {} }
      logBytes = 0
    }
    fs.appendFileSync(logFile, line)
    logBytes += len
  } catch {}
}

const origine = (u) => { try { return new URL(u).origin } catch { return null } }

// --- Une seule instance ---
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) { createWindow(); return }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })
}

let mainWindow = null
let creds = {}

// ====== Ouverture à la connexion (comme Proton Drive) ======
// Activée d'office dès qu'un dossier est en synchro (installation existante
// comprise), tant que l'utilisateur ne l'a pas décochée dans le menu. Lancée
// ainsi, l'app démarre sans fenêtre : seule la synchro tourne, le Dock la rouvre.
// En test ou hors app installée, rien n'est inscrit dans le système.

const fichierReglages = () => path.join(app.getPath('userData'), 'reglages.json')
function lireReglages() { try { return JSON.parse(fs.readFileSync(fichierReglages(), 'utf8')) || {} } catch { return {} } }
function ecrireReglages(r) { try { fs.writeFileSync(fichierReglages(), JSON.stringify(r)) } catch {} }
const inscriptionSysteme = () => app.isPackaged && !process.env.LECTOR_TEST_USER_DATA

function ouvertureAuDemarrage() {
  const r = lireReglages()
  if (typeof r.openAtLogin === 'boolean') return r.openAtLogin
  return !!creds.vaultPath
}

function appliquerOuverture(actif) {
  if (!inscriptionSysteme()) return
  try { app.setLoginItemSettings({ openAtLogin: actif, openAsHidden: true }) } catch (err) { debugLog('Login item: ' + err.message) }
}

function choisirOuverture(actif) {
  ecrireReglages({ ...lireReglages(), openAtLogin: actif })
  appliquerOuverture(actif)
  majMenu()
}

/** Lancée par la session (ouverture à la connexion) : pas de fenêtre. */
function lanceeEnArrierePlan() {
  if (process.argv.includes('--lector-hidden')) return true
  if (!inscriptionSysteme()) return false
  try {
    const l = app.getLoginItemSettings()
    return !!(l.wasOpenedAtLogin || l.wasOpenedAsHidden)
  } catch { return false }
}

// ====== Fenêtre : la web app ======

const fichierFenetre = () => path.join(app.getPath('userData'), 'fenetre.json')

function lireFenetre() {
  try {
    const f = JSON.parse(fs.readFileSync(fichierFenetre(), 'utf8'))
    const visible = screen.getAllDisplays().some((d) => {
      const a = d.workArea
      return f.x < a.x + a.width && f.x + f.width > a.x && f.y < a.y + a.height && f.y + f.height > a.y
    })
    if (Number.isFinite(f.width) && Number.isFinite(f.height) && visible) return f
  } catch {}
  return null
}

function garderFenetre(win) {
  let minuteur = null
  const sauver = () => {
    clearTimeout(minuteur)
    minuteur = setTimeout(() => {
      if (win.isDestroyed()) return
      const b = win.getNormalBounds()
      try { fs.writeFileSync(fichierFenetre(), JSON.stringify({ ...b, maximized: win.isMaximized() })) } catch {}
    }, 400)
  }
  for (const e of ['resize', 'move', 'maximize', 'unmaximize']) win.on(e, sauver)
}

function pageHorsLigne() {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.loadFile(path.join(__dirname, 'hors-ligne.html'), { query: { url: URL_APP } })
}

function createWindow() {
  const f = lireFenetre()
  mainWindow = new BrowserWindow({
    width: f?.width || 1280,
    height: f?.height || 860,
    x: f?.x,
    y: f?.y,
    minWidth: 720,
    minHeight: 520,
    show: false,
    title: 'Lector',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    // Fond de la charte avant la première image : crème miel ou sapin nuit.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#12201A' : '#FBF7EF',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: true,
      devTools: !app.isPackaged,
      // Le pont n'est exposé qu'à cette origine (preload.js).
      additionalArguments: [`--lector-origine=${ORIGINE_APP}`],
    },
  })
  if (f?.maximized) mainWindow.maximize()
  garderFenetre(mainWindow)
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  const wc = mainWindow.webContents

  // Toute première ouverture sans réseau (pas encore de service worker) : une
  // petite page propose de réessayer, et réessaie seule au retour du réseau.
  wc.on('did-fail-load', (_e, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* ABORTED */) return
    if (origine(url) !== ORIGINE_APP) return
    debugLog(`Interface unavailable (${description}): offline page`)
    pageHorsLigne()
  })

  // La fenêtre reste sur la web app (/d/<id>#clé compris) ; tout autre site
  // s'ouvre dans le navigateur du système.
  wc.on('will-navigate', (event, url) => {
    if (origine(url) === ORIGINE_APP) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })
  wc.setWindowOpenHandler(({ url }) => {
    if (origine(url) === ORIGINE_APP) wc.loadURL(url)
    else if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })

  wc.on('context-menu', (_e, p) => {
    const texte = p.selectionText.trim()
    Menu.buildFromTemplate([
      ...(p.isEditable ? [{ role: 'cut', enabled: p.editFlags.canCut }] : []),
      { role: 'copy', enabled: p.editFlags.canCopy },
      ...(p.isEditable ? [{ role: 'paste', enabled: p.editFlags.canPaste }] : []),
      { role: 'selectAll' },
      { type: 'separator' },
      {
        label: 'Search the web',
        enabled: texte.length > 0,
        click: () => shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(texte)}`),
      },
    ]).popup()
  })

  mainWindow.loadURL(URL_APP)
}

// Permissions : seulement ce dont la web app se sert (copier les 12 mots et
// vider le presse-papiers ensuite, rappels, plein écran), et seulement pour elle.
const PERMISSIONS = new Set(['clipboard-sanitized-write', 'clipboard-read', 'notifications', 'fullscreen'])
function reglerSession() {
  const s = session.fromPartition(PARTITION)
  s.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(PERMISSIONS.has(permission) && origine(details?.requestingUrl || wc.getURL()) === ORIGINE_APP)
  })
  s.setPermissionCheckHandler((_wc, permission, requestingOrigin) => PERMISSIONS.has(permission) && origine(requestingOrigin) === ORIGINE_APP)
}

// ====== Synchro du dossier ======

const systemFetch = (url, opts) => net.fetch(url, opts)
let syncManager = null
let arretEnCours = false

function saveCreds(c) {
  creds = c
  cloudStore.save(c)
  majMenu()
}

async function startSyncManager() {
  if (syncManager) return syncManager
  if (!creds.chainSecret || !creds.vaultPath) return null
  const sm = new SyncManager({
    vaultPath: creds.vaultPath,
    serverUrl: creds.serverUrl || SERVEUR_PAR_DEFAUT,
    chainSecret: creds.chainSecret, // S reste dans le processus principal
    deviceId: creds.deviceId,
    fetchImpl: systemFetch,
  })
  syncManager = sm
  iconeDuDossier(creds.vaultPath)
  sm.on('status', majMenu)
  sm.on('sync-complete', majMenu)
  sm.on('error', (err) => { debugLog('Sync error: ' + (err?.message || err)); majMenu() })
  sm.on('chain-block', (e) => { debugLog('Sync stopped: ' + e?.code); majMenu() })
  sm.on('quota', majMenu)
  sm.on('log', (msg) => debugLog('Sync: ' + msg))
  await sm.start()
  majMenu()
  return sm
}

// Icône Lector sur le dossier (une fois, jamais par-dessus l'icône de quelqu'un d'autre).
async function iconeDuDossier(dossier) {
  const r = lireReglages()
  const etat = await poserIcone(dossier, { dejaPosee: r.iconeDossier === dossier })
  if (etat === 'posee') ecrireReglages({ ...lireReglages(), iconeDossier: dossier })
  if (etat !== 'deja') debugLog('Folder icon: ' + etat)
}

async function stopSyncManager() {
  if (!syncManager) return
  const sm = syncManager
  syncManager = null
  try { await sm.stop() } catch (err) { debugLog('Sync stop error: ' + err.message) }
  sm.removeAllListeners()
  majMenu()
}

const chaineDesktop = new ChaineDesktop({
  getCreds: () => creds,
  saveCreds,
  fetchImpl: systemFetch,
  arreterSynchro: stopSyncManager,
  demarrerSynchro: async () => {
    try { await startSyncManager() } catch (err) { debugLog('Sync start error: ' + err.message) }
  },
  verrouOuvert: () => false, // aucune opération sous verrou n'est exposée
  stockageSur: () => cloudStore.isEncrypted(),
  log: debugLog,
  serverUrlParDefaut: SERVEUR_PAR_DEFAUT,
})

async function choisirDossier() {
  if (!creds.chainSecret) {
    await dialog.showMessageBox({
      type: 'info',
      message: 'Sign in first',
      detail: 'Create your key or sign in with your 12 words in the Lector window, then choose the folder to keep in sync.',
    })
    return
  }
  const defaut = path.join(app.getPath('home'), 'Lector Vault')
  const r = await dialog.showOpenDialog({
    title: 'Keep a folder in sync',
    message: 'Your notes (.md files) in this folder stay in sync with your other devices.',
    buttonLabel: 'Keep in Sync',
    defaultPath: creds.vaultPath || defaut,
    properties: ['openDirectory', 'createDirectory'],
  })
  if (r.canceled || !r.filePaths[0]) return
  await adopterDossier(r.filePaths[0])
}

async function adopterDossier(dossier) {
  if (dossier === creds.vaultPath && syncManager) return
  await stopSyncManager()
  saveCreds({ ...creds, vaultPath: dossier })
  // Premier dossier en synchro : ouverture à la connexion, sauf refus déjà exprimé.
  if (ouvertureAuDemarrage()) appliquerOuverture(true)
  try { await startSyncManager() } catch (err) { debugLog('Sync start error: ' + err.message) }
}

async function arreterDossier() {
  if (!creds.vaultPath) return
  const r = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Stop Syncing', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Stop syncing this folder?',
    detail: `${creds.vaultPath}\n\nThe folder and its notes stay on this Mac, and your notes stay on your other devices.`,
  })
  if (r.response !== 0) return
  await stopSyncManager()
  const suite = { ...creds }
  delete suite.vaultPath
  saveCreds(suite)
}

// ====== Pont avec l'interface (window.lectorDesktop) ======

function depuisInterface(event) {
  const frame = event.senderFrame
  return !!frame && frame === mainWindow?.webContents.mainFrame && origine(frame.url) === ORIGINE_APP
}
const refus = { ok: false, code: 'FORBIDDEN' }

ipcMain.handle('bureau:mots', (event) => (depuisInterface(event) ? chaineDesktop.motsPourInterface() : refus))
ipcMain.handle('bureau:connectee', (event, chainId) => (depuisInterface(event) ? chaineDesktop.marquerInterfaceConnectee(String(chainId || '')) : refus))
// La fenêtre utilise une autre clé que le dossier : ses mots restent en mémoire
// (jamais sur le disque) jusqu'à ce que l'utilisateur choisisse, dans le menu,
// de passer le dossier sur cette clé, ou que l'app quitte.
let cleDeLaFenetre = null

ipcMain.handle('bureau:garder', async (event, saisie) => {
  if (!depuisInterface(event)) return refus
  const texte = String(saisie || '')
  const r = await chaineDesktop.garderDepuisInterface(texte)
  debugLog('Chain from the interface: ' + (r.ok ? 'kept' : r.code))
  cleDeLaFenetre = r.code === 'HAS_CHAIN' ? texte : null
  majMenu()
  return r.ok ? { ok: true } : { ok: false, code: r.code }
})

async function utiliserCleDeLaFenetre({ confirmer = true } = {}) {
  if (!cleDeLaFenetre) return { ok: false, code: 'NOTHING' }
  if (confirmer) {
    const dossier = creds.vaultPath ? creds.vaultPath.replace(app.getPath('home'), '~') : null
    const r = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Use This Key', 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      message: 'Use the key of this window for the folder?',
      detail: (dossier ? `The folder ${dossier} will sync with the key you used in the Lector window. All its notes are sent to that key's storage.` : 'This Mac will sync with the key you used in the Lector window.')
        + '\n\nThe storage of the previous key is not erased: devices that still use it keep their notes.',
    })
    if (r.response !== 0) return { ok: false, code: 'CANCELED' }
  }
  const r = await chaineDesktop.passerSurChaine(cleDeLaFenetre)
  debugLog('Folder moved to the key of the window: ' + (r.ok ? 'done' : r.code))
  if (r.ok) cleDeLaFenetre = null
  else if (confirmer) dialog.showMessageBox({ type: 'warning', message: 'The folder could not change key', detail: 'Check your connection and try again.' })
  majMenu()
  return r
}

// ====== Mises à jour ======

let autoUpdater = null
let versionPrete = null
let verificationManuelle = false

function initMisesAJour() {
  if (!app.isPackaged) return
  try {
    autoUpdater = require('electron-updater').autoUpdater
  } catch (err) {
    debugLog('electron-updater unavailable: ' + err.message)
    return
  }
  autoUpdater.setFeedURL({ provider: 'generic', url: URL_MISES_A_JOUR })
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: debugLog, warn: debugLog, error: debugLog, debug: () => {} }
  autoUpdater.on('update-downloaded', (info) => {
    versionPrete = info?.version || null
    majMenu()
    if (Notification.isSupported()) {
      new Notification({ title: `Lector ${versionPrete || ''} is ready`.replace('  ', ' '), body: 'It will be installed the next time you quit Lector.', silent: true }).show()
    }
  })
  autoUpdater.on('update-not-available', () => {
    if (!verificationManuelle) return
    verificationManuelle = false
    dialog.showMessageBox({ type: 'info', message: 'Lector is up to date', detail: `Version ${app.getVersion()}` })
  })
  autoUpdater.on('update-available', (info) => {
    if (!verificationManuelle) return
    verificationManuelle = false
    dialog.showMessageBox({ type: 'info', message: `Lector ${info?.version} is downloading`, detail: 'It will be installed the next time you quit Lector.' })
  })
  autoUpdater.on('error', (err) => {
    debugLog('Update error: ' + (err?.message || err))
    if (!verificationManuelle) return
    verificationManuelle = false
    dialog.showMessageBox({ type: 'warning', message: 'Could not check for updates', detail: 'Try again later.' })
  })
  const verifier = () => autoUpdater.checkForUpdates().catch((err) => debugLog('Update check failed: ' + err.message))
  verifier()
  setInterval(verifier, SIX_HEURES)
  powerMonitor.on('resume', verifier)
}

function verifierMisesAJour() {
  if (!autoUpdater) {
    dialog.showMessageBox({ type: 'info', message: 'Updates are checked in the installed app only.' })
    return
  }
  if (versionPrete) {
    autoUpdater.quitAndInstall()
    return
  }
  verificationManuelle = true
  autoUpdater.checkForUpdates().catch(() => {})
}

// ====== Menus ======

function etatSynchro() {
  if (!creds.chainSecret) return 'Not signed in'
  if (!creds.vaultPath) return 'No folder in sync'
  const s = syncManager?.getStatus()
  if (s?.lastErrorCode || s?.lastError) return `Sync error: ${s.lastErrorCode || s.lastError}`
  if (s?.lastSyncAt) return `Last sync: ${new Date(s.lastSyncAt).toLocaleString()}`
  return syncManager ? 'Syncing…' : 'Sync stopped'
}

let menuEnAttente = false
function majMenu() {
  if (menuEnAttente) return
  menuEnAttente = true
  setTimeout(() => {
    menuEnAttente = false
    if (app.isReady()) Menu.setApplicationMenu(Menu.buildFromTemplate(modeleMenu()))
  }, 100)
}

function modeleMenu() {
  const dossier = creds.vaultPath
  return [
    {
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Lector' },
        { label: versionPrete ? `Restart to Install Lector ${versionPrete}` : 'Check for Updates…', click: verifierMisesAJour },
        { type: 'separator' },
        { label: 'Open at Login', type: 'checkbox', checked: ouvertureAuDemarrage(), click: (item) => choisirOuverture(item.checked) },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' }]),
      ],
    },
    {
      label: 'Sync',
      submenu: [
        { label: dossier ? `Folder: ${dossier.replace(app.getPath('home'), '~')}` : 'No folder in sync', enabled: false },
        { label: etatSynchro(), enabled: false },
        { type: 'separator' },
        { label: 'Show the Folder in Finder', enabled: !!dossier, click: () => shell.openPath(dossier) },
        { label: dossier ? 'Sync Another Folder…' : 'Keep a Folder in Sync…', click: choisirDossier },
        { label: 'Stop Syncing This Folder', enabled: !!dossier, click: arreterDossier },
        { type: 'separator' },
        { label: 'Use the Key of This Window for the Folder…', enabled: !!cleDeLaFenetre, click: () => utiliserCleDeLaFenetre() },
      ],
    },
    { role: 'windowMenu' },
  ]
}

// ====== Démarrage ======

app.whenReady().then(async () => {
  logFile = path.join(app.getPath('userData'), 'lector-debug.log')
  try { logBytes = fs.statSync(logFile).size } catch { logBytes = 0 }
  debugLog(`Lector ${app.getVersion()} starting, interface ${URL_APP}`)

  // Réglages de la synchro, chiffrés par safeStorage (le même fichier qu'avant :
  // une installation existante garde sa chaîne et son dossier).
  cloudStore.init({ userDataPath: app.getPath('userData'), safeStorage, logger: debugLog })
  cloudStore.nettoyerAnciensFichiers()
  creds = cloudStore.load()

  reglerSession()
  majMenu()
  // Ouverture à la connexion : remise en accord avec le choix (ou le défaut).
  appliquerOuverture(ouvertureAuDemarrage())
  if (!lanceeEnArrierePlan()) createWindow()
  initMisesAJour()

  if (creds.chainSecret && creds.vaultPath) {
    try { await startSyncManager() } catch (err) { debugLog('Sync start error: ' + err.message) }
  }

  // Sortie de veille : macOS suspend les sockets, on reconstruit la synchro.
  powerMonitor.on('resume', async () => {
    if (!syncManager) return
    await stopSyncManager()
    try { await startSyncManager() } catch (err) { debugLog('Sync restart error: ' + err.message) }
  })
})

// Tests seulement (dossier de données jetable) : l'état et le choix du dossier
// sans boîte de dialogue, pour e2e/flows/electron-mac.spec.js.
if (process.env.LECTOR_TEST_USER_DATA) {
  global.__lectorTest = {
    creds: () => ({ hasChain: !!creds.chainSecret, chainId: creds.chainId || null, vaultPath: creds.vaultPath || null, interfaceChainId: creds.interfaceChainId || null }),
    synchro: () => (syncManager ? syncManager.getStatus() : null),
    adopterDossier,
    ouvertureAuDemarrage,
    choisirOuverture,
    cleDeLaFenetreEnAttente: () => !!cleDeLaFenetre,
    utiliserCleDeLaFenetre: () => utiliserCleDeLaFenetre({ confirmer: false }),
  }
}

// Fenêtre fermée : l'app reste (la synchro continue) ; le Dock la rouvre.
// Seul Quitter (⌘Q) arrête la synchro.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('activate', () => {
  if (!mainWindow) createWindow()
})

app.on('before-quit', async (e) => {
  if (!syncManager || arretEnCours) return
  e.preventDefault()
  arretEnCours = true
  await stopSyncManager()
  app.quit()
})
