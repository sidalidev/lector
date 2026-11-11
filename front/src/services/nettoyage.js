// Nettoyage, au démarrage, des données locales laissées par les versions avec
// compte et par les fonctions retirées en 2.2 (fiches, surlignages, étiquettes,
// assistant, voix, règle de lecture). Sans dépendance : importé en premier par
// main.jsx, il passe avant tout le reste de l'application.
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
  'lector-activity',
  'lector-all-tags',
  'lector-tts-voice',
  'lector-ai-model',
  'lector-ai-effort',
  'lector-showRuler',
  'lector-autoScrollSpeed',
  'lector-showChatPanel',
  'lector-window-opacity',
  // Retirés ensuite : favoris, récents, taille du texte, bascule de la syntaxe.
  'lector-starred-items',
  'lector-history',
  'lector-fontSize',
  'lector-show-markdown-syntax',
  // Ancienne synchro iCloud des réglages (syncService, retirée).
  'lector-device-id',
  'lector-sync-migrated',
]

// Données par document des fonctions retirées : fiches et révisions, quiz,
// surlignages, étiquettes, réponses mises en cache, conversations.
const PREFIXES_MORTS = [
  'flashcards-',
  'quiz-',
  'highlights-',
  'lector-file-tags-',
  'lector-ai-v2-',
  'lector-chat-global',
]

// Clés API personnelles (Anthropic, ElevenLabs) gardées par l'ancien assistant.
const BASES_MORTES = ['lector-keys']

export function nettoyerAnciennesDonnees() {
  try {
    for (const cle of CLES_MORTES) localStorage.removeItem(cle)
    const mortes = []
    for (let i = 0; i < localStorage.length; i++) {
      const cle = localStorage.key(i)
      if (cle && PREFIXES_MORTS.some((p) => cle.startsWith(p))) mortes.push(cle)
    }
    for (const cle of mortes) localStorage.removeItem(cle)
  } catch {
    // stockage indisponible : rien à nettoyer
  }
  try {
    for (const nom of BASES_MORTES) indexedDB.deleteDatabase(nom)
  } catch {
    // IndexedDB indisponible
  }
  // Un ancien lien d'appairage (…#chaine=…) ne doit pas rester dans la barre d'adresse.
  try {
    if (/[#&]chaine=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search)
  } catch {
    // hors navigateur
  }
}

nettoyerAnciennesDonnees()
