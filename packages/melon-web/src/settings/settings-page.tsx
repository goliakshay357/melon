import { useEffect, useRef, useState } from 'react';
import { SkillsManager, SkillEditor, type SkillPrefill } from '@/components/skills-manager';
import { AgentsManager, AgentEditor, type AgentPrefill } from '@/components/agents-manager';
import { ProvidersSection } from '@/settings/providers-section';
import { confirmAction } from '@/components/dialogs';
import { THEMES } from '@/theme/themes';
import { useThemeStore } from '@/theme/theme-store';
import { useDeveloperStore } from '@/settings/developer-store';
import { useCanvasStore, type AppView } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

type SettingsSection = 'agents' | 'skills' | 'themes' | 'providers' | 'developer';

function sectionFromView(view: AppView): SettingsSection {
    if (view === 'agents') return 'agents';
    if (view === 'themes') return 'themes';
    if (view === 'providers') return 'providers';
    if (view === 'developer') return 'developer';
    return 'skills';
}

/**
 * Full Settings PAGE (not a dialog) — fills the content area next to the
 * navbar. NO tabs/header here: the section follows the navbar row you
 * clicked (Agents | Skills | Themes). Edit/add swaps the whole page to the editor.
 */
export function SettingsPage() {
    const activeView = useCanvasStore((s) => s.activeView);
    const section = sectionFromView(activeView);

    const [editingId, setEditingId] = useState<string | null>(null);
    const [creating, setCreating] = useState(false);
    const [skillPrefill, setSkillPrefill] = useState<SkillPrefill | undefined>(undefined);
    const [agentPrefill, setAgentPrefill] = useState<AgentPrefill | undefined>(undefined);
    const [refreshKey, setRefreshKey] = useState(0);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const dirtyRef = useRef(false);
    const setActiveView = useCanvasStore((s) => s.setActiveView);

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
        setSkillPrefill(undefined);
        setAgentPrefill(undefined);
        setRefreshKey((k) => k + 1);
    };

    // Leaving a section while the editor is open: confirm if dirty.
    useEffect(() => {
        if (!creating && editingId === null) return;
        if (dirtyRef.current) {
            confirmAction({
                title: 'Discard changes?',
                description:
                    section === 'agents'
                        ? 'Your edits to this agent will not be saved.'
                        : 'Your edits to this skill will not be saved.',
            }).then((ok) => {
                if (ok) closeEditor();
                else setActiveView(section === 'themes' ? 'skills' : section);
            });
        } else {
            closeEditor();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [section]);

    const duplicateSkill = async (sk: { id: string; name: string }) => {
        const d = await fetch(`/skills/${sk.id}`)
            .then((r) => r.json())
            .catch(() => null);
        if (!d) return;
        setSkillPrefill({
            name: `${d.name ?? sk.name} copy`,
            description: d.description ?? '',
            instructions: d.instructions ?? '',
        });
        setEditingId(null);
        setCreating(true);
    };

    const duplicateAgent = async (row: { id: string; name: string }) => {
        const d = await fetch(`/agents/${row.id}`)
            .then((r) => r.json())
            .catch(() => null);
        if (!d) return;
        setAgentPrefill({
            name: `${d.name ?? row.name} copy`,
            role: d.role ?? '',
            descriptionMd: d.descriptionMd ?? '',
            defaultSkillIds: Array.isArray(d.defaultSkillIds) ? d.defaultSkillIds : [],
        });
        setEditingId(null);
        setCreating(true);
    };

    const themeId = useThemeStore((s) => s.themeId);
    const setTheme = useThemeStore((s) => s.setTheme);
    const debuggerEnabled = useDeveloperStore((s) => s.debuggerEnabled);
    const setDebuggerEnabled = useDeveloperStore((s) => s.setDebuggerEnabled);

    const inEditor = creating || editingId !== null;

    return (
        <div className="flex h-full w-full flex-col bg-background">
            <div className="min-h-0 flex-1 overflow-hidden">
                {section === 'agents' ? (
                    inEditor ? (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <AgentEditor
                                agentId={creating ? null : editingId}
                                initial={agentPrefill}
                                onBack={closeEditor}
                                onDirtyChange={(d) => {
                                    dirtyRef.current = d;
                                }}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <AgentsManager
                                onEdit={setEditingId}
                                onCreate={() => {
                                    setAgentPrefill(undefined);
                                    setCreating(true);
                                }}
                                onDuplicate={duplicateAgent}
                                refreshKey={refreshKey}
                            />
                        </div>
                    )
                ) : section === 'skills' ? (
                    inEditor ? (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <SkillEditor
                                skillId={creating ? null : editingId}
                                initial={skillPrefill}
                                onBack={closeEditor}
                                onDirtyChange={(d) => {
                                    dirtyRef.current = d;
                                }}
                            />
                        </div>
                    ) : (
                        <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                            <SkillsManager
                                onEdit={setEditingId}
                                onCreate={() => {
                                    setSkillPrefill(undefined);
                                    setCreating(true);
                                }}
                                onDuplicate={duplicateSkill}
                                refreshKey={refreshKey}
                            />
                        </div>
                    )
                ) : section === 'providers' ? (
                    <div className="mx-auto flex h-full w-full max-w-3xl flex-col p-5">
                        <ProvidersSection />
                    </div>
                ) : section === 'developer' ? (
                    <div className="mx-auto h-full w-full max-w-3xl overflow-y-auto p-5">
                        <div className="space-y-3">
                            <div>
                                <h2 className="text-sm font-medium text-card-foreground">Developer options</h2>
                                <p className="mt-0.5 text-[11px] text-muted-foreground">
                                    Tools for inspecting Melon itself. Off by default.
                                </p>
                            </div>
                            <div className="rounded-lg border border-border px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div className="min-w-0">
                                        <p className="text-xs font-medium text-card-foreground">Debugger</p>
                                        <p className="text-[10px] text-muted-foreground">
                                            Show the debugger control on every card, and allow Inspect
                                            (Cmd+Option+I) in the desktop app.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        role="switch"
                                        aria-checked={debuggerEnabled}
                                        aria-label="Debugger"
                                        onClick={() => setDebuggerEnabled(!debuggerEnabled)}
                                        className={cn(
                                            'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                                            debuggerEnabled ? 'bg-primary' : 'bg-muted',
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'absolute top-0.5 size-4 rounded-full bg-background shadow transition-transform',
                                                debuggerEnabled ? 'translate-x-4' : 'translate-x-0.5',
                                            )}
                                        />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
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
                <p className="text-xs font-medium text-foreground" data-testid="app-build-version-page">
                    {appVersion ? `Melon ${appVersion}` : 'Melon'}
                </p>
            </div>
        </div>
    );
}
