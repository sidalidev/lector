# Lector : capacités

> Ce que Lector sait afficher et faire, version par version. À mettre à jour à chaque ajout ou retrait de fonction.

Lector est un éditeur et lecteur Markdown léger, gratuit, sans compte et sans fonction payante. Les documents restent des fichiers `.md` sur l'appareil ; la synchronisation entre appareils et l'écriture à plusieurs sont chiffrées de bout en bout. Depuis la 2.2, tout ce qui ne sert pas à écrire ou afficher du Markdown est retiré (`docs/REMOVED.md`).

---

## Stack technique

| Composant | Version |
|-----------|---------|
| Preact (via `preact/compat`, composants écrits avec l'API React) | 10.29.8 |
| Vite | 7.3.1 |
| Electron | 45 (ordinateur) |
| Capacitor | 8.5.3 (iOS et Android) |
| CodeMirror | 6 (éditeur Markdown) |
| Yjs | 13 (écriture à plusieurs) |

**Plateformes :** web (navigateur, `lector.sidali.dev`) ; macOS (Electron, DMG sur la page des releases GitHub ; Windows et Linux se construisent mais ne sont pas publiés) ; Android (Capacitor, APK signé sur GitHub et Obtainium, mise à jour de l'app entière). iOS : projet Capacitor présent, version 2.x pas encore publiée.

**Poids :** le JavaScript du premier affichage de l'app web pèse environ 55 Ko gzip (budget de 150 Ko vérifié par `npm run test:poids`) ; la page partagée `/d/` environ 185 Ko. Le code propre à l'ordinateur et au mobile n'est jamais téléchargé par le navigateur. Polices : Figtree et Bricolage Grotesque en WOFF2, sous-ensemble latin ; JetBrains Mono (latin) et Noto Naskh Arabic (arabe) ne se chargent que si une note en a besoin. Une fois visitée, l'app web s'ouvre hors ligne : un service worker (`front/src/sw.js`, règles dans `front/src/utils/swRegles.js`) garde ses fichiers, jamais `/v1` ni les documents ; la page passe par le réseau d'abord, une nouvelle version est prise au rechargement suivant.

---

## La note : un seul éditeur mis en forme (CodeMirror 6)

La note s'ouvre directement dans l'éditeur, façon Bear : le Markdown est mis en forme et sa syntaxe n'apparaît que sur la ligne en cours d'écriture. Il n'y a pas de mode lecture séparé ni de mode source. Grammaire : `@codemirror/lang-markdown` (GFM), sans le langage HTML. Code : `front/src/components/editor/livePreview/`.

### Mis en forme

- Titres H1 à H6 (ATX `#` et Setext), en vraie taille ; ancres pour le sommaire et les liens `#titre`
- **Gras**, *italique*, ~~barré~~, `code en ligne`
- Listes ordonnées et non ordonnées, citations `>`, lignes horizontales `---`
- Listes de tâches `- [ ]` / `- [x]` : une case à cocher (tâches et rappels, voir plus bas)
- Tableaux GFM : rendus en tableau tant que le curseur n'y est pas, Markdown éditable au clic
- Blocs de code : police à chasse fixe, fond distinct, **sans coloration syntaxique**
- Liens `[texte](url)`, liens automatiques et adresses nues : un clic les ouvre, sauf sur la ligne en cours d'écriture (`Cmd+clic` ouvre toujours) ; un lien vers une autre note `.md` l'ouvre dans Lector
- Images `![alt](src)` : distantes (`https:`), `data:` et, sur ordinateur et mobile, images locales relatives à la note. Dans le navigateur, une image relative n'est jamais disponible (seul le Markdown voyage) : un encart affiche son texte alternatif
- Chaque ligne prend le sens de son texte (arabe de droite à gauche)

### Écriture

- `Cmd+B` / `Cmd+I` : gras, italique
- Entrée continue la liste en cours
- Annuler et rétablir (`Cmd+Z` / `Cmd+Shift+Z`) ; dans un document partagé, l'annulation passe par Yjs et ne touche que ses propres modifications
- Indentation Tab / Shift-Tab, retour à la ligne automatique
- Coller une URL sur une sélection crée un lien
- Pas de `searchKeymap`, pour ne pas entrer en conflit avec `Cmd+F` (recherche dans le document)

### Affiché tel quel, en texte

- HTML brut : jamais interprété, ni script, ni iframe, ni style (`docs/SECURITE.md`)
- Formules LaTeX `$...$` et `$$...$$` (rendu des maths retiré en 2.2)
- Blocs ` ```mermaid ` (diagrammes retirés en 2.2)
- Notes de bas de page, wikilinks `[[fichier]]`, inclusions et encadrés Obsidian, en-tête YAML
- Vidéos : un lien YouTube, Vimeo ou Rumble reste un lien

---

## Navigation et organisation

- Arbre de fichiers dans la barre latérale
- Ouverture rapide (`Cmd+P`), recherche dans le document (`Cmd+F`), recherche dans tous les fichiers (`Cmd+Shift+F`)
- Palette de commandes (`Cmd+Shift+P`)
- Sommaire flottant (barre latérale droite, `Cmd+Shift+B`)
- Thèmes clair et sombre ; taille du texte fixe (17 px, 15 px sur mobile)
- Écran « About » avec la liste « What leaves your device » (`front/src/services/fluxSortants.js`)
- Sur ordinateur, clic droit « Search the web » sur une sélection (Google, dans le navigateur)

---

## Tâches et rappels

- Cocher une case `- [ ]` dans une note : Lector écrit `- [x]` et la date `✅ AAAA-MM-JJ` dans le fichier (syntaxe du module Obsidian Tasks)
- `⏰ AAAA-MM-JJ HH:mm` pour un rappel à l'heure, `📅 AAAA-MM-JJ` pour une échéance (rappel à 9 h)
- **Today**, en haut de la barre latérale : tâches en retard, du jour et des 7 prochains jours, toutes notes confondues
- **New task** (`Cmd+N` sur ordinateur, ou la palette) : une ligne dans `Inbox.md`, avec date et heure facultatives
- Notifications locales programmées par chaque appareil, aucun serveur ne connaît les rappels

---

## Raccourcis clavier

### Ordinateur et navigateur

| Raccourci | Action |
|-----------|--------|
| `Cmd+B` | Barre latérale gauche |
| `Cmd+Shift+B` | Barre latérale droite (sommaire) |
| `Cmd+F` | Recherche dans le document |
| `Cmd+P` | Ouverture rapide d'un fichier |
| `Cmd+Shift+P` | Palette de commandes |
| `Cmd+Shift+F` | Recherche dans tous les fichiers |
| `Cmd+Shift+E` | Focus sur la barre latérale |
| `Cmd+N` | Nouvelle tâche (ordinateur) |
| `Cmd+[` | Retour dans l'historique |
| `Cmd+]` | Avancer dans l'historique |
| `Escape` | Fermer la recherche |

---

## Fichiers du vault

### Types de fichiers ouverts
- `.md` / `.markdown` : documents Markdown, seul type ouvert comme document

### Découverte
- Parcours récursif de tous les sous-dossiers
- **Ordinateur :** les seuls dossiers ouverts par l'utilisateur, par IPC (`front/desktop/acces.js`)
- **iOS :** dossier iCloud Drive (conteneur CloudKit)
- **Android :** dossier choisi par l'utilisateur (Storage Access Framework, adresses `content://`)
- **Web :** vault de la chaîne (`cloud://`), lu et écrit à travers le chiffrement

### Dossiers ignorés
`node_modules`, `.git`, `.svn`, `.hg`, `dist`, `build`, `.next`, `.nuxt`, `__pycache__`, `.venv`, `venv`, `.env`, `.cache`, `.turbo`, `coverage`, `.nyc_output`, `.parcel-cache`, `.webpack`, `vendor`, `bower_components`, `.idea`, `.vscode`, `.DS_Store`, `tmp`, `.tmp`

Les dossiers cachés (commençant par `.`) sont ignorés.

### Liens entre documents
- Liens locaux `[texte](fichier.md)` : ouvrent le fichier dans Lector
- Détection des fichiers du vault pour les liens croisés

---

## Synchronisation (chaîne)

Détail technique : `docs/CHAINE.md`, publié sur https://lector.sidali.dev/sync/.

- **Sans compte** : le premier appareil crée une chaîne, les suivants la rejoignent avec 12 mots, tapés ou remplis par le gestionnaire de mots de passe (web et mobile). Le QR ne se scanne que dans un navigateur qui offre `BarcodeDetector` et une caméra, pas dans les apps de bureau ni mobiles.
- **Chiffrée de bout en bout** : chaque document est chiffré sur l'appareil (AES-256-GCM) avant de partir ; le serveur ne garde que des blocs qu'il ne peut pas ouvrir et ne voit ni contenu, ni chemin, ni titre.
- **Markdown seulement** : seuls les `.md` et `.markdown` voyagent ; images, PDF et autres fichiers restent sur l'appareil.
- **Quota par chaîne** : 20 Mo, 512 Ko par document, 5 000 documents (valeurs par défaut du serveur). Un document trop gros ou un casier plein est signalé, jamais bloquant.
- **Temps réel sur ordinateur** : un changement fait ailleurs arrive en quelques secondes ; le web relit la liste quand elle se recharge.
- **Kit de secours** imprimable (12 mots, QR, page « Pour un proche »), vérification des mots par trois questions.
- **Nouvelle chaîne** (appareil perdu ou volé), **quitter** sur un appareil, **tout effacer** sur le serveur ; les fichiers des ordinateurs ne sont jamais effacés par ces actions. Le web et le mobile n'ont pas de dossier local : le casier y est peut-être la seule copie. Sur ordinateur, nouvelle chaîne et tout effacer passent par le verrou (Touch ID ou confirmation).

---

## Écrire à plusieurs (partage en temps réel)

Détail : `docs/collab-design.md`.

- Bouton **Share** sur un document ouvert (version web pour l'instant) : lien `https://<hôte>/d/<id>#<clé>` et QR
- Une clé de 256 bits par document, sans lien avec les 12 mots : partager un document ne donne jamais accès au vault
- L'invité ouvre le lien dans un navigateur, sans compte ni installation : prénom, curseurs et sélections des autres en couleur, annulation de ses propres modifications seulement
- Texte, prénoms et curseurs chiffrés sur l'appareil (AES-256-GCM) ; le relais ne fait que transmettre et garder une copie chiffrée pour le rattrapage
- Hors ligne : les modifications restent dans le navigateur et repartent à la reconnexion (fusion Yjs)
- Copie de l'invité dans son navigateur, téléchargeable en `.md`
- **Stop sharing** : le salon est effacé, le lien ne marche plus pour personne, une nouvelle clé au prochain partage
- Pas encore : document partagé relié au fichier `.md` du vault sur ordinateur et Android

Sécurité du rendu et de l'accès au disque (CSP, assainissement des documents, bac à sable d'Electron, dossiers ouverts par l'utilisateur) : `docs/SECURITE.md`.

---

## Export

- Les fichiers `.md` du vault sont l'export (export PDF retiré en 2.2)

---

## Architecture principale

| Composant | Fichier | Rôle |
|-----------|---------|------|
| App | `App.jsx` | Logique principale, raccourcis, état |
| DocumentView | `DocumentView.jsx` | La note ouverte : enregistrement, position de lecture, images locales, liens entre notes |
| Sidebar | `Sidebar.jsx` | Navigateur de fichiers |
| FloatingTOC | `FloatingTOC.jsx` | Sommaire |
| MarkdownEditor | `MarkdownEditor.jsx` | Éditeur CodeMirror 6 ; mise en forme dans `editor/livePreview/` |
| TodayView, NewTask | `TodayView.jsx`, `NewTask.jsx` | Tâches et rappels |
| ChaineSync | `ChaineSync.jsx` | Écran Synchronisation (créer, rejoindre, état, nouvelle chaîne, tout effacer) |
| AboutPanel | `AboutPanel.jsx` | Version, principes, « What leaves your device » |
| FileSystem | `fileSystem.js` | Accès aux fichiers sur toutes les plateformes |
| Nettoyage | `nettoyage.js` | Efface au démarrage les données locales des fonctions retirées |

---

## Ce que Lector ne fait pas

- Wikilinks
- Inclusions et encadrés Obsidian
- En-tête YAML
- Visualisation de PDF
- Coloration syntaxique des blocs de code
- Fiches de révision, quiz, assistant IA, lecture à voix haute, partitions et musique, import de transcriptions, carte mentale, graphe de notes, surlignages, étiquettes (`NON_GOALS.md`)
- Diagrammes (Mermaid compris)
- Rendu des maths (KaTeX)
- Synchronisation des images et autres fichiers non markdown
- Pages publiques : un document partagé ne se lit jamais sans la clé du lien
- Invitations en lecture seule, retrait d'une seule personne (arrêter le partage coupe tout le monde)
- Système de plugins
- Thèmes CSS personnalisés (thèmes intégrés uniquement)

---

> *Dernière mise à jour : novembre 2026.*
