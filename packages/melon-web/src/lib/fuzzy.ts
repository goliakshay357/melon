/**
 * Fuzzy matching — same rules as melon-server / pi-tui.
 * All query chars must appear in order (not necessarily consecutive).
 * Lower score = better.
 */

export function fuzzyMatch(query: string, text: string): { matches: boolean; score: number } {
	const queryLower = query.toLowerCase();
	const textLower = text.toLowerCase();

	if (queryLower.length === 0) return { matches: true, score: 0 };
	if (queryLower.length > textLower.length) return { matches: false, score: 0 };

	let queryIndex = 0;
	let score = 0;
	let lastMatchIndex = -1;
	let consecutiveMatches = 0;

	for (let i = 0; i < textLower.length && queryIndex < queryLower.length; i++) {
		if (textLower[i] === queryLower[queryIndex]) {
			const isWordBoundary = i === 0 || /[\s\-_./:]/.test(textLower[i - 1]!);
			if (lastMatchIndex === i - 1) {
				consecutiveMatches++;
				score -= consecutiveMatches * 5;
			} else {
				consecutiveMatches = 0;
				if (lastMatchIndex >= 0) score += (i - lastMatchIndex - 1) * 2;
			}
			if (isWordBoundary) score -= 10;
			score += i * 0.1;
			lastMatchIndex = i;
			queryIndex++;
		}
	}

	if (queryIndex < queryLower.length) return { matches: false, score: 0 };
	if (queryLower === textLower) score -= 100;
	return { matches: true, score };
}

export function fuzzyScore(query: string, text: string): number | null {
	const tokens = query
		.trim()
		.split(/[\s/]+/)
		.filter((t) => t.length > 0);
	if (tokens.length === 0) return 0;
	let total = 0;
	for (const token of tokens) {
		const m = fuzzyMatch(token, text);
		if (!m.matches) return null;
		total += m.score;
	}
	return total;
}

/** Indices in `text` that matched the fuzzy query (for highlight). */
export function fuzzyMatchIndices(query: string, text: string): number[] | null {
	const q = query.toLowerCase().replace(/[\s/]+/g, "");
	if (!q) return [];
	const lower = text.toLowerCase();
	const indices: number[] = [];
	let qi = 0;
	for (let i = 0; i < lower.length && qi < q.length; i++) {
		if (lower[i] === q[qi]) {
			indices.push(i);
			qi++;
		}
	}
	return qi === q.length ? indices : null;
}
