import { useEffect, useState } from 'react';
import {
    ChevronRight,
    FolderOpen,
    Layers,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
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

const MELON_API = 'http://127.0.0.1:8788';

export function Sidebar() {
    const [collapsed, setCollapsed] = useState(false);
    const [projects, setProjects] = useState<Project[]>([]);
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [newWsName, setNewWsName] = useState('');

    const folder = useCanvasStore((s) => s.folder);
    const workspaces = useCanvasStore((s) => s.workspaces);
    const workspaceId = useCanvasStore((s) => s.workspaceId);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const switchWorkspace = useCanvasStore((s) => s.switchWorkspace);
    const createWorkspace = useCanvasStore((s) => s.createWorkspace);
    const resumeSession = useCanvasStore((s) => s.resumeSession);

    useEffect(() => {
        fetch(`${MELON_API}/projects`)
            .then((r) => r.json())
            .then((d) => setProjects(d.projects ?? []))
            .catch(() => {});
    }, []);

    const toggleFolder = (cwd: string) =>
        setOpenFolders((prev) => {
            const next = new Set(prev);
            next.has(cwd) ? next.delete(cwd) : next.add(cwd);
            return next;
        });

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
                        <span className="text-xs font-semibold text-muted-foreground">
                            Navigator
                        </span>
                        <button
                            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
                            onClick={() => setCollapsed(true)}
                            title="Collapse"
                        >
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto">
                        {/* Workspaces in current folder */}
                        <Section title="Workspaces" icon={<Layers className="size-3.5" />}>
                            {folder &&
                                workspaces.map((ws) => (
                                    <button
                                        key={ws.id}
                                        className={cn(
                                            'block w-full truncate rounded-md px-2 py-1 text-left text-xs hover:bg-secondary',
                                            ws.id === workspaceId
                                                ? 'bg-secondary font-medium text-primary'
                                                : 'text-card-foreground',
                                        )}
                                        onClick={() => switchWorkspace(ws.id)}
                                    >
                                        {ws.name}
                                    </button>
                                ))}
                            {folder && (
                                <form
                                    className="mt-1 flex gap-1 px-1"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (newWsName.trim()) {
                                            createWorkspace(newWsName.trim());
                                            setNewWsName('');
                                        }
                                    }}
                                >
                                    <input
                                        value={newWsName}
                                        onChange={(e) => setNewWsName(e.target.value)}
                                        placeholder="New workspace…"
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
                                    Pick a folder below to begin.
                                </p>
                            )}
                        </Section>

                        {/* Folders → their past sessions */}
                        <Section title="Folders & sessions" icon={<FolderOpen className="size-3.5" />}>
                            {projects.map((p) => (
                                <div key={p.cwd} className="mb-0.5">
                                    <button
                                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-xs text-card-foreground hover:bg-secondary"
                                        onClick={() => {
                                            toggleFolder(p.cwd);
                                            if (!openFolders.has(p.cwd) && !folder) openFolder(p.cwd);
                                        }}
                                    >
                                        <ChevronRight
                                            className={cn(
                                                'size-3 shrink-0 transition-transform',
                                                openFolders.has(p.cwd) && 'rotate-90',
                                            )}
                                        />
                                        <span className="truncate">
                                            {p.cwd.split('/').slice(-2).join('/')}
                                        </span>
                                        <span className="ml-auto text-[10px] text-muted-foreground">
                                            {p.sessions.length}
                                        </span>
                                    </button>
                                    {openFolders.has(p.cwd) && (
                                        <div className="ml-4 border-l border-border pl-1">
                                            {p.sessions.map((s) => (
                                                <button
                                                    key={s.id}
                                                    className="block w-full truncate rounded-md px-2 py-0.5 text-left text-[11px] text-muted-foreground hover:bg-secondary hover:text-card-foreground"
                                                    title={s.firstMessage}
                                                    onClick={() => resumeSession(s.file)}
                                                >
                                                    {s.firstMessage || s.id.slice(0, 8)}
                                                </button>
                                            ))}
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
