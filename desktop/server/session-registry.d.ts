import type { FastifyReply } from "fastify";
import type { CardExtensionUiBridge } from "./extension-ui.ts";
export interface AttachedSession {
    runtime: any;
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
    promptQueue: string[];
    /** Guards the drain loop against re-entrant agent_end triggers. */
    draining?: boolean;
    /** Monotonic token for Cursor turns; prevents a settled old turn mutating a newer one. */
    cursorTurnId?: number;
    /** Cursor turn explicitly stopped by the user; its queue must remain paused. */
    cursorAbortedTurnId?: number;
    /** Extension UI (select/confirm/input) → Melon card question panel. */
    extensionUi?: CardExtensionUiBridge;
}
export declare function isCursorSession(session: Pick<AttachedSession, "runtime">): boolean;
/** Claim a Cursor card synchronously before prompt() can yield. */
export declare function beginCursorTurn(session: Pick<AttachedSession, "runtime" | "busy" | "cursorTurnId">): number | undefined;
export declare function abortCurrentCursorTurn(session: Pick<AttachedSession, "runtime" | "cursorTurnId" | "cursorAbortedTurnId">): void;
export declare function isCursorTurnAborted(session: Pick<AttachedSession, "cursorAbortedTurnId">, turnId: number): boolean;
export declare function isCurrentCursorTurn(session: Pick<AttachedSession, "cursorTurnId">, turnId: number): boolean;
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