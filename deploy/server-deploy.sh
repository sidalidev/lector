#!/bin/bash
set -euo pipefail

DEPLOY_DIR="/home/sid/apps/lector"
cd "$DEPLOY_DIR"

# Start or restart the container
docker compose up -d
echo "Lector landing deployed successfully!"
