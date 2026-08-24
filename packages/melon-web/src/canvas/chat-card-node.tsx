import { memo as ReactMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Handle,
    NodeResizer,
    Position,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { ArrowUp, BarChart3, Minimize2, Plus, Square, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { MarkdownBlock } from '@/components/markdown-block';
import { cn } from '@/lib/utils';

export type ChatCardNodeType = Node<{ cardId: string }, 'chatCard'>;

const statusDot: Record<string, string> = {
    idle: 'bg-[#50fa7b]',
    streaming: 'bg-[#f1fa8c] animate-pulse',
    error: 'bg-[#ff5555]',
};

/** 💭 Thinking — auto-expands while reasoning streams, auto-collapses when the answer begins. */
function ThinkingBlock({ text, active }: { text: string; active: boolean }) {
    const [open, setOpen] = useState(active);
    const prevActive = useRef(active);
    useEffect(() => {
        if (prevActive.current && !active) setOpen(false);
        if (!prevActive.current && active) setOpen(true);
        prevActive.current = active;
    }, [active]);
    return (
        <details
            className="mb-1.5 rounded-md border border-border/60 bg-background/60 px-2 py-1"
            open={open}
            onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="flex cursor-pointer select-none items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {active ? (
                    <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
                ) : (
                    '💭'
                )}
                {active ? 'Thinking…' : 'Thought process'}
            </summary>
            <div className="nowheel mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-2 text-[10px] italic leading-relaxed text-muted-foreground">
                {text || '…'}
            </div>
        </details>
    );
}

/** ⚙ Tool run — auto-expands while executing, collapses to a ✓/✗ summary line. */
function ToolRunBlock({ run }: { run: import('@/types/session-card').ToolRun }) {
    const [open, setOpen] = useState(run.status === 'running');
    const prevStatus = useRef(run.status);
    useEffect(() => {
        if (prevStatus.current === 'running' && run.status !== 'running') setOpen(false);
        if (prevStatus.current !== 'running' && run.status === 'running') setOpen(true);
        prevStatus.current = run.status;
    }, [run.status]);
    return (
        <details
            className="mb-1.5 overflow-hidden rounded-md border border-border/60 bg-[#21222c]"
            open={open}
            onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
        >
            <summary className="flex cursor-pointer select-none items-center gap-1.5 px-2 py-1 font-mono text-[10px] text-muted-foreground">
                {run.status === 'running' ? (
                    <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
                ) : run.status === 'error' ? (
                    <span className="text-[#f85149]">✗</span>
                ) : (
                    <span className="text-[#3fb950]">✓</span>
                )}
                <span className="font-semibold">{run.name}</span>
                <span className="ml-auto opacity-60">
                    {run.status === 'running'
                        ? 'running…'
                        : `${run.output.split('\n').length} lines`}
                </span>
            </summary>
            {run.output && (
                <pre className="nowheel m-0 max-h-48 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 text-[10px] leading-relaxed text-[#f8f8f2]">
                    {run.output}
                </pre>
            )}
        </details>
    );
}


/** ✨ Activity line — shimmering status while the agent works on your fresh message. */
const ACTIVITY_PHRASES = [
    'Deep diving…',
    'Reasoning…',
    'Connecting the dots…',
    'Reading context…',
    'Crafting response…',
];

function ActivityLine() {
    const [idx, setIdx] = useState(0);
    useEffect(() => {
        const t = setInterval(() => setIdx((i) => (i + 1) % ACTIVITY_PHRASES.length), 2200);
        return () => clearInterval(t);
    }, []);
    return (
        <div className="flex items-center gap-2 px-1 py-2">
            <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
            <span className="shimmer-text text-xs font-medium">{ACTIVITY_PHRASES[idx]}</span>
        </div>
    );
}

function ChatCardNodeInner({
    id,
    selected,
    dragging,
}: NodeProps<ChatCardNodeType>) {
    const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
    const forkCard = useCanvasStore((s) => s.forkCard);
    const deleteCards = useCanvasStore((s) => s.deleteCards);
    const sendMessage = useCanvasStore((s) => s.sendMessage);
    const folder = useCanvasStore((s) => s.folder);
    const [draft, setDraft] = useState('');
    const [maximized, setMaximized] = useState(false);
    const [models, setModels] = useState<Array<{ label: string }>>([]);

    useEffect(() => {
        if (models.length > 0) return;
        fetch('http://127.0.0.1:8788/models')
            .then((r) => r.json())
            .then((d) => setModels(d.models ?? []))
            .catch(() => {});
    }, [models.length]);

    const growTextarea = (el: HTMLTextAreaElement | null) => {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
    };

    const abortStream = () => {
        fetch(`http://127.0.0.1:8788/sessions/${id}/abort`, { method: 'POST' }).catch(() => {});
    };
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
    // Defensive: older persisted workspaces may lack newer fields.
    const messages = card.messages ?? [];

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
                className={cn(
                    'nodrag flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
                    card.vizMode
                        ? 'bg-primary/15 text-primary ring-1 ring-inset ring-primary/40'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    useCanvasStore.getState().updateCard(id, {
                        vizMode: !card.vizMode,
                    });
                }}
                title={card.vizMode ? 'Visualization mode ON' : 'Visualization mode OFF'}
            >
                <BarChart3 className="size-3.5" />
                Viz
            </button>
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
            {messages.length === 0 && (
                <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                    Ask something to start this thread.
                </p>
            )}
            {messages.map((m: import('@/types/session-card').ChatMessage, i: number) => (
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
                        (m.tools ?? []).map((t) => <ToolRunBlock key={t.callId} run={t} />)}
                    {m.role === 'assistant' && m.thinking != null && (
                        <ThinkingBlock
                            text={m.thinking}
                            active={!m.text && card.status === 'streaming'}
                        />
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
            {card.status === 'streaming' &&
                (card.messages.length === 0 ||
                    card.messages[card.messages.length - 1]?.role === 'user') && (
                <ActivityLine />
            )}
        </div>
    );

    const footerInput = (
        <div className={cn('shrink-0 border-t border-border p-2', maximized && 'px-4')}>
            <div className="rounded-xl border border-input bg-background focus-within:border-ring">
                <textarea
                    rows={1}
                    value={draft}
                    ref={(el) => growTextarea(el)}
                    onChange={(e) => {
                        setDraft(e.target.value);
                        growTextarea(e.target);
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                        }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Ask anything…  (Enter to send, Shift+Enter for newline)"
                    className="nowheel block max-h-[120px] w-full resize-none bg-transparent px-3 pt-2.5 text-xs leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-1 px-2 pb-1.5 pt-1">
                    {folder && (
                        <span
                            className="truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
                            title={`Workspace: ${folder}`}
                        >
                            📁 {folder.split('/').pop()}
                        </span>
                    )}
                    <select
                        className="max-w-[150px] cursor-pointer truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground"
                        title="Model"
                        value={card.model ?? ''}
                        onChange={(e) =>
                            useCanvasStore.getState().updateCard(id, { model: e.target.value })
                        }
                        onClick={(e) => e.stopPropagation()}
                    >
                        {(card.model && !models.some((m) => m.label === card.model)
                            ? [{ label: card.model }, ...models]
                            : models
                        ).map((m) => (
                            <option key={m.label} value={m.label}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                    <select
                        className="cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground"
                        title="Workspace permissions"
                        value={card.permission ?? 'full'}
                        onChange={(e) =>
                            useCanvasStore.getState().updateCard(id, {
                                permission: e.target.value as 'full' | 'readonly',
                            })
                        }
                        onClick={(e) => e.stopPropagation()}
                    >
                        <option value="full">🔓 full access</option>
                        <option value="readonly">🔒 read-only</option>
                    </select>
                    <button
                        className={cn(
                            'ml-auto flex size-7 items-center justify-center rounded-full transition-colors',
                            card.status === 'streaming'
                                ? 'bg-foreground text-background hover:bg-foreground/80'
                                : draft.trim()
                                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                                  : 'bg-secondary text-muted-foreground',
                        )}
                        title={card.status === 'streaming' ? 'Stop' : 'Send'}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (card.status === 'streaming') abortStream();
                            else submit();
                        }}
                    >
                        {card.status === 'streaming' ? (
                            <Square className="size-3" fill="currentColor" />
                        ) : (
                            <ArrowUp className="size-4" />
                        )}
                    </button>
                </div>
            </div>
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
