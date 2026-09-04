import { useCanvasStore } from '@/store/canvas-store';

/** Top-of-canvas notice for isolation/save issues. */
export function CanvasNoticeBanner() {
	const notice = useCanvasStore((s) => s.canvasNotice);
	const worktreeMissing = useCanvasStore((s) => s.worktreeMissing);
	const sidebarCollapsed = useCanvasStore((s) => s.sidebarCollapsed);
	const dismissCanvasNotice = useCanvasStore((s) => s.dismissCanvasNotice);
	const continueLocalAfterMissingWorktree = useCanvasStore(
		(s) => s.continueLocalAfterMissingWorktree,
	);

	if (!notice && !worktreeMissing) return null;

	return (
		<div
			className="pointer-events-none absolute top-3 z-20 transition-[left] duration-200"
			style={{ left: sidebarCollapsed ? 56 : 268, right: 12 }}
		>
			<div className="pointer-events-auto flex max-w-xl items-start gap-2 rounded-lg border border-border bg-card/95 px-3 py-2 text-xs shadow-sm backdrop-blur">
				<p className="min-w-0 flex-1 leading-relaxed text-card-foreground">
					{notice ??
						'Isolated checkout is missing. Continue in Local mode or restore the worktree.'}
				</p>
				{worktreeMissing ? (
					<button
						type="button"
						className="shrink-0 rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
						onClick={() => void continueLocalAfterMissingWorktree()}
					>
						Continue Local
					</button>
				) : null}
				<button
					type="button"
					className="shrink-0 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground"
					onClick={() => dismissCanvasNotice()}
				>
					Dismiss
				</button>
			</div>
		</div>
	);
}
