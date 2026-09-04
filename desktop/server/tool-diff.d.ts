/** Normalize Write / StrReplace / str_replace / search-replace → comparable token. */
export declare function normalizeMutationToolName(name: string | undefined): string;
export declare function isMutationTool(name: string | undefined): boolean;
export declare function resolveToolPath(cwd: string, args: unknown): string | undefined;
export declare function pathLabelFromArgs(args: unknown, fallback: string): string;
/** Snapshot file contents before a write/edit mutates disk. */
export declare function readFileSnapshot(absolutePath: string): string;
export declare function buildUnifiedDiff(pathLabel: string, before: string, after: string, maxChars?: number): string;
/**
 * Pull a recorded unified diff from pi / Cursor tool results.
 * Cursor native write/edit replay stores diffs on `details` after disk is already mutated,
 * so Melon's before/after snapshot alone often shows "(no textual changes)".
 */
export declare function extractRecordedDiff(result: unknown): string | undefined;
export declare function extractRecordedWriteContent(result: unknown, args: unknown): string | undefined;
/** Build a unified diff from StrReplace / edit args when Cursor did not attach details.diff. */
export declare function synthesizeEditDiffFromArgs(pathLabel: string, args: unknown): string | undefined;
export declare function mutationDiffOutput(opts: {
    cwd: string;
    toolName: string;
    args: unknown;
    before: string;
    fallbackText: string;
    /** Raw tool_execution_end result (may include Cursor/pi `details`). */
    result?: unknown;
}): string;
//# sourceMappingURL=tool-diff.d.ts.map