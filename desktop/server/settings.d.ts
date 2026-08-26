export interface MelonSettings {
    lastModel?: string;
    recentModels?: string[];
    defaultThinkingLevel?: string;
    providerKeys?: Record<string, string>;
}
export declare function loadSettings(): MelonSettings;
export declare function saveSettings(next: MelonSettings): void;
export declare function touchRecentModel(model: string): void;
//# sourceMappingURL=settings.d.ts.map