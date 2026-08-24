import { useState } from 'react';
import { Layers } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';

/** Top navbar: shows the canvas you're in. Double-click the name to rename. */
export function TopBar() {
    const canvasName = useCanvasStore((s) => s.canvasName);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const folder = useCanvasStore((s) => s.folder);
    const serverOffline = useCanvasStore((s) => s.serverOffline);
    const [renaming, setRenaming] = useState(false);
    const [draft, setDraft] = useState('');

    if (!canvasId) return null;

    const commitRename = () => {
        const name = draft.trim();
        setRenaming(false);
        if (!name || !folder || !canvasId || name === canvasName) return;
        useCanvasStore.getState().renameCanvas(folder, canvasId, name);
    };

    return (
        <div className="absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-xl border border-border bg-card/95 px-4 py-2 shadow-sm backdrop-blur">
            <Layers className="size-4 text-primary" />
            {renaming ? (
                <input
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') commitRename();
                        if (e.key === 'Escape') setRenaming(false);
                    }}
                    className="w-48 rounded-md border border-input bg-background px-2 py-0.5 text-sm outline-none focus:border-ring"
                />
            ) : (
                <span
                    className="cursor-text text-sm font-medium text-card-foreground"
                    title="Double-click to rename this canvas"
                    onDoubleClick={() => {
                        setDraft(canvasName);
                        setRenaming(true);
                    }}
                >
                    {canvasName || 'Untitled'}
                </span>
            )}
            {serverOffline && (
                <span className="animate-pulse rounded-md bg-[#ff5555]/15 px-2 py-0.5 text-[10px] font-medium text-[#ff5555]">
                  ⚠ reconnecting to server…
                </span>
            )}
            {folder && (
                <>
                    <span className="text-border">|</span>
                    <span className="text-[11px] text-muted-foreground" title={folder}>
                        📁 {folder.split('/').pop()}
                    </span>
                </>
            )}
        </div>
    );
}
