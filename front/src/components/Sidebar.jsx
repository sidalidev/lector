import { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { Folder, FolderOpen, FileText, Star, Copy, Clock, Search, Home, Plus, CalendarCheck, ListPlus } from 'lucide-react';
import fileSystem from '../services/fileSystem';
import syncService from '../services/syncService';
import storage from '../services/storage';
import normalizeSearch from '../utils/normalizeSearch';
import { t } from '../services/i18n'
import formatRelativeTime from '../utils/formatRelativeTime'
import './Sidebar.css';

function loadStarredItems() {
  return storage.get('starred-items', []);
}

function saveStarredItems(starred) {
  storage.set('starred-items', starred);
  syncService.markGlobalDirty();
}

// Get all ancestor paths for a given path
function getAncestorPaths(folderPath, rootPath) {
  const ancestors = [];
  let current = folderPath;
  while (current && current !== rootPath) {
    const parent = current.substring(0, current.lastIndexOf('/'));
    if (parent && parent !== current) {
      ancestors.push(parent);
      current = parent;
    } else break;
  }
  return ancestors;
}

// Build a cache of which items have starred descendants (computed once)
function buildStarredDescendantsCache(items, starredSet, cache = new Map()) {
  for (const item of items) {
    if (starredSet.has(item.path)) {
      cache.set(item.path, true);
    } else if (item.isDirectory && item.children) {
      buildStarredDescendantsCache(item.children, starredSet, cache);
      const hasStarred = item.children.some(child => cache.get(child.path));
      cache.set(item.path, hasStarred);
    } else {
      cache.set(item.path, false);
    }
  }
  return cache;
}

// Sort items: starred (or containing starred) first, then folders first, then alphabetically
function sortWithStars(items, starredSet) {
  if (items.length === 0) return items;

  // Build cache once for all items
  const cache = buildStarredDescendantsCache(items, starredSet);

  function sortLevel(levelItems) {
    const sorted = [...levelItems].sort((a, b) => {
      const aStarred = cache.get(a.path) || false;
      const bStarred = cache.get(b.path) || false;
      if (aStarred && !bStarred) return -1;
      if (!aStarred && bStarred) return 1;
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });
    for (const item of sorted) {
      if (item.isDirectory && item.children?.length) {
        item.children = sortLevel(item.children);
      }
    }
    return sorted;
  }

  return sortLevel(items);
}


const FileTreeItem = memo(function FileTreeItem({ item, depth, isExpanded, isActive, isStarred, isHighlighted, onToggleFolder, onOpenFile, onContextMenu, expandedFolders, currentFilePath, starredSet, highlightedPath }) {
  if (item.isDirectory) {
    return (
      <div className="file-tree-folder">
        <button
          className={`file-tree-item folder ${isStarred ? 'starred' : ''} ${isHighlighted ? 'highlighted' : ''}`}
          style={{ paddingLeft: `${6 + depth * 14}px` }}
          data-path={item.path}
          onClick={() => onToggleFolder(item.path)}
          onContextMenu={(e) => onContextMenu(e, item.path, true)}
        >
          <span className="file-icon">
            {isExpanded ? <FolderOpen size={15} /> : <Folder size={15} />}
          </span>
          <span className="file-name">{item.name}</span>
          {isStarred && <Star size={10} className="star-indicator" fill="currentColor" />}
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
                isStarred={starredSet.has(child.path)}
                isHighlighted={highlightedPath === child.path}
                onToggleFolder={onToggleFolder}
                onOpenFile={onOpenFile}
                onContextMenu={onContextMenu}
                expandedFolders={expandedFolders}
                currentFilePath={currentFilePath}
                starredSet={starredSet}
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
      className={`file-tree-item file ${isActive ? 'active' : ''} ${isStarred ? 'starred' : ''} ${isHighlighted ? 'highlighted' : ''}`}
      style={{ paddingLeft: `${6 + depth * 14}px` }}
      data-path={item.path}
      onClick={() => onOpenFile(item.path)}
      onContextMenu={(e) => onContextMenu(e, item.path)}
    >
      <span className="file-icon">
        <FileText size={15} />
      </span>
      <span className="file-name">{item.name.replace(/\.(md|markdown)$/i, '')}</span>
      {isStarred && <Star size={10} className="star-indicator" fill="currentColor" />}
    </button>
  );
});

function Sidebar({ dirPath, rootDirPath, currentFilePath, focusFolderPath, onFocusFolderHandled, recentFiles = [], onFileSelected, onReturnHome, onNewFile, refreshKey = 0, hidden = false, onOpenToday, onNewTask, todayActive = false, todayCount = 0 }) {
  const [activeTab, setActiveTab] = useState('files');
  const [files, setFiles] = useState([]);
  const [expandedFolders, setExpandedFolders] = useState({});
  const [starredItems, setStarredItems] = useState(loadStarredItems);
  const [contextMenu, setContextMenu] = useState(null);
  const [highlightedPath, setHighlightedPath] = useState(null);
  const [recentSort, setRecentSort] = useState('recent'); // 'recent' | 'frequent'
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

    return () => {
      if (handler) window.electron?.removeDirChangedListener?.(handler)
      clearInterval(pollInterval)
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
    setActiveTab('files');
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

  const starredSet = useMemo(() => new Set(starredItems), [starredItems]);

  const toggleStar = useCallback((itemPath) => {
    setStarredItems(prev => {
      const next = prev.includes(itemPath)
        ? prev.filter(p => p !== itemPath)
        : [...prev, itemPath];
      saveStarredItems(next);
      return next;
    });
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

  const starredFiles = useMemo(() => {
    const result = [];
    const allPaths = [];
    const walk = (items) => {
      for (const item of items) {
        allPaths.push(item.path);
        if (starredSet.has(item.path)) result.push(item);
        if (item.isDirectory && item.children) walk(item.children);
      }
    };
    walk(files);
    if (starredItems.length > 0 && result.length < starredItems.length) {
      const missing = starredItems.filter(p => !allPaths.includes(p));
      const samplePaths = allPaths.slice(0, 3);
      console.log('[starred] saved=' + starredItems.length + ' matched=' + result.length + ' missing=' + JSON.stringify(missing) + ' sample-tree-paths=' + JSON.stringify(samplePaths));
    }
    return result;
  }, [files, starredSet, starredItems]);

  const sortedFiles = useMemo(() => sortWithStars(files, starredSet), [files, starredSet]);

  const sortedRecentFiles = useMemo(() =>
    [...recentFiles].sort((a, b) => recentSort === 'frequent'
      ? b.openCount - a.openCount
      : new Date(b.lastOpenedAt) - new Date(a.lastOpenedAt)
    ), [recentFiles, recentSort]);

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
        isStarred={starredSet.has(item.path)}
        isHighlighted={highlightedPath === item.path}
        onToggleFolder={toggleFolder}
        onOpenFile={openFile}
        onContextMenu={handleContextMenu}
        expandedFolders={expandedFolders}
        currentFilePath={currentFilePath}
        starredSet={starredSet}
        highlightedPath={highlightedPath}
      />
    ));
    return render(sortedFiles);
  }, [sortedFiles, expandedFolders, currentFilePath, starredSet, highlightedPath, toggleFolder, openFile, handleContextMenu]);

  return (
    <aside className="sidebar" aria-label={t('sidebar.panel')} style={hidden ? { display: 'none' } : undefined}>
      {/* Today : les tâches datées de toutes les notes, en tête de la navigation */}
      {onOpenToday && rootDirPath && !rootDirPath.startsWith('hosted://') && (
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
      {activeTab === 'files' && files.length > 0 && (
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

      <div className="sidebar-tabs" role="tablist" aria-label="Navigation">
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
        <button
          className={`sidebar-tab ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
          title={t('sidebar.filesTab')}
          role="tab"
          aria-selected={activeTab === 'files'}
        >
          <Folder size={17} />
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'starred' ? 'active' : ''}`}
          onClick={() => setActiveTab('starred')}
          title={t('sidebar.favoritesTab')}
        >
          <Star size={17} />
          {starredFiles.length > 0 && <span className="starred-count">{starredFiles.length}</span>}
        </button>
        <button
          className={`sidebar-tab ${activeTab === 'recents' ? 'active' : ''}`}
          onClick={() => setActiveTab('recents')}
          title={t('sidebar.recentsTab')}
        >
          <Clock size={17} />
        </button>
      </div>

      {activeTab === 'files' && (
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
      )}

      {activeTab === 'starred' && (
        <nav className="sidebar-nav starred-list">
          {starredFiles.length === 0 ? (
            <div className="empty-bookmarks">
              <Star size={32} className="empty-icon" />
              <p>{t('sidebar.noFavorites')}</p>
              <p className="empty-hint">{t('sidebar.favoritesHint')}</p>
            </div>
          ) : (
            starredFiles.map(f => {
              const isDir = f.isDirectory;
              const handleClick = () => {
                if (isDir) {
                  const parts = f.path.split('/');
                  const toExpand = {};
                  for (let i = 1; i <= parts.length; i++) toExpand[parts.slice(0, i).join('/')] = true;
                  setExpandedFolders(prev => ({ ...prev, ...toExpand }));
                  setActiveTab('files');
                } else {
                  openFile(f.path);
                }
              };
              return (
                <button
                  key={f.path}
                  className={`sidebar-item starred-item ${!isDir && currentFilePath === f.path ? 'active' : ''}`}
                  onClick={handleClick}
                  onContextMenu={(e) => handleContextMenu(e, f.path)}
                >
                  <span className="starred-icon">
                    {isDir ? <Folder size={14} /> : <FileText size={14} />}
                  </span>
                  <span className="starred-doc-name">{isDir ? f.name : f.name.replace(/\.(md|markdown)$/i, '')}</span>
                  <button
                    className="starred-remove"
                    title={t('sidebar.removeFromFavorites')}
                    onClick={(e) => { e.stopPropagation(); toggleStar(f.path); }}
                  >
                    <Star size={12} fill="currentColor" />
                  </button>
                </button>
              );
            })
          )}
        </nav>
      )}

      {activeTab === 'recents' && (
        <nav className="sidebar-nav recents-list">
          {recentFiles.length === 0 ? (
            <div className="empty-bookmarks">
              <Clock size={32} className="empty-icon" />
              <p>{t('sidebar.noRecent')}</p>
              <p className="empty-hint">{t('sidebar.recentsHint')}</p>
            </div>
          ) : (
            <>
              <div className="recents-sort-bar">
                <button className={`recents-sort-btn ${recentSort === 'recent' ? 'active' : ''}`} onClick={() => setRecentSort('recent')}>{t('sidebar.recentSort')}</button>
                <button className={`recents-sort-btn ${recentSort === 'frequent' ? 'active' : ''}`} onClick={() => setRecentSort('frequent')}>{t('sidebar.frequentSort')}</button>
              </div>
              {sortedRecentFiles.map(f => (
                  <button
                    key={f.filePath}
                    className={`sidebar-item recent-item ${currentFilePath === f.filePath ? 'active' : ''}`}
                    onClick={() => openFile(f.filePath)}
                  >
                    <FileText size={14} className="recent-icon" />
                    <span className="recent-doc-name">{f.fileName}</span>
                    <span className="recent-badge">{f.openCount}</span>
                    <span className="recent-time">{formatRelativeTime(f.lastOpenedAt)}</span>
                  </button>
                ))}
            </>
          )}
        </nav>
      )}


      {/* Context Menu */}
      {contextMenu && (
        <div
          className="context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              toggleStar(contextMenu.path);
              setContextMenu(null);
            }}
          >
            <Star size={14} fill={starredSet.has(contextMenu.path) ? 'currentColor' : 'none'} />
            {starredSet.has(contextMenu.path) ? t('sidebar.removeFavorite') : t('sidebar.addFavorite')}
          </button>
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
