import ReactMarkdown from 'react-markdown';
import { IframeViz } from './iframe-viz';
import { MermaidBlock } from './mermaid-block';
import remarkGfm from 'remark-gfm';

/**
 * An assistant message = a stack of blocks.
 * Today: markdown text. Tomorrow: ```viz-html fences become iframe blocks
 * (VIZ-GOAL milestone 1) — the split already happens here.
 */

type Part =
    | { kind: 'markdown'; content: string }
    | { kind: 'viz-html'; content: string }
    | { kind: 'mermaid'; content: string };

function splitBlocks(raw: string): Part[] {
    const parts: Part[] = [];
    const re = /```(viz-html|mermaid)\s*\n([\s\S]*?)```/g;
    let last = 0;
    for (const match of raw.matchAll(re)) {
        const before = raw.slice(last, match.index);
        if (before.trim()) parts.push({ kind: 'markdown', content: before });
        parts.push({
            kind: match[1] as 'viz-html' | 'mermaid',
            content: match[2],
        });
        last = match.index + match[0].length;
    }
    const rest = raw.slice(last);
    if (rest.trim()) parts.push({ kind: 'markdown', content: rest });
    return parts.length > 0 ? parts : [{ kind: 'markdown', content: raw }];
}

export function MarkdownBlock({ content }: { content: string }) {
    return (
        <div className="md-body">
            {splitBlocks(content).map((part, i) =>
                part.kind === 'viz-html' ? (
                    <IframeViz key={i} code={part.content} />
                ) : part.kind === 'mermaid' ? (
                    <MermaidBlock key={i} code={part.content} />
                ) : (
                    <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                        {part.content}
                    </ReactMarkdown>
                ),
            )}
        </div>
    );
}
