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
		assert.ok(css.includes("melon-code-fence-btn"));
		assert.ok(css.includes("melon-code-fence-pre"));
		assert.equal(css.includes("code-block-copy-button"), false);
		assert.equal(css.includes('[data-streamdown="code-block-header"]'), false);
	});

	it("keeps markdown wired to MelonCode (not Streamdown sticky toolbar)", () => {
		const src = readFileSync(join(webRoot, "src/components/markdown-block.tsx"), "utf8");
		assert.ok(src.includes("MelonCode"));
		assert.ok(src.includes("controls={{ code: false }}"));
		assert.ok(src.includes("code: MelonCode"));
	});

	it("MelonCode owns Prism body and Melon toolbar (no nested Streamdown CodeBlock)", () => {
		const src = readFileSync(join(webRoot, "src/components/melon-code-fence.tsx"), "utf8");
		assert.ok(src.includes("melon-code-fence-toolbar"));
		assert.ok(src.includes("highlightCode"));
		assert.ok(src.includes("tool-prism"));
		assert.ok(src.includes("Download"));
		assert.ok(src.includes("Copy"));
		assert.equal(src.includes("CodeBlockCopyButton"), false);
		assert.equal(src.includes("<CodeBlock"), false);
	});

	it("prism-highlight resolves fence aliases and highlights via Prism", () => {
		const src = readFileSync(join(webRoot, "src/lib/prism-highlight.ts"), "utf8");
		assert.ok(src.includes("resolvePrismLanguage"));
		assert.ok(src.includes('py: "python"'));
		assert.ok(src.includes('ts: "typescript"'));
		assert.ok(src.includes("Prism.highlight"));
		assert.ok(src.includes("escapeHtml"));
	});
});
