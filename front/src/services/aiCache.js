/**
 * AI Cache Service - Cache intelligent pour le contenu généré par Claude
 * Ne regénère que si le document a changé de façon significative
 */
import storage from './storage';

const CACHE_PREFIX = 'lector-ai-v2-';
const SIMILARITY_THRESHOLD = 0.85; // 85% similaire = pas besoin de regénérer

/**
 * Calcule un hash stable du contenu
 */
function computeHash(content) {
  let hash = 0;
  for (let i = 0; i < content.length; i += 37) {
    hash = ((hash << 5) - hash + content.charCodeAt(i)) | 0;
  }
  hash = ((hash << 5) - hash + content.length) | 0;
  return hash.toString(36);
}

/**
 * Extrait la structure du document (headers)
 */
function extractStructure(content) {
  const headers = [];
  const lines = content.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headers.push({ level: match[1].length, title: match[2].trim() });
    }
  }
  return headers;
}

/**
 * Compare deux structures de headers
 */
function structureSimilarity(struct1, struct2) {
  if (struct1.length === 0 && struct2.length === 0) return 1;
  if (struct1.length === 0 || struct2.length === 0) return 0;

  const maxLen = Math.max(struct1.length, struct2.length);
  let matches = 0;

  for (let i = 0; i < Math.min(struct1.length, struct2.length); i++) {
    if (struct1[i].level === struct2[i].level &&
        struct1[i].title === struct2[i].title) {
      matches++;
    }
  }

  return matches / maxLen;
}

/**
 * Calcule la similarité entre deux contenus (0-1)
 */
function contentSimilarity(oldContent, newContent) {
  if (!oldContent || !newContent) return 0;

  // 1. Différence de longueur
  const lenRatio = Math.min(oldContent.length, newContent.length) /
                   Math.max(oldContent.length, newContent.length);

  // Si la taille a changé de plus de 30%, considérer comme différent
  if (lenRatio < 0.7) return lenRatio * 0.5;

  // 2. Comparer la structure (headers)
  const struct1 = extractStructure(oldContent);
  const struct2 = extractStructure(newContent);
  const structSim = structureSimilarity(struct1, struct2);

  // 3. Comparer début et fin du contenu
  const sampleSize = Math.min(500, oldContent.length, newContent.length);
  const startSame = oldContent.slice(0, sampleSize) === newContent.slice(0, sampleSize);
  const endSame = oldContent.slice(-sampleSize) === newContent.slice(-sampleSize);

  // 4. Score combiné
  const edgeSim = (startSame ? 0.5 : 0) + (endSame ? 0.5 : 0);

  // Pondération: 40% structure, 30% taille, 30% edges
  return (structSim * 0.4) + (lenRatio * 0.3) + (edgeSim * 0.3);
}

/**
 * Génère une clé de cache basée sur le filepath
 */
function getCacheKey(filePath) {
  // Utilise le filepath comme clé principale
  const safeKey = filePath.replace(/[^a-zA-Z0-9]/g, '-');
  return `${CACHE_PREFIX}${safeKey}`;
}

/**
 * Récupère le cache pour un fichier
 */
export function getCache(filePath) {
  const key = getCacheKey(filePath);
  return storage.getRaw(key, null);
}

/**
 * Sauvegarde dans le cache
 */
export function setCache(filePath, content, data) {
  try {
    const key = getCacheKey(filePath);
    const cacheEntry = {
      contentHash: computeHash(content),
      contentLength: content.length,
      contentSample: content.slice(0, 500),
      structure: extractStructure(content),
      generatedAt: new Date().toISOString(),
      data: data
    };
    storage.setRaw(key, cacheEntry);
    return true;
  } catch (e) {
    console.warn('Erreur écriture cache AI:', e);
    return false;
  }
}

/**
 * Vérifie si le cache est valide pour le contenu actuel
 * Retourne { valid: boolean, similarity: number, cached: object|null }
 */
export function checkCache(filePath, currentContent) {
  const cached = getCache(filePath);

  if (!cached) {
    return { valid: false, similarity: 0, cached: null, reason: 'no-cache' };
  }

  // Vérifier le hash exact d'abord (rapide)
  const currentHash = computeHash(currentContent);
  if (cached.contentHash === currentHash) {
    return { valid: true, similarity: 1, cached: cached.data, reason: 'exact-match' };
  }

  // Sinon, calculer la similarité
  // Reconstruire un "pseudo-contenu" depuis le cache pour comparaison
  const similarity = contentSimilarity(cached.contentSample + '...', currentContent.slice(0, 500) + '...');

  // Comparer aussi les structures
  const currentStructure = extractStructure(currentContent);
  const structSim = structureSimilarity(cached.structure || [], currentStructure);

  // Score final: moyenne pondérée
  const finalSimilarity = (similarity * 0.4) + (structSim * 0.6);

  if (finalSimilarity >= SIMILARITY_THRESHOLD) {
    return {
      valid: true,
      similarity: finalSimilarity,
      cached: cached.data,
      reason: 'similar-enough',
      generatedAt: cached.generatedAt
    };
  }

  return {
    valid: false,
    similarity: finalSimilarity,
    cached: cached.data,
    reason: 'content-changed',
    generatedAt: cached.generatedAt
  };
}

