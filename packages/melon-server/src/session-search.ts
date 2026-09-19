// Session history search — powers the "session detective" flow.
//
// Sessions are pi JSONL transcripts under <agentDir>/sessions/<project-slug>/.
// This module walks them, extracts user/assistant text, and ranks matches for
// a keyword query. No external index: an in-memory mtime cache makes repeated
// scans cheap, and the corpus (local session files) is small enough that
// full scans stay fast. A SQLite/FTS5 index is the upgrade path if corpora
// grow; the tool contract stays the same.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface SessionMessage {
	role: string;
	text: string;
	timestamp?: string;
}

export interface SessionMatch {
	sessionFile: string;
	/** Directory name under sessions/ — the project slug. */
	project: string;
	/** First user message (truncated) — the human-readable session title. */
	title: string;
	modifiedAt: number;
	score: number;
	/** Best matching messages, snippet-trimmed. */
	matches: Array<{ role: string; timestamp?: string; snippet: string }>;
}

export interface SearchOptions {
	agentDir: string;
	query: string;
	/** Skip this session file (the caller's own session). */
	excludeSessionFile?: string;
	/** Only search this project slug. */
	project?: string;
	limit?: number;
}

interface ParsedSession {
	mtime: number;
	messages: SessionMessage[];
	title: string;
}

const cache = new Map<string, ParsedSession>();
const TITLE_MAX = 90;
const SNIPPET_MAX = 240;
const MAX_MESSAGES_PER_SESSION = 400;

/** Extract user/assistant text from a session JSONL body. Tolerant by design. */
export function parseSessionMessages(content: string): SessionMessage[] {
	const out: SessionMessage[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (entry.type !== "message") continue;
		const message = entry.message as Record<string, unknown> | undefined;
		if (!message) continue;
		const role = typeof message.role === "string" ? message.role : "";
		if (role !== "user" && role !== "assistant") continue;
		const contentBlocks = Array.isArray(message.content) ? message.content : [];
		const text = contentBlocks
			.filter(
				(block): block is { type: string; text?: string } =>
					!!block &&
					typeof block === "object" &&
					(block as { type?: unknown }).type === "text" &&
					typeof (block as { text?: unknown }).text === "string",
			)
			.map((block) => block.text as string)
			.join("\n")
			.trim();
		if (!text) continue;
		out.push({
			role,
			text,
			timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
		});
		if (out.length >= MAX_MESSAGES_PER_SESSION) break;
	}
	return out;
}

function sessionTitle(messages: SessionMessage[]): string {
	const first = messages.find((m) => m.role === "user");
	const text = (first?.text ?? "").replace(/\s+/g, " ").trim();
	return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX - 1)}…` : text;
}

function loadSession(path: string): ParsedSession | null {
	try {
		const mtime = statSync(path).mtimeMs;
		const cached = cache.get(path);
		if (cached && cached.mtime === mtime) return cached;
		if (!existsSync(path)) {
			cache.delete(path);
			return null;
		}
		const messages = parseSessionMessages(readFileSync(path, "utf8"));
		const parsed: ParsedSession = { mtime, messages, title: sessionTitle(messages) };
		cache.set(path, parsed);
		return parsed;
	} catch {
		return null;
	}
}

/** Test-only: drop the mtime cache. */
export function clearSessionCache(): void {
	cache.clear();
}

function snippetAround(text: string, lower: string): string | undefined {
	const idx = text.toLowerCase().indexOf(lower);
	if (idx === -1) return undefined;
	const start = Math.max(0, idx - SNIPPET_MAX / 3);
	let snippet = text
		.slice(start, start + SNIPPET_MAX)
		.replace(/\s+/g, " ")
		.trim();
	if (start > 0) snippet = `…${snippet}`;
	if (start + SNIPPET_MAX < text.length) snippet = `${snippet}…`;
	return snippet;
}

function listSessionFiles(agentDir: string, project?: string): Array<{ path: string; slug: string }> {
	const sessionsRoot = join(agentDir, "sessions");
	if (!existsSync(sessionsRoot)) return [];
	const out: Array<{ path: string; slug: string }> = [];
	for (const slug of readdirSync(sessionsRoot)) {
		if (project && slug !== project) continue;
		const dir = join(sessionsRoot, slug);
		let entries: string[];
		try {
			entries = readdirSync(dir);
		} catch {
			continue;
		}
		for (const file of entries) {
			if (file.endsWith(".jsonl")) out.push({ path: join(dir, file), slug });
		}
	}
	return out;
}

/**
 * Keyword search across all session transcripts. Score: per-message term
 * coverage and hit counts; sessions with hits in the title get a boost.
 */
export function searchSessions(options: SearchOptions): SessionMatch[] {
	const terms = options.query
		.toLowerCase()
		.split(/\s+/)
		.filter((t) => t.length > 0);
	if (terms.length === 0) return [];
	const limit = Math.max(1, Math.min(options.limit ?? 8, 25));

	const hits: SessionMatch[] = [];
	for (const { path, slug } of listSessionFiles(options.agentDir, options.project)) {
		if (options.excludeSessionFile && path === options.excludeSessionFile) continue;
		const parsed = loadSession(path);
		if (!parsed || parsed.messages.length === 0) continue;

		let score = 0;
		const matches: SessionMatch["matches"] = [];
		for (const message of parsed.messages) {
			const lower = message.text.toLowerCase();
			let messageScore = 0;
			for (const term of terms) {
				let idx = lower.indexOf(term);
				let count = 0;
				while (idx !== -1 && count < 20) {
					count++;
					idx = lower.indexOf(term, idx + term.length);
				}
				if (count > 0) messageScore += count;
			}
			if (messageScore === 0) continue;
			score += messageScore;
			if (matches.length < 3) {
				const anchor = terms.find((t) => message.text.toLowerCase().includes(t));
				const snippet = anchor ? snippetAround(message.text, anchor) : undefined;
				if (snippet) {
					matches.push({ role: message.role, timestamp: message.timestamp, snippet });
				}
			}
		}
		if (score === 0) continue;
		if (parsed.title && terms.some((t) => parsed.title.toLowerCase().includes(t))) score += 5;
		hits.push({
			sessionFile: path,
			project: slug,
			title: parsed.title || "(untitled session)",
			modifiedAt: parsed.mtime,
			score,
			matches,
		});
	}
	return hits.sort((a, b) => b.score - a.score || b.modifiedAt - a.modifiedAt).slice(0, limit);
}

export interface ReadExcerptOptions {
	sessionFile: string;
	query?: string;
	/** Max text characters to return. */
	maxChars?: number;
}

/** Pull a readable excerpt from one session: matched messages plus context. */
export function readSessionExcerpt(options: ReadExcerptOptions): {
	title: string;
	project: string;
	excerpt: string;
} | null {
	try {
		const parsed = loadSession(options.sessionFile);
		if (!parsed) return null;
		const slug = options.sessionFile.split("/").slice(-2, -1)[0] ?? "";
		const maxChars = options.maxChars ?? 6000;
		const terms = (options.query ?? "")
			.toLowerCase()
			.split(/\s+/)
			.filter((t) => t.length > 0);

		const parts: string[] = [];
		let chars = 0;
		const push = (role: string, timestamp: string | undefined, text: string): boolean => {
			const trimmed = text.length > 1200 ? `${text.slice(0, 1200)}…` : text;
			const block = `[${role}${timestamp ? ` ${timestamp}` : ""}]\n${trimmed}`;
			if (chars + block.length > maxChars) return false;
			parts.push(block);
			chars += block.length;
			return true;
		};

		if (terms.length > 0) {
			const pushed = new Set<number>();
			const pushIdx = (i: number): boolean => {
				if (pushed.has(i)) return true;
				const m = parsed.messages[i];
				if (!push(m.role, m.timestamp, m.text)) return false;
				pushed.add(i);
				return true;
			};
			for (let i = 0; i < parsed.messages.length && chars < maxChars; i++) {
				const message = parsed.messages[i];
				if (!terms.some((t) => message.text.toLowerCase().includes(t))) continue;
				for (let j = Math.max(0, i - 1); j <= Math.min(parsed.messages.length - 1, i + 1); j++) {
					if (!pushIdx(j)) break;
				}
			}
		}
		if (parts.length === 0) {
			// No query matches (or no query): first user message + the last few turns.
			const pushed = new Set<number>();
			const pushIdx = (i: number): boolean => {
				if (pushed.has(i)) return true;
				const m = parsed.messages[i];
				if (!push(m.role, m.timestamp, m.text)) return false;
				pushed.add(i);
				return true;
			};
			const firstUserIdx = parsed.messages.findIndex((m) => m.role === "user");
			if (firstUserIdx !== -1) pushIdx(firstUserIdx);
			for (let i = Math.max(0, parsed.messages.length - 6); i < parsed.messages.length; i++) {
				if (!pushIdx(i)) break;
			}
		}
		return {
			title: parsed.title || "(untitled session)",
			project: slug,
			excerpt: parts.join("\n\n") || "(empty session)",
		};
	} catch {
		return null;
	}
}

// ---------------------------------------------------------------------------
// Extension entry resolution (melon-ask-question.ts pattern)
// ---------------------------------------------------------------------------

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const moduleDir = dirname(fileURLToPath(import.meta.url));

/** Absolute path to the session-search extension factory, or null if missing. */
export function sessionSearchExtensionPath(): string | null {
	for (const candidate of [
		join(moduleDir, "session-search-extension.js"),
		join(moduleDir, "session-search-extension.ts"),
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return null;
}
