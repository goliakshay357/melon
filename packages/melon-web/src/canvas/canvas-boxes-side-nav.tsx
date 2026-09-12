import { useEffect, useRef, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import {
	Archive,
	Bot,
	BookMarked,
	FileText,
	Inbox,
	Layers,
	MessageSquare,
	MoreHorizontal,
	Pencil,
} from 'lucide-react';
import { SIDEBAR_WIDTH, findOpenSpot } from '@/lib/spawn';
import { currentSpawnSize, useCanvasStore } from '@/store/canvas-store';
import { cn } from '@/lib/utils';
import type { SessionCard } from '@/types/session-card';

type AgentRow = { id: string; name: string; role: string };

/** Centre of the visible canvas, in flow coordinates. */
function centerFlow(screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number }) {
	return screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
}

const SECTION_LABEL =
	'px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground';
const ROW_CLASS =
	'flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors';

/**
 * One box in the fullscreen rail: select, inline rename, and a hover menu with
 * Rename / Archive, matching Supernova's session rows.
 */
function BoxRow({
	card,
	active,
	onSelect,
}: {
	card: SessionCard;
	active: boolean;
	onSelect: () => void;
}) {
	const [menuOpen, setMenuOpen] = useState(false);
	const [renaming, setRenaming] = useState(false);
	const [draft, setDraft] = useState(card.title ?? '');
	const menuRef = useRef<HTMLDivElement>(null);
	const inputRef = useRef<HTMLInputElement>(null);

	const kind = card.kind ?? 'chat';
	const Icon = kind === 'document' ? FileText : kind === 'note' ? BookMarked : MessageSquare;
	const streaming = card.status === 'streaming';
	const pending = (card.boxInboxPending ?? 0) > 0;
	const label =
		card.title?.trim() || (kind === 'chat' ? 'Chat' : kind === 'note' ? 'Note' : 'Document');
	const noun = kind === 'chat' ? 'chat' : 'node';

	useEffect(() => {
		if (!menuOpen) return;
		const onDoc = (e: MouseEvent) => {
			if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setMenuOpen(false);
		};
		document.addEventListener('mousedown', onDoc);
		window.addEventListener('keydown', onKey, true);
		return () => {
			document.removeEventListener('mousedown', onDoc);
			window.removeEventListener('keydown', onKey, true);
		};
	}, [menuOpen]);

	const startRename = () => {
		setMenuOpen(false);
		setDraft(card.title ?? '');
		setRenaming(true);
		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});
	};

	const commitRename = () => {
		const next = draft.trim();
		setRenaming(false);
		if (next && next !== card.title) {
			useCanvasStore.getState().updateCard(card.id, { title: next.slice(0, 44) });
		}
	};

	const archive = () => {
		setMenuOpen(false);
		useCanvasStore.setState({ canvasNotice: `Archived “${label}”. Cmd/Ctrl+Z to restore.` });
		useCanvasStore.getState().deleteCards([card.id]);
	};

	return (
		<div className={cn('group/box relative', active && 'rounded-lg bg-primary/10')}>
			{renaming ? (
				<input
					ref={inputRef}
					value={draft}
					onChange={(e) => setDraft(e.target.value)}
					onBlur={commitRename}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === 'Enter') commitRename();
						else if (e.key === 'Escape') setRenaming(false);
					}}
					className="w-full rounded-lg border border-ring bg-background px-2 py-1 text-xs text-card-foreground outline-none"
				/>
			) : (
				<button
					type="button"
					aria-current={active ? 'true' : undefined}
					title={label}
					onClick={onSelect}
					className={cn(
						ROW_CLASS,
						active ? 'font-medium text-primary' : 'text-card-foreground hover:bg-secondary/70',
					)}
				>
					<Icon
						className={cn('size-3 shrink-0', active ? 'text-primary' : 'text-muted-foreground')}
						aria-hidden
					/>
					<span className="min-w-0 flex-1 truncate">{label}</span>
					<span className="flex shrink-0 items-center gap-1 group-hover/box:invisible">
						{streaming ? (
							<span
								className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-500"
								title="live"
							/>
						) : null}
						{pending ? (
							<span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-700 dark:text-amber-400">
								{card.boxInboxPending}
							</span>
						) : null}
					</span>
				</button>
			)}

			{!renaming && (
				<div ref={menuRef} className="absolute right-1 top-1/2 z-10 -translate-y-1/2">
					<button
						type="button"
						aria-label={`Actions for ${label}`}
						aria-expanded={menuOpen}
						onClick={(e) => {
							e.stopPropagation();
							setMenuOpen((v) => !v);
						}}
						className={cn(
							'grid size-5 place-items-center rounded text-muted-foreground transition-opacity hover:bg-secondary hover:text-foreground focus-visible:opacity-100',
							menuOpen ? 'opacity-100' : 'opacity-0 group-hover/box:opacity-100',
						)}
					>
						<MoreHorizontal className="size-3.5" />
					</button>
					{menuOpen && (
						<div className="absolute right-0 top-full z-50 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-border bg-card py-1 shadow-xl">
							<button
								type="button"
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-card-foreground hover:bg-secondary"
								onClick={startRename}
							>
								<Pencil className="size-3.5 text-muted-foreground" />
								Rename {noun}
							</button>
							<button
								type="button"
								className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-card-foreground hover:bg-secondary"
								onClick={archive}
							>
								<Archive className="size-3.5 text-muted-foreground" />
								Archive {noun}
							</button>
						</div>
					)}
				</div>
			)}
		</div>
	);
}

/**
 * Fullscreen rail — sized and spaced like the main navigation (same width, same
 * row density) so fullscreen feels like the same app, not a second one.
 *
 * Sections: New (chat / document / agent) → Nodes.
 */
export function CanvasBoxesSideNav({ currentCardId }: { currentCardId: string }) {
	const cards = useCanvasStore((s) => s.cards);
	const canvasName = useCanvasStore((s) => s.canvasName);
	const inboxOpen = useCanvasStore((s) => s.inboxOpen);
	const openInbox = useCanvasStore((s) => s.openInbox);
	const { screenToFlowPosition } = useReactFlow();
	const [agents, setAgents] = useState<AgentRow[]>([]);

	const items = [...cards].sort((a, b) => {
		const dy = a.position.y - b.position.y;
		if (Math.abs(dy) > 48) return dy;
		return a.position.x - b.position.x;
	});
	const totalPending = items.reduce((n, c) => n + (c.boxInboxPending ?? 0), 0);

	useEffect(() => {
		let alive = true;
		fetch('/agents')
			.then((r) => (r.ok ? r.json() : null))
			.then((d: { agents?: AgentRow[]; top?: string[] } | null) => {
				if (!alive || !d?.agents) return;
				const byId = new Map(d.agents.map((a) => [a.id, a]));
				const ordered =
					Array.isArray(d.top) && d.top.length > 0
						? d.top.map((id) => byId.get(id)).filter((a): a is AgentRow => !!a)
						: d.agents.slice(0, 5);
				setAgents(
					ordered.slice(0, 5).map((a) => ({ id: a.id, name: a.name, role: a.role ?? '' })),
				);
			})
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, []);

	const openNew = (id: string | null | undefined) => {
		if (id) useCanvasStore.getState().setMaximizedCardId(id);
	};

	// New boxes land beside the box you are viewing, not at the window centre
	// (which already holds a card). addCard still nudges if that spot is taken.
	const spawnNearCurrent = () => {
		const store = useCanvasStore.getState();
		const current = store.cards.find((c) => c.id === currentCardId);
		if (!current) return centerFlow(screenToFlowPosition);
		const size = currentSpawnSize();
		return findOpenSpot(store.cards, current.id, size.width, size.height);
	};

	const newChat = () => {
		useCanvasStore.getState().closeInbox();
		openNew(useCanvasStore.getState().addCard(spawnNearCurrent()));
	};
	const newDocument = () => {
		useCanvasStore.getState().closeInbox();
		void useCanvasStore.getState().createManualDocument(spawnNearCurrent()).then(openNew);
	};
	const newAgent = (profileId: string) => {
		useCanvasStore.getState().closeInbox();
		void useCanvasStore.getState().spawnAgentProfile(profileId, spawnNearCurrent()).then(openNew);
	};

	const select = (targetId: string) => {
		const store = useCanvasStore.getState();
		store.closeInbox();
		if (targetId === currentCardId) return;
		const target = cards.find((c) => c.id === targetId);
		if (!target) return;
		store.requestFocusCard(targetId);
		store.setMaximizedCardId(targetId);
	};

	const sectionLabel = SECTION_LABEL;
	const rowClass = ROW_CLASS;

	return (
		<aside
			aria-label="Canvas nodes"
			className="nodrag nowheel flex shrink-0 flex-col border-r border-border bg-surface"
			style={{ width: SIDEBAR_WIDTH }}
		>
			{/* Rail header — canvas identity + box count. */}
			<div className="flex h-14 shrink-0 items-center gap-2 border-b border-border/70 px-3">
				<Layers className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
				<div className="min-w-0 flex-1">
					<div
						className="truncate text-[13px] font-semibold leading-tight text-foreground"
						title={canvasName || 'Canvas'}
					>
						{canvasName || 'Canvas'}
					</div>
					<div className="text-[10px] leading-tight text-muted-foreground">
						{items.length} {items.length === 1 ? 'node' : 'nodes'}
					</div>
				</div>
			</div>

			{/* Inbox — one entry for the whole canvas, above the box list. */}
			<div className="shrink-0 px-2 pt-1">
				<button
					type="button"
					aria-current={inboxOpen ? 'page' : undefined}
					onClick={() => (inboxOpen ? useCanvasStore.getState().closeInbox() : openInbox(null))}
					className={cn(
						rowClass,
						inboxOpen
							? 'bg-primary/10 font-medium text-primary'
							: 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground',
					)}
				>
					<Inbox
						className={cn('size-3.5 shrink-0', inboxOpen ? 'text-primary' : 'text-muted-foreground')}
						aria-hidden
					/>
					<span className="min-w-0 flex-1 truncate">Inbox</span>
					{totalPending > 0 ? (
						<span className="shrink-0 rounded bg-amber-500/15 px-1 text-[9px] text-amber-700 dark:text-amber-400">
							{totalPending > 99 ? '99+' : totalPending}
						</span>
					) : null}
				</button>
			</div>

			{/* New — the create actions only (not the whole canvas menu). */}
			<div className="shrink-0 px-2 pb-1">
				<p className={sectionLabel}>New</p>
				<div className="flex flex-col gap-0.5">
					<button type="button" className={cn(rowClass, 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground')} onClick={newChat}>
						<MessageSquare className="size-3.5 shrink-0" aria-hidden />
						<span className="min-w-0 flex-1 truncate">New chat</span>
					</button>
					<button type="button" className={cn(rowClass, 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground')} onClick={newDocument}>
						<FileText className="size-3.5 shrink-0" aria-hidden />
						<span className="min-w-0 flex-1 truncate">New document</span>
					</button>
				</div>
				{agents.length > 0 ? (
					<>
						<p className={sectionLabel}>New agent</p>
						<div className="flex flex-col gap-0.5">
							{agents.map((a) => (
								<button
									key={a.id}
									type="button"
									className={cn(rowClass, 'text-muted-foreground hover:bg-secondary/70 hover:text-foreground')}
									title={a.role || a.id}
									onClick={() => newAgent(a.id)}
								>
									<Bot className="size-3.5 shrink-0" aria-hidden />
									<span className="min-w-0 flex-1 truncate">{a.name}</span>
								</button>
							))}
						</div>
					</>
				) : null}
			</div>

			<div className="mx-2 my-1 border-t border-border/70" />

			{/* Boxes — same row density as the main nav. */}
			<nav
				aria-label="Nodes"
				className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2"
				style={{ scrollbarWidth: 'thin' }}
			>
				<p className={sectionLabel}>Nodes</p>
				{items.length === 0 ? (
					<p className="px-2 py-2 text-[11px] text-muted-foreground">No nodes yet.</p>
				) : (
					<div className="flex flex-col gap-0.5">
						{items.map((c) => (
							<BoxRow
								key={c.id}
								card={c}
								active={c.id === currentCardId}
								onSelect={() => select(c.id)}
							/>
						))}
					</div>
				)}
			</nav>
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
