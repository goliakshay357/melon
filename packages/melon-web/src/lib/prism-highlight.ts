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

/** Fence / extension aliases → Prism grammar ids Melon loads. */
const LANG_ALIAS: Record<string, string> = {
	ts: "typescript",
	tsx: "tsx",
	typescript: "typescript",
	js: "javascript",
	jsx: "jsx",
	javascript: "javascript",
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
	python: "python",
	rb: "bash",
	rs: "rust",
	rust: "rust",
	go: "go",
	java: "java",
	kt: "clike",
	c: "c",
	h: "c",
	cpp: "cpp",
	cc: "cpp",
	cxx: "cpp",
	hpp: "cpp",
	"c++": "cpp",
	cs: "csharp",
	csharp: "csharp",
	php: "markup",
	sh: "bash",
	bash: "bash",
	zsh: "bash",
	fish: "bash",
	shell: "bash",
	sql: "sql",
	yaml: "yaml",
	yml: "yaml",
	toml: "bash",
	zshrc: "bash",
};

/** Map a fence label / extension to a loaded Prism grammar id. */
export function resolvePrismLanguage(raw: string | undefined): string | undefined {
	if (!raw) return undefined;
	const key = raw.trim().toLowerCase();
	if (!key || key === "text" || key === "plain" || key === "txt") return undefined;
	const mapped = LANG_ALIAS[key] ?? key;
	return Prism.languages[mapped] ? mapped : undefined;
}

export function languageFromPath(filePath: string | undefined): string | undefined {
	if (!filePath) return undefined;
	const base = filePath.split(/[\\/]/).pop() ?? filePath;
	const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() : undefined;
	if (!ext) return undefined;
	return resolvePrismLanguage(ext) ?? LANG_ALIAS[ext];
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Returns HTML (Prism tokens) or null when highlighting is unavailable. */
export function highlightCode(code: string, language: string | undefined): string | null {
	if (!code) return null;
	const lang = resolvePrismLanguage(language);
	if (!lang) return null;
	const grammar = Prism.languages[lang];
	if (!grammar) return null;
	try {
		return Prism.highlight(code, grammar, lang);
	} catch {
		return null;
	}
}
