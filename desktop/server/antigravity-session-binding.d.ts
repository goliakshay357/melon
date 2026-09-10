import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
/** Reserved if Antigravity ever writes Melon custom session markers. */
export declare const ANTIGRAVITY_SESSION_CUSTOM_TYPE = "antigravity-session";
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
export type ActivateAntigravitySessionBindingOptions = {
    uiContext?: ExtensionUIContext;
};
/**
 * Drop copied Antigravity Melon custom markers from a forked child session.
 * Currently a no-op unless such markers appear; returns how many were removed.
 */
export declare function stripAntigravitySessionEntriesFromSessionFile(sessionFile: string): number;
export declare function activateAntigravitySessionBinding(runtime: SessionRuntime, options?: ActivateAntigravitySessionBindingOptions): Promise<void>;
export declare function runInBoundAntigravitySession<T>(runtime: SessionRuntime, options: ActivateAntigravitySessionBindingOptions, run: () => Promise<T>): Promise<T>;
export {};
//# sourceMappingURL=antigravity-session-binding.d.ts.map