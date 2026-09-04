import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Per-session context for hosts that run several pi sessions in ONE Node
 * process (Melon canvas cards).
 *
 * Upstream pi-cursor-sdk keeps its session scope, resume state and pi tool
 * bridge in process globals that the most recent `session_start` overwrites.
 * With one session per process that is correct. With two live cards it is not:
 * card B binding while card A streams silently redirects A's tool bridge and
 * resume writes to B, which surfaces as
 * "Cursor pi bridge tool call is no longer pending" and as ask_question panels
 * opening in the wrong card.
 *
 * A host opts in by running each Cursor turn inside
 * `runInCursorHostSession({ sessionFile, sessionId, cwd }, fn)`. Everything the
 * turn awaits stays in that async context, so scope/bridge/resume lookups can
 * resolve the calling session instead of "whichever bound last".
 *
 * Until a host calls it, `isCursorHostSessionIsolationEnabled()` stays false
 * and every patched module keeps its original single-session behaviour.
 */

export const ANONYMOUS_SESSION_SCOPE_KEY = "__anonymous__";
export const EPHEMERAL_SESSION_SCOPE_PREFIX = "__ephemeral__:";

export interface CursorHostSession {
	sessionFile?: string;
	sessionId?: string;
	cwd?: string;
}

const storage = new AsyncLocalStorage<CursorHostSession>();
let isolationEnabled = false;

/** Same key shape as getCursorSessionScopeKey(), computed without the globals. */
export function cursorHostSessionScopeKey(session: CursorHostSession): string {
	if (session.sessionFile) return session.sessionFile;
	if (session.sessionId) return `${EPHEMERAL_SESSION_SCOPE_PREFIX}${session.sessionId}`;
	return ANONYMOUS_SESSION_SCOPE_KEY;
}

/** True once any host has run a turn inside a host session context. */
export function isCursorHostSessionIsolationEnabled(): boolean {
	return isolationEnabled;
}

export function runInCursorHostSession<T>(session: CursorHostSession, fn: () => T): T {
	isolationEnabled = true;
	return storage.run({ ...session }, fn);
}

export function getCursorHostSession(): CursorHostSession | undefined {
	return storage.getStore();
}

/** Scope key of the calling turn, or undefined outside a host session context. */
export function getCursorHostSessionScopeKey(): string | undefined {
	const session = storage.getStore();
	return session ? cursorHostSessionScopeKey(session) : undefined;
}

export const __testUtils = {
	disableIsolationForTests(): void {
		isolationEnabled = false;
	},
};
