import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { PendingExtensionUi } from '@/types/session-card';
import { cn } from '@/lib/utils';

/**
 * Blocking question / confirm / input panel above the card inbox.
 * Driven by Melon SSE `extension_ui` (pi ExtensionUIContext bridge).
 */
export function QuestionPanel({
    pending,
    onRespond,
}: {
    pending: PendingExtensionUi;
    onRespond: (
        body:
            | { id: string; value: string }
            | { id: string; confirmed: boolean }
            | { id: string; cancelled: true },
    ) => void;
}) {
    const [custom, setCustom] = useState('');
    const [sending, setSending] = useState(false);

    useEffect(() => {
        setCustom('');
        setSending(false);
    }, [pending.id]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                if (!sending) onRespond({ id: pending.id, cancelled: true });
            }
        };
        window.addEventListener('keydown', onKey, true);
        return () => window.removeEventListener('keydown', onKey, true);
    }, [pending.id, sending, onRespond]);

    const respond = (
        body:
            | { id: string; value: string }
            | { id: string; confirmed: boolean }
            | { id: string; cancelled: true },
    ) => {
        if (sending) return;
        setSending(true);
        onRespond(body);
    };

    return (
        <div
            className="nodrag mb-1.5 rounded-lg border border-border bg-secondary/30 px-3 py-2.5 text-[12px] text-card-foreground"
            onMouseDown={(e) => e.stopPropagation()}
        >
            <div className="mb-2 flex items-start gap-1.5">
                <div className="min-w-0 flex-1">
                    <div className="font-medium leading-snug text-card-foreground">{pending.title}</div>
                    {pending.method === 'confirm' && pending.message ? (
                        <div className="mt-0.5 text-muted-foreground">{pending.message}</div>
                    ) : null}
                </div>
                <button
                    type="button"
                    className="shrink-0 rounded-md p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                    title="Cancel (Esc)"
                    disabled={sending}
                    onClick={() => respond({ id: pending.id, cancelled: true })}
                >
                    <X className="size-3.5" />
                </button>
            </div>

            {pending.method === 'select' && (
                <div className="flex flex-col gap-1">
                    {(pending.options ?? []).map((opt) => (
                        <button
                            key={opt}
                            type="button"
                            disabled={sending}
                            className={cn(
                                'rounded-lg border border-border px-2.5 py-1.5 text-left leading-snug',
                                'hover:bg-secondary disabled:opacity-50',
                            )}
                            onClick={() => respond({ id: pending.id, value: opt })}
                        >
                            {opt}
                        </button>
                    ))}
                </div>
            )}

            {pending.method === 'confirm' && (
                <div className="flex gap-1.5">
                    <button
                        type="button"
                        disabled={sending}
                        className="rounded-lg bg-secondary px-2.5 py-1 text-card-foreground hover:bg-secondary/80 disabled:opacity-50"
                        onClick={() => respond({ id: pending.id, confirmed: true })}
                    >
                        Yes
                    </button>
                    <button
                        type="button"
                        disabled={sending}
                        className="rounded-lg bg-secondary px-2.5 py-1 text-card-foreground hover:bg-secondary/80 disabled:opacity-50"
                        onClick={() => respond({ id: pending.id, confirmed: false })}
                    >
                        No
                    </button>
                    <button
                        type="button"
                        disabled={sending}
                        className="ml-auto rounded-lg px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                        onClick={() => respond({ id: pending.id, cancelled: true })}
                    >
                        Cancel
                    </button>
                </div>
            )}

            {pending.method === 'input' && (
                <form
                    className="flex flex-col gap-1.5"
                    onSubmit={(e) => {
                        e.preventDefault();
                        const trimmed = custom.trim();
                        if (!trimmed) {
                            respond({ id: pending.id, cancelled: true });
                            return;
                        }
                        respond({ id: pending.id, value: trimmed });
                    }}
                >
                    <input
                        autoFocus
                        className="nodrag w-full rounded-lg border border-input bg-background px-2.5 py-1.5 text-[12px] outline-none focus:border-ring"
                        placeholder={pending.placeholder ?? 'Type your answer'}
                        value={custom}
                        disabled={sending}
                        onChange={(e) => setCustom(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') {
                                e.preventDefault();
                                e.stopPropagation();
                                respond({ id: pending.id, cancelled: true });
                            }
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                e.stopPropagation();
                                const trimmed = custom.trim();
                                if (!trimmed) {
                                    respond({ id: pending.id, cancelled: true });
                                    return;
                                }
                                respond({ id: pending.id, value: trimmed });
                            }
                        }}
                    />
                    <div className="flex gap-1.5">
                        <button
                            type="submit"
                            disabled={sending || !custom.trim()}
                            className="rounded-lg bg-secondary px-2.5 py-1 text-card-foreground hover:bg-secondary/80 disabled:opacity-50"
                        >
                            Submit
                        </button>
                        <button
                            type="button"
                            disabled={sending}
                            className="rounded-lg px-2 py-1 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
                            onClick={() => respond({ id: pending.id, cancelled: true })}
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}
        </div>
    );
}
