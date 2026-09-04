import { isValidElement, type ReactNode } from "react";

const LANGUAGE_RE = /language-([^\s]+)/;

export function languageFromClassName(className: string | undefined): string {
	return className?.match(LANGUAGE_RE)?.[1] ?? "";
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
