/**
 * Canvas git worktree isolation (1code-style).
 *
 * Layout:
 *   <projectRoot>/.melon/canvases/<id>.json   — canvas identity (unchanged)
 *   <projectRoot>/.melon/worktrees/<name>/    — per-canvas checkout (agent cwd)
 *
 * One canvas → one worktree → one dedicated branch. Cards on a canvas share
 * that worktree. Non-git folders fall back to Local (agent cwd = projectRoot).
 */
export declare function worktreesDir(projectRoot: string): string;
/** True when `dir` is itself a Melon canvas checkout (opening it as a project would nest). */
export declare function isInsideMelonWorktrees(dir: string): boolean;
export declare function isMelonWorktreePath(projectRoot: string, path: string): boolean;
export declare function generateBranchName(): string;
export declare function generateWorktreeFolderName(parentDir: string): string;
export declare function gitIn(cwd: string, args: string[], timeout?: number): Promise<string>;
/** Serialize mutating git ops for one project so canvases don't fight locks. */
export declare function withProjectGitLock<T>(projectRoot: string, fn: () => Promise<T>): Promise<T>;
export declare function isGitRepo(projectRoot: string): Promise<boolean>;
/** Resolve the repo's default branch (local or origin HEAD). */
export declare function getDefaultBranch(projectRoot: string): Promise<string>;
export interface WorktreeResult {
    success: boolean;
    /** Agent cwd: worktree path, or projectRoot when Local. */
    worktreePath: string;
    branch?: string;
    baseBranch?: string;
    /** isolated = real worktree; local = editing projectRoot directly */
    mode: "isolated" | "local";
    error?: string;
}
export interface CreateWorktreeOptions {
    baseBranch?: string;
    /** When false, skip worktree and use projectRoot (1code useWorktree=false). */
    useWorktree?: boolean;
    /** Reuse this canvas's existing checkout/branch when still valid. */
    existing?: {
        worktreePath?: string | null;
        branch?: string | null;
        baseBranch?: string | null;
    };
}
/** Create or repair a worktree for a canvas; serialized per projectRoot. */
export declare function createWorktreeForCanvas(projectRoot: string, options?: CreateWorktreeOptions): Promise<WorktreeResult>;
export declare function ensureWorktreeForCanvas(projectRoot: string, options?: CreateWorktreeOptions): Promise<WorktreeResult>;
export declare function removeWorktree(projectRoot: string, worktreePath: string): Promise<{
    success: boolean;
    error?: string;
}>;
/** List registered melon worktree paths under projectRoot (for diagnostics). */
export declare function listMelonWorktreeDirs(projectRoot: string): string[];
//# sourceMappingURL=worktree.d.ts.map