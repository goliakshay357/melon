/**
 * Host-side box-mail glue for the send_to_box extension.
 * Bound per attached card; peers are synced from the Melon canvas client.
 */
const byCardId = new Map();
/** sessionManager.getSessionId() → Melon card id (extensions only see the session). */
const cardIdBySessionId = new Map();
export function bindBoxMailHost(cardId, broadcast, sessionId) {
    const existing = byCardId.get(cardId);
    byCardId.set(cardId, {
        cardId,
        peers: existing?.peers ?? [],
        broadcast,
    });
    if (sessionId)
        cardIdBySessionId.set(sessionId, cardId);
}
export function unbindBoxMailHost(cardId) {
    byCardId.delete(cardId);
    for (const [sessionId, id] of cardIdBySessionId) {
        if (id === cardId)
            cardIdBySessionId.delete(sessionId);
    }
}
export function cardIdForSessionId(sessionId) {
    if (!sessionId)
        return undefined;
    return cardIdBySessionId.get(sessionId);
}
export function setBoxPeers(cardId, peers) {
    const binding = byCardId.get(cardId);
    if (!binding) {
        byCardId.set(cardId, {
            cardId,
            peers: peers.filter((p) => p.cardId !== cardId),
            broadcast: () => { },
        });
        return;
    }
    binding.peers = peers.filter((p) => p.cardId !== cardId);
}
export function getBoxPeers(cardId) {
    return byCardId.get(cardId)?.peers ?? [];
}
export function formatBoxDirectory(peers) {
    if (peers.length === 0) {
        return [
            "Canvas nodes you can message with send_to_box:",
            "(none yet — the user can spawn specialized boxes via right-click → Agents)",
        ].join("\n");
    }
    const lines = [
        "Canvas nodes you can message with send_to_box (async; lands in their inbox for human approve by default):",
        "Pass target as card id, profile id, or instance short name.",
        "Pattern: A→B once; optional one B→A with replyReason + inReplyToMailId. No second A→B.",
    ];
    for (const peer of peers.slice(0, 40)) {
        const bits = [`- ${peer.title || peer.cardId} (cardId: ${peer.cardId})`];
        if (peer.agentProfileId)
            bits.push(`profile: ${peer.agentProfileId}`);
        if (peer.agentInstanceName)
            bits.push(`instance: ${peer.agentInstanceName}`);
        if (peer.status)
            bits.push(`status: ${peer.status}`);
        lines.push(bits.join(" · "));
    }
    return lines.join("\n");
}
export function resolveBoxPeer(cardId, target) {
    const raw = target.trim();
    if (!raw)
        return { match: "none" };
    const peers = getBoxPeers(cardId);
    const lower = raw.toLowerCase();
    const byId = peers.find((p) => p.cardId === raw);
    if (byId)
        return { peer: byId, match: "card" };
    const byInstance = peers.find((p) => p.agentInstanceName?.toLowerCase() === lower);
    if (byInstance)
        return { peer: byInstance, match: "instance" };
    const byProfileExact = peers.filter((p) => p.agentProfileId?.toLowerCase() === lower);
    if (byProfileExact.length === 1)
        return { peer: byProfileExact[0], match: "profile" };
    if (byProfileExact.length > 1)
        return { match: "none" }; // ambiguous — caller lists them
    const byTitle = peers.find((p) => p.title.toLowerCase().includes(lower));
    if (byTitle)
        return { peer: byTitle, match: "title" };
    // Profile may exist in Settings but no box on canvas yet — client will spawn.
    // Exclude Melon card ids (`card_…`) so unsynced peers aren't misread as profiles.
    if (!raw.startsWith("card_") && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(raw)) {
        return { match: "none", profileOnly: raw };
    }
    return { match: "none" };
}
export function emitBoxMailIntent(args) {
    const binding = byCardId.get(args.fromCardId);
    if (!binding || binding.broadcast === undefined) {
        throw new Error("Node mail host is not bound for this card.");
    }
    const body = args.body.trim();
    if (!body)
        throw new Error("Message was empty; nothing was drafted.");
    if (!args.toCardId && !args.toProfileId) {
        throw new Error("Need a target card id or profile id.");
    }
    binding.broadcast({
        type: "box_mail_intent",
        fromCardId: args.fromCardId,
        ...(args.toCardId ? { toCardId: args.toCardId } : {}),
        ...(args.toProfileId ? { toProfileId: args.toProfileId } : {}),
        body,
        createdBy: "agent",
        ...(args.envelope && Object.keys(args.envelope).length > 0 ? { envelope: args.envelope } : {}),
        ...(args.inReplyToMailId ? { inReplyToMailId: args.inReplyToMailId } : {}),
    });
    const who = args.toCardId ?? args.toProfileId ?? "target";
    return `Queued mail to ${who}'s inbox. Delivery is asynchronous — the user approves it in that box's inbox (or auto-approve if enabled), then the agent wakes. You will not get a reply in this turn; if they reply later it arrives as a separate inbox message.`;
}
//# sourceMappingURL=box-mail-host.js.map