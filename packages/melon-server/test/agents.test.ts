import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

const agentDir = mkdtempSync(join(tmpdir(), "melon-agents-"));

vi.mock("@earendil-works/pi-coding-agent", () => ({
	getAgentDir: () => agentDir,
}));

const {
	createAgentProfile,
	deleteAgentProfile,
	isValidAgentId,
	listAgentProfiles,
	readAgentProfile,
	topAgentProfiles,
	touchAgentProfileRecent,
	updateAgentProfile,
} = await import("../src/agents.ts");
const { loadSettings, saveSettings } = await import("../src/settings.ts");

describe("agent profiles", () => {
	it("validates ids", () => {
		expect(isValidAgentId("pipeline")).toBe(true);
		expect(isValidAgentId("Bad Id")).toBe(false);
		expect(isValidAgentId("")).toBe(false);
	});

	it("creates, lists, updates, touches, and deletes on disk", () => {
		const created = createAgentProfile({
			id: "pipeline",
			name: "Pipeline",
			role: "runs CI / data steps",
			descriptionMd: "# Pipeline\nAlways verify before merge.\n",
			defaultSkillIds: [],
		});
		expect(created.id).toBe("pipeline");
		expect(existsSync(join(agentDir, "agents", "pipeline", "profile.json"))).toBe(true);
		expect(readFileSync(join(agentDir, "agents", "pipeline", "description.md"), "utf8")).toContain("Always verify");

		expect(listAgentProfiles().map((a) => a.id)).toContain("pipeline");
		expect(readAgentProfile("pipeline")?.role).toBe("runs CI / data steps");

		const updated = updateAgentProfile("pipeline", {
			name: "Pipeline",
			role: "CI owner",
			descriptionMd: "# Pipeline\nUpdated.\n",
			defaultSkillIds: [],
		});
		expect(updated.role).toBe("CI owner");
		expect(readFileSync(join(agentDir, "agents", "pipeline", "description.md"), "utf8")).toContain("Updated");

		touchAgentProfileRecent("pipeline");
		expect(typeof readAgentProfile("pipeline")?.lastUsedAt).toBe("string");
		expect(loadSettings().agentProfileRecentIds?.[0]).toBe("pipeline");
		expect(topAgentProfiles(5)[0]?.id).toBe("pipeline");

		deleteAgentProfile("pipeline");
		expect(existsSync(join(agentDir, "agents", "pipeline"))).toBe(false);
		expect(readAgentProfile("pipeline")).toBeNull();
		expect(loadSettings().agentProfileRecentIds ?? []).not.toContain("pipeline");
	});

	it("rejects duplicate create", () => {
		createAgentProfile({
			id: "reviewer",
			name: "Reviewer",
			role: "code review",
			descriptionMd: "Be thorough.\n",
		});
		expect(() =>
			createAgentProfile({
				id: "reviewer",
				name: "Reviewer 2",
				role: "",
				descriptionMd: "",
			}),
		).toThrow(/already exists/);
	});

	it("persists boxMailAutoSend in settings", () => {
		saveSettings({ ...loadSettings(), boxMailAutoSend: true });
		expect(loadSettings().boxMailAutoSend).toBe(true);
		const disk = JSON.parse(readFileSync(join(agentDir, "melon", "settings.json"), "utf8"));
		expect(disk.boxMailAutoSend).toBe(true);
	});

	it("formats standing instructions for system prompt injection", async () => {
		const { formatAgentStandingInstructions } = await import("../src/agents.ts");
		const text = formatAgentStandingInstructions({
			id: "pipeline",
			name: "Pipeline",
			role: "CI owner",
			descriptionMd: "Always run tests first.\n",
		});
		expect(text).toContain("[Melon agent profile: Pipeline (id: pipeline)]");
		expect(text).toContain("Role: CI owner");
		expect(text).toContain("Always run tests first.");
	});
});
