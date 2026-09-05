// Cursor provider integration via the bundled pi-cursor-sdk extension
// (official @cursor/sdk agent runtime, local-by-default).
//
// The GUI's shared ModelRuntime never runs the session resource loader, so
// extension-registered providers would be invisible to the provider/model
// pickers. This module resolves the bundled extension and registers the Cursor
// provider into such runtimes WITHOUT loading the full extension factory.
//
// Full extension load (discoverAndLoadExtensions) still runs
// registerCursorPiToolBridge(). Melon applies a multicard patch so that no
// longer disposeAll()s sibling session bridges (see
// desktop/patches/pi-cursor-sdk-multicard). GUI catalog load still avoids the
// full factory so we never register a throwaway bridge from ModelRuntime.
// Session runtimes load the extension via additionalExtensionPaths instead
// (see createRuntimeFor in index.ts).
//
// Fail-open: if the package is absent (dev without desktop deps) or load
// fails, builtin providers are unaffected.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";

const moduleDir = dirname(fileURLToPath(import.meta.url));

function cursorSdkResolvers(): NodeJS.Require[] {
	const paths = [
		import.meta.url,
		// desktop/server/cursor-extension.js → desktop/package.json
		join(moduleDir, "../package.json"),
		// packages/melon-server/{src,dist} → repo desktop/package.json
		join(moduleDir, "../../../desktop/package.json"),
	];
	const out: NodeJS.Require[] = [];
	for (const p of paths) {
		try {
			out.push(createRequire(p));
		} catch {
			/* skip invalid */
		}
	}
	return out;
}

export const CURSOR_PROVIDER_ID = "cursor";
let cachedCursorSessionIsolationAvailable: boolean | undefined;

/** Last Cursor catalog load outcome — exposed to GET /models for DBG. */
export type CursorCatalogStatus = {
	loaded: boolean;
	isolationAvailable: boolean;
	extensionPath: string | null;
	modelCount: number;
	/** Human-readable issues (missing key, discovery failure, patch missing, …). */
	issues: string[];
};

let cursorCatalogStatus: CursorCatalogStatus = {
	loaded: false,
	isolationAvailable: false,
	extensionPath: null,
	modelCount: 0,
	issues: ["Cursor catalog not loaded yet"],
};

export function getCursorCatalogStatus(): CursorCatalogStatus {
	return { ...cursorCatalogStatus, issues: [...cursorCatalogStatus.issues] };
}

function setCursorCatalogStatus(next: CursorCatalogStatus): void {
	cursorCatalogStatus = {
		...next,
		issues: next.issues.map((m) => rewriteCursorError(m)),
	};
	for (const issue of cursorCatalogStatus.issues) {
		console.warn("[melon] cursor:", issue);
	}
}

/** Bundled pi-cursor-sdk package dir, or null when not installed. */
export function cursorExtensionPath(): string | null {
	for (const req of cursorSdkResolvers()) {
		try {
			return dirname(req.resolve("pi-cursor-sdk/package.json"));
		} catch {
			/* try next resolver */
		}
	}
	return null;
}

/**
 * The Cursor provider is safe in Melon's multi-card process only when every
 * stateful SDK module carries the session-isolation patch. Do not degrade to
 * upstream's process-global behavior: that can route one card's tools and
 * questions into another card.
 */
export function cursorSessionIsolationAvailable(): boolean {
	if (cachedCursorSessionIsolationAvailable !== undefined) return cachedCursorSessionIsolationAvailable;
	const extPath = cursorExtensionPath();
	if (!extPath) {
		cachedCursorSessionIsolationAvailable = false;
		return false;
	}
	const requiredMarkers = [
		["dist/cursor-host-session.js", "runInCursorHostSession"],
		["dist/cursor-pi-tool-bridge.js", "bridgesBySessionScopeKey"],
		["dist/cursor-session-scope.js", "isCursorHostSessionIsolationEnabled"],
		["dist/cursor-session-agent-resume.js", "resumeStatesByScopeKey"],
		["dist/cursor-session-agent-lineage.js", "lineageStatesByScopeKey"],
		["dist/cursor-session-agent-lifecycle.js", "liveCursorSessionScopeKeys"],
		["dist/index.js", "cursorHostSessionScopeKey"],
	] as const;
	try {
		cachedCursorSessionIsolationAvailable = requiredMarkers.every(([relativePath, marker]) => {
			const path = join(extPath, relativePath);
			return existsSync(path) && readFileSync(path, "utf8").includes(marker);
		});
		return cachedCursorSessionIsolationAvailable;
	} catch {
		cachedCursorSessionIsolationAvailable = false;
		return false;
	}
}

type CursorProviderPieces = {
	discoverModels: (opts?: { onFallback?: (issue: { message: string }) => void }) => Promise<unknown[]>;
	streamCursorLazy: (...args: unknown[]) => unknown;
	CURSOR_API_KEY_CONFIG_VALUE: string;
};

function loadCursorProviderPieces(): CursorProviderPieces | null {
	const extPath = cursorExtensionPath();
	if (!extPath) return null;
	try {
		const sdkRequire = createRequire(join(extPath, "package.json"));
		const discovery = sdkRequire("./dist/model-discovery.js") as {
			discoverModels: CursorProviderPieces["discoverModels"];
		};
		const lazy = sdkRequire("./dist/cursor-provider-lazy.js") as {
			streamCursorLazy: CursorProviderPieces["streamCursorLazy"];
		};
		const apiKey = sdkRequire("./dist/cursor-api-key.js") as {
			CURSOR_API_KEY_CONFIG_VALUE: string;
		};
		return {
			discoverModels: discovery.discoverModels,
			streamCursorLazy: lazy.streamCursorLazy,
			CURSOR_API_KEY_CONFIG_VALUE: apiKey.CURSOR_API_KEY_CONFIG_VALUE,
		};
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setCursorCatalogStatus({
			loaded: false,
			isolationAvailable: cursorSessionIsolationAvailable(),
			extensionPath: extPath,
			modelCount: 0,
			issues: [`Failed to load Cursor SDK modules: ${message}`],
		});
		return null;
	}
}

/**
 * Register the Cursor provider into a ModelRuntime (and refresh).
 * Intentionally does not run the full pi-cursor-sdk extension factory — the
 * GUI catalog does not need a live pi tool bridge, and avoiding the factory
 * keeps ModelRuntime from registering an unused bridge.
 */
export async function loadCursorProviderInto(runtime: ModelRuntime): Promise<void> {
	const extPath = cursorExtensionPath();
	const isolation = cursorSessionIsolationAvailable();

	// Other providers remain available when the Cursor patch is absent. Cursor
	// itself stays out of the catalog rather than silently running cross-wired.
	if (!isolation) {
		setCursorCatalogStatus({
			loaded: false,
			isolationAvailable: false,
			extensionPath: extPath,
			modelCount: 0,
			issues: [
				extPath
					? "Cursor unavailable: per-card isolation patch missing on pi-cursor-sdk. Reinstall desktop dependencies and restart Melon."
					: "Cursor unavailable: pi-cursor-sdk is not installed in this Melon build.",
			],
		});
		return;
	}

	const pieces = loadCursorProviderPieces();
	if (!pieces) {
		if (!cursorCatalogStatus.issues.length || cursorCatalogStatus.issues[0] === "Cursor catalog not loaded yet") {
			setCursorCatalogStatus({
				loaded: false,
				isolationAvailable: true,
				extensionPath: extPath,
				modelCount: 0,
				issues: ["Cursor SDK pieces failed to load (model-discovery / provider-lazy / api-key)."],
			});
		}
		return;
	}

	const issues: string[] = [];
	let models: unknown[] = [];
	try {
		models = await pieces.discoverModels({
			onFallback: (issue) => {
				issues.push(issue.message);
			},
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setCursorCatalogStatus({
			loaded: false,
			isolationAvailable: true,
			extensionPath: extPath,
			modelCount: 0,
			issues: [`Cursor model discovery threw: ${message}`],
		});
		return;
	}

	try {
		runtime.registerProvider(CURSOR_PROVIDER_ID, {
			name: "Cursor",
			baseUrl: "https://cursor.com",
			apiKey: pieces.CURSOR_API_KEY_CONFIG_VALUE,
			api: "cursor-sdk",
			models: models as never,
			streamSimple: pieces.streamCursorLazy as never,
		});
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		setCursorCatalogStatus({
			loaded: false,
			isolationAvailable: true,
			extensionPath: extPath,
			modelCount: 0,
			issues: [`Failed to register Cursor provider: ${message}`],
		});
		return;
	}

	try {
		await runtime.refresh({ allowNetwork: false });
	} catch (e) {
		issues.push(`Cursor provider refresh failed: ${e instanceof Error ? e.message : String(e)}`);
	}

	setCursorCatalogStatus({
		loaded: true,
		isolationAvailable: true,
		extensionPath: extPath,
		modelCount: models.length,
		issues,
	});
}

/**
 * Rewrite TUI-only instructions in Cursor extension errors into actions that
 * exist in Melon. The extension's copy references /login and
 * /cursor-refresh-models — slash commands the GUI does not have.
 */
export function rewriteCursorError(message: string): string {
	if (!/cursor/i.test(message)) return message;
	return message
		.replace(/\/login \(Use an API key -> Cursor\)/gi, "Melon's provider settings (Cursor → add key)")
		.replace(/\bso \/login and model selection/gi, "so Melon's provider settings and model selection")
		.replace(/run \/cursor-refresh-models to refresh/gi, "start a new chat card to refresh")
		.replace(/\/cursor-refresh-models/g, "a new chat card");
}

/**
 * True when a REAL Cursor SDK API key is available. The extension registers a
 * literal placeholder apiKey so the generic auth status reports "configured"
 * with no key present — this checks the actual sources instead.
 */
export function hasRealCursorKey(authEntries: Record<string, unknown>, melonKeys: Record<string, string>): boolean {
	if (process.env.CURSOR_API_KEY?.trim()) return true;
	const stored = authEntries[CURSOR_PROVIDER_ID] as { type?: string; key?: unknown } | undefined;
	if (stored?.type === "api_key" && typeof stored.key === "string" && stored.key.trim()) return true;
	return Boolean(melonKeys[CURSOR_PROVIDER_ID]?.trim());
}
