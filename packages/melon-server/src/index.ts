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
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
	ModelRuntime,
	SessionManager,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { expandHome, loadConfig, modelToString, type MelonConfig } from "./config.ts";
import { SessionRegistry } from "./session-registry.ts";

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
		runtime.session.subscribe((event: any) => {
			if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
				registry.broadcast(cardId, { type: "delta", text: event.assistantMessageEvent.delta });
			} else if (event.type === "agent_start") {
				registry.broadcast(cardId, { type: "status", status: "streaming" });
			} else if (event.type === "agent_end") {
				registry.broadcast(cardId, { type: "status", status: "idle" });
			} else if (event.type === "tool_execution_start") {
				registry.broadcast(cardId, { type: "tool", name: event.toolName });
			}
		});
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
		if (s.busy) return reply.code(409).send({ error: "card is streaming" });
		s.busy = true;
		reply.send({ ok: true });
		const cardId = (req.params as any).cardId;
		try {
			await s.runtime.session.prompt((req.body as any)?.text ?? "");
		} catch (e) {
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

	return app;
}

// Run directly? (vs imported by tests)
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop() ?? "")) {
	const config = loadConfig();
	const app = await buildApp();
	await app.listen({ port: config.port, host: "127.0.0.1" });
	console.error(`melon-server (pi monorepo) on http://127.0.0.1:${config.port}`);
}
