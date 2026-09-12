import { memo as ReactMemo, useCallback, useEffect, useRef, useState } from 'react';
import { Handle, Node, NodeProps, NodeResizer, Position } from '@xyflow/react';
import { BookMarked, Copy, Loader2, Minimize2, Plus, RefreshCw, RotateCcw, Send, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { DocumentEditor } from '@/components/document-editor';
import { MarkdownBlock } from '@/components/markdown-block';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';
import { MinimizedCardBar } from './minimized-card-bar';
import { MaximizeIcon } from './canvas-boxes-side-nav';
import { FullscreenExitButton, FullscreenShell } from './fullscreen-shell';

export type NoteCardNodeType = Node<{ cardId: string }, 'noteCard'>;

function NoteCardNodeInner({ id, selected }: NodeProps<NoteCardNodeType>) {
	const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
	const note = card?.note;
	const maximizedCardId = useCanvasStore((s) => s.maximizedCardId);
	const maximized = maximizedCardId === id;
	const [editingTitle, setEditingTitle] = useState(false);
	const editingTitleRef = useRef(false);
	editingTitleRef.current = editingTitle;
	const [editorEpoch, setEditorEpoch] = useState(0);
	const [refineText, setRefineText] = useState('');
	const refineInputRef = useRef<HTMLInputElement>(null);
	const setMaximized = useCallback(
		(next: boolean) => {
			const st = useCanvasStore.getState();
			void st.flushCardEdits(id);
			setEditorEpoch((e) => e + 1);
			st.setMaximizedCardId(next ? id : null);
		},
		[id],
	);

	useEffect(() => {
		if (!note?.artifactId) return;
		const store = useCanvasStore.getState();
		void store.hydrateNote(id);
		const onFocus = () => void store.hydrateNote(id);
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!maximized) return;
		const prevOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== 'Escape') return;
			e.preventDefault();
			e.stopPropagation();
			if (editingTitleRef.current) {
				setEditingTitle(false);
				return;
			}
			setMaximized(false);
		};
		window.addEventListener('keydown', onKey);
		return () => {
			document.body.style.overflow = prevOverflow;
			window.removeEventListener('keydown', onKey);
		};
	}, [maximized, setMaximized]);

	const onMarkdownUpdate = useCallback(
		(md: string) => useCanvasStore.getState().setNoteBody(id, md),
		[id],
	);

	if (!card || !note) return null;

	const state = note.state;
	const isMerge = note.noteKind === 'merge';

	if (card.minimized) {
		return (
			<MinimizedCardBar
				title={card.title}
				selected={selected}
				leading={
					<span className="flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
						<BookMarked className="size-3" />
						{isMerge ? 'merge' : 'ho'}
					</span>
				}
				onMaximize={() => useCanvasStore.getState().updateCard(id, { minimized: false })}
			/>
		);
	}
	const staleWires = note.wires.filter((w) => w.stale);
	const wireChips = note.wires.map((w) => ({
		...w,
		title: useCanvasStore.getState().cards.find((c) => c.id === w.cardId)?.title ?? w.cardId,
	}));

	const commitTitle = (raw: string) => {
		const t = raw.trim();
		if (!t || t === card.title) return;
		useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
		void useCanvasStore.getState().saveNoteEdits(id);
	};

	const submitRefine = () => {
		const instruction = refineText.trim();
		if (!instruction) return;
		setRefineText('');
		void useCanvasStore.getState().refineNote(id, instruction);
	};

	const header = (fullscreen: boolean) => (
		<div
			className={cn(
				'flex shrink-0 items-center gap-2 border-b border-border',
				fullscreen ? 'h-14 px-4' : 'px-3 py-2',
			)}
		>
			<span
				className="flex shrink-0 items-center gap-1 rounded bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
				title={isMerge ? 'Merged handoff note' : 'Handoff note — file-backed markdown artifact'}
			>
				<BookMarked className="size-3" />
				{isMerge ? 'merge' : 'ho'}
			</span>
			{editingTitle ? (
				<>
					<input
						autoFocus
						defaultValue={card.title}
						title="File name — Enter to rename the file"
						className="nodrag min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-medium text-card-foreground outline-none"
						onBlur={(e) => {
							setEditingTitle(false);
							commitTitle(e.target.value);
						}}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === 'Enter') {
								commitTitle((e.target as HTMLInputElement).value);
								setEditingTitle(false);
							} else if (e.key === 'Escape') {
								e.preventDefault();
								setEditingTitle(false);
							}
						}}
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.stopPropagation()}
					/>
					{note.path && note.path.includes('/') && (
						<span className="shrink-0 truncate text-[10px] text-muted-foreground" title={note.path}>
							{note.path.slice(0, note.path.lastIndexOf('/') + 1)}
						</span>
					)}
				</>
			) : (
				<span
					className="min-w-0 flex-1 cursor-pointer truncate text-sm font-medium text-card-foreground"
					title={`${note.path ?? 'file path pending'} — click to copy`}
					onClick={(e) => {
						e.stopPropagation();
						if (note.path) void navigator.clipboard.writeText(note.path);
					}}
					onDoubleClick={(e) => {
						e.stopPropagation();
						setEditingTitle(true);
					}}
				>
					{(() => {
						const folder = useCanvasStore.getState().folder;
						if (!note.path) return `${card.title}`;
						return folder && note.path.startsWith(`${folder}/`)
							? note.path.slice(folder.length + 1)
							: note.path;
					})()}
				</span>
			)}
			{state === 'ready' && note.model && (
				<span
					className="max-w-[120px] shrink-0 cursor-help truncate rounded bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
					title={`Distilled with ${note.model}`}
				>
					⚡ {note.model.split('/').pop()?.slice(0, 20)}
				</span>
			)}
			{state === 'ready' && note.revision > 0 && (
				<span
					className={cn(
						'shrink-0 rounded px-1.5 py-0.5 text-[10px] tabular-nums',
						note.dirty ? 'bg-amber-500/15 text-amber-500' : 'bg-secondary text-muted-foreground',
					)}
					title={note.dirty ? 'Unsaved edits' : `Revision ${note.revision}`}
				>
					r{note.revision}
					{note.dirty ? ' ·' : ''}
				</span>
			)}
			<button
				className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
				disabled={state !== 'ready' || !note.artifactId}
				onClick={(e) => {
					e.stopPropagation();
					void useCanvasStore.getState().regenerateNote(id);
				}}
				title="Regenerate from the pinned source (diff before accept)"
			>
				<RotateCcw className="size-3.5" />
			</button>
			<button
				className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
				disabled={state !== 'ready'}
				onClick={(e) => {
					e.stopPropagation();
					void navigator.clipboard.writeText(note.body);
				}}
				title="Copy markdown"
			>
				<Copy className="size-3.5" />
			</button>
			<button
				className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
				disabled={state !== 'ready' || !note.artifactId}
				onClick={(e) => {
					e.stopPropagation();
					void useCanvasStore.getState().wireNoteToNewCard(id);
				}}
				title="Spawn a new card seeded with this handoff"
			>
				<Plus className="size-4" />
			</button>
			{fullscreen ? (
				<FullscreenExitButton onExit={() => setMaximized(false)} />
			) : (
				<>
					<button
						className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
						onClick={(e) => {
							e.stopPropagation();
							setMaximized(false);
							useCanvasStore.getState().updateCard(id, { minimized: true });
						}}
						title="Minimize to title strip"
					>
						<Minimize2 className="size-4" />
					</button>
					<button
						className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
						onClick={(e) => {
							e.stopPropagation();
							setMaximized(true);
						}}
						title="Full screen"
					>
						<MaximizeIcon />
					</button>
					<button
						className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-red-500"
						title="Delete note (artifact file moves to .trash)"
						onClick={async () => {
							const ok = await confirmAction({
								title: 'Delete this note?',
								description:
									'The artifact file moves to .melon/notes/handoff/.trash. Cards already seeded keep their copy.',
								confirmLabel: 'Delete',
							});
							if (!ok) return;
							const st = useCanvasStore.getState();
							await st.flushCardEdits(id);
							st.setMaximizedCardId(null);
							st.deleteCards([id]);
						}}
					>
						<X className="size-4" />
					</button>
				</>
			)}
		</div>
	);

	let body: React.ReactNode;
	if (state === 'generating') {
		body = (
			<div className="flex h-full min-h-0 flex-col">
				<div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 text-[11px] text-muted-foreground">
					<Loader2 className="size-3.5 animate-spin" />
					<span className="min-w-0 truncate">{note.statusLine ?? 'Working…'}</span>
				</div>
				<div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-xs">
					{note.body ? (
						<MarkdownBlock content={note.body} streaming />
					) : (
						<p className="text-muted-foreground">
							{isMerge ? 'Distilling sources…' : 'Reading the conversation…'}
						</p>
					)}
				</div>
			</div>
		);
	} else if (state === 'error' && !note.bodyLoaded) {
		body = (
			<div className="flex h-full flex-col items-center justify-center gap-3 px-4 text-center">
				<p className="text-xs text-red-500">{note.error ?? 'Generation failed.'}</p>
				<button
					className="nodrag flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-secondary hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						void useCanvasStore.getState().retryHandoff(id);
					}}
				>
					<RotateCcw className="size-3.5" /> Retry
				</button>
			</div>
		);
	} else if (!note.bodyLoaded) {
		body = (
			<div className="flex h-full items-center justify-center text-xs text-muted-foreground">
				<Loader2 className="size-4 animate-spin" />
			</div>
		);
	} else {
		// Freeze seed per bodyVersion so fullscreen never remounts from store
		// chatter; generation→ready mounts once with the final streamed body.
		body = (
			<DocumentEditor
				key={`${note.artifactId}:${note.bodyVersion ?? 0}:${editorEpoch}`}
				cardId={id}
				initialContent={note.body}
				onMarkdownUpdate={onMarkdownUpdate}
			/>
		);
	}

	const wiresBar =
		state === 'ready' && wireChips.length > 0 ? (
			<div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-1.5">
				{wireChips.map((w) => (
					<button
						key={`${w.cardId}:${w.deliveredAt ?? ''}`}
						className={cn(
							'nodrag rounded px-1.5 py-0.5 text-[10px] transition-colors',
							w.stale
								? 'bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400'
								: w.status === 'delivered'
									? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
									: w.status === 'queued'
										? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
										: 'bg-red-500/10 text-red-500',
						)}
						onClick={(e) => {
							e.stopPropagation();
							if (w.stale) void useCanvasStore.getState().wireNoteToExisting(id, w.cardId);
						}}
						title={
							w.stale
								? `Update ${w.title} to the current body (was ${w.mode} r${w.revision})`
								: `${w.mode} · r${w.revision} · ${w.status}${
										w.deliveredAt ? ` · ${new Date(w.deliveredAt).toLocaleTimeString()}` : ''
									}`
						}
					>
						{w.stale && <RefreshCw className="mr-0.5 inline size-2.5" />}
						{w.stale ? 'update ' : '→ '}
						{w.title}
					</button>
				))}
				{staleWires.length > 1 && (
					<button
						className="nodrag rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 hover:bg-amber-500/20 dark:text-amber-400"
						onClick={(e) => {
							e.stopPropagation();
							void useCanvasStore.getState().sendAllNoteUpdates(id);
						}}
						title="Send the current body to every stale target"
					>
						update all ({staleWires.length})
					</button>
				)}
			</div>
		) : null;

	const errorBar =
		state === 'ready' && note.error ? (
			<div className="flex shrink-0 items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
				<span className="min-w-0 truncate" title={note.error}>
					{note.error}
				</span>
				<span className="flex shrink-0 gap-1">
					<button
						className="nodrag rounded px-1.5 py-0.5 hover:bg-secondary"
						onClick={(e) => {
							e.stopPropagation();
							void useCanvasStore.getState().hydrateNote(id, { force: true });
						}}
					>
						Reload
					</button>
					<button
						className="nodrag rounded px-1.5 py-0.5 hover:bg-secondary"
						onClick={(e) => {
							e.stopPropagation();
							void useCanvasStore.getState().saveNoteEdits(id, { force: true });
						}}
					>
						Keep mine
					</button>
				</span>
			</div>
		) : null;

	const mainBody = (
		<div
			className="nodrag nowheel min-h-0 flex-1"
			onBlur={(e) => {
				if (note.dirty && !e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) {
					void useCanvasStore.getState().saveNoteEdits(id);
				}
			}}
		>
			{body}
		</div>
	);

	const refineBar =
		state === 'ready' ? (
			<div className="flex shrink-0 items-center gap-1.5 border-t border-border px-2 py-1.5">
				<input
					ref={refineInputRef}
					value={refineText}
					onChange={(e) => setRefineText(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === 'Enter') submitRefine();
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
					placeholder="Refine with AI — e.g. “only add, don't rewrite: …”"
					className="nodrag min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] outline-none focus:border-ring"
				/>
				<button
					className="nodrag flex shrink-0 items-center rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary disabled:opacity-40"
					disabled={!refineText.trim()}
					onClick={(e) => {
						e.stopPropagation();
						submitRefine();
					}}
					title="Propose an AI edit (diff before it is applied)"
				>
					<Send className="size-3.5" />
				</button>
			</div>
		) : null;

	const readyEditor = state === 'ready' || note.bodyLoaded;

	return (
		<>
			<div
				className={cn(
					'flex h-full w-full flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow',
					selected ? 'border-ring shadow-md ring-2 ring-ring/30' : 'border-border',
					maximized && 'invisible',
				)}
			>
				<NodeResizer
					isVisible={selected && !maximized}
					minWidth={320}
					minHeight={260}
					lineClassName="!border-primary/50"
					handleClassName="!h-2 !w-2 !rounded-sm !border-primary/60 !bg-white"
					onResizeStart={() => useCanvasStore.getState().beginCardGesture()}
					onResizeEnd={(_e, params) => useCanvasStore.getState().resizeCard(id, params.width, params.height)}
				/>
				<Handle type="target" position={Position.Top} className="!opacity-0" />
				<Handle type="target" position={Position.Bottom} className="!opacity-0" />
				<Handle type="target" position={Position.Left} className="!opacity-0" />
				<Handle type="target" position={Position.Right} className="!opacity-0" />
				<Handle type="source" position={Position.Top} className="!opacity-0" />
				<Handle type="source" position={Position.Bottom} className="!opacity-0" />
				<Handle type="source" position={Position.Left} className="!opacity-0" />
				<Handle type="source" position={Position.Right} className="!opacity-0" />
				{!maximized ? (
					<>
						{header(false)}
						{wiresBar}
						{errorBar}
						{mainBody}
						{refineBar}
					</>
				) : (
					<div className="min-h-0 flex-1" />
				)}
			</div>

			{maximized && (
				<FullscreenShell
					cardId={id}
					ariaLabel={card.title || 'Note'}
					header={header(true)}
					banners={
						<>
							{wiresBar}
							{errorBar}
						</>
					}
				>
					<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
						{mainBody}
						{readyEditor ? refineBar : null}
					</div>
				</FullscreenShell>
			)}
		</>
	);
}

export const NoteCardNode = ReactMemo(NoteCardNodeInner);
