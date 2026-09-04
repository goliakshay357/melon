import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    applyNodeChanges,
    Background,
    BackgroundVariant,
    ReactFlow,
    SelectionMode,
    useKeyPress,
    useReactFlow,
    type Edge,
    type NodeChange,
    type OnNodesDelete,
} from '@xyflow/react';
import { ChatCardNode, type ChatCardNodeType } from './chat-card-node';
import { DocumentCardNode, type DocumentCardNodeType } from './document-card-node';
import { ForkEdge } from './fork-edge';
import { EmptyCanvasHero } from './empty-canvas-hero';
import { Toolbar } from './toolbar';
import { Sidebar } from './sidebar';
import { VizFullscreenLayer } from '@/components/viz-fullscreen-layer';
// import { TopBar } from './topbar';  // DISABLED — re-enable later
import { useCanvasStore, currentSpawnSize } from '@/store/canvas-store';
import { focusViewport, isFullyVisible, SIDEBAR_COLLAPSED_WIDTH, SIDEBAR_WIDTH, type WorldRect } from '@/lib/spawn';
import { useActiveTheme } from '@/theme/theme-store';
import { SettingsPage } from '@/settings/settings-page';
import { isTypingTarget } from '@/lib/utils';
import { DEFAULT_CARD_SIZE } from '@/types/session-card';

type AppNode = ChatCardNodeType | DocumentCardNodeType;

export function Canvas() {
    const cards = useCanvasStore((s) => s.cards);
    const addCard = useCanvasStore((s) => s.addCard);
    const moveCard = useCanvasStore((s) => s.moveCard);
    const deleteCards = useCanvasStore((s) => s.deleteCards);
    const scrollAction = useCanvasStore((s) => s.scrollAction);
    const folder = useCanvasStore((s) => s.folder);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const saveCanvas = useCanvasStore((s) => s.saveCanvas);
    const storedViewport = useCanvasStore((s) => s.viewport);
    const hydrated = useCanvasStore((s) => s.hydrated);
    const serverOffline = useCanvasStore((s) => s.serverOffline);
    const canvasOpening = useCanvasStore((s) => s.canvasOpening);

    const [nodes, setNodes] = useState<AppNode[]>([]);
    const theme = useActiveTheme();
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const shiftPressed = useKeyPress('Shift');
    const { screenToFlowPosition, fitView } = useReactFlow();
    const wrapperRef = useRef<HTMLDivElement>(null);
    const activeView = useCanvasStore((s) => s.activeView);
    const sidebarCollapsed = useCanvasStore((s) => s.sidebarCollapsed);

    // Reopen last session of work on refresh.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        useCanvasStore.getState().restoreLast();
        useCanvasStore.getState().startHealthPoll();
    }, []);

    const nodeTypes = useMemo(() => ({ chatCard: ChatCardNode, documentCard: DocumentCardNode }), []);
    const edgeTypes = useMemo(() => ({ fork: ForkEdge }), []);

	// Autosave workspace (debounced).
	useEffect(() => {
		if (!canvasId || !folder) return;
		const t = setTimeout(() => saveCanvas(), 800);
		return () => clearTimeout(t);
	}, [cards, storedViewport, canvasId, folder]);

	// Apply stored viewport once nodes exist after a workspace load.
	const appliedViewportFor = useRef<string | null>(null);
	const { setViewport: rfSetViewport } = useReactFlow();
	useEffect(() => {
		if (!storedViewport || appliedViewportFor.current === canvasId) return;
		if (nodes.length === 0) return;
		appliedViewportFor.current = canvasId ?? '';
		rfSetViewport(storedViewport);
	}, [nodes.length, canvasId, storedViewport, rfSetViewport]);

	// Track focus in editors/inputs so canvas delete/undo never steal from them.
	const [typingFocus, setTypingFocus] = useState(() => isTypingTarget(document.activeElement));
	useEffect(() => {
		const sync = () => setTypingFocus(isTypingTarget(document.activeElement));
		window.addEventListener('focusin', sync);
		window.addEventListener('focusout', sync);
		sync();
		return () => {
			window.removeEventListener('focusin', sync);
			window.removeEventListener('focusout', sync);
		};
	}, []);

	// Cmd/Ctrl+Z / Shift+Z / Y — canvas layout undo/redo.
	// While focus is in an editor/input, leave the event alone (Milkdown history
	// or the browser's native text undo/redo owns it).
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (useCanvasStore.getState().activeView !== 'canvas') return;
			if (!(e.metaKey || e.ctrlKey)) return;
			const key = e.key.toLowerCase();
			if (key !== 'z' && key !== 'y') return;
			if (isTypingTarget(e.target) || isTypingTarget(document.activeElement)) return;

			const wantRedo = key === 'y' || (key === 'z' && e.shiftKey);
			e.preventDefault();
			e.stopPropagation();
			if (wantRedo) useCanvasStore.getState().redo();
			else useCanvasStore.getState().undo();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);

	// Flush stream batches + save on tab close/refresh — no tail loss.
	useEffect(() => {
		const onLeave = () => {
			useCanvasStore.getState().flushPending();
			useCanvasStore.getState().saveCanvas();
		};
		window.addEventListener('pagehide', onLeave);
		return () => window.removeEventListener('pagehide', onLeave);
	}, []);

	// Capture viewport on move end for persistence.
	const onMoveEnd = useCallback(
		(_e: unknown, vp: { x: number; y: number; zoom: number }) =>
			useCanvasStore.getState().setViewport(vp),
		[],
	);

    // Sync store → RF nodes.
    // PERF: node objects are reused when nothing visual changed, and if NO
    // node changed at all we hand React Flow the same array reference —
    // streaming deltas then cause zero re-renders of the flow/minimap.
    useEffect(() => {
        setNodes((prev) => {
            const prevById = new Map(prev.map((n) => [n.id, n]));
            const next = cards.map(
                (c): AppNode => {
                    const old = prevById.get(c.id);
                    const width = c.size?.width ?? DEFAULT_CARD_SIZE.width;
                    const height = c.size?.height ?? DEFAULT_CARD_SIZE.height;
                    if (
                        old &&
                        old.position.x === c.position.x &&
                        old.position.y === c.position.y &&
                        old.style?.width === width &&
                        old.style?.height === height
                    ) {
                        return old;
                    }
                    return {
                        id: c.id,
                        type: (c.kind === 'document' ? 'documentCard' : 'chatCard') as AppNode['type'],
                        position: c.position,
                        data: { cardId: c.id },
                        style: { width, height },
                        selected: old?.selected ?? false,
                    };
                },
            );
            if (
                prev.length === next.length &&
                next.every((n, i) => prev[i] === n)
            ) {
                return prev;
            }
            return next;
        });
    }, [cards]);

    // Reveal a newly added card when it lands (partially) outside the view.
    // Only single-card adds trigger this — canvas restores hydrate many at once
    // and must not fight the stored viewport.
    const knownCardIdsRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        const prev = knownCardIdsRef.current;
        const added = cards.filter((c) => !prev.has(c.id));
        knownCardIdsRef.current = new Set(cards.map((c) => c.id));
        if (added.length !== 1) return;
        const state = useCanvasStore.getState();
        if (state.canvasOpening || activeView !== 'canvas') return;
        const card = added[0];
        const rect: WorldRect = {
            left: card.position.x,
            top: card.position.y,
            right: card.position.x + (card.size?.width ?? DEFAULT_CARD_SIZE.width),
            bottom: card.position.y + (card.size?.height ?? DEFAULT_CARD_SIZE.height),
        };
        const vp = state.viewport ?? { x: 0, y: 0, zoom: 1 };
        const screen = {
            left: sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH,
            top: 0,
            width: window.innerWidth,
            height: window.innerHeight,
        };
        if (isFullyVisible(rect, vp, screen)) return;
        void rfSetViewport(focusViewport(rect, vp, screen), { duration: 300 });
    }, [cards, activeView, sidebarCollapsed, rfSetViewport]);

    // Fork lineage → edges. Single source of truth: card.parentId.
    const edges = useMemo<Edge[]>(
        () =>
            cards
                .filter((c) => c.parentId)
                .map((c) => {
                    const parent = cards.find((x) => x.id === c.parentId);
                    return {
                        id: `${c.parentId}->${c.id}`,
                        source: c.parentId as string,
                        target: c.id,
                        type: 'fork',
                        data: {
                            sourceSide: c.edgeToParent?.sourceSide,
                            sourceT: c.edgeToParent?.sourceT,
                            targetSide: c.edgeToParent?.targetSide,
                            targetT: c.edgeToParent?.targetT,
                            // Pass positions so React Flow re-renders the edge on ANY card move.
                            srcBox: parent
                                ? { x: parent.position.x, y: parent.position.y, w: parent.size?.width ?? DEFAULT_CARD_SIZE.width, h: parent.size?.height ?? DEFAULT_CARD_SIZE.height }
                                : null,
                            tgtBox: { x: c.position.x, y: c.position.y, w: c.size?.width ?? DEFAULT_CARD_SIZE.width, h: c.size?.height ?? DEFAULT_CARD_SIZE.height },
                        },
                    };
                }),
        [cards],
    );

    const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
    }, []);

    // Sync position to the store DURING drag so connected edges follow live.
    // One undo step per gesture: snapshot on drag start only.
    const onNodeDragStart = useCallback(() => {
        useCanvasStore.getState().beginCardGesture();
    }, []);
    const onNodeDrag = useCallback(
        (_e: unknown, node: AppNode) => moveCard(node.id, node.position),
        [moveCard],
    );

    const onNodeDragStop = useCallback(
        (_e: unknown, node: AppNode) => moveCard(node.id, node.position),
        [moveCard],
    );

    const onNodesDelete: OnNodesDelete<AppNode> = useCallback(
        (deleted) => deleteCards(deleted.map((n) => n.id)),
        [deleteCards],
    );

    const closeMenu = useCallback(() => setMenu(null), []);
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') closeMenu();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [closeMenu]);

    const newCardHere = useCallback(() => {
        if (!menu) return;
        addCard(screenToFlowPosition(menu));
        setMenu(null);
    }, [menu, addCard, screenToFlowPosition]);

    const bounds = wrapperRef.current?.getBoundingClientRect();
    const sidebarWidth = sidebarCollapsed ? SIDEBAR_COLLAPSED_WIDTH : SIDEBAR_WIDTH;
    const spawn = currentSpawnSize();
    const heroCenter = screenToFlowPosition({
        x: sidebarWidth + ((bounds?.width ?? window.innerWidth) - sidebarWidth) / 2,
        y: (bounds?.height ?? window.innerHeight) / 2,
    });
    const heroCardPosition = {
        x: heroCenter.x - spawn.width / 2,
        y: heroCenter.y - spawn.height / 2,
    };

    return (
        <div className="relative h-full w-full" ref={wrapperRef}>
            {/* Canvas layer — stays mounted so streams/iframes survive page swaps;
                hidden while a Settings page fills the content area. */}
            <div className={`absolute inset-0 ${activeView !== 'canvas' ? 'invisible' : ''}`}>
            <ReactFlow
                onlyRenderVisibleElements
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onNodeDragStart={onNodeDragStart}
                onNodeDrag={onNodeDrag}
                onNodeDragStop={onNodeDragStop}
                onNodesDelete={onNodesDelete}
                minZoom={0.1}
                maxZoom={5}
                fitView={false}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: 'fork' }}
                edgesReconnectable={false}
                panOnScroll={scrollAction === 'pan'}
                zoomOnScroll={scrollAction === 'zoom'}
                snapToGrid={shiftPressed}
                snapGrid={[20, 20]}
                selectionMode={SelectionMode.Full}
                multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                // Null while typing so Backspace/Delete edit text, not delete cards.
                deleteKeyCode={typingFocus ? null : ['Backspace', 'Delete']}
                onPaneContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY });
                }}
                onPaneClick={closeMenu}
                onMoveStart={closeMenu}
                onMoveEnd={onMoveEnd}
                colorMode={theme.appearance}
                proOptions={{ hideAttribution: true }}
            >
                {cards.length > 0 && (
                    <Background
                        variant={BackgroundVariant.Dots}
                        gap={16}
                        size={1}
                        color={theme.tokens.canvasDot}
                    />
                )}
            </ReactFlow>

            {cards.length === 0 && !canvasOpening && (
                <EmptyCanvasHero
                    position={heroCardPosition}
                    hydrated={hydrated}
                    serverOffline={serverOffline}
                />
            )}

            {/* <TopBar /> DISABLED — re-enable later */}
            {cards.length > 0 && <Toolbar />}

            {/* Right-click context menu */}
            {menu && (
                <div
                    className="fixed z-20 w-44 rounded-lg border border-border bg-card py-1 text-xs shadow-md"
                    style={{ left: menu.x, top: menu.y }}
                >
                    <button
                        className="block w-full px-3 py-1.5 text-left text-card-foreground hover:bg-secondary"
                        onClick={newCardHere}
                    >
                        💬 New chat card
                    </button>
                    <button
                        className="block w-full px-3 py-1.5 text-left text-card-foreground hover:bg-secondary"
                        onClick={() => {
                            if (!menu) return;
                            addCard(screenToFlowPosition(menu), null, undefined, 'document');
                            setMenu(null);
                        }}
                    >
                        📄 New document
                    </button>
                    <button
                        className="block w-full px-3 py-1.5 text-left text-card-foreground hover:bg-secondary"
                        onClick={() => {
                            fitView({ padding: 0.2, duration: 300 });
                            setMenu(null);
                        }}
                    >
                        Fit view
                    </button>
                </div>
            )}

            </div>

            {/* Navbar — ALWAYS visible; its body swaps between canvas/settings */}
            <Sidebar />

            {/* Fullscreen viz layer — one global portal (z-1000). Renders the
                promoted iframe node from any card; auto-closes off-canvas. */}
            <VizFullscreenLayer />

            {/* Settings PAGE (never a dialog) — fills the content area right of the navbar */}
            {activeView !== 'canvas' && (
                <div
                    className="absolute inset-y-0 right-0 transition-[left] duration-200"
                    style={{ left: sidebarCollapsed ? 48 : 260 }}
                >
                    <SettingsPage />
                </div>
            )}
        </div>
    );
}
