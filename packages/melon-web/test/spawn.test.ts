import { expect, it } from "vitest";
import { findFreeSpot, type SpawnCardLike } from "@/lib/spawn";

function card(id: string, x: number, y: number, w = 320, h = 260): SpawnCardLike {
	return { id, position: { x, y }, size: { width: w, height: h } };
}

function overlaps(
	a: { x: number; y: number },
	w: number,
	h: number,
	c: SpawnCardLike,
): boolean {
	const cw = c.size?.width ?? 320;
	const ch = c.size?.height ?? 260;
	return a.x < c.position.x + cw && a.x + w > c.position.x && a.y < c.position.y + ch && a.y + h > c.position.y;
}

it("keeps a free desired position untouched", () => {
	const cards = [card("a", 0, 0)];
	expect(findFreeSpot(cards, { x: 1000, y: 1000 }, 320, 260)).toEqual({ x: 1000, y: 1000 });
});

it("moves a colliding position off the occupied card", () => {
	const cards = [card("a", 0, 0)];
	const spot = findFreeSpot(cards, { x: 0, y: 0 }, 320, 260);
	expect(spot).not.toEqual({ x: 0, y: 0 });
	expect(overlaps(spot, 320, 260, cards[0])).toBe(false);
});

it("prefers the right column when the requested spot is taken", () => {
	const cards = [card("a", 0, 0)];
	const spot = findFreeSpot(cards, { x: 0, y: 0 }, 320, 260);
	expect(spot.x).toBeGreaterThan(0);
});

it("finds a free slot in a packed grid", () => {
	const cards: SpawnCardLike[] = [];
	for (let ix = 0; ix < 5; ix++) {
		for (let iy = 0; iy < 5; iy++) cards.push(card(`${ix}-${iy}`, ix * 344, iy * 284));
	}
	const spot = findFreeSpot(cards, { x: 0, y: 0 }, 320, 260);
	expect(cards.some((c) => overlaps(spot, 320, 260, c))).toBe(false);
});

it("treats minimized cards as title strips", () => {
	const cards: SpawnCardLike[] = [{ ...card("a", 0, 0), minimized: true }];
	// The old position is inside the strip, so it collides; a spot below it is free.
	const spot = findFreeSpot(cards, { x: 0, y: 0 }, 320, 260);
	expect(spot).not.toEqual({ x: 0, y: 0 });
});
