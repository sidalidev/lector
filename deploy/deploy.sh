#!/bin/bash
# Full release, run by hand: desktop (DMG + ZIP), signed iOS OTA bundle,
# landing, API and web app. The API container applies the Prisma schema when it
# starts: on a database that still holds the old tables it refuses (data loss)
# and keeps restarting, so follow docs/BASCULE-PROD.md for the first 2.0 deploy.
set -euo pipefail

VPS_USER="sid"
VPS_HOST="dockerbop.fr"
VPS_DIR="/home/sid/apps/lector"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Load Apple credentials for notarization
if [ -f "$PROJECT_DIR/.env" ]; then
    export $(grep -v '^#' "$PROJECT_DIR/.env" | xargs)
fi

echo "==> Reading version from package.json..."
VERSION=$(node -p "require('$PROJECT_DIR/package.json').version")
echo "    Version: $VERSION"

echo "==> Building Lector v$VERSION..."
cd "$PROJECT_DIR"
npm run dist

echo "==> Uploading DMG to VPS (first install)..."
scp "$PROJECT_DIR/release/Lector-${VERSION}-universal.dmg" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/releases/Lector.dmg"

echo "==> Uploading ZIP to VPS (auto-update)..."
scp "$PROJECT_DIR/release/Lector-${VERSION}-universal-mac.zip" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/releases/Lector.zip"

# Upload latest-mac.yml for electron-updater (rewrite filenames)
if [ -f "$PROJECT_DIR/release/latest-mac.yml" ]; then
    sed 's/Lector-[^ ]*\.zip/Lector.zip/g; s/Lector-[^ ]*\.dmg/Lector.dmg/g' "$PROJECT_DIR/release/latest-mac.yml" > /tmp/latest-mac.yml
    scp /tmp/latest-mac.yml "$VPS_USER@$VPS_HOST:$VPS_DIR/releases/"
    rm /tmp/latest-mac.yml
fi

# --- iOS OTA bundle (same Vite build; the app expects dist/index.html inside the zip) ---
echo "==> Creating iOS OTA bundle..."
rm -f "$PROJECT_DIR/release/lector-ios-${VERSION}.zip"
(cd "$PROJECT_DIR/front" && zip -r "$PROJECT_DIR/release/lector-ios-${VERSION}.zip" dist/ > /dev/null)

echo "==> Uploading iOS OTA bundle to VPS..."
scp "$PROJECT_DIR/release/lector-ios-${VERSION}.zip" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/releases/lector-ios.zip"

echo "==> Uploading iOS OTA manifest..."
# Signed manifest: the app refuses any bundle whose signature or SHA-256 does not match
node "$PROJECT_DIR/tools/sign-ota.mjs" "$PROJECT_DIR/release/lector-ios-${VERSION}.zip" "$VERSION" \
    "https://lector.dockerbop.fr/api/lector-ios.zip" /tmp/latest-ios.json
scp /tmp/latest-ios.json "$VPS_USER@$VPS_HOST:$VPS_DIR/releases/latest-ios.json"
rm -f /tmp/latest-ios.json

echo "==> Uploading landing page..."
scp "$PROJECT_DIR/front/landing/index.html" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/"
scp "$PROJECT_DIR/front/landing/privacy.html" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/"
# Fonts of the landing pages (OFL, licences next to them)
rsync -a "$PROJECT_DIR/front/landing/fonts" "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/"
# Technical details opened by the app and the recovery kit (tools/page-sync.mjs)
rsync -a "$PROJECT_DIR/front/landing/sync" "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/"
scp "$PROJECT_DIR/front/landing/icon.png" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/" 2>/dev/null || true
scp "$PROJECT_DIR/front/landing/beret.png" \
    "$VPS_USER@$VPS_HOST:$VPS_DIR/landing/" 2>/dev/null || true

# --- API (encrypted chain storage + release notifications) ---

cd "$PROJECT_DIR"

echo "==> Syncing backend code to VPS (rsync)..."
rsync -a --delete --exclude='node_modules' --exclude='*.db' --exclude='*.db-journal' \
  --exclude='.env' --exclude='.test-data' --exclude='dev-chain' \
  "$PROJECT_DIR/back/" "$VPS_USER@$VPS_HOST:$VPS_DIR/server/"

echo "==> Rebuilding backend (the container applies the schema on start)..."
ssh "$VPS_USER@$VPS_HOST" "set -e; cd $VPS_DIR && \
  docker compose up -d --build lector-api lector-landing && \
  for i in \$(seq 1 30); do \
    docker compose exec -T lector-api wget -qO- http://localhost:3456/v1/health > /dev/null 2>&1 && exit 0; \
    sleep 2; \
  done; \
  echo 'API not healthy after 60 s: docker compose logs lector-api'; exit 1"

# /formation/ is served from files already on the host: keep them.
echo "==> Syncing webapp build to VPS..."
rsync -a --delete --exclude='/formation/' "$PROJECT_DIR/front/dist/" "$VPS_USER@$VPS_HOST:$VPS_DIR/webapp/"

echo ""
echo "==> Notifying clients (SSE realtime)..."
if [ -n "${RELEASE_NOTIFY_TOKEN:-}" ]; then
  curl -fsS -X POST https://lector.dockerbop.fr/v1/releases/notify \
    -H "Authorization: Bearer $RELEASE_NOTIFY_TOKEN" \
    -H 'content-type: application/json' \
    -d "{\"version\":\"$VERSION\"}" || echo "    (notify failed, clients will check next interval)"
else
  echo "    Skipped (RELEASE_NOTIFY_TOKEN not set in .env)"
fi

echo ""
echo "==> Lector v$VERSION deployed!"
echo "    Landing:    https://lector.dockerbop.fr"
echo "    Download:   https://lector.dockerbop.fr/download/Lector.dmg"
