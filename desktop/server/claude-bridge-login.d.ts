import { type ModelRuntime } from "@earendil-works/pi-coding-agent";
export type ClaudeBridgeLoginPhase = "idle" | "awaiting_browser" | "done" | "error";
export type ClaudeBridgeLoginStatus = {
    phase: ClaudeBridgeLoginPhase;
    url?: string;
    error?: string;
};
export declare function getClaudeBridgeLoginStatus(): ClaudeBridgeLoginStatus;
/** Abort any in-flight Claude browser login. */
export declare function cancelClaudeBridgeLogin(): void;
/**
 * Start (or resume) Claude Pro/Max OAuth and return the browser authorize URL.
 * Completes in the background when the localhost callback receives the code.
 */
export declare function startClaudeBridgeLogin(getRuntime: () => Promise<ModelRuntime>): Promise<{
    url: string;
}>;
/** Wait until the in-flight login finishes (browser callback). */
export declare function waitClaudeBridgeLogin(): Promise<ClaudeBridgeLoginStatus>;
/** Log out Claude bridge (+ shared Anthropic subscription used for this login). */
export declare function logoutClaudeBridge(getRuntime: () => Promise<ModelRuntime>): Promise<void>;
//# sourceMappingURL=claude-bridge-login.d.ts.map