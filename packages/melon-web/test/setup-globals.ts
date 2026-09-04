// The store batches streaming message patches through requestAnimationFrame.
// These suites run in the node environment (they stub localStorage/EventSource/
// fetch rather than loading a DOM), so the frame callbacks are missing and every
// streaming assertion throws. Back them with timers.
//
// Assigned on globalThis rather than via vi.stubGlobal because the suites call
// vi.unstubAllGlobals() in beforeEach, which would strip a stubbed version.
if (typeof globalThis.requestAnimationFrame !== "function") {
	globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
		setTimeout(() => cb(performance.now()), 16) as unknown as number) as typeof requestAnimationFrame;
	globalThis.cancelAnimationFrame = ((handle: number) =>
		clearTimeout(handle as unknown as NodeJS.Timeout)) as typeof cancelAnimationFrame;
}
