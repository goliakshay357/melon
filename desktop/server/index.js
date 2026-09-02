// Melon bridge — HTTP/SSE front-end over live pi sessions.
// Melon web is a pi frontend (peer of the TUI); sessions go to pi's default
// store so both frontends share history for the same folder.
//
// Contract:
//   POST /sessions                    {cardId, cwd}         → {sessionId, sessionFile, model}
//   POST /sessions/resume             {cardId, sessionFile} → {sessionId, cwd, model}
//   GET  /projects                                          → {projects: [{cwd, sessions[]}]}
//   GET  /sessions/:cardId/events     SSE                   → delta | status | tool | error
//   POST /sessions/:cardId/prompt     {text}                → {ok}
//   POST /sessions/:cardId/abort
import { randomUUID } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync, } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAgentSessionFromServices, createAgentSessionRuntime, createAgentSessionServices, getAgentDir, ModelRuntime, SessionManager, } from "@earendil-works/pi-coding-agent";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { expandHome, loadConfig, modelToString, preview } from "./config.js";
import { SessionRegistry } from "./session-registry.js";
import { denylistModel, getDefaultModel, loadSettings, saveSettings, touchRecentModel } from "./settings.js";
import { loadSkills, materializeSkills, readSkill, saveSkill, deleteSkill } from "./skills.js";
// Split "provider/model-id" on the FIRST slash only — model IDs may contain
// slashes (e.g. OpenRouter "stealth/ox-alpha", "ai21/jamba-large-1.7").
function splitModel(model) {
    const idx = model.indexOf("/");
    if (idx <= 0)
        return ["", ""];
    return [model.slice(0, idx), model.slice(idx + 1)];
}
let _modelRuntime;
async function getModelRuntime() {
    if (!_modelRuntime)
        _modelRuntime = await ModelRuntime.create();
    return _modelRuntime;
}
export async function buildApp(deps = {}) {
    const config = loadConfig(deps.config);
    const app = Fastify({ logger: false });
    await app.register(cors, { origin: true });
    const registry = new SessionRegistry();
    /**
     * System-prompt guardrail: the agent must not explore its own installation
     * (Melon.app, app.asar, DMGs, packaged dist, ~/.melon, the pi SDK) — a real
     * failure mode where the model "reads its own codebase" instead of the
     * user's project.
     */
    const MELON_GUARDRAIL = [
        "Environment boundaries (always apply):",
        "- You are running inside Melon, a desktop app powered by the pi coding agent. Melon's own installation is OFF-LIMITS: never read, list, search, unzip, modify, or delete the app bundle (Melon.app, app.asar), .dmg installers, packaged server/web-dist folders, the desktop Electron shell, or the installed @earendil-works/pi-coding-agent package — even to 'understand the environment'. Exception: reading and executing skills under ~/.melon/agent/skills/ (including multi-file skill packages) is allowed.",
        "- Work only inside the current project directory and paths the user explicitly gives you.",
        "- If a task seems to require changing Melon itself (rare), ask the user first.",
        "",
        "Inline rendering in Melon chat (always apply):",
        "- Melon renders assistant messages as rich content, NOT plain text. Fenced blocks turn into LIVE interactive viewers inside the chat card:",
        "- Small self-contained HTML scenes (few KB): emit a ```viz-html``` fence containing ONE complete HTML document. It renders in a \u2248380px-wide frame (auto-height up to 700px). Design for \u2264380px width, no horizontal overflow.",
        "- Files on disk (archify deliver output, or any complete HTML artifact you wrote via a tool): emit a ```viz-file``` fence whose body is EXACTLY one line: the absolute file path, a pipe (|), then the session working directory. Example: ```/abs/path/to/artifact.html|/abs/session/cwd```. Melon fetches that file and renders it inline in the chat card. NEVER paste large HTML inline, and NEVER just link the file in prose \u2014 the fence is the embedding mechanism.",
        "- NEVER claim the chat is text-only or that you cannot embed. When you produce an HTML artifact, the ```viz-file``` fence embeds it.",
    ].join("\n");
    async function createRuntimeFor(sessionManager, enabledSkills = []) {
        const factory = async ({ cwd, sessionManager: sm, sessionStartEvent, }) => {
            // Restrict the skill CATALOG to only the card's enabled skills, so the
            // model's system prompt doesn't list (and self-invoke) everything.
            const enabledSet = new Set(enabledSkills);
            const skillsOverride = (result) => ({
                ...result,
                skills: (result.skills ?? []).filter((sk) => enabledSet.has(sk.name)),
            });
            // Keep the agent OUT of its own installation. One-time system-prompt
            // addition (not per-prompt, no context bloat).
            const appendSystemPromptOverride = (base) => [
                ...base,
                MELON_GUARDRAIL,
            ];
            const services = await createAgentSessionServices({
                cwd,
                resourceLoaderOptions: { skillsOverride, appendSystemPromptOverride },
            });
            return {
                ...(await createAgentSessionFromServices({
                    services,
                    sessionManager: sm,
                    sessionStartEvent: sessionStartEvent,
                })),
                services,
            };
        };
        return createAgentSessionRuntime(factory, {
            cwd: sessionManager.getCwd(),
            agentDir: getAgentDir(),
            sessionManager,
        });
    }
    async function attachSession(cardId, sessionManager, explicitModel, skills = []) {
        const runtime = await createRuntimeFor(sessionManager, skills);
        try {
            const wanted = explicitModel?.trim() || getDefaultModel(config.defaultModel);
            const [provider, id] = splitModel(wanted);
            const model = (await getModelRuntime()).getModel(provider, id);
            if (model) {
                await runtime.session.setModel(model);
                touchRecentModel(wanted);
            }
            runtime.session.setThinkingLevel(config.defaultThinkingLevel);
        }
        catch (e) {
            console.error("model switch failed:", e?.message ?? e);
        }
        wireEvents(cardId, runtime);
        registry.set(cardId, { runtime, clients: new Set(), busy: false, activeSkills: skills });
        return runtime;
    }
    function wireEvents(cardId, runtime) {
        let deltaCount = 0;
        const toolTimers = new Map();
        // Live context-window fill: broadcast on a 2s throttle while the turn
        // streams, and force a final one on agent_end.
        let ctxLast = 0;
        const broadcastCtx = (force = false) => {
            const now = Date.now();
            if (!force && now - ctxLast < 2000)
                return;
            ctxLast = now;
            try {
                const cu = runtime.session.getContextUsage?.();
                if (cu) {
                    registry.broadcast(cardId, {
                        type: "context_usage",
                        tokens: cu.tokens ?? null,
                        contextWindow: cu.contextWindow ?? 0,
                        percent: cu.percent ?? null,
                    });
                }
            }
            catch {
                /* unavailable — ignore */
            }
        };
        runtime.session.subscribe((event) => {
            try {
                if (event.type === "agent_start") {
                    console.log(`[${cardId}] agent_start`);
                }
                else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                    deltaCount++;
                }
                else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
                    // too chatty to broadcast every one; lifecycle shows via agent_*
                }
                else if (event.type === "turn_end") {
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `turn_end (${event.message?.stopReason ?? "done"})`,
                    });
                }
                else if (event.type === "auto_retry_start") {
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `provider error — auto-retrying (attempt ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}): ${event.errorMessage ?? "unknown"}`,
                    });
                }
                else if (event.type === "summarization_retry_scheduled") {
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `context overflow — summarizing and retrying: ${event.errorMessage ?? "context limit"}`,
                    });
                }
                else if (event.type === "compaction_start") {
                    registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
                }
                else if (event.type === "queue_update") {
                    const q = event;
                    if (q.steering || q.followUp)
                        registry.broadcast(cardId, {
                            type: "raw",
                            text: `queued: ${q.steering ?? ""}${q.followUp ?? ""}`,
                        });
                }
                else if (event.type === "agent_end") {
                    const msgs = event.messages ?? [];
                    const last = msgs[msgs.length - 1];
                    console.log(`[${cardId}] agent_end stopReason=${last?.stopReason} deltas=${deltaCount} usage=in:${last?.usage?.input ?? "?"} out:${last?.usage?.output ?? "?"}`);
                    // Auto-prune models the provider has removed ("not supported").
                    const errMsg = String(last?.errorMessage ?? "");
                    if (last?.stopReason === "error" &&
                        /not supported|no longer|deprecated|unknown model|does not exist/i.test(errMsg)) {
                        const dead = last?.model ? `${last.provider ?? "?"}/${last.model}` : null;
                        if (dead && !dead.includes("?/")) {
                            denylistModel(dead);
                            console.log(`[${cardId}] denylisted dead model: ${dead}`);
                        }
                    }
                    deltaCount = 0;
                    // Release the card as soon as the ANSWER is done. pi's prompt()
                    // promise can linger tens of seconds afterwards (post-run
                    // processing) — holding busy for that blocks the next message.
                    const entry = registry.get(cardId);
                    if (entry)
                        entry.busy = false;
                }
                else if (event.type === "auto_retry_start" || event.type === "summarization_retry_scheduled") {
                    console.log(`[${cardId}] ${event.type}`);
                }
                if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
                    registry.broadcast(cardId, {
                        type: "thinking",
                        text: event.assistantMessageEvent.delta,
                    });
                }
                else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                    registry.broadcast(cardId, { type: "delta", text: event.assistantMessageEvent.delta });
                    broadcastCtx();
                }
                else if (event.type === "agent_start") {
                    registry.broadcast(cardId, { type: "status", status: "streaming" });
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `▶ agent started — model ${modelToString(runtime.session.model)}`,
                    });
                }
                else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
                    // too chatty to broadcast every one; lifecycle shows via agent_*
                }
                else if (event.type === "turn_end") {
                    const msg = event.message;
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `turn_end (${msg?.stopReason ?? "done"})`,
                    });
                    // Structured boundary — clients close the current output segment.
                    // Include the real error so the UI can show WHY it failed.
                    registry.broadcast(cardId, {
                        type: "turn_end",
                        stopReason: msg?.stopReason,
                        error: msg?.errorMessage ?? undefined,
                    });
                }
                else if (event.type === "auto_retry_start") {
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `provider error — auto-retrying (attempt ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}): ${event.errorMessage ?? "unknown"}`,
                    });
                }
                else if (event.type === "summarization_retry_scheduled") {
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `context overflow — summarizing and retrying: ${event.errorMessage ?? "context limit"}`,
                    });
                }
                else if (event.type === "compaction_start") {
                    registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
                }
                else if (event.type === "agent_end") {
                    registry.broadcast(cardId, { type: "status", status: "idle" });
                    const msgs = event.messages ?? [];
                    const lastMsg = msgs[msgs.length - 1];
                    registry.broadcast(cardId, {
                        type: "raw",
                        text: `■ agent ended — ${lastMsg?.stopReason ?? "?"} | model ${lastMsg?.provider ?? "?"}/${lastMsg?.model ?? "?"} | in ${lastMsg?.usage?.input ?? "?"} out ${lastMsg?.usage?.output ?? "?"}`,
                    });
                    // Final context fill for this turn.
                    broadcastCtx(true);
                }
                else if (event.type === "tool_execution_start") {
                    toolTimers.set(event.toolCallId, Date.now());
                    registry.broadcast(cardId, {
                        type: "tool_start",
                        callId: event.toolCallId,
                        name: event.toolName,
                        args: preview(event.args),
                    });
                }
                else if (event.type === "tool_execution_update") {
                    registry.broadcast(cardId, {
                        type: "tool_update",
                        callId: event.toolCallId,
                        output: preview(event.partialResult),
                    });
                }
                else if (event.type === "tool_execution_end") {
                    registry.broadcast(cardId, {
                        type: "tool_end",
                        callId: event.toolCallId,
                        isError: event.isError,
                        output: preview(event.result),
                    });
                    broadcastCtx();
                }
            }
            catch (e) {
                console.error(`[${cardId}] event handler threw:`, e);
                try {
                    registry.broadcast(cardId, { type: "raw", text: `⚠ handler error: ${e?.message ?? e}` });
                }
                catch { }
            }
        });
    }
    const foldersFile = () => join(getAgentDir(), "melon", "folders.json");
    function loadFolderHistory() {
        try {
            return JSON.parse(readFileSync(foldersFile(), "utf8"));
        }
        catch {
            return [];
        }
    }
    function saveFolderHistory(list) {
        mkdirSync(join(getAgentDir(), "melon"), { recursive: true });
        writeFileSync(foldersFile(), JSON.stringify(list, null, "\t"));
    }
    function touchFolder(cwd) {
        const dir = expandHome(cwd);
        if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true)
            return;
        const list = loadFolderHistory();
        const now = new Date().toISOString();
        const existing = list.find((f) => f.cwd === dir);
        if (existing)
            existing.lastOpenedAt = now;
        else
            list.push({ cwd: dir, addedAt: now, lastOpenedAt: now });
        list.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
        saveFolderHistory(list);
    }
    function assertCwd(cwd) {
        const dir = expandHome(cwd ?? "");
        if (!dir || statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
            throw new Error(`invalid cwd: ${cwd}`);
        }
        return dir;
    }
    app.post("/sessions", async (req, reply) => {
        const body = req.body;
        const cardId = body?.cardId ?? randomUUID();
        let dir;
        try {
            dir = assertCwd(body?.cwd ?? config.defaultCwd);
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        const skills = Array.isArray(body?.skills) ? body.skills.filter((x) => typeof x === "string") : [];
        const runtime = await attachSession(cardId, SessionManager.create(dir), body?.model, skills);
        return {
            cardId,
            sessionId: runtime.session.sessionId,
            sessionFile: runtime.session.sessionFile,
            cwd: dir,
            model: modelToString(runtime.session.model),
        };
    });
    app.post("/sessions/resume", async (req, reply) => {
        const body = req.body;
        const cardId = body?.cardId ?? randomUUID();
        const sessionFile = body?.sessionFile;
        if (!sessionFile)
            return reply.code(400).send({ error: "sessionFile required" });
        const skills = Array.isArray(body?.skills) ? body.skills.filter((x) => typeof x === "string") : [];
        const runtime = await attachSession(cardId, SessionManager.open(sessionFile), body?.model, skills);
        return {
            cardId,
            sessionId: runtime.session.sessionId,
            sessionFile,
            cwd: runtime.session.sessionManager.getCwd(),
            model: modelToString(runtime.session.model),
        };
    });
    app.get("/projects", async () => {
        const root = join(getAgentDir(), "sessions");
        const projects = [];
        const seenCwds = new Set();
        for (const slug of readdirSync(root)) {
            const dir = join(root, slug);
            let files;
            try {
                files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
            }
            catch {
                continue;
            }
            if (files.length === 0)
                continue;
            let cwd;
            try {
                const header = JSON.parse(readFileSync(join(dir, files[0]), "utf8").split("\n")[0]);
                cwd = header.cwd;
            }
            catch {
                continue;
            }
            if (!cwd || seenCwds.has(cwd))
                continue;
            try {
                const list = (await SessionManager.list(cwd));
                if (list.length > 0) {
                    seenCwds.add(cwd);
                    projects.push({
                        cwd,
                        sessions: list.map((s) => ({
                            id: s.id,
                            file: s.path,
                            firstMessage: s.firstMessage?.slice(0, 60),
                            modified: s.modified,
                        })),
                    });
                }
            }
            catch {
                /* skip unreadable project */
            }
        }
        return { projects };
    });
    // Fork: copy root→leaf path into a NEW .jsonl (pi-native clone).
    // Child becomes a live session under newCardId; the parent keeps its own
    // runtime re-opened on its original file.
    app.post("/sessions/:cardId/fork", async (req, reply) => {
        const parentCardId = req.params.cardId;
        const body = req.body;
        const newCardId = body?.newCardId ?? randomUUID();
        let s = registry.get(parentCardId);
        // Card not live (e.g. server restarted)? Re-open it from disk.
        if (!s && body?.sessionFile) {
            s = {
                runtime: await createRuntimeFor(SessionManager.open(body.sessionFile)),
                clients: new Set(),
                busy: false,
            };
        }
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        if (s.busy)
            return reply.code(409).send({ error: "card is streaming" });
        const parentSessionFile = s.runtime.session.sessionFile;
        if (!parentSessionFile) {
            return reply.code(400).send({ error: "nothing to fork yet — send a message first" });
        }
        const leaf = s.runtime.session.sessionManager.getLeafEntry();
        const res = await s.runtime.fork(leaf?.id ?? "", { position: "at" });
        if (res.cancelled)
            return reply.code(409).send({ error: "fork cancelled" });
        wireEvents(newCardId, s.runtime);
        registry.set(newCardId, { runtime: s.runtime, clients: new Set(), busy: false });
        await attachSession(parentCardId, SessionManager.open(parentSessionFile));
        const childRuntime = registry.get(newCardId);
        return {
            newCardId,
            sessionId: childRuntime.runtime.session.sessionId,
            sessionFile: childRuntime.runtime.session.sessionFile,
            model: modelToString(childRuntime.runtime.session.model),
            forkedFromEntryId: leaf?.id,
            parentSessionFile,
        };
    });
    // ── Canvas persistence: <folder>/.melon/canvases/<id>.json ──
    function canvasesDir(cwd) {
        return join(expandHome(cwd), ".melon", "canvases");
    }
    // List workspaces in a folder (lightweight: reads each file's meta line).
    app.get("/canvases", async (req, reply) => {
        const q = req.query;
        let dir;
        try {
            dir = assertCwd(q.cwd);
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        // Opening a folder registers it in the sidebar history. Without this,
        // folders added via the native desktop dialog never reach the navbar
        // (only canvas SAVES used to call touchFolder).
        touchFolder(dir);
        const cvDir2 = canvasesDir(dir);
        const out = [];
        try {
            for (const f of readdirSync(cvDir2)) {
                if (!f.endsWith(".json"))
                    continue;
                try {
                    const raw = JSON.parse(readFileSync(join(cvDir2, f), "utf8"));
                    out.push({
                        id: raw.id ?? f.replace(/\.json$/, ""),
                        name: raw.name ?? "Untitled",
                        modified: raw.modified ?? "",
                    });
                }
                catch {
                    /* skip corrupt */
                }
            }
        }
        catch {
            /* no workspaces yet */
        }
        return { canvases: out };
    });
    // Recent canvases across ALL known folders (by last-modified), for the sidebar.
    app.get("/canvases/recent", async () => {
        const recents = [];
        for (const f of loadFolderHistory()) {
            const dir = canvasesDir(f.cwd);
            let files;
            try {
                files = readdirSync(dir);
            }
            catch {
                continue;
            }
            for (const file of files) {
                if (!file.endsWith(".json"))
                    continue;
                try {
                    const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
                    recents.push({
                        id: raw.id ?? file.replace(/\.json$/, ""),
                        name: raw.name ?? "Untitled",
                        cwd: f.cwd,
                        folderName: f.cwd.split("/").pop() ?? f.cwd,
                        modified: raw.modified ?? "",
                    });
                }
                catch {
                    /* skip corrupt */
                }
            }
        }
        recents.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
        return { recent: recents.slice(0, 12) };
    });
    // Delete a canvas file.
    app.delete("/canvases/:id", async (req, reply) => {
        const q = req.query;
        let dir;
        try {
            dir = assertCwd(q.cwd);
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        const { rmSync } = await import("node:fs");
        const file = join(canvasesDir(dir), `${req.params.id}.json`);
        try {
            rmSync(file);
            return { ok: true };
        }
        catch {
            return reply.code(404).send({ error: "canvas not found" });
        }
    });
    // Load one workspace fully.
    app.get("/canvases/:id", async (req, reply) => {
        const q = req.query;
        const file = join(canvasesDir(expandHome(q.cwd)), `${req.params.id}.json`);
        try {
            return JSON.parse(readFileSync(file, "utf8"));
        }
        catch {
            return reply.code(404).send({ error: "canvas not found" });
        }
    });
    // Save (upsert).
    app.put("/canvases/:id", async (req, reply) => {
        const body = req.body;
        let dir;
        try {
            dir = assertCwd(body?.cwd);
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        touchFolder(dir);
        const ws = body?.canvas ?? body?.workspace; // accept legacy key
        if (!ws?.id)
            return reply.code(400).send({ error: "canvas.id required" });
        // DATA GUARD: refuse to overwrite a populated canvas with an empty one.
        const existingFile = join(canvasesDir(dir), `${ws.id}.json`);
        try {
            const existing = JSON.parse(readFileSync(existingFile, "utf8"));
            if ((!Array.isArray(ws.cards) || ws.cards.length === 0) &&
                Array.isArray(existing.cards) &&
                existing.cards.length > 0) {
                return reply.code(409).send({
                    error: "refusing to overwrite populated canvas with empty state",
                    existingCards: existing.cards.length,
                });
            }
        }
        catch {
            /* no existing file — fine */
        }
        const cvDir2 = canvasesDir(dir);
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(cvDir2, { recursive: true });
        ws.modified = new Date().toISOString();
        writeFileSync(join(cvDir2, `${ws.id}.json`), JSON.stringify(ws));
        return { ok: true };
    });
    // Folder navigator: list subdirectories of a path for the in-app picker.
    app.get("/browse", async (req, reply) => {
        const q = req.query;
        let dir;
        try {
            dir = expandHome(q.path && q.path.trim() ? q.path : "~");
        }
        catch {
            dir = homedir();
        }
        if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
            return reply.code(400).send({ error: `not a directory: ${dir}` });
        }
        let dirs = [];
        try {
            dirs = readdirSync(dir, { withFileTypes: true })
                .filter((d) => d.isDirectory() && !d.name.startsWith("."))
                .map((d) => d.name)
                .sort((a, b) => a.localeCompare(b));
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        return { path: dir, parent: join(dir, ".."), dirs };
    });
    // Navigator tree: folder → canvases → their bound sessions (+ loose ones).
    app.get("/tree", async (req, reply) => {
        const q = req.query;
        let dir;
        try {
            dir = assertCwd(q.cwd ?? "~");
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        const cvDir = join(dir, ".melon", "canvases");
        const bound = new Set();
        const canvases = [];
        try {
            for (const f of readdirSync(cvDir)) {
                if (!f.endsWith(".json"))
                    continue;
                try {
                    const cv = JSON.parse(readFileSync(join(cvDir, f), "utf8"));
                    const sessions = (cv.cards ?? [])
                        .filter((c) => c.sessionFile)
                        .map((c) => {
                        bound.add(c.sessionFile);
                        return { file: c.sessionFile, title: c.title };
                    });
                    canvases.push({ id: cv.id, name: cv.name ?? "Untitled", sessions });
                }
                catch {
                    /* skip corrupt */
                }
            }
        }
        catch {
            /* no canvases dir */
        }
        const all = (await SessionManager.list(dir));
        const loose = all
            .filter((s) => !bound.has(s.path))
            .map((s) => ({ file: s.path, title: s.firstMessage?.slice(0, 60) }));
        return { cwd: dir, canvases, loose };
    });
    // Melon folder history — the navigator's source of truth.
    app.get("/folders", async () => {
        // Only list folders that still exist on disk — rm -rf'd folders vanish
        // from the sidebar on the next refresh.
        const folders = loadFolderHistory().filter((f) => statSync(f.cwd, { throwIfNoEntry: false })?.isDirectory() === true);
        return { folders };
    });
    app.post("/folders", async (req, reply) => {
        const cwd = req.body?.cwd;
        try {
            assertCwd(cwd);
        }
        catch (e) {
            return reply.code(400).send({ error: e.message });
        }
        touchFolder(cwd);
        return { ok: true };
    });
    app.delete("/folders", async (req, reply) => {
        const cwd = expandHome(req.query?.cwd ?? "");
        saveFolderHistory(loadFolderHistory().filter((f) => f.cwd !== cwd));
        return { ok: true };
    });
    // Native OS folder picker — runs locally, so the dialog appears on the
    // user's screen and we receive the real absolute path.
    app.post("/pick-folder", async (_req, reply) => {
        const { execFile } = await import("node:child_process");
        const commands = {
            darwin: [
                "osascript",
                "-e",
                `POSIX path of (choose folder with prompt "Choose a folder for your melon canvas")`,
            ],
            win32: [
                "powershell",
                "-NoProfile",
                "-Command",
                "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description = 'Choose a folder for your melon canvas'; if ($d.ShowDialog() -eq 'OK') { $d.SelectedPath }",
            ],
            linux: ["zenity", "--file-selection", "--directory"],
        };
        const [cmd, ...args] = commands[process.platform] ?? commands.linux;
        try {
            const stdout = await new Promise((resolve, reject) => {
                execFile(cmd, args, { timeout: 120000 }, (err, out) => (err ? reject(err) : resolve(String(out))));
            });
            const path = stdout.trim().replace(/\/$/, "");
            if (!path)
                return reply.code(409).send({ cancelled: true });
            if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
                return reply.code(400).send({ error: `not a directory: ${path}` });
            }
            touchFolder(path);
            return { path };
        }
        catch (e) {
            const msg = e.message ?? "";
            if (/cancel|err=-128|User dismissed/i.test(msg)) {
                return reply.code(409).send({ cancelled: true });
            }
            return reply.code(500).send({ error: msg });
        }
    });
    // Available models for the picker. ?provider= scopes the list to one provider.
    app.get("/models", async (req) => {
        const provider = String(req.query?.provider ?? "");
        const mr = await getModelRuntime();
        const all = mr.getModels().map((m) => ({
            label: `${m.provider}/${m.id}`,
            provider: m.provider,
            id: m.id,
        }));
        const denied = new Set((loadSettings().denylistedModels ?? []).map((x) => x));
        const filtered = all.filter((m) => !denied.has(m.label));
        const models = provider ? filtered.filter((m) => m.provider === provider) : filtered;
        return { models, total: models.length };
    });
    // Liveness probe — the frontend polls this to clear the "reconnecting" banner.
    app.get("/healthz", async () => ({
        ok: true,
        uptime: Math.round(process.uptime()),
        model: getDefaultModel(config.defaultModel),
    }));
    // Serve an agent-authored visualization HTML file for the viz-file iframe.
    // Guard: absolute path required; must resolve inside the session's cwd
    // (cards can only show files they could have written themselves).
    app.get("/viz", async (req, reply) => {
        const q = req.query;
        const p = q.path ?? "";
        if (!isAbsolute(p))
            return reply.code(400).send({ error: "absolute path required" });
        // cwd of the requesting card's session, else the requested folder, else default.
        let cwd = "";
        const card = registry.get(q.cardId ?? "");
        if (card?.runtime?.cwd)
            cwd = String(card.runtime.cwd);
        else if (q.cwd) {
            try {
                cwd = assertCwd(q.cwd);
            }
            catch {
                return reply.code(400).send({ error: "unknown cwd" });
            }
        }
        else
            cwd = expandHome(config.defaultCwd);
        const resolved = resolve(p);
        const rel = relative(resolve(cwd), resolved);
        if (rel.startsWith("..") || isAbsolute(rel)) {
            return reply.code(403).send({ error: "path outside the session working directory" });
        }
        try {
            const html = readFileSync(resolved, "utf8");
            return reply.type("text/html; charset=utf-8").send(html);
        }
        catch {
            return reply.code(404).send({ error: "not found" });
        }
    });
    // Available skills for the per-card toggle.
    app.get("/skills", async () => {
        const all = loadSkills();
        const skills = Object.values(all).map((sk) => ({
            id: sk.id,
            name: sk.name,
            description: sk.description,
        }));
        // Debug payload — lets the UI/console dump exactly what the server sees.
        const bundled = join(dirname(fileURLToPath(import.meta.url)), "skills");
        const agentSkills = join(getAgentDir(), "skills");
        const debug = {
            appSkillsDir: bundled,
            appSkillsExists: existsSync(bundled),
            agentSkillsDir: agentSkills,
            agentSkillsExists: existsSync(agentSkills),
            count: Object.keys(all).length,
            ids: Object.keys(all),
        };
        console.error(`[skills-debug] /skills returning ${skills.length}: ${skills.map((s) => s.id).join(", ")}`);
        return { skills, debug };
    });
    // Skill manager CRUD.
    app.get("/skills/:id", async (req, reply) => {
        const id = req.params.id;
        const sk = readSkill(id);
        if (!sk)
            return reply.code(404).send({ error: `unknown skill: ${id}` });
        return { id: sk.id, name: sk.name, description: sk.description, instructions: sk.instructions, raw: sk.raw };
    });
    const VALID_SKILL_ID = /^[a-z0-9-]+$/;
    app.post("/skills", async (req, reply) => {
        const b = req.body;
        const id = String(b?.id ?? "").trim();
        const name = String(b?.name ?? "").trim();
        const description = b?.description ? String(b.description).trim() : undefined;
        const instructions = String(b?.instructions ?? "").trim();
        if (!id || !name || !instructions)
            return reply.code(400).send({ error: "id, name and instructions are required" });
        if (!VALID_SKILL_ID.test(id) || id.length > 64)
            return reply.code(400).send({ error: "id must be lowercase letters, numbers and dashes (max 64)" });
        // Create must never silently overwrite — update goes through PUT.
        if (readSkill(id))
            return reply.code(409).send({ error: `A skill named "${id}" already exists — pick another id.` });
        saveSkill(id, name, description, instructions);
        return { ok: true, id };
    });
    app.put("/skills/:id", async (req, reply) => {
        const id = req.params.id;
        if (!VALID_SKILL_ID.test(id) || id.length > 64)
            return reply.code(400).send({ error: "invalid skill id" });
        const b = req.body;
        const name = String(b?.name ?? "").trim();
        const description = b?.description ? String(b.description).trim() : undefined;
        const instructions = String(b?.instructions ?? "").trim();
        if (!name || !instructions)
            return reply.code(400).send({ error: "name and instructions are required" });
        saveSkill(id, name, description, instructions);
        return { ok: true, id };
    });
    app.delete("/skills/:id", async (req, reply) => {
        const id = req.params.id;
        if (!VALID_SKILL_ID.test(id) || id.length > 64)
            return reply.code(400).send({ error: "invalid skill id" });
        deleteSkill(id);
        return { ok: true, id };
    });
    // Set a card's active skills + retract removed ones.
    app.post("/sessions/:cardId/skills", async (req, reply) => {
        const s = registry.get(req.params.cardId);
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        const next = Array.isArray(req.body?.skills)
            ? req.body.skills.filter((x) => typeof x === "string")
            : [];
        const prev = s.activeSkills ?? [];
        s.activeSkills = next;
        const skills = loadSkills();
        // Catalog is frozen after session start; the AI self-invokes enabled
        // skills on demand. Only retract skills toggled OFF.
        for (const id of prev) {
            if (!next.includes(id) && skills[id]) {
                try {
                    await s.runtime.session.followUp(`You are no longer following the "${skills[id].name}" skill. Ignore its instructions from now on.`);
                }
                catch {
                    /* ignore */
                }
            }
        }
        return { ok: true, skills: next };
    });
    // Switch model on a live card session.
    app.post("/sessions/:cardId/model", async (req, reply) => {
        const s = registry.get(req.params.cardId);
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        const model = String(req.body?.model ?? "");
        const [provider, id] = splitModel(model);
        if (!provider || !id)
            return reply.code(400).send({ error: "model must be provider/id" });
        try {
            const m = (await getModelRuntime()).getModel(provider, id);
            if (!m) {
                // Model is not in the live catalog — hide it so it stops failing.
                denylistModel(model);
                return reply.code(400).send({ error: `unknown model: ${model}` });
            }
            await s.runtime.session.setModel(m);
            touchRecentModel(model);
            return { ok: true, model };
        }
        catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });
    app.get("/settings", async () => ({ settings: loadSettings() }));
    app.put("/settings", async (req, reply) => {
        const body = req.body;
        if (!body || typeof body !== "object")
            return reply.code(400).send({ error: "body required" });
        const cur = loadSettings();
        const next = { ...cur, ...body };
        saveSettings(next);
        return { ok: true, settings: next };
    });
    app.post("/settings/model", async (req, reply) => {
        const model = req.body?.model;
        if (!model || !model.includes("/"))
            return reply.code(400).send({ error: "invalid model" });
        touchRecentModel(model);
        return { ok: true };
    });
    app.get("/auth/providers", async () => {
        const mr = await getModelRuntime();
        const settingsData = loadSettings();
        const melonKeys = settingsData.providerKeys ?? {};
        let authEntries = {};
        try {
            authEntries = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8"));
        }
        catch { }
        function maskKey(key) {
            return key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : `${key.slice(0, 4)}…`;
        }
        const allProviderIds = new Set();
        for (const m of mr.getModels())
            allProviderIds.add(m.provider);
        for (const pid of Object.keys(authEntries))
            allProviderIds.add(pid);
        const result = [];
        for (const pid of [...allProviderIds].sort()) {
            const status = mr.getProviderAuthStatus(pid);
            const entry = authEntries[pid];
            const melonKey = melonKeys[pid];
            let keyPreview;
            let authType;
            if (entry) {
                authType = entry.type ?? undefined;
                if (entry.type === "api_key" && typeof entry.key === "string")
                    keyPreview = maskKey(entry.key);
                else if (entry.type === "oauth" && typeof entry.access === "string")
                    keyPreview = maskKey(entry.access);
            }
            else if (melonKey) {
                keyPreview = maskKey(melonKey);
                authType = "api_key";
            }
            result.push({
                id: pid,
                provider: pid,
                configured: !!status.configured,
                source: status.source ?? undefined,
                keyPreview,
                authType,
            });
        }
        result.sort((a, b) => {
            if (a.configured !== b.configured)
                return a.configured ? -1 : 1;
            return a.id.localeCompare(b.id);
        });
        return result;
    });
    app.post("/auth/:provider/key", async (req, reply) => {
        const provider = req.params.provider;
        const key = req.body?.key;
        if (!key)
            return reply.code(400).send({ error: "key required" });
        try {
            await (await getModelRuntime()).setRuntimeApiKey(provider, key);
            const st = loadSettings();
            st.providerKeys = { ...(st.providerKeys ?? {}), [provider]: key };
            saveSettings(st);
            return { ok: true };
        }
        catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });
    app.delete("/auth/:provider", async (req) => {
        const provider = req.params.provider;
        await (await getModelRuntime()).removeRuntimeApiKey(provider);
        const st = loadSettings();
        if (st.providerKeys)
            delete st.providerKeys[provider];
        saveSettings(st);
        return { ok: true };
    });
    // Transcript from ground truth: pi session .jsonl (context-aware, compaction-safe).
    app.get("/transcript", async (req, reply) => {
        const q = req.query;
        const file = q.sessionFile ? expandHome(q.sessionFile) : undefined;
        if (!file || statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
            return reply.code(400).send({ error: "valid sessionFile required" });
        }
        try {
            const sm = SessionManager.open(file);
            const ctx = sm.buildContextEntries();
            const clean = (t) => t.split("\n[VISUALIZATION PROTOCOL")[0].split("\n[VIZ MODE IS ON")[0].split("\n[READ-ONLY MODE")[0].trim();
            const textOf = (content) => (Array.isArray(content) ? content : [])
                .filter((b) => b.type === "text")
                .map((b) => b.text)
                .join("");
            const messages = [];
            for (const e of ctx) {
                if (e.type !== "message")
                    continue;
                const m = e.message;
                if (m.role === "user") {
                    const text = clean(textOf(m.content));
                    if (text)
                        messages.push({ role: "user", text });
                }
                else if (m.role === "assistant") {
                    let text = "";
                    let thinking = "";
                    for (const b of m.content ?? []) {
                        if (b.type === "text")
                            text += b.text;
                        else if (b.type === "thinking")
                            thinking += b.thinking ?? "";
                    }
                    if (text.trim() || thinking.trim())
                        messages.push({
                            role: "assistant",
                            text: text.trim(),
                            thinking: thinking.trim() || undefined,
                        });
                }
                else if (m.role === "toolResult") {
                    const lastA = [...messages].reverse().find((x) => x.role === "assistant");
                    if (lastA) {
                        lastA.tools = lastA.tools ?? [];
                        if (!lastA.tools.some((t) => t.callId === m.toolCallId)) {
                            lastA.tools.push({
                                callId: m.toolCallId,
                                name: m.toolName ?? "tool",
                                status: m.isError ? "error" : "ok",
                                output: textOf(m.content).slice(0, 4000),
                            });
                        }
                    }
                }
            }
            return {
                sessionId: sm.getSessionId(),
                cwd: sm.getCwd(),
                messages,
            };
        }
        catch (e) {
            return reply.code(500).send({ error: e.message });
        }
    });
    app.get("/sessions/:cardId/events", (req, reply) => {
        const s = registry.get(req.params.cardId);
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        reply.raw.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
            // Raw write bypasses @fastify/cors — add the CORS header manually.
            "access-control-allow-origin": req.headers.origin ?? "*",
        });
        reply.raw.flushHeaders(); // send headers NOW — SSE has no body yet
        s.clients.add(reply);
        req.raw.on("close", () => s.clients.delete(reply));
    });
    app.post("/sessions/:cardId/prompt", async (req, reply) => {
        const s = registry.get(req.params.cardId);
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        const cardId = req.params.cardId;
        const started = Date.now();
        // Busy? Queue via pi's followUp — runs automatically when current work ends.
        if (s.busy) {
            try {
                await s.runtime.session.followUp(req.body?.text ?? "");
                reply.send({ ok: true, queued: true });
            }
            catch (e) {
                reply.code(500).send({ error: e.message });
            }
            return;
        }
        s.busy = true;
        reply.send({ ok: true });
        console.log(`[${cardId}] prompt:start "${String(req.body?.text).slice(0, 60)}"`);
        registry.broadcast(cardId, { type: "raw", text: "⬇ prompt received by server" });
        try {
            const text = req.body?.text ?? "";
            // Skills are activated via pi's native /skill: followUp on toggle —
            // NOT appended per-prompt (that bloated the context window).
            await s.runtime.session.prompt(text);
            console.log(`[${cardId}] prompt:end (${Date.now() - started}ms)`);
        }
        catch (e) {
            console.error(`[${cardId}] prompt:THREW ${e.stack}`);
            registry.broadcast(cardId, { type: "error", message: e.message });
            registry.broadcast(cardId, { type: "status", status: "error" });
        }
        finally {
            s.busy = false;
        }
    });
    app.post("/sessions/:cardId/abort", async (req, reply) => {
        const s = registry.get(req.params.cardId);
        if (!s)
            return reply.code(404).send({ error: "unknown card" });
        registry.broadcast(req.params.cardId, { type: "raw", text: "⏹ stop requested (server)" });
        try {
            await s.runtime.session.abort();
            registry.broadcast(req.params.cardId, { type: "raw", text: "■ generation stopped" });
        }
        catch (e) {
            console.error(`[${req.params.cardId}] abort threw:`, e.message);
        }
        return { ok: true };
    });
    // Serve web UI in production (when web-dist exists next to server)
    // Resolve web-dist relative to THIS script (not cwd — packaged apps launch from / or home).
    const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web-dist");
    if (existsSync(join(webDist, "index.html"))) {
        await app.register(fastifyStatic, { root: webDist });
        app.setNotFoundHandler((req, reply) => {
            if (req.method === "GET") {
                return reply.type("text/html").send(readFileSync(join(webDist, "index.html")));
            }
            reply.code(404).send({ error: "not found" });
        });
    }
    return app;
}
// One-time migration: Melon is isolated in ~/.melon/agent. On first run, if it's
// empty but a terminal pi install (~/.pi/agent) exists, copy credentials + catalog
// so the user doesn't have to re-enter API keys. Idempotent — runs only when empty.
function seedFromPiIfEmpty() {
    const melonDir = getAgentDir();
    const piDir = join(homedir(), ".pi", "agent");
    if (existsSync(join(melonDir, "auth.json")) || !existsSync(join(piDir, "auth.json")))
        return;
    try {
        mkdirSync(melonDir, { recursive: true });
        for (const f of ["auth.json", "models-store.json"]) {
            const src = join(piDir, f);
            const dst = join(melonDir, f);
            if (existsSync(src) && !existsSync(dst)) {
                copyFileSync(src, dst);
                console.error(`[melon] seeded ${f} from ~/.pi/agent`);
            }
        }
    }
    catch (e) {
        console.error("[melon] seed failed:", e?.message ?? e);
    }
}
// pi auto-retries model errors by default (429/overloaded/etc., up to 3x).
// We want FAIL FAST: a model error ends the turn with the real message, no
// silent retry loop. Write retry.enabled=false into the agent settings.
function ensureRetryDisabled() {
    const file = join(getAgentDir(), "settings.json");
    try {
        const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
        if (cur.retry?.enabled === false)
            return;
        writeFileSync(file, JSON.stringify({ ...cur, retry: { enabled: false } }, null, 2));
        console.error("[melon] retries disabled — model errors fail fast");
    }
    catch (e) {
        console.error("[melon] failed to disable retry:", e?.message ?? e);
    }
}
// Run directly? (vs imported by tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
    const config = loadConfig();
    seedFromPiIfEmpty();
    materializeSkills();
    ensureRetryDisabled();
    const app = await buildApp();
    const addr = await app.listen({ port: config.port, host: "127.0.0.1" });
    const boundPort = Number(String(addr).split(":").pop());
    // Structured handshake for the Electron parent — do NOT change this format.
    console.log(`MELON_READY ${JSON.stringify({ port: boundPort })}`);
    console.error(`melon-server on http://127.0.0.1:${boundPort}`);
}
//# sourceMappingURL=index.js.map