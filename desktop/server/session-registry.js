export class SessionRegistry {
    sessions = new Map();
    set(cardId, session) {
        this.sessions.set(cardId, session);
    }
    get(cardId) {
        return this.sessions.get(cardId);
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