// /tree must expose the node (card) id so the Workspaces sidebar can open the
// existing node instead of resuming it as a duplicate card.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-tree-agent-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const projectDir = mkdtempSync(join(tmpdir(), "melon-tree-project-"));
mkdirSync(join(projectDir, ".melon", "canvases"), { recursive: true });
writeFileSync(
	join(projectDir, ".melon", "canvases", "cv-test.json"),
	JSON.stringify({
		id: "cv-test",
		name: "Test canvas",
		cards: [
			{ id: "card-1", title: "First node", sessionFile: "/tmp/session-1.jsonl" },
			{ id: "card-2", title: "Doc node", kind: "document" },
		],
	}),
);

const { buildApp } = await import("../src/index.ts");

describe("GET /tree", () => {
	it("includes the card id for each session so a node can be opened directly", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({ method: "GET", url: `/tree?cwd=${encodeURIComponent(projectDir)}` });
			expect(res.statusCode).toBe(200);
			const body = res.json() as {
				canvases: Array<{ id: string; sessions: Array<{ file: string; title?: string; cardId?: string }> }>;
			};
			const cv = body.canvases.find((c) => c.id === "cv-test");
			expect(cv).toBeDefined();
			expect(cv?.sessions).toHaveLength(1);
			expect(cv?.sessions[0]).toMatchObject({
				file: "/tmp/session-1.jsonl",
				title: "First node",
				cardId: "card-1",
			});
		} finally {
			await app.close();
		}
	});
});
