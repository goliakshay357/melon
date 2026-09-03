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
const DROP_ARG_KEYS = new Set([
    "content",
    "contents",
    "new_string",
    "old_string",
    "newString",
    "oldString",
    "file_text",
    "diff",
]);
/**
 * Compact tool args for the Melon GUI (path/command/pattern/etc.).
 * Drops huge body fields so the client does not re-parse truncated JSON.
 */
export function structuredToolArgs(args) {
    if (!args || typeof args !== "object" || Array.isArray(args))
        return undefined;
    const out = {};
    for (const [key, value] of Object.entries(args)) {
        if (DROP_ARG_KEYS.has(key))
            continue;
        if (typeof value === "string") {
            out[key] = value.length > 400 ? `${value.slice(0, 400)}…` : value;
        }
        else if (typeof value === "number" || typeof value === "boolean" || value === null) {
            out[key] = value;
        }
    }
    return Object.keys(out).length > 0 ? out : undefined;
}
/** Prefer plain text from tool results; fall back to JSON preview. */
export function toolTextPreview(value, max = 8000) {
    if (typeof value === "string")
        return preview(value, max);
    if (value && typeof value === "object") {
        const record = value;
        if (typeof record.text === "string")
            return preview(record.text, max);
        if (Array.isArray(record.content)) {
            const text = record.content
                .filter((block) => !!block &&
                typeof block === "object" &&
                block.type === "text" &&
                typeof block.text === "string")
                .map((block) => block.text)
                .join("\n");
            if (text)
                return preview(text, max);
        }
    }
    return preview(value, max);
}
export function modelToString(model) {
    const m = model;
    return m ? `${m.provider ?? "?"}/${m.id ?? "?"}` : "unknown";
}
//# sourceMappingURL=config.js.map