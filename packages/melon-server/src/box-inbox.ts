/**
 * Per-box inbox for Melon box↔box mail.
 *
 * Flow: send → pending on recipient → human Approve (or auto-approve) →
 * deliver to agent only after that card's user prompt queue is empty.
 * Ephemeral in-process store (same durability bar as promptQueue).
 */

import { randomUUID } from "node:crypto";
import {
	type BoxMailEnvelope,
	type BoxMailEnvelopeInput,
	resolveAndAssertOutboundEnvelope,
} from "./box-mail-envelope.ts";

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

/** cardId → items (newest last). */
const inboxByCard = new Map<string, BoxInboxItem[]>();

function listMutable(cardId: string): BoxInboxItem[] {
	let list = inboxByCard.get(cardId);
	if (!list) {
		list = [];
		inboxByCard.set(cardId, list);
	}
	return list;
}

export function listBoxInbox(cardId: string): BoxInboxItem[] {
	return [...(inboxByCard.get(cardId) ?? [])];
}

/** Card ids that currently have an inbox list (for thread / parent scans). */
export function listBoxInboxCardIds(): string[] {
	return [...inboxByCard.keys()];
}

export function pendingInboxCount(cardId: string): number {
	return (inboxByCard.get(cardId) ?? []).filter((i) => i.direction === "in" && i.status === "pending").length;
}

export function getBoxInboxItem(cardId: string, mailId: string): BoxInboxItem | undefined {
	return (inboxByCard.get(cardId) ?? []).find((i) => i.id === mailId);
}

/** Find a mail item by id across all inboxes (inbound or outbound id). */
export function findBoxMailById(mailId: string): BoxInboxItem | undefined {
	const id = mailId.trim();
	if (!id) return undefined;
	const inboundId = id.endsWith("_out") ? id.slice(0, -4) : id;
	for (const cardId of inboxByCard.keys()) {
		const hit = getBoxInboxItem(cardId, inboundId) ?? getBoxInboxItem(cardId, id);
		if (hit) return hit;
	}
	return undefined;
}

/**
 * Latest inbound mail on `fromCardId` that came from `toCardId` (natural return parent).
 */
export function findLikelyParentMail(fromCardId: string, toCardId: string): BoxInboxItem | undefined {
	const items = listBoxInbox(fromCardId)
		.filter(
			(i) =>
				i.direction === "in" &&
				i.fromCardId === toCardId &&
				(i.status === "delivered" || i.status === "approved" || i.status === "pending"),
		)
		.sort((a, b) => b.createdAt - a.createdAt);
	return items[0];
}

/** True if this thread already has a hop≥1 mail (return already used). */
export function threadHasReturn(threadId: string): boolean {
	const tid = threadId.trim();
	if (!tid) return false;
	const seen = new Set<string>();
	for (const cardId of inboxByCard.keys()) {
		for (const item of listBoxInbox(cardId)) {
			const key = item.id.endsWith("_out") ? item.id.slice(0, -4) : item.id;
			if (seen.has(key)) continue;
			seen.add(key);
			const env = item.envelope;
			if (!env || env.threadId !== tid) continue;
			if (typeof env.hop === "number" && env.hop >= 1) return true;
		}
	}
	return false;
}

/** True when some mail already lists `parentMailId` as its parent. */
export function parentHasChildReply(parentMailId: string): boolean {
	const pid = parentMailId.trim();
	if (!pid) return false;
	const seen = new Set<string>();
	for (const cardId of inboxByCard.keys()) {
		for (const item of listBoxInbox(cardId)) {
			const key = item.id.endsWith("_out") ? item.id.slice(0, -4) : item.id;
			if (seen.has(key)) continue;
			seen.add(key);
			if (item.envelope?.parentMailId === pid) return true;
		}
	}
	return false;
}

export function enqueueBoxMail(args: {
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
}): { inbound: BoxInboxItem; outbound: BoxInboxItem } {
	const body = args.body.trim();
	if (!body) throw Object.assign(new Error("body required"), { statusCode: 400 });

	const explicitParentId =
		(typeof args.inReplyToMailId === "string" && args.inReplyToMailId.trim()) ||
		(typeof args.envelope?.parentMailId === "string" && String(args.envelope.parentMailId).trim()) ||
		"";
	const hasReplyReason =
		typeof args.envelope?.replyReason === "string" && String(args.envelope.replyReason).trim().length > 0;
	const autoLink = args.autoLinkParent ?? hasReplyReason;

	let parent = explicitParentId ? findBoxMailById(explicitParentId) : undefined;
	if (explicitParentId && !parent) {
		throw Object.assign(new Error(`unknown parent mail: ${explicitParentId}`), { statusCode: 400 });
	}
	if (!parent && autoLink) {
		parent = findLikelyParentMail(args.fromCardId, args.toCardId);
		if (!parent) {
			throw Object.assign(new Error("replyReason set but no prior mail from that box to reply to"), {
				statusCode: 400,
			});
		}
	}

	// Agent must not open a fresh hop-0 to someone who just mailed them —
	// optional B→A goes through replyReason / inReplyToMailId only.
	if (!parent && args.createdBy === "agent" && findLikelyParentMail(args.fromCardId, args.toCardId)) {
		throw Object.assign(
			new Error(
				"to reply to the sender, set replyReason (and inReplyToMailId); do not start a new A→B the other way",
			),
			{ statusCode: 400 },
		);
	}

	// Fresh A→B: at most one outbound to that peer until they optionally replied
	// (thread closed). Then a new ask is allowed.
	if (!parent) {
		const priorOut = listBoxInbox(args.fromCardId).some(
			(i) =>
				i.direction === "out" &&
				i.toCardId === args.toCardId &&
				(i.status === "delivered" || i.status === "pending" || i.status === "approved"),
		);
		if (priorOut) {
			const gotReturn = findLikelyParentMail(args.fromCardId, args.toCardId);
			const returnHop = gotReturn?.envelope?.hop;
			const threadClosed = typeof returnHop === "number" && returnHop >= 1;
			if (!threadClosed) {
				throw Object.assign(
					new Error(
						"already mailed that box once — no second A→B; they may optionally reply B→A, then you can @ again",
					),
					{ statusCode: 400 },
				);
			}
		}
	}

	const envelope = resolveAndAssertOutboundEnvelope({
		input: args.envelope,
		parent: parent ? { id: parent.id, envelope: parent.envelope } : null,
		parentAlreadyHasReply: parent ? parentHasChildReply(parent.id) : false,
	});

	const createdAt = Date.now();
	const id = `mail_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

	const inbound: BoxInboxItem = {
		id,
		direction: "in",
		fromCardId: args.fromCardId,
		fromTitle: args.fromTitle,
		toCardId: args.toCardId,
		toTitle: args.toTitle,
		body,
		status: "pending",
		createdBy: args.createdBy,
		createdAt,
		envelope,
	};
	const outbound: BoxInboxItem = {
		id: `${id}_out`,
		direction: "out",
		fromCardId: args.fromCardId,
		fromTitle: args.fromTitle,
		toCardId: args.toCardId,
		toTitle: args.toTitle,
		body,
		status: "delivered",
		createdBy: args.createdBy,
		createdAt,
		envelope,
	};

	listMutable(args.toCardId).push(inbound);
	listMutable(args.fromCardId).push(outbound);
	return { inbound, outbound };
}

/** Mark inbound pending → approved. Returns the item or undefined if not eligible. */
export function approveBoxInboxItem(
	cardId: string,
	mailId: string,
	opts?: { auto?: boolean },
): BoxInboxItem | undefined {
	const item = getBoxInboxItem(cardId, mailId);
	if (!item || item.direction !== "in" || item.status !== "pending") return undefined;
	item.status = "approved";
	if (opts?.auto) item.autoApproved = true;
	return item;
}

export function dismissBoxInboxItem(cardId: string, mailId: string): BoxInboxItem | undefined {
	const list = inboxByCard.get(cardId);
	if (!list) return undefined;
	const idx = list.findIndex((i) => i.id === mailId);
	if (idx < 0) return undefined;
	const item = list[idx]!;
	if (item.direction !== "in" || item.status !== "pending") return undefined;
	item.status = "dismissed";
	// Inbox UI is pending-only — drop dismissed rows from the card list.
	list.splice(idx, 1);
	return item;
}

/** Oldest approved inbound not yet delivered. */
export function takeNextApprovedInbox(cardId: string): BoxInboxItem | undefined {
	const item = (inboxByCard.get(cardId) ?? []).find((i) => i.direction === "in" && i.status === "approved");
	return item;
}

export function markBoxInboxDelivered(cardId: string, mailId: string): void {
	const list = inboxByCard.get(cardId);
	if (!list) return;
	const idx = list.findIndex((i) => i.id === mailId);
	if (idx < 0) return;
	const item = list[idx]!;
	if (item.direction !== "in") return;
	item.status = "delivered";
	// Keep a ledger copy for hop/thread gates, but off the visible inbox list:
	// move delivered inbound to a side bag keyed by card… actually we still need
	// findLikelyParentMail to see it. Leave in list; snapshot filters it out.
}

/** Test / teardown helper. */
export function clearBoxInboxes(): void {
	inboxByCard.clear();
}

/** Visible inbox: pending inbound only (no sent history, no delivered rows). */
export function inboxSnapshot(cardId: string): {
	items: BoxInboxItem[];
	pendingCount: number;
} {
	const items = listBoxInbox(cardId).filter((i) => i.direction === "in" && i.status === "pending");
	return {
		items,
		pendingCount: items.length,
	};
}
