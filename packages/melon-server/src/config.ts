import { homedir } from "node:os";

function env(name: string, fallback: string): string {
	const value = process.env[name];
	return value?.trim() ? value.trim() : fallback;
}

export interface MelonConfig {
	readonly port: number;
	/** provider/model-id used for new cards, e.g. "opencode-go/ox-alpha-free" */
	readonly defaultModel: string;
	readonly defaultThinkingLevel: "minimal" | "low" | "medium" | "high";
	/** Used when a client attaches a card without an explicit cwd. */
	readonly defaultCwd: string;
}

export function loadConfig(overrides: Partial<MelonConfig> = {}): MelonConfig {
	return {
		port: Number(env("MELON_PORT", "8788")),
		defaultModel: env("MELON_DEFAULT_MODEL", "opencode-go/deepseek-v4-flash"),
		defaultThinkingLevel: env("MELON_DEFAULT_THINKING", "high") as MelonConfig["defaultThinkingLevel"],
		defaultCwd: overrides.defaultCwd ?? env("MELON_DEFAULT_CWD", "~/Desktop/workspace/melon"),
	};
}

export function expandHome(dir: string): string {
	return dir.startsWith("~") ? dir.replace("~", homedir()) : dir;
}

/** Truncated string/JSON preview for tool payloads. */
export function preview(value: unknown, max = 1500): string {
	const text = typeof value === "string" ? value : JSON.stringify(value);
	if (!text) return "";
	return text.length > max ? `${text.slice(0, max)}…(+${text.length - max} chars)` : text;
}

export function modelToString(model: unknown): string {
	const m = model as { provider?: string; id?: string } | undefined;
	return m ? `${m.provider ?? "?"}/${m.id ?? "?"}` : "unknown";
}
