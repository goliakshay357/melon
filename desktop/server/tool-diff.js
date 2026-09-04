import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import * as Diff from "diff";
/** Canonical mutation kinds after stripping separators/case. */
const MUTATION_KINDS = new Set(["write", "writefile", "edit", "searchreplace", "strreplace"]);
const PATH_KEYS = ["path", "file_path", "file", "filePath"];
const OLD_TEXT_KEYS = ["oldText", "old_text", "oldString", "old_string", "oldStr", "old_str"];
const NEW_TEXT_KEYS = ["newText", "new_text", "newString", "new_string", "newStr", "new_str"];
const CONTENT_KEYS = ["content", "contents", "file_text", "fileText"];
const DIFF_DETAIL_KEYS = ["diffString", "diff", "unifiedDiff", "patch"];
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return undefined;
    return value;
}
function firstString(record, keys) {
    if (!record)
        return undefined;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === "string" && value.length > 0)
            return value;
    }
    return undefined;
}
/** Normalize Write / StrReplace / str_replace / search-replace → comparable token. */
export function normalizeMutationToolName(name) {
    return (name ?? "")
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, "");
}
export function isMutationTool(name) {
    return MUTATION_KINDS.has(normalizeMutationToolName(name));
}
export function resolveToolPath(cwd, args) {
    const record = asRecord(args);
    const raw = firstString(record, PATH_KEYS);
    if (!raw?.trim())
        return undefined;
    return isAbsolute(raw) ? raw : resolve(cwd, raw);
}
export function pathLabelFromArgs(args, fallback) {
    return firstString(asRecord(args), PATH_KEYS) ?? fallback;
}
/** Snapshot file contents before a write/edit mutates disk. */
export function readFileSnapshot(absolutePath) {
    try {
        return readFileSync(absolutePath, "utf8");
    }
    catch {
        return "";
    }
}
export function buildUnifiedDiff(pathLabel, before, after, maxChars = 12000) {
    if (before === after) {
        return `(no textual changes)\n${pathLabel}`;
    }
    const patch = Diff.createTwoFilesPatch(pathLabel, pathLabel, before, after, undefined, undefined, {
        context: 3,
    });
    // Drop the leading "Index:" / "====" noise; keep ---/+++ and hunks.
    const cleaned = patch
        .split("\n")
        .filter((line) => !line.startsWith("Index:") &&
        line !== "===================================================================")
        .join("\n")
        .trimEnd();
    if (cleaned.length <= maxChars)
        return cleaned;
    return `${cleaned.slice(0, maxChars)}\n…(+${cleaned.length - maxChars} chars truncated)`;
}
function withSummary(summary, diff) {
    const trimmed = summary.trim();
    return trimmed ? `${trimmed}\n\n${diff}` : diff;
}
/**
 * Pull a recorded unified diff from pi / Cursor tool results.
 * Cursor native write/edit replay stores diffs on `details` after disk is already mutated,
 * so Melon's before/after snapshot alone often shows "(no textual changes)".
 */
export function extractRecordedDiff(result) {
    const root = asRecord(result);
    if (!root)
        return undefined;
    const details = asRecord(root.details) ?? root;
    for (const key of DIFF_DETAIL_KEYS) {
        const value = details[key];
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return undefined;
}
export function extractRecordedWriteContent(result, args) {
    const root = asRecord(result);
    const details = asRecord(root?.details);
    const fromDetails = firstString(details, ["fileContentAfterWrite", ...CONTENT_KEYS]);
    if (fromDetails !== undefined)
        return fromDetails;
    return firstString(asRecord(args), CONTENT_KEYS);
}
function replacementFromRecord(record) {
    const oldText = firstString(record, OLD_TEXT_KEYS);
    const newText = firstString(record, NEW_TEXT_KEYS);
    if (oldText === undefined || newText === undefined)
        return undefined;
    return { oldText, newText };
}
/** Build a unified diff from StrReplace / edit args when Cursor did not attach details.diff. */
export function synthesizeEditDiffFromArgs(pathLabel, args) {
    const record = asRecord(args);
    if (!record)
        return undefined;
    const editsRaw = record.edits;
    if (Array.isArray(editsRaw) && editsRaw.length > 0) {
        const parts = [];
        for (const entry of editsRaw) {
            const pair = replacementFromRecord(asRecord(entry));
            if (!pair)
                continue;
            parts.push(buildUnifiedDiff(pathLabel, pair.oldText, pair.newText));
        }
        return parts.length > 0 ? parts.join("\n\n") : undefined;
    }
    const single = replacementFromRecord(record);
    if (!single)
        return undefined;
    return buildUnifiedDiff(pathLabel, single.oldText, single.newText);
}
export function mutationDiffOutput(opts) {
    const summary = opts.fallbackText;
    const label = pathLabelFromArgs(opts.args, resolveToolPath(opts.cwd, opts.args) ?? "file");
    const recorded = extractRecordedDiff(opts.result);
    if (recorded)
        return withSummary(summary, recorded);
    const fromArgs = synthesizeEditDiffFromArgs(label, opts.args);
    if (fromArgs && !fromArgs.startsWith("(no textual changes)")) {
        return withSummary(summary, fromArgs);
    }
    const abs = resolveToolPath(opts.cwd, opts.args);
    const afterDisk = abs ? readFileSnapshot(abs) : undefined;
    if (abs && afterDisk !== undefined && opts.before !== afterDisk) {
        return withSummary(summary, buildUnifiedDiff(label, opts.before, afterDisk));
    }
    // Cursor host Write often mutates disk before Melon snapshots, so before===after.
    // Fall back to recorded/arg content as an add-style patch so the card still shows the write.
    const writeContent = extractRecordedWriteContent(opts.result, opts.args);
    if (writeContent !== undefined) {
        const beforeForContent = opts.before === writeContent ? "" : opts.before;
        const diff = buildUnifiedDiff(label, beforeForContent, writeContent);
        if (!diff.startsWith("(no textual changes)"))
            return withSummary(summary, diff);
    }
    if (fromArgs)
        return withSummary(summary, fromArgs);
    if (abs && afterDisk !== undefined) {
        return withSummary(summary, buildUnifiedDiff(label, opts.before, afterDisk));
    }
    return summary;
}
//# sourceMappingURL=tool-diff.js.map