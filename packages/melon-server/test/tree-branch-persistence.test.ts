// RCA: pi's navigateTree moves the in-memory leaf only. Nothing is written to the
// session file, so a reopened session (and /transcript, which reopens the file)
// snaps the leaf back to the old tail and the next prompt continues from the
// wrong place. Appending a hidden custom entry persists the new leaf.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-branch-agent-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const sessionDir = mkdtempSync(join(tmpdir(), "melon-branch-sessions-"));
const cwd = mkdtempSync(join(tmpdir(), "melon-branch-cwd-"));

const { SessionManager } = await import("@earendil-works/pi-coding-agent");

function userMsg(text: string) {
	return { role: "user" as const, content: text, timestamp: Date.now() };
}
function assistantMsg(text: string) {
	return {
		role: "assistant" as const,
		content: [{ type: "text" as const, text }],
		api: "anthropic-messages" as const,
		provider: "anthropic",
		model: "test",
		usage: {
			input: 1,
			output: 1,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 2,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop" as const,
		timestamp: Date.now(),
	};
}

function messageCount(sm: { buildContextEntries: () => unknown[] }): number {
	return sm.buildContextEntries().filter((e) => (e as { type?: string }).type === "message").length;
}

/** u1 -> a1 -> u2 -> a2, then branch back to just after a1. */
function seedBranched() {
	const sm = SessionManager.create(cwd, sessionDir);
	sm.appendMessage(userMsg("u1"));
	const a1 = sm.appendMessage(assistantMsg("a1"));
	sm.appendMessage(userMsg("u2"));
	sm.appendMessage(assistantMsg("a2"));
	return { sm, a1, file: sm.getSessionFile() as string };
}

describe("in-place edit branch persistence", () => {
	it("branch() alone is lost on reopen (the bug)", () => {
		const { sm, a1, file } = seedBranched();
		sm.branch(a1);
		expect(messageCount(sm)).toBe(2);

		const reopened = SessionManager.open(file);
		// Leaf snapped back to the last file entry, so the old tail is back.
		expect(messageCount(reopened)).toBe(4);
	});

	it("a hidden custom entry persists the branch without entering context", () => {
		const { sm, a1, file } = seedBranched();
		sm.branch(a1);
		const marker = sm.appendCustomEntry("melon.branch");
		expect(sm.getLeafId()).toBe(marker);

		const reopened = SessionManager.open(file);
		expect(reopened.getLeafId()).toBe(marker);
		expect(messageCount(reopened)).toBe(2);
		// The marker is a `custom` entry, not a `custom_message`, so it never becomes
		// a chat message in the transcript or the LLM context.
		const becameMessage = reopened
			.buildContextEntries()
			.some((e) => (e as { type?: string }).type === "custom_message");
		expect(becameMessage).toBe(false);
	});
});
