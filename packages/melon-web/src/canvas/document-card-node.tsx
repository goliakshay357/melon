import { memo as ReactMemo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Node, NodeProps, Position, NodeResizer } from '@xyflow/react';
import { Minimize2, Plus, RefreshCw, X } from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { DocumentEditor } from '@/components/document-editor';
import { confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';
import { MinimizedCardBar } from './minimized-card-bar';
import { CanvasBoxesSideNav, MaximizeIcon } from './canvas-boxes-side-nav';

export type DocumentCardNodeType = Node<{ cardId: string }, 'documentCard'>;

function DocumentCardNodeInner({ id, selected }: NodeProps<DocumentCardNodeType>) {
	const card = useCanvasStore((s) => s.cards.find((c) => c.id === id));
	const maximizedCardId = useCanvasStore((s) => s.maximizedCardId);
	const maximized = maximizedCardId === id;
	const [editingTitle, setEditingTitle] = useState(false);
	const editingTitleRef = useRef(false);
	editingTitleRef.current = editingTitle;
	const [editorEpoch, setEditorEpoch] = useState(0);

	// Seed once per mount / external version bump / fullscreen toggle.
	const seedRef = useRef<string | null>(null);
	const seedVersionRef = useRef<number | null>(null);
	if (card) {
		if (seedVersionRef.current === null) {
			seedVersionRef.current = card.documentVersion ?? 0;
			seedRef.current = card.documentContent ?? '';
		} else if ((card.documentVersion ?? 0) !== seedVersionRef.current) {
			seedVersionRef.current = card.documentVersion ?? 0;
			seedRef.current = card.documentContent ?? '';
		}
	}

	const setMaximized = useCallback(
		(next: boolean) => {
			const st = useCanvasStore.getState();
			void st.flushCardEdits(id);
			const latest = st.cards.find((c) => c.id === id);
			seedRef.current = latest?.documentContent ?? seedRef.current ?? '';
			setEditorEpoch((e) => e + 1);
			st.setMaximizedCardId(next ? id : null);
		},
		[id],
	);

	useEffect(() => {
		if (!card?.documentFile) return;
		let alive = true;
		void (async () => {
			try {
				const read = async (root: string) => {
					const r = await fetch(
						`/file?cwd=${encodeURIComponent(root)}&path=${encodeURIComponent(card.documentFile as string)}`,
					);
					return r.ok ? ((await r.json()) as { content: string; mtimeMs?: number }) : null;
				};
				const roots = [card.documentCwd, useCanvasStore.getState().folder ?? ''].filter(Boolean) as string[];
				let d: { content: string; mtimeMs?: number } | null = null;
				for (const root of roots) {
					d = await read(root);
					if (d) {
						if (root !== card.documentCwd) {
							useCanvasStore.getState().updateCard(id, { documentCwd: root });
						}
						break;
					}
				}
				if (!alive || !d) return;
				const latest = useCanvasStore.getState().cards.find((c) => c.id === id);
				// Don't clobber unsaved typing from a concurrent mount fetch.
				if (latest?.dirty) return;
				if (d.mtimeMs !== undefined && d.mtimeMs === latest?.documentMtimeMs) return;
				useCanvasStore.getState().updateCard(id, {
					documentContent: d.content,
					documentMtimeMs: d.mtimeMs,
					documentVersion: (latest?.documentVersion ?? card.documentVersion ?? 0) + 1,
					dirty: false,
				});
			} catch {
				/* keep local copy */
			}
		})();
		return () => {
			alive = false;
		};
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
			// Title rename wins: first Esc cancels the rename, second leaves fullscreen.
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
		(md: string) => useCanvasStore.getState().setDocumentBody(id, md),
		[id],
	);

	if (!card) return null;

	if (card.minimized) {
		return (
			<MinimizedCardBar
				title={card.title}
				selected={selected}
				leading={<span className="shrink-0 text-sm leading-none">📄</span>}
				onMaximize={() => useCanvasStore.getState().updateCard(id, { minimized: false })}
			/>
		);
	}

	const commitTitle = (raw: string) => {
		const t = raw.trim();
		if (!t || t === card.title) return;
		if (!card.documentFile) {
			useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
			return;
		}
		void (async () => {
			try {
				const renameIn = (root: string) =>
					fetch('/notes/manual/rename', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ cwd: root, path: card.documentFile, title: t }),
					});
				let res = await renameIn(card.documentCwd ?? useCanvasStore.getState().folder ?? '');
				if (res.status === 404 && card.documentCwd && card.documentCwd !== useCanvasStore.getState().folder) {
					res = await renameIn(useCanvasStore.getState().folder ?? '');
				}
				if (!res.ok) {
					useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
					return;
				}
				const d = (await res.json()) as { relPath: string; content: string; mtimeMs: number };
				useCanvasStore.getState().updateCard(id, {
					title: t.slice(0, 44),
					documentFile: d.relPath,
					documentContent: d.content,
					documentMtimeMs: d.mtimeMs,
					documentCwd: card.documentCwd ?? useCanvasStore.getState().folder ?? undefined,
					documentVersion: (card.documentVersion ?? 0) + 1,
				});
			} catch {
				useCanvasStore.getState().updateCard(id, { title: t.slice(0, 44) });
			}
		})();
	};

	const addLinkedCard = () => {
		useCanvasStore.getState().addLinkedCard(id);
	};

	const deleteDocument = async () => {
		const ok = await confirmAction({ title: 'Delete this document?' });
		if (!ok) return;
		const st = useCanvasStore.getState();
		await st.flushCardEdits(id);
		st.setMaximizedCardId(null);
		if (card.documentFile) {
			const root = card.documentCwd ?? st.folder ?? '';
			try {
				const res = await fetch('/notes/manual/delete', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ cwd: root, path: card.documentFile }),
				});
				if (!res.ok && res.status !== 404) {
					useCanvasStore.setState({
						canvasNotice: `Could not delete ${card.documentFile}.`,
					});
					return;
				}
			} catch {
				useCanvasStore.setState({
					canvasNotice: `Could not delete ${card.documentFile} (server unreachable).`,
				});
				return;
			}
		}
		st.deleteCards([id]);
		if (card.documentFile) st.purgeCardFromHistory([id]);
	};

	const header = (fullscreen: boolean) => (
		<div
			className={cn(
				'flex shrink-0 items-center gap-2 border-b border-border',
				fullscreen ? 'px-5 py-3 sm:px-8' : 'px-3 py-2',
			)}
		>
			{editingTitle ? (
				<input
					autoFocus
					defaultValue={card.title}
					title={card.documentFile ? `File name — renaming this renames ${card.documentFile}` : 'Card name'}
					className="nodrag min-w-0 flex-1 rounded border border-ring bg-background px-1.5 py-0.5 text-sm font-medium text-card-foreground outline-none"
					onBlur={(e) => {
						setEditingTitle(false);
						void commitTitle(e.target.value);
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === 'Enter') {
							const t = (e.target as HTMLInputElement).value;
							setEditingTitle(false);
							void commitTitle(t);
						} else if (e.key === 'Escape') {
							e.preventDefault();
							setEditingTitle(false);
						}
					}}
					onClick={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
				/>
			) : (
				<span
					className="min-w-0 flex-1 cursor-text truncate text-sm font-medium text-card-foreground"
					title="Double-click to rename"
					onDoubleClick={(e) => {
						e.stopPropagation();
						setEditingTitle(true);
					}}
				>
					{card.mailDraft ? '✉ ' : '📄 '}
					{card.title}
				</span>
			)}
			{card.documentFile ? (
				<button
					className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
					title="Reload this document from disk"
					onClick={(e) => {
						e.stopPropagation();
						void (async () => {
							const st = useCanvasStore.getState();
							await st.flushCardEdits(id);
							await st.refreshDocumentCard(id);
						})();
					}}
				>
					<RefreshCw className="size-4" />
				</button>
			) : null}
			<button
				className="nodrag rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-primary"
				onClick={(e) => {
					e.stopPropagation();
					addLinkedCard();
				}}
				title="Branch a new card from here (mind map)"
			>
				<Plus className="size-4" />
			</button>
			{fullscreen ? (
				<button
					type="button"
					className="nodrag flex items-center gap-1.5 rounded-md border border-border/80 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
					onClick={(e) => {
						e.stopPropagation();
						setMaximized(false);
					}}
					title="Back to canvas (Esc)"
				>
					<Minimize2 className="size-3.5" />
					Canvas
				</button>
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
						title="Delete document (removes the .md file)"
						onClick={(e) => {
							e.stopPropagation();
							void deleteDocument();
						}}
					>
						<X className="size-4" />
					</button>
				</>
			)}
		</div>
	);

	// The editor scales with the canvas like every other card. Pinch is owned by
	// canvas.tsx (ctrl+wheel → canvas zoom), so it never page-zooms the document.
	const editor = (
		<div
			className="nodrag nowheel h-full min-h-0"
			onBlur={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as HTMLElement | null)) {
					void useCanvasStore.getState().flushManualSave(id);
				}
			}}
		>
			<DocumentEditor
				key={`${card.documentFile ?? 'canvas'}:${card.documentVersion ?? 0}:${editorEpoch}`}
				cardId={id}
				initialContent={seedRef.current ?? ''}
				onMarkdownUpdate={card.documentFile ? onMarkdownUpdate : undefined}
			/>
		</div>
	);

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
					minHeight={220}
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
				{!maximized ? header(false) : null}
				{!maximized ? <div className="min-h-0 flex-1 overflow-hidden">{editor}</div> : <div className="min-h-0 flex-1" />}
			</div>

			{maximized &&
				createPortal(
					<div
						className="fixed inset-0 z-[999] flex flex-col bg-card"
						role="dialog"
						aria-modal="true"
						aria-label={card.title || 'Document'}
					>
						{header(true)}
						<div className="flex min-h-0 flex-1 overflow-hidden">
							<CanvasBoxesSideNav currentCardId={id} />
							<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 sm:px-8 lg:px-10">
								{editor}
							</div>
						</div>
					</div>,
					document.body,
				)}
		</>
	);
}

export const DocumentCardNode = ReactMemo(DocumentCardNodeInner);
