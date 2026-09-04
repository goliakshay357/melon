// Melon hosts many live cards in one Node process. pi-cursor-sdk was written
// for one session per process: its session scope, local-resume state and pi
// tool bridge live in globals that the most recent session_start overwrites.
//
// Two things make that safe here:
//  1. Melon's multicard patch (desktop/patches/pi-cursor-sdk-multicard) keeps
//     one bridge and one state per session and resolves them from the async
//     context of the running turn.
//  2. This module opens that context — activateCursorSessionBinding() before
//     the turn, runInCursorSession() around it — so a card that starts while
//     another is streaming cannot take over the streaming card's bridge, tool
//     answers or resume handle.
//
// Rebinding also matters after Melon canvas fork, which copies
// `cursor-sdk-agent-resume` custom entries into the child .jsonl.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { cursorExtensionPath, cursorSessionIsolationAvailable } from "./cursor-extension.js";
/** pi-cursor-sdk custom entry that pins a local Cursor agent id for resume. */
export const CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE = "cursor-sdk-agent-resume";
/** undefined = not looked up yet, null = patch missing. */
let hostSessionModule;
function loadCursorHostSessionModule() {
    if (hostSessionModule !== undefined)
        return hostSessionModule;
    const extPath = cursorExtensionPath();
    if (!extPath) {
        hostSessionModule = null;
        return hostSessionModule;
    }
    try {
        const sdkRequire = createRequire(join(extPath, "package.json"));
        hostSessionModule = sdkRequire("./dist/cursor-host-session.js");
    }
    catch {
        hostSessionModule = null;
        console.error("[melon] pi-cursor-sdk multicard isolation patch is missing — run desktop/scripts/apply-pi-cursor-sdk-multicard-patch.mjs; concurrent Cursor cards will share session state");
    }
    return hostSessionModule;
}
function cursorIsolationUnavailableError() {
    return Object.assign(new Error("Cursor session isolation is unavailable. Reinstall or run the desktop Cursor patch, then restart Melon."), { statusCode: 503 });
}
function requireCursorHostSessionModule() {
    if (!cursorSessionIsolationAvailable())
        throw cursorIsolationUnavailableError();
    const hostSession = loadCursorHostSessionModule();
    if (!hostSession)
        throw cursorIsolationUnavailableError();
    return hostSession;
}
function isCursorProvider(runtime) {
    return (runtime.session.model?.provider ?? "").toLowerCase() === "cursor";
}
/**
 * Drop copied Cursor local-resume handles from a forked Melon child session and
 * re-chain parentIds so the jsonl tree stays valid. Returns how many entries
 * were removed.
 */
export function stripCursorResumeEntriesFromSessionFile(sessionFile) {
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
        if (obj.type === "custom" && obj.customType === CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE) {
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
 * Register this card's session with pi-cursor-sdk before a Cursor prompt.
 * No-op when Cursor is not the active model or the extension is missing.
 *
 * Always re-supplies uiContext when provided: bindExtensions without it leaves
 * the previous context in place on AgentSession, but Melon can lose the card
 * panel wiring across resume/reattach paths — passing it every time is safe
 * because CardExtensionUiBridge.createUIContext() shares the same pending map.
 */
export async function activateCursorSessionBinding(runtime, options = {}) {
    if (!cursorExtensionPath() || !isCursorProvider(runtime))
        return;
    requireCursorHostSessionModule();
    // Re-emit session_start on THIS card's extension runner. The patched SDK
    // keys its bridge, scope and resume state off this event's sessionManager,
    // so the card is registered under its own session before it prompts.
    await runtime.session.bindExtensions({
        mode: "rpc",
        ...(options.uiContext ? { uiContext: options.uiContext } : {}),
    });
}
/**
 * Run a Cursor turn inside this card's session context, so every
 * `getRegisteredCursorPiToolBridge()` / scope / resume lookup the turn makes
 * resolves to THIS card even while a sibling card binds or streams.
 *
 * Missing isolation is a hard Cursor error. Falling back to the upstream
 * process globals would allow one card to execute another card's tools.
 */
export async function runInCursorSession(runtime, run) {
    if (!isCursorProvider(runtime))
        return run();
    const hostSession = requireCursorHostSessionModule();
    const sm = runtime.session.sessionManager;
    return hostSession.runInCursorHostSession({
        sessionFile: sm.getSessionFile?.(),
        sessionId: sm.getSessionId?.(),
        cwd: sm.getCwd?.(),
    }, run);
}
/**
 * Bind the card and run its prompt in one async session context. This closes
 * the small window where a sibling could bind between session_start and
 * prompt(), while leaving every non-Cursor provider's path unchanged.
 */
export async function runInBoundCursorSession(runtime, options, run) {
    if (!isCursorProvider(runtime))
        return run();
    return runInCursorSession(runtime, async () => {
        await activateCursorSessionBinding(runtime, options);
        return run();
    });
}
//# sourceMappingURL=cursor-session-binding.js.map