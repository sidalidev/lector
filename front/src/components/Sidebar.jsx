import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { Folder, FolderOpen, FileText, Copy, Search, Home, Plus, CalendarCheck, ListPlus } from 'lucide-react';
import fileSystem from '../services/fileSystem';
import normalizeSearch from '../utils/normalizeSearch';
import { t } from '../services/i18n'
import './Sidebar.css';

// Tri : dossiers d'abord, puis ordre alphabétique, à chaque niveau
function trier(items) {
  return [...items].sort((a, b) => {
    if (a.isDirectory && !b.isDirectory) return -1;
    if (!a.isDirectory && b.isDirectory) return 1;
    return a.name.localeCompare(b.name);
  }).map((item) => (item.isDirectory && item.children?.length ? { ...item, children: trier(item.children) } : item));
}


const FileTreeItem = memo(function FileTreeItem({ item, depth, isExpanded, isActive, isHighlighted, onToggleFolder, onOpenFile, onContextMenu, expandedFolders, currentFilePath, highlightedPath }) {
  if (item.isDirectory) {
    return (
      <div className="file-tree-folder">
        <button
          className={`file-tree-item folder ${isHighlighted ? 'highlighted' : ''}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          data-path={item.path}
          onClick={() => onToggleFolder(item.path)}
          onContextMenu={(e) => onContextMenu(e, item.path, true)}
        >
          <span className="file-icon">
            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
          <span className="file-name">{item.name}</span>
        </button>
        {isExpanded && item.children && item.children.length > 0 && (
          <div className="file-tree-children">
            {item.children.map(child => (
              <FileTreeItem
                key={child.path}
                item={child}
                depth={depth + 1}
                isExpanded={!!expandedFolders[child.path]}
                isActive={currentFilePath === child.path}
                isHighlighted={highlightedPath === child.path}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onContextMenu={onContextMenu}
                expandedFolders={expandedFolders}
                currentFilePath={currentFilePath}
                highlightedPath={highlightedPath}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className={`file-tree-item file ${isActive ? 'active' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={{ paddingLeft: `${6 + depth * 14}px` }}
      data-path={item.path}
      onClick={() => onOpenFile(item.path)}
      onContextMenu={(e) => onContextMenu(e, item.path)}
    >
      <span className="file-icon">
        <FileText size={15} />
      </span>
      <span className="file-name">{item.name.replace(/\.(md|markdown)$/i, '')}</span>
    </button>
  );
});

function Sidebar({ dirPath, rootDirPath, currentFilePath, focusFolderPath, onFocusFolderHandled, onFileSelected, onReturnHome, onNewFile, refreshKey = 0, hidden = false, onOpenToday, onNewTask, todayActive = false, todayCount = 0 }) {
  const [files, setFiles] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [contextMenu, setContextMenu] = useState(null);
  const [highlightedPath, setHighlightedPath] = useState(null);
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const quickSearchRef = useRef(null);

  // Load files from root directory (stays anchored, never changes)
  const treeDirPath = rootDirPath || dirPath;
  const prevTreeHash = useRef('');
  const loadFiles = useCallback(async () => {
    if (treeDirPath) {
      const tree = await fileSystem.listDirectoryFiles(treeDirPath);
      // Éviter les re-renders si l'arbre n'a pas changé
      const hash = JSON.stringify(tree);
      if (hash !== prevTreeHash.current) {
        prevTreeHash.current = hash;
        setFiles(tree);
      }
    }
  }, [treeDirPath]);

  useEffect(() => {
    loadFiles();
  }, [loadFiles, refreshKey]);

  // Auto-refresh file tree when files change on disk
  useEffect(() => {
    // Electron: fs.watch événements
    let handler = null
    if (fileSystem.isElectron() && window.electron?.onDirChanged) {
      handler = window.electron.onDirChanged(() => loadFiles())
    }

    // Polling fallback : vérifier la structure toutes les 30s (pas 5s: ça bloque le main process)
    const pollInterval = setInterval(() => loadFiles(), 30000)

    // Lector Vault (navigateur, Android) : un autre appareil a écrit ou supprimé une note.
    let minuteur = null
    const surChaine = () => { clearTimeout(minuteur); minuteur = setTimeout(() => loadFiles(), 300) }
    window.addEventListener('lector-chaine-change', surChaine)

    return () => {
      if (handler) window.electron?.removeDirChangedListener?.(handler)
      clearInterval(pollInterval)
      clearTimeout(minuteur)
      window.removeEventListener('lector-chaine-change', surChaine)
    }
  }, [loadFiles]);

  // Scroll to active file when it changes
  useEffect(() => {
    if (!currentFilePath) return;
    setTimeout(() => {
      const el = document.querySelector(`[data-path="${CSS.escape(currentFilePath)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 150);
  }, [currentFilePath]);

  // Auto-expand folders to reveal current file
  useEffect(() => {
    if (!currentFilePath || !treeDirPath) return;
    // Build all ancestor folder paths between root and current file
    const relative = currentFilePath.startsWith(treeDirPath)
      ? currentFilePath.slice(treeDirPath.length + 1)
      : null;
    if (!relative) return;
    const parts = relative.split('/');
    // Remove the filename, keep only folder parts
    parts.pop();
    const toExpand = {};
    let current = treeDirPath;
    for (const part of parts) {
      current = current + '/' + part;
      toExpand[current] = true;
    }
    if (Object.keys(toExpand).length > 0) {
      setExpandedFolders(prev => ({ ...prev, ...toExpand }));
    }
  }, [currentFilePath, treeDirPath]);

  // Focus folder from QuickOpen (Cmd+P)
  useEffect(() => {
    if (!focusFolderPath || !treeDirPath) return;
    // Expand all ancestors + the folder itself
    const relative = focusFolderPath.startsWith(treeDirPath)
      ? focusFolderPath.slice(treeDirPath.length + 1)
      : null;
    if (!relative) { onFocusFolderHandled?.(); return; }
    const parts = relative.split('/');
    const toExpand = {};
    let current = treeDirPath;
    for (const part of parts) {
      current = current + '/' + part;
      toExpand[current] = true;
    }
    setExpandedFolders(prev => ({ ...prev, ...toExpand }));
    // Highlight the focused folder temporarily
    setHighlightedPath(focusFolderPath);
    setTimeout(() => {
      // Scroll to the focused element
      const el = document.querySelector(`[data-path="${CSS.escape(focusFolderPath)}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    setTimeout(() => setHighlightedPath(null), 2000);
    onFocusFolderHandled?.();
  }, [focusFolderPath, treeDirPath, onFocusFolderHandled]);

  const toggleFolder = useCallback((path) => {
    setExpandedFolders(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  }, []);

  const handleContextMenu = useCallback((e, itemPath, isDirectory = false) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path: itemPath, isDirectory });
  }, []);

  // Close context menu on click anywhere
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // Flatten file tree for quick search
  const flatFiles = useMemo(() => {
    const result = [];
    const walk = (items) => {
      for (const item of items) {
        if (!item.isDirectory) result.push(item);
        if (item.isDirectory && item.children) walk(item.children);
      }
    };
    walk(files);
    return result;
  }, [files]);

  // Fuzzy search results
  const quickSearchResults = useMemo(() => {
    if (!quickSearchQuery || quickSearchQuery.length < 1) return null;
    const q = normalizeSearch(quickSearchQuery);
    return flatFiles.filter(f => normalizeSearch(f.name).includes(q)).slice(0, 20);
  }, [quickSearchQuery, flatFiles]);

  const sortedFiles = useMemo(() => trier(files), [files]);

  const openFile = useCallback(async (filePath) => {
    await fileSystem.openFileByPath(filePath);
    // Notify parent (for mobile: close sidebar after file selection)
    onFileSelected?.();
  }, [onFileSelected]);

  const fileTreeElements = useMemo(() => {
    const render = (items, depth = 0) => items.map(item => (
      <FileTreeItem
        key={item.path}
        item={item}
        depth={depth}
        isExpanded={!!expandedFolders[item.path]}
        isActive={currentFilePath === item.path}
        isHighlighted={highlightedPath === item.path}
        onToggleFolder={toggleFolder}
        onOpenFile={openFile}
        onContextMenu={handleContextMenu}
        expandedFolders={expandedFolders}
        currentFilePath={currentFilePath}
        highlightedPath={highlightedPath}
      />
    ));
    return render(sortedFiles);
  }, [sortedFiles, expandedFolders, currentFilePath, highlightedPath, toggleFolder, openFile, handleContextMenu]);

  return (
    <aside className="sidebar" aria-label={t('sidebar.panel')} style={hidden ? { display: 'none' } : undefined}>
      {/* Today : les tâches datées de toutes les notes, en tête de la navigation */}
      {onOpenToday && rootDirPath && (
        <div className="sidebar-today-row">
          <button
            className={`sidebar-today ${todayActive ? 'active' : ''}`}
            onClick={onOpenToday}
            aria-current={todayActive ? 'page' : undefined}
          >
            <CalendarCheck size={17} />
            <span className="sidebar-today-label">{t('tasks.today')}</span>
            {todayCount > 0 && <span className="sidebar-today-count">{todayCount}</span>}
          </button>
          {onNewTask && (
            <button className="sidebar-today-add" onClick={onNewTask} title={t('tasks.newTask')} aria-label={t('tasks.newTask')}>
              <ListPlus size={17} />
            </button>
          )}
        </div>
      )}
      {/* Quick file search */}
      {files.length > 0 && (
        <div className="sidebar-quick-search">
          <Search size={14} className="sidebar-search-icon" />
          <input
            ref={quickSearchRef}
            type="text"
            className="sidebar-search-input"
            placeholder={t('sidebar.searchFile')}
            value={quickSearchQuery}
            onChange={(e) => setQuickSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && quickSearchResults?.length > 0) {
                openFile(quickSearchResults[0].path);
                setQuickSearchQuery('');
              }
              if (e.key === 'Escape') setQuickSearchQuery('');
            }}
            spellCheck={false}
          />
        </div>
      )}

      {/* Quick search results */}
      {quickSearchResults && quickSearchResults.length > 0 && (
        <div className="sidebar-search-results">
          {quickSearchResults.map(f => (
            <button
              key={f.path}
              className={`sidebar-search-result-item ${currentFilePath === f.path ? 'active' : ''}`}
              onClick={() => { openFile(f.path); setQuickSearchQuery(''); }}
            >
              <FileText size={14} />
              <span className="search-result-name">{f.name.replace(/\.(md|markdown)$/i, '')}</span>
            </button>
          ))}
        </div>
      )}

      <div className="sidebar-tabs">
        {onReturnHome && (
          <button
            className="sidebar-tab sidebar-home-btn"
            onClick={onReturnHome}
            title={t('sidebar.changeSource')}
          >
            <Home size={17} />
          </button>
        )}
        {onNewFile && (
          <button
            className="sidebar-tab sidebar-new-btn"
            onClick={onNewFile}
            title={t('sidebar.newFile')}
          >
            <Plus size={17} />
          </button>
        )}
      </div>

      <nav className="sidebar-nav file-explorer">
        {files.length === 0 ? (
          <div className="empty-files">
            <Folder size={32} className="empty-icon" />
            <p>{t('sidebar.noFiles')}</p>
            {onNewFile && (
              <button className="empty-files-cta" onClick={onNewFile}>
                <Plus size={16} />
                {t('sidebar.createFirst')}
              </button>
            )}
          </div>
        ) : (
          <div className="file-tree">
            {fileTreeElements}
          </div>
        )}
      </nav>

      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <Copy size={14} />
            {t('sidebar.copyPath')}
          </button>
        </div>
      )}
    </aside>
  );
}

export default memo(Sidebar);
