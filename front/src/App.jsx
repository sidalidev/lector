import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore, lazy, Suspense } from 'react';
import {
  Folder, Sliders, List, X,
  RefreshCw, Info, Share2, History
} from 'lucide-react';
import Sidebar from './components/Sidebar';
import RightSidebar from './components/FloatingTOC';
import ErrorBoundary from './components/ErrorBoundary';
import Tooltip from './components/Tooltip';
import fileSystem from './services/fileSystem';
import storage from './services/storage';
import useTranslation from './hooks/useTranslation'
import { cheminDans } from './utils/chemins'
import * as rappels from './services/rappels'
import { vueAujourdhui } from './services/taches/taches.js'
import { haptique } from './services/haptique'
import { messageChaine } from './utils/messagesErreur'
import { allerALigne, ecrireALaFin, remplacerTexte } from './services/editeurCourant'
import { prechargerEditeur } from './services/prechargement'
import './App.css';

const APP_VERSION = __APP_VERSION__ || '0.0.0'

// La note (éditeur mis en forme, CodeMirror) : hors du premier
// chargement, l'écran d'accueil n'en a pas besoin. Avec une source déjà
// choisie, la vue et l'éditeur partent ensemble dès que le dossier des notes
// est connu (services/prechargement.js) : l'app et l'arbre passent d'abord.
const DocumentView = lazy(() => import('./components/DocumentView'));

// Chargés uniquement quand utilisés
const SearchBar = lazy(() => import('./components/SearchBar'));
const QuickOpen = lazy(() => import('./components/QuickOpen'));
const CommandPalette = lazy(() => import('./components/CommandPalette'));
const GlobalSearch = lazy(() => import('./components/GlobalSearch'));
const ChaineSync = lazy(() => import('./components/ChaineSync'));
const AboutPanel = lazy(() => import('./components/AboutPanel'));
const TodayView = lazy(() => import('./components/TodayView'));
const NewTask = lazy(() => import('./components/NewTask'));
// Co-écriture : chargée à l'ouverture du panneau seulement (Yjs hors du paquet principal).
const SharePanel = lazy(() => import('./components/collab/SharePanel'));
const Historique = lazy(() => import('./components/Historique'));
// Navigateur : la clé de 12 mots tient lieu de compte (créer ou se connecter).
const EntreeWeb = lazy(() => import('./components/EntreeWeb'));
// Ordinateur et mobile seulement : jamais téléchargés par le navigateur.
const NATIF = typeof window !== 'undefined' && (!!window.electron || !!window.Capacitor?.isNativePlatform?.());
const CloudStatusIndicator = lazy(() => import('./components/CloudStatusIndicator'));
// Premier lancement sur ordinateur et mobile : jamais dans le paquet web.
const OnboardingWhere = lazy(() => import('./components/Onboarding').then((m) => ({ default: m.OnboardingWhere })));
const ESTWEB = !fileSystem.isElectron() && !fileSystem.isCapacitor();
// Partage en temps réel : version web d'abord. Sur ordinateur et mobile, le
// document partagé doit encore être relié au fichier .md du vault (docs/collab-design.md § 9).
const PARTAGE_POSSIBLE = typeof window !== 'undefined' && !window.electron && !window.Capacitor?.isNativePlatform?.();

// --- Haptic feedback (iOS) ---
const haptic = (style = 'light') => {
  try {
    // iOS Safari Taptic Engine API
    if (navigator.vibrate) navigator.vibrate(style === 'heavy' ? 20 : 10);
    // Capacitor Haptics plugin (if available)
    if (window.Capacitor?.Plugins?.Haptics) {
      const impact = style === 'heavy' ? 'Heavy' : style === 'medium' ? 'Medium' : 'Light';
      window.Capacitor.Plugins.Haptics.impact({ style: impact });
    }
  } catch { /* ignore */ }
};

// --- Clés de session ---
const SESSION_KEY = 'lector-last-session';
const SOURCE_TYPE_KEY = 'lector-source-type';
const ONBOARDING_DONE_KEY = 'lector-onboarding-done';

// Une source déjà choisie : le premier lancement est derrière l'utilisateur.
// L'ancien écran « Sync your devices? » (clé lector-onboarding) n'existe plus.
try {
  if (localStorage.getItem(SOURCE_TYPE_KEY)) localStorage.setItem(ONBOARDING_DONE_KEY, '1');
  localStorage.removeItem('lector-onboarding');
} catch { /* stockage indisponible */ }
function App() {
  // storage.get(key, default) wraps localStorage with 'lector-' prefix + JSON parse
  const { t } = useTranslation()

  const [currentDoc, setCurrentDoc] = useState(null);
  const [rootDirPath, setRootDirPath] = useState(null);
  const [showSidebar, setShowSidebar] = useState(() => storage.get('showSidebar', true));
  const [showSearch, setShowSearch] = useState(false);

  // New states with persistence
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [focusFolderPath, setFocusFolderPath] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => storage.get('sidebarWidth', 220));
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => storage.get('rightSidebarWidth', 200));
  const [showRightSidebar, setShowRightSidebar] = useState(() => storage.get('showRightSidebar', true));
  const [docInfo, setDocInfo] = useState({ headers: [] });
  const sidebarResizing = useRef(false);
  const rightSidebarResizing = useRef(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePopover, setMobilePopover] = useState(null); // null | 'files' | 'tools' | 'info'
  const [popoverClosing, setPopoverClosing] = useState(false);
  const [showSourcePicker, setShowSourcePicker] = useState(() => !localStorage.getItem(SOURCE_TYPE_KEY));
  const [updateReady, setUpdateReady] = useState(null); // version string or null
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showCloudPanel, setShowCloudPanel] = useState(false);
  // Pourquoi l'écran Synchronisation s'ouvre tout seul (CHAIN_UNKNOWN, NO_CHAIN)
  const [cloudPanelReason, setCloudPanelReason] = useState(null);
  // Casier plein, signalé une fois par le processus principal
  const [quotaAlert, setQuotaAlert] = useState(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  // Tâches : vue Today, ajout rapide, message bref
  const [showToday, setShowToday] = useState(false);
  const [showNewTask, setShowNewTask] = useState(false);
  const [toast, setToast] = useState(null);
  const etatTaches = useSyncExternalStore(rappels.abonner, rappels.etatTaches);
  const todayCount = useMemo(() => {
    const v = vueAujourdhui(etatTaches.taches, Date.now());
    return v.enRetard.length + v.aujourdhui.filter(x => !x.fait).length;
  }, [etatTaches]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth <= 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  // On mobile with no doc, auto-open the files popover
  useEffect(() => {
    if (isMobile && rootDirPath && !currentDoc && !showToday) {
      setMobilePopover('files');
    }
  }, [isMobile, rootDirPath, currentDoc, showToday]);

  const closeMobilePopover = useCallback(() => {
    setPopoverClosing(true);
    setTimeout(() => {
      setMobilePopover(null);
      setPopoverClosing(false);
    }, 150);
  }, []);

  const toggleMobilePopover = useCallback((panel) => {
    haptic('light');
    if (mobilePopover === panel) {
      closeMobilePopover();
    } else {
      setPopoverClosing(false);
      setMobilePopover(panel);
    }
  }, [mobilePopover, closeMobilePopover]);

  // Scroll lock when popover is open: applied via class to avoid layout shift flicker
  useEffect(() => {
    if (!mobilePopover || !isMobile) return;
    // Delay scroll lock until after backdrop starts rendering to avoid flicker
    const raf = requestAnimationFrame(() => {
      document.documentElement.classList.add('mobile-scroll-locked');
    });
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove('mobile-scroll-locked');
    };
  }, [mobilePopover, isMobile]);

  // Pas de reset useEffect pour docInfo: DocumentView publie ses headers
  // via onDocInfo à chaque changement de content (useMemo synchrone + useEffect)

  // Save all preferences in a single debounced effect
  useEffect(() => {
    const t = setTimeout(() => {
      const prefs = { showSidebar, sidebarWidth, rightSidebarWidth, showRightSidebar };
      for (const [k, v] of Object.entries(prefs)) {
        storage.set(k, v);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [showSidebar, sidebarWidth, rightSidebarWidth, showRightSidebar]);

  // Add to history when opening new doc
  const addToHistory = useCallback((doc) => {
    if (!doc) return;
    const newHistory = history.slice(0, historyIndex + 1);
    // Don't add if same as current, et surtout ne PAS bouger l'index dans ce cas
    // (l'ancien code incrémentait l'index même en dédup → historique désynchronisé)
    if (newHistory.length > 0 && newHistory[newHistory.length - 1]?.filePath === doc.filePath) {
      return;
    }
    setHistory([...newHistory, doc]);
    setHistoryIndex(newHistory.length);
  }, [history, historyIndex]);

  const goBack = useCallback(() => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setCurrentDoc(history[historyIndex - 1]);
    }
  }, [historyIndex, history]);

  const goForward = useCallback(() => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setCurrentDoc(history[historyIndex + 1]);
    }
  }, [historyIndex, history]);

  // Vrai dès que l'utilisateur a choisi une source : la restauration de session,
  // asynchrone, ne réaffiche plus le choix de la source par-dessus.
  const sourceChoisie = useRef(false);

  // Restore last session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        await fileSystem.ensurePlatform();

        // Ordinateur : avec une chaîne, on démarre toujours sur le vault synchronisé.
        if (fileSystem.isElectron() && window.electron?.cloud?.status) {
          const { restaurerChaineOrdinateur } = await import('./services/sessionNative');
          if (await restaurerChaineOrdinateur({ sourceChoisie, setRootDirPath, setShowSourcePicker })) return;
        }

        // Navigateur : avec une chaîne, on démarre sur son vault (cloud://).
        if (!fileSystem.isElectron() && !fileSystem.isCapacitor()) {
          try {
            const { aUneChaine } = await import('./services/chaineWeb');
            if (await aUneChaine() && !sourceChoisie.current) {
              setRootDirPath('cloud://');
              setShowSourcePicker(false);
              return;
            }
          } catch {}
        }

        // Une source choisie pendant les attentes ci-dessus reste affichée.
        if (sourceChoisie.current) return;

        // Navigateur sans clé : on se connecte ou on crée sa clé, jamais d'entrée ambiguë.
        if (ESTWEB) {
          setShowSourcePicker(true);
          return;
        }

        // Ordinateur et mobile : chargé à la demande, jamais dans le navigateur.
        const { restaurerSessionNative } = await import('./services/sessionNative');
        await restaurerSessionNative({ setRootDirPath, setShowSourcePicker });
      } catch { /* ignore */ }
    };
    restoreSession();
  }, []);

  // Listen for auto-update ready (Electron + iOS OTA + Android APK). Le
  // service n'existe que sur ordinateur et mobile : chargé à la demande.
  const otaRef = useRef(null);
  useEffect(() => {
    if (!NATIF) return;
    let unsub = null;
    let fini = false;
    import('./services/otaService').then(({ default: ota }) => {
      if (fini) return;
      otaRef.current = ota;
      ota.initialize();
      unsub = ota.onUpdateReady((version) => setUpdateReady(version));
    });
    return () => { fini = true; unsub?.(); };
  }, []);

  // Ordinateur : chaîne renouvelée ou effacée ailleurs (synchro arrêtée sans
  // rien toucher, on ouvre l'écran pour rejoindre) ; casier plein (bandeau).
  useEffect(() => {
    if (!window.electron?.cloud?.onEvent) return;
    return window.electron.cloud.onEvent((evt) => {
      if (evt?.type === 'chain-block') {
        setCloudPanelReason(evt.code === 'CHAIN_UNKNOWN' ? 'CHAIN_UNKNOWN' : null);
        setShowCloudPanel(true);
      }
      if (evt?.type === 'quota') setQuotaAlert(evt);
    });
  }, []);

  // Navigateur : la chaîne n'existe plus (ses clés sont oubliées) ou il n'y en a
  // pas. Le vault cloud:// serait vide et sans issue : retour au choix de la
  // source, avec l'écran Synchronisation qui explique quoi faire.
  const rootDirPathRef = useRef(rootDirPath);
  // Dossier des notes connu : une note va s'ouvrir, l'éditeur se télécharge déjà.
  useEffect(() => { if (rootDirPath) prechargerEditeur(); }, [rootDirPath]);
  rootDirPathRef.current = rootDirPath;
  const quitterVaultWeb = useCallback(() => {
    if (!rootDirPathRef.current?.startsWith('cloud://')) return;
    setCurrentDoc(null);
    setRootDirPath(null);
    localStorage.removeItem(SOURCE_TYPE_KEY);
    localStorage.removeItem(SESSION_KEY);
    setShowSourcePicker(true);
  }, []);
  useEffect(() => {
    const ouvrir = (e) => {
      const code = e.detail?.code || null;
      setCloudPanelReason(code);
      setShowCloudPanel(true);
      // Limite anti-partage : la chaîne reste valable, l'écran explique l'attente.
      if (code !== 'CHAIN_READ_LIMITED') quitterVaultWeb();
    };
    window.addEventListener('lector-chaine-requise', ouvrir);
    return () => window.removeEventListener('lector-chaine-requise', ouvrir);
  }, [quitterVaultWeb]);

  // « Set up sync » depuis le premier lancement, sur le web ou un téléphone :
  // le dossier local d'où l'on vient, dont les notes suivent dans la chaîne.
  const copieVersChaine = useRef(null);

  // Écran Synchronisation : ouvrir le vault (dossier sur ordinateur, cloud:// dans le navigateur)
  const ouvrirVaultSynchronise = useCallback(async (vaultPath) => {
    if (!vaultPath) return;
    sourceChoisie.current = true;
    const source = copieVersChaine.current;
    copieVersChaine.current = null;
    if (vaultPath === 'cloud://' && source && source !== 'cloud://') {
      try {
        const { copierVersChaine } = await import('./services/vaultSetup');
        const r = await copierVersChaine(source);
        if (r.echecs > 0) alert(t(`onboarding.copyFailed.${new Intl.PluralRules('en').select(r.echecs) === 'one' ? 'one' : 'other'}`, { n: r.echecs }));
      } catch (err) {
        console.error('Copy to the sync chain failed:', err);
      }
    }
    try {
      if (window.electron?.setRootDir && vaultPath !== 'cloud://') {
        await window.electron.setRootDir(vaultPath);
      }
      setRootDirPath(vaultPath);
      setShowSourcePicker(false);
      setShowCloudPanel(false);
      setCloudPanelReason(null);
    } catch (err) {
      console.error('Failed to open the synced vault:', err);
    }
  }, []);

  const fermerSynchro = useCallback(() => {
    copieVersChaine.current = null;
    setShowCloudPanel(false);
    setCloudPanelReason(null);
  }, []);

  const panneauSynchro = showCloudPanel && (
    <Suspense fallback={null}>
      <ChaineSync
        onClose={fermerSynchro}
        onVaultActivated={ouvrirVaultSynchronise}
        onChainEnded={quitterVaultWeb}
        raison={cloudPanelReason}
      />
    </Suspense>
  );

  // Menu shortcuts (route Cmd/Ctrl+P and Cmd/Ctrl+Shift+P from native menu: needed on Linux/Win)
  const currentDocRef = useRef(currentDoc);
  useEffect(() => { currentDocRef.current = currentDoc }, [currentDoc]);
  useEffect(() => {
    if (!window.electron?.onMenuShortcut) return;
    return window.electron.onMenuShortcut((name) => {
      if (name === 'command-palette') setShowCommandPalette(prev => !prev);
      else if (name === 'about') setShowAbout(true);
      else if (name === 'quick-open') setShowQuickOpen(prev => !prev);
      else if (name === 'new-task') { if (rootDirPathRef.current) setShowNewTask(true); }
      else if (name === 'refresh-files') {
        // Re-scan vault from disk + re-read current open doc (catches edits made
        // by external tools: terminal, scripts, other editors)
        setSidebarRefreshKey(k => k + 1);
        const p = currentDocRef.current?.path;
        if (p) fileSystem.openFileByPath(p).catch(() => {});
      }
    });
  }, []);

  useEffect(() => {
    // Utiliser le service fileSystem unifié.
    // ⚠️ Les on* retournent des unsubscribe : sans les appeler au cleanup, chaque
    // re-run de cet effet (à chaque ouverture de fichier) empilait un listener de
    // plus: fileOpened finissait par tirer N fois par ouverture et cassait
    // l'historique Cmd+[ après quelques fichiers.
    const unsubRootDir = fileSystem.onRootDirSet((dirPath) => {
      setRootDirPath(dirPath);
    });

    // Hot-reload when current file changes on disk
    const unsubFileChanged = fileSystem.onFileChanged((data) => {
      setCurrentDoc(prev => {
        if (prev?.filePath === data.filePath) {
          // Only update if content actually changed to avoid unnecessary re-renders
          if (prev.content === data.content) return prev;
          return { ...prev, content: data.content, type: data.type || prev.type };
        }
        return prev;
      });
    });

    const unsubFileOpened = fileSystem.onFileOpened((data) => {
      setCurrentDoc(data);
      setShowToday(false);
      addToHistory(data);
      // Auto-dismiss source picker when a file is opened externally
      setShowSourcePicker(false);
      if (!localStorage.getItem(SOURCE_TYPE_KEY)) {
        localStorage.setItem(SOURCE_TYPE_KEY, 'file');
      }
      // Save session
      if (data?.filePath) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          filePath: data.filePath,
          rootDirPath: rootDirPath || data.dirPath,
        }));
      }
    });

    // Handle drag & drop
    const handleDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const handleDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        const file = files[0];
        const filePath = fileSystem.getPathForFile(file);

        const isSupported = filePath && /\.(md|markdown)$/i.test(filePath);
        if (isSupported) {
          await fileSystem.openDroppedFile(filePath);
          // Auto-dismiss source picker on drag-drop
          if (!localStorage.getItem(SOURCE_TYPE_KEY)) {
            localStorage.setItem(SOURCE_TYPE_KEY, 'file');
          }
          setShowSourcePicker(false);
        }
      }
    };

    window.document.addEventListener('dragover', handleDragOver);
    window.document.addEventListener('drop', handleDrop);

    // Keyboard shortcuts
    const handleKeyDown = (e) => {
      const target = e.target;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // Cmd+Shift+E for sidebar focus (open if closed, focus + flash if open)
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        if (!showSidebar) {
          setShowSidebar(true);
        }
        setTimeout(() => {
          const sidebar = document.querySelector('.sidebar');
          if (sidebar) {
            sidebar.classList.remove('sidebar-flash');
            void sidebar.offsetWidth; // force reflow
            sidebar.classList.add('sidebar-flash');
          }
          const el = document.querySelector('.sidebar .file-tree-item, .sidebar .sidebar-tab');
          if (el) el.focus();
        }, 50);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setShowRightSidebar(prev => !prev);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        setShowSidebar(prev => !prev);
        return;
      }
      // Cmd+Shift+P for command palette
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        setShowCommandPalette(prev => !prev);
        return;
      }
      // Cmd+P for quick open
      if ((e.metaKey || e.ctrlKey) && e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen(prev => !prev);
        return;
      }
      // Cmd+Shift+F for global search
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setShowGlobalSearch(prev => !prev);
        return;
      }
      // Cmd+F for search (only when a document is open)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && currentDoc) {
        e.preventDefault();
        setShowSearch(true);
      }
      // Escape : ferme la recherche
      if (e.key === 'Escape') setShowSearch(false);

      // Dans un champ de saisie, les raccourcis suivants restent au champ
      if (isInput) return;

      // Cmd+[ and Cmd+] for history navigation
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        goBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        goForward();
      }
    };

    window.document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.document.removeEventListener('dragover', handleDragOver);
      window.document.removeEventListener('drop', handleDrop);
      window.document.removeEventListener('keydown', handleKeyDown);
      unsubRootDir?.();
      unsubFileChanged?.();
      unsubFileOpened?.();
    };
  }, [goBack, goForward]);

  const handleOpenLocalFile = async (relativePath) => {
    if (currentDoc?.dirPath) {
      await fileSystem.openLocalMdFile(relativePath, currentDoc.dirPath);
    }
  };




  // Texte enregistré par l'éditeur de la note
  const handleContentChange = useCallback((newContent) => {
    setCurrentDoc(prev => prev ? { ...prev, content: newContent } : prev);
    // Une tâche écrite ou cochée : Today et les rappels suivent.
    rappels.actualiserBientot(rootDirPathRef.current);
  }, []);

  // --- Tâches et rappels ---
  // Relire le vault : à l'ouverture, au retour au premier plan, à la fin d'une
  // synchro, après une écriture. Jamais de relecture périodique.
  useEffect(() => {
    if (!rootDirPath) { rappels.oublier(); return; }
    rappels.actualiser(rootDirPath);
  }, [rootDirPath]);

  useEffect(() => {
    const relire = () => { if (rootDirPathRef.current) rappels.actualiser(rootDirPathRef.current); };
    const auPremierPlan = () => { if (document.visibilityState === 'visible') relire(); };
    window.addEventListener('focus', relire);
    document.addEventListener('visibilitychange', auPremierPlan);
    const offSync = window.electron?.cloud?.onEvent?.((evt) => { if (evt?.type === 'sync-complete') relire(); });
    const surDisque = window.electron?.onDirChanged?.(() => rappels.actualiserBientot(rootDirPathRef.current));
    return () => {
      window.removeEventListener('focus', relire);
      document.removeEventListener('visibilitychange', auPremierPlan);
      offSync?.();
      if (surDisque) window.electron?.removeDirChangedListener?.(surDisque);
    };
  }, []);

  // Ouvrir une note à la ligne d'une tâche (vue Today, notification touchée).
  const ligneEnAttente = useRef(null);
  const allerALaTache = useCallback(({ ligne, brut }) => {
    let n = ligne;
    const lignes = (currentDocRef.current?.content || '').split('\n').map(l => l.replace(/\r$/, ''));
    if (brut && lignes[n - 1] !== brut) {
      const i = lignes.indexOf(brut);
      if (i >= 0) n = i + 1;
    }
    allerALigne(n);
  }, []);

  const ouvrirTache = useCallback(async ({ chemin, ligne, brut }) => {
    if (!chemin) return;
    setShowToday(false);
    setMobilePopover(null);
    if (currentDocRef.current?.filePath === chemin) {
      setTimeout(() => allerALaTache({ ligne, brut }), 80);
      return;
    }
    ligneEnAttente.current = { chemin, ligne, brut };
    await fileSystem.openFileByPath(chemin);
  }, [allerALaTache]);

  useEffect(() => {
    const p = ligneEnAttente.current;
    if (!p || currentDoc?.filePath !== p.chemin) return;
    ligneEnAttente.current = null;
    const timer = setTimeout(() => allerALaTache(p), 250);
    return () => clearTimeout(timer);
  }, [currentDoc?.filePath, allerALaTache]);

  useEffect(() => rappels.ecouterOuverture((o) => ouvrirTache(o)), [ouvrirTache]);

  const afficherToast = useCallback((texte) => {
    setToast(texte);
    setTimeout(() => setToast(null), 2200);
  }, []);

  const handleNewTask = useCallback(() => {
    const root = rootDirPathRef.current;
    if (!root) return;
    setMobilePopover(null);
    setShowNewTask(true);
  }, []);

  const handleAddTask = useCallback(async (texte, quand) => {
    try {
      const r = await rappels.ajouterTache(rootDirPathRef.current, texte, quand);
      if (!r) return false;
      haptique('confirm');
      if (currentDocRef.current?.filePath === r.chemin) {
        setCurrentDoc(prev => prev ? { ...prev, content: r.contenu } : prev);
      }
      setSidebarRefreshKey(k => k + 1);
      afficherToast(t('tasks.added'));
      rappels.actualiser(rootDirPathRef.current);
      return true;
    } catch (err) {
      alert(err?.code ? messageChaine(err) : t('tasks.writeFailed'));
      return false;
    }
  }, [afficherToast]);

  const handleTodayNoteChanged = useCallback((chemin, contenu) => {
    if (currentDocRef.current?.filePath === chemin) {
      setCurrentDoc(prev => prev ? { ...prev, content: contenu } : prev);
    }
  }, []);

  const openToday = useCallback(() => {
    setShowToday(true);
    setMobilePopover(null);
    if (rootDirPathRef.current) rappels.actualiser(rootDirPathRef.current);
  }, []);

  // Écran 1 : le dossier des notes est prêt (créé, rouvert ou choisi).
  const handleVaultReady = useCallback(async ({ rootDirPath: dossier, sourceType }, { rejoindre = false } = {}) => {
    sourceChoisie.current = true;
    prechargerEditeur();
    localStorage.setItem(SOURCE_TYPE_KEY, sourceType);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ rootDirPath: dossier }));
    setCurrentDoc(null);
    setRootDirPath(dossier);
    // Déjà utilisateur : dossier vide (pas de note d'accueil qui partirait dans
    // sa chaîne), puis droit aux 12 mots.
    if (rejoindre) {
      setSidebarRefreshKey(k => k + 1);
      setShowSourcePicker(false);
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      setCloudPanelReason('JOIN');
      setShowCloudPanel(true);
      return;
    }
    const { bienvenue } = await import('./services/vaultSetup');
    const welcome = await bienvenue(dossier);
    setSidebarRefreshKey(k => k + 1);
    setShowSourcePicker(false);
    // Plus d'écran « Sync your devices? » : la note d'accueil s'ouvre tout de
    // suite, la synchro se règle depuis l'app quand on en a besoin.
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    if (welcome) fileSystem.openFileByPath(welcome).catch(() => {});
  }, []);

  // Navigateur : clé créée ou retrouvée. Les notes déjà écrites dans ce
  // navigateur (avant la clé) suivent dans la chaîne, sans rien écraser.
  const entrerWeb = useCallback(async ({ nouvelle }) => {
    try {
      const bv = await import('./services/browserVault');
      if (await bv.connu().catch(() => null) && await bv.ouvrir()) copieVersChaine.current = bv.RACINE;
    } catch { /* pas de notes locales */ }
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    await ouvrirVaultSynchronise('cloud://');
    if (nouvelle) {
      const { bienvenue } = await import('./services/vaultSetup');
      const welcome = await bienvenue('cloud://');
      setSidebarRefreshKey(k => k + 1);
      if (welcome) fileSystem.openFileByPath(welcome).catch(() => {});
    }
  }, [ouvrirVaultSynchronise]);

  const handleReturnToSourcePicker = useCallback(() => {
    setCurrentDoc(null);
    setRootDirPath(null);
    localStorage.removeItem(SOURCE_TYPE_KEY);
    localStorage.removeItem(SESSION_KEY);
    setShowSourcePicker(true);
  }, []);

  // Créer un nouveau fichier .md: ouvre un mini dialog (prompt() ne marche pas sur Capacitor)
  const handleNewFile = useCallback(() => {
    if (!rootDirPath) return
    setNewFileName('')
    setShowNewFileDialog(true)
  }, [rootDirPath])

  const confirmNewFile = useCallback(async () => {
    const name = newFileName.trim()
    if (!name || !rootDirPath) return
    setShowNewFileDialog(false)
    // Fermer la sidebar mobile pour montrer le doc
    setMobilePopover(null)
    const safeName = name.replace(/[/\\?%*:|"<>]/g, '-')
    const fileName = safeName.endsWith('.md') ? safeName : `${safeName}.md`
    const initialContent = `# ${safeName.replace(/\.md$/, '')}\n\n`
    try {
      let uri = null
      if (rootDirPath.startsWith('cloud://')) {
        // Vault du navigateur : créer un document, c'est déposer son premier bloc chiffré.
        uri = cheminDans(rootDirPath, fileName)
        await fileSystem.writeFile(uri, initialContent)
      } else {
        const result = await fileSystem.createNewFile(rootDirPath, fileName, initialContent)
        if (result?.uri || result?.success) uri = result.uri
      }
      if (uri) {
        await fileSystem.openFileByPath(uri)
        // Refresh la sidebar + curseur dans la nouvelle note
        setSidebarRefreshKey(k => k + 1)
        setTimeout(() => ecrireALaFin(), 400)
      }
    } catch (err) {
      // Casier plein, trop de documents : le dire plutôt que d'échouer en silence.
      if (err?.code) alert(messageChaine(err))
      console.error('[Lector] Erreur création fichier:', err)
    }
  }, [newFileName, rootDirPath])

  if (showSourcePicker && ESTWEB) {
    return (
      <div className="app">
        <Suspense fallback={<div className="onboarding" aria-busy="true" />}>
          <EntreeWeb onPret={entrerWeb} />
        </Suspense>
      </div>
    );
  }

  if (showSourcePicker) {
    return (
      <div className="app">
        <Suspense fallback={<div className="onboarding" aria-busy="true" />}>
          <OnboardingWhere
            onReady={handleVaultReady}
            onAlreadyUser={(r) => handleVaultReady(r, { rejoindre: true })}
            firstRun={!localStorage.getItem(ONBOARDING_DONE_KEY)}
          />
        </Suspense>
        {panneauSynchro}
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
    <div className="app">
      {/* Titlebar: minimal : titre + pastille update */}
      <div className="titlebar drag-region">
        <div className="titlebar-center">
          <div className="titlebar-title" title={`Lector v${APP_VERSION}`}>
            {showToday ? t('tasks.today') : (currentDoc?.fileName || 'Lector')}
            <span className="titlebar-version">v{APP_VERSION}</span>
          </div>
          {window.electron?.cloud && (
            <Suspense fallback={null}>
              <CloudStatusIndicator onClick={() => setShowCloudPanel(true)} />
            </Suspense>
          )}
          {currentDoc && !showToday && (
            <button className="titlebar-share titlebar-icone" onClick={() => setShowHistory(true)} title={t('history.title')} aria-label={t('history.title')} data-testid="historique-ouvrir">
              <History size={13} />
            </button>
          )}
          {PARTAGE_POSSIBLE && currentDoc && !showToday && (
            <button className="titlebar-share" onClick={() => setShowShare(true)} title={t('collab.share.title')} data-testid="collab-partager">
              <Share2 size={13} />
              {t('collab.share')}
            </button>
          )}
          {updateReady && updateDismissed && (
            <button
              className="titlebar-update-dot"
              onClick={() => setUpdateDismissed(false)}
              title={t('app.updateClick', { version: updateReady })}
              aria-label={t('app.updateClick', { version: updateReady })}
            >
              <RefreshCw size={12} />
            </button>
          )}
        </div>
      </div>

      {/* Casier de synchro plein */}
      {quotaAlert && (
        <div className="update-banner">
          <span>{t('app.syncFull', { n: quotaAlert.pending || 0 })}</span>
          <button className="update-banner-btn" onClick={() => { setQuotaAlert(null); setShowCloudPanel(true); }}>
            {t('app.syncOpen')}
          </button>
          <button className="update-banner-dismiss" onClick={() => setQuotaAlert(null)} aria-label={t('fullscreen.close')}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Update banner: Electron + OTA mobile (bundle web) */}
      {updateReady && !updateDismissed && (
        <div className="update-banner">
          <span>{t(otaRef.current?.isAppUpdate ? 'appUpdate.ready' : 'app.updateReady', { version: updateReady })}</span>
          <button className="update-banner-btn" onClick={() => otaRef.current?.installUpdate()}>
            <RefreshCw size={13} />
            {otaRef.current?.isAppUpdate ? t('appUpdate.install') : t('app.restart')}
          </button>
          <button className="update-banner-dismiss" onClick={() => setUpdateDismissed(true)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search Bar */}
      {showSearch && currentDoc && (
        <Suspense fallback={null}>
          <SearchBar
            content={currentDoc.content}
            onClose={() => setShowSearch(false)}
            onGlobalSearch={(q) => {
              setShowSearch(false);
              setShowGlobalSearch(true);
            }}
          />
        </Suspense>
      )}

      {/* Global Search */}
      {showGlobalSearch && (
        <Suspense fallback={null}>
          <GlobalSearch
            rootDirPath={rootDirPath || currentDoc?.dirPath}
            onClose={() => setShowGlobalSearch(false)}
            onOpenFile={async (filePath) => {
              await fileSystem.openFileByPath(filePath);
            }}
          />
        </Suspense>
      )}

      <div className="main-content">
        {/* Sidebar: desktop only (mobile uses popover) */}
        <div
          className={`sidebar-container ${showSidebar ? 'open' : 'closed'}`}
          style={!isMobile && showSidebar ? { width: sidebarWidth } : {}}
        >
          {!isMobile && (
            <>
              <Sidebar
                dirPath={currentDoc?.dirPath}
                rootDirPath={rootDirPath}
                currentFilePath={currentDoc?.filePath}
                focusFolderPath={focusFolderPath}
                onFocusFolderHandled={() => setFocusFolderPath(null)}
                onFileSelected={() => {}}
                onReturnHome={handleReturnToSourcePicker}
                onNewFile={handleNewFile}
                refreshKey={sidebarRefreshKey}
                hidden={!showSidebar}
                onOpenToday={openToday}
                onNewTask={handleNewTask}
                todayActive={showToday}
                todayCount={todayCount}
              />
              <div
                className="sidebar-resize-handle"
                onMouseDown={(e) => {
                  e.preventDefault();
                  sidebarResizing.current = true;
                  const startX = e.clientX;
                  const startWidth = sidebarWidth;
                  const container = e.target.parentElement;
                  document.body.classList.add('is-resizing-sidebar');
                  const onMove = (ev) => {
                    if (!sidebarResizing.current) return;
                    const newWidth = Math.max(160, Math.min(500, startWidth + ev.clientX - startX));
                    container.style.width = newWidth + 'px';
                  };
                  const onUp = (ev) => {
                    sidebarResizing.current = false;
                    const finalWidth = Math.max(160, Math.min(500, startWidth + ev.clientX - startX));
                    setSidebarWidth(finalWidth);
                    document.removeEventListener('mousemove', onMove);
                    document.removeEventListener('mouseup', onUp);
                    document.body.classList.remove('is-resizing-sidebar');
                  };
                  document.addEventListener('mousemove', onMove);
                  document.addEventListener('mouseup', onUp);
                }}
              />
            </>
          )}
        </div>

        {/* Document with integrated mind map */}
        <div className="content-area">
          {showToday ? (
            <ErrorBoundary>
              <Suspense fallback={null}>
                <TodayView
                  rootDirPath={rootDirPath}
                  onOpenTask={ouvrirTache}
                  onNewTask={handleNewTask}
                  onNoteChanged={handleTodayNoteChanged}
                />
              </Suspense>
            </ErrorBoundary>
          ) : currentDoc ? (
              <ErrorBoundary>
                <Suspense fallback={<div className="document-view" />}>
                  <DocumentView
                    content={currentDoc.content}
                    dirPath={currentDoc.dirPath}
                    filePath={currentDoc.filePath}
                    onOpenLocalFile={handleOpenLocalFile}
                    onDocInfo={setDocInfo}
                    onContentChange={handleContentChange}
                  />
                </Suspense>
              </ErrorBoundary>
          ) : (
            <div className="empty-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 80 }}>{t('source.subtitle')}</p></div>
          )}

        </div>

        {/* Right Sidebar: desktop only (mobile uses popover) */}
        {showRightSidebar && !isMobile && currentDoc && !showToday && (
          <div
            className="right-sidebar-container"
            style={{ width: rightSidebarWidth }}
          >
            <div
              className="sidebar-resize-handle left"
              onMouseDown={(e) => {
                e.preventDefault();
                rightSidebarResizing.current = true;
                const startX = e.clientX;
                const startWidth = rightSidebarWidth;
                const container = e.target.parentElement;
                document.body.classList.add('is-resizing-sidebar');
                const onMove = (ev) => {
                  if (!rightSidebarResizing.current) return;
                  const newWidth = Math.max(180, Math.min(500, startWidth - (ev.clientX - startX)));
                  container.style.width = newWidth + 'px';
                };
                const onUp = (ev) => {
                  rightSidebarResizing.current = false;
                  const finalWidth = Math.max(180, Math.min(500, startWidth - (ev.clientX - startX)));
                  setRightSidebarWidth(finalWidth);
                  document.removeEventListener('mousemove', onMove);
                  document.removeEventListener('mouseup', onUp);
                  document.body.classList.remove('is-resizing-sidebar');
                };
                document.addEventListener('mousemove', onMove);
                document.addEventListener('mouseup', onUp);
              }}
            />
            <ErrorBoundary>
              <RightSidebar headers={docInfo.headers} />
            </ErrorBoundary>
          </div>
        )}

      </div>

      {/* Quick Open (Cmd+P) */}
      {showQuickOpen && (
        <Suspense fallback={null}>
          <QuickOpen
            rootDirPath={rootDirPath}
            onClose={() => setShowQuickOpen(false)}
            onFocusFolder={(path) => {
              setFocusFolderPath(path);
              setShowSidebar(true);
            }}
          />
        </Suspense>
      )}

      {/* Command Palette (Cmd+Shift+P) */}
      {showCommandPalette && (
        <Suspense fallback={null}>
          <CommandPalette
            onClose={() => setShowCommandPalette(false)}
            onCommand={(id) => {
              switch (id) {
                case 'share': if (PARTAGE_POSSIBLE && currentDoc) setShowShare(true); break;
                case 'history': if (currentDoc) setShowHistory(true); break;
                case 'search': if (currentDoc) setShowSearch(true); break;
                case 'sidebar': setShowSidebar(prev => !prev); break;
                case 'right-sidebar': setShowRightSidebar(prev => !prev); break;
                case 'about': setShowAbout(true); break;
                case 'cloud': setShowCloudPanel(true); break;
                case 'new-file': handleNewFile(); break;
                case 'new-task': handleNewTask(); break;
                case 'today': openToday(); break;
              }
            }}
          />
        </Suspense>
      )}

      {showHistory && currentDoc && (
        <Suspense fallback={null}>
          <Historique
            doc={currentDoc.filePath}
            texteActuel={currentDoc.content}
            onRestaurer={remplacerTexte}
            onFermer={() => setShowHistory(false)}
          />
        </Suspense>
      )}

      {showShare && currentDoc && (
        <Suspense fallback={null}>
          <SharePanel filePath={currentDoc.filePath} content={currentDoc.content} onClose={() => setShowShare(false)} />
        </Suspense>
      )}

      {/* À propos */}
      {showAbout && <Suspense fallback={null}><AboutPanel onClose={() => setShowAbout(false)} /></Suspense>}

      {/* Synchronisation */}
      {panneauSynchro}

      {/* Ajout rapide d'une tâche (Inbox.md) */}
      {showNewTask && (
        <Suspense fallback={null}>
          <NewTask onClose={() => setShowNewTask(false)} onAdd={handleAddTask} />
        </Suspense>
      )}
      {toast && <div className="lector-toast" role="status">{toast}</div>}

      {/* Mini dialog nouveau fichier */}
      {showNewFileDialog && (
        <div className="new-file-overlay" onClick={() => setShowNewFileDialog(false)}>
          <div className="new-file-dialog" onClick={e => e.stopPropagation()}>
            <h3>{t('sidebar.newFile')}</h3>
            <input
              type="text"
              className="new-file-input"
              value={newFileName}
              onChange={e => setNewFileName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && confirmNewFile()}
              placeholder={t('cmd.newFilePrompt')}
              autoFocus
            />
            <div className="new-file-actions">
              <button className="new-file-cancel" onClick={() => setShowNewFileDialog(false)}>
                {t('cmd.cancel')}
              </button>
              <button className="new-file-confirm" onClick={confirmNewFile} disabled={!newFileName.trim()}>
                {t('cmd.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ====== FAB + POPOVER SYSTEM ====== */}
      <>
        {/* --- Backdrop --- */}
        {mobilePopover && (
            <div
              className={`mobile-popover-backdrop ${popoverClosing ? 'closing' : ''}`}
              onClick={closeMobilePopover}
              aria-hidden="true"
            />
          )}

          {/* --- Popover panel --- */}
          {mobilePopover && (
            <div className={`mobile-popover from-${mobilePopover === 'files' ? 'left' : mobilePopover === 'info' ? 'right' : 'center'} ${popoverClosing ? 'closing' : ''}`}>
              <div className="popover-arrow" />

              {/* Header: swipe-down to close */}
              <div
                className="mobile-popover-header"
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  e.currentTarget._swipeStartY = touch.clientY;
                  e.currentTarget._swipeDelta = 0;
                }}
                onTouchMove={(e) => {
                  if (e.currentTarget._swipeStartY == null) return;
                  const delta = e.touches[0].clientY - e.currentTarget._swipeStartY;
                  e.currentTarget._swipeDelta = delta;
                  // Visual feedback: translate the popover down
                  if (delta > 0) {
                    const popover = e.currentTarget.closest('.mobile-popover');
                    if (popover) popover.style.transform = `translateY(${Math.min(delta * 0.5, 40)}px)`;
                  }
                }}
                onTouchEnd={(e) => {
                  const delta = e.currentTarget._swipeDelta || 0;
                  const popover = e.currentTarget.closest('.mobile-popover');
                  if (popover) popover.style.transform = '';
                  e.currentTarget._swipeStartY = null;
                  e.currentTarget._swipeDelta = 0;
                  if (delta > 60) closeMobilePopover();
                }}
              >
                <span className="mobile-popover-title">
                  {mobilePopover === 'files' ? t('app.files') : mobilePopover === 'tools' ? t('app.tools') : t('app.info')}
                </span>
                <button className="mobile-popover-close" onClick={closeMobilePopover}>
                  <X size={14} />
                </button>
              </div>

              {/* Content */}
              <div className="mobile-popover-content">
                {/* FILES PANEL: with quick file search */}
                {mobilePopover === 'files' && (
                  <Sidebar
                    dirPath={currentDoc?.dirPath}
                    rootDirPath={rootDirPath}
                    currentFilePath={currentDoc?.filePath}
                    focusFolderPath={focusFolderPath}
                    onFocusFolderHandled={() => setFocusFolderPath(null)}
                    onFileSelected={() => closeMobilePopover()}
                    onReturnHome={() => { closeMobilePopover(); handleReturnToSourcePicker(); }}
                    onNewFile={handleNewFile}
                    refreshKey={sidebarRefreshKey}
                    onOpenToday={openToday}
                    onNewTask={handleNewTask}
                    todayActive={showToday}
                    todayCount={todayCount}
                  />
                )}

                {/* TOOLS PANEL */}
                {mobilePopover === 'tools' && (
                  <div className="mobile-tools-grid">
                    <Tooltip text={t('cmd.aboutDesc')} position="bottom">
                      <button
                        className="mobile-tool-btn"
                        onClick={() => { setShowAbout(true); closeMobilePopover(); }}
                      >
                        <span className="tool-icon"><Info size={20} /></span>
                        <span className="tool-label">{t('app.about')}</span>
                      </button>
                    </Tooltip>

                  </div>
                )}

                {/* INFO PANEL: with inline file search */}
                {mobilePopover === 'info' && currentDoc && (
                  <ErrorBoundary>
                    <RightSidebar headers={docInfo.headers} showInlineSearch />
                  </ErrorBoundary>
                )}

              </div>
            </div>
          )}

        {/* --- 3 Floating Action Buttons --- */}
        <button
          className={`mobile-fab mobile-fab-left ${isMobile ? (mobilePopover === 'files' ? 'active' : '') : (showSidebar ? 'active' : '')}`}
          onClick={() => isMobile ? toggleMobilePopover('files') : setShowSidebar(prev => !prev)}
          aria-label={t('app.files')}
          title={t('app.filesSidebar')}
        >
          <Folder size={19} />
        </button>

        {currentDoc && !showToday && (
          <>
            <button
              className={`mobile-fab mobile-fab-center ${mobilePopover === 'tools' ? 'active' : ''}`}
              onClick={() => toggleMobilePopover('tools')}
              aria-label={t('app.tools')}
              title={t('app.toolsBar')}
            >
              <Sliders size={19} />
            </button>
            <button
              className={`mobile-fab mobile-fab-right ${isMobile ? (mobilePopover === 'info' ? 'active' : '') : (showRightSidebar ? 'active' : '')}`}
              onClick={() => isMobile ? toggleMobilePopover('info') : setShowRightSidebar(prev => !prev)}
              aria-label={t('app.info')}
              title={t('app.infoPanel')}
            >
              <List size={19} />
            </button>
          </>
        )}
      </>
    </div>
    </Suspense>
  );
}

export default App;
