import { BookMarked, FileText, MessageSquare } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';

/**
 * Always-visible left strip in maximized mode: every box on this canvas.
 * Click any card to stay fullscreen on that box.
 */
export function CanvasBoxesSideNav({ currentCardId }: { currentCardId: string }) {
	const cards = useCanvasStore((s) => s.cards);
	const items = [...cards].sort((a, b) => {
		const dy = a.position.y - b.position.y;
		if (Math.abs(dy) > 48) return dy;
		return a.position.x - b.position.x;
	});

	const select = (targetId: string) => {
		if (targetId === currentCardId) return;
		const target = cards.find((c) => c.id === targetId);
		if (!target) return;
		const store = useCanvasStore.getState();
		store.requestFocusCard(targetId);
		store.setMaximizedCardId(targetId);
	};

	return (
		<aside
			aria-label="Canvas boxes"
			className="nodrag nowheel flex w-52 shrink-0 flex-col border-r border-border bg-background/90"
		>
			<div className="shrink-0 border-b border-border/70 px-3 py-2.5">
				<div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Boxes</div>
				<div className="mt-0.5 text-[11px] text-muted-foreground/80">{items.length} on this canvas</div>
			</div>
			<div
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5"
				style={{ scrollbarWidth: 'thin' }}
			>
				{items.length === 0 ? (
					<p className="px-2 py-3 text-[12px] text-muted-foreground">No boxes yet.</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{items.map((c) => {
							const kind = c.kind ?? 'chat';
							const active = c.id === currentCardId;
							const Icon =
								kind === 'document' ? FileText : kind === 'note' ? BookMarked : MessageSquare;
							const streaming = c.status === 'streaming';
							const pending = (c.boxInboxPending ?? 0) > 0;
							return (
								<li key={c.id}>
									<button
										type="button"
										aria-current={active ? 'true' : undefined}
										title={c.title || kind}
										onClick={(e) => {
											e.stopPropagation();
											select(c.id);
										}}
										className={cn(
											'nodrag flex w-full items-start gap-2 rounded-lg px-2 py-2 text-left transition-colors',
											active
												? 'bg-primary/12 text-foreground ring-1 ring-inset ring-primary/25'
												: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
										)}
									>
										<Icon className="mt-0.5 size-3.5 shrink-0 opacity-80" aria-hidden />
										<span className="min-w-0 flex-1">
											<span className="block truncate text-[12px] font-medium leading-snug text-inherit">
												{c.title?.trim() ||
													(kind === 'chat' ? 'Chat' : kind === 'note' ? 'Note' : 'Document')}
											</span>
											<span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
												<span className="capitalize">{kind}</span>
												{streaming ? (
													<span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
														<span className="size-1.5 animate-pulse rounded-full bg-current" />
														live
													</span>
												) : null}
												{pending ? (
													<span className="rounded bg-amber-500/15 px-1 py-px text-amber-700 dark:text-amber-400">
														inbox {c.boxInboxPending}
													</span>
												) : null}
											</span>
										</span>
									</button>
								</li>
							);
						})}
					</ul>
				)}
			</div>
		</aside>
	);
}

export function MaximizeIcon() {
	return (
		<svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5">
			<path d="M2 6V2h4M14 10v4h-4" strokeLinecap="round" />
			<rect x="2" y="2" width="12" height="12" rx="2" opacity="0.35" />
		</svg>
	);
}
