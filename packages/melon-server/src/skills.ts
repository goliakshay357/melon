import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Skill {
	id: string;
	name: string;
	description?: string;
	instructions: string;
}

function parseSkillMd(id: string, md: string): Skill | null {
	const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	const front = m ? m[1] : "";
	const body = m ? m[2].trim() : md.trim();
	if (!body) return null;
	const name = front.match(/name:\s*(.+)/)?.[1]?.trim() ?? id;
	const description = front.match(/description:\s*(.+)/)?.[1]?.trim();
	return { id, name, description, instructions: body };
}

function readSkillDir(dir: string, into: Record<string, Skill>): void {
	try {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const md = join(dir, entry.name, "SKILL.md");
			if (!existsSync(md)) continue;
			const skill = parseSkillMd(entry.name, readFileSync(md, "utf8"));
			if (skill) into[skill.id] = skill;
		}
	} catch {
		/* no such dir */
	}
}

/**
 * Default skills SHIP WITH THE APP in <compiled>/skills/ (bundled from
 * assets/skills by the build). On every startup we copy them into the agent
 * dir so a fresh laptop gets them without any manual setup. User-editable
 * overrides live in <agentDir>/melon/skills.json.
 */
export function materializeSkills(): void {
	const bundled = join(dirname(fileURLToPath(import.meta.url)), "skills");
	const target = join(getAgentDir(), "skills");
	try {
		cpSync(bundled, target, { recursive: true, force: false });
		console.error(`[skills-debug] materialized ${bundled} -> ${target}`);
	} catch (e) {
		console.error(`[skills-debug] materialize FAILED from ${bundled}:`, (e as Error).message);
	}
	const all = loadSkills();
	console.error(`[skills-debug] loadSkills sees ${Object.keys(all).length}: ${Object.keys(all).join(", ")}`);
}

/**
 * Skill registry (later sources override earlier):
 * 1. pi skills: ~/.pi/agent/skills/<id>/SKILL.md (fallback when pi is installed)
 * 2. materialized melon skills: <agentDir>/skills/<id>/SKILL.md (ships with the app)
 * 3. custom overrides: <agentDir>/melon/skills.json
 */
export function loadSkills(): Record<string, Skill> {
	const all: Record<string, Skill> = {};
	readSkillDir(join(homedir(), ".pi", "agent", "skills"), all);
	readSkillDir(join(getAgentDir(), "skills"), all);
	try {
		const custom = JSON.parse(readFileSync(join(getAgentDir(), "melon", "skills.json"), "utf8"));
		for (const [id, s] of Object.entries(custom)) {
			const c = s as any;
			all[id] = {
				id,
				name: c.name ?? id,
				description: c.description,
				instructions: String(c.instructions ?? ""),
			};
		}
	} catch {
		/* no custom skills file */
	}
	return all;
}
