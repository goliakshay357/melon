import { nanoid } from "nanoid";

export type CardStatus = "idle" | "streaming" | "error";

export type TraceKind = "prompt" | "thinking" | "tool" | "agent" | "system";

export interface TraceEvent {
	id: string;
	/** start timestamp (ms epoch) */
	ts: number;
	/** duration once finished */
	durMs?: number;
	kind: TraceKind;
	name: string;
	detail?: string;
	status?: "running" | "ok" | "error";
}

export interface ToolRun {
	callId: string;
	name: string;
	status: "running" | "ok" | "error";
	/** Invocation arguments (stable for the whole run). */
	args?: string;
	/** Latest known output — pi sends cumulative snapshots, so this REPLACES. */
	output: string;
}

export interface ChatMessage {
	role: "user" | "assistant";
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
	/** chat = AI conversation · document = Notion-like markdown editor */
	kind?: "chat" | "document";
	/** Raw markdown content for document cards. */
	documentContent?: string;
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
	/** Show the on-card debug console (logs). Defaults ON. */
	debug?: boolean;
	/** Prominent error banner — the current failure reason, if any. */
	error?: string;
	/** How full the model's context window is (from pi's getContextUsage). */
	contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
	/** Active skill ids for this card (injected into prompts). Default OFF. */
	skills?: string[];
	/** Manual mind-map arrow: side + position along side (0..1), plus line waypoints. */
	edgeToParent?: {
		sourceSide?: "top" | "bottom" | "left" | "right";
		sourceT?: number;
		targetSide?: "top" | "bottom" | "left" | "right";
		targetT?: number;
		waypoints?: Array<{ x: number; y: number }>;
	};
	/** Visualization-first mode: agent explains with diagrams/scenes. */
	vizMode?: boolean;
	/** Workspace permission for the agent. */
	permission?: "full" | "readonly";
	/** Messages queued while the agent was busy (DSH-style). */
	queue?: string[];
	/** Full trajectory trace — meta + every lifecycle event (for debugging). */
	sessionId?: string;
	events?: TraceEvent[];
}

export const newCardId = () => `card_${nanoid(8)}`;
