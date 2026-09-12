import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadSettings, saveSettings } from "./settings.ts";

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

const VALID_AGENT_ID = /^[a-z0-9-]+$/;

export function agentsDir(): string {
	return join(getAgentDir(), "agents");
}

function agentDir(id: string): string {
	return join(agentsDir(), id);
}

function profilePath(id: string): string {
	return join(agentDir(id), "profile.json");
}

function descriptionPath(id: string): string {
	return join(agentDir(id), "description.md");
}

export function isValidAgentId(id: string): boolean {
	return VALID_AGENT_ID.test(id) && id.length > 0 && id.length <= 64;
}

function nowIso(): string {
	return new Date().toISOString();
}

function readMeta(id: string): AgentProfileMeta | null {
	const p = profilePath(id);
	if (!existsSync(p)) return null;
	try {
		const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<AgentProfileMeta>;
		if (!raw || typeof raw !== "object") return null;
		const name = typeof raw.name === "string" ? raw.name.trim() : "";
		const role = typeof raw.role === "string" ? raw.role.trim() : "";
		if (!name) return null;
		const defaultSkillIds = Array.isArray(raw.defaultSkillIds)
			? raw.defaultSkillIds.filter((x): x is string => typeof x === "string")
			: [];
		return {
			id,
			name,
			role,
			defaultSkillIds,
			createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
			updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
			...(typeof raw.lastUsedAt === "string" ? { lastUsedAt: raw.lastUsedAt } : {}),
		};
	} catch {
		return null;
	}
}

function writeMeta(meta: AgentProfileMeta): void {
	mkdirSync(agentDir(meta.id), { recursive: true });
	writeFileSync(profilePath(meta.id), `${JSON.stringify(meta, null, "\t")}\n`);
}

/** List all agent profiles (no description body). Ordered by lastUsedAt desc, then name. */
export function listAgentProfiles(): AgentProfileMeta[] {
	const dir = agentsDir();
	if (!existsSync(dir)) return [];
	const rows: AgentProfileMeta[] = [];
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		const meta = readMeta(entry.name);
		if (meta) rows.push(meta);
	}
	rows.sort((a, b) => {
		const aT = a.lastUsedAt ?? "";
		const bT = b.lastUsedAt ?? "";
		if (aT !== bT) return bT.localeCompare(aT);
		return a.name.localeCompare(b.name);
	});
	return rows;
}

/** Top N profiles for right-click spawn (recent first; cold start alphabetical via list sort). */
export function topAgentProfiles(limit = 5): AgentProfileMeta[] {
	return listAgentProfiles().slice(0, Math.max(0, limit));
}

export function readAgentProfile(id: string): AgentProfile | null {
	const meta = readMeta(id);
	if (!meta) return null;
	const descFile = descriptionPath(id);
	const descriptionMd = existsSync(descFile) ? readFileSync(descFile, "utf8") : "";
	return {
		...meta,
		descriptionPath: descFile,
		descriptionMd,
	};
}

export function createAgentProfile(input: {
	id: string;
	name: string;
	role: string;
	descriptionMd: string;
	defaultSkillIds?: string[];
}): AgentProfile {
	const id = input.id.trim();
	if (!isValidAgentId(id)) throw Object.assign(new Error("invalid agent id"), { statusCode: 400 });
	if (readMeta(id)) throw Object.assign(new Error(`An agent named "${id}" already exists`), { statusCode: 409 });
	const name = input.name.trim();
	const role = input.role.trim();
	if (!name) throw Object.assign(new Error("name is required"), { statusCode: 400 });
	const ts = nowIso();
	const meta: AgentProfileMeta = {
		id,
		name,
		role,
		defaultSkillIds: input.defaultSkillIds ?? [],
		createdAt: ts,
		updatedAt: ts,
	};
	writeMeta(meta);
	writeFileSync(descriptionPath(id), input.descriptionMd);
	return readAgentProfile(id)!;
}

export function updateAgentProfile(
	id: string,
	input: {
		name: string;
		role: string;
		descriptionMd: string;
		defaultSkillIds?: string[];
	},
): AgentProfile {
	const existing = readMeta(id);
	if (!existing) throw Object.assign(new Error(`unknown agent: ${id}`), { statusCode: 404 });
	const name = input.name.trim();
	const role = input.role.trim();
	if (!name) throw Object.assign(new Error("name is required"), { statusCode: 400 });
	const meta: AgentProfileMeta = {
		...existing,
		name,
		role,
		defaultSkillIds: input.defaultSkillIds ?? existing.defaultSkillIds,
		updatedAt: nowIso(),
	};
	writeMeta(meta);
	writeFileSync(descriptionPath(id), input.descriptionMd);
	return readAgentProfile(id)!;
}

export function deleteAgentProfile(id: string): void {
	if (!isValidAgentId(id)) throw Object.assign(new Error("invalid agent id"), { statusCode: 400 });
	rmSync(agentDir(id), { recursive: true, force: true });
	const s = loadSettings();
	if (s.agentProfileRecentIds?.includes(id)) {
		s.agentProfileRecentIds = s.agentProfileRecentIds.filter((x) => x !== id);
		saveSettings(s);
	}
}

/** Bump recency for spawn / mail commit (T2). */
export function touchAgentProfileRecent(id: string): void {
	const meta = readMeta(id);
	if (!meta) return;
	const ts = nowIso();
	writeMeta({ ...meta, lastUsedAt: ts, updatedAt: meta.updatedAt });
	const s = loadSettings();
	s.agentProfileRecentIds = [id, ...(s.agentProfileRecentIds ?? []).filter((x) => x !== id)].slice(0, 20);
	saveSettings(s);
}

/** Standing instructions block appended to the Melon system prompt for specialized boxes. */
export function formatAgentStandingInstructions(profile: {
	id: string;
	name: string;
	role: string;
	descriptionMd: string;
}): string {
	const roleLine = profile.role.trim() ? `Role: ${profile.role.trim()}` : null;
	const body = profile.descriptionMd.trim() || "(no description.md yet — ask the user what this agent should do)";
	return [
		`[Melon agent profile: ${profile.name} (id: ${profile.id})]`,
		roleLine,
		"Standing instructions for THIS box — follow them every turn in this session:",
		"",
		body,
	]
		.filter((line): line is string => line != null)
		.join("\n");
}
