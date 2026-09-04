import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { codeTextFromChildren, languageFromClassName } from "../src/components/melon-code-fence-utils.ts";

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
});

describe("melon code fence layout contract", () => {
	it("owns a flex toolbar so card and maximize share one layout", () => {
		const css = readFileSync(join(webRoot, "src/globals.css"), "utf8");
		assert.match(css, /\.melon-code-fence-toolbar\s*\{[^}]*display:\s*flex/s);
		assert.match(css, /\.melon-code-fence-actions\s*\{[^}]*flex-direction:\s*row/s);
		assert.ok(css.includes("code-block-copy-button"));
		assert.ok(css.includes("code-block-download-button"));
		assert.match(css, /\.melon-code-fence \[data-streamdown="code-block-header"\]\s*\{[^}]*display:\s*none/s);
	});

	it("keeps markdown wired to MelonCode (not Streamdown sticky toolbar)", () => {
		const src = readFileSync(join(webRoot, "src/components/markdown-block.tsx"), "utf8");
		assert.ok(src.includes("MelonCode"));
		assert.ok(src.includes("controls={{ code: false }}"));
		assert.ok(src.includes("code: MelonCode"));
	});

	it("MelonCode nests CodeBlock without action children (no sticky overlay)", () => {
		const src = readFileSync(join(webRoot, "src/components/melon-code-fence.tsx"), "utf8");
		assert.ok(src.includes("melon-code-fence-toolbar"));
		assert.ok(src.includes("CodeBlockCopyButton"));
		assert.ok(src.includes("CodeBlockDownloadButton"));
		assert.ok(src.includes("<CodeBlock"));
		assert.equal(/<CodeBlock[^>]*>\s*<CodeBlockCopyButton/s.test(src), false);
	});
});
