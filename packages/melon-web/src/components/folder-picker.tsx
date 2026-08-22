import { useCallback, useEffect, useState } from 'react';
import { ArrowUp, Check, Folder } from 'lucide-react';

const MELON_API = 'http://127.0.0.1:8788';

interface BrowseResult {
    path: string;
    parent: string;
    dirs: string[];
}

export function FolderPicker({
    open,
    onClose,
    onPick,
}: {
    open: boolean;
    onClose: () => void;
    onPick: (path: string) => void;
}) {
    const [current, setCurrent] = useState<string>('~');
    const [data, setData] = useState<BrowseResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [manual, setManual] = useState('');

    const browse = useCallback((path: string) => {
        fetch(`${MELON_API}/browse?path=${encodeURIComponent(path)}`)
            .then(async (r) => {
                if (!r.ok) throw new Error((await r.json()).error ?? r.status);
                return r.json();
            })
            .then((d: BrowseResult) => {
                setData(d);
                setCurrent(d.path);
                setError(null);
            })
            .catch((e) => setError(e.message));
    }, []);

    useEffect(() => {
        if (open) browse('~');
    }, [open, browse]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
            onClick={onClose}
        >
            <div
                className="flex h-[480px] w-[560px] flex-col rounded-xl border border-border bg-card shadow-xl"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-border px-4 py-3">
                    <h2 className="text-sm font-semibold text-card-foreground">Choose a folder</h2>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{data?.path ?? current}</p>
                </div>

                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                    <button
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary"
                        title="Up one level"
                        onClick={() => browse(data?.parent ?? '~')}
                    >
                        <ArrowUp className="size-4" />
                    </button>
                    <input
                        value={manual}
                        onChange={(e) => setManual(e.target.value)}
                        placeholder="/absolute/path or ~/path — press Enter"
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs outline-none focus:border-ring"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && manual.trim()) browse(manual.trim());
                        }}
                    />
                </div>

                <div className="flex-1 overflow-y-auto px-2 py-1">
                    {error && <p className="px-2 py-2 text-xs text-red-500">{error}</p>}
                    {!error && data?.dirs.length === 0 && (
                        <p className="px-2 py-2 text-xs text-muted-foreground">No subfolders.</p>
                    )}
                    {data?.dirs.map((d) => (
                        <button
                            key={d}
                            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-card-foreground hover:bg-secondary"
                            onDoubleClick={() => browse(`${data.path}/${d}`)}
                            onClick={() => browse(`${data.path}/${d}`)}
                        >
                            <Folder className="size-3.5 text-muted-foreground" />
                            {d}
                        </button>
                    ))}
                </div>

                <div className="flex items-center justify-between border-t border-border px-3 py-2">
                    <span className="truncate text-[10px] text-muted-foreground">
                        Selects the folder you're currently inside.
                    </span>
                    <button
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                        disabled={!data}
                        onClick={() => {
                            if (data) {
                                onPick(data.path);
                                onClose();
                            }
                        }}
                    >
                        <Check className="size-3.5" /> Use this folder
                    </button>
                </div>
            </div>
        </div>
    );
}
