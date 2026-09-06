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
	/** Invocation arguments as a truncated display string. */
	args?: string;
	/** Compact structured args (path/command/…) for pretty headers. */
	argsStructured?: Record<string, unknown>;
	/** Latest known output — pi sends cumulative snapshots, so this REPLACES. */
	output: string;
}

export interface ChatMessage {
	role: "user" | "assistant" | "system";
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
export type ExtensionUiDialogMethod = "select" | "confirm" | "input";

/** Pending extension UI dialog (from Melon SSE `extension_ui`). */
export interface PendingExtensionUi {
	id: string;
	method: ExtensionUiDialogMethod;
	title: string;
	options?: string[];
	message?: string;
	placeholder?: string;
}

/** Delivery ledger entry mirrored from the artifact's frontmatter `wires`. */
export interface NoteWireView {
	cardId: string;
	mode: "seed" | "inject";
	revision: number;
	status: "delivered" | "queued" | "failed";
	deliveredAt?: string;
	/** Artifact body drifted since this delivery — offer "send update". */
	stale?: boolean;
}

/**
 * Canvas-side state of a note node (kind: "note"). The artifact FILE at
 * `<folder>/.melon/notes/handoff/<artifactId>.md` is the source of truth;
 * `body` here is a display copy hydrated from it and saved back with PUT.
 */
export interface NoteState {
	/** null until generation succeeds (generating/error states). */
	artifactId: string | null;
	noteKind: "handoff" | "merge";
	state: "generating" | "ready" | "error";
	error?: string;
	body: string;
	/** true once the display copy was hydrated from disk / generation. */
	bodyLoaded: boolean;
	/** Bumped only when the body is replaced from the server (remounts the editor). */
	bodyVersion?: number;
	/** Unsaved local edits (debounced PUT in flight or queued). */
	dirty?: boolean;
	/** Live generation progress line ("distilling with …", failures, …). */
	statusLine?: string;
	/** Optional focus instruction the artifact was generated with. */
	focus?: string;
	/** Artifact file path (absolute, as reported by the server). */
	path?: string;
	revision: number;
	/** Model the artifact was distilled with (frontmatter generatedBy.model). */
	model?: string;
	/** Concurrency token from the last GET/PUT (server file mtime, ms). */
	mtimeMs: number;
	sourceCardId?: string;
	/** Merge retry inputs: the source cards captured at merge creation. */
	mergeSources?: Array<{ cardId?: string; title: string }>;
	wires: NoteWireView[];
}

export interface SessionCard {
	id: string;
	/** chat = AI conversation · document = markdown editor · note = file-backed artifact node */
	kind?: "chat" | "document" | "note";
	/** Note artifact state (kind: "note" only). */
	note?: NoteState;
	/** Raw markdown content for document cards. */
	documentContent?: string;
	/**
	 * File-backed manual document (.melon/notes/manual/<name>.md). When set,
	 * the FILE is the source of truth and edits autosave to it via PUT /file.
	 */
	documentFile?: string;
	/** Root the file lives under (agentCwd at creation — agent can read it). */
	documentCwd?: string;
	/** Bumped when the document body is adopted from disk (remounts editor). */
	documentVersion?: number;
	/** Concurrency token for manual saves (server file mtime, ms). */
	documentMtimeMs?: number;
	title: string;
	position: { x: number; y: number };
	parentId: string | null;
	/**
	 * Merge notes: edges from EVERY source card (parentId stays null so the
	 * single-parent fork edge logic is not triggered for note cards).
	 */
	parentIds?: string[];
	forkedFromEntryId?: string;
	status: CardStatus;
	messages: ChatMessage[];
	size?: { width: number; height: number };
	sessionFile?: string; // pi .jsonl on disk — source of truth for resume
	model?: string;
	/** Current thinking level of this card's session (server-synced via SSE). */
	thinkingLevel?: string;
	/**
	 * Levels the current model supports (server-synced). Undefined until the
	 * first attach; the picker falls back to pi's full list pre-attach.
	 */
	thinkingLevels?: string[];
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
	/** Restored into the card composer when the first prompt fails to send. */
	pendingDraft?: string;
	/**
	 * Unsent composer text. Lives here, not in the card component: React Flow
	 * unmounts off-screen nodes (onlyRenderVisibleElements), so component state
	 * would be dropped whenever the card scrolls out of view or the canvas is
	 * switched, silently erasing what the user typed.
	 */
	draft?: string;
	/** Blocking extension UI (select/confirm/input) above the inbox. */
	pendingExtensionUi?: PendingExtensionUi;
	/** Full trajectory trace — meta + every lifecycle event (for debugging). */
	sessionId?: string;
	events?: TraceEvent[];
}

export const newCardId = () => `card_${nanoid(8)}`;

/** Default chat/document card size when none is stored yet. */
export const DEFAULT_CARD_SIZE = { width: 480, height: 520 } as const;
