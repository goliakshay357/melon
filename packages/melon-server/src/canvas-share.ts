/**
 * Guided "send for review" for an isolated canvas copy.
 *
 * Product: one canvas → one checkout. Sharing commits that checkout,
 * pushes its branch, and opens a review request. Callers must require
 * an explicit confirm flag before invoking shareCanvasWork.
 */

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { gitIn, isMelonWorktreePath, withProjectGitLock } from "./worktree.ts";

const execFileAsync = promisify(execFile);

export type ShareFileChange = "added" | "changed" | "removed";

export interface ShareFile {
	path: string;
	change: ShareFileChange;
}

export interface CanvasShareStatus {
	mode: "isolated" | "local";
	worktreePath: string;
	branch?: string;
	baseBranch?: string;
	exists: boolean;
	hasChanges: boolean;
	ahead: number;
	behind: number;
	files: ShareFile[];
	summary: string;
	canShare: boolean;
	blockedReason?: string;
	prUrl?: string;
}

export interface ShareCanvasOptions {
	confirm: boolean;
	title: string;
	note?: string;
	worktreePath: string;
	branch: string;
	baseBranch: string;
	prUrl?: string;
}

export interface ShareCanvasResult {
	ok: boolean;
	committed: boolean;
	published: boolean;
	prUrl?: string;
	summary: string;
	error?: string;
}

function classifyPorcelain(code: string): ShareFileChange {
	if (code.includes("D")) return "removed";
	if (code.includes("A") || code === "??" || code.includes("?")) return "added";
	return "changed";
}

export function parsePorcelain(stdout: string): ShareFile[] {
	const files: ShareFile[] = [];
	for (const raw of stdout.split("\n")) {
		if (raw.length < 4) continue;
		const code = raw.slice(0, 2);
		let path = raw.slice(3);
		const arrow = path.lastIndexOf(" -> ");
		if (arrow >= 0) path = path.slice(arrow + 4);
		files.push({ path, change: classifyPorcelain(code) });
	}
	return files;
}

function describeFiles(files: ShareFile[]): string {
	if (files.length === 0) return "No file changes yet.";
	const added = files.filter((f) => f.change === "added").length;
	const removed = files.filter((f) => f.change === "removed").length;
	const changed = files.filter((f) => f.change === "changed").length;
	const parts: string[] = [];
	if (changed) parts.push(`${changed} changed`);
	if (added) parts.push(`${added} added`);
	if (removed) parts.push(`${removed} removed`);
	return parts.join(", ");
}

async function aheadBehind(worktreePath: string, baseBranch: string): Promise<{ ahead: number; behind: number }> {
	for (const base of [`origin/${baseBranch}`, baseBranch]) {
		try {
			const out = await gitIn(worktreePath, ["rev-list", "--left-right", "--count", `${base}...HEAD`]);
			const m = out.match(/^(\d+)\s+(\d+)/);
			if (m) return { behind: Number(m[1]), ahead: Number(m[2]) };
		} catch {
			/* try next ref */
		}
	}
	return { ahead: 0, behind: 0 };
}

export async function inspectCanvasShare(input: {
	projectRoot: string;
	mode: "isolated" | "local";
	worktreePath: string;
	branch?: string;
	baseBranch?: string;
	prUrl?: string;
}): Promise<CanvasShareStatus> {
	const { projectRoot, mode, worktreePath, branch, baseBranch, prUrl } = input;
	if (mode !== "isolated") {
		return {
			mode,
			worktreePath,
			branch,
			baseBranch,
			exists: true,
			hasChanges: false,
			ahead: 0,
			behind: 0,
			files: [],
			summary: "This canvas edits the original folder, so there is no separate copy to send.",
			canShare: false,
			blockedReason: "local",
			prUrl,
		};
	}
	if (!isMelonWorktreePath(projectRoot, worktreePath) || !existsSync(worktreePath)) {
		return {
			mode,
			worktreePath,
			branch,
			baseBranch,
			exists: false,
			hasChanges: false,
			ahead: 0,
			behind: 0,
			files: [],
			summary: "This canvas copy is missing. Open the canvas again to restore it, then send.",
			canShare: false,
			blockedReason: "missing",
			prUrl,
		};
	}

	let files: ShareFile[] = [];
	try {
		files = parsePorcelain(await gitIn(worktreePath, ["status", "--porcelain"]));
	} catch {
		files = [];
	}
	const counts = await aheadBehind(worktreePath, baseBranch || "main");
	const hasChanges = files.length > 0;
	const canShare = hasChanges || counts.ahead > 0;
	const summary = canShare
		? [describeFiles(files), counts.ahead > 0 ? `${counts.ahead} already saved and waiting to send` : null]
				.filter(Boolean)
				.join(". ")
		: "Nothing new to send yet.";

	return {
		mode,
		worktreePath,
		branch,
		baseBranch,
		exists: true,
		hasChanges,
		ahead: counts.ahead,
		behind: counts.behind,
		files,
		summary,
		canShare,
		blockedReason: canShare ? undefined : "empty",
		prUrl,
	};
}

async function tryGhPrCreate(
	worktreePath: string,
	baseBranch: string,
	branch: string,
	title: string,
	body: string,
): Promise<string | undefined> {
	try {
		const { stdout } = await execFileAsync(
			"gh",
			["pr", "create", "--base", baseBranch, "--head", branch, "--title", title, "--body", body],
			{ cwd: worktreePath, timeout: 60_000, maxBuffer: 2 * 1024 * 1024 },
		);
		const url = String(stdout)
			.trim()
			.split(/\s+/)
			.find((t) => t.startsWith("http"));
		if (url) return url;
	} catch {
		/* fall through to view */
	}
	try {
		const { stdout } = await execFileAsync("gh", ["pr", "view", "--json", "url", "-q", ".url"], {
			cwd: worktreePath,
			timeout: 30_000,
		});
		const url = String(stdout).trim();
		if (url.startsWith("http")) return url;
	} catch {
		return undefined;
	}
	return undefined;
}

export async function shareCanvasWork(projectRoot: string, options: ShareCanvasOptions): Promise<ShareCanvasResult> {
	if (!options.confirm) {
		return {
			ok: false,
			committed: false,
			published: false,
			summary: "Send was cancelled.",
			error: "confirm required",
		};
	}
	if (!isMelonWorktreePath(projectRoot, options.worktreePath)) {
		return {
			ok: false,
			committed: false,
			published: false,
			summary: "Refusing to send from outside this canvas copy.",
			error: "unsafe path",
		};
	}

	return withProjectGitLock(projectRoot, async () => {
		const status = await inspectCanvasShare({
			projectRoot,
			mode: "isolated",
			worktreePath: options.worktreePath,
			branch: options.branch,
			baseBranch: options.baseBranch,
			prUrl: options.prUrl,
		});
		if (!status.canShare) {
			return {
				ok: false,
				committed: false,
				published: false,
				summary: status.summary,
				error: status.blockedReason,
			};
		}

		let committed = false;
		if (status.hasChanges) {
			try {
				await gitIn(options.worktreePath, ["add", "-A"]);
				const message = options.note?.trim() ? `${options.title}\n\n${options.note.trim()}` : options.title;
				await gitIn(options.worktreePath, ["commit", "-m", message]);
				committed = true;
			} catch (e) {
				const error = e instanceof Error ? e.message : String(e);
				return {
					ok: false,
					committed: false,
					published: false,
					summary: "Couldn't save this copy yet.",
					error,
				};
			}
		}

		try {
			await gitIn(options.worktreePath, ["push", "-u", "origin", "HEAD"], 120_000);
		} catch (e) {
			const error = e instanceof Error ? e.message : String(e);
			return {
				ok: false,
				committed,
				published: false,
				summary: committed
					? "Saved your work in this canvas, but couldn't send it for review. Check that GitHub access is set up, then try again."
					: "Couldn't send this canvas for review.",
				error,
			};
		}

		const body = options.note?.trim() || "Updates from a Melon canvas.";
		const prUrl =
			options.prUrl ||
			(await tryGhPrCreate(options.worktreePath, options.baseBranch, options.branch, options.title, body));

		return {
			ok: true,
			committed,
			published: true,
			prUrl,
			summary: prUrl
				? "Sent for review. Anyone with the link can look at the changes."
				: "Sent your branch. Open GitHub to finish the review request if it didn't appear automatically.",
		};
	});
}
