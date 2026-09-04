// Melon hosts many live cards in one Node process. pi-cursor-sdk keeps
// process-global session scope + local-resume state, so without an explicit
// rebind before each Cursor turn, card B can resume card A's Cursor agent —
// especially after Melon canvas fork, which copies `cursor-sdk-agent-resume`
// custom entries into the child .jsonl.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cursorExtensionPath } from "./cursor-extension.ts";

const require = createRequire(import.meta.url);

/** pi-cursor-sdk custom entry that pins a local Cursor agent id for resume. */
export const CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE = "cursor-sdk-agent-resume";

type SessionRuntime = {
	session: {
		model?: { provider?: string } | null;
		sessionManager: {
			getSessionFile?: () => string | undefined;
			getSessionId?: () => string | undefined;
			getCwd?: () => string;
			appendCustomEntry: (customType: string, data?: unknown) => string;
		};
		bindExtensions: (bindings: { mode: "rpc" }) => Promise<void>;
	};
};

function isCursorProvider(runtime: SessionRuntime): boolean {
	return (runtime.session.model?.provider ?? "").toLowerCase() === "cursor";
}

/**
 * Drop copied Cursor local-resume handles from a forked Melon child session and
 * re-chain parentIds so the jsonl tree stays valid. Returns how many entries
 * were removed.
 */
export function stripCursorResumeEntriesFromSessionFile(sessionFile: string): number {
	if (!sessionFile || !existsSync(sessionFile)) return 0;
	const raw = readFileSync(sessionFile, "utf8");
	if (!raw.trim()) return 0;
	const lines = raw.split(/\n/);
	const headerLine = lines[0] ?? "";
	let header: unknown;
	try {
		header = JSON.parse(headerLine);
	} catch {
		return 0;
	}
	if (!header || typeof header !== "object" || (header as { type?: string }).type !== "session") {
		return 0;
	}

	const kept: Array<Record<string, unknown>> = [];
	let removed = 0;
	for (const line of lines.slice(1)) {
		if (!line.trim()) continue;
		let obj: Record<string, unknown>;
		try {
			obj = JSON.parse(line) as Record<string, unknown>;
		} catch {
			kept.push({ __raw: line });
			continue;
		}
		if (obj.type === "custom" && obj.customType === CURSOR_SDK_AGENT_RESUME_ENTRY_TYPE) {
			removed += 1;
			continue;
		}
		kept.push(obj);
	}
	if (removed === 0) return 0;

	let parentId: string | null = null;
	const rewritten: string[] = [headerLine];
	for (const entry of kept) {
		if ("__raw" in entry) {
			rewritten.push(String(entry.__raw));
			continue;
		}
		const next = { ...entry, parentId };
		rewritten.push(JSON.stringify(next));
		parentId = typeof next.id === "string" ? next.id : parentId;
	}
	writeFileSync(sessionFile, `${rewritten.join("\n")}\n`);
	return removed;
}

/**
 * Point pi-cursor-sdk's process-global scope/resume/appendEntry at this card's
 * session before a Cursor prompt. No-op when Cursor is not the active model or
 * the extension package is missing.
 */
export async function activateCursorSessionBinding(runtime: SessionRuntime): Promise<void> {
	if (!cursorExtensionPath() || !isCursorProvider(runtime)) return;

	const sm = runtime.session.sessionManager;

	// Re-emit session_start on THIS card's extension runner so resume state is
	// restored from this session's branch (not whichever card bound last).
	await runtime.session.bindExtensions({ mode: "rpc" });

	try {
		const resumeMod = require("pi-cursor-sdk/dist/cursor-session-agent-resume.js") as {
			__testUtils?: {
				set: (partial: { appendEntry?: (customType: string, data?: unknown) => unknown }) => void;
			};
		};

		// Resume handles must append into THIS card's jsonl, not the last-created card.
		resumeMod.__testUtils?.set({
			appendEntry: (customType: string, data?: unknown) => sm.appendCustomEntry(customType, data),
		});
	} catch (e) {
		console.error("[melon] cursor session bind helpers unavailable:", (e as Error)?.message ?? e);
	}
}
