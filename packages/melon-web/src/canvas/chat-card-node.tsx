import { memo as ReactMemo, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Handle,
    NodeResizer,
    Position,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { ArrowUp, BarChart3, Copy, Check, Minimize2, Plus, Square, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { confirmAction } from '@/components/dialogs';
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
            {run.args && (
                <pre className="m-0 whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                    $ {run.args}
                </pre>
            )}
            {run.output && (
                <pre className="nowheel m-0 max-h-48 overflow-auto whitespace-pre-wrap border-t border-border/60 px-2 py-1.5 text-[10px] leading-relaxed text-[#f8f8f2]">
                    {run.output || '(no output)'}
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


function buildTraceDump(card: {
    id: string;
    title?: string;
    model?: string;
    sessionFile?: string;
    sessionId?: string;
    permission?: string;
    vizMode?: boolean;
    events?: Array<{
        ts: number;
        durMs?: number;
        kind: string;
        name: string;
        detail?: string;
        status?: string;
    }>;
    messages: Array<{ role: string; text: string; thinking?: string; tools?: Array<{ name: string; status: string; output: string }> }>;
}): string {
    const lines: string[] = [
        'melon trajectory dump',
        `time: ${new Date().toISOString()}`,
        `card: ${card.id}  canvas name: ${card.title ?? ''}`,
        `model: ${card.model ?? 'unknown'}`,
        `session file: ${card.sessionFile ?? '(not attached)'}`,
        `permission: ${card.permission ?? 'full'}  vizMode: ${card.vizMode ? 'on' : 'off'}`,
        '',
        ...(card.events ?? []).map(
            (e) =>
                `[${new Date(e.ts).toISOString()}] ${e.kind.toUpperCase()} ${e.name}` +
                (e.durMs != null ? ` (${e.durMs}ms)` : '') +
                (e.detail ? `\n  ${e.detail.replace(/\n/g, '\n  ')}` : ''),
        ),
        '',
        ...card.messages.map((m) => {
            const tools = (m.tools ?? [])
                .map((t) => `  [tool ${t.name}] ${t.status}\n${t.output.split('\n').map((l) => '    ' + l).join('\n')}`)
                .join('\n');
            const think = m.thinking ? `  [thinking]\n${m.thinking.split('\n').map((l) => '    ' + l).join('\n')}` : '';
            return `[${m.role.toUpperCase()}]\n${m.text}${tools ? '\n' + tools : ''}${think}`;
        }),
    ];
    return lines.join('\n');
}

function CopyButton({ getText }: { getText: () => string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            className="nodrag flex items-center gap-1 rounded-md border border-input px-2 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={(e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(getText()).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1500);
                });
            }}
        >
            {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
            {copied ? 'copied ✓' : 'copy all'}
        </button>
    );
}


// ── Trajectory waterfall (DSH-style) ────────────────────────────────────
interface Turn {
    startTs: number;
    endTs: number;
    label: string;
    events: TraceEvent2[];
}
type TraceEvent2 = import('@/types/session-card').TraceEvent;

function buildTurns(events: TraceEvent2[]): Turn[] {
    const turns: Turn[] = [];
    let cur: Turn | null = null;
    for (const e of events) {
        if (e.kind === 'prompt') {
            cur = { startTs: e.ts, endTs: e.ts, label: e.name, events: [] };
            turns.push(cur);
        }
        if (!cur) {
            cur = { startTs: e.ts, endTs: e.ts, label: '(before first prompt)', events: [] };
            turns.push(cur);
        }
        cur.events.push(e);
        const eEnd = e.ts + (e.durMs ?? 0);
        if (eEnd > cur.endTs) cur.endTs = eEnd;
    }
    return turns;
}

function TrajectoryView({ card }: { card: NonNullable<ReturnType<typeof useCanvasStore.getState>['cards'][number]> }) {
    const [query, setQuery] = useState('');
    const [actualDuration, setActualDuration] = useState(true);
    const [showThinking, setShowThinking] = useState(true);
    const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<TraceEvent2 | null>(null);

    const allEvents = card.events ?? [];
    const filtered = allEvents.filter((e) => {
        if (!showThinking && e.kind === 'thinking') return false;
        if (!query) return true;
        const hay = `${e.name} ${e.detail ?? ''}`.toLowerCase();
        return hay.includes(query.toLowerCase());
    });
    const turns = buildTurns(filtered);

    return (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2">
            {/* Toolbar */}
            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="🔍 search trajectory"
                    className="w-40 rounded-md border border-input bg-background px-2 py-1 text-[10px] outline-none focus:border-ring"
                />
                <button
                    className={cn('rounded-md px-2 py-1 text-[10px] transition-colors', actualDuration ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-secondary')}
                    onClick={() => setActualDuration(!actualDuration)}
                >
                    {actualDuration ? '⏱ actual duration' : '▤ equal-width'}
                </button>
                <button
                    className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary"
                    onClick={() =>
                        setCollapsedTurns(
                            collapsedTurns.size > 0 ? new Set() : new Set(turns.map((_, i) => String(i))),
                        )
                    }
                >
                    {collapsedTurns.size > 0 ? 'Expand turns' : 'Collapse turns'}
                </button>
                <button
                    className={cn('rounded-md px-2 py-1 text-[10px]', showThinking ? 'text-primary' : 'text-muted-foreground hover:bg-secondary')}
                    onClick={() => setShowThinking(!showThinking)}
                >
                    Thinking
                </button>
                <CopyButton getText={() => buildTraceDump(card)} />
            </div>

            {/* Waterfall */}
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto font-mono text-[10px]">
                {turns.length === 0 && (
                    <p className="py-4 text-center text-muted-foreground">No activity yet.</p>
                )}
                {turns.map((turn, ti) => {
                    const span = Math.max(turn.endTs - turn.startTs, 1);
                    const key = `${card.id}:${ti}`;
                    const collapsed = collapsedTurns.has(key) || query.length > 0;
                    return (
                        <div key={key}>
                            <div
                                className="flex cursor-pointer items-center justify-between rounded-md bg-secondary/60 px-2 py-1"
                                onClick={() => {
                                    const next = new Set(collapsedTurns);
                                    next.has(key) ? next.delete(key) : next.add(key);
                                    setCollapsedTurns(next);
                                }}
                            >
                                <span className="truncate font-semibold text-card-foreground">
                                    {collapsedTurns.has(key) ? '▸' : '▾'} TURN {ti + 1}: "{turn.label}"
                                </span>
                                <span className="tabular-nums text-muted-foreground">
                                    {(turn.endTs - turn.startTs) / 1000}s · {turn.events.length} ops
                                </span>
                            </div>
                            {!collapsed && (
                                <div className="ml-3 border-l border-border pl-2">
                                    {turn.events.map((ev) => {
                                        if (ev.id === selected?.id && selected) {
                                            /* row rendered below */
                                        }
                                        const offset = actualDuration
                                            ? ((ev.ts - turn.startTs) / span) * 100
                                            : 0;
                                        const width = actualDuration
                                            ? Math.max(((ev.durMs ?? 80) / span) * 100, 1.5)
                                            : 60;
                                        const color =
                                            ev.kind === 'prompt' ? '#8be9fd' :
                                            ev.kind === 'thinking' ? '#bd93f9' :
                                            ev.kind === 'tool' ? (ev.status === 'error' ? '#ff5555' : '#50fa7b') :
                                            '#6272a4';
                                        const matches =
                                            selected !== null &&
                                            selected.ts === ev.ts &&
                                            selected.name === ev.name;
                                        return (
                                            <div
                                                key={ev.id}
                                                className={cn(
                                                    'group/row cursor-pointer rounded px-1 py-0.5 hover:bg-secondary/40',
                                                    matches && 'bg-secondary',
                                                )}
                                                onClick={() => setSelected(matches ? null : ev)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="w-24 shrink-0 truncate text-muted-foreground">
                                                        {ev.kind === 'prompt' ? '▶ prompt' : ev.kind === 'tool' ? `⚙ ${ev.name}` : ev.kind}
                                                    </span>
                                                    <div className="relative h-2.5 flex-1 rounded-sm bg-secondary/40">
                                                        <div
                                                            className="absolute top-0 h-full rounded-sm opacity-70"
                                                            style={{
                                                                left: `${offset}%`,
                                                                width: `${width}%`,
                                                                background: color,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="w-14 shrink-0 text-right tabular-nums text-muted-foreground">
                                                        {ev.durMs != null ? `${(ev.durMs / 1000).toFixed(2)}s` : '…'}
                                                    </span>
                                                </div>
                                                {selected && matches && (
                                                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background px-2 py-1 text-[9px] leading-relaxed">
                                                        {`${ev.name}\n${ev.detail ?? '(no detail)'}`}
                                                    </pre>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Inspect panel */}
            {selected && (
                <div className="mt-2 max-h-40 shrink-0 overflow-auto rounded-md border border-border bg-background p-2">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                        inspect: {selected.kind} — {selected.name}
                    </p>
                    <pre className="whitespace-pre-wrap break-words text-[10px] leading-relaxed text-muted-foreground">
                        {selected.detail ?? '(no detail captured)'}
                    </pre>
                </div>
            )}
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
    const [view, setView] = useState<'chat' | 'trajectory'>('chat');
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

    const submit = async () => {
        const text = draft.trim();
        if (!text) return;
        setDraft('');
        const ok = await sendMessage(id, text);
        if (!ok) setDraft(text); // failed — give the text back for retry
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
                    view === 'trajectory'
                        ? 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40'
                        : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                )}
                onClick={(e) => {
                    e.stopPropagation();
                    setView(view === 'trajectory' ? 'chat' : 'trajectory');
                }}
                title="Trajectory debugger"
            >
                🧭
            </button>
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
                    onClick={async (e) => {
                        e.stopPropagation();
                        const ok = await confirmAction({
                            title: 'Delete this card?',
                            description: 'You can restore it with Cmd/Ctrl+Z.',
                            confirmLabel: 'Delete',
                        });
                        if (ok) deleteCards([id]);
                    }}
                    title="Delete card"
                >
                    <X className="size-4" />
                </button>
            )}
        </div>
    );

    const trajectoryBody = <TrajectoryView card={card} />;

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
                        'max-w-[92%] overflow-hidden rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
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
                        // PERF: streaming tail renders as plain text — full
                        // markdown parsing per flush starved the main thread.
                        card.status === 'streaming' &&
                        i === messages.length - 1 ? (
                            <>
                                <div className="whitespace-pre-wrap break-words">
                                    {m.text}
                                </div>
                                {!m.text && m.thinking && (
                                    <span className="text-[10px] text-muted-foreground">…</span>
                                )}
                            </>
                        ) : (
                            <>
                                <MarkdownBlock content={m.text} />
                            </>
                        )
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
            {(card.queue?.length ?? 0) > 0 && (
                <div className="mb-1.5 space-y-0.5">
                    <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        ⏳ queued ({card.queue!.length}) — sends when current run finishes
                    </p>
                    {card.queue!.map((q, qi) => (
                        <div
                            key={qi}
                            className="truncate rounded-md bg-secondary/70 px-2 py-1 text-[10px] text-muted-foreground"
                        >
                            {q}
                        </div>
                    ))}
                </div>
            )}
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
                {view === 'trajectory' ? trajectoryBody : messagesBody}
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
                            <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col">
                                {view === 'trajectory' ? (
                                    trajectoryBody
                                ) : (
                                    <>
                                        {messagesBody}
                                        {footerInput}
                                    </>
                                )}
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
