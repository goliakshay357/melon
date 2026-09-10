// Melon-side Claude Code runtime wiring for live turns.
//
// @fractaal/pi-claude-bridge spawns the Claude Code CLI via the Agent SDK.
// Melon must ensure:
//   1. PATH can find `claude` / `claude-code` (GUI Electron often has a thin PATH).
//   2. Melon Anthropic / claude-bridge OAuth is exported as CLAUDE_CODE_OAUTH_TOKEN
//      so Claude Code uses Melon's browser login instead of a separate CLI login.
//   3. Callers can ask whether a turn is ready without hitting Anthropic.
//
// This module does not contact Anthropic; readiness is local preflight only.
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, delimiter as pathDelim } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { CLAUDE_BRIDGE_PROVIDER_ID, claudeBridgeExtensionPath, claudeBridgeSessionIsolationAvailable, hasClaudeBridgeAuth, } from "./claude-bridge-extension.js";
/** Agent SDK / Claude Code reads this for subscription OAuth (Melon browser login). */
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";
const EXTRA_PATH_DIRS = [
    join(homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
];
function pathDelimiter() {
    return pathDelim;
}
/** Directories Melon prepends so GUI-launched servers still find Claude Code. */
export function claudeBridgeExtraPathDirs() {
    return EXTRA_PATH_DIRS.filter((dir) => {
        try {
            return existsSync(dir);
        }
        catch {
            return false;
        }
    });
}
/**
 * Ensure common Claude install locations are on PATH (idempotent).
 * Appends missing dirs so an explicit PATH (tests / user overrides) still wins.
 * Electron `desktop/main.mjs` also prepends ~/.local/bin for GUI-thin PATH.
 */
export function augmentPathForClaudeCode(env = process.env) {
    const delim = pathDelimiter();
    const existing = (env.PATH ?? "").split(delim).filter(Boolean);
    const seen = new Set(existing);
    const suffix = [];
    for (const dir of claudeBridgeExtraPathDirs()) {
        if (seen.has(dir))
            continue;
        seen.add(dir);
        suffix.push(dir);
    }
    const next = [...existing, ...suffix].join(delim);
    env.PATH = next;
    return next;
}
function loadResolveClaudeCodeExecutable() {
    const extPath = claudeBridgeExtensionPath();
    if (!extPath)
        return null;
    try {
        const req = createRequire(join(extPath, "package.json"));
        const mod = req("./dist/executable-resolution.js");
        return mod.resolveClaudeCodeExecutable;
    }
    catch {
        return null;
    }
}
/** Resolve the Claude Code binary Melon will spawn (after PATH augmentation). */
export function resolveMelonClaudeCodeExecutable(env = process.env, configuredPath) {
    augmentPathForClaudeCode(env);
    const resolve = loadResolveClaudeCodeExecutable();
    if (!resolve) {
        // Package missing — still try a minimal PATH search for status reporting.
        const delim = pathDelimiter();
        for (const command of ["claude", "claude-code"]) {
            for (const directory of (env.PATH ?? "").split(delim).filter(Boolean)) {
                const candidate = join(directory, command);
                try {
                    if (existsSync(candidate))
                        return candidate;
                }
                catch {
                    /* keep looking */
                }
            }
        }
        return null;
    }
    try {
        return resolve({ configuredPath, env })?.executablePath ?? null;
    }
    catch {
        return null;
    }
}
function readAuthEntries() {
    try {
        const authPath = join(getAgentDir(), "auth.json");
        return JSON.parse(readFileSync(authPath, "utf8"));
    }
    catch {
        return {};
    }
}
/** Access token from Melon claude-bridge or anthropic OAuth (browser login). */
export function readClaudeBridgeAccessToken() {
    const auth = readAuthEntries();
    for (const id of [CLAUDE_BRIDGE_PROVIDER_ID, "anthropic"]) {
        const entry = auth[id];
        if (entry?.type === "oauth" && typeof entry.access === "string" && entry.access.trim()) {
            return entry.access.trim();
        }
    }
    return null;
}
/**
 * Apply Melon PATH + OAuth into `env` so Claude Agent SDK / Claude Code can run.
 * Safe to call repeatedly (e.g. before each Claude prompt after token refresh).
 */
export function applyClaudeBridgeRuntimeEnv(env = process.env) {
    augmentPathForClaudeCode(env);
    const isolationAvailable = claudeBridgeSessionIsolationAvailable();
    const executablePath = resolveMelonClaudeCodeExecutable(env);
    const token = readClaudeBridgeAccessToken();
    const oauthTokenPresent = Boolean(token);
    if (token) {
        env[CLAUDE_CODE_OAUTH_TOKEN_ENV] = token;
    }
    else {
        delete env[CLAUDE_CODE_OAUTH_TOKEN_ENV];
    }
    const issues = [];
    if (!isolationAvailable) {
        issues.push("Claude Code isolation entry missing (@fractaal/pi-claude-bridge bundle/isolated.js). Reinstall desktop dependencies.");
    }
    if (!executablePath) {
        issues.push("Claude Code executable not found on PATH. Install Claude Code or add it to PATH (e.g. ~/.local/bin).");
    }
    if (!oauthTokenPresent) {
        issues.push("Claude subscription login missing. Use Log in with Claude in Melon's provider picker.");
    }
    return {
        isolationAvailable,
        executableFound: executablePath !== null,
        executablePath,
        oauthTokenPresent,
        ready: isolationAvailable && executablePath !== null && oauthTokenPresent,
        issues,
    };
}
/** Snapshot readiness without mutating env (still may augment PATH for the probe). */
export function getClaudeBridgeRuntimeStatus(env = process.env) {
    const probe = { ...env, PATH: env.PATH };
    return applyClaudeBridgeRuntimeEnv(probe);
}
/**
 * Hard-fail before attaching or prompting a Claude card when local preflight fails.
 * Does not validate the token with Anthropic (subscription may be inactive).
 */
export function requireClaudeBridgeRuntimeReady(env = process.env) {
    const status = applyClaudeBridgeRuntimeEnv(env);
    if (status.ready)
        return status;
    const detail = status.issues[0] ?? "Claude Code is not ready.";
    throw Object.assign(new Error(detail), { statusCode: 503, claudeBridgeRuntime: status });
}
/** True when Melon auth.json has Claude OAuth (same as picker configured). */
export function melonHasClaudeBridgeOAuth() {
    return hasClaudeBridgeAuth(readAuthEntries());
}
/** Absolute dir of the resolved Claude binary's parent, if any (for diagnostics). */
export function claudeBridgeExecutableDir(env = process.env) {
    const path = resolveMelonClaudeCodeExecutable(env);
    return path ? dirname(path) : null;
}
//# sourceMappingURL=claude-bridge-runtime.js.map