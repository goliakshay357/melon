import { describe, expect, it } from "vitest";
import { isTypingTarget } from "../src/lib/utils.ts";

describe("isTypingTarget", () => {
	it("returns false for null / non-elements", () => {
		expect(isTypingTarget(null)).toBe(false);
		expect(isTypingTarget({} as EventTarget)).toBe(false);
	});

	it("detects text inputs and textareas; ignores buttons", () => {
		expect(isTypingTarget({ tagName: "INPUT", type: "text" } as EventTarget)).toBe(true);
		expect(isTypingTarget({ tagName: "INPUT", type: "button" } as EventTarget)).toBe(false);
		expect(isTypingTarget({ tagName: "TEXTAREA" } as EventTarget)).toBe(true);
	});

	it("detects ProseMirror / contenteditable (Milkdown document editor)", () => {
		expect(isTypingTarget({ tagName: "DIV", isContentEditable: true } as EventTarget)).toBe(true);
		expect(
			isTypingTarget({
				tagName: "P",
				isContentEditable: false,
				closest: (sel: string) => (sel.includes(".ProseMirror") ? {} : null),
			} as EventTarget),
		).toBe(true);
	});

	it("returns false for ordinary canvas nodes", () => {
		expect(
			isTypingTarget({
				tagName: "DIV",
				isContentEditable: false,
				closest: () => null,
			} as EventTarget),
		).toBe(false);
	});
});
