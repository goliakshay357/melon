import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";
import { cursorHostSessionScopeKey, isCursorHostSessionIsolationEnabled } from "./cursor-host-session.js";
import { disposeSessionCursorAgent, invalidateSessionAgent, resetSessionCursorAgent, } from "./cursor-session-agent.js";
const liveCursorSessionScopeKeys = new Set();
function contextScopeKey(ctx) {
    return cursorHostSessionScopeKey({
        sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? undefined,
        sessionId: ctx?.sessionManager?.getSessionId?.() ?? undefined,
    });
}
/**
 * Scope key of the session that fired the event. Returns undefined outside
 * host isolation so the SDK keeps using its own default (the last-bound
 * session) — under isolation these lifecycle events must only ever affect the
 * card they came from.
 */
function eventScopeKey(ctx) {
    if (!isCursorHostSessionIsolationEnabled())
        return undefined;
    return contextScopeKey(ctx);
}
export function registerCursorSessionAgentLifecycle(pi) {
    let runnerScopeKey;
    pi.on("session_start", (_event, ctx) => {
        const nextScopeKey = contextScopeKey(ctx);
        if (runnerScopeKey && runnerScopeKey !== nextScopeKey)
            liveCursorSessionScopeKeys.delete(runnerScopeKey);
        runnerScopeKey = nextScopeKey;
        liveCursorSessionScopeKeys.add(nextScopeKey);
    });
    onCursorSessionScopeKeyChange(async (previousScopeKey) => {
        await disposeSessionCursorAgent(previousScopeKey);
    });
    pi.on("session_shutdown", async (event, ctx) => {
        const scopeKey = eventScopeKey(ctx);
        try {
            if (event.reason === "reload") {
                await resetSessionCursorAgent(scopeKey);
                return;
            }
            await disposeSessionCursorAgent(scopeKey);
        }
        finally {
            liveCursorSessionScopeKeys.delete(contextScopeKey(ctx));
            if (runnerScopeKey)
                liveCursorSessionScopeKeys.delete(runnerScopeKey);
            runnerScopeKey = undefined;
            // Cursor.configure is process-global. Clearing it while a sibling
            // session is alive changes that sibling's transport mid-turn.
            if (!isCursorHostSessionIsolationEnabled() || liveCursorSessionScopeKeys.size === 0) {
                clearCursorSdkHttp1();
            }
        }
    });
    pi.on("session_compact", (_event, ctx) => {
        invalidateSessionAgent(eventScopeKey(ctx));
    });
    pi.on("session_before_tree", (_event, ctx) => {
        invalidateSessionAgent(eventScopeKey(ctx));
    });
    pi.on("session_tree", async (_event, ctx) => {
        await resetSessionCursorAgent(eventScopeKey(ctx));
    });
    pi.on("model_select", (_event, ctx) => {
        invalidateSessionAgent(eventScopeKey(ctx));
    });
}
export const __testUtils = {
    getLiveSessionCount() {
        return liveCursorSessionScopeKeys.size;
    },
    resetLiveSessions() {
        liveCursorSessionScopeKeys.clear();
    },
};
