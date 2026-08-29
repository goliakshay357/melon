import { useEffect, useRef, useState } from 'react';
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

function boundaryPoint(px: number, py: number, box: Box, side: Side): Pt {
    const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
    switch (side) {
        case 'top': return { x: clamp(px, box.x, box.x + box.w), y: box.y };
        case 'bottom': return { x: clamp(px, box.x, box.x + box.w), y: box.y + box.h };
        case 'left': return { x: box.x, y: clamp(py, box.y, box.y + box.h) };
        case 'right': return { x: box.x + box.w, y: clamp(py, box.y, box.y + box.h) };
    }
}

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

function cornersFromPath(d: string): Pt[] {
    const pts: Pt[] = [];
    const re = /Q\s*(-?[\d.]+)[,\s]+(-?[\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(d)) !== null) pts.push({ x: +m[1], y: +m[2] });
    return pts.filter((p, i) => i === 0 || Math.abs(p.x - pts[i - 1].x) > 1 || Math.abs(p.y - pts[i - 1].y) > 1);
}

/**
 * Mind-map edge. Dragging is LOCAL + REAL-TIME (no store writes, no canvas
 * re-render — only this edge updates), and persists on release.
 * - Endpoint dots: re-attach either end to any card side.
 * - Corner handles: reshape the line itself.
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
    const persistedWaypoints = data.waypoints ?? null;

    const sp = srcBox ? midOf(srcBox, sourceSide) : { x: props.sourceX, y: props.sourceY };
    const tp = tgtBox ? midOf(tgtBox, targetSide) : { x: props.targetX, y: props.targetY };

    // LIVE drag state — local only, zero store writes while dragging.
    const [live, setLive] = useState<{ sp?: Pt; tp?: Pt; corners?: Pt[] }>({});
    const dragging = useRef<'source' | 'target' | 'corner' | null>(null);
    const cornerIdx = useRef(-1);

    const effSp = live.sp ?? sp;
    const effTp = live.tp ?? tp;
    const effCorners = live.corners ?? persistedWaypoints;

    let path: string;
    let corners: Pt[];
    if (effCorners && effCorners.length > 0) {
        corners = effCorners;
        path = roundedOrtho(routeThrough(effSp, effTp, effCorners), 8);
    } else {
        [path] = getSmoothStepPath({
            sourceX: effSp.x,
            sourceY: effSp.y,
            targetX: effTp.x,
            targetY: effTp.y,
            borderRadius: 8,
            offset: 24,
        });
        corners = cornersFromPath(path);
    }

    const persist = (updates: { sourceSide?: Side; targetSide?: Side; waypoints?: Pt[] | null }) => {
        if (!tgt) return;
        const prev = tgt.edgeToParent ?? {};
        updateCard(tgt.id, { edgeToParent: { ...prev, ...updates } });
    };

    const onPointerMove = (e: React.PointerEvent) => {
        const kind = dragging.current;
        if (!kind) return;
        const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY });

        if (kind === 'corner') {
            const base = effCorners && effCorners.length ? [...effCorners] : corners.length ? [...corners] : [];
            if (base[cornerIdx.current]) {
                base[cornerIdx.current] = { x: flow.x, y: flow.y };
                setLive((l) => ({ ...l, corners: base }));
            }
            return;
        }
        const box = kind === 'source' ? srcBox : tgtBox;
        if (!box) return;
        const side = sideFromAngle(flow.x, flow.y, box);
        if (kind === 'source') {
            setLive((l) => ({ ...l, sp: boundaryPoint(flow.x, flow.y, box, side) }));
        } else {
            setLive((l) => ({ ...l, tp: boundaryPoint(flow.x, flow.y, box, side) }));
        }
    };

    const onPointerUp = () => {
        const kind = dragging.current;
        if (!kind) return;
        const box = kind === 'source' ? srcBox : tgtBox;
        // Commit the FINAL state to the store (persist) only on release.
        if (kind === 'corner') {
            const finalCorners = live.corners && live.corners.length ? [...live.corners] : null;
            persist({ waypoints: finalCorners });
        } else if (box) {
            const flow = screenToFlowPosition({
                x: (window as any).__melonDragLast?.x ?? 0,
                y: (window as any).__melonDragLast?.y ?? 0,
            });
            const side = sideFromAngle(flow.x, flow.y, box);
            persist(kind === 'source' ? { sourceSide: side } : { targetSide: side });
        }
        dragging.current = null;
        cornerIdx.current = -1;
        setLive({});
    };

    const startDrag = (e: React.PointerEvent, kind: 'source' | 'target' | 'corner', idx = -1) => {
        e.stopPropagation();
        e.preventDefault();
        dragging.current = kind;
        cornerIdx.current = idx;
        // Remember the last pointer position for commit (pointer capture isn't needed).
        const remember = (ev: PointerEvent) => ((window as any).__melonDragLast = { x: ev.clientX, y: ev.clientY });
        window.addEventListener('pointermove', remember);
        window.addEventListener(
            'pointerup',
            () => window.removeEventListener('pointermove', remember),
            { once: true },
        );
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
            r={8}
            fill={theme.tokens.purple}
            stroke="#0d1117"
            strokeWidth={1.5}
            style={{ cursor: 'grab', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, kind)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
        >
            <title>Drag to re-attach this end</title>
        </circle>
    );

    const cornerDot = (p: Pt, i: number) => (
        <circle
            className="melon-corner nopan nodrag"
            cx={p.x}
            cy={p.y}
            r={6}
            fill="#0d1117"
            stroke={theme.tokens.purple}
            strokeWidth={1.5}
            style={{ cursor: 'move', touchAction: 'none', pointerEvents: 'all' }}
            onPointerDown={(e) => startDrag(e, 'corner', i)}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
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
            {dot(effSp, 'source')}
            {dot(effTp, 'target')}
        </>
    );
}
