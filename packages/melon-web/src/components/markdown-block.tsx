import ReactMarkdown from 'react-markdown';
import { memo } from 'react';
import { IframeViz } from './iframe-viz';
import remarkGfm from 'remark-gfm';

/**
 * An assistant message = a stack of blocks.
 * ```viz-html fences carry inline HTML; ```viz-file fences reference an
 * HTML file on disk (written by a tool/skill like archify) — the iframe
 * fetches it from the server instead of inlining 100s of KB into chat.
 */

type Part =
    | { kind: 'markdown'; content: string }
    | { kind: 'viz-html'; content: string }
    | { kind: 'viz-file'; path: string; cwd?: string };

function splitBlocks(raw: string): Part[] {
    const parts: Part[] = [];
    const re = /```viz-html\s*\n([\s\S]*?)```/g;
    const reFile = /```viz-file\s*\n([^\n`]+)\n```/g;
    // Collect matches from both fence types, then emit in document order.
    type M = { index: number; end: number; part: Part };
    const ms: M[] = [];
    for (const m of raw.matchAll(re)) {
        ms.push({ index: m.index, end: m.index + m[0].length, part: { kind: 'viz-html', content: m[1] } });
    }
    for (const m of raw.matchAll(reFile)) {
        // fence body = absolute path to the HTML file (optional "| cwd" suffix)
        let [path, cwd] = m[1].split('|').map((s) => s.trim());
        ms.push({ index: m.index, end: m.index + m[0].length, part: { kind: 'viz-file', path, cwd } });
    }
    ms.sort((a, b) => a.index - b.index);
    let last = 0;
    for (const m of ms) {
        const before = raw.slice(last, m.index);
        if (before.trim()) parts.push({ kind: 'markdown', content: before });
        parts.push(m.part);
        last = m.end;
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
                ) : part.kind === 'viz-file' ? (
                    <IframeViz key={i} path={part.path} cwd={part.cwd} />
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
