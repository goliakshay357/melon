import { resolve } from "node:path";
import { parseArgs } from "@earendil-works/pi-coding-agent";
import { truncateCursorDisplayLine } from "./cursor-display-text.js";
import { ANONYMOUS_SESSION_SCOPE_KEY, EPHEMERAL_SESSION_SCOPE_PREFIX, cursorHostSessionScopeKey, getCursorHostSessionScopeKey, isCursorHostSessionIsolationEnabled, } from "./cursor-host-session.js";
export const MAX_CURSOR_SESSION_NAME_LENGTH = 100;
const state = {
    sessionCwd: process.cwd(),
    sessionFile: undefined,
    sessionId: undefined,
    sessionName: undefined,
    projectTrusted: false,
    sessionGeneration: 0,
};
/**
 * Snapshot per pi session, so a multi-card host can read the scope of the
 * session that is actually prompting (see cursor-host-session.js). Always
 * written; only read once a host opts into isolation.
 */
const sessionStates = new Map();
const scopeGenerations = new Map([[ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration]]);
const projectTrustResolutionCwds = new Set();
let nextSessionGeneration = 1;
let scopeChangeHandler;
function scopeKeyOf(scope) {
    return cursorHostSessionScopeKey({ sessionFile: scope.sessionFile, sessionId: scope.sessionId });
}
/** Scope of the calling turn under host isolation; the last-bound scope otherwise. */
function readState() {
    if (!isCursorHostSessionIsolationEnabled())
        return state;
    const hostScopeKey = getCursorHostSessionScopeKey();
    if (!hostScopeKey)
        return state;
    return sessionStates.get(hostScopeKey) ?? state;
}
/**
 * Pi session file when known; used to scope reused Cursor SDK agents to one pi session.
 */
export function getCursorSessionFile() {
    return readState().sessionFile;
}
/**
 * Stable scope key for session-agent pooling. Falls back to a process-local anonymous key
 * before the first session_start (tests and early startup).
 */
export function getCursorSessionScopeKey() {
    return scopeKeyOf(readState());
}
export function getCursorSessionScopeGeneration(scopeKey = getCursorSessionScopeKey()) {
    return scopeGenerations.get(scopeKey) ?? 0;
}
/**
 * Pi session cwd when known; falls back to process.cwd() before session_start.
 * Updated on session_start only until pi threads cwd into streamSimple—mid-session cwd
 * changes without a new session_start event are not reflected here.
 */
export function getCursorSessionCwd() {
    return readState().sessionCwd;
}
export function getCursorSessionProjectTrusted() {
    return readState().projectTrusted;
}
export function getCursorSessionName() {
    return readState().sessionName;
}
function normalizeCursorSessionName(name) {
    if (name === undefined)
        return undefined;
    return truncateCursorDisplayLine(name, MAX_CURSOR_SESSION_NAME_LENGTH) || undefined;
}
function setCursorSessionScope(cwd, sessionFile, sessionId, projectTrusted = false, sessionName) {
    state.sessionCwd = cwd;
    state.sessionFile = sessionFile;
    state.sessionId = sessionId;
    state.sessionName = normalizeCursorSessionName(sessionName);
    state.projectTrusted = projectTrusted;
    state.sessionGeneration = nextSessionGeneration;
    nextSessionGeneration += 1;
    scopeGenerations.set(scopeKeyOf(state), state.sessionGeneration);
    sessionStates.set(scopeKeyOf(state), { ...state });
}
function recordProjectTrustResolution(cwd) {
    projectTrustResolutionCwds.add(resolve(cwd));
}
function isCliProjectTrustApproved(args = process.argv.slice(2)) {
    return parseArgs(args).projectTrustOverride === true;
}
function resetCursorSessionScope() {
    state.sessionCwd = process.cwd();
    state.sessionFile = undefined;
    state.sessionId = undefined;
    state.sessionName = undefined;
    state.projectTrusted = false;
    state.sessionGeneration = 0;
    nextSessionGeneration = 1;
    scopeGenerations.clear();
    scopeGenerations.set(ANONYMOUS_SESSION_SCOPE_KEY, state.sessionGeneration);
    sessionStates.clear();
    projectTrustResolutionCwds.clear();
}
export function onCursorSessionScopeKeyChange(handler) {
    scopeChangeHandler = handler;
}
export function registerCursorSessionScope(pi) {
    pi.on("project_trust", (event) => {
        recordProjectTrustResolution(event.cwd);
        return { trusted: "undecided" };
    });
    // Scope changes are per extension runner. Globally, "the scope key changed"
    // is indistinguishable from "another card just bound", and the lifecycle
    // handler responds by disposing the previous scope's Cursor agent — which
    // under a multi-card host would kill a sibling card mid-turn.
    let runnerScopeKey;
    pi.on("session_start", async (_event, ctx) => {
        const previousGlobalScopeKey = getCursorSessionScopeKey();
        setCursorSessionScope(ctx.cwd, ctx.sessionManager?.getSessionFile?.() ?? undefined, ctx.sessionManager?.getSessionId?.() ?? undefined, ctx.isProjectTrusted?.() === true
            && (projectTrustResolutionCwds.has(resolve(ctx.cwd)) || isCliProjectTrustApproved()), ctx.sessionManager?.getSessionName?.() ?? undefined);
        const nextScopeKey = scopeKeyOf(state);
        const previousScopeKey = isCursorHostSessionIsolationEnabled() ? runnerScopeKey : previousGlobalScopeKey;
        runnerScopeKey = nextScopeKey;
        if (previousScopeKey !== undefined && previousScopeKey !== nextScopeKey) {
            await scopeChangeHandler?.(previousScopeKey);
        }
    });
    pi.on("session_info_changed", (event, ctx) => {
        const sessionName = normalizeCursorSessionName(event.name);
        state.sessionName = sessionName;
        const scopeKey = cursorHostSessionScopeKey({
            sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? undefined,
            sessionId: ctx?.sessionManager?.getSessionId?.() ?? undefined,
        });
        const scoped = sessionStates.get(scopeKey);
        if (scoped)
            scoped.sessionName = sessionName;
    });
    pi.on("session_shutdown", (_event, ctx) => {
        sessionStates.delete(cursorHostSessionScopeKey({
            sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? undefined,
            sessionId: ctx?.sessionManager?.getSessionId?.() ?? undefined,
        }));
    });
}
export const __testUtils = {
    ANONYMOUS_SESSION_SCOPE_KEY,
    EPHEMERAL_SESSION_SCOPE_PREFIX,
    set: setCursorSessionScope,
    recordProjectTrustResolution,
    isCliProjectTrustApproved,
    reset: resetCursorSessionScope,
};
