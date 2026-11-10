# Chaîne de sync : état des tests

Lector 2.0 (sans compte, chaîne seule, `docs/CHAINE.md`). Les fichiers de test décrits plus bas sont ceux de la version 2.2.

## Résultat d'une ancienne exécution (23/10/2026, branche `lector-gratuit`)

Chiffres historiques, d'avant la 2.2 : certains fichiers cités ici (`fournisseurs.test.cjs`, `api-keys.spec.js`, `electron-cles.spec.js`) n'existent plus, d'autres ont été ajoutés depuis. Ils ne décrivent pas l'état actuel.

| Commande | Résultat |
|---|---|
| `npm run test:chaine` | **90 réussis, 0 échec** : `chaine.test.mjs` 18, `qr.test.mjs` 7, `synchro.test.mjs` 31, `serveur-simule.test.mjs` 2, `textes-publics.test.mjs` 7, `chaine-desktop.test.cjs` 14, `verrou.test.cjs` 1, `acces.test.cjs` 5, `fournisseurs.test.cjs` 5 |
| `npx playwright test --project=api --config e2e/playwright.config.js` (`npm run test:api`) | **34 passed** : `chain.spec.js` 31, `health.spec.js` 2, `chain-bout-en-bout.spec.js` 1 (qui lance les 18 scénarios ci-dessous) |
| `node --test e2e/chaine/bout-en-bout.test.cjs` (lancé par le test précédent) | **18 réussis, 0 échec** (13 + 5 cas limites) |
| `npx playwright test --project=flows --config e2e/playwright.config.js` (`npm run test:flows`) | **31 passed** : `sync.spec.js` 4, `api-keys.spec.js` 2, `app.spec.js` 4, `command-palette.spec.js` 5, `demo-mode.spec.js` 5, `securite-rendu.spec.js` 5, `electron-acces.spec.js` 3, `electron-cles.spec.js` 1, `choix-source.spec.js` 1, `impression.spec.js` 1 |
| `node e2e/chaine-navigateur.cjs` (Google Chrome, sans fenêtre) | **ok**, 11 étapes |
| `npm run build` | réussi |

Les suites ne dépendent d'aucun service externe : l'API tourne en local sur une base jetable, le script navigateur bloque toute adresse hors de `localhost`.

## Environnement

- **Serveur** : le vrai `back/` (Express, Prisma, SQLite), lancé par `back/scripts/serveur-test.js` sur le port 3457. Le script refuse de tourner hors de `back/.test-data/`, recrée la base à chaque lancement (`prisma db push`) et recopie sa sortie dans `back/.test-data/serveur.log`, où les tests cherchent ce qui ne doit jamais y être.
- **Limites de test** (`e2e/back-test.js`) : 64 Kio de clair par document, 256 Kio et 20 documents par casier, anti-abus coupé (`CHAIN_RATE_LIMITS=off`).
- **Serveurs à part** dans `chain.spec.js` : les tests anti-abus démarrent un second serveur (port 3458, limiteurs actifs, `CHAIN_MAX_CHAINS=30`) ; les deux tests à écritures en rafale (tout effacer pendant des dépôts, plafond des pierres tombales) tournent sur un troisième (port 3459, dossier `back/.test-data/rafale`), pour ne pas gêner le scénario de bout en bout qui parcourt le dossier du serveur principal.
- **Playwright** démarre l'API de test et Vite (:5173). Le projet `flows` utilise le Chrome installé (`channel: 'chrome'`) : aucun navigateur à télécharger. Les specs `electron-*` lancent le vrai processus principal (`e2e/flows/electron-harnais.cjs`) sur un dossier de données jetable.

## Unitaires (`npm run test:chaine`, sans réseau)

- `chaine.test.mjs` : vecteurs recalculés avec `node:crypto`, dérivations, clés non exportables, `docId`, enveloppes à IV fixés et aléatoires, NFC/NFD, chemins invalides, altérations, `pathEnc` attaché au mauvais `docId`, nouvelle chaîne, BIP39, code d'appairage, ancien lien, `lireSaisie`, marque de suppression.
- `qr.test.mjs` : encodeur QR (Reed-Solomon, motifs, versions, empreinte figée), code `lector-chaine:`.
- `synchro.test.mjs`, contre le serveur simulé (`serveur-simule.mjs`, même contrat que le vrai) : création chiffrée sans fuite, envoi coupé puis repris, saisie, adoption (quatre cas), base de version 1 ignorée, trois voies, NFD, 412, bloc illisible, markdown seulement dans les deux sens, document trop gros et juste à la limite, quota, 413 non fatal, nouvelle chaîne (dont refus faute de place), création idempotente et limitée, preuve fausse puis 429, tout effacer puis recréer, flux, vault web, pierres tombales face à un serveur malveillant ; et, contre les pertes de données : renommage de casse sur disque insensible (même document, rien de supprimé), renommage de casse reçu comme suppression et nouveau document, adoption sans écraser un fichier au nom voisin, ancien casier gardé tant qu'un document n'est ni recopié ni sur le disque (`ROTATION_INCOMPLETE`), reprise d'une création sans supprimer ni écraser les documents d'un appareil entré entre-temps, sauvegarde faite pendant le cycle (ni écrasée ni retirée, copie de conflit au cycle suivant), suppression avec `If-Match`, bloc absent du serveur signalé sans relance.
- `serveur-simule.test.mjs` : le serveur simulé garde la parité avec le vrai sur `X-Lector-Mtime` (années 0 à 9999, sinon 400 `MTIME_INVALID`) et le plafond des pierres tombales (`maxDocs`, les plus anciennes d'abord).
- `chaine-desktop.test.cjs` : `ChaineDesktop` et `SyncManager` sur de vrais dossiers (création, export sous verrou, rejoindre, renouvellement, tout effacer, quitter, création et renouvellement coupés), `cloud-store` (anciens fichiers nettoyés : ceux de la version avec compte et `api-keys.dat`, les clés API retirées en 2.2 ; `S` chiffré sur le disque) ; disque réel : écriture et retrait seulement si le fichier est encore celui du scan, lien symbolique jamais suivi, chemin refusé par le vault (antislash, « .. ») sauté sans bloquer, casse sur disque insensible, fichier enregistré pendant un cycle ; `SyncManager.stop()` pendant le démarrage ou un cycle (plus rien d'écrit ni de relancé), relances à délai croissant.
- `verrou.test.cjs` : verrou fermé, ni nouveaux mots pour une chaîne existante, ni renouvellement, ni effacement (`LOCKED`) ; verrou ouvert, tout passe.
- `acces.test.cjs` : accès du renderer au disque (`front/desktop/acces.js`, `docs/SECURITE.md`) : dossiers ouverts, extensions, préfixe voisin, « .. », liens symboliques, vault, persistance.
- `textes-publics.test.mjs` : ce que Lector affirme en public reste vrai. Pas de « code public » tant que le dépôt est privé ; le lien « Détails techniques » vise `https://lector.dockerbop.fr/sync/`, dont la page (`front/landing/sync/index.html`) doit être celle que `node tools/page-sync.mjs` tire de `docs/CHAINE.md` ; le QR n'est annoncé que pour les navigateurs qui savent le lire ; la politique de confidentialité donne la durée des sauvegardes ; le site ne propose que les installeurs que `deploy/deploy.sh` publie et ne charge rien d'un autre site ; l'archive de la bascule naît en 600 dans le conteneur ; le README ne promet pas d'OTA sur Android.

## API (`e2e/api/chain.spec.js`, `health.spec.js`)

En-têtes absents ou mal formés (400 partout, rien créé) ; création 201, reprise 200, autre preuve 403, casier inconnu 404 ; créations simultanées ; `lastSeenAt` au plus une fois par heure ; dépôt et lecture, le serveur ne voit que des blocs ; CORS ; pierres tombales, 410, résurrection ; `If-Match` / `If-None-Match` et 412 ; formats refusés (dont un clair déguisé et les bornes de `X-Lector-Mtime`) ; panne de la base pendant un dépôt (déclencheurs SQLite) : l'ancien bloc reste servi sous son empreinte, aucun fichier en trop ; les trois 413 (`DOC_TOO_LARGE` juste au-delà de la limite, accepté juste à la limite ; `QUOTA_EXCEEDED` sans trace, compteur exact après re-dépôt et suppression ; `TOO_MANY_DOCS`) ; dépôts parallèles qui ne dépassent pas le quota ; tout effacer ; purge (pierres tombales de plus de 30 jours, casiers inactifs depuis 180 jours, dossiers fantômes, avec des dates simulées) et purge face à un casier redevenu actif ; flux SSE par chaîne, fermé à l'effacement, 10 flux par IP, flux jamais lu coupé à 64 Kio et fin propre pour un lecteur sain ; `verifier-chaine.js` (compteurs, orphelins, blocs manquants, fantômes, `--recount`) ; en rafale, sur un serveur à part : tout effacer pendant des dépôts, plafond des pierres tombales ; anti-abus (5 créations par IP et par heure, exactes même en rafale ; IPv6 compté par /64 ; plafond global de casiers ; 10 preuves fausses par couple IP et chaîne, la bonne preuve passe toujours) ; limite anti-partage sur un serveur à part (8 réseaux lisent, le 9e reçoit 429 `CHAIN_READ_LIMITED` avec `Retry-After`, un réseau déjà vu passe encore, les adresses d'un même /24 ou /48 comptent pour un réseau, une fausse preuve ne compte pas, les écritures passent, la fenêtre raccourcie expire, rien dans le journal) ; journal du serveur sans contenu, chemin, `pathEnc`, preuve, secret, 12 mots, IP ni `id` complet ; aucun clair sur le disque ni dans la base ; santé et routes de l'ancienne version en 404.

## De bout en bout (`e2e/chaine/bout-en-bout.test.cjs`)

Vrais clients contre le vrai serveur de test : `ChaineDesktop` et `SyncManager` du processus principal d'Electron sur de vrais dossiers (Electron n'est pas lancé), et `VaultWebChaine`, le module de l'app web, piloté en Node.

**Une chaîne, deux ordinateurs et un navigateur**
1. A crée la chaîne. Son vault contient 3 `.md` (dont un nom en NFD et des sous-dossiers), une image `.png`, un `.pdf`, un `.txt`, un `.obsidian/workspace.md` et un `.obsidian/app.json`. Seuls les 3 `.md` partent : 3 lignes `ChainDoc`, 3 blocs de la taille attendue (clair + 29 octets), les chemins déchiffrés sont exactement les 3 `.md`, aucun octet de l'image ni du PDF dans les blocs. La synchro suivante n'a rien à faire, les autres fichiers sont comptés comme ignorés.
2. B rejoint : 12 mots à somme fausse refusés **sans aucune requête** ; 12 mots valides d'une chaîne jamais créée : 404, rien gardé, rien créé ; les bons mots en majuscules avec virgules : rejoint. Adoption : B reçoit les 3 documents, envoie le sien, jamais son image ni son `.txt`. Les deux vaults ont le même markdown, octet pour octet.
3. A supprime un document : pierre tombale (`sha256: ""`, `size: 0`, `tombEnc`), `GET` en 410, bloc effacé du disque ; B le retire.
4. A et B modifient le même document : copie de conflit, les deux versions gardées des deux côtés.
5. Un client bogué dépose un `.png` et un `.txt` chiffrés : aucun appareil ne les écrit ni ne les supprime, `notMarkdown` les compte, la vérification de l'appareil les signale (`horsFormat: 2`).
6. Navigateur : rejoint par le code du QR, clés non exportables, arbre et contenus identiques à ceux de A ; écrit un document que A reçoit ; `.png` refusé et document trop gros refusé **sans requête** ; document juste à la limite (64 Kio de clair) accepté par le client et le serveur ; écriture sur une version périmée : 412, la version de A reste ; relu, il s'écrit.
7. Temps réel : `SyncManager` démarré sur A (flux compris) ; B écrit, A reçoit en moins de 10 s alors que la synchro périodique est à 30 s. Le test échoue si le flux est coupé (vérifié).
8. Redémarrage de B avec une base locale de version 1 et un document effacé du disque pendant l'arrêt : la base est ignorée, le document revient du serveur, rien n'est supprimé sur le serveur, la base est réécrite en version 2.
9. Serveur : aucun chemin, contenu, octet d'image ou de PDF dans les blocs, la base SQLite et le journal ; ni `S`, ni 12 mots, ni preuve, ni `id` complet dans le journal ; aucune URL de requête ne contient la preuve ou l'`id` ; `ChainDoc` ne contient que des identifiants opaques et des enveloppes ; `verify` sans preuve : 400, avec preuve : tout à 0, compteurs exacts ; `verifier-chaine.js --chain` : code 0 ; sans argument : 2.
10. Nouvelle chaîne depuis A : ancien casier effacé (ligne, blocs, dossier), l'ancien `id` répond 404 ; B, resté sur l'ancienne, s'arrête en `chain-unknown` sans perdre le fichier écrit entre-temps, garde `S`, puis rejoint avec les nouveaux mots : son document part, aucun conflit.
11. Tout effacer depuis A pendant que B tourne avec son flux : casier détruit (ligne, blocs, dossier), A oublie `S` et sa base, le serveur ferme le flux de B qui reçoit 404 à la reconnexion et s'arrête ; aucun fichier local touché ; `verifier-chaine.js` répond 2 pour ce casier.

Le scénario 9 ne parcourt que le dossier de ce casier : les tests de l'API, en parallèle sur le même serveur, créent et effacent d'autres dossiers pendant le parcours (fichiers temporaires des dépôts compris), d'où aussi une lecture qui tolère un fichier disparu (`lireSiPresent`).

**Chaîne inconnue** : un appareil dont le casier a disparu pendant qu'il était éteint fait une seule requête (manifeste, 404), s'arrête, n'écrit ni ne supprime rien, ne recrée rien et garde `S`.

**Quota** : création avec un document trop gros, un document juste à la limite, cinq documents de 60 000 octets et une grande image. Partent : le document à la limite et trois des cinq (le casier de 256 Kio est plein), signalés : le trop gros et les deux en attente. Deux cycles : état `idle`, aucune erreur, un seul événement « casier plein », aucune requête vouée au refus. Manifeste trop optimiste (un autre appareil a pris la place) : un seul `PUT`, refusé en 413, le cycle se termine normalement, aucune ligne ni aucun fichier en trop. L'utilisateur supprime deux documents : ils sont supprimés du serveur et les deux en attente partent dans le même cycle ; compteurs exacts (`verifier-chaine.js`), aucun fichier local touché.

**Aucune perte dans les cas limites** :
1. reprise d'une création après qu'un autre ordinateur a rejoint : rien du sien n'est supprimé ni écrasé ;
2. suppression pendant qu'un autre appareil écrit : le `DELETE` porte `If-Match`, la nouvelle version survit partout ;
3. nouvelle chaîne dont un document n'a pas pu être écrit sur l'ordinateur : `ROTATION_INCOMPLETE`, l'ancien casier reste ; une fois le document corrigé, la reprise passe ;
4. disque insensible à la casse : renommage de casse et document au nom voisin, sans perte (sauté sur un disque sensible à la casse) ;
5. journal du serveur : ni secret, ni preuve, ni `id` complet de ces chaînes.

## Écrans (`npm run test:flows`)

- `sync.spec.js` : créer, 12 mots, formulaire du gestionnaire, kit de secours, vérification, quitter, rejoindre, tout effacer, erreurs de saisie. Le lien « Détails techniques » vise la page du site ; sur le web, « Tout effacer » dit que le casier est peut-être la seule copie des documents.
- `securite-rendu.spec.js` : documents piégés (HTML brut, CSP, polices et scripts tiers), `docs/SECURITE.md`.
- `electron-acces.spec.js` : vrai processus principal en bac à sable, accès au disque limité aux dossiers ouverts.
- `choix-source.spec.js` : la démo choisie pendant une restauration de session lente (module de la chaîne retardé) reste affichée.
- `impression.spec.js` : l'export d'un dossier en fenêtre d'impression échappe le texte des documents (balises, liens `javascript:`, guillemets).
- `collab.spec.js` : co-écriture dans deux navigateurs, coupure réseau, lien abîmé refusé, partage depuis l'app web puis arrêt.
- `command-palette.spec.js` : ouverture et fermeture de la palette ; aucune commande des fonctions retirées en 2.2 (clés API, fiches, YouTube, lecture à voix haute, règle, défilement automatique, surlignages), ni licence ni Kindle ; la commande About ouvre son écran.
- `app.spec.js`, `demo-mode.spec.js` : bases de l'app, mode démo.

## Poids du démarrage (`npm run test:poids`, `e2e/poids/`)

Après `npm run build`, sert `front/dist` comme nginx en production, ouvre `/app/` dans Chrome sans fenêtre et additionne le gzip de chaque fichier téléchargé : le test échoue si le JavaScript initial de `/app/` dépasse son budget (150 Ko gzip).

## Navigateur réel (`e2e/chaine-navigateur.cjs`)

L'app web servie par Vite, dans Chrome, avec un ordinateur (`ChaineDesktop`, `SyncManager`) dans la même chaîne :
1. sans chaîne : arbre `cloud://` vide, l'app reçoit le signal `NO_CHAIN` ;
2. créer depuis l'écran : 12 mots, formulaire du gestionnaire (`username` = `lector-sync-chain`, `new-password` = les 12 mots), bouton « Save in my password manager » (formulaire soumis, `navigator.credentials.store` appelé sans erreur, `PasswordCredential` présent dans Chrome), vérification de trois mots ;
3. IndexedDB : `chainId`, `cleEnc`, `cleMac`, `preuve`, `version`, clés non exportables, ni `S` ni les mots ;
4. l'ordinateur rejoint avec les 12 mots et envoie ses 3 `.md`, pas son image ;
5. rechargement : l'app s'ouvre sur `cloud://`, la barre latérale montre les dossiers et documents déchiffrés, pas l'image ; un clic affiche le contenu ;
6. `fileSystem` lit et écrit (l'ordinateur reçoit le document écrit), `.png` refusé (`NOT_MARKDOWN`) ;
7. lecture, modification sur l'ordinateur, écriture du navigateur : 412 `CONFLICT`, rien d'écrasé ;
8. `verify` : 4 blocs, `ok: true` ;
9. nouvelle chaîne depuis l'ordinateur : le navigateur reçoit `CHAIN_UNKNOWN`, oublie ses clés, affiche « This chain no longer exists », refuse d'écrire (`NO_CHAIN`) sans aucun dépôt ;
10. rejoindre depuis l'écran avec les nouveaux mots (champ masqué `current-password`) : l'arbre revient ;
11. tout effacer depuis le navigateur (mot `ERASE`) : clés oubliées, casier en 404, l'ordinateur s'arrête en `chain-unknown`, ses fichiers intacts.

## Corrections faites pendant ce lot

1. **Limite par document lue comme une limite de bloc.** Le serveur annonce `maxDocBytes` comme la taille maximale du clair (un bloc peut faire 29 octets de plus), mais le client (`synchro.js`, `web-vault.js`) et le serveur simulé la traitaient comme une limite de bloc : un document de 2 Mo pile était refusé localement alors que le serveur l'aurait accepté. Le scénario « quota » et l'étape 6 du navigateur l'ont montré ; les trois fichiers sont alignés sur le serveur et `synchro.test.mjs` vérifie désormais le cas « juste à la limite ».
2. **Synchro après l'arrêt.** Le surveillant de fichiers gardait sa minuterie d'apaisement (2 s) après `close()` : un changement juste avant l'arrêt de la synchro (quitter, tout effacer) déclenchait encore un cycle. `front/desktop/vault/watcher.js` l'annule à la fermeture.

## Corrections du second lot

Chaque défaut a son test de régression, vérifié en échec sur le code d'avant et en succès après :
- dépôt encore privé annoncé « open source », liens « Détails techniques » et kit de secours en 404 (`textes-publics.test.mjs`, `sync.spec.js`) ;
- « Tout effacer » sur le web et le mobile, où le casier est peut-être la seule copie (`sync.spec.js`) ;
- QR annoncé là où aucune app ne le scanne (`textes-publics.test.mjs`) ;
- sauvegardes du serveur absentes de la politique (`textes-publics.test.mjs`) ;
- installeurs 1.x proposés par le site, polices Google et Umami sur le site (`textes-publics.test.mjs`) ;
- « chiffrée par le trousseau du système » affiché sans trousseau (`electron-cles.spec.js`) ;
- `chmod` de l'hôte sur l'archive de root dans le plan de bascule, OTA annoncée pour Android (`textes-publics.test.mjs`) ;
- nouvelle chaîne et tout effacer sans verrou sur ordinateur (`verrou.test.cjs`) ;
- choix de la source réaffiché par la restauration de session, qui rendait `demo-mode.spec.js` et `app.spec.js` instables (`choix-source.spec.js`) ;
- export imprimé sans échappement (`impression.spec.js`) ;
- parité du serveur simulé (`serveur-simule.test.mjs`).

## Ce qui n'est pas couvert

- **Electron lancé ou empaqueté** : le processus principal est testé en Node, pas dans l'app ; le chargement des modules ES depuis l'archive `asar` reste à confirmer sur une version construite (`npm run dist`).
- **Applications mobiles** (iOS, Android) : aucun test automatique ; elles utilisent le module web, testé dans Chrome.
- **Gestionnaires de mots de passe réels** (Proton Pass, Bitwarden, trousseau iCloud) : le formulaire et l'appel à l'API sont vérifiés, pas la proposition d'enregistrement ni le remplissage. `navigator.credentials.get` (rejoindre depuis le gestionnaire) n'est pas exercé.
- **Scanner du QR** (`BarcodeDetector` et caméra) : le code et sa lecture par `lireSaisie` sont testés, pas la détection par caméra. Seuls certains navigateurs l'offrent (`docs/CHAINE.md` § 3.6).
- **Site et serveur web** : la page `/sync/`, l'absence de ressource tierce et les liens de téléchargement sont vérifiés sur les fichiers ; l'en-tête `frame-ancestors` de `/app/` (`deploy/nginx.conf`) et la commande d'archive du plan de bascule (Docker en root) ne sont pas exécutés ici.
- **Touch ID** : le verrou est injecté dans les tests de `ChaineDesktop`, jamais déclenché pour de vrai.
- **Bascule de production** (`docs/BASCULE-PROD.md`) : aucune commande de ce plan n'a été lancée ; le comportement de Traefik et des sauvegardes n'est pas testable ici.
- **Purge sur une vraie durée** : la purge des 30 jours et des 180 jours est testée avec des dates simulées.

## Lancer

```bash
npm run test:chaine     # unitaires, sans serveur
node tools/page-sync.mjs   # après un changement de docs/CHAINE.md : régénère la page /sync/ du site
npm run test:api        # API et bout en bout (démarre l'API de test sur :3457 et Vite sur :5173)
npm run test:flows      # écrans dans Chrome
npm run test:poids      # poids du démarrage de /app/ (après npm run build)
node e2e/chaine-navigateur.cjs   # navigateur réel ; démarre l'API de test et Vite (:5174) s'il le faut
npm run build
```

Bout en bout seul, avec l'API de test lancée à la main (l'arrêter avant `npm run test:api`, qui refuse un port déjà pris) :

```bash
cd back && node -e "Object.assign(process.env, require('../e2e/back-test.js').ENV_TEST); require('./scripts/serveur-test.js')"
node --test e2e/chaine/bout-en-bout.test.cjs
```

## Pièges connus

- `e2e/chaine/bout-en-bout.test.cjs` doit tourner dans un processus Node ordinaire, comme le processus principal d'Electron : sous le chargeur de Playwright, `crypto.js` déjà compilé en CommonJS par `chain.spec.js` casse l'`import()` natif de `front/desktop/chaine-modules.js`. `e2e/api/chain-bout-en-bout.spec.js` le lance donc à part.
- Script navigateur : si Vite tournait déjà sur :5174 avant une modification du front, le relancer. Sinon la page et les `import()` du script peuvent charger deux versions des mêmes modules.
- Tous les tests arrivent de la même IP : les limiteurs anti-abus sont coupés dans l'environnement de test, sauf dans les tests qui les vérifient sur leur propre serveur.
- `npm run test:api` a besoin des ports 3457, 3458 et 3459 libres (serveur principal, anti-abus, rafale).
- Un dépôt garde son bloc dans un fichier temporaire (`.tmp`) le temps de sa transaction : un test qui parcourt `CHAIN_FILES_ROOT` pendant que les tests de l'API tournent peut voir un fichier disparaître. Ne parcourir que le dossier de son propre casier, et lire en tolérant un fichier disparu.
