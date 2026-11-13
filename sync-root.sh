#!/usr/bin/env bash
# GitHub Pages serves the repo root: copy the dashboard from web/ to the root after every change.
set -euo pipefail
cd "$(dirname "$0")"
npm run -s build:editor
cp web/index.html web/app.js web/styles.css web/config.js web/editor.bundle.js web/slots.js web/voicefx.js web/voices.js web/sfx-library.json web/privacy.html web/terms.html .
mkdir -p fonts sfx anim && cp web/fonts/* fonts/ && cp web/sfx/* sfx/ && cp web/anim/* anim/
echo "Root copy updated."
