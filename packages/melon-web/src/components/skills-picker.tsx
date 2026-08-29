import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search, Wand2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SkillInfo {
    id: string;
    name: string;
    description?: string;
}

/**
 * Per-card skills toggle. Lists available skills (GET /skills) with search,
 * each a checkbox; active skills are injected into the card's prompts.
 */
export function SkillsPicker({
    value,
    onChange,
    open,
    onOpenChange,
}: {
    value: string[];
    onChange: (skills: string[]) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [skills, setSkills] = useState<SkillInfo[]>([]);
    const [query, setQuery] = useState('');
    const [failed, setFailed] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const onOpenChangeRef = useRef(onOpenChange);
    onOpenChangeRef.current = onOpenChange;

    useEffect(() => {
        if (!open) return;
        setQuery('');
        fetch('/skills')
            .then((r) => r.json())
            .then((d) => {
                setSkills(d.skills ?? []);
                setFailed(false);
                console.log('[skills-debug] fetch ok:', (d.skills ?? []).length, (d.skills ?? []).map((x: any) => x.id));
            })
            .catch((e) => {
                setFailed(true);
                console.log('[skills-debug] fetch FAILED:', e);
            });
    }, [open]);

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

    const toggle = (id: string) => {
        const next = value.includes(id) ? value.filter((s) => s !== id) : [...value, id];
        onChange(next);
    };

    const q = query.trim().toLowerCase();
    const filtered = q
        ? skills.filter(
              (sk) =>
                  sk.name.toLowerCase().includes(q) ||
                  (sk.description ?? '').toLowerCase().includes(q),
          )
        : skills;

    return (
        <div ref={ref} data-melon-picker-root className="relative">
            <button
                className={cn(
                    'nodrag flex max-w-[140px] cursor-pointer items-center gap-1 truncate rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground outline-none transition-colors hover:text-foreground',
                    value.length > 0 && 'bg-accent/15 text-accent ring-1 ring-inset ring-accent/40',
                )}
                title="Toggle skills for this card"
                onClick={(e) => {
                    e.stopPropagation();
                    onOpenChange(!open);
                }}
            >
                <Wand2 className="size-3 shrink-0" />
                <span className="truncate">skills{value.length > 0 ? ` (${value.length})` : ''}</span>
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
                    <div className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
                        <Search className="size-3 text-muted-foreground" />
                        <input
                            autoFocus
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            placeholder="Search skills…"
                            className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                        />
                    </div>
                    <p className="px-2 pb-1 pt-1 text-[9px] font-medium uppercase tracking-wide text-muted-foreground">
                        Skills (default off)
                    </p>
                    {failed && (
                        <p className="px-2 py-1 text-[11px] text-red-400">couldn't load skills — server down?</p>
                    )}
                    {!failed && skills.length === 0 && (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground">no skills found</p>
                    )}
                    {filtered.length === 0 && skills.length > 0 && (
                        <p className="px-2 py-1 text-[11px] text-muted-foreground">no matches</p>
                    )}
                    {filtered.map((sk) => {
                        const active = value.includes(sk.id);
                        return (
                            <label
                                key={sk.id}
                                className={cn(
                                    'flex cursor-pointer items-start gap-2 px-2 py-1 transition-colors hover:bg-secondary',
                                    active && 'bg-primary/10',
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={active}
                                    onChange={() => toggle(sk.id)}
                                    className="mt-0.5 size-3 cursor-pointer accent-[#bd93f9]"
                                />
                                <span className="min-w-0">
                                    <span className="block truncate text-[11px] text-card-foreground">
                                        {sk.name}
                                    </span>
                                    {sk.description && (
                                        <span className="block truncate text-[9px] text-muted-foreground">
                                            {sk.description}
                                        </span>
                                    )}
                                </span>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
