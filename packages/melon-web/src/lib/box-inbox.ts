import type { BoxInboxItem, SessionCard } from '@/types/session-card';

export type PendingInboxRow = { card: SessionCard; item: BoxInboxItem };

/**
 * Pending inbound box mail across the given boxes, newest first.
 *
 * Pure so the inbox view and its tests share one definition of "needs a
 * decision": inbound only, status pending. Outbound / approved / dismissed
 * items are history and never appear here.
 */
export function pendingInboxRows(
	cards: SessionCard[],
	filterCardId?: string | null,
): PendingInboxRow[] {
	const rows: PendingInboxRow[] = [];
	for (const card of cards) {
		if (filterCardId && card.id !== filterCardId) continue;
		for (const item of card.boxInbox ?? []) {
			if (item.direction === 'in' && item.status === 'pending') {
				rows.push({ card, item });
			}
		}
	}
	return rows.sort((a, b) => b.item.createdAt - a.item.createdAt);
}
