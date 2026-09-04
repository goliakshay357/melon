import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
