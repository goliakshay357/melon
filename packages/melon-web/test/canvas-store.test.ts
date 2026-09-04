import { beforeEach, expect, it, vi } from "vitest";
import { spawnSize } from "@/lib/spawn";
import type { SessionCard } from "@/types/session-card";

/**
 * Drives the real SSE onmessage handler in canvas-store with scripted frames
 * mirroring an agent run: think → tools → output → tools → think → output.
 * Verifies each output lands in its own assistant message instead of being
 * accumulated into one blob.
 */

type Frame = Record<string, unknown> & { type: string };

class FakeEventSource {
	static latest: FakeEventSource | null = null;
	url: string;
	onopen?: () => void;
	onmessage?: (ev: { data: string }) => void;
	onerror?: () => void;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.latest = this;
	}
	close() {}
	emit(frame: Frame) {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}
}

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

const fetchCalls: string[] = [];
async function fetchStub(url: string, init?: any) {
	fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
	return {
		ok: true,
		status: 200,
		json: async () =>
			url.endsWith("/sessions")
				? { sessionFile: "/tmp/fake-session.jsonl", sessionId: "s1", model: "test/model" }
				: url.includes("/prompt")
					? { ok: true }
					: url.startsWith("/canvases?")
						? { canvases: [] }
						: {},
	} as Response;
}

vi.stubGlobal("localStorage", localStorageStub);
vi.stubGlobal("EventSource", FakeEventSource);
vi.stubGlobal("fetch", vi.fn(fetchStub));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let useCanvasStore: typeof import("@/store/canvas-store").useCanvasStore;

beforeEach(async () => {
	FakeEventSource.latest = null;
	fetchCalls.length = 0;
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal("fetch", vi.fn(fetchStub));
	vi.resetModules();
	({ useCanvasStore } = await import("@/store/canvas-store"));
	useCanvasStore.setState({ folder: "/tmp", hydrated: true });
});

it("resets viewport to 100% zoom when creating a new canvas", async () => {
	useCanvasStore.getState().setViewport({ x: -400, y: 120, zoom: 0.35 });
	await useCanvasStore.getState().createCanvas("Fresh");
	expect(useCanvasStore.getState().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
	expect(useCanvasStore.getState().cards).toEqual([]);
});

it("segregates agent outputs into separate messages per turn", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	const sent = await useCanvasStore.getState().sendMessage(cardId, "refactor X");
	expect(sent).toBe(true);

	const es = FakeEventSource.latest;
	expect(es).not.toBeNull();

	// Simulated run: think → tool → answer → tool → think → answer → end.
	es?.emit({ type: "status", status: "streaming" });
	es?.emit({ type: "thinking", text: "t1-" });
	es?.emit({ type: "delta", text: "output ONE" });
	es?.emit({ type: "tool_start", callId: "c1", name: "bash", args: "ls" });
	es?.emit({ type: "tool_end", callId: "c1", isError: false, output: "file.ts", durationMs: 5 });
	es?.emit({ type: "thinking", text: "t2-" });
	es?.emit({ type: "delta", text: "output TWO" });
	es?.emit({ type: "turn_end", stopReason: "stop" }); // server sends it twice today
	es?.emit({ type: "turn_end", stopReason: "stop" });
	es?.emit({ type: "status", status: "idle" });

	// Flush batched (~130ms) message patches before asserting.
	await sleep(250);

	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	expect(card.status).toBe("idle");

	const msgs = card.messages;
	expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "assistant"]);

	// Turn 1: own thinking, own text, own tool run.
	expect(msgs[1].text).toBe("output ONE");
	expect(msgs[1].thinking).toBe("t1-");
	expect(msgs[1].tools).toHaveLength(1);
	expect(msgs[1].tools?.[0]).toMatchObject({ callId: "c1", status: "ok" });

	// Turn 2: separate block — NOT appended to turn 1's text.
	expect(msgs[2].text).toBe("output TWO");
	expect(msgs[2].thinking).toBe("t2-");
	expect(msgs[2].tools ?? []).toHaveLength(0);

	// Thinking must not bleed across segments either.
	expect(msgs[1].thinking).not.toContain("t2");
});

it("starts a fresh segment for a follow-up run on the same card", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	await useCanvasStore.getState().sendMessage(cardId, "first");
	const es = FakeEventSource.latest;
	es?.emit({ type: "delta", text: "run-one answer" });
	es?.emit({ type: "status", status: "idle" });
	await sleep(250);

	await useCanvasStore.getState().sendMessage(cardId, "second");
	es?.emit({ type: "delta", text: "run-two answer" });
	es?.emit({ type: "status", status: "idle" });
	await sleep(250);

	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	const texts = card.messages.map((m) => `${m.role}:${m.text}`);
	// The second run's answer must not merge into the first run's block.
	expect(texts).toEqual(["user:first", "assistant:run-one answer", "user:second", "assistant:run-two answer"]);
});

it("creates the first canvas and card from the empty-state prompt", async () => {
	const sent = await useCanvasStore.getState().startConversation(
		"map this repository",
		{ x: 120, y: 80 },
		{
			model: "test/model",
			skills: ["archify"],
			permission: "readonly",
			viewport: { x: 100, y: 40, zoom: 1 },
		},
	);

	expect(sent).toBe(true);
	expect(useCanvasStore.getState().canvasName).toBe("Canvas 1");
	expect(useCanvasStore.getState().cards).toHaveLength(1);
	expect(useCanvasStore.getState().viewport).toEqual({ x: 100, y: 40, zoom: 1 });
	expect(useCanvasStore.getState().cards[0]).toMatchObject({
		position: { x: 120, y: 80 },
		model: "test/model",
		skills: ["archify"],
		permission: "readonly",
		// Viewport-aware spawn size; node env has no window → 1280×800 fallback.
		size: spawnSize({ width: 1280, height: 800 }, 1),
	});
	expect(useCanvasStore.getState().cards[0].messages[0]).toEqual({
		role: "user",
		text: "map this repository",
	});
});

it("places a forked card to the right of its parent, not on top", async () => {
	const parentId = useCanvasStore.getState().addCard({ x: 100, y: 200 });
	useCanvasStore.getState().updateCard(parentId, {
		size: { width: 480, height: 520 },
		title: "Parent",
	});

	const childId = await useCanvasStore.getState().forkCard(parentId);
	const child = useCanvasStore.getState().cards.find((c) => c.id === childId);

	expect(child).toBeDefined();
	expect(child?.parentId).toBe(parentId);
	expect(child?.position.x).toBe(100 + 480 + 48);
	expect(child?.position.y).toBe(200);
	expect(child?.size).toEqual({ width: 480, height: 520 });
});

it("renders a queued message only when its run actually starts", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	await useCanvasStore.getState().sendMessage(cardId, "first");
	const es = FakeEventSource.latest;
	es?.emit({ type: "status", status: "streaming" });
	es?.emit({ type: "delta", text: "answering first" });
	await sleep(250); // flush batched delta patches

	// Agent busy → the server appends to its own queue and replies queued: true.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return {
				ok: true,
				status: 200,
				json: async () => (url.includes("/prompt") ? { ok: true, queued: true } : {}),
			} as Response;
		}),
	);

	await useCanvasStore.getState().sendMessage(cardId, "while busy");

	let card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	// The POST response alone must NOT touch the queue — the server's
	// authoritative `queue` frame does. No optimistic append (it duplicated
	// every chip when the frame landed first).
	expect(card.queue).toEqual([]);
	es?.emit({ type: "queue", followUp: ["while busy"] });
	card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	// Queued message must NOT be in the transcript yet — only in the queue.
	expect(card.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
	expect(card.queue).toEqual(["while busy"]);

	// Current run ends → server drains the queue: queue frame + user_message
	// frame land the bubble at the moment the run actually starts.
	es?.emit({ type: "turn_end", stopReason: "stop" });
	es?.emit({ type: "status", status: "idle" });
	es?.emit({ type: "queue", followUp: [] });
	es?.emit({ type: "user_message", text: "while busy" });
	es?.emit({ type: "delta", text: "answer to queued" });
	es?.emit({ type: "status", status: "idle" });
	await sleep(250);

	card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	expect(card.queue).toEqual([]);
	expect(card.messages.map((m) => `${m.role}:${m.text}`)).toEqual([
		"user:first",
		"assistant:answering first",
		"user:while busy",
		"assistant:answer to queued",
	]);
});

it("cancels and edits queued messages via the server queue", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	await useCanvasStore.getState().sendMessage(cardId, "first");
	const es = FakeEventSource.latest;
	es?.emit({ type: "status", status: "streaming" });

	// Queue two messages while busy.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return {
				ok: true,
				status: 200,
				json: async () => (url.includes("/prompt") ? { ok: true, queued: true } : {}),
			} as Response;
		}),
	);
	await useCanvasStore.getState().sendMessage(cardId, "second");
	await useCanvasStore.getState().sendMessage(cardId, "third");
	// Server broadcasts the authoritative list after each push.
	es?.emit({ type: "queue", followUp: ["second", "third"] });
	expect(useCanvasStore.getState().cards[0].queue).toEqual(["second", "third"]);

	// Server is ground truth: cancel by TEXT → remaining list comes back.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return {
				ok: true,
				status: 200,
				json: async () => (url.endsWith("/queue/remove") ? { ok: true, followUp: ["third"] } : {}),
			} as Response;
		}),
	);
	expect(await useCanvasStore.getState().dropQueued(cardId, "second")).toBe("removed");
	expect(useCanvasStore.getState().cards[0].queue).toEqual(["third"]);

	// Race: the agent consumed the item before the cancel landed → server
	// replies 409 with the current list; the client resyncs instead of erroring.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return {
				ok: false,
				status: 409,
				json: async () => ({ error: "queued message not found", followUp: [] }),
			} as unknown as Response;
		}),
	);
	expect(await useCanvasStore.getState().dropQueued(cardId, "third")).toBe("consumed");
	expect(useCanvasStore.getState().cards[0].queue).toEqual([]);

	// Dead server (app restart): the queue can never run — text must be
	// returned to the composer, not dropped.
	useCanvasStore.getState().updateCard(cardId, { queue: ["orphan one", "orphan two"] });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return { ok: false, status: 404, json: async () => ({ error: "unknown card" }) } as unknown as Response;
		}),
	);
	expect(await useCanvasStore.getState().dropQueued(cardId, "orphan one")).toBe("dead");
	expect(useCanvasStore.getState().cards[0].queue).toEqual([]);
	expect(useCanvasStore.getState().cards[0].pendingDraft).toBe("orphan one\n\norphan two");

	// Transient network failure → chip stays, nothing is lost.
	useCanvasStore.getState().updateCard(cardId, { queue: ["keep me"], pendingDraft: undefined });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			throw new Error("offline");
		}),
	);
	expect(await useCanvasStore.getState().dropQueued(cardId, "keep me")).toBe("failed");
	expect(useCanvasStore.getState().cards[0].queue).toEqual(["keep me"]);
	expect(useCanvasStore.getState().cards[0].pendingDraft).toBeUndefined();
});

it("resyncs the queue from the server on mount and restores orphaned text", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().updateCard(cardId, { queue: ["stale after restart"] });

	// Server restarted → unknown card → orphaned text goes to the composer.
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return {
				ok: false,
				status: 404,
				json: async () => ({ error: "unknown card" }),
			} as unknown as Response;
		}),
	);
	await useCanvasStore.getState().syncQueued(cardId);
	expect(useCanvasStore.getState().cards[0].queue).toEqual([]);
	expect(useCanvasStore.getState().cards[0].pendingDraft).toBe("stale after restart");

	// A 404 from a STALE server (route missing, body is not "unknown card")
	// must NOT touch the queue.
	useCanvasStore.getState().updateCard(cardId, { queue: ["keep me"], pendingDraft: undefined });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return { ok: false, status: 404, json: async () => ({ error: "not found" }) } as unknown as Response;
		}),
	);
	await useCanvasStore.getState().syncQueued(cardId);
	expect(useCanvasStore.getState().cards[0].queue).toEqual(["keep me"]);
	expect(useCanvasStore.getState().cards[0].pendingDraft).toBeUndefined();

	// Live server → adopt its list verbatim.
	useCanvasStore.getState().updateCard(cardId, { queue: ["old"] });
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: any) => {
			fetchCalls.push(`${init?.method ?? "GET"} ${url}`);
			return { ok: true, status: 200, json: async () => ({ followUp: ["fresh"] }) } as unknown as Response;
		}),
	);
	await useCanvasStore.getState().syncQueued(cardId);
	expect(useCanvasStore.getState().cards[0].queue).toEqual(["fresh"]);
});

it("orders queued-run thinking AFTER the previous turn's output (drain frame sequence)", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	await useCanvasStore.getState().sendMessage(cardId, "one");
	const es = FakeEventSource.latest;

	// Replay EXACTLY the frames the server emits around a drain: run "one"
	// streams, ends, queue drains, queued message "two" starts, thinks, answers.
	es?.emit({ type: "status", status: "streaming" });
	es?.emit({ type: "thinking", text: "think-A" });
	es?.emit({ type: "delta", text: "answer-A" });
	es?.emit({ type: "turn_end", stopReason: "stop" });
	es?.emit({ type: "agent_meta", stopReason: "stop", inputTokens: 1, outputTokens: 1 });
	es?.emit({ type: "status", status: "idle" });
	es?.emit({ type: "queue", followUp: [] });
	es?.emit({ type: "user_message", text: "two" });
	es?.emit({ type: "status", status: "streaming" });
	es?.emit({ type: "thinking", text: "think-B" });
	es?.emit({ type: "delta", text: "answer-B" });
	es?.emit({ type: "status", status: "idle" });
	await sleep(300);

	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId) as SessionCard;
	expect(card.messages.map((m) => m.role)).toEqual(["user", "assistant", "user", "assistant"]);
	// Run A: thinking + text in its own segment.
	expect(card.messages[1].thinking).toBe("think-A");
	expect(card.messages[1].text).toBe("answer-A");
	// The queued run's thinking must live in ITS OWN segment after its user
	// bubble — never inside the previous assistant message.
	expect(card.messages[2]).toEqual({ role: "user", text: "two" });
	expect(card.messages[3].thinking).toBe("think-B");
	expect(card.messages[3].text).toBe("answer-B");
});

it("keeps an empty canvas after choosing a folder that already has canvases", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string) => {
			fetchCalls.push(`GET ${url}`);
			return {
				ok: true,
				status: 200,
				json: async () =>
					url.startsWith("/canvases?") ? { canvases: [{ id: "cv_existing", name: "Old board" }] } : {},
			} as Response;
		}),
	);

	await useCanvasStore.getState().openFolder("/Users/me/project");

	expect(useCanvasStore.getState().folder).toBe("/Users/me/project");
	expect(useCanvasStore.getState().canvases).toEqual([{ id: "cv_existing", name: "Old board" }]);
	expect(useCanvasStore.getState().canvasId).toBeNull();
	expect(useCanvasStore.getState().cards).toHaveLength(0);
});

it("does not wipe cards to empty while opening a canvas in another folder", async () => {
	useCanvasStore.setState({
		folder: "/Users/me/project-a",
		canvasId: "cv_a",
		canvasName: "A",
		hydrated: true,
		cards: [],
		canvasOpening: false,
	});
	useCanvasStore.getState().addCard({ x: 10, y: 20 });
	const priorCardId = useCanvasStore.getState().cards[0].id;
	const cardCounts: number[] = [];

	let releaseList!: () => void;
	const listGate = new Promise<void>((r) => {
		releaseList = r;
	});

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			fetchCalls.push(`${method} ${u}`);
			if (u.startsWith("/canvases?") && method === "GET") {
				await listGate;
				return {
					ok: true,
					status: 200,
					json: async () => ({ canvases: [{ id: "cv_b", name: "B" }] }),
				} as Response;
			}
			if (u.includes("/canvases/cv_b") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_b",
						name: "B",
						cards: [
							{
								id: "card_b",
								title: "B card",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
						viewport: undefined,
					}),
				} as Response;
			}
			if (method === "PUT" || u.includes("/touch")) {
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	const unsub = useCanvasStore.subscribe((s) => {
		cardCounts.push(s.cards.length);
	});
	const opening = useCanvasStore.getState().openCanvas("/Users/me/project-b", "cv_b");
	// Atomic open: folder/canvasId stay on the prior canvas until both fetches
	// complete — never null mid-flight (that stuck EmptyCanvasHero).
	for (let i = 0; i < 50 && !useCanvasStore.getState().canvasOpening; i++) {
		await sleep(10);
	}
	expect(useCanvasStore.getState().canvasOpening).toBe(true);
	expect(useCanvasStore.getState().folder).toBe("/Users/me/project-a");
	expect(useCanvasStore.getState().canvasId).toBe("cv_a");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual([priorCardId]);
	releaseList();
	await opening;
	unsub();

	expect(useCanvasStore.getState().canvasId).toBe("cv_b");
	expect(useCanvasStore.getState().folder).toBe("/Users/me/project-b");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual(["card_b"]);
	expect(useCanvasStore.getState().canvasOpening).toBe(false);
	expect(cardCounts.every((n) => n > 0)).toBe(true);
});

it("keeps the current canvas when a cross-folder openCanvas fetch fails", async () => {
	useCanvasStore.setState({
		folder: "/Users/me/project-a",
		canvasId: "cv_a",
		canvasName: "A",
		hydrated: true,
		cards: [],
		canvasOpening: false,
	});
	useCanvasStore.getState().addCard({ x: 1, y: 2 });
	const priorCardId = useCanvasStore.getState().cards[0].id;

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			if (method === "PUT") return { ok: true, status: 200, json: async () => ({}) } as Response;
			if (u.includes("/canvases/cv_missing")) {
				return { ok: false, status: 404, json: async () => ({}) } as Response;
			}
			if (u.startsWith("/canvases?")) {
				return { ok: true, status: 200, json: async () => ({ canvases: [] }) } as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	await useCanvasStore.getState().openCanvas("/Users/me/project-b", "cv_missing");

	expect(useCanvasStore.getState().folder).toBe("/Users/me/project-a");
	expect(useCanvasStore.getState().canvasId).toBe("cv_a");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual([priorCardId]);
	expect(useCanvasStore.getState().canvasOpening).toBe(false);
});

it("refetches from disk when the in-memory cache has zero cards", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			if (method === "PUT" || u.includes("/touch")) {
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			if (u.includes("/canvases/cv_other") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_other",
						name: "Other",
						cards: [
							{
								id: "card_other",
								title: "Other",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
					}),
				} as Response;
			}
			if (u.includes("/canvases/cv_populated") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_populated",
						name: "Populated",
						cards: [
							{
								id: "card_disk",
								title: "From disk",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
					}),
				} as Response;
			}
			return { ok: false, status: 404, json: async () => ({}) } as Response;
		}),
	);

	// Active = empty seed for cv_populated (createCanvas-style). Stash it empty
	// by switching to another canvas, then switch back — must refetch disk.
	useCanvasStore.setState({
		folder: "/Users/me/project",
		canvasId: "cv_populated",
		canvasName: "Populated",
		hydrated: true,
		cards: [],
		canvasOpening: false,
	});
	await useCanvasStore.getState().switchCanvas("cv_other");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual(["card_other"]);

	await useCanvasStore.getState().switchCanvas("cv_populated");
	expect(useCanvasStore.getState().canvasId).toBe("cv_populated");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual(["card_disk"]);
});

it("heals a stuck empty view when re-selecting the same canvas", async () => {
	useCanvasStore.setState({
		folder: "/Users/me/project",
		canvasId: "cv_stuck",
		canvasName: "Stuck",
		hydrated: true,
		cards: [],
		canvasOpening: false,
	});

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			if (method === "PUT" || u.includes("/touch")) {
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			if (u.includes("/canvases/cv_stuck") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_stuck",
						name: "Stuck",
						cards: [
							{
								id: "card_healed",
								title: "Healed",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
					}),
				} as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	await useCanvasStore.getState().switchCanvas("cv_stuck");

	expect(useCanvasStore.getState().canvasId).toBe("cv_stuck");
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual(["card_healed"]);
	expect(useCanvasStore.getState().canvasOpening).toBe(false);
});

it("preserves Isolated worktree fields after addCard and switch", async () => {
	useCanvasStore.setState({
		folder: "/Users/me/project",
		canvasId: "cv_iso",
		canvasName: "Iso",
		hydrated: true,
		cards: [],
		worktreePath: "/Users/me/project/.melon/worktrees/calm-canyon",
		worktreeMode: "isolated",
		branch: "brave-owl-1",
		baseBranch: "main",
		useWorktree: true,
		worktreeMissing: false,
		canvasOpening: false,
	});
	useCanvasStore.getState().addCard({ x: 1, y: 2 });

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			if (method === "PUT" || u.includes("/touch")) {
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			if (u.includes("/canvases/cv_other") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_other",
						name: "Other",
						cards: [
							{
								id: "card_o",
								title: "O",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
						worktreeMode: "local",
					}),
				} as Response;
			}
			if (u.includes("/canvases/cv_iso") && method === "GET") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_iso",
						name: "Iso",
						worktreePath: "/Users/me/project/.melon/worktrees/calm-canyon",
						worktreeMode: "isolated",
						worktreeExists: true,
						branch: "brave-owl-1",
						cards: [
							{
								id: "card_iso",
								title: "I",
								position: { x: 0, y: 0 },
								parentId: null,
								kind: "chat",
								status: "idle",
								messages: [],
								size: { width: 400, height: 300 },
							},
						],
					}),
				} as Response;
			}
			return { ok: false, status: 404, json: async () => ({}) } as Response;
		}),
	);

	await useCanvasStore.getState().switchCanvas("cv_other");
	await useCanvasStore.getState().switchCanvas("cv_iso");

	expect(useCanvasStore.getState().worktreeMode).toBe("isolated");
	expect(useCanvasStore.getState().worktreePath).toBe("/Users/me/project/.melon/worktrees/calm-canyon");
	expect(useCanvasStore.getState().agentCwd()).toBe("/Users/me/project/.melon/worktrees/calm-canyon");
});

it("createCanvasInFolder does not save the old canvas under the new folder", async () => {
	const puts: string[] = [];
	useCanvasStore.setState({
		folder: "/Users/me/project-a",
		canvasId: "cv_a",
		canvasName: "A",
		hydrated: true,
		cards: [
			{
				id: "card_a",
				title: "A",
				position: { x: 0, y: 0 },
				parentId: null,
				kind: "chat",
				status: "idle",
				messages: [],
				size: { width: 400, height: 300 },
			},
		],
		canvasOpening: false,
	});

	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
			const u = String(url);
			const method = init?.method ?? "GET";
			if (method === "PUT") {
				const body = JSON.parse(String(init?.body ?? "{}")) as { cwd?: string; canvas?: { id?: string } };
				puts.push(`${body.cwd}::${body.canvas?.id}`);
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			if (u.startsWith("/canvases?") && u.includes("project-b")) {
				return { ok: true, status: 200, json: async () => ({ canvases: [] }) } as Response;
			}
			if (u.includes("/worktree") && method === "POST") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						mode: "local",
						worktreePath: "/Users/me/project-b",
					}),
				} as Response;
			}
			if (u.startsWith("/canvases?") && method === "GET") {
				return { ok: true, status: 200, json: async () => ({ canvases: [] }) } as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	await useCanvasStore.getState().createCanvasInFolder("/Users/me/project-b", "New B", {
		useWorktree: false,
	});

	expect(puts.some((p) => p.startsWith("/Users/me/project-a::cv_a"))).toBe(true);
	expect(puts.some((p) => p.startsWith("/Users/me/project-b::cv_a"))).toBe(false);
	expect(useCanvasStore.getState().folder).toBe("/Users/me/project-b");
	expect(useCanvasStore.getState().canvasId).not.toBe("cv_a");
	expect(useCanvasStore.getState().canvasId).toMatch(/^cv_/);
});

it("never starts a new session without an explicit folder", async () => {
	useCanvasStore.setState({ folder: null, canvasId: null, cards: [] });

	const sent = await useCanvasStore
		.getState()
		.startConversation("do not run this", { x: 0, y: 0 }, { model: "test/model", skills: [], permission: "full" });

	expect(sent).toBe(false);
	expect(useCanvasStore.getState().cards).toHaveLength(0);
	expect(fetchCalls.some((call) => call.endsWith("/sessions"))).toBe(false);
});

it("restores the question panel when extension-ui respond fails", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	const pending = {
		id: "ui-1",
		method: "select" as const,
		title: "Pick",
		options: ["a", "b"],
	};
	useCanvasStore.getState().updateCard(cardId, { pendingExtensionUi: pending });

	vi.stubGlobal(
		"fetch",
		vi.fn(async () => ({ ok: false, status: 409, json: async () => ({ error: "no matching" }) }) as Response),
	);

	await useCanvasStore.getState().respondExtensionUi(cardId, { id: "ui-1", value: "a" });

	expect(useCanvasStore.getState().cards[0].pendingExtensionUi).toEqual(pending);
});

it("clears the question panel on SSE error frames", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	const sent = await useCanvasStore.getState().sendMessage(cardId, "ask me");
	expect(sent).toBe(true);
	const es = FakeEventSource.latest!;
	es.emit({
		type: "extension_ui",
		id: "ui-err",
		method: "select",
		title: "Choose",
		options: ["x"],
	});
	expect(useCanvasStore.getState().cards[0].pendingExtensionUi?.id).toBe("ui-err");

	es.emit({ type: "error", message: "boom" });
	expect(useCanvasStore.getState().cards[0].pendingExtensionUi).toBeUndefined();
	expect(useCanvasStore.getState().cards[0].status).toBe("error");
});

it("keeps question open and status streaming on SSE drop mid-dialog", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	await useCanvasStore.getState().sendMessage(cardId, "ask me");
	const es = FakeEventSource.latest!;
	es.emit({
		type: "extension_ui",
		id: "ui-hold",
		method: "confirm",
		title: "Sure?",
		message: "Really?",
	});
	useCanvasStore.getState().updateCard(cardId, { status: "streaming" });

	es.onerror?.();

	const card = useCanvasStore.getState().cards[0];
	expect(card.pendingExtensionUi?.id).toBe("ui-hold");
	expect(card.status).toBe("streaming");
	// EventSource must stay open so the browser can auto-reconnect + replay.
	expect(FakeEventSource.latest).toBe(es);
});

it("strips pendingExtensionUi when saving canvas", async () => {
	useCanvasStore.setState({
		folder: "/tmp",
		canvasId: "cv_save",
		canvasName: "Save me",
		hydrated: true,
	});
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().updateCard(cardId, {
		status: "streaming",
		pendingExtensionUi: { id: "z", method: "input", title: "Name" },
	});

	let savedCards: SessionCard[] | undefined;
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (typeof url === "string" && url.startsWith("/canvases/") && init?.method === "PUT") {
				const body = JSON.parse(String(init.body)) as { canvas: { cards: SessionCard[] } };
				savedCards = body.canvas.cards;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	await useCanvasStore.getState().saveCanvas();

	expect(savedCards).toBeDefined();
	expect(savedCards![0].status).toBe("idle");
	expect(savedCards![0].pendingExtensionUi).toBeUndefined();
	// In-memory card still has the live dialog.
	expect(useCanvasStore.getState().cards[0].pendingExtensionUi?.id).toBe("z");
});

it("points every card at the canvas private copy cwd", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: RequestInit) => {
			if (typeof url === "string" && url.includes("/worktree") && init?.method === "POST") {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						ok: true,
						mode: "isolated",
						worktreePath: "/tmp/proj/.melon/worktrees/calm-canyon",
						branch: "amber-fox-aaaaaa",
						baseBranch: "main",
					}),
				} as Response;
			}
			return fetchStub(url, init);
		}),
	);
	useCanvasStore.setState({ folder: "/tmp/proj", hydrated: true });
	await useCanvasStore.getState().createCanvas("Shared copy");
	expect(useCanvasStore.getState().worktreeMode).toBe("isolated");
	expect(useCanvasStore.getState().agentCwd()).toBe("/tmp/proj/.melon/worktrees/calm-canyon");
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	expect(useCanvasStore.getState().agentCwd()).toBe("/tmp/proj/.melon/worktrees/calm-canyon");
});

it("edits the original folder when the user picks that option", async () => {
	useCanvasStore.setState({ folder: "/tmp/proj", hydrated: true });
	await useCanvasStore.getState().createCanvas("In place", { useWorktree: false });
	expect(useCanvasStore.getState().worktreeMode).toBe("local");
	expect(useCanvasStore.getState().worktreePath).toBeNull();
	expect(useCanvasStore.getState().agentCwd()).toBe("/tmp/proj");
});
