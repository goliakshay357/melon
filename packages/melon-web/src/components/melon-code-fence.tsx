import { Suspense, useEffect, useState, type HTMLAttributes } from "react";
import { Check, Copy, Download } from "lucide-react";
import { useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { cn } from "@/lib/utils";
import { highlightCode } from "@/lib/prism-highlight";
import { MelonArtifact, MelonArtifactButton, downloadTextFile } from "./melon-artifact";
import { IframeViz } from "./iframe-viz";
import {
	codeTextFromChildren,
	escapeHtml,
	extensionForLanguage,
	languageFromClassName,
} from "./melon-code-fence-utils";

/**
 * Melon-owned fenced-code chrome.
 *
 * Streamdown parses the fence; Melon owns the frame + Prism highlighting.
 * No nested Streamdown highlighter card (avoids sticky toolbar + CSS wars).
 */

export { codeTextFromChildren, languageFromClassName } from "./melon-code-fence-utils";

function VizPlaceholder({ label }: { label: string }) {
	return (
		<div className="my-2 flex h-24 items-center justify-center rounded-md border border-border bg-secondary/50 text-[11px] text-muted-foreground">
			{label}
		</div>
	);
}

function VizHtmlFence({ code, isIncomplete }: { code: string; isIncomplete: boolean }) {
	if (isIncomplete) return <VizPlaceholder label="Loading visualization…" />;
	return <IframeViz code={code} />;
}

function VizFileFence({ code, isIncomplete }: { code: string; isIncomplete: boolean }) {
	if (isIncomplete) return <VizPlaceholder label="Loading visualization…" />;
	const [path, cwd] = code
		.trim()
		.split("|")
		.map((s) => s.trim());
	if (!path) return <VizPlaceholder label="Missing viz file path" />;
	return <IframeViz path={path} cwd={cwd || undefined} />;
}

function CodeActions({ code, language }: { code: string; language: string }) {
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		if (!copied) return;
		const id = window.setTimeout(() => setCopied(false), 1400);
		return () => window.clearTimeout(id);
	}, [copied]);

	return (
		<>
			<MelonArtifactButton
				title={copied ? "Copied" : "Copy code"}
				onClick={() => {
					void navigator.clipboard.writeText(code).then(() => setCopied(true));
				}}
			>
				{copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
			</MelonArtifactButton>
			<MelonArtifactButton
				title="Download"
				onClick={() => {
					downloadTextFile(
						`code.${extensionForLanguage(language)}`,
						code,
						"text/plain;charset=utf-8",
					);
				}}
			>
				<Download className="size-3.5" aria-hidden />
			</MelonArtifactButton>
		</>
	);
}

export function MelonCode({
	className,
	children,
	node: _node,
	...rest
}: HTMLAttributes<HTMLElement> & ExtraProps) {
	const isIncomplete = useIsCodeFenceIncomplete();
	// Streamdown marks fenced blocks with data-block; inline code lacks it.
	const isInline = !("data-block" in rest);
	if (isInline) {
		return (
			<code
				className={cn("rounded bg-muted px-1.5 py-0.5 font-mono text-sm", className)}
				data-streamdown="inline-code"
				{...rest}
			>
				{children}
			</code>
		);
	}

	const language = languageFromClassName(className);
	const code = codeTextFromChildren(children);

	if (language === "viz-html") {
		return (
			<Suspense fallback={<VizPlaceholder label="Loading visualization…" />}>
				<VizHtmlFence code={code} isIncomplete={isIncomplete} />
			</Suspense>
		);
	}
	if (language === "viz-file") {
		return (
			<Suspense fallback={<VizPlaceholder label="Loading visualization…" />}>
				<VizFileFence code={code} isIncomplete={isIncomplete} />
			</Suspense>
		);
	}

	const label = language || "text";
	const highlighted = highlightCode(code, label);
	const html = highlighted ?? escapeHtml(code);

	return (
		<MelonArtifact kind="code" label={label} actions={<CodeActions code={code} language={label} />}>
			<pre className="melon-code-body tool-prism nowheel">
				<code
					className={language ? `language-${language}` : undefined}
					dangerouslySetInnerHTML={{ __html: html || " " }}
				/>
			</pre>
		</MelonArtifact>
	);
}
