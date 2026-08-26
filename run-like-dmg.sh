#!/bin/bash
# Run Melon EXACTLY like the packaged DMG does — one server serving BOTH the UI
# and the API on the same port (no Vite, no proxy). This is the faithful local
# preview of the .app, using Electron's own Node (same runtime as the DMG).
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "── 1. build web UI ──"
cd "$ROOT/packages/melon-web" && npm run build

echo "── 2. build melon-server ──"
cd "$ROOT/packages/melon-server" && npm run build

echo "── 3. sync into desktop shell ──"
cd "$ROOT/desktop"
rm -rf server web-dist
cp -r ../packages/melon-server/dist server
cp -r ../packages/melon-web/dist web-dist

PORT="${MELON_PORT:-8899}"
echo ""
echo "── 4. starting the SAME server the DMG runs ──"
echo "    (single process: UI + API on http://127.0.0.1:$PORT)"
echo "    Ctrl+C to stop"
echo ""
# Use Electron's own Node binary (identical runtime to the packaged app).
ELECTRON_RUN_AS_NODE=1 MELON_PORT="$PORT" \
    ./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron server/index.js
