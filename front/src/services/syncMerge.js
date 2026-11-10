/**
 * Fonctions pures de merge pour la synchronisation iCloud.
 * Chaque fonction prend (local, remote) et retourne le résultat mergé.
 */

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
    preferences: mergePreferences(local.preferences, remote.preferences),
  };
}
