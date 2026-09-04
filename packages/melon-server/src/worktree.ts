/**
 * Canvas git worktree isolation (1code-style).
 *
 * Layout:
 *   <projectRoot>/.melon/canvases/<id>.json   — canvas identity (unchanged)
 *   <projectRoot>/.melon/worktrees/<name>/    — per-canvas checkout (agent cwd)
 *
 * One canvas → one worktree → one dedicated branch. Cards on a canvas share
 * that worktree. Non-git folders fall back to Local (agent cwd = projectRoot).
 */

import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ADJECTIVES = [
	"amber",
	"brave",
	"calm",
	"crisp",
	"dusty",
	"eager",
	"faint",
	"gentle",
	"golden",
	"hidden",
	"ivory",
	"jade",
	"keen",
	"lively",
	"misty",
	"noble",
	"quiet",
	"rapid",
	"silver",
	"sunny",
	"tidal",
	"vivid",
	"wild",
	"zen",
] as const;

const LANDSCAPES = [
	"brook",
	"canyon",
	"cliff",
	"creek",
	"delta",
	"dune",
	"fjord",
	"grove",
	"harbor",
	"hill",
	"lagoon",
	"meadow",
	"mesa",
	"orchard",
	"peak",
	"ridge",
	"river",
	"shore",
	"spring",
	"summit",
	"vale",
	"valley",
	"woods",
] as const;

const ANIMALS = [
	"badger",
	"crane",
	"eagle",
	"finch",
	"fox",
	"hare",
	"heron",
	"ibis",
	"lynx",
	"otter",
	"owl",
	"pine",
	"raven",
	"seal",
	"sparrow",
	"stag",
	"swift",
	"tern",
	"vole",
	"wolf",
] as const;

/** Per-projectRoot serialize so concurrent canvas creates don't fight git locks. */
const createQueues = new Map<string, Promise<unknown>>();

export function worktreesDir(projectRoot: string): string {
	return join(projectRoot, ".melon", "worktrees");
}

export function isMelonWorktreePath(projectRoot: string, path: string): boolean {
	const root = worktreesDir(projectRoot);
	return path === root || path.startsWith(`${root}/`);
}

function pick<T extends readonly string[]>(list: T): T[number] {
	return list[randomBytes(1)[0]! % list.length]!;
}

export function generateBranchName(): string {
	return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${randomBytes(3).toString("hex")}`;
}

export function generateWorktreeFolderName(parentDir: string): string {
	for (let attempt = 0; attempt < 10; attempt++) {
		const name = `${pick(ADJECTIVES)}-${pick(LANDSCAPES)}`;
		if (!existsSync(join(parentDir, name))) return name;
	}
	const base = `${pick(ADJECTIVES)}-${pick(LANDSCAPES)}`;
	for (let suffix = 2; suffix <= 999; suffix++) {
		const name = `${base}-${suffix}`;
		if (!existsSync(join(parentDir, name))) return name;
	}
	return `${base}-${Date.now().toString(36)}`;
}

async function git(cwd: string, args: string[], timeout = 60_000): Promise<string> {
	const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
		timeout,
		maxBuffer: 10 * 1024 * 1024,
	});
	return String(stdout).trim();
}

export async function isGitRepo(projectRoot: string): Promise<boolean> {
	try {
		const out = await git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
		return out === "true";
	} catch {
		return false;
	}
}

/** Resolve the repo's default branch (local or origin HEAD). */
export async function getDefaultBranch(projectRoot: string): Promise<string> {
	try {
		const ref = await git(projectRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
		const m = ref.match(/refs\/remotes\/origin\/(.+)$/);
		if (m?.[1]) return m[1];
	} catch {
		/* no origin/HEAD */
	}
	for (const candidate of ["main", "master"]) {
		try {
			await git(projectRoot, ["rev-parse", "--verify", candidate]);
			return candidate;
		} catch {
			/* try next */
		}
	}
	try {
		return await git(projectRoot, ["branch", "--show-current"]);
	} catch {
		return "main";
	}
}

async function resolveStartCommit(projectRoot: string, baseBranch: string): Promise<string> {
	for (const ref of [`origin/${baseBranch}`, baseBranch]) {
		try {
			return await git(projectRoot, ["rev-parse", `${ref}^{commit}`]);
		} catch {
			/* try next */
		}
	}
	return await git(projectRoot, ["rev-parse", "HEAD"]);
}

export interface WorktreeResult {
	success: boolean;
	/** Agent cwd: worktree path, or projectRoot when Local. */
	worktreePath: string;
	branch?: string;
	baseBranch?: string;
	/** isolated = real worktree; local = editing projectRoot directly */
	mode: "isolated" | "local";
	error?: string;
}

export interface CreateWorktreeOptions {
	baseBranch?: string;
	/** When false, skip worktree and use projectRoot (1code useWorktree=false). */
	useWorktree?: boolean;
}

async function createWorktreeInner(projectRoot: string, options: CreateWorktreeOptions = {}): Promise<WorktreeResult> {
	const useWorktree = options.useWorktree !== false;

	if (!useWorktree) {
		return { success: true, worktreePath: projectRoot, mode: "local" };
	}

	if (!(await isGitRepo(projectRoot))) {
		return { success: true, worktreePath: projectRoot, mode: "local" };
	}

	try {
		const baseBranch = options.baseBranch?.trim() || (await getDefaultBranch(projectRoot));
		const branch = generateBranchName();
		const parent = worktreesDir(projectRoot);
		mkdirSync(parent, { recursive: true });
		const folderName = generateWorktreeFolderName(parent);
		const worktreePath = join(parent, folderName);
		const commit = await resolveStartCommit(projectRoot, baseBranch);

		await git(projectRoot, ["worktree", "add", worktreePath, "-b", branch, commit], 120_000);

		return {
			success: true,
			worktreePath,
			branch,
			baseBranch,
			mode: "isolated",
		};
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		return {
			success: false,
			worktreePath: projectRoot,
			mode: "local",
			error: `Failed to create worktree: ${error}`,
		};
	}
}

/** Create a worktree for a canvas; serialized per projectRoot. */
export async function createWorktreeForCanvas(
	projectRoot: string,
	options: CreateWorktreeOptions = {},
): Promise<WorktreeResult> {
	const prev = createQueues.get(projectRoot) ?? Promise.resolve();
	let release!: () => void;
	const done = new Promise<void>((r) => {
		release = r;
	});
	const chained = prev.catch(() => {}).then(() => done);
	createQueues.set(projectRoot, chained);
	await prev.catch(() => {});
	try {
		return await createWorktreeInner(projectRoot, options);
	} finally {
		release();
		if (createQueues.get(projectRoot) === chained) createQueues.delete(projectRoot);
	}
}

export async function removeWorktree(
	projectRoot: string,
	worktreePath: string,
): Promise<{ success: boolean; error?: string }> {
	if (!worktreePath || worktreePath === projectRoot) {
		return { success: true };
	}
	if (!isMelonWorktreePath(projectRoot, worktreePath)) {
		return {
			success: false,
			error: "refusing to remove path outside <project>/.melon/worktrees/",
		};
	}
	try {
		await git(projectRoot, ["worktree", "remove", worktreePath, "--force"], 60_000);
		return { success: true };
	} catch (e) {
		const error = e instanceof Error ? e.message : String(e);
		// Stale registration — prune and drop the directory if present.
		try {
			await git(projectRoot, ["worktree", "prune"]);
		} catch {
			/* ignore */
		}
		return { success: false, error };
	}
}

/** List registered melon worktree paths under projectRoot (for diagnostics). */
export function listMelonWorktreeDirs(projectRoot: string): string[] {
	const dir = worktreesDir(projectRoot);
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((d) => d.isDirectory())
			.map((d) => join(dir, d.name));
	} catch {
		return [];
	}
}
