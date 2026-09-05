import { memo as ReactMemo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
    Handle,
    NodeResizer,
    Position,
    useReactFlow,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { Bug, ChevronDown, Copy, Minimize2, MoreHorizontal, Pencil, Plus, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { MarkdownBlock } from '@/components/markdown-block';
import { PromptComposer } from '@/components/prompt-composer';
import { QuestionPanel } from '@/components/question-panel';
import { ToolRunBlock } from '@/components/tool-run-block';
import { DEFAULT_CARD_SIZE, type TraceEvent } from '@/types/session-card';
import { cn } from '@/lib/utils';

export type ChatCardNodeType = Node<{ cardId: string }, 'chatCard'>;

const statusDot: Record<string, string> = {
    idle: 'bg-muted-foreground/35',
    streaming: 'bg-[#50fa7b] animate-pulse',
    error: 'bg-[#ff5555]',
};

// ── Persistent block UI state (survives re-renders AND remounts) ─────────
const blockUi = new Map<string, boolean>();
function uiFlag(key: string, fallback: boolean): boolean {
    return blockUi.has(key) ? (blockUi.get(key) as boolean) : fallback;
}
function setUiFlag(key: string, v: boolean) {
    blockUi.set(key, v);
}

function Spinner() {
    return (
        <span className="inline-block size-2.5 animate-spin rounded-full border-2 border-muted-foreground/40 border-t-muted-foreground" />
    );
}

// ── 💭 Thinking ──────────────────────────────────────────────────────────
type MessageShape = {
    role: string;
    text: string;
    thinking?: string;
    tools?: Array<{
        callId: string;
        name: string;
        status: string;
        args?: string;
        argsStructured?: Record<string, unknown>;
        output: string;
    }>;
};

// MODULE-LEVEL + memoized: a stable component identity means React reconciles
// messages on re-render instead of REMOUNTING them (which reloaded viz iframes
// and made the chat bounce up/down while typing).
const MessageBlocks = ReactMemo(function MessageBlocks({
    m,
    index,
    cardId,
    streaming,
    totalMessages,
}: {
    m: MessageShape;
    index: number;
    cardId: string;
    streaming: boolean;
    totalMessages: number;
}) {
    if (m.role === 'user') {
        return (
            <div className="flex justify-end">
                <div className="max-w-[92%] overflow-hidden rounded-xl bg-primary/10 px-3 py-1.5 text-xs leading-relaxed text-primary">
                    {m.text}
                </div>
            </div>
        );
    }
    const isStreamingTail = streaming && index === totalMessages - 1;
    const hasTools = (m.tools ?? []).length > 0;
    // Thinking is live until this turn produces tools or answer text.
    const thinkingActive =
        isStreamingTail && !!m.thinking && !m.text.trim() && !hasTools;
    return (
        <div className="min-w-0 space-y-2 pl-1">
            {m.thinking != null && m.thinking.length > 0 && (
                <ThinkingBlock
                    cardId={cardId}
                    index={index}
                    text={m.thinking}
                    active={thinkingActive}
                />
            )}
            {(m.tools ?? []).map((t) => (
                <ToolRunBlock
                    key={t.callId}
                    cardId={cardId}
                    run={{
                        callId: t.callId,
                        name: t.name,
                        status: (t.status as 'running' | 'ok' | 'error') || 'ok',
                        args: t.args,
                        argsStructured: t.argsStructured,
                        output: t.output,
                    }}
                />
            ))}
            {(isStreamingTail ? m.text.length > 0 : m.text.trim()) ? (
                <div className="rounded-lg bg-secondary/40 px-3 py-2">
                    <MarkdownBlock content={m.text} streaming={isStreamingTail} />
                </div>
            ) : null}
        </div>
    );
});

function ThinkingBlock({
    cardId,
    index,
    text,
    active,
}: {
    cardId: string;
    index: number;
    text: string;
    active: boolean;
}) {
    const key = `${cardId}:think:${index}`;
    const [open, setOpen] = useState(() => uiFlag(key, true));
    const prevActive = useRef(active);
    const autoControlled = useRef(true);
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Live thinking: force open so the stream is visible.
        // Finished thinking: auto-collapse unless the user took control.
        if (active && autoControlled.current) {
            setOpen(true);
            setUiFlag(key, true);
        } else if (prevActive.current && !active && autoControlled.current) {
            setOpen(false);
            setUiFlag(key, false);
        }
        prevActive.current = active;
    }, [active, key]);

    // Keep the latest thought in view while it streams.
    useEffect(() => {
        if (!active || !open) return;
        const el = bodyRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [text, active, open]);

    return (
        <div
            className={cn(
                'rounded-lg border bg-background/40',
                active ? 'border-primary/35' : 'border-border/70',
            )}
        >
            <button
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                onClick={() => {
                    autoControlled.current = false;
                    const next = !open;
                    setOpen(next);
                    setUiFlag(key, next);
                }}
            >
                {active ? <Spinner /> : <span className="text-muted-foreground">💭</span>}
                <span
                    className={cn(
                        'flex-1 text-[10px] font-medium uppercase tracking-wide',
                        active ? 'shimmer-text' : 'text-muted-foreground',
                    )}
                >
                    {active ? 'Thinking…' : 'Thought process'}
                </span>
                <span className="text-[9px] text-muted-foreground/60">{text.length} chars</span>
            </button>
            {open && (
                <div
                    ref={bodyRef}
                    className="nowheel max-h-56 overflow-y-auto whitespace-pre-wrap border-t border-border/50 px-2.5 py-1.5 text-[10px] italic leading-relaxed text-muted-foreground"
                >
                    {text || '…'}
                </div>
            )}
        </div>
    );
}

// ── Activity status above the inbox (ChatGPT/Claude-style strip) ─────────
type ActivityPhase = 'waiting' | 'thinking' | 'tools' | 'responding' | 'working';

const PHASE_LABEL: Record<ActivityPhase, string> = {
    waiting: 'Working',
    thinking: 'Thinking',
    tools: 'Running tools',
    responding: 'Writing',
    working: 'Working',
};

function deriveActivityPhase(
    card: NonNullable<ReturnType<typeof useCanvasStore.getState>['cards'][number]>,
): ActivityPhase {
    const last = card.messages[card.messages.length - 1];
    if (!last || last.role === 'user') return 'waiting';
    const tools = last.tools ?? [];
    if (tools.some((t) => t.status === 'running')) return 'tools';
    if (last.thinking && !last.text.trim() && tools.length === 0) return 'thinking';
    if (last.text.trim()) return 'responding';
    return 'working';
}

// ── Trajectory waterfall (DSH-style) ─────────────────────────────────────
type TraceEvent2 = TraceEvent;

function buildTurns(events: TraceEvent2[]) {
    const turns: Array<{ startTs: number; endTs: number; label: string; events: TraceEvent2[] }> = [];
    let cur: { startTs: number; endTs: number; label: string; events: TraceEvent2[] } | null = null;
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

function buildTraceDump(card: NonNullable<ReturnType<typeof useCanvasStore.getState>['cards'][number]>): string {
    const lines: string[] = [
        'melon trajectory dump',
        `time: ${new Date().toISOString()}`,
        `card: ${card.id}  canvas name: ${card.title ?? ''}`,
        `model: ${card.model ?? 'unknown'}`,
        `session file: ${card.sessionFile ?? '(not attached)'}`,
        `permission: ${card.permission ?? 'full'}  vizMode: ${card.vizMode ? 'on' : 'off'}`,
        '',
    ];
    for (const e of card.events ?? []) {
        lines.push(
            `[${new Date(e.ts).toISOString()}] ${e.kind.toUpperCase()} ${e.name}` +
                (e.durMs != null ? ` (${e.durMs}ms)` : '') +
                (e.detail ? '\n  ' + String(e.detail).split('\n').join('\n  ') : ''),
        );
    }
    for (const m of card.messages) {
        lines.push(`[${m.role.toUpperCase()}] ${m.text}`);
        for (const t of m.tools ?? []) {
            lines.push(
                '  [tool ' +
                    t.name +
                    '] ' +
                    t.status +
                    '\n' +
                    t.output
                        .split('\n')
                        .map((l) => '    ' + l)
                        .join('\n'),
            );
        }
        if (m.thinking) {
            lines.push(
                '  [thinking]\n' +
                    m.thinking
                        .split('\n')
                        .map((l) => '    ' + l)
                        .join('\n'),
            );
        }
    }
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
            {copied ? '✓ copied' : 'copy all'}
        </button>
    );
}

function TrajectoryView({
    card,
}: {
    card: NonNullable<ReturnType<typeof useCanvasStore.getState>['cards'][number]>;
}) {
    const [query, setQuery] = useState('');
    const [actualDuration, setActualDuration] = useState(true);
    const [showThinking, setShowThinking] = useState(true);
    const [collapsedTurns, setCollapsedTurns] = useState<Set<string>>(new Set());
    const [selected, setSelected] = useState<TraceEvent2 | null>(null);

    const filtered = (card.events ?? []).filter((e) => {
        if (!showThinking && e.kind === 'thinking') return false;
        if (!query) return true;
        return `${e.name} ${e.detail ?? ''}`.toLowerCase().includes(query.toLowerCase());
    });
    const turns = buildTurns(filtered);

    return (
        <div className="nowheel flex min-h-0 flex-1 flex-col overflow-hidden px-3 py-2">
            <div className="mb-2 flex shrink-0 flex-wrap items-center gap-1.5">
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="🔍 search trajectory"
                    className="w-40 rounded-md border border-input bg-background px-2 py-1 text-[10px] outline-none focus:border-ring"
                />
                <button
                    className={cn(
                        'rounded-md px-2 py-1 text-[10px] transition-colors',
                        actualDuration ? 'bg-secondary text-primary' : 'text-muted-foreground hover:bg-secondary',
                    )}
                    onClick={() => setActualDuration(!actualDuration)}
                >
                    {actualDuration ? '⏱ actual duration' : '▤ equal-width'}
                </button>
                <button
                    className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-secondary"
                    onClick={() =>
                        setCollapsedTurns(collapsedTurns.size > 0 ? new Set() : new Set(turns.map((_, i) => String(i))))
                    }
                >
                    {collapsedTurns.size > 0 ? 'Expand turns' : 'Collapse turns'}
                </button>
                <button
                    className={cn(
                        'rounded-md px-2 py-1 text-[10px]',
                        showThinking ? 'text-primary' : 'text-muted-foreground hover:bg-secondary',
                    )}
                    onClick={() => setShowThinking(!showThinking)}
                >
                    Thinking
                </button>
                <CopyButton getText={() => buildTraceDump(card)} />
            </div>

            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto font-mono text-[10px]">
                {turns.length === 0 && <p className="py-4 text-center text-muted-foreground">No activity yet.</p>}
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
                                    if (next.has(key)) next.delete(key);
                                    else next.add(key);
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
                                        const offset = actualDuration
                                            ? ((ev.ts - turn.startTs) / span) * 100
                                            : 0;
                                        const width = actualDuration
                                            ? Math.max(((ev.durMs ?? 80) / span) * 100, 1.5)
                                            : 60;
                                        const color =
                                            ev.kind === 'prompt'
                                                ? '#8be9fd'
                                                : ev.kind === 'thinking'
                                                  ? '#bd93f9'
                                                  : ev.kind === 'tool'
                                                    ? ev.status === 'error'
                                                        ? '#ff5555'
                                                        : '#50fa7b'
                                                    : '#6272a4';
                                        const isSelected = selected?.id === ev.id;
                                        return (
                                            <div
                                                key={ev.id}
                                                className={cn(
                                                    'cursor-pointer rounded px-1 py-0.5 hover:bg-secondary/40',
                                                    isSelected && 'bg-secondary',
                                                )}
                                                onClick={() => setSelected(isSelected ? null : ev)}
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span className="w-24 shrink-0 truncate text-muted-foreground">
                                                        {ev.kind === 'prompt'
                                                            ? '▶ prompt'
                                                            : ev.kind === 'tool'
                                                              ? `⚙ ${ev.name}`
                                                              : ev.kind}
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
                                                {isSelected && (
                                                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded bg-background px-2 py-1 text-[9px] leading-relaxed">
                                                        {`${ev.name}\n${ev.detail ?? '(no detail captured)'}`}
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

function CardMoreMenu({
    debug,
    onToggleDebug,
    contextLabel,
}: {
    debug: boolean;
    onToggleDebug: () => void;
    contextLabel: string | null;
}) {
    const [open, setOpen] = useState(false);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (!rootRef.current?.contains(e.target as globalThis.Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', onDoc);
        window.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            window.removeEventListener('keydown', onKey, true);
        };
    }, [open]);

    return (
        <div ref={rootRef} className="relative">
            <button
                type="button"
                className={cn(
                    'nodrag rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
                    open && 'bg-secondary text-foreground',
                )}
                aria-label="More actions"
                aria-expanded={open}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen((v) => !v);
                }}
            >
                <MoreHorizontal className="size-4" />
            </button>
            {open && (
                <div
                    className="nodrag absolute right-0 top-full z-50 mt-1 min-w-[11.5rem] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl"
                    onClick={(e) => e.stopPropagation()}
                >
                    {contextLabel && (
                        <div className="border-b border-border/70 px-3 py-2 text-[11px] text-muted-foreground">
                            Context · {contextLabel}
                        </div>
                    )}
                    <button
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-card-foreground hover:bg-secondary"
                        onClick={() => {
                            onToggleDebug();
                            setOpen(false);
                        }}
                    >
                        <Bug className={cn('size-3.5', debug ? 'text-amber-500' : 'text-muted-foreground')} />
                        {debug ? 'Hide debug' : 'Show debug'}
                    </button>
                </div>
            )}
        </div>
    );
}

// ── Card node ────────────────────────────────────────────────────────────
function ChatCardNodeInner({
    id,
    selected,
    dragging,
}: NodeProps<ChatCardNodeType>) {
    const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
    const forkCard = useCanvasStore((s) => s.forkCard);
    const deleteCards = useCanvasStore((s) => s.deleteCards);
    const sendMessage = useCanvasStore((s) => s.sendMessage);
    const serverOffline = useCanvasStore((s) => s.serverOffline);
    const { setCenter, getZoom } = useReactFlow();
    // The composer draft lives on the card in the store, not in component state:
    // ReactFlow unmounts off-screen nodes (onlyRenderVisibleElements), so local
    // state would be dropped whenever the card scrolls out of view or the canvas
    // is switched, silently erasing what the user typed.
    const draft = card?.draft ?? '';
    const setDraft = useCallback(
        (next: string | ((prev: string) => string)) => useCanvasStore.getState().setCardDraft(id, next),
        [id],
    );
    const [maximized, setMaximized] = useState(false);
    const [view, setView] = useState<'chat' | 'trajectory'>('chat');
    const [editingTitle, setEditingTitle] = useState(false);
    const dbg = (...args: unknown[]) => console.log('[ui-debug]', ...args);
    useEffect(() => { dbg('card mounted', id); }, []);
    const scrollRef = useRef<HTMLDivElement>(null);
    const maxScrollRef = useRef<HTMLDivElement>(null);
    const atBottomRef = useRef(true); // user pinned to the newest output?
    const [showDown, setShowDown] = useState(false); // floating ↓ button
    const lastMsg = card?.messages[card.messages.length - 1];

    const handleMessagesScroll = (el: HTMLDivElement) => {
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        dbg('scroll', `st=${el.scrollTop} sh=${el.scrollHeight} ch=${el.clientHeight} atBottom=${near}`);
        atBottomRef.current = near;
        setShowDown(!near); // React bails out when unchanged
    };
    const goToBottom = () => {
        dbg('DOWN-ARROW clicked — jumping to bottom');
        atBottomRef.current = true;
        setShowDown(false);
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        const el2 = maxScrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight;
    };

    // Auto-follow ONLY while the user is at the bottom. If they scroll away,
    // new output must NOT yank them down — the ↓ button returns them instead.
    useEffect(() => {
        dbg('stream-change fired', `atBottom=${atBottomRef.current} msgs=${card?.messages.length}`);
        if (!atBottomRef.current) return; // user scrolled away — DO NOT yank
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        const el2 = maxScrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight;
    }, [card?.messages.length, lastMsg?.text, lastMsg?.thinking, lastMsg?.tools, card?.status]);

    // Fixed-height card: growing the input footer shrinks the messages viewport.
    // If the user is pinned to the bottom, snap back on ANY resize so typing
    // never pushes the chat up/down.
    useEffect(() => {
        const attach = (el: HTMLDivElement | null) => {
            if (!el) return;
            const ro = new ResizeObserver((entries) => {
                const cr = entries[0]?.contentRect;
                dbg('viewport-resize', `ch=${cr?.height?.toFixed(0)} atBottom=${atBottomRef.current} ${atBottomRef.current ? '→ snap' : '→ leave'}`);
                if (atBottomRef.current) el.scrollTop = el.scrollHeight;
            });
            ro.observe(el);
            return () => ro.disconnect();
        };
        const d1 = attach(scrollRef.current);
        const d2 = attach(maxScrollRef.current);
        return () => {
            d1?.();
            d2?.();
        };
    }, [maximized]);

    // Copy selected text with Ctrl+G / Cmd+G — works in the card without expanding.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'g') return;
            const el = document.activeElement;
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
            const sel = window.getSelection()?.toString();
            if (sel) {
                e.preventDefault();
                navigator.clipboard.writeText(sel).catch(() => {});
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    const abortStream = () => {
        useCanvasStore.getState().abortCard(id);
    };

    useEffect(() => {
        if (!maximized) return;
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setMaximized(false);
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [maximized]);

    useEffect(() => {
        if (!card?.pendingDraft) return;
        // APPEND, never overwrite — the user may be typing already.
        setDraft((prev) => (prev ? `${prev}\n\n${card.pendingDraft}` : card.pendingDraft!));
        useCanvasStore.getState().updateCard(id, { pendingDraft: undefined });
    }, [card?.pendingDraft, id, setDraft]);

    // The persisted queue is a mirror of pi's in-memory queue, which dies
    // with the server. Resync once per mount so stale chips (app restart,
    // page reload) never show messages that will never run.
    // biome-ignore lint/correctness/useExhaustiveDependencies: once per mount
    useEffect(() => {
        if (!card?.sessionFile) return;
        void useCanvasStore.getState().syncQueued(id);
    }, [id]);

    if (!card) return null;

    const focused = !!selected && !dragging;

    const submit = async () => {
        const text = draft.trim();
        if (!text) return;
        setDraft('');
        const ok = await sendMessage(id, text);
        // Failed — hand the text back behind anything typed since, never over it.
        if (!ok) setDraft((prev) => (prev ? `${prev}\n\n${text}` : text));
    };

    const forkThis = () => {
        void (async () => {
            const newId = await forkCard(id);
            const child = useCanvasStore.getState().cards.find((c) => c.id === newId);
            if (!child) return;
            const w = child.size?.width ?? DEFAULT_CARD_SIZE.width;
            const h = child.size?.height ?? DEFAULT_CARD_SIZE.height;
            setCenter(child.position.x + w / 2, child.position.y + h / 2, {
                zoom: getZoom(),
                duration: 320,
            });
        })();
    };

    const contextPct =
        card.contextUsage?.percent != null ? Math.round(card.contextUsage.percent) : null;
    const contextLabel =
        contextPct != null && card.contextUsage
            ? `${contextPct}% · ${(card.contextUsage.tokens ?? 0).toLocaleString()} / ${card.contextUsage.contextWindow.toLocaleString()} tokens`
            : null;

    const header = (isMax: boolean) => (
        <div
            className={cn(
                'flex shrink-0 items-center gap-2 border-b border-border',
                isMax ? 'px-5 py-2.5' : 'rounded-t-xl px-3 py-2',
            )}
        >
            <span className={cn('size-2 shrink-0 rounded-full', statusDot[card.status])} />
            {editingTitle ? (
                <input
                    autoFocus
                    defaultValue={card.title}
                    className="nodrag min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-medium text-card-foreground outline-none"
                    onBlur={(e) => {
                        setEditingTitle(false);
                        const t = e.target.value.trim();
                        if (t && t !== card.title) useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            const t = (e.target as HTMLInputElement).value.trim();
                            setEditingTitle(false);
                            if (t && t !== card.title) useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
                        } else if (e.key === 'Escape') {
                            setEditingTitle(false);
                        }
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                />
            ) : (
                <span
                    className="min-w-0 flex-1 cursor-text truncate text-sm font-medium tracking-tight text-card-foreground"
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingTitle(true);
                    }}
                >
                    {card.title}
                </span>
            )}

            {isMax ? (
                <>
                    {/* Context only when it starts to matter — avoid chrome noise. */}
                    {contextPct != null && contextPct >= 70 && (
                        <span
                            className={cn(
                                'hidden shrink-0 text-[11px] tabular-nums sm:inline',
                                contextPct >= 90 ? 'text-[#ff5555]' : 'text-muted-foreground',
                            )}
                            title={contextLabel ?? undefined}
                        >
                            {contextPct}%
                        </span>
                    )}
                    <CardMoreMenu
                        debug={card.debug === true}
                        contextLabel={contextLabel}
                        onToggleDebug={() =>
                            useCanvasStore.getState().updateCard(id, { debug: !card.debug })
                        }
                    />
                    <button
                        type="button"
                        className="nodrag flex items-center gap-1.5 rounded-md border border-border/80 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMaximized(false);
                        }}
                        title="Back to canvas (Esc)"
                    >
                        <Minimize2 className="size-3.5" />
                        Canvas
                    </button>
                </>
            ) : (
                <>
                    {card.contextUsage?.percent != null && (
                        <div
                            className="flex shrink-0 items-center gap-1"
                            title={`Context window: ${Math.round(card.contextUsage.percent)}% — ${(card.contextUsage.tokens ?? 0).toLocaleString()} of ${card.contextUsage.contextWindow.toLocaleString()} tokens`}
                        >
                            <div className="h-1 w-12 overflow-hidden rounded-full bg-secondary">
                                <div
                                    className="h-full rounded-full transition-all"
                                    style={{
                                        width: `${Math.min(card.contextUsage.percent, 100)}%`,
                                        background:
                                            card.contextUsage.percent < 70
                                                ? '#50fa7b'
                                                : card.contextUsage.percent < 90
                                                  ? '#ffb86c'
                                                  : '#ff5555',
                                    }}
                                />
                            </div>
                            <span className="text-[9px] tabular-nums text-muted-foreground">
                                {Math.round(card.contextUsage.percent)}%
                            </span>
                        </div>
                    )}
                    {/* TRAJECTORY DISABLED — re-enable later by changing {false && ...} to {true && ...} */}
                    {false && (
                        <button
                            className={cn(
                                'nodrag rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
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
                    )}
                    <button
                        className={cn(
                            'nodrag flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors',
                            card.debug === true
                                ? 'bg-amber-500/15 text-amber-500 ring-1 ring-inset ring-amber-500/40'
                                : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                        )}
                        onClick={(e) => {
                            e.stopPropagation();
                            useCanvasStore.getState().updateCard(id, { debug: !card.debug });
                        }}
                        title={card.debug === true ? 'Debug console ON' : 'Debug console OFF'}
                    >
                        <Bug className="size-3.5" />
                        DBG
                    </button>
                    <button
                        className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                        disabled={serverOffline}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (serverOffline) return;
                            forkThis();
                        }}
                        title={serverOffline ? 'Reconnecting to server…' : 'Fork this conversation'}
                    >
                        <Plus className="size-4" />
                    </button>
                    <button
                        className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMaximized(true);
                        }}
                        title="Full screen"
                    >
                        <MaximizeIcon />
                    </button>
                    <button
                        className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
                        onClick={async (e) => {
                            e.stopPropagation();
                            const ok = await import('@/components/dialogs').then((m) =>
                                m.confirmAction({
                                    title: 'Delete this card?',
                                    description: 'You can restore it with Cmd/Ctrl+Z.',
                                    confirmLabel: 'Delete',
                                }),
                            );
                            if (ok) deleteCards([id]);
                        }}
                        title="Delete card"
                    >
                        <X className="size-4" />
                    </button>
                </>
            )}
        </div>
    );

    /** One assistant message = independent sibling blocks (DSH-style). */
    // MessageBlocks now lives at module level (stable identity — an inline
    // component here caused React to remount every message on each render,
    // reloading viz iframes and making the chat bounce).

    const messagesBody = (scrollTo: React.RefObject<HTMLDivElement>, opts?: { roomy?: boolean }) => {
        const streaming = card.status === 'streaming';
        return (
        <div className="relative min-h-0 min-w-0 flex-1">
            <div
                ref={scrollTo}
                onScroll={(e) => handleMessagesScroll(e.currentTarget)}
                className={cn(
                    'nodrag nowheel h-full cursor-default select-text space-y-4 overflow-y-auto',
                    opts?.roomy ? 'px-1 py-5 sm:px-2' : 'px-4 py-3',
                )}
            >
                {card.messages.length === 0 && !streaming && (
                    <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                        Ask something to start this thread.
                    </p>
                )}
                {card.messages.map((m, i) => (
                    <MessageBlocks
                        key={i}
                        m={m}
                        index={i}
                        cardId={id}
                        streaming={streaming}
                        totalMessages={card.messages.length}
                    />
                ))}
            </div>
            {showDown && (
                <button
                    className="nodrag absolute bottom-3 right-3 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-secondary hover:text-foreground"
                    onClick={(e) => {
                        e.stopPropagation();
                        goToBottom();
                    }}
                    title="Scroll to latest output"
                >
                    <ChevronDown className="size-4" />
                </button>
            )}
        </div>
        );
    };

    const activityLabel =
        card.status === 'streaming' ? PHASE_LABEL[deriveActivityPhase(card)] : null;

    const footerInput = (
        <div className={cn('shrink-0 border-t border-border', maximized ? 'px-0 py-3' : 'p-2')}>
            {card.pendingExtensionUi && (
                <QuestionPanel
                    pending={card.pendingExtensionUi}
                    onRespond={(body) => {
                        void useCanvasStore.getState().respondExtensionUi(id, body);
                    }}
                />
            )}
            {(card.queue?.length ?? 0) > 0 && (
                <div className="mb-1.5 space-y-1">
                    {card.queue!.map((q, i) => (
                        <div
                            key={i}
                            className="flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-1 text-[11px] text-amber-500/90"
                        >
                            <span className="truncate" title={q}>
                                ⏳ queued — runs after the current answer: {q}
                            </span>
                            <button
                                className="nodrag ml-auto shrink-0 rounded p-0.5 text-amber-500/70 hover:bg-amber-500/20 hover:text-amber-500"
                                title="Move back to the composer to edit"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void (async () => {
                                        const r = await useCanvasStore.getState().dropQueued(id, q);
                                        // Consumed items belong to the transcript, not the composer.
                                        if (r === 'removed' || r === 'dead') {
                                            setDraft((prev) => (prev ? `${prev}\n\n${q}` : q));
                                        }
                                    })();
                                }}
                            >
                                <Pencil className="size-3" />
                            </button>
                            <button
                                className="nodrag shrink-0 rounded p-0.5 text-amber-500/70 hover:bg-amber-500/20 hover:text-amber-500"
                                title="Cancel queued message"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    void useCanvasStore.getState().dropQueued(id, q);
                                }}
                            >
                                <X className="size-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}
            {activityLabel && (
                <div
                    className="mb-1.5 flex items-center gap-1.5 px-0.5 text-muted-foreground"
                    aria-live="polite"
                >
                    <span className="size-1.5 shrink-0 rounded-full bg-[#50fa7b] animate-pulse" />
                    <span className="text-[11px] tracking-tight">{activityLabel}</span>
                </div>
            )}
            <PromptComposer
                value={draft}
                onChange={setDraft}
                onSubmit={submit}
                model={card.model ?? ''}
                onModelChange={(model) => useCanvasStore.getState().setModel(id, model)}
                thinkingLevel={card.thinkingLevel}
                thinkingLevels={card.thinkingLevels}
                onThinkingChange={(level) => useCanvasStore.getState().setThinkingLevel(id, level)}
                skills={card.skills ?? []}
                onSkillsChange={(skills) => useCanvasStore.getState().setSkills(id, skills)}
                permission={card.permission ?? 'full'}
                onPermissionChange={(permission) =>
                    useCanvasStore.getState().updateCard(id, { permission })
                }
                sending={card.status === 'streaming'}
                onStop={abortStream}
                disabled={serverOffline}
                cardId={id}
                placeholder={
                    serverOffline
                        ? 'Reconnecting to server…'
                        : 'Ask anything…  (Enter to send, Shift+Enter for newline)'
                }
            />
        </div>
    );

    const trajectoryBody = <TrajectoryView card={card} />;

    return (
        <>
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
                    onResizeStart={() => useCanvasStore.getState().beginCardGesture()}
                    onResizeEnd={(_e, params) =>
                        useCanvasStore.getState().resizeCard(id, params.width, params.height)
                    }
                />

                <Handle type="target" position={Position.Top} className="!opacity-0" />
                <Handle type="target" position={Position.Bottom} className="!opacity-0" />
                <Handle type="target" position={Position.Left} className="!opacity-0" />
                <Handle type="target" position={Position.Right} className="!opacity-0" />
                <Handle type="source" position={Position.Top} className="!opacity-0" />
                <Handle type="source" position={Position.Bottom} className="!opacity-0" />
                <Handle type="source" position={Position.Left} className="!opacity-0" />
                <Handle type="source" position={Position.Right} className="!opacity-0" />

                {header(false)}
                {card.error && (
                    <div className="nodrag flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-2">
                        <span className="shrink-0 text-xs">⚠️</span>
                        <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-red-300">
                            {card.error}
                        </span>
                        <button
                            className="nodrag shrink-0 rounded p-0.5 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-200"
                            onClick={(e) => {
                                e.stopPropagation();
                                useCanvasStore.getState().clearCardError(id);
                            }}
                            title="Dismiss error"
                        >
                            <X className="size-3.5" />
                        </button>
                    </div>
                )}
                {view === 'trajectory' ? trajectoryBody : messagesBody(scrollRef)}
                {card.debug === true && <DebugConsole logs={card.logs ?? []} />}
                {footerInput}
            </div>

            {maximized &&
                createPortal(
                    <div
                        className="fixed inset-0 z-[999] flex flex-col bg-card"
                        role="dialog"
                        aria-modal="true"
                        aria-label={card.title || 'Chat'}
                    >
                        {header(true)}
                        {card.error && (
                            <div className="nodrag flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-2">
                                <span className="shrink-0 text-xs">⚠️</span>
                                <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-red-300">
                                    {card.error}
                                </span>
                                <button
                                    className="nodrag shrink-0 rounded p-0.5 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-200"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        useCanvasStore.getState().clearCardError(id);
                                    }}
                                    title="Dismiss error"
                                >
                                    <X className="size-3.5" />
                                </button>
                            </div>
                        )}
                        {/* Wider reading column (~72rem) — gutters shrink without billboard-width lines. */}
                        <div className="mx-auto flex min-h-0 w-full max-w-[72rem] flex-1 flex-col px-5 sm:px-8 lg:px-10">
                            {view === 'trajectory' ? (
                                <TrajectoryView card={card} />
                            ) : (
                                <>
                                    {messagesBody(maxScrollRef, { roomy: true })}
                                    {card.debug === true && <DebugConsole logs={card.logs ?? []} />}
                                    {footerInput}
                                </>
                            )}
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

function DebugConsole({ logs }: { logs: string[] }) {
    const ref = useRef<HTMLDivElement>(null);
    const [copied, setCopied] = useState(false);
    useEffect(() => {
        if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
    }, [logs.length]);
    const copyAll = () => {
        navigator.clipboard
            .writeText(logs.join('\n'))
            .then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            })
            .catch(() => {});
    };
    return (
        <div className="nodrag select-text flex max-h-44 shrink-0 flex-col border-t border-amber-500/25 bg-black/40">
            <div className="flex items-center gap-1.5 px-2 py-1">
                <Bug className="size-3 text-amber-500" />
                <span className="text-[9px] font-semibold uppercase tracking-wide text-amber-500">
                    debug console
                </span>
                <span className="ml-auto text-[9px] text-muted-foreground">{logs.length} events</span>
                <button
                    className="nodrag flex items-center gap-1 rounded px-1 py-0.5 text-[9px] text-muted-foreground transition-colors hover:bg-white/10 hover:text-foreground"
                    onClick={(e) => {
                        e.stopPropagation();
                        copyAll();
                    }}
                    title="Copy all logs to clipboard"
                >
                    <Copy className="size-3" />
                    {copied ? 'copied' : 'copy'}
                </button>
            </div>
            <div
                ref={ref}
                className="nodrag nowheel min-h-0 flex-1 select-text overflow-y-auto px-2 pb-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
            >
                {logs.length === 0 && (
                    <span className="text-muted-foreground/50">no activity yet</span>
                )}
                {logs.map((line, i) => (
                    <div
                        key={i}
                        className={cn(
                            'select-text whitespace-pre-wrap break-words',
                            line.includes('✗') || line.includes('error') || line.includes('failed')
                                ? 'text-red-400'
                                : undefined,
                        )}
                    >
                        {line}
                    </div>
                ))}
            </div>
        </div>
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
