/**
 * Dual-write service: sync per-document data from localStorage to the .md file.
 * Debounced pour éviter les écritures multiples.
 */
import fileSystem from './fileSystem'
import storage from './storage'
import { parseGeneratedSections, updateGeneratedSections } from './lectorGenerated'

const timers = new Map()
const DEBOUNCE_MS = 2000

/**
 * Persiste les données per-document dans le bloc <!-- lector-generated --> du .md.
 * Debounced : n'écrit qu'après 2s d'inactivité.
 */
export function persistToFile(filePath) {
  if (!filePath) return
  const existing = timers.get(filePath)
  if (existing) clearTimeout(existing)
  timers.set(filePath, setTimeout(() => {
    timers.delete(filePath)
    _doWrite(filePath)
  }, DEBOUNCE_MS))
}

async function _doWrite(filePath) {
  try {
    const fileContent = await fileSystem.readFile(filePath)
    if (!fileContent) return

    const { originalContent, generated } = parseGeneratedSections(fileContent)
    const updated = { ...(generated || {}) }

    // Highlights
    const highlights = storage.getRaw(`highlights-${filePath}`, null)
    if (highlights && highlights.length > 0) {
      updated.highlights = highlights
    } else {
      updated.highlights = null
    }

    // Flashcards SR (séparer définitions et données SR)
    const flashcardsData = storage.getRaw(`flashcards-${filePath}`, null)
    if (flashcardsData?.flashcards?.length > 0) {
      // Les définitions (question/answer/difficulty) sont déjà dans le .md via generateAllContent
      // On persiste uniquement les données SR
      updated.flashcardsSR = {
        cards: flashcardsData.flashcards.map(c => ({
          easeFactor: c.easeFactor,
          interval: c.interval,
          repetitions: c.repetitions,
          lastReviewedAt: c.lastReviewedAt,
          nextReviewAt: c.nextReviewAt,
        })),
        score: flashcardsData.score,
        generatedAt: flashcardsData.generatedAt,
      }
    }

    // Quiz SR
    const quizData = storage.getRaw(`quiz-${filePath}`, null)
    if (quizData?.cards?.length > 0) {
      updated.quizSR = quizData
    }

    // Tags
    const tags = storage.get(`file-tags-${filePath}`, null)
    if (tags && tags.length > 0) {
      updated.tags = tags
    } else {
      updated.tags = null
    }

    const newContent = updateGeneratedSections(originalContent, updated)
    if (newContent !== fileContent) {
      await fileSystem.writeFile(filePath, newContent)
    }
  } catch (err) {
    console.warn('[docPersist] Error writing to file:', err.message)
  }
}
