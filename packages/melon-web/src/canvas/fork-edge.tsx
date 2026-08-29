import { BaseEdge, getSmoothStepPath, type EdgeProps } from '@xyflow/react';
import { useActiveTheme } from '@/theme/theme-store';

/**
 * Mind-map edge: smooth ORTHOGONAL routing (rounded corners, auto-tightens
 * around obstacles) instead of raw bezier. Clean arrowhead, hover highlight.
 */
export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const [path] = getSmoothStepPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
        borderRadius: 12,
        offset: 30,
    });

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
                    <path d="M 1 1.5 L 9 5 L 1 8.5 z" fill={theme.tokens.purple} stroke={theme.tokens.purple} strokeWidth="0.6" />
                </marker>
            </defs>
            <BaseEdge
                path={path}
                markerEnd="url(#melon-arrowhead)"
                className="group/edge"
                style={{
                    stroke: `${theme.tokens.purple}99`,
                    strokeWidth: 2,
                    transition: 'stroke-width 120ms ease, stroke 120ms ease',
                }}
            />
        </>
    );
}
