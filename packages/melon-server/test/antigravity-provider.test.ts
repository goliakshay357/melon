import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-antigravity-provider-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
const {
	ANTIGRAVITY_PROVIDER_ID,
	antigravityExtensionEntryPath,
	antigravityExtensionPath,
	antigravitySessionIsolationAvailable,
	getAntigravityCatalogStatus,
	hasAntigravityAuth,
	loadAntigravityProviderInto,
} = await import("../src/antigravity-extension.ts");

if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

describe("hasAntigravityAuth", () => {
	it("false without oauth credentials", () => {
		expect(hasAntigravityAuth({})).toBe(false);
		expect(hasAntigravityAuth({ antigravity: { type: "api_key", key: "x" } })).toBe(false);
		expect(hasAntigravityAuth({ antigravity: { type: "oauth" } })).toBe(false);
	});

	it("true with antigravity oauth access token", () => {
		expect(
			hasAntigravityAuth({
				antigravity: { type: "oauth", access: "tok-ag" },
			}),
		).toBe(true);
	});
});

describe("antigravityExtensionPath", () => {
	it("returns null or a package dir with an extension entry", () => {
		const p = antigravityExtensionPath();
		if (p === null) {
			expect(antigravitySessionIsolationAvailable()).toBe(false);
			return;
		}
		const pkg = JSON.parse(readFileSync(join(p, "package.json"), "utf8")) as {
			name?: string;
			pi?: { extensions?: string[] };
		};
		expect(pkg.name).toBe("pi-antigravity");
		expect(Array.isArray(pkg.pi?.extensions)).toBe(true);
		const entry = antigravityExtensionEntryPath();
		expect(entry).toBeTruthy();
		expect(existsSync(entry!)).toBe(true);
		expect(antigravitySessionIsolationAvailable()).toBe(true);
	});
});

describe("getAntigravityCatalogStatus", () => {
	it("is readable after load attempt via /models and /auth/providers", async () => {
		const app = await buildApp();
		const modelsRes = await app.inject({ method: "GET", url: "/models?provider=antigravity" });
		const modelsBody = modelsRes.json() as {
			models: Array<{ label: string; provider: string }>;
			total: number;
			error?: string;
			antigravity?: { loaded: boolean; issues: string[]; isolationAvailable: boolean; modelCount: number };
		};
		expect(modelsBody.antigravity).toBeTruthy();
		expect(Array.isArray(modelsBody.antigravity?.issues)).toBe(true);
		expect(typeof modelsBody.antigravity?.loaded).toBe("boolean");

		const providersRes = await app.inject({ method: "GET", url: "/auth/providers" });
		const providers = providersRes.json() as Array<{ id: string; configured: boolean; error?: string }>;
		const bridge = providers.find((p) => p.id === ANTIGRAVITY_PROVIDER_ID);
		expect(bridge).toBeTruthy();

		const status = getAntigravityCatalogStatus();
		if (status.loaded) {
			expect(modelsBody.total).toBeGreaterThan(0);
			expect(modelsBody.models.every((m) => m.provider === ANTIGRAVITY_PROVIDER_ID)).toBe(true);
			expect(modelsBody.models.some((m) => m.label === "antigravity/gemini-3.8-flash")).toBe(true);
		} else {
			expect(typeof modelsBody.error).toBe("string");
			expect(modelsBody.error!.length).toBeGreaterThan(0);
			expect(status.issues.length).toBeGreaterThan(0);
		}
		await app.close();
	});
});

describe("loadAntigravityProviderInto", () => {
	it("registers antigravity into ModelRuntime when the package is present", async () => {
		if (!antigravitySessionIsolationAvailable()) return;

		const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
		const runtime = await ModelRuntime.create();
		await loadAntigravityProviderInto(runtime);
		expect(runtime.getProvider(ANTIGRAVITY_PROVIDER_ID)).toBeDefined();
		const models = runtime.getModels().filter((m) => m.provider === ANTIGRAVITY_PROVIDER_ID);
		expect(models.length).toBeGreaterThan(0);
		expect(getAntigravityCatalogStatus().loaded).toBe(true);
	});
});
