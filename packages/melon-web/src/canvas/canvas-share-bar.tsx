import { useState } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { useCanvasStore } from '@/store/canvas-store';

type ShareStatus = {
    summary: string;
    canShare: boolean;
    files?: Array<{ path: string; change: string }>;
    prUrl?: string;
    blockedReason?: string;
    mode?: string;
};

/**
 * Worktree mode + share action for the bottom canvas bubble.
 * Kept out of the top chrome so explore/home stays clean.
 */
export function CanvasShareControls() {
    const canvasId = useCanvasStore((s) => s.canvasId);
    const canvasName = useCanvasStore((s) => s.canvasName);
    const folder = useCanvasStore((s) => s.folder);
    const worktreeMode = useCanvasStore((s) => s.worktreeMode);
    const cardCount = useCanvasStore((s) => s.cards.length);
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<ShareStatus | null>(null);
    const [note, setNote] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<string | null>(null);
    const [confirmed, setConfirmed] = useState(false);

    if (!canvasId || cardCount === 0) return null;

    const isolated = worktreeMode === 'isolated';

    const loadStatus = async () => {
        if (!folder || !canvasId) return;
        setResult(null);
        setConfirmed(false);
        const res = await fetch(`/canvases/${canvasId}/share-status?cwd=${encodeURIComponent(folder)}`);
        if (!res.ok) {
            setStatus({ summary: 'Could not check this canvas copy.', canShare: false });
            return;
        }
        setStatus((await res.json()) as ShareStatus);
    };

    const send = async () => {
        if (!folder || !canvasId || !confirmed || busy) return;
        setBusy(true);
        try {
            const res = await fetch(`/canvases/${canvasId}/share`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    cwd: folder,
                    confirm: true,
                    title: canvasName || 'Updates from Melon',
                    note,
                }),
            });
            const body = (await res.json()) as { summary?: string; error?: string; prUrl?: string };
            setResult(body.summary || body.error || (res.ok ? 'Sent.' : 'Could not send.'));
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <div className="mx-1 h-5 w-px bg-border" />
            <span
                className={
                    isolated
                        ? 'rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary'
                        : 'rounded-md bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground'
                }
                title={
                    isolated
                        ? 'All chats on this canvas share one private copy'
                        : 'Chats edit the original project folder'
                }
            >
                {isolated ? 'Worktree' : 'This project'}
            </span>
            {isolated && (
                <button
                    type="button"
                    className="rounded-md bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                    onClick={() => {
                        setOpen(true);
                        void loadStatus();
                    }}
                >
                    Send for review
                </button>
            )}

            <RadixDialog.Root open={open} onOpenChange={setOpen}>
                <RadixDialog.Portal>
                    <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
                    <RadixDialog.Content className="fixed left-1/2 top-1/2 z-[1001] w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none">
                        <RadixDialog.Title className="text-sm font-semibold text-card-foreground">
                            Send this canvas for review
                        </RadixDialog.Title>
                        <RadixDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            This saves everything in this canvas copy and sends it as a review request. The original
                            project stays as it is until someone accepts the review.
                        </RadixDialog.Description>

                        <p className="mt-3 text-xs text-card-foreground">{status?.summary ?? 'Checking…'}</p>
                        {status?.files && status.files.length > 0 && (
                            <ul className="mt-2 max-h-32 overflow-auto rounded-md border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
                                {status.files.slice(0, 40).map((f) => (
                                    <li key={f.path}>
                                        {f.change === 'added' ? 'Added' : f.change === 'removed' ? 'Removed' : 'Changed'}{' '}
                                        {f.path}
                                    </li>
                                ))}
                            </ul>
                        )}
                        {status?.prUrl && (
                            <a
                                className="mt-2 block text-[11px] text-primary underline"
                                href={status.prUrl}
                                target="_blank"
                                rel="noreferrer"
                            >
                                Open existing review
                            </a>
                        )}

                        <textarea
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="Optional note for reviewers"
                            className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-ring"
                            rows={3}
                        />

                        <label className="mt-3 flex items-start gap-2 text-xs text-card-foreground">
                            <input
                                type="checkbox"
                                checked={confirmed}
                                onChange={(e) => setConfirmed(e.target.checked)}
                                className="mt-0.5"
                            />
                            I want to save this canvas copy and send it for review.
                        </label>

                        {result && <p className="mt-2 text-xs text-muted-foreground">{result}</p>}

                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                type="button"
                                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                                onClick={() => setOpen(false)}
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                disabled={!status?.canShare || !confirmed || busy}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
                                onClick={() => void send()}
                            >
                                {busy ? 'Sending…' : 'Send'}
                            </button>
                        </div>
                    </RadixDialog.Content>
                </RadixDialog.Portal>
            </RadixDialog.Root>
        </>
    );
}
