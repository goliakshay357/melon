import { useCallback, useEffect, useState } from 'react';
import {
    ChevronRight,
    FileText,
    FolderOpen,
    FolderPlus,
    Layers,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Settings,
    X,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { askText, confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';
import { pickFolder } from '@/lib/pick-folder';
import { Sparkles, Palette } from 'lucide-react';



export function Sidebar() {
    const collapsed = useCanvasStore((s) => s.sidebarCollapsed);
    const setCollapsed = useCanvasStore((s) => s.setSidebarCollapsed);
    const [folders, setFolders] = useState<Array<{ cwd: string; lastOpenedAt: string }>>([]);
    const [tree, setTree] = useState<Record<string, { canvases: any[]; loose: any[] }>>({});
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [openCanvasSessions, setOpenCanvasSessions] = useState<Set<string>>(new Set());
    const [pickingNative, setPickingNative] = useState(false);
    const activeView = useCanvasStore((s) => s.activeView);
    const cards = useCanvasStore((s) => s.cards);
    const setActiveView = useCanvasStore((s) => s.setActiveView);
    const openView = (v: 'skills' | 'themes') => {
        setActiveView(v);
    };    const [recent, setRecent] = useState<Array<{ id: string; name: string; cwd: string; folderName: string; modified: string }>>([]);

    const folder = useCanvasStore((s) => s.folder);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const createCanvas = useCanvasStore((s) => s.createCanvas);
    const switchCanvas = useCanvasStore((s) => s.switchCanvas);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const resumeSession = useCanvasStore((s) => s.resumeSession);
    const canvasTreeRev = useCanvasStore((s) => s.canvasTreeRev);
    const [appVersion, setAppVersion] = useState<string | null>(null);

    // Same identity as Melon-<version>-<arch>.dmg — always visible in the navbar.
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

    const loadTree = useCallback(async () => {
        try {
            const fr = await fetch(`/folders`).then((r) => r.json());
            const list = (fr.folders ?? []) as Array<{ cwd: string; lastOpenedAt: string }>;
            setFolders(list);
            const entries = await Promise.all(
                list.map(async (f) => {
                    const tr = await fetch(
                        `/tree?cwd=${encodeURIComponent(f.cwd)}`,
                    ).then((r) => r.json());
                    return [f.cwd, { canvases: tr.canvases ?? [], loose: tr.loose ?? [] }] as const;
                }),
            );
            setTree(Object.fromEntries(entries));
        } catch {
            /* server down */
        }
    }, []);

    useEffect(() => {
        loadTree();
        fetch(`/canvases/recent`)
            .then((r) => r.json())
            .then((d) => setRecent(d.recent ?? []))
            .catch(() => {});
    }, [loadTree, folder, canvasId, canvasTreeRev]);

    const toggleFolder = (cwd: string) =>
        setOpenFolders((prev) => {
            const next = new Set(prev);
            next.has(cwd) ? next.delete(cwd) : next.add(cwd);
            return next;
        });

    const toggleCanvasSessions = (key: string) =>
        setOpenCanvasSessions((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    // Native OS dialog — the only way in. Cancel = no-op.
    const addFolder = async () => {
        setPickingNative(true);
        try {
            const picked = await pickFolder();
            if (picked) {
                await openFolder(picked);
                loadTree();
            }
        } finally {
            setPickingNative(false);
        }
    };

    const newCanvasInFolder = async (cwd: string) => {
        const entry = tree[cwd];
        const suggested = `Canvas ${(entry?.canvases.length ?? 0) + 1}`;
        const name = (await askText({ title: 'Name your new canvas', initial: suggested }))?.trim();
        if (!name) return;
        if (folder !== cwd) await openFolder(cwd);
        await createCanvas(name);
        loadTree();
    };

    const deleteCanvasRow = async (cwd: string, id: string) => {
        if (!(await confirmAction({
            title: 'Delete this canvas?',
            description:
                'The card layout will be removed. Pi sessions remain on disk and can be reopened later.',
            confirmLabel: 'Delete',
        })))
            return;
        if (canvasId === id && folder === cwd) {
            localStorage.removeItem('melon:lastCanvas');
            useCanvasStore.setState({ cards: [], canvasId: null, canvasName: '' });
        }
        await fetch(`/canvases/${id}?cwd=${encodeURIComponent(cwd)}`, {
            method: 'DELETE',
        });
        loadTree();
    };

    const renameCanvasRow = async (cwd: string, cv: { id: string; name: string }) => {
        const name = (await askText({ title: 'Rename canvas', initial: cv.name }))?.trim();
        if (!name || name === cv.name) return;
        await useCanvasStore.getState().renameCanvas(cwd, cv.id, name);
    };

    return (
        <div
            className={cn(
                'absolute left-0 top-0 z-10 flex h-full flex-col overflow-hidden border-r border-border bg-card transition-all duration-200',
                collapsed ? 'w-12 items-center py-2' : 'w-[260px]',
            )}
        >
            {collapsed ? (
                <>
                    <button
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        onClick={() => setCollapsed(false)}
                    >
                        <PanelLeftOpen className="size-4" />
                    </button>
                    {activeView !== 'canvas' && (
                        <>
                            <button
                                className={cn(
                                    'rounded-lg p-2 transition-colors hover:bg-secondary hover:text-foreground',
                                    activeView === 'skills' && 'bg-secondary text-foreground',
                                )}
                                title="Skills"
                                onClick={() => openView('skills')}
                            >
                                <Sparkles className="size-4" />
                            </button>
                            <button
                                className={cn(
                                    'rounded-lg p-2 transition-colors hover:bg-secondary hover:text-foreground',
                                    activeView === 'themes' && 'bg-secondary text-foreground',
                                )}
                                title="Themes"
                                onClick={() => openView('themes')}
                            >
                                <Palette className="size-4" />
                            </button>
                        </>
                    )}
                    <button
                        className="mt-auto rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        title={activeView === 'canvas' ? 'Settings' : 'Back to chat'}
                        onClick={() =>
                            activeView === 'canvas' ? openView('themes') : setActiveView('canvas')
                        }
                    >
                        {activeView === 'canvas' ? (
                            <Settings className="size-4" />
                        ) : (
                            <MessageSquare className="size-4" />
                        )}
                    </button>
                </>
            ) : (
                <>
                    {/* Brand header */}
                    <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-4">
                        <span className="text-base">🍉</span>
                        <span className="flex-1 text-sm font-semibold tracking-tight text-card-foreground">
                            Melon
                        </span>
                        <button
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary"
                            onClick={() => setCollapsed(true)}
                        >
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    {activeView === 'canvas' ? (
                        <>
                    {/* Primary action */}
                    <div className="px-3 pb-1">
                        <button
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:bg-secondary hover:text-foreground"
                            onClick={addFolder}
                        >
                            <FolderPlus className="size-3.5" />
                            {pickingNative ? 'Opening Finder…' : 'Add folder'}
                        </button>
                    </div>

                    {/* Scrollable body */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                        {recent.length > 0 && (
                            <>
                                <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Recent canvases
                                </p>
                                <div className="mb-2 space-y-0.5 pb-2">
                                    {recent.map((cv) => {
                                        const isActive = folder === cv.cwd && cv.id === canvasId;
                                        return (
                                            <button
                                                key={`${cv.cwd}::${cv.id}`}
                                                className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-secondary/70"
                                                title={`${cv.name} — ${cv.folderName}`}
                                                onClick={() => {
                                                    if (folder !== cv.cwd)
                                                        openFolder(cv.cwd).then(() => switchCanvas(cv.id));
                                                    else switchCanvas(cv.id);
                                                }}
                                            >
                                                <Layers className="size-3 shrink-0 text-muted-foreground" />
                                                <span className="min-w-0 flex-1 truncate text-xs text-card-foreground">
                                                    {cv.name}
                                                    {isActive && (cards.some((c) => c.status === "streaming") ? (
                                                        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-400" title="AI is running" />
                                                    ) : cards.some((c) => c.status === "error") ? (
                                                        <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" title="Error" />
                                                    ) : null)}
                                                </span>
                                                <span className="shrink-0 truncate text-[9px] text-muted-foreground">
                                                    📁 {cv.folderName}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        {folders.length === 0 && (
                            <div className="mt-6 px-4 text-center">
                                <FolderOpen className="mx-auto size-6 text-muted-foreground/40" />
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                    No folders yet.
                                    <br />
                                    Add one to start your first canvas.
                                </p>
                            </div>
                        )}

                        {folders.length > 0 && (
                            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Workspaces
                            </p>
                        )}

                        {folders.map(({ cwd }) => {
                            const t = tree[cwd] ?? { canvases: [], loose: [] };
                            return (
                                <div key={cwd} className="mb-1">
                                    {/* Folder row */}
                                    <div className="group/folder flex items-center gap-0.5 rounded-lg pr-1 transition-colors hover:bg-secondary/70">
                                        <button
                                            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 text-left"
                                            onClick={() => toggleFolder(cwd)}
                                        >
                                            <ChevronRight
                                                className={cn(
                                                    'size-3 shrink-0 text-muted-foreground transition-transform',
                                                    openFolders.has(cwd) && 'rotate-90',
                                                )}
                                            />
                                            <span className="truncate text-xs font-medium text-card-foreground">
                                                {cwd.split('/').pop()}
                                            </span>
                                        </button>
                                        <button
                                            className="rounded p-1 opacity-0 transition-opacity hover:bg-background hover:text-primary group-hover/folder:opacity-100"
                                            title={`New canvas in ${cwd.split('/').pop()}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                newCanvasInFolder(cwd);
                                            }}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>
                                    </div>

                                    {/* Canvases + sessions */}
                                    {openFolders.has(cwd) && (
                                        <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                                            {t.canvases.length === 0 && t.loose.length === 0 && (
                                                <p className="py-1 text-[11px] italic text-muted-foreground/70">
                                                    empty
                                                </p>
                                            )}

                                            {t.canvases.map((cv: any) => {
                                                const key = `${cwd}::${cv.id}`;
                                                const isActive =
                                                    folder === cwd && cv.id === canvasId;
                                                return (
                                                    <div key={cv.id}>
                                                        <div
                                                            className={cn(
                                                                'group/cv flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1 transition-colors',
                                                                isActive
                                                                    ? 'bg-primary/10'
                                                                    : 'hover:bg-secondary/70',
                                                            )}
                                                        >
                                                            <ChevronRight
                                                                className={cn(
                                                                    'size-3 shrink-0 cursor-pointer text-muted-foreground transition-transform',
                                                                    openCanvasSessions.has(key) &&
                                                                        'rotate-90',
                                                                )}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleCanvasSessions(key);
                                                                }}
                                                            />
                                                            <Layers
                                                                className={cn(
                                                                    'size-3 shrink-0',
                                                                    isActive
                                                                        ? 'text-primary'
                                                                        : 'text-muted-foreground',
                                                                )}
                                                            />
                                                            <span
                                                                className={cn(
                                                                    'min-w-0 flex-1 cursor-pointer truncate text-xs',
                                                                    isActive
                                                                        ? 'font-medium text-primary'
                                                                        : 'text-card-foreground',
                                                                )}
                                                                title={`${cv.name} — click to open, double-click to rename`}
                                                                onClick={() => {
                                                                    if (folder !== cwd)
                                                                        openFolder(cwd).then(() =>
                                                                            switchCanvas(cv.id),
                                                                        );
                                                                    else switchCanvas(cv.id);
                                                                }}
                                                                onDoubleClick={(e) => {
                                                                    e.stopPropagation();
                                                                    renameCanvasRow(cwd, cv);
                                                                }}
                                                            >
                                                                {cv.name}
                                                                {isActive && (cards.some((c) => c.status === "streaming") ? (
                                                                    <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-400" title="AI is running" />
                                                                ) : cards.some((c) => c.status === "error") ? (
                                                                    <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" title="Error" />
                                                                ) : null)}
                                                            </span>
                                                            <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[9px] tabular-nums text-muted-foreground">
                                                                {cv.sessions.length}
                                                            </span>
                                                            <button
                                                                className="hidden rounded p-0.5 text-muted-foreground transition-colors hover:text-red-500 group-hover/cv:block"
                                                                title="Delete canvas"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    deleteCanvasRow(cwd, cv.id);
                                                                }}
                                                            >
                                                                <X className="size-3" />
                                                            </button>
                                                        </div>

                                                        {openCanvasSessions.has(key) &&
                                                            cv.sessions.map((sess: any) => (
                                                                <button
                                                                    key={sess.file}
                                                                    className="flex w-full items-center gap-1 truncate rounded-md py-0.5 pl-6 pr-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-card-foreground"
                                                                    title={sess.title}
                                                                    onClick={() =>
                                                                        resumeSession(sess.file)
                                                                    }
                                                                >
                                                                    <FileText className="size-2.5 shrink-0" />
                                                                    <span className="truncate">
                                                                        {sess.title ||
                                                                            sess.file
                                                                                .split('/')
                                                                                .pop()
                                                                                ?.slice(0, 24)}
                                                                    </span>
                                                                </button>
                                                            ))}
                                                    </div>
                                                );
                                            })}

                                            {t.loose.length > 0 && (
                                                <div>
                                                    <button
                                                        className="flex w-full items-center gap-1 rounded-lg py-1 pl-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 transition-colors hover:bg-secondary/50"
                                                        onClick={() =>
                                                            toggleCanvasSessions(
                                                                `${cwd}::loose`,
                                                            )
                                                        }
                                                    >
                                                        <ChevronRight
                                                            className={cn(
                                                                'size-2.5 transition-transform',
                                                                openCanvasSessions.has(
                                                                    `${cwd}::loose`,
                                                                ) && 'rotate-90',
                                                            )}
                                                        />
                                                        loose ({t.loose.length})
                                                    </button>
                                                    {openCanvasSessions.has(`${cwd}::loose`) &&
                                                        t.loose.map((sess: any) => (
                                                            <button
                                                                key={sess.file}
                                                                className="flex w-full items-center gap-1 truncate rounded-md py-0.5 pl-4 pr-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-card-foreground"
                                                                title={sess.title}
                                                                onClick={() =>
                                                                    resumeSession(sess.file)
                                                                }
                                                            >
                                                                <FileText className="size-2.5 shrink-0" />
                                                                <span className="truncate">
                                                                    {sess.title ||
                                                                        sess.file
                                                                            .split('/')
                                                                            .pop()
                                                                            ?.slice(0, 24)}
                                                                </span>
                                                            </button>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                        </>
                    ) : (
                        /* Settings mode: navbar body becomes the two pages */
                        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Settings
                            </p>
                            <div className="space-y-0.5">
                                <button
                                    onClick={() => openView('skills')}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                        activeView === 'skills'
                                            ? 'bg-secondary font-medium text-card-foreground'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                >
                                    <Sparkles className="size-3.5 shrink-0" /> Skills
                                </button>
                                <button
                                    onClick={() => openView('themes')}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                        activeView === 'themes'
                                            ? 'bg-secondary font-medium text-card-foreground'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                >
                                    <Palette className="size-3.5 shrink-0" /> Themes
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Footer: build version + workspace breadcrumb + settings */}
                    <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-2">
                        <p
                            className="truncate text-[11px] font-medium text-foreground"
                            data-testid="app-build-version"
                            title={appVersion ? `Melon ${appVersion}` : 'Melon'}
                        >
                            {appVersion ? `Melon ${appVersion}` : 'Melon'}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                            <span className="min-w-0 truncate text-[10px] text-muted-foreground">
                                {folder && `📁 …${folder.split('/').slice(-2).join('/')}`}
                            </span>
                            <button
                                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                title={activeView === 'canvas' ? 'Settings' : 'Back to chat'}
                                onClick={() =>
                                    activeView === 'canvas' ? openView('themes') : setActiveView('canvas')
                                }
                            >
                                {activeView === 'canvas' ? (
                                    <Settings className="size-3.5" />
                                ) : (
                                    <MessageSquare className="size-3.5" />
                                )}
                            </button>
                        </div>
                    </div>

                </>
            )}

        </div>
    );
}
