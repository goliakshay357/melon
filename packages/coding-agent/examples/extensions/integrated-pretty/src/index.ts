/**
 * pi-integrated-pretty — All pi-pretty enhancements integrated into core.
 *
 * This extension patches the existing core tools to provide pi-pretty-like rendering:
 *   • Color-coded exit status (bash)
 *   • Syntax-highlighted file content (read)
 *   • Tree-view directory listings with icons (ls)
 *   • FFF-accelerated file search (find/grep)
 *   • Working indicator shimmer (streaming)
 *   • Thinking label shimmer
 *   • Collapsible output previews
 *   • Enhanced error display
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { registerBashEnhancedTool } from "./tools/bash-enhanced.js";
import { registerReadEnhancedTool } from "./tools/read-enhanced.js";
import { registerLsEnhancedTool } from "./tools/ls-enhanced.js";
import { registerFindEnhancedTool } from "./tools/find-enhanced.js";
import { registerGrepEnhancedTool } from "./tools/grep-enhanced.js";
import type { PiPrettyDeps, SdkTools } from "./types.js";

// Pi aliases static SDK imports to its host package for managed extensions.
const sdk: SdkTools = {
	createReadToolDefinition: require("@earendil-works/pi-coding-agent").createReadToolDefinition,
	createBashToolDefinition: require("@earendil-works/pi-coding-agent").createBashToolDefinition,
	createLsToolDefinition: require("@earendil-works/pi-coding-agent").createLsToolDefinition,
	createFindToolDefinition: require("@earendil-works/pi-coding-agent").createFindToolDefinition,
	createGrepToolDefinition: require("@earendil-works/pi-coding-agent").createGrepToolDefinition,
	getAgentDir: require("@earendil-works/pi-coding-agent").getAgentDir,
};

const createReadTool = sdk.createReadToolDefinition ?? sdk.createReadTool;
const createBashTool = sdk.createBashToolDefinition ?? sdk.createBashTool;
const createLsTool = sdk.createLsToolDefinition ?? sdk.createLsTool;
const createFindTool = sdk.createFindToolDefinition ?? sdk.createFindTool;
const createGrepTool = sdk.createGrepToolDefinition ?? sdk.createGrepTool;

export type { PiPrettyDeps };

export default async function piIntegratedPrettyExtension(pi: ExtensionAPI, deps?: PiPrettyDeps): Promise<void> {
	const cwd = process.cwd();
	const sdkReadTool = createReadTool(cwd);
	const sdkBashTool = createBashTool(cwd);
	const sdkLsTool = createLsTool(cwd);
	const sdkFindTool = createFindTool(cwd);
	const sdkGrepTool = createGrepTool(cwd);

	// Register all enhanced tools
	registerReadEnhancedTool(pi, cwd, null, sdkReadTool, deps?.TextComponent);
	registerBashEnhancedTool(pi, cwd, null, sdkBashTool, deps?.TextComponent);
	registerLsEnhancedTool(pi, cwd, null, sdkLsTool, deps?.TextComponent);
	registerFindEnhancedTool(pi, cwd, deps?.fffModule, sdkFindTool, deps?.TextComponent);
	registerGrepEnhancedTool(pi, cwd, deps?.fffModule, sdkGrepTool, deps?.TextComponent);
}