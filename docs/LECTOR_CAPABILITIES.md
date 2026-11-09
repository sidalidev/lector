# Lector : capacités

> Ce que Lector sait afficher et faire, version par version. À mettre à jour à chaque ajout ou retrait de fonction.

Lector est gratuit, sans compte et sans fonction payante. Les documents restent des fichiers `.md` sur l'appareil ; la synchronisation entre appareils est chiffrée de bout en bout.

---

## Stack technique

| Composant | Version |
|-----------|---------|
| React | 19.2.3 |
| Vite | 7.3.1 |
| Electron | 39.2.7 (ordinateur) |
| Capacitor | 8.0.2 (iOS et Android) |
| CodeMirror | 6 (éditeur Markdown) |
| TailwindCSS | 4.1.18 |

**Plateformes :** macOS, Windows et Linux (Electron ; seul macOS est publié par `deploy/deploy.sh`), iOS et Android (Capacitor ; mise à jour OTA du bundle web sur iOS seulement), web (navigateur).

---

## Markdown : syntaxe prise en charge

**Parser :** remark-gfm v4.0.1 (GitHub Flavored Markdown)
**Renderer :** react-markdown v10.1.0
**HTML brut :** rehype-raw v7.0.0
**Maths :** remark-math et rehype-katex (KaTeX), chargés seulement quand le document contient `$`

### Pris en charge

- Titres H1 à H6
- **Gras**, *italique*, ~~barré~~
- Listes ordonnées et non ordonnées
- Listes de tâches `- [ ]` / `- [x]`
- Tableaux (syntaxe GFM)
- Citations `>`
- Code en ligne et blocs de code
- Liens `[texte](url)`
- Images `![alt](src)`
- Liens automatiques (www.example.com)
- Notes de bas de page GFM `[^1]`
- Formules LaTeX `$...$` et `$$...$$` (KaTeX)
- Lignes horizontales `---`
- Retours à la ligne

### Non pris en charge

- Wikilinks `[[fichier]]` : lus pour le graphe de connaissances uniquement, pas rendus comme liens cliquables
- Inclusions Obsidian `![[fichier.md]]`
- Encadrés Obsidian `> [!note]`
- En-tête YAML (front matter)

---

## Diagrammes et visualisations

Tous rendus en SVG, avec gestion des erreurs et états de chargement.

| Moteur | Bloc de code | Librairie | Notes |
|--------|-------------------|-----------|-------|
| Mermaid | ` ```mermaid ` | mermaid@11.12.2 | flowchart, sequence, class, state, ER, pie, gantt, etc. Police DM Sans |
| Graphviz DOT | ` ```dot ` ou ` ```graphviz ` | @hpcc-js/wasm-graphviz@1.21.0 | Graphes dirigés et non dirigés, toute la syntaxe DOT |
| WaveDrom | ` ```wavedrom ` | wavedrom@3.5.0 | Chronogrammes numériques (JSON) |
| Pikchr | ` ```pikchr ` | pikchr-wasm@2.0.1 | Diagrammes techniques (SVG léger) |
| ABC Music | ` ```abc ` | abcjs@6.6.0 | Notation musicale, tablature, lecture audio (Tone.js) |
| WireViz | ` ```wireviz ` | Converti en Graphviz | Schémas de câblage électronique |

---

## Médias

### Vidéo

| Format | Syntaxe | Notes |
|--------|---------|-------|
| MP4 | `![alt](chemin/video.mp4)` | Chargement différé, fichier local |
| WebM | `![alt](chemin/video.webm)` | Chargement différé, fichier local |
| MOV | `![alt](chemin/video.mov)` | Chargement différé, fichier local |
| YouTube | `[texte](https://youtube.com/watch?v=...)` | Détecté automatiquement, lecteur intégré avec vignette |
| Vimeo | `[texte](https://vimeo.com/...)` | Détecté automatiquement, lecteur intégré |

### Images

- Formats : JPG, PNG, WebP, SVG, GIF
- Locales : `![alt](./image.png)`, chargement différé
- Distantes : `![alt](https://example.com/image.png)`
- Sur un appareil qui reçoit le document par la synchronisation, une image relative absente s'affiche comme un encart « Image non synchronisée » : seul le markdown voyage entre les appareils.

### Audio et musique

- Notation ABC : lecture intégrée (Tone.js), choix de l'instrument (nylon, acier, piano)
- MIDI (.mid, .midi) : lecture avec MidiViewer et Tone.js
- Guitar Pro (.gp, .gp3, .gp4, .gp5, .gpx) : rendu AlphaTab et SoundFont

---

## Coloration syntaxique du code

**Moteur :** Prism.js (via react-syntax-highlighter@16.1.0)
**Thème :** One Light (oneLight)
**Langages :** plus de 100 (JavaScript, TypeScript, Python, Java, C++, C#, Go, Rust, Ruby, PHP, SQL, HTML, CSS, JSON, YAML, Bash, Shell, XML, etc.)

- Numéros de ligne
- Bouton copier (API presse-papiers)
- Détection du langage s'il n'est pas indiqué
- Les blocs `mermaid`, `abc`, `dot`, `graphviz`, `wavedrom`, `pikchr`, `wireviz` sont rendus comme diagrammes

---

## HTML brut

Via rehype-raw, le HTML en ligne est rendu :
- balises courantes : `<div>`, `<span>`, `<strong>`, `<em>`, `<br>`, `<hr>`, `<sup>`, `<sub>`, etc. ;
- attributs `data-` (utilisés pour les signets de titres).

Ne sont pas exécutés : les scripts (bloqués par React) et les gestionnaires d'événements. Les styles CSS en ligne ne s'appliquent qu'en partie.

---

## Mode édition (CodeMirror 6)

**Moteur :** CodeMirror 6 (codemirror + @codemirror/lang-markdown)
**Activation :** `Cmd+E`
**Enregistrement automatique :** après 1 s sans frappe, et à la sortie du mode édition

- Coloration Markdown (titres, gras, italique, liens, code en ligne)
- Numéros de ligne (masqués sur mobile)
- Repli de sections
- Parenthèses appariées et fermées automatiquement
- Annuler et rétablir (`Cmd+Z` / `Cmd+Shift+Z`)
- Indentation Tab / Shift-Tab
- Taille de police dynamique (`Cmd++` / `Cmd+-`)
- Retour à la ligne automatique
- `searchKeymap` exclu pour ne pas entrer en conflit avec `Cmd+F` (recherche globale)
- Suivi des changements externes du fichier en mode édition

---

## Raccourcis clavier

### Ordinateur (Electron)

| Raccourci | Action |
|-----------|--------|
| `Cmd+B` | Barre latérale gauche |
| `Cmd+Shift+B` | Barre latérale droite (sommaire, mots-clés) |
| `Cmd+E` | Mode édition |
| `Cmd+F` | Recherche dans le document |
| `Cmd+P` | Ouverture rapide d'un fichier |
| `Cmd+Shift+P` | Palette de commandes |
| `Cmd+Shift+F` | Recherche dans tous les fichiers |
| `Cmd+Shift+E` | Focus sur la barre latérale |
| `Cmd+[` | Retour dans l'historique |
| `Cmd+]` | Avancer dans l'historique |
| `Cmd++` / `Cmd+-` | Taille de police (±2 px, de 12 à 28 px) |
| `Cmd+0` | Taille de police par défaut (17 px) |
| `Escape` | Fermer la recherche, le mode focus ou le défilement automatique |

### Navigation Vim (dans le document)

| Touche | Action |
|--------|--------|
| `j` | Défiler vers le bas (80 px) |
| `k` | Défiler vers le haut (80 px) |
| `h` | Défiler vers la gauche (80 px) |
| `l` | Défiler vers la droite (80 px) |
| `g` | Aller en haut |
| `G` (Shift+G) | Aller en bas |

---

## Fichiers du vault

### Types de fichiers ouverts
- `.md` / `.markdown` : documents Markdown (principal)
- `.mid` / `.midi` : fichiers MIDI
- `.gp` / `.gp3` / `.gp4` / `.gp5` / `.gpx` : Guitar Pro

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
- Graphe de connaissances construit à partir des liens Markdown et des wikilinks (visualisation uniquement)

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

## IA et voix (clés personnelles)

Aucune fonction ne passe par un serveur de Lector. L'utilisateur saisit ses propres clés dans l'écran « Clés API » ; elles restent sur l'appareil.

- **IA (Claude)** : sur ordinateur, le Claude CLI installé localement est utilisé en priorité ; sinon, partout, la clé API Anthropic personnelle. Modèles proposés d'après le compte Anthropic (liste de repli intégrée).
  - Résumé par document (3 à 5 points)
  - Carte mentale
  - Métadonnées du document (mots-clés, glossaire, niveau de difficulté)
  - Quiz et fiches de révision
  - Explication de diagrammes
  - Discussion sur le document en cours
- **Lecture à voix haute** : voix ElevenLabs avec la clé personnelle de l'utilisateur.

Sur ordinateur, les clés sont chiffrées par le trousseau du système (`safeStorage`) quand il existe (sinon fichier lisible par l'utilisateur seul, et l'écran le dit) et les appels partent du processus principal ; sur le web et le mobile, elles sont chiffrées dans le navigateur et les appels partent directement vers Anthropic ou ElevenLabs.

Sécurité du rendu et de l'accès au disque (CSP, assainissement des documents, bac à sable d'Electron, dossiers ouverts par l'utilisateur) : `docs/SECURITE.md`.

---

## Export

- **PDF** : document en cours, ou dossier entier fusionné en un PDF
- **EPUB** : export local du document (sans envoi)

---

## Architecture principale

| Composant | Fichier | Rôle |
|-----------|---------|------|
| App | `App.jsx` | Logique principale, raccourcis, état |
| DocumentView | `DocumentView.jsx` | Rendu Markdown et fonctions IA |
| DiagramBlocks | `DiagramBlocks.jsx` | Rendu des diagrammes (Mermaid, Graphviz, etc.) |
| Sidebar | `Sidebar.jsx` | Navigateur de fichiers |
| FloatingTOC | `FloatingTOC.jsx` | Sommaire, mots-clés, glossaire |
| MarkdownEditor | `MarkdownEditor.jsx` | Mode édition (CodeMirror 6) |
| ChaineSync | `ChaineSync.jsx` | Écran Synchronisation (créer, rejoindre, état, nouvelle chaîne, tout effacer) |
| ApiKeysPanel | `ApiKeysPanel.jsx` | Écran Clés API (Anthropic, ElevenLabs) |
| FileSystem | `fileSystem.js` | Accès aux fichiers sur toutes les plateformes |

---

## Ce que Lector ne fait pas

- Wikilinks rendus comme liens (graphe uniquement)
- Inclusions et encadrés Obsidian
- En-tête YAML
- Visualisation de PDF ou d'EPUB (export seulement)
- Synchronisation des images et autres fichiers non markdown
- Pages publiques : un document partagé ne se lit jamais sans la clé du lien
- Invitations en lecture seule, retrait d'une seule personne (arrêter le partage coupe tout le monde)
- Système de plugins
- Thèmes CSS personnalisés (thèmes intégrés uniquement)

---

> *Dernière mise à jour : novembre 2026.*
