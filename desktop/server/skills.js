import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
function parseSkillMd(id, md) {
    const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
    const front = m ? m[1] : "";
    const body = m ? m[2].trim() : md.trim();
    if (!body)
        return null;
    const name = front.match(/name:\s*(.+)/)?.[1]?.trim() ?? id;
    const description = front.match(/description:\s*(.+)/)?.[1]?.trim();
    return { id, name, description, instructions: body };
}
function readSkillDir(dir, into) {
    try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
            if (!entry.isDirectory())
                continue;
            const md = join(dir, entry.name, "SKILL.md");
            if (!existsSync(md))
                continue;
            const skill = parseSkillMd(entry.name, readFileSync(md, "utf8"));
            if (skill)
                into[skill.id] = skill;
        }
    }
    catch {
        /* no such dir */
    }
}
/**
 * Default skills SHIP WITH THE APP in <compiled>/skills/ (bundled from
 * assets/skills by the build). On every startup we copy them into the agent
 * dir so a fresh laptop gets them without any manual setup. User-editable
 * overrides live in <agentDir>/melon/skills.json.
 */
export function materializeSkills() {
    const bundled = join(dirname(fileURLToPath(import.meta.url)), "skills");
    const target = join(getAgentDir(), "skills");
    try {
        // IMPORTANT: fs.cpSync does NOT work with asar archives (directory ops
        // aren't asar-patched). Read each bundled SKILL.md (readFileSync is
        // asar-safe) and write it to the agent dir individually.
        let copied = 0;
        const entries = readdirSync(bundled, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            const src = join(bundled, entry.name, "SKILL.md");
            if (!existsSync(src))
                continue;
            const dstDir = join(target, entry.name);
            const dst = join(dstDir, "SKILL.md");
            if (existsSync(dst))
                continue;
            mkdirSync(dstDir, { recursive: true });
            writeFileSync(dst, readFileSync(src, "utf8"));
            copied++;
        }
        console.error(`[skills-debug] materialized ${copied} skills from ${bundled} -> ${target}`);
    }
    catch (e) {
        console.error(`[skills-debug] materialize FAILED from ${bundled}:`, e.message);
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
export function loadSkills() {
    const all = {};
    readSkillDir(join(homedir(), ".pi", "agent", "skills"), all);
    readSkillDir(join(getAgentDir(), "skills"), all);
    try {
        const custom = JSON.parse(readFileSync(join(getAgentDir(), "melon", "skills.json"), "utf8"));
        for (const [id, s] of Object.entries(custom)) {
            const c = s;
            all[id] = {
                id,
                name: c.name ?? id,
                description: c.description,
                instructions: String(c.instructions ?? ""),
            };
        }
    }
    catch {
        /* no custom skills file */
    }
    return all;
}
//# sourceMappingURL=skills.js.map