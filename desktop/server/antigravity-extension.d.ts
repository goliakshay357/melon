import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
export declare const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export declare const ANTIGRAVITY_PROVIDER_NAME = "Antigravity";
export type AntigravityCatalogStatus = {
    loaded: boolean;
    /** True when the bundled package extension entry is present for Melon sessions. */
    isolationAvailable: boolean;
    extensionPath: string | null;
    extensionEntryPath: string | null;
    modelCount: number;
    issues: string[];
};
export declare function getAntigravityCatalogStatus(): AntigravityCatalogStatus;
/** Bundled `pi-antigravity` package dir, or null when not installed. */
export declare function antigravityExtensionPath(): string | null;
/** Extension entry Melon loads into session runtimes (`pi.extensions`). */
export declare function antigravityExtensionEntryPath(): string | null;
/**
 * Melon multi-card sessions require the bundled extension entry. Unlike Claude
 * Code, Antigravity has no separate isolated bundle — Melon owns card isolation.
 */
export declare function antigravitySessionIsolationAvailable(): boolean;
type AntigravityOAuthModule = {
    loginAntigravity: (callbacks: unknown) => Promise<Record<string, unknown>>;
    refreshAntigravityToken: (credentials: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
    getApiKey: (credentials: unknown) => string;
};
/**
 * Load OAuth helpers from the bundled package.
 *
 * `pi-antigravity` ships TypeScript under `node_modules`. Node's native type
 * stripping refuses that path ("Stripping types is currently unsupported for
 * files under node_modules"), which left Melon with "Unknown provider:
 * antigravity" on login. Load `.ts` via jiti — same approach as pi's extension
 * loader. Prefer a `.js` build if one exists.
 */
export declare function loadAntigravityOAuthModule(): Promise<AntigravityOAuthModule>;
/**
 * Register Antigravity into a ModelRuntime (picker + Melon browser login).
 * Sessions still load the full extension factory via additionalExtensionPaths.
 */
export declare function loadAntigravityProviderInto(runtime: ModelRuntime): Promise<void>;
/** True when Melon auth.json has Antigravity OAuth credentials. */
export declare function hasAntigravityAuth(authEntries: Record<string, unknown>): boolean;
export {};
//# sourceMappingURL=antigravity-extension.d.ts.map