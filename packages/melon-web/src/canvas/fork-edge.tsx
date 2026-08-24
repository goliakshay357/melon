import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';
import { useActiveTheme } from '@/theme/theme-store';

export function ForkEdge(props: EdgeProps) {
    const theme = useActiveTheme();
    const [path] = getBezierPath({
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        sourcePosition: props.sourcePosition,
        targetX: props.targetX,
        targetY: props.targetY,
        targetPosition: props.targetPosition,
    });

    return (
        <BaseEdge
            path={path}
            style={{ stroke: `${theme.tokens.purple}99`, strokeWidth: 2 }}
        />
    );
}
