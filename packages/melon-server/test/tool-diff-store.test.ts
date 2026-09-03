import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadToolDiffStore, lookupToolDiff, saveToolDiff } from "../src/tool-diff-store.ts";

describe("tool-diff-store", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const d of dirs) {
			try {
				rmSync(d, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		dirs.length = 0;
	});

	it("persists and reloads diffs by callId", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-diff-"));
		dirs.push(dir);
		const sessionFile = join(dir, "session.jsonl");
		saveToolDiff(sessionFile, "call_1", "Successfully wrote…\n\n--- a\n+++ b\n+hello");
		expect(lookupToolDiff(sessionFile, "call_1")).toContain("+hello");
		expect(lookupToolDiff(sessionFile, "missing")).toBeUndefined();
		const store = loadToolDiffStore(sessionFile);
		expect(store.byCallId.call_1).toContain("+hello");
		const sidecar = readFileSync(`${sessionFile}.melon-tool-diffs.json`, "utf8");
		expect(sidecar).toContain("call_1");
	});
});
