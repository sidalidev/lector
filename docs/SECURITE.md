# Sécurité de l'app : rendu des documents et accès au disque

Un document markdown peut venir de n'importe où (téléchargé, partagé, déposé dans le casier par un autre appareil). Il ne doit jamais exécuter de script dans l'origine de Lector : sur le web, ce script pourrait se servir des clés de la chaîne rangées dans IndexedDB (`docs/CHAINE.md` § 10) ; sur ordinateur, il parlerait au processus principal. Quatre défenses s'empilent, plus une limite de taille.

## 1. Politique de sécurité du contenu (CSP)

Définie dans `front/vite.config.js` et posée en tête de `index.html` (balise `meta`, juste après `<meta charset>`), la même pour le web, Capacitor et Electron :

| Directive | Valeur | Pourquoi |
|---|---|---|
| `default-src` | `'self'` | rien d'autre par défaut |
| `script-src` | `'self'` | seulement les fichiers de l'app : jamais de script en ligne, ni `eval`, ni WebAssembly |
| `style-src` | `'self' 'unsafe-inline'` | styles posés par Preact et CodeMirror |
| `img-src`, `media-src` | `'self' data: blob: https: http: lector-local:` | images et vidéos des documents |
| `font-src` | `'self' data:` | polices embarquées |
| `connect-src` | `'self'`, `https://lector.dockerbop.fr`, `wss://lector.dockerbop.fr`, `wss://lector.sidali.dev` | synchro et relais de co-écriture seulement (l'app mobile n'est pas sur son origine) ; aucun autre service n'est appelé |
| `frame-src` | YouTube, Vimeo, Rumble, `lector-local:` | vidéos intégrées, pages HTML locales sur ordinateur |
| `worker-src` | `'self'` | service worker de l'app web (`/sw.js`) ; il ne met jamais en cache `/v1` ni `/d/<id>` (`front/src/utils/swRegles.js`) |
| `object-src` | `'none'` | |
| `base-uri`, `form-action` | `'self'` | |

En développement seulement, les scripts en ligne de Vite passent par un nonce tiré au démarrage de Vite, et `connect-src` accepte `ws://localhost:*`. Une balise `meta` ne peut pas porter `frame-ancestors` : l'interdiction d'afficher `/app/` dans un cadre est un en-tête du serveur web (`deploy/nginx.conf`).

## 2. Assainissement du HTML des documents

`front/src/utils/schemaMarkdown.js` : la liste blanche de GitHub (`rehype-sanitize`), plus ce que Lector écrit lui-même avant le rendu (titres annotés, repères de ligne) et quelques balises de mise en forme. Jamais de script, d'iframe, de feuille de style, d'objet, de formulaire, de `<base>`, de `<link>` ni de gestionnaire d'événement ; les liens et les sources n'acceptent que `http`, `https`, `mailto` et les chemins relatifs. Le style en ligne est gardé sauf ce qui pourrait recouvrir l'interface ou charger une ressource.

## 3. Mac : la fenêtre affiche la web app, la synchro reste dans le processus principal

La fenêtre charge `https://lector.sidali.dev/` dans sa propre session (`persist:lector`), avec `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` et sans outils de développement dans l'app installée. Elle n'a plus aucun accès au disque : seule la synchro du dossier (`front/desktop/sync-manager.js`, `vault/`) lit et écrit le dossier choisi dans le menu, depuis le processus principal. Tout autre site s'ouvre dans le navigateur du système. Permissions accordées à la seule origine de l'app : presse-papiers et notifications.

## 4. Mac : le pont avec la web app

`preload.js` expose `window.lectorDesktop` à la seule origine de l'app, et `main.js` revérifie l'origine et le cadre principal à chaque appel. Trois appels : les 12 mots de la chaîne du Mac, donnés une seule fois par chaîne pour que l'interface se connecte seule (`interfaceChainId` dans `cloud-secrets.dat`) ; « l'interface est connectée » ; la clé créée ou saisie dans l'interface, que le Mac garde s'il n'a pas de chaîne. S'il en a une autre, il garde la sienne et les mots de l'interface restent en mémoire jusqu'au choix « Use the Key of This Window for the Folder… », qui demande confirmation et n'efface jamais l'ancien casier. S reste chiffré par safeStorage (`cloud-secrets.dat`), comme avant.

## 5. Taille des documents synchronisés

Un document est chiffré, envoyé et déchiffré en mémoire d'un seul bloc. La limite par document est de 512 Ko de clair (`CHAIN_MAX_DOC_BYTES`, 524288 par défaut dans `back/services/chaine.js` et `deploy/docker-compose.yml`) : de quoi garder une longue note, pas assez pour qu'un appareil gonfle le casier ou la mémoire des autres. Le client applique la même limite avant d'envoyer (celle annoncée par le serveur, sinon 512 Ko) : un document plus gros reste sur l'appareil, il est compté et l'écran de synchro le dit, sans requête refusée. Le serveur reste juge et répond 413 `DOC_TOO_LARGE` au-delà.

## 6. Signaler un abus (reporting abuse)

Une faille ou une chaîne utilisée à mauvais escient se signale à `contact@sidali.dev`, adresse publiée aussi dans `https://lector.dockerbop.fr/.well-known/security.txt` (RFC 9116, servi par `back/routes/securityTxt.js`). Pour une chaîne, le signalement donne son identifiant court : les 8 premiers caractères hexadécimaux de son identifiant, la seule forme que gardent les journaux du serveur (l'identifiant complet convient aussi).

Ce que l'hébergeur peut faire : supprimer le casier chiffré de cette chaîne, c'est-à-dire sa ligne en base, ses documents et le dossier de ses blocs (`node scripts/supprimer-chaine.js <id>` dans le conteneur de l'API, qui montre la chaîne et demande de retaper son identifiant court avant d'effacer). Ce qu'il ne peut pas faire : lire ou décrire le contenu. Les blocs, les chemins et les titres sont chiffrés avec une clé dérivée de `S`, qui ne quitte jamais les appareils ; le serveur ne voit que des tailles, des dates et des identifiants opaques. Les appareils de la chaîne gardent leurs fichiers `.md` en local ; à la synchro suivante, ils constatent que le casier n'existe plus.

## Tests

- `e2e/flows/securite-rendu.spec.js` : un document piégé (HTML brut, liens `javascript:`) ne lance aucun script et garde ce que Lector affiche ; la CSP est en place.
- `e2e/flows/electron-mac.spec.js` : vrai processus principal sur des données jetables ; interface connectée avec la chaîne du Mac, chaîne transmise par l'interface, synchro du dossier dans les deux sens (fenêtre fermée comprise), liens externes hors de l'app, pont absent ailleurs que sur l'interface.
- `front/desktop/verrou.test.cjs` : nouvelle chaîne et tout effacer refusés verrou fermé.

Résultats : `docs/CHAINE-TESTS.md`.
