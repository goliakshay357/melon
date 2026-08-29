import { useEffect, useRef } from 'react';
import { BaseEdge, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/store/canvas-store';
import { useActiveTheme } from '@/theme/theme-store';

type Side = 'top' | 'bottom' | 'left' | 'right';
interface ForkData {
    sourceSide?: Side;
    targetSide?: Side;
}
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function pointOn(box: Box, side: Side) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    switch (side) {
        case 'top': return { x: cx, y: box.y };
        case 'bottom': return { x: cx, y: box.y + box.h };
        case 'left': return { x: box.x, y: cy };
        case 'right': return { x: box.x + box.w, y: cy };
    }
}

/** Which side of a card a point is nearest to. */
function nearestSide(px: number, py: number, box: Box): Side {
    const cx = Math.min(Math.max(px, box.x), box.x + box.w);
    const cy = Math.min(Math.max(py, box.y), box.y + box.h);
    const d: Record<Side, number> = {
        left: Math.abs(cx - box.x),
        right: Math.abs(cx - (box.x + box.w)),
        top: Math.abs(cy - box.y),
        bottom: Math.abs(cy - (box.y + box.h)),
    };
    return (Object.keys(d) as Side[]).sort((a, b) => d[a] - d[b])[0];
}

/**
 * Mind-map edge: smooth orthogonal path, default bottom→top, with TWO
 * draggable endpoint handles — drag a circle to re-attach the arrow to any
 * side of its card. Choice persists via the target card's edgeToParent.
 */
export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const { screenToFlowPosition } = useReactFlow();
    const cards = useCanvasStore((s) => s.cards);
    const updateCard = useCanvasStore((s) => s.updateCard);
    const data = (props.data ?? {}) as ForkData;
    const sourceSide = data.sourceSide ?? 'bottom';
    const targetSide = data.targetSide ?? 'top';

    const src = cards.find((c) => c.id === props.source);
    const tgt = cards.find((c) => c.id === props.target);
    const srcBox: Box | null = src
        ? { x: src.position.x, y: src.position.y, w: src.size?.width ?? 380, h: src.size?.height ?? 260 }
        : null;
    const tgtBox: Box | null = tgt
        ? { x: tgt.position.x, y: tgt.position.y, w: tgt.size?.width ?? 380, h: tgt.size?.height ?? 260 }
        : null;

    const sp = srcBox ? pointOn(srcBox, sourceSide) : { x: props.sourceX, y: props.sourceY };
    const tp = tgtBox ? pointOn(tgtBox, targetSide) : { x: props.targetX, y: props.targetY };

    const [path] = getSmoothStepPath({
        sourceX: sp.x,
        sourceY: sp.y,
        targetX: tp.x,
        targetY: tp.y,
        borderRadius: 10,
        offset: 24,
    });

    const dragRef = useRef<{ kind: 'source' | 'target' } | null>(null);

    const startDrag = (e: React.PointerEvent, kind: 'source' | 'target') => {
        e.stopPropagation();
        dragRef.current = { kind };
        (e.target as Element).setPointerCapture(e.pointerId);
    };
    const onDrag = (e: React.PointerEvent) => {
        const d = dragRef.current;
        if (!d) return;
        const box = d.kind === 'source' ? srcBox : tgtBox;
        if (!box || !tgt) return;
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const side = nearestSide(flow.x, flow.y, box);
        const prev = tgt.edgeToParent ?? {};
        updateCard(tgt.id, {
            edgeToParent:
                d.kind === 'source' ? { ...prev, sourceSide: side } : { ...prev, targetSide: side },
        });
    };
    const endDrag = (e: React.PointerEvent) => {
        dragRef.current = null;
        try {
            (e.target as Element).releasePointerCapture(e.pointerId);
        } catch {
            /* ignore */
        }
    };

    // Cleanup a stuck drag if the component unmounts mid-drag.
    useEffect(() => {
        return () => {
            dragRef.current = null;
        };
    }, []);

    const dot = (p: { x: number; y: number }, kind: 'source' | 'target') => (
        <circle
            cx={p.x}
            cy={p.y}
            r={9}
            fill={theme.tokens.purple}
            fillOpacity={0.9}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none' }}
            onPointerDown={(e) => startDrag(e, kind)}
            onPointerMove={onDrag}
            onPointerUp={endDrag}
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
