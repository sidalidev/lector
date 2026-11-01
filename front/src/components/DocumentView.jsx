import { useMemo, useState, useEffect, useLayoutEffect, forwardRef, memo, useRef, useCallback, lazy, Suspense } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeSlug from 'rehype-slug';
import { schemaMarkdown } from '../utils/schemaMarkdown';
import { Maximize2, ChevronDown, ChevronRight, Sparkles, RefreshCw, GraduationCap, ImageOff } from 'lucide-react';
import FullscreenOverlay from './FullscreenOverlay';
import MindMap from './MindMap';
import CodeBlock from './CodeBlock';
import Tooltip from './Tooltip';

// Thin wrappers that lazy-load the real components on first use
function MermaidBlock(props) {
  return <Suspense fallback={<div className="abc-loading">{t('doc.loading')}</div>}><LazyMermaidBlock {...props} /></Suspense>;
}
function AbcBlock(props) {
  return <Suspense fallback={<div className="abc-loading">{t('doc.loadingSheet')}</div>}><LazyAbcBlock {...props} /></Suspense>;
}
const LazyMermaidBlock = lazy(() => import('./DiagramBlocks').then(m => ({ default: m.MermaidBlock })));
const LazyAbcBlock = lazy(() => import('./DiagramBlocks').then(m => ({ default: m.AbcBlock })));
const LazyChordsBlock = lazy(() => import('./DiagramBlocks').then(m => ({ default: m.ChordsBlock })));
const LazyTabBlock = lazy(() => import('./DiagramBlocks').then(m => ({ default: m.TabBlock })));
const LazyStrumBlock = lazy(() => import('./DiagramBlocks').then(m => ({ default: m.StrumBlock })));
function ChordsBlock(props) {
  return <Suspense fallback={null}><LazyChordsBlock {...props} /></Suspense>;
}
function TabBlock(props) {
  return <Suspense fallback={null}><LazyTabBlock {...props} /></Suspense>;
}
function StrumBlock(props) {
  return <Suspense fallback={null}><LazyStrumBlock {...props} /></Suspense>;
}
import { generateAndSaveToFile } from '../services/claude';
import { parseGeneratedSections } from '../services/lectorGenerated';
import fileSystem from '../services/fileSystem';
import syncService from '../services/syncService';
import storage from '../services/storage';
// Lazy : CodeMirror ne se charge que quand on passe en mode édition
const MarkdownEditor = lazy(() => import('./MarkdownEditor'));
import './DocumentView.css';
import { t } from '../services/i18n'
import { besoinDeCle, messageChaine } from '../utils/messagesErreur'

/** Vrai si le dossier fait partie du vault synchronisé par la chaîne (ordinateur). */
async function estDansVaultSynchronise(dirPath) {
  try {
    const s = await window.electron?.cloud?.status?.();
    return !!(s?.hasChain && s.vaultPath && dirPath?.startsWith(s.vaultPath));
  } catch {
    return false;
  }
}

// Stop ABC playback without importing DiagramBlocks
function stopAllAbcPlayback() {
  if (window.__abcActiveStop) {
    try { window.__abcActiveStop(); } catch {}
  }
  window.__abcActiveId = null;
  window.__abcActiveStop = null;
}

// Difficulty badge helper
const difficultyConfig = {
  beginner: { key: 'doc.beginner', className: 'difficulty-beginner' },
  intermediate: { key: 'doc.intermediate', className: 'difficulty-intermediate' },
  advanced: { key: 'doc.advanced', className: 'difficulty-advanced' },
};

// HTML Embed component with fullscreen support
function HtmlEmbed({ url, alt }) {
  const [fullscreen, setFullscreen] = useState(false);

  return (
    <>
      <div className="html-embed">
        <button className="html-embed-expand-btn" onClick={() => setFullscreen(true)} title={t('doc.expand')}>
          <Maximize2 size={14} />
        </button>
        <iframe
          src={url}
          title={alt || t('doc.htmlEmbed')}
          sandbox="allow-scripts allow-same-origin"
          className="html-embed-iframe"
        />
        {alt && <p className="html-embed-caption">{alt}</p>}
      </div>
      {fullscreen && (
        <FullscreenOverlay onClose={() => setFullscreen(false)}>
          <iframe
            src={url}
            title={alt || t('doc.htmlEmbed')}
            sandbox="allow-scripts allow-same-origin"
            className="fullscreen-overlay-iframe"
          />
        </FullscreenOverlay>
      )}
    </>
  );
}

// HTML brut du document, puis assaini avant tout rendu : un .md venu d'ailleurs
// ne doit jamais exécuter de script. KaTeX passe après (sa sortie est sûre).
const REHYPE = [rehypeSlug, rehypeRaw, [rehypeSanitize, schemaMarkdown]];

// Maths LaTeX à la demande : remark-math + rehype-katex + la CSS ne se chargent
// que si le document contient réellement des $…$ / $$…$$. La plupart des docs
// n'en ont pas: les garder hors du bundle principal économise ~80 kB gzip.
let _mathPlugins = null;
function useMathPlugins(content) {
  const hasMath = useMemo(() => /\$[^\s$]/.test(content || ''), [content]);
  const [plugins, setPlugins] = useState(_mathPlugins);
  useEffect(() => {
    if (!hasMath || _mathPlugins) return;
    let alive = true;
    Promise.all([
      import('remark-math'),
      import('rehype-katex'),
      import('katex/dist/katex.min.css'),
    ]).then(([rm, rk]) => {
      _mathPlugins = { remarkMath: rm.default, rehypeKatex: rk.default };
      if (alive) setPlugins(_mathPlugins);
    }).catch(() => {});
    return () => { alive = false; };
  }, [hasMath]);
  return hasMath ? plugins : null;
}

const DocumentView = memo(forwardRef(function DocumentView({
  content,
  dirPath,
  filePath,
  onOpenLocalFile,
  onNavigate,
  onToggleBookmark,
  isBookmarked,
  fontSize = 17,
  onDocInfo,
  editMode = false,
  onContentChange,
  onOpenFlashcards,
  onShowApiKeys,
}, ref) {
  const internalRef = useRef(null);
  const setRefs = useCallback((node) => {
    internalRef.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);


  // Préserver la scroll position quand le contenu change (watcher iCloud)
  const savedScrollRef = useRef(null)
  useLayoutEffect(() => {
    // Sauvegarder avant le re-render causé par un changement de content
    const docView = internalRef.current
    if (docView) savedScrollRef.current = docView.scrollTop
  }, [content])
  useEffect(() => {
    // Restaurer après le re-render
    const docView = internalRef.current
    if (docView && savedScrollRef.current != null) {
      docView.scrollTop = savedScrollRef.current
    }
  }, [content])

  // --- Reading position bookmark: save & restore scroll per file ---
  const scrollSaveRef = useRef(null);
  const restoredFileRef = useRef(null);

  // Save scroll position (debounced): stores ratio + nearest visible header
  useEffect(() => {
    const docView = internalRef.current;
    if (!docView || !filePath) return;

    // ⚠️ Le cleanup de cet effet court APRÈS le commit du nouveau document :
    // relire le DOM à ce moment sauverait la position du NOUVEAU doc sous la clé
    // de l'ANCIEN (corruption des positions de lecture à chaque switch).
    // On persiste donc le dernier snapshot pris pendant le scroll, jamais le DOM du cleanup.
    let lastSnapshot = null;

    const save = () => {
      const { scrollTop, scrollHeight, clientHeight } = docView;
      if (scrollHeight <= clientHeight) return;
      const ratio = scrollTop / (scrollHeight - clientHeight);

      // Find the first header currently visible in viewport
      let nearestHeaderId = null;
      const headerEls = docView.querySelectorAll('[data-header-id]');
      for (const el of headerEls) {
        const rect = el.getBoundingClientRect();
        const viewRect = docView.getBoundingClientRect();
        if (rect.top >= viewRect.top - 20) {
          nearestHeaderId = el.getAttribute('data-header-id');
          break;
        }
      }

      lastSnapshot = { ratio, headerId: nearestHeaderId, timestamp: Date.now() };
      storage.set(`scroll-${filePath}`, lastSnapshot);
      syncService.markDirty(filePath);
    };

    const handleScroll = () => {
      clearTimeout(scrollSaveRef.current);
      scrollSaveRef.current = setTimeout(save, 400);
    };

    docView.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      docView.removeEventListener('scroll', handleScroll);
      clearTimeout(scrollSaveRef.current);
      // Persister le dernier état connu du BON document (jamais relire le DOM ici)
      if (lastSnapshot) {
        storage.set(`scroll-${filePath}`, lastSnapshot);
      }
    };
  }, [filePath]);

  // Restore scroll position when file opens
  useEffect(() => {
    if (!filePath || filePath === restoredFileRef.current) return;
    restoredFileRef.current = filePath;

    // Wait for content to render before restoring
    const timer = setTimeout(() => {
      const docView = internalRef.current;
      if (!docView) return;

      try {
        const saved = storage.get(`scroll-${filePath}`, null);
        if (!saved) return;

        // Strategy 1: scroll to the saved header anchor
        if (saved.headerId) {
          const headerEl = docView.querySelector(`[data-header-id="${saved.headerId}"]`);
          if (headerEl) {
            headerEl.scrollIntoView({ block: 'start' });
            return;
          }
        }

        // Strategy 2: fallback to scroll ratio
        if (saved.ratio != null) {
          const { scrollHeight, clientHeight } = docView;
          docView.scrollTop = saved.ratio * (scrollHeight - clientHeight);
        }
      } catch { /* ignore */ }
    }, 150);

    return () => clearTimeout(timer);
  }, [filePath]);

  // Edit mode: local state for textarea + auto-save
  const mathPlugins = useMathPlugins(content);
  const [editContent, setEditContent] = useState(content);
  const saveTimerRef = useRef(null);

  // Sync editContent when content changes externally (file switch, external edit)
  // Also flush save when leaving edit mode.
  // ⚠️ editFilePathRef : editContent appartient au fichier qui était affiché quand
  // l'édition a commencé. Si on change de fichier pendant l'édition, App bascule
  // editMode=false et filePath dans le même commit: flusher vers le prop filePath
  // courant écraserait le NOUVEAU fichier avec le contenu de l'ancien (perte de
  // données). On flush donc toujours vers editFilePathRef.current.
  const prevEditModeRef = useRef(editMode);
  const editFilePathRef = useRef(filePath);

  // Échec d'enregistrement (casier plein, document trop gros, modifié ailleurs...) : affiché au-dessus du document.
  const [saveError, setSaveError] = useState(null);
  useEffect(() => { setSaveError(null); }, [filePath]);
  const enregistrer = useCallback(async (target, texte) => {
    try {
      await fileSystem.writeFile(target, texte);
      setSaveError(null);
      return true;
    } catch (err) {
      setSaveError(messageChaine(err));
      return false;
    }
  }, []);

  useEffect(() => {
    // Leaving edit mode → flush save immediately, vers le fichier qui était édité
    if (prevEditModeRef.current && !editMode && editContent !== content) {
      clearTimeout(saveTimerRef.current);
      const target = editFilePathRef.current;
      if (target && !target.startsWith('demo://')) {
        enregistrer(target, editContent);
        // Ne propager au parent que si on est resté sur le même fichier
        if (target === filePath && onContentChange) onContentChange(editContent);
      }
    }
    prevEditModeRef.current = editMode;

    if (!editMode) {
      setEditContent(content);
      editFilePathRef.current = filePath;
    }
  }, [editMode, content, filePath]);

  // Auto-save debounce 1s: même garde : écrire vers le fichier en cours d'édition
  useEffect(() => {
    if (!editMode) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const target = editFilePathRef.current;
      if (editContent !== content && target && !target.startsWith('demo://')) {
        const ok = await enregistrer(target, editContent);
        if (ok && target === filePath && onContentChange) onContentChange(editContent);
      }
    }, 1000);
    return () => clearTimeout(saveTimerRef.current);
  }, [editContent, editMode]);

  const handleEditChange = useCallback((newContent) => {
    setEditContent(newContent);
  }, []);

  const [localImages, setLocalImages] = useState({});
  const [mindMapExpanded, setMindMapExpanded] = useState(true);
  const [mindMapFullscreen, setMindMapFullscreen] = useState(false);
  const [aiSummary, setAiSummary] = useState(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [aiMindMapConcepts, setAiMindMapConcepts] = useState(null);
  const [mindMapStatus, setMindMapStatus] = useState(null);
  const summaryContentRef = useRef('');

  // Image fullscreen state
  const [fullscreenImage, setFullscreenImage] = useState(null);

  // Phase 1: Metadata state
  const [metadata, setMetadata] = useState(null);
  const [metadataLoading, setMetadataLoading] = useState(false);
  const [glossaryOpen, setGlossaryOpen] = useState(false);

  const aiHeaderRef = useRef(null);

  // Phase 3c: Workspace files for inter-doc links
  const [workspaceFiles, setWorkspaceFiles] = useState(new Set());


  // Reading time (local, no AI)
  const readingTime = useMemo(() => {
    return Math.ceil(content.split(/\s+/).length / 200);
  }, [content]);

  // Load workspace file names for inter-doc link detection
  useEffect(() => {
    const loadWorkspaceFiles = async () => {
      if (!dirPath) return;
      try {
        const tree = await fileSystem.listDirectoryFiles(dirPath);
        if (!tree) return;
        const names = new Set();
        const extractNames = (items) => {
          for (const item of items) {
            if (!item.isDirectory && item.name.endsWith('.md')) {
              names.add(item.name.replace(/\.md$/, ''));
            }
            if (item.isDirectory && item.children) {
              extractNames(item.children);
            }
          }
        };
        extractNames(tree);
        setWorkspaceFiles(names);
      } catch { /* ignore */ }
    };
    loadWorkspaceFiles();
  }, [dirPath]);

  // État pour le bouton de régénération
  const [isRegenerating, setIsRegenerating] = useState(false);

  // Stop any playing music when navigating to a different file
  useEffect(() => {
    stopAllAbcPlayback();
  }, [filePath]);

  // Charger les données générées depuis le fichier .md (instantané, pas de génération auto)
  // L'utilisateur déclenche la génération manuellement via le bouton Générer/Régénérer
  useEffect(() => {
    if (!filePath) return;

    const contentHash = content.slice(0, 500) + content.length;
    if (contentHash === summaryContentRef.current) return;
    summaryContentRef.current = contentHash;

    // Lire les sections générées depuis le fichier (si elles existent)
    const { originalContent, generated } = parseGeneratedSections(content);

    if (generated) {
      if (generated.summary) setAiSummary(generated.summary); else setAiSummary(null);
      if (generated.concepts) { setAiMindMapConcepts(generated.concepts); setMindMapStatus('ready'); }
      else { setAiMindMapConcepts(null); setMindMapStatus(null); }
      if (generated.keywords || generated.glossary || generated.difficulty) {
        setMetadata({
          keywords: generated.keywords || [],
          glossary: generated.glossary || [],
          difficulty: generated.difficulty || null
        });
      } else {
        setMetadata(null);
      }
      // Hydrater localStorage depuis le .md si données absentes
      if (generated.highlights && !storage.getRaw(`highlights-${filePath}`, null)) {
        storage.setRaw(`highlights-${filePath}`, generated.highlights);
      }
      if (generated.flashcardsSR && !storage.getRaw(`flashcards-${filePath}`, null)) {
        // Fusionner définitions flashcards + données SR du .md
        const defs = generated.flashcards || [];
        const sr = generated.flashcardsSR;
        if (defs.length > 0 && sr?.cards) {
          const merged = defs.map((card, i) => ({ ...card, ...(sr.cards[i] || {}) }));
          storage.setRaw(`flashcards-${filePath}`, { flashcards: merged, score: sr.score || { correct: 0, incorrect: 0 }, generatedAt: sr.generatedAt });
        }
      }
      if (generated.quizSR && !storage.getRaw(`quiz-${filePath}`, null)) {
        storage.setRaw(`quiz-${filePath}`, generated.quizSR);
      }
      if (generated.tags) {
        const existing = storage.get(`file-tags-${filePath}`, null);
        if (!existing || existing.length === 0) {
          storage.set(`file-tags-${filePath}`, generated.tags);
        }
      }
    } else {
      setAiSummary(null);
      setAiMindMapConcepts(null);
      setMindMapStatus(null);
      setMetadata(null);
    }

    setSummaryLoading(false);
    setMetadataLoading(false);
  }, [content, filePath]);

  // Lu par référence : le parent passe une flèche neuve à chaque rendu, et la
  // remettre dans les dépendances relançait onDocInfo sans fin (boucle de rendu).
  const onShowApiKeysRef = useRef(onShowApiKeys);
  onShowApiKeysRef.current = onShowApiKeys;

  // Fonction pour régénérer et sauvegarder dans le fichier
  const handleRegenerateAndSave = useCallback(async () => {
    if (isRegenerating || !filePath) return;

    setIsRegenerating(true);

    try {
      const result = await generateAndSaveToFile(content, filePath, { includeFlashcards: true, includeQuiz: true });

      if (result.success && result.generated) {
        // Mettre à jour l'UI avec les nouvelles données
        if (result.generated.summary) setAiSummary(result.generated.summary);
        if (result.generated.concepts) {
          setAiMindMapConcepts(result.generated.concepts);
          setMindMapStatus('ready');
        }
        if (result.generated.keywords || result.generated.glossary || result.generated.difficulty) {
          setMetadata({
            keywords: result.generated.keywords || [],
            glossary: result.generated.glossary || [],
            difficulty: result.generated.difficulty || null
          });
        }
      } else if (besoinDeCle(result.code)) {
        onShowApiKeysRef.current?.();
      } else {
        console.error('[DocumentView] Failed to regenerate:', result.error);
      }
    } catch (error) {
      console.error('[DocumentView] Error regenerating:', error);
    } finally {
      setIsRegenerating(false);
    }
  }, [content, filePath, isRegenerating]);

  // Phase 3b: Auto-hide AI header on scroll
  // Only trigger state update when the collapsed state actually changes
  // Auto-collapse removed: it caused scroll jumps when the header height changed

  // Keyword click -> scroll to first occurrence
  const handleKeywordClick = useCallback((keyword) => {
    const docContent = document.querySelector('.document-content');
    if (!docContent) return;

    const walker = document.createTreeWalker(docContent, NodeFilter.SHOW_TEXT);
    const lowerKeyword = keyword.toLowerCase();

    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.textContent.toLowerCase().includes(lowerKeyword)) {
        const parent = node.parentElement;
        if (parent) {
          parent.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight
          const orig = parent.style.background;
          parent.style.background = 'rgba(233, 162, 59, 0.3)';
          parent.style.borderRadius = '4px';
          parent.style.transition = 'background 0.3s';
          setTimeout(() => { parent.style.background = orig; }, 2000);
          return;
        }
      }
    }
  }, []);

  // Extraire le contenu original sans les sections lector-generated
  const displayContent = useMemo(() => {
    const { originalContent } = parseGeneratedSections(content);
    return originalContent;
  }, [content]);

  // Extract title (first H1) and rest of content, tracking source line numbers
  const { title, restContent, lineOffsets } = useMemo(() => {
    const lines = displayContent.split('\n');
    let titleLine = '';
    let titleIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].match(/^#\s+(.+)/)) {
        titleLine = lines[i].replace(/^#\s+/, '');
        titleIndex = i;
        break;
      }
    }

    if (titleIndex >= 0) {
      // Build restLines preserving original line numbers (1-based)
      const restLines = [...lines.slice(0, titleIndex), ...lines.slice(titleIndex + 1)];
      const offsets = [
        ...lines.slice(0, titleIndex).map((_, i) => i + 1),
        ...lines.slice(titleIndex + 1).map((_, i) => titleIndex + 1 + i + 1),
      ];
      return { title: titleLine, restContent: restLines.join('\n'), lineOffsets: offsets };
    }

    // No title extracted: offsets are simply 1, 2, 3...
    const offsets = lines.map((_, i) => i + 1);
    return { title: '', restContent: displayContent, lineOffsets: offsets };
  }, [displayContent]);

  // Process content with header IDs, source line numbers, and extract headers for bookmarks
  // Skip headers inside fenced code blocks (``` ... ```)
  const { processedContent, headers } = useMemo(() => {
    let headerIndex = 0;
    const extractedHeaders = [];
    const slugCounts = {};

    const lines = restContent.split('\n');
    let inCodeBlock = false;
    const processed = lines.map((line, idx) => {
      const sourceLine = lineOffsets[idx] || (idx + 1);
      if (line.trimStart().startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        return line;
      }
      if (inCodeBlock) return line;
      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const hashes = match[1];
        const headerTitle = match[2];
        const id = `header-${headerIndex++}`;
        // Slug unique : dédupliquer les titres identiques avec un suffixe
        let slug = headerTitle
          .toLowerCase()
          .replace(/\*\*/g, '')
          .replace(/[^\w\s-\u00C0-\u024F]/g, '')
          .replace(/\s+/g, '-')
          .replace(/^-|-$/g, '');
        slugCounts[slug] = (slugCounts[slug] || 0) + 1;
        if (slugCounts[slug] > 1) slug += `-${slugCounts[slug]}`;
        extractedHeaders.push({ id: slug, numericId: id, text: headerTitle, level: hashes.length });
        return `<h${hashes.length} id="${slug}" data-header-id="${id}" data-header-text="${headerTitle}" data-source-line="${sourceLine}">${headerTitle}</h${hashes.length}>\n`;
      }
      // Mark plain paragraph lines with a source-line span
      // Skip lines that are Markdown block syntax (tables, lists, blockquotes, HRs, blank)
      const trimmed = line.trimStart();
      const isBlockSyntax = trimmed.startsWith('|') || // table
        trimmed.startsWith('-') || trimmed.startsWith('*') || trimmed.startsWith('+') || // unordered list / HR
        /^\d+[.)]\s/.test(trimmed) || // ordered list
        trimmed.startsWith('>') || // blockquote
        trimmed.startsWith('---') || trimmed.startsWith('***') || trimmed.startsWith('___'); // HR
      if (line.trim() && !isBlockSyntax) {
        return `<span data-source-line="${sourceLine}" style="display:none"></span>${line}`;
      }
      return line;
    }).join('\n');

    return { processedContent: processed, headers: extractedHeaders };
  }, [restContent, lineOffsets]);


  // Notify parent of doc info (headers, metadata, generate callback) for right sidebar
  useEffect(() => {
    if (onDocInfo) {
      onDocInfo({ headers, metadata, handleKeywordClick, onGenerate: handleRegenerateAndSave, isGenerating: isRegenerating });
    }
  }, [headers, metadata, onDocInfo, handleKeywordClick, handleRegenerateAndSave, isRegenerating]);

  // Add bookmark buttons to headers
  useEffect(() => {
    if (!onToggleBookmark) return;

    const documentContent = window.document.querySelector('.document-content');
    if (!documentContent) return;

    const headerElements = documentContent.querySelectorAll('[data-header-id]');

    headerElements.forEach(header => {
      const existingBtn = header.querySelector('.header-bookmark-btn');
      if (existingBtn) existingBtn.remove();

      const headerId = header.getAttribute('data-header-id');
      const headerText = header.getAttribute('data-header-text');

      const btn = window.document.createElement('button');
      btn.className = `header-bookmark-btn ${isBookmarked(headerId) ? 'bookmarked' : ''}`;
      btn.title = isBookmarked(headerId) ? t('doc.removeBookmark') : t('doc.addBookmark');
      btn.innerHTML = isBookmarked(headerId)
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/><polyline points="10 2 10 10 13 7 16 10 16 2"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"/></svg>';
      btn.onclick = (e) => {
        e.stopPropagation();
        onToggleBookmark(headerId, headerText);
      };

      header.style.position = 'relative';
      header.appendChild(btn);
    });

    return () => {
      headerElements.forEach(header => {
        const btn = header.querySelector('.header-bookmark-btn');
        if (btn) btn.remove();
      });
    };
  }, [processedContent, onToggleBookmark, isBookmarked]);

  // Track which media files are currently loading from iCloud
  const [loadingMedia, setLoadingMedia] = useState({});

  // Resolved URLs for embedded HTML files (lector-local:// protocol)
  const [htmlEmbeds, setHtmlEmbeds] = useState({});
  const htmlEmbedsRef = useRef(htmlEmbeds);
  htmlEmbedsRef.current = htmlEmbeds;

  // Médias relatifs absents d'un vault synchronisé : seuls les fichiers markdown voyagent
  const [missingMedia, setMissingMedia] = useState({});

  // Refs for stable access in components useMemo (avoids full re-render on image load)
  const localImagesRef = useRef(localImages);
  const loadingMediaRef = useRef(loadingMedia);
  const missingMediaRef = useRef(missingMedia);
  const dirPathRef = useRef(dirPath);
  localImagesRef.current = localImages;
  loadingMediaRef.current = loadingMedia;
  missingMediaRef.current = missingMedia;
  dirPathRef.current = dirPath;

  // Load local images & videos (Electron + Capacitor/iCloud)
  // Load all in parallel to minimize layout shift duration
  useEffect(() => {
    if (!dirPath || !content) return;
    let cancelled = false;

    const imgRegex = /!\[.*?\]\((?!http)(.*?)\)/g;
    const matches = [...content.matchAll(imgRegex)];
    // Exclude .html files: they are handled by the HTML embed useEffect
    const toLoad = matches.map(m => m[1]).filter(src => !localImages[src] && !/\.html?$/i.test(src));

    if (toLoad.length === 0) return;

    // Vault du navigateur : aucun média n'y est jamais disponible.
    if (dirPath.startsWith('cloud://')) return;

    // Mark all as loading at once
    setLoadingMedia(prev => {
      const next = { ...prev };
      toLoad.forEach(src => { next[src] = true; });
      return next;
    });

    // Load all in parallel
    Promise.all(toLoad.map(async (src) => {
      const data = await fileSystem.readLocalMedia(src, dirPath);
      return { src, data };
    })).then(results => {
      if (cancelled) return;

      // Save scroll position before batch DOM update
      const docView = internalRef.current;
      const scrollTop = docView?.scrollTop ?? 0;

      // Apply all loaded images in a single state update
      const newImages = {};
      results.forEach(({ src, data }) => {
        if (data) newImages[src] = data;
      });

      if (Object.keys(newImages).length > 0) {
        setLocalImages(prev => ({ ...prev, ...newImages }));
      }

      const missing = results.filter(({ data }) => !data).map(({ src }) => src);
      if (missing.length > 0) {
        estDansVaultSynchronise(dirPath).then((synchronise) => {
          if (cancelled || !synchronise) return;
          setMissingMedia(prev => ({ ...prev, ...Object.fromEntries(missing.map(src => [src, true])) }));
        });
      }

      // Clear all loading states at once
      setLoadingMedia(prev => {
        const next = { ...prev };
        toLoad.forEach(src => { delete next[src]; });
        return next;
      });

      // Bump revision to re-render only img components (not the whole document)
      setImageRevision(r => r + 1);

      // Restore scroll position after images render
      requestAnimationFrame(() => {
        if (docView && Math.abs(docView.scrollTop - scrollTop) > 50) {
          docView.scrollTop = scrollTop;
        }
      });
    });

    return () => { cancelled = true; };
  }, [content, dirPath]);

  // Resolve local HTML files for iframe embedding
  useEffect(() => {
    if (!dirPath || !content) return;
    let cancelled = false;

    const htmlRegex = /!\[.*?\]\((?!http)(.*?\.html?)\)/gi;
    const matches = [...content.matchAll(htmlRegex)];
    // Store with BOTH encoded and decoded keys so lookup works either way
    const toResolve = matches.map(m => m[1]).filter(src => {
      const decoded = decodeURIComponent(src);
      return !htmlEmbeds[src] && !htmlEmbeds[decoded];
    });

    if (toResolve.length === 0) return;

    Promise.all(toResolve.map(async (src) => {
      const url = await fileSystem.resolveLocalHtml(src, dirPath);
      return { src, url };
    })).then(results => {
      if (cancelled) return;
      const newEmbeds = {};
      results.forEach(({ src, url }) => {
        if (url) {
          // Store under both encoded and decoded keys
          newEmbeds[src] = url;
          const decoded = decodeURIComponent(src);
          if (decoded !== src) newEmbeds[decoded] = url;
        }
      });
      if (Object.keys(newEmbeds).length > 0) {
        setHtmlEmbeds(prev => ({ ...prev, ...newEmbeds }));
      }
    });

    return () => { cancelled = true; };
  }, [content, dirPath]);

  // Force re-render of img components when images finish loading, without recreating all components
  const [imageRevision, setImageRevision] = useState(0);

  // Extract plain text from React children (for language detection)
  const extractText = (children) => {
    if (!children) return '';
    if (typeof children === 'string') return children;
    if (Array.isArray(children)) return children.map(extractText).join('');
    if (children.props?.children) return extractText(children.props.children);
    return '';
  };

  // Custom components for ReactMarkdown
  const components = useMemo(() => ({
    img: ({ src, alt }) => {
      const isLocal = src && !src.startsWith('http') && !src.startsWith('data:');
      const isHtml = src && /\.html?$/i.test(src);
      const isVideo = src && (src.endsWith('.mp4') || src.endsWith('.webm') || src.endsWith('.mov'));

      // Média relatif d'un document synchronisé, absent de cet appareil
      if (isLocal && (dirPathRef.current?.startsWith('cloud://') || missingMediaRef.current[src])) {
        return (
          <span className="media-not-synced" role="img" aria-label={alt || t('doc.mediaNotSynced')}>
            <ImageOff size={16} />
            <span>{t('doc.mediaNotSynced')}</span>
          </span>
        );
      }

      // HTML embed: render as interactive iframe
      if (isHtml && isLocal) {
        const resolvedUrl = htmlEmbedsRef.current[src] || htmlEmbedsRef.current[decodeURIComponent(src)] || htmlEmbedsRef.current[encodeURIComponent(src)];
        if (!resolvedUrl) {
          return (
            <div className="html-embed-loading">
              <div className="html-embed-loading-text">{t('doc.loadingFrom', { name: alt || src })}</div>
            </div>
          );
        }
        return <HtmlEmbed url={resolvedUrl} alt={alt} />;
      }
      const isLoading = isLocal && loadingMediaRef.current[src];
      const resolved = isLocal ? localImagesRef.current[src] : null;
      const isHero = alt === 'hero';

      // Hero image: rendu inline pour éviter les erreurs de nesting DOM
      if (isHero) {
        let heroSrc = resolved || src;
        // Mode hosted : URL directe vers le serveur
        if (!resolved && dirPath && dirPath.startsWith('hosted://')) {
          const hostedId = dirPath.replace('hosted://', '').split('/')[0];
          heroSrc = `/formation/${hostedId}/docs/${encodeURIComponent(src)}`;
        }
        if (isLoading) return <span className="image-hero image-hero-loading" />;
        return <span className="image-hero"><img src={heroSrc} alt="" loading="lazy" /></span>;
      }

      // Loading state: iCloud download in progress
      if (isLoading) {
        return (
          <div className="media-loading-placeholder">
            <div className="media-loading-icon">
              {isVideo ? '🎬' : '🖼️'}
            </div>
            <div className="media-loading-text">
              {t('doc.loadingICloud')}
            </div>
            <div className="media-loading-bar">
              <div className="media-loading-bar-fill" />
            </div>
            {alt && <div className="media-loading-caption">{alt}</div>}
          </div>
        );
      }

      if (isVideo) {
        const videoSrc = resolved || src;
        return (
          <div className="video-embed local-video">
            <video controls width="100%">
              <source src={videoSrc} type="video/mp4" />
              {t('doc.videoUnsupported')}
            </video>
            {alt && <p className="video-caption">{alt}</p>}
          </div>
        );
      }

      const imageSrc = resolved || src;

      return (
        <figure className="image-figure">
          <img src={imageSrc} alt={alt || ''} loading="lazy" onClick={() => setFullscreenImage(imageSrc)} style={{ cursor: 'pointer' }} />
          <button className="image-expand-btn" onClick={() => setFullscreenImage(imageSrc)} title={t('doc.expandImage')}>
            <Maximize2 size={14} />
          </button>
          {alt && <figcaption>{alt}</figcaption>}
        </figure>
      );
    },

    a: ({ href, children }) => {
      // Handle anchor links (internal document navigation)
      if (href && href.startsWith('#')) {
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              const id = href.substring(1);
              const element = document.getElementById(id) || document.querySelector(`[data-header-id="${id}"]`);
              if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
              }
            }}
          >
            {children}
          </a>
        );
      }

      if (href && href.endsWith('.md') && !href.startsWith('http')) {
        return (
          <a
            href="#"
            className="local-link"
            onClick={(e) => {
              e.preventDefault();
              if (onOpenLocalFile) {
                onOpenLocalFile(href);
              }
            }}
          >
            {children}
          </a>
        );
      }

      const isVideo = href?.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/|vimeo\.com\/|rumble\.com\/)/);

      if (isVideo) {
        // YouTube → iframe embed
        const ytMatch = href.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]+)/);
        // Rumble → iframe embed
        const rumbleMatch = href.match(/rumble\.com\/embed\/([a-zA-Z0-9]+)/);
        const rumbleVideoMatch = !rumbleMatch && href.match(/rumble\.com\/([a-zA-Z0-9]+)-/);

        const videoId = ytMatch?.[1];
        const rumbleId = rumbleMatch?.[1] || rumbleVideoMatch?.[1];

        return (
          <span className="video-embed" style={{ display: 'block' }}>
            {videoId ? (
              <iframe
                width="100%"
                height="400"
                src={`https://www.youtube.com/embed/${videoId}`}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                style={{ borderRadius: '12px' }}
              />
            ) : rumbleId ? (
              <iframe
                width="100%"
                height="400"
                src={`https://rumble.com/embed/${rumbleId}/`}
                frameBorder="0"
                allowFullScreen
                style={{ borderRadius: '12px' }}
              />
            ) : href?.match(/vimeo\.com\/(\d+)/) ? (
              <iframe
                width="100%"
                height="400"
                src={`https://player.vimeo.com/video/${href.match(/vimeo\.com\/(\d+)/)[1]}`}
                frameBorder="0"
                allow="autoplay; fullscreen; picture-in-picture"
                allowFullScreen
                style={{ borderRadius: '12px' }}
              />
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer">{href}</a>
            )}
          </span>
        );
      }

      return (
        <a href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },

    // Phase 3c: Inter-document link detection in paragraphs
    p: ({ children, node }) => {
      if (workspaceFiles.size === 0) return <p>{children}</p>;

      // Process text children to detect workspace file references
      const processChildren = (kids) => {
        if (!Array.isArray(kids)) kids = [kids];
        const result = [];
        for (const child of kids) {
          if (typeof child === 'string') {
            const parts = [];
            let remaining = child;
            for (const fileName of workspaceFiles) {
              if (remaining.includes(fileName)) {
                const segments = remaining.split(fileName);
                for (let i = 0; i < segments.length; i++) {
                  if (segments[i]) parts.push(segments[i]);
                  if (i < segments.length - 1) {
                    parts.push(
                      <a
                        key={`${fileName}-${i}`}
                        href="#"
                        className="local-link inter-doc-link"
                        onClick={(e) => {
                          e.preventDefault();
                          if (onOpenLocalFile) onOpenLocalFile(fileName + '.md');
                        }}
                      >
                        {fileName}
                      </a>
                    );
                  }
                }
                remaining = null;
                break;
              }
            }
            if (remaining !== null) {
              result.push(child);
            } else {
              result.push(...parts);
            }
          } else {
            result.push(child);
          }
        }
        return result;
      };

      const text = extractText(children);
      const isArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const arabicRatio = isArabic ? (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length / text.length : 0;
      const isMainlyArabic = arabicRatio > 0.3;
      return <p className={isMainlyArabic ? 'arabic-text' : undefined} dir={isMainlyArabic ? 'rtl' : undefined}>{processChildren(children)}</p>;
    },

    blockquote: ({ children }) => {
      const text = extractText(children);
      const isArabic = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
      const arabicRatio = isArabic ? (text.match(/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g) || []).length / text.length : 0;
      const isMainlyArabic = arabicRatio > 0.3;
      return <blockquote className={`quote${isMainlyArabic ? ' arabic-text' : ''}`} dir={isMainlyArabic ? 'rtl' : undefined}>{children}</blockquote>;
    },

    table: ({ children }) => {
      const handleScroll = (e) => {
        const el = e.currentTarget;
        const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
        el.classList.toggle('scrolled-end', atEnd);
      };
      return (
        <div className="table-wrapper" onScroll={handleScroll}>
          <table>{children}</table>
        </div>
      );
    },

    code: ({ node, inline, className, children, ...props }) => {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : null;
      const codeString = String(children).replace(/\n$/, '');

      const isBlock = !inline || codeString.includes('\n') || node?.position?.start?.line !== node?.position?.end?.line;

      if (isBlock && language === 'mermaid') {
        return <MermaidBlock code={codeString} />;
      }

      if (isBlock && language === 'abc') {
        return <AbcBlock code={codeString} />;
      }

      if (isBlock && language === 'chords') {
        return <ChordsBlock code={codeString} />;
      }

      if (isBlock && language === 'tab') {
        return <TabBlock code={codeString} />;
      }

      if (isBlock && language === 'strum') {
        return <StrumBlock code={codeString} />;
      }

      if (isBlock && language) {
        return <CodeBlock language={language} {...props}>{codeString}</CodeBlock>;
      }

      if (isBlock && codeString.includes('\n')) {
        return <CodeBlock {...props}>{codeString}</CodeBlock>;
      }

      return (
        <code className="inline-code" {...props}>
          {children}
        </code>
      );
    },
  }), [onOpenLocalFile, workspaceFiles]);


  // Edit mode: render textarea
  if (editMode) {
    return (
      <div ref={setRefs} className="document-view document-view-edit">
        {saveError && <div className="doc-save-error" role="alert">{saveError}</div>}
        <Suspense fallback={null}>
          <MarkdownEditor
            content={editContent}
            onChange={handleEditChange}
            fontSize={fontSize}
            autoFocus
          />
        </Suspense>
      </div>
    );
  }


  return (
    <div
      ref={setRefs}
      className="document-view"
    >
      {saveError && <div className="doc-save-error" role="alert">{saveError}</div>}
      <article className="document-content" style={{ fontSize: `${fontSize + 2}px` }}>
        {/* Title + metadata badges */}
        {title && (
          <div className="doc-title-row">
            <h1 className="document-title">{title}</h1>
            <div className="doc-metadata">
              <Tooltip text={t('tooltip.readingTime')}>
                <span className="metadata-badge reading-time-badge">{t('doc.readingTime', { n: readingTime })}</span>
              </Tooltip>
            </div>
          </div>
        )}

        {/* Section IA: bloc distinct */}
          <div className="doc-header-ai" ref={aiHeaderRef}>
            {aiSummary ? (
              /* Contenu IA généré: bloc visuellement distinct */
              <div className="ai-generated-block">
                <div className="ai-generated-header">
                  <div className="ai-generated-header-left">
                    <Tooltip text={t('tooltip.aiBadge')}>
                      <span className="ai-generated-badge"><Sparkles size={12} /> AI</span>
                    </Tooltip>
                    {metadata?.difficulty && (
                      <Tooltip text={t(`tooltip.difficulty.${metadata.difficulty}`)}>
                        <span className={`metadata-badge ${difficultyConfig[metadata.difficulty]?.className || ''}`}>
                          {difficultyConfig[metadata.difficulty] ? t(difficultyConfig[metadata.difficulty].key) : metadata.difficulty}
                        </span>
                      </Tooltip>
                    )}
                  </div>
                  {!fileSystem.isCapacitor() && (
                    <Tooltip text={t('tooltip.regenerate')}>
                      <button
                        className="ai-regenerate-btn"
                        onClick={handleRegenerateAndSave}
                        disabled={isRegenerating}
                      >
                        <RefreshCw size={12} className={isRegenerating ? 'spinning' : ''} />
                      </button>
                    </Tooltip>
                  )}
                </div>

                {/* Bouton Flashcards: en haut pour visibilité */}
                {onOpenFlashcards && (
                  <div className="doc-flashcards-cta">
                    <button className="doc-flashcards-btn" onClick={onOpenFlashcards}>
                      <GraduationCap size={18} />
                      <span>{t('doc.reviewFlashcards')}</span>
                    </button>
                  </div>
                )}

                {/* Résumé */}
                <div className="doc-summary-content">
                  <ReactMarkdown>{aiSummary}</ReactMarkdown>
                </div>

                {/* Keywords */}
                {metadata?.keywords && metadata.keywords.length > 0 && (
                  <div className="doc-keywords">
                    {metadata.keywords.map((kw, i) => (
                      <Tooltip key={i} text={t('tooltip.keyword')} position="bottom">
                        <button
                          className="keyword-chip"
                          onClick={() => handleKeywordClick(kw)}
                        >
                          {kw}
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                )}

                {/* Glossaire */}
                {metadata?.glossary && metadata.glossary.length > 0 && (
                  <div className="glossary-section">
                    <Tooltip text={t('tooltip.glossary')} position="right">
                      <button
                        className="glossary-toggle"
                        onClick={() => setGlossaryOpen(!glossaryOpen)}
                      >
                        <span>{glossaryOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</span>
                        <span>{t('doc.glossary', { n: metadata.glossary.length })}</span>
                      </button>
                    </Tooltip>
                    <div className={`glossary-content ${glossaryOpen ? 'open' : ''}`}>
                      {[...metadata.glossary]
                        .sort((a, b) => a.term.localeCompare(b.term))
                        .map((item, i) => (
                          <div key={i} className="glossary-item">
                            <dt className="glossary-term">{item.term}</dt>
                            <dd className="glossary-definition">{item.definition}</dd>
                          </div>
                        ))
                      }
                    </div>
                  </div>
                )}

                {/* Mind Map */}
                {mindMapStatus === 'ready' && aiMindMapConcepts && (
                  <div className={`doc-mindmap ${mindMapExpanded ? 'expanded' : 'collapsed'}`}>
                    <div className="mindmap-header">
                      <Tooltip text={t('tooltip.overview')} position="bottom">
                        <button className="mindmap-toggle" onClick={() => setMindMapExpanded(!mindMapExpanded)}>
                          <span className="toggle-icon">{mindMapExpanded ? '▼' : '▶'}</span>
                          <span className="toggle-label">{t('doc.overview')}</span>
                        </button>
                      </Tooltip>
                      {mindMapExpanded && (
                        <button className="mindmap-fullscreen-btn" onClick={() => setMindMapFullscreen(true)} title={t('doc.expand')}>
                          <Maximize2 size={16} />
                        </button>
                      )}
                    </div>
                    {mindMapExpanded && (
                      <div className="mindmap-container">
                        <MindMap onNavigate={onNavigate} headers={headers} aiConcepts={aiMindMapConcepts} aiStatus={mindMapStatus} zoomEnabled={false} />
                      </div>
                    )}
                  </div>
                )}

              </div>
            ) : (
              /* Pas encore généré: juste le bouton */
              !fileSystem.isCapacitor() && (
                <div className="doc-ai-actions">
                  <Tooltip text={t('tooltip.generateAll')} position="bottom">
                    <button
                      className="regenerate-btn"
                      onClick={handleRegenerateAndSave}
                      disabled={isRegenerating}
                    >
                      <Sparkles size={14} className={isRegenerating ? 'spinning' : ''} />
                      {isRegenerating ? t('doc.generating') : t('doc.generateAll')}
                    </button>
                  </Tooltip>
                </div>
              )
            )}
          </div>

        {/* Fullscreen Mind Map Overlay */}
        {mindMapFullscreen && (
          <FullscreenOverlay onClose={() => setMindMapFullscreen(false)}>
            <MindMap onNavigate={(id) => {
              setMindMapFullscreen(false);
              onNavigate(id);
            }} headers={headers} aiConcepts={aiMindMapConcepts} aiStatus={mindMapStatus} />
          </FullscreenOverlay>
        )}

        {/* Rest of content with inline quiz insertion */}
        <ReactMarkdown
          remarkPlugins={mathPlugins ? [remarkGfm, mathPlugins.remarkMath] : [remarkGfm]}
          rehypePlugins={mathPlugins ? [...REHYPE, mathPlugins.rehypeKatex] : REHYPE}
          components={components}
        >
          {processedContent}
        </ReactMarkdown>

      </article>

      {/* Image Fullscreen Overlay */}
      {fullscreenImage && (
        <FullscreenOverlay onClose={() => setFullscreenImage(null)}>
          <div className="fullscreen-overlay-image-container">
            <img src={fullscreenImage} alt="" />
          </div>
        </FullscreenOverlay>
      )}
    </div>
  );
}));

export default DocumentView;
