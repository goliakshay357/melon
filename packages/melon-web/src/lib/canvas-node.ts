import type { SessionCard } from '@/types/session-card';

/**
 * Resolve a canvas node from a sidebar entry.
 *
 * The Workspaces tree lists sessions, not cards. `cardId` is a fast path, but the
 * session file is the source of truth (the canvas cards carry it), so a stale
 * tree — or a server that does not send `cardId` — still finds the existing node.
 *
 * Returns `undefined` when the node is gone. Callers must NOT create a card in
 * that case; that was the "clicking a node spawns a duplicate" bug.
 */
export function resolveCanvasNode(
	cards: readonly SessionCard[],
	sessionFile: string | undefined,
	cardId?: string,
): SessionCard | undefined {
	if (cardId) {
		const byId = cards.find((c) => c.id === cardId);
		if (byId) return byId;
	}
	if (!sessionFile) return undefined;
	return cards.find((c) => c.sessionFile === sessionFile);
}
