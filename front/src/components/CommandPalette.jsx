import { useState, useEffect, useRef, useMemo } from 'react';
import {
  Search, Sidebar, PanelRight, FilePlus, Cloud, Info, CalendarCheck, ListPlus, Share2, History
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
      { id: 'today', label: t('cmd.today'), description: t('cmd.todayDesc'), icon: CalendarCheck, keywords: 'today tasks todo due overdue reminders week agenda' },
      { id: 'new-task', label: t('cmd.newTask'), description: t('cmd.newTaskDesc'), icon: ListPlus, keywords: 'new task todo reminder inbox add rappel tache', shortcut: fileSystem.isElectron() ? '⌘N' : null },
      // Partage en temps réel : navigateur seulement pour l'instant (docs/collab-design.md § 9).
      ...(!isCapacitor && !fileSystem.isElectron() ? [
        { id: 'history', label: t('cmd.history'), description: t('cmd.historyDesc'), icon: History, keywords: 'history versions restore undo previous revision historique' },
        { id: 'share', label: t('cmd.share'), description: t('cmd.shareDesc'), icon: Share2, keywords: 'share collaborate together co-write link partager' },
      ] : []),
      { id: 'search', label: t('cmd.search'), description: t('cmd.searchDesc'), icon: Search, keywords: 'search chercher find' },
      { id: 'sidebar', label: t('cmd.sidebar'), description: t('cmd.sidebarDesc'), icon: Sidebar, keywords: 'sidebar barre laterale panel' },
      { id: 'right-sidebar', label: t('cmd.rightSidebar'), description: t('cmd.rightSidebarDesc'), icon: PanelRight, keywords: 'right sidebar toc table matieres panneau droit' },
      { id: 'new-file', label: t('cmd.newFile'), description: t('cmd.newFileDesc'), icon: FilePlus, keywords: 'new file nouveau fichier creer create note' },
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
                {cmd.shortcut && <kbd className="command-palette-shortcut">{cmd.shortcut}</kbd>}
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
