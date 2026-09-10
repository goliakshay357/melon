// Melon hosts many live cards in one Node process. @fractaal/pi-claude-bridge's
// default entry shares module state across reloaded extension instances; Melon
// therefore loads only bundle/isolated.js (see claude-bridge-extension.ts).
//
// That is not enough by itself. This module mirrors cursor-session-binding.ts:
//   1. Hard-fail when the isolated entry is missing (never soft-degrade).
//   2. Re-bind extensions on this card before every Claude prompt so session_start
//      / restore / clear handlers run against THIS card's sessionManager.
//   3. Strip copied `claude-bridge-session` customs from forked Melon child
//      jsonl files so the child cannot --resume the parent's Claude Code session.
//
// Fractaal's shouldRestorePersistedBridgeEntry(piSessionId) is defense-in-depth;
// Melon still strips on fork the same way it strips Cursor resume handles.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { CLAUDE_BRIDGE_PROVIDER_ID, claudeBridgeIsolatedExtensionPath, claudeBridgeSessionIsolationAvailable, } from "./claude-bridge-extension.js";
/** Persisted Claude Code session marker written by @fractaal/pi-claude-bridge. */
export const CLAUDE_BRIDGE_SESSION_CUSTOM_TYPE = "claude-bridge-session";
function isClaudeBridgeProvider(runtime) {
    return (runtime.session.model?.provider ?? "").toLowerCase() === CLAUDE_BRIDGE_PROVIDER_ID;
}
function claudeBridgeIsolationUnavailableError() {
    return Object.assign(new Error("Claude Code session isolation is unavailable. Melon requires @fractaal/pi-claude-bridge's isolated entry (bundle/isolated.js). Reinstall desktop dependencies and restart Melon."), { statusCode: 503 });
}
function requireClaudeBridgeIsolation() {
    if (!claudeBridgeSessionIsolationAvailable() || !claudeBridgeIsolatedExtensionPath()) {
        throw claudeBridgeIsolationUnavailableError();
    }
}
/**
 * Drop copied Claude bridge session markers from a forked Melon child session and
 * re-chain parentIds so the jsonl tree stays valid. Returns how many entries
 * were removed.
 */
export function stripClaudeBridgeSessionEntriesFromSessionFile(sessionFile) {
    if (!sessionFile || !existsSync(sessionFile))
        return 0;
    const raw = readFileSync(sessionFile, "utf8");
    if (!raw.trim())
        return 0;
    const lines = raw.split(/\n/);
    const headerLine = lines[0] ?? "";
    let header;
    try {
        header = JSON.parse(headerLine);
    }
    catch {
        return 0;
    }
    if (!header || typeof header !== "object" || header.type !== "session") {
        return 0;
    }
    const kept = [];
    let removed = 0;
    for (const line of lines.slice(1)) {
        if (!line.trim())
            continue;
        let obj;
        try {
            obj = JSON.parse(line);
        }
        catch {
            kept.push({ __raw: line });
            continue;
        }
        if (obj.type === "custom" && obj.customType === CLAUDE_BRIDGE_SESSION_CUSTOM_TYPE) {
            removed += 1;
            continue;
        }
        kept.push(obj);
    }
    if (removed === 0)
        return 0;
    let parentId = null;
    const rewritten = [headerLine];
    for (const entry of kept) {
        if ("__raw" in entry) {
            rewritten.push(String(entry.__raw));
            continue;
        }
        const next = { ...entry, parentId };
        rewritten.push(JSON.stringify(next));
        parentId = typeof next.id === "string" ? next.id : parentId;
    }
    writeFileSync(sessionFile, `${rewritten.join("\n")}\n`);
    return removed;
}
/**
 * Register this card's session with the isolated Claude bridge before a prompt.
 * No-op when Claude bridge is not the active model.
 *
 * Always re-supplies uiContext when provided (same rationale as Cursor binding).
 */
export async function activateClaudeBridgeSessionBinding(runtime, options = {}) {
    if (!isClaudeBridgeProvider(runtime))
        return;
    requireClaudeBridgeIsolation();
    // Re-emit session_start on THIS card's extension runner so the isolated
    // bridge's restore/clear handlers see this sessionManager (and not a sibling).
    await runtime.session.bindExtensions({
        mode: "rpc",
        ...(options.uiContext ? { uiContext: options.uiContext } : {}),
    });
}
/**
 * Bind the card and run its prompt after isolation is confirmed. Missing
 * isolation is a hard Claude error — never fall back to the shared package entry.
 */
export async function runInBoundClaudeBridgeSession(runtime, options, run) {
    if (!isClaudeBridgeProvider(runtime))
        return run();
    requireClaudeBridgeIsolation();
    await activateClaudeBridgeSessionBinding(runtime, options);
    return run();
}
//# sourceMappingURL=claude-bridge-session-binding.js.map