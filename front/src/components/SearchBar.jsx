import { useState, useEffect, useRef } from 'react';
import { Search, ChevronUp, ChevronDown, X, CaseSensitive, WholeWord, FileSearch } from 'lucide-react';
import { chercher, montrerResultat, effacerRecherche, regexDeRecherche } from '../services/editeurCourant';
import './SearchBar.css';
import { t } from '../services/i18n'

function SearchBar({ onClose, onGlobalSearch }) {
  const [query, setQuery] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Recherche dans le texte de la note (l'éditeur), sans tenir compte des accents.
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const n = chercher(regexDeRecherche(query, { caseSensitive, wholeWord }));
      setMatchCount(n);
      setCurrentIndex(0);
      if (n) montrerResultat(0);
    }, 80);
    return () => clearTimeout(debounceRef.current);
  }, [query, caseSensitive, wholeWord]);

  useEffect(() => () => { clearTimeout(debounceRef.current); effacerRecherche(); }, []);

  useEffect(() => {
    if (matchCount > 0) montrerResultat(Math.min(currentIndex, matchCount - 1));
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
