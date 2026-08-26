export interface MelonSettings {
    lastModel?: string;
    recentModels?: string[];
    defaultThinkingLevel?: string;
    providerKeys?: Record<string, string>;
    /** Models the provider rejected ("not supported") — hidden from the picker. */
    denylistedModels?: string[];
}
export declare function loadSettings(): MelonSettings;
export declare function saveSettings(next: MelonSettings): void;
export declare function touchRecentModel(model: string): void;
/** Denylist a model that the provider rejected, so it stops showing in the picker. */
export declare function denylistModel(model: string): void;
/** Single source of truth for the default model of NEW sessions. */
export declare function getDefaultModel(fallback: string): string;
//# sourceMappingURL=settings.d.ts.map