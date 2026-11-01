# Sécurité de l'app : rendu des documents et accès au disque

Un document markdown peut venir de n'importe où (téléchargé, partagé, déposé dans le casier par un autre appareil). Il ne doit jamais exécuter de script dans l'origine de Lector : sur le web, ce script pourrait se servir des clés de la chaîne et des clés API rangées dans IndexedDB (`docs/CHAINE.md` § 10) ; sur ordinateur, il parlerait au processus principal. Quatre défenses s'empilent, plus une limite de taille.

## 1. Politique de sécurité du contenu (CSP)

Définie dans `front/vite.config.js` et posée en tête de `index.html` (balise `meta`, juste après `<meta charset>`), la même pour le web, Capacitor et Electron :

| Directive | Valeur | Pourquoi |
|---|---|---|
| `default-src` | `'self'` | rien d'autre par défaut |
| `script-src` | `'self' 'wasm-unsafe-eval'` | seulement les fichiers de l'app, jamais de script en ligne ni `eval` ; `'wasm-unsafe-eval'` est requis par verovio (partitions), qui compile du WebAssembly, et n'autorise ni `eval` ni `new Function` |
| `style-src` | `'self' 'unsafe-inline'` | styles posés par React, Mermaid, KaTeX et abcjs |
| `img-src`, `media-src` | `'self' data: blob: https: http: lector-local:` | images et vidéos des documents |
| `font-src` | `'self' data:` | polices embarquées |
| `connect-src` | `'self'`, le serveur de synchro, `api.anthropic.com`, `api.elevenlabs.io`, `paulrosen.github.io`, `surikov.github.io` | synchro, clés API de l'utilisateur, sons des partitions (des données, jamais du code) |
| `frame-src` | YouTube, Vimeo, Rumble, `lector-local:` | vidéos intégrées, pages HTML locales sur ordinateur |
| `object-src` | `'none'` | |
| `base-uri`, `form-action` | `'self'` | |

En développement seulement, le préambule de React Refresh passe par un nonce tiré au démarrage de Vite, et `connect-src` accepte `ws://localhost:*`. Une balise `meta` ne peut pas porter `frame-ancestors` : l'interdiction d'afficher `/app/` dans un cadre est un en-tête du serveur web (`deploy/nginx.conf`).

## 2. Assainissement du HTML des documents

`front/src/utils/schemaMarkdown.js` : la liste blanche de GitHub (`rehype-sanitize`), plus ce que Lector écrit lui-même avant le rendu (titres annotés, repères de ligne), les maths et quelques balises de mise en forme. Jamais de script, d'iframe, de feuille de style, d'objet, de formulaire, de `<base>`, de `<link>` ni de gestionnaire d'événement ; les liens et les sources n'acceptent que `http`, `https`, `mailto` et les chemins relatifs. Le style en ligne est gardé sauf ce qui pourrait recouvrir l'interface ou charger une ressource. Mermaid tourne en mode `strict`. L'export d'un dossier en fenêtre d'impression échappe le texte des documents avant de le mettre en forme (`front/src/utils/impression.js`).

## 3. Ordinateur : accès du renderer au disque

`front/desktop/acces.js` : le renderer ne lit et n'écrit que dans les dossiers que l'utilisateur a ouverts lui-même (boîte de dialogue, double-clic, menu, glisser-déposer), retenus dans `userData/acces.json`, et dans le vault de la synchro. Le renderer ne peut jamais ajouter un dossier. Les chemins sont comparés après résolution des liens symboliques. Par type :

- markdown (`.md`, `.markdown`) pour lire et écrire un document ;
- images (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.svg`) et vidéos (`.mp4`, `.webm`, `.mov`) pour les médias d'un document ;
- pages HTML locales, servies par le protocole `lector-local:` depuis ces seuls dossiers.

## 4. Ordinateur : fenêtre en bac à sable

La fenêtre principale tourne avec `sandbox: true`, `contextIsolation: true` et `nodeIntegration: false` ; le pont `preload.js` n'expose que des appels précis. L'ancien `electron.fetchUrl` (requête réseau quelconque depuis le processus principal) est supprimé. Afficher les 12 mots, renouveler la chaîne et tout effacer exigent le verrou ouvert (Touch ID ; sans Touch ID, une confirmation dans l'écran).

## 5. Taille des documents synchronisés

Un document est chiffré, envoyé et déchiffré en mémoire d'un seul bloc. La limite par document est de 512 Ko de clair (`CHAIN_MAX_DOC_BYTES`, 524288 par défaut dans `back/services/chaine.js` et `deploy/docker-compose.yml`) : de quoi garder une longue note, pas assez pour qu'un appareil gonfle le casier ou la mémoire des autres. Le client applique la même limite avant d'envoyer (celle annoncée par le serveur, sinon 512 Ko) : un document plus gros reste sur l'appareil, il est compté et l'écran de synchro le dit, sans requête refusée. Le serveur reste juge et répond 413 `DOC_TOO_LARGE` au-delà.

## 6. Signaler un abus (reporting abuse)

Une faille ou une chaîne utilisée à mauvais escient se signale à `contact@sidali.dev`, adresse publiée aussi dans `https://lector.dockerbop.fr/.well-known/security.txt` (RFC 9116, servi par `back/routes/securityTxt.js`). Pour une chaîne, le signalement donne son identifiant court : les 8 premiers caractères hexadécimaux de son identifiant, la seule forme que gardent les journaux du serveur (l'identifiant complet convient aussi).

Ce que l'hébergeur peut faire : supprimer le casier chiffré de cette chaîne, c'est-à-dire sa ligne en base, ses documents et le dossier de ses blocs (`node scripts/supprimer-chaine.js <id>` dans le conteneur de l'API, qui montre la chaîne et demande de retaper son identifiant court avant d'effacer). Ce qu'il ne peut pas faire : lire ou décrire le contenu. Les blocs, les chemins et les titres sont chiffrés avec une clé dérivée de `S`, qui ne quitte jamais les appareils ; le serveur ne voit que des tailles, des dates et des identifiants opaques. Les appareils de la chaîne gardent leurs fichiers `.md` en local ; à la synchro suivante, ils constatent que le casier n'existe plus.

## Tests

- `e2e/flows/securite-rendu.spec.js` : un document piégé (HTML brut, Mermaid, liens `javascript:`) ne lance aucun script et garde ce que Lector affiche ; la CSP est en place.
- `e2e/flows/electron-acces.spec.js` et `front/desktop/acces.test.cjs` : vrai processus principal, bac à sable, lectures et écritures refusées hors des dossiers ouverts et pour un autre type de fichier, liens symboliques.
- `e2e/flows/impression.spec.js` : l'export en fenêtre d'impression échappe le texte des documents.
- `front/desktop/verrou.test.cjs` : nouvelle chaîne et tout effacer refusés verrou fermé.

Résultats : `docs/CHAINE-TESTS.md`.
