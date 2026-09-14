import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ArrowUp, Paperclip, Square, X } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { SkillsPicker } from '@/components/skills-picker';
import { ThinkingPicker } from '@/components/thinking-picker';
import { useComposerAttachments } from '@/hooks/use-composer-attachments';
import { boxMentionLabel } from '@/lib/agent-names';
import { boxMailLog } from '@/lib/box-mail-brief';
import { useImageLightbox } from '@/components/image-lightbox';
import {
    attachmentDataUrl,
    COMPOSER_IMAGE_ACCEPT,
    dataTransferHasFiles,
    filesFromDataTransfer,
} from '@/lib/composer-attachments';
import { filesFromClipboard, insertPlainAt, plainTextFromClipboard } from '@/lib/composer-paste';
import {
    activeMention,
    fetchFileCandidates,
    mentionExists,
    type MentionSpan,
    splitMentionSpans,
} from '@/lib/mentions';
import { modelSupportsImages, normalizeModel, type ModelInfo } from '@/lib/models';
import { cn } from '@/lib/utils';
import { useCanvasStore } from '@/store/canvas-store';
import type { ComposerAttachment } from '@/types/session-card';

export type ComposerPermission = 'full' | 'readonly';

const CARD_TEXT = 'text-[length:var(--text-chat)] leading-5';
const HERO_TEXT = 'text-sm leading-relaxed';
/**
 * Shared wrap + font metrics so the transparent textarea caret tracks the
 * mention backdrop (arrow keys / Shift+Enter). Do not diverge these.
 */
const FIELD_METRICS =
    'break-words whitespace-pre-wrap font-[inherit] tracking-normal [font-kerning:none] [tab-size:4]';
/** Transparent glyphs + visible caret; fill-color blocks WebKit black-on-paste. */
const TA_INVISIBLE: CSSProperties = {
    color: 'transparent',
    // WebKit paints fill separately from `color` — keep both transparent.
    WebkitTextFillColor: 'transparent',
};

function assertInvisibleTextarea(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.color = 'transparent';
    el.style.webkitTextFillColor = 'transparent';
}

function syncBackdropScroll(from: HTMLTextAreaElement, to: HTMLDivElement | null) {
    if (!to) return;
    to.scrollTop = from.scrollTop;
    to.scrollLeft = from.scrollLeft;
}

type MentionItem =
    | { kind: 'agent'; token: string; label: string; cardId: string; status: string }
    | { kind: 'file'; token: string; label: string; path: string; title?: string };

/** Backdrop span colors: agent = sky · file exists = sky · missing = red · unknown = dotted. */
function MentionBackdropSpans({
    spans,
    cwd,
    agentTokens,
}: {
    spans: MentionSpan[];
    cwd: string | null;
    agentTokens: Set<string>;
}) {
    return (
        <>
            {spans.map((s, i) =>
                s.mention ? (
                    <span
                        key={i}
                        className={cn(
                            'rounded-sm',
                            agentTokens.has(s.mention.toLowerCase()) || mentionExists(cwd, s.mention) === true
                                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                : mentionExists(cwd, s.mention) === false
                                  ? 'bg-red-500/10 text-red-500'
                                  : 'text-muted-foreground underline decoration-dotted underline-offset-2',
                        )}
                    >
                        {s.text}
                    </span>
                ) : (
                    <span key={i} className="text-foreground">
                        {s.text}
                    </span>
                ),
            )}
        </>
    );
}

export function PromptComposer({
    value,
    onChange,
    onSubmit,
    model,
    onModelChange,
    skills,
    onSkillsChange,
    permission,
    onPermissionChange,
    thinkingLevel,
    thinkingLevels,
    onThinkingChange,
    sending = false,
    onStop,
    disabled = false,
    submitDisabled = false,
    autoFocus = false,
    placeholder = 'Ask anything…  (Enter to send, Shift+Enter for newline)',
    className,
    size = 'card',
    cardId,
    attachments = [],
    onAttachmentsChange,
}: {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    model: string;
    onModelChange: (model: string) => void;
    skills: string[];
    onSkillsChange: (skills: string[]) => void;
    permission: ComposerPermission;
    onPermissionChange: (permission: ComposerPermission) => void;
    /** Per-card thinking level (server-synced). Omit to hide the picker. */
    thinkingLevel?: string;
    /** Levels the current model supports; falls back to pi's full list. */
    thinkingLevels?: string[];
    onThinkingChange?: (level: string) => void;
    sending?: boolean;
    onStop?: () => void;
    disabled?: boolean;
    submitDisabled?: boolean;
    autoFocus?: boolean;
    placeholder?: string;
    className?: string;
    /** `hero` = taller empty-canvas inbox; `card` = compact card footer. */
    size?: 'card' | 'hero';
    /** Card id for Cursor debug logging (omit on empty-canvas hero). */
    cardId?: string;
    /** Image attachments (owned by the card store / hero local state). */
    attachments?: readonly ComposerAttachment[];
    onAttachmentsChange?: (
        update:
            | ComposerAttachment[]
            | ((prev: ComposerAttachment[]) => ComposerAttachment[]),
    ) => void;
}) {
    const hero = size === 'hero';
    const maxHeight = hero ? 220 : 120;
    const [openPicker, setOpenPicker] = useState<'model' | 'skills' | 'thinking' | null>(null);
    const [catalogModels, setCatalogModels] = useState<ModelInfo[]>([]);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const [attachNotice, setAttachNotice] = useState<string | null>(null);
    const openLightbox = useImageLightbox((s) => s.open);

    useEffect(() => {
        let alive = true;
        fetch('/models')
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { models?: Array<Record<string, unknown>> } | null) => {
                if (!alive || !d?.models) return;
                setCatalogModels(
                    d.models.map(normalizeModel).filter((m): m is ModelInfo => m !== null),
                );
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    const imageSupported = useMemo(() => {
        const hit = catalogModels.find((m) => m.label === model);
        return modelSupportsImages(hit);
    }, [catalogModels, model]);

    const setAttachments = useCallback(
        (
            update:
                | ComposerAttachment[]
                | ((prev: ComposerAttachment[]) => ComposerAttachment[]),
        ) => {
            onAttachmentsChange?.(update);
        },
        [onAttachmentsChange],
    );

    const attachmentCtrl = useComposerAttachments({
        attachments,
        disabled: disabled || !onAttachmentsChange,
        imageSupported,
        onAttachmentsChange: setAttachments,
        onNotice: (_title, detail) => {
            setAttachNotice(detail);
            window.setTimeout(() => setAttachNotice(null), 4000);
        },
    });

    // Strip images when switching to a non-vision model.
    useEffect(() => {
        if (imageSupported || attachments.length === 0) return;
        setAttachments((current) => current.filter((a) => a.kind !== 'image'));
        setAttachNotice('Images removed — this model cannot see images.');
        window.setTimeout(() => setAttachNotice(null), 4000);
    }, [imageSupported]); // eslint-disable-line react-hooks/exhaustive-deps — only on capability flip

    // ── slash commands ──
    const COMMANDS = [
        {
            name: 'send',
            hint: 'mail another node — lands in their inbox for Approve',
        },
        {
            name: 'handoff',
            hint: 'distill this conversation into a note — your message names it and steers the focus',
        },
        {
            name: 'compact',
            hint: 'archive this chat under Previous history, start fresh, put the handoff in the input',
        },
        {
            name: 'diagram',
            hint: 'render a diagram of this conversation or your topic — the right visual type is chosen for you',
        },
    ] as const;

    // ── @-mentions (agents on this canvas + files) ──
    const cwd = useCanvasStore((s) => s.worktreePath ?? s.folder);
    const folder = useCanvasStore((s) => s.folder);
    const cards = useCanvasStore((s) => s.cards);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [cmdDismissed, setCmdDismissed] = useState(false);
    const [cmdHighlight, setCmdHighlight] = useState(0);
    const [profileNames, setProfileNames] = useState<Record<string, string>>({});
    const [fileItems, setFileItems] = useState<Array<{ path: string; title?: string }>>([]);
    const [highlight, setHighlight] = useState(0);
    const itemsRef = useRef<MentionItem[]>([]);
    const highlightRef = useRef(0);
    const mentionRef = useRef<ReturnType<typeof activeMention>>(null);

    const mention = activeMention(value, caret);
    const mentionOpen = mention !== null && !dismissed;
    // Command dropdown: while the FIRST token is still being typed ("/", "/ha…").
    const cmdMatch = value.trim().match(/^\/([a-z-]*)$/i);
    const cmdOpen = cmdMatch !== null && !cmdDismissed;
    const cmdItems = cmdMatch
        ? COMMANDS.filter((c) => c.name.startsWith(cmdMatch[1].toLowerCase()))
        : [];

    useEffect(() => {
        let alive = true;
        fetch('/agents')
            .then((r) => (r.ok ? r.json() : null))
            .then((d: { agents?: Array<{ id: string; name: string }> } | null) => {
                if (!alive || !d?.agents) return;
                const map: Record<string, string> = {};
                for (const a of d.agents) {
                    if (a.id && a.name) map[a.id] = a.name;
                }
                setProfileNames(map);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, []);

    const agentTokens = useMemo(() => {
        const set = new Set<string>();
        for (const c of cards) {
            if ((c.kind ?? 'chat') !== 'chat') continue;
            if (cardId && c.id === cardId) continue;
            set.add(c.id.toLowerCase());
            if (c.agentInstanceName) set.add(c.agentInstanceName.toLowerCase());
        }
        return set;
    }, [cards, cardId]);

    const agentItems = useMemo((): MentionItem[] => {
        if (!mention) return [];
        const q = mention.query.toLowerCase();
        const out: MentionItem[] = [];
        for (const c of cards) {
            if ((c.kind ?? 'chat') !== 'chat') continue;
            if (cardId && c.id === cardId) continue;
            const profileName = c.agentProfileId ? profileNames[c.agentProfileId] : undefined;
            const label = boxMentionLabel({
                title: c.title,
                agentInstanceName: c.agentInstanceName,
                agentProfileId: c.agentProfileId,
                profileName,
            });
            const token = c.agentInstanceName?.trim() || c.id;
            const hay = `${label} ${token} ${c.title} ${c.agentProfileId ?? ''}`.toLowerCase();
            if (q && !hay.includes(q)) continue;
            const status =
                c.status === 'streaming' ? 'thinking' : c.status === 'error' ? 'error' : 'idle';
            out.push({ kind: 'agent', token, label, cardId: c.id, status });
        }
        return out.slice(0, 12);
    }, [cards, cardId, mention, profileNames]);

    const items = useMemo((): MentionItem[] => {
        if (!mention) return [];
        const files: MentionItem[] = fileItems.map((f) => ({
            kind: 'file',
            token: f.path,
            label: f.title ?? f.path,
            path: f.path,
            title: f.title,
        }));
        return [...agentItems, ...files];
    }, [mention, agentItems, fileItems]);

    itemsRef.current = items;
    highlightRef.current = highlight;
    mentionRef.current = mention;

    useEffect(() => {
        if (!mentionOpen) return;
        boxMailLog('dropdown open', {
            query: mention?.query ?? '',
            agents: agentItems.length,
            files: fileItems.length,
            items: items.length,
            cardId: cardId ?? null,
        });
    }, [mentionOpen, mention?.query, agentItems.length, fileItems.length, items.length, cardId]);

    useEffect(() => {
        if (!mention) {
            setFileItems([]);
            return;
        }
        let alive = true;
        const t = setTimeout(async () => {
            const files = await fetchFileCandidates(cwd, mention.query, folder !== cwd ? folder : null);
            if (alive) {
                setFileItems(files);
                setHighlight(0);
            }
        }, 120);
        return () => {
            alive = false;
            clearTimeout(t);
        };
    }, [mention?.query, cwd, folder]);

    useEffect(() => {
        setHighlight(0);
    }, [agentItems.length, fileItems.length, mention?.query]);

    const syncCaret = (el: HTMLTextAreaElement | null) => {
        if (el) setCaret(el.selectionStart ?? 0);
    };

    const pickCandidate = useCallback(
        (token: string) => {
            const el = taRef.current;
            const liveCaret = el?.selectionStart ?? caret;
            const live = activeMention(value, liveCaret) ?? mentionRef.current ?? mention;
            if (!live || !token) {
                boxMailLog('pick @ aborted', { token, query: live?.query ?? null, liveCaret });
                return;
            }
            boxMailLog('pick @ complete', {
                from: live.query,
                to: token,
                start: live.start,
                end: live.end,
            });
            const insert = `@${token} `;
            const next = value.slice(0, live.start) + insert + value.slice(live.end);
            onChange(next);
            setDismissed(true);
            requestAnimationFrame(() => {
                const box = taRef.current;
                if (!box) return;
                const pos = live.start + insert.length;
                box.focus();
                box.setSelectionRange(pos, pos);
                setCaret(pos);
                box.style.height = 'auto';
                box.style.height = `${Math.min(Math.max(box.scrollHeight, hero ? 112 : 0), maxHeight)}px`;
            });
        },
        [mention, value, caret, onChange, hero, maxHeight],
    );

    const growTextarea = useCallback(
        (el: HTMLTextAreaElement | null) => {
            if (!el) return;
            el.style.height = 'auto';
            const min = hero ? 112 : 0;
            el.style.height = `${Math.min(Math.max(el.scrollHeight, min), maxHeight)}px`;
        },
        [hero, maxHeight],
    );
    const canSubmit =
        !disabled &&
        !submitDisabled &&
        !attachmentCtrl.isProcessing &&
        (value.trim().length > 0 || attachments.length > 0);
    const spans = splitMentionSpans(value);
    const dropZoneActive = attachmentCtrl.isDraggingFiles;

    return (
        <div
            className={cn(
                'relative rounded-xl border border-input bg-background shadow-sm focus-within:border-ring',
                hero && 'relative border-transparent shadow-none focus-within:border-transparent',
                dropZoneActive && 'border-ring ring-2 ring-ring/30',
                className,
            )}
            {...(onAttachmentsChange ? attachmentCtrl.dropZoneProps : {})}
        >
            {dropZoneActive && (
                <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl bg-background/80">
                    <p className="text-sm font-medium text-muted-foreground">Drop to attach</p>
                </div>
            )}
            {attachments.length > 0 && (
                <div
                    className={cn(
                        'flex flex-wrap gap-2',
                        hero ? 'px-4 pt-3' : 'px-3 pt-2',
                    )}
                >
                    {attachments.map((att) => {
                        const src = attachmentDataUrl(att);
                        return (
                            <div
                                key={att.id}
                                className="relative size-16 overflow-hidden rounded-lg border border-border bg-secondary"
                            >
                                <button
                                    type="button"
                                    className="nodrag block size-full cursor-zoom-in"
                                    title="View image"
                                    aria-label={`View ${att.name}`}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openLightbox(src, att.name);
                                    }}
                                >
                                    <img
                                        alt={att.name}
                                        className="block size-full object-cover"
                                        src={src}
                                        draggable={false}
                                    />
                                </button>
                                <button
                                    type="button"
                                    aria-label={`Remove ${att.name}`}
                                    className="nodrag absolute right-0.5 top-0.5 grid size-4 place-items-center rounded-full bg-foreground/80 text-background hover:bg-foreground"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        attachmentCtrl.remove(att.id);
                                    }}
                                >
                                    <X className="size-2.5" />
                                </button>
                            </div>
                        );
                    })}
                    {attachmentCtrl.isProcessing && (
                        <div className="flex size-16 items-center justify-center rounded-lg border border-dashed border-border text-[10px] text-muted-foreground">
                            Preparing…
                        </div>
                    )}
                </div>
            )}
            {attachNotice && (
                <p
                    className={cn(
                        'text-[10px] text-amber-600 dark:text-amber-400',
                        hero ? 'px-4 pt-1' : 'px-3 pt-1',
                    )}
                    role="status"
                >
                    {attachNotice}
                </p>
            )}
            <div className="relative">
                {/* Highlight backdrop — same metrics as the textarea; the textarea
                    text is transparent and only the caret stays visible. */}
                <div
                    ref={backdropRef}
                    aria-hidden
                    className={cn(
                        'composer-backdrop pointer-events-none absolute inset-0 overflow-hidden text-foreground',
                        FIELD_METRICS,
                        hero ? `px-4 pt-4 pb-2 ${HERO_TEXT}` : `px-3 pt-2.5 pb-1 ${CARD_TEXT}`,
                    )}
                >
                    <MentionBackdropSpans spans={spans} cwd={cwd} agentTokens={agentTokens} />
                    {/* Textarea paints a blank line for a trailing \\n; a div does not
                        unless we mirror it — otherwise arrows drift on the last line. */}
                    {value.endsWith('\n') ? '\n' : null}
                </div>
                <textarea
                    autoFocus={autoFocus}
                    rows={hero ? 4 : 1}
                    value={value}
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    ref={(el) => {
                        taRef.current = el;
                        assertInvisibleTextarea(el);
                        growTextarea(el);
                    }}
                    disabled={disabled}
                    onChange={(e) => {
                        assertInvisibleTextarea(e.currentTarget);
                        onChange(e.target.value);
                        growTextarea(e.target);
                        setCaret(e.target.selectionStart ?? 0);
                        setDismissed(false);
                        setCmdDismissed(false);
                    }}
                    onPaste={(e) => {
                        // Keyboard paste: image files (screenshots) win over text.
                        const pastedFiles = filesFromClipboard(e.clipboardData);
                        if (pastedFiles.length > 0 && onAttachmentsChange) {
                            e.preventDefault();
                            attachmentCtrl.addFiles(pastedFiles);
                            return;
                        }
                        e.preventDefault();
                        // Plain text only — never HTML — so the mention backdrop stays in sync.
                        const clean = plainTextFromClipboard(e.clipboardData);
                        const start = e.currentTarget.selectionStart ?? 0;
                        const end = e.currentTarget.selectionEnd ?? 0;
                        const { next, caret: pos } = insertPlainAt(value, start, end, clean);
                        onChange(next);
                        requestAnimationFrame(() => {
                            const el = e.currentTarget;
                            el.focus();
                            assertInvisibleTextarea(el);
                            el.setSelectionRange(pos, pos);
                            setCaret(pos);
                            growTextarea(el);
                            syncBackdropScroll(el, backdropRef.current);
                        });
                    }}
                    onDragOver={(e) => {
                        if (dataTransferHasFiles(e.dataTransfer) && onAttachmentsChange) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                            return;
                        }
                        // Allow dropping plain text into the field (same path as paste).
                        if (Array.from(e.dataTransfer.types).some((t) => t === 'text/plain' || t === 'text/html' || t === 'text')) {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = 'copy';
                        }
                    }}
                    onDrop={(e) => {
                        const droppedFiles = filesFromDataTransfer(e.dataTransfer);
                        if (droppedFiles.length > 0 && onAttachmentsChange) {
                            e.preventDefault();
                            e.stopPropagation();
                            attachmentCtrl.addFiles(droppedFiles);
                            return;
                        }
                        const types = Array.from(e.dataTransfer.types);
                        if (!types.some((t) => t === 'text/plain' || t === 'text/html' || t === 'text' || t === 'text/uri-list')) {
                            return;
                        }
                        e.preventDefault();
                        e.stopPropagation();
                        const clean = plainTextFromClipboard(e.dataTransfer);
                        if (!clean) return;
                        const start = e.currentTarget.selectionStart ?? value.length;
                        const end = e.currentTarget.selectionEnd ?? start;
                        const { next, caret: pos } = insertPlainAt(value, start, end, clean);
                        onChange(next);
                        requestAnimationFrame(() => {
                            const el = e.currentTarget;
                            el.focus();
                            assertInvisibleTextarea(el);
                            el.setSelectionRange(pos, pos);
                            setCaret(pos);
                            growTextarea(el);
                        });
                    }}
                    onFocus={(e) => assertInvisibleTextarea(e.currentTarget)}
                    onSelect={(e) => syncCaret(e.currentTarget)}
                    onClick={(e) => {
                        syncCaret(e.currentTarget);
                        e.stopPropagation();
                    }}
                    onKeyUp={(e) => syncCaret(e.currentTarget)}
                    onScroll={(e) => {
                        syncBackdropScroll(e.currentTarget, backdropRef.current);
                    }}
                    onKeyDown={(e) => {
                        // Keep canvas layout undo/redo from seeing composer keys, but
                        // never preventDefault on Mod-Z/Y — browser owns text undo/redo.
                        e.stopPropagation();
                        const key = e.key.toLowerCase();
                        if ((e.metaKey || e.ctrlKey) && (key === 'z' || key === 'y')) return;
                        // Command dropdown owns navigation while the first token is typed.
                        if (cmdOpen && cmdItems.length > 0) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setCmdHighlight((h) => (h + 1) % cmdItems.length);
                                return;
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setCmdHighlight((h) => (h - 1 + cmdItems.length) % cmdItems.length);
                                return;
                            }
                            if (e.key === 'Tab' || e.key === 'Enter') {
                                e.preventDefault();
                                const pick = cmdItems[cmdHighlight] ?? cmdItems[0];
                                if (pick) {
                                    onChange(`/${pick.name} `);
                                    setCmdDismissed(true);
                                }
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                setCmdDismissed(true);
                                return;
                            }
                        }
                        // Mention autocomplete (keyboard-first).
                        // While an @token is being typed: Enter/Tab MUST complete the
                        // highlighted row to the FULL token (e.g. @swi → @swift-otter).
                        // Never submit the partial @swi as a user message.
                        const liveMention = mentionRef.current ?? mention;
                        const liveItems = itemsRef.current;
                        const liveOpen = liveMention !== null && !dismissed;
                        if (liveOpen) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                if (liveItems.length === 0) return;
                                setHighlight((h) => (h + 1) % liveItems.length);
                                return;
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                if (liveItems.length === 0) return;
                                setHighlight((h) => (h - 1 + liveItems.length) % liveItems.length);
                                return;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                const hi = highlightRef.current;
                                const chosen =
                                    liveItems[hi] ??
                                    liveItems[0] ??
                                    null;
                                boxMailLog(e.key === 'Enter' ? 'Enter → complete @' : 'Tab → complete @', {
                                    query: liveMention?.query,
                                    items: liveItems.length,
                                    highlight: hi,
                                    chosen: chosen
                                        ? { kind: chosen.kind, token: chosen.token, label: chosen.label }
                                        : null,
                                });
                                if (!chosen?.token) {
                                    boxMailLog('complete @ aborted: no candidate');
                                    return;
                                }
                                pickCandidate(chosen.token);
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                setDismissed(true);
                                return;
                            }
                            // Any other key while menu open: don't treat Enter fallthrough.
                        } else if (e.key === 'Escape' && dismissed) {
                            setDismissed(false);
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            // Safety: if caret is still inside an @token, never send raw partial.
                            const still = activeMention(value, taRef.current?.selectionStart ?? caret);
                            if (still && !dismissed) {
                                boxMailLog('Enter blocked: still inside @token', {
                                    query: still.query,
                                    draftPreview: value.slice(0, 80),
                                });
                                return;
                            }
                            boxMailLog('Enter → submit', {
                                canSubmit,
                                draftPreview: value.slice(0, 80),
                                cardId: cardId ?? null,
                            });
                            if (canSubmit) onSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    className={cn(
                        'composer-input nodrag nowheel relative block w-full resize-none bg-transparent caret-foreground outline-none disabled:cursor-not-allowed disabled:opacity-60',
                        // Placeholder must set fill-color too, or WebKit inherits transparent fill.
                        'placeholder:text-muted-foreground placeholder:[-webkit-text-fill-color:hsl(var(--muted-foreground))]',
                        FIELD_METRICS,
                        hero ? `min-h-[112px] max-h-[220px] px-4 pt-4 pb-2 ${HERO_TEXT}` : `max-h-[120px] px-3 pt-2.5 pb-1 ${CARD_TEXT}`,
                    )}
                    style={TA_INVISIBLE}
                />
                {cmdOpen && (
                    <div
                        className="absolute right-2 bottom-full left-2 z-50 mb-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                        onMouseDown={(e) => e.preventDefault()}
                        onKeyDown={(e) => e.stopPropagation()}
                    >
                        <div className="py-1">
                            {cmdItems.length === 0 && (
                                <p className="px-3 py-2 text-[11px] text-muted-foreground">Unknown command</p>
                            )}
                            {cmdItems.map((c, i) => (
                                <button
                                    key={c.name}
                                    className={cn(
                                        'block w-full px-3 py-1.5 text-left text-[11px] transition-colors',
                                        i === cmdHighlight ? 'bg-secondary text-card-foreground' : 'text-muted-foreground hover:bg-secondary/60',
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onChange(`/${c.name} `);
                                        setCmdDismissed(true);
                                        requestAnimationFrame(() => taRef.current?.focus());
                                    }}
                                >
                                    <span className="font-medium text-sky-600 dark:text-sky-400">/{c.name}</span>
                                    <span className="ml-2">{c.hint}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {mentionOpen && (
                    <div
                        className="absolute right-2 bottom-full left-2 z-50 mb-1 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                        onMouseDown={(e) => e.preventDefault()}
                        onKeyDown={(e) => e.stopPropagation()}
                    >
                        <div className="nowheel max-h-56 overflow-y-auto py-1">
                            {items.length === 0 && (
                                <p className="px-3 py-2 text-[11px] text-muted-foreground">
                                    {mention && mention.query.length > 0
                                        ? 'No matching agents or files'
                                        : 'Type to filter agents on this canvas or files…'}
                                </p>
                            )}
                            {items.map((item, i) => (
                                <button
                                    key={`${item.kind}:${item.token}`}
                                    className={cn(
                                        'block w-full px-3 py-1.5 text-left transition-colors',
                                        i === highlight ? 'bg-secondary' : 'hover:bg-secondary/60',
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        pickCandidate(item.token);
                                    }}
                                    title={
                                        item.kind === 'agent'
                                            ? `Mail ${item.label}`
                                            : cwd
                                              ? `${cwd}/${item.path}`
                                              : item.path
                                    }
                                >
                                    {item.kind === 'agent' ? (
                                        <>
                                            <div className="truncate text-[11px] font-medium text-card-foreground">
                                                <span className="text-sky-600 dark:text-sky-400">@</span>
                                                {item.label}
                                            </div>
                                            <div className="truncate text-[10px] text-muted-foreground">
                                                agent · {item.status} · Enter mails their inbox
                                            </div>
                                        </>
                                    ) : item.title ? (
                                        <>
                                            <div className="truncate text-[11px] font-medium text-card-foreground">
                                                <span className="text-sky-600 dark:text-sky-400">@</span>
                                                {item.title}
                                            </div>
                                            <div className="truncate text-[10px] text-muted-foreground">
                                                {item.path}
                                                {/\.melon\/notes\/manual\//.test(item.path) ? ' · manual' : ' · handoff'}
                                            </div>
                                        </>
                                    ) : (
                                        <div className="truncate text-[11px] text-muted-foreground">
                                            <span className="text-sky-600 dark:text-sky-400">@</span>
                                            {item.path}
                                        </div>
                                    )}
                                </button>
                            ))}
                            <p className="border-t border-border px-3 py-1 text-[9px] text-muted-foreground">
                                ↑↓ navigate · Enter/Tab complete full @name · type message · Enter send
                            </p>
                        </div>
                    </div>
                )}
            </div>
            <div
                className={cn(
                    'flex flex-wrap items-center gap-1',
                    hero ? 'px-3 pb-3 pt-1' : 'px-2 pb-1.5 pt-1',
                )}
            >
                {onAttachmentsChange && (
                    <>
                        <input
                            ref={fileInputRef}
                            type="file"
                            accept={COMPOSER_IMAGE_ACCEPT}
                            multiple
                            className="hidden"
                            onChange={(e) => {
                                const files = e.target.files ? Array.from(e.target.files) : [];
                                if (files.length) attachmentCtrl.addFiles(files);
                                e.target.value = '';
                            }}
                        />
                        <button
                            type="button"
                            disabled={disabled || attachmentCtrl.isProcessing}
                            className="nodrag flex size-7 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                            title="Attach image"
                            aria-label="Attach image"
                            onClick={(e) => {
                                e.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                        >
                            <Paperclip className="size-3.5" />
                        </button>
                    </>
                )}
                <SkillsPicker
                    value={skills}
                    onChange={onSkillsChange}
                    open={openPicker === 'skills'}
                    onOpenChange={(open) => setOpenPicker(open ? 'skills' : null)}
                />
                <ModelPicker
                    value={model}
                    onChange={onModelChange}
                    open={openPicker === 'model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'model' : null)}
                />
                {onThinkingChange && (
                    <ThinkingPicker
                        value={thinkingLevel}
                        levels={thinkingLevels}
                        onChange={onThinkingChange}
                        open={openPicker === 'thinking'}
                        onOpenChange={(open) => setOpenPicker(open ? 'thinking' : null)}
                    />
                )}
                <select
                    className="cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    title="Workspace permissions"
                    aria-label="Workspace permissions"
                    value={permission}
                    onChange={(e) => onPermissionChange(e.target.value as ComposerPermission)}
                    onClick={(e) => e.stopPropagation()}
                >
                    <option value="full">full access</option>
                    <option value="readonly">read-only</option>
                </select>
                <button
                    disabled={!sending && !canSubmit}
                    className={cn(
                        'ml-auto flex size-7 items-center justify-center rounded-full transition-colors',
                        sending
                            ? 'bg-foreground text-background hover:bg-foreground/80'
                            : canSubmit
                              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                              : 'cursor-not-allowed bg-secondary text-muted-foreground',
                    )}
                    title={sending ? 'Stop' : 'Send'}
                    aria-label={sending ? 'Stop generating' : 'Send message'}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (sending) onStop?.();
                        else if (canSubmit) onSubmit();
                    }}
                >
                    {sending ? (
                        <Square className="size-3" fill="currentColor" />
                    ) : (
                        <ArrowUp className="size-4" />
                    )}
                </button>
            </div>
        </div>
    );
}
