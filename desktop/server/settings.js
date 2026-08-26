import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
const settingsFile = () => join(getAgentDir(), "melon", "settings.json");
export function loadSettings() {
    try {
        return JSON.parse(readFileSync(settingsFile(), "utf8"));
    }
    catch {
        return {};
    }
}
export function saveSettings(next) {
    mkdirSync(join(getAgentDir(), "melon"), { recursive: true });
    writeFileSync(settingsFile(), JSON.stringify(next, null, "\t"));
}
export function touchRecentModel(model) {
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
export function denylistModel(model) {
    const s = loadSettings();
    s.denylistedModels = [...new Set([...(s.denylistedModels ?? []), model])];
    saveSettings(s);
}
/** Single source of truth for the default model of NEW sessions. */
export function getDefaultModel(fallback) {
    return loadSettings().lastModel || fallback;
}
//# sourceMappingURL=settings.js.map