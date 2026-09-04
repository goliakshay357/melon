/**
 * Fuzzy matching (same rules as @earendil-works/pi-tui).
 * Matches if all query characters appear in order (not necessarily consecutive).
 * Lower score = better match.
 */
export interface FuzzyMatch {
    matches: boolean;
    score: number;
}
export declare function fuzzyMatch(query: string, text: string): FuzzyMatch;
/** All whitespace-/slash-separated tokens must fuzzy-match. Lower score = better. */
export declare function fuzzyScore(query: string, text: string): number | null;
//# sourceMappingURL=fuzzy.d.ts.map