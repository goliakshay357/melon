import ReactMarkdown from 'react-markdown';
import { memo } from 'react';
import { IframeViz } from './iframe-viz';
import remarkGfm from 'remark-gfm';

/**
 * An assistant message = a stack of blocks.
 * Today: markdown text. Tomorrow: ```viz-html fences become iframe blocks
 * (VIZ-GOAL milestone 1) — the split already happens here.
 */

type Part =
    | { kind: 'markdown'; content: string }
    | { kind: 'viz-html'; content: string };

function splitBlocks(raw: string): Part[] {
    const parts: Part[] = [];
    const re = /```viz-html\s*\n([\s\S]*?)```/g;
    let last = 0;
    for (const match of raw.matchAll(re)) {
        const before = raw.slice(last, match.index);
        if (before.trim()) parts.push({ kind: 'markdown', content: before });
        parts.push({ kind: 'viz-html', content: match[1] });
        last = match.index + match[0].length;
    }
    const rest = raw.slice(last);
    if (rest.trim()) parts.push({ kind: 'markdown', content: rest });
    return parts.length > 0 ? parts : [{ kind: 'markdown', content: raw }];
}

export const MarkdownBlock = memo(function MarkdownBlock({ content }: { content: string }) {
    return (
        <div className="md-body">
            {splitBlocks(content).map((part, i) =>
                part.kind === 'viz-html' ? (
                    <IframeViz key={i} code={part.content} />
                ) : (
                    <ReactMarkdown
                        key={i}
                        remarkPlugins={[remarkGfm]}
                        components={{
                            // Links open in the OS default browser, never inside the app.
                            a: ({ node: _node, ...props }) => (
                                <a target="_blank" rel="noopener noreferrer" {...props} />
                            ),
                        }}
                    >
                        {part.content}
                    </ReactMarkdown>
                ),
            )}
        </div>
    );
});
