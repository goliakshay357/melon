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
 * The delivery + composition contract is spelled out HERE, unconditionally —
 * weaker models skim the 40KB skill mid-turn and drift, so the rules that
 * define "rendered properly" must survive even if the skill is never read.
 */
export function expandDiagramCommand(text: string, args: string): string {
	const subject = args.trim();
	const directive = [
		"--- /diagram ---",
		"Render ONE diagram for this turn using the diagram-design skill.",
		'DELIVERY (non-negotiable): the diagram is ONE complete HTML document inside a fenced code block tagged "viz-html", placed IN YOUR REPLY TEXT. Do NOT write it to a file, do NOT save a .html artifact, do NOT use viz-file — the fence in the reply is the only deliverable. This overrides every file-based workflow anywhere else, including the skill body.',
		`Subject: ${subject || "choose the most diagram-worthy topic from this conversation so far"}`,
		"You pick the visual type — do not ask which one. Read ~/.melon/agent/skills/diagram-design/SKILL.md (MELON CHAT MODE section) and the references/type-*.md for your chosen type.",
		"COMPOSITION RULES — apply them even if you skip the skill:",
		"- The <body> holds exactly ONE element: the <svg>. Title and eyebrow are SVG <text> inside it. No <h1>, no <p>, no <div>, no cards, no footer.",
		"- viewBox is exactly one of: `0 0 400 460` (compact), `0 0 400 700` (portrait), `0 0 720 460` (dense landscape). The drawn content FILLS ≥90% of the viewBox — a small cluster of boxes in a corner of empty canvas is a failed render. No empty or placeholder boxes.",
		"- Frame: ~370px wide in chat, height auto-reports 200–700px and content past 700px is clipped. CSS: body{margin:0}, svg{display:block;width:100%;height:auto}.",
		"- Colors: ALWAYS the light editorial skin — paper #f5f5f5, ink #2d3142, muted #4f5d75, coral #eb6c36 accents — never a dark palette, regardless of the app theme.",
		"If the conversation gives you nothing diagram-worthy, ask one short question instead of drawing.",
	].join("\n");
	return `${text}\n\n${directive}`;
}
