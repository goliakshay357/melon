import type { FastifyReply } from "fastify";

export interface AttachedSession {
	runtime: any; // AgentSessionRuntime — typed loosely: internals shift across pi versions
	clients: Set<FastifyReply>;
	busy: boolean;
	vizProtocolSent?: boolean;
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
