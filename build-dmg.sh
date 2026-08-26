#!/bin/bash
# Build a fresh Melon .dmg from source.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "── 1. build web UI ──"
cd "$ROOT/packages/melon-web"
npm run build

echo "── 2. build melon-server ──"
cd "$ROOT/packages/melon-server"
npm run build

echo "── 3. sync into desktop shell ──"
cd "$ROOT/desktop"
rm -rf server web-dist
cp -r ../packages/melon-server/dist server
cp -r ../packages/melon-web/dist web-dist

echo "── 4. package DMG ──"
npx electron-builder --mac

echo ""
DMG=$(ls -lh release/*.dmg | awk '{print $NF, $5}')
echo "✅ $DMG"
