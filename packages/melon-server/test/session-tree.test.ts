// In-place edit/revert route: input validation must not touch a runtime.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-tree-nav-agent-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");

describe("POST /sessions/:cardId/tree", () => {
	it("requires an entryId", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({ method: "POST", url: "/sessions/card-x/tree", payload: {} });
			expect(res.statusCode).toBe(400);
			expect(res.json().error).toMatch(/entryId/);
		} finally {
			await app.close();
		}
	});

	it("404s for an unknown card with no session file", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "POST",
				url: "/sessions/card-x/tree",
				payload: { entryId: "entry-1" },
			});
			expect(res.statusCode).toBe(404);
		} finally {
			await app.close();
		}
	});
});
