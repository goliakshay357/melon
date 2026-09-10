import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-antigravity-bind-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

describe("runInBoundAntigravitySession", () => {
	afterEach(() => {
		vi.restoreAllMocks();
		vi.resetModules();
	});

	it("is a no-op for non-antigravity providers", async () => {
		const { runInBoundAntigravitySession } = await import("../src/antigravity-session-binding.ts");
		let ran = false;
		const runtime = {
			session: {
				model: { provider: "anthropic" },
				sessionManager: {},
				bindExtensions: vi.fn(async () => {}),
			},
		};
		await runInBoundAntigravitySession(runtime, {}, async () => {
			ran = true;
		});
		expect(ran).toBe(true);
		expect(runtime.session.bindExtensions).not.toHaveBeenCalled();
	});

	it("re-binds extensions on this card before running an Antigravity prompt when available", async () => {
		const ext = await import("../src/antigravity-extension.ts");
		if (!ext.antigravitySessionIsolationAvailable()) return;

		const { runInBoundAntigravitySession } = await import("../src/antigravity-session-binding.ts");
		const bindExtensions = vi.fn(async () => {});
		const runtime = {
			session: {
				model: { provider: "antigravity" },
				sessionManager: {
					getSessionFile: () => join(agentDir, "a.jsonl"),
					getSessionId: () => "sid-a",
					getCwd: () => agentDir,
				},
				bindExtensions,
			},
		};
		let ran = false;
		await runInBoundAntigravitySession(runtime, { uiContext: { kind: "test" } as never }, async () => {
			ran = true;
			expect(bindExtensions).toHaveBeenCalledTimes(1);
			expect(bindExtensions).toHaveBeenCalledWith({
				mode: "rpc",
				uiContext: { kind: "test" },
			});
		});
		expect(ran).toBe(true);
	});

	it("hard-fails Antigravity prompts when the extension entry is missing", async () => {
		vi.resetModules();
		vi.doMock("../src/antigravity-extension.ts", async () => {
			const actual = await vi.importActual<typeof import("../src/antigravity-extension.ts")>(
				"../src/antigravity-extension.ts",
			);
			return {
				...actual,
				antigravitySessionIsolationAvailable: () => false,
				antigravityExtensionEntryPath: () => null,
			};
		});
		const { runInBoundAntigravitySession } = await import("../src/antigravity-session-binding.ts");
		const runtime = {
			session: {
				model: { provider: "antigravity" },
				sessionManager: {},
				bindExtensions: vi.fn(async () => {}),
			},
		};
		await expect(runInBoundAntigravitySession(runtime, {}, async () => "ok")).rejects.toMatchObject({
			statusCode: 503,
			message: expect.stringMatching(/antigravity|extension/i),
		});
		expect(runtime.session.bindExtensions).not.toHaveBeenCalled();
	});
});
