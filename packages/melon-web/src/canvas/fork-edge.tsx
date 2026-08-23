import { BaseEdge, getBezierPath, type EdgeProps } from '@xyflow/react';

export function ForkEdge(props: EdgeProps) {
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
            style={{ stroke: '#bd93f999', strokeWidth: 2 }}
        />
    );
}
