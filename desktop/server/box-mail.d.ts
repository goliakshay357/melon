import type { BoxMailEnvelope } from "./box-mail-envelope.ts";
import type { SessionRegistry } from "./session-registry.ts";
export declare function boxMailOutboundText(args: {
    toTitle: string;
    toCardId: string;
    body: string;
}): string;
export declare function boxMailInboundText(args: {
    fromTitle: string;
    fromCardId: string;
    body: string;
}): string;
export declare function boxMailWakeText(args: {
    fromTitle: string;
    fromCardId: string;
    body: string;
    mailId?: string;
    envelope?: BoxMailEnvelope;
}): string;
export declare function boxMailWakeDisplay(fromTitle: string): string;
/** True when the session is mid-LLM-run (not merely a sticky Melon busy flag). */
export declare function sessionIsStreaming(registry: SessionRegistry, cardId: string): boolean;
/**
 * Inject inbound mail into the recipient transcript (visible).
 * Does NOT start an LLM turn — caller must wake via prompt or queue.
 */
export declare function injectBoxMailToRecipient(args: {
    registry: SessionRegistry;
    toCardId: string;
    fromTitle: string;
    fromCardId: string;
    body: string;
    mailId?: string;
    envelope?: BoxMailEnvelope;
}): Promise<{
    inboundText: string;
    wake: string;
    display: string;
}>;
/**
 * Queue a wake for when the recipient finishes its current turn.
 * Used only when the session is actually streaming / busy.
 */
export declare function queueBoxMailWake(args: {
    registry: SessionRegistry;
    toCardId: string;
    wake: string;
    display: string;
}): void;
/**
 * @deprecated Prefer injectBoxMailToRecipient + explicit wake.
 * Kept for call-site compatibility during transition.
 */
export declare function deliverBoxMailToRecipient(args: {
    registry: SessionRegistry;
    toCardId: string;
    fromTitle: string;
    fromCardId: string;
    body: string;
    mailId?: string;
    envelope?: BoxMailEnvelope;
}): Promise<{
    delivery: "queued" | "ready";
    wake: string;
    display: string;
    wakeQueued: boolean;
}>;
/** Record outbound on the sender transcript (visible, no wake). */
export declare function recordBoxMailOutbound(args: {
    registry: SessionRegistry;
    fromCardId: string;
    toTitle: string;
    toCardId: string;
    body: string;
    mailId?: string;
    envelope?: BoxMailEnvelope;
}): Promise<void>;
//# sourceMappingURL=box-mail.d.ts.map