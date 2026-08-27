import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
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

/**
 * Skill registry.
 * - pi skills: discovered read-only from ~/.pi/agent/skills/<id>/SKILL.md
 * - custom melon skills: <agentDir>/melon/skills.json -> { id: {name?, description?, instructions} }
 * Custom entries override pi skills with the same id.
 */
export function loadSkills(): Record<string, Skill> {
	const all: Record<string, Skill> = {};
	try {
		const piSkillsDir = join(homedir(), ".pi", "agent", "skills");
		for (const dir of readdirSync(piSkillsDir)) {
			const md = join(piSkillsDir, dir, "SKILL.md");
			if (!existsSync(md)) continue;
			const skill = parseSkillMd(dir, readFileSync(md, "utf8"));
			if (skill) all[skill.id] = skill;
		}
	} catch {
		/* no pi skills dir */
	}
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
