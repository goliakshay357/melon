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
import { useCanvasStore } from '@/store/canvas-store';

type AppNode = ChatCardNodeType;

export function Canvas() {
    const cards = useCanvasStore((s) => s.cards);
    const addCard = useCanvasStore((s) => s.addCard);
    const moveCard = useCanvasStore((s) => s.moveCard);
    const deleteCards = useCanvasStore((s) => s.deleteCards);
    const scrollAction = useCanvasStore((s) => s.scrollAction);
    const folder = useCanvasStore((s) => s.folder);
    const workspaceId = useCanvasStore((s) => s.workspaceId);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const saveWorkspace = useCanvasStore((s) => s.saveWorkspace);
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

    const nodeTypes = useMemo(() => ({ chatCard: ChatCardNode }), []);
    const edgeTypes = useMemo(() => ({ fork: ForkEdge }), []);

	// Restore last location (folder + workspace) on first mount.
	const restoredRef = useRef(false);
	useEffect(() => {
		if (restoredRef.current) return;
		const f = localStorage.getItem('melon:lastFolder');
		if (f && !folder) {
			restoredRef.current = true;
			openFolder(f);
		}
	}, [folder, openFolder]);

	// Autosave workspace (debounced).
	useEffect(() => {
		if (!workspaceId || !folder) return;
		const t = setTimeout(() => saveWorkspace(), 800);
		return () => clearTimeout(t);
	}, [cards, storedViewport, workspaceId, folder]);

	// Apply stored viewport once nodes exist after a workspace load.
	const appliedViewportFor = useRef<string | null>(null);
	const { setViewport: rfSetViewport } = useReactFlow();
	useEffect(() => {
		if (!storedViewport || appliedViewportFor.current === workspaceId) return;
		if (nodes.length === 0) return;
		appliedViewportFor.current = workspaceId ?? '';
		rfSetViewport(storedViewport);
	}, [nodes.length, workspaceId, storedViewport, rfSetViewport]);

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
    const onHeroSubmit = (text: string, cwd?: string) => {
        const el = wrapperRef.current;
        if (!el) return;
        const center = screenToFlowPosition({
            x: el.clientWidth / 2 - 190,
            y: el.clientHeight / 2 - 160,
        });
        const id = addCard(center);
        useCanvasStore.getState().sendMessage(id, text, cwd ? { cwd } : undefined);
    };

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

            {/* Folder chooser — very first screen */}
            {!folder ? (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <form
                        className="pointer-events-auto w-[420px] rounded-2xl border border-border bg-card/95 p-6 shadow-lg backdrop-blur"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const cwd = new FormData(e.currentTarget).get('cwd');
                            if (typeof cwd === 'string' && cwd.trim()) openFolder(cwd.trim());
                        }}
                    >
                        <h1 className="mb-1 text-center text-base font-semibold text-card-foreground">
                            🍉 Melon Canvas
                        </h1>
                        <p className="mb-4 text-center text-xs text-muted-foreground">
                            Choose a project folder. Workspaces & sessions live here.
                        </p>
                        <input
                            name="cwd"
                            autoFocus
                            defaultValue="~/Desktop/workspace/melon"
                            placeholder="/path/to/project or ~/path"
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                        />
                        <button
                            type="submit"
                            className="mt-3 w-full rounded-lg bg-primary py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
                        >
                            Open folder
                        </button>
                    </form>
                </div>
            ) : cards.length === 0 && (
                <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
                    <form
                        className="pointer-events-auto w-[420px] rounded-2xl border border-border bg-card/95 p-6 shadow-lg backdrop-blur"
                        onSubmit={(e) => {
                            e.preventDefault();
                            const fd = new FormData(e.currentTarget);
                            const input = fd.get('q');
                            const cwd = fd.get('cwd');
                            if (typeof input === 'string' && input.trim()) {
                                onHeroSubmit(
                                    input.trim(),
                                    typeof cwd === 'string' && cwd.trim() ? cwd.trim() : undefined,
                                );
                            }
                        }}
                    >
                        <h1 className="mb-3 text-center text-base font-semibold text-card-foreground">
                            What do you want to understand?
                        </h1>
                        <input
                            name="q"
                            autoFocus
                            placeholder="Ask anything…"
                            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring"
                        />
                        <input
                            name="cwd"
                            defaultValue="~/Desktop/workspace/melon"
                            placeholder="/path/to/project — where the agent works"
                            className="mt-2 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-xs outline-none focus:border-ring"
                        />
                    </form>
                </div>
            )}
        </div>
    );
}
