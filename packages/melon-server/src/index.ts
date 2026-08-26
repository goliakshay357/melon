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
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	ModelRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { expandHome, loadConfig, type MelonConfig, modelToString, preview } from "./config.ts";
import { SessionRegistry } from "./session-registry.ts";
import { loadSettings, saveSettings, touchRecentModel } from "./settings.js";


let _modelRuntime: ModelRuntime | undefined;
async function getModelRuntime(): Promise<ModelRuntime> {
	if (!_modelRuntime) _modelRuntime = await ModelRuntime.create();
	return _modelRuntime;
}

export interface MelonServerDeps {
	config?: Partial<MelonConfig>;
}

export async function buildApp(deps: MelonServerDeps = {}): Promise<FastifyInstance> {
	const config = loadConfig(deps.config);
	const PROTOCOL = [
		"",
		"[VISUALIZATION PROTOCOL - melon canvas]",
		"You explain on a visual canvas. When a visual genuinely aids understanding, include:",
		"2. ```viz-html fenced blocks for interactive 3D/animated scenes.",
		"viz-html contract (STRICT):",
		"- ONE complete self-contained HTML document per block.",
		'- Load three.js via <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js"}}</script> then import * as THREE from \'three\'.',
		"- Inline all CSS/JS. Dark theme: background #161b22, readable colors.",
		"- Animation via requestAnimationFrame; no external files.",
	"- NEVER emit mermaid, flowchart, or ASCII-art diagrams (e.g. flowchart TB). They render badly. For diagrams use a viz-html scene instead; otherwise explain in prose.",
		"- VIEWPORT: your HTML renders in a frame ~380px wide x 320px tall (auto-height up to 700px). Design for that: vertical stacking, nothing critical below 300px height. ABSOLUTELY NO horizontal overflow — set body { overflow-x: hidden } and keep all elements within 100% width.",
		"Keep prose explanation around the blocks.",
	].join("\n");

	const app = Fastify({ logger: false });
	await app.register(cors, { origin: true });

	const registry = new SessionRegistry();

	async function createRuntimeFor(sessionManager: any): Promise<any> {
		const factory: any = async ({
			cwd,
			sessionManager: sm,
			sessionStartEvent,
		}: {
			cwd: string;
			sessionManager: any;
			sessionStartEvent?: unknown;
		}) => {
			const services = await createAgentSessionServices({ cwd });
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager: sm,
					sessionStartEvent: sessionStartEvent as never,
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

	async function attachSession(cardId: string, sessionManager: any): Promise<any> {
		const runtime = await createRuntimeFor(sessionManager);
		try {
			const [provider, id] = config.defaultModel.split("/");
			const model = (await getModelRuntime()).getModel(provider, id);
			if (model) await runtime.session.setModel(model);
			runtime.session.setThinkingLevel(config.defaultThinkingLevel);
		} catch (e) {
			console.error("model switch failed:", (e as Error)?.message ?? e);
		}
		wireEvents(cardId, runtime);
		registry.set(cardId, { runtime, clients: new Set(), busy: false });
		return runtime;
	}

	function wireEvents(cardId: string, runtime: any): void {
		let deltaCount = 0;
		const toolTimers = new Map<string, number>();
		runtime.session.subscribe((event: any) => {
			if (event.type === "agent_start") {
				console.log(`[${cardId}] agent_start`);
			} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				deltaCount++;
			} else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
				// too chatty to broadcast every one; lifecycle shows via agent_*
			} else if (event.type === "turn_end") {
				registry.broadcast(cardId, {
					type: "raw",
					text: `turn_end (${(event.message as any)?.stopReason ?? "done"})`,
				});
			} else if (event.type === "auto_retry_start") {
				registry.broadcast(cardId, { type: "raw", text: "provider error — auto-retrying…" });
			} else if (event.type === "summarization_retry_scheduled") {
				registry.broadcast(cardId, { type: "raw", text: "context overflow — summarizing and retrying…" });
			} else if (event.type === "compaction_start") {
				registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
			} else if (event.type === "queue_update") {
				const q = event as any;
				if (q.steering || q.followUp)
					registry.broadcast(cardId, {
						type: "raw",
						text: `queued: ${q.steering ?? ""}${q.followUp ?? ""}`,
					});
			} else if (event.type === "agent_end") {
				const msgs = event.messages ?? [];
				const last = msgs[msgs.length - 1];
				console.log(
					`[${cardId}] agent_end stopReason=${last?.stopReason} deltas=${deltaCount} usage=in:${last?.usage?.input?.tokens ?? "?"} out:${last?.usage?.output?.tokens ?? "?"}`,
				);
				deltaCount = 0;
				// Release the card as soon as the ANSWER is done. pi's prompt()
				// promise can linger tens of seconds afterwards (post-run
				// processing) — holding busy for that blocks the next message.
				const entry = registry.get(cardId);
				if (entry) entry.busy = false;
			} else if (event.type === "auto_retry_start" || event.type === "summarization_retry_scheduled") {
				console.log(`[${cardId}] ${event.type}`);
			}

			if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
				registry.broadcast(cardId, {
					type: "thinking",
					text: event.assistantMessageEvent.delta,
				});
			} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				registry.broadcast(cardId, { type: "delta", text: event.assistantMessageEvent.delta });
			} else if (event.type === "agent_start") {
				registry.broadcast(cardId, { type: "status", status: "streaming" });
			} else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
				// too chatty to broadcast every one; lifecycle shows via agent_*
			} else if (event.type === "turn_end") {
				registry.broadcast(cardId, {
					type: "raw",
					text: `turn_end (${(event.message as any)?.stopReason ?? "done"})`,
				});
				// Structured boundary — clients close the current output segment.
				registry.broadcast(cardId, { type: "turn_end", stopReason: (event.message as any)?.stopReason });
			} else if (event.type === "auto_retry_start") {
				registry.broadcast(cardId, { type: "raw", text: "provider error — auto-retrying…" });
			} else if (event.type === "summarization_retry_scheduled") {
				registry.broadcast(cardId, { type: "raw", text: "context overflow — summarizing and retrying…" });
			} else if (event.type === "compaction_start") {
				registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
			} else if (event.type === "queue_update") {
				const q = event as any;
				if (q.steering || q.followUp)
					registry.broadcast(cardId, {
						type: "raw",
						text: `queued: ${q.steering ?? ""}${q.followUp ?? ""}`,
					});
			} else if (event.type === "agent_end") {
				registry.broadcast(cardId, { type: "status", status: "idle" });
			} else if (event.type === "tool_execution_start") {
				toolTimers.set(event.toolCallId, Date.now());
				registry.broadcast(cardId, {
					type: "tool_start",
					callId: event.toolCallId,
					name: event.toolName,
					args: preview(event.args),
				});
			} else if (event.type === "tool_execution_update") {
				registry.broadcast(cardId, {
					type: "tool_update",
					callId: event.toolCallId,
					output: preview(event.partialResult),
				});
			} else if (event.type === "tool_execution_end") {
				registry.broadcast(cardId, {
					type: "tool_end",
					callId: event.toolCallId,
					isError: event.isError,
					output: preview(event.result),
				});
			}
		});
	}

	// ── Melon-owned folder history (independent of pi's session store) ──
	interface FolderEntry {
		cwd: string;
		addedAt: string;
		lastOpenedAt: string;
	}
	const foldersFile = () => join(getAgentDir(), "melon", "folders.json");
	function loadFolderHistory(): FolderEntry[] {
		try {
			return JSON.parse(readFileSync(foldersFile(), "utf8"));
		} catch {
			return [];
		}
	}
	function saveFolderHistory(list: FolderEntry[]): void {
		mkdirSync(join(getAgentDir(), "melon"), { recursive: true });
		writeFileSync(foldersFile(), JSON.stringify(list, null, "\t"));
	}
	function touchFolder(cwd: string): void {
		const dir = expandHome(cwd);
		if (statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) return;
		const list = loadFolderHistory();
		const now = new Date().toISOString();
		const existing = list.find((f) => f.cwd === dir);
		if (existing) existing.lastOpenedAt = now;
		else list.push({ cwd: dir, addedAt: now, lastOpenedAt: now });
		list.sort((a, b) => b.lastOpenedAt.localeCompare(a.lastOpenedAt));
		saveFolderHistory(list);
	}

	function assertCwd(cwd?: string): string {
		const dir = expandHome(cwd ?? "");
		if (!dir || statSync(dir, { throwIfNoEntry: false })?.isDirectory() !== true) {
			throw new Error(`invalid cwd: ${cwd}`);
		}
		return dir;
	}

	app.post("/sessions", async (req, reply) => {
		const cardId = (req.body as any)?.cardId ?? randomUUID();
		let dir: string;
		try {
			dir = assertCwd((req.body as any)?.cwd ?? config.defaultCwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const runtime = await attachSession(cardId, SessionManager.create(dir));
		return {
			cardId,
			sessionId: runtime.session.sessionId,
			sessionFile: runtime.session.sessionFile,
			cwd: dir,
			model: modelToString(runtime.session.model),
		};
	});

	app.post("/sessions/resume", async (req, reply) => {
		const body = req.body as any;
		const cardId = body?.cardId ?? randomUUID();
		const sessionFile = body?.sessionFile;
		if (!sessionFile) return reply.code(400).send({ error: "sessionFile required" });
		const runtime = await attachSession(cardId, SessionManager.open(sessionFile));
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
		const projects: Array<{ cwd: string; sessions: any[] }> = [];
		const seenCwds = new Set<string>();
		for (const slug of readdirSync(root)) {
			const dir = join(root, slug);
			let files: string[];
			try {
				files = readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
			} catch {
				continue;
			}
			if (files.length === 0) continue;
			let cwd: string | undefined;
			try {
				const header = JSON.parse(readFileSync(join(dir, files[0]), "utf8").split("\n")[0]);
				cwd = header.cwd;
			} catch {
				continue;
			}
			if (!cwd || seenCwds.has(cwd)) continue;
			try {
				const list = (await SessionManager.list(cwd)) as any[];
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
			} catch {
				/* skip unreadable project */
			}
		}
		return { projects };
	});

	// Fork: copy root→leaf path into a NEW .jsonl (pi-native clone).
	// Child becomes a live session under newCardId; the parent keeps its own
	// runtime re-opened on its original file.
	app.post("/sessions/:cardId/fork", async (req, reply) => {
		const parentCardId = (req.params as any).cardId;
		const body = req.body as any;
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
		if (!s) return reply.code(404).send({ error: "unknown card" });
		if (s.busy) return reply.code(409).send({ error: "card is streaming" });

		const parentSessionFile = s.runtime.session.sessionFile;
		if (!parentSessionFile) {
			return reply.code(400).send({ error: "nothing to fork yet — send a message first" });
		}
		const leaf = s.runtime.session.sessionManager.getLeafEntry();

		const res = await s.runtime.fork(leaf?.id ?? "", { position: "at" });
		if (res.cancelled) return reply.code(409).send({ error: "fork cancelled" });

		wireEvents(newCardId, s.runtime);
		registry.set(newCardId, { runtime: s.runtime, clients: new Set(), busy: false });
		await attachSession(parentCardId, SessionManager.open(parentSessionFile));

		const childRuntime = registry.get(newCardId)!;
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
	function canvasesDir(cwd: string): string {
		return join(expandHome(cwd), ".melon", "canvases");
	}

	// List workspaces in a folder (lightweight: reads each file's meta line).
	app.get("/canvases", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = assertCwd(q.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const cvDir2 = canvasesDir(dir);
		const out: Array<{ id: string; name: string; modified: string }> = [];
		try {
			for (const f of readdirSync(cvDir2)) {
				if (!f.endsWith(".json")) continue;
				try {
					const raw = JSON.parse(readFileSync(join(cvDir2, f), "utf8"));
					out.push({
						id: raw.id ?? f.replace(/\.json$/, ""),
						name: raw.name ?? "Untitled",
						modified: raw.modified ?? "",
					});
				} catch {
					/* skip corrupt */
				}
			}
		} catch {
			/* no workspaces yet */
		}
		return { canvases: out };
	});

	// Delete a canvas file.
	app.delete("/canvases/:id", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = assertCwd(q.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const { rmSync } = await import("node:fs");
		const file = join(canvasesDir(dir), `${(req.params as any).id}.json`);
		try {
			rmSync(file);
			return { ok: true };
		} catch {
			return reply.code(404).send({ error: "canvas not found" });
		}
	});

	// Load one workspace fully.
	app.get("/canvases/:id", async (req, reply) => {
		const q = req.query as any;
		const file = join(canvasesDir(expandHome(q.cwd)), `${(req.params as any).id}.json`);
		try {
			return JSON.parse(readFileSync(file, "utf8"));
		} catch {
			return reply.code(404).send({ error: "canvas not found" });
		}
	});

	// Save (upsert).
	app.put("/canvases/:id", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		touchFolder(dir);
		const ws = body?.canvas ?? body?.workspace; // accept legacy key
		if (!ws?.id) return reply.code(400).send({ error: "canvas.id required" });
		// DATA GUARD: refuse to overwrite a populated canvas with an empty one.
		const existingFile = join(canvasesDir(dir), `${ws.id}.json`);
		try {
			const existing = JSON.parse(readFileSync(existingFile, "utf8"));
			if (
				(!Array.isArray(ws.cards) || ws.cards.length === 0) &&
				Array.isArray(existing.cards) &&
				existing.cards.length > 0
			) {
				return reply.code(409).send({
					error: "refusing to overwrite populated canvas with empty state",
					existingCards: existing.cards.length,
				});
			}
		} catch {
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
		const q = req.query as any;
		let dir: string;
		try {
			dir = expandHome(q.path && q.path.trim() ? q.path : "~");
		} catch {
			dir = homedir();
		}
		if (!statSync(dir, { throwIfNoEntry: false })?.isDirectory()) {
			return reply.code(400).send({ error: `not a directory: ${dir}` });
		}
		let dirs: string[] = [];
		try {
			dirs = readdirSync(dir, { withFileTypes: true })
				.filter((d) => d.isDirectory() && !d.name.startsWith("."))
				.map((d) => d.name)
				.sort((a, b) => a.localeCompare(b));
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		return { path: dir, parent: join(dir, ".."), dirs };
	});

	// Navigator tree: folder → canvases → their bound sessions (+ loose ones).
	app.get("/tree", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = assertCwd(q.cwd ?? "~");
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const cvDir = join(dir, ".melon", "canvases");
		const bound = new Set<string>();
		const canvases: Array<{
			id: string;
			name: string;
			sessions: Array<{ file: string; title?: string }>;
		}> = [];
		try {
			for (const f of readdirSync(cvDir)) {
				if (!f.endsWith(".json")) continue;
				try {
					const cv = JSON.parse(readFileSync(join(cvDir, f), "utf8"));
					const sessions = (cv.cards ?? [])
						.filter((c: any) => c.sessionFile)
						.map((c: any) => {
							bound.add(c.sessionFile);
							return { file: c.sessionFile, title: c.title };
						});
					canvases.push({ id: cv.id, name: cv.name ?? "Untitled", sessions });
				} catch {
					/* skip corrupt */
				}
			}
		} catch {
			/* no canvases dir */
		}

		const all = (await SessionManager.list(dir)) as any[];
		const loose = all
			.filter((s) => !bound.has(s.path))
			.map((s) => ({ file: s.path, title: s.firstMessage?.slice(0, 60) }));

		return { cwd: dir, canvases, loose };
	});

	// Melon folder history — the navigator's source of truth.
	app.get("/folders", async () => ({ folders: loadFolderHistory() }));

	app.post("/folders", async (req, reply) => {
		const cwd = (req.body as any)?.cwd;
		try {
			assertCwd(cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		touchFolder(cwd);
		return { ok: true };
	});

	app.delete("/folders", async (req, reply) => {
		const cwd = expandHome((req.query as any)?.cwd ?? "");
		saveFolderHistory(loadFolderHistory().filter((f) => f.cwd !== cwd));
		return { ok: true };
	});

	// Native OS folder picker — runs locally, so the dialog appears on the
	// user's screen and we receive the real absolute path.
	app.post("/pick-folder", async (_req, reply) => {
		const { execFile } = await import("node:child_process");
		const commands: Record<string, string[]> = {
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
			const stdout = await new Promise<string>((resolve, reject) => {
				execFile(cmd, args, { timeout: 120000 }, (err, out) => (err ? reject(err) : resolve(String(out))));
			});
			const path = stdout.trim().replace(/\/$/, "");
			if (!path) return reply.code(409).send({ cancelled: true });
			if (statSync(path, { throwIfNoEntry: false })?.isDirectory() !== true) {
				return reply.code(400).send({ error: `not a directory: ${path}` });
			}
			touchFolder(path);
			return { path };
		} catch (e) {
			const msg = (e as Error).message ?? "";
			if (/cancel|err=-128|User dismissed/i.test(msg)) {
				return reply.code(409).send({ cancelled: true });
			}
			return reply.code(500).send({ error: msg });
		}
	});

	// Available models for the picker. ?provider= scopes the list to one provider.
	app.get("/models", async (req) => {
		const provider = String((req.query as any)?.provider ?? "");
		const mr = await getModelRuntime();
		const all = mr.getModels().map((m: any) => ({
			label: `${m.provider}/${m.id}`,
			provider: m.provider,
			id: m.id,
		}));
		const models = provider ? all.filter((m) => m.provider === provider) : all;
		return { models, total: models.length };
	});

	// Switch model on a live card session.
	app.post("/sessions/:cardId/model", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const model = String((req.body as any)?.model ?? "");
		const [provider, id] = model.split("/");
		if (!provider || !id) return reply.code(400).send({ error: "model must be provider/id" });
		try {
			const m = (await getModelRuntime()).getModel(provider, id);
			if (!m) return reply.code(400).send({ error: `unknown model: ${model}` });
			await s.runtime.session.setModel(m);
			return { ok: true, model };
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
	});

	app.get("/settings", async () => ({ settings: loadSettings() }));

	app.put("/settings", async (req, reply) => {
		const body = req.body as any;
		if (!body || typeof body !== "object") return reply.code(400).send({ error: "body required" });
		const cur = loadSettings();
		const next = { ...cur, ...body };
		saveSettings(next);
		return { ok: true, settings: next };
	});

	app.post("/settings/model", async (req, reply) => {
		const model = (req.body as any)?.model;
		if (!model || !model.includes("/")) return reply.code(400).send({ error: "invalid model" });
		touchRecentModel(model);
		return { ok: true };
	});

	app.get("/auth/providers", async () => {
		const mr = await getModelRuntime();
		const settingsData = loadSettings();
		const melonKeys: Record<string, string> = settingsData.providerKeys ?? {};

		let authEntries: Record<string, any> = {};
		try {
			authEntries = JSON.parse(readFileSync(join(getAgentDir(), "auth.json"), "utf8"));
		} catch {}

		function maskKey(key: string): string {
			return key.length > 10 ? `${key.slice(0, 6)}…${key.slice(-4)}` : `${key.slice(0, 4)}…`;
		}

		const allProviderIds = new Set<string>();
		for (const m of mr.getModels()) allProviderIds.add(m.provider);
		for (const pid of Object.keys(authEntries)) allProviderIds.add(pid);

		const result: Array<{
			id: string;
			provider: string;
			configured: boolean;
			source?: string;
			keyPreview?: string;
			authType?: string;
		}> = [];

		for (const pid of [...allProviderIds].sort()) {
			const status = mr.getProviderAuthStatus(pid);
			const entry = authEntries[pid];
			const melonKey = melonKeys[pid];

			let keyPreview: string | undefined;
			let authType: string | undefined;

			if (entry) {
				authType = entry.type ?? undefined;
				if (entry.type === "api_key" && typeof entry.key === "string")
					keyPreview = maskKey(entry.key);
				else if (entry.type === "oauth" && typeof entry.access === "string")
					keyPreview = maskKey(entry.access);
			} else if (melonKey) {
				keyPreview = maskKey(melonKey);
				authType = "api_key";
			}

			result.push({
				id: pid,
				provider: pid,
				configured: !!status.configured,
				source: (status as any).source ?? undefined,
				keyPreview,
				authType,
			});
		}

		result.sort((a, b) => {
			if (a.configured !== b.configured) return a.configured ? -1 : 1;
			return a.id.localeCompare(b.id);
		});
		return result;
	});

	app.post("/auth/:provider/key", async (req, reply) => {
		const provider = (req.params as any).provider;
		const key = (req.body as any)?.key;
		if (!key) return reply.code(400).send({ error: "key required" });
		try {
			await (await getModelRuntime()).setRuntimeApiKey(provider, key);
			const st = loadSettings();
			st.providerKeys = { ...(st.providerKeys ?? {}), [provider]: key };
			saveSettings(st);
			return { ok: true };
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
	});

	app.delete("/auth/:provider", async (req) => {
		const provider = (req.params as any).provider;
		await (await getModelRuntime()).removeRuntimeApiKey(provider);
		const st = loadSettings();
		if (st.providerKeys) delete st.providerKeys[provider];
		saveSettings(st);
		return { ok: true };
	});



	// Transcript from ground truth: pi session .jsonl (context-aware, compaction-safe).
	app.get("/transcript", async (req, reply) => {
		const q = req.query as any;
		const file = q.sessionFile ? expandHome(q.sessionFile) : undefined;
		if (!file || statSync(file, { throwIfNoEntry: false })?.isFile() !== true) {
			return reply.code(400).send({ error: "valid sessionFile required" });
		}
		try {
			const sm = SessionManager.open(file);
			const ctx = sm.buildContextEntries() as any[];
			const clean = (t: string) =>
				t
					.split("\n[VISUALIZATION PROTOCOL")[0]
					.split("\n[VIZ MODE IS ON")[0]
					.split("\n[READ-ONLY MODE")[0]
					.trim();
			const textOf = (content: any): string =>
				(Array.isArray(content) ? content : [])
					.filter((b: any) => b.type === "text")
					.map((b: any) => b.text)
					.join("");
			const messages: any[] = [];
			for (const e of ctx) {
				if (e.type !== "message") continue;
				const m: any = e.message;
				if (m.role === "user") {
					const text = clean(textOf(m.content));
					if (text) messages.push({ role: "user", text });
				} else if (m.role === "assistant") {
					let text = "";
					let thinking = "";
					for (const b of m.content ?? []) {
						if (b.type === "text") text += b.text;
						else if (b.type === "thinking") thinking += b.thinking ?? "";
					}
					if (text.trim() || thinking.trim())
						messages.push({
							role: "assistant",
							text: text.trim(),
							thinking: thinking.trim() || undefined,
						});
				} else if (m.role === "toolResult") {
					const lastA = [...messages].reverse().find((x) => x.role === "assistant");
					if (lastA) {
						lastA.tools = lastA.tools ?? [];
						if (!lastA.tools.some((t: any) => t.callId === m.toolCallId)) {
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
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
	});

	app.get("/sessions/:cardId/events", (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		reply.raw.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			// Raw write bypasses @fastify/cors — add the CORS header manually.
			"access-control-allow-origin": (req.headers.origin as string) ?? "*",
		});
		reply.raw.flushHeaders(); // send headers NOW — SSE has no body yet
		s.clients.add(reply);
		req.raw.on("close", () => s.clients.delete(reply));
	});

	app.post("/sessions/:cardId/prompt", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const cardId = (req.params as any).cardId;
		const started = Date.now();
		// Busy? Queue via pi's followUp — runs automatically when current work ends.
		if (s.busy) {
			try {
				await s.runtime.session.followUp((req.body as any)?.text ?? "");
				reply.send({ ok: true, queued: true });
			} catch (e) {
				reply.code(500).send({ error: (e as Error).message });
			}
			return;
		}
		s.busy = true;
		reply.send({ ok: true });

		console.log(`[${cardId}] prompt:start "${String((req.body as any)?.text).slice(0, 60)}"`);
		try {
			let text = (req.body as any)?.text ?? "";
			if (!s.vizProtocolSent) {
				s.vizProtocolSent = true;
				text = text + "\n" + PROTOCOL;
			}
			await s.runtime.session.prompt(text);
			console.log(`[${cardId}] prompt:end (${Date.now() - started}ms)`);
		} catch (e) {
			console.error(`[${cardId}] prompt:THREW ${(e as Error).stack}`);
			registry.broadcast(cardId, { type: "error", message: (e as Error).message });
			registry.broadcast(cardId, { type: "status", status: "error" });
		} finally {
			s.busy = false;
		}
	});

	app.post("/sessions/:cardId/abort", async (req) => {
		const s = registry.get((req.params as any).cardId);
		await s?.runtime.session.abort();
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

// Run directly? (vs imported by tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
	const config = loadConfig();
	const app = await buildApp();
	const addr = await app.listen({ port: config.port, host: "127.0.0.1" });
	// Log the ACTUAL bound port (differs from config.port when port:0 → OS picks).
	console.error(`melon-server on ${addr}`);
}
