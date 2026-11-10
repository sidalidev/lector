import { useState, useEffect, useCallback, useRef, memo } from 'react';
import { List, Search, ChevronUp, ChevronDown, CaseSensitive, WholeWord } from 'lucide-react';
import { t } from '../services/i18n';
import escapeRegex from '../utils/escapeRegex';
import './FloatingTOC.css';

// Table des matières du document (et, dans le panneau mobile, la recherche dans la note).
function RightSidebar({ headers, showInlineSearch = false }) {
  const [activeId, setActiveId] = useState(null);

  // Inline search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const searchInputRef = useRef(null);
  const searchHighlightsRef = useRef([]);
  const searchCleanupRef = useRef(null);
  const searchDebounceRef = useRef(null);

  // Auto-focus search when shown
  useEffect(() => {
    if (showInlineSearch && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [showInlineSearch]);

  // Inline search logic (reuses SearchBar approach)
  // Normaliser les accents pour recherche agnostique
  const normalize = useCallback((str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, ''), []);

  // Mapper un index de la string normalisée vers la string originale
  const mapNormalizedIndex = useCallback((original, normalizedIdx) => {
    const nfd = original.normalize('NFD');
    let origIdx = 0;
    let normCount = 0;
    for (let i = 0; i < nfd.length && normCount < normalizedIdx; i++) {
      if (!/[\u0300-\u036f]/.test(nfd[i])) normCount++;
      origIdx++;
    }
    // Convertir l'index NFD en index de la string originale
    const beforeNFD = nfd.substring(0, origIdx);
    return beforeNFD.normalize('NFC').length;
  }, []);

  const buildSearchRegex = useCallback((q) => {
    if (!q || q.length < 2) return null;
    // Normaliser la query (retirer les accents) pour matcher avec/sans accents
    let pattern = escapeRegex(normalize(q));
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    try {
      return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch { return null; }
  }, [caseSensitive, wholeWord, normalize]);

  const cleanupSearch = useCallback(() => {
    if (searchCleanupRef.current) {
      searchCleanupRef.current();
      searchCleanupRef.current = null;
    }
    searchHighlightsRef.current = [];
    setSearchCount(0);
  }, []);

  const performSearch = useCallback((q) => {
    cleanupSearch();
    const regex = buildSearchRegex(q);
    if (!regex) return;
    const docEl = document.querySelector('.document-content');
    if (!docEl) return;
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
    const ranges = [];
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      if (!text) continue;
      // Normaliser le texte pour matcher les accents
      const normalizedText = normalize(text);
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(normalizedText)) !== null) {
        // Les positions matchent car NFD decompose puis on retire les diacritiques
        // Il faut mapper les positions normalisées vers les positions originales
        const origStart = mapNormalizedIndex(text, match.index);
        const origEnd = mapNormalizedIndex(text, match.index + match[0].length);
        const range = document.createRange();
        range.setStart(textNode, origStart);
        range.setEnd(textNode, origEnd);
        ranges.push(range);
      }
    }
    if (ranges.length === 0) return;
    if (CSS.highlights) {
      CSS.highlights.set('search-results', new Highlight(...ranges));
      searchHighlightsRef.current = ranges;
      setSearchCount(ranges.length);
      searchCleanupRef.current = () => {
        CSS.highlights.delete('search-results');
        CSS.highlights.delete('search-current');
      };
    } else {
      const marks = [];
      for (let i = ranges.length - 1; i >= 0; i--) {
        const mark = document.createElement('mark');
        mark.className = 'search-highlight';
        try { ranges[i].surroundContents(mark); marks.unshift(mark); } catch {}
      }
      searchHighlightsRef.current = marks;
      setSearchCount(marks.length);
      searchCleanupRef.current = () => {
        for (const mark of marks) {
          if (mark.parentNode) {
            const parent = mark.parentNode;
            while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
            parent.removeChild(mark);
            parent.normalize();
          }
        }
      };
    }
  }, [buildSearchRegex, cleanupSearch]);

  // Debounced search
  useEffect(() => {
    clearTimeout(searchDebounceRef.current);
    if (!searchQuery || searchQuery.length < 2) { cleanupSearch(); return; }
    searchDebounceRef.current = setTimeout(() => {
      performSearch(searchQuery);
      setSearchIndex(0);
    }, 80);
    return () => clearTimeout(searchDebounceRef.current);
  }, [searchQuery, caseSensitive, wholeWord, performSearch, cleanupSearch]);

  // Navigate to current search match
  useEffect(() => {
    if (searchCount === 0) return;
    const items = searchHighlightsRef.current;
    if (!items.length) return;
    const idx = Math.min(searchIndex, items.length - 1);
    if (CSS.highlights) {
      const currentRange = items[idx];
      if (currentRange) {
        CSS.highlights.set('search-current', new Highlight(currentRange));
        const el = currentRange.startContainer.parentElement;
        el?.scrollIntoView({ block: 'center' });
      }
    } else {
      items.forEach((el, i) => el.classList.toggle('current', i === idx));
      items[idx]?.scrollIntoView({ block: 'center' });
    }
  }, [searchIndex, searchCount]);

  // Cleanup search on unmount
  useEffect(() => {
    return () => { cleanupSearch(); clearTimeout(searchDebounceRef.current); };
  }, [cleanupSearch]);

  const goNextSearch = () => { if (searchCount > 0) setSearchIndex(prev => (prev + 1) % searchCount); };
  const goPrevSearch = () => { if (searchCount > 0) setSearchIndex(prev => prev === 0 ? searchCount - 1 : prev - 1); };

  // IntersectionObserver for active header tracking
  useEffect(() => {
    if (headers.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0.1 }
    );

    const elements = headers.map(h => document.getElementById(h.id)).filter(Boolean);
    elements.forEach(el => observer.observe(el));

    return () => observer.disconnect();
  }, [headers]);


  // Auto-scroll la TOC vers le heading actif
  useEffect(() => {
    if (!activeId) return;
    const tocItem = document.querySelector(`.right-toc-item[data-toc-id="${activeId}"]`);
    tocItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  const handleClick = (id) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('highlight');
      setTimeout(() => el.classList.remove('highlight'), 2000);
    }
  };

  return (
    <aside className="right-sidebar">
      {/* Inline file search (shown in mobile popover) */}
      {showInlineSearch && (
        <div className="right-sidebar-search">
          <div className="right-search-row">
            <Search size={14} className="right-search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="right-search-input"
              placeholder={t('toc.searchPlaceholder')}
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setSearchIndex(0); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); e.shiftKey ? goPrevSearch() : goNextSearch(); }
                if (e.key === 'Escape') { setSearchQuery(''); cleanupSearch(); }
              }}
              spellCheck={false}
            />
            {searchQuery && (
              <span className="right-search-count">
                {searchCount > 0 ? `${searchIndex + 1}/${searchCount}` : t('toc.noResults')}
              </span>
            )}
          </div>
          <div className="right-search-controls">
            <button
              className={`right-search-opt ${caseSensitive ? 'active' : ''}`}
              onClick={() => setCaseSensitive(prev => !prev)}
              title={t('toc.caseSensitive')}
            >
              <CaseSensitive size={14} />
            </button>
            <button
              className={`right-search-opt ${wholeWord ? 'active' : ''}`}
              onClick={() => setWholeWord(prev => !prev)}
              title={t('toc.wholeWord')}
            >
              <WholeWord size={14} />
            </button>
            <div className="right-search-nav">
              <button onClick={goPrevSearch} disabled={searchCount === 0}><ChevronUp size={14} /></button>
              <button onClick={goNextSearch} disabled={searchCount === 0}><ChevronDown size={14} /></button>
            </div>
          </div>
        </div>
      )}

      <div className="right-section-label right-toc-label">{t('toc.summary')}</div>

      <div className="right-sidebar-content">
        {headers.length === 0 ? (
          <div className="right-sidebar-empty">
            <List size={28} style={{ opacity: 0.4, marginBottom: 6 }} />
            <p>{t('toc.noHeadings')}</p>
          </div>
        ) : (
          <div className="right-toc-list">
            {headers.map((h, i) => {
              // Trouver le parent pour désambiguïser les titres dupliqués
              let parentLabel = null;
              const isDuplicate = headers.filter(x => x.text === h.text).length > 1;
              if (isDuplicate && h.level > 2) {
                for (let j = i - 1; j >= 0; j--) {
                  if (headers[j].level < h.level) {
                    parentLabel = headers[j].text;
                    break;
                  }
                }
              }
              return (
                <button
                  key={h.id}
                  data-toc-id={h.id}
                  className={`right-toc-item level-${h.level} ${activeId === h.id ? 'active' : ''}`}
                  onClick={() => handleClick(h.id)}
                  title={parentLabel ? `${parentLabel} › ${h.text}` : h.text}
                >
                  {parentLabel && <span className="right-toc-parent">{parentLabel} › </span>}
                  {h.text}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}

export default memo(RightSidebar);
