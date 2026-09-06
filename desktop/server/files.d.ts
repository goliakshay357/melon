/** Relative paths of candidate files under `cwd` (bounded). */
export declare function walkFiles(cwd: string): string[];
export interface FileHit {
    /** Relative path (the @mention token). */
    path: string;
    abs: string;
    score: number;
    /** Note artifacts: the human title from frontmatter (display hint). */
    title?: string;
}
/** Files under .melon/notes with a human title (frontmatter or first H1). */
export declare function noteFiles(cwd: string): Array<{
    path: string;
    abs: string;
    title?: string;
}>;
/**
 * Fuzzy-search candidate files. The .md files WE created (handoff artifacts +
 * manual documents) are prioritized: they match on path AND human title, get
 * a score bonus, and always rank above equal-scoring project files.
 */
export declare function searchFiles(cwd: string, query: string, limit?: number): FileHit[];
/** Resolve a mention path inside the folder; null when it escapes or misses. */
export declare function resolveInside(cwd: string, relPath: string): string | null;
export declare function fileExists(cwd: string, relPath: string): boolean;
/** Read a text file (bounded); null when missing, too large, or outside cwd. */
export declare function readTextFile(cwd: string, relPath: string): {
    abs: string;
    content: string;
} | null;
//# sourceMappingURL=files.d.ts.map