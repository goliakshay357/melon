// Clickable past-session references in chat messages.
//
// session_search output (and the detective's answers) cite sessions by their
// absolute .jsonl path under sessions/<project-slug>/. Extracting those paths
// lets the chat render them as chips: click → that session opens in a new box
// beside the citing card (resumeSession with parentId).

const SESSION_FILE_RE = /\/sessions\/[^\s"'()[\]{}]+\.jsonl/g;

/** Unique session .jsonl paths referenced in a message. */
export function extractSessionPaths(text: string): string[] {
	if (!text) return [];
	return [...new Set(text.match(SESSION_FILE_RE) ?? [])];
}

/**
 * Human label for a session chip. Session filenames start with an ISO-ish
 * timestamp: 2026-09-10T14-42-59-362Z_<uuid>.jsonl → "Sep 10, 14:42".
 */
export function sessionChipLabel(path: string): string {
	const m = path.match(/(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})/);
	if (!m) return "Past session";
	const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
	const month = months[Number(m[2]) - 1] ?? m[2];
	return `Past session · ${month} ${m[3]}, ${m[4]}:${m[5]}`;
}
