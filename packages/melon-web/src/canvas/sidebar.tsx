import { useCallback, useEffect, useState } from 'react';
import {
    ChevronRight,
    FolderOpen,
    PanelLeftClose,
    FolderPlus,
    PanelLeftOpen,
    Plus,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';


const MELON_API = 'http://127.0.0.1:8788';

export function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);

    const [pickingNative, setPickingNative] = useState(false);

    // Native OS dialog — the only way in. Cancel = no-op.
    const addFolder = async () => {
        setPickingNative(true);
        try {
            const res = await fetch(`${MELON_API}/pick-folder`, { method: 'POST' });
            if (res.ok) {
                const { path } = await res.json();
                if (path) {
                    openFolder(path);
                    loadTree();
                }
            }
        } finally {
            setPickingNative(false);
        }
    };
    const [folders, setFolders] = useState<Array<{ cwd: string; lastOpenedAt: string }>>([]);
    const [tree, setTree] = useState<Record<string, { canvases: any[]; loose: any[] }>>({});
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [openCanvasSessions, setOpenCanvasSessions] = useState<Set<string>>(new Set());

    const toggleCanvasSessions = (key: string) =>
        setOpenCanvasSessions((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    const folder = useCanvasStore((s) => s.folder);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const switchCanvas = useCanvasStore((s) => s.switchCanvas);
    const createCanvas = useCanvasStore((s) => s.createCanvas);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const resumeSession = useCanvasStore((s) => s.resumeSession);

    const loadTree = useCallback(async () => {
        try {
            const fr = await fetch(`${MELON_API}/folders`).then((r) => r.json());
            const list = (fr.folders ?? []) as Array<{ cwd: string; lastOpenedAt: string }>;
            setFolders(list);
            const entries = await Promise.all(
                list.map(async (f) => {
                    const tr = await fetch(
                        `${MELON_API}/tree?cwd=${encodeURIComponent(f.cwd)}`,
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
    }, [loadTree, folder, canvasId]);

    const toggleFolder = (cwd: string) =>
        setOpenFolders((prev) => {
            const next = new Set(prev);
            next.has(cwd) ? next.delete(cwd) : next.add(cwd);
            return next;
        });

    // Plus button beside a folder row: new canvas inside THAT folder.
    const newCanvasInFolder = async (cwd: string) => {
        const entry = tree[cwd];
        const suggested = `Canvas ${(entry?.canvases.length ?? 0) + 1}`;
        const name = window.prompt('Name your new canvas', suggested)?.trim();
        if (!name) return; // cancelled
        if (folder !== cwd) await openFolder(cwd);
        await createCanvas(name);
        loadTree();
    };

    const deleteCanvasRow = async (cwd: string, id: string) => {
        if (!window.confirm('Delete this canvas? Card layout is removed (sessions stay on disk).')) return;
        if (canvasId === id && folder === cwd) {
            localStorage.removeItem('melon:lastCanvas');
            useCanvasStore.setState({ cards: [], canvasId: null, canvasName: '' });
        }
        await fetch(`${MELON_API}/canvases/${id}?cwd=${encodeURIComponent(cwd)}`, {
            method: 'DELETE',
        });
        loadTree();
    };

    const renameCanvasRow = async (cwd: string, cv: { id: string; name: string }) => {
        const name = window.prompt('Rename canvas', cv.name)?.trim();
        if (!name || name === cv.name) return;
        const res = await fetch(
            `${MELON_API}/canvases/${cv.id}?cwd=${encodeURIComponent(cwd)}`,
        ).catch(() => null);
        if (!res?.ok) return;
        const data = await res.json();
        data.name = name;
        await fetch(`${MELON_API}/canvases/${cv.id}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ cwd, canvas: data }),
        });
        loadTree();
    };

    return (
        <div
            className={cn(
                'absolute left-3 top-3 z-10 flex h-[calc(100vh-24px)] max-h-[calc(100vh-24px)] w-72 flex-col rounded-xl border border-border bg-card/95 shadow-sm backdrop-blur transition-all',
                collapsed ? 'w-10 items-center py-2' : 'w-72 p-2',
            )}
        >
            {collapsed ? (
                <button
                    className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                    onClick={() => setCollapsed(false)}
                    title="Open navigator"
                >
                    <PanelLeftOpen className="size-4" />
                </button>
            ) : (
                <>
                    <div className="flex shrink-0 items-center justify-between px-1 pb-2">
                        <span className="text-xs font-semibold text-muted-foreground">Navigator</span>
                        <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                            onClick={() => setCollapsed(true)}
                        >
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto">
                        {/* Folder ▸ Canvas ▸ sessions */}
                        <Section title="Folders" icon={<FolderOpen className="size-3.5" />}>
                            <button
                                className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-secondary"
                                onClick={addFolder}
                            >
                                <FolderPlus className="size-3.5" />
                                {pickingNative ? 'Opening Finder…' : 'Add folder'}
                            </button>
                            {folders.map(({ cwd }) => {
                                const t = tree[cwd] ?? { canvases: [], loose: [] };
                                return (
                                <div key={cwd} className="mb-0.5">
                                    <div
                                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 hover:bg-secondary"
                                        onClick={() => toggleFolder(cwd)}
                                    >
                                        <ChevronRight
                                            className={cn(
                                                'size-3 shrink-0 cursor-pointer transition-transform',
                                                openFolders.has(cwd) && 'rotate-90',
                                            )}
                                        />
                                        <span className="flex-1 cursor-pointer truncate text-xs text-card-foreground">
                                            📁 {cwd.split('/').slice(-2).join('/')}
                                        </span>
                                        <button
                                            className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-background hover:text-primary hover:opacity-100"
                                            title={`New canvas in ${cwd.split('/').pop()}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                newCanvasInFolder(cwd);
                                            }}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>
                                    </div>
                                    {openFolders.has(cwd) && (
                                        <div className="ml-4 border-l border-border pl-1">
                                            {t.canvases.length === 0 && t.loose.length === 0 && (
                                                <p className="px-2 py-0.5 text-[11px] text-muted-foreground">empty</p>
                                            )}
                                            {t.canvases.map((cv: any) => (
                                                <div key={cv.id} className="group/cv mb-0.5">
                                                    <div
                                                        className={cn(
                                                            'flex w-full cursor-pointer items-center justify-between gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-secondary',
                                                            folder === cwd && cv.id === canvasId ? 'font-medium text-primary' : 'text-card-foreground',
                                                        )}
                                                        onClick={() => {
                                                            if (folder !== cwd) openFolder(cwd).then(() => switchCanvas(cv.id));
                                                            else switchCanvas(cv.id);
                                                        }}
                                                    >
                                                        <ChevronRight
                                                            className={cn(
                                                                'size-3 shrink-0 cursor-pointer transition-transform',
                                                                openCanvasSessions.has(`${cwd}::${cv.id}`) && 'rotate-90',
                                                            )}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleCanvasSessions(`${cwd}::${cv.id}`);
                                                            }}
                                                        />
                                                        <span
                                                            className="flex-1 truncate"
                                                            onDoubleClick={(e) => {
                                                                e.stopPropagation();
                                                                renameCanvasRow(cwd, cv);
                                                            }}
                                                            title="Double-click to rename"
                                                        >
                                                            🖼 {cv.name}
                                                        </span>
                                                        <button
                                                            className="hidden rounded p-0.5 text-muted-foreground hover:text-red-500 group-hover/cv:block"
                                                            title="Delete canvas"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                deleteCanvasRow(cwd, cv.id);
                                                            }}
                                                        >
                                                            🗑
                                                        </button>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {cv.sessions.length}
                                                        </span>
                                                    </div>
                                                    {openCanvasSessions.has(`${cwd}::${cv.id}`) &&
                                                    cv.sessions.map((sess: any) => (
                                                        <button
                                                            key={sess.file}
                                                            className="block w-full truncate rounded-md px-2 py-0.5 pl-4 text-left text-[10px] text-muted-foreground hover:bg-secondary hover:text-card-foreground"
                                                            title={sess.title}
                                                            onClick={() => resumeSession(sess.file)}
                                                        >
                                                            • {sess.title || sess.file.split('/').pop()?.slice(0, 20)}
                                                        </button>
                                                    ))}
                                                </div>
                                            ))}
                                            {t.loose.length > 0 && (
                                                <div>
                                                    <div
                                                        className="flex w-full cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground hover:bg-secondary"
                                                        onClick={() => toggleCanvasSessions(`${cwd}::loose`)}
                                                    >
                                                        <ChevronRight
                                                            className={cn(
                                                                'size-2.5 transition-transform',
                                                                openCanvasSessions.has(`${cwd}::loose`) && 'rotate-90',
                                                            )}
                                                        />
                                                        loose sessions ({t.loose.length})
                                                    </div>
                                                    {openCanvasSessions.has(`${cwd}::loose`) &&
                                                    t.loose.map((sess: any) => (
                                                        <button
                                                            key={sess.file}
                                                            className="block w-full truncate rounded-md px-2 py-0.5 pl-4 text-left text-[10px] text-muted-foreground hover:bg-secondary hover:text-card-foreground"
                                                            title={sess.title}
                                                            onClick={() => resumeSession(sess.file)}
                                                        >
                                                            • {sess.title || sess.file.split('/').pop()?.slice(0, 20)}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                                );
                            })}
                        </Section>
                    </div>

                    {folder && (
                        <div className="border-t border-border px-1 pt-2 text-[10px] text-muted-foreground">
                            📁 {folder.split('/').pop()}
                        </div>
                    )}
                </>
            )}



        </div>
    );
}

function Section({
    title,
    icon,
    children,
}: {
    title: string;
    icon: React.ReactNode;
    children: React.ReactNode;
}) {
    return (
        <div className="mb-3">
            <div className="flex items-center gap-1.5 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                {icon} {title}
            </div>
            {children}
        </div>
    );
}
