/**
 * Per-box inbox for Melon box↔box mail.
 *
 * Flow: send → pending on recipient → human Approve (or auto-approve) →
 * deliver to agent only after that card's user prompt queue is empty.
 * Ephemeral in-process store (same durability bar as promptQueue).
 */
import { type BoxMailEnvelope, type BoxMailEnvelopeInput } from "./box-mail-envelope.ts";
export type BoxInboxStatus = "pending" | "approved" | "delivered" | "dismissed";
export type BoxInboxDirection = "in" | "out";
export interface BoxInboxItem {
    id: string;
    direction: BoxInboxDirection;
    fromCardId: string;
    fromTitle: string;
    toCardId: string;
    toTitle: string;
    body: string;
    status: BoxInboxStatus;
    createdBy: "user" | "agent";
    createdAt: number;
    /** True when Settings boxMailAutoSend approved without a human click. */
    autoApproved?: boolean;
    /** Structured intent — reply policy, thread, hop (source of truth for gates). */
    envelope?: BoxMailEnvelope;
}
export declare function listBoxInbox(cardId: string): BoxInboxItem[];
/** Card ids that currently have an inbox list (for thread / parent scans). */
export declare function listBoxInboxCardIds(): string[];
export declare function pendingInboxCount(cardId: string): number;
export declare function getBoxInboxItem(cardId: string, mailId: string): BoxInboxItem | undefined;
/** Find a mail item by id across all inboxes (inbound or outbound id). */
export declare function findBoxMailById(mailId: string): BoxInboxItem | undefined;
/**
 * Latest inbound mail on `fromCardId` that came from `toCardId` (natural return parent).
 */
export declare function findLikelyParentMail(fromCardId: string, toCardId: string): BoxInboxItem | undefined;
/** True if this thread already has a hop≥1 mail (return already used). */
export declare function threadHasReturn(threadId: string): boolean;
/** True when some mail already lists `parentMailId` as its parent. */
export declare function parentHasChildReply(parentMailId: string): boolean;
export declare function enqueueBoxMail(args: {
    fromCardId: string;
    fromTitle: string;
    toCardId: string;
    toTitle: string;
    body: string;
    createdBy: "user" | "agent";
    envelope?: BoxMailEnvelopeInput | null;
    inReplyToMailId?: string | null;
    /** Auto-link parent when replyReason is set (B→A). */
    autoLinkParent?: boolean;
}): {
    inbound: BoxInboxItem;
    outbound: BoxInboxItem;
};
/** Mark inbound pending → approved. Returns the item or undefined if not eligible. */
export declare function approveBoxInboxItem(cardId: string, mailId: string, opts?: {
    auto?: boolean;
}): BoxInboxItem | undefined;
export declare function dismissBoxInboxItem(cardId: string, mailId: string): BoxInboxItem | undefined;
/** Oldest approved inbound not yet delivered. */
export declare function takeNextApprovedInbox(cardId: string): BoxInboxItem | undefined;
export declare function markBoxInboxDelivered(cardId: string, mailId: string): void;
/** Test / teardown helper. */
export declare function clearBoxInboxes(): void;
/** Visible inbox: pending inbound only (no sent history, no delivered rows). */
export declare function inboxSnapshot(cardId: string): {
    items: BoxInboxItem[];
    pendingCount: number;
};
//# sourceMappingURL=box-inbox.d.ts.map