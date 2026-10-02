import { memo as ReactMemo, useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import {
    Handle,
    NodeResizer,
    Position,
    useReactFlow,
    type Node,
    type NodeProps,
} from '@xyflow/react';
import { Brain, Bug, Check, ChevronDown, ChevronRight, ChevronUp, Copy, GitBranch, History, Pencil, Search, X } from 'lucide-react';
import { askChoice } from '@/components/dialogs';
import { useImageLightbox } from '@/components/image-lightbox';
import { extractSessionPaths, sessionChipLabel } from '@/lib/session-links';
import { useCanvasStore } from '@/store/canvas-store';
import { useDeveloperStore } from '@/settings/developer-store';
import { SessionJsonViewer } from '@/components/session-json-viewer';
import { boxMailLog } from '@/lib/box-mail-brief';
import { MarkdownBlock } from '@/components/markdown-block';
import { PromptComposer } from '@/components/prompt-composer';
import { MatrixLoader } from '@/components/matrix-loader';
import { QuestionPanel } from '@/components/question-panel';
import { ToolRunBlock } from '@/components/tool-run-block';
import { DEFAULT_CARD_SIZE, type ComposerAttachment, type TraceEvent } from '@/types/session-card';
import { chatImageDataUrl } from '@/lib/composer-attachments';
import { MinimizedCardBar } from './minimized-card-bar';
import { FullscreenExitButton, FullscreenShell } from './fullscreen-shell';
import {
    mentionExists,
    mentionPaths,
    queueExistenceCheck,
    splitMentionSpans,
    subscribeExistence,
} from '@/lib/mentions';
import {
    attachStickUnlock,
    stickToBottomIfNeeded,
    syncStuckToBottom,
} from '@/lib/stick-to-bottom';
import { cn } from '@/lib/utils';

/**
 * User message text with @-mentions: sky when the file exists, red when it
 * doesn't, hover shows the absolute path, click opens it on the canvas.
 */
function UserTextWithMentions({ text }: { text: string }) {
    const cwd = useCanvasStore((s) => s.worktreePath ?? s.folder);
    const folder = useCanvasStore((s) => s.folder);
    const [, bump] = useReducer((x: number) => x + 1, 0);
    useEffect(() => subscribeExistence(bump), [bump]);
    useEffect(() => {
        queueExistenceCheck(cwd, mentionPaths(text), folder !== cwd ? folder : null);
    }, [cwd, folder, text]);
    const spans = splitMentionSpans(text);
    return (
        <>
            {spans.map((s, i) =>
                s.mention ? (
                    <span
                        key={i}
                        role="button"
                        tabIndex={0}
                        className={cn(
                            'cursor-pointer rounded-sm font-medium',
                            mentionExists(cwd, s.mention) === true
                                ? 'text-sky-600 hover:underline dark:text-sky-400'
                                : mentionExists(cwd, s.mention) === false
                                  ? 'text-red-500 hover:underline'
                                  : 'underline decoration-dotted underline-offset-2',
                        )}
                        title={cwd ? `${cwd}/${s.mention}` : s.mention}
                        onClick={(e) => {
                            e.stopPropagation();
                            void useCanvasStore.getState().openFileOnCanvas(s.mention as string);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.stopPropagation();
                                void useCanvasStore.getState().openFileOnCanvas(s.mention as string);
                            }
                        }}
                    >
                        {s.text}
                    </span>
                ) : (
                    <span key={i}>{s.text}</span>
                ),
            )}
        </>
    );
}

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

// ── 💭 Thinking ──────────────────────────────────────────────────────────
/** Edit-in-place is disabled for now. Flip to true to re-enable the Edit action. */
const EDIT_MESSAGE_ENABLED = false;

type MessageShape = {
    role: string;
    text: string;
    thinking?: string;
    /** User-attached images for this turn. */
    images?: Array<{ mimeType: string; data: string; name?: string }>;
    /** pi session entry id — lets a message be a fork point. */
    entryId?: string;
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
/**
 * Message action row, Supernova-style: sits under the message and is hidden until
 * the message is hovered. Copy is always available; Fork and Edit only while the
 * card is idle.
 */
function MessageActions({
    align,
    text,
    onFork,
    onEdit,
}: {
    align: 'start' | 'end';
    text: string;
    onFork?: () => void;
    onEdit?: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const canCopy = text.trim().length > 0;
    if (!canCopy && !onFork && !onEdit) return null;
    return (
        <div
            className={cn(
                'mt-1 flex items-center gap-0.5 opacity-0 transition-opacity group-hover/msg:opacity-100',
                align === 'end' && 'justify-end',
                copied && 'opacity-100',
            )}
        >
            {canCopy ? (
                <button
                    type="button"
                    title={copied ? 'Copied' : 'Copy message'}
                    aria-label="Copy message"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    onClick={() => {
                        if (copied) return;
                        void navigator.clipboard.writeText(text).then(() => {
                            setCopied(true);
                            window.setTimeout(() => setCopied(false), 1000);
                        });
                    }}
                >
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                </button>
            ) : null}
            {onFork ? (
                <button
                    type="button"
                    title="Fork from here"
                    aria-label="Fork from here"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    onClick={onFork}
                >
                    <GitBranch className="size-3.5" />
                </button>
            ) : null}
            {onEdit ? (
                <button
                    type="button"
                    title="Edit from here"
                    aria-label="Edit from here"
                    className="grid size-6 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                    onClick={onEdit}
                >
                    <Pencil className="size-3.5" />
                </button>
            ) : null}
        </div>
    );
}

/**
 * Wraps one work section. When `connector` is set, an animated vertical line
 * grows out of the gap above it (bottom-full of the 8px space-y gap), so each
 * time a new section starts the line draws from the previous one. It is removed
 * with the wrapper once the turn ends.
 */
function TurnSection({ connector, children }: { connector: boolean; children: ReactNode }) {
    return (
        <div className="relative">
            {connector ? (
                <span
                    aria-hidden
                    className="turn-connector-line absolute bottom-full left-[6.5px] h-3 w-px bg-border"
                />
            ) : null}
            {children}
        </div>
    );
}

const MessageBlocks = ReactMemo(function MessageBlocks({
    m,
    index,
    cardId,
    streaming,
    totalMessages,
    highlighted,
    findQuery,
    findActive,
    onFork,
    onEditSubmit,
}: {
    m: MessageShape;
    index: number;
    cardId: string;
    streaming: boolean;
    totalMessages: number;
    highlighted?: boolean;
    findQuery?: string;
    findActive?: boolean;
    /** Fork the conversation up to this message index. */
    onFork?: (index: number) => void;
    /** Revert to before this user message and send the edited text from there. */
    onEditSubmit?: (index: number, text: string) => void;
}) {
    const q = findQuery?.trim() ?? '';
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const openLightbox = useImageLightbox((s) => s.open);
    if (m.role === 'system') {
        const bad = m.text.startsWith('✗');
        return (
            <div className="flex justify-center" data-msg-index={index}>
                <span
                    className={cn(
                        'max-w-[92%] rounded-md px-2 py-0.5 text-center text-[10px]',
                        bad ? 'bg-red-500/10 text-red-500' : 'bg-secondary/60 text-muted-foreground',
                    )}
                >
                    {q ? (
                        <HighlightedPlainText text={m.text} query={q} current={findActive} />
                    ) : (
                        m.text
                    )}
                </span>
            </div>
        );
    }
    if (m.role === 'user') {
        if (editing) {
            const submitEdit = () => {
                const text = draft.trim();
                if (!text) return;
                setEditing(false);
                onEditSubmit?.(index, text);
            };
            return (
                <div
                    className="group/msg flex flex-col items-end"
                    data-msg-index={index}
                    data-user-prompt="true"
                >
                    <div className="w-full max-w-[92%] rounded-xl border border-ring bg-background px-3 py-2">
                        <textarea
                            autoFocus
                            rows={Math.min(10, Math.max(1, draft.split('\n').length))}
                            value={draft}
                            onChange={(e) => setDraft(e.target.value)}
                            onKeyDown={(e) => {
                                e.stopPropagation();
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    submitEdit();
                                } else if (e.key === 'Escape') {
                                    e.preventDefault();
                                    setEditing(false);
                                }
                            }}
                            className="nodrag nowheel block w-full resize-none bg-transparent text-[length:var(--text-chat)] leading-relaxed text-foreground outline-none"
                        />
                        <p className="mt-1 text-right text-[10px] text-muted-foreground">
                            Enter to send · Esc to cancel
                        </p>
                    </div>
                </div>
            );
        }
        return (
            <div
                className={cn(
                    'group/msg flex flex-col items-end rounded-xl transition-colors duration-500',
                    highlighted && 'ring-2 ring-primary/50 ring-offset-2 ring-offset-card',
                )}
                data-msg-index={index}
                data-user-prompt="true"
            >
                <div className="max-w-[92%] overflow-hidden rounded-xl bg-primary/10 px-3 py-1.5 text-[length:var(--text-chat)] leading-relaxed text-primary whitespace-pre-wrap break-words">
                    {m.images && m.images.length > 0 && (
                        <div className="mb-1.5 flex flex-wrap gap-1.5">
                            {m.images.map((img, ii) => {
                                const src = chatImageDataUrl(img);
                                const name = img.name ?? 'Attached image';
                                return (
                                    <button
                                        key={ii}
                                        type="button"
                                        className="nodrag overflow-hidden rounded-md"
                                        title="View image"
                                        aria-label={`View ${name}`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            openLightbox(src, name);
                                        }}
                                    >
                                        <img
                                            alt={name}
                                            className="max-h-24 max-w-[140px] cursor-zoom-in object-cover"
                                            src={src}
                                            draggable={false}
                                        />
                                    </button>
                                );
                            })}
                        </div>
                    )}
                    {m.text.trim().length > 0 && m.text !== '(image)' &&
                        (q ? (
                            <HighlightedPlainText text={m.text} query={q} current={findActive} />
                        ) : (
                            <UserTextWithMentions text={m.text} />
                        ))}
                </div>
                <MessageActions
                    align="end"
                    text={m.text}
                    onFork={!streaming && onFork ? () => onFork(index) : undefined}
                    onEdit={
                        !streaming && onEditSubmit
                            ? () => {
                                  setDraft(m.text);
                                  setEditing(true);
                              }
                            : undefined
                    }
                />
            </div>
        );
    }
    const isStreamingTail = streaming && index === totalMessages - 1;
    const hasTools = (m.tools ?? []).length > 0;
    // Thinking is live until this turn produces tools or answer text.
    const thinkingActive =
        isStreamingTail && !!m.thinking && !m.text.trim() && !hasTools;
    const hasAnswer = isStreamingTail ? m.text.length > 0 : m.text.trim().length > 0;

    // Render the turn as an ordered list of work sections. A connector is drawn
    // before every section except the first, so a new connector mounts exactly
    // when the next section starts and animates into place.
    const sections: Array<{ key: string; node: ReactNode }> = [];
    if (m.thinking != null && m.thinking.length > 0) {
        sections.push({
            key: 'thinking',
            node: (
                <ThinkingBlock
                    cardId={cardId}
                    index={index}
                    text={m.thinking}
                    active={thinkingActive}
                    findQuery={q}
                    findActive={findActive}
                />
            ),
        });
    }
    for (const t of m.tools ?? []) {
        sections.push({
            key: `tool:${t.callId}`,
            node: (
                <ToolRunBlock
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
            ),
        });
    }
    if (hasAnswer) {
        sections.push({
            key: 'answer',
            node: (
                <div>
                    {q ? (
                        <FindHighlightHost query={q} current={findActive}>
                            <MarkdownBlock content={m.text} streaming={isStreamingTail} />
                        </FindHighlightHost>
                    ) : (
                        <MarkdownBlock content={m.text} streaming={isStreamingTail} />
                    )}
                </div>
            ),
        });
    }
    // Cited past sessions render as chips: click opens that session in a new
    // box beside this one (delegation edge), not in the browser.
    if (m.role === 'assistant' && !streaming) {
        const sessionPaths = extractSessionPaths(m.text);
        if (sessionPaths.length > 0) {
            sections.push({
                key: 'sessionLinks',
                node: (
                    <div className="flex flex-wrap gap-1.5">
                        {sessionPaths.map((p) => (
                            <button
                                key={p}
                                type="button"
                                title={`Open in a new box — ${p}`}
                                onClick={() => {
                                    void useCanvasStore
                                        .getState()
                                        .resumeSession(p, { parentId: cardId });
                                }}
                                className="flex max-w-full items-center gap-1.5 rounded-md border border-border bg-secondary/50 px-2 py-1 text-[10px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            >
                                <History className="size-3 shrink-0" />
                                <span className="truncate">{sessionChipLabel(p)}</span>
                            </button>
                        ))}
                    </div>
                ),
            });
        }
    }

    return (
        <div
            className={cn(
                'group/msg min-w-0 space-y-2 pl-1 rounded-lg transition-colors duration-500',
                highlighted && 'ring-2 ring-primary/40 ring-offset-2 ring-offset-card',
            )}
            data-msg-index={index}
        >
            {sections.map((section, i) => (
                <TurnSection key={section.key} connector={i > 0 && isStreamingTail}>
                    {section.node}
                </TurnSection>
            ))}
            <MessageActions align="start" text={m.text} />
        </div>
    );
});

/** Truncate a user prompt for the maximized-mode jump-nav preview. */
function promptNavPreview(text: string, max = 140): string {
    const oneLine = text.replace(/\s+/g, ' ').trim();
    if (oneLine.length <= max) return oneLine;
    return `${oneLine.slice(0, max - 1)}…`;
}

function messageSearchHaystack(m: MessageShape): string {
    const parts = [m.text, m.thinking ?? ''];
    for (const t of m.tools ?? []) {
        parts.push(t.name, t.args ?? '', t.output ?? '');
    }
    return parts.join('\n');
}

/** Message indexes whose text/thinking/tools contain `query` (case-insensitive). */
function findMatchingMessageIndexes(
    messages: Array<MessageShape>,
    query: string,
): number[] {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: number[] = [];
    for (let i = 0; i < messages.length; i++) {
        const m = messages[i];
        if (!m || m.role === 'system') continue;
        if (messageSearchHaystack(m).toLowerCase().includes(q)) out.push(i);
    }
    return out;
}

/** Compact floating Cmd/Ctrl+F control — overlay, not a full-width strip. */
function MaximizedFindBar({
    query,
    matchIndex,
    matchCount,
    onQueryChange,
    onPrev,
    onNext,
    onClose,
    inputRef,
}: {
    query: string;
    matchIndex: number;
    matchCount: number;
    onQueryChange: (value: string) => void;
    onPrev: () => void;
    onNext: () => void;
    onClose: () => void;
    inputRef: RefObject<HTMLInputElement>;
}) {
    const status =
        query.trim().length === 0
            ? '—'
            : matchCount === 0
              ? '0/0'
              : `${matchIndex + 1}/${matchCount}`;

    const noHits = query.trim().length > 0 && matchCount === 0;

    return (
        <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-card/95 px-3 py-2 shadow-lg ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <input
                ref={inputRef}
                type="search"
                value={query}
                placeholder="Find in chat"
                aria-label="Find in chat"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => onQueryChange(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        onNext();
                        return;
                    }
                    if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) {
                        e.preventDefault();
                        e.stopPropagation();
                        onPrev();
                        return;
                    }
                    if (e.key === 'Escape') {
                        e.preventDefault();
                        e.stopPropagation();
                        onClose();
                    }
                }}
                className="nodrag nowheel w-[12rem] bg-transparent text-[13px] leading-none text-card-foreground outline-none placeholder:text-muted-foreground/80 sm:w-[14rem]"
            />
            <span
                className={cn(
                    'min-w-[2.75rem] shrink-0 text-right text-[11px] tabular-nums',
                    noHits ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground',
                )}
                aria-live="polite"
            >
                {status}
            </span>
            <div className="flex items-center gap-0.5 border-l border-border/60 pl-2">
                <button
                    type="button"
                    className="nodrag inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-35"
                    onClick={onPrev}
                    disabled={matchCount === 0}
                    title="Previous match (↑)"
                    aria-label="Previous match"
                >
                    <ChevronUp className="size-3.5" />
                </button>
                <button
                    type="button"
                    className="nodrag inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground disabled:opacity-35"
                    onClick={onNext}
                    disabled={matchCount === 0}
                    title="Next match (↓)"
                    aria-label="Next match"
                >
                    <ChevronDown className="size-3.5" />
                </button>
            </div>
            <button
                type="button"
                className="nodrag inline-flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                onClick={onClose}
                title="Close (Esc)"
                aria-label="Close find"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Split plain text into normal + match segments for in-text find highlights. */
function highlightPlainParts(
    text: string,
    query: string,
): Array<{ text: string; hit: boolean }> {
    const q = query.trim();
    if (!q || !text) return [{ text, hit: false }];
    const re = new RegExp(escapeRegExp(q), 'gi');
    const parts: Array<{ text: string; hit: boolean }> = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
        if (m.index > last) parts.push({ text: text.slice(last, m.index), hit: false });
        parts.push({ text: m[0], hit: true });
        last = m.index + m[0].length;
        if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) parts.push({ text: text.slice(last), hit: false });
    return parts.length > 0 ? parts : [{ text, hit: false }];
}

function FindMark({
    text,
    current,
}: {
    text: string;
    current?: boolean;
}) {
    return (
        <mark
            data-find-hit=""
            data-find-current={current ? '' : undefined}
            className={cn(
                'rounded-[2px] px-0.5 py-px font-medium not-italic',
                current
                    ? 'bg-[#FFEA00] text-black ring-1 ring-[#FF8A00]'
                    : 'bg-[#7CFFB2] text-[#062816]',
            )}
        >
            {text}
        </mark>
    );
}

function HighlightedPlainText({
    text,
    query,
    current,
}: {
    text: string;
    query: string;
    current?: boolean;
}) {
    const parts = highlightPlainParts(text, query);
    if (!query.trim()) return <>{text}</>;
    let sawCurrent = false;
    return (
        <>
            {parts.map((p, i) => {
                if (!p.hit) return <span key={i}>{p.text}</span>;
                const isCurrent = !!current && !sawCurrent;
                if (isCurrent) sawCurrent = true;
                return <FindMark key={i} text={p.text} current={isCurrent} />;
            })}
        </>
    );
}

function clearDomFindMarks(root: HTMLElement): void {
    const marks = root.querySelectorAll('mark[data-find-hit]');
    for (const mark of marks) {
        const parent = mark.parentNode;
        if (!parent) continue;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
        parent.normalize();
    }
}

/** Walk text nodes and wrap query hits in <mark> — works for rendered markdown. */
function applyDomFindMarks(root: HTMLElement, query: string, current: boolean): void {
    const q = query.trim();
    if (!q) return;
    const re = new RegExp(escapeRegExp(q), 'gi');
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            if (parent.closest('mark[data-find-hit], script, style')) {
                return NodeFilter.FILTER_REJECT;
            }
            // Skip empty / whitespace-only nodes for speed.
            if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        },
    });
    const textNodes: Text[] = [];
    let node = walker.nextNode();
    while (node) {
        textNodes.push(node as Text);
        node = walker.nextNode();
    }

    let assignedCurrent = false;
    for (const textNode of textNodes) {
        const value = textNode.nodeValue ?? '';
        re.lastIndex = 0;
        if (!re.test(value)) continue;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(value)) != null) {
            if (m.index > last) {
                frag.appendChild(document.createTextNode(value.slice(last, m.index)));
            }
            const mark = document.createElement('mark');
            mark.setAttribute('data-find-hit', '');
            const isCurrent = current && !assignedCurrent;
            if (isCurrent) {
                mark.setAttribute('data-find-current', '');
                assignedCurrent = true;
            }
            mark.className = isCurrent
                ? 'rounded-[2px] px-0.5 py-px font-medium bg-[#FFEA00] text-black ring-1 ring-[#FF8A00]'
                : 'rounded-[2px] px-0.5 py-px font-medium bg-[#7CFFB2] text-[#062816]';
            mark.textContent = m[0];
            frag.appendChild(mark);
            last = m.index + m[0].length;
            if (m[0].length === 0) re.lastIndex++;
        }
        if (last < value.length) {
            frag.appendChild(document.createTextNode(value.slice(last)));
        }
        textNode.parentNode?.replaceChild(frag, textNode);
    }
}

/** Applies find highlights inside markdown / mixed DOM after paint. */
function FindHighlightHost({
    query,
    current,
    children,
    className,
}: {
    query: string;
    current?: boolean;
    children: ReactNode;
    className?: string;
}) {
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const root = ref.current;
        if (!root) return;
        clearDomFindMarks(root);
        const q = query.trim();
        if (!q) return;
        applyDomFindMarks(root, q, !!current);
    }, [query, current, children]);
    return (
        <div ref={ref} className={className}>
            {children}
        </div>
    );
}

/**
 * Right-edge prompt bars (maximized chat only).
 * Stacked ticks (not a minimap). Active bar follows chat scroll; the list
 * auto-scrolls so that bar stays visible — you don't scrub the rail yourself.
 */
function UserPromptSideNav({
    prompts,
    activeIndex,
    onJump,
}: {
    prompts: Array<{ index: number; text: string }>;
    activeIndex: number;
    onJump: (messageIndex: number) => void;
}) {
    const [hovered, setHovered] = useState<number | null>(null);
    const [hoverAnchor, setHoverAnchor] = useState<{ top: number; right: number } | null>(null);
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const activeBtnRef = useRef<HTMLButtonElement | null>(null);
    const btnRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

    useEffect(() => {
        return () => {
            if (leaveTimer.current) clearTimeout(leaveTimer.current);
        };
    }, []);

    // Keep the active tick in view as the chat scroll position changes.
    useEffect(() => {
        if (activeIndex < 0) return;
        activeBtnRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }, [activeIndex]);

    const clearLeave = () => {
        if (leaveTimer.current) {
            clearTimeout(leaveTimer.current);
            leaveTimer.current = null;
        }
    };

    const placeHover = (index: number) => {
        const el = btnRefs.current.get(index);
        if (!el) {
            setHovered(index);
            setHoverAnchor(null);
            return;
        }
        const rect = el.getBoundingClientRect();
        setHovered(index);
        // Anchor to the left of the tick so the card isn't clipped by the rail.
        setHoverAnchor({
            top: rect.top + rect.height / 2,
            right: window.innerWidth - rect.left + 10,
        });
    };

    const onEnter = (index: number) => {
        clearLeave();
        placeHover(index);
    };

    const onLeave = () => {
        clearLeave();
        leaveTimer.current = setTimeout(() => {
            setHovered(null);
            setHoverAnchor(null);
        }, 100);
    };

    if (prompts.length === 0) return null;

    const hoveredOrdinal = hovered == null ? -1 : prompts.findIndex((p) => p.index === hovered);
    const hoveredPrompt = hoveredOrdinal >= 0 ? prompts[hoveredOrdinal] : null;

    return (
        <>
            <nav
                aria-label="Jump to user prompts"
                className="nodrag nowheel pointer-events-none absolute inset-y-0 right-0 z-20 flex w-14 flex-col items-end justify-center py-10 pr-2.5"
                onMouseLeave={onLeave}
            >
                {/* max-h-full: short chats stay centered; long chats fill + auto-scroll */}
                <div
                    className="flex max-h-full flex-col items-end gap-1.5 overflow-y-auto overscroll-contain"
                    style={{ scrollbarWidth: 'none' }}
                >
                    {prompts.map((p, n) => {
                        const active = p.index === activeIndex;
                        const isHot = hovered === p.index;
                        return (
                            <button
                                key={p.index}
                                ref={(el) => {
                                    if (el) btnRefs.current.set(p.index, el);
                                    else btnRefs.current.delete(p.index);
                                    if (active) activeBtnRef.current = el;
                                }}
                                type="button"
                                aria-label={`Jump to prompt ${n + 1}: ${promptNavPreview(p.text, 64)}`}
                                aria-current={active ? 'true' : undefined}
                                onMouseEnter={() => onEnter(p.index)}
                                onFocus={() => onEnter(p.index)}
                                onBlur={onLeave}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onJump(p.index);
                                }}
                                className="pointer-events-auto nodrag relative flex h-3.5 w-14 shrink-0 items-center justify-end outline-none"
                            >
                                <span
                                    className={cn(
                                        'block h-[3px] origin-right rounded-full will-change-[width]',
                                        'transition-[width,background-color,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                        active || isHot
                                            ? 'w-10 bg-primary opacity-100'
                                            : 'w-2.5 bg-muted-foreground/45 opacity-60',
                                    )}
                                />
                            </button>
                        );
                    })}
                </div>
            </nav>
            {/* Portal so overflow on the rail can't clip the prompt preview. */}
            {hoveredPrompt &&
                hoverAnchor &&
                createPortal(
                    <div
                        role="tooltip"
                        className="pointer-events-none fixed z-[1100] w-[min(17rem,70vw)] -translate-y-1/2"
                        style={{ top: hoverAnchor.top, right: hoverAnchor.right }}
                    >
                        <div className="rounded-lg border border-border/80 bg-card/95 px-3 py-2.5 shadow-lg ring-1 ring-black/5 backdrop-blur-md dark:ring-white/10">
                            <div className="mb-1 flex items-center justify-between gap-2">
                                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                    Prompt {hoveredOrdinal + 1}
                                </span>
                                <span className="text-[10px] tabular-nums text-muted-foreground/70">
                                    {hoveredOrdinal + 1}/{prompts.length}
                                </span>
                            </div>
                            <p className="line-clamp-3 text-[12px] leading-snug text-card-foreground">
                                {promptNavPreview(hoveredPrompt.text, 180)}
                            </p>
                        </div>
                    </div>,
                    document.body,
                )}
        </>
    );
}

/** Which user prompt owns the current reading position in the scroll viewport. */
function resolveViewportPromptIndex(scroller: HTMLDivElement): number {
    const nodes = scroller.querySelectorAll('[data-user-prompt="true"]');
    if (nodes.length === 0) return -1;
    const rootRect = scroller.getBoundingClientRect();
    // Reading line: a bit below the top so the section you're in stays active.
    const marker = scroller.scrollTop + Math.min(96, scroller.clientHeight * 0.18);
    let current = -1;
    for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const y =
            node.getBoundingClientRect().top - rootRect.top + scroller.scrollTop;
        const idx = Number(node.getAttribute('data-msg-index'));
        if (!Number.isFinite(idx)) continue;
        if (y <= marker) current = idx;
        else break;
    }
    if (current < 0) {
        const first = nodes[0];
        if (first instanceof HTMLElement) {
            const idx = Number(first.getAttribute('data-msg-index'));
            return Number.isFinite(idx) ? idx : -1;
        }
    }
    return current;
}

function ThinkingBlock({
    cardId,
    index,
    text,
    active,
    findQuery = '',
    findActive = false,
}: {
    cardId: string;
    index: number;
    text: string;
    active: boolean;
    findQuery?: string;
    findActive?: boolean;
}) {
    const key = `${cardId}:think:${index}`;
    const [open, setOpen] = useState(() => uiFlag(key, true));
    const prevActive = useRef(active);
    const autoControlled = useRef(true);
    const bodyRef = useRef<HTMLDivElement>(null);
    const atBottomRef = useRef(true);

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

    // New live thought: re-pin to the tail so first tokens are visible.
    useEffect(() => {
        if (active) atBottomRef.current = true;
    }, [active]);

    // Follow the stream only while the reader stays at the bottom of this box.
    useEffect(() => {
        if (!active || !open) return;
        stickToBottomIfNeeded(bodyRef.current, atBottomRef);
    }, [text, active, open]);

    useEffect(() => {
        if (!open) return;
        return attachStickUnlock(bodyRef.current, atBottomRef);
    }, [open, active]);

    // Open thinking when a find hit lives inside it.
    useEffect(() => {
        if (!findQuery.trim() || !findActive) return;
        if (text.toLowerCase().includes(findQuery.trim().toLowerCase())) {
            setOpen(true);
            setUiFlag(key, true);
        }
    }, [findQuery, findActive, text, key]);

    return (
        <div className="min-w-0 text-[13px]">
            <button
                type="button"
                aria-expanded={open}
                className={cn(
                    'flex w-full min-w-0 items-center gap-2 py-0.5 text-left text-muted-foreground transition-colors hover:text-foreground',
                    active && 'shimmer-text',
                )}
                onClick={() => {
                    autoControlled.current = false;
                    const next = !open;
                    setOpen(next);
                    setUiFlag(key, next);
                }}
            >
                <Brain className="size-3.5 shrink-0" />
                <span className="min-w-0 truncate">{active ? 'Thinking…' : 'Thought process'}</span>
                <ChevronRight
                    className={cn('ml-auto size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
                />
            </button>
            {open && (
                <div
                    ref={bodyRef}
                    onScroll={(e) => syncStuckToBottom(e.currentTarget, atBottomRef)}
                    className="nowheel mt-1.5 max-h-56 overflow-y-auto whitespace-pre-wrap text-[12px] leading-relaxed text-muted-foreground"
                >
                    {findQuery.trim() ? (
                        <HighlightedPlainText
                            text={text || '…'}
                            query={findQuery}
                            current={findActive}
                        />
                    ) : (
                        text || '…'
                    )}
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

/** Same size in card header and fullscreen — do not enlarge in fullscreen. */
function ContextMeter({
    percent,
    tokens,
    contextWindow,
}: {
    percent: number;
    tokens: number | null;
    contextWindow: number;
}) {
    return (
        <div
            className="flex shrink-0 items-center gap-1"
            title={`Context window: ${Math.round(percent)}% — ${(tokens ?? 0).toLocaleString()} of ${contextWindow.toLocaleString()} tokens`}
        >
            <div className="h-1 w-12 overflow-hidden rounded-full bg-secondary">
                <div
                    className="h-full rounded-full transition-all"
                    style={{
                        width: `${Math.min(percent, 100)}%`,
                        background: percent < 70 ? '#50fa7b' : percent < 90 ? '#ffb86c' : '#ff5555',
                    }}
                />
            </div>
            <span className="text-[9px] tabular-nums text-muted-foreground">{Math.round(percent)}%</span>
        </div>
    );
}

/** Quiet header action: professional dot, label via title only. */
function HeaderDot({
    title,
    onClick,
    active,
    tone = 'muted',
    badge,
    disabled,
}: {
    title: string;
    onClick: (e: React.MouseEvent) => void;
    active?: boolean;
    tone?: 'muted' | 'amber' | 'danger' | 'primary';
    badge?: string | number | null;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            disabled={disabled}
            title={title}
            aria-label={title}
            className={cn(
                'nodrag relative flex size-5 shrink-0 items-center justify-center rounded-full transition-colors',
                disabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-secondary',
            )}
            onClick={onClick}
        >
            <span
                className={cn(
                    'size-1.5 rounded-full transition-colors',
                    tone === 'amber' && 'bg-amber-500',
                    tone === 'danger' && 'bg-red-500/80',
                    tone === 'primary' && 'bg-primary',
                    tone === 'muted' && (active ? 'bg-foreground' : 'bg-muted-foreground/45'),
                )}
            />
            {badge != null && badge !== '' ? (
                <span className="absolute -right-0.5 -top-0.5 flex h-2.5 min-w-2.5 items-center justify-center rounded-full bg-secondary px-0.5 text-[7px] font-semibold tabular-nums text-muted-foreground ring-1 ring-border">
                    {badge}
                </span>
            ) : null}
        </button>
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
    const debuggerEnabled = useDeveloperStore((s) => s.debuggerEnabled);
    const sessionJsonEnabled = useDeveloperStore((s) => s.sessionJsonEnabled);
    // Settings → Debugger ON opens the debug console on every card (no per-card toggle).
    const showDebugConsole = debuggerEnabled;
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
    const draftAttachments = card?.draftAttachments ?? [];
    const setDraftAttachments = useCallback(
        (next: ComposerAttachment[] | ((prev: ComposerAttachment[]) => ComposerAttachment[])) =>
            useCanvasStore.getState().setCardDraftAttachments(id, next),
        [id],
    );
    const maximizedCardId = useCanvasStore((s) => s.maximizedCardId);
    const maximized = maximizedCardId === id;
    const setMaximized = useCallback(
        (next: boolean) => {
            useCanvasStore.getState().setMaximizedCardId(next ? id : null);
        },
        [id],
    );
    const [view, setView] = useState<'chat' | 'trajectory' | 'json'>('chat');
    const [editingTitle, setEditingTitle] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const [viewportPromptIndex, setViewportPromptIndex] = useState(-1);
    const [findOpen, setFindOpen] = useState(false);
    const [findQuery, setFindQuery] = useState('');
    const [findMatchCursor, setFindMatchCursor] = useState(0);
    const findInputRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        void useCanvasStore.getState().syncBoxInbox(id);
    }, [id]);
    // Settings → Session JSON ON replaces the chat body with the session viewer.
    useEffect(() => {
        if (sessionJsonEnabled && card?.sessionFile) {
            setView('json');
            return;
        }
        setView((prev) => (prev === 'json' ? 'chat' : prev));
    }, [sessionJsonEnabled, card?.sessionFile]);
    const scrollRef = useRef<HTMLDivElement>(null);
    const maxScrollRef = useRef<HTMLDivElement>(null);
    const atBottomRef = useRef(true); // user pinned to the newest output?
    const [showDown, setShowDown] = useState(false); // floating ↓ button
    const lastMsg = card?.messages[card.messages.length - 1];
    const highlightClearRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const findMatches = findMatchingMessageIndexes(card?.messages ?? [], findQuery);

    const handleMessagesScroll = (el: HTMLDivElement) => {
        const near = syncStuckToBottom(el, atBottomRef);
        setShowDown(!near); // React bails out when unchanged
        if (maximized) {
            const next = resolveViewportPromptIndex(el);
            setViewportPromptIndex((prev) => (prev === next ? prev : next));
        }
    };
    const goToBottom = () => {
        atBottomRef.current = true;
        setShowDown(false);
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
        const el2 = maxScrollRef.current;
        if (el2) el2.scrollTop = el2.scrollHeight;
    };

    const jumpToMessage = useCallback((messageIndex: number, opts?: { sticky?: boolean }) => {
        // Leaving the bottom so stream auto-follow does not yank us away.
        atBottomRef.current = false;
        setShowDown(true);
        setHighlightedIndex(messageIndex);
        setViewportPromptIndex(messageIndex);
        if (highlightClearRef.current) clearTimeout(highlightClearRef.current);
        if (!opts?.sticky) {
            highlightClearRef.current = setTimeout(() => setHighlightedIndex(-1), 1800);
        }
        const root = maxScrollRef.current;
        const target = root?.querySelector(`[data-msg-index="${messageIndex}"]`);
        if (target instanceof HTMLElement) {
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            // After paint, land on the exact highlighted letter(s) if present.
            window.setTimeout(() => {
                const hit =
                    target.querySelector('mark[data-find-current]') ??
                    target.querySelector('mark[data-find-hit]');
                if (hit instanceof HTMLElement) {
                    hit.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
            }, 80);
        }
    }, []);

    const jumpToUserPrompt = useCallback(
        (messageIndex: number) => jumpToMessage(messageIndex),
        [jumpToMessage],
    );

    const closeFind = useCallback(() => {
        setFindOpen(false);
        setFindQuery('');
        setFindMatchCursor(0);
        setHighlightedIndex(-1);
        if (highlightClearRef.current) clearTimeout(highlightClearRef.current);
    }, []);

    const goToFindMatch = useCallback(
        (cursor: number, matches: number[]) => {
            if (matches.length === 0) return;
            const next = ((cursor % matches.length) + matches.length) % matches.length;
            setFindMatchCursor(next);
            jumpToMessage(matches[next]!, { sticky: true });
        },
        [jumpToMessage],
    );

    const onFindQueryChange = useCallback(
        (value: string) => {
            setFindQuery(value);
            const matches = findMatchingMessageIndexes(card?.messages ?? [], value);
            setFindMatchCursor(0);
            if (matches.length > 0) {
                jumpToMessage(matches[0]!, { sticky: true });
            } else {
                setHighlightedIndex(-1);
            }
        },
        [card?.messages, jumpToMessage],
    );

    useEffect(() => {
        return () => {
            if (highlightClearRef.current) clearTimeout(highlightClearRef.current);
        };
    }, []);

    // Auto-follow ONLY while the user is at the bottom. If they scroll away,
    // new output must NOT yank them down — the ↓ button returns them instead.
    useEffect(() => {
        stickToBottomIfNeeded(scrollRef.current, atBottomRef);
        stickToBottomIfNeeded(maxScrollRef.current, atBottomRef);
        setShowDown(!atBottomRef.current);
    }, [card?.messages.length, lastMsg?.text, lastMsg?.thinking, lastMsg?.tools, card?.status]);

    // Fixed-height card: growing the input footer shrinks the messages viewport.
    // If the user is pinned to the bottom, snap back on ANY resize so typing
    // never pushes the chat up/down.
    useEffect(() => {
        const attach = (el: HTMLDivElement | null) => {
            if (!el) return;
            const ro = new ResizeObserver(() => {
                stickToBottomIfNeeded(el, atBottomRef);
            });
            ro.observe(el);
            return () => ro.disconnect();
        };
        const d1 = attach(scrollRef.current);
        const d2 = attach(maxScrollRef.current);
        const u1 = attachStickUnlock(scrollRef.current, atBottomRef, () => setShowDown(true));
        const u2 = attachStickUnlock(maxScrollRef.current, atBottomRef, () => setShowDown(true));
        return () => {
            d1?.();
            d2?.();
            u1?.();
            u2?.();
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
        if (!maximized) {
            setHighlightedIndex(-1);
            setViewportPromptIndex(-1);
            setFindOpen(false);
            setFindQuery('');
            setFindMatchCursor(0);
            return;
        }
        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        // Seed "you are here" as soon as fullscreen opens.
        requestAnimationFrame(() => {
            const el = maxScrollRef.current;
            if (el) setViewportPromptIndex(resolveViewportPromptIndex(el));
        });
        const onKey = (e: KeyboardEvent) => {
            const mod = e.metaKey || e.ctrlKey;
            if (mod && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                e.stopPropagation();
                setFindOpen(true);
                requestAnimationFrame(() => {
                    findInputRef.current?.focus();
                    findInputRef.current?.select();
                });
                return;
            }
            if (findOpen && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                const el = e.target as HTMLElement | null;
                const tag = el?.tagName;
                // Find input / composer handle their own keys.
                if (tag === 'TEXTAREA' || tag === 'INPUT') return;
                const matches = findMatchingMessageIndexes(card?.messages ?? [], findQuery);
                if (matches.length > 0) {
                    e.preventDefault();
                    goToFindMatch(
                        findMatchCursor + (e.key === 'ArrowDown' ? 1 : -1),
                        matches,
                    );
                }
                return;
            }
            if (e.key === 'Escape') {
                if (useCanvasStore.getState().inboxOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    useCanvasStore.getState().closeInbox();
                    return;
                }
                if (findOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    closeFind();
                    return;
                }
                setMaximized(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', onKey);
        };
    }, [maximized, findOpen, findQuery, findMatchCursor, closeFind, goToFindMatch, card?.messages, setMaximized]);

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

    // Minimized: the whole node collapses to a title strip. Live hooks above
    // keep running (stream follow, pendingDraft restore), so maximizing
    // brings the thread back exactly where it was.
    if (card.minimized) {
        return (
            <MinimizedCardBar
                title={card.title}
                selected={focused}
                leading={
                    <span className={cn('size-2 shrink-0 rounded-full', statusDot[card.status])} />
                }
                onMaximize={() => useCanvasStore.getState().updateCard(id, { minimized: false })}
            />
        );
    }

    const submit = async () => {
        const text = draft.trim();
        const attachments = [...draftAttachments];
        boxMailLog('card submit', {
            cardId: id,
            textPreview: text.slice(0, 100),
            images: attachments.length,
        });
        if (!text && attachments.length === 0) {
            boxMailLog('card submit abort: empty');
            return;
        }
        setDraft('');
        setDraftAttachments([]);
        const ok = await sendMessage(id, text, { attachments });
        boxMailLog('card submit done', { ok });
        // Failed — hand the text/images back behind anything typed since, never over it.
        if (!ok) {
            setDraft((prev) => (prev ? `${prev}\n\n${text}` : text));
            if (attachments.length > 0) {
                setDraftAttachments((prev) => [...attachments, ...prev]);
            }
        }
    };

    /** Reveal a freshly forked card next to its parent. */
    const revealNewCard = (newId: string) => {
        const child = useCanvasStore.getState().cards.find((c) => c.id === newId);
        if (!child) return;
        const w = child.size?.width ?? DEFAULT_CARD_SIZE.width;
        const h = child.size?.height ?? DEFAULT_CARD_SIZE.height;
        setCenter(child.position.x + w / 2, child.position.y + h / 2, {
            zoom: getZoom(),
            duration: 320,
        });
    };

    /** Fork the whole card, or a branch up to one pi entry. */
    const forkAt = (atEntryId?: string) => {
        void (async () => {
            const newId = await forkCard(id, atEntryId);
            revealNewCard(newId);
        })();
    };

    const forkThis = () => forkAt();

    /**
     * Fork up to one message. Streamed messages do not carry pi entry ids, so
     * hydrate the transcript once on demand and then read the entry for that
     * index. Falls back to a whole-card fork if the entry cannot be resolved.
     */
    const forkAtMessage = (index: number) => {
        void (async () => {
            const cardNow = () => useCanvasStore.getState().cards.find((c) => c.id === id);
            let msgs = cardNow()?.messages ?? [];
            if (!msgs[index]?.entryId) {
                await useCanvasStore.getState().hydrateMessages(id);
                msgs = cardNow()?.messages ?? [];
            }
            const newId = await forkCard(id, msgs[index]?.entryId);
            revealNewCard(newId);
        })();
    };

    /**
     * Send an edited user message from its own position: revert the session to
     * just before it, then send the new text so every later turn is dropped from
     * the active branch.
     */
    const editMessage = (index: number, text: string) => {
        void (async () => {
            const cardNow = () => useCanvasStore.getState().cards.find((c) => c.id === id);
            let msgs = cardNow()?.messages ?? [];
            if (!msgs[index]?.entryId) {
                await useCanvasStore.getState().hydrateMessages(id);
                msgs = cardNow()?.messages ?? [];
            }
            const entryId = msgs[index]?.entryId;
            if (!entryId) {
                console.error(
                    `[melon] edit: no entryId for message ${index} — the server transcript has no entry ids. Restart melon-server.`,
                );
                useCanvasStore.setState({
                    canvasNotice:
                        'Could not edit: the server did not provide a message id. Restart melon-server and reload.',
                });
                return;
            }
            await useCanvasStore.getState().editUserMessage(id, entryId, text, index);
        })();
    };

    const historyEntries = card.sessionHistory ?? [];
    const viewingHistoryId = card.viewingHistoryId ?? null;
    const viewingEntry = viewingHistoryId
        ? historyEntries.find((h) => h.id === viewingHistoryId) ?? null
        : null;
    const displayMessages = viewingEntry?.messages ?? card.messages;
    const viewingHistory = Boolean(viewingEntry);

    const openPreviousHistory = () => {
        void (async () => {
            if (viewingHistory) {
                useCanvasStore.getState().setViewingHistory(id, null);
                return;
            }
            if (historyEntries.length === 0) return;
            if (historyEntries.length === 1) {
                useCanvasStore.getState().setViewingHistory(id, historyEntries[0]!.id);
                return;
            }
            const choice = await askChoice({
                title: 'Previous history',
                description: 'Pick which archived chat to view. Your live session stays as it is.',
                options: [...historyEntries]
                    .reverse()
                    .map((h) => ({
                        value: h.id,
                        label: h.label,
                        description: `${h.messages.length} messages`,
                    })),
            });
            if (choice) useCanvasStore.getState().setViewingHistory(id, choice);
        })();
    };

    const header = (isMax: boolean) => (
        <div
            className={cn(
                'flex shrink-0 items-center gap-2 border-b border-border',
                isMax ? 'h-14 px-4' : 'rounded-t-xl px-3 py-2',
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
                    title={
                        card.agentProfileId
                            ? `${card.title} · id ${card.id}${card.agentInstanceName ? ` · ${card.agentInstanceName}` : ''}`
                            : 'Double-click to rename'
                    }
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingTitle(true);
                    }}
                >
                    {card.title}
                </span>
            )}
            {card.agentProfileId && (
                <span
                    className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground"
                    title={`Profile ${card.agentProfileId} · ${card.id}${card.agentInstanceName ? ` · ${card.agentInstanceName}` : ''} · ${card.status === 'streaming' ? 'thinking' : card.status === 'error' ? 'error' : 'idle'}`}
                >
                    agent
                </span>
            )}

            {card.contextUsage?.percent != null ? (
                <ContextMeter
                    percent={card.contextUsage.percent}
                    tokens={card.contextUsage.tokens}
                    contextWindow={card.contextUsage.contextWindow}
                />
            ) : null}

            {isMax ? (
                <>
                    {historyEntries.length > 0 ? (
                        <HeaderDot
                            title={viewingHistory ? 'Back to live session' : 'Previous history'}
                            active={viewingHistory}
                            badge={historyEntries.length > 9 ? '9+' : historyEntries.length}
                            onClick={(e) => {
                                e.stopPropagation();
                                openPreviousHistory();
                            }}
                        />
                    ) : null}
                    <FullscreenExitButton onExit={() => setMaximized(false)} />
                </>
            ) : (
                <>
                    <HeaderDot
                        title="Node inbox"
                        tone={(card.boxInboxPending ?? 0) > 0 ? 'amber' : 'muted'}
                        badge={
                            (card.boxInboxPending ?? 0) > 0
                                ? (card.boxInboxPending ?? 0) > 9
                                    ? '9+'
                                    : card.boxInboxPending
                                : null
                        }
                        onClick={(e) => {
                            e.stopPropagation();
                            useCanvasStore.getState().openInbox(id);
                        }}
                    />
                    {historyEntries.length > 0 ? (
                        <HeaderDot
                            title={viewingHistory ? 'Back to live session' : 'Previous history'}
                            active={viewingHistory}
                            badge={historyEntries.length > 9 ? '9+' : historyEntries.length}
                            onClick={(e) => {
                                e.stopPropagation();
                                openPreviousHistory();
                            }}
                        />
                    ) : null}
                    <HeaderDot
                        title={serverOffline ? 'Reconnecting to server…' : 'Fork this conversation'}
                        disabled={serverOffline}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (serverOffline) return;
                            forkThis();
                        }}
                    />
                    <HeaderDot
                        title="Minimize to title strip"
                        onClick={(e) => {
                            e.stopPropagation();
                            useCanvasStore.getState().updateCard(id, { minimized: true });
                        }}
                    />
                    <HeaderDot
                        title="Full screen"
                        onClick={(e) => {
                            e.stopPropagation();
                            setMaximized(true);
                        }}
                    />
                    <HeaderDot
                        title="Delete card"
                        tone="danger"
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
                    />
                </>
            )}
        </div>
    );

    /** One assistant message = independent sibling blocks (DSH-style). */
    // MessageBlocks now lives at module level (stable identity — an inline
    // component here caused React to remount every message on each render,
    // reloading viz iframes and making the chat bounce).

    const messagesBody = (scrollTo: React.RefObject<HTMLDivElement>, opts?: { roomy?: boolean }) => {
        const streaming = !viewingHistory && card.status === 'streaming';
        // roomy (maximized): scroll surface is full-bleed so side gutters/padding
        // still receive wheel events; max-width + horizontal padding live INSIDE.
        return (
        <div className="relative min-h-0 min-w-0 flex-1">
            {viewingHistory ? (
                <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-secondary/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                    <span className="truncate">Previous history · {viewingEntry?.label}</span>
                    <button
                        type="button"
                        className="nodrag shrink-0 rounded px-1.5 py-0.5 text-foreground hover:bg-secondary"
                        onClick={(e) => {
                            e.stopPropagation();
                            useCanvasStore.getState().setViewingHistory(id, null);
                        }}
                    >
                        Back to live
                    </button>
                </div>
            ) : null}
            <div
                ref={scrollTo}
                onScroll={(e) => handleMessagesScroll(e.currentTarget)}
                className={cn(
                    'nodrag nowheel h-full cursor-default select-text overflow-y-auto',
                    // Vertical padding on the scroller; space-y on the inner
                    // column so user/thinking blocks get the same gaps as tools.
                    opts?.roomy ? 'py-5' : 'px-4 py-3',
                )}
            >
                <div
                    className={cn(
                        'space-y-4',
                        opts?.roomy &&
                            'mx-auto w-full max-w-3xl px-5 md:px-8',
                    )}
                >
                    {displayMessages.length === 0 && !streaming && (
                        <p className="flex h-full items-center justify-center text-xs text-muted-foreground">
                            {viewingHistory ? 'This archive is empty.' : 'Ask something to start this thread.'}
                        </p>
                    )}
                    {displayMessages.map((m, i) => (
                        <MessageBlocks
                            key={i}
                            m={m}
                            index={i}
                            cardId={id}
                            streaming={streaming}
                            totalMessages={displayMessages.length}
                            highlighted={highlightedIndex === i}
                            findQuery={findOpen ? findQuery : ''}
                            findActive={findOpen && highlightedIndex === i}
                            onFork={viewingHistory ? undefined : forkAtMessage}
                            onEditSubmit={
                                viewingHistory || !EDIT_MESSAGE_ENABLED ? undefined : editMessage
                            }
                        />
                    ))}
                </div>
            </div>
            {showDown && (
                <button
                    className="nodrag absolute bottom-3 left-1/2 z-10 flex size-7 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-md transition-colors hover:bg-secondary hover:text-foreground"
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
        <div className={cn('shrink-0', maximized ? 'px-0 py-3' : 'p-2')}>
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
                                            const restored =
                                                useCanvasStore.getState().takeQueuedAttachments(id, q);
                                            const restoreText = q === '(image)' && restored.length > 0 ? '' : q;
                                            if (restoreText) {
                                                setDraft((prev) => (prev ? `${prev}\n\n${restoreText}` : restoreText));
                                            }
                                            if (restored.length > 0) {
                                                setDraftAttachments((prev) => [...restored, ...prev]);
                                            }
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
                <p
                    className="mb-2 flex w-fit items-center gap-2.5 px-0.5 text-[length:var(--text-chat)] text-muted-foreground"
                    role="status"
                    aria-live="polite"
                >
                    <MatrixLoader />
                    <span className="shimmer-text">{activityLabel}</span>
                </p>
            )}
            <PromptComposer
                value={draft}
                onChange={setDraft}
                onSubmit={submit}
                attachments={draftAttachments}
                onAttachmentsChange={setDraftAttachments}
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
                disabled={serverOffline || viewingHistory}
                cardId={id}
                placeholder={
                    serverOffline
                        ? 'Reconnecting to server…'
                        : viewingHistory
                          ? 'Viewing previous history — switch back to live to chat'
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
                    'relative flex h-full w-full flex-col rounded-xl border bg-card shadow-sm transition-shadow',
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
                        {card.compactionFailed && (
                            <button
                                className="nodrag shrink-0 rounded border border-red-400/40 px-2 py-0.5 text-[11px] text-red-200 transition-colors hover:bg-red-500/20"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    useCanvasStore.getState().retryCompaction(id);
                                }}
                                title="Retry background compaction"
                            >
                                Retry
                            </button>
                        )}
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
                {view === 'trajectory'
                    ? trajectoryBody
                    : view === 'json'
                        ? <SessionJsonViewer cardId={id} sessionFile={card.sessionFile} />
                        : messagesBody(scrollRef)}
                {showDebugConsole && <DebugConsole logs={card.logs ?? []} />}
                {footerInput}
            </div>

            {maximized && (
                <FullscreenShell
                    cardId={id}
                    ariaLabel={card.title || 'Chat'}
                    header={header(true)}
                    banners={
                        <>
                            {card.error && (
                                <div className="nodrag flex items-start gap-2 border-b border-red-500/30 bg-red-500/10 px-5 py-2">
                                    <span className="shrink-0 text-xs">⚠️</span>
                                    <span className="min-w-0 flex-1 break-words text-[11px] leading-relaxed text-red-300">
                                        {card.error}
                                    </span>
                                    {card.compactionFailed && (
                                        <button
                                            className="nodrag shrink-0 rounded border border-red-400/40 px-2 py-0.5 text-[11px] text-red-200 transition-colors hover:bg-red-500/20"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                useCanvasStore.getState().retryCompaction(id);
                                            }}
                                            title="Retry background compaction"
                                        >
                                            Retry
                                        </button>
                                    )}
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
                        </>
                    }
                >
                    <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                        {findOpen && (
                            <div className="pointer-events-none absolute right-5 top-3 z-40 sm:right-8">
                                <div className="pointer-events-auto">
                                    <MaximizedFindBar
                                        query={findQuery}
                                        matchIndex={findMatches.length === 0 ? 0 : findMatchCursor}
                                        matchCount={findMatches.length}
                                        onQueryChange={onFindQueryChange}
                                        onPrev={() => goToFindMatch(findMatchCursor - 1, findMatches)}
                                        onNext={() => goToFindMatch(findMatchCursor + 1, findMatches)}
                                        onClose={closeFind}
                                        inputRef={findInputRef}
                                    />
                                </div>
                            </div>
                        )}
                        {view === 'json' ? (
                            <SessionJsonViewer cardId={id} sessionFile={card.sessionFile} className="mx-5 mb-4 md:mx-8" />
                        ) : view === 'trajectory' ? (
                            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-5 md:px-8">
                                <TrajectoryView card={card} />
                            </div>
                        ) : (
                            <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
                                <UserPromptSideNav
                                    prompts={card.messages
                                        .map((m, index) => ({ index, text: m.text, role: m.role }))
                                        .filter((m) => m.role === 'user' && m.text.trim().length > 0)
                                        .map(({ index, text }) => ({ index, text }))}
                                    activeIndex={viewportPromptIndex}
                                    onJump={jumpToUserPrompt}
                                />
                                {/* Full-bleed scroll; reading column width is applied inside messagesBody. */}
                                {messagesBody(maxScrollRef, { roomy: true })}
                                {showDebugConsole && (
                                    <div className="mx-auto w-full max-w-3xl shrink-0 px-5 md:px-8">
                                        <DebugConsole logs={card.logs ?? []} />
                                    </div>
                                )}
                                <div className="mx-auto w-full max-w-3xl shrink-0 px-5 md:px-8">
                                    {footerInput}
                                </div>
                            </div>
                        )}
                    </div>
                </FullscreenShell>
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


export const ChatCardNode = ReactMemo(ChatCardNodeInner);
