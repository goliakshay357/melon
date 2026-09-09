// Claude bridge browser-login API smoke tests (no real OAuth).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-claude-login-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getClaudeBridgeLoginStatus } = await import("../src/claude-bridge-login.ts");
const { hasClaudeBridgeAuth } = await import("../src/claude-bridge-extension.ts");

describe("claude-bridge login API", () => {
	it("rejects API keys for claude-bridge", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/auth/claude-bridge/key",
			payload: { key: "sk-should-not-work" },
		});
		expect(res.statusCode).toBe(400);
		expect(String(res.json().error)).toMatch(/browser login/i);
		await app.close();
	});

	it("exposes idle login status and cancel", async () => {
		const app = await buildApp();
		const status = await app.inject({ method: "GET", url: "/auth/claude-bridge/login/status" });
		expect(status.json()).toEqual({ phase: "idle" });

		const cancel = await app.inject({ method: "POST", url: "/auth/claude-bridge/login/cancel" });
		expect(cancel.json().ok).toBe(true);
		expect(getClaudeBridgeLoginStatus().phase).toBe("idle");
		await app.close();
	});

	it("hasClaudeBridgeAuth stays false without oauth", () => {
		expect(hasClaudeBridgeAuth({})).toBe(false);
	});
});
