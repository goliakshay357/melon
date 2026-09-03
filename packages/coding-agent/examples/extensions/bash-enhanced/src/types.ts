/* pi-bash-enhanced: type definitions. */

import type { ExtensionAPI, ExtensionContext, ToolDefinition } from "@earendil-works/pi-coding-agent";

export interface BashDetails {
	_type: "bashResult";
	text: string;
	exitCode: number;
	command: string;
}

export interface SdkToolDef {
	name: string;
	description?: string;
	parameters: any;

	execute(tid: string, params: any, sig: AbortSignal, upd?: any, ctx?: ExtensionContext): Promise<any>;
}

export interface RenderCtxLike {
	lastComponent?: any;
	expanded?: boolean;
	isError?: boolean;
	state?: any;
	rw?: number;
}

export interface ThemeLike {
	fg(key: string, text: string): string;
	bold(text: string): string;
}

export interface ComponentLike {
	render?(width: number): string[];
}

export interface TextContent {
	type: "text";
	text?: string;
}

export interface PiPrettyDeps {
	sdk?: {
		createReadToolDefinition?: (cwd: string) => SdkToolDef;
		createBashToolDefinition?: (cwd: string) => SdkToolDef;
		createLsToolDefinition?: (cwd: string) => SdkToolDef;
		createFindToolDefinition?: (cwd: string) => SdkToolDef;
		createGrepToolDefinition?: (cwd: string) => SdkToolDef;
		getAgentDir?: () => string;
	};
	fffModule?: any;
	TextComponent?: new (t?: string, x?: number, y?: number) => { setText(v: string): void };
}

export interface AgentToolResult<T> {
	content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError?: boolean;
	details?: T;
}

export type Result = AgentToolResult<Record<string, unknown>>;