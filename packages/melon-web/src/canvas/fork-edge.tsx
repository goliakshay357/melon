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

function sideFromAngle(px: number, py: number, box: Box): Side {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const nx = (px - cx) / (box.w / 2);
    const ny = (py - cy) / (box.h / 2);
    return Math.abs(nx) > Math.abs(ny) ? (nx >= 0 ? 'right' : 'left') : ny >= 0 ? 'bottom' : 'top';
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
 * Mind-map edge — default smooth orthogonal path bottom→top with ONE arrowhead
 * at the target end. BOTH ends have a draggable dot: grab either dot and move
 * it around its card to re-attach that end to any side. Dragging is handled on
 * the WINDOW (not SVG capture) so it works reliably in both directions.
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

    const dragging = useRef<'source' | 'target' | null>(null);

    const sp = srcBox ? midOf(srcBox, sourceSide) : { x: props.sourceX, y: props.sourceY };
    const tp = tgtBox ? midOf(tgtBox, targetSide) : { x: props.targetX, y: props.targetY };

    const [path] = getSmoothStepPath({
        sourceX: sp.x,
        sourceY: sp.y,
        targetX: tp.x,
        targetY: tp.y,
        borderRadius: 10,
        offset: 24,
    });

    // Window-level drag so BOTH endpoints behave identically (no SVG capture quirks).
    useEffect(() => {
        if (!dragging.current) return;
        const onMove = (e: PointerEvent) => {
            const kind = dragging.current;
            if (!kind) return;
            const box = kind === 'source' ? srcBox : tgtBox;
            if (!box || !tgt) return;
            const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const side = sideFromAngle(flow.x, flow.y, box);
            const prev = tgt.edgeToParent ?? {};
            updateCard(tgt.id, {
                edgeToParent:
                    kind === 'source' ? { ...prev, sourceSide: side } : { ...prev, targetSide: side },
            });
        };
        const onUp = () => {
            dragging.current = null;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging, srcBox, tgtBox, tgt, updateCard, screenToFlowPosition]);

    const startDrag = (e: React.PointerEvent, kind: 'source' | 'target') => {
        e.stopPropagation();
        dragging.current = kind;
    };

    const dot = (p: { x: number; y: number }, kind: 'source' | 'target') => (
        <circle
            className="melon-endpoint nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={9}
            fill={theme.tokens.purple}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, kind)}
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
                    orient="auto"
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
