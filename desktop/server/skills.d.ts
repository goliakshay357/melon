export interface Skill {
    id: string;
    name: string;
    description?: string;
    instructions: string;
}
/**
 * Default skills SHIP WITH THE APP in <compiled>/skills/ (bundled from
 * assets/skills by the build). On every startup we copy them into the agent
 * dir so a fresh laptop gets them without any manual setup. User-editable
 * overrides live in <agentDir>/melon/skills.json.
 */
export declare function materializeSkills(): void;
/**
 * Skill registry (later sources override earlier):
 * 1. pi skills: ~/.pi/agent/skills/<id>/SKILL.md (fallback when pi is installed)
 * 2. materialized melon skills: <agentDir>/skills/<id>/SKILL.md (ships with the app)
 * 3. custom overrides: <agentDir>/melon/skills.json
 */
export declare function loadSkills(): Record<string, Skill>;
//# sourceMappingURL=skills.d.ts.map