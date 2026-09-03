// Extension binding tests. Hermetic: the agent dir points at a throwaway dir,
// and the probe extension is removed after the test so it never leaks into
// other sessions.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-ext-bind-test-"));
// The env var name depends on the build's piConfig branding (this repo builds
// as "melon" → MELON_CODING_AGENT_DIR). Set both spellings.
process.env.MELON_CODING_AGENT_DIR = agentDir;
process.env.PI_CODING_AGENT_DIR = agentDir;

const { buildApp } = await import("../src/index.ts");
const { getAgentDir } = await import("@earendil-works/pi-coding-agent");

// Fail fast if the hermetic dir is not actually in effect.
if (getAgentDir() !== agentDir) {
	throw new Error(`hermetic agent dir not in effect: getAgentDir() = ${getAgentDir()}`);
}

const probeOutPath = join(agentDir, "mode-probe-out.json");
const probeExtPath = join(agentDir, "extensions", "mode-probe.ts");

function installModeProbe(): void {
	mkdirSync(join(agentDir, "extensions"), { recursive: true });
	writeFileSync(
		probeExtPath,
		// Records the extension mode the session was bound with. session_start
		// only fires via AgentSession.bindExtensions().
		`import { writeFileSync } from "node:fs";
export default function (pi) {
	pi.on("session_start", (_event, ctx) => {
		writeFileSync(${JSON.stringify(probeOutPath)}, JSON.stringify({ mode: ctx.mode }));
	});
}
`,
	);
}

afterEach(() => {
	rmSync(probeExtPath, { force: true });
	rmSync(probeOutPath, { force: true });
});

describe("session extension bindings", () => {
	it("binds extensions in rpc mode and delivers session_start on session create", async () => {
		installModeProbe();
		const app = await buildApp();
		try {
			const res = await app.inject({
				method: "POST",
				url: "/sessions",
				payload: { cardId: `ext-mode-${Date.now()}`, cwd: import.meta.dirname },
			});
			expect(res.statusCode).toBe(200);
			const probe = JSON.parse(readFileSync(probeOutPath, "utf8")) as { mode: string };
			// "rpc" (not the "print" default): extensions gate terminal-only
			// behavior on ctx.mode, and pi-cursor-sdk only enables native tool
			// replay outside "print" mode.
			expect(probe.mode).toBe("rpc");
		} finally {
			await app.close();
		}
	});
});
