#!/bin/bash
# Build a fresh Melon .dmg from source, then SMOKE-TEST the packaged app.
set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$ROOT/desktop/dist/mac-arm64/Melon.app"

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

echo "── 4. ensure pi-coding-agent matches dev (version + branding) ──"
node -e '
const fs = require("fs");
const path = require("path");
const root = require(path.join(process.argv[1], "node_modules/@earendil-works/pi-coding-agent/package.json"));
const dp = path.join(process.argv[1], "desktop/node_modules/@earendil-works/pi-coding-agent/package.json");
const d = JSON.parse(fs.readFileSync(dp, "utf8"));
const pc = d.piConfig || {};
if (d.version !== root.version) {
  console.error(`  ✗ desktop pi-coding-agent is v${d.version}, dev is v${root.version}. Run: cd desktop && npm install`);
  process.exit(1);
}
if (pc.name || pc.configDir !== ".pi") {
  console.error(`  ✗ desktop pi-coding-agent is branded (${JSON.stringify(pc)}). It must match dev: {"configDir":".pi"}`);
  process.exit(1);
}
console.log(`  ✓ pi-coding-agent matches dev (v${root.version}, configDir .pi)`);
' "$ROOT"

echo "── 5. package DMG ──"
npx electron-builder --mac

echo "── 6. smoke test the packaged app ──"
pkill -f "Melon.app/Contents/MacOS/Melon" 2>/dev/null || true
sleep 2
LOG=/tmp/melon-smoke.log
"$APP/Contents/MacOS/Melon" > "$LOG" 2>&1 &
SMOKE_PID=$!

# Wait for the server's structured handshake and extract the port.
PORT=""
for i in $(seq 1 30); do
    PORT=$(grep -oE 'server on port [0-9]+' "$LOG" 2>/dev/null | grep -oE '[0-9]+' | tail -1)
    [ -n "$PORT" ] && break
    sleep 1
done
if [ -z "$PORT" ]; then
    echo "❌ smoke test: server never reported a port. Log:"; grep -v IMK "$LOG" | tail -20
    kill $SMOKE_PID 2>/dev/null || true
    exit 1
fi
echo "  server bound to port $PORT"

# 5a. health endpoint
if ! curl -sf "http://127.0.0.1:$PORT/healthz" >/dev/null; then
    echo "❌ smoke test: /healthz failed"; kill $SMOKE_PID 2>/dev/null || true; exit 1
fi
echo "  ✓ /healthz"

# 5b. UI shell
if ! curl -sf "http://127.0.0.1:$PORT/" | grep -q "<html"; then
    echo "❌ smoke test: / did not serve HTML"; kill $SMOKE_PID 2>/dev/null || true; exit 1
fi
echo "  ✓ / serves HTML"

# 5c. real chat round-trip
CARD="smoke-$(date +%s)"
curl -sf -X POST "http://127.0.0.1:$PORT/sessions" \
    -H 'content-type: application/json' \
    -d "{\"cardId\":\"$CARD\",\"cwd\":\"$ROOT\"}" >/dev/null
(curl -s -N "http://127.0.0.1:$PORT/sessions/$CARD/events" > /tmp/melon-smoke-events.log 2>&1 &)
sleep 1
curl -sf -X POST "http://127.0.0.1:$PORT/sessions/$CARD/prompt" \
    -H 'content-type: application/json' \
    -d '{"text":"Reply with exactly: SMOKE OK"}' >/dev/null
# Wait for streamed deltas (deepseek reasoning can take ~20s).
STREAMED=""
for i in $(seq 1 45); do
    STREAMED=$(grep -oE '"text":"[^"]*"' /tmp/melon-smoke-events.log 2>/dev/null | sed 's/"text":"//; s/"$//' | tr -d '\n')
    echo "$STREAMED" | grep -q "SMOKE" && break
    sleep 2
done
if ! echo "$STREAMED" | grep -q "SMOKE"; then
    echo "❌ smoke test: no streamed response. Events:"; tail -5 /tmp/melon-smoke-events.log 2>/dev/null
    kill $SMOKE_PID 2>/dev/null || true; exit 1
fi
echo "  ✓ chat streams: $STREAMED"

kill $SMOKE_PID 2>/dev/null || true
pkill -f "Melon.app/Contents/MacOS/Melon" 2>/dev/null || true
echo "  ✓ packaged app smoke test passed"

echo ""
DMG=$(ls -lh "$ROOT/desktop/dist"/*.dmg 2>/dev/null | grep -i melon | awk '{print $NF, $5}' | head -1)
[ -z "$DMG" ] && echo "❌ no DMG produced" && exit 1
echo "✅ $DMG"
