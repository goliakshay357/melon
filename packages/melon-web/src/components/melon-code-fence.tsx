import { Suspense, useState, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";
import { Check, Copy, Download } from "lucide-react";
import { useIsCodeFenceIncomplete, type ExtraProps } from "streamdown";
import { cn } from "@/lib/utils";
import { escapeHtml, highlightCode, resolvePrismLanguage } from "@/lib/prism-highlight";
import { IframeViz } from "./iframe-viz";
import { codeTextFromChildren, languageFromClassName } from "./melon-code-fence-utils";

/**
 * Melon-owned fenced-code chrome.
 *
 * Streamdown's default toolbar (sticky + -mt-10) breaks under React Flow and
 * the maximize portal. Streamdown also ships no highlighter unless
 * `@streamdown/code` is installed — tokens stay `inherit`. Melon draws the
 * header + Prism body itself so card and fullscreen stay aligned and colored.
 */

export { codeTextFromChildren, languageFromClassName } from "./melon-code-fence-utils";

const EXT_BY_LANG: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	python: "py",
	markdown: "md",
	markup: "html",
	csharp: "cs",
	bash: "sh",
	rust: "rs",
	yaml: "yml",
};

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

function downloadCode(code: string, language: string) {
	const prismLang = resolvePrismLanguage(language);
	const ext = (prismLang && EXT_BY_LANG[prismLang]) || language || "txt";
	const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `code.${ext}`;
	a.click();
	URL.revokeObjectURL(url);
}

function FenceAction({
	label,
	onClick,
	children,
}: {
	label: string;
	onClick: (e: MouseEvent<HTMLButtonElement>) => void;
	children: ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			className="nodrag melon-code-fence-btn"
			onClick={(e) => {
				e.stopPropagation();
				onClick(e);
			}}
		>
			{children}
		</button>
	);
}

function FenceToolbar({ code, label }: { code: string; label: string }) {
	const [copied, setCopied] = useState(false);

	return (
		<div className="melon-code-fence-toolbar">
			<span className="melon-code-fence-lang">{label}</span>
			<div className="melon-code-fence-actions">
				<FenceAction label="Download file" onClick={() => downloadCode(code, label)}>
					<Download className="size-3.5" strokeWidth={2} />
				</FenceAction>
				<FenceAction
					label="Copy code"
					onClick={() => {
						void navigator.clipboard.writeText(code).then(() => {
							setCopied(true);
							window.setTimeout(() => setCopied(false), 1500);
						});
					}}
				>
					{copied ? (
						<Check className="size-3.5" strokeWidth={2} />
					) : (
						<Copy className="size-3.5" strokeWidth={2} />
					)}
				</FenceAction>
			</div>
		</div>
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
	const highlighted = highlightCode(code, language);
	const html = highlighted ?? escapeHtml(code);

	return (
		<div className="melon-code-fence" data-melon="code-fence" data-language={label}>
			<FenceToolbar code={code} label={label} />
			<pre className="nowheel melon-code-fence-pre tool-prism">
				<code
					className={cn(language && `language-${language}`)}
					dangerouslySetInnerHTML={{ __html: html || " " }}
				/>
			</pre>
		</div>
	);
}
