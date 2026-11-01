import { useState, useEffect, useCallback } from 'react';
import { StickyNote, X, Trash2, Check, Pencil, Plus, Sparkles, MessageSquare, Highlighter } from 'lucide-react';
import syncService from '../services/syncService';
import storage from '../services/storage';
import { persistToFile } from '../services/docPersist';
import './Highlights.css';
import { t } from '../services/i18n'

const HIGHLIGHT_COLORS = [
  { name: 'yellow', color: '#fef08a', labelKey: 'highlights.yellow' },
  { name: 'green', color: '#bbf7d0', labelKey: 'highlights.green' },
  { name: 'blue', color: '#bfdbfe', labelKey: 'highlights.blue' },
  { name: 'pink', color: '#fbcfe8', labelKey: 'highlights.pink' },
  { name: 'orange', color: '#fed7aa', labelKey: 'highlights.orange' },
];

function Highlights({ filePath, onHighlightsChange, editingHighlight, setEditingHighlight }) {
  const [highlights, setHighlights] = useState([]);
  const [showPopup, setShowPopup] = useState(false);
  const [popupPosition, setPopupPosition] = useState({ x: 0, y: 0 });
  const [pendingSelection, setPendingSelection] = useState(null);
  const [noteText, setNoteText] = useState('');

  // Load highlights from localStorage
  useEffect(() => {
    if (!filePath) return;
    const parsed = storage.getRaw(`highlights-${filePath}`, null);
    if (parsed) {
      setHighlights(parsed);
      onHighlightsChange?.(parsed);
    } else {
      setHighlights([]);
      onHighlightsChange?.([]);
    }
  }, [filePath]);

  // Save highlights to localStorage + sync
  useEffect(() => {
    if (!filePath || highlights.length === 0 && !storage.getRaw(`highlights-${filePath}`, null)) return;
    storage.setRaw(`highlights-${filePath}`, highlights);
    onHighlightsChange?.(highlights);
    syncService.markDirty(filePath);
    persistToFile(filePath);
  }, [highlights, filePath]);

  // Apply highlights to DOM: preserve scroll position during mutations
  useEffect(() => {
    if (!filePath) return;

    const docView = document.querySelector('.document-view');
    const scrollTop = docView?.scrollTop ?? 0;

    // Remove existing highlights first
    const existingMarks = document.querySelectorAll('mark[data-highlight-id]');
    existingMarks.forEach(mark => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });

    // Apply highlights using text search
    highlights.forEach(highlight => {
      applyHighlightToDOM(highlight);
    });

    // Restore scroll position after DOM mutations
    if (docView && Math.abs(docView.scrollTop - scrollTop) > 5) {
      docView.scrollTop = scrollTop;
    }
  }, [highlights, filePath]);

  // Apply a single highlight to the DOM
  const applyHighlightToDOM = (highlight) => {
    const docContent = document.querySelector('.document-content');
    if (!docContent) return;

    const walker = document.createTreeWalker(
      docContent,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );

    let node;
    while (node = walker.nextNode()) {
      const index = node.textContent.indexOf(highlight.text);
      if (index !== -1) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + highlight.text.length);

        const mark = document.createElement('mark');
        mark.setAttribute('data-highlight-id', highlight.id);
        mark.style.backgroundColor = highlight.colorValue;
        if (highlight.note) {
          mark.classList.add('has-note');
        }

        try {
          range.surroundContents(mark);

          // Add click handler for editing
          mark.addEventListener('click', (e) => {
            e.stopPropagation();
            setEditingHighlight?.(highlight);
            setNoteText(highlight.note || '');
          });

          break; // Only highlight first occurrence
        } catch (e) {
          // Range spans multiple elements, skip
        }
      }
    }
  };

  // Handle text selection
  const handleMouseUp = useCallback((e) => {
    // Ignore if clicking on popup
    if (e.target.closest('.highlight-popup') || e.target.closest('.note-modal')) {
      return;
    }

    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();

    if (!selectedText || selectedText.length < 3) {
      setTimeout(() => setShowPopup(false), 100);
      return;
    }

    // Check if selection is within document content
    if (selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    const container = range.commonAncestorContainer;
    const docContent = document.querySelector('.document-content');

    if (!docContent?.contains(container)) {
      setShowPopup(false);
      return;
    }

    // Check if already highlighted
    if (e.target.closest('mark[data-highlight-id]')) {
      return;
    }

    // Get selection position
    const rect = range.getBoundingClientRect();

    setPendingSelection({
      text: selectedText,
    });

    setPopupPosition({
      x: rect.left + rect.width / 2,
      y: rect.top - 10,
    });
    setShowPopup(true);
  }, []);

  // Add highlight
  const addHighlight = (colorName) => {
    if (!pendingSelection) return;

    const color = HIGHLIGHT_COLORS.find(c => c.name === colorName);
    const newHighlight = {
      id: Date.now().toString(),
      text: pendingSelection.text,
      color: colorName,
      colorValue: color.color,
      note: '',
      createdAt: new Date().toISOString(),
    };

    setHighlights(prev => [...prev, newHighlight]);
    setShowPopup(false);
    setPendingSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // Remove highlight
  const removeHighlight = (id) => {
    setHighlights(prev => prev.filter(h => h.id !== id));
    setEditingHighlight?.(null);
  };

  // Update note
  const updateNote = (id, note) => {
    setHighlights(prev => prev.map(h =>
      h.id === id ? { ...h, note } : h
    ));
  };

  // Setup event listeners
  useEffect(() => {
    document.addEventListener('mouseup', handleMouseUp);
    return () => document.removeEventListener('mouseup', handleMouseUp);
  }, [handleMouseUp]);

  // Close popup on click outside
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest('.highlight-popup') && !e.target.closest('.highlight-color-btn')) {
        setShowPopup(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Handle editing highlight from parent
  useEffect(() => {
    if (editingHighlight) {
      setNoteText(editingHighlight.note || '');
    }
  }, [editingHighlight]);

  return (
    <>
      {/* Selection popup */}
      {showPopup && (
        <div
          className="highlight-popup"
          style={{
            left: popupPosition.x,
            top: popupPosition.y,
          }}
        >
          <div className="highlight-colors">
            {HIGHLIGHT_COLORS.map(color => (
              <button
                key={color.name}
                className="highlight-color-btn"
                style={{ backgroundColor: color.color }}
                onClick={() => addHighlight(color.name)}
                title={t(color.labelKey)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Note editor modal */}
      {editingHighlight && (
        <div className="note-modal-overlay" onClick={() => setEditingHighlight(null)}>
          <div className="note-modal" onClick={e => e.stopPropagation()}>
            <div className="note-modal-header">
              <StickyNote size={18} />
              <span>Note</span>
              <button onClick={() => setEditingHighlight(null)}>
                <X size={16} />
              </button>
            </div>
            <div
              className="note-modal-highlight"
              style={{ backgroundColor: editingHighlight.colorValue }}
            >
              "{editingHighlight.text.slice(0, 150)}{editingHighlight.text.length > 150 ? '...' : ''}"
            </div>
            <textarea
              className="note-modal-textarea"
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder={t('highlights.notePlaceholder')}
              autoFocus
            />
            <div className="note-modal-actions">
              <button
                className="note-modal-delete"
                onClick={() => {
                  removeHighlight(editingHighlight.id);
                }}
              >
                <Trash2 size={14} /> {t('highlights.delete')}
              </button>
              <button
                className="note-modal-save"
                onClick={() => {
                  updateNote(editingHighlight.id, noteText);
                  setEditingHighlight(null);
                }}
              >
                <Check size={14} /> {t('highlights.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// Highlights Panel component
export function HighlightsPanel({ highlights, onSelectHighlight, onEditNote, onClose }) {
  return (
    <div className="highlights-panel">
      <div className="highlights-panel-header">
        <Highlighter size={18} />
        <h3>Notes & Highlights</h3>
        <span className="highlights-count">{highlights.length}</span>
        <button className="highlights-close" onClick={onClose}>
          <X size={16} />
        </button>
      </div>

      {highlights.length === 0 ? (
        <div className="highlights-empty">
          <Sparkles size={48} className="highlights-empty-icon" />
          <p>{t('highlights.none')}</p>
          <p className="highlights-hint">{t('highlights.hint')}</p>
        </div>
      ) : (
        <div className="highlights-list">
          {highlights.map(highlight => (
            <div
              key={highlight.id}
              className="highlight-item"
              onClick={() => onSelectHighlight?.(highlight)}
            >
              <div
                className="highlight-item-bar"
                style={{ backgroundColor: highlight.colorValue }}
              />
              <div className="highlight-item-content">
                <p className="highlight-item-text">
                  "{highlight.text.slice(0, 80)}{highlight.text.length > 80 ? '...' : ''}"
                </p>
                {highlight.note && (
                  <p className="highlight-item-note">
                    <MessageSquare size={12} /> {highlight.note}
                  </p>
                )}
                <button
                  className="highlight-item-edit"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditNote?.(highlight);
                  }}
                >
                  {highlight.note ? <><Pencil size={12} /> {t('highlights.editNote')}</> : <><Plus size={12} /> {t('highlights.addNote')}</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default Highlights;
export { HIGHLIGHT_COLORS };
