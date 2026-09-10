import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-extension.js";
let active = null;
function setPhase(phase, extra = {}) {
    if (!active)
        return;
    active.phase = phase;
    Object.assign(active, extra);
}
export function getAntigravityLoginStatus() {
    if (!active)
        return { phase: "idle" };
    return {
        phase: active.phase,
        ...(active.url ? { url: active.url } : {}),
        ...(active.error ? { error: active.error } : {}),
    };
}
/** Abort any in-flight Antigravity browser login. */
export function cancelAntigravityLogin() {
    if (!active)
        return;
    active.abort.abort();
    active = null;
}
/**
 * Start (or resume) Google OAuth for Antigravity and return the authorize URL.
 * Completes in the background when the localhost callback receives the code.
 */
export async function startAntigravityLogin(getRuntime) {
    if (active?.phase === "awaiting_browser" && active.url) {
        return { url: active.url };
    }
    if (active) {
        active.abort.abort();
        active = null;
    }
    const abort = new AbortController();
    let resolveUrl = () => { };
    let rejectUrl = () => { };
    const urlPromise = new Promise((resolve, reject) => {
        resolveUrl = resolve;
        rejectUrl = reject;
    });
    const runtime = await getRuntime();
    const finished = runtime
        .login(ANTIGRAVITY_PROVIDER_ID, "oauth", {
        signal: abort.signal,
        notify(event) {
            if (event.type === "auth_url") {
                if (active)
                    active.url = event.url;
                resolveUrl(event.url);
            }
        },
        prompt: async () => {
            // Melon GUI prefers the localhost callback. Hang until cancel;
            // paste-based remote login is not exposed in the picker yet.
            await new Promise((_resolve, reject) => {
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
        new Promise((_, reject) => {
            setTimeout(() => reject(new Error("Timed out waiting for Antigravity login URL")), 20_000);
        }),
    ]);
    if (active)
        active.url = url;
    return { url };
}
/** Wait until the in-flight login finishes (browser callback). */
export async function waitAntigravityLogin() {
    if (!active)
        return { phase: "idle" };
    await active.finished.catch(() => undefined);
    const status = getAntigravityLoginStatus();
    if (status.phase === "done") {
        active = null;
    }
    return status;
}
/** Log out Antigravity from Melon auth. */
export async function logoutAntigravity(getRuntime) {
    cancelAntigravityLogin();
    try {
        await (await getRuntime()).logout(ANTIGRAVITY_PROVIDER_ID);
    }
    catch {
        /* may already be logged out */
    }
}
//# sourceMappingURL=antigravity-login.js.map