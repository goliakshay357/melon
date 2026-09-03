/* pi-bash-enhanced: rendering functions. */

import { Text as TuiText } from "@earendil-works/pi-tui";
import { type AgentToolResult, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { BG_ERROR, FG_DIM, RST, TOOL_RESULT_INDENT, fillToolBackground, renderToolDuration } from "./config.js";

type BashDetails = {
	_type: "bashResult";
	text: string;
	exitCode: number;
	command: string;
};

type RenderContext = {
	lastComponent?: any;
	expanded?: boolean;
	isError?: boolean;
	state?: any;
	rw?: number;
};

type ThemeLike = {
	fg(key: string, text: string): string;
	bold(text: string): string;
};

function getTextContent(result: AgentToolResult<Record<string, unknown>>): string {
	return (result.content ?? [])
		.filter((c: any) => c.type === "text")
		.map((c: any) => c.text ?? "")
		.join("\n");
}

function renderToolError(error: string, theme: ThemeLike): string {
	const body = error
		.split("\n")
		.filter((line) => line.trim() && !line.includes("warning:") && !line.includes("error:"))
		.map((line) => `${TOOL_RESULT_INDENT}${theme.fg("error", line.trim())}`)
		.join("\n");
	return fillToolBackground(body, BG_ERROR);
}

export function makeRenderCall(toolName: string) {
	return (args: Record<string, unknown>, theme: ThemeLike, ctx: RenderContext) => {
		const text = ctx.lastComponent ?? new TuiText("", 0, 0);
		const bg = ctx.isError ? BG_ERROR : undefined;
		text.setText(fillToolBackground(`${theme.fg("toolTitle", theme.bold(toolName))}`, bg));
		return text;
	};
}

export function makeRenderResult() {
	return (result: AgentToolResult<Record<string, unknown>>, _opt: unknown, theme: ThemeLike, ctx: RenderContext) => {
		const text = ctx.lastComponent ?? new TuiText("", 0, 0);
		if (ctx.isError) {
			text.setText(renderToolError(getTextContent(result) || "Error", theme));
			return text;
		}
		const content = getTextContent(result);
		if (content) {
			const renderWidth = process.stdout.columns || 80;
			const lines = content.split("\n");
			const maxShow = ctx.expanded ? lines.length : Math.min(lines.length, 80);
			const preview = lines.slice(0, maxShow).join("\n");
			const more = lines.length > maxShow ? `\n${FG_DIM}... ${lines.length - maxShow} more lines${RST}` : "";
			const metrics = renderToolDuration(result);
			text.setText(
				fillToolBackground(
					`${TOOL_RESULT_INDENT}${preview}${more}${metrics ? `\n${TOOL_RESULT_INDENT}${metrics}` : ""}`,
					undefined,
					renderWidth,
				),
			);
		} else {
			text.setText(fillToolBackground(`${TOOL_RESULT_INDENT}${theme.fg("dim", "(no text output)")}`));
		}
		return text;
	};
}