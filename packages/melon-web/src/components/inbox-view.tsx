import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Inbox, Send, Trash2 } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { pendingInboxRows, type PendingInboxRow } from '@/lib/box-inbox';
import { cn } from '@/lib/utils';
import type { BoxMailReplyPolicy } from '@/types/session-card';

function replyPolicyLabel(policy: BoxMailReplyPolicy | undefined): string | null {
	if (policy === 'never') return 'no reply needed';
	if (policy === 'always_result') return 'result expected';
	if (policy === 'if_needed') return 'reply if needed';
	return null;
}

function relativeTime(ms: number): string {
	if (!ms) return '';
	const diff = Date.now() - ms;
	if (diff < 0) return '';
	if (diff < 60_000) return 'just now';
	if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
	if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
	return `${Math.floor(diff / 86_400_000)}d ago`;
}

/**
 * Canvas-level inbox view: master list on the left, full message + pinned
 * actions on the right. Approve/dismiss never scroll — only the message does.
 *
 * It is a view (fills the content area), not a dialog, so it is hosted by the
 * canvas frame and by the fullscreen shell without any overlay, focus trap, or
 * z-index tricks.
 */
export function InboxView({
	filterCardId,
	closeLabel = 'Back',
	onClose,
	onOpenBox,
}: {
	/** Narrow the list to one node. Null/undefined shows every node. */
	filterCardId?: string | null;
	closeLabel?: string;
	onClose: () => void;
	/** Override where "open node" goes (fullscreen swaps the maximized card). */
	onOpenBox?: (cardId: string) => void;
}) {
	const cards = useCanvasStore((s) => s.cards);
	const [selectedId, setSelectedId] = useState<string | null>(null);
	const rootRef = useRef<HTMLDivElement>(null);
	// Guards against double-submitting when the same decision is triggered twice
	// before the server response lands (rapid key repeats, double click).
	const busyRef = useRef(false);

	// Pull a fresh inbox for every box the view can show, once per open.
	useEffect(() => {
		const all = useCanvasStore.getState().cards;
		const ids = filterCardId ? [filterCardId] : all.map((c) => c.id);
		for (const cid of ids) void useCanvasStore.getState().syncBoxInbox(cid);
	}, [filterCardId]);

	const rows = useMemo<PendingInboxRow[]>(
		() => pendingInboxRows(cards, filterCardId),
		[cards, filterCardId],
	);

	// Keep a valid selection as items leave the queue.
	useEffect(() => {
		if (rows.length === 0) {
			if (selectedId !== null) setSelectedId(null);
			return;
		}
		if (!rows.some((r) => r.item.id === selectedId)) {
			setSelectedId(rows[0].item.id);
		}
	}, [rows, selectedId]);

	const selected = rows.find((r) => r.item.id === selectedId) ?? rows[0] ?? null;
	const selectedPolicy = selected ? replyPolicyLabel(selected.item.envelope?.replyPolicy) : null;

	const advance = (removedId: string) => {
		const idx = rows.findIndex((r) => r.item.id === removedId);
		const next = rows[idx + 1] ?? rows[idx - 1] ?? null;
		setSelectedId(next ? next.item.id : null);
	};

	const approve = async (row: PendingInboxRow) => {
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			const ok = await useCanvasStore.getState().approveBoxInbox(row.card.id, row.item.id);
			if (ok) advance(row.item.id);
		} finally {
			busyRef.current = false;
		}
	};
	const dismiss = async (row: PendingInboxRow) => {
		if (busyRef.current) return;
		busyRef.current = true;
		try {
			const ok = await useCanvasStore.getState().dismissBoxInbox(row.card.id, row.item.id);
			if (ok) advance(row.item.id);
		} finally {
			busyRef.current = false;
		}
	};

	const openBox = (cardId: string) => {
		if (onOpenBox) {
			onOpenBox(cardId);
			return;
		}
		useCanvasStore.getState().requestFocusCard(cardId);
		onClose();
	};

	const move = (delta: number) => {
		if (rows.length === 0) return;
		const idx = Math.max(
			0,
			rows.findIndex((r) => r.item.id === selectedId),
		);
		const next = Math.min(rows.length - 1, Math.max(0, idx + delta));
		setSelectedId(rows[next].item.id);
	};

	// Keyboard-first triage. Scoped to focus inside the view so the canvas
	// shortcuts and text inputs elsewhere keep working.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const root = rootRef.current;
			if (!root) return;
			const active = document.activeElement;
			if (active && active !== document.body && !root.contains(active)) return;
			if (e.key === 'Escape') {
				e.preventDefault();
				onClose();
				return;
			}
			if (e.key === 'ArrowDown' || e.key === 'j') {
				e.preventDefault();
				move(1);
				return;
			}
			if (e.key === 'ArrowUp' || e.key === 'k') {
				e.preventDefault();
				move(-1);
				return;
			}
			if ((e.key === 'a' || e.key === 'A') && selected) {
				e.preventDefault();
				void approve(selected);
				return;
			}
			if ((e.key === 'd' || e.key === 'D') && selected) {
				e.preventDefault();
				void dismiss(selected);
				return;
			}
			if (e.key === 'Enter' && selected) {
				e.preventDefault();
				openBox(selected.card.id);
			}
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
		// Re-subscribe when the queue or selection changes; the handlers close over
		// the current rows/selection by design.
	}, [rows, selectedId, selected]);

	useEffect(() => {
		rootRef.current?.focus({ preventScroll: true });
	}, []);

	const pendingLabel = `${rows.length} pending`;

	return (
		<div
			ref={rootRef}
			tabIndex={-1}
			role="region"
			aria-label="Inbox"
			className="flex h-full w-full flex-col bg-background text-foreground outline-none"
		>
			{/* Header */}
			<div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4 sm:px-5">
				<Inbox className="size-4 shrink-0 text-muted-foreground" aria-hidden />
				<h1 className="text-sm font-semibold tracking-tight">Inbox</h1>
				<span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
					{pendingLabel}
				</span>
				<button
					type="button"
					className="ml-auto flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					onClick={onClose}
					title={`${closeLabel} (Esc)`}
				>
					<ArrowLeft className="size-3.5" />
					{closeLabel}
					<kbd className="rounded border border-border px-1 text-[9px] leading-tight text-muted-foreground/80">
						Esc
					</kbd>
				</button>
			</div>

			{rows.length === 0 ? (
				<div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
					<Inbox className="size-6 text-muted-foreground/60" aria-hidden />
					<p className="text-sm text-muted-foreground">No pending mail.</p>
					<p className="max-w-sm text-[11px] text-muted-foreground/80">
						Approved messages go straight into the target node and leave the inbox.
					</p>
				</div>
			) : (
				<div className="flex min-h-0 min-w-0 flex-1">
					{/* Master list — the only independently scrolling column. */}
					<div
						role="listbox"
						aria-label="Pending messages"
						className="flex w-[17rem] shrink-0 flex-col overflow-y-auto border-r border-border p-2 sm:w-[19rem]"
						style={{ scrollbarWidth: 'thin' }}
					>
						{rows.map((row) => {
							const active = row.item.id === selected?.item.id;
							const policy = replyPolicyLabel(row.item.envelope?.replyPolicy);
							return (
								<button
									key={row.item.id}
									type="button"
									role="option"
									aria-selected={active}
									onClick={() => setSelectedId(row.item.id)}
									className={cn(
										'flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 text-left transition-colors',
										active ? 'bg-primary/10' : 'hover:bg-secondary/70',
									)}
								>
									<span className="flex min-w-0 items-center gap-1.5">
										<span
											className={cn(
												'min-w-0 flex-1 truncate text-xs font-medium',
												active ? 'text-primary' : 'text-card-foreground',
											)}
										>
											{row.item.fromTitle}
										</span>
										{row.item.autoApproved ? (
											<span className="shrink-0 rounded bg-secondary px-1 text-[9px] text-muted-foreground">
												auto
											</span>
										) : null}
										<span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
											{relativeTime(row.item.createdAt)}
										</span>
									</span>
									<span className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">
										{row.item.body}
									</span>
									<span className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
										{policy ? <span className="truncate">{policy}</span> : null}
										<span className="shrink-0 opacity-70">· to {row.item.toTitle}</span>
									</span>
								</button>
							);
						})}
					</div>

					{/* Detail — message scrolls, actions pinned below it. */}
					<div className="flex min-h-0 min-w-0 flex-1 flex-col">
						{selected ? (
							<>
								<div className="min-h-0 flex-1 overflow-y-auto px-5 py-5" style={{ scrollbarWidth: 'thin' }}>
									<div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
										<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
											<span>
												From{' '}
												<span className="font-medium text-card-foreground/90">
													{selected.item.fromTitle}
												</span>
											</span>
											<span aria-hidden>→</span>
											<span>
												To{' '}
												<span className="font-medium text-card-foreground/90">
													{selected.item.toTitle}
												</span>
											</span>
											<span className="tabular-nums opacity-80">
												{relativeTime(selected.item.createdAt)}
											</span>
											{selectedPolicy ? (
												<span className="rounded bg-secondary px-1.5 py-0.5">
													{selectedPolicy}
												</span>
											) : null}
											{selected.item.autoApproved ? (
												<span className="rounded bg-secondary px-1.5 py-0.5">
													auto-approved
												</span>
											) : null}
										</div>
										<p className="whitespace-pre-wrap break-words text-[13px] leading-relaxed text-card-foreground">
											{selected.item.body}
										</p>
									</div>
								</div>

								<div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-5 py-3">
									<button
										type="button"
										className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
										onClick={() => openBox(selected.card.id)}
										title="Open node (Enter)"
									>
										<Send className="size-3.5" />
										Open node
									</button>
									<div className="ml-auto flex items-center gap-2">
										<button
											type="button"
											className="flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => void dismiss(selected)}
											title="Dismiss (D)"
										>
											<Trash2 className="size-3.5" />
											Dismiss
										</button>
										<button
											type="button"
											className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
											onClick={() => void approve(selected)}
											title="Approve for agent (A)"
										>
											<Check className="size-3.5" />
											Approve for agent
										</button>
									</div>
								</div>
							</>
						) : null}
					</div>
				</div>
			)}
		</div>
	);
}
