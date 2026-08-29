import { useEffect, useRef } from 'react';
import { BaseEdge, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/store/canvas-store';
import { useActiveTheme } from '@/theme/theme-store';

type Side = 'top' | 'bottom' | 'left' | 'right';
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/**
 * Which side a point is on, judged by its DIRECTION from the card center
 * (normalized by half-dims). Stable — no jitter near corners.
 */
function sideFromAngle(px: number, py: number, box: Box): Side {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const nx = (px - cx) / (box.w / 2);
    const ny = (py - cy) / (box.h / 2);
    return Math.abs(nx) > Math.abs(ny) ? (nx >= 0 ? 'right' : 'left') : ny >= 0 ? 'bottom' : 'top';
}

/** Point ON a card's side, following the pointer's projection along that side. */
function boundaryPoint(px: number, py: number, box: Box, side: Side) {
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    switch (side) {
        case 'top': return { x: clamp(px, box.x, box.x + box.w), y: box.y };
        case 'bottom': return { x: clamp(px, box.x, box.x + box.w), y: box.y + box.h };
        case 'left': return { x: box.x, y: clamp(py, box.y, box.y + box.h) };
        case 'right': return { x: box.x + box.w, y: clamp(py, box.y, box.y + box.h) };
    }
}

function midOf(box: Box, side: Side) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    switch (side) {
        case 'top': return { x: cx, y: box.y };
        case 'bottom': return { x: cx, y: box.y + box.h };
        case 'left': return { x: box.x, y: cy };
        case 'right': return { x: box.x + box.w, y: cy };
    }
}

/**
 * Mind-map edge. Default: smooth orthogonal path bottom→top.
 * Two endpoint dots (visible on hover): drag a dot around its card to
 * re-attach the arrow to any side. The dot follows your pointer along that
 * side live; on release it snaps to the side midpoint. Choice persists.
 */
export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const { screenToFlowPosition } = useReactFlow();
    const cards = useCanvasStore((s) => s.cards);
    const updateCard = useCanvasStore((s) => s.updateCard);
    const data = (props.data ?? {}) as { sourceSide?: Side; targetSide?: Side };

    const src = cards.find((c) => c.id === props.source);
    const tgt = cards.find((c) => c.id === props.target);
    const srcBox: Box | null = src
        ? { x: src.position.x, y: src.position.y, w: src.size?.width ?? 380, h: src.size?.height ?? 260 }
        : null;
    const tgtBox: Box | null = tgt
        ? { x: tgt.position.x, y: tgt.position.y, w: tgt.size?.width ?? 380, h: tgt.size?.height ?? 260 }
        : null;

    const sourceSide = data.sourceSide ?? 'bottom';
    const targetSide = data.targetSide ?? 'top';

    const dragPos = useRef<{ source?: { x: number; y: number }; target?: { x: number; y: number } }>({});
    const dragging = useRef<'source' | 'target' | null>(null);

    const sp = dragPos.current.source ?? (srcBox ? midOf(srcBox, sourceSide) : { x: props.sourceX, y: props.sourceY });
    const tp = dragPos.current.target ?? (tgtBox ? midOf(tgtBox, targetSide) : { x: props.targetX, y: props.targetY });

    const [path] = getSmoothStepPath({
        sourceX: sp.x,
        sourceY: sp.y,
        targetX: tp.x,
        targetY: tp.y,
        borderRadius: 10,
        offset: 24,
    });

    const onPointerDown = (e: React.PointerEvent, kind: 'source' | 'target') => {
        e.stopPropagation();
        dragging.current = kind;
        (e.target as Element).setPointerCapture(e.pointerId);
    };
    const onPointerMove = (e: React.PointerEvent) => {
        const kind = dragging.current;
        if (!kind) return;
        const box = kind === 'source' ? srcBox : tgtBox;
        if (!box || !tgt) return;
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const side = sideFromAngle(flow.x, flow.y, box);
        dragPos.current[kind] = boundaryPoint(flow.x, flow.y, box, side);
        const prev = tgt.edgeToParent ?? {};
        updateCard(tgt.id, {
            edgeToParent: kind === 'source' ? { ...prev, sourceSide: side } : { ...prev, targetSide: side },
        });
    };
    const onPointerUp = (e: React.PointerEvent) => {
        dragging.current = null;
        dragPos.current = {};
        try {
            (e.target as Element).releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
    };

    useEffect(
        () => () => {
            dragging.current = null;
            dragPos.current = {};
        },
        [],
    );

    const dot = (p: { x: number; y: number }, kind: 'source' | 'target') => (
        <circle
            className="melon-endpoint nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={7}
            fill={theme.tokens.purple}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(e) => onPointerDown(e, kind)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            <title>Drag to re-attach this end</title>
        </circle>
    );

    return (
        <>
            <defs>
                <marker
                    id="melon-arrowhead"
                    viewBox="0 0 10 10"
                    refX="7.5"
                    refY="5"
                    markerWidth="4.5"
                    markerHeight="4.5"
                    orient="auto-start-reverse"
                >
                    <path d="M 1 1.5 L 9 5 L 1 8.5 z" fill={theme.tokens.purple} />
                </marker>
            </defs>
            <BaseEdge
                path={path}
                markerEnd="url(#melon-arrowhead)"
                style={{ stroke: `${theme.tokens.purple}99`, strokeWidth: 2 }}
            />
            {dot(sp, 'source')}
            {dot(tp, 'target')}
        </>
    );
}
