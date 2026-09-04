import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	extractRecordedDiff,
	isMutationTool,
	mutationDiffOutput,
	resolveToolPath,
	synthesizeEditDiffFromArgs,
} from "../src/tool-diff.ts";

describe("tool-diff Cursor / Melon mutation cards", () => {
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

	it("treats Cursor Write / StrReplace names as mutation tools", () => {
		expect(isMutationTool("Write")).toBe(true);
		expect(isMutationTool("StrReplace")).toBe(true);
		expect(isMutationTool("str_replace")).toBe(true);
		expect(isMutationTool("search-replace")).toBe(true);
		expect(isMutationTool("write_file")).toBe(true);
		expect(isMutationTool("bash")).toBe(false);
	});

	it("resolves Cursor filePath args", () => {
		expect(resolveToolPath("/repo", { filePath: "src/a.ts" })).toBe(join("/repo", "src/a.ts"));
	});

	it("prefers recorded Cursor details.diffString over a no-op disk snapshot", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-tool-diff-"));
		dirs.push(dir);
		const file = join(dir, "a.ts");
		writeFileSync(file, "after\n");
		const out = mutationDiffOutput({
			cwd: dir,
			toolName: "edit",
			args: { path: "a.ts" },
			before: "after\n",
			fallbackText: "edit ok",
			result: {
				content: [{ type: "text", text: "edit ok" }],
				details: {
					variant: "nativeEdit",
					diffString: "--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-before\n+after\n",
				},
			},
		});
		expect(out).toContain("edit ok");
		expect(out).toContain("-before");
		expect(out).toContain("+after");
		expect(out).not.toContain("(no textual changes)");
	});

	it("synthesizes a StrReplace diff from old_string / new_string when Cursor left no details", () => {
		const synth = synthesizeEditDiffFromArgs("f.ts", {
			path: "f.ts",
			old_string: "hello",
			new_string: "world",
		});
		expect(synth).toContain("-hello");
		expect(synth).toContain("+world");

		const out = mutationDiffOutput({
			cwd: "/tmp",
			toolName: "StrReplace",
			args: { path: "f.ts", old_string: "hello", new_string: "world" },
			before: "world",
			fallbackText: "ok",
			result: { content: [{ type: "text", text: "ok" }] },
		});
		expect(out).toContain("-hello");
		expect(out).toContain("+world");
	});

	it("shows Write content as a diff when disk before===after (Cursor already wrote)", () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-tool-diff-"));
		dirs.push(dir);
		mkdirSync(dir, { recursive: true });
		const file = join(dir, "new.ts");
		const content = "export const x = 1;\n";
		writeFileSync(file, content);
		const out = mutationDiffOutput({
			cwd: dir,
			toolName: "Write",
			args: { path: "new.ts", content },
			before: content,
			fallbackText: "Successfully wrote",
			result: {
				content: [{ type: "text", text: "Successfully wrote" }],
				details: { variant: "nativeWrite", fileContentAfterWrite: content },
			},
		});
		expect(out).toContain("+export const x = 1;");
		expect(out).not.toContain("(no textual changes)");
	});

	it("extractRecordedDiff reads nested details", () => {
		expect(
			extractRecordedDiff({
				details: { diff: "--- a\n+++ b\n+line\n" },
			}),
		).toContain("+line");
	});
});
