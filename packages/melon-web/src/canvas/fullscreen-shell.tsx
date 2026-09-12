import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Minimize2 } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { InboxView } from '@/components/inbox-view';
import { CanvasBoxesSideNav } from './canvas-boxes-side-nav';

const FOCUSABLE =
	'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Shared fullscreen (maximized card) chrome — the only place fullscreen layout
 * lives, so chat / document / note stay identical.
 *
 * Surface model (Melon tokens, supernova-style layering):
 *   background → rail (surface, recessed) → content column (background, raised)
 *
 * The Melon nav is intentionally NOT shown: fullscreen is its own surface. The
 * vertical node list is the first column and runs the full height; the card
 * header lives INSIDE the content column so the rail reaches the top edge.
 */
export function FullscreenShell({
	cardId,
	ariaLabel,
	header,
	banners,
	children,
}: {
	cardId: string;
	ariaLabel: string;
	/** Card-specific header row (breadcrumb, actions, exit). Rendered in the content column. */
	header: ReactNode;
	/** Optional status strips under the header (content width only). */
	banners?: ReactNode;
	children: ReactNode;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const restoreRef = useRef<HTMLElement | null>(null);
	// Paint the opaque shell first, then mount the (potentially heavy) card body on
	// the next frame. Without this the canvas stays visible while Milkdown / a long
	// transcript mounts into the portal.
	const [contentReady, setContentReady] = useState(false);
	// The inbox is a canvas-level view; whichever card is fullscreen hosts it in
	// the content column so every card kind gets it identically.
	const inboxOpen = useCanvasStore((s) => s.inboxOpen);

	useEffect(() => {
		setContentReady(false);
		const id = requestAnimationFrame(() => setContentReady(true));
		return () => cancelAnimationFrame(id);
	}, [cardId]);

	useEffect(() => {
		restoreRef.current = document.activeElement as HTMLElement | null;
		const panel = panelRef.current;
		if (!panel) return;
		if (!panel.contains(document.activeElement)) panel.focus({ preventScroll: true });

		const onKeyDown = (e: KeyboardEvent) => {
			if (e.key !== 'Tab') return;
			const nodes = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
				(el) => el.offsetParent !== null || el === document.activeElement,
			);
			if (nodes.length === 0) return;
			const first = nodes[0];
			const last = nodes[nodes.length - 1];
			if (e.shiftKey && document.activeElement === first) {
				e.preventDefault();
				last.focus();
			} else if (!e.shiftKey && document.activeElement === last) {
				e.preventDefault();
				first.focus();
			}
		};
		panel.addEventListener('keydown', onKeyDown);
		return () => {
			panel.removeEventListener('keydown', onKeyDown);
			restoreRef.current?.focus?.({ preventScroll: true });
		};
	}, []);

	return createPortal(
		<div
			ref={panelRef}
			tabIndex={-1}
			role="dialog"
			aria-modal="true"
			aria-label={ariaLabel}
			className="fixed inset-0 z-[999] flex bg-background text-foreground outline-none"
		>
			<CanvasBoxesSideNav currentCardId={cardId} />
			<div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
				{inboxOpen ? (
					<InboxView
						closeLabel="Back to node"
						onClose={() => useCanvasStore.getState().closeInbox()}
						onOpenBox={(targetId) => {
							useCanvasStore.getState().setMaximizedCardId(targetId);
							useCanvasStore.getState().closeInbox();
						}}
					/>
				) : (
					<>
						{header}
						{banners}
						<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
							{contentReady ? children : null}
						</div>
					</>
				)}
			</div>
		</div>,
		document.body,
	);
}

/**
 * Fullscreen breadcrumb: `Canvas / Node`. Keeps the page title legible instead of
 * a raw truncated card title.
 */
export function FullscreenBreadcrumb({
	title,
	titleNode,
}: {
	title: string;
	/** Custom title node (e.g. an inline rename input). Replaces the plain title. */
	titleNode?: ReactNode;
}) {
	const canvasName = useCanvasStore((s) => s.canvasName);
	return (
		<span className="flex min-w-0 flex-1 items-center gap-1.5">
			{canvasName ? (
				<>
					<span
						className="hidden max-w-[11rem] shrink-0 truncate text-[13px] text-muted-foreground sm:inline"
						title={canvasName}
					>
						{canvasName}
					</span>
					<span className="hidden shrink-0 text-muted-foreground/50 sm:inline" aria-hidden>
						/
					</span>
				</>
			) : null}
			{titleNode ?? (
				<span className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
					{title}
				</span>
			)}
		</span>
	);
}

/** Single exit affordance for every fullscreen header (Esc). */
export function FullscreenExitButton({ onExit }: { onExit: () => void }) {
	return (
		<button
			type="button"
			className="nodrag flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
			onClick={(e) => {
				e.stopPropagation();
				onExit();
			}}
			title="Back to canvas (Esc)"
			aria-label="Exit fullscreen"
		>
			<Minimize2 className="size-3.5" />
			Canvas
			<kbd className="rounded border border-border px-1 text-[9px] leading-tight text-muted-foreground/80">
				Esc
			</kbd>
		</button>
	);
}
