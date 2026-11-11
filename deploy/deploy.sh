#!/bin/bash
# Déploiement du site et de l'app web sur le serveur (lancé à la main) :
#   npm run deploy            app web, pages du site, configuration nginx
#   npm run deploy -- --api   la même chose, puis le relais (lector-api)
#
# Le relais applique lui-même son schéma au démarrage (CMD du Dockerfile) :
# aucun « prisma db push » n'est lancé d'ici. Les versions ordinateur et
# Android se publient sur GitHub Releases, pas par ce script.
#
# Disposition sur le serveur : deploy/docker-compose.yml.
set -euo pipefail

VPS="sid@dockerbop.fr"
DIR="/home/sid/apps/lector"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

API=false
for arg in "$@"; do
  case "$arg" in
    --api) API=true ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Option inconnue : $arg (voir --help)" >&2; exit 1 ;;
  esac
done

cd "$PROJECT_DIR"

echo "==> Build de l'app web..."
npm run build

echo "==> App web -> $DIR/webapp/"
rsync -a --delete front/dist/ "$VPS:$DIR/webapp/"

echo "==> Pages du site -> $DIR/landing/"
rsync -a front/landing/privacy.html front/landing/sync front/landing/fonts "$VPS:$DIR/landing/"

# nginx.conf est monté seul dans le conteneur : on le réécrit en place (même
# inode) et on revient à l'ancien si nginx -t le refuse.
echo "==> Configuration nginx..."
scp deploy/nginx.conf "$VPS:$DIR/nginx.conf.nouveau"
ssh "$VPS" "set -e; cd $DIR
  cp nginx.conf nginx.conf.precedent
  cat nginx.conf.nouveau > nginx.conf
  if docker compose exec -T lector-landing nginx -t; then
    docker compose exec -T lector-landing nginx -s reload
    rm -f nginx.conf.nouveau
  else
    cat nginx.conf.precedent > nginx.conf
    echo 'nginx -t a refusé la nouvelle configuration : ancienne remise.' >&2
    exit 1
  fi"

if [ "$API" = true ]; then
  echo "==> Relais : mise à jour du dépôt et reconstruction de lector-api..."
  ssh "$VPS" "set -e; cd $DIR
    git -C repo pull --ff-only
    docker compose up -d --build lector-api
    for i in \$(seq 1 30); do
      docker compose exec -T lector-api wget -qO- http://localhost:3456/v1/health > /dev/null 2>&1 && exit 0
      sleep 2
    done
    echo 'Relais pas en bonne santé après 60 s : docker compose logs lector-api' >&2
    exit 1"
fi

echo ""
echo "==> Déployé : https://lector.sidali.dev/"
