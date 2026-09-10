// Claude Code provider via the bundled @fractaal/pi-claude-bridge extension.
//
// Same Melon pattern as cursor-extension.ts:
// - GUI ModelRuntime never runs the session resource loader, so extension-
//   registered providers would be invisible to the pickers. This module
//   registers the claude-bridge catalog into such runtimes without loading the
//   full extension factory.
// - Session runtimes load the *isolated* entry via additionalExtensionPaths so
//   multi-card Melon processes do not share bridge session/tool state.
//
// Fail-open: if the package is absent (dev without desktop deps) or load
// fails, builtin providers are unaffected.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const moduleDir = dirname(fileURLToPath(import.meta.url));
function claudeBridgeResolvers() {
    const paths = [
        import.meta.url,
        // desktop/server/claude-bridge-extension.js → desktop/package.json
        join(moduleDir, "../package.json"),
        // packages/melon-server/{src,dist} → repo desktop/package.json
        join(moduleDir, "../../../desktop/package.json"),
    ];
    const out = [];
    for (const p of paths) {
        try {
            out.push(createRequire(p));
        }
        catch {
            /* skip invalid */
        }
    }
    return out;
}
export const CLAUDE_BRIDGE_PROVIDER_ID = "claude-bridge";
let claudeBridgeCatalogStatus = {
    loaded: false,
    isolationAvailable: false,
    extensionPath: null,
    isolatedEntryPath: null,
    modelCount: 0,
    issues: ["Claude bridge catalog not loaded yet"],
};
export function getClaudeBridgeCatalogStatus() {
    return { ...claudeBridgeCatalogStatus, issues: [...claudeBridgeCatalogStatus.issues] };
}
function setClaudeBridgeCatalogStatus(next) {
    claudeBridgeCatalogStatus = next;
    for (const issue of claudeBridgeCatalogStatus.issues) {
        console.warn("[melon] claude-bridge:", issue);
    }
}
/** Bundled @fractaal/pi-claude-bridge package dir, or null when not installed. */
export function claudeBridgeExtensionPath() {
    for (const req of claudeBridgeResolvers()) {
        try {
            // package.json is not in the package "exports" map — resolve an entry
            // and walk up from bundle/*.js to the package root.
            const entry = req.resolve("@fractaal/pi-claude-bridge");
            return dirname(dirname(entry));
        }
        catch {
            try {
                const isolated = req.resolve("@fractaal/pi-claude-bridge/isolated");
                return dirname(dirname(isolated));
            }
            catch {
                /* try next resolver */
            }
        }
    }
    return null;
}
/** Isolated Melon multi-card entry (bundle/isolated.js), or null. */
export function claudeBridgeIsolatedExtensionPath() {
    const extPath = claudeBridgeExtensionPath();
    if (!extPath)
        return null;
    const isolated = join(extPath, "bundle", "isolated.js");
    return existsSync(isolated) ? isolated : null;
}
/**
 * Claude bridge is safe in Melon's multi-card process only when the isolated
 * entry is present. Upstream's default package entry shares module state across
 * reloaded extension instances — do not use it for Melon sessions.
 */
export function claudeBridgeSessionIsolationAvailable() {
    return claudeBridgeIsolatedExtensionPath() !== null;
}
/** Catalog models registered into the GUI ModelRuntime (picker only). */
const CLAUDE_BRIDGE_CATALOG_MODELS = [
    {
        id: "claude-fable-5",
        name: "Claude Fable 5",
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-opus-5",
        name: "Claude Opus 5",
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-opus-4-8",
        name: "Claude Opus 4.8",
        reasoning: true,
        thinkingLevelMap: { xhigh: "xhigh", max: "max" },
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-opus-4-7",
        name: "Claude Opus 4.7",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-sonnet-5",
        name: "Claude Sonnet 5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_000_000,
        maxTokens: 128_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-haiku-4-5",
        name: "Claude Haiku 4.5",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200_000,
        maxTokens: 64_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
];
function catalogStreamUnavailable() {
    throw new Error("Claude Code turns run inside Melon chat cards (isolated bridge), not the shared model catalog runtime.");
}
/**
 * Register the Claude bridge provider into a ModelRuntime (and refresh).
 * Intentionally does not run the full extension factory — the GUI catalog only
 * needs model ids for the picker. Sessions load bundle/isolated.js instead.
 */
export async function loadClaudeBridgeProviderInto(runtime) {
    const extPath = claudeBridgeExtensionPath();
    const isolatedEntryPath = claudeBridgeIsolatedExtensionPath();
    const isolation = isolatedEntryPath !== null;
    if (!extPath) {
        setClaudeBridgeCatalogStatus({
            loaded: false,
            isolationAvailable: false,
            extensionPath: null,
            isolatedEntryPath: null,
            modelCount: 0,
            issues: ["Claude bridge unavailable: @fractaal/pi-claude-bridge is not installed in this Melon build."],
        });
        return;
    }
    if (!isolation) {
        setClaudeBridgeCatalogStatus({
            loaded: false,
            isolationAvailable: false,
            extensionPath: extPath,
            isolatedEntryPath: null,
            modelCount: 0,
            issues: [
                "Claude bridge unavailable: isolated entry (bundle/isolated.js) missing. Multi-card Melon requires the isolated bridge build.",
            ],
        });
        return;
    }
    const issues = [];
    try {
        runtime.registerProvider(CLAUDE_BRIDGE_PROVIDER_ID, {
            name: "Claude Code",
            baseUrl: "claude-bridge",
            apiKey: "not-used",
            api: "claude-bridge",
            models: CLAUDE_BRIDGE_CATALOG_MODELS,
            streamSimple: catalogStreamUnavailable,
        });
    }
    catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setClaudeBridgeCatalogStatus({
            loaded: false,
            isolationAvailable: true,
            extensionPath: extPath,
            isolatedEntryPath,
            modelCount: 0,
            issues: [`Failed to register Claude bridge provider: ${message}`],
        });
        return;
    }
    try {
        await runtime.refresh({ allowNetwork: false });
    }
    catch (e) {
        issues.push(`Claude bridge provider refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    setClaudeBridgeCatalogStatus({
        loaded: true,
        isolationAvailable: true,
        extensionPath: extPath,
        isolatedEntryPath,
        modelCount: CLAUDE_BRIDGE_CATALOG_MODELS.length,
        issues,
    });
}
/**
 * True when Melon has Claude subscription credentials usable for Claude Code.
 * Melon browser login stores OAuth under `claude-bridge` and/or `anthropic`;
 * applyClaudeBridgeRuntimeEnv exports the access token as CLAUDE_CODE_OAUTH_TOKEN.
 */
export function hasClaudeBridgeAuth(authEntries) {
    const bridge = authEntries[CLAUDE_BRIDGE_PROVIDER_ID];
    if (bridge?.type === "oauth" && typeof bridge.access === "string" && bridge.access.trim())
        return true;
    const anthropic = authEntries.anthropic;
    if (anthropic?.type === "oauth" && typeof anthropic.access === "string" && anthropic.access.trim())
        return true;
    return false;
}
//# sourceMappingURL=claude-bridge-extension.js.map