/**
 * Input parser — the FIRST step of every send. One pass over the composer
 * text decides: is this a command (/handoff …) or a normal message, and which
 * @file mentions need to ride along as real content.
 *
 * Command: only when the text STARTS with "/name". Unknown commands are NOT
 * errors — they fall through as normal text (least surprise).
 * Mentions: every @path in the text, deduplicated, trailing punctuation
 * stripped (same tokenizer the highlighter uses).
 */

import { mentionPaths } from "@/lib/mentions";

// Build marker — the first [melon-@] line in the console proves this bundle is live.
console.log(`[melon-@] build loaded ${__MELON_BUILD__}`);

export interface ParsedInput {
	/** Non-null only when the text begins with a /command. */
	command: { name: string; args: string } | null;
	/** @file paths mentioned anywhere in the text, deduped in order. */
	mentions: string[];
}

export function parseInput(text: string): ParsedInput {
	const trimmed = text.trim();
	console.log(`[melon-@] parseInput: text="${trimmed.slice(0, 60)}"`);
	let command: ParsedInput["command"] = null;
	if (trimmed.startsWith("/")) {
		const match = trimmed.match(/^\/([a-z][a-z-]*)(?:\s+([\s\S]*))?$/i);
		if (match) command = { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
	}
	const parsed = { command, mentions: [...new Set(mentionPaths(text))] };
	console.log(
		`[melon-@] parseInput -> command=${parsed.command ? `${parsed.command.name} "${parsed.command.args}"` : "none"} mentions=[${parsed.mentions.join(", ")}]`,
	);
	return parsed;
}

const MAX_FILE_CHARS = 24_000;
const MAX_TOTAL_CHARS = 64_000;

async function readMentionFile(cwds: Array<string | null>, path: string): Promise<string | null> {
	for (const cwd of cwds) {
		if (!cwd) continue;
		try {
			const res = await fetch(`/file?cwd=${encodeURIComponent(cwd)}&path=${encodeURIComponent(path)}`);
			if (!res.ok) continue;
			const d = (await res.json()) as { content: string };
			return d.content;
		} catch {
			/* try next root */
		}
	}
	return null;
}

/**
 * Manual-typed mentions are often partial ("@1-pag" for
 * .melon/notes/handoff/1-pager.md). Resolution order: exact → +".md" → the
 * server's fuzzy search. Returns the RESOLVED path so the user can see what
 * was actually attached.
 */
async function resolveMention(
	path: string,
	cwds: Array<string | null>,
): Promise<{ path: string; content: string } | null> {
	for (const candidate of [path, `${path}.md`]) {
		const content = await readMentionFile(cwds, candidate);
		if (content !== null) return { path: candidate, content };
	}
	for (const cwd of cwds) {
		if (!cwd) continue;
		try {
			const res = await fetch(`/files?cwd=${encodeURIComponent(cwd)}&q=${encodeURIComponent(path)}&limit=3`);
			if (!res.ok) continue;
			const d = (await res.json()) as { files: Array<{ path: string }> };
			for (const hit of d.files) {
				const content = await readMentionFile(cwds, hit.path);
				if (content !== null) return { path: hit.path, content };
			}
		} catch {
			/* next root */
		}
	}
	return null;
}

/**
 * Append @mention file contents after the user's text so the model receives
 * the real material (same behavior as pi's CLI @file arguments). Files that
 * are missing or oversized are skipped — the red highlight already told the
 * user they don't resolve. The DISPLAYED message stays the user's own text.
 */
export async function expandMentions(text: string, mentions: string[], cwds: Array<string | null>): Promise<string> {
	if (mentions.length === 0) return text;
	const parts: string[] = [];
	let total = 0;
	for (const path of mentions) {
		if (total >= MAX_TOTAL_CHARS) {
			parts.push(`@${path} — not attached (attachment budget reached)`);
			continue;
		}
		const resolved = await resolveMention(path, cwds);
		if (resolved === null) {
			console.log(`[melon-@] attach FAILED: "${path}" resolved to nothing (skipped)`);
			continue;
		}
		console.log(`[melon-@] attach "${path}" -> "${resolved.path}" (${resolved.content.length} chars)`);
		const clipped =
			resolved.content.length > MAX_FILE_CHARS
				? `${resolved.content.slice(0, MAX_FILE_CHARS)}\n… (truncated at ${MAX_FILE_CHARS} chars — ask me to read the file for more)`
				: resolved.content;
		total += clipped.length;
		parts.push(`--- file: ${resolved.path} ---\n${clipped}`);
	}
	if (parts.length === 0) return text;
	return `${text}\n\n${parts.join("\n\n")}`;
}

/**
 * /diagram [subject] — the transcript keeps the user's own "/diagram …" text;
 * this directive rides along for the MODEL only (same pattern as @mentions).
 * Type selection is the agent's job: it loads the diagram-design skill and
 * picks the right visual type from the conversation.
 */
export function expandDiagramCommand(text: string, args: string): string {
	const subject = args.trim();
	const directive = [
		"--- /diagram ---",
		"Use the diagram-design skill for this turn: read its SKILL.md, follow the MELON CHAT MODE section, load the type reference you choose, and emit ONE diagram in a fenced block tagged ```viz-html```.",
		`Subject: ${subject || "choose the most diagram-worthy topic from this conversation so far"}`,
		"You pick the visual type — do not ask which one. If the conversation gives you nothing diagram-worthy, ask one short question instead of drawing.",
	].join("\n");
	return `${text}\n\n${directive}`;
}
