// Theme persistence via /settings. Hermetic agent dir so we never touch real settings.
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-theme-settings-"));
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");

if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

describe("theme settings persistence", () => {
	it("PUT /settings stores theme on disk and GET returns it", async () => {
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { theme: "github-dark" },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.theme).toBe("github-dark");

			const disk = JSON.parse(readFileSync(join(agentDir, "melon", "settings.json"), "utf8"));
			expect(disk.theme).toBe("github-dark");

			const get = await app.inject({ method: "GET", url: "/settings" });
			expect(get.statusCode).toBe(200);
			expect(get.json().settings.theme).toBe("github-dark");
		} finally {
			await app.close();
		}
	});

	it("rejects empty theme", async () => {
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { theme: "  " },
			});
			expect(res.statusCode).toBe(400);
		} finally {
			await app.close();
		}
	});

	it("merges theme without wiping other settings", async () => {
		mkdirSync(join(agentDir, "melon"), { recursive: true });
		const { writeFileSync } = await import("node:fs");
		writeFileSync(
			join(agentDir, "melon", "settings.json"),
			JSON.stringify({ lastModel: "anthropic/claude-sonnet-4", theme: "dracula" }, null, "\t"),
		);
		const app = await buildApp();
		try {
			const put = await app.inject({
				method: "PUT",
				url: "/settings",
				payload: { theme: "moonfly" },
			});
			expect(put.statusCode).toBe(200);
			expect(put.json().settings.lastModel).toBe("anthropic/claude-sonnet-4");
			expect(put.json().settings.theme).toBe("moonfly");
		} finally {
			await app.close();
		}
	});
});
