import { useEffect, useRef, useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { Check, ChevronDown, KeyRound, Settings2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderInfo {
    id: string;
    provider: string;
    configured: boolean;
    source?: string;
    keyPreview?: string;
    authType?: string;
}

/**
 * Provider dropdown with configure/re-key inline (Radix dialog, no window.prompt).
 * Selecting a provider switches the card model to that provider's first model.
 */
export function ProviderPicker({
    model,
    onChange,
    open,
    onOpenChange,
}: {
    model: string;
    onChange: (model: string) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const [providers, setProviders] = useState<ProviderInfo[]>([]);
    const [configuring, setConfiguring] = useState<ProviderInfo | null>(null);
    const [key, setKey] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');
    const ref = useRef<HTMLDivElement>(null);

    const current = model.split('/')[0] ?? '';

    const load = () =>
        fetch('/auth/providers')
            .then((r) => r.json())
            .then(setProviders)
            .catch(() => {});

    useEffect(() => {
        load();
    }, []);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            const t = e.target as Element;
            if (ref.current && !ref.current.contains(t) && !t.closest?.('[data-melon-picker-root]'))
                onOpenChangeRef.current(false);
        };
        const onEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onOpenChangeRef.current(false);
        };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    const selectProvider = async (p: ProviderInfo) => {
        onOpenChange(false);
        const res = await fetch(`/models?provider=${encodeURIComponent(p.id)}`).then((r) =>
            r.json(),
        );
        const first = res.models?.[0];
        onChange(first ? first.label : `${p.id}/`);
    };

    const saveKey = async () => {
        if (!configuring || !key.trim()) return;
        setSaving(true);
        setError('');
        try {
            const res = await fetch(`/auth/${configuring.id}/key`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ key: key.trim() }),
            });
            if (!res.ok) {
                const d = await res.json().catch(() => ({}));
                setError(d.error ?? 'Failed to save key');
            } else {
                setConfiguring(null);
                setKey('');
                load();
            }
        } catch {
            setError('Network error saving key');
        } finally {
            setSaving(false);
        }
    };

    const removeKey = async (p: ProviderInfo) => {
        await fetch(`/auth/${p.id}`, { method: 'DELETE' }).catch(() => {});
        load();
    };

    return (
        <div ref={ref} data-melon-picker-root className="relative">
            <button
                className="flex max-w-[140px] cursor-pointer items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
                title={`Provider: ${current || 'none'}`}
                onClick={(e) => {
                    e.stopPropagation();
                    onOpenChange(!open);
                }}
            >
                <Settings2 className="size-3 shrink-0" />
                <span className="truncate">{current || 'provider'}</span>
                <ChevronDown className="size-3 shrink-0" />
            </button>

            {open && (
                <div
                    className="nowheel nodrag absolute bottom-full left-0 z-[50] mb-1 max-h-64 w-72 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-xl"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') onOpenChangeRef.current(false);
                        e.stopPropagation();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Provider
                    </p>
                    {providers.map((p) => (
                        <div
                            key={p.id}
                            className="flex items-center gap-1 px-1.5 py-0.5 hover:bg-secondary"
                        >
                            <button
                                className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                onClick={() => selectProvider(p)}
                            >
                                <span
                                    className={cn(
                                        'size-1.5 shrink-0 rounded-full',
                                        p.configured ? 'bg-emerald-400' : 'bg-muted-foreground/40',
                                    )}
                                />
                                <span
                                    className={cn(
                                        'truncate text-[11px]',
                                        p.configured
                                            ? 'text-card-foreground'
                                            : 'text-muted-foreground',
                                    )}
                                >
                                    {p.id}
                                </span>
                                {p.id === current && (
                                    <Check className="size-3 shrink-0 text-primary" />
                                )}
                            </button>
                            {p.keyPreview && (
                                <span className="shrink-0 text-[9px] text-muted-foreground">
                                    {p.keyPreview}
                                </span>
                            )}
                            <button
                                className="shrink-0 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground"
                                title={p.configured ? 'Re-key' : 'Configure key'}
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setConfiguring(p);
                                    setKey('');
                                    setError('');
                                    onOpenChange(false);
                                }}
                            >
                                <KeyRound className="size-3" />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            <RadixDialog.Root
                open={configuring !== null}
                onOpenChange={(o) => {
                    if (!o) setConfiguring(null);
                }}
            >
                <RadixDialog.Portal>
                    <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
                    <RadixDialog.Content
                        className="fixed left-1/2 top-1/2 z-[1001] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
                        onKeyDown={(e) => e.stopPropagation()}
                    >
                        <RadixDialog.Title className="text-sm font-semibold text-card-foreground">
                            {configuring?.configured ? 'Re-key' : 'Configure'}{' '}
                            {configuring?.id}
                        </RadixDialog.Title>
                        <RadixDialog.Description className="sr-only">
                            Enter an API key for this provider.
                        </RadixDialog.Description>

                        <input
                            autoFocus
                            type="password"
                            value={key}
                            onChange={(e) => setKey(e.target.value)}
                            placeholder="API key"
                            className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') saveKey();
                            }}
                        />
                        {error && (
                            <p className="mt-2 text-[11px] text-red-400">{error}</p>
                        )}
                        {configuring?.configured && (
                            <button
                                className="mt-2 text-[11px] text-red-400 hover:underline"
                                onClick={async () => {
                                    await removeKey(configuring);
                                    setConfiguring(null);
                                }}
                            >
                                Remove key
                            </button>
                        )}

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                                onClick={() => setConfiguring(null)}
                            >
                                Cancel
                            </button>
                            <button
                                disabled={saving || !key.trim()}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                                onClick={saveKey}
                            >
                                {saving ? 'Saving…' : 'Save key'}
                            </button>
                        </div>
                    </RadixDialog.Content>
                </RadixDialog.Portal>
            </RadixDialog.Root>
        </div>
    );
}
