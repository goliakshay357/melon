import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModelInfo {
    label: string;
    provider: string;
    id: string;
}

/**
 * Searchable model dropdown scoped to one provider, with recents pinned on top.
 * Calls GET /models?provider=X and GET /settings (recents).
 */
export function ModelPicker({
    value,
    onChange,
    open,
    onOpenChange,
}: {
    value: string;
    onChange: (model: string) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;
    const [query, setQuery] = useState('');
    const [models, setModels] = useState<ModelInfo[]>([]);
    const [recents, setRecents] = useState<string[]>([]);
    const ref = useRef<HTMLDivElement>(null);

    const provider = value.split('/')[0] ?? '';

    useEffect(() => {
        let alive = true;
        setModels([]);
        fetch(`/models?provider=${encodeURIComponent(provider)}`)
            .then((r) => r.json())
            .then((d) => {
                if (alive) setModels(d.models ?? []);
            })
            .catch(() => {});
        return () => {
            alive = false;
        };
    }, [provider]);

    useEffect(() => {
        if (!open) return;
        fetch('/settings')
            .then((r) => r.json())
            .then((d) => setRecents(d.settings?.recentModels ?? []))
            .catch(() => {});
    }, [open]);

    useEffect(() => {
        const onDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) onOpenChangeRef.current(false);
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

    const select = (model: string) => {
        onChange(model);
        onOpenChange(false);
    };

    const q = query.trim().toLowerCase();
    const filtered = q ? models.filter((m) => m.label.toLowerCase().includes(q)) : models;
    const recentModels = recents.filter((r) => r.startsWith(`${provider}/`));
    const showRecents = !q && recentModels.length > 0;

    return (
        <div ref={ref} className="relative">
            <button
                className="flex max-w-[170px] cursor-pointer items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground"
                title={`Model: ${value}`}
                onMouseDown={(e) => {
                    e.stopPropagation();
                    if (open) onOpenChangeRef.current(false);
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    onOpenChange(!open);
                    setQuery('');
                }}
            >
                <span className="truncate">{value || 'select model'}</span>
                <ChevronDown className="size-3 shrink-0" />
            </button>

            {open && (
                <div
                    className="absolute bottom-full left-0 z-[50] mb-1 w-64 overflow-hidden rounded-lg border border-border bg-card shadow-xl"
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') onOpenChangeRef.current(false);
                        e.stopPropagation();
                    }}
                    onMouseDown={(e) => e.stopPropagation()}
                >
                    <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                        <Search className="size-3 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder={`Search ${provider} models…`}
                            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                        />
                    </div>

                    <div className="nowheel nodrag max-h-56 overflow-y-auto py-1">
                        {showRecents && (
                            <>
                                <p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Recent
                                </p>
                                {recentModels.map((r) => (
                                    <button
                                        key={`rec-${r}`}
                                        className={cn(
                                            'block w-full truncate px-2 py-1 text-left text-[11px] text-card-foreground hover:bg-secondary',
                                            r === value && 'bg-primary/10 text-primary',
                                        )}
                                        onClick={() => select(r)}
                                    >
                                        {r}
                                    </button>
                                ))}
                            </>
                        )}

                        <p className="px-2 pb-0.5 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                            {q ? 'Results' : 'All models'}
                        </p>
                        {filtered.length === 0 && (
                            <p className="px-2 py-1 text-[11px] text-muted-foreground">No matches</p>
                        )}
                        {filtered.slice(0, 200).map((m) => (
                            <button
                                key={m.label}
                                className={cn(
                                    'block w-full truncate px-2 py-1 text-left text-[11px] text-card-foreground hover:bg-secondary',
                                    m.label === value && 'bg-primary/10 text-primary',
                                )}
                                onClick={() => select(m.label)}
                            >
                                {m.label}
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
