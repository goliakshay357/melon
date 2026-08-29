export interface Skill {
    id: string;
    name: string;
    description?: string;
    instructions: string;
}
export declare function skillsDir(): string;
/**
 * Default skills SHIP WITH THE APP in <compiled>/skills/ (bundled from
 * assets/skills by the build). On every startup we copy them into the agent
 * dir so a fresh laptop gets them without manual setup — unless the user
 * deleted that skill (denylisted).
 */
export declare function materializeSkills(): void;
/**
 * Skill registry — .md files are the SINGLE source of truth.
 * 1. pi skills (~/.pi/agent/skills) as read-only fallback.
 * 2. melon skills (~/.melon/agent/skills) — editable, ships + user-created.
 */
export declare function loadSkills(): Record<string, Skill>;
/** Read one skill's full .md (raw text + parsed fields). */
export declare function readSkill(id: string): (Skill & {
    raw: string;
}) | null;
/** Create or update a skill .md file. */
export declare function saveSkill(id: string, name: string, description: string | undefined, instructions: string): void;
/** Delete a skill (and denylist it so bundled ones don't return on restart). */
export declare function deleteSkill(id: string): void;
//# sourceMappingURL=skills.d.ts.map