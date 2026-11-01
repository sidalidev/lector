/**
 * Fonctions pures de merge pour la synchronisation iCloud.
 * Chaque fonction prend (local, remote) et retourne le résultat mergé.
 */

/**
 * Merge highlights par union d'id.
 * Si même id avec note différente -> garder le plus récent (modifiedAt ou createdAt).
 */
export function mergeHighlights(local = [], remote = []) {
  const map = new Map();

  for (const h of local) {
    map.set(h.id, h);
  }

  for (const h of remote) {
    const existing = map.get(h.id);
    if (!existing) {
      map.set(h.id, h);
    } else if (existing.note !== h.note) {
      const existingTime = existing.modifiedAt || existing.createdAt || '0';
      const remoteTime = h.modifiedAt || h.createdAt || '0';
      if (remoteTime > existingTime) {
        map.set(h.id, h);
      }
    }
  }

  return Array.from(map.values());
}

/**
 * Merge flashcards : "most progressed wins".
 * Pour chaque carte (identifiée par question), garder celle avec
 * le plus de repetitions, ou si égal, le lastReviewedAt le plus récent.
 * Scores = Math.max des deux.
 */
export function mergeFlashcards(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  const localCards = local.flashcards || [];
  const remoteCards = remote.flashcards || [];

  // Index par question
  const map = new Map();
  for (const card of localCards) {
    map.set(card.question, card);
  }

  for (const card of remoteCards) {
    const existing = map.get(card.question);
    if (!existing) {
      map.set(card.question, card);
    } else {
      const existingReps = existing.repetitions || 0;
      const remoteReps = card.repetitions || 0;
      if (remoteReps > existingReps) {
        map.set(card.question, card);
      } else if (remoteReps === existingReps) {
        const existingTime = existing.lastReviewedAt || '0';
        const remoteTime = card.lastReviewedAt || '0';
        if (remoteTime > existingTime) {
          map.set(card.question, card);
        }
      }
    }
  }

  const localScore = local.score || { correct: 0, incorrect: 0 };
  const remoteScore = remote.score || { correct: 0, incorrect: 0 };

  return {
    flashcards: Array.from(map.values()),
    score: {
      correct: Math.max(localScore.correct, remoteScore.correct),
      incorrect: Math.max(localScore.incorrect, remoteScore.incorrect),
    },
    generatedAt: local.generatedAt > remote.generatedAt ? local.generatedAt : remote.generatedAt,
  };
}

/**
 * Merge tags par union de name. Couleur du plus récent si conflit.
 */
export function mergeTags(local = [], remote = []) {
  const map = new Map();

  for (const tag of local) {
    map.set(tag.name.toLowerCase(), tag);
  }

  for (const tag of remote) {
    const key = tag.name.toLowerCase();
    if (!map.has(key)) {
      map.set(key, tag);
    }
    // On garde le local par défaut (pas de timestamp sur les tags individuels)
  }

  return Array.from(map.values());
}

/**
 * Merge starred items par union.
 * Suppression = si absent côté remote et lastModified remote plus récent.
 */
export function mergeStarredItems(local = [], remote = [], localModified, remoteModified) {
  if (!remoteModified || localModified >= remoteModified) {
    // Local est plus récent ou égal : union
    return [...new Set([...local, ...remote])];
  }

  // Remote plus récent : items manquants côté remote sont considérés supprimés
  const remoteSet = new Set(remote);
  const merged = local.filter(item => remoteSet.has(item));
  // Ajouter les items du remote qui ne sont pas dans local
  for (const item of remote) {
    if (!merged.includes(item)) {
      merged.push(item);
    }
  }
  return merged;
}

/**
 * Merge scroll position : timestamp le plus récent gagne.
 */
export function mergeScrollPosition(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  const localTime = local.timestamp || 0;
  const remoteTime = remote.timestamp || 0;

  return remoteTime > localTime ? remote : local;
}

/**
 * Merge préférences : last-write-wins sur lastModified.
 */
export function mergePreferences(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  const localTime = local.lastModified || '0';
  const remoteTime = remote.lastModified || '0';

  return remoteTime > localTime ? remote : local;
}

/**
 * Merge history : union par filePath, garder le plus récent + max openCount.
 */
export function mergeHistory(local = [], remote = []) {
  const map = new Map();

  for (const entry of local) {
    map.set(entry.filePath, entry);
  }

  for (const entry of remote) {
    const existing = map.get(entry.filePath);
    if (!existing) {
      map.set(entry.filePath, entry);
    } else {
      map.set(entry.filePath, {
        ...existing,
        openCount: Math.max(existing.openCount || 1, entry.openCount || 1),
        lastOpenedAt: existing.lastOpenedAt > entry.lastOpenedAt
          ? existing.lastOpenedAt
          : entry.lastOpenedAt,
      });
    }
  }

  // Trier par lastOpenedAt décroissant
  return Array.from(map.values())
    .sort((a, b) => (b.lastOpenedAt || '').localeCompare(a.lastOpenedAt || ''));
}

/**
 * Merge complet d'un fichier document sync.
 */
export function mergeDocumentData(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  return {
    version: 1,
    filePath: local.filePath || remote.filePath,
    lastModified: new Date().toISOString(),
    deviceId: local.deviceId,
    highlights: mergeHighlights(local.highlights, remote.highlights),
    flashcards: mergeFlashcards(local.flashcards, remote.flashcards),
    tags: mergeTags(local.tags, remote.tags),
    scroll: mergeScrollPosition(local.scroll, remote.scroll),
  };
}

/**
 * Merge complet du fichier global.json.
 */
export function mergeGlobalData(local, remote) {
  if (!local && !remote) return null;
  if (!local) return remote;
  if (!remote) return local;

  return {
    version: 1,
    lastModified: new Date().toISOString(),
    deviceId: local.deviceId,
    allTags: mergeTags(local.allTags, remote.allTags),
    starredItems: mergeStarredItems(
      local.starredItems, remote.starredItems,
      local.lastModified, remote.lastModified
    ),
    preferences: mergePreferences(local.preferences, remote.preferences),
    history: mergeHistory(local.history, remote.history),
  };
}
