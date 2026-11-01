import { useState, useEffect, useRef, useCallback } from 'react';
import { FileSearch, X } from 'lucide-react';
import fileSystem from '../services/fileSystem';
import escapeRegex from '../utils/escapeRegex';
import normalizeSearch from '../utils/normalizeSearch';
import './SearchBar.css';
import { t } from '../services/i18n'

// Flatten file tree into list of { name, path } for .md files
function flattenTree(items, list = []) {
  for (const item of items) {
    if (item.isDirectory && item.children) {
      flattenTree(item.children, list);
    } else if (item.name?.endsWith('.md')) {
      list.push({ name: item.name, path: item.path });
    }
  }
  return list;
}

function GlobalSearch({ rootDirPath, onClose, onOpenFile }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [fileCount, setFileCount] = useState(0);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);
  const abortRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Search across all files: works on both Electron and Capacitor
  const performSearch = useCallback(async (q) => {
    if (!q || q.length < 2 || !rootDirPath) {
      setResults([]);
      setFileCount(0);
      return;
    }

    setSearching(true);
    abortRef.current = false;

    try {
      // Electron native search (faster)
      if (window.electron?.searchAllFiles) {
        const res = await window.electron.searchAllFiles(rootDirPath, q);
        if (!abortRef.current) {
          setResults(res.results || []);
          setFileCount(res.fileCount || 0);
        }
      } else {
        // Cross-platform JS search: list all files then read & search
        const tree = await fileSystem.listDirectoryFiles(rootDirPath);
        if (abortRef.current) return;
        const files = flattenTree(tree || []);
        const searchResults = [];
        const normQ = normalizeSearch(q);

        for (const file of files) {
          if (abortRef.current) return;
          try {
            const content = await fileSystem.readFile(file.path);
            if (!content || abortRef.current) continue;
            const lines = content.split('\n');
            const matches = [];
            for (let i = 0; i < lines.length; i++) {
              if (normalizeSearch(lines[i]).includes(normQ)) {
                matches.push({ line: i + 1, text: lines[i].trim().substring(0, 200) });
              }
            }
            if (matches.length > 0) {
              searchResults.push({ fileName: file.name, filePath: file.path, matches });
            }
          } catch { /* skip unreadable files */ }
        }

        if (!abortRef.current) {
          setResults(searchResults);
          setFileCount(files.length);
        }
      }
    } catch {
      if (!abortRef.current) setResults([]);
    }

    if (!abortRef.current) setSearching(false);
  }, [rootDirPath]);

  useEffect(() => {
    clearTimeout(debounceRef.current);
    abortRef.current = true;

    if (!query || query.length < 2) {
      setResults([]);
      setFileCount(0);
      setSearching(false);
      return;
    }

    debounceRef.current = setTimeout(() => {
      performSearch(query);
    }, 250);

    return () => {
      clearTimeout(debounceRef.current);
      abortRef.current = true;
    };
  }, [query, performSearch]);

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  // Highlight match in context text
  const highlightText = (text, q) => {
    if (!q) return text;
    try {
      const regex = new RegExp(`(${escapeRegex(q)})`, 'gi');
      const parts = text.split(regex);
      return parts.map((part, i) =>
        regex.test(part) ? <mark key={i}>{part}</mark> : part
      );
    } catch {
      return text;
    }
  };

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <div className="global-search-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label={t('gsearch.title')}>
      <div className="global-search-panel" onClick={(e) => e.stopPropagation()}>
        <div className="global-search-header">
          <FileSearch size={18} className="search-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('gsearch.placeholder')}
            className="global-search-input"
            spellCheck={false}
          />
          <button
            onClick={onClose}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}
          >
            <X size={18} />
          </button>
        </div>

        {query.length >= 2 && (
          <div className="global-search-status">
            {searching ? t('gsearch.searching') :
              t('gsearch.status', { total: totalMatches, s: totalMatches !== 1 ? 's' : '', files: results.length, fs: results.length !== 1 ? 's' : '', scanned: fileCount })
            }
          </div>
        )}

        <div className="global-search-results">
          {results.length === 0 && query.length >= 2 && !searching && (
            <div className="global-search-empty">{t('gsearch.noResults')}</div>
          )}

          {results.map((file) => (
            <div key={file.filePath}>
              <div className="global-search-file">{file.fileName}</div>
              {file.matches.slice(0, 10).map((match, i) => (
                <button
                  key={i}
                  className="global-search-match"
                  onClick={() => {
                    onOpenFile(file.filePath);
                    onClose();
                  }}
                >
                  <span className="global-search-line">{match.line}</span>
                  <span className="global-search-text">
                    {highlightText(match.text, query)}
                  </span>
                </button>
              ))}
              {file.matches.length > 10 && (
                <div className="global-search-line" style={{ padding: '2px 28px', fontSize: '10px' }}>
                  {t('gsearch.moreResults', { n: file.matches.length - 10 })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default GlobalSearch;
