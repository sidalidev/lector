import { useState, useEffect, useRef, useCallback } from 'react';
import { Search, ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, FileSearch } from 'lucide-react';
import escapeRegex from '../utils/escapeRegex';
import './SearchBar.css';
import { t } from '../services/i18n'

function SearchBar({ content, onClose, onGlobalSearch }) {
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef(null);
  const highlightsRef = useRef([]);
  const cleanupRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Build regex from options
  const buildRegex = useCallback((q) => {
    if (!q || q.length < 2) return null;
    let pattern = escapeRegex(q);
    if (wholeWord) pattern = `\\b${pattern}\\b`;
    try {
      return new RegExp(pattern, caseSensitive ? 'g' : 'gi');
    } catch {
      return null;
    }
  }, [caseSensitive, wholeWord]);

  // Cleanup all highlights efficiently
  const cleanup = useCallback(() => {
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    highlightsRef.current = [];
    setMatchCount(0);
  }, []);

  // Perform highlighting using CSS Custom Highlight API if available, else mark elements
  const highlight = useCallback((q) => {
    cleanup();

    const regex = buildRegex(q);
    if (!regex) return;

    const docEl = document.querySelector('.document-content');
    if (!docEl) return;

    // Use efficient approach: collect all text nodes once, find ranges
    const walker = document.createTreeWalker(docEl, NodeFilter.SHOW_TEXT);
    const marks = [];
    const ranges = [];

    // Single pass: find all matching ranges
    let textNode;
    while ((textNode = walker.nextNode())) {
      const text = textNode.textContent;
      if (!text) continue;

      let match;
      // Reset lastIndex for each node
      regex.lastIndex = 0;
      while ((match = regex.exec(text)) !== null) {
        const range = document.createRange();
        range.setStart(textNode, match.index);
        range.setEnd(textNode, match.index + match[0].length);
        ranges.push(range);
      }
    }

    if (ranges.length === 0) return;

    // Try CSS Custom Highlight API (Chrome 105+, very performant, no DOM mutation)
    if (CSS.highlights) {
      const allHighlight = new Highlight(...ranges);
      CSS.highlights.set('search-results', allHighlight);

      // Store ranges for navigation
      highlightsRef.current = ranges;
      setMatchCount(ranges.length);

      cleanupRef.current = () => {
        CSS.highlights.delete('search-results');
        CSS.highlights.delete('search-current');
      };
      return;
    }

    // Fallback: wrap in <mark> elements (reverse order to preserve offsets)
    for (let i = ranges.length - 1; i >= 0; i--) {
      const mark = document.createElement('mark');
      mark.className = 'search-highlight';
      try {
        ranges[i].surroundContents(mark);
        marks.unshift(mark);
      } catch {
        // surroundContents can fail if range spans elements
        // In that case skip this match
      }
    }

    highlightsRef.current = marks;
    setMatchCount(marks.length);

    cleanupRef.current = () => {
      for (const mark of marks) {
        if (mark.parentNode) {
          const parent = mark.parentNode;
          while (mark.firstChild) {
            parent.insertBefore(mark.firstChild, mark);
          }
          parent.removeChild(mark);
          parent.normalize(); // merge adjacent text nodes
        }
      }
    };
  }, [buildRegex, cleanup]);

  // Debounced search
  useEffect(() => {
    clearTimeout(debounceRef.current);
    if (!query || query.length < 2) {
      cleanup();
      return;
    }
    debounceRef.current = setTimeout(() => {
      highlight(query);
      setCurrentIndex(0);
    }, 80);

    return () => clearTimeout(debounceRef.current);
  }, [query, caseSensitive, wholeWord, highlight, cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
      clearTimeout(debounceRef.current);
    };
  }, [cleanup]);

  // Navigate to current match
  useEffect(() => {
    if (matchCount === 0) return;
    const items = highlightsRef.current;
    if (!items.length) return;

    const idx = Math.min(currentIndex, items.length - 1);

    if (CSS.highlights) {
      // CSS Highlight API: set current highlight
      const currentRange = items[idx];
      if (currentRange) {
        CSS.highlights.set('search-current', new Highlight(currentRange));
        // Scroll into view: get the range's bounding rect
        const rect = currentRange.getBoundingClientRect();
        const docView = document.querySelector('.document-view');
        if (docView && rect) {
          const viewRect = docView.getBoundingClientRect();
          if (rect.top < viewRect.top + 60 || rect.bottom > viewRect.bottom - 60) {
            const el = currentRange.startContainer.parentElement;
            el?.scrollIntoView({ block: 'center' });
          }
        }
      }
    } else {
      // Mark fallback: toggle .current class
      items.forEach((el, i) => {
        el.classList.toggle('current', i === idx);
      });
      items[idx]?.scrollIntoView({ block: 'center' });
    }
  }, [currentIndex, matchCount]);

  const goNext = () => {
    if (matchCount > 0) setCurrentIndex(prev => (prev + 1) % matchCount);
  };

  const goPrev = () => {
    if (matchCount > 0) setCurrentIndex(prev => prev === 0 ? matchCount - 1 : prev - 1);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.shiftKey ? goPrev() : goNext();
    }
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div className="search-bar">
      <div className="search-input-row">
        <Search size={15} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setCurrentIndex(0); }}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          className="search-input"
          spellCheck={false}
        />
        {query && matchCount >= 0 && (
          <span className="search-count">
            {matchCount > 0 ? `${currentIndex + 1}/${matchCount}` : t('search.noResults')}
          </span>
        )}
      </div>

      <div className="search-options">
        <button
          className={`search-option-btn ${caseSensitive ? 'active' : ''}`}
          onClick={() => setCaseSensitive(prev => !prev)}
          title={t('search.caseSensitive')}
        >
          <CaseSensitive size={15} />
        </button>
        <button
          className={`search-option-btn ${wholeWord ? 'active' : ''}`}
          onClick={() => setWholeWord(prev => !prev)}
          title={t('search.wholeWord')}
        >
          <WholeWord size={15} />
        </button>
        {onGlobalSearch && (
          <button
            className="search-option-btn"
            onClick={() => onGlobalSearch(query)}
            title={t('search.globalSearch')}
          >
            <FileSearch size={15} />
          </button>
        )}
      </div>

      <div className="search-nav">
        <button onClick={goPrev} disabled={matchCount === 0} title={t('search.previous')}>
          <ChevronUp size={16} />
        </button>
        <button onClick={goNext} disabled={matchCount === 0} title={t('search.next')}>
          <ChevronDown size={16} />
        </button>
        <button onClick={onClose} className="search-close-btn" title={t('search.close')}>
          <X size={16} />
        </button>
      </div>
    </div>
  );
}

export default SearchBar;
