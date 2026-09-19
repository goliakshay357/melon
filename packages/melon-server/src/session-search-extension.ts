// Melon session_search / session_read tools — memory over past conversations.
//
// Lets any card's agent find which past session discussed a topic and pull
// readable excerpts from it. This is the capability the "session detective"
// box is built on, but any agent can call the tools directly.

import { Type } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readSessionExcerpt, searchSessions } from "./session-search.ts";

const SearchParamsSchema = Type.Object({
	query: Type.String({ description: "Keywords to search for across past session transcripts" }),
	project: Type.Optional(Type.String({ description: "Restrict the search to one project slug (folder name)" })),
	limit: Type.Optional(Type.Number({ description: "Max sessions to return (default 8, max 25)" })),
});

const ReadParamsSchema = Type.Object({
	sessionFile: Type.String({ description: "Absolute path to the session .jsonl (from session_search)" }),
	query: Type.Optional(Type.String({ description: "Focus keywords — excerpts are pulled around matches" })),
});

function currentSessionFile(ctx: ExtensionContext): string | undefined {
	try {
		return ctx.sessionManager.getSessionFile() ?? undefined;
	} catch {
		return undefined;
	}
}

function formatSearchResults(results: ReturnType<typeof searchSessions>): Array<{ type: "text"; text: string }> {
	if (results.length === 0) {
		return [
			{
				type: "text",
				text: "No past sessions matched. Try fewer or different keywords, or search a different project.",
			},
		];
	}
	const lines = [`${results.length} session(s) matched, best first:`];
	results.forEach((hit, index) => {
		const date = new Date(hit.modifiedAt).toISOString().slice(0, 16).replace("T", " ");
		lines.push(
			`\n${index + 1}. ${hit.title}\n   project: ${hit.project} · last modified: ${date}\n   file: ${hit.sessionFile}`,
		);
		for (const match of hit.matches) {
			lines.push(`   [${match.role}] ${match.snippet}`);
		}
	});
	lines.push("\nUse session_read with a file path to pull the relevant excerpt before citing it.");
	return [{ type: "text", text: lines.join("\n") }];
}

export default function sessionSearchExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "session_search",
		label: "Search past sessions",
		description:
			"Search past Melon/pi session transcripts (all projects, this machine) for a topic. Returns the matching sessions with titles, dates, and snippets. Use when the user references something discussed before.",
		promptSnippet: "Find which past session discussed a topic",
		promptGuidelines: [
			"When the user references a previous conversation ('that thing I told you', 'what did I decide about X'), call session_search with distinctive keywords.",
			"Cite the session title and date when using information from session_search or session_read.",
		],
		parameters: SearchParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const query = typeof params.query === "string" ? params.query : "";
			if (!query.trim()) throw new Error("query is required.");
			const project = typeof params.project === "string" ? params.project : undefined;
			const limit = typeof params.limit === "number" ? params.limit : undefined;
			const results = searchSessions({
				agentDir: getAgentDir(),
				query,
				project,
				limit,
				excludeSessionFile: currentSessionFile(ctx),
			});
			return { content: formatSearchResults(results), details: { results } };
		},
	});

	pi.registerTool({
		name: "session_read",
		label: "Read session excerpt",
		description:
			"Read a readable excerpt from one past session .jsonl (path from session_search). With a query, excerpts are pulled around the matching messages.",
		promptSnippet: "Pull the relevant excerpt from a past session",
		parameters: ReadParamsSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const sessionFile = typeof params.sessionFile === "string" ? params.sessionFile : "";
			if (!sessionFile.trim()) throw new Error("sessionFile is required.");
			const query = typeof params.query === "string" ? params.query : undefined;
			const excerpt = readSessionExcerpt({ sessionFile, query });
			if (!excerpt) {
				return {
					content: [{ type: "text", text: `Could not read session file: ${sessionFile}` }],
					details: { sessionFile },
				};
			}
			return {
				content: [
					{
						type: "text",
						text: `Session "${excerpt.title}" (project: ${excerpt.project})\n\n${excerpt.excerpt}`,
					},
				],
				details: { title: excerpt.title, project: excerpt.project },
			};
		},
	});
}
