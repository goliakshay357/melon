import { beforeEach, expect, it, vi } from "vitest";

class FakeEventSource {
	static latest: FakeEventSource | null = null;
	url: string;
	onopen?: () => void;
	onmessage?: (ev: { data: string }) => void;
	onerror?: () => void;
	closed = false;
	constructor(url: string) {
		this.url = url;
		FakeEventSource.latest = this;
	}
	close() {
		this.closed = true;
	}
}

const localStorageStub = {
	getItem: (_k: string) => null as string | null,
	setItem: (_k: string, _v: string) => {},
	removeItem: (_k: string) => {},
};

let healthOk = true;
const transcriptCalls: string[] = [];

async function fetchStub(url: string, _init?: RequestInit) {
	if (url.includes("/healthz")) {
		if (!healthOk) throw new Error("offline");
		return {
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		} as Response;
	}
	if (url.startsWith("/transcript")) {
		transcriptCalls.push(url);
		return {
			ok: true,
			status: 200,
			json: async () => ({
				sessionId: "s1",
				messages: [
					{ role: "user", text: "hi" },
					{ role: "assistant", text: "hello" },
				],
			}),
		} as Response;
	}
	if (url.startsWith("/canvases?")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({ canvases: [{ id: "cv1", name: "Canvas 1" }] }),
		} as Response;
	}
	if (url.endsWith("/sessions") || url.endsWith("/sessions/resume")) {
		return {
			ok: true,
			status: 200,
			json: async () => ({
				sessionFile: "/tmp/fake-session.jsonl",
				sessionId: "s1",
				model: "test/model",
			}),
		} as Response;
	}
	if (url.includes("/prompt")) {
		return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
	}
	return {
		ok: true,
		status: 200,
		json: async () => ({}),
	} as Response;
}

vi.stubGlobal("localStorage", localStorageStub);
vi.stubGlobal("EventSource", FakeEventSource);
vi.stubGlobal("fetch", vi.fn(fetchStub));

let useCanvasStore: typeof import("@/store/canvas-store").useCanvasStore;

beforeEach(async () => {
	FakeEventSource.latest = null;
	transcriptCalls.length = 0;
	healthOk = true;
	vi.unstubAllGlobals();
	vi.stubGlobal("localStorage", localStorageStub);
	vi.stubGlobal("EventSource", FakeEventSource);
	vi.stubGlobal("fetch", vi.fn(fetchStub));
	vi.resetModules();
	({ useCanvasStore } = await import("@/store/canvas-store"));
	useCanvasStore.setState({ folder: "/tmp", hydrated: true, serverOffline: false });
});

it("markServerOffline settles streaming cards and blocks send", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	await useCanvasStore.getState().sendMessage(cardId, "go");
	expect(FakeEventSource.latest).not.toBeNull();
	useCanvasStore.getState().updateCard(cardId, { status: "streaming" });

	useCanvasStore.getState().markServerOffline();

	expect(useCanvasStore.getState().serverOffline).toBe(true);
	expect(FakeEventSource.latest?.closed).toBe(true);
	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId);
	expect(card?.status).toBe("idle");
	expect(await useCanvasStore.getState().sendMessage(cardId, "again")).toBe(false);
});

it("healAfterReconnect rehydrates transcripts after the server returns", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().updateCard(cardId, {
		sessionFile: "/tmp/fake-session.jsonl",
		status: "streaming",
	});
	useCanvasStore.getState().markServerOffline();
	expect(useCanvasStore.getState().serverOffline).toBe(true);

	useCanvasStore.setState({ serverOffline: false });
	await useCanvasStore.getState().healAfterReconnect();

	expect(transcriptCalls.some((u) => u.includes("fake-session"))).toBe(true);
	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId);
	expect(card?.messages.some((m) => m.text === "hello")).toBe(true);
});

it("markServerOffline returns queued prompts to the composer draft", () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().updateCard(cardId, {
		status: "streaming",
		queue: ["follow-up A", "follow-up B"],
		pendingDraft: "scratch",
	});

	useCanvasStore.getState().markServerOffline();

	const card = useCanvasStore.getState().cards.find((c) => c.id === cardId);
	expect(card?.status).toBe("idle");
	expect(card?.queue).toEqual([]);
	expect(card?.pendingDraft).toBe("scratch\n\nfollow-up A\n\nfollow-up B");
});

it("health poll heals after reconnect while the UI stayed open", async () => {
	vi.useFakeTimers();
	try {
		useCanvasStore.getState().addCard({ x: 0, y: 0 });
		const cardId = useCanvasStore.getState().cards[0].id;
		useCanvasStore.getState().updateCard(cardId, {
			sessionFile: "/tmp/fake-session.jsonl",
			status: "streaming",
		});

		healthOk = false;
		useCanvasStore.getState().startHealthPoll();
		await vi.advanceTimersByTimeAsync(0);
		expect(useCanvasStore.getState().serverOffline).toBe(true);
		expect(useCanvasStore.getState().cards.find((c) => c.id === cardId)?.status).toBe("idle");

		healthOk = true;
		transcriptCalls.length = 0;
		await vi.advanceTimersByTimeAsync(3000);
		await Promise.resolve();
		await Promise.resolve();

		expect(useCanvasStore.getState().serverOffline).toBe(false);
		expect(transcriptCalls.some((u) => u.includes("fake-session"))).toBe(true);
	} finally {
		vi.useRealTimers();
	}
});

it("blocks fork and new conversation while offline", async () => {
	useCanvasStore.getState().addCard({ x: 0, y: 0 });
	const cardId = useCanvasStore.getState().cards[0].id;
	useCanvasStore.getState().markServerOffline();

	expect(await useCanvasStore.getState().forkCard(cardId)).toBe("");

	useCanvasStore.setState({ cards: [], serverOffline: true });
	expect(
		await useCanvasStore.getState().startConversation(
			"hi",
			{ x: 0, y: 0 },
			{
				model: "test/model",
				skills: [],
				permission: "full",
			},
		),
	).toBe(false);
});
