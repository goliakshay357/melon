import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-extension.js";
import { CLAUDE_BRIDGE_PROVIDER_ID } from "./claude-bridge-extension.js";
import { CURSOR_PROVIDER_ID } from "./cursor-extension.js";
export function queueDisplays(queue) {
    return queue.map((q) => q.display ?? q.text);
}
function providerId(session) {
    return (session.runtime.session.model?.provider ?? "").toLowerCase();
}
/** Providers that require Melon per-card isolation (attach locks, turn tokens, …). */
export function isIsolationSensitiveSession(session) {
    const id = providerId(session);
    return id === CURSOR_PROVIDER_ID || id === CLAUDE_BRIDGE_PROVIDER_ID || id === ANTIGRAVITY_PROVIDER_ID;
}
export function isCursorSession(session) {
    return providerId(session) === CURSOR_PROVIDER_ID;
}
export function isClaudeBridgeSession(session) {
    return providerId(session) === CLAUDE_BRIDGE_PROVIDER_ID;
}
export function isAntigravitySession(session) {
    return providerId(session) === ANTIGRAVITY_PROVIDER_ID;
}
/**
 * Claim an isolation-sensitive card synchronously before prompt() can yield.
 * Returns undefined for ordinary providers (caller sets busy itself).
 */
export function beginIsolationTurn(session) {
    if (!isIsolationSensitiveSession(session))
        return undefined;
    const turnId = (session.isolationTurnId ?? session.cursorTurnId ?? 0) + 1;
    session.isolationTurnId = turnId;
    session.cursorTurnId = turnId;
    session.busy = true;
    return turnId;
}
/** @deprecated Prefer beginIsolationTurn — Cursor-named alias. */
export function beginCursorTurn(session) {
    return beginIsolationTurn(session);
}
export function abortCurrentIsolationTurn(session) {
    if (!isIsolationSensitiveSession(session))
        return;
    const turnId = session.isolationTurnId ?? session.cursorTurnId;
    if (turnId === undefined)
        return;
    session.isolationAbortedTurnId = turnId;
    session.cursorAbortedTurnId = turnId;
}
/** @deprecated Prefer abortCurrentIsolationTurn. */
export function abortCurrentCursorTurn(session) {
    abortCurrentIsolationTurn(session);
}
export function isIsolationTurnAborted(session, turnId) {
    return (session.isolationAbortedTurnId ?? session.cursorAbortedTurnId) === turnId;
}
/** @deprecated Prefer isIsolationTurnAborted. */
export function isCursorTurnAborted(session, turnId) {
    return isIsolationTurnAborted(session, turnId);
}
export function isCurrentIsolationTurn(session, turnId) {
    return (session.isolationTurnId ?? session.cursorTurnId) === turnId;
}
/** @deprecated Prefer isCurrentIsolationTurn. */
export function isCurrentCursorTurn(session, turnId) {
    return isCurrentIsolationTurn(session, turnId);
}
export class SessionRegistry {
    sessions = new Map();
    set(cardId, session) {
        this.sessions.set(cardId, session);
    }
    get(cardId) {
        return this.sessions.get(cardId);
    }
    entries() {
        return this.sessions.entries();
    }
    delete(cardId) {
        this.sessions.delete(cardId);
    }
    /// Comment frames keep streams alive and surface dead sockets.
    pingAll() {
        for (const s of this.sessions.values()) {
            for (const client of s.clients) {
                client.raw.write(`: ping\n\n`);
            }
        }
    }
    broadcast(cardId, payload) {
        const s = this.sessions.get(cardId);
        if (!s)
            return;
        for (const client of s.clients) {
            client.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
        }
    }
}
//# sourceMappingURL=session-registry.js.map