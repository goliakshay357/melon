import { memo as ReactMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Handle,
    NodeResizer,
    Position,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { Minimize2, Plus, X } from 'lucide-react';
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
    const [maximized, setMaximized] = useState(false);
    const bodyRef = useRef<HTMLDivElement | null>(null);
    // Auto-scroll only while the user is already at the bottom; scrolling up
    // to read pauses it until they return.
    const stickToBottom = useRef(true);

    const scrollToBottom = () => {
        const el = bodyRef.current;
        if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
    };
    const handleBodyScroll = () => {
        const el = bodyRef.current;
        if (!el) return;
        stickToBottom.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    };

    // Auto-scroll when content grows (streaming) or while typing.
    useEffect(() => {
        scrollToBottom();
    }, [
        card?.messages,
        draft,
        maximized,
    ]);

    // Escape exits full screen.
    useEffect(() => {
        if (!maximized) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMaximized(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [maximized]);

    if (!card) return null;

    // chartdb note-node pattern: interactive only when selected and not mid-drag.
    const focused = !!selected && !dragging;

    const submit = () => {
        const text = draft.trim();
        if (!text) return;
        setDraft('');
        sendMessage(id, text);
    };

    const header = (isMax: boolean) => (
        <div
            className={cn(
                'flex shrink-0 items-center gap-2 border-b border-border px-3 py-2',
                isMax ? '' : 'rounded-t-xl',
            )}
        >
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
                className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
                onClick={(e) => {
                    e.stopPropagation();
                    setMaximized(!isMax);
                }}
                title={isMax ? 'Minimize' : 'Full screen'}
            >
                {isMax ? <Minimize2 className="size-4" /> : <MaximizeIcon />}
            </button>
            {!isMax && (
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
            )}
        </div>
    );

    const messagesBody = (
        <div
            ref={bodyRef}
            onScroll={handleBodyScroll}
            className="nowheel min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
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
                    {m.role === 'assistant' &&
                        m.tools?.map((t) => (
                            <details
                                key={t.callId}
                                className="mb-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1"
                                open={t.status === 'running'}
                            >
                                <summary className="cursor-pointer select-none text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    ⚙ {t.name}{' '}
                                    {t.status === 'running'
                                        ? '…running'
                                        : t.status === 'error'
                                          ? '✗ error'
                                          : '✓'}
                                </summary>
                                {t.output && (
                                    <pre className="nowheel mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] leading-relaxed text-muted-foreground">
                                        {t.output}
                                    </pre>
                                )}
                            </details>
                        ))}
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
    );

    const footerInput = (
        <div className={cn('shrink-0 border-t border-border p-2', maximized && 'px-4')}>
            <input
                className="nodrag w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs outline-none placeholder:text-muted-foreground focus:border-ring"
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
    );

    return (
        <>
            {/* Normal canvas card */}
            <div
                className={cn(
                    'flex h-full w-full flex-col rounded-xl border bg-card shadow-sm transition-shadow',
                    focused ? 'border-ring shadow-md ring-2 ring-ring/30' : 'border-border',
                )}
            >
                <NodeResizer
                    isVisible={selected}
                    minWidth={320}
                    minHeight={260}
                    lineClassName="!border-primary/50"
                    handleClassName="!h-2 !w-2 !rounded-sm !border-primary/60 !bg-white"
                    onResizeEnd={(_e, params) =>
                        useCanvasStore
                            .getState()
                            .resizeCard(id, params.width, params.height)
                    }
                />

                <Handle type="target" position={Position.Top} className="!opacity-0" />
                <Handle type="source" position={Position.Bottom} className="!opacity-0" />

                {header(false)}
                {messagesBody}
                {footerInput}
            </div>

            {/* Full-screen mode — portal escapes React Flow's transformed canvas */}
            {maximized &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[999] flex items-center justify-center bg-black/70 p-6"
                        onClick={() => setMaximized(false)}
                    >
                        <div
                            className="flex h-full max-h-[92vh] w-full max-w-[95vw] flex-col rounded-xl border border-border bg-card shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {header(true)}
                            {/* Centered reading column — no full-width stretch */}
                            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col">
                                {messagesBody}
                                {footerInput}
                            </div>
                            <div className="flex shrink-0 justify-end border-t border-border p-1.5">
                                <button
                                    className="nodrag flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                                    onClick={() => setMaximized(false)}
                                    title="Minimize (back to canvas)"
                                >
                                    <Minimize2 className="size-3.5" /> minimize
                                </button>
                            </div>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

function MaximizeIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6V2h4M14 10v4h-4" strokeLinecap="round" />
            <rect x="2" y="2" width="12" height="12" rx="2" opacity="0.35" />
        </svg>
    );
}

export const ChatCardNode = ReactMemo(ChatCardNodeInner);
