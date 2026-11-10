// Effacement des données locales de Lector dans ce navigateur ou cette vue web
// mobile, après « Tout effacer » (docs/CHAINE.md, section Tout effacer).
//
// L'origine appartient à l'app (lector.dockerbop.fr dans un navigateur, la vue
// web locale de Capacitor sur mobile, la page de l'app sur l'ordinateur) : on
// vide donc tout ce qu'elle a rangé, pas seulement les clés connues.
//
// Ce qui est effacé :
// - IndexedDB « lector-keys » : clés API d'une ancienne version (déjà
//   effacées au démarrage par nettoyage.js, par sécurité) ;
// - IndexedDB « lector-chaine » : clés de la chaîne (déjà oubliées avant, par
//   sécurité si l'effacement a été coupé) ;
// - toute autre base IndexedDB de l'origine (indexedDB.databases() quand le
//   moteur le permet) ;
// - localStorage en entier : positions de lecture, historique, favoris,
//   réglages, session, appareil ;
// - sessionStorage en entier ;
// - Cache Storage (caches d'un service worker, s'il y en a un) et
//   désinscription des service workers.
//
// Ne touche pas : les fichiers d'un dossier choisi sur l'ordinateur (voir
// chaine-desktop.js, case « Also move my local folder to the Trash »), ni les
// fichiers natifs de l'app mobile hors de la vue web.

export const BASES_CONNUES = ['lector-keys', 'lector-chaine']

function supprimerBase(idb, nom) {
  return new Promise((resolve) => {
    try {
      const req = idb.deleteDatabase(nom)
      req.onsuccess = () => resolve(true)
      req.onerror = () => resolve(false)
      // Une connexion encore ouverte retarde la suppression, qui se fera à sa fermeture.
      req.onblocked = () => resolve(true)
    } catch {
      resolve(false)
    }
  })
}

/**
 * Vide le stockage local de l'app. Ne lève jamais : renvoie la liste de ce qui
 * a été effacé, pour les tests et le journal.
 * @param {object} [env] environnement injecté (tests) ; par défaut globalThis
 */
export async function effacerDonneesLocales(env = globalThis) {
  const efface = []

  let idb = null
  try { idb = env.indexedDB || null } catch { /* IndexedDB interdit sur cette page */ }
  if (idb) {
    const noms = new Set(BASES_CONNUES)
    try {
      const bases = await idb.databases?.()
      for (const b of bases || []) if (b?.name) noms.add(b.name)
    } catch { /* liste indisponible : bases connues seulement */ }
    for (const nom of noms) if (await supprimerBase(idb, nom)) efface.push(`indexedDB:${nom}`)
  }

  for (const nom of ['localStorage', 'sessionStorage']) {
    try {
      if (env[nom]) { env[nom].clear(); efface.push(nom) }
    } catch { /* stockage indisponible */ }
  }

  try {
    if (env.caches?.keys) {
      for (const cle of await env.caches.keys()) {
        if (await env.caches.delete(cle)) efface.push(`cache:${cle}`)
      }
    }
  } catch { /* Cache Storage indisponible */ }

  try {
    const regs = await env.navigator?.serviceWorker?.getRegistrations?.()
    for (const r of regs || []) if (await r.unregister()) efface.push('serviceWorker')
  } catch { /* pas de service worker */ }

  return efface
}
