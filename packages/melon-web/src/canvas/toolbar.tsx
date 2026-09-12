import { useState } from 'react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { Maximize, Plus, Redo2, Undo2, ZoomIn, ZoomOut } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { CanvasShareControls, SHARE_FOR_REVIEW_ENABLED } from './canvas-share-bar';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

function ToolbarButton({
	label,
	hint,
	onClick,
	disabled,
	children,
}: {
	label: string;
	hint?: string;
	onClick: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40"
			title={hint ? `${label} (${hint})` : label}
			aria-label={label}
			disabled={disabled}
			onClick={onClick}
		>
			{children}
		</button>
	);
}

export function Toolbar() {
	const { zoomIn, zoomOut, fitView, getZoom, setViewport, getViewport, screenToFlowPosition } =
		useReactFlow();
	const [zoom, setZoom] = useState(Math.round(getZoom() * 100));
	const addCard = useCanvasStore((s) => s.addCard);

	useOnViewportChange({
		onChange: (v) => setZoom(Math.round(v.zoom * 100)),
	});

	const resetZoom = () => {
		const vp = getViewport();
		// Keep the viewport centre fixed while resetting the scale.
		const cx = window.innerWidth / 2;
		const cy = window.innerHeight / 2;
		const worldX = (cx - vp.x) / vp.zoom;
		const worldY = (cy - vp.y) / vp.zoom;
		void setViewport({ x: cx - worldX, y: cy - worldY, zoom: 1 }, { duration: 200 });
	};

	const addChatCardHere = () => {
		const sidebar = useCanvasStore.getState().sidebarCollapsed ? 48 : 260;
		const center = {
			x: sidebar + (window.innerWidth - sidebar) / 2,
			y: window.innerHeight / 2,
		};
		addCard(screenToFlowPosition(center));
	};

	const undo = () => {
		if (!useCanvasStore.getState().undo()) {
			useCanvasStore.setState({ canvasNotice: 'Nothing to undo.' });
		}
	};
	const redo = () => {
		if (!useCanvasStore.getState().redo()) {
			useCanvasStore.setState({ canvasNotice: 'Nothing to redo.' });
		}
	};

	return (
		<div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-card/90 px-2 py-1 shadow-sm backdrop-blur">
			<ToolbarButton label="Undo" hint={`${mod}Z`} onClick={undo}>
				<Undo2 className="size-4" />
			</ToolbarButton>
			<ToolbarButton label="Redo" hint={`${mod}⇧Z`} onClick={redo}>
				<Redo2 className="size-4" />
			</ToolbarButton>
			<div className="mx-1 h-5 w-px bg-border" />
			<ToolbarButton label="Zoom out" onClick={() => zoomOut({ duration: 200 })}>
				<ZoomOut className="size-4" />
			</ToolbarButton>
			<button
				type="button"
				className="w-14 rounded-md px-1 py-1 text-center text-xs tabular-nums text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				title="Reset to 100%"
				aria-label="Reset zoom to 100 percent"
				onClick={resetZoom}
			>
				{zoom}%
			</button>
			<ToolbarButton label="Zoom in" onClick={() => zoomIn({ duration: 200 })}>
				<ZoomIn className="size-4" />
			</ToolbarButton>
			<ToolbarButton label="Fit view" onClick={() => fitView({ padding: 0.2, duration: 300 })}>
				<Maximize className="size-4" />
			</ToolbarButton>
			<div className="mx-1 h-5 w-px bg-border" />
			<ToolbarButton label="New chat card" onClick={addChatCardHere}>
				<Plus className="size-4" />
			</ToolbarButton>
			{SHARE_FOR_REVIEW_ENABLED && <CanvasShareControls />}
		</div>
	);
}
