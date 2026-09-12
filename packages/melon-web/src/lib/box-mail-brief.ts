/**
 * Box-mail handoff helpers.
 *
 * @agent: distill on the *sender* (model explores / decides), then send_to_box.
 * /send: still packs a quick template brief (escape hatch for raw mail).
 */

import { expandMentions } from "@/lib/input-parser";
import type { ChatMessage, SessionCard } from "@/types/session-card";

const MAX_CONTEXT_CHARS = 12_000;
const MAX_MESSAGES = 12;

/** Only `[box-mail]` lines — keep the console quiet while debugging mail/@agent. */
export function boxMailLog(...args: unknown[]): void {
	console.log("[box-mail]", ...args);
}

function clip(text: string, max: number): string {
	const t = text.trim();
	if (t.length <= max) return t;
	return `${t.slice(0, max)}\n… (truncated)`;
}

function recentTranscript(messages: ChatMessage[]): string {
	const slice = messages.filter((m) => m.role === "user" || m.role === "assistant").slice(-MAX_MESSAGES);
	if (slice.length === 0) return "(no prior messages on the sender box)";
	const lines: string[] = [];
	let used = 0;
	for (const m of slice) {
		const role = m.role === "user" ? "User" : "Assistant";
		const body = clip(m.text ?? "", 1_600);
		const block = `### ${role}\n${body}`;
		if (used + block.length > MAX_CONTEXT_CHARS) {
			lines.push("… (earlier turns omitted)");
			break;
		}
		lines.push(block);
		used += block.length;
	}
	return lines.join("\n\n");
}

/** Strip one @token occurrence (case-insensitive) from composer text. */
export function stripMentionToken(text: string, token: string): string {
	const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const re = new RegExp(`(^|[\\s([])@${escaped}(?=[\\s.,;:!?\\)\\]]|$)`, "i");
	return text
		.replace(re, "$1")
		.replace(/[ \t]{2,}/g, " ")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/**
 * Hidden context for the *sender* model when the user @mentions another box.
 * User-visible transcript keeps the original @ line; this drives distill → send_to_box.
 */
export function buildHandoffDistillContext(opts: { from: SessionCard; to: SessionCard; userText: string }): string {
	const request = opts.userText.trim() || "(no extra instruction — infer from this node's conversation)";
	const targetLabel = opts.to.title || opts.to.id;
	const instance = opts.to.agentInstanceName?.trim();
	const profile = opts.to.agentProfileId?.trim();
	boxMailLog("buildDistillContext", {
		from: opts.from.id,
		to: opts.to.id,
		requestChars: request.length,
	});
	return [
		"[melon-handoff] The user wants you to hand work to ANOTHER Melon canvas node.",
		"Do not answer the user's request yourself as the final deliverable — prepare a handoff and mail it.",
		"",
		"## Target node",
		`- title: ${targetLabel}`,
		`- cardId: ${opts.to.id}  (prefer this as send_to_box target)`,
		instance ? `- instance: ${instance}` : null,
		profile ? `- profile: ${profile}` : null,
		"",
		"## User request (for the other node)",
		request,
		"",
		"## Your job this turn",
		"1. Figure out what the recipient must do. Read the repo / decide only as far as needed to write a clear brief.",
		'2. Write a short, high-signal message: goal, constraints, key facts, relevant paths, what "done" looks like. Synthesize — do NOT paste this chat.',
		"3. Call send_to_box once with target set to the cardId (or instance) above and message set to that brief.",
		"4. Pattern: A→B once. They may optionally reply once. Do not plan a second A→B.",
		"5. After send_to_box succeeds, tell the user in one short line that mail is waiting in their inbox for Approve.",
		"",
		"If you cannot form a useful brief, say so here and do not call send_to_box.",
	]
		.filter((line): line is string => line !== null)
		.join("\n");
}

/**
 * Quick template brief for /send (raw mail escape hatch).
 * Prefer @agent distill path for thoughtful handoffs.
 */
export async function buildBoxMailBrief(opts: {
	from: SessionCard;
	to: SessionCard;
	userText: string;
	fileMentions: string[];
	cwds: Array<string | null>;
}): Promise<string> {
	const request = opts.userText.trim() || "(no extra instruction — use the context below)";
	boxMailLog("buildBrief", {
		from: opts.from.id,
		to: opts.to.id,
		requestChars: request.length,
		fileMentions: opts.fileMentions,
		priorMsgs: opts.from.messages.length,
	});
	const filesBlock =
		opts.fileMentions.length > 0 ? await expandMentions("## Attached files", opts.fileMentions, opts.cwds) : "";
	const parts = [
		`[Task mail from node "${opts.from.title || opts.from.id}" → "${opts.to.title || opts.to.id}"]`,
		"",
		"## Request",
		"",
		request,
		"",
		"## Why / context",
		"",
		"The recipient node is a separate session. Below is recent conversation from the sender so you know what to do and why.",
		"",
		"## Recent conversation (sender)",
		"",
		recentTranscript(opts.from.messages),
	];
	if (filesBlock) {
		parts.push("", filesBlock);
	}
	parts.push(
		"",
		"## Instructions for you",
		"",
		"Treat the Request as your job. Use the context and attached files as reference. Optional: one mail back to the sender if truly needed; otherwise finish here.",
	);
	const brief = parts.join("\n");
	boxMailLog("buildBrief done", { briefChars: brief.length });
	return brief;
}
