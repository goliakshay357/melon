import { type ReactNode } from 'react';
import { Handle, Position } from '@xyflow/react';
import { cn } from '@/lib/utils';

/**
 * Collapsed card chip: just the title (+ anything the caller wants on the
 * left, e.g. the chat status dot) and a restore button. Double-click the
 * strip restores too. The strip itself stays draggable — only the button
 * is nodrag.
 *
 * The invisible React Flow Handles here are REQUIRED: edge endpoints are
 * computed from a node's handleBounds (getEdgePosition), and a node with no
 * <Handle> yields null positions → React Flow drops the edge entirely.
 * Without them, fork/merge lines vanish when a card is minimized.
 */
export function MinimizedCardBar({
    title,
    leading,
    selected,
    onMaximize,
    hint,
}: {
    title: string;
    leading?: ReactNode;
    selected?: boolean;
    onMaximize: () => void;
    hint?: string;
}) {
    return (
        <>
            <div
                className={cn(
                    'flex h-full w-full cursor-pointer items-center gap-2 rounded-xl border bg-card px-3 shadow-sm transition-shadow',
                    selected ? 'border-ring shadow-md ring-2 ring-ring/30' : 'border-border',
                )}
                title={hint ?? title}
                onDoubleClick={(e) => {
                    e.stopPropagation();
                    onMaximize();
                }}
            >
                {leading}
                <span className="min-w-0 flex-1 truncate text-sm font-medium tracking-tight text-card-foreground">
                    {title}
                </span>
                <button
                    type="button"
                    className="nodrag shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-primary"
                    onClick={(e) => {
                        e.stopPropagation();
                        onMaximize();
                    }}
                    title="Restore card (double-click the strip too)"
                    aria-label="Restore card"
                >
                    <MaximizeIcon />
                </button>
            </div>
            <Handle type="source" position={Position.Top} className="!opacity-0" />
            <Handle type="source" position={Position.Bottom} className="!opacity-0" />
            <Handle type="source" position={Position.Left} className="!opacity-0" />
            <Handle type="source" position={Position.Right} className="!opacity-0" />
            <Handle type="target" position={Position.Top} className="!opacity-0" />
            <Handle type="target" position={Position.Bottom} className="!opacity-0" />
            <Handle type="target" position={Position.Left} className="!opacity-0" />
            <Handle type="target" position={Position.Right} className="!opacity-0" />
        </>
    );
}

function MaximizeIcon() {
    return (
        <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 6V2h4M14 10v4h-4" strokeLinecap="round" />
            <rect x="2" y="2" width="12" height="12" rx="2" opacity="0.35" />
        </svg>
    );
}