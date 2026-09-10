import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-antigravity-login-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { cancelAntigravityLogin, getAntigravityLoginStatus } = await import("../src/antigravity-login.ts");

describe("antigravity login status", () => {
	it("starts idle and cancel is safe when idle", () => {
		expect(getAntigravityLoginStatus()).toEqual({ phase: "idle" });
		cancelAntigravityLogin();
		expect(getAntigravityLoginStatus()).toEqual({ phase: "idle" });
	});
});
