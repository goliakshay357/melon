import { memo as ReactMemo, useState } from 'react';
import {
    Handle,
    NodeResizer,
    Position,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { MarkdownBlock } from '@/components/markdown-block';
import { cn } from '@/lib/utils';

export type ChatCardNodeType = Node<{ cardId: string }, 'chatCard'>;

const statusDot: Record<string, string> = {
    idle: 'bg-[#1f883d]',
    streaming: 'bg-[#bf8700] animate-pulse',
    error: 'bg-[#cf222e]',
};

function ChatCardNodeInner({
    id,
    selected,
    dragging,
}: NodeProps<ChatCardNodeType>) {
    const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
    const forkCard = useCanvasStore((s) => s.forkCard);
    const deleteCards = useCanvasStore((s) => s.deleteCards);
    const sendMessage = useCanvasStore((s) => s.sendMessage);
    const [draft, setDraft] = useState('');
    const [copied, setCopied] = useState(false);

    if (!card) return null;

    // chartdb note-node pattern: interactive only when selected and not mid-drag.
    const focused = !!selected && !dragging;

    const submit = () => {
        const text = draft.trim();
        if (!text) return;
        setDraft('');
        sendMessage(id, text);
    };

    return (
        <div
            className={cn(
                'flex h-full w-full flex-col rounded-xl border bg-card shadow-sm transition-shadow',
                focused ? 'border-ring shadow-md ring-2 ring-ring/30' : 'border-border',
            )}
        >
            {/* Resize handles — visible when the card is selected */}
            <NodeResizer
                isVisible={selected}
                minWidth={320}
                minHeight={260}
                lineClassName="!border-primary/50"
                handleClassName="!h-2 !w-2 !rounded-sm !border-primary/60 !bg-card"
                onResizeEnd={(_e, params) =>
                    useCanvasStore
                        .getState()
                        .resizeCard(id, params.width, params.height)
                }
            />

            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />

            {/* Header — drag handle zone */}
            <div className="flex items-center gap-2 rounded-t-xl border-b border-border px-3 py-2">
                <span className={cn('size-2 shrink-0 rounded-full', statusDot[card.status])} />
                <span className="flex-1 truncate text-sm font-medium text-card-foreground">
                    {card.title}
                </span>
                <button
                    className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
                    onClick={(e) => {
                        e.stopPropagation();
                        forkCard(id);
                    }}
                    title="Fork this conversation"
                >
                    <Plus className="size-4" />
                </button>
                <button
                    className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
                    onClick={(e) => {
                        e.stopPropagation();
                        deleteCards([id]);
                    }}
                    title="Delete card"
                >
                    <X className="size-4" />
                </button>
            </div>

            {/* Body — flexes to whatever height the card is resized to */}
            <div className="nowheel min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-2">
                {card.messages.length === 0 && (
                    <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Ask something to start this thread.
                    </p>
                )}
                {card.messages.map((m, i) => (
                    <div
                        key={i}
                        className={cn(
                            'max-w-[90%] rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                            m.role === 'user'
                                ? 'ml-auto bg-primary/10 text-primary'
                                : 'bg-secondary text-secondary-foreground',
                        )}
                    >
                        {m.role === 'assistant' && m.thinking && (
                            <details className="mb-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1">
                                <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    💭 Thinking
                                </summary>
                                <div className="nowheel mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap italic leading-relaxed text-muted-foreground">
                                    {m.thinking}
                                </div>
                            </details>
                        )}
                        {m.role === 'assistant' ? (
                            <>
                                <MarkdownBlock content={m.text} />
                                {!m.text && m.thinking && (
                                    <span className="text-[10px] text-muted-foreground">…</span>
                                )}
                            </>
                        ) : (
                            m.text
                        )}
                    </div>
                ))}
            </div>

            {/* Pipe trace — first-principles visibility */}
            <details className="border-t border-border px-3 py-1 text-[10px]">
                <summary className="flex cursor-pointer select-none items-center gap-2 text-muted-foreground">
                    <span>
                        log{card.model ? ` · ${card.model}` : ''}
                    </span>
                    <button
                        className="nodrag ml-auto rounded px-1.5 py-0.5 hover:bg-secondary"
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            navigator.clipboard
                                .writeText((card.logs ?? []).join('\n'))
                                .then(() => setCopied(true))
                                .then(() => window.setTimeout(() => setCopied(false), 1200));
                        }}
                    >
                        {copied ? 'copied ✓' : 'copy'}
                    </button>
                </summary>
                <div className="nowheel mt-1 max-h-24 overflow-y-auto font-mono leading-relaxed text-muted-foreground">
                    {(card.logs ?? []).length === 0 && <div>(no activity yet)</div>}
                    {(card.logs ?? []).map((l, i) => (
                        <div key={i} className="whitespace-pre-wrap">{l}</div>
                    ))}
                </div>
            </details>

            {/* Footer input */}
            <div className="border-t border-border p-2">
                <input
                    className="nodrag w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') submit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Ask anything…"
                />
            </div>
        </div>
    );
}

export const ChatCardNode = ReactMemo(ChatCardNodeInner);
