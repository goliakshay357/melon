// Antigravity / Cloud Code Assist provider via the bundled `pi-antigravity` package.
//
// Same Melon pattern as cursor-extension.ts / claude-bridge-extension.ts:
// - GUI ModelRuntime never runs the session resource loader, so this module
//   registers the antigravity catalog (+ OAuth hooks) without relying on the
//   session extension loader for the picker.
// - Session runtimes load the package extension entry via additionalExtensionPaths.
//
// Antigravity has no separate `/isolated` export (native HTTP provider). Melon
// still treats it as isolation-sensitive (attach locks, session-file exclusivity,
// turn tokens, bound re-bind). Hard-fail when the package is missing.
//
// Fail-open: if the package is absent, builtin providers are unaffected.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function antigravityResolvers(): NodeJS.Require[] {
	const paths = [
		import.meta.url,
		join(moduleDir, "../package.json"),
		join(moduleDir, "../../../desktop/package.json"),
	];
	const out: NodeJS.Require[] = [];
	for (const p of paths) {
		try {
			out.push(createRequire(p));
		} catch {
			/* skip */
		}
	}
	return out;
}

export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_PROVIDER_NAME = "Antigravity";

export type AntigravityCatalogStatus = {
	loaded: boolean;
	/** True when the bundled package extension entry is present for Melon sessions. */
	isolationAvailable: boolean;
	extensionPath: string | null;
	extensionEntryPath: string | null;
	modelCount: number;
	issues: string[];
};

let antigravityCatalogStatus: AntigravityCatalogStatus = {
	loaded: false,
	isolationAvailable: false,
	extensionPath: null,
	extensionEntryPath: null,
	modelCount: 0,
	issues: ["Antigravity catalog not loaded yet"],
};

export function getAntigravityCatalogStatus(): AntigravityCatalogStatus {
	return { ...antigravityCatalogStatus, issues: [...antigravityCatalogStatus.issues] };
}

function setAntigravityCatalogStatus(next: AntigravityCatalogStatus): void {
	antigravityCatalogStatus = next;
	for (const issue of antigravityCatalogStatus.issues) {
		console.warn("[melon] antigravity:", issue);
	}
}

/** Bundled `pi-antigravity` package dir, or null when not installed. */
export function antigravityExtensionPath(): string | null {
	for (const req of antigravityResolvers()) {
		try {
			const pkgJson = req.resolve("pi-antigravity/package.json");
			return dirname(pkgJson);
		} catch {
			try {
				const entry = req.resolve("pi-antigravity");
				// main is src/index.ts → package root is dirname(dirname(entry)) when entry is .../src/index.ts
				const dir = dirname(entry);
				if (existsSync(join(dir, "package.json"))) return dir;
				const parent = dirname(dir);
				if (existsSync(join(parent, "package.json"))) return parent;
			} catch {
				/* try next */
			}
		}
	}
	return null;
}

/** Extension entry Melon loads into session runtimes (`pi.extensions`). */
export function antigravityExtensionEntryPath(): string | null {
	const root = antigravityExtensionPath();
	if (!root) return null;
	const candidates = [join(root, "src", "index.ts"), join(root, "src", "index.js"), join(root, "index.js")];
	for (const p of candidates) {
		if (existsSync(p)) return p;
	}
	return null;
}

/**
 * Melon multi-card sessions require the bundled extension entry. Unlike Claude
 * Code, Antigravity has no separate isolated bundle — Melon owns card isolation.
 */
export function antigravitySessionIsolationAvailable(): boolean {
	return antigravityExtensionEntryPath() !== null;
}

/** Conservative static catalog (picker). Live refresh happens inside the session extension. */
const ANTIGRAVITY_CATALOG_MODELS = [
	{
		id: "gemini-3.8-flash",
		name: "Gemini 3.8 Flash (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "gemini-3.7-flash",
		name: "Gemini 3.7 Flash (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "gemini-3.6-flash",
		name: "Gemini 3.6 Flash (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "gemini-3.5-flash",
		name: "Gemini 3.5 Flash (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 1_048_576,
		maxTokens: 65_535,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 200_000,
		maxTokens: 64_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6 (Antigravity)",
		reasoning: true,
		input: ["text", "image"] as ("text" | "image")[],
		contextWindow: 250_000,
		maxTokens: 64_000,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
	{
		id: "gpt-oss-120b",
		name: "GPT-OSS 120B (Antigravity)",
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		contextWindow: 128_000,
		maxTokens: 32_768,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	},
];

function catalogStreamUnavailable(): never {
	throw new Error(
		"Antigravity turns run inside Melon chat cards (bundled extension), not the shared model catalog runtime.",
	);
}

type AntigravityOAuthModule = {
	loginAntigravity: (callbacks: unknown) => Promise<Record<string, unknown>>;
	refreshAntigravityToken: (credentials: unknown, signal?: AbortSignal) => Promise<Record<string, unknown>>;
	getApiKey: (credentials: unknown) => string;
};

let oauthModulePromise: Promise<AntigravityOAuthModule> | null = null;

/** Load OAuth helpers from the bundled package (TypeScript source entry). */
export function loadAntigravityOAuthModule(): Promise<AntigravityOAuthModule> {
	if (!oauthModulePromise) {
		oauthModulePromise = (async () => {
			const root = antigravityExtensionPath();
			if (!root) {
				throw new Error("Antigravity unavailable: pi-antigravity is not installed in this Melon build.");
			}
			const oauthTs = join(root, "src", "auth", "oauth.ts");
			const oauthJs = join(root, "src", "auth", "oauth.js");
			const href = pathToFileURL(existsSync(oauthTs) ? oauthTs : oauthJs).href;
			const mod = (await import(href)) as AntigravityOAuthModule;
			if (typeof mod.loginAntigravity !== "function" || typeof mod.getApiKey !== "function") {
				throw new Error("Antigravity package is missing OAuth login helpers.");
			}
			return mod;
		})();
	}
	return oauthModulePromise;
}

/**
 * Register Antigravity into a ModelRuntime (picker + Melon browser login).
 * Sessions still load the full extension factory via additionalExtensionPaths.
 */
export async function loadAntigravityProviderInto(runtime: ModelRuntime): Promise<void> {
	const extPath = antigravityExtensionPath();
	const entryPath = antigravityExtensionEntryPath();
	const isolation = entryPath !== null;

	if (!extPath) {
		setAntigravityCatalogStatus({
			loaded: false,
			isolationAvailable: false,
			extensionPath: null,
			extensionEntryPath: null,
			modelCount: 0,
			issues: ["Antigravity unavailable: pi-antigravity is not installed in this Melon build."],
		});
		return;
	}

	if (!isolation) {
		setAntigravityCatalogStatus({
			loaded: false,
			isolationAvailable: false,
			extensionPath: extPath,
			extensionEntryPath: null,
			modelCount: 0,
			issues: ["Antigravity unavailable: extension entry (src/index.ts) missing. Reinstall desktop dependencies."],
		});
		return;
	}

	const issues: string[] = [];
	let oauth: AntigravityOAuthModule;
	try {
		oauth = await loadAntigravityOAuthModule();
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setAntigravityCatalogStatus({
			loaded: false,
			isolationAvailable: true,
			extensionPath: extPath,
			extensionEntryPath: entryPath,
			modelCount: 0,
			issues: [`Failed to load Antigravity OAuth module: ${message}`],
		});
		return;
	}

	try {
		runtime.registerProvider(ANTIGRAVITY_PROVIDER_ID, {
			name: ANTIGRAVITY_PROVIDER_NAME,
			baseUrl: "https://daily-cloudcode-pa.googleapis.com",
			api: "antigravity-api" as never,
			models: ANTIGRAVITY_CATALOG_MODELS as never,
			oauth: {
				name: ANTIGRAVITY_PROVIDER_NAME,
				isSubscription: true,
				login: (callbacks) => oauth.loginAntigravity(callbacks) as never,
				refreshToken: (credentials, signal) => oauth.refreshAntigravityToken(credentials, signal) as never,
				getApiKey: (credentials) => oauth.getApiKey(credentials),
			},
			streamSimple: catalogStreamUnavailable as never,
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setAntigravityCatalogStatus({
			loaded: false,
			isolationAvailable: true,
			extensionPath: extPath,
			extensionEntryPath: entryPath,
			modelCount: 0,
			issues: [`Failed to register Antigravity provider: ${message}`],
		});
		return;
	}

	try {
		await runtime.refresh({ allowNetwork: false });
	} catch (e) {
		issues.push(`Antigravity provider refresh failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	setAntigravityCatalogStatus({
		loaded: true,
		isolationAvailable: true,
		extensionPath: extPath,
		extensionEntryPath: entryPath,
		modelCount: ANTIGRAVITY_CATALOG_MODELS.length,
		issues,
	});
}

/** True when Melon auth.json has Antigravity OAuth credentials. */
export function hasAntigravityAuth(authEntries: Record<string, unknown>): boolean {
	const entry = authEntries[ANTIGRAVITY_PROVIDER_ID] as { type?: string; access?: unknown } | undefined;
	return entry?.type === "oauth" && typeof entry.access === "string" && entry.access.trim().length > 0;
}
