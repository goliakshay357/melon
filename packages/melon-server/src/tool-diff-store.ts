import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface ToolDiffStore {
	version: 1;
	/** callId → enriched tool output (includes Melon unified diff). */
	byCallId: Record<string, string>;
}

function storePath(sessionFile: string): string {
	return `${sessionFile}.melon-tool-diffs.json`;
}

export function loadToolDiffStore(sessionFile: string): ToolDiffStore {
	try {
		const raw = JSON.parse(readFileSync(storePath(sessionFile), "utf8")) as Partial<ToolDiffStore>;
		if (raw && typeof raw === "object" && raw.byCallId && typeof raw.byCallId === "object") {
			return { version: 1, byCallId: raw.byCallId as Record<string, string> };
		}
	} catch {
		/* missing / invalid — empty */
	}
	return { version: 1, byCallId: {} };
}

export function saveToolDiff(sessionFile: string, callId: string, output: string): void {
	if (!sessionFile || !callId || !output) return;
	const store = loadToolDiffStore(sessionFile);
	store.byCallId[callId] = output;
	const path = storePath(sessionFile);
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, JSON.stringify(store));
}

export function lookupToolDiff(sessionFile: string, callId: string | undefined): string | undefined {
	if (!callId) return undefined;
	const out = loadToolDiffStore(sessionFile).byCallId[callId];
	return typeof out === "string" && out.length > 0 ? out : undefined;
}
