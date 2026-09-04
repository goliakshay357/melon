#!/usr/bin/env node
/**
 * Apply Melon's multi-card Cursor patch onto the installed pi-cursor-sdk
 * package (desktop/node_modules).
 *
 * Upstream 0.3.6 assumes one pi session per Node process: it keeps a single
 * pi tool bridge (disposing siblings on re-register) and keeps session scope,
 * resume and lineage state in globals that the most recent session_start
 * overwrites. Melon runs many cards in one process, so a second card silently
 * takes over the first card's bridge and session state.
 *
 * The patch keeps one bridge and one state per pi session and resolves them
 * from the async context of the running turn (dist/cursor-host-session.js).
 *
 * Usage (from repo root or desktop/):
 *   node desktop/scripts/apply-pi-cursor-sdk-multicard-patch.mjs
 *
 * Safe to re-run. No-op when pi-cursor-sdk is not installed.
 */
import { copyFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopRoot = join(__dirname, "..");
const patchDir = join(desktopRoot, "patches", "pi-cursor-sdk-multicard");
const require = createRequire(join(desktopRoot, "package.json"));

let sdkRoot;
try {
	sdkRoot = dirname(require.resolve("pi-cursor-sdk/package.json"));
} catch {
	console.log("[melon] pi-cursor-sdk not installed — skip multicard bridge patch");
	process.exit(0);
}

// [patch file, path inside pi-cursor-sdk, adds a file upstream does not ship]
const files = [
	["cursor-host-session.ts", "src/cursor-host-session.ts", true],
	["cursor-host-session.js", "dist/cursor-host-session.js", true],
	["cursor-pi-tool-bridge.ts", "src/cursor-pi-tool-bridge.ts"],
	["cursor-pi-tool-bridge-abort.ts", "src/cursor-pi-tool-bridge-abort.ts"],
	["cursor-pi-tool-bridge-types.ts", "src/cursor-pi-tool-bridge-types.ts"],
	["cursor-session-scope.ts", "src/cursor-session-scope.ts"],
	["cursor-session-agent-resume.ts", "src/cursor-session-agent-resume.ts"],
	["cursor-session-agent-lineage.ts", "src/cursor-session-agent-lineage.ts"],
	["cursor-session-agent-lifecycle.ts", "src/cursor-session-agent-lifecycle.ts"],
	["index.ts", "src/index.ts"],
	["cursor-pi-tool-bridge.js", "dist/cursor-pi-tool-bridge.js"],
	["cursor-pi-tool-bridge-abort.js", "dist/cursor-pi-tool-bridge-abort.js"],
	["cursor-session-scope.js", "dist/cursor-session-scope.js"],
	["cursor-session-agent-resume.js", "dist/cursor-session-agent-resume.js"],
	["cursor-session-agent-lineage.js", "dist/cursor-session-agent-lineage.js"],
	["cursor-session-agent-lifecycle.js", "dist/cursor-session-agent-lifecycle.js"],
	["index.js", "dist/index.js"],
];

for (const [name, rel, isNewFile] of files) {
	const from = join(patchDir, name);
	const to = join(sdkRoot, rel);
	if (!existsSync(from)) {
		console.error(`[melon] missing patch file: ${from}`);
		process.exit(1);
	}
	if (!isNewFile && !existsSync(to)) {
		console.error(`[melon] missing SDK target: ${to}`);
		process.exit(1);
	}
	copyFileSync(from, to);
}

// Each patched runtime module must actually carry the isolation wiring; a
// partially applied patch is worse than none (cards would cross-wire again).
const markers = [
	["dist/cursor-host-session.js", "runInCursorHostSession"],
	["dist/cursor-pi-tool-bridge.js", "registeredCursorPiToolBridges"],
	["dist/cursor-pi-tool-bridge.js", "bridgesBySessionScopeKey"],
	["dist/cursor-session-scope.js", "isCursorHostSessionIsolationEnabled"],
	["dist/cursor-session-agent-resume.js", "resumeStatesByScopeKey"],
	["dist/cursor-session-agent-lineage.js", "lineageStatesByScopeKey"],
	["dist/cursor-session-agent-lifecycle.js", "eventScopeKey"],
	["dist/index.js", "cursorHostSessionScopeKey"],
];

for (const [rel, marker] of markers) {
	const contents = readFileSync(join(sdkRoot, rel), "utf8");
	if (!contents.includes(marker)) {
		console.error(`[melon] multicard patch did not apply correctly: ${rel} is missing ${marker}`);
		process.exit(1);
	}
}

console.log(`[melon] applied pi-cursor-sdk multicard session isolation patch → ${sdkRoot}`);
