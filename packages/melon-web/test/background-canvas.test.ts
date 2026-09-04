import { beforeEach, expect, it, vi } from "vitest";

type Frame = Record<string, unknown> & { type: string };

class FakeEventSource {
	static latest: FakeEventSource | null = null;
	static closed: FakeEventSource[] = [];
	url: string;
	closed = false;
	onopen?: () => void;
	onmessage?: (ev: { data: string }) => void;
	onerror?: () => void;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.latest = this;
	}
	close() {
		this.closed = true;
		FakeEventSource.closed.push(this);
	}
	emit(frame: Frame) {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}
}

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

async function fetchStub(url: string, init?: { method?: string }) {
	const u = String(url);
	if (u.endsWith("/sessions") && (init?.method ?? "GET") === "POST") {
		return {
			ok: true,
			status: 200,
			json: async () => ({ sessionFile: "/tmp/fake.jsonl", sessionId: "s1", model: "test/model" }),
		} as Response;
	}
	if (u.includes("/prompt")) {
		return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
	}
	if (u.includes("/canvases/cv_a") && (init?.method ?? "GET") === "GET") {
		return {
			ok: true,
			status: 200,
			json: async () => ({ id: "cv_a", name: "A", cards: [], viewport: undefined }),
		} as Response;
	}
	if (u.includes("/canvases/cv_b")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({ id: "cv_b", name: "B", cards: [], viewport: undefined }),
		} as Response;
	}
	if ((init?.method ?? "GET") === "PUT") {
		return { ok: true, status: 200, json: async () => ({}) } as Response;
	}
	return { ok: true, status: 200, json: async () => ({ canvases: [] }) } as Response;
}

vi.stubGlobal("localStorage", localStorageStub);
vi.stubGlobal("EventSource", FakeEventSource);
vi.stubGlobal("fetch", vi.fn(fetchStub));

let useCanvasStore: typeof import("../src/store/canvas-store.ts").useCanvasStore;

beforeEach(async () => {
	FakeEventSource.latest = null;
	FakeEventSource.closed = [];
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal("fetch", vi.fn(fetchStub));
	vi.resetModules();
	({ useCanvasStore } = await import("../src/store/canvas-store.ts"));
	useCanvasStore.setState({
		folder: "/tmp",
		hydrated: true,
		canvasId: "cv_a",
		canvasName: "A",
		cards: [],
		canvasActivity: {},
	});
});

it("keeps SSE streaming on a background canvas and updates activity dots", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	expect(await useCanvasStore.getState().sendMessage(cardId, "run in background")).toBe(true);
	const es = FakeEventSource.latest;
	expect(es).not.toBeNull();

	es?.emit({ type: "status", status: "streaming" });
	expect(useCanvasStore.getState().canvasActivity.cv_a).toBe("streaming");
	expect(useCanvasStore.getState().cards[0].status).toBe("streaming");

	await useCanvasStore.getState().switchCanvas("cv_b");
	expect(useCanvasStore.getState().canvasId).toBe("cv_b");
	expect(useCanvasStore.getState().cards).toEqual([]);
	// Dot source of truth for navbar — still streaming on A while viewing B.
	expect(useCanvasStore.getState().canvasActivity.cv_a).toBe("streaming");
	expect(useCanvasStore.getState().canvasActivity.cv_b).toBe("idle");

	// Background SSE still applies.
	es?.emit({ type: "status", status: "idle" });
	expect(useCanvasStore.getState().canvasActivity.cv_a).toBe("idle");
	expect(useCanvasStore.getState().canvasId).toBe("cv_b");

	// Return to A from cache — no cold settle wipe.
	es?.emit({ type: "status", status: "streaming" });
	expect(useCanvasStore.getState().canvasActivity.cv_a).toBe("streaming");
	await useCanvasStore.getState().switchCanvas("cv_a");
	expect(useCanvasStore.getState().canvasId).toBe("cv_a");
	expect(useCanvasStore.getState().cards.find((c) => c.id === cardId)?.status).toBe("streaming");
});

it("applies background deltas into the workspace cache", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	expect(await useCanvasStore.getState().sendMessage(cardId, "bg text")).toBe(true);
	const es = FakeEventSource.latest!;
	es.emit({ type: "status", status: "streaming" });

	await useCanvasStore.getState().switchCanvas("cv_b");
	es.emit({ type: "delta", text: "hello from bg" });
	useCanvasStore.getState().flushPending();

	await useCanvasStore.getState().switchCanvas("cv_a");
	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId);
	const last = card?.messages[card.messages.length - 1];
	expect(last?.role).toBe("assistant");
	expect(last?.text).toContain("hello from bg");
});

it("closes SSE when forgetting an active canvas that was never switched away", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	expect(await useCanvasStore.getState().sendMessage(cardId, "leak check")).toBe(true);
	const es = FakeEventSource.latest!;
	expect(es.closed).toBe(false);

	useCanvasStore.getState().forgetCanvas("cv_a");
	expect(es.closed).toBe(true);
});

it("ignores overlapping switchCanvas while one is in flight", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	let release!: () => void;
	const gate = new Promise<void>((r) => {
		release = r;
	});
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string }) => {
			const u = String(url);
			if (u.includes("/canvases/cv_b") && (init?.method ?? "GET") === "GET") {
				await gate;
				return {
					ok: true,
					status: 200,
					json: async () => ({ id: "cv_b", name: "B", cards: [], viewport: undefined }),
				} as Response;
			}
			return fetchStub(url, init);
		}),
	);

	const first = useCanvasStore.getState().switchCanvas("cv_b");
	await useCanvasStore.getState().switchCanvas("cv_b"); // overlapping — no-op
	expect(useCanvasStore.getState().canvasId).toBe("cv_a");
	release();
	await first;
	expect(useCanvasStore.getState().canvasId).toBe("cv_b");
});

it("updates cached workspace name on rename", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	await useCanvasStore.getState().switchCanvas("cv_b");
	await useCanvasStore.getState().renameCanvas("/tmp", "cv_a", "Renamed A");
	await useCanvasStore.getState().switchCanvas("cv_a");
	expect(useCanvasStore.getState().canvasName).toBe("Renamed A");
});
