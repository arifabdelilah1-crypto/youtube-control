#!/usr/bin/env bash
# GitHub Pages serves the repo root: copy the dashboard from web/ to the root after every change.
set -euo pipefail
cd "$(dirname "$0")"
npm run -s build:editor
cp web/index.html web/app.js web/styles.css web/config.js web/editor.bundle.js .
mkdir -p fonts sfx && cp web/fonts/* fonts/ && cp web/sfx/* sfx/
echo "Root copy updated."
