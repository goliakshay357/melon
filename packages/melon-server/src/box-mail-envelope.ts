/**
 * Versioned mail intent envelope for box↔box messaging.
 *
 * Product rule (simple):
 *   A → B (once)
 *   B → A (optional, once, needs replyReason)
 *   no A → B again on that thread
 */

import { randomUUID } from "node:crypto";

export const BOX_MAIL_SCHEMA_VERSION = 1 as const;
export type BoxMailSchemaVersion = typeof BOX_MAIL_SCHEMA_VERSION;

/** Hop 0 = A→B, hop 1 = optional B→A. No hop 2. */
export const BOX_MAIL_MAX_HOPS = 1;

export type BoxMailReplyPolicy = "never" | "if_needed" | "always_result";

export type BoxMailReplyReason = "blocked" | "needs_decision" | "deliverable_ready" | "error_for_sender";

export const BOX_MAIL_REPLY_POLICIES: readonly BoxMailReplyPolicy[] = ["never", "if_needed", "always_result"] as const;

export const BOX_MAIL_REPLY_REASONS: readonly BoxMailReplyReason[] = [
	"blocked",
	"needs_decision",
	"deliverable_ready",
	"error_for_sender",
] as const;

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

function isReplyPolicy(v: unknown): v is BoxMailReplyPolicy {
	return typeof v === "string" && (BOX_MAIL_REPLY_POLICIES as readonly string[]).includes(v);
}

function isReplyReason(v: unknown): v is BoxMailReplyReason {
	return typeof v === "string" && (BOX_MAIL_REPLY_REASONS as readonly string[]).includes(v);
}

export function newBoxMailThreadId(): string {
	return `thr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function coerceReplyPolicy(raw: unknown): BoxMailReplyPolicy {
	if (isReplyPolicy(raw)) return raw;
	return "never";
}

export function parseReplyReason(raw: unknown): BoxMailReplyReason | undefined {
	if (raw === undefined || raw === null || raw === "") return undefined;
	if (!isReplyReason(raw)) {
		throw Object.assign(new Error(`invalid replyReason (allowed: ${BOX_MAIL_REPLY_REASONS.join(", ")})`), {
			statusCode: 400,
		});
	}
	return raw;
}

export type ResolveEnvelopeArgs = {
	input?: BoxMailEnvelopeInput | null;
	parent?: BoxMailParentRef | null;
	parentAlreadyHasReply?: boolean;
};

export function resolveAndAssertOutboundEnvelope(args: ResolveEnvelopeArgs): BoxMailEnvelope {
	const input = args.input ?? {};
	const parent = args.parent ?? null;

	const extras: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(input)) {
		if (
			k === "schemaVersion" ||
			k === "threadId" ||
			k === "parentMailId" ||
			k === "hop" ||
			k === "replyPolicy" ||
			k === "replyReason"
		) {
			continue;
		}
		extras[k] = v;
	}

	if (parent) {
		const parentEnv = parent.envelope;
		const parentHop = typeof parentEnv?.hop === "number" ? parentEnv.hop : 0;
		const hop = parentHop + 1;
		if (hop > BOX_MAIL_MAX_HOPS) {
			throw Object.assign(
				new Error("no further mail on this thread (A→B, optional B→A only) — user can @mention for a new ask"),
				{ statusCode: 400 },
			);
		}
		const parentPolicy = parentEnv ? coerceReplyPolicy(parentEnv.replyPolicy) : "if_needed";
		if (parentPolicy === "never") {
			throw Object.assign(new Error("parent mail replyPolicy is never — replies are blocked"), {
				statusCode: 400,
			});
		}
		if (args.parentAlreadyHasReply) {
			throw Object.assign(new Error("this mail already has a reply — do not send another"), {
				statusCode: 400,
			});
		}
		const replyReason = parseReplyReason(input.replyReason);
		if (!replyReason) {
			throw Object.assign(
				new Error(`replyReason required for B→A (allowed: ${BOX_MAIL_REPLY_REASONS.join(", ")})`),
				{ statusCode: 400 },
			);
		}
		const threadId =
			parentEnv && typeof parentEnv.threadId === "string" && parentEnv.threadId.trim()
				? parentEnv.threadId
				: newBoxMailThreadId();

		// B→A closes the thread — A must not mail B again on it.
		return {
			...extras,
			schemaVersion: BOX_MAIL_SCHEMA_VERSION,
			threadId,
			parentMailId: parent.id,
			hop,
			replyPolicy: "never",
			replyReason,
		};
	}

	const rawPolicy = input.replyPolicy;
	let replyPolicy: BoxMailReplyPolicy;
	if (rawPolicy === undefined || rawPolicy === null || rawPolicy === "") {
		replyPolicy = "if_needed";
	} else if (isReplyPolicy(rawPolicy)) {
		replyPolicy = rawPolicy;
	} else {
		replyPolicy = "never";
	}
	const threadId =
		typeof input.threadId === "string" && input.threadId.trim() ? input.threadId.trim() : newBoxMailThreadId();
	return {
		...extras,
		schemaVersion: BOX_MAIL_SCHEMA_VERSION,
		threadId,
		hop: 0,
		replyPolicy,
	};
}

export function formatEnvelopeWakeLines(envelope: BoxMailEnvelope, mailId: string): string[] {
	const lines = [
		`Mail envelope: policy=${envelope.replyPolicy}; thread=${envelope.threadId}; hop=${envelope.hop}; mailId=${mailId}.`,
	];
	if (envelope.replyPolicy === "never") {
		lines.push("Do NOT send_to_box back to the sender. Finish in this box and end the turn (no courtesy ack).");
	} else if (envelope.replyPolicy === "always_result") {
		lines.push(
			"When finished, you may send ONE result back via send_to_box.",
			`Required: replyReason (${BOX_MAIL_REPLY_REASONS.join(" | ")}) and inReplyToMailId=${mailId}.`,
			"After that, stop — no further back-and-forth.",
		);
	} else {
		lines.push(
			"Optional: mail the sender back ONCE only if truly needed (blocked / needs_decision / deliverable_ready / error_for_sender).",
			`If you reply: replyReason + inReplyToMailId=${mailId}. Otherwise stay silent — no thanks/ack.`,
			"There is no second A→B after that.",
		);
	}
	return lines;
}

export function envelopePolicyBadge(policy: BoxMailReplyPolicy | undefined): string {
	switch (policy) {
		case "never":
			return "no reply";
		case "always_result":
			return "result expected";
		case "if_needed":
			return "if needed";
		default:
			return "if needed";
	}
}
