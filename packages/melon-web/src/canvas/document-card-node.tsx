import { memo as ReactMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Node, NodeProps, Position, NodeResizer } from '@xyflow/react';
import { Plus, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { DocumentEditor } from '@/components/document-editor';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';

export type DocumentCardNodeType = Node<{ cardId: string }, 'documentCard'>;

function DocumentCardNodeInner({ id, selected }: NodeProps<DocumentCardNodeType>) {
    const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
    const [editingTitle, setEditingTitle] = useState(false);
    // Seed once per mount so store documentContent updates don't remount Milkdown
    // (which would wipe Mod-Z history on every keystroke).
    const seedRef = useRef<string | null>(null);
    if (card && seedRef.current === null) seedRef.current = card.documentContent ?? '';

    // File-backed manuals: adopt disk state on mount (external editors, second
    // window) — a changed file bumps documentVersion, remounting the editor.
    useEffect(() => {
        if (!card?.documentFile) return;
        let alive = true;
        void (async () => {
            try {
                const read = async (root: string) => {
                    const r = await fetch(
                        `/file?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(card.documentFile as string)}`,
                    );
                    return r.ok ? ((await r.json()) as { content: string; mtimeMs?: number }) : null;
                };
                const roots = [card.documentCwd, useCanvasStore.getState().folder ?? ''].filter(Boolean) as string[];
                let d: { content: string; mtimeMs?: number } | null = null;
                for (const root of roots) {
                    d = await read(root);
                    if (d) {
                        if (root !== card.documentCwd) {
                            useCanvasStore.getState().updateCard(id, { documentCwd: root });
                        }
                        break;
                    }
                }
                if (!alive || !d) return;
                if (d.mtimeMs !== undefined && d.mtimeMs === card.documentMtimeMs) return;
                useCanvasStore.getState().updateCard(id, {
                    documentContent: d.content,
                    documentMtimeMs: d.mtimeMs,
                    documentVersion: (card.documentVersion ?? 0) + 1,
                });
            } catch {
                /* keep local copy */
            }
        })();
        return () => {
            alive = false;
        };
        // Mount-only: the store owns state afterwards.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const onMarkdownUpdate = useCallback(
        (md: string) => useCanvasStore.getState().setDocumentBody(id, md),
        [id],
    );

    if (!card) return null;

    // Rename: card title follows the user — and for file-backed manuals the
    // FILE follows too (slug filename + leading H1 rewritten server-side).
    const commitTitle = (raw: string) => {
        const t = raw.trim();
        if (!t || t === card.title) return;
        if (!card.documentFile) {
            useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
            return;
        }
        void (async () => {
            try {
                const renameIn = (root: string) =>
                    fetch("/notes/manual/rename", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ cwd: root, path: card.documentFile, title: t }),
                    });
                let res = await renameIn(card.documentCwd ?? useCanvasStore.getState().folder ?? "");
                if (res.status === 404 && card.documentCwd && card.documentCwd !== useCanvasStore.getState().folder) {
                    res = await renameIn(useCanvasStore.getState().folder ?? "");
                }
                if (!res.ok) {
                    useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
                    return;
                }
                const d = (await res.json()) as { relPath: string; content: string; mtimeMs: number };
                useCanvasStore.getState().updateCard(id, {
                    title: t.slice(0, 44),
                    documentFile: d.relPath,
                    documentContent: d.content,
                    documentMtimeMs: d.mtimeMs,
                    documentCwd: card.documentCwd ?? useCanvasStore.getState().folder ?? undefined,
                    documentVersion: (card.documentVersion ?? 0) + 1,
                });
            } catch {
                useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
            }
        })();
    };

    // Branch a linked card from this document → the mind-map arrow starts here.
    const addLinkedCard = () => {
        useCanvasStore.getState().addLinkedCard(id);
    };

    const header = (
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
            {editingTitle ? (
                <input
                    autoFocus
                    defaultValue={card.title}
                    title={card.documentFile ? `File name — renaming this renames ${card.documentFile}` : 'Card name'}
                    className="nodrag min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-medium text-card-foreground outline-none"
                    onBlur={(e) => {
                        setEditingTitle(false);
                        void commitTitle(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            const t = (e.target as HTMLInputElement).value;
                            setEditingTitle(false);
                            void commitTitle(t);
                        } else if (e.key === 'Escape') setEditingTitle(false);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                />
            ) : (
                <span
                    className="min-w-0 flex-1 cursor-text truncate text-sm font-medium text-card-foreground"
                    title="Double-click to rename"
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingTitle(true);
                    }}
                >
                    📄 {card.title}
                </span>
            )}
            <button
                className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
                onClick={(e) => {
                    e.stopPropagation();
                    addLinkedCard();
                }}
                title="Branch a new card from here (mind map)"
            >
                <Plus className="size-4" />
            </button>
            <button
                className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
                title="Delete document"
                onClick={async () => {
                    const ok = await confirmAction({ title: 'Delete this document?' });
                    if (ok) useCanvasStore.getState().deleteCards([id]);
                }}
            >
                <X className="size-4" />
            </button>
        </div>
    );

    return (
        <div
            className={cn(
                'flex h-full w-full flex-col rounded-xl border bg-card shadow-sm transition-shadow',
                selected ? 'border-ring shadow-md ring-2 ring-ring/30' : 'border-border',
            )}
        >
            <NodeResizer
                isVisible={selected}
                minWidth={320}
                minHeight={220}
                lineClassName="!border-primary/50"
                handleClassName="!h-2 !w-2 !rounded-sm !border-primary/60 !bg-white"
                onResizeStart={() => useCanvasStore.getState().beginCardGesture()}
                onResizeEnd={(_e, params) => useCanvasStore.getState().resizeCard(id, params.width, params.height)}
            />
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} className="!opacity-0" />
            <Handle type="target" position={Position.Left} className="!opacity-0" />
            <Handle type="target" position={Position.Right} className="!opacity-0" />
            <Handle type="source" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
            <Handle type="source" position={Position.Left} className="!opacity-0" />
            <Handle type="source" position={Position.Right} className="!opacity-0" />
            {header}
            <div
                className="nodrag min-h-0 flex-1"
                onBlur={(e) => {
                    // Focus left the document — flush pending edits to disk.
                    if (!e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) {
                        void useCanvasStore.getState().flushManualSave(id);
                    }
                }}
            >
                <DocumentEditor
                    key={`${card.documentFile ?? 'canvas'}:${card.documentVersion ?? 0}`}
                    cardId={id}
                    initialContent={seedRef.current ?? ''}
                    onMarkdownUpdate={card.documentFile ? onMarkdownUpdate : undefined}
                />
            </div>
        </div>
    );
}

export const DocumentCardNode = ReactMemo(DocumentCardNodeInner);
