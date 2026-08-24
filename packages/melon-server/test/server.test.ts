import { describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";

// Unit-ish: no LLM calls. Real-model streaming is covered by the
// gated integration test at the bottom (MELON_E2E=1).

describe("melon-server routes", () => {
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
