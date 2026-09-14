/** Near-bottom threshold for chat / nested stream scrollers. */
export const STICK_NEAR_PX = 60;

export function isNearBottom(el: HTMLElement, threshold = STICK_NEAR_PX): boolean {
	return el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
}

/** Update stickiness from an onScroll handler. */
export function syncStuckToBottom(
	el: HTMLElement,
	stuck: { current: boolean },
	threshold = STICK_NEAR_PX,
): boolean {
	stuck.current = isNearBottom(el, threshold);
	return stuck.current;
}

/**
 * Snap to the tail only while the user is still pinned to the bottom.
 * Re-checks the DOM so a missed onScroll cannot yank during streaming.
 */
export function stickToBottomIfNeeded(el: HTMLElement | null, stuck: { current: boolean }): void {
	if (!el || !stuck.current) return;
	if (!isNearBottom(el)) {
		stuck.current = false;
		return;
	}
	el.scrollTop = el.scrollHeight;
}

/**
 * Unlock stickiness on upward wheel / touch so live streams cannot fight the reader.
 * Returns a disposer, or undefined if el is null.
 */
export function attachStickUnlock(
	el: HTMLElement | null,
	stuck: { current: boolean },
	onUnlock?: () => void,
): (() => void) | undefined {
	if (!el) return;
	const unlock = () => {
		if (!stuck.current) return;
		stuck.current = false;
		onUnlock?.();
	};
	const onWheel = (e: WheelEvent) => {
		if (e.deltaY < 0) unlock();
	};
	let startY = 0;
	const onTouchStart = (e: TouchEvent) => {
		startY = e.touches[0]?.clientY ?? 0;
	};
	const onTouchMove = (e: TouchEvent) => {
		const y = e.touches[0]?.clientY ?? 0;
		// Finger drag down → content moves up → reading older material.
		if (y - startY > 8) unlock();
	};
	el.addEventListener('wheel', onWheel, { passive: true });
	el.addEventListener('touchstart', onTouchStart, { passive: true });
	el.addEventListener('touchmove', onTouchMove, { passive: true });
	return () => {
		el.removeEventListener('wheel', onWheel);
		el.removeEventListener('touchstart', onTouchStart);
		el.removeEventListener('touchmove', onTouchMove);
	};
}
