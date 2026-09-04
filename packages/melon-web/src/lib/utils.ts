import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

const NON_TEXT_INPUT_TYPES = new Set([
	"button",
	"checkbox",
	"radio",
	"submit",
	"reset",
	"file",
	"color",
	"range",
	"hidden",
	"image",
]);

type TypingLike = {
	tagName?: string;
	type?: string;
	isContentEditable?: boolean;
	closest?: (selectors: string) => unknown;
};

/**
 * True when keyboard focus is inside text UI (inputs, Milkdown/ProseMirror,
 * contenteditable). Canvas shortcuts (Cmd/Ctrl+Z, Backspace delete-card) must
 * not run in these targets — they belong to the focused editor.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
	if (!target || typeof (target as TypingLike).tagName !== "string") return false;
	const el = target as TypingLike;
	const tag = el.tagName!.toUpperCase();
	if (tag === "INPUT") {
		const type = (el.type || "text").toLowerCase();
		return !NON_TEXT_INPUT_TYPES.has(type);
	}
	if (tag === "TEXTAREA" || tag === "SELECT") return true;
	if (el.isContentEditable) return true;
	return Boolean(el.closest?.('[contenteditable="true"],[contenteditable=""],.ProseMirror'));
}
