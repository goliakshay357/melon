export interface MelonSettings {
    lastModel?: string;
    recentModels?: string[];
    /** Starred models (provider/id) shown first in the model picker. */
    favoriteModels?: string[];
    defaultThinkingLevel?: string;
    providerKeys?: Record<string, string>;
    /** Models the provider rejected ("not supported") — hidden from the picker. */
    denylistedModels?: string[];
    /** Melon web UI theme id (e.g. moonfly). Survives webview storage resets. */
    theme?: string;
    /**
     * When true, inbound box mail auto-approves in the recipient inbox and
     * delivers to the agent without a human click (TRD T1). Default / absent =
     * false (pending → Approve in inbox).
     */
    boxMailAutoSend?: boolean;
    /** Recently used agent profile ids (spawn / mail); drives Settings top-5. */
    agentProfileRecentIds?: string[];
}
export declare function loadSettings(): MelonSettings;
export declare function saveSettings(next: MelonSettings): void;
export declare function touchRecentModel(model: string): void;
/** Denylist a model that the provider rejected, so it stops showing in the picker. */
export declare function denylistModel(model: string): void;
/** Clear all denylisted models of one provider (e.g. after a valid key was added —
 * models that failed pre-key must not stay hidden forever). */
export declare function clearProviderDenylist(provider: string): void;
/** Single source of truth for the default model of NEW sessions. */
export declare function getDefaultModel(fallback: string): string;
//# sourceMappingURL=settings.d.ts.map