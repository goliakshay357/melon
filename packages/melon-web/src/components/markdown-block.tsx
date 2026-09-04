import { memo } from "react";
import { Streamdown, type CustomRendererProps } from "streamdown";
import { IframeViz } from "./iframe-viz";

/**
 * Assistant message markdown via streamdown (incomplete-syntax aware while
 * streaming). ```viz-html / ```viz-file fences still become Melon iframes —
 * mounted only after the fence closes so half-streamed HTML does not thrash.
 */

function VizPlaceholder({ label }: { label: string }) {
	return (
		<div className="my-2 flex h-24 items-center justify-center rounded-md border border-border bg-secondary/50 text-[11px] text-muted-foreground">
			{label}
		</div>
	);
}

function VizHtmlRenderer({ code, isIncomplete }: CustomRendererProps) {
	if (isIncomplete) return <VizPlaceholder label="Loading visualization…" />;
	return <IframeViz code={code} />;
}

function VizFileRenderer({ code, isIncomplete }: CustomRendererProps) {
	if (isIncomplete) return <VizPlaceholder label="Loading visualization…" />;
	const [path, cwd] = code
		.trim()
		.split("|")
		.map((s) => s.trim());
	if (!path) return <VizPlaceholder label="Missing viz file path" />;
	return <IframeViz path={path} cwd={cwd || undefined} />;
}

const VIZ_RENDERERS = [
	{ language: "viz-html", component: VizHtmlRenderer },
	{ language: "viz-file", component: VizFileRenderer },
];

export const MarkdownBlock = memo(function MarkdownBlock({
	content,
	streaming = false,
}: {
	content: string;
	/** True while this message is the live streaming tail. */
	streaming?: boolean;
}) {
	return (
		<div className="md-body">
			<Streamdown
				isAnimating={streaming}
				parseIncompleteMarkdown
				components={{
					// Links open in the OS default browser, never inside the app.
					a: ({ href, children, ...props }) => (
						<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
							{children}
						</a>
					),
				}}
				plugins={{ renderers: VIZ_RENDERERS }}
			>
				{content}
			</Streamdown>
		</div>
	);
});
