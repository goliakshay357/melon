var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
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
import { createJiti } from "jiti/static";
const moduleDir = dirname(fileURLToPath(import.meta.url));
function antigravityResolvers() {
    const paths = [
        import.meta.url,
        join(moduleDir, "../package.json"),
        join(moduleDir, "../../../desktop/package.json"),
    ];
    const out = [];
    for (const p of paths) {
        try {
            out.push(createRequire(p));
        }
        catch {
            /* skip */
        }
    }
    return out;
}
export const ANTIGRAVITY_PROVIDER_ID = "antigravity";
export const ANTIGRAVITY_PROVIDER_NAME = "Antigravity";
let antigravityCatalogStatus = {
    loaded: false,
    isolationAvailable: false,
    extensionPath: null,
    extensionEntryPath: null,
    modelCount: 0,
    issues: ["Antigravity catalog not loaded yet"],
};
export function getAntigravityCatalogStatus() {
    return { ...antigravityCatalogStatus, issues: [...antigravityCatalogStatus.issues] };
}
function setAntigravityCatalogStatus(next) {
    antigravityCatalogStatus = next;
    for (const issue of antigravityCatalogStatus.issues) {
        console.warn("[melon] antigravity:", issue);
    }
}
/** Bundled `pi-antigravity` package dir, or null when not installed. */
export function antigravityExtensionPath() {
    for (const req of antigravityResolvers()) {
        try {
            const pkgJson = req.resolve("pi-antigravity/package.json");
            return dirname(pkgJson);
        }
        catch {
            try {
                const entry = req.resolve("pi-antigravity");
                // main is src/index.ts → package root is dirname(dirname(entry)) when entry is .../src/index.ts
                const dir = dirname(entry);
                if (existsSync(join(dir, "package.json")))
                    return dir;
                const parent = dirname(dir);
                if (existsSync(join(parent, "package.json")))
                    return parent;
            }
            catch {
                /* try next */
            }
        }
    }
    return null;
}
/** Extension entry Melon loads into session runtimes (`pi.extensions`). */
export function antigravityExtensionEntryPath() {
    const root = antigravityExtensionPath();
    if (!root)
        return null;
    const candidates = [join(root, "src", "index.ts"), join(root, "src", "index.js"), join(root, "index.js")];
    for (const p of candidates) {
        if (existsSync(p))
            return p;
    }
    return null;
}
/**
 * Melon multi-card sessions require the bundled extension entry. Unlike Claude
 * Code, Antigravity has no separate isolated bundle — Melon owns card isolation.
 */
export function antigravitySessionIsolationAvailable() {
    return antigravityExtensionEntryPath() !== null;
}
/** Conservative static catalog (picker). Live refresh happens inside the session extension. */
const ANTIGRAVITY_CATALOG_MODELS = [
    {
        id: "gemini-3.8-flash",
        name: "Gemini 3.8 Flash (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "gemini-3.7-flash",
        name: "Gemini 3.7 Flash (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "gemini-3.6-flash",
        name: "Gemini 3.6 Flash (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "gemini-3.5-flash",
        name: "Gemini 3.5 Flash (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_048_576,
        maxTokens: 65_536,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "gemini-3.1-pro",
        name: "Gemini 3.1 Pro (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 1_048_576,
        maxTokens: 65_535,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-sonnet-4-6",
        name: "Claude Sonnet 4.6 (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 200_000,
        maxTokens: 64_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6 (Antigravity)",
        reasoning: true,
        input: ["text", "image"],
        contextWindow: 250_000,
        maxTokens: 64_000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
    {
        id: "gpt-oss-120b",
        name: "GPT-OSS 120B (Antigravity)",
        reasoning: true,
        input: ["text"],
        contextWindow: 128_000,
        maxTokens: 32_768,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
];
function catalogStreamUnavailable() {
    throw new Error("Antigravity turns run inside Melon chat cards (bundled extension), not the shared model catalog runtime.");
}
let oauthModulePromise = null;
/**
 * Load OAuth helpers from the bundled package.
 *
 * `pi-antigravity` ships TypeScript under `node_modules`. Node's native type
 * stripping refuses that path ("Stripping types is currently unsupported for
 * files under node_modules"), which left Melon with "Unknown provider:
 * antigravity" on login. Load `.ts` via jiti — same approach as pi's extension
 * loader. Prefer a `.js` build if one exists.
 */
export function loadAntigravityOAuthModule() {
    if (!oauthModulePromise) {
        oauthModulePromise = (async () => {
            try {
                const root = antigravityExtensionPath();
                if (!root) {
                    throw new Error("Antigravity unavailable: pi-antigravity is not installed in this Melon build.");
                }
                const oauthTs = join(root, "src", "auth", "oauth.ts");
                const oauthJs = join(root, "src", "auth", "oauth.js");
                const path = existsSync(oauthJs) ? oauthJs : existsSync(oauthTs) ? oauthTs : null;
                if (!path) {
                    throw new Error("Antigravity package is missing src/auth/oauth.(js|ts).");
                }
                let mod;
                if (path.endsWith(".ts")) {
                    const jiti = createJiti(import.meta.url, { moduleCache: false });
                    mod = (await jiti.import(path));
                }
                else {
                    mod = (await import(__rewriteRelativeImportExtension(pathToFileURL(path).href)));
                }
                if (typeof mod.loginAntigravity !== "function" || typeof mod.getApiKey !== "function") {
                    throw new Error("Antigravity package is missing OAuth login helpers.");
                }
                return mod;
            }
            catch (error) {
                // Allow a later retry after install/rebuild; do not cache a rejection forever.
                oauthModulePromise = null;
                throw error;
            }
        })();
    }
    return oauthModulePromise;
}
/**
 * Register Antigravity into a ModelRuntime (picker + Melon browser login).
 * Sessions still load the full extension factory via additionalExtensionPaths.
 */
export async function loadAntigravityProviderInto(runtime) {
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
    const issues = [];
    let oauth;
    try {
        oauth = await loadAntigravityOAuthModule();
    }
    catch (e) {
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
            api: "antigravity-api",
            models: ANTIGRAVITY_CATALOG_MODELS,
            oauth: {
                name: ANTIGRAVITY_PROVIDER_NAME,
                isSubscription: true,
                login: (callbacks) => oauth.loginAntigravity(callbacks),
                refreshToken: (credentials, signal) => oauth.refreshAntigravityToken(credentials, signal),
                getApiKey: (credentials) => oauth.getApiKey(credentials),
            },
            streamSimple: catalogStreamUnavailable,
        });
    }
    catch (e) {
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
    }
    catch (e) {
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
export function hasAntigravityAuth(authEntries) {
    const entry = authEntries[ANTIGRAVITY_PROVIDER_ID];
    return entry?.type === "oauth" && typeof entry.access === "string" && entry.access.trim().length > 0;
}
//# sourceMappingURL=antigravity-extension.js.map