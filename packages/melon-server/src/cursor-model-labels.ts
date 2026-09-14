/**
 * Cursor ships two catalog rows both named "Auto":
 * - `auto-smart` — Cursor Router (Optimize For: Intelligence / Balance / Cost)
 * - `default` (alias `auto`) — legacy cost-oriented Auto
 * Melon shows distinct labels so the picker is not ambiguous.
 */
export function cursorAutoDisplayName(id: string, name: string): string {
	const trimmed = name.trim();
	if (!/^auto$/i.test(trimmed)) return name;
	const base = (id.split(/[@:]/)[0] ?? id).trim();
	if (base === "auto-smart") return "Auto · Smart";
	if (base === "default" || base === "auto") return "Auto · Cost";
	return name;
}
