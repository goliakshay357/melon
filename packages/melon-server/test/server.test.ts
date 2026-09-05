import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp, readAppVersion } from "../src/index.ts";

// Unit-ish: no LLM calls. Real-model streaming is covered by the
// gated integration test at the bottom (MELON_E2E=1).

describe("melon-server routes", () => {
	it("healthz reports ok + product version", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/healthz" });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.ok).toBe(true);
		expect(body.version).toBe(readAppVersion());
		expect(String(body.version)).toMatch(/^\d+\.\d+\.\d+/);
		await app.close();
	});

	it("MELON_VERSION env overrides package.json for healthz", async () => {
		const prev = process.env.MELON_VERSION;
		process.env.MELON_VERSION = "9.9.9-test";
		try {
			expect(readAppVersion()).toBe("9.9.9-test");
			const app = await buildApp();
			const res = await app.inject({ method: "GET", url: "/healthz" });
			expect(res.json().version).toBe("9.9.9-test");
			await app.close();
		} finally {
			if (prev === undefined) delete process.env.MELON_VERSION;
			else process.env.MELON_VERSION = prev;
		}
	});

	it("404s SSE for unknown card", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/sessions/nope/events" });
		expect(res.statusCode).toBe(404);
		await app.close();
	});

	it("rejects invalid cwd with 400", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId: "t1", cwd: "/definitely/not/a/real/dir" },
		});
		expect(res.statusCode).toBe(400);
		expect(res.json().error).toContain("invalid cwd");
		await app.close();
	});

	it("requires sessionFile on resume", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/sessions/resume",
			payload: { cardId: "t2" },
		});
		expect(res.statusCode).toBe(400);
		await app.close();
	});

	it("lists projects with real cwds from session headers", async () => {
		const app = await buildApp();
		const res = await app.inject({ method: "GET", url: "/projects" });
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(Array.isArray(body.projects)).toBe(true);
		for (const p of body.projects) {
			expect(p.cwd).toMatch(/^\//); // real absolute path, not a slug
			expect(Array.isArray(p.sessions)).toBe(true);
		}
		await app.close();
	});

	it("creates a real session when given a valid cwd (no prompt)", async () => {
		const app = await buildApp();
		const res = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId: `test-${Date.now()}`, cwd: import.meta.dirname },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(body.sessionFile).toMatch(/\.jsonl$/);
		expect(body.model).toContain("/");
		await app.close();
	});

	it("POST /sessions returns effective thinking state", async () => {
		const app = await buildApp();
		const cardId = `think-attach-${Date.now()}`;
		const res = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId, cwd: import.meta.dirname, thinkingLevel: "low" },
		});
		expect(res.statusCode).toBe(200);
		const body = res.json();
		expect(typeof body.thinkingLevel).toBe("string");
		expect(Array.isArray(body.thinkingLevels)).toBe(true);
		expect(body.thinkingLevels.length).toBeGreaterThan(0);
		await app.close();
	});

	it("POST /sessions/:cardId/thinking sets the level and rejects unknown ones", async () => {
		const app = await buildApp();
		const cardId = `think-set-${Date.now()}`;
		const create = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId, cwd: import.meta.dirname },
		});
		expect(create.statusCode).toBe(200);

		const set = await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/thinking`,
			payload: { level: "high" },
		});
		expect(set.statusCode).toBe(200);
		const body = set.json();
		expect(body.ok).toBe(true);
		expect(typeof body.level).toBe("string");
		expect(Array.isArray(body.thinkingLevels)).toBe(true);

		// The effective level may be clamped by the model, but it must be one
		// of the model's supported levels.
		expect(body.thinkingLevels).toContain(body.level);

		const bad = await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/thinking`,
			payload: { level: "bogus" },
		});
		expect(bad.statusCode).toBe(400);

		const missing = await app.inject({
			method: "POST",
			url: "/sessions/nope/thinking",
			payload: { level: "high" },
		});
		expect(missing.statusCode).toBe(404);
		await app.close();
	});

	it("POST /canvases/:id/worktree creates under .melon/worktrees", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-api-wt-"));
		try {
			execFileSync("git", ["init", "-b", "main"], { cwd: dir });
			execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
			execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
			writeFileSync(join(dir, "README.md"), "# t\n");
			execFileSync("git", ["add", "."], { cwd: dir });
			execFileSync("git", ["commit", "-m", "init"], { cwd: dir });

			const app = await buildApp();
			const res = await app.inject({
				method: "POST",
				url: "/canvases/cv_test1/worktree",
				payload: { cwd: dir },
			});
			expect(res.statusCode).toBe(200);
			const body = res.json();
			expect(body.ok).toBe(true);
			expect(body.mode).toBe("isolated");
			expect(String(body.worktreePath)).toContain(join(".melon", "worktrees"));
			await app.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("GET /canvases/search finds canvases by title across folders", async () => {
		const a = mkdtempSync(join(tmpdir(), "melon-search-a-"));
		const b = mkdtempSync(join(tmpdir(), "melon-search-b-"));
		try {
			for (const [dir, id, name, modified] of [
				[a, "cv_alpha", "Alpha board", "2026-01-02T00:00:00.000Z"],
				[a, "cv_other", "Other", "2026-01-01T00:00:00.000Z"],
				[b, "cv_alpha2", "alpha draft", "2026-01-03T00:00:00.000Z"],
				[b, "cv_empty", "", "2026-01-04T00:00:00.000Z"],
			] as const) {
				const cvDir = join(dir, ".melon", "canvases");
				mkdirSync(cvDir, { recursive: true });
				writeFileSync(join(cvDir, `${id}.json`), JSON.stringify({ id, name, modified, cards: [] }));
			}

			const app = await buildApp();
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: a } });
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: b } });

			const empty = await app.inject({ method: "GET", url: "/canvases/search?q=" });
			expect(empty.statusCode).toBe(200);
			expect(empty.json().results).toEqual([]);

			const res = await app.inject({ method: "GET", url: "/canvases/search?q=alpha" });
			expect(res.statusCode).toBe(200);
			const body = res.json() as {
				query: string;
				results: Array<{
					id: string;
					name: string;
					cwd: string;
					folderName: string;
					match: string;
				}>;
			};
			expect(body.query).toBe("alpha");
			const scoped = body.results.filter((r) => r.cwd === a || r.cwd === b);
			expect(scoped.map((r) => r.id)).toEqual(["cv_alpha2", "cv_alpha"]);
			expect(scoped.every((r) => r.name.toLowerCase().includes("alpha"))).toBe(true);
			expect(scoped.every((r) => r.match === "title")).toBe(true);

			const untitled = await app.inject({ method: "GET", url: "/canvases/search?q=untit" });
			expect(
				(untitled.json().results as Array<{ id: string; cwd: string }>).some(
					(r) => r.id === "cv_empty" && r.cwd === b,
				),
			).toBe(true);

			// Fuzzy subsequence: "abd" matches "Alpha board" (letters in order).
			const fuzzy = await app.inject({ method: "GET", url: "/canvases/search?q=abd" });
			const fuzzyScoped = (
				fuzzy.json().results as Array<{ id: string; cwd: string; match: string; score: number }>
			).filter((r) => r.cwd === a || r.cwd === b);
			expect(fuzzyScoped.some((r) => r.id === "cv_alpha")).toBe(true);
			expect(fuzzyScoped.every((r) => typeof r.score === "number")).toBe(true);
			// Nearest: exact-ish "alpha" should rank ahead of looser hits when kind ties.
			const alphaQ = await app.inject({ method: "GET", url: "/canvases/search?q=alpha" });
			const alphaScoped = (alphaQ.json().results as Array<{ id: string; cwd: string; score: number }>).filter(
				(r) => r.cwd === a || r.cwd === b,
			);
			expect(alphaScoped[0]?.id).toBe("cv_alpha2"); // "alpha draft" starts with alpha

			await app.close();
		} finally {
			rmSync(a, { recursive: true, force: true });
			rmSync(b, { recursive: true, force: true });
		}
	});

	it("GET /canvases/search matches card titles and message text", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-search-deep-"));
		try {
			const cvDir = join(dir, ".melon", "canvases");
			mkdirSync(cvDir, { recursive: true });
			writeFileSync(
				join(cvDir, "cv_title_only.json"),
				JSON.stringify({
					id: "cv_title_only",
					name: "Boring board",
					modified: "2026-01-01T00:00:00.000Z",
					cards: [],
				}),
			);
			writeFileSync(
				join(cvDir, "cv_card_hit.json"),
				JSON.stringify({
					id: "cv_card_hit",
					name: "Layout A",
					modified: "2026-01-02T00:00:00.000Z",
					cards: [{ id: "card_1", title: "worktree lazy vs eager", messages: [] }],
				}),
			);
			writeFileSync(
				join(cvDir, "cv_msg_hit.json"),
				JSON.stringify({
					id: "cv_msg_hit",
					name: "Layout B",
					modified: "2026-01-03T00:00:00.000Z",
					cards: [
						{
							id: "card_2",
							title: "Chat",
							messages: [
								{ role: "user", text: "Please explain the worktree isolation path." },
								{ role: "assistant", text: "Sure." },
							],
						},
					],
				}),
			);
			writeFileSync(
				join(cvDir, "cv_doc_hit.json"),
				JSON.stringify({
					id: "cv_doc_hit",
					name: "Notes",
					modified: "2026-01-04T00:00:00.000Z",
					cards: [
						{
							id: "card_3",
							kind: "document",
							title: "Doc",
							documentContent: "# Spec\n\nworktree folder layout goes here.",
							messages: [],
						},
					],
				}),
			);

			const app = await buildApp();
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: dir } });

			const res = await app.inject({ method: "GET", url: "/canvases/search?q=worktree" });
			expect(res.statusCode).toBe(200);
			const results = (
				res.json() as {
					results: Array<{
						id: string;
						cwd: string;
						match: string;
						snippet?: string;
						cardTitle?: string;
					}>;
				}
			).results.filter((r) => r.cwd === dir);
			expect(results.map((r) => r.id)).toEqual(["cv_card_hit", "cv_msg_hit", "cv_doc_hit"]);
			expect(results.map((r) => r.match)).toEqual(["card", "message", "document"]);
			expect(results[0]?.cardTitle).toBe("worktree lazy vs eager");
			expect(results[1]?.snippet?.toLowerCase()).toContain("worktree");
			expect(results[2]?.snippet?.toLowerCase()).toContain("worktree");
			expect(results.some((r) => r.id === "cv_title_only")).toBe(false);

			// Title match outranks a weaker card/message hit on the same canvas.
			writeFileSync(
				join(cvDir, "cv_both.json"),
				JSON.stringify({
					id: "cv_both",
					name: "worktree canvas",
					modified: "2026-01-05T00:00:00.000Z",
					cards: [
						{
							id: "card_4",
							title: "other",
							messages: [{ role: "user", text: "mentions worktree too" }],
						},
					],
				}),
			);
			const both = await app.inject({ method: "GET", url: "/canvases/search?q=worktree" });
			const bothHit = (both.json() as { results: Array<{ id: string; cwd: string; match: string }> }).results.find(
				(r) => r.id === "cv_both" && r.cwd === dir,
			);
			expect(bothHit?.match).toBe("title");
			await app.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("POST /canvases/:id/touch bumps modified for Recent ordering", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-touch-"));
		try {
			const cvDir = join(dir, ".melon", "canvases");
			mkdirSync(cvDir, { recursive: true });
			writeFileSync(
				join(cvDir, "cv_touch.json"),
				JSON.stringify({
					id: "cv_touch",
					name: "Touch me",
					modified: "2020-01-01T00:00:00.000Z",
					cards: [],
				}),
			);
			const app = await buildApp();
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: dir } });

			const touch = await app.inject({
				method: "POST",
				url: "/canvases/cv_touch/touch",
				payload: { cwd: dir },
			});
			expect(touch.statusCode).toBe(200);
			expect(touch.json().ok).toBe(true);
			expect(String(touch.json().modified) > "2020-01-01").toBe(true);

			const recent = await app.inject({ method: "GET", url: "/canvases/recent" });
			const hit = (recent.json().recent as Array<{ id: string; cwd: string; modified: string }>).find(
				(r) => r.id === "cv_touch" && r.cwd === dir,
			);
			expect(hit?.modified).toBe(touch.json().modified);

			await app.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("PUT /canvases/:id accepts bodies up to the 10 MiB limit", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-canvas-big-"));
		try {
			const app = await buildApp();
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: dir } });

			const pad = "x".repeat(1.5 * 1024 * 1024);
			const res = await app.inject({
				method: "PUT",
				url: "/canvases/cv_big",
				headers: { "content-type": "application/json" },
				payload: {
					cwd: dir,
					canvas: {
						id: "cv_big",
						name: "Big",
						cwd: dir,
						viewport: { x: 0, y: 0, zoom: 1 },
						cards: [
							{
								id: "card_big",
								kind: "chat",
								position: { x: 0, y: 0 },
								messages: [{ role: "assistant", text: pad }],
							},
						],
					},
				},
			});
			expect(res.statusCode).toBe(200);
			expect(res.json().ok).toBe(true);

			await app.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("PUT /canvases/:id allowEmpty clears a populated canvas", async () => {
		const dir = mkdtempSync(join(tmpdir(), "melon-canvas-empty-"));
		try {
			const app = await buildApp();
			await app.inject({ method: "POST", url: "/folders", payload: { cwd: dir } });

			const seed = await app.inject({
				method: "PUT",
				url: "/canvases/cv_clear",
				headers: { "content-type": "application/json" },
				payload: {
					cwd: dir,
					canvas: {
						id: "cv_clear",
						name: "Clear me",
						cwd: dir,
						viewport: { x: 0, y: 0, zoom: 1 },
						cards: [{ id: "card_1", kind: "chat", position: { x: 0, y: 0 }, messages: [] }],
					},
				},
			});
			expect(seed.statusCode).toBe(200);

			const blocked = await app.inject({
				method: "PUT",
				url: "/canvases/cv_clear",
				headers: { "content-type": "application/json" },
				payload: {
					cwd: dir,
					canvas: {
						id: "cv_clear",
						name: "Clear me",
						cwd: dir,
						viewport: { x: 0, y: 0, zoom: 1 },
						cards: [],
					},
				},
			});
			expect(blocked.statusCode).toBe(409);

			const cleared = await app.inject({
				method: "PUT",
				url: "/canvases/cv_clear",
				headers: { "content-type": "application/json" },
				payload: {
					cwd: dir,
					allowEmpty: true,
					canvas: {
						id: "cv_clear",
						name: "Clear me",
						cwd: dir,
						viewport: { x: 0, y: 0, zoom: 1 },
						cards: [],
					},
				},
			});
			expect(cleared.statusCode).toBe(200);

			const got = await app.inject({
				method: "GET",
				url: `/canvases/cv_clear?cwd=${encodeURIComponent(dir)}`,
			});
			expect(got.statusCode).toBe(200);
			expect(got.json().cards).toEqual([]);

			await app.close();
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe.skipIf(!process.env.MELON_E2E)("integration (MELON_E2E=1)", () => {
	it("streams a prompt end to end", async () => {
		const app = await buildApp();
		const created = await app.inject({
			method: "POST",
			url: "/sessions",
			payload: { cardId: `e2e-${Date.now()}`, cwd: import.meta.dirname },
		});
		const { cardId } = created.json();

		let text = "";
		const events: any[] = [];
		const controller = new AbortController();
		const stream = fetch(
			`http://127.0.0.1:${app.server?.address()}/sessions/${cardId}/events`.replace(
				"http://127.0.0.1:",
				"http://127.0.0.1:",
			),
			{
				signal: controller.signal,
			},
		).then(async (r) => {
			const reader = (r.body as ReadableStream).getReader();
			const decoder = new TextDecoder();
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				for (const line of decoder.decode(value).split("\n")) {
					if (!line.startsWith("data: ")) continue;
					const ev = JSON.parse(line.slice(6));
					events.push(ev);
					if (ev.type === "delta") text += ev.text;
					if (ev.type === "status" && ev.status === "idle") controller.abort();
				}
			}
		});

		await new Promise((r) => setTimeout(r, 300)); // let SSE connect first
		await app.inject({
			method: "POST",
			url: `/sessions/${cardId}/prompt`,
			payload: { text: "Reply with exactly: E2E OK" },
		});
		await Promise.race([stream, new Promise((r) => setTimeout(r, 60000))]);
		controller.abort();
		expect(text.length).toBeGreaterThan(0);
		expect(events.some((e) => e.type === "status")).toBe(true);
		await app.close();
	}, 90000);
});
