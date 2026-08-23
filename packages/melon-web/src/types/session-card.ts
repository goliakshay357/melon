import { nanoid } from 'nanoid';

export type CardStatus = 'idle' | 'streaming' | 'error';

export interface ToolRun {
    callId: string;
    name: string;
    status: 'running' | 'ok' | 'error';
    output: string;
}

export interface ChatMessage {
    role: 'user' | 'assistant';
    text: string;
    /** Model reasoning stream (thinking models only). */
    thinking?: string;
    /** Tool executions that happened during this turn. */
    tools?: ToolRun[];
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
    /** Visualization-first mode: agent explains with diagrams/scenes. */
    vizMode?: boolean;
}

export const newCardId = () => `card_${nanoid(8)}`;
