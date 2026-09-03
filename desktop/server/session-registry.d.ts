import type { FastifyReply } from "fastify";
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
}
export declare class SessionRegistry {
    private readonly sessions;
    set(cardId: string, session: AttachedSession): void;
    get(cardId: string): AttachedSession | undefined;
    delete(cardId: string): void;
    pingAll(): void;
    broadcast(cardId: string, payload: unknown): void;
}
//# sourceMappingURL=session-registry.d.ts.map