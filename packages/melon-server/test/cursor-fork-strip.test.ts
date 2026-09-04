import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE,
	stripCursorResumeEntriesFromSessionFile,
} from "../src/cursor-session-binding.ts";

describe("stripCursorResumeEntriesFromSessionFile", () => {
	it("removes cursor resume customs and re-chains parentIds", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-fork-strip-"));
		const file = join(dir, "child.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess-child",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: "/tmp",
				parentSession: "/tmp/parent.jsonl",
			}),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
			}),
			JSON.stringify({
				type: "custom",
				id: "c-resume",
				parentId: "m1",
				timestamp: "2026-01-01T00:00:02.000Z",
				customType: CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE,
				data: { agentId: "agent-abc" },
			}),
			JSON.stringify({
				type: "message",
				id: "m2",
				parentId: "c-resume",
				timestamp: "2026-01-01T00:00:03.000Z",
				message: { role: "assistant", content: [{ type: "text", text: "yo" }], timestamp: 2 },
			}),
		];
		writeFileSync(file, `${lines.join("\n")}\n`);

		expect(stripCursorResumeEntriesFromSessionFile(file)).toBe(1);

		const out = readFileSync(file, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as Record<string, unknown>);
		expect(out).toHaveLength(3);
		expect(out[0].type).toBe("session");
		expect(out[1]).toMatchObject({ id: "m1", parentId: null });
		expect(out[2]).toMatchObject({ id: "m2", parentId: "m1" });
		expect(out.some((e) => e.customType === CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE)).toBe(false);
	});

	it("is a no-op when no resume entries exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-fork-strip-"));
		const file = join(dir, "plain.jsonl");
		const lines = [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "sess",
				timestamp: "2026-01-01T00:00:00.000Z",
				cwd: "/tmp",
			}),
			JSON.stringify({
				type: "message",
				id: "m1",
				parentId: null,
				timestamp: "2026-01-01T00:00:01.000Z",
				message: { role: "user", content: [], timestamp: 1 },
			}),
		];
		writeFileSync(file, `${lines.join("\n")}\n`);
		const before = readFileSync(file, "utf8");
		expect(stripCursorResumeEntriesFromSessionFile(file)).toBe(0);
		expect(readFileSync(file, "utf8")).toBe(before);
	});
});
