// Handoff note artifacts: <folder>/.melon/notes/handoff/<id>.md
//
// A note is one markdown file: a fixed-schema YAML frontmatter block
// (server-owned provenance/ledger) + a free-form body (the artifact itself).
// The file is the source of truth — canvas nodes only reference it.
//
// The frontmatter uses a strict YAML SUBSET (flat scalars, string lists,
// lists of flat maps) emitted and parsed by this module. Everything is
// deterministic; strings that are not obviously safe plain scalars are
// JSON-quoted (JSON string escapes are valid YAML flow scalars).

import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export type NoteKind = "handoff" | "merge";

export interface NoteSource {
	/** Display-only; may go stale. */
	cardTitle?: string;
	cardId?: string;
	canvasId?: string;
	sessionFile: string;
	sessionId: string;
	/** Distillation pin — tree lookup by id survives compaction. */
	leafEntryId?: string;
	cwd?: string;
	/** merge sources: the per-source handoff artifact this distillation came from. */
	handoffId?: string;
}

export interface NoteWire {
	cardId: string;
	canvasId?: string;
	mode: "seed" | "inject";
	revision: number;
	/** Hash of the body at delivery time — staleness is content-based. */
	bodyHash: string;
	status: "delivered" | "queued" | "failed";
	deliveredAt?: string;
	error?: string;
}

export interface NoteDoc {
	id: string;
	kind: NoteKind;
	title: string;
	revision: number;
	created: string;
	updated: string;
	/** true once the body differs from the generated revision. */
	edited: boolean;
	sources: NoteSource[];
	generatedBy: { model: string; thinkingLevel: string; promptVersion: string };
	/** Append-only trail, oldest first. */
	history: string[];
	wires: NoteWire[];
	body: string;
	/** File mtime (ms) as of the last load/save — optimistic concurrency token. */
	mtimeMs: number;
	/**
	 * Absolute file path this artifact was loaded from / should be saved to.
	 * Filenames are slugs of the title and may change on rename; the `id` is
	 * the stable identity. Not part of the serialized frontmatter.
	 */
	filePath?: string;
}

export function notesDir(cwd: string): string {
	return join(cwd, ".melon", "notes", "handoff");
}

/** User-authored markdown documents ("New document" cards), plain files. */
export function manualsDir(cwd: string): string {
	return join(cwd, ".melon", "notes", "manual");
}

/** Filesystem-safe slug for a manual filename. */
export function slugifyTitle(title: string): string {
	const slug = title
		.toLowerCase()
		.normalize("NFKD")
		.replace(/[^\w\s-]/g, "")
		.trim()
		.replace(/[\s_]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 48);
	return slug || "untitled";
}

/** Create <slug>.md in manuals/, deduping with -2, -3, … suffixes. */
export function createManual(cwd: string, title: string): { relPath: string; abs: string; title: string } {
	const dir = manualsDir(cwd);
	mkdirSync(dir, { recursive: true });
	const base = slugifyTitle(title);
	let name = `${base}.md`;
	let n = 2;
	while (existsSync(join(dir, name))) {
		name = `${base}-${n}.md`;
		n++;
	}
	const abs = join(dir, name);
	writeFileSync(abs, `# ${title}\n\n`);
	return { relPath: `.melon/notes/manual/${name}`, abs, title };
}

export interface ManualSummary {
	path: string;
	abs: string;
	title: string;
	mtimeMs: number;
}

/** List manual documents; title = first H1 heading, else filename base. */
export function listManuals(cwd: string): ManualSummary[] {
	const dir = manualsDir(cwd);
	let files: string[];
	try {
		files = readdirSync(dir);
	} catch {
		return [];
	}
	const out: ManualSummary[] = [];
	for (const f of files) {
		if (!f.endsWith(".md")) continue;
		const abs = join(dir, f);
		try {
			const st = statSync(abs);
			const content = readFileSync(abs, "utf8");
			const h1 = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
			out.push({
				path: `.melon/notes/manual/${f}`,
				abs,
				title: h1 || f.replace(/\.md$/, ""),
				mtimeMs: st.mtimeMs,
			});
		} catch {
			/* skip unreadable */
		}
	}
	out.sort((a, b) => a.title.localeCompare(b.title));
	return out;
}

export function notePath(cwd: string, id: string): string {
	return join(notesDir(cwd), `${id}.md`);
}

export function newNoteId(): string {
	return `ho_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
}

export function hashBody(body: string): string {
	return createHash("sha256").update(body).digest("hex").slice(0, 16);
}

/** A wire is stale when the artifact body has drifted from what was delivered. */
export function wireIsStale(doc: NoteDoc, wire: NoteWire): boolean {
	return wire.status === "delivered" && wire.bodyHash !== hashBody(doc.body);
}

/** Copy the current revision to history/ and prune older snapshots (last 5). */
export function snapshotRevision(cwd: string, doc: NoteDoc): void {
	const histDir = join(notesDir(cwd), "history");
	mkdirSync(histDir, { recursive: true });
	writeFileSync(join(histDir, `${doc.id}.r${doc.revision}.md`), serializeNote(doc));
	const trashDir = join(notesDir(cwd), ".trash");
	mkdirSync(trashDir, { recursive: true });
	const prefix = `${doc.id}.r`;
	const snaps = readdirSync(histDir)
		.filter((f) => f.startsWith(prefix) && f.endsWith(".md"))
		.map((f) => Number.parseInt(f.slice(prefix.length, -3), 10))
		.filter((n) => Number.isFinite(n))
		.sort((a, b) => b - a);
	for (const rev of snaps.slice(5)) {
		try {
			renameSync(join(histDir, `${doc.id}.r${rev}.md`), join(trashDir, `${doc.id}.r${rev}.md`));
		} catch {
			/* prune is best-effort */
		}
	}
}

const NOTE_ID_RE = /^ho_[a-zA-Z0-9]{4,16}$/;

export function isValidNoteId(id: string): boolean {
	return NOTE_ID_RE.test(id);
}

// ── YAML subset: scalar handling ──

const PLAIN_SCALAR_RE = /^[A-Za-z0-9][A-Za-z0-9_\-./@ ()+,]*$/;

function emitScalar(value: unknown): string {
	if (typeof value === "number" || typeof value === "boolean") return String(value);
	if (value === null || value === undefined) return '""';
	const str = String(value);
	// Anything that could parse as a bool/number, or contains YAML-significant
	// characters, goes out JSON-quoted (valid YAML double-quoted scalar).
	if (
		str.length === 0 ||
		!PLAIN_SCALAR_RE.test(str) ||
		str.includes(": ") ||
		str.includes(" #") ||
		/^(true|false|null|yes|no|on|off|~)$/i.test(str) ||
		/^-?[\d.]+$/.test(str)
	) {
		return JSON.stringify(str);
	}
	return str;
}

function parseScalar(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
		try {
			const parsed = JSON.parse(trimmed) as unknown;
			if (typeof parsed === "string") return parsed;
		} catch {
			/* fall through — treat as literal */
		}
	}
	return trimmed;
}

// ── YAML subset: serializer ──

function emitMapEntries(lines: string[], entries: Array<[string, unknown]>, indent: string): void {
	for (const [key, value] of entries) {
		if (value === undefined) continue;
		if (Array.isArray(value)) {
			if (value.length === 0) {
				lines.push(`${indent}${key}: []`);
			} else if (value.every((v) => typeof v === "string" || typeof v === "number" || typeof v === "boolean")) {
				lines.push(`${indent}${key}:`);
				for (const item of value) lines.push(`${indent}  - ${emitScalar(item)}`);
			} else {
				lines.push(`${indent}${key}:`);
				for (const item of value) {
					if (typeof item !== "object" || item === null) throw new Error("unsupported list item");
					const mapEntries = Object.entries(item as Record<string, unknown>).filter(([, v]) => v !== undefined);
					if (mapEntries.length === 0) continue;
					const [firstKey, firstValue] = mapEntries[0] as [string, unknown];
					lines.push(`${indent}  - ${firstKey}: ${emitScalar(firstValue)}`);
					for (const [k, v] of mapEntries.slice(1)) lines.push(`${indent}    ${k}: ${emitScalar(v)}`);
				}
			}
		} else if (typeof value === "object" && value !== null) {
			lines.push(`${indent}${key}:`);
			emitMapEntries(lines, Object.entries(value as Record<string, unknown>), `${indent}  `);
		} else {
			lines.push(`${indent}${key}: ${emitScalar(value)}`);
		}
	}
}

export function serializeNote(doc: NoteDoc): string {
	const lines: string[] = ["---"];
	emitMapEntries(
		lines,
		[
			["id", doc.id],
			["kind", doc.kind],
			["title", doc.title],
			["revision", doc.revision],
			["created", doc.created],
			["updated", doc.updated],
			["edited", doc.edited],
			["sources", doc.sources],
			["generatedBy", doc.generatedBy],
			["history", doc.history],
			["wires", doc.wires],
		],
		"",
	);
	lines.push("---", "", doc.body.replace(/\s+$/, ""));
	return `${lines.join("\n")}\n`;
}

// ── YAML subset: parser ──

interface Line {
	indent: number;
	text: string;
}

function parseBlock(lines: Line[], start: number, indent: number): { value: unknown; next: number } {
	if (start >= lines.length || lines[start].indent < indent) return { value: undefined, next: start };
	if (lines[start].text.startsWith("- ") || lines[start].text === "-") {
		const list: unknown[] = [];
		let i = start;
		while (
			i < lines.length &&
			lines[i].indent === indent &&
			(lines[i].text.startsWith("- ") || lines[i].text === "-")
		) {
			const itemText = lines[i].text === "-" ? "" : lines[i].text.slice(2);
			const itemIndent = indent + 2;
			if (itemText.includes(": ") || itemText.endsWith(":")) {
				// Flat map item: first key inline after "- ", siblings at itemIndent.
				const map: Record<string, unknown> = {};
				const sep = itemText.indexOf(": ");
				const keyEnd = itemText.endsWith(":") ? itemText.length : sep >= 0 ? sep : itemText.length;
				const firstKey = itemText.slice(0, keyEnd).trim();
				const firstRaw = itemText.endsWith(":") ? "" : itemText.slice(sep + 2);
				map[firstKey] = firstRaw.trim() === "" ? undefined : parseScalar(firstRaw);
				i++;
				while (i < lines.length && lines[i].indent === itemIndent && !lines[i].text.startsWith("- ")) {
					const entry = parseMapLine(lines[i].text);
					map[entry.key] = entry.value;
					i++;
				}
				list.push(map);
			} else {
				list.push(parseScalar(itemText));
				i++;
			}
		}
		return { value: list, next: i };
	}

	const map: Record<string, unknown> = {};
	let i = start;
	while (i < lines.length && lines[i].indent === indent) {
		if (lines[i].text.startsWith("- ")) break;
		const entry = parseMapLine(lines[i].text);
		i++;
		if (entry.value === undefined) {
			// Nested block (map or list) at a deeper indent, else null.
			if (i < lines.length && lines[i].indent > indent) {
				const nested = parseBlock(lines, i, lines[i].indent);
				map[entry.key] = nested.value;
				i = nested.next;
			} else {
				map[entry.key] = null;
			}
		} else {
			map[entry.key] = entry.value;
		}
	}
	return { value: map, next: i };
}

function parseMapLine(text: string): { key: string; value: string | undefined } {
	const sep = text.indexOf(": ");
	if (sep >= 0) return { key: text.slice(0, sep).trim(), value: parseScalar(text.slice(sep + 2)) };
	if (text.endsWith(":")) return { key: text.slice(0, -1).trim(), value: undefined };
	// Bare scalar line inside a map block — treat as an unlabeled value.
	return { key: parseScalar(text), value: parseScalar(text) };
}

export function parseNote(text: string): NoteDoc {
	const allLines = text.split("\n");
	if (allLines[0]?.trim() !== "---") throw new Error("missing frontmatter opening '---'");
	const closing = allLines.findIndex((line, i) => i > 0 && line.trim() === "---");
	if (closing < 0) throw new Error("missing frontmatter closing '---'");
	const bodyLines = allLines.slice(closing + 1);
	// Trim leading blank lines after the closing fence.
	while (bodyLines.length > 0 && bodyLines[0].trim() === "") bodyLines.shift();

	const lines: Line[] = [];
	for (const raw of allLines.slice(1, closing)) {
		if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
		const indent = raw.length - raw.trimStart().length;
		lines.push({ indent, text: raw.trim() });
	}
	const parsed = parseBlock(lines, 0, 0);
	if (parsed.next < lines.length) throw new Error("malformed frontmatter structure");
	const fm = parsed.value as Record<string, unknown>;
	if (!fm || typeof fm !== "object") throw new Error("frontmatter is not a mapping");

	const id = parseScalar(String(fm.id ?? ""));
	if (!isValidNoteId(id)) throw new Error(`invalid note id: ${fm.id}`);
	const kindRaw = parseScalar(String(fm.kind ?? "handoff"));
	if (kindRaw !== "handoff" && kindRaw !== "merge") throw new Error(`unsupported note kind: ${kindRaw}`);
	const rev = Number(fm.revision);
	const sources = Array.isArray(fm.sources)
		? (fm.sources as Record<string, unknown>[]).map((s) => ({
				cardTitle: str(s.cardTitle),
				cardId: str(s.cardId),
				canvasId: str(s.canvasId),
				sessionFile: String(s.sessionFile ?? ""),
				sessionId: String(s.sessionId ?? ""),
				leafEntryId: str(s.leafEntryId),
				cwd: str(s.cwd),
				handoffId: str(s.handoffId),
			}))
		: [];
	const generatedBy = (fm.generatedBy ?? {}) as Record<string, unknown>;
	const wires = Array.isArray(fm.wires)
		? (fm.wires as Record<string, unknown>[]).map((w) => ({
				cardId: String(w.cardId ?? ""),
				canvasId: str(w.canvasId),
				mode: w.mode === "inject" ? ("inject" as const) : ("seed" as const),
				revision: Number(w.revision ?? 1),
				bodyHash: String(w.bodyHash ?? ""),
				status:
					w.status === "queued" || w.status === "failed" || w.status === "delivered"
						? (w.status as NoteWire["status"])
						: ("delivered" as const),
				deliveredAt: str(w.deliveredAt),
				error: str(w.error),
			}))
		: [];

	return {
		id,
		kind: kindRaw,
		title: parseScalar(String(fm.title ?? "")),
		revision: Number.isFinite(rev) && rev > 0 ? rev : 1,
		created: parseScalar(String(fm.created ?? "")),
		updated: parseScalar(String(fm.updated ?? "")),
		edited: fm.edited === true,
		sources,
		generatedBy: {
			model: parseScalar(String(generatedBy.model ?? "")),
			thinkingLevel: parseScalar(String(generatedBy.thinkingLevel ?? "default")),
			promptVersion: parseScalar(String(generatedBy.promptVersion ?? "handoff-1")),
		},
		history: Array.isArray(fm.history) ? (fm.history as unknown[]).map((h) => parseScalar(String(h))) : [],
		wires,
		body: bodyLines.join("\n"),
		mtimeMs: 0,
	};
}

function str(value: unknown): string | undefined {
	if (value === undefined || value === null) return undefined;
	const s = parseScalar(String(value));
	return s === "" ? undefined : s;
}

// ── File I/O ──

/**
 * Find the artifact file whose frontmatter id is `id`. Filenames are slugs of
 * the title and may change on rename, so resolution is content-based.
 */
export function resolveNoteFile(cwd: string, id: string): string | null {
	const dir = notesDir(cwd);
	let files: string[];
	try {
		files = readdirSync(dir);
	} catch {
		return null;
	}
	for (const f of files) {
		if (!f.endsWith(".md")) continue;
		const abs = join(dir, f);
		try {
			if (parseNote(readFileSync(abs, "utf8")).id === id) return abs;
		} catch {
			/* skip corrupt */
		}
	}
	return null;
}

/** Find a free `<slug>.md` name in handoff/, skipping `exceptAbs`. */
export function uniqueHandoffFileName(cwd: string, title: string, exceptAbs?: string): string {
	const dir = notesDir(cwd);
	const base = slugifyTitle(title);
	let name = `${base}.md`;
	let n = 2;
	while (existsSync(join(dir, name)) && join(dir, name) !== exceptAbs) {
		name = `${base}-${n}.md`;
		n++;
	}
	return join(dir, name);
}

export function loadNote(cwd: string, id: string): NoteDoc | null {
	const path = resolveNoteFile(cwd, id);
	if (!path) return null;
	const doc = parseNote(readFileSync(path, "utf8"));
	doc.mtimeMs = statSync(path).mtimeMs;
	doc.filePath = path;
	// Legacy migration: pre-naming artifacts were saved as <id>.md — give them
	// their title's slug so the filename is meaningful. Idempotent.
	if (path.split("/").pop() === `${doc.id}.md`) {
		try {
			renameNoteFile(cwd, doc, doc.title);
			doc.mtimeMs = statSync(doc.filePath).mtimeMs;
		} catch {
			/* keep legacy name on failure */
		}
	}
	return doc;
}

/** Write the artifact file; returns the fresh mtime (concurrency token). */
export function saveNote(cwd: string, doc: NoteDoc): number {
	const path = doc.filePath ?? resolveNoteFile(cwd, doc.id) ?? notePath(cwd, doc.id);
	doc.filePath = path;
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(path, serializeNote(doc));
	return statSync(path).mtimeMs;
}

/**
 * Rename the artifact file to a slug of `newTitle` (deduped). The frontmatter
 * id never changes — only the filename. Returns the updated doc.filePath.
 */
export function renameNoteFile(cwd: string, doc: NoteDoc, newTitle: string): string {
	const current = doc.filePath ?? resolveNoteFile(cwd, doc.id) ?? notePath(cwd, doc.id);
	doc.filePath = current;
	const next = uniqueHandoffFileName(cwd, newTitle, current);
	if (next !== current) renameSync(current, next);
	doc.filePath = next;
	return next;
}

export interface NoteSummary {
	id: string;
	kind: NoteKind;
	title: string;
	revision: number;
	updated: string;
	path: string;
	mtimeMs: number;
	wiredCardIds: string[];
}

export function listNotes(cwd: string): NoteSummary[] {
	const dir = notesDir(cwd);
	let files: string[];
	try {
		files = readdirSync(dir);
	} catch {
		return [];
	}
	const out: NoteSummary[] = [];
	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		const abs = join(dir, file);
		try {
			const doc = parseNote(readFileSync(abs, "utf8"));
			if (!isValidNoteId(doc.id)) continue;
			out.push({
				id: doc.id,
				kind: doc.kind,
				title: doc.title,
				revision: doc.revision,
				updated: doc.updated,
				path: abs,
				mtimeMs: statSync(abs).mtimeMs,
				wiredCardIds: [...new Set(doc.wires.map((w) => w.cardId))],
			});
		} catch {
			/* skip corrupt */
		}
	}
	out.sort((a, b) => b.updated.localeCompare(a.updated));
	return out;
}

/** Soft delete: move to .trash/ (never a hard delete from the UI). */
export function trashNote(cwd: string, id: string): boolean {
	const path = resolveNoteFile(cwd, id);
	if (!path) return false;
	const trashDir = join(notesDir(cwd), ".trash");
	mkdirSync(trashDir, { recursive: true });
	renameSync(path, join(trashDir, path.split("/").pop() ?? `${id}.md`));
	return true;
}

/** Find a trashed artifact file whose frontmatter id is `id`. */
function resolveTrashedNoteFile(cwd: string, id: string): string | null {
	const trashDir = join(notesDir(cwd), ".trash");
	let files: string[];
	try {
		files = readdirSync(trashDir);
	} catch {
		return null;
	}
	for (const f of files) {
		if (!f.endsWith(".md")) continue;
		const abs = join(trashDir, f);
		try {
			if (parseNote(readFileSync(abs, "utf8")).id === id) return abs;
		} catch {
			/* skip corrupt */
		}
	}
	return null;
}

/** Move a trashed artifact back so it can be surfaced again. */
export function restoreNote(cwd: string, id: string): boolean {
	const trashed = resolveTrashedNoteFile(cwd, id);
	if (!trashed) return false;
	const dir = notesDir(cwd);
	mkdirSync(dir, { recursive: true });
	renameSync(trashed, join(dir, trashed.split("/").pop() ?? `${id}.md`));
	return true;
}

/** Summaries for trashed artifacts (artifact browser trash section). */
export function listTrashedNotes(cwd: string): NoteSummary[] {
	const trashDir = join(notesDir(cwd), ".trash");
	let files: string[];
	try {
		files = readdirSync(trashDir);
	} catch {
		return [];
	}
	const out: NoteSummary[] = [];
	for (const file of files) {
		if (!file.endsWith(".md")) continue;
		// Revision snapshots are named <slug>.r<N>.md — skip them.
		if (/\.r\d+\.md$/.test(file)) continue;
		try {
			const doc = parseNote(readFileSync(join(trashDir, file), "utf8"));
			out.push({
				id: doc.id,
				kind: doc.kind,
				title: doc.title,
				revision: doc.revision,
				updated: doc.updated,
				path: join(trashDir, file),
				mtimeMs: statSync(join(trashDir, file)).mtimeMs,
				wiredCardIds: [...new Set(doc.wires.map((w) => w.cardId))],
			});
		} catch {
			/* skip corrupt */
		}
	}
	out.sort((a, b) => b.updated.localeCompare(a.updated));
	return out;
}
