#!/bin/bash
# Rebuild melon-web AND melon-server, sync both into the desktop shell.
set -e
cd "$(dirname "$0")"

echo "── building web UI ──"
npm --prefix packages/melon-web run build 2>&1 | tail -1
rm -rf desktop/web-dist
cp -r packages/melon-web/dist desktop/web-dist

echo "── syncing server ──"
rm -rf desktop/server
cp -r packages/melon-server/dist desktop/server
cp packages/melon-server/package.json desktop/server/package.json

echo "✓ desktop/web-dist and desktop/server updated — restart the app"
