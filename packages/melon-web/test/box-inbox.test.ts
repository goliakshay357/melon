import { expect, it } from "vitest";
import { pendingInboxRows } from "@/lib/box-inbox";
import type { BoxInboxItem, SessionCard } from "@/types/session-card";

function card(id: string, boxInbox: BoxInboxItem[]): SessionCard {
	return {
		id,
		title: id,
		position: { x: 0, y: 0 },
		parentId: null,
		status: "idle",
		messages: [],
		boxInbox,
	};
}

function mail(
	id: string,
	overrides: Partial<BoxInboxItem> = {},
): BoxInboxItem {
	return {
		id,
		direction: "in",
		fromCardId: "from",
		fromTitle: "From",
		toCardId: "to",
		toTitle: "To",
		body: id,
		status: "pending",
		createdBy: "agent",
		createdAt: 0,
		...overrides,
	};
}

it("returns only pending inbound mail", () => {
	const rows = pendingInboxRows([
		card("a", [
			mail("keep", { createdAt: 1 }),
			mail("out", { direction: "out", createdAt: 2 }),
			mail("approved", { status: "approved", createdAt: 3 }),
			mail("dismissed", { status: "dismissed", createdAt: 4 }),
		]),
	]);
	expect(rows.map((r) => r.item.id)).toEqual(["keep"]);
});

it("orders newest first and keeps the owning card", () => {
	const rows = pendingInboxRows([
		card("a", [mail("old", { createdAt: 10 })]),
		card("b", [mail("new", { createdAt: 20 })]),
	]);
	expect(rows.map((r) => r.item.id)).toEqual(["new", "old"]);
	expect(rows[0].card.id).toBe("b");
});

it("narrows to a single box when filtered", () => {
	const rows = pendingInboxRows(
		[card("a", [mail("a1")]), card("b", [mail("b1")])],
		"b",
	);
	expect(rows.map((r) => r.item.id)).toEqual(["b1"]);
});
