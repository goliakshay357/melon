// @-mention file search: bounded recursive walk of the canvas folder,
// fuzzy-scored relative paths, plus guarded file reads for open-on-canvas.
//
// Hidden dirs are skipped EXCEPT note artifacts (.melon/notes/handoff/*.md) —
// those are first-class @-mention targets.

import { existsSync, readdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fuzzyScore } from "./fuzzy.ts";
import { parseNote, slugifyTitle } from "./notes.ts";

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	".svn",
	".hg",
	"dist",
	"build",
	"out",
	".next",
	".venv",
	"venv",
	"__pycache__",
	".DS_Store",
]);

const MAX_SCAN = 50_000;
const MAX_DEPTH = 10;
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Relative paths of candidate files under `cwd` (bounded). */
export function walkFiles(cwd: string): string[] {
	const root = resolve(cwd);
	const out: string[] = [];
	let scanned = 0;

	const visit = (dir: string, depth: number): void => {
		if (depth > MAX_DEPTH || scanned >= MAX_SCAN) return;
		const entries = (() => {
			try {
				return readdirSync(dir, { withFileTypes: true });
			} catch {
				return null;
			}
		})();
		if (!entries) return;
		// .melon first: on huge repos the scan budget must never starve the
		// created-note folders.
		entries.sort((a, b) => (a.name === ".melon" ? -1 : b.name === ".melon" ? 1 : 0));
		for (const entry of entries) {
			if (scanned >= MAX_SCAN) return;
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				const relFromRoot = relative(root, abs);
				// .melon: only descend into notes/ — handoff artifacts and manual
				// documents are first-class @-mention targets.
				if (relFromRoot === ".melon") {
					const notesDir = join(abs, "notes");
					if (existsSync(notesDir)) visit(notesDir, depth + 1);
					continue;
				}
				// Dot directories are searchable like any other (.github, .pi, …) —
				// only known-noise VCS dirs are excluded. No security gate: the
				// agent could read these files with its tools anyway.
				if (SKIP_DIRS.has(entry.name)) continue;
				if (entry.name === "history" || entry.name === ".trash") continue;
				visit(abs, depth + 1);
				continue;
			}
			if (!entry.isFile()) continue;
			if (entry.name === ".DS_Store") continue;
			scanned++;
			out.push(relative(root, abs).split("\\").join("/"));
		}
	};
	visit(root, 0);
	return out;
}

export interface FileHit {
	/** Relative path (the @mention token). */
	path: string;
	abs: string;
	score: number;
	/** Note artifacts: the human title from frontmatter (display hint). */
	title?: string;
}

/** Files under .melon/notes with a human title (frontmatter or first H1). */
export function noteFiles(cwd: string): Array<{ path: string; abs: string; title?: string }> {
	const notesRoot = join(resolve(cwd), ".melon", "notes");
	const out: Array<{ path: string; abs: string; title?: string }> = [];
	const visit = (dir: string, depth: number): void => {
		if (depth > 4) return;
		const entries = (() => {
			try {
				return readdirSync(dir, { withFileTypes: true });
			} catch {
				return null;
			}
		})();
		if (!entries) return;
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "history" || entry.name === ".trash") continue;
				visit(abs, depth + 1);
				continue;
			}
			if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
			const rel = relative(notesRoot, abs).split("\\").join("/");
			const relPath = `.melon/notes/${rel}`;
			try {
				const content = readFileSync(abs, "utf8");
				if (rel.startsWith("handoff/")) {
					const doc = parseNote(content);
					// Legacy migration: <id>.md → slug of the title, in place.
					if (entry.name === `${doc.id}.md` && doc.title.trim()) {
						const base = slugifyTitle(doc.title);
						let name = `${base}.md`;
						let n = 2;
						while (existsSync(join(dir, name)) && join(dir, name) !== abs) {
							name = `${base}-${n}.md`;
							n++;
						}
						const nextAbs = join(dir, name);
						if (nextAbs !== abs) {
							try {
								renameSync(abs, nextAbs);
								out.push({ path: `.melon/notes/handoff/${name}`, abs: nextAbs, title: doc.title });
								continue;
							} catch {
								/* keep legacy name */
							}
						}
					}
					out.push({ path: relPath, abs, title: doc.title || undefined });
				} else {
					const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
					out.push({ path: relPath, abs, title: h1 || entry.name.replace(/\.md$/, "") });
				}
			} catch {
				/* skip corrupt */
			}
		}
	};
	visit(notesRoot, 0);
	return out;
}

/**
 * Fuzzy-search candidate files. The .md files WE created (handoff artifacts +
 * manual documents) are prioritized: they match on path AND human title, get
 * a score bonus, and always rank above equal-scoring project files.
 */
export function searchFiles(cwd: string, query: string, limit = 20): FileHit[] {
	const root = resolve(cwd);
	// noteFiles first — its legacy rename must happen before the walk so the
	// stale <id>.md path can never appear in results.
	const notes = noteFiles(cwd);
	const files = walkFiles(cwd);
	const q = query.trim();
	if (!q) {
		// Bare "@": created .md files first, then every other .md at any depth,
		// then top-level files of other types.
		const hits: FileHit[] = notes.map((n) => ({ path: n.path, abs: n.abs, score: -1000, title: n.title }));
		const seen = new Set(hits.map((h) => h.path));
		const mdFiles = files
			.filter((f) => f.endsWith(".md") && !seen.has(f))
			.sort((a, b) => a.localeCompare(b))
			.slice(0, limit);
		for (const path of mdFiles) hits.push({ path, abs: join(root, path), score: -500 });
		const top = files
			.filter((f) => !f.includes("/") && !f.endsWith(".md"))
			.sort((a, b) => a.localeCompare(b))
			.slice(0, limit);
		for (const path of top) hits.push({ path, abs: join(root, path), score: 0 });
		return hits.slice(0, limit);
	}
	const byPath = new Map<string, FileHit>();
	for (const path of files) {
		const score = fuzzyScore(q, path);
		if (score === null) continue;
		byPath.set(path, { path, abs: join(root, path), score });
	}
	for (const n of notes) {
		const score = fuzzyScore(q, `${n.path} ${n.title ?? ""}`);
		if (score === null) continue;
		// Strong bonus + title display: created files win ties and near-ties.
		const prefixBonus = n.path.toLowerCase().startsWith(q.toLowerCase()) ? -60 : 0;
		byPath.set(n.path, { path: n.path, abs: n.abs, score: score - 20 + prefixBonus, title: n.title });
	}
	const all = [...byPath.values()].sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
	const ours = all.filter((h) => h.title !== undefined);
	const rest = all.filter((h) => h.title === undefined);
	return [...ours, ...rest].slice(0, limit);
}

/** Resolve a mention path inside the folder; null when it escapes or misses. */
export function resolveInside(cwd: string, relPath: string): string | null {
	if (!relPath || relPath.includes("..") || relPath.startsWith("/")) return null;
	const root = resolve(cwd);
	const abs = resolve(root, relPath);
	if (abs !== root && !abs.startsWith(root + "/")) return null;
	return abs;
}

export function fileExists(cwd: string, relPath: string): boolean {
	const abs = resolveInside(cwd, relPath);
	if (!abs) return false;
	try {
		return statSync(abs).isFile();
	} catch {
		return false;
	}
}

/** Read a text file (bounded); null when missing, too large, or outside cwd. */
export function readTextFile(cwd: string, relPath: string): { abs: string; content: string } | null {
	const abs = resolveInside(cwd, relPath);
	if (!abs || !existsSync(abs)) return null;
	try {
		if (statSync(abs).size > MAX_FILE_BYTES) return null;
		return { abs, content: readFileSync(abs, "utf8") };
	} catch {
		return null;
	}
}
