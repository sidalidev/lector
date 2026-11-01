import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Scroll, BookOpen, Highlighter, Ruler,
  Search, Sidebar, PanelRight, Maximize2, Zap, KeyRound, Youtube, FilePlus, Volume2, FolderDown, GraduationCap, Cloud, Info
} from 'lucide-react';
import normalizeSearch from '../utils/normalizeSearch';
import { t } from '../services/i18n'
import fileSystem from '../services/fileSystem';
import './CommandPalette.css';

function CommandPalette({ onClose, onCommand }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const isCapacitor = fileSystem.isCapacitor()

  const commands = useMemo(() => {
    const all = [
      { id: 'autoscroll', label: t('cmd.autoscroll'), description: t('cmd.autoscrollDesc'), icon: Scroll, keywords: 'scroll defiler auto' },
      { id: 'focus', label: t('cmd.focus'), description: t('cmd.focusDesc'), icon: Maximize2, keywords: 'focus zen distraction' },
      { id: 'ruler', label: t('cmd.ruler'), description: t('cmd.rulerDesc'), icon: Ruler, keywords: 'ruler regle lecture ligne' },
      { id: 'highlights', label: t('cmd.highlights'), description: t('cmd.highlightsDesc'), icon: Highlighter, keywords: 'highlight surligner annotations' },
      { id: 'flashcards', label: t('cmd.flashcards'), description: t('cmd.flashcardsDesc'), icon: BookOpen, keywords: 'flashcard revision cartes' },
      { id: 'search', label: t('cmd.search'), description: t('cmd.searchDesc'), icon: Search, keywords: 'search chercher find' },
      { id: 'sidebar', label: t('cmd.sidebar'), description: t('cmd.sidebarDesc'), icon: Sidebar, keywords: 'sidebar barre laterale panel' },
      { id: 'right-sidebar', label: t('cmd.rightSidebar'), description: t('cmd.rightSidebarDesc'), icon: PanelRight, keywords: 'right sidebar toc table matieres panneau droit' },
      { id: 'new-file', label: t('cmd.newFile'), description: t('cmd.newFileDesc'), icon: FilePlus, keywords: 'new file nouveau fichier creer create note' },
      { id: 'tts', label: t('cmd.tts'), description: t('cmd.ttsDesc'), icon: Volume2, keywords: 'audio lecture voix tts speech elevenlabs read aloud' },
      // YouTube et Export PDF uniquement sur desktop (pas fonctionnel sur mobile)
      ...(!isCapacitor ? [
        { id: 'export-pdf', label: t('cmd.exportPdf'), description: t('cmd.exportPdfDesc'), icon: Zap, keywords: 'export pdf imprimer' },
        { id: 'export-folder-pdf', label: t('cmd.exportFolderPdf'), description: t('cmd.exportFolderPdfDesc'), icon: FolderDown, keywords: 'export folder dossier pdf all tout formation' },
        { id: 'youtube', label: t('cmd.youtube'), description: t('cmd.youtubeDesc'), icon: Youtube, keywords: 'youtube video transcript srt sous-titres subtitles' },
      ] : []),
      { id: 'learn', label: t('cmd.learn'), description: t('cmd.learnDesc'), icon: GraduationCap, keywords: 'learn apprendre comprendre understand topic sujet fiche revision study' },
      { id: 'api-keys', label: t('cmd.apiKeys'), description: t('cmd.apiKeysDesc'), icon: KeyRound, keywords: 'api key cle anthropic elevenlabs claude voix voice assistant' },
      { id: 'about', label: t('cmd.about'), description: t('cmd.aboutDesc'), icon: Info, keywords: 'about version privacy credits fonts a propos' },
      ...(!isCapacitor ? [
        { id: 'cloud', label: t('cmd.cloud'), description: t('cmd.cloudDesc'), icon: Cloud, keywords: 'vault cloud sync synchro chaine chain appareil device nuage' },
      ] : []),
    ]
    return all
  }, [isCapacitor]);

  const filtered = useMemo(() => {
    if (!query.trim()) return commands;
    const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
    return commands.filter(cmd => {
      const haystack = normalizeSearch(`${cmd.label} ${cmd.description} ${cmd.keywords}`);
      return terms.every(term => haystack.includes(term));
    });
  }, [query, commands]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [filtered]);

  useEffect(() => {
    const el = listRef.current?.children[selectedIndex];
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const execute = (cmd) => {
    onCommand(cmd.id)
    onClose()
  };

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(i => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (filtered[selectedIndex]) execute(filtered[selectedIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div className="command-palette" onClick={e => e.stopPropagation()}>
        <div className="command-palette-header">
          <span className="command-palette-prefix">&gt;</span>
          <input
            ref={inputRef}
            className="command-palette-input"
            type="text"
            placeholder={t('cmd.searchCommand')}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
          />
        </div>
        <div className="command-palette-list" ref={listRef}>
          {filtered.map((cmd, i) => {
            const Icon = cmd.icon;
            return (
              <button
                key={cmd.id}
                className={`command-palette-item ${i === selectedIndex ? 'selected' : ''}`}
                onClick={() => execute(cmd)}
                onMouseEnter={() => setSelectedIndex(i)}
              >
                <span className="command-palette-icon"><Icon size={16} /></span>
                <div className="command-palette-text">
                  <span className="command-palette-label">{cmd.label}</span>
                  <span className="command-palette-desc">{cmd.description}</span>
                </div>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="command-palette-empty">{t('cmd.noResults')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
