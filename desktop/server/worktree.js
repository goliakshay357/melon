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
import { existsSync, mkdirSync, readdirSync, realpathSync } from "node:fs";
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
];
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
];
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
];
/** Per-projectRoot serialize so concurrent canvas creates don't fight git locks. */
const createQueues = new Map();
export function worktreesDir(projectRoot) {
    return join(projectRoot, ".melon", "worktrees");
}
function posixish(p) {
    return p.replace(/\\/g, "/");
}
function tryRealpath(p) {
    try {
        return realpathSync(p);
    }
    catch {
        return p;
    }
}
/** True when `dir` is itself a Melon canvas checkout (opening it as a project would nest). */
export function isInsideMelonWorktrees(dir) {
    return posixish(dir).includes("/.melon/worktrees/");
}
export function isMelonWorktreePath(projectRoot, path) {
    const root = tryRealpath(worktreesDir(projectRoot));
    const target = tryRealpath(path);
    const rootN = posixish(root);
    const targetN = posixish(target);
    return targetN === rootN || targetN.startsWith(`${rootN}/`);
}
function pick(list) {
    return list[randomBytes(1)[0] % list.length];
}
export function generateBranchName() {
    return `${pick(ADJECTIVES)}-${pick(ANIMALS)}-${randomBytes(3).toString("hex")}`;
}
export function generateWorktreeFolderName(parentDir) {
    for (let attempt = 0; attempt < 10; attempt++) {
        const name = `${pick(ADJECTIVES)}-${pick(LANDSCAPES)}`;
        if (!existsSync(join(parentDir, name)))
            return name;
    }
    const base = `${pick(ADJECTIVES)}-${pick(LANDSCAPES)}`;
    for (let suffix = 2; suffix <= 999; suffix++) {
        const name = `${base}-${suffix}`;
        if (!existsSync(join(parentDir, name)))
            return name;
    }
    return `${base}-${Date.now().toString(36)}`;
}
export async function gitIn(cwd, args, timeout = 60_000) {
    const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
    });
    return String(stdout).trim();
}
async function git(cwd, args, timeout = 60_000) {
    return gitIn(cwd, args, timeout);
}
/** Serialize mutating git ops for one project so canvases don't fight locks. */
export async function withProjectGitLock(projectRoot, fn) {
    const prev = createQueues.get(projectRoot) ?? Promise.resolve();
    let release;
    const done = new Promise((r) => {
        release = r;
    });
    const chained = prev.catch(() => { }).then(() => done);
    createQueues.set(projectRoot, chained);
    await prev.catch(() => { });
    try {
        return await fn();
    }
    finally {
        release();
        if (createQueues.get(projectRoot) === chained)
            createQueues.delete(projectRoot);
    }
}
export async function isGitRepo(projectRoot) {
    try {
        const out = await git(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
        return out === "true";
    }
    catch {
        return false;
    }
}
/** Resolve the repo's default branch (local or origin HEAD). */
export async function getDefaultBranch(projectRoot) {
    try {
        const ref = await git(projectRoot, ["symbolic-ref", "refs/remotes/origin/HEAD"]);
        const m = ref.match(/refs\/remotes\/origin\/(.+)$/);
        if (m?.[1])
            return m[1];
    }
    catch {
        /* no origin/HEAD */
    }
    for (const candidate of ["main", "master"]) {
        try {
            await git(projectRoot, ["rev-parse", "--verify", candidate]);
            return candidate;
        }
        catch {
            /* try next */
        }
    }
    try {
        return await git(projectRoot, ["branch", "--show-current"]);
    }
    catch {
        return "main";
    }
}
async function resolveStartCommit(projectRoot, baseBranch) {
    for (const ref of [`origin/${baseBranch}`, baseBranch]) {
        try {
            return await git(projectRoot, ["rev-parse", `${ref}^{commit}`]);
        }
        catch {
            /* try next */
        }
    }
    return await git(projectRoot, ["rev-parse", "HEAD"]);
}
async function pathIsUsableCheckout(projectRoot, worktreePath, branch) {
    if (!existsSync(worktreePath))
        return false;
    if (!isMelonWorktreePath(projectRoot, worktreePath))
        return false;
    try {
        const inside = await git(worktreePath, ["rev-parse", "--is-inside-work-tree"]);
        if (inside !== "true")
            return false;
        if (!branch)
            return true;
        const current = await git(worktreePath, ["branch", "--show-current"]);
        return !current || current === branch;
    }
    catch {
        return false;
    }
}
async function branchExists(projectRoot, branch) {
    try {
        await git(projectRoot, ["rev-parse", "--verify", `refs/heads/${branch}`]);
        return true;
    }
    catch {
        return false;
    }
}
async function createWorktreeInner(projectRoot, options = {}) {
    const useWorktree = options.useWorktree !== false;
    if (!useWorktree) {
        return { success: true, worktreePath: projectRoot, mode: "local" };
    }
    if (isInsideMelonWorktrees(projectRoot)) {
        return {
            success: true,
            worktreePath: projectRoot,
            mode: "local",
            error: "This folder is already a canvas copy. Editing it directly.",
        };
    }
    if (!(await isGitRepo(projectRoot))) {
        return { success: true, worktreePath: projectRoot, mode: "local" };
    }
    const existing = options.existing;
    const existingPath = existing?.worktreePath?.trim() || "";
    const existingBranch = existing?.branch?.trim() || "";
    if (existingPath && (await pathIsUsableCheckout(projectRoot, existingPath, existingBranch || null))) {
        let branch = existingBranch || undefined;
        let baseBranch = existing?.baseBranch?.trim() || undefined;
        try {
            if (!branch)
                branch = await git(existingPath, ["branch", "--show-current"]);
        }
        catch {
            /* keep stored */
        }
        if (!baseBranch)
            baseBranch = await getDefaultBranch(projectRoot);
        return {
            success: true,
            worktreePath: existingPath,
            branch,
            baseBranch,
            mode: "isolated",
        };
    }
    try {
        const baseBranch = existing?.baseBranch?.trim() || options.baseBranch?.trim() || (await getDefaultBranch(projectRoot));
        const parent = worktreesDir(projectRoot);
        mkdirSync(parent, { recursive: true });
        if (existingBranch && (await branchExists(projectRoot, existingBranch))) {
            try {
                await git(projectRoot, ["worktree", "prune"]);
            }
            catch {
                /* ignore */
            }
            const worktreePath = existingPath && isMelonWorktreePath(projectRoot, existingPath) && !existsSync(existingPath)
                ? existingPath
                : join(parent, generateWorktreeFolderName(parent));
            await git(projectRoot, ["worktree", "add", worktreePath, existingBranch], 120_000);
            return {
                success: true,
                worktreePath,
                branch: existingBranch,
                baseBranch,
                mode: "isolated",
            };
        }
        const branch = generateBranchName();
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
    }
    catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        return {
            success: false,
            worktreePath: projectRoot,
            mode: "local",
            error: `Failed to create worktree: ${error}`,
        };
    }
}
/** Create or repair a worktree for a canvas; serialized per projectRoot. */
export async function createWorktreeForCanvas(projectRoot, options = {}) {
    return withProjectGitLock(projectRoot, () => createWorktreeInner(projectRoot, options));
}
export async function ensureWorktreeForCanvas(projectRoot, options = {}) {
    return createWorktreeForCanvas(projectRoot, options);
}
export async function removeWorktree(projectRoot, worktreePath) {
    if (!worktreePath || worktreePath === projectRoot) {
        return { success: true };
    }
    if (!isMelonWorktreePath(projectRoot, worktreePath)) {
        return {
            success: false,
            error: "refusing to remove path outside <project>/.melon/worktrees/",
        };
    }
    return withProjectGitLock(projectRoot, async () => {
        try {
            await git(projectRoot, ["worktree", "remove", worktreePath, "--force"], 60_000);
            return { success: true };
        }
        catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            try {
                await git(projectRoot, ["worktree", "prune"]);
            }
            catch {
                /* ignore */
            }
            return { success: false, error };
        }
    });
}
/** List registered melon worktree paths under projectRoot (for diagnostics). */
export function listMelonWorktreeDirs(projectRoot) {
    const dir = worktreesDir(projectRoot);
    try {
        return readdirSync(dir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(dir, d.name));
    }
    catch {
        return [];
    }
}
//# sourceMappingURL=worktree.js.map