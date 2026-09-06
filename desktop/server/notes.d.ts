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
    generatedBy: {
        model: string;
        thinkingLevel: string;
        promptVersion: string;
    };
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
export declare function notesDir(cwd: string): string;
/** User-authored markdown documents ("New document" cards), plain files. */
export declare function manualsDir(cwd: string): string;
/** Filesystem-safe slug for a manual filename. */
export declare function slugifyTitle(title: string): string;
/** Create <slug>.md in manuals/, deduping with -2, -3, … suffixes. */
export declare function createManual(cwd: string, title: string): {
    relPath: string;
    abs: string;
    title: string;
};
export interface ManualSummary {
    path: string;
    abs: string;
    title: string;
    mtimeMs: number;
}
/** List manual documents; title = first H1 heading, else filename base. */
export declare function listManuals(cwd: string): ManualSummary[];
export declare function notePath(cwd: string, id: string): string;
export declare function newNoteId(): string;
export declare function hashBody(body: string): string;
/** A wire is stale when the artifact body has drifted from what was delivered. */
export declare function wireIsStale(doc: NoteDoc, wire: NoteWire): boolean;
/** Copy the current revision to history/ and prune older snapshots (last 5). */
export declare function snapshotRevision(cwd: string, doc: NoteDoc): void;
export declare function isValidNoteId(id: string): boolean;
export declare function serializeNote(doc: NoteDoc): string;
export declare function parseNote(text: string): NoteDoc;
/**
 * Find the artifact file whose frontmatter id is `id`. Filenames are slugs of
 * the title and may change on rename, so resolution is content-based.
 */
export declare function resolveNoteFile(cwd: string, id: string): string | null;
/** Find a free `<slug>.md` name in handoff/, skipping `exceptAbs`. */
export declare function uniqueHandoffFileName(cwd: string, title: string, exceptAbs?: string): string;
export declare function loadNote(cwd: string, id: string): NoteDoc | null;
/** Write the artifact file; returns the fresh mtime (concurrency token). */
export declare function saveNote(cwd: string, doc: NoteDoc): number;
/**
 * Rename the artifact file to a slug of `newTitle` (deduped). The frontmatter
 * id never changes — only the filename. Returns the updated doc.filePath.
 */
export declare function renameNoteFile(cwd: string, doc: NoteDoc, newTitle: string): string;
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
export declare function listNotes(cwd: string): NoteSummary[];
/** Soft delete: move to .trash/ (never a hard delete from the UI). */
export declare function trashNote(cwd: string, id: string): boolean;
/** Move a trashed artifact back so it can be surfaced again. */
export declare function restoreNote(cwd: string, id: string): boolean;
/** Summaries for trashed artifacts (artifact browser trash section). */
export declare function listTrashedNotes(cwd: string): NoteSummary[];
//# sourceMappingURL=notes.d.ts.map