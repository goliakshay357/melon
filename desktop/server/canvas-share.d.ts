/**
 * Guided "send for review" for an isolated canvas copy.
 *
 * Product: one canvas → one checkout. Sharing commits that checkout,
 * pushes its branch, and opens a review request. Callers must require
 * an explicit confirm flag before invoking shareCanvasWork.
 */
export type ShareFileChange = "added" | "changed" | "removed";
export interface ShareFile {
    path: string;
    change: ShareFileChange;
}
export interface CanvasShareStatus {
    mode: "isolated" | "local";
    worktreePath: string;
    branch?: string;
    baseBranch?: string;
    exists: boolean;
    hasChanges: boolean;
    ahead: number;
    behind: number;
    files: ShareFile[];
    summary: string;
    canShare: boolean;
    blockedReason?: string;
    prUrl?: string;
}
export interface ShareCanvasOptions {
    confirm: boolean;
    title: string;
    note?: string;
    worktreePath: string;
    branch: string;
    baseBranch: string;
    prUrl?: string;
}
export interface ShareCanvasResult {
    ok: boolean;
    committed: boolean;
    published: boolean;
    prUrl?: string;
    summary: string;
    error?: string;
}
export declare function parsePorcelain(stdout: string): ShareFile[];
export declare function inspectCanvasShare(input: {
    projectRoot: string;
    mode: "isolated" | "local";
    worktreePath: string;
    branch?: string;
    baseBranch?: string;
    prUrl?: string;
}): Promise<CanvasShareStatus>;
export declare function shareCanvasWork(projectRoot: string, options: ShareCanvasOptions): Promise<ShareCanvasResult>;
//# sourceMappingURL=canvas-share.d.ts.map