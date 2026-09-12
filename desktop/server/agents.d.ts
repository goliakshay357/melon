export interface AgentProfile {
    id: string;
    name: string;
    role: string;
    descriptionPath: string;
    descriptionMd: string;
    defaultSkillIds: string[];
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
}
export interface AgentProfileMeta {
    id: string;
    name: string;
    role: string;
    defaultSkillIds: string[];
    createdAt: string;
    updatedAt: string;
    lastUsedAt?: string;
}
export declare function agentsDir(): string;
export declare function isValidAgentId(id: string): boolean;
/** List all agent profiles (no description body). Ordered by lastUsedAt desc, then name. */
export declare function listAgentProfiles(): AgentProfileMeta[];
/** Top N profiles for right-click spawn (recent first; cold start alphabetical via list sort). */
export declare function topAgentProfiles(limit?: number): AgentProfileMeta[];
export declare function readAgentProfile(id: string): AgentProfile | null;
export declare function createAgentProfile(input: {
    id: string;
    name: string;
    role: string;
    descriptionMd: string;
    defaultSkillIds?: string[];
}): AgentProfile;
export declare function updateAgentProfile(id: string, input: {
    name: string;
    role: string;
    descriptionMd: string;
    defaultSkillIds?: string[];
}): AgentProfile;
export declare function deleteAgentProfile(id: string): void;
/** Bump recency for spawn / mail commit (T2). */
export declare function touchAgentProfileRecent(id: string): void;
/** Standing instructions block appended to the Melon system prompt for specialized boxes. */
export declare function formatAgentStandingInstructions(profile: {
    id: string;
    name: string;
    role: string;
    descriptionMd: string;
}): string;
//# sourceMappingURL=agents.d.ts.map