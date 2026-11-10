import { useState, useEffect, useCallback, useRef, useMemo, useSyncExternalStore, lazy, Suspense } from 'react';
import {
  Folder, Sliders, List, X, Focus, Ruler, Play, Pause,
  Highlighter, GraduationCap, Download, Minus, Plus,
  Blend, RefreshCw, Pencil, MessageCircle, Volume2, Sparkles,
  Tag, FolderDown, Info, Share2
} from 'lucide-react';
import { getTotalDueCount, getAllDueCards } from './services/spacedRepetition';
import Sidebar from './components/Sidebar';
import DocumentView from './components/DocumentView';
import SearchBar from './components/SearchBar';
import ReadingRuler from './components/ReadingRuler';
import ProgressBar from './components/ProgressBar';

import AutoScroll from './components/AutoScroll';
import TagManager, { useFileTags } from './components/TagManager';
import QuickOpen from './components/QuickOpen';
import CommandPalette from './components/CommandPalette';
import RightSidebar from './components/FloatingTOC';
import ErrorBoundary from './components/ErrorBoundary';
import Tooltip from './components/Tooltip';
import { OnboardingWhere, OnboardingSync } from './components/Onboarding';
import CloudStatusIndicator from './components/CloudStatusIndicator';
import { getMasteryScore } from './services/spacedRepetition';
import fileSystem from './services/fileSystem';
import syncService from './services/syncService';
import storage from './services/storage';
import otaService from './services/otaService';
import { getStreak } from './services/activityTracker';
import useTranslation from './hooks/useTranslation'
import { cheminDans } from './utils/chemins'
import * as rappels from './services/rappels'
import { vueAujourdhui } from './services/taches/taches.js'
import { haptique } from './services/haptique'
import { messageChaine } from './utils/messagesErreur'
import { echapperHtml, markdownVersHtmlImpression } from './utils/impression'
import './App.css';

const APP_VERSION = __APP_VERSION__ || '0.0.0'

// Lazy-loaded : chargés uniquement quand utilisés
const Highlights = lazy(() => import('./components/Highlights'));
const HighlightsPanel = lazy(() => import('./components/Highlights').then(m => ({ default: m.HighlightsPanel })));
// Highlights est lazy mais toujours monté : chargé dès l'ouverture d'un doc
const Flashcards = lazy(() => import('./components/Flashcards'));
const GlobalSearch = lazy(() => import('./components/GlobalSearch'));
const ChatPanel = lazy(() => import('./components/ChatPanel'));
const ChaineSync = lazy(() => import('./components/ChaineSync'));
const ApiKeysPanel = lazy(() => import('./components/ApiKeysPanel'));
const AboutPanel = lazy(() => import('./components/AboutPanel'));
const YouTubeImport = lazy(() => import('./components/YouTubeImport'));
const TextToSpeech = lazy(() => import('./components/TextToSpeech'));
const TodayView = lazy(() => import('./components/TodayView'));
const NewTask = lazy(() => import('./components/NewTask'));
// Co-écriture : chargée à l'ouverture du panneau seulement (Yjs hors du paquet principal).
const SharePanel = lazy(() => import('./components/collab/SharePanel'));
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

// --- History helpers ---
const SESSION_KEY = 'lector-last-session';
const SOURCE_TYPE_KEY = 'lector-source-type';
// Premier lancement en cours : { step: 'sync', welcome } tant que l'écran
// « Sync your devices? » n'a pas reçu de réponse (l'app tuée y revient).
const ONBOARDING_KEY = 'lector-onboarding';
const ONBOARDING_DONE_KEY = 'lector-onboarding-done';

// Utilisateur d'avant cet écran (une source déjà choisie) : le premier
// lancement est derrière lui, l'écran « Sync your devices? » ne s'impose pas.
try {
  if (localStorage.getItem(SOURCE_TYPE_KEY) && !localStorage.getItem(ONBOARDING_KEY)) {
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
  }
} catch { /* stockage indisponible */ }

function lireOnboarding() {
  try { return JSON.parse(localStorage.getItem(ONBOARDING_KEY) || 'null'); } catch { return null; }
}
const MAX_HISTORY = 50;

function loadHistory() {
  return storage.get('history', []);
}

function saveHistory(entries) {
  storage.set('history', entries.slice(0, MAX_HISTORY));
  syncService.markGlobalDirty();
}

function recordFileOpen(filePath, fileName) {
  const entries = loadHistory();
  const idx = entries.findIndex(e => e.filePath === filePath);
  const now = new Date().toISOString();
  if (idx >= 0) {
    entries[idx].openCount += 1;
    entries[idx].lastOpenedAt = now;
    // Move to front
    const [item] = entries.splice(idx, 1);
    entries.unshift(item);
  } else {
    entries.unshift({ filePath, fileName, lastOpenedAt: now, openCount: 1 });
  }
  saveHistory(entries);
  return entries.slice(0, MAX_HISTORY);
}

function App() {
  // storage.get(key, default) wraps localStorage with 'lector-' prefix + JSON parse
  const { t } = useTranslation()

  const [currentDoc, setCurrentDoc] = useState(null);
  const [rootDirPath, setRootDirPath] = useState(null);
  const [recentFiles, setRecentFiles] = useState(() => loadHistory());
  const [showSidebar, setShowSidebar] = useState(() => storage.get('showSidebar', true));
  const [showSearch, setShowSearch] = useState(false);
  const [bookmarks, setBookmarks] = useState([]);

  // New states with persistence
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [showRuler, setShowRuler] = useState(() => storage.get('showRuler', false));
  const [fontSize, setFontSize] = useState(() => storage.get('fontSize', 17));
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(false);
  const [autoScrollSpeed, setAutoScrollSpeed] = useState(() => storage.get('autoScrollSpeed', 50));
  const [showTagManager, setShowTagManager] = useState(false);
  const [showHighlightsPanel, setShowHighlightsPanel] = useState(false);
  const [highlights, setHighlights] = useState([]);
  const [editingHighlight, setEditingHighlight] = useState(null);
  const [showFlashcards, setShowFlashcards] = useState(false);
  const [crossDocDueCards, setCrossDocDueCards] = useState(null);
  const [streak, setStreak] = useState(() => getStreak());
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [showCommandPalette, setShowCommandPalette] = useState(false);
  const [showGlobalSearch, setShowGlobalSearch] = useState(false);
  const [focusFolderPath, setFocusFolderPath] = useState(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => storage.get('sidebarWidth', 220));
  const [rightSidebarWidth, setRightSidebarWidth] = useState(() => storage.get('rightSidebarWidth', 200));
  const [showRightSidebar, setShowRightSidebar] = useState(() => storage.get('showRightSidebar', true));
  const [docInfo, setDocInfo] = useState({ headers: [], metadata: null, handleKeywordClick: null });
  const sidebarResizing = useRef(false);
  const rightSidebarResizing = useRef(false);

  // Mobile detection
  const [isMobile, setIsMobile] = useState(false);
  const [mobilePopover, setMobilePopover] = useState(null); // null | 'files' | 'tools' | 'info'
  const [popoverClosing, setPopoverClosing] = useState(false);
  const [mobileDueCount, setMobileDueCount] = useState(0);
  const [windowOpacity, setWindowOpacity] = useState(() => {
    const saved = localStorage.getItem('lector-window-opacity');
    return saved ? parseFloat(saved) : 1;
  });
  const [syncRevision, setSyncRevision] = useState(0);
  const [showSourcePicker, setShowSourcePicker] = useState(() => !localStorage.getItem(SOURCE_TYPE_KEY));
  const [onboarding, setOnboarding] = useState(() => lireOnboarding());
  const [updateReady, setUpdateReady] = useState(null); // version string or null
  const [updateDismissed, setUpdateDismissed] = useState(false);
  const [editMode, setEditMode] = useState(() => storage.get('editMode', false));
  const [showShare, setShowShare] = useState(false);
  const [showChatPanel, setShowChatPanel] = useState(() => storage.get('showChatPanel', false));
  const [focusMode, setFocusMode] = useState(false);
  const [showApiKeys, setShowApiKeys] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showCloudPanel, setShowCloudPanel] = useState(false);
  // Pourquoi l'écran Synchronisation s'ouvre tout seul (CHAIN_UNKNOWN, NO_CHAIN)
  const [cloudPanelReason, setCloudPanelReason] = useState(null);
  // Casier plein, signalé une fois par le processus principal
  const [quotaAlert, setQuotaAlert] = useState(null);
  const [showYouTubeImport, setShowYouTubeImport] = useState(false);
  const [showNewFileDialog, setShowNewFileDialog] = useState(false);
  const [newFileName, setNewFileName] = useState('');
  const [sidebarRefreshKey, setSidebarRefreshKey] = useState(0);
  const [showTTS, setShowTTS] = useState(false);
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

  // Restore window opacity on mount
  useEffect(() => {
    if (windowOpacity < 1) {
      window.electron?.setWindowOpacity(windowOpacity);
    }
  }, []);

  const handleOpacityChange = (value) => {
    const v = parseFloat(value);
    setWindowOpacity(v);
    localStorage.setItem('lector-window-opacity', v);
    window.electron?.setWindowOpacity(v);
  };

  // Track due count for tools panel
  useEffect(() => {
    const update = () => setMobileDueCount(getTotalDueCount());
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
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

  // Get tags for current file
  const fileTags = useFileTags(currentDoc?.filePath);

  // Mastery score for current doc
  const [masteryScore, setMasteryScore] = useState(null);
  useEffect(() => {
    if (!currentDoc?.filePath) { setMasteryScore(null); return; }
    setMasteryScore(getMasteryScore(currentDoc.filePath));
    const handleStorage = (e) => {
      if (e.key?.startsWith('flashcards-')) {
        setMasteryScore(getMasteryScore(currentDoc.filePath));
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [currentDoc?.filePath, showFlashcards]);

  // Save all preferences in a single debounced effect
  useEffect(() => {
    const t = setTimeout(() => {
      const prefs = { fontSize, showRuler, autoScrollSpeed, showSidebar, sidebarWidth, rightSidebarWidth, showRightSidebar, editMode, showChatPanel };
      for (const [k, v] of Object.entries(prefs)) {
        storage.set(k, v);
      }
      syncService.markGlobalDirty();
    }, 300);
    return () => clearTimeout(t);
  }, [fontSize, showRuler, autoScrollSpeed, showSidebar, sidebarWidth, rightSidebarWidth, showRightSidebar, editMode, showChatPanel]);

  const documentViewRef = useRef(null);
  const progressRef = useRef(null);

  // Barre de progression de lecture: scroll listener sur le document-view
  useEffect(() => {
    const el = documentViewRef.current;
    if (!el || !currentDoc) return;
    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      const pct = scrollHeight > clientHeight ? scrollTop / (scrollHeight - clientHeight) : 0;
      if (progressRef.current) progressRef.current.style.width = `${pct * 100}%`;
    };
    el.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [currentDoc?.filePath]);

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

  // Mode démo : contenu embarqué, rien n'est persisté.
  // Le picker revient au prochain lancement tant qu'une vraie source n'est pas choisie.
  const handleSourceDemo = useCallback(async () => {
    sourceChoisie.current = true;
    setRootDirPath('demo://');
    setShowSourcePicker(false);
    try {
      const { getDemoFiles } = await import('./services/demoContent');
      const { getLocale } = await import('./services/i18n');
      const first = getDemoFiles(getLocale())[0];
      await fileSystem.openFileByPath(`demo://${first.name}`);
    } catch (err) {
      console.error('demo mode error:', err);
    }
  }, []);

  // Restore last session on mount
  useEffect(() => {
    const restoreSession = async () => {
      try {
        await fileSystem.ensurePlatform();

        // Mode hosted : ?hosted=nom → charge les docs depuis /formation/nom/docs/
        const urlParams = new URLSearchParams(window.location.search)
        const hostedId = urlParams.get('hosted')
        if (hostedId) {
          setShowSourcePicker(false)
          setRootDirPath(`hosted://${hostedId}`)
          try {
            const res = await fetch(`/formation/${hostedId}/manifest.json`)
            const manifest = await res.json()
            // Charger le premier doc
            if (manifest.files?.length > 0) {
              const firstFile = manifest.files[0]
              const docRes = await fetch(`/formation/${hostedId}/docs/${encodeURIComponent(firstFile)}`)
              const content = await docRes.text()
              const data = {
                content,
                fileName: firstFile,
                filePath: `hosted://${hostedId}/${firstFile}`,
                dirPath: `hosted://${hostedId}`,
                type: 'markdown',
              }
              setCurrentDoc(data)
            }
          } catch (err) {
            console.error('[Lector] Hosted mode error:', err)
          }
          return
        }

        // ?demo : la démo embarquée, sans rien persister (captures, tests).
        if (urlParams.has('demo') && !localStorage.getItem(SOURCE_TYPE_KEY)) {
          handleSourceDemo();
          return;
        }

        // Ordinateur : avec une chaîne, on démarre toujours sur le vault synchronisé.
        if (fileSystem.isElectron() && window.electron?.cloud?.status) {
          try {
            const cs = await window.electron.cloud.status();
            if (cs?.hasChain && cs?.vaultPath && !sourceChoisie.current) {
              await window.electron.setRootDir(cs.vaultPath);
              setRootDirPath(cs.vaultPath);
              setShowSourcePicker(false);
              try {
                const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
                if (session?.filePath && session.filePath.startsWith(cs.vaultPath)) {
                  await fileSystem.openFileByPath(session.filePath);
                }
              } catch {}
              return;
            }
          } catch {}
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

        const sourceType = localStorage.getItem(SOURCE_TYPE_KEY);

        // Session demo:// résiduelle (état transitoire jamais censé être persisté) → purge
        try {
          const st = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
          if (st?.filePath?.startsWith('demo://') || st?.rootDirPath?.startsWith('demo://')) {
            localStorage.removeItem(SESSION_KEY);
            localStorage.removeItem(SOURCE_TYPE_KEY);
            setShowSourcePicker(true);
            return;
          }
        } catch {}

        // No source type saved → show picker
        if (!sourceType) {
          setShowSourcePicker(true);
          return;
        }

        // Capacitor/iOS
        if (fileSystem.isCapacitor()) {
          if (sourceType === 'icloud') {
            const available = await fileSystem.isAvailable();
            if (!available) {
              // iCloud coupé depuis (déconnexion, réglages) → retour au picker
              // plutôt qu'un écran vide sans issue
              localStorage.removeItem(SOURCE_TYPE_KEY);
              setShowSourcePicker(true);
              return;
            }
            if (available) {
              setRootDirPath('icloud://');
              setShowSourcePicker(false);

              // Créer le document de bienvenue au premier lancement
              if (!localStorage.getItem('lector-welcome-created')) {
                try {
                  const welcomePath = `icloud://${t('welcome.fileName')}.md`
                  await fileSystem.writeFile(welcomePath, t('welcome.content'))
                  localStorage.setItem('lector-welcome-created', '1')
                  await fileSystem.openFileByPath(welcomePath)
                } catch { /* ignore: ne pas bloquer le démarrage */ }
              } else {
                try {
                  const session = JSON.parse(localStorage.getItem(SESSION_KEY));
                  if (session?.filePath) {
                    await fileSystem.openFileByPath(session.filePath);
                  }
                } catch { /* ignore */ }
              }
            }
          } else if (sourceType === 'folder') {
            // Android SAF : restaurer le rootDirPath depuis la session
            try {
              const session = JSON.parse(localStorage.getItem(SESSION_KEY))
              // Accès rendu (réglages, autre appareil restauré) : l'écran du dossier revient.
              const { accesAndroid } = await import('./services/vaultSetup')
              if (session?.rootDirPath?.startsWith('content://') && !(await accesAndroid(session.rootDirPath))) {
                localStorage.removeItem(SOURCE_TYPE_KEY)
                setShowSourcePicker(true)
                return
              }
              if (session?.rootDirPath) {
                setRootDirPath(session.rootDirPath)
                setShowSourcePicker(false)
                if (session?.filePath) {
                  await fileSystem.openFileByPath(session.filePath)
                }
              } else {
                // Pas de session → re-picker
                localStorage.removeItem(SOURCE_TYPE_KEY)
                setShowSourcePicker(true)
              }
            } catch {
              localStorage.removeItem(SOURCE_TYPE_KEY)
              setShowSourcePicker(true)
            }
          }
          return;
        }

        // Navigateur : le dossier de notes du navigateur. Un dossier du disque
        // dont la permission est oubliée attend un clic sur l'écran du dossier.
        if (!fileSystem.isElectron() && sourceType === 'browser') {
          const bv = await import('./services/browserVault');
          if (await bv.ouvrir()) {
            setRootDirPath(bv.RACINE);
            setShowSourcePicker(false);
            try {
              const session = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
              if (session?.filePath?.startsWith(bv.RACINE)) await fileSystem.openFileByPath(session.filePath);
            } catch {}
          } else {
            setShowSourcePicker(true);
          }
          return;
        }

        // Electron
        if (fileSystem.isElectron() && window.electron) {
          if (sourceType === 'icloud') {
            // Lector Vault is the only desktop source now: drop legacy iCloud auto-open.
            localStorage.removeItem(SOURCE_TYPE_KEY);
            setShowSourcePicker(true);
            return;
          } else if (sourceType === 'folder') {
            try {
              const session = JSON.parse(localStorage.getItem(SESSION_KEY));
              // IPC sets rootDirPath via onRootDirSet listener + starts watcher.
              // Refusé si le dossier n'existe plus ou n'a jamais été ouvert par l'utilisateur : on le redemande.
              if (session?.rootDirPath && await window.electron.setRootDir(session.rootDirPath)) {
                setShowSourcePicker(false);
                if (session.filePath) {
                  await fileSystem.openFileByPath(session.filePath);
                }
              } else {
                setShowSourcePicker(true);
              }
            } catch {
              setShowSourcePicker(true);
            }
          } else if (sourceType === 'file') {
            try {
              const session = JSON.parse(localStorage.getItem(SESSION_KEY));
              if (session?.filePath && await fileSystem.openFileByPath(session.filePath)) {
                setShowSourcePicker(false);
              } else {
                setShowSourcePicker(true);
              }
            } catch {
              setShowSourcePicker(true);
            }
          }
        }
      } catch { /* ignore */ }
    };
    restoreSession();
  }, []);

  // Listen for auto-update ready (Electron + iOS OTA)
  useEffect(() => {
    otaService.initialize();
    const unsub = otaService.onUpdateReady((version) => setUpdateReady(version));
    return unsub;
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
      else if (name === 'new-task') { if (rootDirPathRef.current && !rootDirPathRef.current.startsWith('hosted://')) setShowNewTask(true); }
      else if (name === 'refresh-files') {
        // Re-scan vault from disk + re-read current open doc (catches edits made
        // by external tools: terminal, scripts, other editors)
        setSidebarRefreshKey(k => k + 1);
        const p = currentDocRef.current?.path;
        if (p) fileSystem.openFileByPath(p).catch(() => {});
      }
    });
  }, []);

  // Initialize sync service + focus-triggered pull + sync re-render
  useEffect(() => {
    // Init sync
    syncService.initialize();

    // Re-render when sync pulls new data
    const unsub = syncService.onSyncComplete(() => {
      setSyncRevision(r => r + 1);
    });

    // Pull on window focus/foreground
    const handleFocus = () => syncService.pullChanged();
    window.addEventListener('focus', handleFocus);

    // Also handle visibility change (iOS background/foreground)
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        syncService.pullChanged();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      unsub();
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibility);
      syncService.destroy();
    };
  }, []);

  // Reload data from localStorage when sync pulls new data
  useEffect(() => {
    if (syncRevision === 0) return;
    setRecentFiles(loadHistory());
  }, [syncRevision]);

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
      setEditMode(false);
      // Auto-dismiss source picker when a file is opened externally
      setShowSourcePicker(false);
      // Mode démo : ne rien persister (ni source, ni session, ni récents).
      // Le picker doit revenir au prochain lancement.
      if (data?.filePath?.startsWith('demo://')) return;
      if (!localStorage.getItem(SOURCE_TYPE_KEY)) {
        localStorage.setItem(SOURCE_TYPE_KEY, 'file');
      }
      // Save session & update history
      if (data?.filePath) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
          filePath: data.filePath,
          rootDirPath: rootDirPath || data.dirPath,
        }));
        setRecentFiles(recordFileOpen(data.filePath, data.fileName));
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

        const gpExts = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx'];
        const mxlExts = ['.musicxml', '.mxl'];
        const isSupported = filePath && (filePath.endsWith('.md') || filePath.endsWith('.mid') || filePath.endsWith('.midi') || mxlExts.some(ext => filePath.toLowerCase().endsWith(ext)) || gpExts.some(ext => filePath.toLowerCase().endsWith(ext)));
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
      // Cmd+E for edit mode toggle
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key === 'e') {
        e.preventDefault();
        if (currentDoc) {
          setEditMode(prev => !prev);
        }
        return;
      }
      // Cmd+F for search (only when a document is open)
      if ((e.metaKey || e.ctrlKey) && e.key === 'f' && currentDoc) {
        e.preventDefault();
        setShowSearch(true);
      }
      // Escape to close search/focus mode/autoscroll
      if (e.key === 'Escape') {
        setShowSearch(false);
        setAutoScrollEnabled(false);
        setFocusMode(false);
      }

      // Skip Vim navigation if in input
      if (isInput) return;

      // Vim-like navigation: j/k (vertical), h/l (horizontal), gg/G (top/bottom)
      const docView = window.document.querySelector('.document-view');
      if (e.key === 'j') {
        e.preventDefault();
        if (docView) docView.scrollTop += 80;
      }
      if (e.key === 'k') {
        e.preventDefault();
        if (docView) docView.scrollTop -= 80;
      }
      if (e.key === 'h') {
        e.preventDefault();
        if (docView) docView.scrollLeft -= 80;
      }
      if (e.key === 'l') {
        e.preventDefault();
        if (docView) docView.scrollLeft += 80;
      }
      // g for top, G for bottom
      if (e.key === 'g' && !e.shiftKey) {
        e.preventDefault();
        if (docView) docView.scrollTop = 0;
      }
      if (e.key === 'G' || (e.key === 'g' && e.shiftKey)) {
        e.preventDefault();
        if (docView) docView.scrollTop = docView.scrollHeight;
      }
      // Cmd+[ and Cmd+] for history navigation
      if ((e.metaKey || e.ctrlKey) && e.key === '[') {
        e.preventDefault();
        goBack();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ']') {
        e.preventDefault();
        goForward();
      }
      // Cmd+Plus/Minus for font size
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault();
        setFontSize(prev => Math.min(prev + 2, 28));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '-') {
        e.preventDefault();
        setFontSize(prev => Math.max(prev - 2, 12));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === '0') {
        e.preventDefault();
        setFontSize(17);
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

  const handleOpenFile = async () => {
    await fileSystem.openFileDialog();
  };

  const handleOpenLocalFile = async (relativePath) => {
    if (currentDoc?.dirPath) {
      await fileSystem.openLocalMdFile(relativePath, currentDoc.dirPath);
    }
  };

  const scrollToHeader = (id) => {
    const el = window.document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('highlight');
      setTimeout(() => el.classList.remove('highlight'), 2000);
    }
  };

  // Navigate from chat line reference → document element
  const handleNavigateToLine = useCallback((lineStart, lineEnd) => {
    // Find the first element with a matching data-source-line
    const docView = window.document.querySelector('.document-content');
    if (!docView) return;

    // Find closest element for the target line
    let target = null;
    let bestDist = Infinity;
    const els = docView.querySelectorAll('[data-source-line]');
    for (const el of els) {
      const n = parseInt(el.getAttribute('data-source-line'), 10);
      if (n >= lineStart && n <= lineEnd) {
        target = el;
        break;
      }
      // Fallback: closest line before the target
      if (n <= lineStart && (lineStart - n) < bestDist) {
        bestDist = lineStart - n;
        target = el;
      }
    }

    if (!target) return;

    // If it's a hidden span marker, use the next visible sibling or parent
    const scrollTarget = target.style?.display === 'none' ? (target.nextElementSibling || target.parentElement) : target;

    scrollTarget.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Highlight effect
    const orig = scrollTarget.style.background;
    scrollTarget.style.background = 'rgba(233, 162, 59, 0.28)';
    scrollTarget.style.borderRadius = '4px';
    scrollTarget.style.transition = 'background 0.3s';
    setTimeout(() => {
      scrollTarget.style.background = orig;
    }, 2000);
  }, []);

  const toggleBookmark = useCallback((headerId, headerText) => {
    setBookmarks(prev => {
      const exists = prev.find(b => b.id === headerId);
      if (exists) {
        return prev.filter(b => b.id !== headerId);
      }
      return [...prev, { id: headerId, text: headerText, filePath: currentDoc?.filePath }];
    });
  }, [currentDoc?.filePath]);

  const isBookmarked = useCallback((headerId) => {
    return bookmarks.some(b => b.id === headerId);
  }, [bookmarks]);

  // Handle content change from edit mode
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
    const el = document.querySelector(`.document-content [data-task-line="${n}"]`);
    if (!el) { handleNavigateToLine(n, n); return; }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('task-flash');
    setTimeout(() => el.classList.remove('task-flash'), 2000);
  }, [handleNavigateToLine]);

  const ouvrirTache = useCallback(async ({ chemin, ligne, brut }) => {
    if (!chemin) return;
    setShowToday(false);
    setMobilePopover(null);
    setEditMode(false);
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
    if (!root || root.startsWith('hosted://')) return;
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
    setEditMode(false);
    setMobilePopover(null);
    if (rootDirPathRef.current) rappels.actualiser(rootDirPathRef.current);
  }, []);

  const handleOpenFolder = async () => {
    await fileSystem.openFolderDialog();
  };

  // Écran 1 : le dossier des notes est prêt (créé, rouvert ou choisi).
  const handleVaultReady = useCallback(async ({ rootDirPath: dossier, sourceType }, { rejoindre = false } = {}) => {
    sourceChoisie.current = true;
    localStorage.setItem(SOURCE_TYPE_KEY, sourceType);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ rootDirPath: dossier }));
    setCurrentDoc(null);
    setRootDirPath(dossier);
    // Déjà utilisateur : dossier vide (pas de note d'accueil qui partirait dans
    // sa chaîne), puis droit aux 12 mots.
    if (rejoindre) {
      setSidebarRefreshKey(k => k + 1);
      setShowSourcePicker(false);
      localStorage.removeItem(ONBOARDING_KEY);
      localStorage.setItem(ONBOARDING_DONE_KEY, '1');
      setCloudPanelReason('JOIN');
      setShowCloudPanel(true);
      return;
    }
    const { bienvenue } = await import('./services/vaultSetup');
    const welcome = await bienvenue(dossier);
    setSidebarRefreshKey(k => k + 1);
    setShowSourcePicker(false);
    // Écran 2 au premier lancement seulement, et jamais avec une chaîne déjà en place.
    let aUneChaine = false;
    try {
      if (window.electron?.cloud?.status) aUneChaine = !!(await window.electron.cloud.status())?.hasChain;
      else aUneChaine = await (await import('./services/chaineWeb')).aUneChaine();
    } catch {}
    if (!localStorage.getItem(ONBOARDING_DONE_KEY) && !aUneChaine) {
      const etat = { step: 'sync', welcome };
      localStorage.setItem(ONBOARDING_KEY, JSON.stringify(etat));
      setOnboarding(etat);
      return;
    }
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    if (welcome) fileSystem.openFileByPath(welcome).catch(() => {});
  }, []);

  // Écran 2 : réponse à « Sync your devices? ».
  const terminerOnboarding = useCallback((synchro) => {
    const welcome = onboarding?.welcome;
    localStorage.removeItem(ONBOARDING_KEY);
    localStorage.setItem(ONBOARDING_DONE_KEY, '1');
    setOnboarding(null);
    if (welcome) fileSystem.openFileByPath(welcome).catch(() => {});
    if (synchro) {
      if (!fileSystem.isElectron()) copieVersChaine.current = rootDirPathRef.current;
      setShowCloudPanel(true);
    }
  }, [onboarding]);

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
        // Refresh la sidebar + passer en édition
        setSidebarRefreshKey(k => k + 1)
        setTimeout(() => setEditMode(true), 300)
      }
    } catch (err) {
      // Casier plein, trop de documents : le dire plutôt que d'échouer en silence.
      if (err?.code) alert(messageChaine(err))
      console.error('[Lector] Erreur création fichier:', err)
    }
  }, [newFileName, rootDirPath])

  // Lancer une session de révision cross-docs (toutes cartes dues)
  const handleReviewAll = useCallback(() => {
    const cards = getAllDueCards();
    if (cards.length === 0) return;
    setCrossDocDueCards(cards);
    setShowFlashcards(true);
  }, []);

  // Export dossier du document courant → ouvrir dans une fenêtre print pour PDF
  const handleExportFolderPdf = useCallback(async () => {
    const dirPath = currentDoc?.dirPath || rootDirPath;
    if (!dirPath) return;
    const folderName = dirPath.split('/').pop();
    const markdown = await fileSystem.readFolderAsMarkdown(dirPath);
    if (!markdown) { alert(t('cmd.noMarkdownInFolder')); return; }

    // Ouvrir une nouvelle fenêtre avec le contenu formaté pour impression
    const printWin = window.open('', '_blank');
    if (!printWin) return;
    printWin.document.write(`<!DOCTYPE html>
<html><head>
<title>Export: ${echapperHtml(folderName)}</title>
<style>
  body { font-family: 'Literata', Georgia, serif; font-size: 14px; line-height: 1.8; color: #1F2A22; max-width: 800px; margin: 0 auto; padding: 40px; }
  h1 { font-size: 28px; margin: 2em 0 0.5em; page-break-before: always; }
  h1:first-child { page-break-before: avoid; }
  h2 { font-size: 22px; margin: 1.5em 0 0.5em; }
  h3 { font-size: 18px; margin: 1.2em 0 0.4em; }
  code { font-family: 'JetBrains Mono', monospace; background: #f5f3f0; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
  pre { background: #f5f3f0; padding: 16px; border-radius: 8px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  hr { border: none; border-top: 2px solid #E8E4DF; margin: 3em 0; }
  blockquote { border-left: 4px solid #D4A574; margin: 1em 0; padding: 0.5em 1em; color: #6B6560; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #E8E4DF; padding: 8px 12px; text-align: left; }
  th { background: #f5f3f0; font-weight: 600; }
  img { max-width: 100%; height: auto; }
  @media print { h1 { page-break-before: always; } h1:first-child { page-break-before: avoid; } }
</style>
</head><body></body></html>`);
    // Texte des documents échappé : une balise écrite dans un document reste du texte.
    const html = markdownVersHtmlImpression(markdown);
    printWin.document.body.innerHTML = html;
    printWin.document.close();
    setTimeout(() => printWin.print(), 500);
  }, [currentDoc?.dirPath, rootDirPath]);

  if (showSourcePicker) {
    return (
      <div className="app">
        <OnboardingWhere
          onReady={handleVaultReady}
          onAlreadyUser={(r) => handleVaultReady(r, { rejoindre: true })}
          onDemo={handleSourceDemo}
          firstRun={!localStorage.getItem(ONBOARDING_DONE_KEY)}
        />
        {panneauSynchro}
      </div>
    );
  }

  if (onboarding?.step === 'sync') {
    return (
      <div className="app">
        <OnboardingSync onSetUp={() => terminerOnboarding(true)} onSkip={() => terminerOnboarding(false)} />
      </div>
    );
  }

  return (
    <Suspense fallback={null}>
    <div className={`app${focusMode ? ' focus-mode' : ''}`}>
      {/* Titlebar: minimal : titre + pastille update */}
      <div className="titlebar drag-region">
        <div className="titlebar-center">
          <div className="titlebar-title" title={`Lector v${APP_VERSION}`}>
            {showToday ? t('tasks.today') : (currentDoc?.fileName || 'Lector')}
            {streak > 0 && <span className="streak-badge" title={t('app.streakTooltip', { n: streak })}>🔥 {streak}</span>}
            <span className="titlebar-version">v{APP_VERSION}</span>
          </div>
          <CloudStatusIndicator onClick={() => setShowCloudPanel(true)} />
          {PARTAGE_POSSIBLE && currentDoc && !showToday && !currentDoc.filePath?.startsWith('demo://') && (
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
          <span>{t(otaService.isAppUpdate ? 'appUpdate.ready' : 'app.updateReady', { version: updateReady })}</span>
          <button className="update-banner-btn" onClick={() => otaService.installUpdate()}>
            <RefreshCw size={13} />
            {otaService.isAppUpdate ? t('appUpdate.install') : t('app.restart')}
          </button>
          <button className="update-banner-dismiss" onClick={() => setUpdateDismissed(true)}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* Search Bar */}
      {showSearch && currentDoc && (
        <SearchBar
          content={currentDoc.content}
          onClose={() => setShowSearch(false)}
          onGlobalSearch={(q) => {
            setShowSearch(false);
            setShowGlobalSearch(true);
          }}
        />
      )}

      {/* Global Search */}
      {showGlobalSearch && (
        <GlobalSearch
          rootDirPath={rootDirPath || currentDoc?.dirPath}
          onClose={() => setShowGlobalSearch(false)}
          onOpenFile={async (filePath) => {
            await fileSystem.openFileByPath(filePath);
          }}
        />
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
                content={currentDoc?.content || ''}
                onNavigate={scrollToHeader}
                bookmarks={bookmarks}
                onBookmarkClick={scrollToHeader}
                dirPath={currentDoc?.dirPath}
                rootDirPath={rootDirPath}
                currentFilePath={currentDoc?.filePath}
                focusFolderPath={focusFolderPath}
                onFocusFolderHandled={() => setFocusFolderPath(null)}
                recentFiles={recentFiles}
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
          {/* Reading Ruler: scoped to content area only */}
          {showRuler && currentDoc && !showToday && <ReadingRuler />}
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
                  <DocumentView
                    ref={documentViewRef}
                    content={currentDoc.content}
                    dirPath={currentDoc.dirPath}
                    filePath={currentDoc.filePath}
                    onOpenLocalFile={handleOpenLocalFile}
                    onNavigate={scrollToHeader}
                    onToggleBookmark={toggleBookmark}
                    isBookmarked={isBookmarked}
                    fontSize={fontSize}
                    onDocInfo={setDocInfo}
                    editMode={editMode}
                    onContentChange={handleContentChange}
                    onOpenFlashcards={() => setShowFlashcards(true)}
                    onShowApiKeys={() => setShowApiKeys(true)}
                    onTasksChanged={() => rappels.actualiser(rootDirPathRef.current)}
                  />
              </ErrorBoundary>
          ) : (
            <div className="empty-content"><p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 80 }}>{t('source.subtitle')}</p></div>
          )}

          {/* Barre de progression de lecture: en bas de la zone document */}
          {currentDoc && !showToday && (
            <div className="doc-read-progress">
              <div ref={progressRef} className="doc-read-progress-fill" />
            </div>
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
              <RightSidebar
                headers={docInfo.headers}
                metadata={docInfo.metadata}
                onKeywordClick={docInfo.handleKeywordClick}
                currentFilePath={currentDoc?.filePath}
                onOpenFile={handleOpenLocalFile}
                knowledgeLinks={[]}
                onGenerate={() => docInfo.onGenerate?.()}
                isGenerating={docInfo.isGenerating}
                onReviewAll={handleReviewAll}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* Highlights Panel */}
        {showHighlightsPanel && (
            <HighlightsPanel
              highlights={highlights}
              onSelectHighlight={(h) => {
                // Scroll to highlight in document
                const mark = document.querySelector(`mark[data-highlight-id="${h.id}"]`);
                if (mark) {
                  mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
                  mark.classList.add('pulse');
                  setTimeout(() => mark.classList.remove('pulse'), 1000);
                }
              }}
              onEditNote={(h) => setEditingHighlight(h)}
              onClose={() => setShowHighlightsPanel(false)}
            />
        )}
      </div>

      {/* Highlights System */}
      <Highlights
        filePath={currentDoc?.filePath}
        onHighlightsChange={setHighlights}
        editingHighlight={editingHighlight}
        setEditingHighlight={setEditingHighlight}
      />

      {/* Progress Bar */}
      <ProgressBar />

      {/* AutoScroll Control */}
      <AutoScroll
        enabled={autoScrollEnabled}
        onClose={() => setAutoScrollEnabled(false)}
        speed={autoScrollSpeed}
        setSpeed={setAutoScrollSpeed}
      />

      {/* Tag Manager */}
      {showTagManager && currentDoc && (
        <TagManager
          filePath={currentDoc.filePath}
          onClose={() => setShowTagManager(false)}
        />
      )}

      {/* Flashcards: mode document ou cross-docs */}
      {showFlashcards && (crossDocDueCards || currentDoc) && (
          <Flashcards
            content={currentDoc?.content}
            filePath={currentDoc?.filePath}
            dueCards={crossDocDueCards}
            onClose={() => { setShowFlashcards(false); setCrossDocDueCards(null); setStreak(getStreak()); }}
          />
      )}

      {/* Quick Open (Cmd+P) */}
      {showQuickOpen && (
        <QuickOpen
          rootDirPath={rootDirPath}
          onClose={() => setShowQuickOpen(false)}
          onFocusFolder={(path) => {
            setFocusFolderPath(path);
            setShowSidebar(true);
          }}
        />
      )}

      {/* Command Palette (Cmd+Shift+P) */}
      {showCommandPalette && (
        <CommandPalette
          onClose={() => setShowCommandPalette(false)}
          onCommand={(id) => {
            switch (id) {
              case 'autoscroll': setAutoScrollEnabled(prev => !prev); break;
              case 'focus': setFocusMode(prev => !prev); break;
              case 'ruler': setShowRuler(prev => !prev); break;
              case 'highlights': setShowHighlightsPanel(prev => !prev); break;
              case 'flashcards': if (currentDoc) setShowFlashcards(true); break;
              case 'share': if (PARTAGE_POSSIBLE && currentDoc) setShowShare(true); break;
              case 'search': if (currentDoc) setShowSearch(true); break;
              case 'sidebar': setShowSidebar(prev => !prev); break;
              case 'right-sidebar': setShowRightSidebar(prev => !prev); break;
              case 'export-pdf':
                if (currentDoc) fileSystem.exportPdf(currentDoc.fileName);
                break;
              case 'export-folder-pdf':
                if (rootDirPath) handleExportFolderPdf();
                break;
              case 'api-keys': setShowApiKeys(true); break;
              case 'about': setShowAbout(true); break;
              case 'cloud': setShowCloudPanel(true); break;
              case 'youtube': setShowYouTubeImport(true); break;
              case 'tts': if (currentDoc) setShowTTS(true); break;
              case 'new-file': handleNewFile(); break;
              case 'new-task': handleNewTask(); break;
              case 'today': openToday(); break;
              case 'learn': setShowChatPanel(true); break;
            }
          }}
        />
      )}

      {/* Chat Panel : desktop overlay (global + contextuel) */}
      {showChatPanel && !isMobile && (
          <div className="chat-overlay-backdrop" onClick={() => setShowChatPanel(false)}>
            <div className="chat-overlay" onClick={(e) => e.stopPropagation()}>
              <ChatPanel
                documentContent={currentDoc?.content || null}
                filePath={currentDoc?.filePath || null}
                onClose={() => setShowChatPanel(false)}
                onNavigateToLine={handleNavigateToLine}
                rootDirPath={rootDirPath || currentDoc?.dirPath}
                onOpenFile={handleOpenLocalFile}
                onShowApiKeys={() => setShowApiKeys(true)}
              />
            </div>
          </div>
      )}

      {/* Text-to-Speech */}
      {showTTS && currentDoc && (
        <TextToSpeech
          content={currentDoc.content}
          onClose={() => setShowTTS(false)}
          onShowApiKeys={() => setShowApiKeys(true)}
        />
      )}

      {/* Clés API personnelles */}
      {showApiKeys && <ApiKeysPanel onClose={() => setShowApiKeys(false)} />}
      {showShare && currentDoc && (
        <SharePanel filePath={currentDoc.filePath} content={currentDoc.content} onClose={() => setShowShare(false)} />
      )}

      {/* À propos */}
      {showAbout && <AboutPanel onClose={() => setShowAbout(false)} />}

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

      {/* YouTube Import */}
      {showYouTubeImport && (
        <YouTubeImport
          onClose={() => setShowYouTubeImport(false)}
          onImport={async ({ content, fileName }) => {
            // Sauvegarder le fichier dans le dossier courant et l'ouvrir
            const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '-').replace(/\s+/g, ' ').trim()
            if (rootDirPath) {
              const filePath = cheminDans(rootDirPath, safeName)
              try {
                await fileSystem.writeFile(filePath, content)
              } catch (err) {
                alert(messageChaine(err))
                return
              }
              await fileSystem.openFileByPath(filePath)
            } else {
              // Fallback : ouvrir en mémoire
              setCurrentDoc({ content, fileName: safeName, filePath: null, dirPath: null, type: 'markdown' })
            }
            setShowYouTubeImport(false)
          }}
        />
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
                  {mobilePopover === 'files' ? t('app.files') : mobilePopover === 'tools' ? t('app.tools') : mobilePopover === 'chat' ? t('app.chat') : t('app.info')}
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
                    content={currentDoc?.content || ''}
                    onNavigate={(id) => { scrollToHeader(id); closeMobilePopover(); }}
                    bookmarks={bookmarks}
                    onBookmarkClick={(id) => { scrollToHeader(id); closeMobilePopover(); }}
                    dirPath={currentDoc?.dirPath}
                    rootDirPath={rootDirPath}
                    currentFilePath={currentDoc?.filePath}
                    focusFolderPath={focusFolderPath}
                    onFocusFolderHandled={() => setFocusFolderPath(null)}
                    recentFiles={recentFiles}
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
                    {currentDoc && (
                      <Tooltip text={t('tooltip.edit')} position="bottom">
                        <button
                          className={`mobile-tool-btn ${editMode ? 'active' : ''}`}
                          onClick={() => { setEditMode(prev => !prev); closeMobilePopover(); }}
                        >
                          <span className="tool-icon"><Pencil size={20} /></span>
                          <span className="tool-label">{t('app.edit')}</span>
                        </button>
                      </Tooltip>
                    )}
                    <Tooltip text={t('tooltip.focus')} position="bottom">
                      <button
                        className={`mobile-tool-btn ${focusMode ? 'active' : ''}`}
                        onClick={() => {
                          setFocusMode(prev => !prev);
                          closeMobilePopover();
                        }}
                      >
                        <span className="tool-icon"><Focus size={20} /></span>
                        <span className="tool-label">{t('app.focus')}</span>
                      </button>
                    </Tooltip>

                    <Tooltip text={t('tooltip.ruler')} position="bottom">
                      <button
                        className={`mobile-tool-btn ${showRuler ? 'active' : ''}`}
                        onClick={() => { setShowRuler(prev => !prev); closeMobilePopover(); }}
                      >
                        <span className="tool-icon"><Ruler size={20} /></span>
                        <span className="tool-label">{t('app.ruler')}</span>
                      </button>
                    </Tooltip>

                    <Tooltip text={t('tooltip.autoscroll')} position="bottom">
                      <button
                        className={`mobile-tool-btn ${autoScrollEnabled ? 'active' : ''}`}
                        onClick={() => { setAutoScrollEnabled(prev => !prev); closeMobilePopover(); }}
                      >
                        <span className="tool-icon">{autoScrollEnabled ? <Pause size={20} /> : <Play size={20} />}</span>
                        <span className="tool-label">{t('app.reading')}</span>
                      </button>
                    </Tooltip>

                    <Tooltip text={t('tooltip.notes')} position="bottom">
                      <button
                        className={`mobile-tool-btn ${showHighlightsPanel ? 'active' : ''}`}
                        onClick={() => { setShowHighlightsPanel(prev => !prev); closeMobilePopover(); }}
                      >
                        <span className="tool-icon"><Highlighter size={20} /></span>
                        <span className="tool-label">{t('app.notes')}</span>
                      </button>
                    </Tooltip>

                    <Tooltip text={t('tooltip.export')} position="bottom">
                      <button
                        className="mobile-tool-btn"
                        onClick={async () => {
                          if (currentDoc) await fileSystem.exportPdf(currentDoc.fileName);
                          closeMobilePopover();
                        }}
                      >
                        <span className="tool-icon"><Download size={20} /></span>
                        <span className="tool-label">{t('app.export')}</span>
                      </button>
                    </Tooltip>

                    {(currentDoc?.dirPath || rootDirPath) && (
                      <Tooltip text={t('cmd.exportFolderPdfDesc')} position="bottom">
                        <button
                          className="mobile-tool-btn"
                          onClick={() => { handleExportFolderPdf(); closeMobilePopover(); }}
                        >
                          <span className="tool-icon"><FolderDown size={20} /></span>
                          <span className="tool-label">{t('cmd.exportFolderPdf')}</span>
                        </button>
                      </Tooltip>
                    )}

                    <Tooltip text={t('cmd.aboutDesc')} position="bottom">
                      <button
                        className="mobile-tool-btn"
                        onClick={() => { setShowAbout(true); closeMobilePopover(); }}
                      >
                        <span className="tool-icon"><Info size={20} /></span>
                        <span className="tool-label">{t('app.about')}</span>
                      </button>
                    </Tooltip>

                    {/* Section assistant : groupe visuel distinct */}
                    <div className="mobile-tools-ai-section">
                      <div className="mobile-tools-ai-label">
                        <Sparkles size={12} />
                        <span>{t('app.ai')}</span>
                      </div>
                      <div className="mobile-tools-ai-grid">
                        <Tooltip text={t('tooltip.flashcards')} position="bottom">
                          <button
                            className="mobile-tool-btn mobile-tool-btn-ai"
                            style={{ position: 'relative' }}
                            onClick={() => { setShowFlashcards(true); closeMobilePopover(); }}
                          >
                            <span className="tool-icon"><GraduationCap size={20} /></span>
                            <span className="tool-label">{t('flash.title')}</span>
                            {mobileDueCount > 0 && <span className="tool-badge">{mobileDueCount > 99 ? '99+' : mobileDueCount}</span>}
                          </button>
                        </Tooltip>

                        {currentDoc && (
                          <Tooltip text={t('tooltip.audio')} position="bottom">
                            <button
                              className={`mobile-tool-btn mobile-tool-btn-ai ${showTTS ? 'active' : ''}`}
                              onClick={() => { setShowTTS(true); closeMobilePopover(); }}
                            >
                              <span className="tool-icon"><Volume2 size={20} /></span>
                              <span className="tool-label">{t('app.aiVoice')}</span>
                            </button>
                          </Tooltip>
                        )}

                        <Tooltip text={t('tooltip.chat')} position="bottom">
                          <button
                            className={`mobile-tool-btn mobile-tool-btn-ai ${isMobile ? (mobilePopover === 'chat' ? 'active' : '') : (showChatPanel ? 'active' : '')}`}
                            onClick={() => { isMobile ? toggleMobilePopover('chat') : setShowChatPanel(prev => !prev); }}
                          >
                            <span className="tool-icon"><MessageCircle size={20} /></span>
                            <span className="tool-label">{t('app.chat')}</span>
                          </button>
                        </Tooltip>
                      </div>
                    </div>

                    {/* Streak + Mastery */}
                    {streak > 0 && (
                      <div className="mobile-mastery-row">
                        <span>🔥</span>
                        <span className="mastery-label">{t('app.streak')}</span>
                        <span className="mastery-value mastery-high">{streak} {streak === 1 ? t('app.day') : t('app.days')}</span>
                      </div>
                    )}
                    {currentDoc && masteryScore !== null && (
                      <div className="mobile-mastery-row">
                        <GraduationCap size={14} />
                        <span className="mastery-label">{t('app.mastery')}</span>
                        <span className={`mastery-value ${masteryScore <= 33 ? 'mastery-low' : masteryScore <= 66 ? 'mastery-mid' : 'mastery-high'}`}>
                          {masteryScore}%
                        </span>
                      </div>
                    )}

                    {/* Tags du fichier */}
                    {currentDoc && (
                      <div className="mobile-tags-row">
                        {fileTags.map(tag => (
                          <span key={tag.name} className="mobile-tag" style={{ backgroundColor: tag.color }}>
                            {tag.name}
                          </span>
                        ))}
                        <button
                          className="mobile-tag-manage-btn"
                          onClick={() => { setShowTagManager(true); closeMobilePopover(); }}
                        >
                          <Tag size={14} />
                          <span>{t('app.manageTags')}</span>
                        </button>
                      </div>
                    )}

                    <div className="mobile-font-group">
                      <button className="font-btn" onClick={() => setFontSize(prev => Math.max(prev - 2, 12))}>
                        <Minus size={16} />
                      </button>
                      <span className="font-size-value">{fontSize}</span>
                      <button className="font-btn" onClick={() => setFontSize(prev => Math.min(prev + 2, 28))}>
                        <Plus size={16} />
                      </button>
                    </div>

                    {fileSystem.isElectron() && (
                      <div className="mobile-opacity-group">
                        <Blend size={14} className="opacity-icon" />
                        <input
                          type="range"
                          min="0.3"
                          max="1"
                          step="0.05"
                          value={windowOpacity}
                          onChange={(e) => handleOpacityChange(e.target.value)}
                          className="opacity-slider-popover"
                          title={t('app.opacity', { percent: Math.round(windowOpacity * 100) })}
                        />
                        <span className="opacity-value">{Math.round(windowOpacity * 100)}%</span>
                      </div>
                    )}
                  </div>
                )}

                {/* INFO PANEL: with inline file search */}
                {mobilePopover === 'info' && currentDoc && (
                  <ErrorBoundary>
                    <RightSidebar
                      headers={docInfo.headers}
                      metadata={docInfo.metadata}
                      onKeywordClick={docInfo.handleKeywordClick}
                      currentFilePath={currentDoc?.filePath}
                      onOpenFile={handleOpenLocalFile}
                      knowledgeLinks={[]}
                      onGenerate={() => docInfo.onGenerate?.()}
                      isGenerating={docInfo.isGenerating}
                      onReviewAll={handleReviewAll}
                      showInlineSearch
                    />
                  </ErrorBoundary>
                )}

                {/* CHAT PANEL: global + contextuel */}
                {mobilePopover === 'chat' && (
                  <ChatPanel
                    documentContent={currentDoc?.content || null}
                    filePath={currentDoc?.filePath || null}
                    onClose={closeMobilePopover}
                    onNavigateToLine={handleNavigateToLine}
                    rootDirPath={rootDirPath || currentDoc?.dirPath}
                    onOpenFile={handleOpenLocalFile}
                    onShowApiKeys={() => setShowApiKeys(true)}
                  />
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
            {/* Chat FAB : outil local ou clé API de l'utilisateur */}
            <button
              className={`mobile-fab mobile-fab-chat ${isMobile ? (mobilePopover === 'chat' ? 'active' : '') : (showChatPanel ? 'active' : '')}`}
              onClick={() => { isMobile ? toggleMobilePopover('chat') : setShowChatPanel(prev => !prev) }}
              aria-label={t('app.chat')}
              title={t('app.chatPanel')}
            >
              <MessageCircle size={19} />
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
