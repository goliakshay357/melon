// Custom model catalog management for the Melon GUI.
//
// Custom models live in the coding agent's models.json (getAgentDir()/models.json)
// so Melon and the terminal TUI share one source of truth. This module validates
// GUI input and upserts entries; the ModelRuntime picks changes up via refresh().

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/** Custom model entry accepted from the Melon GUI (models.json `models[]` shape). */
export interface CustomModelInput {
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

export function modelsJsonPath(): string {
	return join(getAgentDir(), "models.json");
}

interface ModelsJsonProviderConfig {
	models?: unknown[];
	[key: string]: unknown;
}

interface ModelsJson {
	providers?: Record<string, ModelsJsonProviderConfig>;
	[key: string]: unknown;
}

/**
 * models.json allows JSONC (pi's ModelConfig strips comments), so parsing must
 * too — e.g. ~/.melon/agent/models.json ships with // comment blocks.
 */
function stripJsonComments(text: string): string {
	let out = "";
	let inString = false;
	let escaped = false;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		const next = text[i + 1];
		if (inString) {
			out += ch;
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') {
			inString = true;
			out += ch;
			continue;
		}
		if (ch === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
			i++;
			continue;
		}
		out += ch;
	}
	return out;
}

function readModelsJson(): ModelsJson {
	const path = modelsJsonPath();
	if (!existsSync(path)) return {};
	try {
		const parsed: unknown = JSON.parse(stripJsonComments(readFileSync(path, "utf8")));
		return parsed && typeof parsed === "object" ? (parsed as ModelsJson) : {};
	} catch (e) {
		throw new Error(`${path} is not valid JSON: ${(e as Error).message}. Fix or remove the file, then try again.`);
	}
}

function writeModelsJson(config: ModelsJson): void {
	const path = modelsJsonPath();
	mkdirSync(dirname(path), { recursive: true });
	const tmp = `${path}.tmp-${process.pid}`;
	writeFileSync(tmp, `${JSON.stringify(config, null, "\t")}\n`);
	renameSync(tmp, path);
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Numeric form fields may arrive as strings; accept "200000" like 200000. */
function toPositiveInt(value: unknown): number | undefined {
	if (typeof value === "string" && value.trim() !== "") value = Number(value.trim());
	return isPositiveInt(value) ? value : undefined;
}

/** Validate a GUI "add model" payload; returns the models.json entry to upsert. */
export function parseCustomModelInput(body: unknown): CustomModelInput {
	const raw = (body ?? {}) as Record<string, unknown>;
	const id = typeof raw.id === "string" ? raw.id.trim() : "";
	if (!id) throw new Error("Model ID is required.");
	if (/\s/.test(id)) throw new Error(`Invalid model ID "${id}": no whitespace allowed.`);
	const out: CustomModelInput = { id };
	if (typeof raw.name === "string" && raw.name.trim()) out.name = raw.name.trim();
	if (raw.reasoning !== undefined) {
		if (typeof raw.reasoning !== "boolean") throw new Error("reasoning must be a boolean.");
		out.reasoning = raw.reasoning;
	}
	if (raw.contextWindow !== undefined) {
		const contextWindow = toPositiveInt(raw.contextWindow);
		if (contextWindow === undefined) throw new Error("Context window must be a positive integer.");
		out.contextWindow = contextWindow;
	}
	if (raw.maxTokens !== undefined) {
		const maxTokens = toPositiveInt(raw.maxTokens);
		if (maxTokens === undefined) throw new Error("Max output tokens must be a positive integer.");
		out.maxTokens = maxTokens;
	}
	return out;
}

/** Upsert one model into `providers[providerId].models` (replaces same-id entries). */
export function upsertCustomModel(providerId: string, model: CustomModelInput): void {
	const config = readModelsJson();
	const providers = { ...config.providers };
	const existing = providers[providerId] ?? {};
	const models = (Array.isArray(existing.models) ? [...existing.models] : []).filter(
		(m) => !(m && typeof m === "object" && (m as { id?: unknown }).id === model.id),
	);
	models.push(model);
	providers[providerId] = { ...existing, models };
	writeModelsJson({ ...config, providers });
}

export interface CustomModelEntry {
	provider: string;
	id: string;
	name?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

/** All custom models added via the GUI, across providers. */
export function listCustomModels(): CustomModelEntry[] {
	let config: ModelsJson;
	try {
		config = readModelsJson();
	} catch {
		return [];
	}
	const out: CustomModelEntry[] = [];
	for (const [provider, providerConfig] of Object.entries(config.providers ?? {})) {
		if (!Array.isArray(providerConfig.models)) continue;
		for (const raw of providerConfig.models) {
			if (!raw || typeof raw !== "object") continue;
			const m = raw as Record<string, unknown>;
			const id = typeof m.id === "string" ? m.id : "";
			if (!id) continue;
			out.push({
				provider,
				id,
				...(typeof m.name === "string" && m.name.trim() ? { name: m.name.trim() } : {}),
				...(typeof m.reasoning === "boolean" ? { reasoning: m.reasoning } : {}),
				...(typeof m.contextWindow === "number" ? { contextWindow: m.contextWindow } : {}),
				...(typeof m.maxTokens === "number" ? { maxTokens: m.maxTokens } : {}),
			});
		}
	}
	return out;
}

/** Remove one custom model; returns true when an entry was removed. */
export function removeCustomModel(providerId: string, modelId: string): boolean {
	const config = readModelsJson();
	const providerConfig = config.providers?.[providerId];
	if (!providerConfig || !Array.isArray(providerConfig.models)) return false;
	const before = providerConfig.models.length;
	const models = providerConfig.models.filter(
		(m) => !(m && typeof m === "object" && (m as { id?: unknown }).id === modelId),
	);
	if (models.length === before) return false;
	const providers = { ...config.providers, [providerId]: { ...providerConfig, models } };
	writeModelsJson({ ...config, providers });
	return true;
}
