import { beforeEach, expect, it, vi } from "vitest";

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

async function fetchStub(url: string, init?: { method?: string }) {
	const u = String(url);
	if ((init?.method ?? "GET") === "PUT") {
		return { ok: true, status: 200, json: async () => ({}) } as Response;
	}
	if (u.includes("/canvases/")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({ id: "cv_b", name: "B", cards: [], viewport: undefined }),
		} as Response;
	}
	return { ok: true, status: 200, json: async () => ({ canvases: [] }) } as Response;
}

vi.stubGlobal("localStorage", localStorageStub);
vi.stubGlobal("fetch", vi.fn(fetchStub));

let useCanvasStore: typeof import("../src/store/canvas-store.ts").useCanvasStore;

beforeEach(async () => {
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
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

it("undoes and redoes card add", () => {
	const id = useCanvasStore.getState().addCard({ x: 10, y: 20 });
	expect(useCanvasStore.getState().cards).toHaveLength(1);
	expect(useCanvasStore.getState().cards[0].id).toBe(id);

	expect(useCanvasStore.getState().undo()).toBe(true);
	expect(useCanvasStore.getState().cards).toHaveLength(0);

	expect(useCanvasStore.getState().redo()).toBe(true);
	expect(useCanvasStore.getState().cards).toHaveLength(1);
	expect(useCanvasStore.getState().cards[0].id).toBe(id);
});

it("undoes card delete and redo removes again", () => {
	const id = useCanvasStore.getState().addCard({ x: 0, y: 0 });
	useCanvasStore.getState().deleteCards([id]);
	expect(useCanvasStore.getState().cards).toHaveLength(0);

	expect(useCanvasStore.getState().undo()).toBe(true);
	expect(useCanvasStore.getState().cards.map((c) => c.id)).toEqual([id]);

	expect(useCanvasStore.getState().redo()).toBe(true);
	expect(useCanvasStore.getState().cards).toHaveLength(0);
});

it("records one undo step for a move gesture", () => {
	const id = useCanvasStore.getState().addCard({ x: 0, y: 0 });
	useCanvasStore.getState().beginCardGesture();
	useCanvasStore.getState().moveCard(id, { x: 100, y: 50 });
	useCanvasStore.getState().moveCard(id, { x: 200, y: 80 });

	expect(useCanvasStore.getState().undo()).toBe(true);
	expect(useCanvasStore.getState().cards[0].position).toEqual({ x: 0, y: 0 });

	expect(useCanvasStore.getState().redo()).toBe(true);
	expect(useCanvasStore.getState().cards[0].position).toEqual({ x: 200, y: 80 });
});

it("clears redo when a new layout action happens after undo", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	useCanvasStore.getState().undo();
	expect(useCanvasStore.getState().redo()).toBe(true); // redo available
	useCanvasStore.getState().undo();
	useCanvasStore.getState().addCard({ x: 1, y: 1 }); // new action clears redo
	expect(useCanvasStore.getState().redo()).toBe(false);
});

it("returns false when stacks are empty", () => {
	expect(useCanvasStore.getState().undo()).toBe(false);
	expect(useCanvasStore.getState().redo()).toBe(false);
});
