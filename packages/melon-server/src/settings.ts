import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface MelonSettings {
	lastModel?: string;
	recentModels?: string[];
	defaultThinkingLevel?: string;
	providerKeys?: Record<string, string>;
	/** Models the provider rejected ("not supported") — hidden from the picker. */
	denylistedModels?: string[];
	/** Melon web UI theme id (e.g. moonfly). Survives webview storage resets. */
	theme?: string;
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
	// Selecting a working model clears it from the denylist if it was there.
	if (s.denylistedModels?.includes(model)) {
		s.denylistedModels = s.denylistedModels.filter((m) => m !== model);
	}
	saveSettings(s);
}

/** Denylist a model that the provider rejected, so it stops showing in the picker. */
export function denylistModel(model: string): void {
	const s = loadSettings();
	s.denylistedModels = [...new Set([...(s.denylistedModels ?? []), model])];
	saveSettings(s);
}

/** Clear all denylisted models of one provider (e.g. after a valid key was added —
 * models that failed pre-key must not stay hidden forever). */
export function clearProviderDenylist(provider: string): void {
	const s = loadSettings();
	if (!s.denylistedModels?.length) return;
	const prefix = `${provider}/`;
	const next = s.denylistedModels.filter((m) => !m.startsWith(prefix));
	if (next.length === s.denylistedModels.length) return;
	s.denylistedModels = next;
	saveSettings(s);
}

/** Single source of truth for the default model of NEW sessions. */
export function getDefaultModel(fallback: string): string {
	return loadSettings().lastModel || fallback;
}
