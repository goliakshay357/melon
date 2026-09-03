// Cursor provider integration via the bundled pi-cursor-sdk extension
// (official @cursor/sdk agent runtime, local-by-default).
//
// The GUI's shared ModelRuntime never runs the session resource loader, so
// extension-registered providers would be invisible to the provider/model
// pickers. This module resolves the bundled extension and loads it into such
// runtimes. Session runtimes get the same extension through the resource
// loader's additionalExtensionPaths instead (see createRuntimeFor in index.ts).
//
// Fail-open: if the package is absent (dev without desktop deps) or load
// fails, builtin providers are unaffected.
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { discoverAndLoadExtensions, getAgentDir, } from "@earendil-works/pi-coding-agent";
const require = createRequire(import.meta.url);
export const CURSOR_PROVIDER_ID = "cursor";
/** Bundled pi-cursor-sdk package dir, or null when not installed. */
export function cursorExtensionPath() {
    try {
        return dirname(require.resolve("pi-cursor-sdk/package.json"));
    }
    catch {
        return null;
    }
}
/** Register the extension's providers into a ModelRuntime (and refresh). */
export async function loadCursorProviderInto(runtime) {
    const extPath = cursorExtensionPath();
    if (!extPath)
        return;
    const agentDir = getAgentDir();
    // Pass the package DIR — pi's discovery resolves its "pi" manifest. cwd is
    // the agent dir so no project-local .pi/extensions are scanned; global
    // extensions load too, keeping the GUI consistent with session runtimes.
    const result = await discoverAndLoadExtensions([extPath], agentDir, agentDir);
    for (const { name, config, extensionPath } of result.runtime.pendingProviderRegistrations) {
        try {
            runtime.registerProvider(name, config);
        }
        catch (e) {
            console.error(`[melon] extension "${extensionPath}" failed to register provider "${name}":`, e?.message ?? e);
        }
    }
    result.runtime.pendingProviderRegistrations = [];
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