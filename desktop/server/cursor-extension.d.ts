import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
export declare const CURSOR_PROVIDER_ID = "cursor";
/** Bundled pi-cursor-sdk package dir, or null when not installed. */
export declare function cursorExtensionPath(): string | null;
/**
 * The Cursor provider is safe in Melon's multi-card process only when every
 * stateful SDK module carries the session-isolation patch. Do not degrade to
 * upstream's process-global behavior: that can route one card's tools and
 * questions into another card.
 */
export declare function cursorSessionIsolationAvailable(): boolean;
/**
 * Register the Cursor provider into a ModelRuntime (and refresh).
 * Intentionally does not run the full pi-cursor-sdk extension factory — the
 * GUI catalog does not need a live pi tool bridge, and avoiding the factory
 * keeps ModelRuntime from registering an unused bridge.
 */
export declare function loadCursorProviderInto(runtime: ModelRuntime): Promise<void>;
/**
 * Rewrite TUI-only instructions in Cursor extension errors into actions that
 * exist in Melon. The extension's copy references /login and
 * /cursor-refresh-models — slash commands the GUI does not have.
 */
export declare function rewriteCursorError(message: string): string;
/**
 * True when a REAL Cursor SDK API key is available. The extension registers a
 * literal placeholder apiKey so the generic auth status reports "configured"
 * with no key present — this checks the actual sources instead.
 */
export declare function hasRealCursorKey(authEntries: Record<string, unknown>, melonKeys: Record<string, string>): boolean;
//# sourceMappingURL=cursor-extension.d.ts.map