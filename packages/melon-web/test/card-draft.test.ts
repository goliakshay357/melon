import { beforeEach, expect, it, vi } from "vitest";

/**
 * Unsent composer text lives on the card, not in the card component: React
 * Flow unmounts off-screen nodes, so component state was being dropped
 * whenever a card left the viewport or the canvas was switched. These tests
 * cover the store side of that — the draft must survive a streaming run and
 * must not be rewritten by canvas layout undo/redo.
 */

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
	emit(frame: Record<string, unknown> & { type: string }) {
		this.onmessage?.({ data: JSON.stringify(frame) });
	}
}

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

async function fetchStub(url: string) {
	return {
		ok: true,
		status: 200,
		json: async () =>
			url.endsWith("/sessions")
				? { sessionFile: "/tmp/fake-session.jsonl", sessionId: "s1", model: "test/model" }
				: {},
	} as Response;
}

let useCanvasStore: typeof import("@/store/canvas-store").useCanvasStore;

beforeEach(async () => {
	FakeEventSource.latest = null;
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal("fetch", vi.fn(fetchStub));
	// The store coalesces stream text to animation frames; this suite runs in
	// plain node, so give it the same batching via timers.
	vi.stubGlobal("requestAnimationFrame", (cb: () => void) => setTimeout(cb, 0) as unknown as number);
	vi.stubGlobal("cancelAnimationFrame", (handle: number) => clearTimeout(handle));
	vi.resetModules();
	({ useCanvasStore } = await import("@/store/canvas-store"));
	useCanvasStore.setState({ folder: "/tmp", hydrated: true });
});

it("keeps a typed draft through a streaming run", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	await useCanvasStore.getState().sendMessage(cardId, "first prompt");

	// User types the next prompt while the answer is still streaming.
	useCanvasStore.getState().setCardDraft(cardId, "my next prompt");

	const es = FakeEventSource.latest;
	es?.emit({ type: "status", status: "streaming" });
	es?.emit({ type: "thinking", text: "thinking-" });
	es?.emit({ type: "delta", text: "answer" });
	es?.emit({ type: "tool_start", callId: "c1", name: "bash", args: "ls" });
	es?.emit({ type: "tool_end", callId: "c1", isError: false, output: "file.ts", durationMs: 4 });
	es?.emit({ type: "delta", text: " continues" });
	es?.emit({ type: "turn_end", stopReason: "stop" });
	es?.emit({ type: "status", status: "idle" });
	await new Promise((r) => setTimeout(r, 10));

	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId);
	expect(card?.status).toBe("idle");
	expect(card?.draft).toBe("my next prompt");
});

it("appends to the draft without losing keystrokes that landed meanwhile", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	useCanvasStore.getState().setCardDraft(cardId, "typed while sending");
	// What the failed-send path does: hand the text back behind current input.
	useCanvasStore.getState().setCardDraft(cardId, (prev) => (prev ? `${prev}\n\nretry me` : "retry me"));

	expect(useCanvasStore.getState().cards[0].draft).toBe("typed while sending\n\nretry me");
});

it("does not rewrite the composer when canvas layout is undone", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;

	useCanvasStore.getState().beginCardGesture();
	useCanvasStore.getState().moveCard(cardId, { x: 400, y: 240 });
	useCanvasStore.getState().setCardDraft(cardId, "typed after the drag");

	expect(useCanvasStore.getState().undo()).toBe(true);
	expect(useCanvasStore.getState().cards[0].position).toEqual({ x: 0, y: 0 });
	expect(useCanvasStore.getState().cards[0].draft).toBe("typed after the drag");

	expect(useCanvasStore.getState().redo()).toBe(true);
	expect(useCanvasStore.getState().cards[0].position).toEqual({ x: 400, y: 240 });
	expect(useCanvasStore.getState().cards[0].draft).toBe("typed after the drag");
});

it("restores a deleted card's draft when the delete is undone", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().setCardDraft(cardId, "unsent work");

	useCanvasStore.getState().deleteCards([cardId]);
	expect(useCanvasStore.getState().cards).toHaveLength(0);

	expect(useCanvasStore.getState().undo()).toBe(true);
	expect(useCanvasStore.getState().cards[0].draft).toBe("unsent work");
});

it("keeps queued text handed back to the composer separate from the draft", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().setCardDraft(cardId, "still typing");

	useCanvasStore.getState().queueToDraft(cardId, ["orphaned queue item"]);

	const card = useCanvasStore.getState().cards[0];
	expect(card.draft).toBe("still typing");
	expect(card.pendingDraft).toBe("orphaned queue item");
});
