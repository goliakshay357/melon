import { formatEnvelopeWakeLines } from "./box-mail-envelope.js";
import { queueDisplays } from "./session-registry.js";
export function boxMailOutboundText(args) {
    return `[Node mail → ${args.toTitle} (${args.toCardId})]\n\n${args.body.trim()}`;
}
export function boxMailInboundText(args) {
    return `[Node mail from ${args.fromTitle} (${args.fromCardId})]\n\n${args.body.trim()}`;
}
export function boxMailWakeText(args) {
    const lines = [
        "[box-mail] A message just arrived from another node on this canvas (via inbox).",
        `From: ${args.fromTitle} (id: ${args.fromCardId}).`,
        "This is another Melon chat node reaching out — not the user typing here.",
        "",
        args.body.trim(),
        "",
    ];
    if (args.envelope && args.mailId) {
        lines.push(...formatEnvelopeWakeLines(args.envelope, args.mailId));
    }
    else {
        lines.push("Handle it under your standing instructions. Do the work in this node. Optional: one send_to_box back to the sender only if truly needed (with replyReason). No further ping-pong.");
    }
    return lines.join("\n");
}
export function boxMailWakeDisplay(fromTitle) {
    return `[node mail from ${fromTitle}]`;
}
/** True when the session is mid-LLM-run (not merely a sticky Melon busy flag). */
export function sessionIsStreaming(registry, cardId) {
    const s = registry.get(cardId);
    try {
        return Boolean(s?.runtime?.session?.isStreaming);
    }
    catch {
        return false;
    }
}
/**
 * Inject inbound mail into the recipient transcript (visible).
 * Does NOT start an LLM turn — caller must wake via prompt or queue.
 */
export async function injectBoxMailToRecipient(args) {
    const s = args.registry.get(args.toCardId);
    if (!s)
        throw Object.assign(new Error("recipient not attached"), { statusCode: 404 });
    const inboundText = boxMailInboundText({
        fromTitle: args.fromTitle,
        fromCardId: args.fromCardId,
        body: args.body,
    });
    const custom = {
        customType: "melon.box_mail",
        content: [{ type: "text", text: inboundText }],
        display: true,
        details: {
            fromCardId: args.fromCardId,
            ...(args.mailId ? { mailId: args.mailId } : {}),
            ...(args.envelope ? { envelope: args.envelope } : {}),
        },
    };
    const streaming = sessionIsStreaming(args.registry, args.toCardId);
    if (streaming || s.busy) {
        await s.runtime.session.sendCustomMessage(custom, { deliverAs: "nextTurn" });
    }
    else {
        await s.runtime.session.sendCustomMessage(custom, {});
    }
    args.registry.broadcast(args.toCardId, {
        type: "box_mail_injected",
        fromCardId: args.fromCardId,
        text: inboundText,
        ...(args.mailId ? { mailId: args.mailId } : {}),
        ...(args.envelope ? { envelope: args.envelope } : {}),
    });
    const wake = boxMailWakeText({
        fromTitle: args.fromTitle,
        fromCardId: args.fromCardId,
        body: args.body,
        mailId: args.mailId,
        envelope: args.envelope,
    });
    const display = boxMailWakeDisplay(args.fromTitle);
    return { inboundText, wake, display };
}
/**
 * Queue a wake for when the recipient finishes its current turn.
 * Used only when the session is actually streaming / busy.
 */
export function queueBoxMailWake(args) {
    const s = args.registry.get(args.toCardId);
    if (!s)
        throw Object.assign(new Error("recipient not attached"), { statusCode: 404 });
    s.promptQueue.push({ text: args.wake, display: args.display });
    args.registry.broadcast(args.toCardId, {
        type: "queue",
        followUp: queueDisplays(s.promptQueue),
    });
}
/**
 * @deprecated Prefer injectBoxMailToRecipient + explicit wake.
 * Kept for call-site compatibility during transition.
 */
export async function deliverBoxMailToRecipient(args) {
    const s = args.registry.get(args.toCardId);
    if (!s)
        throw Object.assign(new Error("recipient not attached"), { statusCode: 404 });
    const streaming = sessionIsStreaming(args.registry, args.toCardId);
    // Sticky Melon busy without an active run — heal so idle wakes can run.
    if (s.busy && !streaming && !s.draining) {
        s.busy = false;
    }
    const { wake, display } = await injectBoxMailToRecipient(args);
    const reallyBusy = streaming || s.busy || Boolean(s.draining);
    if (reallyBusy) {
        queueBoxMailWake({ registry: args.registry, toCardId: args.toCardId, wake, display });
        return { delivery: "queued", wake, display, wakeQueued: true };
    }
    return { delivery: "ready", wake, display, wakeQueued: false };
}
/** Record outbound on the sender transcript (visible, no wake). */
export async function recordBoxMailOutbound(args) {
    const s = args.registry.get(args.fromCardId);
    if (!s)
        throw Object.assign(new Error("sender not attached"), { statusCode: 404 });
    const outbound = boxMailOutboundText({
        toTitle: args.toTitle,
        toCardId: args.toCardId,
        body: args.body,
    });
    const custom = {
        customType: "melon.box_mail_out",
        content: [{ type: "text", text: outbound }],
        display: true,
        details: {
            toCardId: args.toCardId,
            ...(args.mailId ? { mailId: args.mailId } : {}),
            ...(args.envelope ? { envelope: args.envelope } : {}),
        },
    };
    await s.runtime.session.sendCustomMessage(custom, {});
    args.registry.broadcast(args.fromCardId, {
        type: "box_mail_outbound",
        toCardId: args.toCardId,
        text: outbound,
        ...(args.mailId ? { mailId: args.mailId } : {}),
        ...(args.envelope ? { envelope: args.envelope } : {}),
    });
}
//# sourceMappingURL=box-mail.js.map