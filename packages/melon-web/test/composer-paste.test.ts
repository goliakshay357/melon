import { describe, expect, it } from "vitest";
import {
	clipboardPlainText,
	htmlToPlainText,
	insertPlainAt,
	plainTextFromClipboard,
	sanitizePastedText,
} from "../src/lib/composer-paste";

function fakeClipboard(parts: { plain?: string; html?: string; uri?: string }): DataTransfer {
	return {
		getData(type: string) {
			if (type === "text/plain" || type === "text") return parts.plain ?? "";
			if (type === "text/html") return parts.html ?? "";
			if (type === "text/uri-list") return parts.uri ?? "";
			return "";
		},
	} as DataTransfer;
}

describe("composer paste sanitization", () => {
	it("keeps normal multiline plain text", () => {
		expect(sanitizePastedText("hello\nworld")).toBe("hello\nworld");
	});

	it("normalizes CRLF and strips ANSI from terminals", () => {
		const raw = "a\r\n\u001b[30mblack\u001b[0m\nb";
		expect(sanitizePastedText(raw)).toBe("a\nblack\nb");
	});

	it("strips OSC hyperlinks and zero-width chars", () => {
		const raw = "x\u001b]8;;https://ex.com\u0007link\u001b]8;;\u0007y\u200Bz";
		expect(sanitizePastedText(raw)).toBe("xlinkyz");
	});

	it("falls back to HTML when text/plain is empty", () => {
		const text = clipboardPlainText(fakeClipboard({ html: "<div>line1</div><div>line2<br></div>" }));
		expect(htmlToPlainText("<div>line1</div>")).toContain("line1");
		expect(plainTextFromClipboard(fakeClipboard({ html: "<p>hi</p>" }))).toContain("hi");
		expect(text.replace(/\n+/g, "\n").trim()).toBe("line1\nline2");
	});

	it("decodes numeric entities from HTML", () => {
		expect(htmlToPlainText("&#65;&#x42;")).toBe("AB");
	});

	it("falls back to uri-list", () => {
		expect(plainTextFromClipboard(fakeClipboard({ uri: "#comment\nhttps://example.com\nhttps://b.test" }))).toBe(
			"https://example.com\nhttps://b.test",
		);
	});

	it("prefers text/plain over HTML when both exist", () => {
		expect(plainTextFromClipboard(fakeClipboard({ plain: "from-plain", html: "<b>from-html</b>" }))).toBe(
			"from-plain",
		);
	});

	it("inserts at caret without clobbering surroundings", () => {
		expect(insertPlainAt("ab", 1, 1, "X")).toEqual({ next: "aXb", caret: 2 });
		expect(insertPlainAt("ab", 0, 2, "Z")).toEqual({ next: "Z", caret: 1 });
	});
});
