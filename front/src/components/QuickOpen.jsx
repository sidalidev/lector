import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { FileText, Folder, Search, Music } from 'lucide-react';
import normalizeSearch from '../utils/normalizeSearch';
import './QuickOpen.css';
import { t } from '../services/i18n'

// Highlight matching portions in text (accent-insensitive)
function highlightMatch(text, query) {
  if (!query || !query.trim()) return text;
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return text;

  const normalized = normalizeSearch(text);
  // Collect all match ranges on the original text
  const ranges = [];
  for (const term of terms) {
    let idx = 0;
    while ((idx = normalized.indexOf(term, idx)) !== -1) {
      ranges.push([idx, idx + term.length]);
      idx += 1;
    }
  }
  if (ranges.length === 0) return text;

  // Merge overlapping ranges
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const prev = merged[merged.length - 1];
    if (ranges[i][0] <= prev[1]) {
      prev[1] = Math.max(prev[1], ranges[i][1]);
    } else {
      merged.push(ranges[i]);
    }
  }

  // Build JSX with <mark> for matched parts
  const parts = [];
  let last = 0;
  for (const [start, end] of merged) {
    if (start > last) parts.push(text.slice(last, start));
    parts.push(<mark key={start}>{text.slice(start, end)}</mark>);
    last = end;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

// Flatten tree into a flat list with relative paths
function flattenTree(items, parts = []) {
  const result = [];
  for (const item of items) {
    const currentParts = [...parts, item.name];
    result.push({
      name: item.name,
      path: item.path,
      isDirectory: item.isDirectory,
      relativePath: currentParts.join('/'),
    });
    if (item.isDirectory && item.children) {
      result.push(...flattenTree(item.children, currentParts));
    }
  }
  return result;
}

function QuickOpen({ onClose, rootDirPath, onFocusFolder }) {
  const [query, setQuery] = useState('');
  const [allItems, setAllItems] = useState([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState('files'); // 'files' or 'content'
  const [contentResults, setContentResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const searchTimeout = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Load file tree
  useEffect(() => {
    const load = async () => {
      if (window.electron && rootDirPath) {
        const tree = await window.electron.listDirectoryFiles(rootDirPath);
        setAllItems(flattenTree(tree));
      }
    };
    load();
  }, [rootDirPath]);

  // Detect mode: if query starts with '>' search content
  useEffect(() => {
    const isContent = query.startsWith('>');
    setMode(isContent ? 'content' : 'files');

    if (isContent) {
      const q = query.slice(1).trim();
      if (q.length < 2) {
        setContentResults([]);
        return;
      }
      // Debounce content search
      clearTimeout(searchTimeout.current);
      setSearching(true);
      searchTimeout.current = setTimeout(async () => {
        if (window.electron && rootDirPath) {
          const results = await window.electron.searchAllFiles(rootDirPath, q);
          setContentResults(results);
        }
        setSearching(false);
      }, 250);
    }

    return () => clearTimeout(searchTimeout.current);
  }, [query, rootDirPath]);

  const filtered = useMemo(() => {
    if (mode === 'content') return [];
    if (!query.trim()) return allItems;
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    return allItems
      .map(item => {
        const name = normalizeSearch(item.name);
        const path = normalizeSearch(item.relativePath);
        // All terms must match somewhere in name or path
        const matches = terms.every(t => name.includes(t) || path.includes(t));
        if (!matches) return null;
        // Score: exact name match > name contains > path only
        let score = 0;
        if (name === terms.join(' ')) score = 100;
        else if (terms.every(t => name.includes(t))) score = 50;
        else score = 10;
        return { ...item, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score);
  }, [query, allItems, mode]);

  const displayItems = mode === 'content' ? contentResults : filtered;

  useEffect(() => {
    setSelectedIndex(0);
  }, [displayItems]);

  // Scroll selected into view
  useEffect(() => {
    const el = listRef.current?.children[selectedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const openItem = async (item) => {
    if (mode === 'content') {
      // Content search result
      if (window.electron) {
        await window.electron.openFileByPath(item.filePath);
      }
    } else if (item.isDirectory) {
      onFocusFolder?.(item.path);
    } else if (window.electron) {
      await window.electron.openFileByPath(item.path);
    }
    onClose();
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, displayItems.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (displayItems[selectedIndex]) openItem(displayItems[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="quick-open-overlay" onClick={onClose}>
      <div className="quick-open" onClick={e => e.stopPropagation()}>
        <div className="quick-open-header">
          <input
            ref={inputRef}
            className="quick-open-input"
            type="text"
            placeholder={mode === 'content' ? t('quick.contentPlaceholder') : t('quick.placeholder')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          {mode === 'files' && (
            <button
              className="quick-open-mode-btn"
              onClick={() => setQuery('>')}
              title={t('quick.searchContent')}
            >
              <Search size={14} />
            </button>
          )}
        </div>
        <div className="quick-open-list" ref={listRef}>
          {mode === 'files' && filtered.slice(0, 50).map((item, i) => (
            <button
              key={item.path}
              className={`quick-open-item ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => openItem(item)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="quick-open-icon">
                {item.isDirectory ? <Folder size={14} /> : (item.name.endsWith('.mid') || item.name.endsWith('.midi')) ? <Music size={14} /> : <FileText size={14} />}
              </span>
              <span className="quick-open-name">{highlightMatch(item.isDirectory ? item.name : item.name.replace(/\.(md|mid|midi)$/, ''), query)}</span>
              <span className="quick-open-path">{highlightMatch(item.relativePath, query)}</span>
            </button>
          ))}

          {mode === 'content' && !searching && contentResults.map((result, i) => (
            <button
              key={result.filePath}
              className={`quick-open-item content-result ${i === selectedIndex ? 'selected' : ''}`}
              onClick={() => openItem(result)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="quick-open-icon">
                <FileText size={14} />
              </span>
              <div className="quick-open-content-result">
                <span className="quick-open-name">{result.fileName}</span>
                <span className="quick-open-match-preview">
                  {result.matches[0]?.text}
                </span>
              </div>
              <span className="quick-open-match-count">{result.matches.length}</span>
            </button>
          ))}

          {mode === 'content' && searching && (
            <div className="quick-open-empty">{t('quick.searching')}</div>
          )}

          {displayItems.length === 0 && !searching && query.length > 1 && (
            <div className="quick-open-empty">{t('quick.noResults')}</div>
          )}

          {mode === 'content' && query === '>' && (
            <div className="quick-open-empty">{t('quick.typeToSearch')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default QuickOpen;
