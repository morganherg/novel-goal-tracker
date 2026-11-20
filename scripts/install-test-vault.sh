#!/bin/sh
# Build the plugin and copy it into the local test vault next to this repo.
set -e
cd "$(dirname "$0")/.."
npm run build
DEST="../Novel Goal Tracker Test Vault/.obsidian/plugins/novel-goal-tracker"
mkdir -p "$DEST"
cp main.js manifest.json styles.css "$DEST/"
echo "Installed into $DEST"
