// Recherche cross-document : utilisé par ChatPanel pour chercher dans tous les docs
import fileSystem from './fileSystem'
import normalizeSearch from '../utils/normalizeSearch'

// Aplatir l'arbre de fichiers en liste de .md
function flattenTree(items, list = []) {
  for (const item of items) {
    if (item.isDirectory && item.children) {
      flattenTree(item.children, list)
    } else if (item.name?.endsWith('.md')) {
      list.push({ name: item.name, path: item.path })
    }
  }
  return list
}

/**
 * Liste tous les fichiers .md du workspace (juste les noms relatifs)
 */
export async function listWorkspaceFiles(rootDirPath) {
  if (!rootDirPath) return []
  const tree = await fileSystem.listDirectoryFiles(rootDirPath)
  const files = flattenTree(tree || [])
  return files.map(f => {
    // Chemin relatif par rapport au rootDir
    const rel = f.path.startsWith(rootDirPath) ? f.path.slice(rootDirPath.length + 1) : f.name
    return rel
  })
}

/**
 * Cherche des keywords dans tous les documents .md d'un dossier
 * @param {string} rootDirPath - Chemin racine
 * @param {string[]} keywords - Mots-clés à chercher
 * @param {object} options
 * @param {number} options.maxResults - Nombre max de docs retournés (défaut: 5)
 * @param {string} options.excludePath - Chemin du doc courant à exclure
 * @returns {{ results: Array<{ fileName, filePath, relevance, excerpts }>, fileCount }}
 */
export async function searchAllDocuments(rootDirPath, keywords, { maxResults = 5, excludePath } = {}) {
  if (!rootDirPath || !keywords?.length) {
    return { results: [], fileCount: 0 }
  }

  const tree = await fileSystem.listDirectoryFiles(rootDirPath)
  const files = flattenTree(tree || [])
  const normKeywords = keywords.map(k => normalizeSearch(k))
  const results = []

  for (const file of files) {
    // Exclure le document courant
    if (excludePath && file.path === excludePath) continue

    try {
      const content = await fileSystem.readFile(file.path)
      if (!content) continue

      const normContent = normalizeSearch(content)
      let relevance = 0
      const excerpts = []

      for (const kw of normKeywords) {
        if (!kw) continue
        // Compter les occurrences
        let idx = 0
        let count = 0
        while ((idx = normContent.indexOf(kw, idx)) !== -1) {
          count++
          idx += kw.length
        }
        if (count > 0) {
          relevance += count

          // Extraire un extrait autour de la première occurrence
          if (excerpts.length < 3) {
            const firstIdx = normContent.indexOf(kw)
            const start = Math.max(0, firstIdx - 80)
            const end = Math.min(content.length, firstIdx + kw.length + 80)
            excerpts.push(content.substring(start, end).trim())
          }
        }
      }

      if (relevance > 0) {
        results.push({
          fileName: file.name,
          filePath: file.path,
          relevance,
          excerpts,
        })
      }
    } catch { /* fichier illisible, on skip */ }
  }

  // Trier par pertinence décroissante
  results.sort((a, b) => b.relevance - a.relevance)

  return {
    results: results.slice(0, maxResults),
    fileCount: files.length,
  }
}

/**
 * Charge tous les .md d'un dossier (pas récursif) comme contexte
 * @param {string} dirPath - Chemin du dossier
 * @param {string} excludePath - Fichier à exclure (le doc courant)
 * @param {number} maxChars - Limite totale de caractères
 */
export async function buildFolderContext(dirPath, excludePath, maxChars = 8000) {
  if (!dirPath) return ''
  const tree = await fileSystem.listDirectoryFiles(dirPath)
  if (!tree) return ''

  // Fichiers .md du dossier uniquement (pas récursif)
  const files = (tree || []).filter(f => !f.isDirectory && f.name?.endsWith('.md'))
  let context = ''
  for (const file of files) {
    if (file.path === excludePath) continue
    try {
      const content = await fileSystem.readFile(file.path)
      if (!content) continue
      const truncated = content.substring(0, 2000)
      const block = `--- ${file.name} ---\n${truncated}\n\n`
      if (context.length + block.length > maxChars) break
      context += block
    } catch { /* skip */ }
  }
  return context
}

/**
 * Charge tous les .md du workspace (récursif) comme contexte
 */
export async function buildWorkspaceContext(rootDirPath, excludePath, maxChars = 10000) {
  if (!rootDirPath) return ''
  const tree = await fileSystem.listDirectoryFiles(rootDirPath)
  const files = flattenTree(tree || [])
  let context = ''
  for (const file of files) {
    if (file.path === excludePath) continue
    try {
      const content = await fileSystem.readFile(file.path)
      if (!content) continue
      const truncated = content.substring(0, 1500)
      const block = `--- ${file.name} ---\n${truncated}\n\n`
      if (context.length + block.length > maxChars) break
      context += block
    } catch { /* skip */ }
  }
  return context
}

/**
 * Construit le contexte enrichi à partir des résultats de recherche
 * Lit le contenu des docs trouvés et les formate pour l'AI
 */
export async function buildExtraContext(searchResults, maxChars = 6000) {
  let context = ''
  for (const result of searchResults) {
    try {
      const content = await fileSystem.readFile(result.filePath)
      if (!content) continue
      const truncated = content.substring(0, 2000)
      const block = `--- ${result.fileName} ---\n${truncated}\n\n`
      if (context.length + block.length > maxChars) break
      context += block
    } catch { /* skip */ }
  }
  return context
}
