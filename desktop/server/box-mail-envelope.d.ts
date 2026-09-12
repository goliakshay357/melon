/**
 * Versioned mail intent envelope for box↔box messaging.
 *
 * Product rule (simple):
 *   A → B (once)
 *   B → A (optional, once, needs replyReason)
 *   no A → B again on that thread
 */
export declare const BOX_MAIL_SCHEMA_VERSION: 1;
export type BoxMailSchemaVersion = typeof BOX_MAIL_SCHEMA_VERSION;
/** Hop 0 = A→B, hop 1 = optional B→A. No hop 2. */
export declare const BOX_MAIL_MAX_HOPS = 1;
export type BoxMailReplyPolicy = "never" | "if_needed" | "always_result";
export type BoxMailReplyReason = "blocked" | "needs_decision" | "deliverable_ready" | "error_for_sender";
export declare const BOX_MAIL_REPLY_POLICIES: readonly BoxMailReplyPolicy[];
export declare const BOX_MAIL_REPLY_REASONS: readonly BoxMailReplyReason[];
export interface BoxMailEnvelope {
    schemaVersion: BoxMailSchemaVersion;
    threadId: string;
    parentMailId?: string;
    hop: number;
    replyPolicy: BoxMailReplyPolicy;
    replyReason?: BoxMailReplyReason;
    [key: string]: unknown;
}
export type BoxMailEnvelopeInput = {
    schemaVersion?: unknown;
    threadId?: unknown;
    parentMailId?: unknown;
    hop?: unknown;
    replyPolicy?: unknown;
    replyReason?: unknown;
    [key: string]: unknown;
};
export type BoxMailParentRef = {
    id: string;
    envelope?: BoxMailEnvelope;
};
export declare function newBoxMailThreadId(): string;
export declare function coerceReplyPolicy(raw: unknown): BoxMailReplyPolicy;
export declare function parseReplyReason(raw: unknown): BoxMailReplyReason | undefined;
export type ResolveEnvelopeArgs = {
    input?: BoxMailEnvelopeInput | null;
    parent?: BoxMailParentRef | null;
    parentAlreadyHasReply?: boolean;
};
export declare function resolveAndAssertOutboundEnvelope(args: ResolveEnvelopeArgs): BoxMailEnvelope;
export declare function formatEnvelopeWakeLines(envelope: BoxMailEnvelope, mailId: string): string[];
export declare function envelopePolicyBadge(policy: BoxMailReplyPolicy | undefined): string;
//# sourceMappingURL=box-mail-envelope.d.ts.map