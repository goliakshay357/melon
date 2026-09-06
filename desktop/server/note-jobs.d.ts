export type NoteJobEvent = {
    type: "status";
    message: string;
} | {
    type: "delta";
    text: string;
} | {
    type: "done";
    artifact: Record<string, unknown>;
} | {
    type: "error";
    message: string;
};
export interface NoteJob {
    id: string;
    events: NoteJobEvent[];
    clients: Set<(event: NoteJobEvent) => void>;
    done: boolean;
    createdAt: number;
}
export declare function createNoteJob(): NoteJob;
export declare function getNoteJob(jobId: string): NoteJob | undefined;
/** Emit to the buffered log and every live subscriber. */
export declare function emitNoteJob(job: NoteJob, event: NoteJobEvent): void;
/**
 * Throttled delta pump: LLM streams arrive in small pieces — coalesce to
 * ~80ms frames so the SSE channel and UI don't drown in per-token frames.
 */
export declare function createDeltaPump(job: NoteJob): {
    push: (text: string) => void;
    flush: () => void;
};
//# sourceMappingURL=note-jobs.d.ts.map