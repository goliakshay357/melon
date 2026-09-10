/** Agent SDK / Claude Code reads this for subscription OAuth (Melon browser login). */
export declare const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
export type ClaudeBridgeRuntimeStatus = {
    isolationAvailable: boolean;
    executableFound: boolean;
    executablePath: string | null;
    oauthTokenPresent: boolean;
    /** True when Melon can attempt a Claude Code turn (isolation + binary + Melon OAuth). */
    ready: boolean;
    issues: string[];
};
/** Directories Melon prepends so GUI-launched servers still find Claude Code. */
export declare function claudeBridgeExtraPathDirs(): string[];
/**
 * Ensure common Claude install locations are on PATH (idempotent).
 * Appends missing dirs so an explicit PATH (tests / user overrides) still wins.
 * Electron `desktop/main.mjs` also prepends ~/.local/bin for GUI-thin PATH.
 */
export declare function augmentPathForClaudeCode(env?: NodeJS.ProcessEnv): string;
/** Resolve the Claude Code binary Melon will spawn (after PATH augmentation). */
export declare function resolveMelonClaudeCodeExecutable(env?: NodeJS.ProcessEnv, configuredPath?: string): string | null;
/** Access token from Melon claude-bridge or anthropic OAuth (browser login). */
export declare function readClaudeBridgeAccessToken(): string | null;
/**
 * Apply Melon PATH + OAuth into `env` so Claude Agent SDK / Claude Code can run.
 * Safe to call repeatedly (e.g. before each Claude prompt after token refresh).
 */
export declare function applyClaudeBridgeRuntimeEnv(env?: NodeJS.ProcessEnv): ClaudeBridgeRuntimeStatus;
/** Snapshot readiness without mutating env (still may augment PATH for the probe). */
export declare function getClaudeBridgeRuntimeStatus(env?: NodeJS.ProcessEnv): ClaudeBridgeRuntimeStatus;
/**
 * Hard-fail before attaching or prompting a Claude card when local preflight fails.
 * Does not validate the token with Anthropic (subscription may be inactive).
 */
export declare function requireClaudeBridgeRuntimeReady(env?: NodeJS.ProcessEnv): ClaudeBridgeRuntimeStatus;
/** True when Melon auth.json has Claude OAuth (same as picker configured). */
export declare function melonHasClaudeBridgeOAuth(): boolean;
/** Absolute dir of the resolved Claude binary's parent, if any (for diagnostics). */
export declare function claudeBridgeExecutableDir(env?: NodeJS.ProcessEnv): string | null;
//# sourceMappingURL=claude-bridge-runtime.d.ts.map