// Cursor provider integration via the bundled pi-cursor-sdk extension
// (official @cursor/sdk agent runtime, local-by-default).
//
// The GUI's shared ModelRuntime never runs the session resource loader, so
// extension-registered providers would be invisible to the provider/model
// pickers. This module resolves the bundled extension and registers the Cursor
// provider into such runtimes WITHOUT loading the full extension factory.
//
// Full extension load (discoverAndLoadExtensions) still runs
// registerCursorPiToolBridge(). Melon applies a multicard patch so that no
// longer disposeAll()s sibling session bridges (see
// desktop/patches/pi-cursor-sdk-multicard). GUI catalog load still avoids the
// full factory so we never register a throwaway bridge from ModelRuntime.
// Session runtimes load the extension via additionalExtensionPaths instead
// (see createRuntimeFor in index.ts).
//
// Fail-open: if the package is absent (dev without desktop deps) or load
// fails, builtin providers are unaffected.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const moduleDir = dirname(fileURLToPath(import.meta.url));
function cursorSdkResolvers() {
    const paths = [
        import.meta.url,
        // desktop/server/cursor-extension.js → desktop/package.json
        join(moduleDir, "../package.json"),
        // packages/melon-server/{src,dist} → repo desktop/package.json
        join(moduleDir, "../../../desktop/package.json"),
    ];
    const out = [];
    for (const p of paths) {
        try {
            out.push(createRequire(p));
        }
        catch {
            /* skip invalid */
        }
    }
    return out;
}
export const CURSOR_PROVIDER_ID = "cursor";
let cachedCursorSessionIsolationAvailable;
/** Bundled pi-cursor-sdk package dir, or null when not installed. */
export function cursorExtensionPath() {
    for (const req of cursorSdkResolvers()) {
        try {
            return dirname(req.resolve("pi-cursor-sdk/package.json"));
        }
        catch {
            /* try next resolver */
        }
    }
    return null;
}
/**
 * The Cursor provider is safe in Melon's multi-card process only when every
 * stateful SDK module carries the session-isolation patch. Do not degrade to
 * upstream's process-global behavior: that can route one card's tools and
 * questions into another card.
 */
export function cursorSessionIsolationAvailable() {
    if (cachedCursorSessionIsolationAvailable !== undefined)
        return cachedCursorSessionIsolationAvailable;
    const extPath = cursorExtensionPath();
    if (!extPath) {
        cachedCursorSessionIsolationAvailable = false;
        return false;
    }
    const requiredMarkers = [
        ["dist/cursor-host-session.js", "runInCursorHostSession"],
        ["dist/cursor-pi-tool-bridge.js", "bridgesBySessionScopeKey"],
        ["dist/cursor-session-scope.js", "isCursorHostSessionIsolationEnabled"],
        ["dist/cursor-session-agent-resume.js", "resumeStatesByScopeKey"],
        ["dist/cursor-session-agent-lineage.js", "lineageStatesByScopeKey"],
        ["dist/cursor-session-agent-lifecycle.js", "liveCursorSessionScopeKeys"],
        ["dist/index.js", "cursorHostSessionScopeKey"],
    ];
    try {
        cachedCursorSessionIsolationAvailable = requiredMarkers.every(([relativePath, marker]) => {
            const path = join(extPath, relativePath);
            return existsSync(path) && readFileSync(path, "utf8").includes(marker);
        });
        return cachedCursorSessionIsolationAvailable;
    }
    catch {
        cachedCursorSessionIsolationAvailable = false;
        return false;
    }
}
function loadCursorProviderPieces() {
    const extPath = cursorExtensionPath();
    if (!extPath)
        return null;
    try {
        const sdkRequire = createRequire(join(extPath, "package.json"));
        const discovery = sdkRequire("./dist/model-discovery.js");
        const lazy = sdkRequire("./dist/cursor-provider-lazy.js");
        const apiKey = sdkRequire("./dist/cursor-api-key.js");
        return {
            discoverModels: discovery.discoverModels,
            streamCursorLazy: lazy.streamCursorLazy,
            CURSOR_API_KEY_CONFIG_VALUE: apiKey.CURSOR_API_KEY_CONFIG_VALUE,
        };
    }
    catch {
        return null;
    }
}
/**
 * Register the Cursor provider into a ModelRuntime (and refresh).
 * Intentionally does not run the full pi-cursor-sdk extension factory — the
 * GUI catalog does not need a live pi tool bridge, and avoiding the factory
 * keeps ModelRuntime from registering an unused bridge.
 */
export async function loadCursorProviderInto(runtime) {
    // Other providers remain available when the Cursor patch is absent. Cursor
    // itself stays out of the catalog rather than silently running cross-wired.
    if (!cursorSessionIsolationAvailable())
        return;
    const pieces = loadCursorProviderPieces();
    if (!pieces)
        return;
    let fallbackMessage;
    const models = await pieces.discoverModels({
        onFallback: (issue) => {
            fallbackMessage = issue.message;
        },
    });
    if (fallbackMessage) {
        console.warn("[melon] cursor model catalog fallback:", fallbackMessage);
    }
    try {
        runtime.registerProvider(CURSOR_PROVIDER_ID, {
            name: "Cursor",
            baseUrl: "https://cursor.com",
            apiKey: pieces.CURSOR_API_KEY_CONFIG_VALUE,
            api: "cursor-sdk",
            models: models,
            streamSimple: pieces.streamCursorLazy,
        });
    }
    catch (e) {
        console.error(`[melon] failed to register provider "${CURSOR_PROVIDER_ID}":`, e?.message ?? e);
        return;
    }
    await runtime.refresh({ allowNetwork: false });
}
/**
 * Rewrite TUI-only instructions in Cursor extension errors into actions that
 * exist in Melon. The extension's copy references /login and
 * /cursor-refresh-models — slash commands the GUI does not have.
 */
export function rewriteCursorError(message) {
    if (!/cursor/i.test(message))
        return message;
    return message
        .replace(/\/login \(Use an API key -> Cursor\)/gi, "Melon's provider settings (Cursor → add key)")
        .replace(/run \/cursor-refresh-models to refresh/gi, "start a new chat card to refresh")
        .replace(/\/cursor-refresh-models/g, "a new chat card");
}
/**
 * True when a REAL Cursor SDK API key is available. The extension registers a
 * literal placeholder apiKey so the generic auth status reports "configured"
 * with no key present — this checks the actual sources instead.
 */
export function hasRealCursorKey(authEntries, melonKeys) {
    if (process.env.CURSOR_API_KEY?.trim())
        return true;
    const stored = authEntries[CURSOR_PROVIDER_ID];
    if (stored?.type === "api_key" && typeof stored.key === "string" && stored.key.trim())
        return true;
    return Boolean(melonKeys[CURSOR_PROVIDER_ID]?.trim());
}
//# sourceMappingURL=cursor-extension.js.map