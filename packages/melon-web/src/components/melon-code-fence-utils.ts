import { isValidElement, type ReactNode } from "react";

const LANGUAGE_RE = /language-([^\s]+)/;

const LANG_EXT: Record<string, string> = {
	typescript: "ts",
	ts: "ts",
	tsx: "tsx",
	javascript: "js",
	js: "js",
	jsx: "jsx",
	python: "py",
	py: "py",
	rust: "rs",
	rs: "rs",
	go: "go",
	java: "java",
	c: "c",
	cpp: "cpp",
	csharp: "cs",
	cs: "cs",
	json: "json",
	yaml: "yml",
	yml: "yml",
	markdown: "md",
	md: "md",
	html: "html",
	css: "css",
	sql: "sql",
	bash: "sh",
	sh: "sh",
	shell: "sh",
	zsh: "sh",
	text: "txt",
};

export function languageFromClassName(className: string | undefined): string {
	return className?.match(LANGUAGE_RE)?.[1] ?? "";
}

export function extensionForLanguage(language: string): string {
	const key = language.toLowerCase().trim();
	return LANG_EXT[key] ?? (key && /^[a-z0-9]+$/i.test(key) ? key : "txt");
}

export function codeTextFromChildren(children: ReactNode): string {
	if (
		isValidElement(children) &&
		children.props &&
		typeof children.props === "object" &&
		"children" in children.props &&
		typeof (children.props as { children?: unknown }).children === "string"
	) {
		return (children.props as { children: string }).children;
	}
	if (typeof children === "string") return children;
	return "";
}

export function escapeHtml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
