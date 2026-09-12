// Autoname must never touch a manually named canvas, and must no-op before any
// chat exists. Both paths short-circuit before calling a model.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-autoname-agent-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const projectDir = mkdtempSync(join(tmpdir(), "melon-autoname-project-"));
mkdirSync(join(projectDir, ".melon", "canvases"), { recursive: true });
writeFileSync(
	join(projectDir, ".melon", "canvases", "cv-named.json"),
	JSON.stringify({ id: "cv-named", name: "Billing Rework", cards: [] }),
);
writeFileSync(
	join(projectDir, ".melon", "canvases", "cv-fresh.json"),
	JSON.stringify({ id: "cv-fresh", name: "Canvas 3", cards: [] }),
);

const { buildApp } = await import("../src/index.ts");

describe("POST /canvases/:id/autoname", () => {
	it("leaves a manually named canvas alone", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "POST",
				url: `/canvases/cv-named/autoname`,
				payload: { cwd: projectDir },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toMatchObject({ skipped: true, name: "Billing Rework" });
			const disk = JSON.parse(readFileSync(join(projectDir, ".melon", "canvases", "cv-named.json"), "utf8"));
			expect(disk.name).toBe("Billing Rework");
		} finally {
			await app.close();
		}
	});

	it("skips a placeholder canvas with no chat yet", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "POST",
				url: `/canvases/cv-fresh/autoname`,
				payload: { cwd: projectDir },
			});
			expect(res.statusCode).toBe(200);
			expect(res.json()).toMatchObject({ skipped: true, reason: "no chat yet" });
		} finally {
			await app.close();
		}
	});
});
