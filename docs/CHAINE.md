# Chaîne de sync de Lector : spécification

Lector 2.0 est gratuit et sans compte. La synchronisation entre appareils passe par une **chaîne** : un secret tiré sur un appareil de l'utilisateur, d'où sortent toutes les clés. Le serveur ne garde que des blocs chiffrés qu'il ne sait pas ouvrir.

Statut : implémenté (serveur `back/`, clients `front/src/services/chaine/`, `front/desktop/`, écrans `front/src/components/ChaineSync.jsx`) et testé (`docs/CHAINE-TESTS.md`). Mise en production : `docs/BASCULE-PROD.md`.

## 0. En bref

- **Pas de compte.** Ni e-mail, ni mot de passe, ni licence. La chaîne est l'identité : qui a le secret `S` a accès au casier ; qui ne l'a pas n'a rien.
- **`S` ne quitte jamais les appareils.** 16 octets aléatoires, écrits en 12 mots (BIP39) ou dans un QR. Le serveur ne connaît que l'identifiant public `id` et l'empreinte de la preuve `P`, tous deux dérivés de `S`.
- **Serveur aveugle.** Il range des blocs chiffrés (AES-256-GCM) sous des identifiants opaques. Il ne voit ni le contenu, ni les chemins, ni les titres.
- **Markdown seulement.** Seuls les fichiers `.md` et `.markdown` voyagent. Images, PDF et autres restent sur l'appareil où ils sont.
- **Un casier par chaîne**, avec un quota (20 Mo, 512 Ko de clair par document, 5 000 documents par défaut). Le casier est petit exprès : Lector est fait pour du texte, et 20 Mo le rendent inutile pour stocker des images ou des fichiers.
- **Premier appareil : créer. Les suivants : rejoindre** avec les 12 mots, tapés ou remplis par le gestionnaire de mots de passe (le QR, seulement dans un navigateur qui sait le lire, § 3.6). Rejoindre ne crée jamais de casier.
- **Les documents restent des `.md` en clair sur le disque** de chaque appareil. Le chiffrement concerne ce qui part vers le serveur.

## 1. Vocabulaire

| Terme | Sens |
|---|---|
| `S` | Secret de chaîne, 16 octets aléatoires (128 bits). Écrit en 12 mots ou en code d'appairage (QR). |
| Chaîne | Les appareils qui connaissent `S`. |
| Casier | Ce que le serveur garde pour une chaîne : une ligne `Chain`, une ligne `ChainDoc` par document, les blocs sur disque. |
| `id` | Identifiant public de la chaîne, dérivé de `S` (32 hex). Le serveur range le casier sous cet `id`. |
| Preuve `P` | Valeur dérivée de `S`, présentée à chaque requête. Le serveur n'en garde que `hex(SHA-256(P))`. |
| `docId` | Identifiant opaque d'un document : HMAC de son chemin. Stable tant que le chemin ne change pas. |
| Bloc | Contenu chiffré d'un document (`contentEnc`). |
| Pierre tombale | Trace d'un document supprimé, gardée 30 jours, avec la marque de suppression chiffrée `tombEnc`. |
| Appareil | Une installation de Lector. Il tire au hasard un identifiant (UUID) qui sert seulement à reconnaître ses propres échos dans le flux temps réel ; le serveur ne le stocke pas. |

### Un seul secret

| Ce que possède quelqu'un | Ce qu'il obtient |
|---|---|
| `S` (12 mots, QR, un appareil de la chaîne) | Tout : lire, écrire, effacer le casier, renouveler la chaîne. |
| `P` seule (fuite d'en-têtes) | Écrire, supprimer ou effacer des blocs ; jamais les lire (`P` ne donne ni `S`, ni les clés). |
| L'`id` seul | Savoir si le casier existe (404 pour un `id` inconnu, 403 pour une fausse preuve), rien d'autre : sans `P`, toutes les routes refusent (400 sans preuve) et ne disent même pas la taille du casier. L'`id` fait 128 bits dérivés de `S` : il ne se devine pas. |
| Rien | Rien sur le casier. |
| Le serveur (hébergeur, intrus sur la machine) | Blocs chiffrés et métadonnées listées au § 2. |

### Pourquoi pas de compte

Rien à réinitialiser, rien à facturer, rien qui relie le casier à une personne. Le prix : perdre `S` partout (tous les appareils et la fiche des 12 mots) rend le casier illisible pour tout le monde, définitivement. Chaque appareil garde son vault en clair sur son disque et peut recréer une chaîne (§ 11).

## 2. Ce que le serveur voit, ce qu'il ne voit pas

**Il voit** :
- l'`id` de la chaîne et l'empreinte de `P` ;
- par document : `docId`, taille du bloc (taille du fichier + 29 octets), date de modification fournie par le client, date de dépôt, date de suppression, marque de suppression chiffrée ;
- la longueur approximative du chemin (taille de `pathEnc`, sans remplissage) ;
- le nombre de documents, la place occupée, le rythme des écritures, la date de création du casier et sa dernière activité (à l'heure près) ;
- au passage, l'adresse IP des requêtes (limiteurs anti-abus en mémoire, journaux d'accès du proxy) et l'identifiant aléatoire d'appareil (`X-Lector-Device`), qui n'est pas stocké ;
- en mémoire seulement, pendant 24 heures, l'empreinte salée du préfixe réseau de chaque appareil qui lit la chaîne (§ 13.1).

**Il ne voit pas** : le contenu, les chemins, les titres, les noms de dossiers, l'arborescence, les extensions, `S`, les 12 mots, les clés. Un ancien bloc `<!-- lector-generated -->` (résumés et cartes écrits par les versions d'avant la 2.2, jamais affiché) fait partie du `.md`, donc du bloc chiffré.

**Il ne journalise jamais** : la preuve, `pathEnc`, un corps de requête, une IP, un `id` de chaîne complet (8 premiers caractères au plus). Les tests le vérifient dans la sortie du serveur.

**Rien d'autre ne passe par lui.** Lector n'envoie le texte d'un document à aucun autre service.

## 3. Cryptographie

Tout est dans `front/src/services/chaine/crypto.js` : HKDF-SHA256, HMAC-SHA256, AES-256-GCM, BIP39. Un seul module ES, sans DOM, qui tourne dans le navigateur, la vue web Capacitor, le processus principal d'Electron (import dynamique) et Node 22. Il est vérifié contre `docs/CHAINE-VECTEURS.json`, produits par une implémentation indépendante (`node:crypto`, `generer-vecteurs.mjs`).

### 3.1 Secret

`S` = 16 octets de `crypto.getRandomValues`. Jamais envoyé au serveur, jamais journalisé, jamais placé dans une URL.

### 3.2 Dérivations

HKDF-SHA256, sel vide, `S` comme matériau d'entrée :

| Nom | info HKDF | Taille | Usage |
|---|---|---|---|
| `id` | `lector-id` | 16 octets, écrit en hex (32 caractères) | Identifiant public du casier, en-tête `X-Lector-Chain-Id`. |
| `K_enc` | `lector-enc` | 32 octets | Clé AES-256-GCM des chemins, contenus et marques de suppression. |
| `K_mac` | `lector-mac` | 32 octets | Clé HMAC-SHA256 des `docId`. |
| `P` | `lector-proof` | 32 octets | Preuve, envoyée en base64url (43 caractères) dans `X-Lector-Chain-Proof`. Le serveur stocke `hex(SHA-256(P))`. HKDF est à sens unique : `P` ne donne ni `S`, ni `K_enc`, ni `K_mac`. |

Dans le code : `preparer(S)` renvoie `{ id, preuve, cleEnc, cleMac }`, avec `cleEnc` et `cleMac` en `CryptoKey` **non exportables**.

### 3.3 Chemin normalisé et `docId`

Chemin canonique (`normaliserChemin`) : relatif à la racine du vault, séparateur `/`, Unicode **NFC** (macOS rend souvent du NFD : `Été` donne le même `docId` sous les deux formes), casse conservée, aucun segment vide, `.` ou `..`, pas de `/` initial ni final, pas de NUL, 1024 octets UTF-8 au plus. Convertir `\` (Windows) en `/` est le rôle de la couche vault.

```
docId = hex(HMAC-SHA256(K_mac, UTF-8(chemin normalisé)))      64 caractères hex
```

Renommer un fichier revient à supprimer l'ancien `docId` et à créer le nouveau.

### 3.4 Enveloppe

Format unique pour les chemins, les contenus et les marques de suppression :

```
enveloppe = 0x01 (version) ‖ iv (12 octets) ‖ chiffré ‖ étiquette (16 octets)
```

- AES-256-GCM, `K_enc`, étiquette de 128 bits. Surcoût fixe : 29 octets.
- IV de 12 octets aléatoires, nouveau à chaque chiffrement (taille recommandée par NIST SP 800-38D). Avec des IV aléatoires de 96 bits, la limite prudente est 2^32 chiffrements par clé, très au-delà de la vie d'un vault. Une nouvelle chaîne change de clé. Recréer un casier avec le même `S` après un effacement est sans risque pour la même raison.
- Une version inconnue est refusée. Le premier octet n'est pas dans l'AAD : le modifier ne peut que faire échouer la lecture.

### 3.5 `pathEnc`, `contentEnc`, `tombEnc`

| Champ | Clair | AAD | Encodage |
|---|---|---|---|
| `contentEnc` | octets du fichier | `UTF-8(docId)` | binaire : corps du `PUT`, réponse du `GET` |
| `pathEnc` | `UTF-8(chemin normalisé)` | `UTF-8("chemin:" + docId)` | base64url sans remplissage : en-tête `X-Lector-Path-Enc`, champ du manifeste |
| `tombEnc` | `UTF-8("supprime:" + docId + ":" + sha256 du bloc supprimé)` | `UTF-8("tombe:" + docId)` | base64url : en-tête `X-Lector-Tomb-Enc` du `DELETE`, champ du manifeste |

Les AAD différentes empêchent le serveur d'échanger le chemin et le contenu d'un document ; le `docId` dans l'AAD empêche d'attacher le bloc d'un document à un autre. `dechiffrerCheminAvec` recalcule en plus `HMAC(K_mac, chemin)` et refuse un résultat différent du `docId`.

### 3.6 12 mots et code d'appairage

- **12 mots** : BIP39 anglais standard sur les 128 bits de `S` (11 bits par mot, 4 bits de somme de contrôle = premier quartet de SHA-256(S)). Saisie insensible à la casse, espaces et virgules acceptés.
- **Code d'appairage** (contenu du QR) : `lector-chaine:<base64url(S)>` (36 caractères). Ce n'est pas une adresse web : l'appareil photo d'un téléphone ne l'ouvre pas dans un navigateur, il se lit avec le scanner de Lector. Il vaut les 12 mots : l'interface ne propose de copier ni le code ni les mots (presse-papiers universel, historiques de presse-papiers).
- **Qui peut scanner** : le scanner exige `BarcodeDetector` et une caméra, donc l'app web dans un navigateur qui les offre (Chrome sur Android ou sur macOS, par exemple). L'app de bureau (pas d'accès à la caméra) et les apps iOS et Android (vue web sans `BarcodeDetector`, pas de permission caméra) ne le scannent pas ; l'onglet « Scanner » n'apparaît que là où il marche. Partout ailleurs : les 12 mots, tapés ou remplis par le gestionnaire de mots de passe. Les textes de l'app, du kit de secours et du site le disent.
- **Ancien lien** `https://lector.dockerbop.fr/app/#chaine=<base64url(S)>` : plus jamais produit (une page ouverte entre dans l'historique du navigateur, fragment compris, puis dans sa synchronisation). Collé dans le champ, il est encore lu.
- `lireSaisie(texte)` accepte les 12 mots, le code ou un ancien lien, sans aucun appel réseau.

### 3.7 Vecteurs

`docs/CHAINE-VECTEURS.json`, pour `S = 000102030405060708090a0b0c0d0e0f` :

| Valeur | Résultat |
|---|---|
| `id` | `21493c49c3cb28f9041197f59f7e704e` |
| `docId("Pro/Notes.md")` | `99e94d4113b8b7e5983597f288e090da3c7e6e7861702a1d33c3bc8ecbebe3c0` |
| 12 mots | `abandon amount liar amount expire adjust cage candy arch gather drum buyer` |
| code d'appairage | `lector-chaine:AAECAwQFBgcICQoLDA0ODw` |

Ils contiennent aussi `K_enc`, `K_mac`, `P`, l'empreinte stockée par le serveur, `pathEnc` (iv `0a0b0c0d0e0f101112131415`) et `contentEnc` de `"# Test\n"` (iv `00112233445566778899aabb`), un cas NFC/NFD, des chemins invalides, des mots à somme fausse et un second `S`.

```bash
npm run test:chaine                                   # vérifie crypto.js contre les vecteurs (et le reste)
node front/src/services/chaine/generer-vecteurs.mjs   # régénère le JSON avec node:crypto
```

## 4. Stockage serveur

### 4.1 Schéma Prisma (`back/prisma/schema.prisma`)

```prisma
model Chain {
  id         String     @id                 // 32 hex, dérivé de S côté client
  proofHash  String                         // hex(SHA-256(P)), jamais la preuve
  bytesUsed  Int        @default(0)         // somme des size des blocs vivants
  docCount   Int        @default(0)         // blocs vivants
  createdAt  DateTime   @default(now())
  lastSeenAt DateTime   @default(now())     // écrit au plus une fois par heure
  docs       ChainDoc[]
}

model ChainDoc {
  id        String    @id @default(uuid())
  chainId   String
  chain     Chain     @relation(fields: [chainId], references: [id], onDelete: Cascade)
  docId     String    // 64 hex
  pathEnc   String    // enveloppe du chemin, base64url
  sha256    String    // SHA-256 du BLOC ('' pour une pierre tombale)
  size      Int       // taille du bloc (0 pour une pierre tombale)
  mtime     DateTime  // fournie par le client
  deletedAt DateTime?
  tombEnc   String?
  updatedAt DateTime  @updatedAt
  @@unique([chainId, docId])
  @@index([chainId, deletedAt])
}
```

Aucune table d'utilisateurs, d'appareils ni de licences. Le conteneur applique le schéma au démarrage (`prisma db push`) : sur une base qui contient encore les tables de la version avec compte, il refuse (perte de données) et redémarre en boucle. D'où la bascule sur une base neuve (`docs/BASCULE-PROD.md`).

### 4.2 Fichiers

- Racine `CHAIN_FILES_ROOT` (production : `/data/chain`, dans le volume `lector-data` ; développement : `back/dev-chain`).
- Chemin d'un bloc : `CHAIN_FILES_ROOT/<id>/<docId[0:2]>/<docId>`. Aucun nom fourni par le client n'entre dans un chemin disque : seulement un `id` et un `docId` validés en hex.
- Écriture atomique (fichier temporaire puis renommage).

### 4.3 Compteurs et quota

`bytesUsed` et `docCount` sont tenus à jour dans la ligne `Chain`. Un dépôt écrit d'abord le bloc dans un fichier temporaire, à côté de sa place. La réservation de place, une mise à jour conditionnelle (`bytesUsed <= quota - delta`, atomique dans SQLite : deux dépôts parallèles ne dépassent pas le quota ensemble), et la ligne `ChainDoc` passent ensuite dans une seule transaction, liée au casier lu à l'authentification (même `createdAt`). Le bloc n'est renommé à sa place qu'après la transaction. En cas d'échec, le temporaire est supprimé et rien ne change, ni sur le disque, ni en base. Un dépôt qui croise un effacement du casier reçoit 404 `CHAIN_UNKNOWN`. Un dépôt qui remplace un bloc ne compte que la différence ; une suppression libère la place du bloc. `scripts/verifier-chaine.js` recalcule ces compteurs à partir des lignes et du disque (§ 5.3).

## 5. Contrat des routes (`/v1/chain`)

### 5.1 En-têtes et authentification

| En-tête | Valeur |
|---|---|
| `X-Lector-Chain-Id` | `id`, 32 hex minuscules |
| `X-Lector-Chain-Proof` | `P` en base64url, 43 caractères |
| `X-Lector-Device` | facultatif : identifiant aléatoire de l'installation (1 à 64 caractères parmi `[A-Za-z0-9_-]`), sert seulement à marquer les événements du flux ; jamais stocké |

Ordre des contrôles, sur toutes les routes (création comprise) :
1. en-têtes absents ou mal formés : **400** `CHAIN_ID_INVALID`, puis `CHAIN_PROOF_MISSING` ;
2. casier inconnu : **404** `CHAIN_UNKNOWN` (jamais créé, effacé, ou renouvelé ailleurs) ;
3. preuve fausse : **403** `CHAIN_PROOF_INVALID`, puis **429** `CHAIN_PROOF_LIMITED` (§ 13) ; la bonne preuve passe toujours ;
4. `lastSeenAt` mis à jour au plus une fois par heure ;
5. lectures (`GET`) seulement : un nouveau réseau alors que la chaîne a déjà été lue depuis 8 réseaux distincts en 24 heures, **429** `CHAIN_READ_LIMITED` avec `Retry-After` (§ 13.1) ; les réseaux déjà vus passent.

La preuve n'est jamais dans une URL : toutes les requêtes, flux compris, la portent dans les en-têtes. Toutes les réponses portent `Cache-Control: no-store`. CORS expose `ETag`, `X-Lector-Path-Enc` et `X-Lector-Mtime`.

### 5.2 Routes

| Route | Requête | Réponse | Refus |
|---|---|---|---|
| `POST /v1/chain` | aucun corps : l'`id` et la preuve viennent des en-têtes | 201 créé, 200 s'il existe déjà avec la même preuve (reprise après coupure) ; `{ chainId, bytesUsed, quotaBytes, maxDocBytes, maxDocs, docCount }` | 403 `CHAIN_PROOF_INVALID` (existe avec une autre preuve) ; 429 `CHAIN_CREATE_LIMITED` ; 503 `CHAIN_CAPACITY` |
| `GET /v1/chain` | | mêmes champs | 404, 403, 429 (`CHAIN_PROOF_LIMITED`, `CHAIN_READ_LIMITED`) |
| `DELETE /v1/chain` | | 204 : la ligne `Chain` d'abord, qui emporte ses documents (tout dépôt en vol échoue), puis le dossier ; les flux ouverts sont fermés, et un lecteur qui n'a pas tout lu est coupé net | 404, 403 |
| `GET /v1/chain/manifest` | | mêmes champs + `docs: [{ docId, pathEnc, sha256, size, mtime, deletedAt, tombEnc }]`, pierres tombales de moins de 30 jours comprises | 404, 403 |
| `PUT /v1/chain/docs/:docId` | corps binaire = bloc ; `X-Lector-Path-Enc` ; `X-Lector-Mtime` (date ISO entre les années 0000 et 9999, sinon 400 `MTIME_INVALID` ; absent : la date du serveur) ; `If-Match: <sha256 du bloc attendu>` (guillemets, `W/` et `*` acceptés) ou `If-None-Match: *` pour une création, y compris par-dessus une pierre tombale ; sans les deux, écriture inconditionnelle | 200 `{ docId, sha256, size, bytesUsed }` et `ETag` | 412 `{ code: CONFLICT, current }` ; 413 `DOC_TOO_LARGE { maxDocBytes }`, `QUOTA_EXCEEDED { bytesUsed, quotaBytes, size }`, `TOO_MANY_DOCS { docCount, maxDocs }` ; 400 `DOC_ID_INVALID`, `PATH_ENC_INVALID`, `MTIME_INVALID`, `ENVELOPE_INVALID` |
| `GET /v1/chain/docs/:docId` | | bloc brut ; `ETag` = SHA-256 du bloc (sans guillemets), `X-Lector-Path-Enc`, `X-Lector-Mtime` | 404 `DOC_UNKNOWN` ; 410 `DOC_DELETED { deletedAt }` |
| `DELETE /v1/chain/docs/:docId` | `X-Lector-Tomb-Enc` obligatoire ; `If-Match` facultatif (les clients l'envoient dès qu'ils connaissent l'empreinte du bloc) | 204, aussi quand le document est déjà supprimé ; bloc effacé du disque, place rendue. Au plus `maxDocs` pierres tombales par casier : les plus anciennes partent d'abord (un appareil qui l'a manquée renvoie le document, comme après 30 jours) | 400 `TOMB_ENC_INVALID` ; 404 `DOC_UNKNOWN` ; 412 `CONFLICT` |
| `GET /v1/chain/verify` | | `{ chain (8 caractères), blocs, octets, blocsManquants, empreintesFausses, versionsInconnues, blocsSuspects, orphelins, compteurs, attendu, ok }` | 404, 403 |
| `GET /v1/chain/stream` | lu par `fetch` (en-têtes), jamais par `EventSource` | SSE : `: connected`, puis `event: vault-change` avec `{ kind: 'put' \| 'delete', docId, actorDevice }`, et `: ping` toutes les 25 s | 503 `STREAM_CAPACITY` (20 flux par chaîne, 10 par IP, un /64 en IPv6, 500 au total) ; un flux qui laisse plus de 64 Kio non lus est coupé, et le client se reconnecte |
| `GET /v1/health`, `/v1/releases/*` | | inchangées | |

`maxDocBytes` est la taille maximale du **clair** d'un document : un bloc est accepté jusqu'à `maxDocBytes + 29` octets. `ENVELOPE_INVALID` couvre un bloc de moins de 29 octets, une version différente de 1, et un bloc qui ressemble à du clair (partie chiffrée de 32 octets ou plus qui se lit en UTF-8 valide, ou entropie inférieure à 7,5 bits par octet sur un bloc d'au moins 1 Kio) : garde-fou contre un client bogué, pas une preuve.

Toutes les routes de l'ancienne version (`/v1/auth/*`, `/v1/sync/*`, `/v1/licenses/*`, `/v1/webhooks/*`, `/v1/chat/*`, `/v1/tts/*`, `/v1/reader/*`) répondent 404. Une ancienne app lit le manifeste en premier : elle s'arrête en erreur avant toute action, sans rien effacer.

### 5.3 Vérification

`GET /v1/chain/verify` (pour l'appareil, avec la preuve) et `node scripts/verifier-chaine.js --chain <id> | --all [--recount]` (sur le serveur, sortie JSON `{ chaines, problemes, fantomes, rapports }`, code de sortie 0 si tout va bien, 1 s'il reste un problème, 2 pour une erreur d'usage ou une chaîne inconnue) contrôlent : chaque bloc vivant existe, a la bonne taille, la bonne empreinte, commence par `0x01`, ne ressemble pas à du clair ; aucun fichier orphelin ; compteurs égaux à la somme des lignes ; avec `--all`, aucun dossier de casier sans ligne en base (fantôme). `--recount` recalcule les compteurs et supprime orphelins et fantômes ; à lancer API arrêtée.

## 6. Synchronisation côté client

### 6.1 Base locale

`<vault>/.lector-sync/chaine.json` :

```json
{
  "version": 2,
  "chainId": "2149...",
  "docs": { "Pro/Notes.md": { "docId": "99e9...", "sha256Clair": "47dd...", "sha256Bloc": "ded3...", "size": 7, "mtime": "..." } }
}
```

Deux empreintes : celle du clair (comparée au disque) et celle du bloc (comparée au manifeste). Rien de dérivé du clair ne part au serveur. Champ facultatif `horsDisque: true` : document du casier gardé sans fichier sur ce disque, parce qu'un fichier local occupe déjà son nom à la casse près (§ 6.2) ; il n'est jamais supprimé depuis cet appareil. Une base d'une autre version (dont la `version: 1` de la branche avec compte) est ignorée et reconstruite : la synchro suivante se comporte comme une adoption (§ 6.3), sans rien supprimer.

### 6.2 Trois voies (`synchroniserChaine`, `front/src/services/chaine/synchro.js`)

- Index local par chemin, index serveur par `docId`. Le lien vient de `HMAC(K_mac, chemin)` (mis en cache dans la base) ou, pour un `docId` inconnu, du déchiffrement de `pathEnc`.
- `localModifie = L.sha256 ≠ B.sha256Clair` ; `serveurModifie = S.sha256 ≠ B.sha256Bloc`.
- Décisions : envoi, téléchargement, suppression sur le serveur, retrait local, résurrection, conflit. Si les deux côtés ont changé, le bloc est téléchargé ; clair identique : pas de conflit ; sinon la version locale reste et celle du serveur devient une copie `nom (conflict AAAA-MM-JJ-HH-MM).md`, envoyée elle aussi.
- Chaque dépôt porte `If-Match` (empreinte du bloc que l'appareil croit remplacer) ou `If-None-Match: *`, et chaque `DELETE` porte `If-Match` quand l'empreinte est connue. Un 412 relance un cycle au lieu d'écraser : le dernier qui écrit ne gagne pas en silence.
- Toute écriture ou tout retrait local vérifie que le fichier est encore celui du scan. Sinon le vault ne touche à rien (`ECHANGED`), le cycle est relancé, puis la version du serveur devient une copie de conflit si les deux ont changé.
- Un fichier que le scan n'a pas vu mais que le disque a encore à ce nom (absence fausse) ne donne jamais de pierre tombale.
- Les chemins que le vault refuse (`EINVALIDPATH` : nom invalide ou réservé) et les liens symboliques (`ESYMLINK` : jamais suivis, et jamais d'écriture hors du vault une fois le chemin résolu par `realpath`) sont sautés, comme un fichier verrouillé ; ces documents sont comptés (`notWritten`) et l'écran Synchronisation les annonce.
- Un bloc vivant au manifeste mais absent au `GET` (404) est signalé, sans relance.
- Disques insensibles à la casse (macOS, Windows par défaut) : un renommage qui ne change que la casse reste le même document (le chemin de la base est gardé), sans envoi ni suppression. Un document du casier dont le nom ne diffère que par la casse d'un fichier local n'écrase jamais ce fichier : copie de conflit si les contenus diffèrent, et la base le retient en `horsDisque`.
- Un document supprimé ailleurs n'est retiré du disque que si le local est inchangé **et** que `tombEnc` se vérifie pour ce `docId` et l'empreinte de bloc de la base. Sinon il est renvoyé. Le serveur ne peut donc pas faire effacer un fichier en posant une fausse pierre tombale.
- Un bloc ou un chemin qui ne se déchiffre pas : rien n'est touché localement, l'indicateur de synchro le signale.
- Ordre d'un cycle : retraits locaux (un document renommé ailleurs libère son nom), téléchargements, suppressions (elles libèrent de la place), envois, comparaisons.

### 6.3 Adoption

Un appareil qui rejoint une chaîne avec un vault déjà rempli (ou après une nouvelle chaîne) n'a pas de base pour ce casier. Pour un document présent des deux côtés, il télécharge le bloc : même clair, la base est enregistrée ; seul le local a bougé depuis la base de la chaîne précédente, il part ; seul le serveur a bougé, il est pris ; sinon, copie de conflit. Les fichiers présents d'un seul côté sont envoyés ou téléchargés, avec la règle de casse du § 6.2. **Rien n'est supprimé pendant l'adoption.**

### 6.4 Ordinateur (Electron)

La synchro tourne dans le processus principal (`front/desktop/sync-manager.js`) : au démarrage, à chaque changement d'un fichier markdown du vault, toutes les 30 s, et dès qu'un autre appareil annonce une écriture dans le flux (`GET /v1/chain/stream`, lu par `fetch` avec les en-têtes ; ses propres échos sont filtrés par `actorDevice`). Une réponse `CHAIN_UNKNOWN` ou `CHAIN_PROOF_INVALID` arrête la boucle (`chain-unknown`, `chain-proof`) sans rien toucher au disque. Un cycle à relancer (412, fichier changé pendant le cycle) repart après 1 s, puis 2 s, 4 s... jusqu'à 30 s. `stop()` interrompt le cycle avant sa prochaine écriture et l'attend (5 s au plus) ; après `stop()`, rien ne repart, et un `stop()` pendant `start()` laisse la synchro arrêtée. `getStatus()` donne aussi `notWritten`, le nombre de documents que le disque refuse (§ 6.2). Lector écrit `LECTOR-FORMATS.md` à la racine du vault ; il voyage comme les autres documents.

### 6.5 Navigateur et mobile

Pas de vault local : `fileSystem.listDirectoryFiles('cloud://')` lit le manifeste et déchiffre les `pathEnc` pour construire l'arbre ; `openFileByPath` télécharge puis déchiffre ; `writeFile` chiffre puis dépose avec `If-Match` = empreinte du bloc **lu** par cette session (`VaultWebChaine`, une instance par session). Un document modifié ailleurs après sa lecture donne 412, jamais un écrasement. L'app iOS et Android (Capacitor) utilise le même module que le navigateur. Le web n'écoute pas le flux temps réel : il relit le manifeste chaque fois que l'arbre est rechargé.

## 7. Markdown seulement, limite par document et quota

**Filtre client, dans les deux sens** (`estMarkdown`) :
- seuls `.md` et `.markdown` (casse indifférente) partent ; un fichier local d'un autre type n'est jamais lu, envoyé ni supprimé (il est compté comme ignoré) ;
- les fichiers et dossiers cachés (`.lector-sync/`, `.obsidian/`, tout ce qui commence par `.`) sont ignorés ;
- un bloc dont le chemin déchiffré n'est pas markdown (déposé par un client bogué) n'est **jamais écrit** sur le disque, ni supprimé : il est signalé (`notMarkdown`) et la vérification de l'appareil le compte (`horsFormat`) ;
- sur le web, écrire un fichier d'un autre type est refusé avant tout envoi (`NOT_MARKDOWN`).

Le serveur ne peut pas faire ce contrôle : chemins et contenus sont chiffrés. Ses seules gardes sont la taille d'un bloc et le quota.

**Limite par document** : un fichier de plus de `maxDocBytes` octets (512 Ko par défaut) n'est pas envoyé et n'entraîne aucune requête refusée ; il est signalé (`tooLarge`) et reste sur l'appareil.

**Quota** : le client lit la place libre dans le manifeste et n'envoie pas ce qui serait refusé. Casier plein : les documents en attente sont comptés (`quotaPending`), un seul événement `quota` est émis à l'entrée dans cet état, la synchro continue pour le reste (téléchargements, suppressions). Si le serveur répond quand même 413 (un autre appareil a pris la place entre-temps), le cycle cesse d'envoyer et se termine normalement : ce n'est jamais une erreur fatale, rien n'est supprimé localement. Une suppression rend la place ; les documents en attente partent au cycle suivant.

À la création, l'écran montre avant l'envoi le nombre de fichiers markdown et la taille des blocs ; l'envoi est partiel si la place manque, la chaîne est créée quand même.

## 8. Écrans

Un seul écran, **Synchronisation** (`ChaineSync.jsx`), textes `sync.*` et codes `cloud.chain.err.*` en anglais et en français. Chaque vue a une explication courte, un « Pourquoi ? » et un lien « Détails techniques » vers ce document, publié par le site de Lector (https://lector.sidali.dev/sync/, page `front/landing/sync/index.html` produite par `node tools/page-sync.mjs`).

| Vue | Contenu |
|---|---|
| Proposer | « Protéger et synchroniser » (créer) ou « Rejoindre ». Jamais bloquant. |
| 12 mots | Grille numérotée, avertissement de perte, formulaire du gestionnaire de mots de passe (§ 9), kit de secours à imprimer, case « Je les ai notés ». Sur le web : ce navigateur ne les montrera plus. Pas de bouton copier. |
| Vérification | Trois mots demandés au hasard. « Vérifier plus tard » est possible : un rappel discret reste dans l'état tant que les mots ne sont pas confirmés. |
| Progression (ordinateur) | Estimation (fichiers, taille, place du casier), puis barre d'envoi. |
| Rejoindre | Onglets « Scanner » (si `BarcodeDetector` et une caméra sont disponibles) et « 12 mots » (champ masqué `autocomplete="current-password"`), bouton « Depuis mon gestionnaire de mots de passe » quand le navigateur sait le faire. Erreurs distinctes : mots invalides (mot inconnu, somme fausse, nombre de mots) et « aucune chaîne ne correspond à ces mots » (404). Jamais de création depuis cet écran. |
| État | Place utilisée et nombre de documents, état de la synchro (documents trop gros, casier plein, blocs illisibles ou d'un autre type, documents que le disque refuse), rappel de sauvegarde. Ordinateur : dossier du vault, « Ajouter un appareil », « Nouvelle chaîne », « Vérifier ». Partout : « Quitter la chaîne sur cet appareil », « Tout effacer ». |
| Ajouter un appareil (ordinateur) | Derrière le verrou (Touch ID, 5 min ; sans Touch ID, confirmation, 60 s) : QR du code et 12 mots, masqués après 60 s. L'explication dit qui peut scanner le QR (§ 3.6). |
| Opération coupée | Création ou renouvellement interrompu : reprendre ou abandonner. Un renouvellement refusé par `ROTATION_INCOMPLETE` (§ 11.1) liste les documents en cause. |
| Chaîne inconnue | « Cette chaîne n'existe plus : renouvelée ou effacée depuis un autre appareil. » Rejoindre avec les nouveaux mots ; sur ordinateur, créer une chaîne depuis ce vault. |
| Nouvelle chaîne | § 11, avec ce que ça garantit et ne garantit pas. Derrière le verrou : tirer les nouveaux mots et lancer le renouvellement. |
| Tout effacer | Il faut taper le mot affiché (`ERASE` ou `EFFACER`) ; sur ordinateur, verrou ouvert, et une case décochée par défaut « Also move my local folder to the Trash ». Sur le web et le mobile, l'explication dit que le casier est peut-être la seule copie des documents sur cet appareil, et que l'appareil oublie aussi ce que Lector y gardait (historique, favoris, réglages). Détail au § 11.2. |

**Kit de secours** (`KitSecours.jsx`, `window.print`, sans dépendance) : les 12 mots numérotés, le QR du code, et une page « Pour un proche » (où est la clé, quelle app, comment récupérer et lire les documents, adresse de ce document sur le site de Lector).

**Médias** : sur l'appareil qui a le fichier, les images relatives s'affichent ; ailleurs, un encart « Image non synchronisée : seul le markdown voyage entre les appareils ».

## 9. Gestionnaire de mots de passe

- **Web et mobile, enregistrer** : `navigator.credentials.store(new PasswordCredential({ id: 'lector-sync-chain', name: 'Lector sync chain', password: <12 mots> }))` quand le navigateur l'offre (Chromium), **et** un vrai `<form>` soumis par `requestSubmit()` avec `<input name="username" id="lector-sync-chain" autocomplete="username" value="lector-sync-chain">` et `<input type="password" autocomplete="new-password" value="<12 mots>">`, pour les extensions (Proton Pass, Bitwarden) et Safari. Si rien n'est proposé, l'écran explique comment créer l'entrée à la main (nom `lector-sync-chain`, les 12 mots séparés par des espaces).
- **Web et mobile, rejoindre** : `navigator.credentials.get({ password: true, mediation: 'optional' })`, et le champ `autocomplete="current-password"` que le gestionnaire sait remplir.
- **Ordinateur** : pas de `PasswordCredential` dans Electron. Le QR, les 12 mots derrière le verrou et le kit de secours ; l'entrée se crée à la main dans le gestionnaire.
- Jamais de presse-papiers.

## 10. Stockage local du secret

| Plateforme | Secret de chaîne |
|---|---|
| Ordinateur (Electron) | `S` en hex dans `userData/cloud-secrets.dat` (`{ vaultPath, serverUrl, deviceId, chainSecret, chainId, chainPendingSecret, chainSaved }`), chiffré par `safeStorage` (Trousseau macOS, DPAPI, libsecret). Sans chiffrement système (Linux sans trousseau) : JSON en mode 0600 et avertissement dans l'écran. Le renderer ne reçoit jamais `S` : seulement `hasChain`, et les mots pour affichage, à la création ou verrou ouvert. Nouvelle chaîne (mots et lancement) et Tout effacer exigent aussi le verrou ouvert (`LOCKED` sinon) : un script qui tournerait dans le renderer ne peut ni faire passer la chaîne sur des mots qu'il connaît, ni effacer le casier, sans Touch ID là où il existe. |
| Navigateur, iOS, Android | IndexedDB `lector-chaine` : `{ version, chainId, preuve, cleEnc, cleMac }`, clés `CryptoKey` non exportables ; `S` est effacé de la mémoire après `preparer`. Un script qui s'exécuterait sur la page pourrait utiliser les clés sur place, pas emporter `S`. La preuve est lisible (il faut l'envoyer) : elle permet d'écrire ou d'effacer, pas de lire. |

Les anciennes données locales de la version avec compte (jeton, licence, identifiants d'appareil, entrée IndexedDB liée à un compte) sont effacées au premier démarrage de la 2.0. Le vault reste.

Lector 2.2 n'a plus de clés API (assistant et lecture à voix haute retirés). Au démarrage, il efface celles qu'une ancienne version a laissées : `userData/api-keys.dat` sur ordinateur (`front/desktop/cloud-store.js`), la base IndexedDB `lector-keys` sur le web et le mobile, avec les données par document des fonctions retirées dans le stockage de la page (fiches, quiz, surlignages, étiquettes, réponses en cache, conversations, activité ; `front/src/services/nettoyage.js`).

## 11. Nouvelle chaîne, tout effacer, quitter

### 11.1 Nouvelle chaîne (rotation côté client)

À faire quand un appareil est perdu ou volé, ou qu'on n'a plus confiance dans quelqu'un qui a vu les 12 mots. Disponible sur ordinateur (appareil qui a tout le vault), verrou ouvert. `renouvelerChaine` :

1. tire un nouveau `S'` et affiche ses 12 mots ;
2. synchronise avec l'ancien casier jusqu'à un cycle sans changement ;
3. crée le nouveau casier (`POST /v1/chain`) et y envoie tout le vault, rechiffré : tous les `docId` changent ;
4. relit le manifeste de l'ancien casier : si un autre appareil y a écrit entre-temps, récupère et renvoie, jusqu'à stabilité (5 passes au plus, sinon `ROTATION_UNSTABLE`) ;
5. efface l'ancien casier (`DELETE /v1/chain`), seulement si le nouveau a tout reçu et que chaque document markdown du dernier manifeste de l'ancien est dans le nouveau casier ou sur le disque. Sinon 409 `ROTATION_INCOMPLETE { missing: [chemins] }` : rien n'est effacé, le secret reste en attente et l'écran liste ces documents (les corriger ou les retirer, puis reprendre, ou abandonner). Les blocs illisibles ou absents du serveur ne bloquent pas. Faute de place, le nouveau casier est retiré et l'ancien reste la chaîne.

Création et reprise (`envoyerTout`) : un bloc du casier inconnu de la base n'est ni supprimé ni écrasé. Même clair, il est gardé ; sinon la synchro suivante en fait une copie de conflit.

`S'` est gardé « en attente » (`chainPendingSecret`) pendant l'opération : une coupure se reprend, ou s'abandonne (le casier en cours est effacé ; si l'ancien n'existe déjà plus, le nouveau devient la chaîne). Les autres appareils reçoivent 404 `CHAIN_UNKNOWN`, s'arrêtent sans rien effacer, et rejoignent avec les nouveaux mots (adoption, § 6.3).

**Garantit** : les anciens mots n'ouvrent plus rien (l'ancien casier est effacé du serveur) ; les nouveaux `docId` ne se relient pas aux anciens. **Ne garantit pas** : ce qu'un ancien appareil a déjà sur son disque ; les sauvegardes du serveur antérieures, qui gardent les anciens blocs, lisibles avec l'ancienne clé, jusqu'à 30 jours sur le serveur et jusqu'à 6 mois dans les archives mensuelles ; l'effacement physique des blocs sur le disque du serveur ; un appareil espionné pendant qu'il était dans la chaîne.

### 11.2 Tout effacer

Depuis n'importe quel appareil qui a la chaîne (`DELETE /v1/chain`, sur ordinateur verrou ouvert) : la ligne du casier d'abord, qui emporte ses documents (tout dépôt en vol échoue), puis le dossier ; les flux ouverts sont fermés, un lecteur qui n'a pas tout lu est coupé net, les autres appareils reçoivent 404 et s'arrêtent. Les sauvegardes du serveur gardent les blocs chiffrés jusqu'à 30 jours, et jusqu'à 6 mois dans les archives mensuelles. Recréer ensuite une chaîne, même avec le même `S`, est possible.

Ce qui est effacé, et où, une fois le casier effacé (ou déjà inconnu du serveur) :

| Où | Effacé | Gardé |
|---|---|---|
| Serveur | Ligne `Chain`, lignes `ChainDoc`, dossier des blocs du casier. | Sauvegardes chiffrées (30 jours, archives mensuelles 6 mois). |
| Ordinateur (Electron), dans l'ordre | 1. `S` et les champs de chaîne de `userData/cloud-secrets.dat` (`chainSecret`, `chainId`, `chainPendingSecret`, `chainSaved`) ; 2. la base de synchro du vault. 3. Seulement si la case « Also move my local folder to the Trash » est cochée (décochée par défaut) : le dossier du vault part à la **corbeille du système** (`shell.trashItem`, jamais de suppression définitive ; refusé pour la racine, le dossier personnel et `userData`), `vaultPath` est retiré, puis la page vide son propre stockage (comme le web, ligne suivante) et repart sur le choix de la source. | Sans la case : le dossier du vault et ses fichiers, intacts, ainsi que le stockage de la page (historique, favoris, réglages, session). Si la corbeille refuse, tout le reste est effacé, le dossier reste le vault et l'écran le dit. Les vaults des autres ordinateurs ne sont jamais touchés. |
| Navigateur, iOS, Android (vue web) | Tout le stockage de l'origine, par `effacerDonneesLocales` (`front/src/services/effacementLocal.js`) : IndexedDB `lector-chaine` (clés de la chaîne) et `lector-keys` (clés API d'une ancienne version, déjà effacées au démarrage), toute autre base IndexedDB de l'origine, `localStorage` en entier (positions de lecture, historique, favoris, réglages, session, identifiant d'appareil, `lector-sync-saved`), `sessionStorage`, Cache Storage et service workers. La page se recharge ensuite sur le choix de la source. | Rien de Lector dans la vue web. Hors de la vue web, sur mobile : les fichiers natifs éventuels de l'app (non couverts par cette version). |

Le web et le mobile n'ont pas de vault local (§ 6.5) : le casier y est peut-être la seule copie des documents, et l'écran le dit. L'effacement réel des documents en clair restés sur un ordinateur (crypto-shredding) attend le chiffrement local, hors périmètre de la 2.0.

### 11.3 Quitter sur cet appareil

`S` (ou les clés, sur le web) est oublié et la synchro s'arrête. Le casier et les autres appareils ne changent pas ; la base locale est gardée pour une adoption plus tard.

### 11.4 `S` perdu partout

Si plus aucun appareil ne garde `S` et que la fiche est perdue, les blocs sont illisibles pour tout le monde, définitivement, et le casier ne peut plus être effacé par l'utilisateur (il faudrait `P`). La purge des casiers inactifs le supprime au bout de 180 jours (§ 14). Un appareil qui a encore le vault en clair crée une nouvelle chaîne.

## 12. Limites assumées

- Le serveur peut **cacher** un document, **resservir une ancienne version** d'un bloc ou refuser une écriture. Il ne peut ni lire, ni fabriquer, ni modifier un bloc sans que le client le détecte (AES-GCM authentifié), ni déplacer un bloc d'un document à un autre (AAD), ni faire supprimer un fichier local (marque `tombEnc`, § 6.2). Un manifeste authentifié contre le retour en arrière n'existe pas encore.
- Le `docId` étant stable, le serveur sait que « le même document » a été modifié dix fois, sans savoir lequel. La taille des blocs et des `pathEnc` n'est pas masquée.
- Qui obtient `P` (sans `S`) peut écrire, supprimer ou effacer le casier, pas le lire. Les clients détectent un bloc ou une marque fabriqués.
- Le web garde des clés utilisables sur place par un script de la page (pas exportables).
- Les sauvegardes du serveur gardent les blocs (chiffrés) et les métadonnées du § 2 jusqu'à 30 jours sur le serveur, et jusqu'à 6 mois dans les archives mensuelles, hors de la machine. La politique de confidentialité le dit.
- Les journaux d'accès du proxy gardent l'IP et le chemin des requêtes (des `docId`, jamais la preuve ni l'`id`) 7 jours au plus.
- Un appareil compromis lit tout ce qu'il voit passer.

## 13. Anti-abus

Sans compte, les seules défenses hors quota sont en mémoire, par IP (`back/services/limiteurs.js`) :
- **créations** : 5 casiers par IP et par heure (`CHAIN_CREATE_PER_HOUR`), 429 `CHAIN_CREATE_LIMITED` ; une reprise idempotente (même `id`, même preuve) passe toujours. Les créations passent une à une : la limite par IP et `CHAIN_MAX_CHAINS` sont exactes même en rafale ;
- **preuves fausses** : 10 par 15 minutes par couple (IP, chaîne), puis 429 `CHAIN_PROOF_LIMITED` pour ce couple seulement. Jamais de blocage par chaîne seule : sinon n'importe qui connaissant un `id` gèlerait la synchro de son propriétaire. La bonne preuve passe toujours (`P` fait 256 bits, la force brute est exclue) ;
- **capacité** : `CHAIN_MAX_CHAINS` casiers au total (10 000 par défaut), puis 503 `CHAIN_CAPACITY` ; 20 flux par chaîne, 10 par IP et 500 au total, puis 503 `STREAM_CAPACITY` ; un flux qui laisse plus de 64 Kio non lus est coupé ; au plus `CHAIN_MAX_DOCS` pierres tombales par casier ;
- toutes les limites par IP prennent le /64 pour une adresse IPv6 (un seul abonné en a souvent des milliards) ;
- `trust proxy 1` : derrière le proxy, l'IP vient de `X-Forwarded-For`, sinon les limiteurs deviendraient globaux ;
- **réseaux lecteurs** : au plus 8 réseaux distincts lisent une chaîne en 24 heures (§ 13.1) ;
- `CHAIN_RATE_LIMITS=off` les désactive (tests seulement).

### 13.1 Limite anti-partage

Une chaîne sert aux appareils d'une même personne. Pour qu'elle ne devienne pas un casier de partage entre inconnus (les 12 mots postés quelque part), le serveur compte, pour chaque chaîne, les **réseaux distincts qui lisent** sur une fenêtre glissante de 24 heures (`back/services/reseauxLecteurs.js`) :
- un réseau est le préfixe de l'adresse : /24 en IPv4 (adresses `::ffff:a.b.c.d` comprises), /48 en IPv6 ;
- le préfixe n'est gardé que sous forme d'empreinte HMAC-SHA256 avec un **sel aléatoire tiré au démarrage et remplacé toutes les 24 heures** ; l'ancien sel reste 24 heures de plus pour reconnaître un réseau vu juste avant la rotation, puis il est oublié et plus aucune empreinte ne se relie à un réseau ;
- tout vit dans une `Map` du processus : **jamais sur le disque, jamais dans les journaux**, tout disparaît au redémarrage. Au plus 20 empreintes par chaîne (avec la date de leur dernière lecture) ;
- seules les requêtes `GET` (état, manifeste, blocs, flux) **à la bonne preuve** comptent : sans `P`, personne ne peut user le budget d'une chaîne et bloquer son propriétaire ;
- un réseau sort du compte 24 heures après sa dernière lecture ;
- au-delà de **8 réseaux distincts** (`CHAIN_READ_NETWORKS_MAX`), une lecture depuis un **nouveau** réseau répond **429** `CHAIN_READ_LIMITED` avec `Retry-After` (le temps avant que le plus ancien réseau sorte du compte) ; les réseaux déjà vus continuent, les écritures ne sont pas concernées. Le journal note une fois par jour et par chaîne `[chain <8 hex>] read refused: too many networks today`, sans adresse ;
- l'effacement du casier oublie ses empreintes.

Un usage normal en reste très loin : un ordinateur à la maison, un téléphone qui change d'adresse en 4G ou 5G (souvent dans quelques /24 de l'opérateur), le Wi-Fi d'un lieu de travail, un hôtel. Les clients affichent un message en clair (« This chain was opened from too many different networks today, so new ones are paused for now… »), jamais le code ; dans le navigateur, l'écran de la chaîne s'ouvre pour l'expliquer, sans rien oublier.

`CHAIN_READ_NETWORKS_WINDOW_MS` (86400000) règle la durée de la fenêtre et de la rotation du sel ; seuls les tests la raccourcissent.

Variables du serveur : `DATABASE_URL`, `PORT`, `CHAIN_FILES_ROOT`, `CHAIN_QUOTA_BYTES` (20971520), `CHAIN_MAX_DOC_BYTES` (524288), `CHAIN_MAX_DOCS` (5000), `CHAIN_MAX_CHAINS` (10000), `CHAIN_INACTIVE_DAYS` (180), `CHAIN_CREATE_PER_HOUR` (5), `CHAIN_READ_NETWORKS_MAX` (8), `CHAIN_READ_NETWORKS_WINDOW_MS` (86400000), `CHAIN_RATE_LIMITS`, `RELEASE_NOTIFY_TOKEN`. Exemple : `back/.env.example`.

## 14. Purge des orphelins

La purge tourne au démarrage de l'API puis toutes les 24 heures (`back/services/casiers.js`) :
- les pierres tombales de plus de 30 jours sont supprimées (ligne) ;
- les casiers sans aucune requête depuis 180 jours, environ 6 mois (`CHAIN_INACTIVE_DAYS`, `lastSeenAt`, écrit au plus une fois par heure par une requête authentifiée) sont effacés entièrement, lignes et dossier ; `lastSeenAt` est revérifié au moment de la suppression, et un casier redevenu actif entre-temps reste ;
- les dossiers de casier sans ligne en base (fantômes) sont supprimés.

C'est le sort des casiers dont tous les appareils et la fiche ont disparu (§ 11.4). Un appareil qui synchronise même une fois tous les six mois garde son casier. `verifier-chaine.js --all` signale aussi les fantômes et les fichiers sans ligne (orphelins, après un arrêt brutal entre l'écriture du bloc et celle de la ligne) ; `--recount` les supprime.

## 15. Modèle de menace en 10 lignes

1. Le serveur, son hébergeur et un intrus sur la machine ne lisent ni contenus, ni chemins, ni titres : ils n'ont que des blocs AES-256-GCM.
2. Ils voient des métadonnées : nombre et taille des blocs, dates, rythme, IP au passage (§ 2).
3. Ils peuvent cacher, refuser ou resservir un ancien bloc ; pas fabriquer, modifier, déplacer, ni faire effacer un fichier local.
4. Qui a les 12 mots ou le QR a tout : ils se gardent comme une clé de coffre, jamais en photo ni dans un message.
5. Qui a seulement la preuve peut abîmer le casier, pas le lire ; les appareils gardent leurs fichiers.
6. Qui connaît seulement l'`id` apprend si le casier existe (404 ou 403), rien d'autre, pas même sa taille ; ses fausses preuves ne bloquent pas le propriétaire.
7. Un appareil perdu se coupe par « Nouvelle chaîne » ; ce qu'il a déjà sur son disque reste lisible par qui le tient.
8. Les sauvegardes du serveur gardent les anciens blocs jusqu'à 6 mois, lisibles avec l'ancienne clé.
9. Sur le web, un script hostile dans la page pourrait utiliser les clés sur place ; il ne peut pas emporter `S`. La politique de sécurité du contenu et l'assainissement des documents le rendent improbable (`docs/SECURITE.md`).
10. Les mots perdus partout, le casier est perdu pour tout le monde, et purgé après 180 jours sans activité.

## 16. Tests

Suites, commandes et résultats : `docs/CHAINE-TESTS.md`.
