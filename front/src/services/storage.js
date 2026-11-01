/**
 * Centralized localStorage wrapper.
 * Replaces all raw localStorage.getItem/setItem scattered across the codebase.
 */

const PREFIX = 'lector-';

const storage = {
  get(key, defaultValue = null) {
    try {
      const stored = localStorage.getItem(PREFIX + key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(value));
    } catch { /* quota exceeded: ignore */ }
  },

  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },

  // Raw methods: no prefix, for keys shared across modules (highlights, flashcards)
  getRaw(key, defaultValue = null) {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  setRaw(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch { /* quota exceeded: ignore */ }
  },

  removeRaw(key) {
    localStorage.removeItem(key);
  },
};

export default storage;
