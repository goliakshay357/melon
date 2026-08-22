import { nanoid } from 'nanoid';

export type CardStatus = 'idle' | 'streaming' | 'error';

export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
}

/**
 * Layout + stub conversation state.
 * Phase 2: `messages` moves out into pi session files; this keeps only
 * id / position / lineage. `forkedFromEntryId` is melon-owned because
 * pi's session header records parentSession but NOT the fork-point entry.
 */
export interface SessionCard {
    id: string;
    title: string;
    position: { x: number; y: number };
    parentId: string | null;
    forkedFromEntryId?: string;
    status: CardStatus;
    messages: ChatMessage[];
    size?: { width: number; height: number };
    sessionFile?: string; // pi .jsonl on disk — source of truth for resume
    model?: string;
    logs?: string[]; // live pipe trace, newest last
}

export const newCardId = () => `card_${nanoid(8)}`;
