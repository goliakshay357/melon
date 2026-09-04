import { describe, expect, it } from "vitest";
import {
	clampIntoView,
	findOpenSpot,
	focusViewport,
	isFullyVisible,
	type SpawnViewport,
	spawnSize,
	visibleWorldRect,
	type WorldRect,
} from "@/lib/spawn";

const VP: SpawnViewport = { x: 0, y: 0, zoom: 1 };
/** 1280×800 window, sidebar overlays the left 260px. */
const SCREEN = { left: 260, top: 0, width: 1280, height: 800 };
const VIEW = visibleWorldRect(VP, SCREEN);

describe("spawnSize", () => {
	it("scales with the visible canvas area", () => {
		const s = spawnSize({ width: 1280, height: 800 }, 1);
		expect(s.width).toBe(Math.round(1280 * 0.45));
		// 800 * 0.6 = 480 falls below the 520 minimum — min clamp wins.
		expect(s.height).toBe(520);
	});

	it("clamps to the 480×520 minimum on small screens", () => {
		const s = spawnSize({ width: 500, height: 500 }, 1);
		expect(s.width).toBe(480);
		expect(s.height).toBe(520);
	});

	it("clamps to the readability maximum on huge screens", () => {
		const s = spawnSize({ width: 5000, height: 3000 }, 1);
		expect(s.width).toBe(960);
		expect(s.height).toBe(900);
	});

	it("accounts for zoom — zoomed out means more world space", () => {
		const near = spawnSize({ width: 1000, height: 800 }, 1);
		const far = spawnSize({ width: 1000, height: 800 }, 0.5);
		expect(far.width).toBeGreaterThan(near.width);
		expect(far.height).toBeGreaterThan(near.height);
	});
});

describe("clampIntoView", () => {
	const SIZE = { width: 480, height: 520 };

	it("leaves positions that already overlap the view enough", () => {
		const spot = { x: VIEW.left + 100, y: VIEW.top + 100 };
		expect(clampIntoView(spot, SIZE, VP, SCREEN)).toEqual(spot);
	});

	it("pulls a card that hangs mostly off the right edge back inside", () => {
		// 180 of 480 px visible (< 40%) — the fork-near-right-edge case.
		const spot = { x: VIEW.right - 180, y: VIEW.top + 100 };
		const clamped = clampIntoView(spot, SIZE, VP, SCREEN);
		expect(clamped.x + SIZE.width).toBeLessThanOrEqual(VIEW.right);
		expect(clamped.x).toBeGreaterThanOrEqual(VIEW.left);
	});

	it("pulls a fully off-screen card inside", () => {
		const clamped = clampIntoView({ x: VIEW.right + 500, y: VIEW.top }, SIZE, VP, SCREEN);
		expect(clamped.x + SIZE.width).toBeLessThanOrEqual(VIEW.right);
	});

	it("keeps cards to the left of the view on the left side", () => {
		const clamped = clampIntoView({ x: VIEW.left - 1000, y: VIEW.top + 100 }, SIZE, VP, SCREEN);
		expect(clamped.x).toBeGreaterThanOrEqual(VIEW.left);
	});

	it("centers a card wider than the view", () => {
		const wide = { width: VIEW.right - VIEW.left + 400, height: 520 };
		const clamped = clampIntoView({ x: VIEW.right + 900, y: VIEW.top }, wide, VP, SCREEN);
		expect(clamped.x).toBe((VIEW.left + VIEW.right) / 2 - wide.width / 2);
	});

	it("respects zoom — world positions are viewport-relative", () => {
		const vp: SpawnViewport = { x: -400, y: 0, zoom: 2 };
		const view = visibleWorldRect(vp, SCREEN);
		const clamped = clampIntoView({ x: view.right + 500, y: view.top }, SIZE, vp, SCREEN);
		expect(clamped.x + SIZE.width).toBeLessThanOrEqual(view.right + 0.001);
	});
});

function rectAt(x: number, y: number, w: number, h: number): WorldRect {
	return { left: x, right: x + w, top: y, bottom: y + h };
}

describe("isFullyVisible", () => {
	it("is true for a card well inside the view", () => {
		expect(isFullyVisible(rectAt(VIEW.left + 100, VIEW.top + 100, 480, 520), VP, SCREEN)).toBe(true);
	});

	it("is false when the card crosses the right edge", () => {
		expect(isFullyVisible(rectAt(VIEW.right - 200, VIEW.top + 100, 480, 520), VP, SCREEN)).toBe(false);
	});
});

describe("focusViewport", () => {
	it("keeps zoom and pans minimally to reveal an off-screen card", () => {
		const vp: SpawnViewport = { x: 0, y: 0, zoom: 1 };
		// Card fully right of the view.
		const rect = rectAt(VIEW.right + 600, VIEW.top + 100, 480, 520);
		const next = focusViewport(rect, vp, SCREEN);
		expect(next.zoom).toBe(1);
		expect(isFullyVisible(rect, next, SCREEN)).toBe(true);
		// Minimal pan: the card's right edge sits just inside the view.
		expect(next.x).toBeLessThanOrEqual(0);
	});

	it("does not move the viewport for a fully visible card", () => {
		const vp: SpawnViewport = { x: -123, y: -45, zoom: 1.2 };
		const view = visibleWorldRect(vp, SCREEN);
		// Offsets chosen so the card + 48px margins fit the 1066×666 world view.
		const rect = rectAt(view.left + 100, view.top + 50, 480, 520);
		expect(isFullyVisible(rect, vp, SCREEN)).toBe(true);
		expect(focusViewport(rect, vp, SCREEN)).toEqual(vp);
	});

	it("centers a card that cannot fit in the view", () => {
		const rect = rectAt(0, 0, SCREEN.width + 1000, 520);
		const next = focusViewport(rect, VP, SCREEN);
		const view = visibleWorldRect(next, SCREEN);
		expect((rect.left + rect.right) / 2).toBeCloseTo((view.left + view.right) / 2, 5);
	});
});

describe("findOpenSpot", () => {
	const card = (id: string, x: number, y: number, w = 480, h = 520) => ({
		id,
		position: { x, y },
		size: { width: w, height: h },
	});

	it("places to the right of the source when free", () => {
		const spot = findOpenSpot([card("a", 0, 0)], "a", 480, 520);
		expect(spot).toEqual({ x: 528, y: 0 });
	});

	it("wraps down when the right column is occupied, never overlapping", () => {
		const cards = [card("a", 0, 0), card("b", 528, 0), card("c", 528, 568)];
		const spot = findOpenSpot(cards, "a", 480, 520);
		const box = rectAt(spot.x, spot.y, 480, 520);
		for (const c of cards) {
			const other = rectAt(c.position.x, c.position.y, 480, 520);
			const overlaps =
				box.left < other.right && box.right > other.left && box.top < other.bottom && box.bottom > other.top;
			expect(overlaps).toBe(false);
		}
	});

	it("ignores the source card itself when checking overlap", () => {
		const spot = findOpenSpot([card("a", 0, 0)], "a", 480, 520);
		expect(spot.x).toBeGreaterThan(0);
	});
});
