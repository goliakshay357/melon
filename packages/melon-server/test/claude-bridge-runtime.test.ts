// Local Claude Code runtime preflight (PATH, OAuth env) — no Anthropic network calls.
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-claude-runtime-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const {
	CLAUDE_CODE_OAUTH_TOKEN_ENV,
	applyClaudeBridgeRuntimeEnv,
	augmentPathForClaudeCode,
	getClaudeBridgeRuntimeStatus,
	readClaudeBridgeAccessToken,
	requireClaudeBridgeRuntimeReady,
	resolveMelonClaudeCodeExecutable,
} = await import("../src/claude-bridge-runtime.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");

if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

function writeAuth(access: string): void {
	mkdirSync(agentDir, { recursive: true });
	writeFileSync(
		join(agentDir, "auth.json"),
		JSON.stringify(
			{
				"claude-bridge": {
					type: "oauth",
					access,
					refresh: "refresh-test",
					expires: Date.now() + 60_000,
				},
			},
			null,
			"\t",
		),
		{ mode: 0o600 },
	);
}

function makeFakeClaudeBin(): { binDir: string; binPath: string } {
	const binDir = mkdtempSync(join(tmpdir(), "melon-fake-claude-bin-"));
	const binPath = join(binDir, "claude");
	writeFileSync(binPath, "#!/bin/sh\necho fake-claude\n");
	chmodSync(binPath, 0o755);
	return { binDir, binPath };
}

describe("augmentPathForClaudeCode", () => {
	it("appends known dirs without dropping existing PATH entries", () => {
		const env: NodeJS.ProcessEnv = { PATH: "/custom/bin" };
		const next = augmentPathForClaudeCode(env);
		expect(env.PATH).toBe(next);
		expect(next.split(":")[0]).toBe("/custom/bin");
	});
});

describe("Claude OAuth → CLAUDE_CODE_OAUTH_TOKEN", () => {
	afterEach(() => {
		delete process.env[CLAUDE_CODE_OAUTH_TOKEN_ENV];
	});

	it("reads Melon claude-bridge oauth access token", () => {
		writeAuth("tok-melon-claude");
		expect(readClaudeBridgeAccessToken()).toBe("tok-melon-claude");
	});

	it("exports Melon oauth into CLAUDE_CODE_OAUTH_TOKEN for Claude Code", () => {
		writeAuth("tok-for-sdk");
		const { binDir, binPath } = makeFakeClaudeBin();
		const env: NodeJS.ProcessEnv = { PATH: binDir };
		const status = applyClaudeBridgeRuntimeEnv(env);
		expect(env[CLAUDE_CODE_OAUTH_TOKEN_ENV]).toBe("tok-for-sdk");
		expect(status.oauthTokenPresent).toBe(true);
		expect(status.executableFound).toBe(true);
		expect(status.executablePath).toBe(binPath);
	});

	it("clears CLAUDE_CODE_OAUTH_TOKEN when Melon has no oauth", () => {
		writeFileSync(join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
		const env: NodeJS.ProcessEnv = {
			PATH: process.env.PATH,
			[CLAUDE_CODE_OAUTH_TOKEN_ENV]: "stale",
		};
		const status = applyClaudeBridgeRuntimeEnv(env);
		expect(env[CLAUDE_CODE_OAUTH_TOKEN_ENV]).toBeUndefined();
		expect(status.oauthTokenPresent).toBe(false);
		expect(status.ready).toBe(false);
		expect(status.issues.some((i) => /login/i.test(i))).toBe(true);
	});
});

describe("resolveMelonClaudeCodeExecutable", () => {
	it("finds a fake claude binary on PATH after augmentation", () => {
		const { binDir, binPath } = makeFakeClaudeBin();
		const env: NodeJS.ProcessEnv = { PATH: binDir };
		expect(resolveMelonClaudeCodeExecutable(env)).toBe(binPath);
	});
});

describe("requireClaudeBridgeRuntimeReady", () => {
	it("throws 503 when oauth or executable is missing", () => {
		writeFileSync(join(agentDir, "auth.json"), "{}\n", { mode: 0o600 });
		const env: NodeJS.ProcessEnv = { PATH: "/no/such/claude/bin" };
		try {
			requireClaudeBridgeRuntimeReady(env);
			expect.unreachable("should have thrown");
		} catch (e) {
			expect(e).toMatchObject({ statusCode: 503 });
			expect((e as Error).message.length).toBeGreaterThan(0);
		}
	});

	it("passes local preflight when isolation, oauth, and executable are present", async () => {
		const ext = await import("../src/claude-bridge-extension.ts");
		if (!ext.claudeBridgeSessionIsolationAvailable()) return;

		writeAuth("tok-ready");
		const { binDir } = makeFakeClaudeBin();
		const env: NodeJS.ProcessEnv = { PATH: binDir };
		const status = requireClaudeBridgeRuntimeReady(env);
		expect(status.ready).toBe(true);
		expect(status.isolationAvailable).toBe(true);
		expect(status.executableFound).toBe(true);
		expect(status.oauthTokenPresent).toBe(true);
		expect(getClaudeBridgeRuntimeStatus(env).ready).toBe(true);
	});
});
