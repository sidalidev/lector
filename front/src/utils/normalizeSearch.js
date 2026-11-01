/**
 * Remove diacritics (accents) from a string for accent-insensitive search.
 * "café" → "cafe", "éléphant" → "elephant", "résumé" → "resume"
 */
export default function normalizeSearch(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}
