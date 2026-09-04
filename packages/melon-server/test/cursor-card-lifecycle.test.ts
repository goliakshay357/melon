import { describe, expect, it } from "vitest";
import {
	type AttachedSession,
	abortCurrentCursorTurn,
	beginCursorTurn,
	isCurrentCursorTurn,
	isCursorTurnAborted,
} from "../src/session-registry.ts";

function cursorSession(): AttachedSession {
	return {
		runtime: { session: { model: { provider: "cursor" } } },
		clients: new Set(),
		busy: false,
		promptQueue: [],
	};
}

describe("Cursor card turn ownership", () => {
	it("claims busy synchronously and gives each turn a new owner token", () => {
		const session = cursorSession();
		const first = beginCursorTurn(session);
		expect(first).toBe(1);
		expect(session.busy).toBe(true);
		expect(isCurrentCursorTurn(session, first!)).toBe(true);

		session.busy = false;
		const second = beginCursorTurn(session);
		expect(second).toBe(2);
		expect(isCurrentCursorTurn(session, first!)).toBe(false);
		expect(isCurrentCursorTurn(session, second!)).toBe(true);
	});

	it("marks only the current turn aborted so its queue remains paused", () => {
		const session = cursorSession();
		const first = beginCursorTurn(session)!;
		abortCurrentCursorTurn(session);
		expect(isCursorTurnAborted(session, first)).toBe(true);

		const second = beginCursorTurn(session)!;
		expect(isCursorTurnAborted(session, second)).toBe(false);
		expect(isCurrentCursorTurn(session, first)).toBe(false);
	});

	it("does not change admission behavior for another provider", () => {
		const session = cursorSession();
		session.runtime.session.model.provider = "anthropic";
		expect(beginCursorTurn(session)).toBeUndefined();
		expect(session.busy).toBe(false);
		abortCurrentCursorTurn(session);
		expect(session.cursorAbortedTurnId).toBeUndefined();
	});
});
