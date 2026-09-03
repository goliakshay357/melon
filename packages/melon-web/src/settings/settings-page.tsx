import { useEffect, useRef, useState } from 'react';
import { SkillsManager, SkillEditor, type SkillPrefill } from '@/components/skills-manager';
import { confirmAction } from '@/components/dialogs';
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
    const [prefill, setPrefill] = useState<SkillPrefill | undefined>(undefined);
    const [refreshKey, setRefreshKey] = useState(0);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const dirtyRef = useRef(false);
    const setActiveView = useCanvasStore((s) => s.setActiveView);

    // Same version string baked into release artifact names (Melon-0.3.3-arm64.dmg).
    useEffect(() => {
        let alive = true;
        fetch('/healthz', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { version?: unknown } | null) => {
                if (!alive) return;
                const v = typeof body?.version === 'string' ? body.version.trim() : '';
                setAppVersion(v || null);
            })
            .catch(() => {
                if (alive) setAppVersion(null);
            });
        return () => {
            alive = false;
        };
    }, []);

    const closeEditor = () => {
        setEditingId(null);
        setCreating(false);
        setPrefill(undefined);
        setRefreshKey((k) => k + 1);
    };

    // Leaving the skills section while the editor is open: confirm if dirty.
    useEffect(() => {
        if (section === 'skills' || (!creating && editingId === null)) return;
        if (dirtyRef.current) {
            confirmAction({
                title: 'Discard changes?',
                description: 'Your edits to this skill will not be saved.',
            }).then((ok) => {
                if (ok) closeEditor();
                else setActiveView('skills');
            });
        } else {
            closeEditor();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section]);

    const duplicate = async (sk: { id: string; name: string }) => {
        const d = await fetch(`/skills/${sk.id}`)
            .then((r) => r.json())
            .catch(() => null);
        if (!d) return;
        setPrefill({
            name: `${d.name ?? sk.name} copy`,
            description: d.description ?? '',
            instructions: d.instructions ?? '',
        });
        setEditingId(null);
        setCreating(true);
    };

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
                                initial={prefill}
                                onBack={closeEditor}
                                onDirtyChange={(d) => (dirtyRef.current = d)}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <SkillsManager
                                onEdit={setEditingId}
                                onCreate={() => {
                                    setPrefill(undefined);
                                    setCreating(true);
                                }}
                                onDuplicate={duplicate}
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
            <div className="shrink-0 border-t border-border px-5 py-3">
                <p className="text-[10px] text-muted-foreground" data-testid="app-build-version">
                    {appVersion ? `Melon ${appVersion}` : 'Melon'}
                </p>
            </div>
        </div>
    );
}
