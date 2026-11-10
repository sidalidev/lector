/**
 * Fonctions pures de merge pour la synchronisation iCloud.
 * Chaque fonction prend (local, remote) et retourne le résultat mergé.
 */

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
    starredItems: mergeStarredItems(
      local.starredItems, remote.starredItems,
      local.lastModified, remote.lastModified
    ),
    preferences: mergePreferences(local.preferences, remote.preferences),
    history: mergeHistory(local.history, remote.history),
  };
}
