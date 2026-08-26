import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface MelonSettings {
	lastModel?: string;
	recentModels?: string[];
	defaultThinkingLevel?: string;
	providerKeys?: Record<string, string>;
}

const settingsFile = () => join(getAgentDir(), "melon", "settings.json");

export function loadSettings(): MelonSettings {
	try {
		return JSON.parse(readFileSync(settingsFile(), "utf8")) as MelonSettings;
	} catch {
		return {};
	}
}

export function saveSettings(next: MelonSettings): void {
	mkdirSync(join(getAgentDir(), "melon"), { recursive: true });
	writeFileSync(settingsFile(), JSON.stringify(next, null, "\t"));
}

export function touchRecentModel(model: string): void {
	const s = loadSettings();
	s.lastModel = model;
	s.recentModels = [model, ...(s.recentModels ?? []).filter((m) => m !== model)].slice(0, 5);
	saveSettings(s);
}
