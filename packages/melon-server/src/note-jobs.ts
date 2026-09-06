// Note generation jobs: server-side work (distill / merge) with a live event
// log. The artifact FILE is created immediately when the job starts (the name
// exists before the AI does anything); progress, streamed body deltas, and
// completion/failure are broadcast to SSE subscribers and buffered so a
// reconnecting client replays the whole story.

import { randomUUID } from "node:crypto";

export type NoteJobEvent =
	| { type: "status"; message: string }
	| { type: "delta"; text: string }
	| { type: "done"; artifact: Record<string, unknown> }
	| { type: "error"; message: string };

export interface NoteJob {
	id: string;
	events: NoteJobEvent[];
	clients: Set<(event: NoteJobEvent) => void>;
	done: boolean;
	createdAt: number;
}

const jobs = new Map<string, NoteJob>();
const MAX_JOBS = 40;

export function createNoteJob(): NoteJob {
	while (jobs.size >= MAX_JOBS) {
		const oldest = [...jobs.values()].sort((a, b) => a.createdAt - b.createdAt)[0];
		if (!oldest) break;
		jobs.delete(oldest.id);
	}
	const job: NoteJob = {
		id: `job_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
		events: [],
		clients: new Set(),
		done: false,
		createdAt: Date.now(),
	};
	jobs.set(job.id, job);
	return job;
}

export function getNoteJob(jobId: string): NoteJob | undefined {
	return jobs.get(jobId);
}

/** Emit to the buffered log and every live subscriber. */
export function emitNoteJob(job: NoteJob, event: NoteJobEvent): void {
	job.events.push(event);
	for (const send of job.clients) {
		try {
			send(event);
		} catch {
			/* dead subscriber — SSE cleanup removes it */
		}
	}
	if (event.type === "done" || event.type === "error") job.done = true;
}

/**
 * Throttled delta pump: LLM streams arrive in small pieces — coalesce to
 * ~80ms frames so the SSE channel and UI don't drown in per-token frames.
 */
export function createDeltaPump(job: NoteJob): { push: (text: string) => void; flush: () => void } {
	let buffer = "";
	let timer: ReturnType<typeof setTimeout> | null = null;
	const flush = () => {
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		if (!buffer) return;
		const text = buffer;
		buffer = "";
		emitNoteJob(job, { type: "delta", text });
	};
	return {
		push: (text) => {
			buffer += text;
			if (!timer) timer = setTimeout(flush, 80);
		},
		flush,
	};
}
