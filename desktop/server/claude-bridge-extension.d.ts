import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
export declare const CLAUDE_BRIDGE_PROVIDER_ID = "claude-bridge";
/** Last Claude bridge catalog load outcome — exposed to GET /models for DBG. */
export type ClaudeBridgeCatalogStatus = {
    loaded: boolean;
    isolationAvailable: boolean;
    extensionPath: string | null;
    isolatedEntryPath: string | null;
    modelCount: number;
    /** Human-readable issues (missing package, isolation entry, …). */
    issues: string[];
};
export declare function getClaudeBridgeCatalogStatus(): ClaudeBridgeCatalogStatus;
/** Bundled @fractaal/pi-claude-bridge package dir, or null when not installed. */
export declare function claudeBridgeExtensionPath(): string | null;
/** Isolated Melon multi-card entry (bundle/isolated.js), or null. */
export declare function claudeBridgeIsolatedExtensionPath(): string | null;
/**
 * Claude bridge is safe in Melon's multi-card process only when the isolated
 * entry is present. Upstream's default package entry shares module state across
 * reloaded extension instances — do not use it for Melon sessions.
 */
export declare function claudeBridgeSessionIsolationAvailable(): boolean;
/**
 * Register the Claude bridge provider into a ModelRuntime (and refresh).
 * Intentionally does not run the full extension factory — the GUI catalog only
 * needs model ids for the picker. Sessions load bundle/isolated.js instead.
 */
export declare function loadClaudeBridgeProviderInto(runtime: ModelRuntime): Promise<void>;
/**
 * True when Melon has Claude subscription credentials usable for Claude Code.
 * Melon browser login stores OAuth under `claude-bridge` and/or `anthropic`;
 * applyClaudeBridgeRuntimeEnv exports the access token as CLAUDE_CODE_OAUTH_TOKEN.
 */
export declare function hasClaudeBridgeAuth(authEntries: Record<string, unknown>): boolean;
//# sourceMappingURL=claude-bridge-extension.d.ts.map