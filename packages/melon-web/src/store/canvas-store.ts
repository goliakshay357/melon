import { nanoid } from "nanoid";
import { create } from "zustand";
import { type ChatMessage, newCardId, type SessionCard, type ToolRun } from "@/types/session-card";


// cardId → live SSE stream state
const streams = new Map<
	string,
	{
		es: EventSource;
		buffer: string;
		thinkingBuffer: string;
		/** Text after this point belongs to the NEXT assistant message. */
		segSealed: boolean;
		flushTimer?: ReturnType<typeof setTimeout>;
		/** Batched message mutation carried between SSE frames until applied. */
		pendingPatch?: (m: ChatMessage) => ChatMessage;
		pendingApply?: () => void;
		thinkingEventId?: string;
		thinkingStartTs?: number;
	}
>();
const attached = new Set<string>(); // cardIds with an existing server-side session

// Undo stack: pre-mutation card snapshots (in-memory only).
const undoStack: SessionCard[][] = [];
function pushUndo(cards: SessionCard[]) {
	undoStack.push(cards.map((c) => ({ ...c })));
	if (undoStack.length > 25) undoStack.shift();
}

let eventIdCounter = 0;

/** Structured trajectory event — feeds the waterfall view. */
function pushEvent(
	cardId: string,
	ev: { kind: import("@/types/session-card").TraceKind; name: string; detail?: string },
): string {
	const id = `ev_${++eventIdCounter}`;
	useCanvasStore.setState((s) => ({
		cards: s.cards.map((c) =>
			c.id === cardId
				? {
						...c,
						events: [
							...(c.events ?? []),
							{ id, ts: Date.now(), kind: ev.kind, name: ev.name, detail: ev.detail },
						].slice(-400),
					}
				: c,
		),
	}));
	return id;
}

/** Update the latest event of a card (duration/status/detail). */
function patchEvent(cardId: string, id: string, patch: Partial<import("@/types/session-card").TraceEvent>) {
	useCanvasStore.setState((s) => ({
		cards: s.cards.map((c) =>
			c.id === cardId
				? {
						...c,
						events: (c.events ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)),
					}
				: c,
		),
	}));
}

function pushLog(cardId: string, line: string) {
	const t = new Date().toLocaleTimeString([], { hour12: false });
	useCanvasStore.setState((s) => ({
		cards: s.cards.map((c) =>
			c.id === cardId
				? {
						...c,
						logs: [...(c.logs ?? []), `${t}  ${line}`].slice(-60),
					}
				: c,
		),
	}));
}

type ScrollAction = "pan" | "zoom";

/**
 * Live statuses (streaming/error) must never survive persistence or a dropped
 * SSE stream — the run they describe is gone, so the Stop button would be
 * stuck forever. Coerce back to idle before saving or restoring cards.
 */
function settleTransientStatuses(cards: SessionCard[]): SessionCard[] {
	return cards.map((c) => (c.status === "idle" ? c : { ...c, status: "idle" }));
}

export interface CanvasMeta {
	id: string;
	name: string;
	modified?: string;
}

interface CanvasState {
	cards: SessionCard[];
	folder: string | null; // real directory this canvas belongs to
	canvasId: string | null;
	canvasName: string;
	/** true once the initial restore from disk succeeded — autosave armed. */
	hydrated: boolean;
	serverOffline: boolean;
	canvases: CanvasMeta[]; // canvases within current folder
	canvasTreeRev: number; // bumped on every canvas mutation — navigator listens
	viewport?: { x: number; y: number; zoom: number };
	setViewport: (v: { x: number; y: number; zoom: number }) => void;
	restoreLast: () => Promise<void>;
	restoreLastInner: () => Promise<void>;
	startHealthPoll: () => void;
	hydrateMessages: (cardId: string, sessionFile?: string) => Promise<void>;
	flushPending: () => void;
	renameCanvas: (cwd: string, canvasId: string, name: string) => Promise<void>;
	openFolder: (folder: string) => Promise<void>;
	switchCanvas: (id: string) => Promise<void>;
	createCanvas: (name: string) => Promise<void>;
	saveCanvas: () => Promise<void>;
	scrollAction: ScrollAction;
	setScrollAction: (a: ScrollAction) => void;
	addCard: (position: { x: number; y: number }, parentId?: string | null, forcedId?: string) => string;
	forkCard: (parentId: string) => Promise<string>;
	moveCard: (id: string, position: { x: number; y: number }) => void;
	updateCard: (id: string, patch: Partial<SessionCard>) => void;
	setModel: (id: string, model: string) => void;
	resizeCard: (id: string, width: number, height: number) => void;
	undo: () => boolean;
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

const loc = loadLastLocation();

export const useCanvasStore = create<CanvasState>((set, get) => ({
	cards: [],
	folder: loc.folder,
	canvasId: loc.canvasId,
	canvasName: "",
	canvases: [],
	canvasTreeRev: 0,
	hydrated: false,
	serverOffline: false,
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
				const res = await fetch('/healthz', { cache: 'no-store' });
				const body = await res.json();
				if (res.ok && body?.ok === true) {
					set({ serverOffline: false });
					if (!get().hydrated) get().restoreLast();
				} else {
					set({ serverOffline: true });
				}
			} catch {
				set({ serverOffline: true });
			}
		};
		tick();
		healthTimer = setInterval(tick, 3000);
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
		// Reflect immediately everywhere.
		set((s) => ({
			canvasName: s.canvasId === canvasId ? trimmed : s.canvasName,
			canvasTreeRev: s.canvasTreeRev + 1,
		}));
	},

	async saveCanvas() {
		const { folder, canvasId, canvasName, cards, viewport, hydrated } = get();
		if (!folder || !canvasId || !hydrated) return;
		try {
			localStorage.setItem(
				`melon:backup:${canvasId}`,
				JSON.stringify({ name: canvasName, viewport, cards: settleTransientStatuses(cards) }),
			);
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
					cards: settleTransientStatuses(cards),
				},
			}),
		}).catch(() => {});
	},

	async switchCanvas(id) {
		const folder = get().folder;
		if (!folder) return;
		const res = await fetch(`/canvases/${id}?cwd=${encodeURIComponent(folder)}`).catch(() => null);
		if (!res?.ok) return;
		const cv = await res.json();
		set({
			cards: settleTransientStatuses(Array.isArray(cv.cards) ? cv.cards : []),
			canvasId: id,
			canvasName: cv.name ?? "Untitled",
			viewport: cv.viewport,
		});
		localStorage.setItem("melon:lastCanvas", id);
		// Ground truth pass: rebuild chats from pi .jsonl files.
		for (const c of get().cards) {
			if (c.sessionFile) await get().hydrateMessages(c.id, c.sessionFile);
		}
	},

	async createCanvas(name) {
		if (!get().folder) return;
		const id = `cv_${nanoid(8)}`;
		set({ canvasId: id, canvasName: name || "Untitled", cards: [] });
		localStorage.setItem("melon:lastCanvas", id);
		await get().saveCanvas();
		// refresh list
		const res = await fetch(`/canvases?cwd=${encodeURIComponent(get().folder ?? "")}`).catch(() => null);
		if (res?.ok) set({ canvases: (await res.json()).canvases ?? [] });
	},

	async openFolder(rawFolder) {
		set({ folder: rawFolder, canvases: [], cards: [], canvasId: null });
		localStorage.setItem("melon:lastFolder", rawFolder);
		const res = await fetch(`/canvases?cwd=${encodeURIComponent(rawFolder)}`).catch(() => null);
		let canvases: CanvasMeta[] = [];
		if (res?.ok) canvases = (await res.json()).canvases ?? [];
		set({ canvases });
		if (canvases.length > 0) {
			await get().switchCanvas(canvases[0].id);
		}
	},
	scrollAction: (localStorage.getItem("melon:scroll_action") as ScrollAction) || "pan",

	setScrollAction(a) {
		localStorage.setItem("melon:scroll_action", a);
		set({ scrollAction: a });
	},

	addCard(position, parentId = null, forcedId?: string) {
		pushUndo(get().cards);
		const parent = parentId ? get().cards.find((c) => c.id === parentId) : undefined;
		const card: SessionCard = {
			id: forcedId ?? newCardId(),
			title: parent ? `↳ ${parent.title}`.slice(0, 44) : "New card",
			position,
			parentId,
			status: "idle",
			messages: [],
		};
		set((s) => ({ cards: [...s.cards, card] }));
		return card.id;
	},

	async forkCard(parentId) {
		pushUndo(get().cards);
		const parent = get().cards.find((c) => c.id === parentId);
		const childCardId = newCardId();
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

		get().addCard(
			{
				x: (parent?.position.x ?? 0) + 140,
				y: (parent?.position.y ?? 0) + 180,
			},
			parentId,
			childCardId,
		);
		get().updateCard(childCardId, {
			title: parent ? `↳ ${parent.title}`.slice(0, 44) : "New card",
			sessionFile: sessionInfo?.sessionFile,
			model: sessionInfo?.model,
			forkedFromEntryId: sessionInfo?.forkedFromEntryId,
		});
		return childCardId;
	},

	moveCard(id, position) {
		get().updateCard(id, { position });
	},

	updateCard(id, patch) {
		set((s) => ({
			cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
		}));
	},

	// One path for model changes — keeps UI and backend in sync always.
	setModel(id, model) {
		get().updateCard(id, { model });
		// Persist as the new default for future cards.
		fetch("/settings/model", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model }),
		}).catch(() => {});
		// If this card already has a live session, switch it immediately.
		if (attached.has(id)) {
			fetch(`/sessions/${id}/model`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ model }),
			}).catch(() => {});
		}
	},

	undo() {
		const snapshot = undoStack.pop();
		if (!snapshot) return false;
		set({ cards: snapshot });
		return true;
	},

	resizeCard(id, width, height) {
		get().updateCard(id, { size: { width: Math.round(width), height: Math.round(height) } });
	},

	deleteCards(ids) {
		if (ids.length === 0) return;
		pushUndo(get().cards);
		const dead = new Set(ids);
		set((s) => ({
			// Orphan children rather than cascading — forks survive parents in v1.
			cards: s.cards
				.filter((c) => !dead.has(c.id))
				.map((c) => (c.parentId && dead.has(c.parentId) ? { ...c, parentId: null } : c)),
		}));
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
			transcript = await fetch(
				`/transcript?sessionFile=${encodeURIComponent(sessionFile)}`,
			).then((r) => r.json());
		} catch {
			return null;
		}
		// Place resumed cards to the right of existing content.
		const cards = get().cards;
		const maxX = cards.length ? Math.max(...cards.map((c) => c.position.x)) : -400;
		get().addCard({ x: maxX + 440, y: cards.length ? cards[0].position.y : 0 }, null, cardId);
		const tMsgs = ((transcript?.messages ?? []) as any[]).filter(
			(mm: any) =>
				mm.role === "user" || mm.text || mm.thinking || mm.tools?.length,
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
            if (st.flushTimer) {
                clearTimeout(st.flushTimer);
                st.flushTimer = undefined;
            }
            if (!st.pendingPatch) continue;
            const fn = st.pendingPatch;
            st.pendingPatch = undefined;
            const cur = get().cards.find((c) => c.id === cardId);
            if (!cur) continue;
            const msgs = [...cur.messages];
            const last = msgs[msgs.length - 1];
            if (last?.role === "assistant") msgs[msgs.length - 1] = fn(last);
            else msgs.push(fn({ role: "assistant", text: "" }));
            useCanvasStore.setState((s) => ({
                cards: s.cards.map((c) =>
                    c.id === cardId ? { ...c, messages: msgs } : c,
                ),
            }));
        }
    },

    // Rebuild chat from pi session ground truth (.jsonl).
    async hydrateMessages(cardId, sessionFile) {
        const file = sessionFile ?? get().cards.find((c) => c.id === cardId)?.sessionFile;
        if (!file) return;
        try {
            const res = await fetch(
                `/transcript?sessionFile=${encodeURIComponent(file)}`,
            );
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
		const card = get().cards.find((c) => c.id === cardId);
		if (!card || !text.trim()) return false;
		// Snapshot for rollback — the user's text is never lost.
		const messagesBefore = [...card.messages];
		get().updateCard(cardId, {
			status: "streaming",
			title: card.messages.length === 0 ? text.slice(0, 40) : card.title,
			messages: [...card.messages, { role: "user", text }],
		});
		const rollback = (why: string) => {
			pushLog(cardId, `✗ ${why} — input restored`);
			get().updateCard(cardId, {
				status: "idle",
				messages: messagesBefore,
				queue: [],
			});
		};

		// ── 1. attach (idempotent, resume-first) ──
		if (!attached.has(cardId)) {
			const sessionFile = opts?.sessionFile ?? card.sessionFile;
			const url = sessionFile ? `/sessions/resume` : `/sessions`;
			pushLog(
				cardId,
				`→ ATTACH ${sessionFile ? `RESUME ${sessionFile.split("/").pop()}` : `NEW cwd=${opts?.cwd ?? "(default)"}`}`,
			);
			try {
				const res = await fetch(url, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(
						sessionFile
						? { cardId, sessionFile, model: card.model }
						: { cardId, cwd: opts?.cwd ?? get().folder ?? undefined, model: card.model },
					),
				});
				if (!res.ok) throw new Error(`attach ${res.status}: ${await res.text()}`);
				const info = (await res.json()) as {
					sessionFile?: string;
					sessionId?: string;
					model?: string;
				};
				get().updateCard(cardId, {
					sessionFile: info.sessionFile,
					model: info.model,
				});
				attached.add(cardId);
				// structured attach event emitted below via pushEvent
			} catch (e) {
				pushLog(cardId, `✗ ATTACH FAILED: ${e instanceof Error ? e.message : e}`);
				rollback("could not reach melon server");
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
			st = { es, buffer: "", thinkingBuffer: "", segSealed: false, thinkingStartTs: Date.now() };
			streams.set(cardId, st);
			es.onopen = () => pushLog(cardId, "✓ SSE open");
			es.onmessage = (ev) => {
				const data = JSON.parse(ev.data as string) as
					| { type: "delta"; text: string }
					| { type: "thinking"; text: string }
					| { type: "tool_start"; callId: string; name: string; args?: string }
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
					| { type: "error"; message: string };

				// Batched mutation of the newest assistant message (~8fps, anti-flicker).
				// Pending state lives on the STREAM (not this per-frame closure) so it
				// survives across frames, and is never re-targeted — a slow flush can't
				// spill into the NEXT output segment.
				const cancelFlush = () => {
					if (st!.flushTimer) {
						clearTimeout(st!.flushTimer);
						st!.flushTimer = undefined;
					}
				};
				const applyPending = () => {
					const fn = st!.pendingPatch;
					if (!fn) return;
					st!.pendingPatch = undefined;
					const cur = useCanvasStore.getState().cards.find((c) => c.id === cardId);
					if (!cur) return;
					const msgs = [...cur.messages];
					const last = msgs[msgs.length - 1];
					if (last?.role === "assistant") {
						msgs[msgs.length - 1] = fn(last);
					} else {
						msgs.push(fn({ role: "assistant", text: "" }));
					}
					useCanvasStore.setState((s) => ({
						cards: s.cards.map((c) => (c.id === cardId ? { ...c, messages: msgs } : c)),
					}));
				};
				const patchLastAssistant = (fn: (m: ChatMessage) => ChatMessage, immediate = false) => {
					const prev = st!.pendingPatch;
					st!.pendingPatch = prev ? (m) => fn(prev(m)) : fn;
					if (immediate) {
						cancelFlush();
						applyPending();
						return;
					}
					if (!st!.flushTimer) {
						st!.flushTimer = setTimeout(() => {
							st!.flushTimer = undefined;
							applyPending();
						}, 130);
					}
				};

				const ensureTool = (run: Partial<ToolRun> & { callId: string; name?: string }, immediate = false) => {
					patchLastAssistant((m) => {
						const tools = [...(m.tools ?? [])];
						const i = tools.findIndex((t) => t.callId === run.callId);
						if (i >= 0) tools[i] = { ...tools[i], ...run } as ToolRun;
						else
							tools.push({
								name: "tool",
								status: "running",
								output: "",
								...run,
							} as ToolRun);
						return { ...m, tools };
					}, immediate);
				};

				const appendToLastAssistant = (patch: { text?: string; thinking?: string }) => {
					patchLastAssistant((m) => ({ ...m, ...patch }));
				};

				/** Start a fresh assistant output — the previous turn's text is done. */
				const openAssistantSegment = () => {
					// Pending text belongs to the PREVIOUS segment — land it first.
					cancelFlush();
					applyPending();
					useCanvasStore.setState((s) => ({
						cards: s.cards.map((c) =>
							c.id === cardId
								? { ...c, messages: [...c.messages, { role: "assistant" as const, text: "", tools: [] }] }
								: c,
						),
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
							output: "",
						},
						true,
					);
					// The tool call ends this assistant message — any answer that
					// follows is a NEW output block, not a continuation.
					st!.segSealed = true;
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
					pushLog(
						cardId,
						`⚙ ${data.callId.slice(0, 8)} ${data.isError ? "✗" : "✓"}${data.durationMs ? ` ${data.durationMs}ms` : ""}`,
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
					const evs = useCanvasStore.getState().cards.find((c) => c.id === cardId)?.events ?? [];
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
					}
				} else if (data.type === "thinking") {
					if (!st!.thinkingEventId) {
						st!.thinkingEventId = pushEvent(cardId, {
							kind: "thinking",
							name: "reasoning",
							detail: "",
						});
						st!.thinkingStartTs = Date.now();
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
						// Run finished → queued messages have been consumed.
						useCanvasStore.getState().updateCard(cardId, {
							status: "idle",
							queue: [],
						});
						return;
					}
					useCanvasStore.getState().updateCard(cardId, {
						status: data.status,
					});
				} else if ((data as { type: string }).type === "error") {
					pushLog(cardId, "✗ agent error");
					useCanvasStore.getState().updateCard(cardId, {
						status: "error",
						queue: [],
					});
				}
			};
			es.onerror = () => {
				pushLog(cardId, "✗ SSE dropped — will re-attach on next message");
				st!.es.close();
				streams.delete(cardId);
				attached.delete(cardId);
				// The run's outcome is now unknowable — release the Stop button
				// instead of leaving the card stuck on streaming forever.
				useCanvasStore.getState().updateCard(cardId, { status: "idle" });
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
			pushLog(cardId, "⏳ agent busy — message queued");
			const cur = get().cards.find((c) => c.id === cardId);
			get().updateCard(cardId, { queue: [...(cur?.queue ?? []), text] });
		}
		return true;
	},
}));
