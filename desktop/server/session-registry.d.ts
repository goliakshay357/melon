import type { FastifyReply } from "fastify";
export interface AttachedSession {
    runtime: any;
    clients: Set<FastifyReply>;
    busy: boolean;
    vizProtocolSent?: boolean;
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