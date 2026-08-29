import * as RadixDialog from '@radix-ui/react-dialog';
import { useState } from 'react';
import { THEMES } from '@/theme/themes';
import { useThemeStore } from '@/theme/theme-store';
import { cn } from '@/lib/utils';
import { SkillsManager, SkillEditor } from '@/components/skills-manager';

/**
 * Settings — two columns: Skills (left, searchable + editor) | Theme (right).
 * Clicking edit/add on a skill swaps the whole dialog to the skill editor;
 * Back returns to the two-column browse view.
 */
export function SettingsDialog({
    open,
    onOpenChange,
}: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const closeEditor = () => {
        setEditingId(null);
        setCreating(false);
        setRefreshKey((k) => k + 1); // refetch the list after a save
    };

    const inEditor = creating || editingId !== null;

    return (
        <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
                <RadixDialog.Content
                    className="fixed left-1/2 top-1/2 z-[1001] flex h-[min(640px,85vh)] w-[min(900px,92vw)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <RadixDialog.Title className="shrink-0 text-sm font-semibold text-card-foreground">
                        Settings
                    </RadixDialog.Title>
                    <RadixDialog.Description className="sr-only">
                        Manage skills and appearance.
                    </RadixDialog.Description>

                    {inEditor ? (
                        /* ── Skill editor takes over the dialog ── */
                        <div className="mt-3 flex min-h-0 flex-1 flex-col">
                            <SkillEditor
                                skillId={creating ? null : editingId}
                                onBack={closeEditor}
                            />
                        </div>
                    ) : (
                        /* ── Two-column browse view ── */
                        <div className="mt-3 grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-6">
                            {/* Left: skills */}
                            <div className="flex min-h-0 flex-col">
                                <p className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Skills
                                </p>
                                <div className="mt-2 flex min-h-0 flex-1 flex-col">
                                    <SkillsManager
                                        onEdit={setEditingId}
                                        onCreate={() => setCreating(true)}
                                        refreshKey={refreshKey}
                                    />
                                </div>
                            </div>

                            {/* Right: theme */}
                            <div className="flex min-h-0 flex-col overflow-y-auto">
                                <p className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Theme
                                </p>
                                <div
                                    className="mt-2 shrink-0 space-y-1"
                                    role="radiogroup"
                                    aria-label="Theme"
                                >
                                    {THEMES.map((t) => {
                                        const active = t.id === themeId;
                                        return (
                                            <button
                                                key={t.id}
                                                role="radio"
                                                aria-checked={active}
                                                onClick={() => setTheme(t.id)}
                                                className={cn(
                                                    'flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                                                    active
                                                        ? 'border-ring bg-primary/10'
                                                        : 'border-border hover:bg-secondary',
                                                )}
                                            >
                                                <span
                                                    className={cn(
                                                        'size-3 shrink-0 rounded-full border',
                                                        active
                                                            ? 'border-primary bg-primary'
                                                            : 'border-muted-foreground/50',
                                                    )}
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate text-xs font-medium text-card-foreground">
                                                        {t.label}
                                                    </span>
                                                    <span className="block text-[10px] capitalize text-muted-foreground">
                                                        {t.appearance}
                                                    </span>
                                                </span>
                                                <span className="flex shrink-0 gap-1">
                                                    {(
                                                        [
                                                            '--background',
                                                            '--primary',
                                                            '--accent',
                                                        ] as const
                                                    ).map((v) => (
                                                        <span
                                                            key={v}
                                                            className="size-4 rounded-full border border-border"
                                                            style={{
                                                                background: `hsl(${t.vars[v]})`,
                                                            }}
                                                        />
                                                    ))}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
