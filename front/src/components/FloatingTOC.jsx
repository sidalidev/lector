import { useState, useEffect, useRef, memo } from 'react';
import { List, Search, ChevronUp, ChevronDown, CaseSensitive, WholeWord } from 'lucide-react';
import { t } from '../services/i18n';
import { allerALigne, ligneEnHaut, chercher, montrerResultat, effacerRecherche, regexDeRecherche } from '../services/editeurCourant';
import './FloatingTOC.css';

// Table des matières du document (et, dans le panneau mobile, la recherche dans la note).
function RightSidebar({ headers, showInlineSearch = false }) {
  const [activeId, setActiveId] = useState(null);

  // Recherche dans la note (panneau mobile) : même moteur que la barre de recherche.
  const [searchQuery, setSearchQuery] = useState('');
  const [searchIndex, setSearchIndex] = useState(0);
  const [searchCount, setSearchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (showInlineSearch && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 100);
    }
  }, [showInlineSearch]);

  useEffect(() => {
    if (!showInlineSearch) return undefined;
    const minuteur = setTimeout(() => {
      const n = chercher(regexDeRecherche(searchQuery, { caseSensitive, wholeWord }));
      setSearchCount(n);
      setSearchIndex(0);
      if (n) montrerResultat(0);
    }, 80);
    return () => clearTimeout(minuteur);
  }, [showInlineSearch, searchQuery, caseSensitive, wholeWord]);

  useEffect(() => () => { if (showInlineSearch) effacerRecherche(); }, [showInlineSearch]);

  useEffect(() => {
    if (searchCount > 0) montrerResultat(Math.min(searchIndex, searchCount - 1));
  }, [searchIndex, searchCount]);

  const cleanupSearch = () => { effacerRecherche(); setSearchCount(0); };
  const goNextSearch = () => { if (searchCount > 0) setSearchIndex(prev => (prev + 1) % searchCount); };
  const goPrevSearch = () => { if (searchCount > 0) setSearchIndex(prev => prev === 0 ? searchCount - 1 : prev - 1); };

  // Titre courant : le dernier titre au-dessus du haut de l'écran.
  useEffect(() => {
    if (headers.length === 0) return undefined;
    const vue = document.querySelector('.document-view');
    if (!vue) return undefined;
    let image = 0;
    const suivre = () => {
      cancelAnimationFrame(image);
      image = requestAnimationFrame(() => {
        const haut = ligneEnHaut();
        if (haut == null) return;
        let actif = headers[0].id;
        for (const h of headers) { if (h.line <= haut + 2) actif = h.id; else break; }
        setActiveId(actif);
      });
    };
    vue.addEventListener('scroll', suivre, { passive: true });
    suivre();
    return () => { vue.removeEventListener('scroll', suivre); cancelAnimationFrame(image); };
  }, [headers]);

  // Auto-scroll la TOC vers le heading actif
  useEffect(() => {
    if (!activeId) return;
    const tocItem = document.querySelector(`.right-toc-item[data-toc-id="${activeId}"]`);
    tocItem?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeId]);

  const handleClick = (id) => {
    const h = headers.find((x) => x.id === id);
    if (h) allerALigne(h.line, { haut: true });
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
