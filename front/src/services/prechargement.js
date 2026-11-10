// Ouvrir une note enchaînait les téléchargements : l'app, puis DocumentView,
// puis l'éditeur (CodeMirror). Dès qu'une note va s'ouvrir (source déjà
// choisie, ou l'utilisateur commence à entrer sa clé), on demande la vue et
// l'éditeur ensemble : le réseau les télécharge en parallèle de l'app.
let fait = false

export function prechargerEditeur() {
  if (fait) return
  fait = true
  // Échec (hors ligne) sans bruit : l'ouverture de la note réessaiera.
  import('../components/DocumentView').catch(() => {})
  import('../components/MarkdownEditor').catch(() => {})
}
