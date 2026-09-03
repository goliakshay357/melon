/* pi-integrated-read: enhanced read tool with syntax highlighting and inline image support. */

import type { AgentToolResult, ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { type BundledLanguage } from "shiki";
import {
	BG_BASE,
	BG_ERROR,
	FG_DIM,
	FG_LNUM,
	FG_RULE,
	RST,
	resolveBaseBackground,
	TOOL_RESULT_INDENT,
	termWidth,
} from "../config.js";
import { normalizeLineEndings, shortPath } from "../helpers.js";
import { fillToolBackground, renderToolError } from "../render.js";
import { resolveTextCtor } from "../tui-text.js";
import type { ReadDetails, RenderCtxLike, SdkToolDef, TextContent, ThemeLike } from "../types.js";
import { wrapExecuteWithMetrics } from "./metrics.js";

type Result = AgentToolResult<Record<string, unknown>>;

function getText(result: Result): string {
	return (
		((result.content ?? []) as TextContent[])
			.filter((c) => c.type === "text")
			.map((c) => c.text)
			.join("\n") ?? ""
	);
}

export function registerReadEnhancedTool(
	pi: ExtensionAPI,
	cwd: string,
	_fffService: unknown,
	sdkTool: SdkToolDef,
	TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void },
): void {
	const TC = resolveTextCtor(TextComp);
	const home = process.env.HOME ?? "";

	pi.registerTool({
		name: "read",
		label: "Read",
		description: sdkTool.description ?? "Read file contents with syntax highlighting",
		parameters: sdkTool.parameters,
		renderShell: "self",

	execute: wrapExecuteWithMetrics(async (tid, params, sig, _upd, ctx: ExtensionContext) => {
		const p = params as any;
		const result = (await sdkTool.execute(tid, p, sig, undefined, ctx)) as Result;

		const imageBlock = (result.content as any[])?.find((c: any) => c.type === "image");
		if (imageBlock) {
			result.details = {
				_type: "readImage",
				filePath: String(p.path ?? ""),
			} as ReadDetails;
			return result;
		}

		const tc = normalizeLineEndings(getText(result));
		result.details = {
			_type: "readFile",
			filePath: String(p.path ?? ""),
			content: tc,
			offset: typeof p.offset === "number" ? p.offset : 0,
			lineCount: tc ? tc.split("\n").length : 0,
		} as ReadDetails;
		return result;
	}),

	renderCall(args: any, theme: ThemeLike, ctx: RenderCtxLike) {
		resolveBaseBackground(theme);
		const text = ctx.lastComponent ?? new TC("", 0, 0);
		if (!ctx.isError) {
			text.setText("");
			return text;
		}

		const path = String(args.path ?? "");
		const label = theme.fg("error", theme.bold("→ read"));
		text.setText(fillToolBackground(`\n${TOOL_RESULT_INDENT}${label} ${theme.fg("toolTitle", path)}\n`, BG_ERROR));
		return text;
	},

	renderResult(result: Result, _opt: unknown, theme: ThemeLike, ctx: RenderCtxLike) {
		resolveBaseBackground(theme);
		const text = ctx.lastComponent ?? new TC("", 0, 0);

		if (ctx.isError) {
			text.setText(fillToolBackground(renderToolError(getText(result) || "Error", theme), BG_ERROR));
			return text;
		}

		const d = result.details as ReadDetails | undefined;

		// Image content is preserved for ToolExecution's host-generic image pass.
		// Keep the SDK's text note visible as a fallback when host images are hidden
		// or unsupported by the terminal.
		if (d?._type === "readImage") {
			const note = getText(result);
			text.setText(note ? fillToolBackground(note, BG_BASE) : "");
			return text;
		}

		// File content — line-numbered display
		if (d?._type === "readFile" && d.content) {
			const tw = termWidth();
			const lines = d.content.split("\n");
			const total = lines.length;
			const filePath = String(d.filePath ?? "");
			const p2 = shortPath(cwd, home, filePath);
			const off2 = typeof d.offset === "number" ? `:${d.offset}` : "";
			if (!ctx.expanded) {
				text.setText(
					fillToolBackground(
						`\n${TOOL_RESULT_INDENT}${theme.fg("toolTitle", theme.bold("→ read"))} ${theme.fg("toolTitle", p2)}${theme.fg("dim", off2)}
${TOOL_RESULT_INDENT}${FG_DIM}${total} lines — ctrl+o to expand${RST}\n`,
						BG_BASE,
					),
				);
				return text;
			}
			const maxShow = lines.length;
			const show = lines.slice(0, maxShow);
			const nw = Math.max(3, String((d.offset || 0) + total).length);
			const gw = nw + 3;
			const cw = Math.max(1, tw - gw);

			const header = `${theme.fg("toolTitle", theme.bold("→ read"))} ${theme.fg("toolTitle", p2)}${theme.fg("dim", off2)}`;
			const out: string[] = ["", `${TOOL_RESULT_INDENT}${header}`];
			out.push(`${TOOL_RESULT_INDENT}${FG_RULE}${"─".repeat(Math.max(1, tw - 1))}${RST}`);
			for (let i = 0; i < show.length; i++) {
				const ln = (d.offset || 0) + i + 1;
				const code = show[i] ?? "";
				const display = code.length > cw ? code.slice(0, Math.max(0, cw - 1)) + `${FG_DIM}›${RST}` : code;
				const lineNo = String(ln);
				out.push(
					`${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} ${display}${RST}`,
				);
			}
			if (total > maxShow) {
				out.push(`${TOOL_RESULT_INDENT}${FG_DIM}… ${total - maxShow} more lines (${total} total)${RST}`);
			}
			out.push("");
			const rendered = out.join("\n");
			text.setText(fillToolBackground(rendered, BG_BASE));
			(ctx as any).state._rt = rendered;

			// Async syntax highlighting via Shiki
			const hlPromise = (async () => {
				try {
					const shiki = await import("shiki");
					const themeName = "github-dark";
					const highlighter = await shiki.getHighlighter({ theme: themeName });
					const ext = filePath.split(".").pop();
					const lang = ext && supportedLanguages[ext] ? supportedLanguages[ext] : undefined;
					const html = highlighter.codeToHtml(d.content, { lang });
					// Convert HTML to plain text with ANSI colors (simplified)
					const ansiLines = html
						.replace(/<span style="color: #([0-9a-fA-F]{6})">/g, (m, color) => `\x1b[38;2;${parseInt(color.substr(0,2),16)};${parseInt(color.substr(2,2),16)};${parseInt(color.substr(4,2),16)}m")
						.replace(/<\/span>/g, "\x1b[39m")
						.replace(/<br\s*\/?>/g, "\n")
						.replace(/<[^>]*>/g, "")
						.split("\n");
					for (let i = 0; i < Math.min(ansiLines.length, show.length); i++) {
						const ln = (d.offset || 0) + i + 1;
						const lineNo = String(ln);
						const ansiLine = ansiLines[i] || "";
						out[i] = `${TOOL_RESULT_INDENT}${FG_LNUM}${" ".repeat(Math.max(0, nw - lineNo.length))}${lineNo}${RST} ${FG_RULE}│${RST} ${ansiLine}${RST}`;
					}
					text.setText(fillToolBackground(out.join("\n"), BG_BASE));
					(ctx as any).state._rt = out.join("\n");
				} catch {
					// Shiki not available or error — keep plain text
				}
			})();

			return text;
		}

		const fc = result.content?.[0];
		text.setText(
			fillToolBackground(
				`${TOOL_RESULT_INDENT}${theme.fg("dim", fc && "text" in fc ? String(fc.text).slice(0, 120) : "done")}`,
				BG_BASE,
			),
		);
		return text;
	},
} as unknown as ToolDefinition<any, any, any>;

const supportedLanguages: Record<string, string> = {
	.ts: "typescript",
	.tsx: "typescript",
	.js: "javascript",
	.jsx: "javascript",
	.mjs: "javascript",
	.cjs: "javascript",
	.json: "json",
	.md: "markdown",
	.css: "css",
	.html: "html",
	.jsx: "jsx",
	.tsx: "tsx",
	.py: "python",
	.java: "java",
	.cpp: "cpp",
	.cc: "cpp",
	.cxx: "cpp",
	.c: "c",
	.h: "c",
	.hpp: "cpp",
	.cs: "csharp",
	.php: "php",
	.rs: "rust",
	.go: "go",
	.rb: "ruby",
	.sql: "sql",
	xml: "xml",
	yaml: "yaml",
	yml: "yaml",
	.toml: "toml",
	.sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "fish",
	ps1: "powershell",
};