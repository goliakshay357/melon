import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";

/** Mirror of pi's `ConfiguredPackage` (not re-exported by the package root). */
interface ConfiguredPackage {
	source: string;
	scope: "user" | "project";
	filtered: boolean;
	installedPath?: string;
}

// ---------------------------------------------------------------------------
// Web access config (pi-web-access's web-search.json, next to the agent dir)
// ---------------------------------------------------------------------------

const webSearchConfigFile = () => join(getAgentDir(), "web-search.json");

export function loadWebSearchConfig(): Record<string, unknown> {
	try {
		return JSON.parse(readFileSync(webSearchConfigFile(), "utf8")) as Record<string, unknown>;
	} catch {
		return {};
	}
}

/** Merge a partial config over the existing web-search.json. */
export function saveWebSearchConfig(patch: Record<string, unknown>): Record<string, unknown> {
	const next = { ...loadWebSearchConfig(), ...patch };
	writeFileSync(webSearchConfigFile(), JSON.stringify(next, null, "\t"));
	return next;
}

// ---------------------------------------------------------------------------
// Pi package management (extensions manager)
// ---------------------------------------------------------------------------

function createPackageManager(): DefaultPackageManager {
	const agentDir = getAgentDir();
	return new DefaultPackageManager({
		cwd: agentDir,
		agentDir,
		settingsManager: SettingsManager.create(agentDir, agentDir),
	});
}

export function listPackages(): ConfiguredPackage[] {
	return createPackageManager().listConfiguredPackages();
}

export async function installPackage(source: string): Promise<ConfiguredPackage[]> {
	const pm = createPackageManager();
	await pm.installAndPersist(source);
	return listPackages();
}

export async function removePackage(source: string): Promise<{ removed: boolean; packages: ConfiguredPackage[] }> {
	const pm = createPackageManager();
	const removed = await pm.removeAndPersist(source);
	return { removed, packages: listPackages() };
}

export async function updatePackages(source?: string): Promise<ConfiguredPackage[]> {
	const pm = createPackageManager();
	await pm.update(source);
	return listPackages();
}
