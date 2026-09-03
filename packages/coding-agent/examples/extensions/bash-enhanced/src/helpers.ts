/* pi-bash-enhanced: helper functions. */

export function compactErrorLines(error: string): string[] {
	return error
		.split("\n")
		.filter((line) => line.trim() && !line.includes("warning:") && !line.includes("error:"))
		.map((line) => line.trim());
}

export function inferBashExitCode(text: string | null, defaultExit: number): number {
	if (!text) return defaultExit;
	const match = text.match(/\bexit (\d+)\b/);
	if (match) return parseInt(match[1], 10) || defaultExit;
	return defaultExit;
}

export function stripBashExitStatusLine(text: string): string {
	return text.replace(/^exit \d+\n/, "");
}

export function normalizeLineEndings(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}