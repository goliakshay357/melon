import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import { isCursorLocalAgentId } from "./cursor-session-agent-resume.js";
import {
	cursorHostSessionScopeKey,
	getCursorHostSessionScopeKey,
	isCursorHostSessionIsolationEnabled,
} from "./cursor-host-session.js";
import { asRecord } from "./cursor-record-utils.js";

export const CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE = "cursor-sdk-agent-lineage";

const LINEAGE_ENTRY_VERSION = 1;

function isIsoTimestamp(value: unknown): value is string {
	if (typeof value !== "string" || !value) return false;
	const timestamp = Date.parse(value);
	return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value;
}

export interface CursorSessionAgentLineageEntryData {
	version: 1;
	runtime: "local";
	agentId: string;
	sessionId: string;
	sessionFile?: string;
	scopeKey: string;
	cwd: string;
	timestamp: string;
}

interface CursorSessionAgentLineageState {
	appendEntry?: ExtensionAPI["appendEntry"];
	sessionId?: string;
	sessionFile?: string;
	scopeKey?: string;
	cwd?: string;
	recordedAgentIds: Set<string>;
}

/** One lineage state per pi session; see cursor-host-session.js. */
const lineageStatesByScopeKey = new Map<string, CursorSessionAgentLineageState>();
const initialLineageState: CursorSessionAgentLineageState = { recordedAgentIds: new Set() };
let lastBoundLineageState: CursorSessionAgentLineageState = initialLineageState;

function lineageStateForScopeKey(scopeKey: string): CursorSessionAgentLineageState {
	const existing = lineageStatesByScopeKey.get(scopeKey);
	if (existing) return existing;
	const created: CursorSessionAgentLineageState = { recordedAgentIds: new Set() };
	lineageStatesByScopeKey.set(scopeKey, created);
	return created;
}

function currentLineageState(): CursorSessionAgentLineageState {
	if (!isCursorHostSessionIsolationEnabled()) return lastBoundLineageState;
	const hostScopeKey = getCursorHostSessionScopeKey();
	return hostScopeKey ? lineageStateForScopeKey(hostScopeKey) : lastBoundLineageState;
}

export function parseCursorSessionAgentLineageEntryData(value: unknown): CursorSessionAgentLineageEntryData | undefined {
	const record = asRecord(value);
	if (
		record?.version !== LINEAGE_ENTRY_VERSION ||
		record.runtime !== "local" ||
		!isCursorLocalAgentId(record.agentId) ||
		typeof record.sessionId !== "string" ||
		!record.sessionId ||
		typeof record.scopeKey !== "string" ||
		!record.scopeKey ||
		typeof record.cwd !== "string" ||
		!record.cwd ||
		!isIsoTimestamp(record.timestamp)
	) {
		return undefined;
	}
	if (record.sessionFile !== undefined && (typeof record.sessionFile !== "string" || !record.sessionFile)) return undefined;
	return {
		version: LINEAGE_ENTRY_VERSION,
		runtime: "local",
		agentId: record.agentId,
		sessionId: record.sessionId,
		...(record.sessionFile ? { sessionFile: record.sessionFile } : {}),
		scopeKey: record.scopeKey,
		cwd: record.cwd,
		timestamp: record.timestamp,
	};
}

function readRecordedAgentIds(entries: readonly SessionEntry[], sessionId: string): Set<string> {
	return new Set(
		entries.flatMap((entry) => {
			if (entry.type !== "custom" || entry.customType !== CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE) return [];
			const data = parseCursorSessionAgentLineageEntryData(entry.data);
			return data?.sessionId === sessionId ? [data.agentId] : [];
		}),
	);
}

/** Best-effort forensic lineage at the local Agent.send() boundary. Independent of resume. */
export function recordCursorSessionAgentLineage(agentId: string): void {
	const state = currentLineageState();
	const { appendEntry, sessionId, sessionFile, scopeKey, cwd } = state;
	if (!appendEntry || !sessionId || !scopeKey || !cwd) return;
	if (!isCursorLocalAgentId(agentId) || state.recordedAgentIds.has(agentId)) return;
	const data: CursorSessionAgentLineageEntryData = {
		version: LINEAGE_ENTRY_VERSION,
		runtime: "local",
		agentId,
		sessionId,
		...(sessionFile ? { sessionFile } : {}),
		scopeKey,
		cwd,
		timestamp: new Date().toISOString(),
	};
	try {
		appendEntry<CursorSessionAgentLineageEntryData>(CURSOR_SESSION_AGENT_LINEAGE_ENTRY_TYPE, data);
		state.recordedAgentIds.add(agentId);
	} catch {
		// Lineage is forensic metadata; a failed stock pi append must not affect the session.
	}
}

interface CursorSessionAgentLineageExtensionApi {
	appendEntry: ExtensionAPI["appendEntry"];
	on: ExtensionAPI["on"];
}

export function registerCursorSessionAgentLineage(pi: CursorSessionAgentLineageExtensionApi): void {
	pi.on("session_start", (_event, ctx) => {
		const scopeKey = cursorHostSessionScopeKey({
			sessionFile: ctx.sessionManager.getSessionFile() ?? undefined,
			sessionId: ctx.sessionManager.getSessionId(),
		});
		const state = lineageStateForScopeKey(scopeKey);
		lastBoundLineageState = state;
		state.appendEntry = pi.appendEntry;
		state.sessionId = ctx.sessionManager.getSessionId();
		state.sessionFile = ctx.sessionManager.getSessionFile() ?? undefined;
		state.scopeKey = scopeKey;
		state.cwd = ctx.cwd;
		state.recordedAgentIds = readRecordedAgentIds(ctx.sessionManager.getEntries(), state.sessionId);
	});
	pi.on("session_shutdown", (_event, ctx) => {
		const scopeKey = cursorHostSessionScopeKey({
			sessionFile: ctx.sessionManager?.getSessionFile?.() ?? undefined,
			sessionId: ctx.sessionManager?.getSessionId?.() ?? undefined,
		});
		const state = lineageStatesByScopeKey.get(scopeKey);
		lineageStatesByScopeKey.delete(scopeKey);
		if (state && lastBoundLineageState !== state) return;
		lastBoundLineageState = initialLineageState;
		initialLineageState.appendEntry = undefined;
		initialLineageState.sessionId = undefined;
		initialLineageState.sessionFile = undefined;
		initialLineageState.scopeKey = undefined;
		initialLineageState.cwd = undefined;
		initialLineageState.recordedAgentIds = new Set();
	});
}

function resetStateForTests(): void {
	lineageStatesByScopeKey.clear();
	lastBoundLineageState = initialLineageState;
	initialLineageState.appendEntry = undefined;
	initialLineageState.sessionId = undefined;
	initialLineageState.sessionFile = undefined;
	initialLineageState.scopeKey = undefined;
	initialLineageState.cwd = undefined;
	initialLineageState.recordedAgentIds = new Set();
}

export const __testUtils = {
	reset: resetStateForTests,
};
