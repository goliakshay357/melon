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
import {
	CLAUDE_BRIDGE_PROVIDER_ID,
	claudeBridgeExtensionPath,
	claudeBridgeSessionIsolationAvailable,
	hasClaudeBridgeAuth,
} from "./claude-bridge-extension.ts";

/** Agent SDK / Claude Code reads this for subscription OAuth (Melon browser login). */
export const CLAUDE_CODE_OAUTH_TOKEN_ENV = "CLAUDE_CODE_OAUTH_TOKEN";

export type ClaudeBridgeRuntimeStatus = {
	isolationAvailable: boolean;
	executableFound: boolean;
	executablePath: string | null;
	oauthTokenPresent: boolean;
	/** True when Melon can attempt a Claude Code turn (isolation + binary + Melon OAuth). */
	ready: boolean;
	issues: string[];
};

type ResolveClaudeCodeExecutable = (opts?: {
	configuredPath?: string;
	env?: NodeJS.ProcessEnv;
	platform?: NodeJS.Platform;
}) => { command: string; executablePath: string } | null;

const EXTRA_PATH_DIRS = [
	join(homedir(), ".local", "bin"),
	"/opt/homebrew/bin",
	"/opt/homebrew/sbin",
	"/usr/local/bin",
	"/usr/bin",
	"/bin",
];

function pathDelimiter(): string {
	return pathDelim;
}

/** Directories Melon prepends so GUI-launched servers still find Claude Code. */
export function claudeBridgeExtraPathDirs(): string[] {
	return EXTRA_PATH_DIRS.filter((dir) => {
		try {
			return existsSync(dir);
		} catch {
			return false;
		}
	});
}

/**
 * Ensure common Claude install locations are on PATH (idempotent).
 * Appends missing dirs so an explicit PATH (tests / user overrides) still wins.
 * Electron `desktop/main.mjs` also prepends ~/.local/bin for GUI-thin PATH.
 */
export function augmentPathForClaudeCode(env: NodeJS.ProcessEnv = process.env): string {
	const delim = pathDelimiter();
	const existing = (env.PATH ?? "").split(delim).filter(Boolean);
	const seen = new Set(existing);
	const suffix: string[] = [];
	for (const dir of claudeBridgeExtraPathDirs()) {
		if (seen.has(dir)) continue;
		seen.add(dir);
		suffix.push(dir);
	}
	const next = [...existing, ...suffix].join(delim);
	env.PATH = next;
	return next;
}

function loadResolveClaudeCodeExecutable(): ResolveClaudeCodeExecutable | null {
	const extPath = claudeBridgeExtensionPath();
	if (!extPath) return null;
	try {
		const req = createRequire(join(extPath, "package.json"));
		const mod = req("./dist/executable-resolution.js") as {
			resolveClaudeCodeExecutable: ResolveClaudeCodeExecutable;
		};
		return mod.resolveClaudeCodeExecutable;
	} catch {
		return null;
	}
}

/** Resolve the Claude Code binary Melon will spawn (after PATH augmentation). */
export function resolveMelonClaudeCodeExecutable(
	env: NodeJS.ProcessEnv = process.env,
	configuredPath?: string,
): string | null {
	augmentPathForClaudeCode(env);
	const resolve = loadResolveClaudeCodeExecutable();
	if (!resolve) {
		// Package missing — still try a minimal PATH search for status reporting.
		const delim = pathDelimiter();
		for (const command of ["claude", "claude-code"] as const) {
			for (const directory of (env.PATH ?? "").split(delim).filter(Boolean)) {
				const candidate = join(directory, command);
				try {
					if (existsSync(candidate)) return candidate;
				} catch {
					/* keep looking */
				}
			}
		}
		return null;
	}
	try {
		return resolve({ configuredPath, env })?.executablePath ?? null;
	} catch {
		return null;
	}
}

function readAuthEntries(): Record<string, unknown> {
	try {
		const authPath = join(getAgentDir(), "auth.json");
		return JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Access token from Melon claude-bridge or anthropic OAuth (browser login). */
export function readClaudeBridgeAccessToken(): string | null {
	const auth = readAuthEntries();
	for (const id of [CLAUDE_BRIDGE_PROVIDER_ID, "anthropic"] as const) {
		const entry = auth[id] as { type?: string; access?: unknown } | undefined;
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
export function applyClaudeBridgeRuntimeEnv(env: NodeJS.ProcessEnv = process.env): ClaudeBridgeRuntimeStatus {
	augmentPathForClaudeCode(env);

	const isolationAvailable = claudeBridgeSessionIsolationAvailable();
	const executablePath = resolveMelonClaudeCodeExecutable(env);
	const token = readClaudeBridgeAccessToken();
	const oauthTokenPresent = Boolean(token);
	if (token) {
		env[CLAUDE_CODE_OAUTH_TOKEN_ENV] = token;
	} else {
		delete env[CLAUDE_CODE_OAUTH_TOKEN_ENV];
	}

	const issues: string[] = [];
	if (!isolationAvailable) {
		issues.push(
			"Claude Code isolation entry missing (@fractaal/pi-claude-bridge bundle/isolated.js). Reinstall desktop dependencies.",
		);
	}
	if (!executablePath) {
		issues.push(
			"Claude Code executable not found on PATH. Install Claude Code or add it to PATH (e.g. ~/.local/bin).",
		);
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
export function getClaudeBridgeRuntimeStatus(env: NodeJS.ProcessEnv = process.env): ClaudeBridgeRuntimeStatus {
	const probe: NodeJS.ProcessEnv = { ...env, PATH: env.PATH };
	return applyClaudeBridgeRuntimeEnv(probe);
}

/**
 * Hard-fail before attaching or prompting a Claude card when local preflight fails.
 * Does not validate the token with Anthropic (subscription may be inactive).
 */
export function requireClaudeBridgeRuntimeReady(env: NodeJS.ProcessEnv = process.env): ClaudeBridgeRuntimeStatus {
	const status = applyClaudeBridgeRuntimeEnv(env);
	if (status.ready) return status;
	const detail = status.issues[0] ?? "Claude Code is not ready.";
	throw Object.assign(new Error(detail), { statusCode: 503, claudeBridgeRuntime: status });
}

/** True when Melon auth.json has Claude OAuth (same as picker configured). */
export function melonHasClaudeBridgeOAuth(): boolean {
	return hasClaudeBridgeAuth(readAuthEntries());
}

/** Absolute dir of the resolved Claude binary's parent, if any (for diagnostics). */
export function claudeBridgeExecutableDir(env: NodeJS.ProcessEnv = process.env): string | null {
	const path = resolveMelonClaudeCodeExecutable(env);
	return path ? dirname(path) : null;
}
