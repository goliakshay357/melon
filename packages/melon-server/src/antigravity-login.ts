// Antigravity Google browser login for Melon.
//
// Uses pi-antigravity's OAuth (PKCE → localhost:51121). Melon opens the authorize
// URL in the system browser; credentials are stored under `antigravity` via
// ModelRuntime.login after the provider is registered.
import type { AuthEvent } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-extension.ts";

export type AntigravityLoginPhase = "idle" | "awaiting_browser" | "done" | "error";

export type AntigravityLoginStatus = {
	phase: AntigravityLoginPhase;
	url?: string;
	error?: string;
};

type ActiveLogin = {
	abort: AbortController;
	url?: string;
	phase: AntigravityLoginPhase;
	error?: string;
	finished: Promise<void>;
};

let active: ActiveLogin | null = null;

function setPhase(phase: AntigravityLoginPhase, extra: Partial<ActiveLogin> = {}): void {
	if (!active) return;
	active.phase = phase;
	Object.assign(active, extra);
}

export function getAntigravityLoginStatus(): AntigravityLoginStatus {
	if (!active) return { phase: "idle" };
	return {
		phase: active.phase,
		...(active.url ? { url: active.url } : {}),
		...(active.error ? { error: active.error } : {}),
	};
}

/** Abort any in-flight Antigravity browser login. */
export function cancelAntigravityLogin(): void {
	if (!active) return;
	active.abort.abort();
	active = null;
}

/**
 * Start (or resume) Google OAuth for Antigravity and return the authorize URL.
 * Completes in the background when the localhost callback receives the code.
 */
export async function startAntigravityLogin(getRuntime: () => Promise<ModelRuntime>): Promise<{ url: string }> {
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
		.login(ANTIGRAVITY_PROVIDER_ID, "oauth", {
			signal: abort.signal,
			notify(event: AuthEvent) {
				if (event.type === "auth_url") {
					if (active) active.url = event.url;
					resolveUrl(event.url);
				}
			},
			prompt: async () => {
				// Melon GUI prefers the localhost callback. Hang until cancel;
				// paste-based remote login is not exposed in the picker yet.
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
		.then(() => {
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
			setTimeout(() => reject(new Error("Timed out waiting for Antigravity login URL")), 20_000);
		}),
	]);
	if (active) active.url = url;
	return { url };
}

/** Wait until the in-flight login finishes (browser callback). */
export async function waitAntigravityLogin(): Promise<AntigravityLoginStatus> {
	if (!active) return { phase: "idle" };
	await active.finished.catch(() => undefined);
	const status = getAntigravityLoginStatus();
	if (status.phase === "done") {
		active = null;
	}
	return status;
}

/** Log out Antigravity from Melon auth. */
export async function logoutAntigravity(getRuntime: () => Promise<ModelRuntime>): Promise<void> {
	cancelAntigravityLogin();
	try {
		await (await getRuntime()).logout(ANTIGRAVITY_PROVIDER_ID);
	} catch {
		/* may already be logged out */
	}
}
