# Bascule de production vers Lector 2.0

Plan à suivre à la main, dans l'ordre. Aucune de ces commandes n'a été lancée pendant la préparation de la 2.0.

Ce qui change sur le serveur : l'API sans compte (`docs/CHAINE.md`) repart d'une base neuve. Comptes, licences et vault en clair (`/data/users`) disparaissent du serveur. Les documents ne sont jamais en danger : ils sont sur le disque du Mac, dans la copie de l'étape 0, dans l'archive de l'étape 2 et dans les sauvegardes automatiques.

## Règles

- **Jamais** `docker compose down -v`, `docker volume rm lector_lector-data`, ni renommer le projet `lector` ou le volume : un nouveau nom donnerait un volume vide.
- **Supprimer `/data/lector.db` avant de démarrer le nouveau conteneur.** Il applique le schéma au démarrage (`prisma db push`) ; sur l'ancienne base, qui contient encore des tables non vides, il refuse (perte de données) et redémarre en boucle.
- `deploy/deploy.sh` est une release complète (desktop notarisé, bundle iOS, landing, API, web) : pas avant l'étape 3, et pas nécessaire pour cette bascule.
- Retour arrière possible tant que les clients 2.0 ne sont pas publiés (étapes 6 et 7) : voir la fin du document.

## 0. Sur le Mac, avant de toucher au serveur

1. Branche fusionnée et tests verts :
   ```bash
   npm run test:chaine && npm run test:api && npm run test:flows && npm run build
   ```
2. **Quitter Lector** sur le Mac et sur tout autre ordinateur qui synchronise : l'ancienne version enverrait des fichiers en clair pendant la bascule.
3. Construire et installer la 2.0 sur le Mac, **sans la publier** (elle ne sera ouverte qu'à l'étape 5) :
   ```bash
   npm run install-app          # DMG, ZIP et latest-mac.yml dans release/, app installée dans /Applications
   npm run dist:win             # seulement si des PC Windows suivent
   ```
   La 2.0 ne publie que macOS (`deploy.sh`, étape 6). La landing ne propose plus que le DMG et l'app web : Windows et Linux passent par le navigateur tant qu'aucun installeur 2.0 n'est publié (étape 6).
4. Copie du vault :
   ```bash
   tar czf ~/lector-vault-avant-bascule-$(date +%F).tgz -C ~ lector-vault
   ```
5. Ce que la chaîne devra contenir (markdown visible seulement ; environ 817 fichiers et 11 Mo au 23/10/2026) :
   ```bash
   find ~/lector-vault -name '*.md' -not -path '*/.*' | wc -l
   find ~/lector-vault -name '*.md' -not -path '*/.*' -exec cat {} + | wc -c
   ```

## 1. Serveur : arrêter l'API

```bash
ssh sid@dockerbop.fr
cd /home/sid/apps/lector
docker compose stop lector-api
```

La landing continue de servir le DMG, `latest-mac.yml`, `latest-ios.json` et le bundle iOS : la mise à jour automatique ne voit rien. Seule la synchro est coupée.

## 2. Serveur : sauvegarde explicite, puis suppression de l'ancien monde

1. Archive du volume, hors de la rotation des sauvegardes automatiques :
   ```bash
   F=lector-data-avant-gratuit-$(date +%F).tar.gz
   docker run --rm -e F="$F" -e PROPRIETAIRE="$(id -u):$(id -g)" \
     -v lector_lector-data:/source:ro -v /home/sid/backups:/backup alpine \
     sh -c 'umask 077 && tar czf "/backup/$F" -C /source . && chown "$PROPRIETAIRE" "/backup/$F"'
   ls -lh "/home/sid/backups/$F"            # -rw------- sid sid
   tar tzf "/home/sid/backups/$F" | head -20
   ```
   Le conteneur tourne en root : l'archive naît en 600 (`umask 077`) et il la donne ensuite à `sid`. Un `chmod` lancé par `sid` sur un fichier de root échouerait (« Operation not permitted »).
   Elle contient le vault en clair, les e-mails et les licences : à traiter comme une donnée sensible (étape 8.6).
2. Inventaire :
   ```bash
   docker run --rm -v lector_lector-data:/data:ro alpine sh -c 'ls -la /data; du -sh /data/users /data/chain 2>/dev/null'
   ```
   Attendu : `lector.db` (et parfois `lector.db-journal`), `users/` (environ 521 Mo en clair), d'anciennes copies `.bak` de la base, peut-être `chain/` vide.
3. Suppression (seulement si l'archive de l'étape 2.1 est complète) :
   ```bash
   docker run --rm -v lector_lector-data:/data alpine sh -c \
     'rm -f /data/lector.db /data/lector.db-journal /data/*.bak*; rm -rf /data/users /data/chain; ls -la /data'
   ```
   Attendu : `/data` vide. Le nouveau serveur crée `lector.db` et `chain/`.
4. Propriétaire du volume :
   ```bash
   docker run --rm -v lector_lector-data:/data alpine sh -c 'chown -R 1000:1000 /data && ls -lnd /data'
   ```
   Attendu : `/data` à `1000 1000`. L'image 2.0 tourne en utilisateur `node` (uid et gid 1000 dans `node:20-alpine`), avec un système de fichiers en lecture seule hors du volume et de `/tmp`. Le volume a été créé par l'image 1.x, en root : sans ce `chown`, `prisma db push` ne peut pas créer `lector.db` et le conteneur redémarre en boucle (« unable to open database file » ou « readonly database »). Un volume neuf prend déjà `node:node`.

## 3. Serveur : nouveau code

1. **Fichier `.env` du serveur** (`/home/sid/apps/lector/.env`) : noter les clés à révoquer (étape 8.1), puis retirer `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `RESEND_API_KEY`, `ELEVENLABS_API_KEY`, `ANTHROPIC_API_KEY`, `JWT_SECRET`, `USER_FILES_ROOT`. Garder `RELEASE_NOTIFY_TOKEN`. Les limites (`CHAIN_QUOTA_BYTES`, `CHAIN_MAX_DOC_BYTES`, `CHAIN_MAX_DOCS`, `CHAIN_MAX_CHAINS`, `CHAIN_CREATE_PER_HOUR`) ont des valeurs par défaut dans `deploy/docker-compose.yml`.
2. **Code** : `git pull` si `/home/sid/apps/lector` est un clone du dépôt ; sinon, depuis le Mac, la copie que fait `deploy.sh` :
   ```bash
   rsync -a --delete --exclude='node_modules' --exclude='*.db' --exclude='*.db-journal' \
     --exclude='.env' --exclude='.test-data' --exclude='dev-chain' \
     back/ sid@dockerbop.fr:/home/sid/apps/lector/server/
   ```
   Vérifier que le `docker-compose.yml` du serveur a le même service `lector-api` que `deploy/docker-compose.yml` : contexte de build vers le code du back, `DATABASE_URL=file:/data/lector.db`, `CHAIN_FILES_ROOT=/data/chain`, les variables `CHAIN_*`, `RELEASE_NOTIFY_TOKEN` (absent jusqu'ici : sans lui, `POST /v1/releases/notify` répond 503), le volume `lector-data:/data`, plus aucune variable de l'ancienne version, et les clés de durcissement : `init: true`, `read_only: true`, `tmpfs: [/tmp]`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit: 512m`, `pids_limit: 200`.
3. **Démarrer** :
   ```bash
   docker compose up -d --build lector-api
   docker compose logs -f lector-api     # schéma créé sur la base neuve, puis « [Lector API] http://localhost:3456 »
   docker compose ps                     # lector-api (healthy)
   ```
4. **Vérifier depuis le Mac** :
   ```bash
   curl -s https://lector.dockerbop.fr/v1/health                                   # {"ok":true}
   curl -s https://lector.dockerbop.fr/v1/chain/manifest                           # 400 CHAIN_ID_INVALID
   curl -s -o /dev/null -w 'sync/manifest %{http_code}\n' https://lector.dockerbop.fr/v1/sync/manifest   # 404
   for r in auth/login licenses/activate webhooks/stripe chat/ask tts/synthesize reader/send-to-kindle; do
     curl -s -o /dev/null -w "$r %{http_code}\n" -X POST "https://lector.dockerbop.fr/v1/$r"               # 404 partout
   done
   curl -sI https://lector.dockerbop.fr/releases/latest-mac.yml | head -1         # 200
   curl -s https://lector.dockerbop.fr/api/latest-ios.json | head -c 200           # version et signature
   ```
   Les versions 1.x encore installées reçoivent 404 sur leurs anciennes routes : leur synchro lit le manifeste en premier et s'arrête en erreur avant toute action, sans rien effacer.

## 4. Web et landing

> **Avant de copier `privacy.html`** : la page (comme `PRIVACY.md`, `docs/THREAT_MODEL.md` et `docs/legal/REGISTRE.md`) décrit l'état actuel du serveur : journal Traefik de toutes les requêtes gardé **7 jours**, copies possibles dans les sauvegardes. Si l'étape 8.4 est faite avant (Traefik : erreurs seulement, sans en-têtes, tourné à 3 jours, dossier des journaux exclu des sauvegardes), mettre à jour ces quatre fichiers pour dire 3 jours, pas avant. Le journal nginx de `lector-landing` (`access_log off;`) et la limite des journaux Docker sont réglés dans le dépôt et partent avec ce déploiement.

L'app web servie sous `/app/` est encore la 1.x (elle appelle des routes qui n'existent plus). Depuis le Mac, après `npm run build` (étape 0) :

```bash
rsync -a --delete --exclude='/formation/' front/dist/ sid@dockerbop.fr:/home/sid/apps/lector/webapp/
scp front/landing/index.html front/landing/privacy.html sid@dockerbop.fr:/home/sid/apps/lector/landing/
rsync -a front/landing/sync sid@dockerbop.fr:/home/sid/apps/lector/landing/
```

Vérifier `https://lector.dockerbop.fr` (plus de prix, section « Your data is yours », boutons « Download for Mac » et « Open in your browser »), `https://lector.dockerbop.fr/privacy` et `https://lector.dockerbop.fr/sync/` (détails techniques, ouverts par l'app et le kit de secours). La landing ne charge plus rien d'un autre site (ni Google Fonts, ni Umami).

Le serveur web : `deploy/nginx.conf` interdit désormais d'afficher `/app/` dans le cadre d'un autre site (`docs/SECURITE.md`). `deploy.sh` ne le copie pas : comparer avec celui du serveur, puis le copier et recharger.
```bash
ssh sid@dockerbop.fr 'cat /home/sid/apps/lector/nginx.conf' | diff - deploy/nginx.conf
scp deploy/nginx.conf sid@dockerbop.fr:/home/sid/apps/lector/nginx.conf
ssh sid@dockerbop.fr 'cd /home/sid/apps/lector && docker compose exec lector-landing nginx -t && docker compose exec lector-landing nginx -s reload'
curl -sI https://lector.dockerbop.fr/app/ | grep -i content-security-policy     # frame-ancestors 'none'
```

## 5. Le Mac : créer la chaîne

1. Ouvrir Lector 2.0. Au premier démarrage, les anciennes données de compte (jeton, identifiants d'appareil, préférences d'envoi) sont effacées ; le dossier du vault est gardé.
2. **Sync**, « Protect and sync », dossier `~/lector-vault`. L'écran annonce le nombre de fichiers markdown et la taille à envoyer : comparer à l'étape 0.5.
3. **Les 12 mots** :
   - les recopier dans **Proton Pass** : nouvelle entrée de type identifiant, nom d'utilisateur `lector-sync-chain`, mot de passe = les 12 mots séparés par des espaces. L'app de bureau ne peut pas la créer elle-même et ne copie jamais les mots : les taper ;
   - **imprimer le kit de secours** (« Print the recovery kit ») et le ranger comme un papier important ;
   - cocher « I saved them », répondre aux trois mots demandés.
4. Laisser l'envoi finir (barre de progression, environ 817 blocs). En fin d'envoi : « Documents encrypted and sent: N ».
5. **Vérifier** :
   - écran Sync : nombre de documents (environ 817) et place utilisée (environ 11 Mo sur 20 Mo) ; bouton « Verify » sans problème ;
   - sur le serveur :
     ```bash
     docker compose exec -T lector-api node scripts/verifier-chaine.js --all
     ```
     Attendu : `"problemes": 0`, `blocs` = le nombre de l'étape 0.5, `octets` environ 11 Mo + 29 octets par bloc, aucun `fantomes`.
6. **Nettoyer le vault** des restes de la version avec compte (chemins en clair, jamais synchronisés désormais) :
   ```bash
   rm -f ~/lector-vault/.lector-sync/manifest.json ~/lector-vault/LECTOR-FORMATS.md.before-recover
   ```

## 6. Les autres ordinateurs : mise à jour desktop

Procédure de release desktop, **pas `deploy.sh`** : publier les fichiers construits à l'étape 0 sous des noms stables, puis prévenir les clients.

```bash
V=2.0.0
scp "release/Lector-$V-universal.dmg" sid@dockerbop.fr:/home/sid/apps/lector/releases/Lector.dmg
scp "release/Lector-$V-universal-mac.zip" sid@dockerbop.fr:/home/sid/apps/lector/releases/Lector.zip
sed 's/Lector-[^ ]*\.zip/Lector.zip/g; s/Lector-[^ ]*\.dmg/Lector.dmg/g' release/latest-mac.yml > /tmp/latest-mac.yml
scp /tmp/latest-mac.yml sid@dockerbop.fr:/home/sid/apps/lector/releases/
# Windows, seulement si l'étape 0.3 l'a construit : « Lector Setup $V.exe » publié en Lector-Setup.exe,
# et latest.yml réécrit de la même façon ; remettre alors le lien Windows dans front/landing/index.html.
# RELEASE_NOTIFY_TOKEN : la valeur du .env.
curl -fsS -X POST https://lector.dockerbop.fr/v1/releases/notify \
  -H "Authorization: Bearer $RELEASE_NOTIFY_TOKEN" -H 'content-type: application/json' -d "{\"version\":\"$V\"}"
```

Vérifier : `curl -s https://lector.dockerbop.fr/releases/latest-mac.yml | head -3` montre `version: 2.0.0`. Sur chaque ordinateur mis à jour : **Sync**, « Join », les 12 mots (tapés, ou remplis depuis Proton Pass). L'app de bureau ne scanne pas le QR : il ne sert qu'à un navigateur qui sait le lire (onglet « Scan »). La première synchro adopte le vault local sans rien supprimer.

Les installeurs 1.x pour Windows et Linux restent dans `releases/` (`Lector-Setup.exe`, `Lector.deb`, `Lector.AppImage`, `latest.yml`, `latest-linux.yml`) : la landing ne les propose plus, mais un lien direct les sert encore. Sans 2.0 à publier pour ces systèmes, les sortir du dossier servi :
```bash
mkdir -p /home/sid/backups/lector-1x-installeurs
cd /home/sid/apps/lector/releases && mv Lector-Setup.exe Lector.deb Lector.AppImage latest.yml latest-linux.yml /home/sid/backups/lector-1x-installeurs/ 2>/dev/null; ls
```

## 7. L'iPhone : rejoindre

L'app iOS affiche le bundle web : il faut soit la version 2.0 des stores, soit le bundle 2.0 publié par mise à jour OTA (partie iOS de `deploy.sh` : zip de `front/dist`, signature par `tools/sign-ota.mjs`, envoi de `lector-ios.zip` et `latest-ios.json`). Vérifier sur l'iPhone que le bundle 2.0 s'ouvre bien sur l'app native en place.

Puis **Sync**, « Join », les 12 mots : Proton Pass peut remplir le champ masqué, sinon les taper (pas de scanner de QR dans la vue web d'iOS). Les documents du Mac apparaissent ; en modifier un sur le Mac et le voir arriver, en supprimer un sur l'iPhone et le voir disparaître du Mac.

## 8. Après la bascule

1. **Révoquer les clés** restées dans l'ancien `.env` du serveur et dans toutes les sauvegardes qui le contiennent, chez chaque fournisseur :
   - Stripe : clé secrète live, secret et point d'arrivée du webhook, liens de paiement et produit Lector+ ; vérifier d'abord qu'aucun abonnement actif ne reste facturé, sinon l'annuler et prévenir l'abonné ;
   - Resend, ElevenLabs, Anthropic : les clés de l'ancien serveur.
   Retirer aussi ces clés du `.env` local du Mac (lu par `deploy.sh`) : il n'a plus besoin que des identifiants Apple de notarisation et de `RELEASE_NOTIFY_TOKEN`.
2. **App Store Connect** : regarder les abonnés actifs de `lector_plus_monthly` et ce que deviendra leur renouvellement, puis retirer l'abonnement de la vente (le supprimer si App Store Connect le permet). Mettre à jour la fiche : plus de prix ni d'achat intégré, étiquette de confidentialité (pas de compte, documents chiffrés de bout en bout), et la même chose sur Google Play. **À décider** : la déclaration de statut de commerçant (DSA) pour une app gratuite sans revenus.
3. **Sauvegardes automatiques** (`smart_backup.sh`) : celles d'avant la bascule contiennent `/data/users` en clair et l'ancien `.env` : environ 15 jours sur le serveur, quelques jours sur le Mac, 8 copies quotidiennes et 6 gardiens mensuels dans iCloud (jusqu'à 6 mois). **À décider** : laisser la rotation faire, ou supprimer dès maintenant les gardiens antérieurs à la bascule. Après la bascule, l'archive du volume ne contient plus que `lector.db` et `chain/` (blocs chiffrés) : vérifier sur la prochaine (`tar tzf ... volumes/lector_lector-data.tar.gz`).
4. **Traefik** journalise chaque requête (JSON) avec l'IP (`ClientHost`, `ClientAddr`) et le chemin (des `docId`, jamais la preuve ni l'`id` de chaîne). Le journal est global : impossible de l'éteindre pour Lector seul. Options :
   - `--accesslog.fields.names.ClientHost=drop` et `--accesslog.fields.names.ClientAddr=drop` : plus aucune IP, pour tous les sites (GoAccess perd la géolocalisation) ;
   - `--accesslog.filters.statuscodes=400-599` : seules les erreurs sont journalisées ;
   - rotation à 3 jours au lieu de 7.
   Dans tous les cas, vérifier que `--log.level` n'est pas `DEBUG` et qu'aucune option ne garde les en-têtes (`accesslog.fields.headers.defaultmode=keep`).
   **Recommandé** : retirer `ClientHost` et `ClientAddr` (ou ne garder que les erreurs) **et** tourner le journal à 3 jours (`rotate 3`, `daily` dans logrotate), puis exclure le dossier des journaux Traefik des sauvegardes. Procédure : `TRAEFIK_LOGS_ERREURS_SEULEMENT.md`, dans la documentation d'infra hors dépôt. La politique, `PRIVACY.md`, `docs/THREAT_MODEL.md` et `docs/legal/REGISTRE.md` disent aujourd'hui 7 jours : ne les passer à 3 jours qu'une fois ce réglage fait et vérifié.
5. **Historique git**, avant tout passage du dépôt en public : il contient encore `deploy/decrypt-enc.js` (clés d'appareil en clair), les mots de passe du keystore Android (anciennement dans `build.gradle`) et des commits signés d'une adresse personnelle. Réécriture (`git filter-repo`, avec un `.mailmap` vers l'auteur public), puis poussée forcée et nouveau clone partout. **Décision de Sid.**
6. **Après 30 jours** sans problème : supprimer l'archive de l'étape 2.1 (`/home/sid/backups/lector-data-avant-gratuit-*.tar.gz`), ou la garder hors ligne, chiffrée, puis la supprimer du serveur. Même décision pour la copie locale de l'étape 0.4.
7. **Divers** : le moniteur de santé (`/v1/health`) reste vert ; retirer tout moniteur qui vise une route supprimée. La `location /formation/` de nginx est retirée ; les fichiers déjà présents dans `webapp/formation/` sur le serveur ne sont plus servis et peuvent être effacés à la main.

## Liste de contrôle

- [ ] `/v1/health` répond `{"ok":true}`, `lector-api` est `healthy`, ses journaux ne montrent ni preuve, ni `pathEnc`, ni IP.
- [ ] Les anciennes routes répondent 404 ; `/v1/chain/manifest` sans en-têtes répond 400.
- [ ] `verifier-chaine.js --all` : `problemes: 0`, blocs = fichiers markdown du vault.
- [ ] `/data` ne contient que `lector.db` (et parfois `lector.db-journal`) et `chain/`, et appartient à `1000:1000`.
- [ ] `https://lector.dockerbop.fr/sync/` s'ouvre (lien « Technical details » de l'app) ; la landing ne propose aucun installeur 1.x.
- [ ] Un second appareil a rejoint avec les 12 mots ; une modification et une suppression font l'aller-retour.
- [ ] La mise à jour automatique répond (`latest-mac.yml`, `latest-ios.json`, `Lector.dmg`).
- [ ] Les 12 mots sont dans Proton Pass et le kit de secours est imprimé.
- [ ] Clés révoquées, abonnements fermés, fiches des stores à jour.

## Retour arrière

Tant que les étapes 6 et 7 n'ont pas eu lieu, seuls le Mac, le serveur et l'app web sont en 2.0 :

```bash
docker compose stop lector-api
docker run --rm -v lector_lector-data:/data -v /home/sid/backups:/backup alpine sh -c \
  'rm -rf /data/* && tar xzf /backup/lector-data-avant-gratuit-<date>.tar.gz -C /data && ls -la /data'
```

Puis remettre le code du back de la 1.x (même copie qu'à l'étape 3.2, depuis l'ancienne version), l'ancien `.env`, `docker compose up -d --build lector-api`, l'ancienne app web, et réinstaller la 1.x sur le Mac. Après la publication des clients 2.0, revenir en arrière demanderait aussi une nouvelle version desktop : mieux vaut corriger en avant.

Propriétaire du volume : la 1.x tourne en root et relit un volume à `node` sans rien faire de plus. Revenir ensuite à la 2.0 demande de refaire le `chown` de l'étape 2.4. Les commandes `docker compose run --rm lector-api node scripts/verifier-chaine.js ...` et `docker compose exec` tournent en `node` et marchent sans changement. Le schéma Prisma de la 2.0 n'a pas changé.
