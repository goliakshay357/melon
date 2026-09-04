import type { FastifyReply } from "fastify";
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
	promptQueue: string[];
	/** Guards the drain loop against re-entrant agent_end triggers. */
	draining?: boolean;
	/** Extension UI (select/confirm/input) → Melon card question panel. */
	extensionUi?: CardExtensionUiBridge;
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
