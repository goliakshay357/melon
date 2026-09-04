import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
/** pi-cursor-sdk custom entry that pins a local Cursor agent id for resume. */
export declare const CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE = "cursor-sdk-agent-resume";
type SessionRuntime = {
    session: {
        model?: {
            provider?: string;
        } | null;
        sessionManager: {
            getSessionFile?: () => string | undefined;
            getSessionId?: () => string | undefined;
            getCwd?: () => string;
            appendCustomEntry: (customType: string, data?: unknown) => string;
        };
        bindExtensions: (bindings: {
            mode: "rpc";
            uiContext?: ExtensionUIContext;
        }) => Promise<void>;
    };
};
export type ActivateCursorSessionBindingOptions = {
    /** Melon card question panel — must be re-applied on every rebind. */
    uiContext?: ExtensionUIContext;
};
/**
 * Drop copied Cursor local-resume handles from a forked Melon child session and
 * re-chain parentIds so the jsonl tree stays valid. Returns how many entries
 * were removed.
 */
export declare function stripCursorResumeEntriesFromSessionFile(sessionFile: string): number;
/**
 * Register this card's session with pi-cursor-sdk before a Cursor prompt.
 * No-op when Cursor is not the active model or the extension is missing.
 *
 * Always re-supplies uiContext when provided: bindExtensions without it leaves
 * the previous context in place on AgentSession, but Melon can lose the card
 * panel wiring across resume/reattach paths — passing it every time is safe
 * because CardExtensionUiBridge.createUIContext() shares the same pending map.
 */
export declare function activateCursorSessionBinding(runtime: SessionRuntime, options?: ActivateCursorSessionBindingOptions): Promise<void>;
/**
 * Run a Cursor turn inside this card's session context, so every
 * `getRegisteredCursorPiToolBridge()` / scope / resume lookup the turn makes
 * resolves to THIS card even while a sibling card binds or streams.
 *
 * Missing isolation is a hard Cursor error. Falling back to the upstream
 * process globals would allow one card to execute another card's tools.
 */
export declare function runInCursorSession<T>(runtime: SessionRuntime, run: () => Promise<T>): Promise<T>;
/**
 * Bind the card and run its prompt in one async session context. This closes
 * the small window where a sibling could bind between session_start and
 * prompt(), while leaving every non-Cursor provider's path unchanged.
 */
export declare function runInBoundCursorSession<T>(runtime: SessionRuntime, options: ActivateCursorSessionBindingOptions, run: () => Promise<T>): Promise<T>;
export {};
//# sourceMappingURL=cursor-session-binding.d.ts.map