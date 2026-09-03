import { homedir } from "node:os";
function env(name, fallback) {
    const value = process.env[name];
    return value?.trim() ? value.trim() : fallback;
}
export function loadConfig(overrides = {}) {
    return {
        port: Number(env("MELON_PORT", "8788")),
        defaultModel: env("MELON_DEFAULT_MODEL", "opencode-go/deepseek-v4-flash"),
        defaultThinkingLevel: env("MELON_DEFAULT_THINKING", "high"),
        defaultCwd: overrides.defaultCwd ?? env("MELON_DEFAULT_CWD", "~/Desktop/workspace/melon"),
    };
}
export function expandHome(dir) {
    return dir.startsWith("~") ? dir.replace("~", homedir()) : dir;
}
/** Truncated string/JSON preview for tool payloads. */
export function preview(value, max = 1500) {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    if (!text)
        return "";
    return text.length > max ? `${text.slice(0, max)}…(+${text.length - max} chars)` : text;
}
export function modelToString(model) {
    const m = model;
    return m ? `${m.provider ?? "?"}/${m.id ?? "?"}` : "unknown";
}
//# sourceMappingURL=config.js.map