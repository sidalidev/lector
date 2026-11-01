// Nettoyage, au démarrage, des données locales laissées par les versions avec
// compte. Sans dépendance : importé en premier par main.jsx, il passe avant
// tout le reste de l'application.
//
// Les clés de chaîne d'une ancienne version (IndexedDB « lector-chaine ») sont
// oubliées par chaineWeb.clesWeb() à leur première lecture.

const CLES_MORTES = [
  'lector-cloud-jwt',
  'lector-cloud-me',
  'lector-cloud-device-ids',
  'lector-chaine-vue',
  'lector-chaine-plus-tard',
  'lector-license',
]

export function nettoyerAnciennesDonnees() {
  try {
    for (const cle of CLES_MORTES) localStorage.removeItem(cle)
  } catch {
    // stockage indisponible : rien à nettoyer
  }
  // Un ancien lien d'appairage (…#chaine=…) ne doit pas rester dans la barre d'adresse.
  try {
    if (/[#&]chaine=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search)
  } catch {
    // hors navigateur
  }
}

nettoyerAnciennesDonnees()
