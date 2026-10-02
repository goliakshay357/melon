import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DefaultPackageManager, getAgentDir, SettingsManager } from "@earendil-works/pi-coding-agent";
// ---------------------------------------------------------------------------
// Web access config (pi-web-access's web-search.json, next to the agent dir)
// ---------------------------------------------------------------------------
const webSearchConfigFile = () => join(getAgentDir(), "web-search.json");
export function loadWebSearchConfig() {
    try {
        return JSON.parse(readFileSync(webSearchConfigFile(), "utf8"));
    }
    catch {
        return {};
    }
}
/** Merge a partial config over the existing web-search.json. */
export function saveWebSearchConfig(patch) {
    const next = { ...loadWebSearchConfig(), ...patch };
    writeFileSync(webSearchConfigFile(), JSON.stringify(next, null, "\t"));
    return next;
}
// ---------------------------------------------------------------------------
// Pi package management (extensions manager)
// ---------------------------------------------------------------------------
function createPackageManager() {
    const agentDir = getAgentDir();
    return new DefaultPackageManager({
        cwd: agentDir,
        agentDir,
        settingsManager: SettingsManager.create(agentDir, agentDir),
    });
}
export function listPackages() {
    return createPackageManager().listConfiguredPackages();
}
export async function installPackage(source) {
    const pm = createPackageManager();
    await pm.installAndPersist(source);
    return listPackages();
}
export async function removePackage(source) {
    const pm = createPackageManager();
    const removed = await pm.removeAndPersist(source);
    return { removed, packages: listPackages() };
}
export async function updatePackages(source) {
    const pm = createPackageManager();
    await pm.update(source);
    return listPackages();
}
//# sourceMappingURL=extensions.js.map