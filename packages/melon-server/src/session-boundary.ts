// Session boundary context (worktree isolation).
//
// A "session boundary" describes where the agent is allowed to act. The first
// instantiation is git worktree isolation: the session runs in a linked
// worktree of a parent repository, and the two classic LLM failure modes are
// (1) editing/running against the parent repo instead of the worktree, and
// (2) using parent-repo paths from context (handoff notes, user messages)
// verbatim. This module is the single source of truth for the boundary:
// detection, prompt rendering, path translation, and guard rules all read it.
//
// Consumers:
// - session-boundary-extension.ts renders the prompt block and enforces guards
// - tests pin detection and guard behavior (see test/session-boundary.test.ts)

import { execFile } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface SessionBoundary {
	/** The directory the session is rooted in (the worktree checkout). */
	sessionRoot: string;
	/** The main repository the worktree was created from. */
	mainRepoRoot: string;
	/** Branch checked out in the worktree, or null when detached. */
	branch: string | null;
}

/**
 * Detect a linked git worktree for `cwd`. Returns null when cwd is not inside
 * a git repo, or is the main working tree itself (no isolation to enforce).
 */
export async function detectSessionBoundary(cwd: string): Promise<SessionBoundary | null> {
	let stdout: string;
	try {
		const result = await execFileAsync(
			"git",
			[
				"-C",
				cwd,
				"rev-parse",
				"--absolute-git-dir",
				"--path-format=absolute",
				"--git-common-dir",
				"--abbrev-ref",
				"HEAD",
			],
			{ timeout: 5000 },
		);
		stdout = result.stdout;
	} catch {
		return null;
	}
	const [gitDir, commonDir, branchLine] = stdout.trim().split("\n");
	if (!gitDir || !commonDir) return null;
	// Linked worktrees have their git dir nested under <main>/.git/worktrees/.
	if (gitDir === commonDir) return null;
	const sessionRoot = realpathSync(resolve(cwd));
	const mainRepoRoot = dirname(commonDir);
	if (mainRepoRoot === sessionRoot) return null;
	const branch = branchLine && branchLine !== "HEAD" ? branchLine : null;
	return { sessionRoot, mainRepoRoot, branch };
}

/** Lexical containment: is `path` inside (or equal to) `root`? */
export function isInsideRoot(path: string, root: string): boolean {
	const rel = relative(root, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** Resolve a tool `path` argument (relative paths are session-cwd-relative). */
export function resolveToolPath(rawPath: string, cwd: string): string {
	return isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
}

/**
 * Map a parent-repo path to its worktree equivalent. Returns null when the
 * path is not under the main repo root.
 */
export function translateToSessionRoot(path: string, boundary: SessionBoundary): string | null {
	if (!isInsideRoot(path, boundary.mainRepoRoot)) return null;
	return resolve(boundary.sessionRoot, relative(boundary.mainRepoRoot, path));
}

/** Structured teaching error for file tools targeting outside the worktree. */
export function boundaryBlockReason(path: string, boundary: SessionBoundary): string {
	const translated = translateToSessionRoot(path, boundary);
	const branchPart = boundary.branch ? ` (branch ${boundary.branch})` : "";
	return [
		`PATH_OUTSIDE_SESSION_ROOT: ${path} is outside this session's worktree ${boundary.sessionRoot}${branchPart}.`,
		`The main repository (${boundary.mainRepoRoot}) must not be modified from this session.`,
		translated
			? `Apply the change to the same relative path inside the worktree: ${translated}`
			: `Apply the change inside the worktree root: ${boundary.sessionRoot}`,
	].join(" ");
}

/** Prose block rendered into the system prompt from the boundary context. */
export function renderBoundaryPrompt(boundary: SessionBoundary): string {
	const branchPart = boundary.branch ? ` (branch \`${boundary.branch}\`)` : "";
	return [
		"## Session boundary (worktree isolation)",
		`- This session runs in git worktree \`${boundary.sessionRoot}\`${branchPart}.`,
		`- Main repository: \`${boundary.mainRepoRoot}\`. Never create or modify files there, and never run git commands against it.`,
		"- All file changes and commands must stay inside the worktree. When context (handoff notes, user messages) references a path under the main repository, use the same relative path inside the worktree instead — the tools translate or block automatically.",
	].join("\n");
}

/**
 * Guard for a file-tool `path` argument. Returns an action:
 * - "allow" — path is inside the session root
 * - "translate" — path points into the main repo and the equivalent worktree
 *   file exists; the caller rewrites the tool input to `translated`
 * - "block" — outside the session root and not safely translatable
 */
export function fileToolGuard(
	rawPath: string,
	cwd: string,
	boundary: SessionBoundary,
): { action: "allow" } | { action: "translate"; translated: string } | { action: "block"; reason: string } {
	const abs = resolveToolPath(rawPath, cwd);
	if (isInsideRoot(abs, boundary.sessionRoot)) return { action: "allow" };
	const translated = translateToSessionRoot(abs, boundary);
	if (translated !== null && existsSync(translated)) return { action: "translate", translated };
	return { action: "block", reason: boundaryBlockReason(abs, boundary) };
}

/** Extract `cd` target tokens from a shell command (crude but sufficient). */
function cdTargets(command: string): string[] {
	const targets: string[] = [];
	const re = /(?:^|[;&|]|\bthen\b|\belif\b)\s*cd\s+("([^"]*)"|'([^']*)'|([^\s;&|]+))/g;
	for (const match of command.matchAll(re)) {
		targets.push(match[2] ?? match[3] ?? match[4] ?? "");
	}
	return targets;
}

/**
 * Block rule for bash: a `cd` into the main repository (outside the worktree)
 * would make every later command run against the parent repo. Returns the
 * teaching error to block with, or null when the command may proceed.
 */
export function bashBlockReason(command: string, cwd: string, boundary: SessionBoundary): string | null {
	for (const target of cdTargets(command)) {
		const abs = resolveToolPath(target, cwd);
		if (!isInsideRoot(abs, boundary.sessionRoot) && isInsideRoot(abs, boundary.mainRepoRoot)) {
			return boundaryBlockReason(abs, boundary);
		}
	}
	return null;
}

/**
 * Whether a bash command visibly references the main repository path. Such
 * commands still run, but the result is annotated (see bashBoundaryWarning)
 * so the model sees when it acted on the parent repo.
 */
export function bashReferencesMainRepo(command: string, boundary: SessionBoundary): boolean {
	return command.includes(boundary.mainRepoRoot);
}

/** One-line annotation appended to bash results that touched the parent repo. */
export function bashBoundaryWarning(boundary: SessionBoundary): string {
	const branchPart = boundary.branch ? ` (branch ${boundary.branch})` : "";
	return `[melon] This command referenced the main repository (${boundary.mainRepoRoot}). This session runs in git worktree ${boundary.sessionRoot}${branchPart} — changes made there do not land in the worktree.`;
}

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Resolve the boundary-guard extension entry for session runtimes. */
export function sessionBoundaryExtensionPath(): string | null {
	for (const candidate of [
		join(moduleDir, "session-boundary-extension.js"),
		join(moduleDir, "session-boundary-extension.ts"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
