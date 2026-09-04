import { DEFAULT_CARD_SIZE } from "@/types/session-card";

/**
 * Card spawn placement — pure functions, unit-tested in test/spawn-placement.test.ts.
 *
 * New cards should use a good share of the visible screen instead of a fixed
 * 480×520 stamp, never land off-screen, and the canvas pans to reveal a new
 * card when it spawns out of view.
 *
 * World coordinates (React Flow flow space) map to screen pixels via
 * screen = world * zoom + viewport.{x,y} — so the visible world rect is
 * derived from the viewport translate and the on-screen canvas rect.
 */

export interface SpawnSize {
	width: number;
	height: number;
}

export interface SpawnViewport {
	x: number;
	y: number;
	zoom: number;
}

/** Screen-space rect of the visible canvas area (px). Sidebar overlays its left edge. */
export interface ScreenRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

/** World-space rect (left/top inclusive, right/bottom exclusive edges). */
export interface WorldRect {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

export const SIDEBAR_WIDTH = 260;
export const SIDEBAR_COLLAPSED_WIDTH = 48;

/** Spawn targets relative to the visible canvas area. */
const SPAWN_WIDTH_FRACTION = 0.45;
const SPAWN_HEIGHT_FRACTION = 0.6;
/** Readability clamps — the card's inner reading column is capped anyway. */
const MAX_SPAWN_WIDTH = 960;
const MAX_SPAWN_HEIGHT = 900;

/** Never spawn a card with less than this fraction of itself inside the view. */
const MIN_VISIBLE_FRACTION = 0.4;
/** World-space padding kept between a card edge and the viewport edge. */
const VIEW_MARGIN = 48;

function clamp(v: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, v));
}

/**
 * Size for a newly spawned card: a fixed share of the visible canvas area
 * (in world units, so it holds at any zoom), clamped to the classic 480×520
 * minimum and a readability maximum.
 */
export function spawnSize(screen: { width: number; height: number }, zoom: number): SpawnSize {
	const visible = { width: screen.width / zoom, height: screen.height / zoom };
	return {
		width: clamp(visible.width * SPAWN_WIDTH_FRACTION, DEFAULT_CARD_SIZE.width, MAX_SPAWN_WIDTH),
		height: clamp(visible.height * SPAWN_HEIGHT_FRACTION, DEFAULT_CARD_SIZE.height, MAX_SPAWN_HEIGHT),
	};
}

/** The world-space rect currently visible inside the given screen rect. */
export function visibleWorldRect(vp: SpawnViewport, screen: ScreenRect): WorldRect {
	const { x, y, zoom } = vp;
	return {
		left: (screen.left - x) / zoom,
		right: (screen.left + screen.width - x) / zoom,
		top: (screen.top - y) / zoom,
		bottom: (screen.top + screen.height - y) / zoom,
	};
}

function overlapExtent(cardMin: number, cardMax: number, viewMin: number, viewMax: number): number {
	return Math.min(cardMax, viewMax) - Math.max(cardMin, viewMin);
}

/**
 * Shift a spawn position so a good share of the card is inside the visible
 * area. Positions that already overlap enough are left untouched (the
 * right-of-parent column layout stays); sliver or fully off-screen placements
 * are pulled fully inside on the offending axis when the card fits.
 */
export function clampIntoView(
	position: { x: number; y: number },
	size: SpawnSize,
	vp: SpawnViewport,
	screen: ScreenRect,
): { x: number; y: number } {
	const view = visibleWorldRect(vp, screen);
	let { x, y } = position;

	const xOverlap = overlapExtent(x, x + size.width, view.left, view.right);
	if (xOverlap < size.width * MIN_VISIBLE_FRACTION) {
		if (size.width <= view.right - view.left) {
			// Pull fully inside, toward the side the card came from.
			const cardCenter = x + size.width / 2;
			const viewCenter = (view.left + view.right) / 2;
			x = cardCenter < viewCenter ? view.left + VIEW_MARGIN : view.right - VIEW_MARGIN - size.width;
		} else {
			// Wider than the view — center it.
			x = (view.left + view.right) / 2 - size.width / 2;
		}
	}

	const yOverlap = overlapExtent(y, y + size.height, view.top, view.bottom);
	if (yOverlap < size.height * MIN_VISIBLE_FRACTION) {
		if (size.height <= view.bottom - view.top) {
			const cardCenter = y + size.height / 2;
			const viewCenter = (view.top + view.bottom) / 2;
			y = cardCenter < viewCenter ? view.top + VIEW_MARGIN : view.bottom - VIEW_MARGIN - size.height;
		} else {
			y = (view.top + view.bottom) / 2 - size.height / 2;
		}
	}

	return { x, y };
}

/** True when the card rect is fully inside the visible area (plus margin). */
export function isFullyVisible(rect: WorldRect, vp: SpawnViewport, screen: ScreenRect): boolean {
	const view = visibleWorldRect(vp, screen);
	return (
		rect.left - VIEW_MARGIN >= view.left &&
		rect.right + VIEW_MARGIN <= view.right &&
		rect.top - VIEW_MARGIN >= view.top &&
		rect.bottom + VIEW_MARGIN <= view.bottom
	);
}

/**
 * Viewport translate (zoom unchanged) that brings the card rect fully into
 * view. Moves as little as possible; centers the card on an axis it cannot
 * fit within.
 */
export function focusViewport(rect: WorldRect, vp: SpawnViewport, screen: ScreenRect): SpawnViewport {
	const solve = (
		cardMin: number,
		cardMax: number,
		screenMin: number,
		screenSpan: number,
		translate: number,
	): number => {
		const zoom = vp.zoom;
		// translate must satisfy: (screenMin - t)/zoom >= cardMin - margin
		const lower = screenMin - zoom * (cardMin - VIEW_MARGIN);
		// and: (screenMin + span - t)/zoom <= cardMax + margin
		const upper = screenMin + screenSpan - zoom * (cardMax + VIEW_MARGIN);
		if (lower > upper) {
			// Card (plus margins) wider than the visible span — center it.
			return screenMin + screenSpan / 2 - zoom * ((cardMin + cardMax) / 2);
		}
		return clamp(translate, lower, upper);
	};

	return {
		x: solve(rect.left, rect.right, screen.left, screen.width, vp.x),
		y: solve(rect.top, rect.bottom, screen.top, screen.height, vp.y),
		zoom: vp.zoom,
	};
}

export interface SpawnCardLike {
	id: string;
	position: { x: number; y: number };
	size?: SpawnSize;
}

function spawnCardWidth(c: SpawnCardLike): number {
	return c.size?.width ?? DEFAULT_CARD_SIZE.width;
}
function spawnCardHeight(c: SpawnCardLike): number {
	return c.size?.height ?? DEFAULT_CARD_SIZE.height;
}

interface SpawnBox {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

function boxesOverlap(a: SpawnBox, b: SpawnBox): boolean {
	return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/** Nearest free position for a new card, so it never lands on top of another. */
export function findOpenSpot(cards: SpawnCardLike[], sourceId: string, w: number, h: number): { x: number; y: number } {
	const src = cards.find((c) => c.id === sourceId);
	if (!src) return { x: 0, y: 0 };
	const gap = 48;
	const occupied: SpawnBox[] = cards
		.filter((c) => c.id !== sourceId)
		.map((c) => ({
			left: c.position.x,
			right: c.position.x + spawnCardWidth(c),
			top: c.position.y,
			bottom: c.position.y + spawnCardHeight(c),
		}));
	// Column to the right first (mind-map flow), row by row — cards flow right,
	// then wrap down, so arrows read bottom→top naturally.
	const spots: Array<{ x: number; y: number }> = [];
	for (let i = 0; i < 6; i++)
		spots.push({ x: src.position.x + spawnCardWidth(src) + gap, y: src.position.y + i * (h + gap) });
	for (let i = 1; i <= 4; i++) spots.push({ x: src.position.x, y: src.position.y + i * (h + gap) });
	for (const s of spots) {
		const box: SpawnBox = { left: s.x, right: s.x + w, top: s.y, bottom: s.y + h };
		if (!occupied.some((o) => boxesOverlap(box, o))) return s;
	}
	return { x: src.position.x + spawnCardWidth(src) + gap, y: src.position.y };
}
