/* pi-bash-enhanced: tui-text helpers. */

export function resolveTextCtor(TextComp?: new (t?: string, x?: number, y?: number) => { setText(v: string): void }) {
	return TextComp;
}