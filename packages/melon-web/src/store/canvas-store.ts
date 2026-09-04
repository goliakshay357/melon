import { nanoid } from "nanoid";
import { create } from "zustand";
import {
	clampIntoView,
	findOpenSpot,
	type ScreenRect,
	SIDEBAR_COLLAPSED_WIDTH,
	SIDEBAR_WIDTH,
	type SpawnSize,
	spawnSize,
} from "@/lib/spawn";
import {
	type ChatMessage,
	DEFAULT_CARD_SIZE,
	newCardId,
	type PendingExtensionUi,
	type SessionCard,
	type ToolRun,
} from "@/types/session-card";

function cardWidth(c: SessionCard): number {
	return c.size?.width ?? DEFAULT_CARD_SIZE.width;
}

// cardId → live SSE stream state
const streams = new Map<
	string,
	{
		es: EventSource;
		buffer: string;
		thinkingBuffer: string;
		/** Text after this point belongs to the NEXT assistant message. */
		segSealed: boolean;
		/** rAF id for coalescing text/thinking patches (~1 paint), not a slow timer. */
		flushRaf?: number;
		/** Batched message mutation carried between SSE frames until applied. */
		pendingPatch?: (m: ChatMessage) => ChatMessage;
		pendingApply?: () => void;
		thinkingEventId?: string;
		thinkingStartTs?: number;
		toolNames?: Map<string, string>;
		/** User pressed stop — freeze the display, ignore further deltas. */
		stopRequested?: boolean;
		/** Throttle SSE glitch logs while a question stays open. */
		lastPendingSseErrorLog?: number;
	}
>();
const attached = new Set<string>(); // cardIds with an existing server-side session

/** Live in-memory canvases (including background ones still streaming). */
export type CanvasActivity = "idle" | "streaming" | "error";

interface WorkspaceSnapshot {
	cards: SessionCard[];
	viewport?: { x: number; y: number; zoom: number };
	name: string;
	touchedAt: number;
	worktreePath?: string | null;
	branch?: string | null;
	baseBranch?: string | null;
	useWorktree?: boolean;
}

const WORKSPACE_LRU_MAX = 8;
const workspaces = new Map<string, WorkspaceSnapshot>();
/** cardId → canvasId so SSE can patch background canvases. */
const cardCanvas = new Map<string, string>();

function activityOf(cards: SessionCard[]): CanvasActivity {
	if (cards.some((c) => c.status === "streaming")) return "streaming";
	if (cards.some((c) => c.status === "error")) return "error";
	return "idle";
}

function reindexCanvasCards(canvasId: string, cards: SessionCard[]) {
	for (const [cid, cv] of cardCanvas) {
		if (cv === canvasId) cardCanvas.delete(cid);
	}
	for (const c of cards) cardCanvas.set(c.id, canvasId);
}

function forgetWorkspace(canvasId: string) {
	const ws = workspaces.get(canvasId);
	if (ws) {
		for (const c of ws.cards) {
			const st = streams.get(c.id);
			if (st) {
				st.es.close();
				streams.delete(c.id);
			}
			attached.delete(c.id);
			cardCanvas.delete(c.id);
		}
		workspaces.delete(canvasId);
	}
	// Active canvas may never have been stashed (never switched away). Still
	// tear down its live SSE so delete/openFolder cannot leak streams.
	const active = useCanvasStore.getState();
	if (active.canvasId === canvasId) {
		for (const c of active.cards) {
			const st = streams.get(c.id);
			if (st) {
				st.es.close();
				streams.delete(c.id);
			}
			attached.delete(c.id);
			cardCanvas.delete(c.id);
		}
	}
}

function clearAllWorkspaces() {
	for (const id of [...workspaces.keys()]) forgetWorkspace(id);
	for (const [cardId, st] of streams) {
		st.es.close();
		streams.delete(cardId);
	}
	attached.clear();
	cardCanvas.clear();
	workspaces.clear();
	undoStack.length = 0;
	redoStack.length = 0;
}

function evictIdleWorkspaces(keepId: string | null) {
	const idle = [...workspaces.entries()]
		.filter(([id, w]) => {
			if (keepId && id === keepId) return false;
			if (activityOf(w.cards) !== "idle") return false;
			if (w.cards.some((c) => streams.has(c.id) || attached.has(c.id))) return false;
			return true;
		})
		.sort((a, b) => a[1].touchedAt - b[1].touchedAt);
	while (workspaces.size > WORKSPACE_LRU_MAX && idle.length > 0) {
		const [id] = idle.shift()!;
		const w = workspaces.get(id);
		workspaces.delete(id);
		if (w) for (const c of w.cards) cardCanvas.delete(c.id);
	}
}

function findCard(cardId: string): SessionCard | undefined {
	const state = useCanvasStore.getState();
	const active = state.cards.find((c) => c.id === cardId);
	if (active) return active;
	const canvasId = cardCanvas.get(cardId);
	if (!canvasId) return undefined;
	return workspaces.get(canvasId)?.cards.find((c) => c.id === cardId);
}

function stashActiveWorkspace() {
	const { canvasId, cards, viewport, canvasName, canvasActivity, worktreePath, branch, baseBranch, useWorktree } =
		useCanvasStore.getState();
	if (!canvasId) return;
	workspaces.set(canvasId, {
		cards: cards.map((c) => ({ ...c })),
		viewport,
		name: canvasName,
		touchedAt: Date.now(),
		worktreePath,
		branch,
		baseBranch,
		useWorktree,
	});
	reindexCanvasCards(canvasId, cards);
	useCanvasStore.setState({
		canvasActivity: { ...canvasActivity, [canvasId]: activityOf(cards) },
	});
	evictIdleWorkspaces(canvasId);
}

/**
 * Patch a card whether it lives on the active canvas or a background workspace.
 * Keeps SSE streaming updates alive after switchCanvas.
 */
function patchCardInStore(cardId: string, updater: (c: SessionCard) => SessionCard) {
	const state = useCanvasStore.getState();
	if (state.cards.some((c) => c.id === cardId)) {
		const cards = state.cards.map((c) => (c.id === cardId ? updater(c) : c));
		const canvasId = state.canvasId;
		const canvasActivity = canvasId
			? { ...state.canvasActivity, [canvasId]: activityOf(cards) }
			: state.canvasActivity;
		useCanvasStore.setState({ cards, canvasActivity });
		if (canvasId) {
			const prev = workspaces.get(canvasId);
			if (prev) workspaces.set(canvasId, { ...prev, cards, touchedAt: Date.now() });
			else {
				workspaces.set(canvasId, {
					cards,
					viewport: state.viewport,
					name: state.canvasName,
					touchedAt: Date.now(),
				});
			}
			reindexCanvasCards(canvasId, cards);
		}
		return;
	}
	const canvasId = cardCanvas.get(cardId);
	if (!canvasId) return;
	const ws = workspaces.get(canvasId);
	if (!ws) return;
	const cards = ws.cards.map((c) => (c.id === cardId ? updater(c) : c));
	workspaces.set(canvasId, { ...ws, cards, touchedAt: Date.now() });
	useCanvasStore.setState((s) => ({
		canvasActivity: { ...s.canvasActivity, [canvasId]: activityOf(cards) },
	}));
}

// Canvas layout undo/redo (add/delete/move/resize/fork). Document text and
// composer drafts own their own history (Milkdown / browser) and must not
// share this stack — see isTypingTarget() focus routing in canvas.tsx.
const UNDO_LIMIT = 25;
const undoStack: SessionCard[][] = [];
const redoStack: SessionCard[][] = [];

function cloneCards(cards: SessionCard[]): SessionCard[] {
	try {
		return structuredClone(cards);
	} catch {
		return JSON.parse(JSON.stringify(cards)) as SessionCard[];
	}
}

function pushUndo(cards: SessionCard[]) {
	undoStack.push(cloneCards(cards));
	if (undoStack.length > UNDO_LIMIT) undoStack.shift();
	redoStack.length = 0;
}

function applyCardSnapshot(snapshot: SessionCard[]) {
	const canvasId = useCanvasStore.getState().canvasId;
	useCanvasStore.setState({
		cards: snapshot,
		...(canvasId
			? {
					canvasActivity: {
						...useCanvasStore.getState().canvasActivity,
						[canvasId]: activityOf(snapshot),
					},
				}
			: {}),
	});
	if (canvasId) {
		const prev = workspaces.get(canvasId);
		workspaces.set(canvasId, {
			cards: snapshot,
			viewport: useCanvasStore.getState().viewport,
			name: prev?.name ?? useCanvasStore.getState().canvasName,
			touchedAt: Date.now(),
		});
		reindexCanvasCards(canvasId, snapshot);
	}
}

let eventIdCounter = 0;

/** Screen rect of the visible canvas area — sidebar overlays its left edge. */
function spawnScreen(sidebarCollapsed: boolean): ScreenRect {
	const width = typeof window === "undefined" ? 1280 : window.innerWidth;
	const height = typeof window === "undefined" ? 800 : window.innerHeight;
	return {
		left: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
		top: 0,
		width,
		height,
	};
}

/** Size a brand-new card should spawn at, for the current viewport + zoom. */
export function currentSpawnSize(): SpawnSize {
	const s = useCanvasStore.getState();
	const vp = s.viewport ?? { x: 0, y: 0, zoom: 1 };
	return spawnSize(spawnScreen(s.sidebarCollapsed), vp.zoom);
}

/** Place a spawn position inside the visible canvas area. */
function spawnPosition(position: { x: number; y: number }, size: SpawnSize): { x: number; y: number } {
	const s = useCanvasStore.getState();
	const vp = s.viewport ?? { x: 0, y: 0, zoom: 1 };
	return clampIntoView(position, size, vp, spawnScreen(s.sidebarCollapsed));
}

/** Structured trajectory event — feeds the waterfall view. */
function pushEvent(
	cardId: string,
	ev: { kind: import("@/types/session-card").TraceKind; name: string; detail?: string },
): string {
	const id = `ev_${++eventIdCounter}`;
	patchCardInStore(cardId, (c) => ({
		...c,
		events: [...(c.events ?? []), { id, ts: Date.now(), kind: ev.kind, name: ev.name, detail: ev.detail }].slice(
			-400,
		),
	}));
	return id;
}

/** Update the latest event of a card (duration/status/detail). */
function patchEvent(cardId: string, id: string, patch: Partial<import("@/types/session-card").TraceEvent>) {
	patchCardInStore(cardId, (c) => ({
		...c,
		events: (c.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
	}));
}

function pushLog(cardId: string, line: string) {
	const t = new Date().toLocaleTimeString([], { hour12: false });
	patchCardInStore(cardId, (c) => ({
		...c,
		logs: [...(c.logs ?? []), `${t}  ${line}`].slice(-60),
	}));
}

type ScrollAction = "pan" | "zoom";

/**
 * Live statuses (streaming/error) and pendingExtensionUi must never survive
 * persistence or a cold restore — the run/dialog ids die with the process, so
 * a zombie Stop button or question panel would lie. Strip both before save/load.
 */
function settleTransientStatuses(cards: SessionCard[]): SessionCard[] {
	return cards.map((c) => {
		const next = c.status === "idle" ? c : { ...c, status: "idle" as const };
		if (!next.pendingExtensionUi) return next;
		const { pendingExtensionUi: _drop, ...rest } = next;
		return rest;
	});
}

export interface CanvasMeta {
	id: string;
	name: string;
	modified?: string;
}

/** Agent isolation for a canvas (1code-style worktree). */
export type CanvasWorktreeMode = "isolated" | "local";

export type AppView = "canvas" | "skills" | "themes";

interface CanvasState {
	cards: SessionCard[];
	/** Which page fills the content area. Canvas stays mounted underneath. */
	activeView: AppView;
	setActiveView: (v: AppView) => void;
	/** Navbar collapse state — the settings page offsets by the navbar width. */
	sidebarCollapsed: boolean;
	setSidebarCollapsed: (v: boolean) => void;
	folder: string | null; // project root this canvas belongs to (canvas JSON location)
	canvasId: string | null;
	canvasName: string;
	/**
	 * Agent cwd when Isolated. Same as `folder` when Local / unset.
	 * Canvas JSON stays under `folder`/.melon/canvases/; checkout under
	 * `folder`/.melon/worktrees/<name>/.
	 */
	worktreePath: string | null;
	branch: string | null;
	baseBranch: string | null;
	useWorktree: boolean;
	worktreeMode: CanvasWorktreeMode;
	/** true once the initial restore from disk succeeded — autosave armed. */
	hydrated: boolean;
	serverOffline: boolean;
	/**
	 * True while switchCanvas/openCanvas is loading a target canvas.
	 * UI must not show EmptyCanvasHero during this window.
	 */
	canvasOpening: boolean;
	canvases: CanvasMeta[]; // canvases within current folder
	canvasTreeRev: number; // bumped on every canvas mutation — navigator listens
	/** Per-canvas run status — drives navbar dots for active AND background canvases. */
	canvasActivity: Record<string, CanvasActivity>;
	viewport?: { x: number; y: number; zoom: number };
	setViewport: (v: { x: number; y: number; zoom: number }) => void;
	restoreLast: () => Promise<void>;
	restoreLastInner: () => Promise<void>;
	startHealthPoll: () => void;
	/** Tear down live SSE and settle streaming cards when the backend dies. */
	markServerOffline: () => void;
	/** After /healthz recovers while the UI stayed open — resync transcripts. */
	healAfterReconnect: () => Promise<void>;
	hydrateMessages: (cardId: string, sessionFile?: string) => Promise<void>;
	flushPending: () => void;
	renameCanvas: (cwd: string, canvasId: string, name: string) => Promise<void>;
	openFolder: (folder: string) => Promise<void>;
	/**
	 * Open a canvas, including when it lives in another folder.
	 * Unlike openFolder, does not wipe to the empty-home composer mid-switch.
	 */
	openCanvas: (cwd: string, id: string) => Promise<void>;
	switchCanvas: (id: string) => Promise<void>;
	createCanvas: (name: string, opts?: { useWorktree?: boolean }) => Promise<void>;
	/** Drop a canvas from the live cache (SSE, activity). Call when deleting. */
	forgetCanvas: (id: string) => void;
	/** Agent working directory for the active canvas (worktree or folder). */
	agentCwd: () => string | null;
	startConversation: (
		text: string,
		position: { x: number; y: number },
		options: { model: string; skills: string[]; permission: "full" | "readonly" },
	) => Promise<boolean>;
	saveCanvas: () => Promise<void>;
	scrollAction: ScrollAction;
	setScrollAction: (a: ScrollAction) => void;
	addCard: (
		position: { x: number; y: number },
		parentId?: string | null,
		forcedId?: string,
		kind?: "chat" | "document",
		/** Omit to spawn at the viewport-aware default size. */
		size?: SpawnSize,
	) => string;
	forkCard: (parentId: string) => Promise<string>;
	moveCard: (id: string, position: { x: number; y: number }) => void;
	updateCard: (id: string, patch: Partial<SessionCard>) => void;
	setModel: (id: string, model: string) => void;
	setCardError: (id: string, message: string) => void;
	clearCardError: (id: string) => void;
	/** Move queued text into the composer draft without dropping what's there. */
	queueToDraft: (id: string, texts: string[]) => void;
	/**
	 * Remove a queued message (identified by its TEXT — pi's live queue
	 * mutates under any client-side index) from the agent's real queue.
	 * "removed" — gone from the server queue; "consumed" — the agent already
	 * took it (it's executing; the chip resyncs away); "dead" — the server has
	 * no such session (e.g. app restart) so the text was returned to the
	 * composer; "failed" — transient error, keep the chip.
	 */
	dropQueued: (id: string, text: string) => Promise<"removed" | "consumed" | "dead" | "failed">;
	/** Resync the local queue mirror from the server on card mount. */
	syncQueued: (id: string) => Promise<void>;
	/** Answer or cancel a pending extension UI dialog above the inbox. */
	respondExtensionUi: (
		id: string,
		body: { id: string; value: string } | { id: string; confirmed: boolean } | { id: string; cancelled: true },
	) => Promise<void>;
	setSkills: (id: string, skills: string[]) => void;
	abortCard: (id: string) => void;
	addLinkedCard: (sourceId: string) => void;
	resizeCard: (id: string, width: number, height: number) => void;
	/** Snapshot layout before a drag/resize so one gesture = one undo step. */
	beginCardGesture: () => void;
	undo: () => boolean;
	redo: () => boolean;
	deleteCards: (ids: string[]) => void;
	sendMessage: (cardId: string, text: string, opts?: { cwd?: string; sessionFile?: string }) => Promise<boolean>;
	resumeSession: (sessionFile: string) => Promise<string | null>;
}

function loadLastLocation(): { folder: string | null; canvasId: string | null } {
	try {
		return {
			folder: localStorage.getItem("melon:lastFolder"),
			canvasId: localStorage.getItem("melon:lastCanvas"),
		};
	} catch {
		return { folder: null, canvasId: null };
	}
}

let healthTimer: ReturnType<typeof setInterval> | null = null;
let restoring = false;
let startingConversation = false;
let healingReconnect = false;
/** Serialize canvas switches — overlapping switches corrupt the workspace cache. */
let switchingCanvas = false;

/** Close every live EventSource and clear attach state (server process is gone). */
function tearDownAllStreams(logLine: string) {
	for (const [cardId, st] of streams) {
		st.es.close();
		streams.delete(cardId);
		pushLog(cardId, logLine);
	}
	attached.clear();
}

/** Settle streaming/question/queue state on a card list after the backend dies. */
function settleCardsAfterDisconnect(cards: SessionCard[]): SessionCard[] {
	return cards.map((c) => {
		const streaming = c.status === "streaming";
		const queued = c.queue ?? [];
		if (!streaming && !c.pendingExtensionUi && queued.length === 0) return c;
		const base = c.pendingDraft;
		const pendingDraft =
			queued.length === 0 ? c.pendingDraft : base ? `${base}\n\n${queued.join("\n\n")}` : queued.join("\n\n");
		return {
			...c,
			status: streaming ? ("idle" as const) : c.status,
			pendingExtensionUi: undefined,
			queue: [],
			pendingDraft,
		};
	});
}

const loc = loadLastLocation();

export const useCanvasStore = create<CanvasState>((set, get) => ({
	cards: [],
	activeView: "canvas" as AppView,
	setActiveView: (v) => set({ activeView: v }),
	sidebarCollapsed: false,
	setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
	folder: loc.folder,
	canvasId: loc.canvasId,
	canvasName: "",
	worktreePath: null,
	branch: null,
	baseBranch: null,
	useWorktree: true,
	worktreeMode: "local",
	canvasOpening: false,
	canvases: [],
	canvasTreeRev: 0,
	canvasActivity: {},
	hydrated: false,
	serverOffline: false,
	agentCwd() {
		return get().worktreePath ?? get().folder;
	},
	setViewport(v) {
		set({ viewport: v });
	},

	// Reopen the last folder + canvas after a refresh.
	// Retries while the desktop/server is restarting — never silently blank.
	async restoreLast() {
		if (restoring) return;
		restoring = true;
		try {
			await get().restoreLastInner();
		} finally {
			restoring = false;
		}
	},

	async restoreLastInner() {
		const folder = localStorage.getItem("melon:lastFolder");
		if (!folder) {
			set({ hydrated: true });
			return;
		}
		set({ folder });
		let canvases: CanvasMeta[] | null = null;
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				const res = await fetch(`/canvases?cwd=${encodeURIComponent(folder)}`);
				if (res.ok) {
					canvases = (await res.json()).canvases ?? [];
					break;
				}
			} catch {
				/* retry */
			}
			set({ serverOffline: true });
			await new Promise((r) => setTimeout(r, 1200));
		}
		if (!canvases) {
			set({ serverOffline: true, hydrated: false });
			return;
		}
		set({ canvases, serverOffline: false });
		if (canvases.length === 0) {
			set({ hydrated: true });
			return;
		}
		const wanted = localStorage.getItem("melon:lastCanvas");
		const target = canvases.find((c) => c.id === wanted)?.id ?? canvases[0].id;
		await get().switchCanvas(target);
		set({ hydrated: true });
	},

	// Poll /healthz and auto-recover the UI the moment the server is back.
	startHealthPoll() {
		if (healthTimer) return;
		const tick = async () => {
			try {
				const res = await fetch("/healthz", { cache: "no-store" });
				const body = await res.json();
				if (res.ok && body?.ok === true) {
					const wasOffline = get().serverOffline;
					set({ serverOffline: false });
					if (!get().hydrated) {
						get().restoreLast();
					} else if (wasOffline) {
						void get().healAfterReconnect();
					}
				} else if (!get().serverOffline) {
					get().markServerOffline();
				}
			} catch {
				if (!get().serverOffline) get().markServerOffline();
			}
		};
		tick();
		healthTimer = setInterval(tick, 3000);
	},

	markServerOffline() {
		if (get().serverOffline) return;
		tearDownAllStreams("✗ connection lost — waiting for server");
		const state = get();
		const cards = settleCardsAfterDisconnect(state.cards);
		const canvasActivity = { ...state.canvasActivity };
		if (state.canvasId) canvasActivity[state.canvasId] = activityOf(cards);
		for (const [id, ws] of workspaces) {
			const next = settleCardsAfterDisconnect(ws.cards);
			workspaces.set(id, { ...ws, cards: next, touchedAt: Date.now() });
			canvasActivity[id] = activityOf(next);
		}
		set({ cards, canvasActivity, serverOffline: true });
	},

	async healAfterReconnect() {
		if (healingReconnect) return;
		healingReconnect = true;
		try {
			const { folder, cards } = get();
			if (folder) {
				try {
					const res = await fetch(`/canvases?cwd=${encodeURIComponent(folder)}`);
					if (res.ok) {
						set({ canvases: (await res.json()).canvases ?? [] });
					}
				} catch {
					/* list refresh is best-effort */
				}
			}
			const toHeal: Array<{ id: string; sessionFile: string }> = [];
			for (const c of cards) {
				if (c.sessionFile) toHeal.push({ id: c.id, sessionFile: c.sessionFile });
			}
			for (const ws of workspaces.values()) {
				for (const c of ws.cards) {
					if (c.sessionFile && !toHeal.some((t) => t.id === c.id)) {
						toHeal.push({ id: c.id, sessionFile: c.sessionFile });
					}
				}
			}
			for (const t of toHeal) {
				await get().hydrateMessages(t.id, t.sessionFile);
			}
		} finally {
			healingReconnect = false;
		}
	},

	// Single rename path — active-canvas name, disk, and navigator stay in sync.
	async renameCanvas(cwd, canvasId, name) {
		const trimmed = name.trim();
		if (!trimmed || !cwd || !canvasId) return;
		try {
			const res = await fetch(`/canvases/${canvasId}?cwd=${encodeURIComponent(cwd)}`);
			if (!res.ok) return;
			const data = await res.json();
			data.name = trimmed;
			const put = await fetch(`/canvases/${canvasId}`, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cwd, canvas: data }),
			});
			if (!put.ok) return;
		} catch {
			return;
		}
		// Reflect immediately everywhere (active title + background cache name).
		set((s) => ({
			canvasName: s.canvasId === canvasId ? trimmed : s.canvasName,
			canvasTreeRev: s.canvasTreeRev + 1,
		}));
		const cached = workspaces.get(canvasId);
		if (cached) workspaces.set(canvasId, { ...cached, name: trimmed, touchedAt: Date.now() });
	},

	async saveCanvas() {
		const {
			folder,
			canvasId,
			canvasName,
			cards,
			viewport,
			hydrated,
			worktreePath,
			branch,
			baseBranch,
			useWorktree,
			worktreeMode,
		} = get();
		if (!folder || !canvasId || !hydrated) return;
		const cold = settleTransientStatuses(cards);
		try {
			localStorage.setItem(`melon:backup:${canvasId}`, JSON.stringify({ name: canvasName, viewport, cards: cold }));
		} catch {
			/* quota — non-fatal */
		}
		await fetch(`/canvases/${canvasId}`, {
			method: "PUT",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				cwd: folder,
				canvas: {
					id: canvasId,
					name: canvasName || "Untitled",
					cwd: folder,
					viewport,
					cards: cold,
					worktreePath: worktreePath ?? undefined,
					branch: branch ?? undefined,
					baseBranch: baseBranch ?? undefined,
					useWorktree,
					worktreeMode,
				},
			}),
		}).catch(() => {});
	},

	async switchCanvas(id) {
		const folder = get().folder;
		if (!folder) return;
		if (switchingCanvas) return;

		const touchOpened = async () => {
			await fetch(`/canvases/${id}/touch`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cwd: folder }),
			}).catch(() => null);
			set((s) => ({ canvasTreeRev: s.canvasTreeRev + 1 }));
		};

		// Already open — still bump Recent so sidebar stays in sync.
		if (get().canvasId === id) {
			await touchOpened();
			return;
		}

		switchingCanvas = true;
		set({ canvasOpening: true });
		try {
			const prevId = get().canvasId;
			if (prevId) {
				stashActiveWorkspace();
				await get().saveCanvas();
			}
			// Layout history is per active canvas view — don't undo across switches.
			undoStack.length = 0;
			redoStack.length = 0;

			const applyWorktree = (cv: {
				worktreePath?: string | null;
				branch?: string | null;
				baseBranch?: string | null;
				useWorktree?: boolean;
				worktreeMode?: CanvasWorktreeMode;
			}) => {
				const path = typeof cv.worktreePath === "string" ? cv.worktreePath : null;
				const mode: CanvasWorktreeMode =
					cv.worktreeMode === "isolated" || (path && path !== folder) ? "isolated" : "local";
				return {
					worktreePath: path,
					branch: typeof cv.branch === "string" ? cv.branch : null,
					baseBranch: typeof cv.baseBranch === "string" ? cv.baseBranch : null,
					useWorktree: cv.useWorktree !== false,
					worktreeMode: mode,
				};
			};

			const cached = workspaces.get(id);
			if (cached) {
				const wt = applyWorktree(cached);
				set({
					cards: cached.cards,
					canvasId: id,
					canvasName: cached.name,
					viewport: cached.viewport,
					...wt,
					canvasActivity: {
						...get().canvasActivity,
						[id]: activityOf(cached.cards),
					},
				});
				reindexCanvasCards(id, cached.cards);
				workspaces.set(id, { ...cached, ...wt, touchedAt: Date.now() });
				localStorage.setItem("melon:lastCanvas", id);
				await touchOpened();
				return;
			}

			const res = await fetch(`/canvases/${id}?cwd=${encodeURIComponent(folder)}`).catch(() => null);
			if (!res?.ok) return;
			const cv = await res.json();
			const loaded = Array.isArray(cv.cards) ? (cv.cards as SessionCard[]) : [];
			// Cold load: no live SSE for these cards yet. Keep any still-attached
			// stream state if the card id somehow survived (should not after clear).
			// Strip zombie pendingExtensionUi — dialog ids are not durable.
			const cards = loaded.map((c) => (streams.has(c.id) ? c : settleTransientStatuses([c])[0]!));
			const name = cv.name ?? "Untitled";
			const viewport = cv.viewport as CanvasState["viewport"];
			const wt = applyWorktree(cv);
			set({
				cards,
				canvasId: id,
				canvasName: name,
				viewport,
				...wt,
				canvasActivity: { ...get().canvasActivity, [id]: activityOf(cards) },
			});
			workspaces.set(id, { cards, viewport, name, touchedAt: Date.now(), ...wt });
			reindexCanvasCards(id, cards);
			localStorage.setItem("melon:lastCanvas", id);
			evictIdleWorkspaces(id);
			// Ground truth pass only for cards without a live stream.
			for (const c of get().cards) {
				if (c.sessionFile && !streams.has(c.id)) await get().hydrateMessages(c.id, c.sessionFile);
			}
			await touchOpened();
		} finally {
			switchingCanvas = false;
			set({ canvasOpening: false });
		}
	},

	forgetCanvas(id) {
		forgetWorkspace(id);
		set((s) => {
			const next = { ...s.canvasActivity };
			delete next[id];
			return { canvasActivity: next };
		});
	},

	async createCanvas(name, opts) {
		if (!get().folder || get().serverOffline) return;
		if (get().canvasId) {
			stashActiveWorkspace();
			await get().saveCanvas();
		}
		undoStack.length = 0;
		redoStack.length = 0;
		const id = `cv_${nanoid(8)}`;
		const folder = get().folder!;
		const useWorktree = opts?.useWorktree !== false;
		set({
			canvasId: id,
			canvasName: name || "Untitled",
			cards: [],
			worktreePath: null,
			branch: null,
			baseBranch: null,
			useWorktree,
			worktreeMode: "local",
			canvasActivity: { ...get().canvasActivity, [id]: "idle" },
		});
		workspaces.set(id, {
			cards: [],
			name: name || "Untitled",
			touchedAt: Date.now(),
			useWorktree,
			worktreePath: null,
			branch: null,
			baseBranch: null,
		});
		localStorage.setItem("melon:lastCanvas", id);
		await get().saveCanvas();

		// 1code-style: allocate Isolated checkout under <folder>/.melon/worktrees/.
		try {
			const wtRes = await fetch(`/canvases/${id}/worktree`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cwd: folder, useWorktree }),
			});
			if (wtRes.ok) {
				const body = (await wtRes.json()) as {
					worktreePath?: string;
					branch?: string;
					baseBranch?: string;
					mode?: CanvasWorktreeMode;
				};
				const path = typeof body.worktreePath === "string" ? body.worktreePath : folder;
				const mode: CanvasWorktreeMode = body.mode === "isolated" ? "isolated" : "local";
				set({
					worktreePath: mode === "isolated" ? path : folder,
					branch: typeof body.branch === "string" ? body.branch : null,
					baseBranch: typeof body.baseBranch === "string" ? body.baseBranch : null,
					useWorktree,
					worktreeMode: mode,
				});
				const cached = workspaces.get(id);
				if (cached) {
					workspaces.set(id, {
						...cached,
						worktreePath: get().worktreePath,
						branch: get().branch,
						baseBranch: get().baseBranch,
						useWorktree,
					});
				}
				await get().saveCanvas();
			}
		} catch {
			/* Local fallback — agent still runs in folder */
		}

		// refresh list
		const res = await fetch(`/canvases?cwd=${encodeURIComponent(get().folder ?? "")}`).catch(() => null);
		if (res?.ok) set({ canvases: (await res.json()).canvases ?? [] });
		set((s) => ({ canvasTreeRev: s.canvasTreeRev + 1 }));
	},

	async startConversation(text, position, options) {
		const prompt = text.trim();
		const folder = get().folder;
		if (
			startingConversation ||
			!prompt ||
			!folder ||
			!options.model ||
			get().cards.length > 0 ||
			get().serverOffline
		) {
			return false;
		}
		startingConversation = true;
		try {
			if (!get().canvasId) {
				const names = new Set(get().canvases.map((canvas) => canvas.name));
				let number = 1;
				while (names.has(`Canvas ${number}`)) number++;
				await get().createCanvas(`Canvas ${number}`);
			}
			if (!get().canvasId) return false;

			const cardId = get().addCard(position);
			get().updateCard(cardId, {
				skills: options.skills,
				permission: options.permission,
			});
			get().setModel(cardId, options.model);
			const sent = await get().sendMessage(cardId, prompt, { cwd: get().agentCwd() ?? folder });
			if (!sent) get().updateCard(cardId, { pendingDraft: prompt });
			return sent;
		} finally {
			startingConversation = false;
		}
	},

	async openFolder(rawFolder) {
		// Keep the empty-state composer up: set the folder, load the canvas
		// list for the sidebar, but do not auto-open an existing canvas.
		// First send (or an explicit sidebar click) creates/opens a canvas.
		clearAllWorkspaces();
		set({
			folder: rawFolder,
			canvases: [],
			cards: [],
			canvasId: null,
			canvasName: "",
			worktreePath: null,
			branch: null,
			baseBranch: null,
			useWorktree: true,
			worktreeMode: "local",
			canvasActivity: {},
		});
		localStorage.setItem("melon:lastFolder", rawFolder);
		localStorage.removeItem("melon:lastCanvas");
		const res = await fetch(`/canvases?cwd=${encodeURIComponent(rawFolder)}`).catch(() => null);
		let canvases: CanvasMeta[] = [];
		if (res?.ok) canvases = (await res.json()).canvases ?? [];
		set({ canvases, hydrated: true, serverOffline: false });
	},

	async openCanvas(cwd, id) {
		if (get().folder === cwd) {
			await get().switchCanvas(id);
			return;
		}
		if (switchingCanvas) return;
		switchingCanvas = true;
		set({ canvasOpening: true });
		try {
			// Persist under the *current* folder before changing cwd — saveCanvas
			// reads folder from state.
			if (get().canvasId) {
				stashActiveWorkspace();
				await get().saveCanvas();
			}

			// Fetch list + canvas BEFORE mutating visible state. The previous
			// path set canvasId=null (and sometimes left cards=[]) mid-flight,
			// which stuck the empty-home hero when the load failed or the
			// prior view was already empty.
			const [listRes, canvasRes] = await Promise.all([
				fetch(`/canvases?cwd=${encodeURIComponent(cwd)}`).catch(() => null),
				fetch(`/canvases/${id}?cwd=${encodeURIComponent(cwd)}`).catch(() => null),
			]);
			if (!canvasRes?.ok) return;

			let canvases: CanvasMeta[] = [];
			if (listRes?.ok) canvases = ((await listRes.json()) as { canvases?: CanvasMeta[] }).canvases ?? [];
			const cv = await canvasRes.json();
			const loaded = Array.isArray(cv.cards) ? (cv.cards as SessionCard[]) : [];
			const cards = loaded.map((c) => (streams.has(c.id) ? c : settleTransientStatuses([c])[0]!));
			const name = (cv.name as string | undefined) ?? "Untitled";
			const viewport = cv.viewport as CanvasState["viewport"];
			const path = typeof cv.worktreePath === "string" ? cv.worktreePath : null;
			const mode: CanvasWorktreeMode =
				cv.worktreeMode === "isolated" || (path && path !== cwd) ? "isolated" : "local";
			const wt = {
				worktreePath: path,
				branch: typeof cv.branch === "string" ? cv.branch : null,
				baseBranch: typeof cv.baseBranch === "string" ? cv.baseBranch : null,
				useWorktree: cv.useWorktree !== false,
				worktreeMode: mode,
			};

			clearAllWorkspaces();
			undoStack.length = 0;
			redoStack.length = 0;
			set({
				folder: cwd,
				canvases,
				canvasId: id,
				canvasName: name,
				cards,
				viewport,
				...wt,
				canvasActivity: { [id]: activityOf(cards) },
				hydrated: true,
				serverOffline: false,
			});
			workspaces.set(id, { cards, viewport, name, touchedAt: Date.now(), ...wt });
			reindexCanvasCards(id, cards);
			localStorage.setItem("melon:lastFolder", cwd);
			localStorage.setItem("melon:lastCanvas", id);
			for (const c of get().cards) {
				if (c.sessionFile && !streams.has(c.id)) await get().hydrateMessages(c.id, c.sessionFile);
			}
			await fetch(`/canvases/${id}/touch`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cwd }),
			}).catch(() => null);
			set((s) => ({ canvasTreeRev: s.canvasTreeRev + 1 }));
		} finally {
			switchingCanvas = false;
			set({ canvasOpening: false });
		}
	},
	scrollAction: (localStorage.getItem("melon:scroll_action") as ScrollAction) || "pan",

	setScrollAction(a) {
		localStorage.setItem("melon:scroll_action", a);
		set({ scrollAction: a });
	},

	addCard(position, parentId = null, forcedId?: string, kind: "chat" | "document" = "chat", size?: SpawnSize) {
		pushUndo(get().cards);
		const parent = parentId ? get().cards.find((c) => c.id === parentId) : undefined;
		const cardSize = size ?? currentSpawnSize();
		const card: SessionCard = {
			id: forcedId ?? newCardId(),
			title: parent ? `↳ ${parent.title}`.slice(0, 44) : "New card",
			position: spawnPosition(position, cardSize),
			parentId,
			kind,
			status: "idle",
			messages: [],
			size: { width: cardSize.width, height: cardSize.height },
			debug: false,
			skills: [],
			documentContent: "",
		};
		set((s) => {
			const cards = [...s.cards, card];
			const canvasId = s.canvasId;
			if (canvasId) {
				cardCanvas.set(card.id, canvasId);
				const prev = workspaces.get(canvasId);
				workspaces.set(canvasId, {
					cards,
					viewport: s.viewport,
					name: s.canvasName,
					touchedAt: Date.now(),
					...(prev ? {} : {}),
				});
			}
			return { cards };
		});
		return card.id;
	},

	async forkCard(parentId) {
		if (get().serverOffline) return "";
		// addCard pushes undo — do not push twice or one Cmd+Z is a no-op.
		const parent = get().cards.find((c) => c.id === parentId);
		const childCardId = newCardId();
		const childSize = parent?.size ?? currentSpawnSize();
		const position = parent ? findOpenSpot(get().cards, parentId, childSize.width, childSize.height) : { x: 0, y: 0 };
		let sessionInfo: {
			sessionFile?: string;
			model?: string;
			forkedFromEntryId?: string;
		} | null = null;

		// Ask the server to clone the pi session (root→leaf → new .jsonl).
		try {
			const res = await fetch(`/sessions/${parentId}/fork`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					newCardId: childCardId,
					sessionFile: parent?.sessionFile,
				}),
			});
			if (!res.ok) throw new Error(await res.text());
			sessionInfo = await res.json();
			attached.add(childCardId);
			pushLog(childCardId, `✓ FORKED from ${parentId} — full transcript inherited`);
		} catch (e) {
			pushLog(
				parentId,
				`⚠️ server fork failed, card will attach on first message: ${e instanceof Error ? e.message : e}`,
			);
		}

		get().addCard(position, parentId, childCardId, "chat", childSize);
		get().updateCard(childCardId, {
			title: parent ? `↳ ${parent.title}`.slice(0, 44) : "New card",
			size: childSize,
			sessionFile: sessionInfo?.sessionFile,
			model: sessionInfo?.model,
			forkedFromEntryId: sessionInfo?.forkedFromEntryId,
		});
		if (sessionInfo?.sessionFile) await get().hydrateMessages(childCardId, sessionInfo.sessionFile);
		return childCardId;
	},

	moveCard(id, position) {
		get().updateCard(id, { position });
	},

	updateCard(id, patch) {
		patchCardInStore(id, (c) => ({ ...c, ...patch }));
	},

	// Toggle a card's active skills (persists via autosave; live-switches if attached).
	setSkills(id, skills) {
		get().updateCard(id, { skills });
		if (attached.has(id)) {
			fetch(`/sessions/${id}/skills`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ skills }),
			})
				.then(async (r) => {
					if (!r.ok) {
						const d = await r.json().catch(() => ({}) as any);
						pushLog(id, `✗ skills update failed: ${d.error ?? r.status}`);
					}
				})
				.catch((e) => pushLog(id, `✗ skills update failed: ${e instanceof Error ? e.message : e}`));
		}
	},

	// Branch a linked card beside the source, in the nearest free space.
	// Inherits the source's kind: document → document, chat → chat.
	addLinkedCard(sourceId) {
		const src = get().cards.find((c) => c.id === sourceId);
		const size = currentSpawnSize();
		const pos = findOpenSpot(get().cards, sourceId, size.width, size.height);
		get().addCard(pos, sourceId, undefined, src?.kind ?? "chat", size);
	},

	// Stop generation: freeze the display immediately, then abort server-side.
	abortCard(id) {
		const st = streams.get(id);
		if (st) st.stopRequested = true;
		pushLog(id, "⏹ stop requested — pausing output");
		get().updateCard(id, { pendingExtensionUi: undefined });
		fetch(`/sessions/${id}/abort`, { method: "POST" }).catch(() => {});
	},

	// Prominent on-card error banner.
	setCardError(id, message) {
		get().updateCard(id, { error: message });
	},
	clearCardError(id) {
		get().updateCard(id, { error: undefined });
	},

	// Server (pi's own queue) is ground truth — every path adopts the list it
	// returns so the client mirror can never drift from what will execute.
	queueToDraft(id, texts) {
		if (texts.length === 0) return;
		const cur = findCard(id);
		const base = cur?.pendingDraft;
		get().updateCard(id, {
			pendingDraft: base ? `${base}\n\n${texts.join("\n\n")}` : texts.join("\n\n"),
		});
	},

	async dropQueued(id, text) {
		pushLog(id, `[cancel] click: "${text.slice(0, 30)}"`);
		const res = await fetch(`/sessions/${id}/queue/remove`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text }),
		}).catch((e) => {
			pushLog(id, `[cancel] network error: ${e instanceof Error ? e.message : e}`);
			return null;
		});
		if (!res) return "failed";
		if (res?.status === 404) {
			// Only a definitive "unknown card" means the queue died with the
			// server (app restart). A missing ROUTE on a stale server also
			// 404s — clearing the queue there would silently drop live text.
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (body.error === "unknown card") {
				const cur = findCard(id);
				const orphans = [...(cur?.queue ?? [])];
				get().updateCard(id, { queue: [] });
				if (orphans.length) get().queueToDraft(id, orphans);
				pushLog(id, "⏳ server queue gone — text returned to composer");
				return "dead";
			}
			pushLog(id, `[cancel] 404 stale-server body=${JSON.stringify(body)}`);
			return "failed";
		}
		if (res?.status === 409) {
			// Agent already consumed it — it's executing now. Resync the chip.
			const d = (await res.json().catch(() => ({}))) as { followUp?: string[] };
			get().updateCard(id, { queue: d.followUp ?? [] });
			pushLog(id, `[cancel] 409 already executing, queue=${JSON.stringify(d.followUp ?? [])}`);
			return "consumed";
		}
		if (!res?.ok) {
			pushLog(id, `[cancel] failed HTTP ${res?.status ?? "?"}`);
			return "failed";
		}
		const d = (await res.json()) as { followUp?: string[] };
		get().updateCard(id, { queue: d.followUp ?? [] });
		pushLog(id, `[cancel] ok, queue=${JSON.stringify(d.followUp ?? [])}`);
		return "removed";
	},

	async syncQueued(id) {
		const res = await fetch(`/sessions/${id}/queue`).catch(() => null);
		// Network hiccup → keep the local mirror; a later sync or drop fixes it.
		if (!res) return;
		if (res.status === 404) {
			// "unknown card" = server restarted, the queue died with it —
			// orphan the text to the composer. Any other 404 (e.g. a stale
			// server without this route) must NOT touch the queue.
			const body = (await res.json().catch(() => ({}))) as { error?: string };
			if (body.error !== "unknown card") return;
			const cur = findCard(id);
			const orphans = [...(cur?.queue ?? [])];
			get().updateCard(id, { queue: [] });
			if (orphans.length) get().queueToDraft(id, orphans);
			return;
		}
		if (!res.ok) return;
		const d = (await res.json()) as { followUp?: string[] };
		get().updateCard(id, { queue: d.followUp ?? [] });
	},

	async respondExtensionUi(id, body) {
		const snapshot = findCard(id)?.pendingExtensionUi;
		// Clear while in-flight (panel sending flag + this) to avoid double-submit.
		// Restore on failure so a network/409 blip cannot leave the agent hung
		// with no UI.
		get().updateCard(id, { pendingExtensionUi: undefined });
		pushLog(
			id,
			`[extension-ui] respond ${"cancelled" in body && body.cancelled ? "cancelled" : "confirmed" in body ? `confirmed=${body.confirmed}` : `value=${String((body as { value: string }).value).slice(0, 80)}`}`,
		);
		const res = await fetch(`/sessions/${id}/extension-ui`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		}).catch(() => null);
		if (res?.ok) return;
		pushLog(id, `[extension-ui] respond failed HTTP ${res?.status ?? "?"} — restoring panel`);
		const cur = findCard(id);
		// Only restore if nothing newer replaced it (SSE clear / new dialog).
		if (snapshot && !cur?.pendingExtensionUi) {
			get().updateCard(id, { pendingExtensionUi: snapshot });
		}
	},

	// One path for model changes — keeps UI and backend in sync always.
	setModel(id, model) {
		const prev = findCard(id)?.model;
		get().updateCard(id, { model });
		// Persist as the new default for future cards.
		fetch("/settings/model", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model }),
		}).catch(() => {});
		// If this card already has a live session, switch it immediately.
		// On failure, REVERT the card's model so UI never lies about the backend.
		if (attached.has(id)) {
			fetch(`/sessions/${id}/model`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model }),
			})
				.then(async (r) => {
					if (!r.ok) {
						const d = await r.json().catch(() => ({}) as any);
						pushLog(id, `✗ model switch failed: ${d.error ?? r.status} — keeping ${prev ?? "current model"}`);
						get().setCardError(id, `Model switch failed: ${d.error ?? r.status}`);
						get().updateCard(id, { model: prev });
					} else {
						pushLog(id, `✓ model switched to ${model}`);
						get().clearCardError(id);
					}
				})
				.catch((e) => {
					pushLog(
						id,
						`✗ model switch failed: ${e instanceof Error ? e.message : e} — keeping ${prev ?? "current model"}`,
					);
					get().setCardError(id, `Model switch failed: ${e instanceof Error ? e.message : e}`);
					get().updateCard(id, { model: prev });
				});
		}
	},

	undo() {
		const snapshot = undoStack.pop();
		if (!snapshot) return false;
		redoStack.push(cloneCards(get().cards));
		if (redoStack.length > UNDO_LIMIT) redoStack.shift();
		applyCardSnapshot(snapshot);
		return true;
	},

	redo() {
		const snapshot = redoStack.pop();
		if (!snapshot) return false;
		undoStack.push(cloneCards(get().cards));
		if (undoStack.length > UNDO_LIMIT) undoStack.shift();
		applyCardSnapshot(snapshot);
		return true;
	},

	beginCardGesture() {
		pushUndo(get().cards);
	},

	resizeCard(id, width, height) {
		get().updateCard(id, { size: { width: Math.round(width), height: Math.round(height) } });
	},

	deleteCards(ids) {
		if (ids.length === 0) return;
		pushUndo(get().cards);
		const dead = new Set(ids);
		for (const id of ids) {
			const st = streams.get(id);
			if (st) {
				st.es.close();
				streams.delete(id);
			}
			attached.delete(id);
			cardCanvas.delete(id);
			fetch(`/sessions/${id}/abort`, { method: "POST" }).catch(() => {});
		}
		set((s) => {
			const cards = s.cards
				.filter((c) => !dead.has(c.id))
				.map((c) => (c.parentId && dead.has(c.parentId) ? { ...c, parentId: null } : c));
			const canvasId = s.canvasId;
			if (canvasId) {
				const prev = workspaces.get(canvasId);
				if (prev) workspaces.set(canvasId, { ...prev, cards, touchedAt: Date.now() });
				reindexCanvasCards(canvasId, cards);
			}
			return {
				cards,
				canvasActivity: canvasId ? { ...s.canvasActivity, [canvasId]: activityOf(cards) } : s.canvasActivity,
			};
		});
	},

	async resumeSession(sessionFile) {
		const cardId = newCardId();
		let transcript: any = null;
		try {
			const res = await fetch(`/sessions/resume`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ cardId, sessionFile }),
			});
			if (!res.ok) throw new Error(await res.text());
			transcript = await fetch(`/transcript?sessionFile=${encodeURIComponent(sessionFile)}`).then((r) => r.json());
		} catch {
			return null;
		}
		// Place resumed cards to the right of existing content.
		const cards = get().cards;
		const maxX = cards.length ? Math.max(...cards.map((c) => c.position.x + cardWidth(c))) : -DEFAULT_CARD_SIZE.width;
		get().addCard({ x: maxX + 48, y: cards.length ? cards[0].position.y : 0 }, null, cardId);
		const tMsgs = ((transcript?.messages ?? []) as any[]).filter(
			(mm: any) => mm.role === "user" || mm.text || mm.thinking || mm.tools?.length,
		);
		get().updateCard(cardId, {
			title: "Resumed session",
			sessionId: transcript?.sessionId ?? undefined,
			messages: tMsgs.map((mm: any) => ({
				role: mm.role,
				text: mm.text ?? "",
				thinking: mm.thinking,
				tools: mm.tools,
			})),
		});
		return cardId;
	},

	// Force-apply batched stream patches (tab close / visibility loss).
	flushPending() {
		for (const [cardId, st] of streams.entries()) {
			if (st.flushRaf != null) {
				cancelAnimationFrame(st.flushRaf);
				st.flushRaf = undefined;
			}
			if (!st.pendingPatch) continue;
			const fn = st.pendingPatch;
			st.pendingPatch = undefined;
			const cur = findCard(cardId);
			if (!cur) continue;
			const msgs = [...cur.messages];
			const last = msgs[msgs.length - 1];
			if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
			else msgs.push(fn({ role: "assistant", text: "" }));
			patchCardInStore(cardId, (c) => ({ ...c, messages: msgs }));
		}
	},

	// Rebuild chat from pi session ground truth (.jsonl).
	async hydrateMessages(cardId, sessionFile) {
		const file = sessionFile ?? findCard(cardId)?.sessionFile;
		if (!file) return;
		try {
			const res = await fetch(`/transcript?sessionFile=${encodeURIComponent(file)}`);
			if (!res.ok) return;
			const d = await res.json();
			const msgs = (d.messages ?? []).filter(
				(m: any) => m.role === "user" || m.text || m.thinking || m.tools?.length,
			);
			if (msgs.length === 0) return;
			get().updateCard(cardId, {
				sessionId: d.sessionId ?? undefined,
				messages: msgs.map((m: any) => ({
					role: m.role,
					text: m.text ?? "",
					thinking: m.thinking,
					tools: m.tools,
				})),
			});
			pushLog(cardId, `✓ transcript hydrated (${msgs.length} messages from .jsonl)`);
		} catch {
			/* keep whatever we have */
		}
	},

	async sendMessage(cardId, text, opts) {
		const card = findCard(cardId);
		if (!card || !text.trim()) return false;
		if (get().serverOffline) return false;
		const sessionFile = opts?.sessionFile ?? card.sessionFile;
		const cwd = opts?.cwd ?? get().agentCwd() ?? get().folder;
		if (!sessionFile && !cwd) {
			get().setCardError(cardId, "Choose a folder before starting a session.");
			return false;
		}
		// The user message is NOT appended here — if the agent is busy the
		// server queues it (pi followUp) and it must only land in the
		// transcript when its run actually starts (agent_start pops it from
		// card.queue). Rendering upfront made the message look sent while
		// the AI was still answering the previous prompt.
		const prevStatus = card.status;
		const isFirstMessage = card.messages.length === 0;
		get().updateCard(cardId, { status: "streaming", error: undefined });
		const rollback = (why: string) => {
			pushLog(cardId, `✗ ${why}`);
			get().updateCard(cardId, { status: prevStatus });
		};

		// ── 1. attach (idempotent, resume-first) ──
		if (!attached.has(cardId)) {
			const url = sessionFile ? `/sessions/resume` : `/sessions`;
			pushLog(cardId, `→ ATTACH ${sessionFile ? `RESUME ${sessionFile.split("/").pop()}` : `NEW cwd=${cwd}`}`);
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						sessionFile
							? { cardId, sessionFile, model: card.model, skills: card.skills ?? [] }
							: {
									cardId,
									cwd,
									model: card.model,
									skills: card.skills ?? [],
								},
					),
				});
				if (!res.ok) throw new Error(`attach ${res.status}: ${await res.text()}`);
				const info = (await res.json()) as {
					sessionFile?: string;
					sessionId?: string;
					model?: string;
					followUp?: string[];
				};
				get().updateCard(cardId, {
					sessionFile: info.sessionFile,
					model: info.model,
					// Server-truth queue — reconciles the mirror after reload/reconnect.
					queue: info.followUp ?? [],
				});
				attached.add(cardId);
				pushLog(
					cardId,
					`✓ attached — model ${info.model ?? "?"}${info.sessionFile ? ` | ${info.sessionFile.split("/").pop()}` : ""}`,
				);
				// structured attach event emitted below via pushEvent
			} catch (e) {
				const msg = `Attach failed: ${e instanceof Error ? e.message : e}`;
				rollback(msg);
				get().setCardError(cardId, msg);
				return false;
			}
		} else {
			pushLog(cardId, "• already attached");
		}

		// ── 2. SSE subscription (once per card) ──
		let st = streams.get(cardId);
		if (!st) {
			pushLog(cardId, `→ SSE connect`);
			const es = new EventSource(`/sessions/${cardId}/events`);
			st = {
				es,
				buffer: "",
				thinkingBuffer: "",
				segSealed: false,
				thinkingStartTs: Date.now(),
				toolNames: new Map(),
			};
			streams.set(cardId, st);
			es.onopen = () => pushLog(cardId, "✓ SSE open");
			es.onmessage = (ev) => {
				const data = JSON.parse(ev.data as string) as
					| { type: "delta"; text: string }
					| { type: "thinking"; text: string }
					| {
							type: "tool_start";
							callId: string;
							name: string;
							args?: string;
							argsStructured?: Record<string, unknown>;
					  }
					| { type: "tool_update"; callId: string; output: string }
					| {
							type: "tool_end";
							callId: string;
							isError: boolean;
							output: string;
							durationMs?: number;
					  }
					| { type: "raw"; text: string }
					| { type: "turn_end"; stopReason?: string; error?: string }
					| {
							type: "agent_meta";
							stopReason: string;
							inputTokens: number | null;
							outputTokens: number | null;
					  }
					| { type: "status"; status: "idle" | "streaming" | "error" }
					| { type: "error"; message: string }
					| { type: "context_usage"; tokens: number | null; contextWindow: number; percent: number | null }
					| { type: "queue"; followUp: string[] }
					| { type: "user_message"; text: string }
					| {
							type: "extension_ui";
							id: string;
							method: "select" | "confirm" | "input" | "notify";
							title?: string;
							options?: string[];
							message?: string;
							placeholder?: string;
							notifyType?: string;
					  }
					| { type: "extension_ui_clear"; id?: string };

				// Coalesce text/thinking patches to the next animation frame so the
				// UI tracks the stream closely (ChatGPT-style append) without a
				// 130ms "chunk dump". Pending state lives on the STREAM so a slow
				// flush can't spill into the NEXT output segment.
				const cancelFlush = () => {
					if (st!.flushRaf != null) {
						cancelAnimationFrame(st!.flushRaf);
						st!.flushRaf = undefined;
					}
				};
				const applyPending = () => {
					const fn = st!.pendingPatch;
					if (!fn) return;
					st!.pendingPatch = undefined;
					patchCardInStore(cardId, (c) => {
						const msgs = [...c.messages];
						const last = msgs[msgs.length - 1];
						if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
						else msgs.push(fn({ role: "assistant", text: "" }));
						return { ...c, messages: msgs };
					});
				};
				const patchLastAssistant = (fn: (m: ChatMessage) => ChatMessage, immediate = false) => {
					const prev = st!.pendingPatch;
					st!.pendingPatch = prev ? (m) => fn(prev(m)) : fn;
					if (immediate) {
						cancelFlush();
						applyPending();
						return;
					}
					if (st!.flushRaf == null) {
						st!.flushRaf = requestAnimationFrame(() => {
							st!.flushRaf = undefined;
							applyPending();
						});
					}
				};

				const ensureTool = (run: Partial<ToolRun> & { callId: string; name?: string }, _immediate = false) => {
					// Direct, targeted update: find the assistant message that CONTAINS this
					// tool by callId. Tool events can arrive AFTER a new output segment has
					// opened — updating only the last message would leave the real tool
					// stuck on "running" forever (the visible bug).
					patchCardInStore(cardId, (c) => {
						let found = false;
						const messages = c.messages.map((m) => {
							if (m.role !== "assistant" || found) return m;
							if (!m.tools?.some((t) => t.callId === run.callId)) return m;
							found = true;
							const tools = [...m.tools];
							const i = tools.findIndex((t) => t.callId === run.callId);
							if (i >= 0) tools[i] = { ...tools[i], ...run } as ToolRun;
							return { ...m, tools };
						});
						if (found) return { ...c, messages };
						// First sighting — attach to the last assistant message (or open one).
						const msgs = [...c.messages];
						const last = msgs[msgs.length - 1];
						if (last?.role === "assistant") {
							msgs[msgs.length - 1] = {
								...last,
								tools: [
									...(last.tools ?? []),
									{ name: "tool", status: "running", output: "", ...run } as ToolRun,
								],
							};
						} else {
							msgs.push({
								role: "assistant",
								text: "",
								tools: [{ name: "tool", status: "running", output: "", ...run } as ToolRun],
							});
						}
						return { ...c, messages: msgs };
					});
				};

				const appendToLastAssistant = (patch: { text?: string; thinking?: string }) => {
					patchLastAssistant((m) => ({ ...m, ...patch }));
				};

				/** Start a fresh assistant output — the previous turn's text is done. */
				const openAssistantSegment = () => {
					// Pending text belongs to the PREVIOUS segment — land it first.
					cancelFlush();
					applyPending();
					patchCardInStore(cardId, (c) => ({
						...c,
						messages: [...c.messages, { role: "assistant" as const, text: "", tools: [] }],
					}));
				};

				let __toolEvId = "";
				if (data.type === "tool_start") {
					__toolEvId = pushEvent(cardId, {
						kind: "tool",
						name: data.name,
						detail: data.args,
					});
					// Immediate — the ⚙ block must appear instantly.
					ensureTool(
						{
							callId: data.callId,
							name: data.name,
							args: data.args,
							argsStructured: data.argsStructured,
							output: "",
						},
						true,
					);
					// The tool call ends this assistant message — any answer that
					// follows is a NEW output block, not a continuation.
					st!.segSealed = true;
					st!.toolNames!.set(data.callId, data.name);
				} else if (data.type === "tool_update") {
					// Snapshot — REPLACE, never append.
					ensureTool({ callId: data.callId, output: data.output });
				} else if (data.type === "tool_end") {
					// Final result — replace + lock terminal state.
					ensureTool(
						{
							callId: data.callId,
							status: data.isError ? "error" : "ok",
							output: data.output,
						},
						true,
					);
					patchEvent(cardId, __toolEvId, {
						durMs: data.durationMs,
						detail: data.output.slice(0, 2000),
						status: data.isError ? "error" : "ok",
					});
					const tName = st!.toolNames?.get(data.callId) ?? data.callId.slice(0, 8);
					pushLog(
						cardId,
						`⚙ ${tName} ${data.isError ? "✗" : "✓"}${data.durationMs ? ` ${data.durationMs}ms` : ""}${data.isError && data.output ? ` — ${data.output.slice(0, 200)}` : ""}`,
					);
				} else if (data.type === "agent_meta") {
					const meta = `stopReason=${data.stopReason} tokens in:${data.inputTokens ?? "?"} out:${data.outputTokens ?? "?"}`;
					// Clock out any still-open thinking run.
					if (st!.thinkingEventId) {
						patchEvent(cardId, st!.thinkingEventId, {
							durMs: Date.now() - (st!.thinkingStartTs ?? Date.now()),
							status: "ok",
							detail: st!.thinkingBuffer.slice(-8000),
						});
						st!.thinkingEventId = undefined;
					}
					// Close the prompt event with total duration.
					const evs = findCard(cardId)?.events ?? [];
					const pe = [...evs].reverse().find((e) => e.id === promptEventId);
					if (pe) {
						patchEvent(cardId, pe.id, {
							durMs: Date.now() - pe.ts,
							status: data.stopReason === "aborted" ? "error" : "ok",
							detail: meta,
						});
					}
					pushLog(cardId, `← agent_end ${meta}`);
				} else if (data.type === "raw") {
					pushEvent(cardId, { kind: "system", name: "note", detail: data.text });
					pushLog(cardId, `• ${data.text}`);
				} else if (data.type === "turn_end") {
					st!.segSealed = true;
					if (data.error) {
						// Show the real failure reason, not just "turn_end (error)".
						const readable = data.error.split("stack=")[0].trim().slice(0, 300);
						pushEvent(cardId, { kind: "system", name: "error", detail: readable });
						pushLog(cardId, `✗ ${readable}`);
						get().setCardError(cardId, readable);
						// Failed turn — clear any open question (server also cancelAlls).
						useCanvasStore.getState().updateCard(cardId, { pendingExtensionUi: undefined });
					}
				} else if (data.type === "thinking") {
					if (!st!.thinkingEventId) {
						st!.thinkingEventId = pushEvent(cardId, {
							kind: "thinking",
							name: "reasoning",
							detail: "",
						});
						st!.thinkingStartTs = Date.now();
						const dbg = findCard(cardId);
						pushLog(
							cardId,
							`[state] thinking-start lastRole=${dbg?.messages[dbg.messages.length - 1]?.role} pending=${st!.pendingPatch ? "yes" : "no"} segSealed=${st!.segSealed}`,
						);
					}
					if (st!.segSealed) {
						st!.buffer = "";
						st!.thinkingBuffer = "";
						st!.segSealed = false;
						openAssistantSegment();
					}
					st!.thinkingBuffer += data.text;
					appendToLastAssistant({ thinking: st!.thinkingBuffer });
					// Thought process lives IN the event — inspect shows it anytime.
					patchEvent(cardId, st!.thinkingEventId, {
						detail: st!.thinkingBuffer.slice(-6000),
					});
				} else if (data.type === "delta") {
					if (st!.thinkingEventId) {
						// CLOCK OUT — duration + full thought process captured.
						patchEvent(cardId, st!.thinkingEventId, {
							durMs: Date.now() - (st!.thinkingStartTs ?? Date.now()),
							status: "ok",
							detail: st!.thinkingBuffer.slice(-8000),
						});
						st!.thinkingEventId = undefined;
					}
					if (st!.segSealed) {
						st!.buffer = "";
						st!.segSealed = false;
						openAssistantSegment();
					}
					st!.buffer += data.text;
					appendToLastAssistant({ text: st!.buffer });
				} else if (data.type === "status") {
					if (data.status === "idle") {
						st!.buffer = "";
						st!.thinkingBuffer = "";
						st!.segSealed = false;
						cancelFlush();
						applyPending();
						// Queue is server-truth ({type:"queue"} events) — do not
						// clear or pop here; consumption is detected server-side.
						const dbg = findCard(cardId);
						pushLog(
							cardId,
							`[state] idle roles=${JSON.stringify(dbg?.messages.map((m) => m.role))} pending=${st!.pendingPatch ? "yes" : "no"}`,
						);
						useCanvasStore.getState().updateCard(cardId, { status: "idle" });
						return;
					}
					if (data.status === "streaming") {
						const dbg = findCard(cardId);
						pushLog(
							cardId,
							`[state] streaming roles=${JSON.stringify(dbg?.messages.map((m) => m.role))} segSealed=${st!.segSealed}`,
						);
					}
					useCanvasStore.getState().updateCard(cardId, {
						status: data.status,
					});
				} else if ((data as { type: string }).type === "queue") {
					// Server-truth queue sync — the server owns the queue, the card
					// only mirrors it. No diffing, no client-side bookkeeping.
					const q = data as { followUp?: string[] };
					pushLog(cardId, `[queue-sync] server list=${JSON.stringify(q.followUp ?? [])}`);
					useCanvasStore.getState().updateCard(cardId, { queue: q.followUp ?? [] });
				} else if ((data as { type: string }).type === "user_message") {
					// A queued message just reached the model (drain started it).
					// Direct sends are appended optimistically — skip the echo.
					const um = data as { text: string };
					const cur = findCard(cardId);
					if (!cur) return;
					const last = cur.messages[cur.messages.length - 1];
					pushLog(
						cardId,
						`[state] user_message "${um.text.slice(0, 20)}" lastRole=${last?.role} pending=${st!.pendingPatch ? "yes" : "no"} segSealed=${st!.segSealed}`,
					);
					if (last?.role === "user" && last.text === um.text) return;
					useCanvasStore.getState().updateCard(cardId, {
						messages: [...cur.messages, { role: "user", text: um.text }],
					});
				} else if (data.type === "context_usage") {
					useCanvasStore.getState().updateCard(cardId, {
						contextUsage: {
							tokens: data.tokens,
							contextWindow: data.contextWindow,
							percent: data.percent,
						},
					});
				} else if ((data as { type: string }).type === "extension_ui") {
					const ui = data as {
						id: string;
						method: string;
						title?: string;
						options?: string[];
						message?: string;
						placeholder?: string;
						notifyType?: string;
					};
					if (ui.method === "notify") {
						pushLog(cardId, `• ${ui.message ?? ""}`);
						return;
					}
					if (ui.method !== "select" && ui.method !== "confirm" && ui.method !== "input") return;
					const pending: PendingExtensionUi = {
						id: ui.id,
						method: ui.method,
						title: ui.title ?? "",
						...(ui.options ? { options: ui.options } : {}),
						...(ui.message ? { message: ui.message } : {}),
						...(ui.placeholder ? { placeholder: ui.placeholder } : {}),
					};
					pushLog(cardId, `[extension-ui] ${ui.method}: ${pending.title.slice(0, 80)}`);
					useCanvasStore.getState().updateCard(cardId, { pendingExtensionUi: pending });
				} else if ((data as { type: string }).type === "extension_ui_clear") {
					const clear = data as { id?: string };
					const cur = findCard(cardId);
					if (!cur?.pendingExtensionUi) return;
					if (clear.id && cur.pendingExtensionUi.id !== clear.id) return;
					useCanvasStore.getState().updateCard(cardId, { pendingExtensionUi: undefined });
				} else if ((data as { type: string }).type === "error") {
					const msg = (data as { message?: string }).message;
					pushLog(cardId, `✗ agent error: ${msg ?? "unknown"}`);
					if (msg) pushEvent(cardId, { kind: "system", name: "error", detail: msg.slice(0, 300) });
					get().setCardError(cardId, msg ?? "agent error");
					const cur = findCard(cardId);
					const queuedBack = cur?.queue ?? [];
					// Turn is dead — drop any question panel so we don't look open while the agent is gone.
					useCanvasStore.getState().updateCard(cardId, {
						status: "error",
						queue: [],
						pendingExtensionUi: undefined,
					});
					if (queuedBack.length) {
						// The server queue holds these too — clear it or they would
						// execute as zombies on the next prompt. Server list wins.
						void fetch(`/sessions/${cardId}/queue/clear`, { method: "POST" })
							.then((r) => (r.ok ? (r.json() as Promise<{ followUp?: string[] }>) : null))
							.then((cleared) => get().queueToDraft(cardId, cleared?.followUp ?? queuedBack))
							.catch(() => get().queueToDraft(cardId, queuedBack));
					}
				}
			};
			es.onerror = () => {
				const cur = findCard(cardId);
				// Mid-question: keep the EventSource so the browser auto-reconnects
				// and the server can replay the dialog. Do NOT pretend idle (Stop
				// would vanish while the agent is still blocked on the answer).
				if (cur?.pendingExtensionUi) {
					if (cur.status !== "streaming") {
						useCanvasStore.getState().updateCard(cardId, { status: "streaming" });
					}
					const now = Date.now();
					if (!st!.lastPendingSseErrorLog || now - st!.lastPendingSseErrorLog > 5000) {
						st!.lastPendingSseErrorLog = now;
						pushLog(cardId, "✗ SSE glitch — keeping question open (auto-reconnect)");
					}
					return;
				}
				pushLog(cardId, "✗ SSE dropped — will re-attach on next message");
				st!.es.close();
				streams.delete(cardId);
				attached.delete(cardId);
				// The run's outcome is now unknowable — release the Stop button
				// instead of leaving the card stuck on streaming forever. Queued
				// text never reached the transcript — hand it back (server wins).
				const queuedBack = cur?.queue ?? [];
				useCanvasStore.getState().updateCard(cardId, { status: "idle", queue: [] });
				if (queuedBack.length) {
					fetch(`/sessions/${cardId}/queue/clear`, { method: "POST" })
						.then((r) => (r.ok ? (r.json() as Promise<{ followUp?: string[] }>) : null))
						.then((cleared) => get().queueToDraft(cardId, cleared?.followUp ?? queuedBack))
						.catch(() => get().queueToDraft(cardId, queuedBack));
				}
			};
		} else {
			st.buffer = "";
			st.thinkingBuffer = "";
			st.segSealed = false;
			st.thinkingStartTs = Date.now();
		}

		// ── 3. send ──
		const promptEventId = pushEvent(cardId, {
			kind: "prompt",
			name: text.slice(0, 60),
		});
		pushLog(cardId, `→ PROMPT "${text.slice(0, 40)}"`);
		let pres: Response;
		try {
			pres = await fetch(`/sessions/${cardId}/prompt`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					text,
					viz: card.vizMode === true,
					readonly: card.permission === "readonly",
				}),
			});
		} catch (e) {
			rollback(`send failed: ${e instanceof Error ? e.message : e}`);
			return false;
		}
		if (!pres.ok) {
			rollback(`prompt rejected HTTP ${pres.status}`);
			return false;
		}
		const pj = (await pres.json().catch(() => ({}))) as { queued?: boolean };
		if (pj.queued) {
			pushLog(cardId, "⏳ agent busy — message queued (renders when its run starts)");
			// NO local append here: the server broadcasts the authoritative
			// `queue` frame BEFORE this response arrives, and both landing set
			// the state — an append on top of the frame DUPLICATES the item
			// (seen as every queued chip rendering twice).
			return true;
		}
		// Accepted immediately — NOW it lands in the transcript.
		const cur = findCard(cardId);
		get().updateCard(cardId, {
			status: "streaming",
			title: isFirstMessage ? text.slice(0, 40) : card.title,
			messages: [...(cur?.messages ?? []), { role: "user", text }],
		});
		return true;
	},
}));
