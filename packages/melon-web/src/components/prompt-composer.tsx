import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { ModelPicker } from '@/components/model-picker';
import { ProviderPicker } from '@/components/provider-picker';
import { SkillsPicker } from '@/components/skills-picker';
import { ThinkingPicker } from '@/components/thinking-picker';
import { useCanvasStore } from '@/store/canvas-store';
import {
    activeMention,
    fetchFileCandidates,
    mentionExists,
    type MentionSpan,
    splitMentionSpans,
} from '@/lib/mentions';
import { cn } from '@/lib/utils';

export type ComposerPermission = 'full' | 'readonly';

const CARD_TEXT = 'text-xs leading-relaxed';
const HERO_TEXT = 'text-sm leading-relaxed';

/** Backdrop span colors: file exists = sky, missing = red, unknown = dotted. */
function MentionBackdropSpans({ spans, cwd }: { spans: MentionSpan[]; cwd: string | null }) {
    return (
        <>
            {spans.map((s, i) =>
                s.mention ? (
                    <span
                        key={i}
                        className={cn(
                            'rounded-sm',
                            mentionExists(cwd, s.mention) === true
                                ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400'
                                : mentionExists(cwd, s.mention) === false
                                  ? 'bg-red-500/10 text-red-500'
                                  : 'text-muted-foreground underline decoration-dotted underline-offset-2',
                        )}
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
}) {
    const hero = size === 'hero';
    const maxHeight = hero ? 220 : 120;
    const [openPicker, setOpenPicker] = useState<'model' | 'provider' | 'skills' | 'thinking' | null>(null);

    // ── slash commands ──
    const COMMANDS = [
        {
            name: 'handoff',
            hint: 'distill this conversation into a note — your message names it and steers the focus',
        },
        {
            name: 'diagram',
            hint: 'render a diagram of this conversation or your topic — the right visual type is chosen for you',
        },
    ] as const;

    // ── @-mentions ──
    const cwd = useCanvasStore((s) => s.worktreePath ?? s.folder);
    const folder = useCanvasStore((s) => s.folder);
    const taRef = useRef<HTMLTextAreaElement | null>(null);
    const backdropRef = useRef<HTMLDivElement | null>(null);
    const [caret, setCaret] = useState(0);
    const [dismissed, setDismissed] = useState(false);
    const [cmdDismissed, setCmdDismissed] = useState(false);
    const [cmdHighlight, setCmdHighlight] = useState(0);
    const [items, setItems] = useState<Array<{ path: string; title?: string }>>([]);
    const [highlight, setHighlight] = useState(0);

    const mention = activeMention(value, caret);
    const mentionOpen = mention !== null && !dismissed;
    // Command dropdown: while the FIRST token is still being typed ("/", "/ha…").
    const cmdMatch = value.trim().match(/^\/([a-z-]*)$/i);
    const cmdOpen = cmdMatch !== null && !cmdDismissed;
    const cmdItems = cmdMatch
        ? COMMANDS.filter((c) => c.name.startsWith(cmdMatch[1].toLowerCase()))
        : [];

    useEffect(() => {
        console.log(
            `[melon-@] dropdown: open=${mention !== null && !dismissed} query="${mention?.query ?? ""}" cwd=${cwd} folder=${folder} caret=${caret}`,
        );
    }, [mention?.query, mention, dismissed, caret, cwd, folder]);

    useEffect(() => {
        if (!mention) {
            setItems([]);
            return;
        }
        let alive = true;
        const t = setTimeout(async () => {
            const files = await fetchFileCandidates(cwd, mention.query, folder !== cwd ? folder : null);
            if (alive) {
                setItems(files);
                setHighlight(0);
            }
        }, 120);
        return () => {
            alive = false;
            clearTimeout(t);
        };
    }, [mention?.query, cwd, folder]);

    const syncCaret = (el: HTMLTextAreaElement | null) => {
        if (el) setCaret(el.selectionStart ?? 0);
    };

    const pickCandidate = useCallback(
        (path: string) => {
            if (!mention) return;
            const insert = `@${path} `;
            const next = value.slice(0, mention.start) + insert + value.slice(mention.end);
            onChange(next);
            setDismissed(true);
            requestAnimationFrame(() => {
                const el = taRef.current;
                if (!el) return;
                const pos = mention.start + insert.length;
                el.focus();
                el.setSelectionRange(pos, pos);
                setCaret(pos);
                el.style.height = 'auto';
                el.style.height = `${Math.min(Math.max(el.scrollHeight, hero ? 112 : 0), maxHeight)}px`;
            });
        },
        [mention, value, onChange, hero, maxHeight],
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
    const canSubmit = !disabled && !submitDisabled && value.trim().length > 0;
    const spans = splitMentionSpans(value);

    return (
        <div
            className={cn(
                'rounded-xl border border-input bg-background shadow-sm focus-within:border-ring',
                hero && 'relative border-transparent shadow-none focus-within:border-transparent',
                className,
            )}
        >
            <div className="relative">
                {/* Highlight backdrop — same metrics as the textarea; the textarea
                    text is transparent and only the caret stays visible. */}
                <div
                    ref={backdropRef}
                    aria-hidden
                    className={cn(
                        'pointer-events-none absolute inset-0 overflow-hidden break-words whitespace-pre-wrap',
                        hero ? `px-4 pt-4 pb-2 ${HERO_TEXT}` : `px-3 pt-2.5 pb-1 ${CARD_TEXT}`,
                    )}
                >
                    <MentionBackdropSpans spans={spans} cwd={cwd} />
                </div>
                <textarea
                    autoFocus={autoFocus}
                    rows={hero ? 4 : 1}
                    value={value}
                    ref={(el) => {
                        taRef.current = el;
                        growTextarea(el);
                    }}
                    disabled={disabled}
                    onChange={(e) => {
                        onChange(e.target.value);
                        growTextarea(e.target);
                        setCaret(e.target.selectionStart ?? 0);
                        setDismissed(false);
                        setCmdDismissed(false);
                    }}
                    onSelect={(e) => syncCaret(e.currentTarget)}
                    onClick={(e) => {
                        syncCaret(e.currentTarget);
                        e.stopPropagation();
                    }}
                    onKeyUp={(e) => syncCaret(e.currentTarget)}
                    onScroll={(e) => {
                        if (backdropRef.current) backdropRef.current.scrollTop = e.currentTarget.scrollTop;
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
                            if (e.key === 'Tab') {
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
                            // Enter falls through to normal submit — the command runs.
                        }
                        // Mention autocomplete owns navigation keys while open.
                        if (mentionOpen && items.length > 0) {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                setHighlight((h) => (h + 1) % items.length);
                                return;
                            }
                            if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                setHighlight((h) => (h - 1 + items.length) % items.length);
                                return;
                            }
                            if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                pickCandidate(items[highlight]?.path ?? '');
                                return;
                            }
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                setDismissed(true);
                                return;
                            }
                        } else if (e.key === 'Escape' && dismissed) {
                            setDismissed(false);
                        }
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            if (canSubmit) onSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    className={cn(
                        'nodrag nowheel relative block w-full resize-none bg-transparent caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60',
                        hero ? `min-h-[112px] max-h-[220px] px-4 pt-4 pb-2 ${HERO_TEXT}` : `max-h-[120px] px-3 pt-2.5 pb-1 ${CARD_TEXT}`,
                    )}
                    style={{ color: 'transparent' }}
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
                                    {mention && mention.query.length > 0 ? 'No matching files' : 'Start typing to search files…'}
                                </p>
                            )}
                            {items.map((item, i) => (
                                <button
                                    key={item.path}
                                    className={cn(
                                        'block w-full px-3 py-1.5 text-left transition-colors',
                                        i === highlight ? 'bg-secondary' : 'hover:bg-secondary/60',
                                    )}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        pickCandidate(item.path);
                                    }}
                                    title={cwd ? `${cwd}/${item.path}` : item.path}
                                >
                                    {item.title ? (
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
                                ↑↓ navigate · Enter/Tab select · Esc dismiss
                            </p>
                        </div>
                    </div>
                )}
            </div>
            <div
                className={cn(
                    'flex items-center gap-1',
                    hero ? 'px-3 pb-3 pt-1' : 'px-2 pb-1.5 pt-1',
                )}
            >
                <SkillsPicker
                    value={skills}
                    onChange={onSkillsChange}
                    open={openPicker === 'skills'}
                    onOpenChange={(open) => setOpenPicker(open ? 'skills' : null)}
                />
                <ProviderPicker
                    model={model}
                    onChange={onModelChange}
                    open={openPicker === 'provider'}
                    onOpenChange={(open) => setOpenPicker(open ? 'provider' : null)}
                    cardId={cardId}
                />
                <ModelPicker
                    value={model}
                    onChange={onModelChange}
                    open={openPicker === 'model'}
                    onOpenChange={(open) => setOpenPicker(open ? 'model' : null)}
                    cardId={cardId}
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
                    className="cursor-pointer rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none hover:text-foreground"
                    title="Workspace permissions"
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
