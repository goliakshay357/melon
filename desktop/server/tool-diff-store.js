import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
function storePath(sessionFile) {
    return `${sessionFile}.melon-tool-diffs.json`;
}
export function loadToolDiffStore(sessionFile) {
    try {
        const raw = JSON.parse(readFileSync(storePath(sessionFile), "utf8"));
        if (raw && typeof raw === "object" && raw.byCallId && typeof raw.byCallId === "object") {
            return { version: 1, byCallId: raw.byCallId };
        }
    }
    catch {
        /* missing / invalid — empty */
    }
    return { version: 1, byCallId: {} };
}
export function saveToolDiff(sessionFile, callId, output) {
    if (!sessionFile || !callId || !output)
        return;
    const store = loadToolDiffStore(sessionFile);
    store.byCallId[callId] = output;
    const path = storePath(sessionFile);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(store));
}
export function lookupToolDiff(sessionFile, callId) {
    if (!callId)
        return undefined;
    const out = loadToolDiffStore(sessionFile).byCallId[callId];
    return typeof out === "string" && out.length > 0 ? out : undefined;
}
//# sourceMappingURL=tool-diff-store.js.map