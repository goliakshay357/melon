import * as RadixDialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';

/**
 * Promise-based dialogs (Radix UI) — work identically in browser & Electron.
 * Usage anywhere:
 *   const name = await askText({ title: 'Name your canvas', initial: 'Canvas 1' });
 *   const ok = await confirmAction({ title: 'Delete canvas?' });
 * Requires <DialogHost /> mounted once.
 */

type Request =
    | {
          kind: 'text';
          title: string;
          initial?: string;
          placeholder?: string;
          resolve: (v: string | null) => void;
      }
    | {
          kind: 'confirm';
          title: string;
          description?: string;
          confirmLabel?: string;
          resolve: (v: boolean) => void;
      };

let push: ((r: Request) => void) | null = null;

export function askText(opts: {
    title: string;
    initial?: string;
    placeholder?: string;
}): Promise<string | null> {
    return new Promise((resolve) => push?.({ kind: 'text', ...opts, resolve }));
}

export function confirmAction(opts: {
    title: string;
    description?: string;
    confirmLabel?: string;
}): Promise<boolean> {
    return new Promise((resolve) => push?.({ kind: 'confirm', ...opts, resolve }));
}

export function DialogHost() {
    const [req, setReq] = useState<Request | null>(null);
    const [value, setValue] = useState('');

    useEffect(() => {
        push = (r: Request) => {
            setValue(r.kind === 'text' ? (r.initial ?? '') : '');
            setReq(r);
        };
        return () => {
            push = null;
        };
    }, []);

    const close = (result: unknown) => {
        if (!req) return;
        if (req.kind === 'text') (req.resolve as (v: string | null) => void)(result as string | null);
        else (req.resolve as (v: boolean) => void)(result as boolean);
        setReq(null);
    };

    return (
        <RadixDialog.Root
            open={req !== null}
            onOpenChange={(o) => {
                if (!o) close(req?.kind === 'text' ? null : false);
            }}
        >
            <RadixDialog.Portal>
                <RadixDialog.Overlay className="fixed inset-0 z-[1000] bg-black/60" />
                <RadixDialog.Content
                    className="fixed left-1/2 top-1/2 z-[1001] w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card p-5 shadow-2xl focus:outline-none"
                    onKeyDown={(e) => e.stopPropagation()}
                >
                    <RadixDialog.Title className="text-sm font-semibold text-card-foreground">
                        {req?.title}
                    </RadixDialog.Title>
                    {req?.kind === 'confirm' && req.description && (
                        <RadixDialog.Description className="mt-2 text-xs leading-relaxed text-muted-foreground">
                            {req.description}
                        </RadixDialog.Description>
                    )}

                    {req?.kind === 'text' && (
                        <>
                            <input
                                autoFocus
                                value={value}
                                onChange={(e) => setValue(e.target.value)}
                                placeholder={req.placeholder}
                                className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') close(value.trim() || null);
                                }}
                            />
                            <div className="mt-4 flex justify-end gap-2">
                                <button
                                    className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                                    onClick={() => close(null)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                                    onClick={() => close(value.trim() || null)}
                                >
                                    Create
                                </button>
                            </div>
                        </>
                    )}

                    {req?.kind === 'confirm' && (
                        <div className="mt-4 flex justify-end gap-2">
                            <button
                                className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-secondary"
                                onClick={() => close(false)}
                            >
                                Cancel
                            </button>
                            <button
                                className="rounded-lg bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90"
                                onClick={() => close(true)}
                            >
                                {req.confirmLabel ?? 'Delete'}
                            </button>
                        </div>
                    )}
                </RadixDialog.Content>
            </RadixDialog.Portal>
        </RadixDialog.Root>
    );
}
