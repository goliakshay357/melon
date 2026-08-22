import { useCallback, useEffect, useState } from 'react';
import {
    ChevronRight,
    FolderOpen,
    FolderPlus,
    Layers,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { FolderPicker } from '@/components/folder-picker';
import { cn } from '@/lib/utils';

interface SessionInfo {
    id: string;
    file: string;
    firstMessage?: string;
}
interface Project {
    cwd: string;
    sessions: SessionInfo[];
}
void 0;

const MELON_API = 'http://127.0.0.1:8788';

export function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const [tree, setTree] = useState<Array<any>>([]);
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [newCanvasName, setNewCanvasName] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);

    const folder = useCanvasStore((s) => s.folder);
    const canvases = useCanvasStore((s) => s.canvases);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const switchCanvas = useCanvasStore((s) => s.switchCanvas);
    const createCanvas = useCanvasStore((s) => s.createCanvas);
    const resumeSession = useCanvasStore((s) => s.resumeSession);

    const loadTree = useCallback(async () => {
        try {
            const pr = await fetch(`${MELON_API}/projects`).then((r) => r.json());
            const trees = await Promise.all(
                (pr.projects ?? []).map(async (p: Project) => {
                    const tr = await fetch(
                        `${MELON_API}/tree?cwd=${encodeURIComponent(p.cwd)}`,
                    ).then((r) => r.json());
                    return { cwd: p.cwd, canvases: tr.canvases ?? [], loose: tr.loose ?? [] };
                }),
            );
            setTree(trees);
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

    // Start a new canvas in a folder chosen via the navigator.
    const newCanvasInPickedFolder = async (path: string) => {
        await openFolder(path);
        await createCanvas('Canvas 1');
    };

    // Plus button beside a folder row: new canvas inside THAT folder.
    const newCanvasInFolder = async (cwd: string) => {
        const entry = tree.find((t) => t.cwd === cwd);
        const name = `Canvas ${(entry?.canvases.length ?? 0) + 1}`;
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
                'absolute left-3 top-3 z-10 flex max-h-[80vh] flex-col rounded-xl border border-border bg-card/95 shadow-sm backdrop-blur transition-all',
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
                    <div className="flex items-center justify-between px-1 pb-2">
                        <span className="text-xs font-semibold text-muted-foreground">Navigator</span>
                        <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                            onClick={() => setCollapsed(true)}
                        >
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {/* Canvases within current folder */}
                        <Section title="Canvases" icon={<Layers className="size-3.5" />}>
                            {folder &&
                                canvases.map((cv) => (
                                    <button
                                        key={cv.id}
                                        className={cn(
                                            'block w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-secondary',
                                            cv.id === canvasId
                                                ? 'bg-secondary font-medium text-primary'
                                                : 'text-card-foreground',
                                        )}
                                        onClick={() => switchCanvas(cv.id)}
                                    >
                                        {cv.name}
                                    </button>
                                ))}
                            {folder && (
                                <form
                                    className="mt-1 flex gap-1 px-1"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (newCanvasName.trim()) {
                                            createCanvas(newCanvasName.trim());
                                            setNewCanvasName('');
                                        }
                                    }}
                                >
                                    <input
                                        value={newCanvasName}
                                        onChange={(e) => setNewCanvasName(e.target.value)}
                                        placeholder="New canvas…"
                                        className="nodrag w-full rounded-md border border-input bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
                                    />
                                    <button
                                        type="submit"
                                        className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
                                    >
                                        <Plus className="size-3.5" />
                                    </button>
                                </form>
                            )}
                            {!folder && (
                                <p className="px-2 py-1 text-[11px] text-muted-foreground">
                                    Open a folder to begin.
                                </p>
                            )}
                        </Section>

                        {/* Folder ▸ Canvas ▸ sessions */}
                        <Section title="Folders" icon={<FolderOpen className="size-3.5" />}>
                            <button
                                className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-primary hover:bg-secondary"
                                onClick={() => setPickerOpen(true)}
                            >
                                <FolderPlus className="size-3.5" /> New canvas in another folder…
                            </button>
                            {tree.map((t) => (
                                <div key={t.cwd} className="mb-0.5">
                                    <div
                                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 hover:bg-secondary"
                                        onClick={() => toggleFolder(t.cwd)}
                                    >
                                        <ChevronRight
                                            className={cn(
                                                'size-3 shrink-0 cursor-pointer transition-transform',
                                                openFolders.has(t.cwd) && 'rotate-90',
                                            )}
                                        />
                                        <span className="flex-1 cursor-pointer truncate text-xs text-card-foreground">
                                            📁 {t.cwd.split('/').slice(-2).join('/')}
                                        </span>
                                        <button
                                            className="rounded p-0.5 text-muted-foreground opacity-60 hover:bg-background hover:text-primary hover:opacity-100"
                                            title={`New canvas in ${t.cwd.split('/').pop()}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                newCanvasInFolder(t.cwd);
                                            }}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>
                                    </div>
                                    {openFolders.has(t.cwd) && (
                                        <div className="ml-4 border-l border-border pl-1">
                                            {t.canvases.length === 0 && t.loose.length === 0 && (
                                                <p className="px-2 py-0.5 text-[11px] text-muted-foreground">empty</p>
                                            )}
                                            {t.canvases.map((cv: any) => (
                                                <div key={cv.id} className="group/cv mb-0.5">
                                                    <div
                                                        className={cn(
                                                            'flex w-full cursor-pointer items-center justify-between gap-1 rounded-md px-2 py-0.5 text-[11px] hover:bg-secondary',
                                                            folder === t.cwd && cv.id === canvasId ? 'font-medium text-primary' : 'text-card-foreground',
                                                        )}
                                                        onClick={() => {
                                                            if (folder !== t.cwd) openFolder(t.cwd).then(() => switchCanvas(cv.id));
                                                            else switchCanvas(cv.id);
                                                        }}
                                                    >
                                                        <span
                                                            className="flex-1 truncate"
                                                            onDoubleClick={(e) => {
                                                                e.stopPropagation();
                                                                renameCanvasRow(t.cwd, cv);
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
                                                                deleteCanvasRow(t.cwd, cv.id);
                                                            }}
                                                        >
                                                            🗑
                                                        </button>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {cv.sessions.length}
                                                        </span>
                                                    </div>
                                                    {cv.sessions.map((sess: any) => (
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
                                                    <p className="px-2 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                                                        loose sessions ({t.loose.length})
                                                    </p>
                                                    {t.loose.map((sess: any) => (
                                                        <button
                                                            key={sess.file}
                                                            className="block w-full truncate rounded-md px-2 py-0.5 text-left text-[10px] text-muted-foreground hover:bg-secondary hover:text-card-foreground"
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
                            ))}
                        </Section>
                    </div>

                    {folder && (
                        <div className="border-t border-border px-1 pt-2 text-[10px] text-muted-foreground">
                            📁 {folder.split('/').pop()}
                        </div>
                    )}
                </>
            )}

            <FolderPicker
                open={pickerOpen}
                onClose={() => setPickerOpen(false)}
                onPick={newCanvasInPickedFolder}
            />
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
