import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

export function skillsDir(): string {
	return join(getAgentDir(), "skills");
}

function skillPath(id: string): string {
	return join(skillsDir(), id, "SKILL.md");
}

function unquote(v: string): string {
	const t = v.trim();
	if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))))
		return t.slice(1, -1).trim();
	return t;
}

function parseSkillMd(id: string, md: string): Skill | null {
	const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	const front = m ? m[1] : "";
	const body = m ? m[2].trim() : md.trim();
	if (!body) return null;
	const name = unquote(front.match(/name:\s*(.+)/)?.[1] ?? "") || id;
	const description = front.match(/description:\s*(.+)/)?.[1];
	return { id, name, description: description ? unquote(description) : undefined, instructions: body };
}

function serializeSkillMd(name: string, description: string | undefined, instructions: string): string {
	// Keep the frontmatter valid YAML: strip quotes from the unquoted name
	// value and replace colons (which would break the scalar).
	const safeName = name.replace(/['"]/g, "").replace(/:/g, "-").trim();
	const lines = ["---", `name: ${safeName}`];
	if (description) lines.push(`description: '${description.replace(/'/g, "")}'`);
	lines.push("---");
	return `${lines.join("\n")}\n\n${instructions.trim()}\n`;
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

/** Deleted-skill denylist, so a deleted bundled skill isn't re-materialized on restart. */
function deletedFile(): string {
	return join(getAgentDir(), "melon", "deleted-skills.json");
}
function loadDeleted(): Set<string> {
	try {
		return new Set(JSON.parse(readFileSync(deletedFile(), "utf8")) as string[]);
	} catch {
		return new Set();
	}
}
function saveDeleted(ids: Set<string>): void {
	mkdirSync(join(getAgentDir(), "melon"), { recursive: true });
	writeFileSync(deletedFile(), JSON.stringify([...ids], null, 2));
}

/**
 * Default skills SHIP WITH THE APP in <compiled>/skills/ (bundled from
 * assets/skills by the build). On every startup we copy them into the agent
 * dir so a fresh laptop gets them without manual setup — unless the user
 * deleted that skill (denylisted).
 */
export function materializeSkills(): void {
	const bundled = join(dirname(fileURLToPath(import.meta.url)), "skills");
	const target = skillsDir();
	const deleted = loadDeleted();
	try {
		let copied = 0;
		const entries = readdirSync(bundled, { withFileTypes: true });
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (deleted.has(entry.name)) continue; // user deleted it — don't resurrect
			const src = join(bundled, entry.name, "SKILL.md");
			if (!existsSync(src)) continue;
			const dstDir = join(target, entry.name);
			const dst = join(dstDir, "SKILL.md");
			if (existsSync(dst)) continue;
			mkdirSync(dstDir, { recursive: true });
			writeFileSync(dst, readFileSync(src, "utf8"));
			copied++;
		}
		console.error(`[skills] materialized ${copied} bundled skills`);
	} catch {
		/* bundled dir missing — fine in dev */
	}
}

/**
 * Skill registry — .md files are the SINGLE source of truth.
 * 1. pi skills (~/.pi/agent/skills) as read-only fallback.
 * 2. melon skills (~/.melon/agent/skills) — editable, ships + user-created.
 */
export function loadSkills(): Record<string, Skill> {
	const all: Record<string, Skill> = {};
	readSkillDir(join(homedir(), ".pi", "agent", "skills"), all);
	readSkillDir(skillsDir(), all);
	return all;
}

/** Read one skill's full .md (raw text + parsed fields). */
export function readSkill(id: string): (Skill & { raw: string }) | null {
	const p = skillPath(id);
	if (!existsSync(p)) return null;
	const raw = readFileSync(p, "utf8");
	const s = parseSkillMd(id, raw);
	return s ? { ...s, raw } : null;
}

/** Create or update a skill .md file. */
export function saveSkill(id: string, name: string, description: string | undefined, instructions: string): void {
	mkdirSync(join(skillsDir(), id), { recursive: true });
	writeFileSync(skillPath(id), serializeSkillMd(name, description, instructions));
	// Re-creating clears it from the delete denylist.
	const deleted = loadDeleted();
	if (deleted.has(id)) {
		deleted.delete(id);
		saveDeleted(deleted);
	}
}

/** Delete a skill (and denylist it so bundled ones don't return on restart). */
export function deleteSkill(id: string): void {
	rmSync(join(skillsDir(), id), { recursive: true, force: true });
	const deleted = loadDeleted();
	deleted.add(id);
	saveDeleted(deleted);
}
