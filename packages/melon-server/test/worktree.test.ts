import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	createWorktreeForCanvas,
	generateBranchName,
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
});
