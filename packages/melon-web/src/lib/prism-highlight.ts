import Prism from "prismjs";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-css";
import "prismjs/components/prism-go";
import "prismjs/components/prism-java";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-json";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-yaml";

const EXT_LANG: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	mjs: "javascript",
	cjs: "javascript",
	json: "json",
	md: "markdown",
	markdown: "markdown",
	css: "css",
	scss: "css",
	html: "markup",
	htm: "markup",
	xml: "markup",
	svg: "markup",
	py: "python",
	rb: "bash",
	rs: "rust",
	go: "go",
	java: "java",
	kt: "clike",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	cs: "csharp",
	php: "markup",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	sql: "sql",
	yaml: "yaml",
	yml: "yaml",
	toml: "bash",
	typescript: "typescript",
	javascript: "javascript",
	python: "python",
	rust: "rust",
	csharp: "csharp",
	shell: "bash",
	zshrc: "bash",
};

/** Map fence language / extension aliases to a Prism grammar id. */
export function resolvePrismLanguage(language: string | undefined): string | undefined {
	if (!language) return undefined;
	const key = language.toLowerCase().trim();
	if (!key) return undefined;
	const mapped = EXT_LANG[key] ?? key;
	if (Prism.languages[mapped]) return mapped;
	return undefined;
}

export function languageFromPath(filePath: string | undefined): string | undefined {
	if (!filePath) return undefined;
	const base = filePath.split(/[\\/]/).pop() ?? filePath;
	const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() : undefined;
	if (!ext) return undefined;
	return resolvePrismLanguage(ext) ?? EXT_LANG[ext];
}

/** Returns HTML (Prism tokens) or null when highlighting is unavailable. */
export function highlightCode(code: string, language: string | undefined): string | null {
	if (!code) return null;
	const resolved = resolvePrismLanguage(language);
	if (!resolved) return null;
	const grammar = Prism.languages[resolved];
	if (!grammar) return null;
	try {
		return Prism.highlight(code, grammar, resolved);
	} catch {
		return null;
	}
}
