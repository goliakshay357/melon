import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ANTIGRAVITY_SESSION_CUSTOM_TYPE,
	stripAntigravitySessionEntriesFromSessionFile,
} from "../src/antigravity-session-binding.ts";

describe("stripAntigravitySessionEntriesFromSessionFile", () => {
	it("removes antigravity-session customs and re-chains parentIds", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-antigravity-fork-strip-"));
		const file = join(dir, "child.jsonl");
		writeFileSync(
			file,
			[
				JSON.stringify({ type: "session", id: "s1", cwd: dir, timestamp: "t0", version: 1 }),
				JSON.stringify({
					type: "custom",
					customType: ANTIGRAVITY_SESSION_CUSTOM_TYPE,
					id: "c1",
					parentId: null,
					timestamp: "t1",
				}),
				JSON.stringify({ type: "message", id: "m1", parentId: "c1", timestamp: "t2", role: "user" }),
				JSON.stringify({ type: "message", id: "m2", parentId: "m1", timestamp: "t3", role: "assistant" }),
			].join("\n") + "\n",
		);
		expect(stripAntigravitySessionEntriesFromSessionFile(file)).toBe(1);
		const out = readFileSync(file, "utf8")
			.trim()
			.split("\n")
			.map((l) => JSON.parse(l) as { type?: string; id?: string; parentId?: string | null; customType?: string });
		expect(out).toHaveLength(3);
		expect(out[0].type).toBe("session");
		expect(out[1]).toMatchObject({ id: "m1", parentId: null });
		expect(out[2]).toMatchObject({ id: "m2", parentId: "m1" });
		expect(out.some((e) => e.customType === ANTIGRAVITY_SESSION_CUSTOM_TYPE)).toBe(false);
	});

	it("is a no-op when no antigravity session entries exist", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-antigravity-fork-strip-"));
		const file = join(dir, "child.jsonl");
		const before =
			[
				JSON.stringify({ type: "session", id: "s1", cwd: dir, timestamp: "t0", version: 1 }),
				JSON.stringify({ type: "message", id: "m1", parentId: null, timestamp: "t1", role: "user" }),
			].join("\n") + "\n";
		writeFileSync(file, before);
		expect(stripAntigravitySessionEntriesFromSessionFile(file)).toBe(0);
		expect(readFileSync(file, "utf8")).toBe(before);
	});
});
