import { spawnSync } from "node:child_process";
import { CURSOR_PI_TOOL_BRIDGE_DEBUG_ENV, CURSOR_PI_TOOL_BRIDGE_DIAGNOSTIC_PREFIX, serializeCursorPiToolBridgeDiagnostic, } from "./cursor-pi-tool-bridge-diagnostics.js";
import { CURSOR_PI_TOOL_BRIDGE_BUILTINS_ENV, CURSOR_PI_TOOL_BRIDGE_CALL_TIMEOUT_MS_ENV, CURSOR_PI_TOOL_BRIDGE_ENV, } from "./cursor-pi-tool-bridge-env.js";
import { bridgeToolExecutionAbortTracker } from "./cursor-pi-tool-bridge-abort.js";
import { isCursorPiBridgeToolCallId, MCP_SERVER_NAME } from "./cursor-pi-tool-bridge-constants.js";
import { LOOPBACK_HOST, CursorPiToolBridgeRegistry } from "./cursor-pi-tool-bridge-server.js";
import { cursorHostSessionScopeKey, getCursorHostSessionScopeKey, isCursorHostSessionIsolationEnabled, } from "./cursor-host-session.js";
export { resolveCursorPiToolBridgeDebugEnabled } from "./cursor-pi-tool-bridge-diagnostics.js";
export { CURSOR_PI_TOOL_BRIDGE_BUILTINS_ENV, CURSOR_PI_TOOL_BRIDGE_CALL_TIMEOUT_MS_ENV, CURSOR_PI_TOOL_BRIDGE_ENV, resolveCursorPiToolBridgeBuiltinsEnabled, resolveCursorPiToolBridgeCallTimeoutMs, resolveCursorPiToolBridgeEnabled, } from "./cursor-pi-tool-bridge-env.js";
export { buildCursorPiToolBridgeSnapshot, buildCursorPiToolBridgeSurfaceSignature, } from "./cursor-pi-tool-bridge-snapshot.js";
/**
 * Multi-session hosts (Melon canvas cards) load this extension once per session
 * in a shared Node process. Bridges stay alive per extension runner (`pi`): a new
 * card must not disposeAll() another card's pending MCP tool calls.
 *
 * Two resolution modes:
 * - default (TUI, one session per process): `activeCursorPiToolBridge`, the
 *   bridge whose session received session_start most recently.
 * - host isolation (see cursor-host-session.js): the bridge registered for the
 *   scope key of the session running the current turn. Concurrent cards then
 *   never steal each other's bridge, which is what produced
 *   "Cursor pi bridge tool call is no longer pending".
 */
const registeredCursorPiToolBridges = new Set();
const bridgesBySessionScopeKey = new Map();
const sessionScopeKeysByBridge = new Map();
let activeCursorPiToolBridge;
function sessionScopeKeyFromContext(ctx) {
    return cursorHostSessionScopeKey({
        sessionFile: ctx?.sessionManager?.getSessionFile?.() ?? undefined,
        sessionId: ctx?.sessionManager?.getSessionId?.() ?? undefined,
    });
}
function trackBridgeSessionScope(bridge, scopeKey) {
    const previous = sessionScopeKeysByBridge.get(bridge);
    if (previous === scopeKey)
        return;
    if (previous && bridgesBySessionScopeKey.get(previous) === bridge) {
        bridgesBySessionScopeKey.delete(previous);
    }
    sessionScopeKeysByBridge.set(bridge, scopeKey);
    bridgesBySessionScopeKey.set(scopeKey, bridge);
}
function untrackBridgeSessionScope(bridge) {
    const scopeKey = sessionScopeKeysByBridge.get(bridge);
    sessionScopeKeysByBridge.delete(bridge);
    if (scopeKey && bridgesBySessionScopeKey.get(scopeKey) === bridge) {
        bridgesBySessionScopeKey.delete(scopeKey);
    }
}
const WINDOWS_BRIDGE_ABORT_ENV = "PI_CURSOR_BRIDGE_TOOL_CALL_ID";
function buildWindowsBridgeBashAbortCommand(command, marker) {
    return `export ${WINDOWS_BRIDGE_ABORT_ENV}=${marker}; ${command}`;
}
function installWindowsBridgeBashAbortMarker(event) {
    if (process.platform !== "win32" || event.toolName !== "bash")
        return undefined;
    if (typeof event.input !== "object" || event.input === null || !("command" in event.input))
        return undefined;
    const input = event.input;
    if (typeof input.command !== "string" || input.command.length === 0)
        return undefined;
    const marker = event.toolCallId.replace(/[^A-Za-z0-9_.:-]/g, "_");
    input.command = buildWindowsBridgeBashAbortCommand(input.command, marker);
    return marker;
}
function killWindowsBridgeBashMarkerTree(marker) {
    if (process.platform !== "win32" || !marker)
        return;
    const encodedMarker = Buffer.from(marker, "utf8").toString("base64");
    const script = `
$marker = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedMarker}'))
$needle = '${WINDOWS_BRIDGE_ABORT_ENV}=' + $marker
$seen = @{}
function Stop-Tree([int]$ProcessId) {
  if ($seen.ContainsKey($ProcessId)) { return }
  $seen[$ProcessId] = $true
  Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ProcessId } | ForEach-Object { Stop-Tree $_.ProcessId }
  Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
}
Get-CimInstance Win32_Process -Filter "Name = 'bash.exe' OR Name = 'sh.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains($needle) } |
  ForEach-Object { Stop-Tree $_.ProcessId }
`;
    spawnSync("powershell.exe", ["-NoLogo", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
        stdio: "ignore",
        timeout: 3_000,
        windowsHide: true,
    });
}
export function registerCursorPiToolBridge(pi) {
    const bridge = new CursorPiToolBridgeRegistry(pi);
    registeredCursorPiToolBridges.add(bridge);
    activeCursorPiToolBridge = bridge;
    // Melon (and similar hosts) call bindExtensions / session_start on the card
    // about to prompt so getRegisteredCursorPiToolBridge() follows that card.
    pi.on("session_start", (_event, ctx) => {
        activeCursorPiToolBridge = bridge;
        trackBridgeSessionScope(bridge, sessionScopeKeyFromContext(ctx));
    });
    pi.on("tool_call", (event, ctx) => {
        // Each pi only delivers tool_call to its own handlers — do not require
        // this bridge to be the process-wide "active" one (siblings stay live).
        if (!bridge.hasPendingPiToolCallId(event.toolCallId)) {
            return isCursorPiBridgeToolCallId(event.toolCallId)
                ? { block: true, reason: "Cursor pi bridge tool call is no longer pending" }
                : undefined;
        }
        const windowsAbortMarker = installWindowsBridgeBashAbortMarker(event);
        const trackingStarted = bridgeToolExecutionAbortTracker.track(event.toolCallId, {
            signal: ctx.signal,
            abort: () => {
                ctx.abort();
                killWindowsBridgeBashMarkerTree(windowsAbortMarker);
            },
            cancelPending: (reason) => {
                bridge.cancelPendingPiToolCallId(event.toolCallId, reason);
            },
        });
        if (trackingStarted)
            return undefined;
        return { block: true, reason: "Cursor pi bridge tool execution was aborted before it started" };
    });
    pi.on("tool_result", (event) => {
        bridgeToolExecutionAbortTracker.finish(event.toolCallId);
    });
    pi.on("session_shutdown", async (event) => {
        const reason = `Cursor pi tool bridge session shutdown: ${event.reason}`;
        registeredCursorPiToolBridges.delete(bridge);
        untrackBridgeSessionScope(bridge);
        if (activeCursorPiToolBridge === bridge) {
            activeCursorPiToolBridge = undefined;
            for (const remaining of registeredCursorPiToolBridges) {
                activeCursorPiToolBridge = remaining;
            }
        }
        bridgeToolExecutionAbortTracker.abortMatching((toolCallId) => bridge.hasPendingPiToolCallId(toolCallId), reason);
        await bridge.disposeAll(reason);
    });
    return bridge;
}
const warnedMissingSessionScopeKeys = new Set();
/**
 * Bridge for the current turn. Under host isolation the lookup is strict: a
 * turn belonging to session X must never be handed session Y's bridge, because
 * that is how one card's tool call ends up pending on another card.
 */
export function getRegisteredCursorPiToolBridge() {
    if (!isCursorHostSessionIsolationEnabled())
        return activeCursorPiToolBridge;
    const hostScopeKey = getCursorHostSessionScopeKey();
    if (!hostScopeKey)
        return activeCursorPiToolBridge;
    const bridge = bridgesBySessionScopeKey.get(hostScopeKey);
    if (!bridge && !warnedMissingSessionScopeKeys.has(hostScopeKey)) {
        warnedMissingSessionScopeKeys.add(hostScopeKey);
        console.error(`[pi-cursor-sdk] no pi tool bridge registered for session scope ${hostScopeKey}`);
    }
    return bridge;
}
export const __testUtils = {
    CURSOR_PI_TOOL_BRIDGE_ENV,
    CURSOR_PI_TOOL_BRIDGE_BUILTINS_ENV,
    CURSOR_PI_TOOL_BRIDGE_CALL_TIMEOUT_MS_ENV,
    CURSOR_PI_TOOL_BRIDGE_DEBUG_ENV,
    CURSOR_PI_TOOL_BRIDGE_DIAGNOSTIC_PREFIX,
    LOOPBACK_HOST,
    MCP_SERVER_NAME,
    createRegistry(pi, env = process.env) {
        return new CursorPiToolBridgeRegistry(pi, env);
    },
    getRegisteredBridgeForTests() {
        return activeCursorPiToolBridge;
    },
    getRegisteredBridgeCountForTests() {
        return registeredCursorPiToolBridges.size;
    },
    getBridgeForSessionScopeKeyForTests(scopeKey) {
        return bridgesBySessionScopeKey.get(scopeKey);
    },
    serializeDiagnosticForTests(event) {
        return serializeCursorPiToolBridgeDiagnostic(event);
    },
    getActiveBridgeToolExecutionAbortCount() {
        return bridgeToolExecutionAbortTracker.getActiveCount();
    },
    buildWindowsBridgeBashAbortCommandForTests: buildWindowsBridgeBashAbortCommand,
    installWindowsBridgeBashAbortMarkerForTests: installWindowsBridgeBashAbortMarker,
    emitBridgeToolExecutionProcessAbortSignalForTests(signal) {
        bridgeToolExecutionAbortTracker.emitProcessAbortSignalForTests(signal);
    },
    async resetRegisteredBridgeForTests() {
        bridgeToolExecutionAbortTracker.abortAll("Cursor pi tool bridge test reset");
        const bridges = [...registeredCursorPiToolBridges];
        registeredCursorPiToolBridges.clear();
        bridgesBySessionScopeKey.clear();
        sessionScopeKeysByBridge.clear();
        warnedMissingSessionScopeKeys.clear();
        activeCursorPiToolBridge = undefined;
        await Promise.all(bridges.map((bridge) => bridge.disposeAll("Cursor pi tool bridge test reset")));
    },
};
