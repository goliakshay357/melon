// Melon session boundary guard — worktree isolation enforcement.
//
// Loaded into every Melon session via additionalExtensionPaths. At session
// start it detects whether the session cwd is a linked git worktree. When it
// is, it (1) renders a boundary block into the system prompt, (2) translates
// file-tool paths that point into the main repo to their worktree equivalent
// (when the equivalent file exists) and blocks them otherwise, and (3) blocks
// `cd` into the main repo and annotates bash results that reference it.
//
// Sessions in regular folders (no linked worktree) are untouched.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";
import {
	bashBlockReason,
	bashBoundaryWarning,
	bashReferencesMainRepo,
	detectSessionBoundary,
	fileToolGuard,
	renderBoundaryPrompt,
	type SessionBoundary,
} from "./session-boundary.ts";

export default function sessionBoundaryExtension(pi: ExtensionAPI): void {
	let boundary: SessionBoundary | null = null;

	pi.on("session_start", async (_event, ctx) => {
		boundary = await detectSessionBoundary(ctx.cwd);
	});

	pi.on("before_agent_start", (event) => {
		if (!boundary) return;
		return { systemPrompt: `${event.systemPrompt}\n\n${renderBoundaryPrompt(boundary)}` };
	});

	pi.on("tool_call", (event, ctx) => {
		if (!boundary) return;

		// File tools: translate parent-repo paths to the worktree when the
		// equivalent file exists; block writes/edits that would escape.
		if (
			isToolCallEventType("read", event) ||
			isToolCallEventType("write", event) ||
			isToolCallEventType("edit", event)
		) {
			const rawPath = typeof event.input.path === "string" ? event.input.path : "";
			if (!rawPath) return;
			const guard = fileToolGuard(rawPath, ctx.cwd, boundary);
			if (guard.action === "translate") {
				event.input.path = guard.translated;
				return;
			}
			if (guard.action === "block") {
				return { block: true, reason: guard.reason };
			}
			return;
		}

		// Bash: block cd into the main repo (it would persist for later commands).
		if (isToolCallEventType("bash", event)) {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (!command) return;
			const blockReason = bashBlockReason(command, ctx.cwd, boundary);
			if (blockReason) return { block: true, reason: blockReason };
		}
	});

	// Bash results: annotate (do not block) commands that referenced the main
	// repo, so the model sees when it acted on the parent repository.
	pi.on("tool_result", (event) => {
		if (!boundary || event.toolName !== "bash") return;
		const command = typeof event.input.command === "string" ? event.input.command : "";
		if (!command || !bashReferencesMainRepo(command, boundary)) return;
		return {
			content: [...event.content, { type: "text" as const, text: bashBoundaryWarning(boundary) }],
		};
	});
}
