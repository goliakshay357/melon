export function isCursorSession(session) {
    return (session.runtime.session.model?.provider ?? "").toLowerCase() === "cursor";
}
/** Claim a Cursor card synchronously before prompt() can yield. */
export function beginCursorTurn(session) {
    if (!isCursorSession(session))
        return undefined;
    const turnId = (session.cursorTurnId ?? 0) + 1;
    session.cursorTurnId = turnId;
    session.busy = true;
    return turnId;
}
export function abortCurrentCursorTurn(session) {
    if (isCursorSession(session) && session.cursorTurnId !== undefined) {
        session.cursorAbortedTurnId = session.cursorTurnId;
    }
}
export function isCursorTurnAborted(session, turnId) {
    return session.cursorAbortedTurnId === turnId;
}
export function isCurrentCursorTurn(session, turnId) {
    return session.cursorTurnId === turnId;
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