import type { FastifyReply } from "fastify";

export interface AttachedSession {
	runtime: any; // AgentSessionRuntime — typed loosely: internals shift across pi versions
	clients: Set<FastifyReply>;
	busy: boolean;
}

export class SessionRegistry {
	private readonly sessions = new Map<string, AttachedSession>();

	set(cardId: string, session: AttachedSession): void {
		this.sessions.set(cardId, session);
	}

	get(cardId: string): AttachedSession | undefined {
		return this.sessions.get(cardId);
	}

	delete(cardId: string): void {
		this.sessions.delete(cardId);
	}

	broadcast(cardId: string, payload: unknown): void {
		const s = this.sessions.get(cardId);
		if (!s) return;
		for (const client of s.clients) {
			client.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
		}
	}
}
