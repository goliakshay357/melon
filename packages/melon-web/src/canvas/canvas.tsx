import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    applyNodeChanges,
    Background,
    BackgroundVariant,
    MiniMap,
    ReactFlow,
    SelectionMode,
    useKeyPress,
    useReactFlow,
    type Edge,
    type NodeChange,
    type OnNodesDelete,
} from '@xyflow/react';
import { ChatCardNode, type ChatCardNodeType } from './chat-card-node';
import { ForkEdge } from './fork-edge';
import { Toolbar } from './toolbar';
import { Sidebar } from './sidebar';
import { TopBar } from './topbar';
import { useCanvasStore } from '@/store/canvas-store';

type AppNode = ChatCardNodeType;

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

    const [nodes, setNodes] = useState<AppNode[]>([]);
    const [theme, setTheme] = useState<'light' | 'dark'>(() =>
        (localStorage.getItem('melon:theme') as 'light' | 'dark') || 'light',
    );
    useEffect(() => {
        const onTheme = (e: Event) =>
            setTheme((e as CustomEvent<'light' | 'dark'>).detail);
        window.addEventListener('melon:theme', onTheme);
        return () => window.removeEventListener('melon:theme', onTheme);
    }, []);
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
    const shiftPressed = useKeyPress('Shift');
    const { screenToFlowPosition, fitView } = useReactFlow();
    const wrapperRef = useRef<HTMLDivElement>(null);

    // Reopen last session of work on refresh.
    const restoredRef = useRef(false);
    useEffect(() => {
        if (restoredRef.current) return;
        restoredRef.current = true;
        useCanvasStore.getState().restoreLast();
    }, []);

    const nodeTypes = useMemo(() => ({ chatCard: ChatCardNode }), []);
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

	// Capture viewport on move end for persistence.
	const onMoveEnd = useCallback(
		(_e: unknown, vp: { x: number; y: number; zoom: number }) =>
			useCanvasStore.getState().setViewport(vp),
		[],
	);

    // Sync store → RF nodes (preserving selection flags across rebuilds).
    useEffect(() => {
        setNodes((prev) => {
            const prevById = new Map(prev.map((n) => [n.id, n]));
            return cards.map(
                (c): AppNode => ({
                    id: c.id,
                    type: 'chatCard',
                    position: c.position,
                    data: { cardId: c.id },
                    style: {
                        width: c.size?.width ?? 380,
                        height: c.size?.height ?? 360,
                    },
                    selected: prevById.get(c.id)?.selected ?? false,
                }),
            );
        });
    }, [cards]);

    // Fork lineage → edges. Single source of truth: card.parentId.
    const edges = useMemo<Edge[]>(
        () =>
            cards
                .filter((c) => c.parentId)
                .map((c) => ({
                    id: `${c.parentId}->${c.id}`,
                    source: c.parentId as string,
                    target: c.id,
                    type: 'fork',
                })),
        [cards],
    );

    const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
        setNodes((nds) => applyNodeChanges(changes, nds));
    }, []);

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

    // Hero input when the canvas is empty — the "what do you want to understand?" moment.
    return (
        <div className="relative h-full w-full" ref={wrapperRef}>
            <ReactFlow
                onlyRenderVisibleElements
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onNodeDragStop={onNodeDragStop}
                onNodesDelete={onNodesDelete}
                minZoom={0.1}
                maxZoom={5}
                fitView={false}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                defaultEdgeOptions={{ type: 'fork' }}
                panOnScroll={scrollAction === 'pan'}
                zoomOnScroll={scrollAction === 'zoom'}
                snapToGrid={shiftPressed}
                snapGrid={[20, 20]}
                selectionMode={SelectionMode.Full}
                multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
                deleteKeyCode={['Backspace', 'Delete']}
                onPaneContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ x: e.clientX, y: e.clientY });
                }}
                onPaneClick={closeMenu}
                onMoveStart={closeMenu}
                onMoveEnd={onMoveEnd}
                colorMode={theme}
                proOptions={{ hideAttribution: true }}
            >
                <Background variant={BackgroundVariant.Dots} gap={16} size={1} color={theme === "dark" ? "#30363d" : "#d0d7de"} />
                <MiniMap
                    pannable
                    zoomable
                    className="!bottom-14"
                    nodeColor={() => 'hsl(152 32% 42% / 0.35)'}
                />
            </ReactFlow>

            <Sidebar />
            <TopBar />
            <Toolbar />

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
                        New card here
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
    );
}
