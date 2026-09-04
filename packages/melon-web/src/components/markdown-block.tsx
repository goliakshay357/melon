import { memo } from "react";
import { Streamdown } from "streamdown";
import { MelonCode } from "./melon-code-fence";

/**
 * Assistant message markdown via streamdown (incomplete-syntax aware while
 * streaming). Fenced code uses Melon's own toolbar (see melon-code-fence);
 * ```viz-html / ```viz-file still become Melon iframes.
 */
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
				// Disable Streamdown's sticky code toolbar — MelonCode owns that chrome.
				controls={{ code: false }}
				components={{
					code: MelonCode,
					// Links open in the OS default browser, never inside the app.
					a: ({ href, children, ...props }) => (
						<a href={href} target="_blank" rel="noopener noreferrer" {...props}>
							{children}
						</a>
					),
				}}
			>
				{content}
			</Streamdown>
		</div>
	);
});
