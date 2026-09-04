// Regression: GUI ModelRuntime must register the Cursor provider without
// running the full pi-cursor-sdk factory. Also: multi-card hosts need sibling
// bridges to survive a second registerCursorPiToolBridge, and a card that
// prompts while another card binds must keep its own bridge, scope and resume
// state (Melon multicard session isolation patch).

import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-cursor-bridge-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const require = createRequire(import.meta.url);
const melonServerRoot = dirname(fileURLToPath(import.meta.url)); // .../test
const repoDesktopRequire = createRequire(join(melonServerRoot, "../../../desktop/package.json"));

function resolveCursorSdkRequire(): NodeJS.Require | null {
	try {
		require.resolve("pi-cursor-sdk/package.json");
		return require;
	} catch {
		try {
			repoDesktopRequire.resolve("pi-cursor-sdk/package.json");
			return repoDesktopRequire;
		} catch {
			return null;
		}
	}
}

describe("loadCursorProviderInto bridge isolation", () => {
	const sdkRequire = resolveCursorSdkRequire();

	afterEach(async () => {
		if (!sdkRequire) return;
		try {
			const bridge = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
				__testUtils?: { resetRegisteredBridgeForTests?: () => Promise<void> };
			};
			await bridge.__testUtils?.resetRegisteredBridgeForTests?.();
		} catch {
			/* ignore */
		}
	});

	it("registers the cursor provider without replacing a live pi tool bridge", async () => {
		if (!sdkRequire) return; // desktop dep not installed — skip

		const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
		const { loadCursorProviderInto } = await import("../src/cursor-extension.ts");
		const bridgeMod = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
			registerCursorPiToolBridge: (pi: {
				on: (event: string, handler: unknown) => void;
				getActiveTools?: () => string[];
			}) => { disposeAll: (reason?: string) => Promise<void> };
			getRegisteredCursorPiToolBridge: () => { disposeAll: (reason?: string) => Promise<void> } | undefined;
			__testUtils?: { resetRegisteredBridgeForTests?: () => Promise<void> };
		};

		await bridgeMod.__testUtils?.resetRegisteredBridgeForTests?.();

		const fakePi = {
			on() {},
			getActiveTools: () => [] as string[],
		};
		const sessionBridge = bridgeMod.registerCursorPiToolBridge(fakePi);
		expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(sessionBridge);

		const runtime = await ModelRuntime.create();
		await loadCursorProviderInto(runtime);

		// Must still be the session bridge — GUI provider load must not disposeAll.
		expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(sessionBridge);
		expect(runtime.getProvider("cursor")).toBeDefined();
		// Model discovery hits the network before falling back; the default 5s
		// budget is not enough when the whole suite runs in parallel.
	}, 30_000);

	it("keeps sibling bridges alive when a second card registers", async () => {
		if (!sdkRequire) return;

		const bridgeMod = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
			registerCursorPiToolBridge: (pi: {
				on: (event: string, handler: (payload?: unknown) => void) => void;
				getActiveTools?: () => string[];
			}) => { disposeAll: (reason?: string) => Promise<void> };
			getRegisteredCursorPiToolBridge: () => { disposeAll: (reason?: string) => Promise<void> } | undefined;
			__testUtils?: {
				resetRegisteredBridgeForTests?: () => Promise<void>;
				getRegisteredBridgeCountForTests?: () => number;
			};
		};

		await bridgeMod.__testUtils?.resetRegisteredBridgeForTests?.();

		const handlersA = new Map<string, Array<(payload?: unknown) => void>>();
		const handlersB = new Map<string, Array<(payload?: unknown) => void>>();
		const fakePiA = {
			on(event: string, handler: (payload?: unknown) => void) {
				const list = handlersA.get(event) ?? [];
				list.push(handler);
				handlersA.set(event, list);
			},
			getActiveTools: () => [] as string[],
		};
		const fakePiB = {
			on(event: string, handler: (payload?: unknown) => void) {
				const list = handlersB.get(event) ?? [];
				list.push(handler);
				handlersB.set(event, list);
			},
			getActiveTools: () => [] as string[],
		};

		const bridgeA = bridgeMod.registerCursorPiToolBridge(fakePiA);
		const bridgeB = bridgeMod.registerCursorPiToolBridge(fakePiB);

		expect(bridgeMod.__testUtils?.getRegisteredBridgeCountForTests?.()).toBe(2);
		expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeB);

		// Melon rebinds card A before prompting — session_start selects A's bridge.
		for (const h of handlersA.get("session_start") ?? []) h();
		expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeA);

		for (const h of handlersB.get("session_start") ?? []) h();
		expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeB);

		// Both bridges still independently disposable (siblings were not wiped).
		await bridgeA.disposeAll("test");
		await bridgeB.disposeAll("test");
	});
});

type FakePiHandler = (event: unknown, ctx: unknown) => unknown;

type FakePi = {
	pi: {
		on: (event: string, handler: FakePiHandler) => void;
		appendEntry: (customType: string, data?: unknown) => string;
		getActiveTools: () => string[];
	};
	emit: (event: string, payload: unknown, ctx: unknown) => Promise<void>;
	appends: Array<{ customType: string; data?: unknown }>;
};

function createFakePi(): FakePi {
	const handlers = new Map<string, FakePiHandler[]>();
	const appends: Array<{ customType: string; data?: unknown }> = [];
	return {
		appends,
		pi: {
			on(event, handler) {
				const list = handlers.get(event) ?? [];
				list.push(handler);
				handlers.set(event, list);
			},
			appendEntry(customType, data) {
				appends.push({ customType, data });
				return `entry-${appends.length}`;
			},
			getActiveTools: () => [],
		},
		async emit(event, payload, ctx) {
			for (const handler of handlers.get(event) ?? []) await handler(payload, ctx);
		},
	};
}

/** Minimal session_start context: what the SDK reads to key a session. */
function fakeSessionContext(sessionFile: string, sessionId: string, cwd: string) {
	return {
		cwd,
		isProjectTrusted: () => false,
		sessionManager: {
			getSessionFile: () => sessionFile,
			getSessionId: () => sessionId,
			getSessionName: () => undefined,
			getBranch: () => [],
			getEntries: () => [],
		},
	};
}

type CursorHostSessionModule = {
	runInCursorHostSession: <T>(session: { sessionFile?: string; sessionId?: string; cwd?: string }, fn: () => T) => T;
	__testUtils: { disableIsolationForTests: () => void };
};

describe("concurrent card isolation", () => {
	const sdkRequire = resolveCursorSdkRequire();
	const cwdA = mkdtempSync(join(tmpdir(), "melon-card-a-"));
	const cwdB = mkdtempSync(join(tmpdir(), "melon-card-b-"));
	const sessionFileA = join(cwdA, "a.jsonl");
	const sessionFileB = join(cwdB, "b.jsonl");

	afterEach(async () => {
		if (!sdkRequire) return;
		const bridgeMod = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
			__testUtils?: { resetRegisteredBridgeForTests?: () => Promise<void> };
		};
		await bridgeMod.__testUtils?.resetRegisteredBridgeForTests?.();
		const scope = sdkRequire("pi-cursor-sdk/dist/cursor-session-scope.js") as {
			__testUtils: { reset: () => void };
		};
		scope.__testUtils.reset();
		const resume = sdkRequire("pi-cursor-sdk/dist/cursor-session-agent-resume.js") as {
			__testUtils: { reset: () => void };
		};
		resume.__testUtils.reset();
		const lifecycle = sdkRequire("pi-cursor-sdk/dist/cursor-session-agent-lifecycle.js") as {
			__testUtils?: { resetLiveSessions?: () => void };
		};
		lifecycle.__testUtils?.resetLiveSessions?.();
		const http1 = sdkRequire("pi-cursor-sdk/dist/cursor-http1.js") as {
			__testUtils?: { reset?: () => void };
		};
		http1.__testUtils?.reset?.();
		// Leave the process in single-session mode for tests that assert it.
		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		host.__testUtils.disableIsolationForTests();
	});

	it("hands each card its own pi tool bridge while a sibling binds", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		const bridgeMod = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
			registerCursorPiToolBridge: (pi: FakePi["pi"]) => { disposeAll: (reason?: string) => Promise<void> };
			getRegisteredCursorPiToolBridge: () => { disposeAll: (reason?: string) => Promise<void> } | undefined;
			__testUtils?: { resetRegisteredBridgeForTests?: () => Promise<void> };
		};
		await bridgeMod.__testUtils?.resetRegisteredBridgeForTests?.();

		const cardA = createFakePi();
		const cardB = createFakePi();
		const bridgeA = bridgeMod.registerCursorPiToolBridge(cardA.pi);
		const bridgeB = bridgeMod.registerCursorPiToolBridge(cardB.pi);

		await cardA.emit("session_start", {}, fakeSessionContext(sessionFileA, "sid-a", cwdA));
		await cardB.emit("session_start", {}, fakeSessionContext(sessionFileB, "sid-b", cwdB));

		// Card A is mid-turn; card B bound last. A must still see its own bridge,
		// including after awaits (the context follows the whole turn).
		await host.runInCursorHostSession({ sessionFile: sessionFileA, sessionId: "sid-a" }, async () => {
			expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeA);
			await new Promise((resolve) => setTimeout(resolve, 0));
			await cardB.emit("session_start", {}, fakeSessionContext(sessionFileB, "sid-b", cwdB));
			expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeA);
		});

		host.runInCursorHostSession({ sessionFile: sessionFileB, sessionId: "sid-b" }, () => {
			expect(bridgeMod.getRegisteredCursorPiToolBridge()).toBe(bridgeB);
		});
	});

	it("resolves session scope from the prompting card, not the last bind", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		const scope = sdkRequire("pi-cursor-sdk/dist/cursor-session-scope.js") as {
			registerCursorSessionScope: (pi: FakePi["pi"]) => void;
			getCursorSessionScopeKey: () => string;
			getCursorSessionCwd: () => string;
			__testUtils: { reset: () => void };
		};
		scope.__testUtils.reset();

		const cardA = createFakePi();
		const cardB = createFakePi();
		scope.registerCursorSessionScope(cardA.pi);
		scope.registerCursorSessionScope(cardB.pi);

		await cardA.emit("session_start", {}, fakeSessionContext(sessionFileA, "sid-a", cwdA));
		await cardB.emit("session_start", {}, fakeSessionContext(sessionFileB, "sid-b", cwdB));

		host.runInCursorHostSession({ sessionFile: sessionFileA, sessionId: "sid-a" }, () => {
			expect(scope.getCursorSessionScopeKey()).toBe(sessionFileA);
			expect(scope.getCursorSessionCwd()).toBe(cwdA);
		});
		host.runInCursorHostSession({ sessionFile: sessionFileB, sessionId: "sid-b" }, () => {
			expect(scope.getCursorSessionScopeKey()).toBe(sessionFileB);
			expect(scope.getCursorSessionCwd()).toBe(cwdB);
		});
	});

	it("does not treat a sibling card binding as this card's scope change", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		const scope = sdkRequire("pi-cursor-sdk/dist/cursor-session-scope.js") as {
			registerCursorSessionScope: (pi: FakePi["pi"]) => void;
			onCursorSessionScopeKeyChange: (handler: (previousScopeKey: string) => void) => void;
			__testUtils: { reset: () => void };
		};
		scope.__testUtils.reset();
		// Melon opts in; the scope-change handler disposes the previous scope's
		// Cursor agent, so firing it on a card switch would kill a live sibling.
		host.runInCursorHostSession({}, () => {});

		const disposedScopeKeys: string[] = [];
		scope.onCursorSessionScopeKeyChange((previousScopeKey) => {
			disposedScopeKeys.push(previousScopeKey);
		});

		const cardA = createFakePi();
		const cardB = createFakePi();
		scope.registerCursorSessionScope(cardA.pi);
		scope.registerCursorSessionScope(cardB.pi);

		await cardA.emit("session_start", {}, fakeSessionContext(sessionFileA, "sid-a", cwdA));
		await cardB.emit("session_start", {}, fakeSessionContext(sessionFileB, "sid-b", cwdB));
		await cardA.emit("session_start", {}, fakeSessionContext(sessionFileA, "sid-a", cwdA));
		expect(disposedScopeKeys).toEqual([]);

		// The same card moving to a different session still is a scope change.
		const movedSessionFile = join(cwdA, "a-forked.jsonl");
		await cardA.emit("session_start", {}, fakeSessionContext(movedSessionFile, "sid-a2", cwdA));
		expect(disposedScopeKeys).toEqual([sessionFileA]);
	});

	it("writes a resume handle into the prompting card's transcript only", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		const resume = sdkRequire("pi-cursor-sdk/dist/cursor-session-agent-resume.js") as {
			registerCursorSessionAgentResume: (pi: FakePi["pi"]) => void;
			persistCursorSessionAgentResumeHandle: (input: {
				runtime: "local";
				agentId: string;
				poolKey: string;
				sendState: { bootstrapped: boolean; contextFingerprint: string; incrementalSendCount: number };
				storeIdentity: { version: 1; stateRoot: string };
			}) => void;
			__testUtils: { reset: () => void };
		};
		resume.__testUtils.reset();

		const cardA = createFakePi();
		const cardB = createFakePi();
		resume.registerCursorSessionAgentResume(cardA.pi);
		resume.registerCursorSessionAgentResume(cardB.pi);

		const ctxA = fakeSessionContext(sessionFileA, "sid-a", cwdA);
		const ctxB = fakeSessionContext(sessionFileB, "sid-b", cwdB);
		await cardA.emit("session_start", {}, ctxA);
		await cardB.emit("session_start", {}, ctxB);

		host.runInCursorHostSession({ sessionFile: sessionFileA, sessionId: "sid-a" }, () => {
			resume.persistCursorSessionAgentResumeHandle({
				runtime: "local",
				agentId: "agent-card-a",
				poolKey: "pool-a",
				sendState: { bootstrapped: true, contextFingerprint: "fp-a", incrementalSendCount: 1 },
				storeIdentity: { version: 1, stateRoot: join(cwdA, "store") },
			});
		});

		// Card B finishing its own turn must not claim card A's pending handle.
		await cardB.emit("turn_end", {}, ctxB);
		expect(cardB.appends).toHaveLength(0);

		await cardA.emit("turn_end", {}, ctxA);
		expect(cardA.appends).toHaveLength(1);
		expect(cardA.appends[0]?.customType).toBe("cursor-sdk-agent-resume");
		expect((cardA.appends[0]?.data as { agentId?: string; sessionFile?: string }).agentId).toBe("agent-card-a");
		expect((cardA.appends[0]?.data as { sessionFile?: string }).sessionFile).toBe(sessionFileA);
	});

	it("keeps process-global HTTP/1 configuration until the last Cursor card closes", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		host.runInCursorHostSession({}, () => {});
		const lifecycle = sdkRequire("pi-cursor-sdk/dist/cursor-session-agent-lifecycle.js") as {
			registerCursorSessionAgentLifecycle: (pi: FakePi["pi"]) => void;
			__testUtils: { resetLiveSessions: () => void; getLiveSessionCount: () => number };
		};
		const http1 = sdkRequire("pi-cursor-sdk/dist/cursor-http1.js") as {
			configureCursorSdkHttp1: (
				sdk: { Cursor: { configure: (config: unknown) => void } },
				setting: unknown,
			) => boolean | undefined;
			__testUtils: { reset: () => void };
		};
		lifecycle.__testUtils.resetLiveSessions();
		http1.__testUtils.reset();

		const cardA = createFakePi();
		const cardB = createFakePi();
		lifecycle.registerCursorSessionAgentLifecycle(cardA.pi);
		lifecycle.registerCursorSessionAgentLifecycle(cardB.pi);
		const ctxA = fakeSessionContext(sessionFileA, "sid-a", cwdA);
		const ctxB = fakeSessionContext(sessionFileB, "sid-b", cwdB);
		await cardA.emit("session_start", {}, ctxA);
		await cardB.emit("session_start", {}, ctxB);
		expect(lifecycle.__testUtils.getLiveSessionCount()).toBe(2);

		const configurations: unknown[] = [];
		http1.configureCursorSdkHttp1(
			{ Cursor: { configure: (config) => configurations.push(config) } },
			{ source: "session", value: true },
		);
		expect(configurations).toHaveLength(1);

		await cardA.emit("session_shutdown", { reason: "quit" }, ctxA);
		expect(lifecycle.__testUtils.getLiveSessionCount()).toBe(1);
		expect(configurations).toHaveLength(1);

		await cardB.emit("session_shutdown", { reason: "quit" }, ctxB);
		expect(lifecycle.__testUtils.getLiveSessionCount()).toBe(0);
		expect(configurations).toHaveLength(2);
		expect(configurations[1]).toEqual({ local: { useHttp1ForAgent: null } });
	});

	it("resolves compaction from the event session even inside a sibling context", async () => {
		if (!sdkRequire) return;

		const host = sdkRequire("pi-cursor-sdk/dist/cursor-host-session.js") as CursorHostSessionModule;
		const extension = sdkRequire("pi-cursor-sdk/dist/index.js") as {
			resolveCursorCompactionScopeKey: (ctx: unknown) => string | undefined;
		};
		const scopeKey = host.runInCursorHostSession({ sessionFile: sessionFileB, sessionId: "sid-b" }, () =>
			extension.resolveCursorCompactionScopeKey(fakeSessionContext(sessionFileA, "sid-a", cwdA)),
		);
		expect(scopeKey).toBe(sessionFileA);
	});

	it("runInCursorSession opens the card's context around a cursor prompt", async () => {
		if (!sdkRequire) return;

		const scope = sdkRequire("pi-cursor-sdk/dist/cursor-session-scope.js") as {
			registerCursorSessionScope: (pi: FakePi["pi"]) => void;
			getCursorSessionScopeKey: () => string;
			__testUtils: { reset: () => void };
		};
		scope.__testUtils.reset();
		const { runInCursorSession } = await import("../src/cursor-session-binding.ts");

		const card = createFakePi();
		scope.registerCursorSessionScope(card.pi);
		await card.emit("session_start", {}, fakeSessionContext(sessionFileA, "sid-a", cwdA));
		// A sibling card binds after A registered: the global scope now points at B.
		const sibling = createFakePi();
		scope.registerCursorSessionScope(sibling.pi);
		await sibling.emit("session_start", {}, fakeSessionContext(sessionFileB, "sid-b", cwdB));

		const runtime = {
			session: {
				model: { provider: "cursor" },
				sessionManager: {
					getSessionFile: () => sessionFileA,
					getSessionId: () => "sid-a",
					getCwd: () => cwdA,
					appendCustomEntry: () => "entry-1",
				},
				bindExtensions: async () => {},
			},
		};

		const seen = await runInCursorSession(runtime, async () => scope.getCursorSessionScopeKey());
		expect(seen).toBe(sessionFileA);
	});

	it("reuses a live Cursor runtime on reconnect and rejects a second card owner", async () => {
		if (!sdkRequire) return;

		const bridgeMod = sdkRequire("pi-cursor-sdk/dist/cursor-pi-tool-bridge.js") as {
			__testUtils?: { getRegisteredBridgeCountForTests?: () => number };
		};
		const { buildApp } = await import("../src/index.ts");
		const app = await buildApp();
		const cardId = `cursor-reconnect-${Date.now()}`;
		const [created, duplicateCreate] = await Promise.all([
			app.inject({
				method: "POST",
				url: "/sessions",
				payload: { cardId, cwd: cwdA, model: "cursor/auto-smart" },
			}),
			app.inject({
				method: "POST",
				url: "/sessions",
				payload: { cardId, cwd: cwdA, model: "cursor/auto-smart" },
			}),
		]);
		expect(created.statusCode).toBe(200);
		expect(duplicateCreate.statusCode).toBe(200);
		const createdBody = created.json() as { sessionFile: string; sessionId: string };
		expect((duplicateCreate.json() as { sessionId: string }).sessionId).toBe(createdBody.sessionId);
		const bridgeCount = bridgeMod.__testUtils?.getRegisteredBridgeCountForTests?.();
		expect(bridgeCount).toBeGreaterThan(0);

		// This is what the web client does after an SSE reconnect. It must
		// return the existing runtime instead of registering a second bridge.
		const resumed = await app.inject({
			method: "POST",
			url: "/sessions/resume",
			payload: {
				cardId,
				sessionFile: createdBody.sessionFile,
				model: "cursor/auto-smart",
			},
		});
		expect(resumed.statusCode).toBe(200);
		expect((resumed.json() as { sessionId: string }).sessionId).toBe(createdBody.sessionId);
		expect(bridgeMod.__testUtils?.getRegisteredBridgeCountForTests?.()).toBe(bridgeCount);

		// The Cursor bridge and agent pool are session-file scoped. A different
		// live card cannot own the same file at the same time.
		const duplicateOwner = await app.inject({
			method: "POST",
			url: "/sessions/resume",
			payload: {
				cardId: `${cardId}-duplicate`,
				sessionFile: createdBody.sessionFile,
				model: "cursor/auto-smart",
			},
		});
		expect(duplicateOwner.statusCode).toBe(409);
		expect(duplicateOwner.json().message).toContain("already open");
		expect(bridgeMod.__testUtils?.getRegisteredBridgeCountForTests?.()).toBe(bridgeCount);

		const deleted = await app.inject({ method: "DELETE", url: `/sessions/${cardId}` });
		expect(deleted.statusCode).toBe(200);
		expect(bridgeMod.__testUtils?.getRegisteredBridgeCountForTests?.()).toBe((bridgeCount ?? 1) - 1);

		// Teardown releases ownership so another card can intentionally resume.
		const newOwner = await app.inject({
			method: "POST",
			url: "/sessions/resume",
			payload: {
				cardId: `${cardId}-new-owner`,
				sessionFile: createdBody.sessionFile,
				model: "cursor/auto-smart",
			},
		});
		expect(newOwner.statusCode).toBe(200);

		await app.close();
	}, 30_000);
});
