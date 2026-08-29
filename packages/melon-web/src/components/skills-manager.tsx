import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Search, Copy, ArrowLeft } from 'lucide-react';
import { confirmAction } from '@/components/dialogs';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

interface SkillRow {
    id: string;
    name: string;
    description?: string;
}

export interface SkillPrefill {
    name: string;
    description?: string;
    instructions: string;
}

/** id-safe slug from a display name: "My Cool Skill" → "my-cool-skill". */
const slugify = (s: string) =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);

/* ────────────────────────────────────────────────────────────
   Browse view — searchable list of all skills
   ──────────────────────────────────────────────────────────── */
export function SkillsManager({
    onEdit,
    onCreate,
    onDuplicate,
    refreshKey,
}: {
    onEdit: (id: string) => void;
    onCreate: () => void;
    onDuplicate: (sk: SkillRow) => void;
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
        const res = await fetch(`/skills/${sk.id}`, { method: 'DELETE' }).catch(() => null);
        if (res?.ok) {
            // Prune the deleted skill from every card's toggle state so no
            // stale id lingers in the canvas.
            useCanvasStore.setState((st) => ({
                cards: st.cards.map((c) =>
                    c.skills?.includes(sk.id)
                        ? { ...c, skills: c.skills.filter((s) => s !== sk.id) }
                        : c,
                ),
            }));
        }
        load();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Toolbar: search + add */}
            <div className="flex shrink-0 items-center gap-2">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search skills…"
                        className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-ring"
                    />
                </div>
                <button
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={onCreate}
                    title="Add skill"
                >
                    <Plus className="size-3.5" /> Add
                </button>
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
                            title="Duplicate"
                            onClick={() => onDuplicate(sk)}
                        >
                            <Copy className="size-3.5" />
                        </button>
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

        </div>
    );
}

/* ────────────────────────────────────────────────────────────
   Editor view — skillId=null → create (optionally from a
   duplicated skill via `initial`).
   ──────────────────────────────────────────────────────────── */
export function SkillEditor({
    skillId,
    initial,
    onBack,
    onDirtyChange,
}: {
    skillId: string | null;
    initial?: SkillPrefill;
    onBack: () => void;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const isNew = skillId === null;
    const [id, setId] = useState(initial ? slugify(initial.name) : '');
    const [name, setName] = useState(initial?.name ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [instructions, setInstructions] = useState(initial?.instructions ?? '');
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!isNew);
    const [error, setError] = useState('');

    const idTouched = useRef(false);
    const snapshot = useRef(
        JSON.stringify({
            id: initial ? slugify(initial.name) : '',
            name: initial?.name ?? '',
            description: initial?.description ?? '',
            instructions: initial?.instructions ?? '',
        }),
    );

    useEffect(() => {
        if (isNew) return;
        fetch(`/skills/${skillId}`)
            .then((r) => r.json())
            .then((d) => {
                setName(d.name ?? skillId);
                setDescription(d.description ?? '');
                setInstructions(d.instructions ?? '');
                snapshot.current = JSON.stringify({
                    id: '',
                    name: d.name ?? skillId,
                    description: d.description ?? '',
                    instructions: d.instructions ?? '',
                });
                setLoading(false);
            })
            .catch(() => {
                setError('Failed to load skill');
                setLoading(false);
            });
    }, [skillId, isNew]);

    const dirty =
        !loading &&
        JSON.stringify({ id, name, description, instructions }) !== snapshot.current;
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty]);

    const setNameAndSlug = (v: string) => {
        setName(v);
        if (!idTouched.current && isNew) setId(slugify(v));
    };

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

    const back = async () => {
        if (dirty) {
            const ok = await confirmAction({
                title: 'Discard changes?',
                description: 'Your edits to this skill will not be saved.',
            });
            if (!ok) return;
        }
        onBack();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2">
                <button
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={back}
                >
                    <ArrowLeft className="size-3.5" /> Back
                </button>
                <p className="truncate text-xs font-medium text-card-foreground">
                    {isNew ? (initial ? 'Duplicate skill' : 'New skill') : 'Edit skill'}
                    {dirty && <span className="ml-1.5 text-[10px] text-muted-foreground">• unsaved</span>}
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
                                maxLength={64}
                                onChange={(e) => {
                                    idTouched.current = true;
                                    setId(e.target.value);
                                }}
                                placeholder="id (e.g. my-skill)"
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-ring"
                            />
                        )}
                        <input
                            value={name}
                            onChange={(e) => setNameAndSlug(e.target.value)}
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
                    {isNew && !idTouched.current && id && (
                        <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">
                            id auto-generated from the name — edit it if you want a different one
                        </p>
                    )}
                    <textarea
                        value={instructions}
                        onChange={(e) => setInstructions(e.target.value)}
                        placeholder={
                            'Instructions (markdown)…\n\nThis is what the AI reads when it decides to use the skill.'
                        }
                        spellCheck={false}
                        className="mt-2 min-h-0 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-ring"
                    />
                    {error && <p className="mt-1.5 shrink-0 text-[11px] text-red-400">{error}</p>}
                </>
            )}
        </div>
    );
}
