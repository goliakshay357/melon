import { memo as ReactMemo, useState } from 'react';
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

    if (!card) return null;

    const updateDoc = (md: string) => {
        useCanvasStore.getState().updateCard(id, { documentContent: md });
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
                    className="nodrag min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-medium text-card-foreground outline-none"
                    onBlur={(e) => {
                        setEditingTitle(false);
                        const t = e.target.value.trim();
                        if (t && t !== card.title) useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
                    }}
                    onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                            const t = (e.target as HTMLInputElement).value.trim();
                            setEditingTitle(false);
                            if (t && t !== card.title) useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
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
                onResizeEnd={(_e, params) => useCanvasStore.getState().resizeCard(id, params.width, params.height)}
            />
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
            {header}
            <div className="nodrag min-h-0 flex-1">
                <DocumentEditor content={card.documentContent ?? ''} onChange={updateDoc} />
            </div>
        </div>
    );
}

export const DocumentCardNode = ReactMemo(DocumentCardNodeInner);
