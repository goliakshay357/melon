import { describe, expect, it } from "vitest";
import {
	type AttachedSession,
	abortCurrentIsolationTurn,
	beginIsolationTurn,
	isClaudeBridgeSession,
	isCurrentIsolationTurn,
	isIsolationSensitiveSession,
	isIsolationTurnAborted,
} from "../src/session-registry.ts";

function sessionFor(provider: string): AttachedSession {
	return {
		runtime: { session: { model: { provider } } },
		clients: new Set(),
		busy: false,
		promptQueue: [],
	};
}

describe("Claude bridge card turn ownership", () => {
	it("treats claude-bridge as isolation-sensitive", () => {
		const session = sessionFor("claude-bridge");
		expect(isClaudeBridgeSession(session)).toBe(true);
		expect(isIsolationSensitiveSession(session)).toBe(true);
	});

	it("claims busy synchronously and gives each turn a new owner token", () => {
		const session = sessionFor("claude-bridge");
		const first = beginIsolationTurn(session);
		expect(first).toBe(1);
		expect(session.busy).toBe(true);
		expect(isCurrentIsolationTurn(session, first!)).toBe(true);

		session.busy = false;
		const second = beginIsolationTurn(session);
		expect(second).toBe(2);
		expect(isCurrentIsolationTurn(session, first!)).toBe(false);
		expect(isCurrentIsolationTurn(session, second!)).toBe(true);
	});

	it("marks only the current turn aborted so its queue remains paused", () => {
		const session = sessionFor("claude-bridge");
		const first = beginIsolationTurn(session)!;
		abortCurrentIsolationTurn(session);
		expect(isIsolationTurnAborted(session, first)).toBe(true);

		const second = beginIsolationTurn(session)!;
		expect(isIsolationTurnAborted(session, second)).toBe(false);
		expect(isCurrentIsolationTurn(session, first)).toBe(false);
	});

	it("does not change admission behavior for another provider", () => {
		const session = sessionFor("anthropic");
		expect(beginIsolationTurn(session)).toBeUndefined();
		expect(session.busy).toBe(false);
		abortCurrentIsolationTurn(session);
		expect(session.isolationAbortedTurnId).toBeUndefined();
	});
});
