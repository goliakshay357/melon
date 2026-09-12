// Melon send_to_box extension — agent-initiated box↔box mail (HITL by default).
//
// Pattern: A→B once; optional B→A once (replyReason). No A→B again on that thread.

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readAgentProfile } from "./agents.ts";
import { BOX_MAIL_REPLY_REASONS } from "./box-mail-envelope.ts";
import { cardIdForSessionId, emitBoxMailIntent, getBoxPeers, resolveBoxPeer } from "./box-mail-host.ts";

export const MELON_SEND_TO_BOX_TOOL_NAME = "send_to_box";

const SendToBoxParamsSchema = Type.Object({
	target: Type.String({
		description:
			"Who to message: another box's cardId, agent profile id, or instance short name (from the canvas boxes list in your system prompt).",
	}),
	message: Type.String({
		description: "What to send. Short, purposeful — like texting a teammate. No courtesy-only acks.",
	}),
	replyReason: Type.Optional(
		Type.String({
			description: `Only when replying to a box that mailed you: ${BOX_MAIL_REPLY_REASONS.join(" | ")}. Omit for a new A→B handoff.`,
		}),
	),
	inReplyToMailId: Type.Optional(
		Type.String({
			description: "Inbound mailId from the wake when replying. Prefer this over guessing.",
		}),
	),
});

function resolveFromCardId(ctx: ExtensionContext): string | undefined {
	try {
		return cardIdForSessionId(ctx.sessionManager.getSessionId());
	} catch {
		return undefined;
	}
}

function describePeers(cardId: string): string {
	const peers = getBoxPeers(cardId);
	if (peers.length === 0) {
		return "No other chat boxes are known on this canvas yet.";
	}
	return peers
		.map((p) => {
			const bits = [`${p.title} (cardId: ${p.cardId})`];
			if (p.agentProfileId) bits.push(`profile ${p.agentProfileId}`);
			if (p.agentInstanceName) bits.push(`instance ${p.agentInstanceName}`);
			if (p.status) bits.push(p.status);
			return `- ${bits.join(", ")}`;
		})
		.join("\n");
}

function textResult(text: string) {
	return {
		content: [{ type: "text" as const, text }],
		details: undefined,
	};
}

export default function melonSendToBoxExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: MELON_SEND_TO_BOX_TOOL_NAME,
		label: "Send to box",
		description:
			"Send a message to ANOTHER Melon canvas box (async inbox, Approve by default). Pattern: hand off A→B once; optional single reply B→A with replyReason. Do not mail back and forth further. No courtesy acks.",
		promptSnippet: "Message another canvas box (A→B once; optional one B→A reply)",
		executionMode: "sequential",
		parameters: SendToBoxParamsSchema,
		promptGuidelines: [
			"Use send_to_box to pass work to another box; do not invent shared transcripts.",
			"A→B once per handoff. Optional B→A reply only with replyReason + inReplyToMailId from the wake.",
			"Do not send a second A→B after they reply. Do not send thanks/ack-only mail.",
			"Address by cardId when possible.",
		],
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const fromCardId = resolveFromCardId(ctx);
			if (!fromCardId) {
				throw new Error("send_to_box is only available inside a Melon chat card.");
			}
			const p = params as {
				target?: string;
				message?: string;
				replyReason?: string;
				inReplyToMailId?: string;
			};
			const target = String(p.target ?? "").trim();
			const message = String(p.message ?? "").trim();
			if (!target) throw new Error("target is required.");
			if (!message) throw new Error("message is required.");

			const replyReason = typeof p.replyReason === "string" ? p.replyReason.trim() : "";
			const inReplyToMailId = typeof p.inReplyToMailId === "string" ? p.inReplyToMailId.trim() : "";
			const envelope: Record<string, unknown> = {};
			if (replyReason) envelope.replyReason = replyReason;
			if (inReplyToMailId) envelope.parentMailId = inReplyToMailId;

			const resolved = resolveBoxPeer(fromCardId, target);
			if (resolved.peer) {
				return textResult(
					emitBoxMailIntent({
						fromCardId,
						toCardId: resolved.peer.cardId,
						toProfileId: resolved.peer.agentProfileId,
						body: message,
						envelope: Object.keys(envelope).length ? envelope : undefined,
						inReplyToMailId: inReplyToMailId || undefined,
					}),
				);
			}

			const ambiguous = getBoxPeers(fromCardId).filter(
				(peer) => peer.agentProfileId?.toLowerCase() === target.toLowerCase(),
			);
			if (ambiguous.length > 1) {
				return textResult(
					[
						`Several boxes use profile "${target}" — pick one cardId:`,
						...ambiguous.map(
							(peer) => `- ${peer.title} (cardId: ${peer.cardId}, instance: ${peer.agentInstanceName ?? "—"})`,
						),
					].join("\n"),
				);
			}

			if (resolved.profileOnly) {
				if (!readAgentProfile(resolved.profileOnly)) {
					return textResult(
						[
							`No box or agent profile matched target "${target}".`,
							"Known boxes:",
							describePeers(fromCardId),
						].join("\n"),
					);
				}
				return textResult(
					emitBoxMailIntent({
						fromCardId,
						toProfileId: resolved.profileOnly,
						body: message,
						envelope: Object.keys(envelope).length ? envelope : undefined,
						inReplyToMailId: inReplyToMailId || undefined,
					}),
				);
			}

			return textResult(
				[
					`No box matched target "${target}".`,
					"Known boxes:",
					describePeers(fromCardId),
					"Or pass a Settings → Agents profile id to spawn one automatically.",
				].join("\n"),
			);
		},
	});
}
