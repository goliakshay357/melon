import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import {
	codeTextFromChildren,
	escapeHtml,
	extensionForLanguage,
	languageFromClassName,
} from "../src/components/melon-code-fence-utils.ts";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("melon code fence helpers", () => {
	it("parses fence language from className", () => {
		assert.equal(languageFromClassName("language-ts"), "ts");
		assert.equal(languageFromClassName("language-python something"), "python");
		assert.equal(languageFromClassName(undefined), "");
		assert.equal(languageFromClassName("not-a-fence"), "");
	});

	it("extracts code text from streamdown-style children", () => {
		assert.equal(codeTextFromChildren("plain"), "plain");
		assert.equal(codeTextFromChildren(createElement("code", null, "nested")), "nested");
		assert.equal(codeTextFromChildren(null), "");
	});

	it("maps languages to download extensions", () => {
		assert.equal(extensionForLanguage("typescript"), "ts");
		assert.equal(extensionForLanguage("python"), "py");
		assert.equal(extensionForLanguage("text"), "txt");
	});

	it("escapes HTML for unhighlighted fences", () => {
		assert.equal(escapeHtml(`a <b> & "c"`), "a &lt;b&gt; &amp; &quot;c&quot;");
	});
});

describe("melon artifact layout contract", () => {
	it("owns a shared flex toolbar for code and tables", () => {
		const css = readFileSync(join(webRoot, "src/globals.css"), "utf8");
		assert.match(css, /\.melon-artifact-toolbar\s*\{[^}]*display:\s*flex/s);
		assert.match(css, /\.melon-artifact-actions\s*\{[^}]*flex-direction:\s*row/s);
		assert.match(css, /\.melon-code-body\s*\{/s);
		assert.match(css, /\.melon-table-scroll\s*\{[^}]*overflow:\s*auto/s);
		assert.match(css, /\.melon-table\s*\{[^}]*display:\s*table/s);
		assert.match(css, /\.melon-table-head\s*\{[^}]*position:\s*sticky/s);
		assert.equal(css.includes("display: block; overflow-x: auto"), false);
	});

	it("keeps markdown wired to Melon code + table chrome", () => {
		const src = readFileSync(join(webRoot, "src/components/markdown-block.tsx"), "utf8");
		assert.ok(src.includes("MelonCode"));
		assert.ok(src.includes("MelonTable"));
		assert.ok(src.includes("controls={{ code: false, table: false }}"));
		assert.ok(src.includes("code: MelonCode"));
		assert.ok(src.includes("table: MelonTable"));
	});

	it("MelonCode uses Melon Prism body, not nested Streamdown CodeBlock", () => {
		const src = readFileSync(join(webRoot, "src/components/melon-code-fence.tsx"), "utf8");
		assert.ok(src.includes("MelonArtifact"));
		assert.ok(src.includes("melon-code-body"));
		assert.ok(src.includes("highlightCode"));
		assert.equal(src.includes("CodeBlock"), false);
		assert.equal(src.includes("CodeBlockCopyButton"), false);
	});

	it("MelonTable wraps a real table with quiet copy", () => {
		const src = readFileSync(join(webRoot, "src/components/melon-table.tsx"), "utf8");
		assert.ok(src.includes("MelonArtifact"));
		assert.ok(src.includes("melon-table-scroll"));
		assert.ok(src.includes("tableDataToMarkdown"));
		assert.ok(src.includes("extractTableDataFromElement"));
		assert.equal(src.includes("TableCopyDropdown"), false);
		assert.equal(src.includes("fullscreen"), false);
	});
});
