/**
 * Host-side box-mail glue for the send_to_box extension.
 * Bound per attached card; peers are synced from the Melon canvas client.
 */
export interface BoxPeer {
    cardId: string;
    title: string;
    agentProfileId?: string;
    agentInstanceName?: string;
    /** idle | thinking | error | offline — from canvas sync */
    status?: "idle" | "thinking" | "error" | "offline";
}
export type BoxMailIntentPayload = {
    type: "box_mail_intent";
    fromCardId: string;
    toCardId?: string;
    toProfileId?: string;
    body: string;
    createdBy: "agent";
    envelope?: Record<string, unknown>;
    inReplyToMailId?: string;
};
export declare function bindBoxMailHost(cardId: string, broadcast: (payload: BoxMailIntentPayload) => void, sessionId?: string): void;
export declare function unbindBoxMailHost(cardId: string): void;
export declare function cardIdForSessionId(sessionId: string | undefined): string | undefined;
export declare function setBoxPeers(cardId: string, peers: BoxPeer[]): void;
export declare function getBoxPeers(cardId: string): BoxPeer[];
export declare function formatBoxDirectory(peers: readonly BoxPeer[]): string;
export declare function resolveBoxPeer(cardId: string, target: string): {
    peer?: BoxPeer;
    match: "card" | "profile" | "instance" | "title" | "none";
    profileOnly?: string;
};
export declare function emitBoxMailIntent(args: {
    fromCardId: string;
    toCardId?: string;
    toProfileId?: string;
    body: string;
    envelope?: Record<string, unknown>;
    inReplyToMailId?: string;
}): string;
//# sourceMappingURL=box-mail-host.d.ts.map