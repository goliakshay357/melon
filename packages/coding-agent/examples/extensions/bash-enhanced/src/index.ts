/**
 * pi-bash-enhanced — Enhanced bash tool with pi-pretty-like rendering.
 *
 * This extension overrides the built-in bash tool to provide:
 *   • Color-coded exit status summaries (exit 0 vs exit 1)
 *   • Collapsible output preview with line count headers
 *   • Enhanced error display
 *   • Command truncation when collapsed
 */

import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerBashEnhancedTool } from "./tools/bash-enhanced.js";
import type { PiPrettyDeps, SdkTools } from "./types.js";

// Pi aliases static SDK imports to its host package for managed extensions.
// Native dynamic imports bypass that alias because the managed npm root omits
// Pi peer dependencies.

const sdk: SdkTools = {
	createReadToolDefinition: require("@earendil-works/pi-coding-agent").createReadToolDefinition,
	createBashToolDefinition: require("@earendil-works/pi-coding-agent").createBashToolDefinition,
	createLsToolDefinition: require("@earendil-works/pi-coding-agent").createLsToolDefinition,
	createFindToolDefinition: require("@earendil-works/pi-coding-agent").createFindToolDefinition,
	createGrepToolDefinition: require("@earendil-works/pi-coding-agent").createGrepToolDefinition,
	getAgentDir: require("@earendil-works/pi-coding-agent").getAgentDir,
};

const createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;

export type { PiPrettyDeps };

export default async function piBashEnhancedExtension(pi: ExtensionAPI, deps?: PiPrettyDeps): Promise<void> {
	const cwd = process.cwd();
	const sdkTool = createBashTool(cwd);

	// Register the enhanced bash tool
	registerBashEnhancedTool(pi, cwd, null, sdkTool, deps?.TextComponent);

	// Optional: Add a command to toggle enhanced mode (if needed in the future)
	pi.registerCommand("bash-enhanced-toggle", {
		description: "Toggle bash-enhanced rendering mode",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
		ctx.ui.notify("bash-enhanced: mode toggled (no-op, check if rendering is enhanced)", "info");
		// Future enhancement: toggle between regular and enhanced bash rendering
		return "bash-enhanced mode active";
	},
	});
}