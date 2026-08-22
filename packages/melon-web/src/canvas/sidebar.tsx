import { useEffect, useState } from 'react';
import { FolderOpen, History } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

interface SessionInfo {
    id: string;
    file: string;
    firstMessage?: string;
    modified?: string;
}
interface Project {
    cwd: string;
    sessions: SessionInfo[];
}

const MELON_API = 'http://127.0.0.1:8788';

export function Sidebar() {
    const [projects, setProjects] = useState<Project[]>([]);
    const [openProject, setOpenProject] = useState<string | null>(null);
    const resumeSession = useCanvasStore((s) => s.resumeSession);

    useEffect(() => {
        fetch(`${MELON_API}/projects`)
            .then((r) => r.json())
            .then((d) => setProjects(d.projects ?? []))
            .catch(() => {});
    }, []);

    return (
        <div className="absolute left-3 top-3 z-10 max-h-[70vh] w-72 overflow-y-auto rounded-xl border border-border bg-card/95 p-2 shadow-sm backdrop-blur">
            <div className="flex items-center gap-1.5 px-1 pb-2 text-xs font-semibold text-muted-foreground">
                <History className="size-3.5" /> Sessions
            </div>
            {projects.length === 0 && (
                <p className="px-1 py-2 text-xs text-muted-foreground">No past sessions found.</p>
            )}
            {projects.map((p) => (
                <div key={p.cwd} className="mb-1">
                    <button
                        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs text-card-foreground hover:bg-secondary"
                        onClick={() =>
                            setOpenProject(openProject === p.cwd ? null : p.cwd)
                        }
                    >
                        <FolderOpen className="size-3.5 shrink-0 text-primary" />
                        <span className="truncate">{p.cwd.split('/').slice(-2).join('/')}</span>
                        <span className="ml-auto text-[10px] text-muted-foreground">
                            {p.sessions.length}
                        </span>
                    </button>
                    {openProject === p.cwd &&
                        p.sessions.map((s) => (
                            <button
                                key={s.id}
                                className={cn(
                                    'block w-full truncate rounded-md py-1 pl-6 pr-2 text-left text-[11px] text-muted-foreground hover:bg-secondary hover:text-card-foreground',
                                )}
                                title={s.firstMessage}
                                onClick={() => resumeSession(s.file)}
                            >
                                {s.firstMessage || s.id.slice(0, 8)}
                            </button>
                        ))}
                </div>
            ))}
        </div>
    );
}
