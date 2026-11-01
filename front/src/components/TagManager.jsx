import { useState, useEffect } from 'react';
import storage from '../services/storage';
import syncService from '../services/syncService';
import { persistToFile } from '../services/docPersist';
import './TagManager.css';
import { t } from '../services/i18n'

const PRESET_COLORS = [
  '#E57373', // Red
  '#FFB74D', // Orange
  '#FFF176', // Yellow
  '#81C784', // Green
  '#64B5F6', // Blue
  '#BA68C8', // Purple
  '#F06292', // Pink
  '#90A4AE', // Grey
];

function TagManager({ filePath, onClose }) {
  const [tags, setTags] = useState([]);
  const [allTags, setAllTags] = useState([]);
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);

  // Load tags from localStorage
  useEffect(() => {
    setAllTags(storage.get('all-tags', []));
    setTags(storage.get(`file-tags-${filePath}`, []));
  }, [filePath]);

  // Save tags
  const saveTags = (newTags, newAllTags) => {
    storage.set(`file-tags-${filePath}`, newTags);
    storage.set('all-tags', newAllTags);
    syncService.markDirty(filePath);
    syncService.markGlobalDirty();
    persistToFile(filePath);
  };

  const addTag = () => {
    if (!newTagName.trim()) return;

    const tagName = newTagName.trim();

    // Check if tag already exists in all tags
    let existingTag = allTags.find(t => t.name.toLowerCase() === tagName.toLowerCase());

    if (!existingTag) {
      existingTag = { name: tagName, color: selectedColor };
      const newAllTags = [...allTags, existingTag];
      setAllTags(newAllTags);
      saveTags([...tags, existingTag], newAllTags);
    } else {
      saveTags([...tags, existingTag], allTags);
    }

    // Add to file's tags if not already there
    if (!tags.find(t => t.name.toLowerCase() === tagName.toLowerCase())) {
      setTags([...tags, existingTag]);
    }

    setNewTagName('');
  };

  const removeTag = (tagName) => {
    const newTags = tags.filter(t => t.name !== tagName);
    setTags(newTags);
    saveTags(newTags, allTags);
  };

  const addExistingTag = (tag) => {
    if (!tags.find(t => t.name === tag.name)) {
      const newTags = [...tags, tag];
      setTags(newTags);
      saveTags(newTags, allTags);
    }
  };

  const availableTags = allTags.filter(t => !tags.find(ft => ft.name === t.name));

  return (
    <div className="tag-manager-overlay" onClick={onClose}>
      <div className="tag-manager" onClick={e => e.stopPropagation()}>
        <div className="tag-manager-header">
          <h3>{t('tags.title')}</h3>
          <button className="tag-manager-close" onClick={onClose}>✕</button>
        </div>

        {/* Current tags */}
        <div className="current-tags">
          {tags.length === 0 ? (
            <p className="no-tags">{t('tags.noTags')}</p>
          ) : (
            <div className="tags-list">
              {tags.map(tag => (
                <span
                  key={tag.name}
                  className="tag"
                  style={{ backgroundColor: tag.color }}
                >
                  {tag.name}
                  <button onClick={() => removeTag(tag.name)}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Add new tag */}
        <div className="add-tag-section">
          <div className="add-tag-input">
            <input
              type="text"
              value={newTagName}
              onChange={e => setNewTagName(e.target.value)}
              placeholder={t('tags.newTag')}
              onKeyDown={e => e.key === 'Enter' && addTag()}
            />
            <button onClick={addTag}>+</button>
          </div>
          <div className="color-picker">
            {PRESET_COLORS.map(color => (
              <button
                key={color}
                className={`color-btn ${selectedColor === color ? 'active' : ''}`}
                style={{ backgroundColor: color }}
                onClick={() => setSelectedColor(color)}
              />
            ))}
          </div>
        </div>

        {/* Existing tags */}
        {availableTags.length > 0 && (
          <div className="existing-tags">
            <p className="section-label">{t('tags.existing')}</p>
            <div className="tags-list">
              {availableTags.map(tag => (
                <span
                  key={tag.name}
                  className="tag clickable"
                  style={{ backgroundColor: tag.color }}
                  onClick={() => addExistingTag(tag)}
                >
                  {tag.name}
                  <span className="add-icon">+</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Helper hook for getting tags
export function useFileTags(filePath) {
  const [tags, setTags] = useState([]);

  useEffect(() => {
    if (!filePath) return;
    setTags(storage.get(`file-tags-${filePath}`, []));
  }, [filePath]);

  return tags;
}

export default TagManager;
