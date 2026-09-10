// Melon Claude bridge isolation: hard-fail without isolated entry; re-bind before prompt;
// never soft-degrade to the shared package entry.

import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-claude-bind-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

describe("runInBoundClaudeBridgeSession", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("is a no-op for non-claude-bridge providers", async () => {
		const { runInBoundClaudeBridgeSession } = await import("../src/claude-bridge-session-binding.ts");
		let ran = false;
		const runtime = {
			session: {
				model: { provider: "anthropic" },
				sessionManager: {},
				bindExtensions: vi.fn(async () => {}),
			},
		};
		await runInBoundClaudeBridgeSession(runtime, {}, async () => {
			ran = true;
		});
		expect(ran).toBe(true);
		expect(runtime.session.bindExtensions).not.toHaveBeenCalled();
	});

	it("re-binds extensions on this card before running a Claude prompt when isolation is available", async () => {
		const ext = await import("../src/claude-bridge-extension.ts");
		if (!ext.claudeBridgeSessionIsolationAvailable()) return; // desktop dep missing — skip

		const { runInBoundClaudeBridgeSession } = await import("../src/claude-bridge-session-binding.ts");
		const bindExtensions = vi.fn(async () => {});
		const runtime = {
			session: {
				model: { provider: "claude-bridge" },
				sessionManager: {
					getSessionFile: () => join(agentDir, "a.jsonl"),
					getSessionId: () => "sid-a",
					getCwd: () => agentDir,
				},
				bindExtensions,
			},
		};
		let ran = false;
		await runInBoundClaudeBridgeSession(runtime, { uiContext: { kind: "test" } as never }, async () => {
			ran = true;
			expect(bindExtensions).toHaveBeenCalledTimes(1);
			expect(bindExtensions).toHaveBeenCalledWith({
				mode: "rpc",
				uiContext: { kind: "test" },
			});
		});
		expect(ran).toBe(true);
	});

	it("hard-fails Claude prompts when the isolated entry is missing", async () => {
		vi.resetModules();
		vi.doMock("../src/claude-bridge-extension.ts", async () => {
			const actual = await vi.importActual<typeof import("../src/claude-bridge-extension.ts")>(
				"../src/claude-bridge-extension.ts",
			);
			return {
				...actual,
				claudeBridgeSessionIsolationAvailable: () => false,
				claudeBridgeIsolatedExtensionPath: () => null,
			};
		});
		const { runInBoundClaudeBridgeSession } = await import("../src/claude-bridge-session-binding.ts");
		const runtime = {
			session: {
				model: { provider: "claude-bridge" },
				sessionManager: {},
				bindExtensions: vi.fn(async () => {}),
			},
		};
		await expect(runInBoundClaudeBridgeSession(runtime, {}, async () => "ok")).rejects.toMatchObject({
			statusCode: 503,
			message: expect.stringMatching(/isolated/i),
		});
		expect(runtime.session.bindExtensions).not.toHaveBeenCalled();
	});
});
