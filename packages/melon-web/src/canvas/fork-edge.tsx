import { useEffect, useRef, useState } from 'react';
import { BaseEdge, getBezierPath, Position, useReactFlow, type EdgeProps } from '@xyflow/react';
import { useCanvasStore } from '@/store/canvas-store';
import { useActiveTheme } from '@/theme/theme-store';

type Side = 'top' | 'bottom' | 'left' | 'right';
interface Pt {
    x: number;
    y: number;
}
interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

function pointAlong(box: Box, side: Side, t: number): Pt {
    const c = Math.min(Math.max(t, 0), 1);
    switch (side) {
        case 'top': return { x: box.x + box.w * c, y: box.y };
        case 'bottom': return { x: box.x + box.w * c, y: box.y + box.h };
        case 'left': return { x: box.x, y: box.y + box.h * c };
        case 'right': return { x: box.x + box.w, y: box.y + box.h * c };
    }
}

function sideAndT(px: number, py: number, box: Box): { side: Side; t: number } {
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    const d = {
        top: Math.abs(py - box.y),
        bottom: Math.abs(py - (box.y + box.h)),
        left: Math.abs(px - box.x),
        right: Math.abs(px - (box.x + box.w)),
    };
    const side = (Object.keys(d) as Side[]).sort((a, b) => d[a] - d[b])[0];
    switch (side) {
        case 'top': return { side, t: clamp((px - box.x) / box.w, 0, 1) };
        case 'bottom': return { side, t: clamp((px - box.x) / box.w, 0, 1) };
        case 'left': return { side, t: clamp((py - box.y) / box.h, 0, 1) };
        case 'right': return { side, t: clamp((py - box.y) / box.h, 0, 1) };
    }
}

/**
 * Curved (bezier) mind-map edge. Smooth S-curve, single arrowhead at the
 * target. Endpoints slide continuously along the card perimeter (real-time,
 * pointer-captured); drag commits on release.
 */
export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const { screenToFlowPosition } = useReactFlow();
    const cards = useCanvasStore((s) => s.cards);
    const updateCard = useCanvasStore((s) => s.updateCard);
    const data = (props.data ?? {}) as {
        sourceSide?: Side;
        sourceT?: number;
        targetSide?: Side;
        targetT?: number;
    };

    const src = cards.find((c) => c.id === props.source);
    const tgt = cards.find((c) => c.id === props.target);
    const srcBox: Box | null = src
        ? { x: src.position.x, y: src.position.y, w: src.size?.width ?? 380, h: src.size?.height ?? 260 }
        : null;
    const tgtBox: Box | null = tgt
        ? { x: tgt.position.x, y: tgt.position.y, w: tgt.size?.width ?? 380, h: tgt.size?.height ?? 260 }
        : null;

    // AUTO sides: derive the natural connection sides from the cards'
    // relative positions, re-evaluated live as cards move. A manual drag
    // (persisted sourceSide/targetSide) overrides the auto value.
    const autoSides = (() => {
        if (!srcBox || !tgtBox) return { sourceSide: 'bottom' as Side, targetSide: 'top' as Side };
        const srcCx = srcBox.x + srcBox.w / 2;
        const srcCy = srcBox.y + srcBox.h / 2;
        const tgtCx = tgtBox.x + tgtBox.w / 2;
        const tgtCy = tgtBox.y + tgtBox.h / 2;
        const dx = tgtCx - srcCx;
        const dy = tgtCy - srcCy;
        if (Math.abs(dx) > Math.abs(dy)) {
            return dx >= 0
                ? { sourceSide: 'right' as Side, targetSide: 'left' as Side }
                : { sourceSide: 'left' as Side, targetSide: 'right' as Side };
        }
        return dy >= 0
            ? { sourceSide: 'bottom' as Side, targetSide: 'top' as Side }
            : { sourceSide: 'top' as Side, targetSide: 'bottom' as Side };
    })();

    const sourceSide = data.sourceSide ?? autoSides.sourceSide;
    const sourceT = data.sourceT ?? 0.5;
    const targetSide = data.targetSide ?? autoSides.targetSide;
    const targetT = data.targetT ?? 0.5;

    const sp = srcBox ? pointAlong(srcBox, sourceSide, sourceT) : { x: props.sourceX, y: props.sourceY };
    const tp = tgtBox ? pointAlong(tgtBox, targetSide, targetT) : { x: props.targetX, y: props.targetY };

    const [live, setLive] = useState<{ sp?: Pt; tp?: Pt }>({});
    const dragging = useRef<'source' | 'target' | null>(null);
    const pending = useRef<{ sourceSide: Side; sourceT: number; targetSide: Side; targetT: number } | null>(null);

    const effSp = live.sp ?? sp;
    const effTp = live.tp ?? tp;

    const [path] = getBezierPath({
        sourceX: effSp.x,
        sourceY: effSp.y,
        sourcePosition: sourceSide as Position,
        targetX: effTp.x,
        targetY: effTp.y,
        targetPosition: targetSide as Position,
        curvature: 0.28,
    });

    const onMove = (e: React.PointerEvent) => {
        const kind = dragging.current;
        if (!kind) return;
        const box = kind === 'source' ? srcBox : tgtBox;
        if (!box) return;
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
        const { side, t } = sideAndT(flow.x, flow.y, box);
        const p = pointAlong(box, side, t);
        pending.current = {
            sourceSide,
            sourceT,
            targetSide,
            targetT,
            ...(pending.current ?? {}),
        };
        if (kind === 'source') {
            pending.current = { ...pending.current, sourceSide: side, sourceT: t };
            setLive((l) => ({ ...l, sp: p }));
        } else {
            pending.current = { ...pending.current, targetSide: side, targetT: t };
            setLive((l) => ({ ...l, tp: p }));
        }
    };

    const onUp = (e?: React.PointerEvent) => {
        if (e) {
            try {
                (e.target as Element).releasePointerCapture?.(e.pointerId);
            } catch {
                /* ignore */
            }
        }
        if (dragging.current && tgt && pending.current) {
            const prev = tgt.edgeToParent ?? {};
            updateCard(tgt.id, { edgeToParent: { ...prev, ...pending.current } });
        }
        dragging.current = null;
        pending.current = null;
        setLive({});
    };

    const startDrag = (e: React.PointerEvent, kind: 'source' | 'target') => {
        e.stopPropagation();
        e.preventDefault();
        dragging.current = kind;
        pending.current = null;
        (e.target as Element).setPointerCapture?.(e.pointerId);
    };

    useEffect(
        () => () => {
            dragging.current = null;
        },
        [],
    );

    const dot = (p: Pt, kind: 'source' | 'target') => (
        <circle
            className="melon-endpoint nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={7}
            fill={theme.tokens.purple}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, kind)}
            onPointerMove={onMove}
            onPointerUp={onUp}
        >
            <title>Drag to slide along the card</title>
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
            {dot(effSp, 'source')}
            {dot(effTp, 'target')}
        </>
    );
}
