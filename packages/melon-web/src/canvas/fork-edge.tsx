import { useEffect, useRef } from 'react';
import { BaseEdge, getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react';
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

function sideFromAngle(px: number, py: number, box: Box): Side {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    const nx = (px - cx) / (box.w / 2);
    const ny = (py - cy) / (box.h / 2);
    return Math.abs(nx) > Math.abs(ny) ? (nx >= 0 ? 'right' : 'left') : ny >= 0 ? 'bottom' : 'top';
}

function midOf(box: Box, side: Side): Pt {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    switch (side) {
        case 'top': return { x: cx, y: box.y };
        case 'bottom': return { x: cx, y: box.y + box.h };
        case 'left': return { x: box.x, y: cy };
        case 'right': return { x: box.x + box.w, y: cy };
    }
}

/** Orthogonal polyline S → waypoints → T (axis-aligned bends). */
function routeThrough(s: Pt, t: Pt, waypoints: Pt[]): Pt[] {
    const pts: Pt[] = [s];
    let prev = s;
    for (const w of waypoints) {
        pts.push({ x: w.x, y: prev.y });
        pts.push(w);
        prev = w;
    }
    pts.push({ x: t.x, y: prev.y });
    pts.push(t);
    return pts;
}

/** Build a smooth path with rounded corners through the given points. */
function roundedOrtho(points: Pt[], r: number): string {
    if (points.length < 2) return '';
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length - 1; i++) {
        const p = points[i - 1];
        const c = points[i];
        const n = points[i + 1];
        const dx1 = Math.sign(c.x - p.x);
        const dy1 = Math.sign(c.y - p.y);
        const dx2 = Math.sign(n.x - c.x);
        const dy2 = Math.sign(n.y - c.y);
        const rad = Math.min(
            r,
            Math.abs(c.x - p.x) / 2,
            Math.abs(c.y - p.y) / 2,
            Math.abs(n.x - c.x) / 2,
            Math.abs(n.y - c.y) / 2,
        );
        const a1 = { x: c.x - dx1 * rad, y: c.y - dy1 * rad };
        const a2 = { x: c.x + dx2 * rad, y: c.y + dy2 * rad };
        d += ` L ${a1.x} ${a1.y} Q ${c.x} ${c.y} ${a2.x} ${a2.y}`;
    }
    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
}

/** Extract the corner control points from a smooth-step path string. */
function cornersFromPath(d: string): Pt[] {
    const pts: Pt[] = [];
    const re = /Q\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d)) !== null) pts.push({ x: +m[1], y: +m[2] });
    // Dedupe near-identical points.
    return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1 || Math.abs(p.y - pts[i - 1].y) > 1);
}

/**
 * Mind-map edge. Both ends have draggable dots (re-attach to any side) and
 * the LINE has draggable corner handles — drag a corner to reshape the arrow.
 * Default: smooth orthogonal bottom→top with one arrowhead at the target.
 */
export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const { screenToFlowPosition } = useReactFlow();
    const cards = useCanvasStore((s) => s.cards);
    const updateCard = useCanvasStore((s) => s.updateCard);
    const data = (props.data ?? {}) as {
        sourceSide?: Side;
        targetSide?: Side;
        waypoints?: Pt[];
    };

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
    const waypoints = data.waypoints ?? null;

    const sp = srcBox ? midOf(srcBox, sourceSide) : { x: props.sourceX, y: props.sourceY };
    const tp = tgtBox ? midOf(tgtBox, targetSide) : { x: props.targetX, y: props.targetY };

    let path: string;
    let corners: Pt[];
    if (waypoints && waypoints.length > 0) {
        corners = waypoints;
        path = roundedOrtho(routeThrough(sp, tp, waypoints), 8);
    } else {
        [path] = getSmoothStepPath({
            sourceX: sp.x,
            sourceY: sp.y,
            targetX: tp.x,
            targetY: tp.y,
            borderRadius: 8,
            offset: 24,
        });
        corners = cornersFromPath(path);
    }

    const dragging = useRef<'source' | 'target' | 'corner' | null>(null);
    const cornerIdx = useRef(-1);

    const persist = (updates: { sourceSide?: Side; targetSide?: Side; waypoints?: Pt[] | null }) => {
        if (!tgt) return;
        const prev = tgt.edgeToParent ?? {};
        updateCard(tgt.id, { edgeToParent: { ...prev, ...updates } });
    };

    // Window-level drag — reliable for endpoints AND corners.
    useEffect(() => {
        if (!dragging.current) return;
        const onMove = (e: PointerEvent) => {
            const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            const kind = dragging.current;
            if (kind === 'corner') {
                const cur = waypoints && waypoints.length ? [...waypoints] : corners.length ? [...corners] : [];
                if (cur[cornerIdx.current]) cur[cornerIdx.current] = { x: flow.x, y: flow.y };
                persist({ waypoints: cur.length ? cur : null });
                return;
            }
            const box = kind === 'source' ? srcBox : tgtBox;
            if (!box || !tgt) return;
            const side = sideFromAngle(flow.x, flow.y, box);
            persist(kind === 'source' ? { sourceSide: side } : { targetSide: side });
        };
        const onUp = () => {
            dragging.current = null;
            cornerIdx.current = -1;
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
        };
    }, [dragging, srcBox, tgtBox, tgt, updateCard, screenToFlowPosition, waypoints, corners, persist]);

    useEffect(
        () => () => {
            dragging.current = null;
        },
        [],
    );

    const startDrag = (e: React.PointerEvent, kind: 'source' | 'target' | 'corner', idx = -1) => {
        e.stopPropagation();
        dragging.current = kind;
        cornerIdx.current = idx;
    };

    const dot = (p: Pt, kind: 'source' | 'target') => (
        <circle
            className="melon-endpoint nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={8}
            fill={theme.tokens.purple}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, kind)}
        >
            <title>Drag to re-attach this end</title>
        </circle>
    );

    const cornerDot = (p: Pt, i: number) => (
        <circle
            className="melon-corner nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={5.5}
            fill="#0d1117"
            stroke={theme.tokens.purple}
            strokeWidth={1.5}
            style={{ cursor: 'move', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, 'corner', i)}
        >
            <title>Drag to reshape the line</title>
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
            {corners.map((c, i) => cornerDot(c, i))}
            {dot(sp, 'source')}
            {dot(tp, 'target')}
        </>
    );
}
