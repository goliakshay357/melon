export declare function isMutationTool(name: string | undefined): boolean;
export declare function resolveToolPath(cwd: string, args: unknown): string | undefined;
/** Snapshot file contents before a write/edit mutates disk. */
export declare function readFileSnapshot(absolutePath: string): string;
export declare function buildUnifiedDiff(pathLabel: string, before: string, after: string, maxChars?: number): string;
export declare function mutationDiffOutput(opts: {
    cwd: string;
    toolName: string;
    args: unknown;
    before: string;
    fallbackText: string;
}): string;
//# sourceMappingURL=tool-diff.d.ts.map