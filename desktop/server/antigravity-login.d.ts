import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
export type AntigravityLoginPhase = "idle" | "awaiting_browser" | "done" | "error";
export type AntigravityLoginStatus = {
    phase: AntigravityLoginPhase;
    url?: string;
    error?: string;
};
export declare function getAntigravityLoginStatus(): AntigravityLoginStatus;
/** Abort any in-flight Antigravity browser login. */
export declare function cancelAntigravityLogin(): void;
/**
 * Start (or resume) Google OAuth for Antigravity and return the authorize URL.
 * Completes in the background when the localhost callback receives the code.
 */
export declare function startAntigravityLogin(getRuntime: () => Promise<ModelRuntime>): Promise<{
    url: string;
}>;
/** Wait until the in-flight login finishes (browser callback). */
export declare function waitAntigravityLogin(): Promise<AntigravityLoginStatus>;
/** Log out Antigravity from Melon auth. */
export declare function logoutAntigravity(getRuntime: () => Promise<ModelRuntime>): Promise<void>;
//# sourceMappingURL=antigravity-login.d.ts.map