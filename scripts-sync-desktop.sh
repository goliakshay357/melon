#!/bin/bash
# Rebuild melon-web and sync into the desktop shell.
set -e
cd "$(dirname "$0")"
npm --prefix packages/melon-web run build
rm -rf desktop/web-dist
cp -r packages/melon-web/dist desktop/web-dist
echo "✓ desktop/web-dist updated — restart the Melon app to see changes"
