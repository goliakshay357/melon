import { beforeEach, expect, it, vi } from "vitest";
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
// biome-ignore lint/suspicious/noExplicitAny: test stub
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
	vi.resetModules();
	({ useCanvasStore } = await import("@/store/canvas-store"));
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
