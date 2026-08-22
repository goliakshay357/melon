import ReactMarkdown from 'react-markdown';
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

export function MarkdownBlock({ content }: { content: string }) {
    return (
        <div className="md-body">
            {splitBlocks(content).map((part, i) =>
                part.kind === 'viz-html' ? (
                    <div
                        key={i}
                        className="my-2 rounded-lg border border-dashed border-primary/50 bg-primary/5 px-3 py-4 text-center text-[11px] text-muted-foreground"
                    >
                        🖼 visualization block ({part.content.split('\n').length} lines) — iframe rendering arrives with VIZ-GOAL M1
                    </div>
                ) : (
                    <ReactMarkdown key={i} remarkPlugins={[remarkGfm]}>
                        {part.content}
                    </ReactMarkdown>
                ),
            )}
        </div>
    );
}
