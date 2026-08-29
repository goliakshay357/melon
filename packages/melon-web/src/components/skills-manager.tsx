import { useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';

interface SkillRow {
    id: string;
    name: string;
    description?: string;
}

/**
 * Skill manager — list / edit / create / delete skill .md files.
 * Changes reflect in the ✨ skills dropdown (it refetches /skills on open).
 */
export function SkillsManager() {
    const [skills, setSkills] = useState<SkillRow[]>([]);
    const [editing, setEditing] = useState<SkillRow | null>(null);
    const [creating, setCreating] = useState(false);
    const [id, setId] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [instructions, setInstructions] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    const load = () =>
        fetch('/skills')
            .then((r) => r.json())
            .then((d) => setSkills(d.skills ?? []))
            .catch(() => {});

    useEffect(() => {
        load();
    }, []);

    const startEdit = async (sk: SkillRow) => {
        const res = await fetch(`/skills/${sk.id}`).then((r) => r.json());
        setEditing(sk);
        setCreating(false);
        setId(sk.id);
        setName(res.name ?? sk.name);
        setDescription(res.description ?? '');
        setInstructions(res.instructions ?? '');
        setError('');
    };

    const startCreate = () => {
        setCreating(true);
        setEditing(null);
        setId('');
        setName('');
        setDescription('');
        setInstructions('');
        setError('');
    };

    const save = async () => {
        if (!name.trim() || !instructions.trim()) {
            setError('Name and instructions are required.');
            return;
        }
        if (creating && !/^[a-z0-9-]+$/.test(id.trim())) {
            setError('Id must be lowercase letters, numbers and dashes.');
            return;
        }
        setSaving(true);
        setError('');
        const method = creating ? 'POST' : 'PUT';
        const url = creating ? '/skills' : `/skills/${editing!.id}`;
        const body = creating ? { id: id.trim(), name, description, instructions } : { name, description, instructions };
        const res = await fetch(url, {
            method,
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
        setSaving(false);
        if (!res.ok) {
            const d = await res.json().catch(() => ({}));
            setError(d.error ?? 'Save failed');
            return;
        }
        setCreating(false);
        setEditing(null);
        load();
    };

    const remove = async (sk: SkillRow) => {
        const ok = await confirmAction({ title: `Delete skill "${sk.name}"?`, description: 'This removes the .md file permanently.' });
        if (!ok) return;
        await fetch(`/skills/${sk.id}`, { method: 'DELETE' }).catch(() => {});
        load();
    };

    const isFormOpen = creating || editing !== null;

    return (
        <div>
            <div className="flex items-center gap-2">
                <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Skills</p>
                <button
                    className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
                    onClick={startCreate}
                >
                    <Plus className="size-3.5" /> Add skill
                </button>
            </div>

            <div className="mt-2 space-y-1">
                {skills.length === 0 && (
                    <p className="text-[11px] text-muted-foreground">no skills yet</p>
                )}
                {skills.map((sk) => (
                    <div key={sk.id} className="group flex items-center gap-2 rounded-lg border border-border px-2 py-1.5">
                        <div className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-card-foreground">{sk.name}</span>
                            {sk.description && (
                                <span className="block truncate text-[10px] text-muted-foreground">{sk.description}</span>
                            )}
                        </div>
                        <button
                            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100"
                            title="Edit"
                            onClick={() => startEdit(sk)}
                        >
                            <Pencil className="size-3.5" />
                        </button>
                        <button
                            className="rounded p-1 text-muted-foreground opacity-0 hover:bg-secondary hover:text-red-500 group-hover:opacity-100"
                            title="Delete"
                            onClick={() => remove(sk)}
                        >
                            <Trash2 className="size-3.5" />
                        </button>
                    </div>
                ))}
            </div>

            {isFormOpen && (
                <div className="mt-3 rounded-lg border border-ring p-3">
                    <p className="text-xs font-medium text-card-foreground">
                        {creating ? 'New skill' : `Edit ${editing!.name}`}
                    </p>
                    <div className="mt-2 space-y-2">
                        {creating && (
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
                            placeholder="Description (one line)"
                            className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                        />
                        <textarea
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                            placeholder="Instructions (markdown)…"
                            rows={8}
                            className="w-full resize-y rounded-md border border-input bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-ring"
                        />
                        {error && <p className="text-[11px] text-red-400">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <button
                                className="rounded-md px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary"
                                onClick={() => {
                                    setCreating(false);
                                    setEditing(null);
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                disabled={saving}
                                className={cn(
                                    'rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50',
                                )}
                                onClick={save}
                            >
                                {saving ? 'Saving…' : 'Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
