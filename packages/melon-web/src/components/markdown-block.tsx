import { memo } from "react";
import { Streamdown } from "streamdown";
import { MelonCode } from "./melon-code-fence";
import { MelonTable, MelonTd, MelonTh, MelonThead } from "./melon-table";

/**
 * Assistant message markdown via streamdown (incomplete-syntax aware while
 * streaming). Fenced code and tables use Melon's artifact chrome; Streamdown
 * handles parse + incomplete fences. ```viz-html / ```viz-file become iframes.
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
				// Melon owns code/table chrome — disable Streamdown toolbars.
				controls={{ code: false, table: false }}
				components={{
					code: MelonCode,
					table: MelonTable,
					thead: MelonThead,
					th: MelonTh,
					td: MelonTd,
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
