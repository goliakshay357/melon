export interface ToolDiffStore {
    version: 1;
    /** callId → enriched tool output (includes Melon unified diff). */
    byCallId: Record<string, string>;
}
export declare function loadToolDiffStore(sessionFile: string): ToolDiffStore;
export declare function saveToolDiff(sessionFile: string, callId: string, output: string): void;
export declare function lookupToolDiff(sessionFile: string, callId: string | undefined): string | undefined;
//# sourceMappingURL=tool-diff-store.d.ts.map