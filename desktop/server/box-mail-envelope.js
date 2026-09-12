/**
 * Versioned mail intent envelope for box↔box messaging.
 *
 * Product rule (simple):
 *   A → B (once)
 *   B → A (optional, once, needs replyReason)
 *   no A → B again on that thread
 */
import { randomUUID } from "node:crypto";
export const BOX_MAIL_SCHEMA_VERSION = 1;
/** Hop 0 = A→B, hop 1 = optional B→A. No hop 2. */
export const BOX_MAIL_MAX_HOPS = 1;
export const BOX_MAIL_REPLY_POLICIES = ["never", "if_needed", "always_result"];
export const BOX_MAIL_REPLY_REASONS = [
    "blocked",
    "needs_decision",
    "deliverable_ready",
    "error_for_sender",
];
function isReplyPolicy(v) {
    return typeof v === "string" && BOX_MAIL_REPLY_POLICIES.includes(v);
}
function isReplyReason(v) {
    return typeof v === "string" && BOX_MAIL_REPLY_REASONS.includes(v);
}
export function newBoxMailThreadId() {
    return `thr_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}
export function coerceReplyPolicy(raw) {
    if (isReplyPolicy(raw))
        return raw;
    return "never";
}
export function parseReplyReason(raw) {
    if (raw === undefined || raw === null || raw === "")
        return undefined;
    if (!isReplyReason(raw)) {
        throw Object.assign(new Error(`invalid replyReason (allowed: ${BOX_MAIL_REPLY_REASONS.join(", ")})`), {
            statusCode: 400,
        });
    }
    return raw;
}
export function resolveAndAssertOutboundEnvelope(args) {
    const input = args.input ?? {};
    const parent = args.parent ?? null;
    const extras = {};
    for (const [k, v] of Object.entries(input)) {
        if (k === "schemaVersion" ||
            k === "threadId" ||
            k === "parentMailId" ||
            k === "hop" ||
            k === "replyPolicy" ||
            k === "replyReason") {
            continue;
        }
        extras[k] = v;
    }
    if (parent) {
        const parentEnv = parent.envelope;
        const parentHop = typeof parentEnv?.hop === "number" ? parentEnv.hop : 0;
        const hop = parentHop + 1;
        if (hop > BOX_MAIL_MAX_HOPS) {
            throw Object.assign(new Error("no further mail on this thread (A→B, optional B→A only) — user can @mention for a new ask"), { statusCode: 400 });
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
            throw Object.assign(new Error(`replyReason required for B→A (allowed: ${BOX_MAIL_REPLY_REASONS.join(", ")})`), { statusCode: 400 });
        }
        const threadId = parentEnv && typeof parentEnv.threadId === "string" && parentEnv.threadId.trim()
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
    let replyPolicy;
    if (rawPolicy === undefined || rawPolicy === null || rawPolicy === "") {
        replyPolicy = "if_needed";
    }
    else if (isReplyPolicy(rawPolicy)) {
        replyPolicy = rawPolicy;
    }
    else {
        replyPolicy = "never";
    }
    const threadId = typeof input.threadId === "string" && input.threadId.trim() ? input.threadId.trim() : newBoxMailThreadId();
    return {
        ...extras,
        schemaVersion: BOX_MAIL_SCHEMA_VERSION,
        threadId,
        hop: 0,
        replyPolicy,
    };
}
export function formatEnvelopeWakeLines(envelope, mailId) {
    const lines = [
        `Mail envelope: policy=${envelope.replyPolicy}; thread=${envelope.threadId}; hop=${envelope.hop}; mailId=${mailId}.`,
    ];
    if (envelope.replyPolicy === "never") {
        lines.push("Do NOT send_to_box back to the sender. Finish in this node and end the turn (no courtesy ack).");
    }
    else if (envelope.replyPolicy === "always_result") {
        lines.push("When finished, you may send ONE result back via send_to_box.", `Required: replyReason (${BOX_MAIL_REPLY_REASONS.join(" | ")}) and inReplyToMailId=${mailId}.`, "After that, stop — no further back-and-forth.");
    }
    else {
        lines.push("Optional: mail the sender back ONCE only if truly needed (blocked / needs_decision / deliverable_ready / error_for_sender).", `If you reply: replyReason + inReplyToMailId=${mailId}. Otherwise stay silent — no thanks/ack.`, "There is no second A→B after that.");
    }
    return lines;
}
export function envelopePolicyBadge(policy) {
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
//# sourceMappingURL=box-mail-envelope.js.map