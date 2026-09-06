/**
 * @-mention utilities for inputs: token parsing, colored-span rendering, and
 * a debounced batch existence check (green = file exists, red = missing).
 * Existence is cached per (cwd, path) and subscribers re-render on updates.
 *
 * A mention is "@" + a run of non-whitespace, directly after line start,
 * whitespace, or an opening bracket. Trailing sentence punctuation (. , ; : ! ?)
 * and closing brackets stay OUT of the token so "@README.md." doesn't check a
 * path that cannot exist.
 */

export interface MentionSpan {
	text: string;
	/** The path after "@" when this span is a mention token. */
	mention?: string;
}

const MENTION_RE = /(^|[\s([])@([^\s]+)/g;
const TRAILING_PUNCT = /[.,;:!?)\]]+$/;

function splitToken(raw: string): { token: string; trailing: string } {
	const m = raw.match(TRAILING_PUNCT);
	const trailing = m ? m[0] : "";
	return { token: raw.slice(0, raw.length - trailing.length), trailing };
}

/** Split text into plain/mention spans for rendering. */
export function splitMentionSpans(text: string): MentionSpan[] {
	const spans: MentionSpan[] = [];
	let last = 0;
	for (const match of text.matchAll(MENTION_RE)) {
		const lead = match[1] ?? "";
		const { token, trailing } = splitToken(match[2] ?? "");
		if (!token) continue;
		const tokenStart = (match.index ?? 0) + lead.length;
		if (tokenStart > last) spans.push({ text: text.slice(last, tokenStart) });
		spans.push({ text: `@${token}`, mention: token });
		last = tokenStart + 1 + token.length;
		if (trailing) {
			spans.push({ text: trailing });
			last += trailing.length;
		}
	}
	if (last < text.length) spans.push({ text: text.slice(last) });
	return spans;
}

/**
 * The @token under the caret (the one being typed), or null.
 */
export function activeMention(text: string, caret: number): { query: string; start: number; end: number } | null {
	for (const match of text.matchAll(MENTION_RE)) {
		const lead = match[1] ?? "";
		const { token, trailing } = splitToken(match[2] ?? "");
		if (!token) continue;
		const start = (match.index ?? 0) + lead.length;
		const end = start + 1 + token.length + trailing.length;
		if (caret >= start && caret <= end) return { query: token, start, end };
	}
	return null;
}

// ── Existence cache (debounced batch check) ──

const cache = new Map<string, boolean>();
const listeners = new Set<() => void>();
let pendingByCwd = new Map<string, Set<string>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function key(cwd: string, path: string): string {
	return `${cwd}\u0000${path}`;
}

/** true = exists · false = missing · undefined = not checked yet */
export function mentionExists(cwd: string | null, path: string): boolean | undefined {
	if (!cwd) return undefined;
	return cache.get(key(cwd, path));
}

export function subscribeExistence(fn: () => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function emit() {
	for (const fn of listeners) fn();
}

/** Queue paths for a batched /files/exists check (debounced 250ms). */
export function queueExistenceCheck(cwd: string | null, paths: string[], alsoCwd?: string | null): void {
	if (!cwd) return;
	let unknown = false;
	for (const p of paths) {
		if (cache.has(key(cwd, p))) continue;
		unknown = true;
		const set = pendingByCwd.get(cwd) ?? new Set<string>();
		set.add(p);
		pendingByCwd.set(cwd, set);
	}
	if (!unknown) return;
	if (flushTimer) clearTimeout(flushTimer);
	flushTimer = setTimeout(async () => {
		const batch = pendingByCwd;
		pendingByCwd = new Map();
		flushTimer = null;
		await Promise.all(
			[...batch.entries()].map(async ([dir, paths]) => {
				try {
					const res = await fetch("/files/exists", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ cwd: dir, paths: [...paths], alsoCwd: alsoCwd ?? undefined }),
					});
					if (!res.ok) return;
					const d = (await res.json()) as { existing: string[] };
					const existing = new Set(d.existing);
					for (const p of paths) cache.set(key(dir, p), existing.has(p));
				} catch {
					/* network hiccup — unknown stays unknown, retried next queue */
				}
			}),
		);
		emit();
	}, 250);
}

/** All mention paths in a text (for existence checks). */
export function mentionPaths(text: string): string[] {
	const out: string[] = [];
	for (const match of text.matchAll(MENTION_RE)) {
		const { token } = splitToken(match[2] ?? "");
		if (token) out.push(token);
	}
	return out;
}

export interface FileCandidate {
	path: string;
	/** Human title for created .md files (handoff artifacts, manuals). */
	title?: string;
}

/** Autocomplete candidates from the server's fuzzy file search. */
export async function fetchFileCandidates(
	cwd: string | null,
	query: string,
	alsoCwd?: string | null,
	limit = 20,
): Promise<FileCandidate[]> {
	if (!cwd) return [];
	const t0 = Date.now();
	try {
		const url = `/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(query)}&limit=${limit}${
			alsoCwd ? `&alsoCwd=${encodeURIComponent(alsoCwd)}` : ""
		}`;
		console.log(`[melon-@] fetch: ${url}`);
		const res = await fetch(url);
		if (!res.ok) {
			console.log(`[melon-@] fetch FAILED: HTTP ${res.status}`);
			return [];
		}
		const d = (await res.json()) as { files: FileCandidate[] };
		console.log(
			`[melon-@] fetch -> ${d.files.length} hits in ${Date.now() - t0}ms: ${
				d.files
					.slice(0, 6)
					.map((f) => (f.title ? `${f.title} (${f.path})` : f.path))
					.join(" | ") || "<none>"
			}`,
		);
		return d.files;
	} catch (e) {
		console.log(`[melon-@] fetch THREW: ${e instanceof Error ? e.message : e}`);
		return [];
	}
}
