// Melon hosts many live cards in one Node process. Antigravity is a native HTTP
// provider (no Claude-Code-style subprocess), but Melon still applies the same
// per-card defenses as Cursor / Claude bridge:
//   1. Hard-fail when the bundled extension entry is missing.
//   2. Re-bind extensions on this card before every Antigravity prompt.
//   3. Fork strip is a no-op today (Antigravity does not persist Melon custom
//      session markers); keep the hook for parity and future-proofing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ANTIGRAVITY_PROVIDER_ID, antigravityExtensionEntryPath, antigravitySessionIsolationAvailable, } from "./antigravity-extension.js";
/** Reserved if Antigravity ever writes Melon custom session markers. */
export const ANTIGRAVITY_SESSION_CUSTOM_TYPE = "antigravity-session";
function isAntigravityProvider(runtime) {
    return (runtime.session.model?.provider ?? "").toLowerCase() === ANTIGRAVITY_PROVIDER_ID;
}
function antigravityIsolationUnavailableError() {
    return Object.assign(new Error("Antigravity session isolation is unavailable. Melon requires the bundled pi-antigravity extension entry. Reinstall desktop dependencies and restart Melon."), { statusCode: 503 });
}
function requireAntigravityIsolation() {
    if (!antigravitySessionIsolationAvailable() || !antigravityExtensionEntryPath()) {
        throw antigravityIsolationUnavailableError();
    }
}
/**
 * Drop copied Antigravity Melon custom markers from a forked child session.
 * Currently a no-op unless such markers appear; returns how many were removed.
 */
export function stripAntigravitySessionEntriesFromSessionFile(sessionFile) {
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
        if (obj.type === "custom" && obj.customType === ANTIGRAVITY_SESSION_CUSTOM_TYPE) {
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
export async function activateAntigravitySessionBinding(runtime, options = {}) {
    if (!isAntigravityProvider(runtime))
        return;
    requireAntigravityIsolation();
    await runtime.session.bindExtensions({
        mode: "rpc",
        ...(options.uiContext ? { uiContext: options.uiContext } : {}),
    });
}
export async function runInBoundAntigravitySession(runtime, options, run) {
    if (!isAntigravityProvider(runtime))
        return run();
    requireAntigravityIsolation();
    await activateAntigravitySessionBinding(runtime, options);
    return run();
}
//# sourceMappingURL=antigravity-session-binding.js.map