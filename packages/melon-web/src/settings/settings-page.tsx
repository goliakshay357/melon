import { useState } from 'react';
import { SkillsManager, SkillEditor } from '@/components/skills-manager';
import { THEMES } from '@/theme/themes';
import { useThemeStore } from '@/theme/theme-store';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

/**
 * Full Settings PAGE (not a dialog) — fills the content area next to the
 * navbar. Two sections chosen by tabs: Skills | Themes. Clicking edit/add on
 * a skill swaps the whole page to the skill editor; Back returns to tabs.
 */
export function SettingsPage({ initialTab }: { initialTab?: 'skills' | 'themes' }) {
    const [tab, setTab] = useState<'skills' | 'themes'>(initialTab ?? 'skills');
    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);

    const inEditor = creating || editingId !== null;

    return (
        <div className="flex h-full w-full flex-col bg-background">
            {/* Page header */}
            <div className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-5">
                <h1 className="text-sm font-semibold text-card-foreground">Settings</h1>
                {!inEditor && (
                    <div className="ml-4 flex gap-1" role="tablist">
                        {(['skills', 'themes'] as const).map((t) => (
                            <button
                                key={t}
                                role="tab"
                                aria-selected={tab === t}
                                onClick={() => setTab(t)}
                                className={cn(
                                    'rounded-md px-3 py-1.5 text-xs capitalize transition-colors',
                                    tab === t
                                        ? 'bg-secondary font-medium text-card-foreground'
                                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                                )}
                            >
                                {t}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-hidden">
                {tab === 'skills' ? (
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
                        <div
                            className="space-y-1"
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
                )}
            </div>
        </div>
    );
}

/** Keep the store import used even if tabs change later. */
export function useAppView() {
    return useCanvasStore((s) => s.activeView);
}
