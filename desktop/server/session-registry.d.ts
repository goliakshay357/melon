import type { FastifyReply } from "fastify";
import type { CardExtensionUiBridge } from "./extension-ui.ts";
export interface AttachedSession {
    runtime: any;
    clients: Set<FastifyReply>;
    busy: boolean;
    lastViz?: boolean;
    /** Skill ids currently active for this card's session. */
    activeSkills?: string[];
    /** Settings → Agents profile bound to this box (standing instructions). */
    agentProfileId?: string;
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
export declare function queueDisplays(queue: QueuedPrompt[]): string[];
/** Providers that require Melon per-card isolation (attach locks, turn tokens, …). */
export declare function isIsolationSensitiveSession(session: Pick<AttachedSession, "runtime">): boolean;
export declare function isCursorSession(session: Pick<AttachedSession, "runtime">): boolean;
export declare function isClaudeBridgeSession(session: Pick<AttachedSession, "runtime">): boolean;
export declare function isAntigravitySession(session: Pick<AttachedSession, "runtime">): boolean;
/**
 * Claim an isolation-sensitive card synchronously before prompt() can yield.
 * Returns undefined for ordinary providers (caller sets busy itself).
 */
export declare function beginIsolationTurn(session: Pick<AttachedSession, "runtime" | "busy" | "isolationTurnId" | "cursorTurnId">): number | undefined;
/** @deprecated Prefer beginIsolationTurn — Cursor-named alias. */
export declare function beginCursorTurn(session: Pick<AttachedSession, "runtime" | "busy" | "isolationTurnId" | "cursorTurnId">): number | undefined;
export declare function abortCurrentIsolationTurn(session: Pick<AttachedSession, "runtime" | "isolationTurnId" | "isolationAbortedTurnId" | "cursorTurnId" | "cursorAbortedTurnId">): void;
/** @deprecated Prefer abortCurrentIsolationTurn. */
export declare function abortCurrentCursorTurn(session: Pick<AttachedSession, "runtime" | "isolationTurnId" | "isolationAbortedTurnId" | "cursorTurnId" | "cursorAbortedTurnId">): void;
export declare function isIsolationTurnAborted(session: Pick<AttachedSession, "isolationAbortedTurnId" | "cursorAbortedTurnId">, turnId: number): boolean;
/** @deprecated Prefer isIsolationTurnAborted. */
export declare function isCursorTurnAborted(session: Pick<AttachedSession, "isolationAbortedTurnId" | "cursorAbortedTurnId">, turnId: number): boolean;
export declare function isCurrentIsolationTurn(session: Pick<AttachedSession, "isolationTurnId" | "cursorTurnId">, turnId: number): boolean;
/** @deprecated Prefer isCurrentIsolationTurn. */
export declare function isCurrentCursorTurn(session: Pick<AttachedSession, "isolationTurnId" | "cursorTurnId">, turnId: number): boolean;
export declare class SessionRegistry {
    private readonly sessions;
    set(cardId: string, session: AttachedSession): void;
    get(cardId: string): AttachedSession | undefined;
    entries(): IterableIterator<[string, AttachedSession]>;
    delete(cardId: string): void;
    pingAll(): void;
    broadcast(cardId: string, payload: unknown): void;
}
//# sourceMappingURL=session-registry.d.ts.map