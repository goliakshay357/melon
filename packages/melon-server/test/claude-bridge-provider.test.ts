// Claude bridge provider catalog tests. Hermetic agent dir — never touch real auth.
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-claude-bridge-test-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
const {
	CLAUDE_BRIDGE_PROVIDER_ID,
	claudeBridgeExtensionPath,
	claudeBridgeIsolatedExtensionPath,
	claudeBridgeSessionIsolationAvailable,
	getClaudeBridgeCatalogStatus,
	hasClaudeBridgeAuth,
	loadClaudeBridgeProviderInto,
} = await import("../src/claude-bridge-extension.ts");

if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

describe("hasClaudeBridgeAuth", () => {
	it("false when no oauth credentials exist", () => {
		expect(hasClaudeBridgeAuth({})).toBe(false);
		expect(hasClaudeBridgeAuth({ anthropic: { type: "api_key", key: "sk-a" } })).toBe(false);
		expect(hasClaudeBridgeAuth({ [CLAUDE_BRIDGE_PROVIDER_ID]: { type: "oauth" } })).toBe(false);
	});

	it("true from claude-bridge oauth or Anthropic Pro/Max oauth", () => {
		expect(
			hasClaudeBridgeAuth({
				[CLAUDE_BRIDGE_PROVIDER_ID]: { type: "oauth", access: "tok-bridge" },
			}),
		).toBe(true);
		expect(hasClaudeBridgeAuth({ anthropic: { type: "oauth", access: "tok-anthropic" } })).toBe(true);
	});
});

describe("claudeBridgeExtensionPath", () => {
	it("returns null or a package dir with an isolated Melon entry", () => {
		const p = claudeBridgeExtensionPath();
		if (p === null) {
			expect(claudeBridgeSessionIsolationAvailable()).toBe(false);
			return;
		}
		const pkg = JSON.parse(readFileSync(join(p, "package.json"), "utf8")) as {
			name?: string;
			pi?: { extensions?: string[] };
		};
		expect(pkg.name).toBe("@fractaal/pi-claude-bridge");
		expect(Array.isArray(pkg.pi?.extensions)).toBe(true);
		const isolated = claudeBridgeIsolatedExtensionPath();
		expect(isolated).toBeTruthy();
		expect(existsSync(isolated!)).toBe(true);
		expect(claudeBridgeSessionIsolationAvailable()).toBe(true);
	});
});

describe("getClaudeBridgeCatalogStatus", () => {
	it("is readable after load attempt via /models and /auth/providers", async () => {
		const app = await buildApp();
		const modelsRes = await app.inject({ method: "GET", url: "/models?provider=claude-bridge" });
		const modelsBody = modelsRes.json() as {
			models: Array<{ label: string; provider: string }>;
			total: number;
			error?: string;
			claudeBridge?: { loaded: boolean; issues: string[]; isolationAvailable: boolean; modelCount: number };
		};
		expect(modelsBody.claudeBridge).toBeTruthy();
		expect(Array.isArray(modelsBody.claudeBridge?.issues)).toBe(true);
		expect(typeof modelsBody.claudeBridge?.loaded).toBe("boolean");

		const providersRes = await app.inject({ method: "GET", url: "/auth/providers" });
		const providers = providersRes.json() as Array<{ id: string; configured: boolean; error?: string }>;
		const bridge = providers.find((p) => p.id === CLAUDE_BRIDGE_PROVIDER_ID);
		expect(bridge).toBeTruthy();

		const status = getClaudeBridgeCatalogStatus();
		if (status.loaded) {
			expect(modelsBody.total).toBeGreaterThan(0);
			expect(modelsBody.models.every((m) => m.provider === CLAUDE_BRIDGE_PROVIDER_ID)).toBe(true);
			expect(modelsBody.models.some((m) => m.label === "claude-bridge/claude-opus-4-8")).toBe(true);
		} else {
			expect(typeof modelsBody.error).toBe("string");
			expect(modelsBody.error!.length).toBeGreaterThan(0);
			expect(status.issues.length).toBeGreaterThan(0);
		}
		await app.close();
	});
});

describe("loadClaudeBridgeProviderInto", () => {
	it("registers claude-bridge into ModelRuntime when the isolated package is present", async () => {
		if (!claudeBridgeSessionIsolationAvailable()) return;

		const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
		const runtime = await ModelRuntime.create();
		await loadClaudeBridgeProviderInto(runtime);
		expect(runtime.getProvider(CLAUDE_BRIDGE_PROVIDER_ID)).toBeDefined();
		const models = runtime.getModels().filter((m) => m.provider === CLAUDE_BRIDGE_PROVIDER_ID);
		expect(models.length).toBeGreaterThan(0);
		expect(getClaudeBridgeCatalogStatus().loaded).toBe(true);
	});
});
