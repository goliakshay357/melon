// Session boundary (worktree isolation) — detection, prompt rendering, and
// guard rules. Detection runs against real git repos built in tmpdirs.

import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	bashBlockReason,
	bashBoundaryWarning,
	bashReferencesMainRepo,
	boundaryBlockReason,
	detectSessionBoundary,
	fileToolGuard,
	isInsideRoot,
	renderBoundaryPrompt,
	translateToSessionRoot,
} from "../src/session-boundary.ts";

const execFileAsync = (cmd: string, args: string[], cwd: string) =>
	new Promise<string>((resolvePromise, rejectPromise) => {
		execFile(cmd, args, { cwd }, (error, stdout) => {
			if (error) rejectPromise(error);
			else resolvePromise(stdout.toString());
		});
	});

async function git(cwd: string, ...args: string[]): Promise<string> {
	return execFileAsync("git", args, cwd);
}

/** Main repo at <dir>/project with a linked worktree at <dir>/wt. */
async function makeWorktreeFixture(): Promise<{ project: string; wt: string }> {
	const dir = mkdtempSync(join(tmpdir(), "melon-boundary-"));
	const project = join(dir, "project");
	mkdirSync(project);
	await git(project, "init", "-b", "main");
	await git(project, "commit", "--allow-empty", "-m", "init");
	const wt = join(dir, "wt");
	await git(project, "worktree", "add", "-b", "card-17", wt);
	return { project, wt };
}

describe("detectSessionBoundary", () => {
	it("detects a linked worktree with main repo root and branch", async () => {
		const { project, wt } = await makeWorktreeFixture();
		const boundary = await detectSessionBoundary(wt);
		expect(boundary).not.toBeNull();
		expect(boundary?.sessionRoot).toBe(realpathSync(wt));
		expect(boundary?.mainRepoRoot).toBe(realpathSync(project));
		expect(boundary?.branch).toBe("card-17");
	});

	it("returns null for the main working tree", async () => {
		const { project } = await makeWorktreeFixture();
		expect(await detectSessionBoundary(project)).toBeNull();
	});

	it("returns null outside a git repo", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-boundary-nogit-"));
		expect(await detectSessionBoundary(dir)).toBeNull();
	});
});

describe("path guards", () => {
	const boundary = {
		sessionRoot: "/tmp/repo/.melon/worktrees/card-17",
		mainRepoRoot: "/tmp/repo",
		branch: "card-17",
	};

	it("isInsideRoot accepts the root itself and children, rejects outside", () => {
		expect(isInsideRoot(boundary.sessionRoot, boundary.sessionRoot)).toBe(true);
		expect(isInsideRoot(`${boundary.sessionRoot}/src/a.ts`, boundary.sessionRoot)).toBe(true);
		expect(isInsideRoot("/tmp/repo/src/a.ts", boundary.sessionRoot)).toBe(false);
		// The main repo is an ancestor of melon worktrees — still outside the root.
		expect(isInsideRoot(boundary.mainRepoRoot, boundary.sessionRoot)).toBe(false);
	});

	it("translateToSessionRoot maps parent paths to worktree equivalents", () => {
		expect(translateToSessionRoot("/tmp/repo/src/a.ts", boundary)).toBe(
			"/tmp/repo/.melon/worktrees/card-17/src/a.ts",
		);
		expect(translateToSessionRoot("/elsewhere/a.ts", boundary)).toBeNull();
	});

	it("fileToolGuard allows paths inside the session root", () => {
		const cwd = boundary.sessionRoot;
		expect(fileToolGuard("src/a.ts", cwd, boundary)).toEqual({ action: "allow" });
		expect(fileToolGuard(`${boundary.sessionRoot}/src/a.ts`, cwd, boundary)).toEqual({ action: "allow" });
	});

	it("fileToolGuard blocks parent-repo paths that have no worktree equivalent", () => {
		const cwd = boundary.sessionRoot;
		const result = fileToolGuard("/tmp/repo/nope/missing.ts", cwd, boundary);
		expect(result.action).toBe("block");
		if (result.action === "block") {
			expect(result.reason).toContain("PATH_OUTSIDE_SESSION_ROOT");
			expect(result.reason).toContain(boundary.sessionRoot);
		}
	});

	it("fileToolGuard blocks paths outside both the worktree and the main repo", () => {
		const cwd = boundary.sessionRoot;
		expect(fileToolGuard("/etc/passwd", cwd, boundary).action).toBe("block");
	});

	it("boundaryBlockReason suggests the translated worktree path", () => {
		const reason = boundaryBlockReason("/tmp/repo/src/a.ts", boundary);
		expect(reason).toContain("PATH_OUTSIDE_SESSION_ROOT");
		expect(reason).toContain(`${boundary.sessionRoot}/src/a.ts`);
	});
});

describe("bash guards", () => {
	const boundary = {
		sessionRoot: "/tmp/repo/.melon/worktrees/card-17",
		mainRepoRoot: "/tmp/repo",
		branch: "card-17",
	};
	const cwd = boundary.sessionRoot;

	it("blocks cd into the main repo", () => {
		const reason = bashBlockReason("cd /tmp/repo && npm test", cwd, boundary);
		expect(reason).toContain("PATH_OUTSIDE_SESSION_ROOT");
	});

	it("blocks cd into a main-repo subdirectory", () => {
		expect(bashBlockReason("cd /tmp/repo/packages/ai", cwd, boundary)).not.toBeNull();
	});

	it("allows cd inside the worktree and unrelated directories", () => {
		expect(bashBlockReason("cd /tmp/repo/.melon/worktrees/card-17/src", cwd, boundary)).toBeNull();
		expect(bashBlockReason("cd /home/user", cwd, boundary)).toBeNull();
		expect(bashBlockReason("npm test", cwd, boundary)).toBeNull();
	});

	it("allows cd with quoted paths into the main repo to be blocked too", () => {
		expect(bashBlockReason('cd "/tmp/repo" && git status', cwd, boundary)).not.toBeNull();
	});

	it("flags commands that reference the main repo path", () => {
		expect(bashReferencesMainRepo("git -C /tmp/repo log", boundary)).toBe(true);
		expect(bashReferencesMainRepo("npm test", boundary)).toBe(false);
		expect(bashBoundaryWarning(boundary)).toContain(boundary.mainRepoRoot);
	});
});

describe("renderBoundaryPrompt", () => {
	it("renders both roots and the branch", () => {
		const text = renderBoundaryPrompt({
			sessionRoot: "/w/wt",
			mainRepoRoot: "/w/main",
			branch: "card-17",
		});
		expect(text).toContain("Session boundary");
		expect(text).toContain("/w/wt");
		expect(text).toContain("/w/main");
		expect(text).toContain("card-17");
	});

	it("renders without a branch when detached", () => {
		const text = renderBoundaryPrompt({ sessionRoot: "/w/wt", mainRepoRoot: "/w/main", branch: null });
		expect(text).not.toContain("branch");
	});
});

describe("worktree-relative session cwd", () => {
	it("detects the boundary when the session cwd is nested inside the worktree", async () => {
		const { project, wt } = await makeWorktreeFixture();
		const nested = join(wt, "nested");
		mkdirSync(nested);
		writeFileSync(join(nested, "f.txt"), "x");
		const boundary = await detectSessionBoundary(nested);
		expect(boundary?.mainRepoRoot).toBe(realpathSync(project));
	});
});
