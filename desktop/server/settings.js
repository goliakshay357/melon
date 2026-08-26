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
    saveSettings(s);
}
//# sourceMappingURL=settings.js.map