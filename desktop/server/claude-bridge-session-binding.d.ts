import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
/** Persisted Claude Code session marker written by @fractaal/pi-claude-bridge. */
export declare const CLAUDE_BRIDGE_SESSION_CUSTOM_TYPE = "claude-bridge-session";
type SessionRuntime = {
    session: {
        model?: {
            provider?: string;
        } | null;
        sessionManager: {
            getSessionFile?: () => string | undefined;
            getSessionId?: () => string | undefined;
            getCwd?: () => string;
        };
        bindExtensions: (bindings: {
            mode: "rpc";
            uiContext?: ExtensionUIContext;
        }) => Promise<void>;
    };
};
export type ActivateClaudeBridgeSessionBindingOptions = {
    /** Melon card question panel — re-applied on every rebind. */
    uiContext?: ExtensionUIContext;
};
/**
 * Drop copied Claude bridge session markers from a forked Melon child session and
 * re-chain parentIds so the jsonl tree stays valid. Returns how many entries
 * were removed.
 */
export declare function stripClaudeBridgeSessionEntriesFromSessionFile(sessionFile: string): number;
/**
 * Register this card's session with the isolated Claude bridge before a prompt.
 * No-op when Claude bridge is not the active model.
 *
 * Always re-supplies uiContext when provided (same rationale as Cursor binding).
 */
export declare function activateClaudeBridgeSessionBinding(runtime: SessionRuntime, options?: ActivateClaudeBridgeSessionBindingOptions): Promise<void>;
/**
 * Bind the card and run its prompt after isolation is confirmed. Missing
 * isolation is a hard Claude error — never fall back to the shared package entry.
 */
export declare function runInBoundClaudeBridgeSession<T>(runtime: SessionRuntime, options: ActivateClaudeBridgeSessionBindingOptions, run: () => Promise<T>): Promise<T>;
export {};
//# sourceMappingURL=claude-bridge-session-binding.d.ts.map