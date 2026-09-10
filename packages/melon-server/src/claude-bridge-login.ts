// Claude Code / Claude Pro/Max browser login for Melon.
//
// Reuses Anthropic's subscription OAuth (same flow as pi `/login` for Anthropic).
// Melon opens the authorize URL in the system browser; a localhost callback
// completes the flow. Credentials are stored under both `anthropic` (via
// ModelRuntime.login) and `claude-bridge` (Melon provider picker).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthEvent, Credential } from "@earendil-works/pi-ai";
import { getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { CLAUDE_BRIDGE_PROVIDER_ID } from "./claude-bridge-extension.ts";

export type ClaudeBridgeLoginPhase = "idle" | "awaiting_browser" | "done" | "error";

export type ClaudeBridgeLoginStatus = {
	phase: ClaudeBridgeLoginPhase;
	url?: string;
	error?: string;
};

type ActiveLogin = {
	abort: AbortController;
	url?: string;
	phase: ClaudeBridgeLoginPhase;
	error?: string;
	finished: Promise<void>;
};

let active: ActiveLogin | null = null;

function setPhase(phase: ClaudeBridgeLoginPhase, extra: Partial<ActiveLogin> = {}): void {
	if (!active) return;
	active.phase = phase;
	Object.assign(active, extra);
}

export function getClaudeBridgeLoginStatus(): ClaudeBridgeLoginStatus {
	if (!active) return { phase: "idle" };
	return {
		phase: active.phase,
		...(active.url ? { url: active.url } : {}),
		...(active.error ? { error: active.error } : {}),
	};
}

function persistClaudeBridgeCredential(credential: Credential): void {
	if (credential.type !== "oauth") return;
	mkdirSync(getAgentDir(), { recursive: true });
	const authPath = join(getAgentDir(), "auth.json");
	let auth: Record<string, unknown> = {};
	try {
		auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
	} catch {
		/* empty */
	}
	auth[CLAUDE_BRIDGE_PROVIDER_ID] = {
		type: "oauth",
		access: credential.access,
		refresh: credential.refresh,
		expires: credential.expires,
	};
	writeFileSync(authPath, JSON.stringify(auth, null, "\t"), { mode: 0o600 });
}

function clearClaudeBridgeCredential(): void {
	try {
		const authPath = join(getAgentDir(), "auth.json");
		const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		if (CLAUDE_BRIDGE_PROVIDER_ID in auth) {
			delete auth[CLAUDE_BRIDGE_PROVIDER_ID];
			writeFileSync(authPath, JSON.stringify(auth, null, "\t"), { mode: 0o600 });
		}
	} catch {
		/* ignore */
	}
}

/** Abort any in-flight Claude browser login. */
export function cancelClaudeBridgeLogin(): void {
	if (!active) return;
	active.abort.abort();
	active = null;
}

/**
 * Start (or resume) Claude Pro/Max OAuth and return the browser authorize URL.
 * Completes in the background when the localhost callback receives the code.
 */
export async function startClaudeBridgeLogin(getRuntime: () => Promise<ModelRuntime>): Promise<{ url: string }> {
	if (active?.phase === "awaiting_browser" && active.url) {
		return { url: active.url };
	}
	if (active) {
		active.abort.abort();
		active = null;
	}

	const abort = new AbortController();
	let resolveUrl: (url: string) => void = () => {};
	let rejectUrl: (err: Error) => void = () => {};
	const urlPromise = new Promise<string>((resolve, reject) => {
		resolveUrl = resolve;
		rejectUrl = reject;
	});

	const runtime = await getRuntime();
	const finished = runtime
		.login("anthropic", "oauth", {
			signal: abort.signal,
			notify(event: AuthEvent) {
				if (event.type === "auth_url") {
					if (active) active.url = event.url;
					resolveUrl(event.url);
				}
			},
			prompt: async () => {
				// Melon GUI does not collect pasted codes; the localhost callback
				// completes the flow. Hang until cancel.
				await new Promise<void>((_resolve, reject) => {
					if (abort.signal.aborted) {
						reject(new Error("Login cancelled"));
						return;
					}
					abort.signal.addEventListener("abort", () => reject(new Error("Login cancelled")), { once: true });
				});
				throw new Error("Login cancelled");
			},
		})
		.then((credential) => {
			persistClaudeBridgeCredential(credential);
			setPhase("done");
		})
		.catch((error) => {
			const message = error instanceof Error ? error.message : String(error);
			if (message === "Login cancelled" || abort.signal.aborted) {
				active = null;
				rejectUrl(new Error("Login cancelled"));
				return;
			}
			setPhase("error", { error: message });
			rejectUrl(error instanceof Error ? error : new Error(message));
		});

	active = {
		abort,
		phase: "awaiting_browser",
		finished: finished.then(() => undefined),
	};

	const url = await Promise.race([
		urlPromise,
		new Promise<string>((_, reject) => {
			setTimeout(() => reject(new Error("Timed out waiting for Claude login URL")), 20_000);
		}),
	]);
	if (active) active.url = url;
	return { url };
}

/** Wait until the in-flight login finishes (browser callback). */
export async function waitClaudeBridgeLogin(): Promise<ClaudeBridgeLoginStatus> {
	if (!active) return { phase: "idle" };
	await active.finished.catch(() => undefined);
	const status = getClaudeBridgeLoginStatus();
	if (status.phase === "done") {
		active = null;
	}
	return status;
}

/** Log out Claude bridge (+ shared Anthropic subscription used for this login). */
export async function logoutClaudeBridge(getRuntime: () => Promise<ModelRuntime>): Promise<void> {
	cancelClaudeBridgeLogin();
	clearClaudeBridgeCredential();
	try {
		await (await getRuntime()).logout("anthropic");
	} catch {
		/* anthropic may already be logged out */
	}
}
