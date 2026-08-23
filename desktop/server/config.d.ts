export interface MelonConfig {
    readonly port: number;
    /** provider/model-id used for new cards, e.g. "opencode-go/ox-alpha-free" */
    readonly defaultModel: string;
    readonly defaultThinkingLevel: "minimal" | "low" | "medium" | "high";
    /** Used when a client attaches a card without an explicit cwd. */
    readonly defaultCwd: string;
}
export declare function loadConfig(overrides?: Partial<MelonConfig>): MelonConfig;
export declare function expandHome(dir: string): string;
/** Truncated string/JSON preview for tool payloads. */
export declare function preview(value: unknown, max?: number): string;
export declare function modelToString(model: unknown): string;
//# sourceMappingURL=config.d.ts.map