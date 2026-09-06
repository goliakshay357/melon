import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	hashBody,
	isValidNoteId,
	listNotes,
	listTrashedNotes,
	loadNote,
	type NoteDoc,
	newNoteId,
	notePath,
	notesDir,
	parseNote,
	renameNoteFile,
	restoreNote,
	saveNote,
	serializeNote,
	snapshotRevision,
	trashNote,
	uniqueHandoffFileName,
	wireIsStale,
} from "../src/notes.ts";

function makeDoc(overrides: Partial<NoteDoc> = {}): NoteDoc {
	const now = "2026-09-06T14:22:10.000Z";
	return {
		id: newNoteId(),
		kind: "handoff",
		title: "flaky compaction test",
		revision: 1,
		created: now,
		updated: now,
		edited: false,
		sources: [
			{
				cardTitle: "flaky compaction test",
				cardId: "card_abc12345",
				canvasId: "cv_xyz",
				sessionFile: "/tmp/pi/sessions/2026-09-05T11-04-12_0198ab.jsonl",
				sessionId: "0198abcd-0000-7000-8000-000000000000",
				leafEntryId: "e_91f2",
				cwd: "/Users/akshay/workspace/pi",
			},
		],
		generatedBy: { model: "anthropic/claude-sonnet-4", thinkingLevel: "default", promptVersion: "handoff-1" },
		history: ["r1 generated from 1 source (2026-09-06T14:22:10.000Z)"],
		wires: [],
		body: "## Goal\nFix the flake.\n\n## Handoff notes (mine)\n",
		mtimeMs: 0,
		...overrides,
	};
}

describe("note frontmatter", () => {
	it("round-trips a full document", () => {
		const doc = makeDoc({
			wires: [
				{
					cardId: "card_child999",
					canvasId: "cv_xyz",
					mode: "seed",
					revision: 1,
					bodyHash: "abcd1234efgh5678",
					status: "delivered",
					deliveredAt: "2026-09-06T15:00:00.000Z",
				},
			],
			history: ["r1 generated from 1 source (t)", "r1 edited by user (t2)"],
		});
		const parsed = parseNote(serializeNote(doc));
		expect(parsed.id).toBe(doc.id);
		expect(parsed.kind).toBe("handoff");
		expect(parsed.title).toBe(doc.title);
		expect(parsed.revision).toBe(1);
		expect(parsed.created).toBe(doc.created);
		expect(parsed.updated).toBe(doc.updated);
		expect(parsed.edited).toBe(false);
		expect(parsed.sources).toEqual(doc.sources);
		expect(parsed.generatedBy).toEqual(doc.generatedBy);
		expect(parsed.history).toEqual(doc.history);
		expect(parsed.wires).toEqual(doc.wires);
		expect(parsed.body).toBe(doc.body);
	});

	it("quotes titles with special YAML characters", () => {
		const doc = makeDoc({ title: 'ho: "quoted" #tag\nsecond line — ünïcode' });
		const text = serializeNote(doc);
		const parsed = parseNote(text);
		expect(parsed.title).toBe(doc.title);
		// The raw frontmatter must carry the quoted form.
		expect(text).toMatch(/title: "/);
	});

	it("preserves titles that look like numbers or booleans", () => {
		for (const title of ["42", "true", "no", "2026-09-06"]) {
			const parsed = parseNote(serializeNote(makeDoc({ title })));
			expect(parsed.title).toBe(title);
		}
	});

	it("round-trips empty lists and undefined optional fields", () => {
		const doc = makeDoc({
			sources: [{ sessionFile: "/s.jsonl", sessionId: "s1" }],
			history: [],
			wires: [],
		});
		const parsed = parseNote(serializeNote(doc));
		expect(parsed.sources).toEqual([{ sessionFile: "/s.jsonl", sessionId: "s1" }]);
		expect(parsed.history).toEqual([]);
		expect(parsed.wires).toEqual([]);
	});

	it("round-trips a merge note with handoffId provenance", () => {
		const doc = makeDoc({
			kind: "merge",
			title: 'merge: "a" + "b"',
			sources: [
				{ sessionFile: "/s1.jsonl", sessionId: "s1", handoffId: "ho_11111111", cardTitle: "a" },
				{ sessionFile: "/s2.jsonl", sessionId: "s2", handoffId: "ho_22222222", cardTitle: "b" },
			],
		});
		const parsed = parseNote(serializeNote(doc));
		expect(parsed.kind).toBe("merge");
		expect(parsed.sources).toEqual(doc.sources);
	});

	it("rejects malformed frontmatter", () => {
		expect(() => parseNote("no frontmatter here")).toThrow();
		expect(() => parseNote("---\nid: not-an-id\nkind: handoff\n---\nbody")).toThrow(/invalid note id/);
		expect(() => parseNote("---\nid: ho_abcdef12\nkind: task\n---\nbody")).toThrow(/unsupported note kind/);
	});

	it("keeps the body verbatim including blank lines (file ends with one newline)", () => {
		const body = "## Goal\n\n- a\n- b\n\n## Handoff notes (mine)\nsome note\n";
		const parsed = parseNote(serializeNote(makeDoc({ body })));
		// The serializer strips trailing whitespace and the file ends with one
		// newline — the parser reports it back as the body's trailing newline.
		expect(parsed.body).toBe("## Goal\n\n- a\n- b\n\n## Handoff notes (mine)\nsome note\n");
	});
});

describe("note store", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function tempFolder(): string {
		const dir = mkdtempSync(join(tmpdir(), "melon-notes-"));
		dirs.push(dir);
		return dir;
	}

	it("saves, loads, and reports mtime", () => {
		const cwd = tempFolder();
		const doc = makeDoc();
		const mtime = saveNote(cwd, doc);
		expect(mtime).toBeGreaterThan(0);
		const loaded = loadNote(cwd, doc.id);
		expect(loaded?.title).toBe(doc.title);
		expect(loaded?.body).toBe(doc.body);
		expect(loaded?.mtimeMs).toBe(mtime);
		expect(existsSync(notePath(cwd, doc.id))).toBe(true);
	});

	it("lists notes with wire targets", () => {
		const cwd = tempFolder();
		saveNote(cwd, makeDoc({ title: "b note" }));
		saveNote(
			cwd,
			makeDoc({
				title: "a note",
				wires: [{ cardId: "card_target1", mode: "seed", revision: 1, bodyHash: "h", status: "delivered" }],
			}),
		);
		const list = listNotes(cwd);
		expect(list).toHaveLength(2);
		const withWire = list.find((n) => n.wiredCardIds.length > 0);
		expect(withWire?.wiredCardIds).toEqual(["card_target1"]);
		// paths are real files on disk
		for (const n of list) expect(existsSync(n.path)).toBe(true);
	});

	it("soft-deletes to .trash and then reports not found", () => {
		const cwd = tempFolder();
		const doc = makeDoc();
		saveNote(cwd, doc);
		expect(trashNote(cwd, doc.id)).toBe(true);
		expect(loadNote(cwd, doc.id)).toBeNull();
		expect(existsSync(join(notesDir(cwd), ".trash", `${doc.id}.md`))).toBe(true);
		expect(trashNote(cwd, doc.id)).toBe(false);
	});

	it("serializes to a file that contains the exact body", () => {
		const cwd = tempFolder();
		const doc = makeDoc();
		saveNote(cwd, doc);
		const raw = readFileSync(notePath(cwd, doc.id), "utf8");
		expect(raw.startsWith("---\n")).toBe(true);
		expect(raw).toContain("\n---\n\n");
		expect(raw).toContain("## Goal");
	});
});

describe("revisions and staleness", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function tempFolder(): string {
		const dir = mkdtempSync(join(tmpdir(), "melon-notes-"));
		dirs.push(dir);
		return dir;
	}

	it("wireIsStale tracks content drift, not delivery mode", () => {
		const doc = makeDoc();
		const wire = {
			cardId: "card_x",
			mode: "inject" as const,
			revision: 1,
			bodyHash: hashBody(doc.body),
			status: "delivered" as const,
		};
		expect(wireIsStale(doc, wire)).toBe(false);
		expect(wireIsStale(doc, { ...wire, bodyHash: "different" })).toBe(true);
		expect(wireIsStale(doc, { ...wire, bodyHash: "different", status: "queued" as const })).toBe(false);
	});

	it("snapshotRevision writes history files and prunes to the last 5", () => {
		const cwd = tempFolder();
		const doc = makeDoc();
		saveNote(cwd, doc);
		for (let i = 0; i < 8; i++) {
			snapshotRevision(cwd, doc);
			doc.revision += 1;
			doc.body = `${doc.body}\nrev ${doc.revision}`;
			saveNote(cwd, doc);
		}
		const histDir = join(notesDir(cwd), "history");
		const snaps = readdirSync(histDir).filter((f) => f.startsWith(doc.id));
		expect(snaps).toHaveLength(5);
		expect(loadNote(cwd, doc.id)?.revision).toBe(9);
	});

	it("restore moves a trashed note back and the trash list reports it", () => {
		const cwd = tempFolder();
		const doc = makeDoc();
		saveNote(cwd, doc);
		trashNote(cwd, doc.id);
		expect(listTrashedNotes(cwd).map((n) => n.id)).toContain(doc.id);
		expect(restoreNote(cwd, doc.id)).toBe(true);
		expect(listTrashedNotes(cwd)).toHaveLength(0);
		expect(loadNote(cwd, doc.id)?.title).toBe(doc.title);
		expect(restoreNote(cwd, doc.id)).toBe(false);
	});
});

describe("named files and rename", () => {
	const dirs: string[] = [];
	afterEach(() => {
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	function tempFolder(): string {
		const dir = mkdtempSync(join(tmpdir(), "melon-notes-"));
		dirs.push(dir);
		return dir;
	}

	it("creation targets a slug filename; the id stays the identity", () => {
		const cwd = tempFolder();
		const doc = makeDoc({ title: "auth-flow exploration!" });
		doc.filePath = uniqueHandoffFileName(cwd, doc.title);
		saveNote(cwd, doc);
		// frontmatter id ≠ filename
		expect(doc.filePath.endsWith("auth-flow-exploration.md")).toBe(true);
		const loaded = loadNote(cwd, doc.id);
		expect(loaded?.id).toBe(doc.id);
		expect(loaded?.title).toBe(doc.title);
	});

	it("rename follows the title, keeps the id resolvable, and dedupes", () => {
		const cwd = tempFolder();
		const doc = makeDoc({ title: "first name" });
		doc.filePath = uniqueHandoffFileName(cwd, doc.title);
		saveNote(cwd, doc);
		const other = makeDoc({ title: "renamed name" });
		other.filePath = uniqueHandoffFileName(cwd, other.title);
		saveNote(cwd, other);

		doc.title = "renamed name";
		const newPath = renameNoteFile(cwd, doc, doc.title);
		saveNote(cwd, doc); // the PUT route persists the new title after renaming
		// the other artifact already holds renamed-name.md → deduped suffix
		expect(newPath.endsWith("renamed-name-2.md")).toBe(true);
		expect(loadNote(cwd, doc.id)?.title).toBe("renamed name");
		expect(listNotes(cwd)).toHaveLength(2);
	});

	it("trash/restore works with slug filenames", () => {
		const cwd = tempFolder();
		const doc = makeDoc({ title: "trashed artifact" });
		doc.filePath = uniqueHandoffFileName(cwd, doc.title);
		saveNote(cwd, doc);
		expect(trashNote(cwd, doc.id)).toBe(true);
		expect(loadNote(cwd, doc.id)).toBeNull();
		expect(listTrashedNotes(cwd).map((n) => n.id)).toContain(doc.id);
		expect(restoreNote(cwd, doc.id)).toBe(true);
		expect(loadNote(cwd, doc.id)?.id).toBe(doc.id);
	});
});

describe("wire helpers", () => {
	it("produces stable body hashes and valid ids", () => {
		expect(hashBody("abc")).toBe(hashBody("abc"));
		expect(hashBody("abc")).not.toBe(hashBody("abd"));
		expect(hashBody("abc")).toMatch(/^[0-9a-f]{16}$/);
		expect(isValidNoteId(newNoteId())).toBe(true);
		expect(isValidNoteId("nope")).toBe(false);
	});
});
