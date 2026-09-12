import { expect, it } from "vitest";
import { resolveCanvasNode } from "@/lib/canvas-node";
import type { SessionCard } from "@/types/session-card";

function card(id: string, sessionFile?: string): SessionCard {
	return {
		id,
		title: id,
		position: { x: 0, y: 0 },
		parentId: null,
		status: "idle",
		messages: [],
		sessionFile,
	};
}

it("resolves by card id when the tree provides it", () => {
	const cards = [card("a", "/s/a.jsonl"), card("b", "/s/b.jsonl")];
	expect(resolveCanvasNode(cards, "/s/b.jsonl", "b")?.id).toBe("b");
});

it("falls back to the session file when card id is missing (old server)", () => {
	const cards = [card("a", "/s/a.jsonl"), card("b", "/s/b.jsonl")];
	// No cardId: the session file is the source of truth, so this must still find b.
	expect(resolveCanvasNode(cards, "/s/b.jsonl")?.id).toBe("b");
});

it("uses the session file when the card id is stale", () => {
	const cards = [card("a", "/s/a.jsonl"), card("b", "/s/b.jsonl")];
	expect(resolveCanvasNode(cards, "/s/b.jsonl", "deleted-card")?.id).toBe("b");
});

it("returns undefined when the node is gone, so callers never create a card", () => {
	const cards = [card("a", "/s/a.jsonl")];
	expect(resolveCanvasNode(cards, "/s/missing.jsonl", "gone")).toBeUndefined();
	expect(resolveCanvasNode(cards, undefined, "gone")).toBeUndefined();
});
