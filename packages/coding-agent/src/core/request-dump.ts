// Last provider request capture — the debug viewer's "what actually went to
// the LLM" payload.
//
// When the debugRequestDump setting is on, the host's streamFn onPayload hook
// records the final provider payload (assembled message array, tool schemas,
// sampling params) right before it is sent. The latest capture is kept in
// memory per session id and mirrored to <agentDir>/logs/last-request-<sessionId>.json
// so both the in-process viewer endpoint and post-hoc debugging can read it.
// Fail-open: capture must never affect the request.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";

export interface CapturedRequest {
	sessionId: string | undefined;
	model: string;
	capturedAt: string;
	/** The final provider payload: messages, tools, and all sampling params. */
	payload: unknown;
}

const captures = new Map<string, CapturedRequest>();

/** Record the latest provider request for a session (debug viewer). */
export function captureRequest(entry: CapturedRequest): void {
	try {
		if (entry.sessionId) {
			captures.set(entry.sessionId, entry);
			const dir = join(getAgentDir(), "logs");
			mkdirSync(dir, { recursive: true });
			const safe = entry.sessionId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
			writeFileSync(join(dir, `last-request-${safe}.json`), `${JSON.stringify(entry, null, 2)}\n`);
		}
	} catch {
		/* ignore */
	}
}

/** Latest captured provider request for a session, if any. */
export function getCapturedRequest(sessionId: string): CapturedRequest | undefined {
	return captures.get(sessionId);
}
