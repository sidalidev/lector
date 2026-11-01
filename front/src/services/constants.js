// Utilitaires partagés

// Hash djb2 : utilisé par aiCache, syncService, tts, ChatPanel
export function hashString(str) {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash).toString(36)
}
