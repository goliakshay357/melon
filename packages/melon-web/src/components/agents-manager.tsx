import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Search, Copy, ArrowLeft, SquareArrowOutUpRight } from 'lucide-react';
import { confirmAction } from '@/components/dialogs';
import { detachAgentProfileFromCards, useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';
import { fuzzyScore } from '@/lib/fuzzy';

interface AgentRow {
    id: string;
    name: string;
    role: string;
    defaultSkillIds?: string[];
}

interface SkillOption {
    id: string;
    name: string;
}

export interface AgentPrefill {
    name: string;
    role?: string;
    descriptionMd: string;
    defaultSkillIds?: string[];
}

const slugify = (s: string) =>
    s
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 64);

export function AgentsManager({
    onEdit,
    onCreate,
    onDuplicate,
    refreshKey,
}: {
    onEdit: (id: string) => void;
    onCreate: () => void;
    onDuplicate: (row: AgentRow) => void;
    refreshKey: number;
}) {
    const [agents, setAgents] = useState<AgentRow[]>([]);
    const [query, setQuery] = useState('');
    const [autoSend, setAutoSend] = useState(false);
    const [autoSendSaving, setAutoSendSaving] = useState(false);

    const load = () =>
        fetch('/agents')
            .then((r) => r.json())
            .then((d) => setAgents(d.agents ?? []))
            .catch(() => {});

    const loadSettings = () =>
        fetch('/settings')
            .then((r) => r.json())
            .then((d) => setAutoSend(d.settings?.boxMailAutoSend === true))
            .catch(() => {});

    useEffect(() => {
        load();
        loadSettings();
    }, [refreshKey]);

    const filtered = useMemo(() => {
        const q = query.trim();
        if (!q) return agents;
        return agents
            .flatMap((a) => {
                const score = fuzzyScore(q, `${a.id} ${a.name} ${a.role}`);
                return score === null ? [] : [{ a, score }];
            })
            .sort((x, y) => x.score - y.score)
            .map(({ a }) => a);
    }, [agents, query]);

    const remove = async (row: AgentRow) => {
        const using = useCanvasStore
            .getState()
            .cards.filter((c) => (c.kind ?? 'chat') === 'chat' && c.agentProfileId === row.id);
        const ok = await confirmAction({
            title: `Delete agent "${row.name}"?`,
            description:
                using.length > 0
                    ? `${using.length} open box${using.length === 1 ? '' : 'es'} use this profile. Transcripts stay; those boxes become general (no standing instructions).`
                    : 'Removes the profile from Settings. Open boxes keep their transcripts; they become general.',
        });
        if (!ok) return;
        const res = await fetch(`/agents/${row.id}`, { method: 'DELETE' }).catch(() => null);
        if (res?.ok) detachAgentProfileFromCards(row.id);
        load();
    };

    const toggleAutoSend = async () => {
        const next = !autoSend;
        setAutoSendSaving(true);
        const res = await fetch('/settings', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ boxMailAutoSend: next }),
        }).catch(() => null);
        setAutoSendSaving(false);
        if (res?.ok) setAutoSend(next);
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="mb-3 shrink-0 rounded-lg border border-border px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-medium text-card-foreground">Box mail auto-approve</p>
                        <p className="text-[10px] text-muted-foreground">
                            Off: mail waits in the inbox until you Approve. On: skip Approve and deliver to the agent (after its queue).
                        </p>
                    </div>
                    <button
                        type="button"
                        role="switch"
                        aria-checked={autoSend}
                        disabled={autoSendSaving}
                        onClick={toggleAutoSend}
                        className={cn(
                            'relative h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50',
                            autoSend ? 'bg-primary' : 'bg-muted',
                        )}
                    >
                        <span
                            className={cn(
                                'absolute top-0.5 size-4 rounded-full bg-background transition-transform',
                                autoSend ? 'left-4' : 'left-0.5',
                            )}
                        />
                    </button>
                </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
                <div className="relative flex-1">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search agents…"
                        className="w-full rounded-md border border-input bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-ring"
                    />
                </div>
                <button
                    className="flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={onCreate}
                    title="Add agent"
                >
                    <Plus className="size-3.5" /> Add
                </button>
            </div>

            <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto pr-1">
                {filtered.length === 0 && (
                    <p className="px-1 py-4 text-[11px] text-muted-foreground">
                        {agents.length === 0
                            ? 'No specialized agents yet — add one to reuse on any canvas.'
                            : 'no matches'}
                    </p>
                )}
                {filtered.map((row) => (
                    <div
                        key={row.id}
                        className="group flex items-center gap-2 rounded-lg border border-border px-2.5 py-2"
                    >
                        <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-card-foreground">
                                {row.name}
                            </span>
                            <span className="block truncate text-[10px] text-muted-foreground" title={row.role}>
                                {row.role || row.id}
                            </span>
                        </div>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title="Open on canvas"
                            onClick={() => {
                                void useCanvasStore.getState().spawnAgentProfile(row.id);
                            }}
                        >
                            <SquareArrowOutUpRight className="size-3.5" />
                        </button>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title="Duplicate"
                            onClick={() => onDuplicate(row)}
                        >
                            <Copy className="size-3.5" />
                        </button>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title="Edit"
                            onClick={() => onEdit(row.id)}
                        >
                            <Pencil className="size-3.5" />
                        </button>
                        <button
                            className="shrink-0 rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-red-500 group-hover:opacity-100"
                            title="Delete"
                            onClick={() => remove(row)}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
}

export function AgentEditor({
    agentId,
    initial,
    onBack,
    onDirtyChange,
}: {
    agentId: string | null;
    initial?: AgentPrefill;
    onBack: () => void;
    onDirtyChange?: (dirty: boolean) => void;
}) {
    const isNew = agentId === null;
    const [id, setId] = useState(initial ? slugify(initial.name) : '');
    const [name, setName] = useState(initial?.name ?? '');
    const [role, setRole] = useState(initial?.role ?? '');
    const [descriptionMd, setDescriptionMd] = useState(initial?.descriptionMd ?? '');
    const [defaultSkillIds, setDefaultSkillIds] = useState<string[]>(initial?.defaultSkillIds ?? []);
    const [skillOptions, setSkillOptions] = useState<SkillOption[]>([]);
    const [saving, setSaving] = useState(false);
    const [loading, setLoading] = useState(!isNew);
    const [error, setError] = useState('');

    const idTouched = useRef(false);
    const snapshot = useRef(
        JSON.stringify({
            id: initial ? slugify(initial.name) : '',
            name: initial?.name ?? '',
            role: initial?.role ?? '',
            descriptionMd: initial?.descriptionMd ?? '',
            defaultSkillIds: initial?.defaultSkillIds ?? [],
        }),
    );

    useEffect(() => {
        fetch('/skills')
            .then((r) => r.json())
            .then((d) =>
                setSkillOptions(
                    (d.skills ?? []).map((s: { id: string; name: string }) => ({
                        id: s.id,
                        name: s.name,
                    })),
                ),
            )
            .catch(() => {});
    }, []);

    useEffect(() => {
        if (isNew) return;
        fetch(`/agents/${agentId}`)
            .then((r) => r.json())
            .then((d) => {
                setName(d.name ?? agentId);
                setRole(d.role ?? '');
                setDescriptionMd(d.descriptionMd ?? '');
                setDefaultSkillIds(Array.isArray(d.defaultSkillIds) ? d.defaultSkillIds : []);
                snapshot.current = JSON.stringify({
                    id: '',
                    name: d.name ?? agentId,
                    role: d.role ?? '',
                    descriptionMd: d.descriptionMd ?? '',
                    defaultSkillIds: Array.isArray(d.defaultSkillIds) ? d.defaultSkillIds : [],
                });
                setLoading(false);
            })
            .catch(() => {
                setError('Failed to load agent');
                setLoading(false);
            });
    }, [agentId, isNew]);

    const dirty =
        !loading &&
        JSON.stringify({ id, name, role, descriptionMd, defaultSkillIds }) !== snapshot.current;
    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const setNameAndSlug = (v: string) => {
        setName(v);
        if (!idTouched.current && isNew) setId(slugify(v));
    };

    const toggleSkill = (skillId: string) => {
        setDefaultSkillIds((prev) =>
            prev.includes(skillId) ? prev.filter((x) => x !== skillId) : [...prev, skillId],
        );
    };

    const save = async () => {
        if (!name.trim()) {
            setError('Name is required.');
            return;
        }
        if (isNew && !/^[a-z0-9-]+$/.test(id.trim())) {
            setError('Id must be lowercase letters, numbers and dashes.');
            return;
        }
        setSaving(true);
        setError('');
        const res = await fetch(isNew ? '/agents' : `/agents/${agentId}`, {
            method: isNew ? 'POST' : 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(
                isNew
                    ? {
                          id: id.trim(),
                          name: name.trim(),
                          role: role.trim(),
                          descriptionMd,
                          defaultSkillIds,
                      }
                    : {
                          name: name.trim(),
                          role: role.trim(),
                          descriptionMd,
                          defaultSkillIds,
                      },
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
                description: 'Your edits to this agent will not be saved.',
            });
            if (!ok) return;
        }
        onBack();
    };

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-2">
                <button
                    className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={back}
                >
                    <ArrowLeft className="size-3.5" /> Back
                </button>
                <p className="truncate text-xs font-medium text-card-foreground">
                    {isNew ? (initial ? 'Duplicate agent' : 'New agent') : 'Edit agent'}
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
                                placeholder="id (e.g. pipeline)"
                                className="w-full rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-ring"
                            />
                        )}
                        <input
                            value={name}
                            onChange={(e) => setNameAndSlug(e.target.value)}
                            placeholder="Name (e.g. Pipeline)"
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                        />
                        <input
                            value={role}
                            onChange={(e) => setRole(e.target.value)}
                            placeholder="Role (short label)"
                            className={cn(
                                'w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring',
                                isNew ? 'col-span-2' : 'col-span-2',
                            )}
                        />
                    </div>
                    {isNew && !idTouched.current && id && (
                        <p className="mt-1 shrink-0 text-[10px] text-muted-foreground">
                            id auto-generated from the name — edit it if you want a different one
                        </p>
                    )}
                    <textarea
                        value={descriptionMd}
                        onChange={(e) => setDescriptionMd(e.target.value)}
                        placeholder={
                            'Standing instructions (description.md)…\n\nInjected every turn when a box uses this profile.'
                        }
                        spellCheck={false}
                        className="mt-2 min-h-[140px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed outline-none focus:border-ring"
                    />
                    {skillOptions.length > 0 && (
                        <div className="mt-2 max-h-28 shrink-0 overflow-y-auto rounded-md border border-border p-2">
                            <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Default skills (optional)
                            </p>
                            <div className="flex flex-wrap gap-1.5">
                                {skillOptions.map((sk) => {
                                    const on = defaultSkillIds.includes(sk.id);
                                    return (
                                        <button
                                            key={sk.id}
                                            type="button"
                                            onClick={() => toggleSkill(sk.id)}
                                            className={cn(
                                                'rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                                                on
                                                    ? 'border-ring bg-primary/10 text-foreground'
                                                    : 'border-border text-muted-foreground hover:bg-secondary',
                                            )}
                                        >
                                            {sk.name}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                    {error && <p className="mt-1.5 shrink-0 text-[11px] text-red-400">{error}</p>}
                </>
            )}
        </div>
    );
}
