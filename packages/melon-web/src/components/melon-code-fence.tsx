import { Suspense, type HTMLAttributes } from "react";
import {
	CodeBlock,
	CodeBlockCopyButton,
	CodeBlockDownloadButton,
	useIsCodeFenceIncomplete,
	type ExtraProps,
} from "streamdown";
import { cn } from "@/lib/utils";
import { IframeViz } from "./iframe-viz";
import { codeTextFromChildren, languageFromClassName } from "./melon-code-fence-utils";

/**
 * Melon-owned fenced-code chrome.
 *
 * Streamdown's default toolbar uses sticky + -mt-10. That layout diverges in Melon:
 * React Flow card transforms vs the maximized-card portal scroll root. We never use
 * that sticky overlay — Melon draws language + Copy/Download as a real flex header,
 * then nests Streamdown's highlighter body underneath (its own header is hidden).
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

	return (
		<div className="melon-code-fence" data-melon="code-fence">
			<div className="melon-code-fence-toolbar">
				<span className="melon-code-fence-lang">{label}</span>
				<div className="melon-code-fence-actions">
					<CodeBlockCopyButton code={code} />
					<CodeBlockDownloadButton code={code} language={label} />
				</div>
			</div>
			{/* No action children → Streamdown skips its sticky overlay entirely. */}
			<CodeBlock
				code={code}
				language={label}
				isIncomplete={isIncomplete}
				className="melon-code-fence-body"
			/>
		</div>
	);
}
