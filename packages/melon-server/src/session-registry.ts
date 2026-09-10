import type { FastifyReply } from "fastify";
import { ANTIGRAVITY_PROVIDER_ID } from "./antigravity-extension.ts";
import { CLAUDE_BRIDGE_PROVIDER_ID } from "./claude-bridge-extension.ts";
import { CURSOR_PROVIDER_ID } from "./cursor-extension.ts";
import type { CardExtensionUiBridge } from "./extension-ui.ts";

export interface AttachedSession {
	runtime: any; // AgentSessionRuntime — typed loosely: internals shift across pi versions
	clients: Set<FastifyReply>;
	busy: boolean;
	lastViz?: boolean;
	/** Skill ids currently active for this card's session. */
	activeSkills?: string[];
	/**
	 * Server-owned prompt queue. pi has no per-item queue removal, so queued
	 * prompts NEVER enter pi's followUp queue — this array is the single
	 * source of truth for the UI (chips, cancel, edit) and is drained one
	 * prompt at a time whenever the agent goes idle.
	 */
	promptQueue: QueuedPrompt[];
	/** Guards the drain loop against re-entrant agent_end triggers. */
	draining?: boolean;
	/**
	 * Monotonic token for isolation-sensitive turns (Cursor, Claude bridge, Antigravity).
	 * Prevents a settled old turn mutating a newer one.
	 */
	isolationTurnId?: number;
	/** Isolation-sensitive turn explicitly stopped by the user; queue stays paused. */
	isolationAbortedTurnId?: number;
	/** @deprecated Use isolationTurnId — kept as alias for older call sites/tests. */
	cursorTurnId?: number;
	/** @deprecated Use isolationAbortedTurnId. */
	cursorAbortedTurnId?: number;
	/** Extension UI (select/confirm/input) → Melon card question panel. */
	extensionUi?: CardExtensionUiBridge;
}

/**
 * One queued prompt. `text` is what the model receives; `display` is what the
 * UI shows everywhere (queue chips, cancel-to-draft, the user_message frame).
 * Command expansions like /diagram append a model-facing directive to `text`
 * — without `display`, that directive would leak into the user's composer and
 * transcript.
 */
export interface QueuedPrompt {
	text: string;
	display?: string;
	context?: string;
}

export function queueDisplays(queue: QueuedPrompt[]): string[] {
	return queue.map((q) => q.display ?? q.text);
}

function providerId(session: Pick<AttachedSession, "runtime">): string {
	return (session.runtime.session.model?.provider ?? "").toLowerCase();
}

/** Providers that require Melon per-card isolation (attach locks, turn tokens, …). */
export function isIsolationSensitiveSession(session: Pick<AttachedSession, "runtime">): boolean {
	const id = providerId(session);
	return id === CURSOR_PROVIDER_ID || id === CLAUDE_BRIDGE_PROVIDER_ID || id === ANTIGRAVITY_PROVIDER_ID;
}

export function isCursorSession(session: Pick<AttachedSession, "runtime">): boolean {
	return providerId(session) === CURSOR_PROVIDER_ID;
}

export function isClaudeBridgeSession(session: Pick<AttachedSession, "runtime">): boolean {
	return providerId(session) === CLAUDE_BRIDGE_PROVIDER_ID;
}

export function isAntigravitySession(session: Pick<AttachedSession, "runtime">): boolean {
	return providerId(session) === ANTIGRAVITY_PROVIDER_ID;
}

/**
 * Claim an isolation-sensitive card synchronously before prompt() can yield.
 * Returns undefined for ordinary providers (caller sets busy itself).
 */
export function beginIsolationTurn(
	session: Pick<AttachedSession, "runtime" | "busy" | "isolationTurnId" | "cursorTurnId">,
): number | undefined {
	if (!isIsolationSensitiveSession(session)) return undefined;
	const turnId = (session.isolationTurnId ?? session.cursorTurnId ?? 0) + 1;
	session.isolationTurnId = turnId;
	session.cursorTurnId = turnId;
	session.busy = true;
	return turnId;
}

/** @deprecated Prefer beginIsolationTurn — Cursor-named alias. */
export function beginCursorTurn(
	session: Pick<AttachedSession, "runtime" | "busy" | "isolationTurnId" | "cursorTurnId">,
): number | undefined {
	return beginIsolationTurn(session);
}

export function abortCurrentIsolationTurn(
	session: Pick<
		AttachedSession,
		"runtime" | "isolationTurnId" | "isolationAbortedTurnId" | "cursorTurnId" | "cursorAbortedTurnId"
	>,
): void {
	if (!isIsolationSensitiveSession(session)) return;
	const turnId = session.isolationTurnId ?? session.cursorTurnId;
	if (turnId === undefined) return;
	session.isolationAbortedTurnId = turnId;
	session.cursorAbortedTurnId = turnId;
}

/** @deprecated Prefer abortCurrentIsolationTurn. */
export function abortCurrentCursorTurn(
	session: Pick<
		AttachedSession,
		"runtime" | "isolationTurnId" | "isolationAbortedTurnId" | "cursorTurnId" | "cursorAbortedTurnId"
	>,
): void {
	abortCurrentIsolationTurn(session);
}

export function isIsolationTurnAborted(
	session: Pick<AttachedSession, "isolationAbortedTurnId" | "cursorAbortedTurnId">,
	turnId: number,
): boolean {
	return (session.isolationAbortedTurnId ?? session.cursorAbortedTurnId) === turnId;
}

/** @deprecated Prefer isIsolationTurnAborted. */
export function isCursorTurnAborted(
	session: Pick<AttachedSession, "isolationAbortedTurnId" | "cursorAbortedTurnId">,
	turnId: number,
): boolean {
	return isIsolationTurnAborted(session, turnId);
}

export function isCurrentIsolationTurn(
	session: Pick<AttachedSession, "isolationTurnId" | "cursorTurnId">,
	turnId: number,
): boolean {
	return (session.isolationTurnId ?? session.cursorTurnId) === turnId;
}

/** @deprecated Prefer isCurrentIsolationTurn. */
export function isCurrentCursorTurn(
	session: Pick<AttachedSession, "isolationTurnId" | "cursorTurnId">,
	turnId: number,
): boolean {
	return isCurrentIsolationTurn(session, turnId);
}

export class SessionRegistry {
	private readonly sessions = new Map<string, AttachedSession>();

	set(cardId: string, session: AttachedSession): void {
		this.sessions.set(cardId, session);
	}

	get(cardId: string): AttachedSession | undefined {
		return this.sessions.get(cardId);
	}

	entries(): IterableIterator<[string, AttachedSession]> {
		return this.sessions.entries();
	}

	delete(cardId: string): void {
		this.sessions.delete(cardId);
	}

	/// Comment frames keep streams alive and surface dead sockets.
	pingAll(): void {
		for (const s of this.sessions.values()) {
			for (const client of s.clients) {
				client.raw.write(`: ping\n\n`);
			}
		}
	}

	broadcast(cardId: string, payload: unknown): void {
		const s = this.sessions.get(cardId);
		if (!s) return;
		for (const client of s.clients) {
			client.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
		}
	}
}
