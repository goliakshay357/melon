import { useEffect, useState } from 'react';
import { SkillsManager, SkillEditor } from '@/components/skills-manager';
import { THEMES } from '@/theme/themes';
import { useThemeStore } from '@/theme/theme-store';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

/**
 * Full Settings PAGE (not a dialog) — fills the content area next to the
 * navbar. NO tabs/header here: the section follows the navbar row you
 * clicked (Skills | Themes). Edit/add swaps the whole page to the editor.
 */
export function SettingsPage() {
    const activeView = useCanvasStore((s) => s.activeView);
    const section: 'skills' | 'themes' = activeView === 'themes' ? 'themes' : 'skills';

    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    // Leaving the skills section (e.g. navbar → Themes) closes the editor.
    useEffect(() => {
        if (section !== 'skills') {
            setEditingId(null);
            setCreating(false);
        }
    }, [section]);

    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);

    const inEditor = creating || editingId !== null;

    return (
        <div className="flex h-full w-full flex-col bg-background">
            <div className="min-h-0 flex-1 overflow-hidden">
                {section === 'skills' ? (
                    inEditor ? (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <SkillEditor
                                skillId={creating ? null : editingId}
                                onBack={() => {
                                    setEditingId(null);
                                    setCreating(false);
                                    setRefreshKey((k) => k + 1);
                                }}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto h-full w-full max-w-3xl p-5">
                            <SkillsManager
                                onEdit={setEditingId}
                                onCreate={() => setCreating(true)}
                                refreshKey={refreshKey}
                            />
                        </div>
                    )
                ) : (
                    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-5">
                        <div className="space-y-1" role="radiogroup" aria-label="Theme">
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
                )}
            </div>
        </div>
    );
}
