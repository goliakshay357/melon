// Developer debugger flag via /settings. Hermetic agent dir.
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-developer-settings-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");

if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

describe("developerDebugger settings persistence", () => {
	it("PUT /settings stores developerDebugger on disk and GET returns it", async () => {
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { developerDebugger: true },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.developerDebugger).toBe(true);

			const disk = JSON.parse(readFileSync(join(agentDir, "melon", "settings.json"), "utf8"));
			expect(disk.developerDebugger).toBe(true);

			const get = await app.inject({ method: "GET", url: "/settings" });
			expect(get.statusCode).toBe(200);
			expect(get.json().settings.developerDebugger).toBe(true);
		} finally {
			await app.close();
		}
	});

	it("rejects non-boolean developerDebugger", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { developerDebugger: "yes" },
			});
			expect(res.statusCode).toBe(400);
		} finally {
			await app.close();
		}
	});

	it("merges developerDebugger without wiping other settings", async () => {
		mkdirSync(join(agentDir, "melon"), { recursive: true });
		writeFileSync(
			join(agentDir, "melon", "settings.json"),
			JSON.stringify({ lastModel: "anthropic/claude-sonnet-4", theme: "dracula" }, null, "\t"),
		);
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { developerDebugger: true },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.lastModel).toBe("anthropic/claude-sonnet-4");
			expect(put.json().settings.theme).toBe("dracula");
			expect(put.json().settings.developerDebugger).toBe(true);
		} finally {
			await app.close();
		}
	});
});
