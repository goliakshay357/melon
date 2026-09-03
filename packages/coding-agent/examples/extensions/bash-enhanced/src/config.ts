/* pi-bash-enhanced: configuration helpers. */

import type { BundledTheme } from "shiki";

export function resolveBaseBackground(theme: any): void {
	const bg = theme.getBgAnsi?.("toolPendingBg");
	if (bg) process.stdout.write(bg);
}

export const TOOL_RESULT_INDENT = " ";

export function termWidth(): number {
	return process.stdout.columns || 80;
}

export function loadConfig(): { theme?: string; background?: { tool?: string; error?: string } } {
	// Minimal config for bash-enhanced
	try {
		const home = process.env.HOME;
		if (!home) return {};
		const settings = JSON.parse(require("node:fs").readFileSync(require("node:path").join(home, ".pi/agent/settings.json"), "utf8"));
		return {
			theme: typeof settings.theme === "string" ? settings.theme : undefined,
			background: settings.background || {},
		};
	} catch {
		return {};
	}
}

export const BG_ERROR = "\x1b[48;2;42;1;6m";
export const FG_DIM = "\x1b[38;2;139;148;158m";
export const FG_BLUE = "\x1b[38;2;59;130;246m";
export const FG_YELLOW = "\x1b[38;2;250;204;21m";
export const FG_LNUM = "\x1b[38;2;99;102;241m";
export const FG_RULE = "\x1b[38;2;156;163;175m";
export const RST = "\x1b[0m";

export const DEFAULT_THEME: BundledTheme = "github-dark";

export const CACHE_LIMIT = 128;