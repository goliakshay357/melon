import * as Diff from "diff";
import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const MUTATION_TOOLS = new Set(["write", "edit", "write_file", "search_replace", "str_replace"]);

export function isMutationTool(name: string | undefined): boolean {
	return Boolean(name && MUTATION_TOOLS.has(name.trim().toLowerCase()));
}

export function resolveToolPath(cwd: string, args: unknown): string | undefined {
	if (!args || typeof args !== "object" || Array.isArray(args)) return undefined;
	const record = args as Record<string, unknown>;
	const raw = record.path ?? record.file_path ?? record.file;
	if (typeof raw !== "string" || !raw.trim()) return undefined;
	return isAbsolute(raw) ? raw : resolve(cwd, raw);
}

/** Snapshot file contents before a write/edit mutates disk. */
export function readFileSnapshot(absolutePath: string): string {
	try {
		return readFileSync(absolutePath, "utf8");
	} catch {
		return "";
	}
}

export function buildUnifiedDiff(pathLabel: string, before: string, after: string, maxChars = 12000): string {
	if (before === after) {
		return `(no textual changes)\n${pathLabel}`;
	}
	const patch = Diff.createTwoFilesPatch(pathLabel, pathLabel, before, after, undefined, undefined, {
		context: 3,
	});
	// Drop the leading "Index:" / "====" noise; keep ---/+++ and hunks.
	const cleaned = patch
		.split("\n")
		.filter((line) => !line.startsWith("Index:") && line !== "===================================================================")
		.join("\n")
		.trimEnd();
	if (cleaned.length <= maxChars) return cleaned;
	return `${cleaned.slice(0, maxChars)}\n…(+${cleaned.length - maxChars} chars truncated)`;
}

export function mutationDiffOutput(opts: {
	cwd: string;
	toolName: string;
	args: unknown;
	before: string;
	fallbackText: string;
}): string {
	const abs = resolveToolPath(opts.cwd, opts.args);
	if (!abs) return opts.fallbackText;
	const after = readFileSnapshot(abs);
	const label =
		typeof (opts.args as { path?: unknown } | null)?.path === "string"
			? String((opts.args as { path: string }).path)
			: abs;
	const diff = buildUnifiedDiff(label, opts.before, after);
	// Keep a one-line summary above the patch so the card still shows intent.
	const summary = opts.fallbackText.trim();
	return summary ? `${summary}\n\n${diff}` : diff;
}
