// Model favorites persist through PUT /settings. Hermetic agent dir.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-favorite-models-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");

describe("favoriteModels settings", () => {
	it("stores favorites on disk, deduped", async () => {
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { favoriteModels: ["anthropic/claude-sonnet-4", "openai/gpt-5", "anthropic/claude-sonnet-4"] },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.favoriteModels).toEqual([
				"anthropic/claude-sonnet-4",
				"openai/gpt-5",
			]);

			const disk = JSON.parse(readFileSync(join(agentDir, "melon", "settings.json"), "utf8"));
			expect(disk.favoriteModels).toEqual(["anthropic/claude-sonnet-4", "openai/gpt-5"]);

			const get = await app.inject({ method: "GET", url: "/settings" });
			expect(get.json().settings.favoriteModels).toEqual([
				"anthropic/claude-sonnet-4",
				"openai/gpt-5",
			]);
		} finally {
			await app.close();
		}
	});

	it("rejects non-arrays and empty entries", async () => {
		const app = await buildApp();
		try {
			const notArray = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { favoriteModels: "anthropic/claude-sonnet-4" },
			});
			expect(notArray.statusCode).toBe(400);

			const empty = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { favoriteModels: ["ok", "  "] },
			});
			expect(empty.statusCode).toBe(400);
		} finally {
			await app.close();
		}
	});

	it("round-trips an empty favorites list", async () => {
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { favoriteModels: [] },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.favoriteModels).toEqual([]);
		} finally {
			await app.close();
		}
	});
});
