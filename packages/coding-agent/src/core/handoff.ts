/**
 * Handoff artifact distillation — shared between the TUI /handoff example
 * extension and the melon canvas note system.
 *
 * A handoff artifact is a standalone markdown document distilled from a
 * session branch so a future session can continue without the transcript.
 * The section contract is fixed so generators, UI, and users agree on shape.
 */
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { serializeConversation } from "./compaction/index.ts";
import { convertToLlm } from "./messages.ts";
import type { SessionEntry } from "./session-manager.ts";

export const HANDOFF_ARTIFACT_SYSTEM_PROMPT = `You are a knowledge-distillation assistant. You receive the serialized transcript of one work session and produce a HANDOFF ARTIFACT: a standalone markdown document that lets a future session continue the work without re-reading the transcript.

Write for the next context window, not as a history. Drop narrative; keep what changes what the reader does next.

Output EXACTLY these markdown sections, in this order, with these headers verbatim:

## Goal
## Findings
## Decisions
## Gotchas
## Open questions
## Evidence (do not re-derive)
## Handoff notes (mine)

Rules:
- Goal: the actual objective of the session, one or two sentences.
- Findings: what was learned or established — facts, root causes, measurements.
- Decisions: choices made and why; one line each where possible.
- Gotchas: traps, failed approaches, things that look right but are wrong.
- Open questions: unresolved threads worth pursuing next.
- Evidence (do not re-derive): exact commands with outputs, repro steps, measurements — anything expensive or impossible to re-derive. Keep commands copy-pasteable.
- Handoff notes (mine): emit the header followed by an empty line; the user fills this section in later.
- Be concise; prefer bullets. Reference file paths (with line numbers where useful).
- Budget: aim for under ~2000 tokens total. When truncating, drop historical narrative first; keep decisions, open questions, and evidence last.
- Do not add other sections, preambles, or closing remarks. Output the document only.`;

export const MERGE_ARTIFACT_SYSTEM_PROMPT = `You are a synthesis assistant. You receive several distilled HANDOFF ARTIFACTS from independent work sessions. Produce ONE merged handoff artifact so a future session can continue from all of them without reading the originals.

Output EXACTLY these markdown sections, headers verbatim, in this order — one "What ... established" section PER source, in the order the sources are given:

## Shared goal
## What "<source A title>" established
## What "<source B title>" established
## Decisions
## Conflicts to resolve
## Open questions
## Evidence (do not re-derive)
## Next steps
## Handoff notes (mine)

Rules:
- Shared goal: the common objective across sources. If there is genuinely none, say exactly that and name each source's own goal — never invent a common goal.
- Per-source sections: compress each source's findings, decisions, and gotchas; do not drop un-reproducible evidence.
- Decisions: merged and deduplicated; attribute to a source where it matters.
- Conflicts to resolve: when sources disagree, QUOTE both sides, state where each came from, take an explicitly labeled default stance ("Default stance taken below; flip it here if you disagree"), and never resolve silently. Omit this section only when there are truly no contradictions.
- Evidence (do not re-derive): exact commands with outputs, repro steps, measurements — copy-pasteable.
- Budget: roughly 1500 tokens per source, 4000 total. Truncate historical narrative first; keep conflicts, decisions, and evidence last.
- Do not add other sections, preambles, or closing remarks. Output the document only.`;

export const REFINE_ARTIFACT_SYSTEM_PROMPT = `You are an editor for a handoff artifact: a standalone markdown document with FIXED sections that lets a future session continue work without the original transcript.

Apply the user's instruction to the CURRENT artifact.

Rules:
- Keep the fixed section headers and their order (add nothing, remove nothing structural).
- Change only what the instruction requires; "only add, don't rewrite" means pure additions.
- Never invent facts that are not supported by the current artifact or the grounding material.
- Stay concise; prefer bullets.
- Output the full updated artifact only — no preamble, no diff, no commentary.`;

function entryToMessage(entry: SessionEntry): AgentMessage | undefined {
	if (entry.type === "message") {
		return entry.message;
	}
	if (entry.type === "compaction") {
		return {
			role: "compactionSummary",
			summary: entry.summary,
			tokensBefore: entry.tokensBefore,
			timestamp: new Date(entry.timestamp).getTime(),
		};
	}
	return undefined;
}

/**
 * Compaction-aware message extraction from a branch path (root → leaf):
 * the latest compaction entry replaces everything before its firstKeptEntryId.
 */
export function branchToHandoffMessages(branch: SessionEntry[]): AgentMessage[] {
	let compactionIndex = -1;
	for (let i = branch.length - 1; i >= 0; i--) {
		if (branch[i].type === "compaction") {
			compactionIndex = i;
			break;
		}
	}
	if (compactionIndex < 0) {
		return branch.map(entryToMessage).filter((message) => message !== undefined);
	}

	const compaction = branch[compactionIndex];
	const firstKeptIndex =
		compaction.type === "compaction" ? branch.findIndex((entry) => entry.id === compaction.firstKeptEntryId) : -1;
	const compactedBranch = [
		compaction,
		...(firstKeptIndex >= 0 ? branch.slice(firstKeptIndex, compactionIndex) : []),
		...branch.slice(compactionIndex + 1),
	];
	return compactedBranch.map(entryToMessage).filter((message) => message !== undefined);
}

/** Serialize a session branch (root → leaf path) into transcript text for distillation. */
export function serializeBranchForHandoff(branch: SessionEntry[]): string {
	const messages = branchToHandoffMessages(branch);
	if (messages.length === 0) return "";
	return serializeConversation(convertToLlm(messages));
}
