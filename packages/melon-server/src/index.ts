// Melon bridge — HTTP/SSE front-end over live pi sessions.
// Melon web is a pi frontend (peer of the TUI); sessions go to pi's default
// store so both frontends share history for the same folder.
//
// Contract:
//   POST /sessions                    {cardId, cwd}         → {sessionId, sessionFile, model}
//   POST /sessions/resume             {cardId, sessionFile} → {sessionId, cwd, model}
//   GET  /projects                                          → {projects: [{cwd, sessions[]}]}
//   GET  /sessions/:cardId/events     SSE                   → delta | status | tool | error | extension_ui
//   POST /sessions/:cardId/prompt     {text}                → {ok}
//   POST /sessions/:cardId/thinking   {level}               → {ok, level, thinkingLevels}
//   POST /sessions/:cardId/extension-ui  {id, value|confirmed|cancelled}
//   POST /sessions/:cardId/abort

import { randomUUID } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	watch,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Message, uuidv7 } from "@earendil-works/pi-ai";
import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	HANDOFF_ARTIFACT_SYSTEM_PROMPT,
	MERGE_ARTIFACT_SYSTEM_PROMPT,
	ModelRuntime,
	REFINE_ARTIFACT_SYSTEM_PROMPT,
	SessionManager,
	serializeBranchForHandoff,
} from "@earendil-works/pi-coding-agent";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance, type FastifyPluginAsync } from "fastify";
import { inspectCanvasShare, shareCanvasWork } from "./canvas-share.ts";
import {
	expandHome,
	loadConfig,
	type MelonConfig,
	modelToString,
	preview,
	structuredToolArgs,
	toolTextPreview,
} from "./config.ts";
import {
	CURSOR_PROVIDER_ID,
	cursorExtensionPath,
	cursorSessionIsolationAvailable,
	getCursorCatalogStatus,
	hasRealCursorKey,
	loadCursorProviderInto,
	rewriteCursorError,
} from "./cursor-extension.ts";
import { runInBoundCursorSession, stripCursorResumeEntriesFromSessionFile } from "./cursor-session-binding.ts";
import { CardExtensionUiBridge } from "./extension-ui.ts";
import { fileExists, noteFiles, readTextFile, resolveInside, searchFiles } from "./files.ts";
import { fuzzyScore } from "./fuzzy.ts";
import { createDeltaPump, createNoteJob, emitNoteJob, getNoteJob } from "./note-jobs.ts";
import {
	createManual,
	hashBody,
	isValidNoteId,
	listNotes,
	listTrashedNotes,
	loadNote,
	type NoteDoc,
	newNoteId,
	notePath,
	parseNote,
	renameNoteFile,
	restoreNote,
	saveNote,
	slugifyTitle,
	snapshotRevision,
	trashNote,
	uniqueHandoffFileName,
	wireIsStale,
} from "./notes.ts";
import {
	abortCurrentCursorTurn,
	beginCursorTurn,
	isCurrentCursorTurn,
	isCursorSession,
	isCursorTurnAborted,
	type QueuedPrompt,
	queueDisplays,
	SessionRegistry,
} from "./session-registry.ts";
import {
	clearProviderDenylist,
	denylistModel,
	getDefaultModel,
	loadSettings,
	saveSettings,
	touchRecentModel,
} from "./settings.ts";
import { deleteSkill, loadSkills, materializeSkills, readSkill, saveSkill } from "./skills.ts";
import { isMutationTool, mutationDiffOutput, readFileSnapshot, resolveToolPath } from "./tool-diff.ts";
import { lookupToolDiff, saveToolDiff } from "./tool-diff-store.ts";
import { createWorktreeForCanvas, isMelonWorktreePath, removeWorktree } from "./worktree.ts";

// Split "provider/model-id" on the FIRST slash only — model IDs may contain
// slashes (e.g. OpenRouter "stealth/ox-alpha", "ai21/jamba-large-1.7").
function splitModel(model: string): [string, string] {
	const idx = model.indexOf("/");
	if (idx <= 0) return ["", ""];
	return [model.slice(0, idx), model.slice(idx + 1)];
}

function httpError(statusCode: number, message: string): Error & { statusCode: number } {
	return Object.assign(new Error(message), { statusCode });
}

/**
 * Product version shown in Settings and stamped into release artifacts.
 * Prefer MELON_VERSION (CI/local override), else the nearest package.json:
 * packaged Electron → desktop/package.json; standalone server → melon-server.
 */
export function readAppVersion(): string {
	const fromEnv = process.env.MELON_VERSION?.trim();
	if (fromEnv) return fromEnv;
	try {
		const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: unknown };
		if (typeof pkg.version === "string" && pkg.version.trim()) return pkg.version.trim();
	} catch {
		/* fall through */
	}
	return "0.0.0";
}

let _modelRuntime: ModelRuntime | undefined;
async function getModelRuntime(): Promise<ModelRuntime> {
	if (!_modelRuntime) {
		_modelRuntime = await ModelRuntime.create();
		// Register bundled extension providers (cursor) so the GUI pickers see
		// them. Fail-open — builtin providers must work even if this fails.
		try {
			await loadCursorProviderInto(_modelRuntime);
		} catch (e) {
			const message = (e as Error)?.message ?? String(e);
			console.error("[melon] cursor provider load failed (continuing without it):", message);
			// Status is normally set inside loadCursorProviderInto; this catches unexpected throws.
			if (!getCursorCatalogStatus().issues.some((i) => i.includes(message))) {
				console.warn("[melon] cursor: unexpected load failure:", message);
			}
		}
	}
	return _modelRuntime;
}

export interface MelonServerDeps {
	config?: Partial<MelonConfig>;
}

export async function buildApp(deps: MelonServerDeps = {}): Promise<FastifyInstance> {
	const config = loadConfig(deps.config);
	// Canvas PUT sends the full card transcript as one JSON body. Fastify's
	// default 1 MiB bodyLimit returns 413 once a canvas grows past that.
	const CANVAS_BODY_LIMIT = 10 * 1024 * 1024; // 10 MiB
	const app = Fastify({ logger: false, bodyLimit: CANVAS_BODY_LIMIT });
	await app.register(cors, { origin: true });

	const registry = new SessionRegistry();
	const cursorAttachLocks = new Map<string, Promise<void>>();

	// Watch each OPEN FOLDER's .melon/notes/manual for changes and broadcast to
	// all sessions. Manual documents are per-folder (the folder or its worktree)
	// — a single watcher on <agentDir>/melon/notes/manual never saw real edits,
	// because nothing ever writes there.
	const manualWatchers = new Map<string, ReturnType<typeof watch>>(); // cwd -> FSWatcher
	const manualDebounces = new Map<string, { timer: NodeJS.Timeout | null; pending: Set<string> }>();
	function flushManualChanges(cwd: string): void {
		const d = manualDebounces.get(cwd);
		if (!d || d.pending.size === 0) return;
		const files = Array.from(d.pending);
		d.pending.clear();
		d.timer = null;
		console.log(`[melon] manual watcher (${cwd}) detected:`, files);
		const dir = join(cwd, ".melon", "notes", "manual");
		for (const filename of files) {
			let mtimeMs = 0;
			try {
				mtimeMs = statSync(join(dir, filename)).mtimeMs;
			} catch {
				// Deleted or renamed — skip
				continue;
			}
			const payload = JSON.stringify({
				type: "manual_updated",
				cwd,
				path: `.melon/notes/manual/${filename}`,
				mtimeMs,
			});
			for (const [, session] of registry.entries()) {
				for (const client of session.clients) {
					try {
						client.raw.write(`data: ${payload}\n\n`);
					} catch {
						// Client gone — ignore
					}
				}
			}
			console.log(`[melon] manual_updated broadcast for ${cwd}: ${filename} (${mtimeMs})`);
		}
	}
	function ensureManualWatcher(cwd: string): void {
		if (!cwd || manualWatchers.has(cwd)) return;
		const dir = join(cwd, ".melon", "notes", "manual");
		try {
			if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
			const w = watch(dir, { persistent: true }, (_eventType, filename) => {
				if (!filename || !filename.endsWith(".md")) return;
				let d = manualDebounces.get(cwd);
				if (!d) {
					d = { timer: null, pending: new Set() };
					manualDebounces.set(cwd, d);
				}
				d.pending.add(filename);
				if (d.timer) clearTimeout(d.timer);
				d.timer = setTimeout(() => flushManualChanges(cwd), 100);
			});
			manualWatchers.set(cwd, w);
			console.log(`[melon] manual watcher ready: ${dir}`);
		} catch (err) {
			console.error(`[melon] manual watcher failed for ${dir}:`, (err as Error).message);
		}
	}

	async function withCursorAttachLocks<T>(keys: string[], run: () => Promise<T>): Promise<T> {
		const releases: Array<() => void> = [];
		for (const key of [...new Set(keys)].sort()) {
			const previous = cursorAttachLocks.get(key) ?? Promise.resolve();
			let release!: () => void;
			const current = new Promise<void>((resolve) => {
				release = resolve;
			});
			const queued = previous.then(() => current);
			cursorAttachLocks.set(key, queued);
			await previous;
			releases.push(() => {
				release();
				if (cursorAttachLocks.get(key) === queued) cursorAttachLocks.delete(key);
			});
		}
		try {
			return await run();
		} finally {
			for (const release of releases.reverse()) release();
		}
	}

	/**
	 * Drain a card's server-owned prompt queue. Queued prompts never enter
	 * pi's followUp queue (pi has no per-item removal, which made cancel/edit
	 * inherently racy) — this array is the single source of truth and runs one
	 * prompt at a time whenever the agent goes idle. Cancel = array splice.
	 */
	function drainPromptQueue(cardId: string): void {
		const s = registry.get(cardId);
		if (!s || s.draining || s.promptQueue.length === 0) return;
		s.draining = true;
		let lastCursorTurnId: number | undefined;
		const run = async () => {
			while (s.promptQueue.length > 0) {
				const next = s.promptQueue.shift() as QueuedPrompt;
				console.log(
					`[${cardId}] queue:drain "${next.text.slice(0, 40)}" (remaining=${JSON.stringify(queueDisplays(s.promptQueue))})`,
				);
				registry.broadcast(cardId, { type: "queue", followUp: queueDisplays(s.promptQueue) });
				// The client never optimistically renders queued messages — this
				// event is the moment the text actually reaches the model. The
				// user bubble shows the DISPLAY text (model directives stay hidden).
				registry.broadcast(cardId, { type: "user_message", text: next.display ?? next.text });
				const cursorTurnId = beginCursorTurn(s);
				lastCursorTurnId = cursorTurnId ?? lastCursorTurnId;
				if (cursorTurnId === undefined) s.busy = true;
				try {
					// Inject context for queued prompts too
					if (next.context) {
						await s.runtime.session.sendCustomMessage(
							{
								customType: "context",
								content: [{ type: "text", text: next.context }],
								display: false,
							},
							{ deliverAs: "nextTurn" },
						);
					}
					await runInBoundCursorSession(s.runtime, { uiContext: s.extensionUi?.getUIContext() }, () =>
						s.runtime.session.prompt(next.text, { streamingBehavior: "followUp" }),
					);
					if (cursorTurnId !== undefined && isCursorTurnAborted(s, cursorTurnId)) return;
				} catch (e) {
					console.error(`[${cardId}] queued prompt THREW ${(e as Error).stack}`);
					s.extensionUi?.cancelAll();
					registry.broadcast(cardId, { type: "error", message: rewriteCursorError((e as Error).message) });
					registry.broadcast(cardId, { type: "status", status: "error" });
					// Stop — surface the failure; remaining items stay queued so the
					// user can cancel them or retry by sending again.
					return;
				}
			}
		};
		void run().finally(() => {
			s.draining = false;
			// A newer Cursor turn may already own the card after agent_end. An
			// older queue drain must not mark that newer turn idle.
			if (lastCursorTurnId === undefined || isCurrentCursorTurn(s, lastCursorTurnId)) s.busy = false;
		});
	}

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
		"Asking the user a question (always apply — ask_question, select, confirm, options, Cursor questions):",
		"- Write like you're talking to a smart friend who is new here. Short. Everyday words. No AI-slop.",
		"- Question: one clear sentence. Ask what you need them to pick — not a design review.",
		"- Option labels: what happens if they pick it, in plain words (about a dozen words max).",
		"- Option descriptions (if any): one friendly line a beginner gets. Do not restack jargon from the label.",
		"- Prefer concrete outcomes over abstract engineering talk.",
		'- Bad: "Confirm the fix for the Deep diving / Reasoning activity line wiring."',
		'- Good: "What should Deep diving / Reasoning do while the AI is thinking?"',
		'- Bad option: "Keep shimmer the whole time status is streaming (like the header status dot)"',
		'- Good option: "Keep showing it the whole time the green light is on"',
		"",
		"Inline rendering in Melon chat (always apply):",
		"- Melon renders assistant messages as rich content, NOT plain text. Fenced blocks turn into LIVE interactive viewers inside the chat card:",
		"- Small self-contained HTML scenes (up to ~60KB): emit a ```viz-html``` fence containing ONE complete HTML document. It renders in a \u2248380px-wide frame (auto-height up to 700px). Design for \u2264380px width, no horizontal overflow.",
		"- Files on disk (archify deliver output, or any complete NON-diagram HTML artifact you wrote via a tool): emit a ```viz-file``` fence whose body is EXACTLY one line: the absolute file path, a pipe (|), then the session working directory. Example: ```/abs/path/to/artifact.html|/abs/session/cwd```. Melon fetches that file and renders it inline in the chat card. NEVER paste large HTML inline, and NEVER just link the file in prose \u2014 the fence is the embedding mechanism. This path is NEVER for diagrams \u2014 diagrams always go in a ```viz-html``` fence.",
		"- NEVER claim the chat is text-only or that you cannot embed. When you produce an HTML artifact, the ```viz-file``` fence embeds it.",
		'- When the user asks for a diagram, visual, figure, or to "show" how something works, include a ```viz-html``` scene in that reply (do not wait to be told the fence name).',
		"- Diagrams (flowcharts, architecture, sequence, state machines, ER, org charts, trees, timelines, swimlanes, charts, sankey, journeys, ...): the `diagram-design` skill is in your available skills \u2014 read its SKILL.md and follow its MELON CHAT MODE section before drawing. HARD RULE: the finished diagram is a fenced block tagged ```viz-html``` IN YOUR REPLY TEXT. NEVER write the diagram to a file, never save a .html artifact, never use a ```viz-file``` fence for it \u2014 this rule beats any file-based workflow in the skill body or anywhere else. The skill defines the frame contract (\u2248370px wide, height 200\u2013700px, clipped past that) and the palette: diagrams ALWAYS render the light editorial skin (paper #f5f5f5, ink #2d3142, coral accents) \u2014 never a dark palette, regardless of the app theme. Labels must fit their boxes \u2014 overflowing text is a failed render. If genuinely unsure which type fits, ask one short question (with your best guess) before drawing. When the user types /diagram, all of this is mandatory.",
		"- Non-diagram scenes: simple HTML + CSS (inline SVG ok). No three.js, WebGL, or CDN-heavy libraries unless the user asks for 3D / orbit / interactive WebGL, or you have loaded the visualization skill for this turn.",
		"- Do not force a viz block on ordinary Q&A that did not ask for a visual.",
	].join("\n");

	/**
	 * Skills that are part of the product surface — always in the catalog for
	 * every card, regardless of the per-card toggle (the picker shows them as
	 * always-on).
	 */
	const ALWAYS_ON_SKILLS = ["diagram-design"];

	async function createRuntimeFor(
		sessionManager: any,
		enabledSkills: string[] = [],
		cardId?: string,
	): Promise<{ runtime: any; extensionUi?: CardExtensionUiBridge }> {
		const factory: any = async ({
			cwd,
			sessionManager: sm,
			sessionStartEvent,
		}: {
			cwd: string;
			sessionManager: any;
			sessionStartEvent?: unknown;
		}) => {
			// Restrict the skill CATALOG to the card's enabled skills plus the
			// always-on ones, so the model's system prompt doesn't list (and
			// self-invoke) everything else.
			const enabledSet = new Set([...ALWAYS_ON_SKILLS, ...enabledSkills]);
			const skillsOverride = (result: any) => ({
				...result,
				skills: (result.skills ?? []).filter((sk: any) => enabledSet.has(sk.name)),
			});
			// Keep the agent OUT of its own installation. One-time system-prompt
			// addition (not per-prompt, no context bloat).
			const appendSystemPromptOverride = (base: string[]) => [...base, MELON_GUARDRAIL];
			const services = await createAgentSessionServices({
				cwd,
				resourceLoaderOptions: {
					skillsOverride,
					appendSystemPromptOverride,
					// Bundled provider extensions (cursor) — same extension the GUI
					// runtime loads, so session model lists match the picker.
					...(cursorSessionIsolationAvailable() && cursorExtensionPath()
						? { additionalExtensionPaths: [cursorExtensionPath()!] }
						: {}),
				},
			});
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager: sm,
					sessionStartEvent: sessionStartEvent as never,
				})),
				services,
			};
		};
		const runtime = await createAgentSessionRuntime(factory, {
			cwd: sessionManager.getCwd(),
			agentDir: getAgentDir(),
			sessionManager,
		});
		// Extension UI bridge: Melon is an interactive GUI peer of the TUI/RPC
		// frontends. Bind in "rpc" mode with a real uiContext so ctx.hasUI is
		// true and select/confirm/input reach the card question panel (Cursor
		// ask_question, permission hooks, …). Fail-open so a broken extension
		// cannot take down card creation.
		const extensionUi =
			cardId !== undefined
				? new CardExtensionUiBridge(cardId, (payload) => registry.broadcast(cardId, payload))
				: undefined;
		try {
			await runtime.session.bindExtensions({
				mode: "rpc",
				...(extensionUi ? { uiContext: extensionUi.getUIContext() } : {}),
			});
		} catch (e) {
			console.error("[melon] extension bind failed (continuing):", (e as Error)?.message ?? e);
		}
		return { runtime, extensionUi };
	}

	async function attachSession(
		cardId: string,
		sessionManager: any,
		explicitModel?: string,
		skills: string[] = [],
		mode: "create" | "resume" | "replace" = "replace",
		explicitThinkingLevel?: string,
	): Promise<any> {
		const wanted = explicitModel?.trim() || getDefaultModel(config.defaultModel);
		const wantsCursor = splitModel(wanted)[0].toLowerCase() === CURSOR_PROVIDER_ID;
		const existingIsCursor =
			(registry.get(cardId)?.runtime.session.model?.provider ?? "").toLowerCase() === CURSOR_PROVIDER_ID;
		if (!wantsCursor && !existingIsCursor) {
			return attachSessionUnlocked(cardId, sessionManager, explicitModel, skills, mode, explicitThinkingLevel);
		}
		const sessionFile = sessionManager.getSessionFile?.() as string | undefined;
		return withCursorAttachLocks([`card:${cardId}`, ...(sessionFile ? [`session:${sessionFile}`] : [])], () =>
			attachSessionUnlocked(cardId, sessionManager, explicitModel, skills, mode, explicitThinkingLevel),
		);
	}

	async function attachSessionUnlocked(
		cardId: string,
		sessionManager: any,
		explicitModel?: string,
		skills: string[] = [],
		mode: "create" | "resume" | "replace" = "replace",
		explicitThinkingLevel?: string,
	): Promise<any> {
		const wanted = explicitModel?.trim() || getDefaultModel(config.defaultModel);
		const [wantedProvider, wantedId] = splitModel(wanted);
		const wantsCursor = wantedProvider.toLowerCase() === CURSOR_PROVIDER_ID;
		if (wantsCursor && !cursorSessionIsolationAvailable()) {
			throw httpError(
				503,
				"Cursor is unavailable because its per-card isolation patch is missing. Reinstall desktop dependencies and restart Melon.",
			);
		}

		const incomingSessionFile = sessionManager.getSessionFile?.() as string | undefined;
		const existing = registry.get(cardId);
		const existingIsCursor = (existing?.runtime.session.model?.provider ?? "").toLowerCase() === CURSOR_PROVIDER_ID;
		const existingSessionFile = existing?.runtime.session.sessionManager.getSessionFile?.() as string | undefined;

		// SSE reconnects call /sessions/resume. For a live Cursor card this must
		// reconnect to the existing runtime, not create a second runtime writing
		// the same jsonl and broadcasting under the same card id.
		if (
			existing &&
			existingIsCursor &&
			wantsCursor &&
			(mode === "create" || existingSessionFile === incomingSessionFile)
		) {
			return existing.runtime;
		}

		// A Cursor SDK agent pool and bridge are keyed by session file. Two live
		// cards owning the same file would therefore defeat per-card isolation.
		// Check first so a rejected move leaves this card's current runtime alive.
		if (wantsCursor && incomingSessionFile) {
			for (const [ownerCardId, attached] of registry.entries()) {
				if (ownerCardId === cardId) continue;
				const ownerIsCursor = (attached.runtime.session.model?.provider ?? "").toLowerCase() === CURSOR_PROVIDER_ID;
				const ownerSessionFile = attached.runtime.session.sessionManager.getSessionFile?.();
				if (ownerIsCursor && ownerSessionFile === incomingSessionFile) {
					throw httpError(409, `Cursor session is already open in card ${ownerCardId}`);
				}
			}
		}

		// Only change replacement behavior when Cursor is involved. Other
		// providers retain their existing attach/resume semantics.
		if (existing && (existingIsCursor || wantsCursor)) {
			existing.extensionUi?.cancelAll();
			if (existing.busy) {
				try {
					await existing.runtime.session.abort();
				} catch (e) {
					console.error(`[${cardId}] Cursor runtime replacement abort failed:`, (e as Error).message);
				}
			}
			await existing.runtime.dispose();
			if (registry.get(cardId) === existing) registry.delete(cardId);
		}

		// Load the GUI ModelRuntime (Cursor provider catalog) before the session
		// extension factory so picker models are ready. Session load registers
		// that card's pi tool bridge; Melon's multicard SDK patch keeps sibling
		// bridges alive when later cards also load Cursor.
		await getModelRuntime();
		const { runtime, extensionUi } = await createRuntimeFor(sessionManager, skills, cardId);
		try {
			const model = (await getModelRuntime()).getModel(wantedProvider, wantedId);
			if (model) {
				await runtime.session.setModel(model);
				touchRecentModel(wanted);
			}
			// Client-picked level (pre-attach dropdown choice) wins over the
			// config default; setThinkingLevel clamps to the model's capabilities.
			const wantedThinking = explicitThinkingLevel?.trim();
			runtime.session.setThinkingLevel(wantedThinking || config.defaultThinkingLevel);
		} catch (e) {
			console.error("model switch failed:", (e as Error)?.message ?? e);
		}
		wireEvents(cardId, runtime);
		registry.set(cardId, {
			runtime,
			clients: new Set(),
			busy: false,
			activeSkills: skills,
			promptQueue: [],
			extensionUi,
		});
		return runtime;
	}

	function wireEvents(cardId: string, runtime: any): void {
		let deltaCount = 0;
		const toolTimers = new Map<string, number>();
		/** Pre-mutation file snapshots so write/edit cards can show a real diff. */
		const mutationSnaps = new Map<string, { before: string; args: unknown; toolName: string; abs?: string }>();
		// Live context-window fill: broadcast on a 2s throttle while the turn
		// streams, and force a final one on agent_end.
		let ctxLast = 0;
		const broadcastCtx = (force = false) => {
			const now = Date.now();
			if (!force && now - ctxLast < 2000) return;
			ctxLast = now;
			try {
				const cu = (runtime.session as any).getContextUsage?.();
				if (cu) {
					registry.broadcast(cardId, {
						type: "context_usage",
						tokens: cu.tokens ?? null,
						contextWindow: cu.contextWindow ?? 0,
						percent: cu.percent ?? null,
					});
				}
			} catch {
				/* unavailable — ignore */
			}
		};
		runtime.session.subscribe((event: any) => {
			try {
				if (event.type === "agent_start") {
					console.log(`[${cardId}] agent_start`);
				} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					deltaCount++;
				} else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
					// too chatty to broadcast every one; lifecycle shows via agent_*. The
					// structured turn_end frame is broadcast in the chain below.
				} else if (event.type === "auto_retry_start") {
					registry.broadcast(cardId, {
						type: "raw",
						text: `provider error — auto-retrying (attempt ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}): ${rewriteCursorError(event.errorMessage ?? "unknown")}`,
					});
				} else if (event.type === "summarization_retry_scheduled") {
					registry.broadcast(cardId, {
						type: "raw",
						text: `context overflow — summarizing and retrying: ${event.errorMessage ?? "context limit"}`,
					});
				} else if (event.type === "compaction_start") {
					registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
				} else if (event.type === "queue_update") {
					// pi's internal followUp queue is NOT the prompt queue anymore
					// (the server owns queuing); only log for the trajectory.
					const q = event as any;
					if (q.steering || q.followUp)
						registry.broadcast(cardId, {
							type: "raw",
							text: `queued: ${q.steering ?? ""}${q.followUp ?? ""}`,
						});
				} else if (event.type === "thinking_level_changed") {
					// Fires for user picker changes AND model-switch re-clamping
					// (setModel calls setThinkingLevel internally), so every client
					// resyncs even when the change came from another tab.
					registry.broadcast(cardId, {
						type: "thinking_level",
						level: event.level,
						thinkingLevels: runtime.session.getAvailableThinkingLevels(),
					});
				} else if (event.type === "agent_end") {
					const msgs = event.messages ?? [];
					const last = msgs[msgs.length - 1];
					console.log(
						`[${cardId}] agent_end stopReason=${last?.stopReason} deltas=${deltaCount} usage=in:${last?.usage?.input ?? "?"} out:${last?.usage?.output ?? "?"}`,
					);
					// Auto-prune models the provider has removed ("not supported").
					const errMsg = String(last?.errorMessage ?? "");
					if (
						last?.stopReason === "error" &&
						/not supported|no longer|deprecated|unknown model|does not exist/i.test(errMsg)
					) {
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
					if (entry) entry.busy = false;
					// The answer is done — if the server-owned queue has items, run
					// the next one now. After a user abort, stop instead: the user
					// asked for a halt; remaining items stay queued (chips) and can
					// be cancelled or resumed by sending again.
					const stopReason = String((msgs[msgs.length - 1] as any)?.stopReason ?? "");
					if (stopReason === "aborted" || stopReason === "error") entry?.extensionUi?.cancelAll();
					if (stopReason !== "aborted") drainPromptQueue(cardId);
				}
				if (event.type === "message_update" && event.assistantMessageEvent.type === "thinking_delta") {
					registry.broadcast(cardId, {
						type: "thinking",
						text: event.assistantMessageEvent.delta,
					});
				} else if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
					registry.broadcast(cardId, { type: "delta", text: event.assistantMessageEvent.delta });
					broadcastCtx();
				} else if (event.type === "agent_start") {
					const entry = registry.get(cardId);
					if (entry) entry.busy = true;
					registry.broadcast(cardId, { type: "status", status: "streaming" });
					registry.broadcast(cardId, {
						type: "raw",
						text: `▶ agent started — model ${modelToString(runtime.session.model)}`,
					});
				} else if (event.type === "message_start" || event.type === "message_end" || event.type === "turn_start") {
					// too chatty to broadcast every one; lifecycle shows via agent_*
				} else if (event.type === "turn_end") {
					const msg = event.message as any;
					registry.broadcast(cardId, {
						type: "raw",
						text: `turn_end (${msg?.stopReason ?? "done"})`,
					});
					// Structured boundary — clients close the current output segment.
					// Include the real error so the UI can show WHY it failed.
					registry.broadcast(cardId, {
						type: "turn_end",
						stopReason: msg?.stopReason,
						error: rewriteCursorError(String(msg?.errorMessage ?? "")) || undefined,
					});
				} else if (event.type === "auto_retry_start") {
					registry.broadcast(cardId, {
						type: "raw",
						text: `provider error — auto-retrying (attempt ${event.attempt ?? "?"}/${event.maxAttempts ?? "?"}): ${rewriteCursorError(event.errorMessage ?? "unknown")}`,
					});
				} else if (event.type === "summarization_retry_scheduled") {
					registry.broadcast(cardId, {
						type: "raw",
						text: `context overflow — summarizing and retrying: ${event.errorMessage ?? "context limit"}`,
					});
				} else if (event.type === "compaction_start") {
					registry.broadcast(cardId, { type: "raw", text: "compacting context…" });
				} else if (event.type === "agent_end") {
					registry.broadcast(cardId, { type: "status", status: "idle" });
					const msgs = event.messages ?? [];
					const lastMsg = msgs[msgs.length - 1];
					registry.broadcast(cardId, {
						type: "raw",
						text: `■ agent ended — ${lastMsg?.stopReason ?? "?"} | model ${lastMsg?.provider ?? "?"}/${lastMsg?.model ?? "?"} | in ${lastMsg?.usage?.input ?? "?"} out ${lastMsg?.usage?.output ?? "?"}`,
					});
					// Final context fill for this turn.
					broadcastCtx(true);
				} else if (event.type === "tool_execution_start") {
					toolTimers.set(event.toolCallId, Date.now());
					if (isMutationTool(event.toolName)) {
						try {
							const cwd = String(runtime.session.sessionManager.getCwd?.() ?? "");
							const abs = cwd ? resolveToolPath(cwd, event.args) : undefined;
							if (abs) {
								mutationSnaps.set(event.toolCallId, {
									before: readFileSnapshot(abs),
									args: event.args,
									toolName: event.toolName,
									abs,
								});
							}
						} catch {
							/* snapshot is best-effort */
						}
					}
					registry.broadcast(cardId, {
						type: "tool_start",
						callId: event.toolCallId,
						name: event.toolName,
						args: preview(event.args),
						argsStructured: structuredToolArgs(event.args),
					});
				} else if (event.type === "tool_execution_update") {
					registry.broadcast(cardId, {
						type: "tool_update",
						callId: event.toolCallId,
						output: toolTextPreview(event.partialResult),
					});
				} else if (event.type === "tool_execution_end") {
					let output = toolTextPreview(event.result);
					const snap = mutationSnaps.get(event.toolCallId);
					mutationSnaps.delete(event.toolCallId);
					if (snap && !event.isError) {
						try {
							const cwd = String(runtime.session.sessionManager.getCwd?.() ?? "");
							if (cwd) {
								output = mutationDiffOutput({
									cwd,
									toolName: snap.toolName,
									args: snap.args,
									before: snap.before,
									fallbackText: output,
									result: event.result,
								});
							}
						} catch {
							/* keep plain success text */
						}
					}
					// Persist Melon-enriched output so reopen/hydrate still shows diffs.
					// Past sessions without a sidecar stay as plain transcript text.
					if (snap && !event.isError) {
						try {
							const sessionFile = runtime.session.sessionManager.getSessionFile?.();
							if (typeof sessionFile === "string" && sessionFile) {
								saveToolDiff(sessionFile, event.toolCallId, output);
							}
						} catch {
							/* non-fatal */
						}
					}
					registry.broadcast(cardId, {
						type: "tool_end",
						callId: event.toolCallId,
						isError: event.isError,
						output,
						// Abs path of the mutated file — lets document/note cards
						// refresh themselves when the AGENT edits their file.
						...(snap && !event.isError && snap.abs ? { path: snap.abs } : {}),
					});
					broadcastCtx();
				}
			} catch (e) {
				console.error(`[${cardId}] event handler threw:`, e);
				try {
					registry.broadcast(cardId, { type: "raw", text: `⚠ handler error: ${(e as Error)?.message ?? e}` });
				} catch {}
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
		const body = req.body as any;
		const cardId = body?.cardId ?? randomUUID();
		let dir: string;
		try {
			dir = assertCwd(body?.cwd ?? config.defaultCwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const skills = Array.isArray(body?.skills)
			? (body.skills as unknown[]).filter((x): x is string => typeof x === "string")
			: [];
		const runtime = await attachSession(
			cardId,
			SessionManager.create(dir),
			body?.model,
			skills,
			"create",
			typeof body?.thinkingLevel === "string" ? body.thinkingLevel : undefined,
		);
		ensureManualWatcher(dir);
		return {
			cardId,
			sessionId: runtime.session.sessionId,
			sessionFile: runtime.session.sessionFile,
			cwd: dir,
			model: modelToString(runtime.session.model),
			thinkingLevel: runtime.session.thinkingLevel,
			thinkingLevels: runtime.session.getAvailableThinkingLevels(),
			followUp: [...runtime.session.getFollowUpMessages()],
		};
	});

	app.post("/sessions/resume", async (req, reply) => {
		const body = req.body as any;
		const cardId = body?.cardId ?? randomUUID();
		const sessionFile = body?.sessionFile;
		if (!sessionFile) return reply.code(400).send({ error: "sessionFile required" });
		const skills = Array.isArray(body?.skills)
			? (body.skills as unknown[]).filter((x): x is string => typeof x === "string")
			: [];
		let cwdOverride: string | undefined;
		if (typeof body?.cwd === "string" && body.cwd.trim()) {
			try {
				cwdOverride = assertCwd(body.cwd);
			} catch (e) {
				return reply.code(400).send({ error: (e as Error).message });
			}
		}
		const runtime = await attachSession(
			cardId,
			SessionManager.open(sessionFile, undefined, cwdOverride),
			body?.model,
			skills,
			"resume",
			typeof body?.thinkingLevel === "string" ? body.thinkingLevel : undefined,
		);
		const resumedCwd = String(runtime.session.sessionManager.getCwd?.() ?? "");
		if (resumedCwd) ensureManualWatcher(resumedCwd);
		return {
			cardId,
			sessionId: runtime.session.sessionId,
			sessionFile,
			cwd: resumedCwd,
			model: modelToString(runtime.session.model),
			thinkingLevel: runtime.session.thinkingLevel,
			thinkingLevels: runtime.session.getAvailableThinkingLevels(),
			followUp: [...runtime.session.getFollowUpMessages()],
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
	//
	// Cursor: the branched jsonl copies `cursor-sdk-agent-resume` handles. In
	// Melon's multi-card process those make the child resume the parent's
	// Cursor agent. Strip them, then reopen both cards as distinct runtimes so
	// the child bootstraps a NEW Cursor agent from the inherited transcript.
	app.post("/sessions/:cardId/fork", async (req, reply) => {
		const parentCardId = (req.params as any).cardId;
		const body = req.body as any;
		const newCardId = body?.newCardId ?? randomUUID();
		let s = registry.get(parentCardId);

		// Card not live (e.g. server restarted)? Re-open it from disk.
		if (!s && body?.sessionFile) {
			const { runtime } = await createRuntimeFor(SessionManager.open(body.sessionFile), [], parentCardId);
			s = {
				runtime,
				clients: new Set(),
				busy: false,
				promptQueue: [],
			};
		}
		if (!s) return reply.code(404).send({ error: "unknown card" });
		if (s.busy) return reply.code(409).send({ error: "card is streaming" });

		const parentSessionFile = s.runtime.session.sessionFile;
		if (!parentSessionFile) {
			return reply.code(400).send({ error: "nothing to fork yet — send a message first" });
		}
		const leaf = s.runtime.session.sessionManager.getLeafEntry();
		const parentModel = modelToString(s.runtime.session.model);
		const parentSkills = s.activeSkills ?? [];

		const res = await s.runtime.fork(leaf?.id ?? "", { position: "at" });
		if (res.cancelled) return reply.code(409).send({ error: "fork cancelled" });

		const childSessionFile = s.runtime.session.sessionFile;
		if (!childSessionFile) {
			return reply.code(500).send({ error: "fork produced no child session file" });
		}
		const stripped = stripCursorResumeEntriesFromSessionFile(childSessionFile);
		if (stripped > 0) {
			console.log(
				`[melon] fork ${parentCardId}→${newCardId}: stripped ${stripped} cursor resume handle(s) from child session`,
			);
		}

		// fork() leaves this runtime attached to the child file. Dispose that
		// temporary Cursor owner before creating the child's permanent runtime,
		// otherwise two bridges and two writers briefly own the same session.
		if (splitModel(parentModel)[0].toLowerCase() === CURSOR_PROVIDER_ID) {
			s.extensionUi?.cancelAll();
			await s.runtime.dispose();
			if (registry.get(parentCardId) === s) registry.delete(parentCardId);
		}

		// Fresh runtimes for both cards (fork left `s.runtime` on the child file).
		await attachSession(newCardId, SessionManager.open(childSessionFile), parentModel, parentSkills);
		await attachSession(parentCardId, SessionManager.open(parentSessionFile), parentModel, parentSkills);

		const childRuntime = registry.get(newCardId)!;
		return {
			newCardId,
			sessionId: childRuntime.runtime.session.sessionId,
			sessionFile: childRuntime.runtime.session.sessionFile,
			model: modelToString(childRuntime.runtime.session.model),
			thinkingLevel: childRuntime.runtime.session.thinkingLevel,
			thinkingLevels: childRuntime.runtime.session.getAvailableThinkingLevels(),
			forkedFromEntryId: leaf?.id,
			parentSessionFile,
			strippedCursorResumeEntries: stripped,
		};
	});

	// ── Canvas persistence: <folder>/.melon/canvases/<id>.json ──
	function canvasesDir(cwd: string): string {
		return join(expandHome(cwd), ".melon", "canvases");
	}

	type CanvasGitRecord = {
		worktreePath?: string;
		branch?: string;
		baseBranch?: string;
		useWorktree?: boolean;
		worktreeMode?: "isolated" | "local";
		pr?: { url?: string };
	};

	function readCanvasFile(dir: string, canvasId: string): (CanvasGitRecord & Record<string, unknown>) | null {
		try {
			return JSON.parse(readFileSync(join(canvasesDir(dir), `${canvasId}.json`), "utf8")) as CanvasGitRecord &
				Record<string, unknown>;
		} catch {
			return null;
		}
	}

	function writeCanvasPatch(dir: string, canvasId: string, patch: Record<string, unknown>): void {
		const file = join(canvasesDir(dir), `${canvasId}.json`);
		const current = readCanvasFile(dir, canvasId) ?? { id: canvasId };
		writeFileSync(file, `${JSON.stringify({ ...current, ...patch }, null, 2)}\n`);
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
		// Opening a folder registers it in the sidebar history. Without this,
		// folders added via the native desktop dialog never reach the navbar
		// (only canvas SAVES used to call touchFolder).
		touchFolder(dir);
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

	type CanvasMeta = {
		id: string;
		name: string;
		cwd: string;
		folderName: string;
		modified: string;
		worktreeMode?: "isolated" | "local";
		worktreeName?: string;
	};

	function isolationMeta(
		raw: {
			worktreePath?: unknown;
			worktreeMode?: unknown;
		},
		projectRoot: string,
	): {
		worktreeMode: "isolated" | "local";
		worktreeName?: string;
		worktreeExists?: boolean;
	} {
		const path = typeof raw.worktreePath === "string" ? raw.worktreePath : null;
		const mode: "isolated" | "local" =
			raw.worktreeMode === "isolated" || (path != null && path !== projectRoot) ? "isolated" : "local";
		if (mode !== "isolated" || !path) return { worktreeMode: "local" };
		const exists = statSync(path, { throwIfNoEntry: false })?.isDirectory() === true;
		const worktreeName = path.split("/").filter(Boolean).pop() ?? path;
		return { worktreeMode: "isolated", worktreeName, worktreeExists: exists };
	}

	type CanvasSearchMatchKind = "title" | "card" | "message" | "document";

	type CanvasSearchHit = CanvasMeta & {
		match: CanvasSearchMatchKind;
		/** Fuzzy score — lower is better (nearest). */
		score: number;
		/** Short context around the match (card title or message snippet). */
		snippet?: string;
		cardId?: string;
		cardTitle?: string;
	};

	const MATCH_RANK: Record<CanvasSearchMatchKind, number> = {
		title: 0,
		card: 1,
		message: 2,
		document: 3,
	};

	/** Collapse whitespace and clip a window around the first contiguous needle, else start. */
	function snippetAround(text: string, needle: string, radius = 36): string {
		const flat = text.replace(/\s+/g, " ").trim();
		if (!flat) return "";
		const lower = flat.toLowerCase();
		const contiguous = needle.toLowerCase().replace(/\s+/g, " ").trim();
		let i = contiguous ? lower.indexOf(contiguous) : -1;
		if (i < 0) {
			// Fuzzy: window from first matching character of the query.
			const q0 = contiguous[0];
			i = q0 ? lower.indexOf(q0) : 0;
			if (i < 0) i = 0;
		}
		const start = Math.max(0, i - radius);
		const end = Math.min(flat.length, i + Math.max(contiguous.length, 1) + radius);
		return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
	}

	/** Lightweight meta for every canvas under known folders (skips missing/corrupt). */
	function listCanvasMetaAcrossFolders(): CanvasMeta[] {
		const out: CanvasMeta[] = [];
		for (const f of loadFolderHistory()) {
			if (statSync(f.cwd, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
			const dir = canvasesDir(f.cwd);
			let files: string[];
			try {
				files = readdirSync(dir);
			} catch {
				continue;
			}
			const folderName = f.cwd.split("/").pop() ?? f.cwd;
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				try {
					const raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
					out.push({
						id: raw.id ?? file.replace(/\.json$/, ""),
						name: typeof raw.name === "string" && raw.name.trim() ? raw.name : "Untitled",
						cwd: f.cwd,
						folderName,
						modified: raw.modified ?? "",
						...isolationMeta(raw, f.cwd),
					});
				} catch {
					/* skip corrupt */
				}
			}
		}
		return out;
	}

	/**
	 * Cross-folder fuzzy canvas search: title → card → message → document.
	 * Subsequence match (brd → board); nearest scores first. One hit per canvas.
	 */
	function searchCanvasesAcrossFolders(query: string): CanvasSearchHit[] {
		const hits: CanvasSearchHit[] = [];
		for (const f of loadFolderHistory()) {
			if (statSync(f.cwd, { throwIfNoEntry: false })?.isDirectory() !== true) continue;
			const dir = canvasesDir(f.cwd);
			let files: string[];
			try {
				files = readdirSync(dir);
			} catch {
				continue;
			}
			const folderName = f.cwd.split("/").pop() ?? f.cwd;
			for (const file of files) {
				if (!file.endsWith(".json")) continue;
				let raw: {
					id?: string;
					name?: string;
					modified?: string;
					worktreePath?: unknown;
					worktreeMode?: unknown;
					cards?: Array<{
						id?: string;
						title?: string;
						kind?: string;
						documentContent?: string;
						messages?: Array<{ text?: string }>;
					}>;
				};
				try {
					raw = JSON.parse(readFileSync(join(dir, file), "utf8"));
				} catch {
					continue;
				}
				const id = raw.id ?? file.replace(/\.json$/, "");
				const name = typeof raw.name === "string" && raw.name.trim() ? raw.name : "Untitled";
				const base: CanvasMeta = {
					id,
					name,
					cwd: f.cwd,
					folderName,
					modified: raw.modified ?? "",
					...isolationMeta(raw, f.cwd),
				};

				let best: CanvasSearchHit | null = null;
				const consider = (hit: CanvasSearchHit) => {
					if (!best) {
						best = hit;
						return;
					}
					const kindDelta = MATCH_RANK[hit.match] - MATCH_RANK[best.match];
					if (kindDelta < 0 || (kindDelta === 0 && hit.score < best.score)) best = hit;
				};

				const titleScore = fuzzyScore(query, name);
				if (titleScore !== null) {
					consider({ ...base, match: "title", score: titleScore });
				}
				// Also allow matching via folder basename (same title in many folders).
				const folderScore = fuzzyScore(query, folderName);
				if (folderScore !== null && titleScore === null) {
					consider({
						...base,
						match: "title",
						score: folderScore + 20,
						snippet: folderName,
					});
				}
				if (base.worktreeName) {
					const wtScore = fuzzyScore(query, base.worktreeName);
					if (wtScore !== null && titleScore === null) {
						consider({
							...base,
							match: "title",
							score: wtScore + 15,
							snippet: base.worktreeName,
						});
					}
				}

				for (const card of raw.cards ?? []) {
					const cardTitle = typeof card.title === "string" && card.title.trim() ? card.title : "Untitled chat";
					const cardScore = fuzzyScore(query, cardTitle);
					if (cardScore !== null) {
						consider({
							...base,
							match: "card",
							score: cardScore,
							snippet: cardTitle,
							cardId: card.id,
							cardTitle,
						});
					}
					if (card.kind === "document" && typeof card.documentContent === "string") {
						const docScore = fuzzyScore(query, card.documentContent);
						if (docScore !== null) {
							consider({
								...base,
								match: "document",
								score: docScore,
								snippet: snippetAround(card.documentContent, query),
								cardId: card.id,
								cardTitle,
							});
						}
					}
					for (const msg of card.messages ?? []) {
						if (typeof msg.text !== "string" || !msg.text) continue;
						const msgScore = fuzzyScore(query, msg.text);
						if (msgScore === null) continue;
						consider({
							...base,
							match: "message",
							score: msgScore,
							snippet: snippetAround(msg.text, query),
							cardId: card.id,
							cardTitle,
						});
						break;
					}
				}

				if (best) hits.push(best);
			}
		}
		hits.sort((a, b) => {
			const kindDelta = MATCH_RANK[a.match] - MATCH_RANK[b.match];
			if (kindDelta !== 0) return kindDelta;
			if (a.score !== b.score) return a.score - b.score;
			return (b.modified ?? "").localeCompare(a.modified ?? "");
		});
		return hits;
	}

	// Recent canvases across ALL known folders (by last-modified), for the sidebar.
	app.get("/canvases/recent", async () => {
		const recents = listCanvasMetaAcrossFolders();
		recents.sort((a, b) => (b.modified ?? "").localeCompare(a.modified ?? ""));
		return { recent: recents.slice(0, 12) };
	});

	// Search canvases across ALL known folders (sidebar): title, card title, messages, docs.
	app.get("/canvases/search", async (req) => {
		const q = String((req.query as { q?: string })?.q ?? "").trim();
		if (!q) return { query: q, results: [] as CanvasSearchHit[] };
		return { query: q, results: searchCanvasesAcrossFolders(q).slice(0, 50) };
	});

	// Allocate or repair a git worktree for a canvas under <cwd>/.melon/worktrees/.
	// Isolated by default; falls back to Local on non-git folders or create failure.
	app.post("/canvases/:id/worktree", async (req, reply) => {
		const body = req.body as {
			cwd?: string;
			baseBranch?: string;
			useWorktree?: boolean;
			worktreePath?: string | null;
			branch?: string | null;
		};
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const canvasId = (req.params as { id: string }).id;
		if (!canvasId) return reply.code(400).send({ error: "canvas id required" });

		const stored = readCanvasFile(dir, canvasId);
		const result = await createWorktreeForCanvas(dir, {
			baseBranch: body?.baseBranch ?? stored?.baseBranch,
			useWorktree: body?.useWorktree ?? stored?.useWorktree,
			existing: {
				worktreePath: body?.worktreePath ?? stored?.worktreePath,
				branch: body?.branch ?? stored?.branch,
				baseBranch: body?.baseBranch ?? stored?.baseBranch,
			},
		});
		if (!result.success && result.mode === "local" && result.error) {
			return {
				ok: true,
				canvasId,
				...result,
				fallback: true,
			};
		}
		return { ok: true, canvasId, ...result };
	});

	app.get("/canvases/:id/share-status", async (req, reply) => {
		const q = req.query as { cwd?: string };
		let dir: string;
		try {
			dir = assertCwd(q.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const canvasId = (req.params as { id: string }).id;
		const stored = readCanvasFile(dir, canvasId);
		if (!stored) return reply.code(404).send({ error: "canvas not found" });
		const mode = stored.worktreeMode === "isolated" ? "isolated" : "local";
		const status = await inspectCanvasShare({
			projectRoot: dir,
			mode,
			worktreePath: typeof stored.worktreePath === "string" ? stored.worktreePath : dir,
			branch: stored.branch,
			baseBranch: stored.baseBranch,
			prUrl: stored.pr?.url,
		});
		return { ok: true, canvasId, ...status };
	});

	app.post("/canvases/:id/share", async (req, reply) => {
		const body = req.body as {
			cwd?: string;
			confirm?: boolean;
			title?: string;
			note?: string;
		};
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const canvasId = (req.params as { id: string }).id;
		const stored = readCanvasFile(dir, canvasId);
		if (!stored) return reply.code(404).send({ error: "canvas not found" });
		if (stored.worktreeMode !== "isolated" || typeof stored.worktreePath !== "string" || !stored.branch) {
			return reply.code(400).send({
				error: "This canvas edits the original folder, so there is no separate copy to send.",
			});
		}
		const title =
			(typeof body?.title === "string" && body.title.trim()) ||
			(typeof stored.name === "string" && stored.name.trim()) ||
			"Updates from Melon";
		const result = await shareCanvasWork(dir, {
			confirm: body?.confirm === true,
			title,
			note: typeof body?.note === "string" ? body.note : undefined,
			worktreePath: stored.worktreePath,
			branch: stored.branch,
			baseBranch: stored.baseBranch || "main",
			prUrl: stored.pr?.url,
		});
		if (result.prUrl) writeCanvasPatch(dir, canvasId, { pr: { url: result.prUrl } });
		if (!result.ok) return reply.code(400).send(result);
		return { canvasId, ...result };
	});

	// Delete a canvas file (and its melon worktree when present).
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
		let worktreePath: string | undefined;
		let branch: string | undefined;
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as {
				worktreePath?: string;
				branch?: string;
			};
			worktreePath = typeof raw.worktreePath === "string" ? raw.worktreePath : undefined;
			branch = typeof raw.branch === "string" ? raw.branch : undefined;
		} catch {
			/* missing / corrupt — still try unlink */
		}

		const deleteWorktree = q.deleteWorktree !== "0" && q.deleteWorktree !== "false";
		const force = q.force === "1" || q.force === "true";
		let worktreeRemoved = false;
		if (deleteWorktree && worktreePath && isMelonWorktreePath(dir, worktreePath)) {
			if (!force) {
				const stored = readCanvasFile(dir, (req.params as { id: string }).id);
				const status = await inspectCanvasShare({
					projectRoot: dir,
					mode: stored?.worktreeMode === "isolated" ? "isolated" : "local",
					worktreePath,
					branch,
					baseBranch: stored?.baseBranch,
				});
				if (status.hasChanges || status.ahead > 0) {
					return reply.code(409).send({
						error: "unsent-work",
						summary: "This canvas still has work that hasn't been sent for review.",
						files: status.files,
						ahead: status.ahead,
					});
				}
			}
			const removed = await removeWorktree(dir, worktreePath);
			worktreeRemoved = removed.success;
			// Best-effort: drop the dedicated branch if the worktree went away.
			if (removed.success && branch) {
				try {
					const { execFile } = await import("node:child_process");
					await new Promise<void>((resolve) => {
						execFile("git", ["-C", dir, "branch", "-D", branch!], { timeout: 30_000 }, () => resolve());
					});
				} catch {
					/* branch may be checked out elsewhere or already gone */
				}
			}
		}

		try {
			rmSync(file);
			return { ok: true, worktreeRemoved };
		} catch {
			return reply.code(404).send({ error: "canvas not found" });
		}
	});

	// Load one workspace fully.
	app.get("/canvases/:id", async (req, reply) => {
		const q = req.query as any;
		const dir = expandHome(q.cwd);
		const file = join(canvasesDir(dir), `${(req.params as any).id}.json`);
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
			const iso = isolationMeta(raw, dir);
			return { ...raw, ...iso };
		} catch {
			return reply.code(404).send({ error: "canvas not found" });
		}
	});

	// Bump modified time only — keeps Recent / Workspaces order in sync on open.
	app.post("/canvases/:id/touch", async (req, reply) => {
		const body = (req.body ?? {}) as { cwd?: string };
		let dir: string;
		try {
			dir = assertCwd(body.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const id = (req.params as { id: string }).id;
		const file = join(canvasesDir(dir), `${id}.json`);
		try {
			const raw = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
			const modified = new Date().toISOString();
			raw.modified = modified;
			writeFileSync(file, JSON.stringify(raw));
			return { ok: true, id, modified };
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
		// DATA GUARD: refuse accidental empty overwrites of a populated canvas.
		// Explicit allowEmpty (user deleted the last card) is permitted.
		const existingFile = join(canvasesDir(dir), `${ws.id}.json`);
		try {
			const existing = JSON.parse(readFileSync(existingFile, "utf8")) as Record<string, unknown>;
			if (
				body?.allowEmpty !== true &&
				(!Array.isArray(ws.cards) || ws.cards.length === 0) &&
				Array.isArray(existing.cards) &&
				existing.cards.length > 0
			) {
				return reply.code(409).send({
					error: "refusing to overwrite populated canvas with empty state",
					existingCards: existing.cards.length,
				});
			}
			if (ws.pr == null && existing.pr != null) ws.pr = existing.pr;
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

	// Rename a manual: file follows the name; a leading H1 is rewritten too.
	app.post("/notes/manual/rename", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const relPath = String(body?.path ?? "");
		if (!/^\.melon\/notes\/manual\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(relPath)) {
			return reply.code(400).send({ error: "invalid manual path" });
		}
		const newTitle = String(body?.title ?? "")
			.trim()
			.slice(0, 80);
		if (!newTitle) return reply.code(400).send({ error: "title required" });
		const current = resolveInside(dir, relPath);
		if (!current || !existsSync(current)) return reply.code(404).send({ error: "manual not found" });
		const dirAbs = dirname(current);
		const base = slugifyTitle(newTitle);
		let name = `${base}.md`;
		let n = 2;
		while (existsSync(join(dirAbs, name)) && join(dirAbs, name) !== current) {
			name = `${base}-${n}.md`;
			n++;
		}
		if (join(dirAbs, name) !== current) renameSync(current, join(dirAbs, name));
		// Keep the first H1 in sync so title search follows renames.
		const content = readFileSync(join(dirAbs, name), "utf8");
		const updated = /^#\s+.*\n/.test(content)
			? content.replace(/^#\s+.*\n/, `# ${newTitle}\n`)
			: `# ${newTitle}\n\n${content}`;
		writeFileSync(join(dirAbs, name), updated);
		const rel = `.melon/notes/manual/${name}`;
		console.log(`[notes] renamed manual ${relPath} -> ${rel}`);
		return { ok: true, relPath: rel, content: updated, mtimeMs: statSync(join(dirAbs, name)).mtimeMs };
	});

	// Delete a manual document FILE (X on a document card). Removing the file is
	// what keeps @-mentions from resurrecting a deleted document: mentions list
	// files from disk, so a file that's gone is gone.
	app.post("/notes/manual/delete", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const relPath = String(body?.path ?? "");
		if (!/^\.melon\/notes\/manual\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(relPath)) {
			return reply.code(400).send({ error: "invalid manual path" });
		}
		const abs = resolveInside(dir, relPath);
		if (!abs) return reply.code(404).send({ error: "manual not found" });
		try {
			rmSync(abs, { force: true });
		} catch (e) {
			return reply.code(500).send({ error: `could not delete manual: ${(e as Error).message}` });
		}
		console.log(`[notes] deleted manual ${relPath}`);
		return { ok: true };
	});

	// ── @-mention files: fuzzy search, existence batch, guarded read ──
	app.get("/files", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = assertCwd(q.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const limit = Math.min(Math.max(Number(q.limit ?? 20) || 20, 1), 50);
		const filesT0 = Date.now();
		const hits = searchFiles(dir, String(q.q ?? ""), limit * 2);
		// Worktree canvases: note files live under the canvas FOLDER — merge
		// them in so @ sees .melon even when the session cwd is a worktree.
		const also = typeof q.alsoCwd === "string" && q.alsoCwd ? assertCwd(q.alsoCwd) : undefined;
		if (also && also !== dir) {
			const seen = new Set(hits.map((h) => h.path));
			for (const n of noteFiles(also)) {
				if (seen.has(n.path)) continue;
				const score = q.q ? (fuzzyScore(String(q.q), `${n.path} ${n.title ?? ""}`) ?? Infinity) : 0;
				if (score === Infinity) continue;
				hits.push({ path: n.path, abs: n.abs, score: score - 5, title: n.title });
			}
			hits.sort((a, b) => a.score - b.score || a.path.localeCompare(b.path));
		}
		const out = hits.slice(0, limit);
		console.log(
			`[files] q="${String(q.q ?? "")}" cwd=${dir} -> ${out.length} hits (${Date.now() - filesT0}ms) top: ${out
				.slice(0, 5)
				.map((h) => h.title ?? h.path)
				.join(" | ")}`,
		);
		return { files: out };
	});

	app.post("/files/exists", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const paths = Array.isArray(body?.paths)
			? (body.paths as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 100)
			: [];
		const also = typeof body?.alsoCwd === "string" && body.alsoCwd ? assertCwd(body.alsoCwd) : undefined;
		return {
			existing: paths.filter((p) => fileExists(dir, p) || (also !== undefined && fileExists(also, p))),
		};
	});

	// Read one file for open-on-canvas (bounded, folder-contained).
	app.get("/file", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = assertCwd(q.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const hit = readTextFile(dir, String(q.path ?? ""));
		if (!hit) return reply.code(404).send({ error: "file not found or unreadable" });
		let mtimeMs: number | undefined;
		try {
			mtimeMs = statSync(hit.abs).mtimeMs;
		} catch {
			/* optional */
		}
		return { abs: hit.abs, content: hit.content, mtimeMs };
	});

	// Save a manual document (only .melon/notes/manual/*.md are writable).
	app.put("/file", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const relPath = String(body?.path ?? "");
		if (!/^\.melon\/notes\/manual\/[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(relPath)) {
			return reply.code(400).send({ error: "only .melon/notes/manual/*.md documents are writable" });
		}
		const content = typeof body?.content === "string" ? body.content : null;
		if (content === null) return reply.code(400).send({ error: "content required" });
		const abs = resolveInside(dir, relPath);
		if (!abs) return reply.code(400).send({ error: "invalid path" });
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, content);
		return { ok: true, mtimeMs: statSync(abs).mtimeMs };
	});

	// Create a manual document ("New document" cards are file-backed).
	app.post("/notes/manual/create", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const title =
			String(body?.title ?? "Untitled")
				.trim()
				.slice(0, 80) || "Untitled";
		const created = createManual(dir, title);
		console.log(`[notes] created manual ${created.relPath}`);
		return created;
	});

	// ── Notes (handoff artifacts): <folder>/.melon/notes/handoff/<id>.md ──
	// The file is the source of truth; canvas note nodes reference it by id.

	/** One LLM call → text. Throws httpError with a user-facing message. */
	async function completeNoteText(systemPrompt: string, prompt: string, modelString: string): Promise<string> {
		const [provider, modelId] = splitModel(modelString);
		const model = (await getModelRuntime()).getModel(provider, modelId);
		if (!model) throw httpError(400, `unknown model: ${modelString}`);
		try {
			const response = await (await getModelRuntime()).complete(
				model,
				{
					systemPrompt,
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{ cacheRetention: "none", sessionId: uuidv7() },
			);
			if (response.stopReason === "error") {
				throw httpError(502, `generation failed: ${response.errorMessage ?? "unknown error"}`);
			}
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (!text) throw httpError(502, "generation produced no text");
			return text;
		} catch (e) {
			if ((e as { statusCode?: number }).statusCode) throw e;
			throw httpError(502, `generation failed: ${(e as Error).message}`);
		}
	}

	/** The user's personal-notes section is pre-created so edits have a home. */
	function ensureNotesMine(text: string): string {
		return /^## Handoff notes \(mine\)/m.test(text) ? text : `${text}\n\n## Handoff notes (mine)\n`;
	}

	/** Resolve the distillation source: live card first, else a session file. */
	function resolveNoteSource(body: any): { sm: SessionManager; sessionFile: string; leafId: string } {
		const sourceCard = body?.sourceCardId ? registry.get(body.sourceCardId) : undefined;
		if (sourceCard) {
			const sm: SessionManager = sourceCard.runtime.session.sessionManager;
			const sessionFile = sm.getSessionFile() ?? "";
			if (!sessionFile || !existsSync(sessionFile)) {
				throw httpError(422, "source card has no flushed session yet — send a message first");
			}
			const leafId = sm.getLeafEntry()?.id;
			if (!leafId) throw httpError(422, "nothing to distill — session is empty");
			return { sm, sessionFile, leafId };
		}
		if (typeof body?.sessionFile === "string" && body.sessionFile.trim()) {
			const file = expandHome(body.sessionFile);
			if (!existsSync(file)) throw httpError(400, `session file not found: ${file}`);
			const sm = SessionManager.open(file);
			const leafId =
				typeof body?.leafEntryId === "string" &&
				sm.getBranch(body.leafEntryId).some((e) => e.id === body.leafEntryId)
					? body.leafEntryId
					: sm.getLeafEntry()?.id;
			if (!leafId) throw httpError(422, "nothing to distill — session is empty");
			return { sm, sessionFile: sm.getSessionFile() ?? file, leafId };
		}
		throw httpError(400, "sourceCardId or sessionFile required");
	}

	function wantedModelFor(body: any, sourceCardId?: string): string {
		const sourceCard = sourceCardId ? registry.get(sourceCardId) : undefined;
		return (
			(typeof body?.model === "string" && body.model.trim()) ||
			(sourceCard ? modelToString(sourceCard.runtime.session.model) : "") ||
			getDefaultModel(config.defaultModel)
		);
	}

	/** Distill one session branch into a handoff artifact via one LLM call. */
	app.post("/notes/generate", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}

		let resolved: { sm: SessionManager; sessionFile: string; leafId: string };
		try {
			resolved = resolveNoteSource(body);
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ error: (e as Error).message });
		}
		const { sm, sessionFile, leafId } = resolved;

		const conversationText = serializeBranchForHandoff(sm.getBranch(leafId));
		if (!conversationText.trim()) return reply.code(422).send({ error: "no conversation to distill" });

		const wantedModel = wantedModelFor(body, body?.sourceCardId);
		let generated: string;
		try {
			generated = await completeNoteText(
				HANDOFF_ARTIFACT_SYSTEM_PROMPT,
				`## Session transcript\n\n${conversationText}`,
				wantedModel,
			);
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 502).send({ error: (e as Error).message });
		}
		generated = ensureNotesMine(generated);

		const now = new Date().toISOString();
		const doc: NoteDoc = {
			id: newNoteId(),
			kind: "handoff",
			title:
				String(body?.sourceTitle ?? "Handoff")
					.trim()
					.slice(0, 80) || "Handoff",
			revision: 1,
			created: now,
			updated: now,
			edited: false,
			sources: [
				{
					cardTitle: typeof body?.sourceTitle === "string" ? body.sourceTitle : undefined,
					cardId: typeof body?.sourceCardId === "string" ? body.sourceCardId : undefined,
					canvasId: typeof body?.canvasId === "string" ? body.canvasId : undefined,
					sessionFile,
					sessionId: sm.getSessionId(),
					leafEntryId: leafId,
					cwd: sm.getCwd(),
				},
			],
			generatedBy: {
				model: wantedModel,
				thinkingLevel: typeof body?.thinkingLevel === "string" ? body.thinkingLevel : "default",
				promptVersion: "handoff-1",
			},
			history: [`r1 generated from 1 source (${now})`],
			wires: [],
			body: generated,
			mtimeMs: 0,
		};
		doc.filePath = uniqueHandoffFileName(dir, doc.title);
		const mtimeMs = saveNote(dir, doc);
		console.log(`[notes] generated ${doc.id} -> ${doc.filePath}`);
		return {
			id: doc.id,
			kind: doc.kind,
			title: doc.title,
			revision: doc.revision,
			created: doc.created,
			updated: doc.updated,
			edited: doc.edited,
			body: doc.body,
			path: doc.filePath,
			mtimeMs,
			generatedBy: doc.generatedBy,
			source: doc.sources[0],
		};
	});

	app.get("/notes", async (req) => {
		const dir = expandHome((req.query as any)?.cwd ?? "");
		return { notes: listNotes(dir) };
	});

	app.get("/notes/:id", async (req, reply) => {
		const dir = expandHome((req.query as any)?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		return {
			...doc,
			bodyHash: hashBody(doc.body),
			path: doc.filePath ?? notePath(dir, id),
			// Per-wire content drift — chips render stale + "send update".
			wires: doc.wires.map((w) => ({ ...w, stale: wireIsStale(doc, w) })),
		};
	});

	// User edits: body and/or title. mtimeMs is the optimistic concurrency
	// token — on mismatch the server returns 409 with the current file state.
	// `via: { instruction }` marks the edit as an accepted AI refine.
	app.put("/notes/:id", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		if (typeof body?.mtimeMs === "number" && body.mtimeMs > 0 && Math.abs(body.mtimeMs - doc.mtimeMs) > 1) {
			return reply.code(409).send({ error: "note changed on disk", note: { ...doc, path: doc.filePath } });
		}
		const now = new Date().toISOString();
		let changed = false;
		if (typeof body?.title === "string" && body.title.trim() && body.title.trim() !== doc.title) {
			doc.title = body.title.trim().slice(0, 80);
			// Title is the name: the filename follows it (id stays stable).
			renameNoteFile(dir, doc, doc.title);
			changed = true;
		}
		if (typeof body?.body === "string" && body.body !== doc.body) {
			doc.body = body.body;
			doc.edited = true;
			const instruction = typeof body?.via?.instruction === "string" ? body.via.instruction.trim() : "";
			doc.history.push(
				instruction
					? `r${doc.revision} edited via AI refine: "${instruction.slice(0, 120)}" (${now})`
					: `r${doc.revision} edited by user (${now})`,
			);
			changed = true;
		}
		let mtimeMs = doc.mtimeMs;
		if (changed) {
			doc.updated = now;
			mtimeMs = saveNote(dir, doc);
		}
		return {
			ok: true,
			mtimeMs,
			title: doc.title,
			revision: doc.revision,
			updated: doc.updated,
			...(doc.filePath ? { path: doc.filePath } : {}),
		};
	});

	app.delete("/notes/:id", async (req, reply) => {
		const dir = expandHome((req.query as any)?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		trashNote(dir, id);
		return { ok: true, wiredCardIds: [...new Set(doc.wires.map((w) => w.cardId))] };
	});

	// Deliver a note into a card. Mode is decided server-side: seed for a
	// fresh card (message appended, NO turn triggered — it flushes with the
	// first assistant reply), inject for a card that already has a
	// conversation (LLM-visible custom_message; queued via nextTurn when the
	// card is mid-turn). Re-delivering identical content is a 409 no-op; any
	// body drift delivers as an update.
	app.post("/notes/:id/wire", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		const targetCardId = String(body?.targetCardId ?? "");
		if (!targetCardId) return reply.code(400).send({ error: "targetCardId required" });

		const bodyHash = hashBody(doc.body);
		const lastWire = [...doc.wires].reverse().find((w) => w.cardId === targetCardId);
		if (lastWire && lastWire.status === "delivered" && lastWire.bodyHash === bodyHash) {
			return reply.code(409).send({ error: "already delivered, unchanged", wire: lastWire });
		}

		// Reuse a live runtime, else attach one (resume when the card has a file).
		const existing = registry.get(targetCardId);
		let runtime: any;
		if (existing) {
			runtime = existing.runtime;
		} else {
			const sessionCwd = typeof body?.sessionCwd === "string" && body.sessionCwd.trim() ? body.sessionCwd : dir;
			const skills = Array.isArray(body?.skills)
				? (body.skills as unknown[]).filter((x): x is string => typeof x === "string")
				: [];
			const sessionFile = typeof body?.sessionFile === "string" && body.sessionFile ? body.sessionFile : undefined;
			runtime = await attachSession(
				targetCardId,
				sessionFile ? SessionManager.open(sessionFile) : SessionManager.create(sessionCwd),
				body?.model,
				skills,
				"create",
				typeof body?.thinkingLevel === "string" ? body.thinkingLevel : undefined,
			);
		}
		const envelope = `[Context handoff from card "${
			doc.sources[0]?.cardTitle ?? doc.title
		}" — reference material for future turns, not a request.\nArtifact ${doc.id} r${doc.revision} — file: ${
			doc.filePath ?? notePath(dir, doc.id)
		}]`;
		const messageText = `${envelope}\n\n${doc.body}`;
		const hasMessages = runtime.session.sessionManager.getEntries().some((e: any) => e.type === "message");
		let mode: "seed" | "inject";
		if (hasMessages) {
			// Inject: LLM-visible, rendered distinctly, content lands in the file
			// immediately when idle, or rides the next turn when mid-flight.
			mode = "inject";
			const custom = {
				customType: "melon.handoff",
				content: [{ type: "text", text: messageText }],
				display: true,
				details: { artifactId: doc.id, revision: doc.revision },
			};
			if (existing?.busy) {
				await runtime.session.sendCustomMessage(custom, { deliverAs: "nextTurn" });
			} else {
				await runtime.session.sendCustomMessage(custom, {});
			}
		} else {
			mode = "seed";
			runtime.session.sessionManager.appendMessage({
				role: "user",
				content: [{ type: "text", text: messageText }],
				timestamp: Date.now(),
			} as Message);
		}
		// Any connected client renders the delivered content immediately.
		registry.broadcast(targetCardId, {
			type: "note_injected",
			artifactId: doc.id,
			revision: doc.revision,
			mode,
			text: messageText,
		});

		const now = new Date().toISOString();
		const wire = {
			cardId: targetCardId,
			...(typeof body?.canvasId === "string" ? { canvasId: body.canvasId } : {}),
			mode,
			revision: doc.revision,
			bodyHash,
			status: "delivered" as const,
			deliveredAt: now,
		};
		doc.wires.push(wire);
		saveNote(dir, doc);
		console.log(`[notes] ${mode === "seed" ? "seeded" : "injected"} ${doc.id} r${doc.revision} → ${targetCardId}`);
		return {
			ok: true,
			mode,
			sessionId: runtime.session.sessionId,
			sessionFile: runtime.session.sessionFile,
			message: messageText,
			wire,
		};
	});

	// ── Merge: distill-each + one synthesis call → a merge artifact ──
	app.post("/notes/merge/generate", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		// Sources: explicit descriptors ({cardId?} for live cards, {sessionFile?}
		// for cold sessions), or the shorthand sourceCardIds array.
		const rawSources: Array<{ cardId?: string; sessionFile?: string; title?: string }> = Array.isArray(body?.sources)
			? (body.sources as any[]).map((s) => ({
					cardId: typeof s?.cardId === "string" ? s.cardId : undefined,
					sessionFile: typeof s?.sessionFile === "string" ? s.sessionFile : undefined,
					title: typeof s?.title === "string" ? s.title : undefined,
				}))
			: (Array.isArray(body?.sourceCardIds) ? body.sourceCardIds : [])
					.filter((x: unknown): x is string => typeof x === "string")
					.map((cardId: string) => ({ cardId }));
		if (rawSources.length < 2) return reply.code(400).send({ error: "at least two sources required" });

		// Distill-each: reuse an existing handoff artifact for a source when one
		// exists; otherwise distill fresh and SAVE it (file only — no canvas node).
		const distillations: Array<{ title: string; body: string; source: NoteDoc["sources"][number] }> = [];
		try {
			for (const src of rawSources) {
				const reuseSessionFile = src.sessionFile;
				const reusable = listNotes(dir)
					.map((n) => loadNote(dir, n.id))
					.find(
						(n) =>
							n &&
							n.kind === "handoff" &&
							((src.cardId && n.sources.some((s) => s.cardId === src.cardId)) ||
								(reuseSessionFile && n.sources.some((s) => s.sessionFile === expandHome(reuseSessionFile)))),
					);
				if (reusable) {
					distillations.push({
						title: reusable.title,
						body: reusable.body,
						source: { ...reusable.sources[0], cardId: src.cardId, handoffId: reusable.id },
					});
					continue;
				}
				const resolved = resolveNoteSource({
					...(src.cardId ? { sourceCardId: src.cardId } : {}),
					...(src.sessionFile ? { sessionFile: src.sessionFile } : {}),
				});
				const conversationText = serializeBranchForHandoff(resolved.sm.getBranch(resolved.leafId));
				if (!conversationText.trim()) {
					throw httpError(422, `source has no conversation to distill`);
				}
				const cardTitle =
					src.title ?? (src.cardId ? body?.sourceTitles?.[src.cardId] : undefined) ?? src.cardId ?? "source";
				const text = ensureNotesMine(
					await completeNoteText(
						HANDOFF_ARTIFACT_SYSTEM_PROMPT,
						`## Session transcript\n\n${conversationText}`,
						wantedModelFor(body, src.cardId),
					),
				);
				const now = new Date().toISOString();
				const perSource: NoteDoc = {
					id: newNoteId(),
					kind: "handoff",
					title: String(cardTitle).trim().slice(0, 80) || "Handoff",
					revision: 1,
					created: now,
					updated: now,
					edited: false,
					sources: [
						{
							cardTitle: typeof cardTitle === "string" ? cardTitle : undefined,
							cardId: src.cardId,
							canvasId: typeof body?.canvasId === "string" ? body.canvasId : undefined,
							sessionFile: resolved.sessionFile,
							sessionId: resolved.sm.getSessionId(),
							leafEntryId: resolved.leafId,
							cwd: resolved.sm.getCwd(),
						},
					],
					generatedBy: {
						model: wantedModelFor(body, src.cardId),
						thinkingLevel: "default",
						promptVersion: "handoff-1",
					},
					history: [`r1 generated as merge source (${now})`],
					wires: [],
					body: text,
					mtimeMs: 0,
				};
				perSource.filePath = uniqueHandoffFileName(dir, perSource.title);
				saveNote(dir, perSource);
				distillations.push({
					title: perSource.title,
					body: perSource.body,
					source: { ...perSource.sources[0], handoffId: perSource.id },
				});
			}
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 502).send({ error: (e as Error).message });
		}

		const sourcesBlock = distillations
			.map((d) => `## Source: "${d.title}" (artifact ${d.source.handoffId})\n\n${d.body}`)
			.join("\n\n---\n\n");
		const wantedModel = wantedModelFor(body);
		let merged: string;
		try {
			merged = ensureNotesMine(
				await completeNoteText(
					MERGE_ARTIFACT_SYSTEM_PROMPT,
					`## Source handoff artifacts\n\n${sourcesBlock}`,
					wantedModel,
				),
			);
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 502).send({ error: (e as Error).message });
		}

		const now = new Date().toISOString();
		const doc: NoteDoc = {
			id: newNoteId(),
			kind: "merge",
			title:
				String(body?.title ?? `Merge of ${distillations.length}`)
					.trim()
					.slice(0, 80) || "Merge",
			revision: 1,
			created: now,
			updated: now,
			edited: false,
			sources: distillations.map((d) => d.source),
			generatedBy: {
				model: wantedModel,
				thinkingLevel: typeof body?.thinkingLevel === "string" ? body.thinkingLevel : "default",
				promptVersion: "merge-1",
			},
			history: [`r1 generated from ${distillations.length} sources (${now})`],
			wires: [],
			body: merged,
			mtimeMs: 0,
		};
		doc.filePath = uniqueHandoffFileName(dir, doc.title);
		const mtimeMs = saveNote(dir, doc);
		console.log(`[notes] merged ${doc.id} -> ${doc.filePath}`);
		return {
			id: doc.id,
			kind: doc.kind,
			title: doc.title,
			revision: doc.revision,
			body: doc.body,
			path: doc.filePath,
			mtimeMs,
			generatedBy: doc.generatedBy,
			sources: doc.sources,
		};
	});

	// Regenerate: propose a new body from the pinned provenance. Writes nothing
	// — the client diffs it and accepts via POST /notes/:id/revision.
	app.post("/notes/:id/regenerate", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		const includeNewer = body?.includeNewer === true;
		const wantedModel = wantedModelFor(body);

		try {
			if (doc.kind === "merge") {
				// Re-synthesize from per-source artifacts (cheap, no raw re-read);
				// includeNewer re-distills each source from its session first.
				const parts: string[] = [];
				for (const s of doc.sources) {
					let title = s.cardTitle ?? "source";
					let text: string | undefined;
					if (s.handoffId && !includeNewer) {
						const src = loadNote(dir, s.handoffId);
						if (src) {
							title = src.title;
							text = src.body;
						}
					}
					if (!text) {
						const resolved = resolveNoteSource({ sessionFile: s.sessionFile });
						const conversationText = serializeBranchForHandoff(resolved.sm.getBranch(resolved.leafId));
						if (!conversationText.trim()) throw httpError(422, `source session has no conversation`);
						text = ensureNotesMine(
							await completeNoteText(
								HANDOFF_ARTIFACT_SYSTEM_PROMPT,
								`## Session transcript\n\n${conversationText}`,
								wantedModel,
							),
						);
					}
					parts.push(`## Source: "${title}" (artifact ${s.handoffId ?? "n/a"})\n\n${text}`);
				}
				const proposal = ensureNotesMine(
					await completeNoteText(
						MERGE_ARTIFACT_SYSTEM_PROMPT,
						`## Source handoff artifacts\n\n${parts.join("\n\n---\n\n")}`,
						wantedModel,
					),
				);
				return { ok: true, proposal };
			}

			const src = doc.sources[0];
			if (!src?.sessionFile) return reply.code(422).send({ error: "artifact has no session provenance" });
			const resolved = resolveNoteSource({
				sessionFile: src.sessionFile,
				...(includeNewer ? {} : { leafEntryId: src.leafEntryId }),
			});
			const conversationText = serializeBranchForHandoff(resolved.sm.getBranch(resolved.leafId));
			if (!conversationText.trim()) return reply.code(422).send({ error: "no conversation to distill" });
			const proposal = ensureNotesMine(
				await completeNoteText(
					HANDOFF_ARTIFACT_SYSTEM_PROMPT,
					`## Session transcript\n\n${conversationText}`,
					wantedModel,
				),
			);
			return { ok: true, proposal };
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 502).send({ error: (e as Error).message });
		}
	});

	// Accept a regenerated body: snapshot the current revision to history/,
	// bump the revision, write. Delivered wires go stale via hash mismatch.
	app.post("/notes/:id/revision", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		const newBody = typeof body?.body === "string" ? body.body : "";
		if (!newBody.trim()) return reply.code(400).send({ error: "body required" });
		snapshotRevision(dir, doc);
		const now = new Date().toISOString();
		doc.revision += 1;
		doc.body = newBody;
		doc.edited = false;
		doc.updated = now;
		doc.history.push(`r${doc.revision} regenerated (${now})`);
		const mtimeMs = saveNote(dir, doc);
		return { ok: true, revision: doc.revision, mtimeMs, bodyHash: hashBody(doc.body) };
	});

	// AI refine: propose an edited body from the current one + instruction.
	// Merge artifacts ground on their per-source distillations. Writes nothing.
	app.post("/notes/:id/refine", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const doc = loadNote(dir, id);
		if (!doc) return reply.code(404).send({ error: "note not found" });
		const instruction = String(body?.instruction ?? "").trim();
		if (!instruction) return reply.code(400).send({ error: "instruction required" });
		const wantedModel = wantedModelFor(body);

		try {
			let grounding = "";
			if (doc.kind === "merge") {
				const parts: string[] = [];
				for (const s of doc.sources) {
					if (!s.handoffId) continue;
					const src = loadNote(dir, s.handoffId);
					if (src) parts.push(`## Source: "${src.title}"\n\n${src.body}`);
				}
				if (parts.length > 0)
					grounding = `\n\n## Grounding (per-source distillations)\n\n${parts.join("\n\n---\n\n")}`;
			}
			const proposal = ensureNotesMine(
				await completeNoteText(
					REFINE_ARTIFACT_SYSTEM_PROMPT,
					`## Current artifact\n\n${doc.body}${grounding}\n\n## Instruction\n\n${instruction}`,
					wantedModel,
				),
			);
			return { ok: true, proposal };
		} catch (e) {
			return reply.code((e as { statusCode?: number }).statusCode ?? 502).send({ error: (e as Error).message });
		}
	});

	// ── Generation jobs: shell file exists at start; live status + streamed body ──

	const HANDOFF_SKELETON =
		"## Goal\n\n## Findings\n\n## Decisions\n\n## Gotchas\n\n## Open questions\n\n## Evidence (do not re-derive)\n\n## Handoff notes (mine)\n";
	const MERGE_SKELETON =
		"## Shared goal\n\n## Decisions\n\n## Conflicts to resolve\n\n## Open questions\n\n## Evidence (do not re-derive)\n\n## Next steps\n\n## Handoff notes (mine)\n";

	/** One streaming LLM call; deltas are pumped into the job's event log. */
	async function streamNoteText(
		job: ReturnType<typeof createNoteJob>,
		systemPrompt: string,
		prompt: string,
		modelString: string,
	): Promise<string> {
		const [provider, modelId] = splitModel(modelString);
		const model = (await getModelRuntime()).getModel(provider, modelId);
		if (!model) throw httpError(400, `unknown model: ${modelString}`);
		const pump = createDeltaPump(job);
		try {
			const stream = (await getModelRuntime()).stream(
				model,
				{
					systemPrompt,
					messages: [{ role: "user", content: [{ type: "text", text: prompt }], timestamp: Date.now() }],
				},
				{ cacheRetention: "none", sessionId: uuidv7() },
			);
			void (async () => {
				try {
					for await (const ev of stream) {
						if (ev.type === "text_delta") pump.push(ev.delta);
					}
				} catch {
					/* result() surfaces the failure */
				}
			})();
			const response = await stream.result();
			pump.flush();
			if (response.stopReason === "error") {
				throw httpError(502, `generation failed: ${response.errorMessage ?? "unknown error"}`);
			}
			const text = response.content
				.filter((c): c is { type: "text"; text: string } => c.type === "text")
				.map((c) => c.text)
				.join("\n")
				.trim();
			if (!text) throw httpError(502, "generation produced no text");
			return text;
		} catch (e) {
			pump.flush();
			if ((e as { statusCode?: number }).statusCode) throw e;
			throw httpError(502, `generation failed: ${(e as Error).message}`);
		}
	}

	/**
	 * Start a handoff job. The artifact FILE is created immediately (the name
	 * exists before the AI does anything); pass artifactId to re-run generation
	 * into an existing shell (retry after failure).
	 */
	app.post("/notes/generate/start", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		let doc: NoteDoc;
		let leafId: string | undefined;
		if (typeof body?.artifactId === "string" && body.artifactId) {
			if (!isValidNoteId(body.artifactId)) return reply.code(400).send({ error: "invalid note id" });
			const loaded = loadNote(dir, body.artifactId);
			if (!loaded) return reply.code(404).send({ error: "note not found" });
			doc = loaded;
			doc.body = HANDOFF_SKELETON;
			doc.edited = false;
			leafId = doc.sources[0]?.leafEntryId;
		} else {
			let resolved: { sm: SessionManager; sessionFile: string; leafId: string };
			try {
				resolved = resolveNoteSource(body);
			} catch (e) {
				return reply.code((e as { statusCode?: number }).statusCode ?? 400).send({ error: (e as Error).message });
			}
			leafId = resolved.leafId;
			const now = new Date().toISOString();
			doc = {
				id: newNoteId(),
				kind: "handoff",
				title:
					String(body?.sourceTitle ?? "Handoff")
						.trim()
						.slice(0, 80) || "Handoff",
				revision: 1,
				created: now,
				updated: now,
				edited: false,
				sources: [
					{
						cardTitle: typeof body?.sourceTitle === "string" ? body.sourceTitle : undefined,
						cardId: typeof body?.sourceCardId === "string" ? body.sourceCardId : undefined,
						canvasId: typeof body?.canvasId === "string" ? body.canvasId : undefined,
						sessionFile: resolved.sessionFile,
						sessionId: resolved.sm.getSessionId(),
						leafEntryId: resolved.leafId,
						cwd: resolved.sm.getCwd(),
					},
				],
				generatedBy: {
					model: wantedModelFor(body, body?.sourceCardId),
					thinkingLevel: typeof body?.thinkingLevel === "string" ? body.thinkingLevel : "default",
					promptVersion: "handoff-1",
				},
				history: [`r1 generation started (${now})`],
				wires: [],
				body: HANDOFF_SKELETON,
				mtimeMs: 0,
			};
			doc.filePath = uniqueHandoffFileName(dir, doc.title);
		}
		const mtimeMs = saveNote(dir, doc);
		const job = createNoteJob();
		const sessionFile = doc.sources[0]?.sessionFile ?? "";
		const pinnedLeaf = leafId ?? doc.sources[0]?.leafEntryId;
		const model = doc.generatedBy.model;
		const focus = typeof body?.focus === "string" ? body.focus.trim().slice(0, 300) : "";
		if (focus && !doc.history.some((h) => h.includes("focus:"))) {
			doc.history.push(`r1 focus: "${focus}" (${new Date().toISOString()})`);
			saveNote(dir, doc);
		}
		const runDoc = doc;
		void (async () => {
			try {
				emitNoteJob(job, { type: "status", message: "reading session transcript" });
				if (!sessionFile || !existsSync(sessionFile)) throw httpError(422, "source session is gone");
				const sm = SessionManager.open(sessionFile);
				const leaf = pinnedLeaf && sm.getBranch(pinnedLeaf).length > 0 ? pinnedLeaf : sm.getLeafEntry()?.id;
				const conversationText = serializeBranchForHandoff(sm.getBranch(leaf ?? ""));
				if (!conversationText.trim()) throw httpError(422, "no conversation to distill");
				emitNoteJob(job, {
					type: "status",
					message: focus ? `distilling with ${model} (focus: ${focus.slice(0, 60)})` : `distilling with ${model}`,
				});
				const focusBlock = focus
					? `\n\n## Focus\n\n${focus}\n\nGive special attention to the focus above; compress everything else. Keep ALL the fixed section headers in place.`
					: "";
				const text = ensureNotesMine(
					await streamNoteText(
						job,
						HANDOFF_ARTIFACT_SYSTEM_PROMPT,
						`## Session transcript\n\n${conversationText}${focusBlock}`,
						model,
					),
				);
				emitNoteJob(job, { type: "status", message: "writing artifact" });
				runDoc.body = text;
				runDoc.updated = new Date().toISOString();
				runDoc.edited = false;
				const finalMtime = saveNote(dir, runDoc);
				emitNoteJob(job, {
					type: "done",
					artifact: {
						id: runDoc.id,
						title: runDoc.title,
						revision: runDoc.revision,
						body: runDoc.body,
						path: runDoc.filePath,
						mtimeMs: finalMtime,
						generatedBy: runDoc.generatedBy,
					},
				});
			} catch (e) {
				emitNoteJob(job, { type: "error", message: (e as Error).message });
			}
		})();
		return {
			id: doc.id,
			title: doc.title,
			path: doc.filePath,
			mtimeMs,
			model: doc.generatedBy.model,
			jobId: job.id,
		};
	});

	// Live generation events (status / body deltas / done / error). Buffered —
	// a reconnecting client replays the whole story.
	app.get("/notes/jobs/:jobId/events", (req, reply) => {
		const job = getNoteJob((req.params as any).jobId);
		if (!job) return reply.code(404).send({ error: "unknown job" });
		reply.raw.writeHead(200, {
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
			connection: "keep-alive",
			"access-control-allow-origin": (req.headers.origin as string) ?? "*",
		});
		reply.raw.flushHeaders();
		for (const ev of job.events) reply.raw.write(`data: ${JSON.stringify(ev)}\n\n`);
		if (job.done) {
			reply.raw.end();
			return;
		}
		const send = (event: Parameters<typeof emitNoteJob>[1]) => {
			try {
				reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
				if (event.type === "done" || event.type === "error") reply.raw.end();
			} catch {
				/* client gone */
			}
		};
		job.clients.add(send);
		req.raw.on("close", () => job.clients.delete(send));
	});

	// ── Merge job: same shape as handoff jobs (distill-each + synthesis) ──
	app.post("/notes/merge/start", async (req, reply) => {
		const body = req.body as any;
		let dir: string;
		try {
			dir = assertCwd(body?.cwd);
		} catch (e) {
			return reply.code(400).send({ error: (e as Error).message });
		}
		const rawSources: Array<{ cardId?: string; sessionFile?: string; title?: string }> = Array.isArray(body?.sources)
			? (body.sources as any[]).map((src) => ({
					cardId: typeof src?.cardId === "string" ? src.cardId : undefined,
					sessionFile: typeof src?.sessionFile === "string" ? src.sessionFile : undefined,
					title: typeof src?.title === "string" ? src.title : undefined,
				}))
			: [];
		if (rawSources.length < 2) return reply.code(400).send({ error: "at least two sources required" });
		const title =
			String(body?.title ?? "Merge")
				.trim()
				.slice(0, 80) || "Merge";
		const now = new Date().toISOString();
		const doc: NoteDoc = {
			id: newNoteId(),
			kind: "merge",
			title,
			revision: 1,
			created: now,
			updated: now,
			edited: false,
			sources: [],
			generatedBy: {
				model: wantedModelFor(body),
				thinkingLevel: typeof body?.thinkingLevel === "string" ? body.thinkingLevel : "default",
				promptVersion: "merge-1",
			},
			history: [`r1 merge started from ${rawSources.length} sources (${now})`],
			wires: [],
			body: MERGE_SKELETON,
			mtimeMs: 0,
		};
		doc.filePath = uniqueHandoffFileName(dir, doc.title);
		const mtimeMs = saveNote(dir, doc);
		const job = createNoteJob();
		const model = doc.generatedBy.model;
		const runDoc = doc;
		void (async () => {
			try {
				const distillations: Array<{ title: string; body: string; source: NoteDoc["sources"][number] }> = [];
				let index = 0;
				for (const src of rawSources) {
					index++;
					const reuseSessionFile = src.sessionFile;
					const reusable = listNotes(dir)
						.map((n) => loadNote(dir, n.id))
						.find(
							(n) =>
								n &&
								n.kind === "handoff" &&
								((src.cardId && n.sources.some((s) => s.cardId === src.cardId)) ||
									(reuseSessionFile && n.sources.some((s) => s.sessionFile === expandHome(reuseSessionFile)))),
						);
					if (reusable) {
						emitNoteJob(job, {
							type: "status",
							message: `source ${index}/${rawSources.length}: reusing "${reusable.title}"`,
						});
						distillations.push({
							title: reusable.title,
							body: reusable.body,
							source: { ...reusable.sources[0], cardId: src.cardId, handoffId: reusable.id },
						});
						continue;
					}
					emitNoteJob(job, { type: "status", message: `distilling source ${index}/${rawSources.length}` });
					const resolved = resolveNoteSource({
						...(src.cardId ? { sourceCardId: src.cardId } : {}),
						...(src.sessionFile ? { sessionFile: src.sessionFile } : {}),
					});
					const conversationText = serializeBranchForHandoff(resolved.sm.getBranch(resolved.leafId));
					if (!conversationText.trim()) throw httpError(422, "a source has no conversation to distill");
					const cardTitle =
						src.title ?? (src.cardId ? body?.sourceTitles?.[src.cardId] : undefined) ?? src.cardId ?? "source";
					const text = ensureNotesMine(
						await streamNoteText(
							job,
							HANDOFF_ARTIFACT_SYSTEM_PROMPT,
							`## Session transcript\n\n${conversationText}`,
							model,
						),
					);
					const perNow = new Date().toISOString();
					const perSource: NoteDoc = {
						id: newNoteId(),
						kind: "handoff",
						title: String(cardTitle).trim().slice(0, 80) || "Handoff",
						revision: 1,
						created: perNow,
						updated: perNow,
						edited: false,
						sources: [
							{
								cardTitle: typeof cardTitle === "string" ? cardTitle : undefined,
								cardId: src.cardId,
								canvasId: typeof body?.canvasId === "string" ? body.canvasId : undefined,
								sessionFile: resolved.sessionFile,
								sessionId: resolved.sm.getSessionId(),
								leafEntryId: resolved.leafId,
								cwd: resolved.sm.getCwd(),
							},
						],
						generatedBy: { model, thinkingLevel: "default", promptVersion: "handoff-1" },
						history: [`r1 generated as merge source (${perNow})`],
						wires: [],
						body: text,
						mtimeMs: 0,
					};
					perSource.filePath = uniqueHandoffFileName(dir, perSource.title);
					saveNote(dir, perSource);
					distillations.push({
						title: perSource.title,
						body: perSource.body,
						source: { ...perSource.sources[0], handoffId: perSource.id },
					});
				}
				runDoc.sources = distillations.map((d) => d.source);
				emitNoteJob(job, { type: "status", message: `synthesizing with ${model}` });
				const sourcesBlock = distillations
					.map((d) => `## Source: "${d.title}" (artifact ${d.source.handoffId})\n\n${d.body}`)
					.join("\n\n---\n\n");
				const merged = ensureNotesMine(
					await streamNoteText(
						job,
						MERGE_ARTIFACT_SYSTEM_PROMPT,
						`## Source handoff artifacts\n\n${sourcesBlock}`,
						model,
					),
				);
				emitNoteJob(job, { type: "status", message: "writing artifact" });
				runDoc.body = merged;
				runDoc.updated = new Date().toISOString();
				runDoc.edited = false;
				const finalMtime = saveNote(dir, runDoc);
				emitNoteJob(job, {
					type: "done",
					artifact: {
						id: runDoc.id,
						title: runDoc.title,
						revision: runDoc.revision,
						body: runDoc.body,
						path: runDoc.filePath,
						mtimeMs: finalMtime,
						generatedBy: runDoc.generatedBy,
						sources: runDoc.sources,
					},
				});
			} catch (e) {
				emitNoteJob(job, { type: "error", message: (e as Error).message });
			}
		})();
		return {
			id: doc.id,
			title: doc.title,
			path: doc.filePath,
			mtimeMs,
			model: doc.generatedBy.model,
			jobId: job.id,
		};
	});

	// Resolve a note FILE path to its stable identity (for @-mention clicks —
	// filenames are slugs and may change; the frontmatter id never does).
	app.get("/notes/resolve", async (req, reply) => {
		const q = req.query as any;
		const dir = expandHome(q.cwd ?? "");
		const relPath = String(q.path ?? "");
		const hit = readTextFile(dir, relPath);
		if (!hit) return reply.code(404).send({ error: "note not found" });
		try {
			const doc = parseNote(hit.content);
			return { id: doc.id, kind: doc.kind, title: doc.title };
		} catch {
			return reply.code(404).send({ error: "not a note artifact" });
		}
	});

	// Re-surface a trashed artifact (artifact browser trash section).
	app.post("/notes/:id/restore", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		if (!restoreNote(dir, id)) return reply.code(404).send({ error: "not in trash" });
		const doc = loadNote(dir, id);
		return { ok: true, note: doc ? { ...doc, path: notePath(dir, id) } : null };
	});

	app.get("/notes-trash", async (req) => {
		const dir = expandHome((req.query as any)?.cwd ?? "");
		return { notes: listTrashedNotes(dir) };
	});

	// Reveal the artifact file in the OS file manager (desktop shell).
	app.post("/notes/:id/reveal", async (req, reply) => {
		const body = req.body as any;
		const dir = expandHome(body?.cwd ?? "");
		const id = (req.params as any).id;
		if (!isValidNoteId(id)) return reply.code(400).send({ error: "invalid note id" });
		const path = notePath(dir, id);
		if (!existsSync(path)) return reply.code(404).send({ error: "note not found" });
		const { execFile } = await import("node:child_process");
		const cmd =
			process.platform === "darwin"
				? ["open", "-R", path]
				: process.platform === "win32"
					? ["explorer", "/select,", path]
					: ["xdg-open", dir];
		try {
			await new Promise<void>((res, rej) =>
				execFile(cmd[0] as string, cmd.slice(1), { timeout: 15_000 }, (err) => (err ? rej(err) : res())),
			);
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
		return { ok: true };
	});

	// Folder navigator: list subdirectories of a path for the in-app picker.
	app.get("/browse", async (req, reply) => {
		const q = req.query as any;
		let dir: string;
		try {
			dir = expandHome(q.path?.trim() ? q.path : "~");
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
			worktreeMode?: "isolated" | "local";
			worktreeName?: string;
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
					const iso = isolationMeta(cv, dir);
					canvases.push({
						id: cv.id,
						name: cv.name ?? "Untitled",
						worktreeMode: iso.worktreeMode,
						worktreeName: iso.worktreeName,
						sessions,
					});
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
	app.get("/folders", async () => {
		// Only list folders that still exist on disk — rm -rf'd folders vanish
		// from the sidebar on the next refresh.
		const folders = loadFolderHistory().filter(
			(f) => statSync(f.cwd, { throwIfNoEntry: false })?.isDirectory() === true,
		);
		return { folders };
	});

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

	app.delete("/folders", async (req, _reply) => {
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
		const denied = new Set((loadSettings().denylistedModels ?? []).map((x) => x));
		const filtered = all.filter((m) => !denied.has(m.label));
		const models = provider ? filtered.filter((m) => m.provider === provider) : filtered;
		const wantsCursor = !provider || provider.toLowerCase() === CURSOR_PROVIDER_ID;
		const cursor = wantsCursor ? getCursorCatalogStatus() : undefined;
		// Empty Cursor list is almost always a load/isolation/auth issue — surface it.
		const error =
			provider.toLowerCase() === CURSOR_PROVIDER_ID && models.length === 0
				? (cursor?.issues[0] ?? "No Cursor models available")
				: undefined;
		return { models, total: models.length, ...(cursor ? { cursor } : {}), ...(error ? { error } : {}) };
	});

	// Liveness probe — the frontend polls this to clear the "reconnecting" banner.
	// `version` is the same identity stamped into DMG/AppImage/exe filenames.
	app.get("/healthz", async () => ({
		ok: true,
		uptime: Math.round(process.uptime()),
		model: getDefaultModel(config.defaultModel),
		version: readAppVersion(),
	}));

	// Serve an agent-authored visualization HTML file for the viz-file iframe.
	// Guard: absolute path required; must resolve inside the session's cwd
	// (cards can only show files they could have written themselves).
	app.get("/viz", async (req, reply) => {
		const q = req.query as { path?: string; cwd?: string; cardId?: string };
		const p = q.path ?? "";
		if (!isAbsolute(p)) return reply.code(400).send({ error: "absolute path required" });
		// cwd of the requesting card's session, else the requested folder, else default.
		let cwd = "";
		const card = registry.get(q.cardId ?? "");
		if (card?.runtime?.cwd) cwd = String(card.runtime.cwd);
		else if (q.cwd) {
			try {
				cwd = assertCwd(q.cwd);
			} catch {
				return reply.code(400).send({ error: "unknown cwd" });
			}
		} else cwd = expandHome(config.defaultCwd);
		const resolved = resolve(p);
		const rel = relative(resolve(cwd), resolved);
		if (rel.startsWith("..") || isAbsolute(rel)) {
			return reply.code(403).send({ error: "path outside the session working directory" });
		}
		try {
			const html = readFileSync(resolved, "utf8");
			return reply.type("text/html; charset=utf-8").send(html);
		} catch {
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
		const id = (req.params as any).id;
		const sk = readSkill(id);
		if (!sk) return reply.code(404).send({ error: `unknown skill: ${id}` });
		return { id: sk.id, name: sk.name, description: sk.description, instructions: sk.instructions, raw: sk.raw };
	});

	const VALID_SKILL_ID = /^[a-z0-9-]+$/;

	app.post("/skills", async (req, reply) => {
		const b = req.body as any;
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
		const id = (req.params as any).id;
		if (!VALID_SKILL_ID.test(id) || id.length > 64) return reply.code(400).send({ error: "invalid skill id" });
		const b = req.body as any;
		const name = String(b?.name ?? "").trim();
		const description = b?.description ? String(b.description).trim() : undefined;
		const instructions = String(b?.instructions ?? "").trim();
		if (!name || !instructions) return reply.code(400).send({ error: "name and instructions are required" });
		saveSkill(id, name, description, instructions);
		return { ok: true, id };
	});

	app.delete("/skills/:id", async (req, reply) => {
		const id = (req.params as any).id;
		if (!VALID_SKILL_ID.test(id) || id.length > 64) return reply.code(400).send({ error: "invalid skill id" });
		deleteSkill(id);
		return { ok: true, id };
	});

	// Set a card's active skills + retract removed ones.
	app.post("/sessions/:cardId/skills", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const next = Array.isArray((req.body as any)?.skills)
			? ((req.body as any).skills as unknown[]).filter((x): x is string => typeof x === "string")
			: [];
		const prev = s.activeSkills ?? [];
		s.activeSkills = next;
		const skills = loadSkills();
		// Catalog is frozen after session start; the AI self-invokes enabled
		// skills on demand. Only retract skills toggled OFF.
		for (const id of prev) {
			if (!next.includes(id) && skills[id]) {
				try {
					await s.runtime.session.followUp(
						`You are no longer following the "${skills[id].name}" skill. Ignore its instructions from now on.`,
					);
				} catch {
					/* ignore */
				}
			}
		}
		return { ok: true, skills: next };
	});

	// Switch model on a live card session.
	app.post("/sessions/:cardId/model", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const model = String((req.body as any)?.model ?? "");
		const [provider, id] = splitModel(model);
		if (!provider || !id) return reply.code(400).send({ error: "model must be provider/id" });
		try {
			const m = (await getModelRuntime()).getModel(provider, id);
			if (!m) {
				// Model is not in the live catalog — hide it so it stops failing.
				denylistModel(model);
				return reply.code(400).send({ error: `unknown model: ${model}` });
			}
			await s.runtime.session.setModel(m);
			touchRecentModel(model);
			// setModel re-clamps the thinking level to the new model's
			// capabilities — return the effective state so the picker resyncs.
			return {
				ok: true,
				model,
				thinkingLevel: s.runtime.session.thinkingLevel,
				thinkingLevels: s.runtime.session.getAvailableThinkingLevels(),
			};
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
	});

	// Valid level NAMES (pi clamps to the model's supported subset internally).
	const VALID_THINKING_LEVELS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);

	// Change thinking level on a live card session. Applies from the NEXT
	// streaming call — pi re-feeds agent state at every turn boundary
	// (prepareNextTurn), so mid-turn changes are followed without a restart.
	app.post("/sessions/:cardId/thinking", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const level = (req.body as any)?.level;
		if (typeof level !== "string" || !VALID_THINKING_LEVELS.has(level)) {
			return reply.code(400).send({ error: "level must be one of off|minimal|low|medium|high|xhigh|max" });
		}
		try {
			s.runtime.session.setThinkingLevel(level);
			return {
				ok: true,
				level: s.runtime.session.thinkingLevel,
				thinkingLevels: s.runtime.session.getAvailableThinkingLevels(),
			};
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
		// Theme id must be a non-empty string when provided (web owns the catalog).
		if ("theme" in body) {
			if (typeof body.theme !== "string" || !body.theme.trim()) {
				return reply.code(400).send({ error: "theme must be a non-empty string" });
			}
			next.theme = body.theme.trim();
		}
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
		// Always list Cursor so a failed catalog load is visible in the picker.
		allProviderIds.add(CURSOR_PROVIDER_ID);

		const cursorStatus = getCursorCatalogStatus();
		const result: Array<{
			id: string;
			provider: string;
			configured: boolean;
			source?: string;
			keyPreview?: string;
			authType?: string;
			error?: string;
		}> = [];

		for (const pid of [...allProviderIds].sort()) {
			const status = mr.getProviderAuthStatus(pid);
			const entry = authEntries[pid];
			const melonKey = melonKeys[pid];

			let keyPreview: string | undefined;
			let authType: string | undefined;

			if (entry) {
				authType = entry.type ?? undefined;
				if (entry.type === "api_key" && typeof entry.key === "string") keyPreview = maskKey(entry.key);
				else if (entry.type === "oauth" && typeof entry.access === "string") keyPreview = maskKey(entry.access);
			} else if (melonKey) {
				keyPreview = maskKey(melonKey);
				authType = "api_key";
			}

			// The cursor extension registers a literal placeholder apiKey, so the
			// generic status reports "configured" with no real key. Report the truth.
			const configured = pid === CURSOR_PROVIDER_ID ? hasRealCursorKey(authEntries, melonKeys) : !!status.configured;

			result.push({
				id: pid,
				provider: pid,
				configured,
				source: (status as any).source ?? undefined,
				keyPreview,
				authType,
				...(pid === CURSOR_PROVIDER_ID && (!cursorStatus.loaded || cursorStatus.issues.length > 0)
					? { error: cursorStatus.issues[0] }
					: {}),
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
			// Persist to auth.json — runtime overrides die with this process, but
			// sessions (and extensions like pi-cursor-sdk) read auth.json directly.
			mkdirSync(getAgentDir(), { recursive: true });
			const authPath = join(getAgentDir(), "auth.json");
			let auth: Record<string, unknown> = {};
			try {
				auth = JSON.parse(readFileSync(authPath, "utf8"));
			} catch {}
			auth[provider] = { type: "api_key", key };
			writeFileSync(authPath, JSON.stringify(auth, null, "\t"), { mode: 0o600 });
			// A fresh key may resurrect models that failed before it existed.
			clearProviderDenylist(provider);
			const st = loadSettings();
			st.providerKeys = { ...(st.providerKeys ?? {}), [provider]: key };
			saveSettings(st);
			// Re-discover Cursor models now that a real key exists.
			if (provider === CURSOR_PROVIDER_ID) {
				try {
					await loadCursorProviderInto(await getModelRuntime());
				} catch (e) {
					return reply.code(500).send({
						error: (e as Error).message,
						cursor: getCursorCatalogStatus(),
					});
				}
				return { ok: true, cursor: getCursorCatalogStatus() };
			}
			return { ok: true };
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
	});

	app.delete("/auth/:provider", async (req) => {
		const provider = (req.params as any).provider;
		await (await getModelRuntime()).removeRuntimeApiKey(provider);
		// Keep auth.json in sync with the runtime override removal.
		try {
			const authPath = join(getAgentDir(), "auth.json");
			const auth = JSON.parse(readFileSync(authPath, "utf8")) as Record<string, unknown>;
			if (provider in auth) {
				delete auth[provider];
				writeFileSync(authPath, JSON.stringify(auth, null, "\t"), { mode: 0o600 });
			}
		} catch {}
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
				t.split("\n[VISUALIZATION PROTOCOL")[0].split("\n[VIZ MODE IS ON")[0].split("\n[READ-ONLY MODE")[0].trim();
			const textOf = (content: any): string =>
				(Array.isArray(content) ? content : [])
					.filter((b: any) => b.type === "text")
					.map((b: any) => b.text)
					.join("");
			const messages: any[] = [];
			const pendingToolArgs = new Map<string, Record<string, unknown>>();
			for (const e of ctx) {
				// Injected handoff notes are LLM-visible custom messages — render
				// them in the transcript so hydration after reload keeps them.
				if (e.type === "custom_message") {
					const cm = e as any;
					if (cm.display !== false) {
						const text = clean(textOf(cm.content));
						if (text) messages.push({ role: "user", text, injected: cm.customType === "melon.handoff" });
					}
					continue;
				}
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
						else if (
							(b.type === "toolCall" || b.type === "toolUse" || b.type === "tool_use") &&
							typeof b.id === "string"
						) {
							const structured = structuredToolArgs(b.arguments ?? b.input ?? b.args);
							if (structured) pendingToolArgs.set(b.id, structured);
						}
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
							const argsStructured = pendingToolArgs.get(m.toolCallId);
							pendingToolArgs.delete(m.toolCallId);
							const persisted = lookupToolDiff(file, m.toolCallId);
							lastA.tools.push({
								callId: m.toolCallId,
								name: m.toolName ?? "tool",
								status: m.isError ? "error" : "ok",
								output: persisted ?? textOf(m.content).slice(0, 8000),
								argsStructured,
								args: argsStructured ? preview(argsStructured) : undefined,
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
		// Replay a blocking question if the client reconnects mid-dialog.
		const pendingUi = s.extensionUi?.getPendingEvent();
		if (pendingUi) reply.raw.write(`data: ${JSON.stringify(pendingUi)}\n\n`);
		req.raw.on("close", () => s.clients.delete(reply));
	});

	// Answer (or cancel) a pending extension UI dialog for this card.
	app.post("/sessions/:cardId/extension-ui", async (req, reply) => {
		const cardId = (req.params as any).cardId as string;
		const s = registry.get(cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const body = (req.body ?? {}) as Record<string, unknown>;
		const id = typeof body.id === "string" ? body.id : "";
		if (!id) return reply.code(400).send({ error: "id required" });

		let response:
			| { id: string; value: string }
			| { id: string; confirmed: boolean }
			| { id: string; cancelled: true };
		if (body.cancelled === true) {
			response = { id, cancelled: true };
		} else if (typeof body.confirmed === "boolean") {
			response = { id, confirmed: body.confirmed };
		} else if (typeof body.value === "string") {
			response = { id, value: body.value };
		} else {
			return reply.code(400).send({ error: "value, confirmed, or cancelled required" });
		}

		if (!s.extensionUi?.respond(response)) {
			return reply.code(409).send({ error: "no matching pending extension UI request" });
		}
		reply.send({ ok: true });
	});

	app.post("/sessions/:cardId/prompt", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const cardId = (req.params as any).cardId;
		const started = Date.now();
		// Busy? Append to the SERVER-OWNED queue — never pi's followUp queue.
		// pi has no per-item removal, so queueing there made cancel/edit racy
		// (clear + re-queue could lose or duplicate items). The drain loop
		// (agent_end -> drainPromptQueue) executes queued items one at a time.
		if (s.busy) {
			const text = String((req.body as any)?.text ?? "");
			const display = String((req.body as any)?.display ?? "") || undefined;
			const context = (req.body as any)?.context ?? "";
			s.promptQueue.push({ text, display, context: context || undefined });
			console.log(
				`[${cardId}] queue:push "${(display ?? text).slice(0, 40)}" (queue=${JSON.stringify(queueDisplays(s.promptQueue))})`,
			);
			registry.broadcast(cardId, { type: "queue", followUp: queueDisplays(s.promptQueue) });
			reply.send({ ok: true, queued: true });
			return;
		}
		const cursorTurnId = beginCursorTurn(s);
		reply.send({ ok: true });

		console.log(`[${cardId}] prompt:start "${String((req.body as any)?.text).slice(0, 60)}"`);
		registry.broadcast(cardId, { type: "raw", text: "\u2b07 prompt received by server" });
		try {
			const text = (req.body as any)?.text ?? "";
			const context = (req.body as any)?.context ?? "";
			// Inject diagram directives and file contents as custom context
			// messages (not user text) so the model doesn't echo them back.
			if (context) {
				await s.runtime.session.sendCustomMessage(
					{
						customType: "context",
						content: [{ type: "text", text: context }],
						display: false,
					},
					{ deliverAs: "nextTurn" },
				);
			}
			await runInBoundCursorSession(s.runtime, { uiContext: s.extensionUi?.getUIContext() }, () =>
				s.runtime.session.prompt(text),
			);
			console.log(`[${cardId}] prompt:end (${Date.now() - started}ms)`);
		} catch (e) {
			console.error(`[${cardId}] prompt:THREW ${(e as Error).stack}`);
			s.extensionUi?.cancelAll();
			registry.broadcast(cardId, { type: "error", message: rewriteCursorError((e as Error).message) });
			registry.broadcast(cardId, { type: "status", status: "error" });
		} finally {
			if (cursorTurnId === undefined) {
				// Preserve existing behavior for non-Cursor providers.
				drainPromptQueue(cardId);
			} else if (registry.get(cardId) === s && isCurrentCursorTurn(s, cursorTurnId)) {
				// agent_end may already have started the next queued turn. Only
				// the current owner can release busy or drain, and an explicit
				// Stop keeps queued prompts paused.
				if (!s.draining) s.busy = false;
				if (!isCursorTurnAborted(s, cursorTurnId)) drainPromptQueue(cardId);
			}
		}
	});

	// The queue lives on the registry entry (s.promptQueue) — cancel is a
	// plain array splice with no pi-internal races.
	app.get("/sessions/:cardId/queue", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		reply.send({ followUp: queueDisplays(s.promptQueue) });
	});

	// Items are identified by their DISPLAY text, not index: the queue mutates
	// as items drain, so a stale index could remove the wrong entry. Display is
	// what the client holds (chips / drafts).
	app.post("/sessions/:cardId/queue/remove", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const text = String((req.body as any)?.text ?? "");
		if (!text) return reply.code(400).send({ error: "text required" });
		const index = s.promptQueue.findIndex((q) => (q.display ?? q.text) === text);
		if (index === -1) {
			// Already drained — it is executing (or done) now. 409 + current
			// list lets the client resync instead of erroring.
			console.log(
				`[${(req.params as any).cardId}] queue:remove MISS "${text.slice(0, 40)}" (queue=${JSON.stringify(queueDisplays(s.promptQueue))})`,
			);
			return reply.code(409).send({ error: "queued message not found", followUp: queueDisplays(s.promptQueue) });
		}
		s.promptQueue.splice(index, 1);
		registry.broadcast((req.params as any).cardId, { type: "queue", followUp: queueDisplays(s.promptQueue) });
		console.log(`[${(req.params as any).cardId}] queue:remove "${text.slice(0, 40)}"`);
		reply.send({ ok: true, followUp: queueDisplays(s.promptQueue) });
	});

	// Clear the whole queue (error/abort recovery) — returns what was dropped
	// so the client can hand the text back to the composer (display strings).
	app.post("/sessions/:cardId/queue/clear", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		const dropped = queueDisplays(s.promptQueue);
		s.promptQueue = [];
		registry.broadcast((req.params as any).cardId, { type: "queue", followUp: [] });
		console.log(`[${(req.params as any).cardId}] queue:clear (${dropped.length} items)`);
		reply.send({ ok: true, followUp: dropped });
	});

	// A user edit landed on a manual/note file that a LIVE agent may hold a
	// stale copy of. Queue a one-line context marker (no turn is triggered).
	app.post("/sessions/:cardId/notify-file", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return { ok: true, notified: false };
		const path = String((req.body as any)?.path ?? "").trim();
		if (!path) return reply.code(400).send({ error: "path required" });
		const custom = {
			customType: "melon.file_changed",
			content: [
				{
					type: "text",
					text: `[context update] The file ${path} was just edited by the user on disk. Any earlier contents you read are outdated — re-read it before relying on them.`,
				},
			],
			display: false,
		};
		try {
			if (s.busy) {
				await s.runtime.session.sendCustomMessage(custom, { deliverAs: "nextTurn" });
			} else {
				await s.runtime.session.sendCustomMessage(custom, {});
			}
		} catch (e) {
			return reply.code(500).send({ error: (e as Error).message });
		}
		return { ok: true, notified: true };
	});

	app.post("/sessions/:cardId/abort", async (req, reply) => {
		const s = registry.get((req.params as any).cardId);
		if (!s) return reply.code(404).send({ error: "unknown card" });
		abortCurrentCursorTurn(s);
		registry.broadcast((req.params as any).cardId, { type: "raw", text: "⏹ stop requested (server)" });
		// Unblock any open question panel immediately (don't wait for agent_end).
		s.extensionUi?.cancelAll();
		try {
			await s.runtime.session.abort();
			registry.broadcast((req.params as any).cardId, { type: "raw", text: "■ generation stopped" });
		} catch (e) {
			console.error(`[${(req.params as any).cardId}] abort threw:`, (e as Error).message);
		}
		return { ok: true };
	});

	// Cursor owns process-level SDK resources (agent pool, bridge, scoped
	// resume state). Deleting a Cursor card must emit session_shutdown and
	// remove that ownership; the existing non-Cursor delete behavior is left
	// unchanged.
	app.delete("/sessions/:cardId", async (req, reply) => {
		const cardId = (req.params as any).cardId as string;
		const s = registry.get(cardId);
		if (!s) return { ok: true };
		if (!isCursorSession(s)) {
			return reply.code(409).send({ error: "session teardown is only enabled for Cursor cards" });
		}

		s.extensionUi?.cancelAll();
		abortCurrentCursorTurn(s);
		if (s.busy) {
			try {
				await s.runtime.session.abort();
			} catch (e) {
				console.error(`[${cardId}] Cursor teardown abort failed:`, (e as Error).message);
			}
		}
		await s.runtime.dispose();
		if (registry.get(cardId) === s) registry.delete(cardId);
		for (const client of s.clients) client.raw.end();
		return { ok: true };
	});

	// Serve web UI in production (when web-dist exists next to server)
	// Resolve web-dist relative to THIS script (not cwd — packaged apps launch from / or home).
	const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web-dist");
	if (existsSync(join(webDist, "index.html"))) {
		// Parent monorepo may hoist a newer fastify than this package's pin;
		// plugin generics then disagree across the two copies. Runtime is fine.
		await app.register(fastifyStatic as unknown as FastifyPluginAsync<{ root: string }>, {
			root: webDist,
		});
		app.setNotFoundHandler((req, reply) => {
			if (req.method === "GET") {
				return reply.type("text/html").send(readFileSync(join(webDist, "index.html")));
			}
			reply.code(404).send({ error: "not found" });
		});
	}

	// Test hook: live session bridge for extension-ui route tests.
	(
		app as FastifyInstance & { __testGetExtensionUi?: (cardId: string) => CardExtensionUiBridge | undefined }
	).__testGetExtensionUi = (cardId: string) => registry.get(cardId)?.extensionUi;

	return app;
}

// One-time migration: Melon is isolated in ~/.melon/agent. On first run, if it's
// empty but a terminal pi install (~/.pi/agent) exists, copy credentials + catalog
// so the user doesn't have to re-enter API keys. Idempotent — runs only when empty.
function seedFromPiIfEmpty(): void {
	const melonDir = getAgentDir();
	const piDir = join(homedir(), ".pi", "agent");
	if (existsSync(join(melonDir, "auth.json")) || !existsSync(join(piDir, "auth.json"))) return;
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
	} catch (e) {
		console.error("[melon] seed failed:", (e as Error)?.message ?? e);
	}
}

// pi auto-retries model errors by default (429/overloaded/etc., up to 3x).
// We want FAIL FAST: a model error ends the turn with the real message, no
// silent retry loop. Write retry.enabled=false into the agent settings.
function ensureRetryDisabled(): void {
	const file = join(getAgentDir(), "settings.json");
	try {
		const cur = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
		if (cur.retry?.enabled === false) return;
		writeFileSync(file, JSON.stringify({ ...cur, retry: { enabled: false } }, null, 2));
		console.error("[melon] retries disabled — model errors fail fast");
	} catch (e) {
		console.error("[melon] failed to disable retry:", (e as Error)?.message ?? e);
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
	const shutdown = () => {
		void app.close().finally(() => process.exit(0));
	};
	process.once("SIGINT", shutdown);
	process.once("SIGTERM", shutdown);
}
