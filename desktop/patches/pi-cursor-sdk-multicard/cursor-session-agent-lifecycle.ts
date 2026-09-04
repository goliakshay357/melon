import type {
	ExtensionHandler,
	SessionBeforeTreeEvent,
	SessionCompactEvent,
	SessionShutdownEvent,
	SessionStartEvent,
	SessionTreeEvent,
} from "@earendil-works/pi-coding-agent";
import { clearCursorSdkHttp1 } from "./cursor-http1.js";
import { onCursorSessionScopeKeyChange } from "./cursor-session-scope.js";
import { cursorHostSessionScopeKey, isCursorHostSessionIsolationEnabled } from "./cursor-host-session.js";
import {
	disposeSessionCursorAgent,
	invalidateSessionAgent,
	resetSessionCursorAgent,
} from "./cursor-session-agent.js";

export interface CursorSessionAgentLifecycleExtensionApi {
	on(event: "session_shutdown", handler: ExtensionHandler<SessionShutdownEvent>): void;
	on(event: "session_start", handler: ExtensionHandler<SessionStartEvent>): void;
	on(event: "session_compact", handler: ExtensionHandler<SessionCompactEvent>): void;
	on(event: "session_before_tree", handler: ExtensionHandler<SessionBeforeTreeEvent>): void;
	on(event: "session_tree", handler: ExtensionHandler<SessionTreeEvent>): void;
	on(
		event: "model_select",
		handler: (event: unknown, ctx: CursorLifecycleContext) => Promise<void> | void,
	): void;
}

interface CursorLifecycleContext {
	sessionManager?: { getSessionFile?: () => string | undefined; getSessionId?: () => string | undefined };
}

const liveCursorSessionScopeKeys = new Set<string>();

function contextScopeKey(ctx: CursorLifecycleContext | undefined): string {
	return cursorHostSessionScopeKey({
		sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? undefined,
		sessionId: ctx?.sessionManager?.getSessionId?.() ?? undefined,
	});
}

/**
 * Scope key of the session that fired the event. Returns undefined outside
 * host isolation so the SDK keeps using its own default (the last-bound
 * session) — under isolation these lifecycle events must only ever affect the
 * card they came from.
 */
function eventScopeKey(ctx: CursorLifecycleContext | undefined): string | undefined {
	if (!isCursorHostSessionIsolationEnabled()) return undefined;
	return contextScopeKey(ctx);
}

export function registerCursorSessionAgentLifecycle(pi: CursorSessionAgentLifecycleExtensionApi): void {
	let runnerScopeKey: string | undefined;
	pi.on("session_start", (_event, ctx) => {
		const nextScopeKey = contextScopeKey(ctx);
		if (runnerScopeKey && runnerScopeKey !== nextScopeKey) liveCursorSessionScopeKeys.delete(runnerScopeKey);
		runnerScopeKey = nextScopeKey;
		liveCursorSessionScopeKeys.add(nextScopeKey);
	});
	onCursorSessionScopeKeyChange(async (previousScopeKey) => {
		await disposeSessionCursorAgent(previousScopeKey);
	});
	pi.on("session_shutdown", async (event, ctx) => {
		const scopeKey = eventScopeKey(ctx);
		try {
			if (event.reason === "reload") {
				await resetSessionCursorAgent(scopeKey);
				return;
			}
			await disposeSessionCursorAgent(scopeKey);
		} finally {
			liveCursorSessionScopeKeys.delete(contextScopeKey(ctx));
			if (runnerScopeKey) liveCursorSessionScopeKeys.delete(runnerScopeKey);
			runnerScopeKey = undefined;
			// Cursor.configure is process-global. Clearing it while a sibling
			// session is alive changes that sibling's transport mid-turn.
			if (!isCursorHostSessionIsolationEnabled() || liveCursorSessionScopeKeys.size === 0) {
				clearCursorSdkHttp1();
			}
		}
	});
	pi.on("session_compact", (_event, ctx) => {
		invalidateSessionAgent(eventScopeKey(ctx));
	});
	pi.on("session_before_tree", (_event, ctx) => {
		invalidateSessionAgent(eventScopeKey(ctx));
	});
	pi.on("session_tree", async (_event, ctx) => {
		await resetSessionCursorAgent(eventScopeKey(ctx));
	});
	pi.on("model_select", (_event, ctx) => {
		invalidateSessionAgent(eventScopeKey(ctx));
	});
}

export const __testUtils = {
	getLiveSessionCount(): number {
		return liveCursorSessionScopeKeys.size;
	},
	resetLiveSessions(): void {
		liveCursorSessionScopeKeys.clear();
	},
};
