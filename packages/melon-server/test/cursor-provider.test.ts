// Cursor provider integration tests. Hermetic: the agent dir points at a
// throwaway dir so auth.json / settings writes never touch the real agent dir.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-cursor-test-"));
// The env var name depends on the build's piConfig branding (this repo builds
// as "melon" → MELON_CODING_AGENT_DIR). Set both spellings.
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");
const { cursorExtensionPath, cursorSessionIsolationAvailable, hasRealCursorKey, rewriteCursorError } = await import(
	"../src/cursor-extension.ts"
);
const { loadSettings } = await import("../src/settings.ts");

// Fail fast if the hermetic dir is not actually in effect — writing keys or
// settings to the real agent dir from a test would be destructive.
if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

const authPath = join(agentDir, "auth.json");

function seedSettings(next: Record<string, unknown>): void {
	mkdirSync(join(agentDir, "melon"), { recursive: true });
	writeFileSync(join(agentDir, "melon", "settings.json"), JSON.stringify(next, null, "\t"));
}

describe("rewriteCursorError", () => {
	it("maps TUI-only commands to Melon actions", () => {
		const msg =
			"Cursor model discovery needs an API key from /login (Use an API key -> Cursor) or CURSOR_API_KEY. " +
			"After adding auth to an already-started pi session, run /cursor-refresh-models to refresh the full live Cursor model catalog without restarting pi.";
		const out = rewriteCursorError(msg);
		expect(out).not.toContain("/login");
		expect(out).not.toContain("/cursor-refresh-models");
		expect(out).toContain("provider settings");
		expect(out).toContain("new chat card");
	});

	it("leaves non-cursor errors untouched", () => {
		const msg = "anthropic: overloaded_error";
		expect(rewriteCursorError(msg)).toBe(msg);
	});
});

describe("getCursorCatalogStatus", () => {
	it("is readable after loadCursorProviderInto attempt via /models", async () => {
		const { getCursorCatalogStatus } = await import("../src/cursor-extension.ts");
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/models?provider=cursor" });
		const body = res.json() as {
			models: unknown[];
			total: number;
			error?: string;
			cursor?: { loaded: boolean; issues: string[]; isolationAvailable: boolean };
		};
		expect(body.cursor).toBeTruthy();
		expect(Array.isArray(body.cursor?.issues)).toBe(true);
		expect(typeof body.cursor?.loaded).toBe("boolean");
		expect(typeof body.cursor?.isolationAvailable).toBe("boolean");
		if (body.total === 0) {
			expect(typeof body.error).toBe("string");
			expect(body.error!.length).toBeGreaterThan(0);
		}
		const status = getCursorCatalogStatus();
		expect(status.issues.length).toBeGreaterThan(0);
		await app.close();
	});
});

describe("hasRealCursorKey", () => {
	const envKey = process.env.CURSOR_API_KEY;
	const withEnv = (value: string | undefined, fn: () => void) => {
		if (value === undefined) delete process.env.CURSOR_API_KEY;
		else process.env.CURSOR_API_KEY = value;
		try {
			fn();
		} finally {
			if (envKey === undefined) delete process.env.CURSOR_API_KEY;
			else process.env.CURSOR_API_KEY = envKey;
		}
	};

	it("false when no key source exists", () => {
		withEnv(undefined, () => expect(hasRealCursorKey({}, {})).toBe(false));
	});

	it("true from auth.json entry, melon settings key, or env", () => {
		withEnv(undefined, () => {
			expect(hasRealCursorKey({ cursor: { type: "api_key", key: "sk-a" } }, {})).toBe(true);
			expect(hasRealCursorKey({ cursor: { type: "oauth" } }, {})).toBe(false);
			expect(hasRealCursorKey({}, { cursor: "sk-b" })).toBe(true);
		});
		withEnv("sk-c", () => expect(hasRealCursorKey({}, {})).toBe(true));
	});
});

describe("cursorExtensionPath", () => {
	it("returns null or an existing package dir with a pi manifest", () => {
		const p = cursorExtensionPath();
		if (p === null) return;
		const pkg = JSON.parse(readFileSync(join(p, "package.json"), "utf8")) as { pi?: { extensions?: string[] } };
		expect(Array.isArray(pkg.pi?.extensions)).toBe(true);
		expect(cursorSessionIsolationAvailable()).toBe(true);
	});
});

describe("provider key persistence", () => {
	it("POST /auth/:provider/key writes auth.json (0600), stores the key, clears that provider's denylist", async () => {
		seedSettings({ denylistedModels: ["cursor/grok-4.6", "openrouter/some-model"] });
		const app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/auth/openrouter/key",
			payload: { key: "sk-or-test-123456" },
		});
		expect(res.json().ok).toBe(true);

		expect(existsSync(authPath)).toBe(true);
		expect(statSync(authPath).mode & 0o777).toBe(0o600);
		const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		expect(auth.openrouter).toEqual({ type: "api_key", key: "sk-or-test-123456" });

		const st = loadSettings();
		expect(st.providerKeys?.openrouter).toBe("sk-or-test-123456");
		// Only the keyed provider's denylist entries are cleared.
		expect(st.denylistedModels).toEqual(["cursor/grok-4.6"]);
		await app.close();
	});

	it("DELETE /auth/:provider removes the auth.json entry too", async () => {
		seedSettings({ providerKeys: { openrouter: "sk-or-test-123456" } });
		const app = await buildApp();
		const res = await app.inject({ method: "DELETE", url: "/auth/openrouter" });
		expect(res.json().ok).toBe(true);
		const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
		expect(auth.openrouter).toBeUndefined();
		expect(loadSettings().providerKeys?.openrouter).toBeUndefined();
		await app.close();
	});
});
