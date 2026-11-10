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
| TailwindCSS | 4.1.18 |

**Plateformes :** macOS, Windows et Linux (Electron ; seul macOS est publié par `deploy/deploy.sh`), iOS et Android (Capacitor ; mise à jour OTA du bundle web sur iOS, APK signé sur Android), web (navigateur).

**Poids :** le JavaScript du premier affichage de `/app/` pèse environ 80 Ko gzip (budget de 150 Ko vérifié par `npm run test:poids`) ; la page partagée `/d/` environ 185 Ko. La coloration du code ne se charge que lorsque la note affichée en contient. Polices : Figtree et Bricolage Grotesque en WOFF2, sous-ensemble latin ; les autres ne se chargent que si une note en a besoin.

---

## Markdown : syntaxe prise en charge

**Parser :** remark-gfm v4 (GitHub Flavored Markdown)
**Renderer :** react-markdown v10
**HTML brut :** rehype-raw v7, assaini par rehype-sanitize (`docs/SECURITE.md`)

### Pris en charge

- Titres H1 à H6 (ancres stables, signets)
- **Gras**, *italique*, ~~barré~~
- Listes ordonnées et non ordonnées
- Listes de tâches `- [ ]` / `- [x]`, cochables dans la note (tâches et rappels, voir plus bas)
- Tableaux (syntaxe GFM)
- Citations `>`
- Code en ligne et blocs de code
- Liens `[texte](url)`
- Images `![alt](src)`
- Liens automatiques (www.example.com)
- Notes de bas de page GFM `[^1]`
- Lignes horizontales `---`
- Retours à la ligne

### Non pris en charge

- Wikilinks `[[fichier]]`
- Inclusions Obsidian `![[fichier.md]]`
- Encadrés Obsidian `> [!note]`
- En-tête YAML (front matter)
- Formules LaTeX : `$...$` et `$$...$$` restent du texte (rendu des maths retiré en 2.2)

---

## Diagrammes

Aucun moteur de diagramme (Mermaid retiré en 2.2) : un bloc ` ```mermaid ` s'affiche comme du code.

---

## Médias

### Vidéo

| Format | Syntaxe | Notes |
|--------|---------|-------|
| MP4, WebM, MOV | `![alt](chemin/video.mp4)` | Chargement différé, fichier local |
| YouTube | `[texte](https://youtube.com/watch?v=...)` | Lien détecté, lecteur intégré |
| Vimeo | `[texte](https://vimeo.com/...)` | Lien détecté, lecteur intégré |
| Rumble | `[texte](https://rumble.com/...)` | Lien détecté, lecteur intégré |

### Images

- Formats : JPG, PNG, WebP, SVG, GIF
- Locales : `![alt](./image.png)`, chargement différé
- Distantes : `![alt](https://example.com/image.png)`
- Sur un appareil qui reçoit le document par la synchronisation, une image relative absente s'affiche comme un encart « Image non synchronisée » : seul le markdown voyage entre les appareils.

### Pages HTML locales (ordinateur)

Un fichier `.html` cité dans une note s'affiche dans un cadre isolé (protocole `lector-local:`), depuis les seuls dossiers ouverts par l'utilisateur.

---

## Coloration syntaxique du code

**Moteur :** highlight.js 11 : le cœur et la grammaire de chaque langage se téléchargent au premier bloc qui en a besoin ; le texte brut s'affiche tout de suite.
**Langages :** Bash, C, C++, C#, CSS, Diff, Dockerfile, Go, INI/TOML, Java, JavaScript, JSON, Kotlin, Lua, Makefile, Markdown, PHP, Python, Ruby, Rust, SCSS, SQL, Swift, TypeScript, XML/HTML, YAML (et leurs alias courants). Un autre langage, ou un bloc sans langage, s'affiche en texte brut.

- Bouton copier (API presse-papiers)

---

## HTML brut

Via rehype-raw puis rehype-sanitize, le HTML en ligne est rendu selon la liste blanche de GitHub, plus quelques balises de mise en forme et les attributs que Lector écrit lui-même (titres annotés, repères de ligne).

Ne sont jamais rendus : les scripts, iframes, feuilles de style, objets, formulaires et gestionnaires d'événements. Détail : `docs/SECURITE.md`.

---

## Mode édition (CodeMirror 6)

**Moteur :** CodeMirror 6 (`@codemirror/view`, `@codemirror/lang-markdown`)
**Activation :** `Cmd+E`

- Coloration Markdown (titres, gras, italique, liens, code en ligne)
- Numéros de ligne (masqués sur mobile)
- Repli de sections
- Parenthèses appariées et fermées automatiquement
- Annuler et rétablir (`Cmd+Z` / `Cmd+Shift+Z`) ; dans un document partagé, l'annulation passe par Yjs et ne touche que ses propres modifications
- Indentation Tab / Shift-Tab
- Retour à la ligne automatique
- Coller une URL sur une sélection crée un lien
- Pas de `searchKeymap`, pour ne pas entrer en conflit avec `Cmd+F` (recherche dans le document)

---

## Navigation et organisation

- Arbre de fichiers dans la barre latérale
- Ouverture rapide (`Cmd+P`), recherche dans le document (`Cmd+F`), recherche dans tous les fichiers (`Cmd+Shift+F`)
- Palette de commandes (`Cmd+Shift+P`)
- Sommaire flottant (barre latérale droite, `Cmd+Shift+B`) et signets sur les titres
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

### Ordinateur (Electron)

| Raccourci | Action |
|-----------|--------|
| `Cmd+B` | Barre latérale gauche |
| `Cmd+Shift+B` | Barre latérale droite (sommaire) |
| `Cmd+E` | Mode édition |
| `Cmd+F` | Recherche dans le document |
| `Cmd+P` | Ouverture rapide d'un fichier |
| `Cmd+Shift+P` | Palette de commandes |
| `Cmd+Shift+F` | Recherche dans tous les fichiers |
| `Cmd+Shift+E` | Focus sur la barre latérale |
| `Cmd+N` | Nouvelle tâche |
| `Cmd+[` | Retour dans l'historique |
| `Cmd+]` | Avancer dans l'historique |
| `Escape` | Fermer la recherche |

---

## Fichiers du vault

### Types de fichiers ouverts
- `.md` / `.markdown` : documents Markdown, seul type ouvert comme document

### Découverte
- Parcours récursif de tous les sous-dossiers
- **Ordinateur :** accès complet au système de fichiers par IPC
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

Détail technique : `docs/CHAINE.md`, publié sur https://lector.dockerbop.fr/sync/.

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
| DocumentView | `DocumentView.jsx` | Rendu Markdown, médias, tâches cochables |
| CodeBlock | `CodeBlock.jsx` | Blocs de code, highlight.js à la demande |
| Sidebar | `Sidebar.jsx` | Navigateur de fichiers |
| FloatingTOC | `FloatingTOC.jsx` | Sommaire |
| MarkdownEditor | `MarkdownEditor.jsx` | Mode édition (CodeMirror 6) |
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
