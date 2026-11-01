/**
 * Escape special regex characters in a string.
 * Used in SearchBar, GlobalSearch, FloatingTOC.
 */
export default function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
