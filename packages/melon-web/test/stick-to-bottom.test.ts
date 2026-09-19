import { describe, expect, it, vi } from "vitest";
import {
	attachStickUnlock,
	isNearBottom,
	STICK_NEAR_PX,
	stickToBottomIfNeeded,
	syncStuckToBottom,
} from "../src/lib/stick-to-bottom";

type FakeEl = HTMLElement & {
	dispatch: (type: string, event: Event) => void;
};

function fakeEl(partial: { scrollHeight: number; scrollTop: number; clientHeight: number }): FakeEl {
	const listeners = new Map<string, Set<(e: Event) => void>>();
	const el = {
		scrollHeight: partial.scrollHeight,
		scrollTop: partial.scrollTop,
		clientHeight: partial.clientHeight,
		addEventListener(type: string, fn: (e: Event) => void) {
			let set = listeners.get(type);
			if (!set) {
				set = new Set();
				listeners.set(type, set);
			}
			set.add(fn);
		},
		removeEventListener(type: string, fn: (e: Event) => void) {
			listeners.get(type)?.delete(fn);
		},
		dispatch(type: string, event: Event) {
			for (const fn of listeners.get(type) ?? []) fn(event);
		},
	};
	return el as unknown as FakeEl;
}

describe("stick-to-bottom", () => {
	it("isNearBottom uses the shared threshold", () => {
		const el = fakeEl({ scrollHeight: 1000, scrollTop: 940, clientHeight: 50 });
		// distance = 1000 - 940 - 50 = 10
		expect(isNearBottom(el)).toBe(true);
		expect(isNearBottom(el, 5)).toBe(false);
		expect(STICK_NEAR_PX).toBe(60);
	});

	it("syncStuckToBottom tracks distance from the tail", () => {
		const stuck = { current: true };
		const el = fakeEl({ scrollHeight: 1000, scrollTop: 100, clientHeight: 50 });
		expect(syncStuckToBottom(el, stuck)).toBe(false);
		expect(stuck.current).toBe(false);
	});

	it("stickToBottomIfNeeded does not yank when the DOM is scrolled away", () => {
		const stuck = { current: true };
		const el = fakeEl({ scrollHeight: 1000, scrollTop: 100, clientHeight: 50 });
		stickToBottomIfNeeded(el, stuck);
		expect(stuck.current).toBe(false);
		expect(el.scrollTop).toBe(100);
	});

	it("stickToBottomIfNeeded snaps when pinned near the bottom", () => {
		const stuck = { current: true };
		const el = fakeEl({ scrollHeight: 1000, scrollTop: 940, clientHeight: 50 });
		stickToBottomIfNeeded(el, stuck);
		expect(stuck.current).toBe(true);
		expect(el.scrollTop).toBe(1000);
	});

	it("attachStickUnlock clears stickiness on upward wheel", () => {
		const stuck = { current: true };
		const onUnlock = vi.fn();
		const el = fakeEl({ scrollHeight: 1000, scrollTop: 940, clientHeight: 50 });
		const dispose = attachStickUnlock(el, stuck, onUnlock);
		el.dispatch("wheel", { deltaY: -40 } as unknown as WheelEvent);
		expect(stuck.current).toBe(false);
		expect(onUnlock).toHaveBeenCalledOnce();
		dispose?.();
	});
});
