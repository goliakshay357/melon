import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectCanvasShare, parsePorcelain, shareCanvasWork } from "../src/canvas-share.ts";
import {
	createWorktreeForCanvas,
	generateBranchName,
	isInsideMelonWorktrees,
	isMelonWorktreePath,
	removeWorktree,
	worktreesDir,
} from "../src/worktree.ts";

const temps: string[] = [];

function tempGitRepo(): string {
	const dir = mkdtempSync(join(tmpdir(), "melon-wt-"));
	temps.push(dir);
	execFileSync("git", ["init", "-b", "main"], { cwd: dir });
	execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
	execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
	writeFileSync(join(dir, "README.md"), "# test\n");
	execFileSync("git", ["add", "."], { cwd: dir });
	execFileSync("git", ["commit", "-m", "init"], { cwd: dir });
	return dir;
}

afterEach(() => {
	for (const dir of temps.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	}
});

describe("melon worktree paths", () => {
	it("keeps worktrees under <project>/.melon/worktrees", () => {
		const root = "/Users/me/proj";
		expect(worktreesDir(root)).toBe(join(root, ".melon", "worktrees"));
		expect(isMelonWorktreePath(root, join(root, ".melon", "worktrees", "quiet-ridge"))).toBe(true);
		expect(isMelonWorktreePath(root, join(root, "other"))).toBe(false);
		expect(isMelonWorktreePath(root, root)).toBe(false);
		expect(isInsideMelonWorktrees(join(root, ".melon", "worktrees", "quiet-ridge"))).toBe(true);
		expect(isInsideMelonWorktrees(root)).toBe(false);
	});

	it("generates adjective-animal-hex branch names", () => {
		const name = generateBranchName();
		expect(name).toMatch(/^[a-z]+-[a-z]+-[0-9a-f]{6}$/);
	});
});

describe("createWorktreeForCanvas", () => {
	it("creates an isolated checkout under .melon/worktrees", async () => {
		const root = tempGitRepo();
		const result = await createWorktreeForCanvas(root);
		expect(result.success).toBe(true);
		expect(result.mode).toBe("isolated");
		expect(result.worktreePath).toContain(join(".melon", "worktrees"));
		expect(result.branch).toBeTruthy();
		expect(result.baseBranch).toBe("main");
		const removed = await removeWorktree(root, result.worktreePath);
		expect(removed.success).toBe(true);
	});

	it("reuses an existing canvas checkout instead of minting a second one", async () => {
		const root = tempGitRepo();
		const first = await createWorktreeForCanvas(root);
		const second = await createWorktreeForCanvas(root, {
			existing: {
				worktreePath: first.worktreePath,
				branch: first.branch,
				baseBranch: first.baseBranch,
			},
		});
		expect(second.mode).toBe("isolated");
		expect(second.worktreePath).toBe(first.worktreePath);
		expect(second.branch).toBe(first.branch);
		await removeWorktree(root, first.worktreePath);
	});

	it("reattaches a missing folder when the branch still exists", async () => {
		const root = tempGitRepo();
		const first = await createWorktreeForCanvas(root);
		rmSync(first.worktreePath, { recursive: true, force: true });
		const repaired = await createWorktreeForCanvas(root, {
			existing: {
				worktreePath: first.worktreePath,
				branch: first.branch,
				baseBranch: first.baseBranch,
			},
		});
		expect(repaired.mode).toBe("isolated");
		expect(repaired.branch).toBe(first.branch);
		expect(repaired.worktreePath).toBeTruthy();
		await removeWorktree(root, repaired.worktreePath);
	});

	it("falls back to Local when useWorktree is false", async () => {
		const root = tempGitRepo();
		const result = await createWorktreeForCanvas(root, { useWorktree: false });
		expect(result.success).toBe(true);
		expect(result.mode).toBe("local");
		expect(result.worktreePath).toBe(root);
	});

	it("falls back to Local for non-git folders", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-nongit-"));
		temps.push(dir);
		const result = await createWorktreeForCanvas(dir);
		expect(result.success).toBe(true);
		expect(result.mode).toBe("local");
		expect(result.worktreePath).toBe(dir);
	});

	it("does not nest a private copy inside an existing canvas checkout", async () => {
		const root = tempGitRepo();
		const isolated = await createWorktreeForCanvas(root);
		const nested = await createWorktreeForCanvas(isolated.worktreePath);
		expect(nested.mode).toBe("local");
		expect(nested.worktreePath).toBe(isolated.worktreePath);
		await removeWorktree(root, isolated.worktreePath);
	});
});

describe("canvas share", () => {
	it("parses git status lines into added/changed/removed", () => {
		expect(parsePorcelain(" M src/a.ts\nA  src/b.ts\n D src/c.ts\n?? src/d.ts\n")).toEqual([
			{ path: "src/a.ts", change: "changed" },
			{ path: "src/b.ts", change: "added" },
			{ path: "src/c.ts", change: "removed" },
			{ path: "src/d.ts", change: "added" },
		]);
	});

	it("refuses to send without explicit confirmation", async () => {
		const root = tempGitRepo();
		const wt = await createWorktreeForCanvas(root);
		const result = await shareCanvasWork(root, {
			confirm: false,
			title: "x",
			worktreePath: wt.worktreePath,
			branch: wt.branch!,
			baseBranch: wt.baseBranch!,
		});
		expect(result.ok).toBe(false);
		await removeWorktree(root, wt.worktreePath);
	});

	it("reports unsent files in the private copy", async () => {
		const root = tempGitRepo();
		const wt = await createWorktreeForCanvas(root);
		writeFileSync(join(wt.worktreePath, "note.txt"), "hello\n");
		const status = await inspectCanvasShare({
			projectRoot: root,
			mode: "isolated",
			worktreePath: wt.worktreePath,
			branch: wt.branch,
			baseBranch: wt.baseBranch,
		});
		expect(status.canShare).toBe(true);
		expect(status.files.some((f) => f.path === "note.txt")).toBe(true);
		await removeWorktree(root, wt.worktreePath);
	});

	it("commits confirmed share inside the canvas copy only", async () => {
		const root = tempGitRepo();
		const wt = await createWorktreeForCanvas(root);
		writeFileSync(join(wt.worktreePath, "note.txt"), "hello\n");
		mkdirSync(join(root, "keep-out"), { recursive: true });
		writeFileSync(join(root, "keep-out", "secret.txt"), "nope\n");
		const result = await shareCanvasWork(root, {
			confirm: true,
			title: "Share canvas",
			worktreePath: wt.worktreePath,
			branch: wt.branch!,
			baseBranch: wt.baseBranch!,
		});
		expect(result.committed).toBe(true);
		expect(result.published).toBe(false);
		const log = execFileSync("git", ["-C", wt.worktreePath, "log", "-1", "--pretty=%s"], { encoding: "utf8" });
		expect(log.trim()).toBe("Share canvas");
		expect(execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" })).toContain("keep-out");
		await removeWorktree(root, wt.worktreePath);
	});
});
