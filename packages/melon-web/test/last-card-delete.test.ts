import { beforeEach, expect, it, vi } from "vitest";

/**
 * Deleting the last card must leave the canvas empty. The empty-overwrite
 * guard used to 409 and the client healed by reloading the deleted card.
 */

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

let useCanvasStore: typeof import("../src/store/canvas-store.ts").useCanvasStore;

beforeEach(async () => {
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
	vi.resetModules();
	({ useCanvasStore } = await import("../src/store/canvas-store.ts"));
});

it("keeps the canvas empty after deleting the last card", async () => {
	const puts: Array<{ allowEmpty?: boolean; cards: unknown[] }> = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
			const u = String(url);
			if ((init?.method ?? "GET") === "PUT" && u.includes("/canvases/")) {
				const body = JSON.parse(String(init?.body ?? "{}")) as {
					allowEmpty?: boolean;
					canvas?: { cards?: unknown[] };
				};
				puts.push({ allowEmpty: body.allowEmpty, cards: body.canvas?.cards ?? [] });
				return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
			}
			if ((init?.method ?? "GET") === "POST" || (init?.method ?? "GET") === "DELETE") {
				return { ok: true, status: 200, json: async () => ({}) } as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	useCanvasStore.setState({
		folder: "/tmp/proj",
		hydrated: true,
		canvasId: "cv_solo",
		canvasName: "Solo",
		cards: [],
		canvasActivity: {},
	});
	const id = useCanvasStore.getState().addCard({ x: 0, y: 0 });
	useCanvasStore.getState().deleteCards([id]);

	expect(useCanvasStore.getState().cards).toHaveLength(0);
	await vi.waitFor(() => expect(puts.some((p) => p.cards.length === 0 && p.allowEmpty === true)).toBe(true));
	expect(useCanvasStore.getState().cards).toHaveLength(0);
	expect(useCanvasStore.getState().canvasNotice).toBeNull();
});

it("does not resurrect cards when an intentional empty save still gets 409", async () => {
	vi.stubGlobal(
		"fetch",
		vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
			const u = String(url);
			if ((init?.method ?? "GET") === "PUT" && u.includes("/canvases/")) {
				return {
					ok: false,
					status: 409,
					json: async () => ({ error: "refusing to overwrite populated canvas with empty state" }),
				} as Response;
			}
			if (
				u.includes("/canvases/cv_solo?") ||
				(u.includes("/canvases/cv_solo") && (init?.method ?? "GET") === "GET")
			) {
				return {
					ok: true,
					status: 200,
					json: async () => ({
						id: "cv_solo",
						name: "Solo",
						cards: [{ id: "ghost", position: { x: 0, y: 0 }, status: "idle", messages: [] }],
						viewport: { x: 0, y: 0, zoom: 1 },
					}),
				} as Response;
			}
			return { ok: true, status: 200, json: async () => ({}) } as Response;
		}),
	);

	useCanvasStore.setState({
		folder: "/tmp/proj",
		hydrated: true,
		canvasId: "cv_solo",
		canvasName: "Solo",
		cards: [],
		canvasActivity: {},
		canvasNotice: null,
	});
	const id = useCanvasStore.getState().addCard({ x: 1, y: 2 });
	useCanvasStore.getState().deleteCards([id]);
	await Promise.resolve();
	await Promise.resolve();

	expect(useCanvasStore.getState().cards).toHaveLength(0);
	expect(useCanvasStore.getState().canvasNotice).toBeNull();
});
