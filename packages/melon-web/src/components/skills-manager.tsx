import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Search, ArrowLeft } from 'lucide-react';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';

interface SkillRow {
    id: string;
    name: string;
    description?: string;
}

/* ────────────────────────────────────────────────────────────
   Browse view — searchable list of all skills
   ──────────────────────────────────────────────────────────── */
export function SkillsManager({
    onEdit,
    onCreate,
    refreshKey,
}: {
    onEdit: (id: string) => void;
    onCreate: () => void;
    refreshKey: number;
}) {
    const [skills, setSkills] = useState<SkillRow[]>([]);
    const [query, setQuery] = useState('');

    const load = () =>
        fetch('/skills')
            .then((r) => r.json())
            .then((d) => setSkills(d.skills ?? []))
            .catch(() => {});

    useEffect(() => {
        load();
    }, [refreshKey]);

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return skills;
        return skills.filter(
            (s) =>
                s.id.toLowerCase().includes(q) ||
                s.name.toLowerCase().includes(q) ||
                (s.description ?? '').toLowerCase().includes(q),
        );
    }, [skills, query]);

    const remove = async (sk: SkillRow) => {
        const ok = await confirmAction({
            title: `Delete skill "${sk.name}"?`,
            description: 'This removes the .md file permanently.',
        });
        if (!ok) return;
        await fetch(`/skills/${sk.id}`, { method: 'DELETE' }).catch(() => {});
        load();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Search */}
            <div className="relative shrink-0">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search skills…"
                    className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-ring"
                />
            </div>

            {/* List */}
            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {filtered.length === 0 && (
                    <p className="px-1 py-4 text-[11px] text-muted-foreground">
                        {skills.length === 0 ? 'no skills yet' : 'no matches'}
                    </p>
                )}
                {filtered.map((sk) => (
                    <div
                        key={sk.id}
                        className="group flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
                    >
                        <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-card-foreground">
                                {sk.name}
                            </span>
                            {sk.description && (
                                <span
                                    className="block truncate text-[10px] text-muted-foreground"
                                    title={sk.description}
                                >
                                    {sk.description}
                                </span>
                            )}
                        </div>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title="Edit"
                            onClick={() => onEdit(sk.id)}
                        >
                            <Pencil className="size-3.5" />
                        </button>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-red-500 group-hover:opacity-100"
                            title="Delete"
                            onClick={() => remove(sk)}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </div>
                ))}
            </div>

            {/* Add */}
            <button
                className="mt-2 flex shrink-0 items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2 text-[11px] text-muted-foreground hover:border-ring hover:text-foreground"
                onClick={onCreate}
            >
                <Plus className="size-3.5" /> Add skill
            </button>
        </div>
    );
}

/* ────────────────────────────────────────────────────────────
   Editor view — takes over the dialog. skillId=null → create.
   ──────────────────────────────────────────────────────────── */
export function SkillEditor({
    skillId,
    onBack,
}: {
    skillId: string | null;
    onBack: () => void;
}) {
    const isNew = skillId === null;
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!isNew);
    const [error, setError] = useState('');
    const taRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isNew) return;
        fetch(`/skills/${skillId}`)
            .then((r) => r.json())
            .then((d) => {
                setName(d.name ?? skillId);
                setDescription(d.description ?? '');
                setInstructions(d.instructions ?? '');
                setLoading(false);
            })
            .catch(() => {
                setError('Failed to load skill');
                setLoading(false);
            });
    }, [skillId, isNew]);

    const save = async () => {
        if (!name.trim() || !instructions.trim()) {
            setError('Name and instructions are required.');
            return;
        }
        if (isNew && !/^[a-z0-9-]+$/.test(id.trim())) {
            setError('Id must be lowercase letters, numbers and dashes.');
            return;
        }
        setSaving(true);
        setError('');
        const res = await fetch(isNew ? '/skills' : `/skills/${skillId}`, {
            method: isNew ? 'POST' : 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
                isNew
                    ? { id: id.trim(), name: name.trim(), description, instructions }
                    : { name: name.trim(), description, instructions },
            ),
        });
        setSaving(false);
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setError(d.error ?? 'Save failed');
            return;
        }
        onBack();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2">
                <button
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={onBack}
                >
                    <ArrowLeft className="size-3.5" /> Back
                </button>
                <p className="truncate text-xs font-medium text-card-foreground">
                    {isNew ? 'New skill' : `Edit skill`}
                </p>
                <button
                    disabled={saving || loading}
                    className="ml-auto shrink-0 rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                    onClick={save}
                >
                    {saving ? 'Saving…' : 'Save'}
                </button>
            </div>

            {loading ? (
                <p className="mt-4 text-[11px] text-muted-foreground">loading…</p>
            ) : (
                <>
                    <div className="mt-3 grid shrink-0 grid-cols-2 gap-2">
                        {isNew && (
                            <input
                                value={id}
                                onChange={(e) => setId(e.target.value)}
                                placeholder="id (e.g. my-skill)"
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                            />
                        )}
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Name"
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                        />
                        <input
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="Description (shown in the skills picker)"
                            className={cn(
                                'w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring',
                                isNew && 'col-span-2',
                            )}
                        />
                    </div>
                    <textarea
                        ref={taRef}
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder={'Instructions (markdown)…\n\nThis is what the AI reads when it decides to use the skill.'}
                        spellCheck={false}
                        className="mt-2 min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-ring"
                    />
                    {error && <p className="mt-1.5 shrink-0 text-[11px] text-red-400">{error}</p>}
                </>
            )}
        </div>
    );
}
