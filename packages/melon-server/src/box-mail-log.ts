// Box-mail event log — the shareable audit trail for the delegation flow.
//
// Every stage of card↔card mail (send, spawn-delivery, edit, approve,
// deliver) appends one JSON line to <agentDir>/logs/box-mail.log, so a broken
// handoff can be diagnosed from a single file the user can paste or attach.
// Fail-open: logging must never break the mail flow.

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** First N chars of a mail body in logs — enough to identify, not a transcript. */
export function mailBodyPreview(body: string, max = 200): string {
	const text = body.replace(/\s+/g, " ").trim();
	return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function boxMailFileLog(event: string, fields: Record<string, unknown> = {}): void {
	try {
		const dir = join(getAgentDir(), "logs");
		mkdirSync(dir, { recursive: true });
		appendFileSync(
			join(dir, "box-mail.log"),
			`${JSON.stringify({ ts: new Date().toISOString(), event, ...fields })}\n`,
		);
	} catch {
		/* ignore */
	}
}
