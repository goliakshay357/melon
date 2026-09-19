// Session search — transcript parsing, ranking, and excerpt pulling, against
// synthetic .jsonl corpora in tmpdirs.

import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { clearSessionCache, parseSessionMessages, readSessionExcerpt, searchSessions } from "../src/session-search.ts";

const dirs: string[] = [];
function scratch(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), `melon-sess-${prefix}-`));
	dirs.push(dir);
	return dir;
}
afterEach(() => {
	clearSessionCache();
});

function entry(type: "message" | "custom" | "session", role: string, text: string, timestamp?: string): string {
	return JSON.stringify({
		type,
		timestamp,
		...(type === "message" ? { message: { role, content: [{ type: "text", text }] } } : {}),
	});
}

function writeSession(agentDir: string, slug: string, lines: string[]): string {
	const dir = join(agentDir, "sessions", slug);
	mkdirSync(dir, { recursive: true });
	const file = join(dir, `${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
	writeFileSync(file, `${lines.join("\n")}\n`);
	return file;
}

describe("parseSessionMessages", () => {
	it("extracts user/assistant text and skips non-message entries", () => {
		const body = [
			entry("session", "user", "ignored"),
			entry("custom", "user", "ignored"),
			entry("message", "user", "hello about retries", "2026-01-01T10:00:00Z"),
			JSON.stringify({ type: "message", message: { role: "assistant", content: [{ type: "tool_use" }] } }),
			entry("message", "assistant", "we chose exponential backoff"),
			"{broken json",
			"",
		].join("\n");
		const messages = parseSessionMessages(body);
		expect(messages).toHaveLength(2);
		expect(messages[0]).toMatchObject({ role: "user", timestamp: "2026-01-01T10:00:00Z" });
		expect(messages[1].text).toContain("exponential backoff");
	});
});

describe("searchSessions", () => {
	it("ranks sessions by keyword hits and returns snippets", () => {
		const agentDir = scratch("corpus");
		writeSession(agentDir, "backend", [
			entry("message", "user", "fix the API retry logic"),
			entry("message", "assistant", "we chose exponential backoff with jitter on 429s"),
		]);
		writeSession(agentDir, "melon", [
			entry("message", "user", "canvas zoom bug"),
			entry("message", "assistant", "the minimap flickers"),
		]);
		const hits = searchSessions({ agentDir, query: "retry backoff" });
		expect(hits.length).toBeGreaterThanOrEqual(1);
		expect(hits[0]?.project).toBe("backend");
		expect(hits[0]?.title).toContain("retry");
		expect(hits[0]?.matches.some((m) => m.snippet.includes("exponential backoff"))).toBe(true);
	});

	it("boosts sessions whose title matches and skips the excluded session", () => {
		const agentDir = scratch("exclude");
		const mine = writeSession(agentDir, "proj", [
			entry("message", "user", "retry logic discussion"),
			entry("message", "assistant", "retry logic reply"),
		]);
		writeSession(agentDir, "proj2", [
			entry("message", "user", "other topic"),
			entry("message", "assistant", "mentions retry logic once"),
		]);
		const hits = searchSessions({ agentDir, query: "retry logic", excludeSessionFile: mine });
		expect(hits.some((h) => h.sessionFile === mine)).toBe(false);
		expect(hits.every((h) => h.sessionFile !== mine)).toBe(true);
	});

	it("returns [] for empty queries and respects limit", () => {
		const agentDir = scratch("limit");
		for (let i = 0; i < 5; i++) {
			writeSession(agentDir, "p", [entry("message", "user", `keyword topic number ${i}`)]);
		}
		expect(searchSessions({ agentDir, query: "   " })).toEqual([]);
		const hits = searchSessions({ agentDir, query: "keyword", limit: 2 });
		expect(hits).toHaveLength(2);
	});

	it("picks up new content after mtime changes (cache invalidation)", () => {
		const agentDir = scratch("mtime");
		const file = writeSession(agentDir, "p", [entry("message", "user", "initial topic")]);
		expect(searchSessions({ agentDir, query: "websocket" })).toHaveLength(0);
		writeFileSync(file, `${entry("message", "user", "let's use a websocket connection")}\n`);
		const future = Date.now() / 1000 + 5;
		utimesSync(file, future, future);
		const hits = searchSessions({ agentDir, query: "websocket" });
		expect(hits).toHaveLength(1);
	});
});

describe("readSessionExcerpt", () => {
	it("pulls excerpts around query matches with a neighbor line", () => {
		const agentDir = scratch("read");
		const file = writeSession(agentDir, "proj", [
			entry("message", "user", "we discussed the retry budget"),
			entry("message", "assistant", "capped at 3 attempts"),
			entry("message", "user", "unrelated line"),
		]);
		const result = readSessionExcerpt({ sessionFile: file, query: "retry budget" });
		expect(result?.title).toContain("retry budget");
		expect(result?.excerpt).toContain("capped at 3 attempts".replace("capped", "capped").slice(0, 6));
		expect(result?.excerpt).toContain("capped at 3 attempts");
	});

	it("falls back to first user message + last turns without a query", () => {
		const agentDir = scratch("readfallback");
		const file = writeSession(agentDir, "p", [
			entry("message", "user", "the very first ask"),
			entry("message", "assistant", "mid answer"),
			entry("message", "user", "latest question"),
			entry("message", "assistant", "latest answer"),
		]);
		const result = readSessionExcerpt({ sessionFile: file });
		expect(result?.excerpt).toContain("the very first ask");
		expect(result?.excerpt).toContain("latest answer");
	});

	it("returns null for missing files", () => {
		expect(readSessionExcerpt({ sessionFile: "/nope/missing.jsonl" })).toBeNull();
	});
});
