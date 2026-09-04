import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
    ChevronRight,
    FileText,
    FolderOpen,
    FolderPlus,
    Layers,
    MessageSquare,
    PanelLeftClose,
    PanelLeftOpen,
    Plus,
    Search,
    Settings,
    X,
} from 'lucide-react';
import { useCanvasStore } from '@/store/canvas-store';
import { askText, askChoice, confirmAction } from '@/components/dialogs';
import { cn } from '@/lib/utils';
import { fuzzyMatchIndices, fuzzyScore } from '@/lib/fuzzy';
import { pickFolder } from '@/lib/pick-folder';
import { Sparkles, Palette } from 'lucide-react';

type CanvasListItem = {
    id: string;
    name: string;
    cwd: string;
    folderName: string;
    modified: string;
    worktreeMode?: 'isolated' | 'local';
    worktreeName?: string;
};

type CanvasSearchMatchKind = 'title' | 'card' | 'message' | 'document';

type CanvasSearchHit = CanvasListItem & {
    match?: CanvasSearchMatchKind;
    score?: number;
    snippet?: string;
    cardId?: string;
    cardTitle?: string;
};

function matchKindLabel(kind: CanvasSearchMatchKind | undefined): string | null {
    if (kind === 'card') return 'Card';
    if (kind === 'message') return 'Message';
    if (kind === 'document') return 'Document';
    return null;
}

function formatModified(iso: string): string {
    if (!iso) return '';
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return '';
    const diff = Date.now() - t;
    if (diff < 60_000) return 'just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`;
    return new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function HighlightMatch({ text, query }: { text: string; query: string }): ReactNode {
    const q = query.trim();
    if (!q) return text;
    const indices = fuzzyMatchIndices(q, text);
    if (!indices || indices.length === 0) return text;
    const set = new Set(indices);
    const parts: ReactNode[] = [];
    let buf = '';
    let inMark = false;
    const flush = (marked: boolean, key: number) => {
        if (!buf) return;
        if (marked) {
            parts.push(
                <mark key={key} className="rounded-sm bg-primary/20 px-0.5 text-inherit">
                    {buf}
                </mark>,
            );
        } else {
            parts.push(<span key={key}>{buf}</span>);
        }
        buf = '';
    };
    for (let i = 0; i < text.length; i++) {
        const marked = set.has(i);
        if (i === 0) inMark = marked;
        else if (marked !== inMark) {
            flush(inMark, i);
            inMark = marked;
        }
        buf += text[i];
    }
    flush(inMark, text.length);
    return <>{parts}</>;
}

export function Sidebar() {
    const collapsed = useCanvasStore((s) => s.sidebarCollapsed);
    const setCollapsed = useCanvasStore((s) => s.setSidebarCollapsed);
    const [folders, setFolders] = useState<Array<{ cwd: string; lastOpenedAt: string }>>([]);
    const [tree, setTree] = useState<Record<string, { canvases: any[]; loose: any[] }>>({});
    const [openFolders, setOpenFolders] = useState<Set<string>>(new Set());
    const [openCanvasSessions, setOpenCanvasSessions] = useState<Set<string>>(new Set());
    const [pickingNative, setPickingNative] = useState(false);
    const activeView = useCanvasStore((s) => s.activeView);
    const setActiveView = useCanvasStore((s) => s.setActiveView);
    const openView = (v: 'skills' | 'themes') => {
        setActiveView(v);
    };
    const [recent, setRecent] = useState<CanvasListItem[]>([]);
    const [switchingCanvasId, setSwitchingCanvasId] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [searchResults, setSearchResults] = useState<CanvasSearchHit[]>([]);
    const [searchStatus, setSearchStatus] = useState<'idle' | 'loading' | 'error'>('idle');
    const searchInputRef = useRef<HTMLInputElement>(null);

    const folder = useCanvasStore((s) => s.folder);
    const worktreePath = useCanvasStore((s) => s.worktreePath);
    const worktreeMode = useCanvasStore((s) => s.worktreeMode);
    const branch = useCanvasStore((s) => s.branch);
    const canvasId = useCanvasStore((s) => s.canvasId);
    const canvasActivity = useCanvasStore((s) => s.canvasActivity);
    const createCanvasInFolder = useCanvasStore((s) => s.createCanvasInFolder);
    const openCanvas = useCanvasStore((s) => s.openCanvas);
    const openFolder = useCanvasStore((s) => s.openFolder);
    const resumeSession = useCanvasStore((s) => s.resumeSession);
    const forgetCanvas = useCanvasStore((s) => s.forgetCanvas);
    const canvasTreeRev = useCanvasStore((s) => s.canvasTreeRev);
    const [appVersion, setAppVersion] = useState<string | null>(null);
    const [cwdCopied, setCwdCopied] = useState(false);
    const cwdCopiedTimerRef = useRef<number | null>(null);

    // Same identity as Melon-<version>-<arch>.dmg — always visible in the navbar.
    useEffect(() => {
        let alive = true;
        fetch('/healthz', { cache: 'no-store' })
            .then((r) => (r.ok ? r.json() : null))
            .then((body: { version?: unknown } | null) => {
                if (!alive) return;
                const v = typeof body?.version === 'string' ? body.version.trim() : '';
                setAppVersion(v || null);
            })
            .catch(() => {
                if (alive) setAppVersion(null);
            });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        return () => {
            if (cwdCopiedTimerRef.current != null) window.clearTimeout(cwdCopiedTimerRef.current);
        };
    }, []);

    const loadTree = useCallback(async () => {
        try {
            const fr = await fetch(`/folders`).then((r) => r.json());
            const list = (fr.folders ?? []) as Array<{ cwd: string; lastOpenedAt: string }>;
            setFolders(list);
            const entries = await Promise.all(
                list.map(async (f) => {
                    const tr = await fetch(
                        `/tree?cwd=${encodeURIComponent(f.cwd)}`,
                    ).then((r) => r.json());
                    return [f.cwd, { canvases: tr.canvases ?? [], loose: tr.loose ?? [] }] as const;
                }),
            );
            setTree(Object.fromEntries(entries));
        } catch {
            /* server down */
        }
    }, []);

    useEffect(() => {
        loadTree();
        fetch(`/canvases/recent`)
            .then((r) => r.json())
            .then((d) => setRecent(d.recent ?? []))
            .catch(() => {});
        // canvasId alone used to refetch before touch finished and clobber Recent order.
        // Open/rename/delete/create bump canvasTreeRev after disk is updated.
    }, [loadTree, folder, canvasTreeRev]);

    useEffect(() => {
        const t = window.setTimeout(() => setDebouncedQuery(searchQuery.trim()), 120);
        return () => window.clearTimeout(t);
    }, [searchQuery]);

    /** Instant fuzzy over the already-loaded navigator tree (titles + folder names). */
    const localTitleHits = useCallback(
        (q: string): CanvasSearchHit[] => {
            if (!q) return [];
            const hits: CanvasSearchHit[] = [];
            for (const [cwd, entry] of Object.entries(tree)) {
                const folderName = cwd.split('/').pop() ?? cwd;
                for (const cv of entry.canvases ?? []) {
                    const name =
                        typeof cv.name === 'string' && cv.name.trim() ? cv.name : 'Untitled';
                    const titleScore = fuzzyScore(q, name);
                    const folderScore = fuzzyScore(q, folderName);
                    if (titleScore === null && folderScore === null) continue;
                    hits.push({
                        id: cv.id,
                        name,
                        cwd,
                        folderName,
                        modified: '',
                        match: 'title',
                        score:
                            titleScore !== null
                                ? titleScore
                                : (folderScore ?? 0) + 20,
                        snippet: titleScore === null ? folderName : undefined,
                    });
                }
            }
            // Recent may include canvases not yet in an expanded tree fetch.
            for (const cv of recent) {
                if (hits.some((h) => h.cwd === cv.cwd && h.id === cv.id)) continue;
                const titleScore = fuzzyScore(q, cv.name);
                const folderScore = fuzzyScore(q, cv.folderName);
                if (titleScore === null && folderScore === null) continue;
                hits.push({
                    ...cv,
                    match: 'title',
                    score: titleScore !== null ? titleScore : (folderScore ?? 0) + 20,
                });
            }
            hits.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));
            return hits;
        },
        [tree, recent],
    );

    useEffect(() => {
        if (!debouncedQuery) {
            setSearchResults([]);
            setSearchStatus('idle');
            return;
        }
        let alive = true;
        const local = localTitleHits(debouncedQuery);
        // Show local hits immediately so typing feels live even before the server answers.
        setSearchResults(local);
        setSearchStatus('loading');
        fetch(`/canvases/search?q=${encodeURIComponent(debouncedQuery)}`)
            .then((r) => {
                if (!r.ok) throw new Error(`search ${r.status}`);
                return r.json();
            })
            .then((d: { results?: CanvasSearchHit[] }) => {
                if (!alive) return;
                const remote = d.results ?? [];
                // Merge: keep best (kind + score) per cwd::id; prefer remote metadata.
                const byKey = new Map<string, CanvasSearchHit>();
                const rank = (m?: CanvasSearchMatchKind) =>
                    m === 'title' ? 0 : m === 'card' ? 1 : m === 'message' ? 2 : m === 'document' ? 3 : 9;
                const better = (a: CanvasSearchHit, b: CanvasSearchHit) => {
                    const kd = rank(a.match) - rank(b.match);
                    if (kd !== 0) return kd < 0 ? a : b;
                    return (a.score ?? 0) <= (b.score ?? 0) ? a : b;
                };
                for (const hit of [...local, ...remote]) {
                    const key = `${hit.cwd}::${hit.id}`;
                    const prev = byKey.get(key);
                    byKey.set(key, prev ? better(prev, hit) : hit);
                }
                const merged = [...byKey.values()].sort((a, b) => {
                    const kd = rank(a.match) - rank(b.match);
                    if (kd !== 0) return kd;
                    if ((a.score ?? 0) !== (b.score ?? 0)) return (a.score ?? 0) - (b.score ?? 0);
                    return (b.modified ?? '').localeCompare(a.modified ?? '');
                });
                setSearchResults(merged.slice(0, 50));
                setSearchStatus('idle');
            })
            .catch(() => {
                if (!alive) return;
                // Server down / old build: still keep local fuzzy hits.
                setSearchResults(local.slice(0, 50));
                setSearchStatus(local.length > 0 ? 'idle' : 'error');
            });
        return () => {
            alive = false;
        };
    }, [debouncedQuery, canvasTreeRev, localTitleHits]);

    // Cmd/Ctrl+K focuses sidebar canvas search (expands nav if collapsed).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'k') return;
            if (e.altKey || e.shiftKey) return;
            const tag = (e.target as HTMLElement | null)?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable)
                return;
            e.preventDefault();
            if (collapsed) setCollapsed(false);
            if (activeView !== 'canvas') setActiveView('canvas');
            queueMicrotask(() => searchInputRef.current?.focus());
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [collapsed, setCollapsed, activeView, setActiveView]);

    const toggleFolder = (cwd: string) =>
        setOpenFolders((prev) => {
            const next = new Set(prev);
            next.has(cwd) ? next.delete(cwd) : next.add(cwd);
            return next;
        });

    const toggleCanvasSessions = (key: string) =>
        setOpenCanvasSessions((prev) => {
            const next = new Set(prev);
            next.has(key) ? next.delete(key) : next.add(key);
            return next;
        });

    const clearSearch = () => {
        setSearchQuery('');
        setDebouncedQuery('');
        setSearchResults([]);
        setSearchStatus('idle');
    };

    const openCanvasHit = (cv: { id: string; cwd: string; name?: string; folderName?: string }) => {
        // Leave search mode → normal Recent/Workspaces tree, with this canvas focused.
        clearSearch();
        setActiveView('canvas');
        // Optimistic: put this canvas at the top of Recent immediately (matches Workspaces focus).
        setRecent((prev) => {
            const folderName = cv.folderName ?? cv.cwd.split('/').pop() ?? cv.cwd;
            const name = cv.name ?? prev.find((r) => r.id === cv.id && r.cwd === cv.cwd)?.name ?? 'Untitled';
            const next: CanvasListItem = {
                id: cv.id,
                cwd: cv.cwd,
                name,
                folderName,
                modified: new Date().toISOString(),
            };
            return [next, ...prev.filter((r) => !(r.id === cv.id && r.cwd === cv.cwd))].slice(0, 12);
        });
        setOpenFolders((prev) => {
            const next = new Set(prev);
            next.add(cv.cwd);
            return next;
        });
        setSwitchingCanvasId(cv.id);
        const revealInTree = () => {
            // Two frames: search unmounts, then folder/canvas row paints.
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    const el = document.querySelector(
                        `[data-sidebar-canvas-id="${CSS.escape(cv.id)}"][data-sidebar-cwd="${CSS.escape(cv.cwd)}"]`,
                    );
                    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                });
            });
        };
        // openCanvas handles same-folder and cross-folder atomically — never
        // routes through openFolder (which wipes cards to [] for empty-home).
        void openCanvas(cv.cwd, cv.id)
            .catch(() => {})
            .finally(() => {
                setSwitchingCanvasId(null);
                revealInTree();
            });
    };

    // Native OS dialog — the only way in. Cancel = no-op.
    const addFolder = async () => {
        setPickingNative(true);
        try {
            const picked = await pickFolder();
            if (picked) {
                await openFolder(picked);
                loadTree();
            }
        } finally {
            setPickingNative(false);
        }
    };

    const newCanvasInFolder = async (cwd: string) => {
        const entry = tree[cwd];
        const suggested = `Canvas ${(entry?.canvases.length ?? 0) + 1}`;
        const name = (await askText({ title: 'Name your new canvas', initial: suggested }))?.trim();
        if (!name) return;
        const nested = cwd.includes('/.melon/worktrees/');
        let useWorktree = !nested;
        if (!nested) {
            const choice = await askChoice({
                title: 'Agent working directory',
                description: 'Isolated keeps agent edits in a git worktree under .melon/worktrees/. Local edits the project folder directly.',
                options: [
                    {
                        label: 'Isolated',
                        value: 'isolated',
                        description: 'New checkout under .melon/worktrees/ (recommended for git repos)',
                    },
                    {
                        label: 'Local',
                        value: 'local',
                        description: 'Agent cwd = this project folder',
                    },
                ],
            });
            if (!choice) return;
            useWorktree = choice === 'isolated';
        }
        await createCanvasInFolder(cwd, name, { useWorktree });
        loadTree();
    };

    const deleteCanvasRow = async (cwd: string, id: string) => {
        const row = tree[cwd]?.canvases?.find((c: { id: string }) => c.id === id) as
            | { id: string; worktreeMode?: string; worktreeName?: string }
            | undefined;
        const isolated = row?.worktreeMode === 'isolated';
        if (!(await confirmAction({
            title: 'Delete this canvas?',
            description: isolated
                ? `The card layout will be removed. The Isolated checkout${row?.worktreeName ? ` (${row.worktreeName})` : ''} under .melon/worktrees/ and its branch will also be deleted. Pi session transcripts remain on disk.`
                : 'The card layout will be removed. Pi session transcripts remain on disk.',
            confirmLabel: 'Delete',
        })))
            return;
        forgetCanvas(id);
        if (canvasId === id && folder === cwd) {
            localStorage.removeItem('melon:lastCanvas');
            useCanvasStore.setState({
                cards: [],
                canvasId: null,
                canvasName: '',
                worktreePath: null,
                branch: null,
                baseBranch: null,
                worktreeMode: 'local',
            });
        }
        await fetch(`/canvases/${id}?cwd=${encodeURIComponent(cwd)}`, {
            method: 'DELETE',
        });
        // Drop from Recent immediately + bump rev so Workspaces tree refetch matches.
        setRecent((prev) => prev.filter((r) => !(r.id === id && r.cwd === cwd)));
        useCanvasStore.setState((s) => ({ canvasTreeRev: s.canvasTreeRev + 1 }));
        loadTree();
    };

    const renameCanvasRow = async (cwd: string, cv: { id: string; name: string }) => {
        const name = (await askText({ title: 'Rename canvas', initial: cv.name }))?.trim();
        if (!name || name === cv.name) return;
        await useCanvasStore.getState().renameCanvas(cwd, cv.id, name);
    };

    const searching = searchQuery.trim().length > 0;
    const searchPending = searching && (searchStatus === 'loading' || searchQuery.trim() !== debouncedQuery);

    // Navbar footer: project vs agent cwd (Local vs Isolated). Click copies agent cwd.
    const projectLeaf = folder?.split('/').filter(Boolean).pop() ?? null;
    const agentPath =
        worktreeMode === 'isolated' && worktreePath && worktreePath !== folder
            ? worktreePath
            : folder;
    const agentLeaf = agentPath?.split('/').filter(Boolean).pop() ?? null;
    const footerLabel =
        worktreeMode === 'isolated' && agentLeaf
            ? `Isolated · ${agentLeaf}${branch ? ` · ${branch}` : ''}`
            : projectLeaf
              ? `Local · ${projectLeaf}`
              : null;
    const footerTitle =
        worktreeMode === 'isolated' && worktreePath
            ? `Click to copy agent cwd\nProject: ${folder ?? ''}\nAgent: ${worktreePath}${branch ? `\nBranch: ${branch}` : ''}`
            : folder
              ? `Click to copy agent cwd\n${folder}`
              : undefined;

    const copyAgentCwd = () => {
        const cwd = useCanvasStore.getState().agentCwd();
        if (!cwd) return;
        void navigator.clipboard.writeText(cwd).then(() => {
            setCwdCopied(true);
            if (cwdCopiedTimerRef.current != null) window.clearTimeout(cwdCopiedTimerRef.current);
            cwdCopiedTimerRef.current = window.setTimeout(() => {
                setCwdCopied(false);
                cwdCopiedTimerRef.current = null;
            }, 1500);
        });
    };

    return (
        <div
            className={cn(
                'absolute left-0 top-0 z-10 flex h-full flex-col overflow-hidden border-r border-border bg-card transition-all duration-200',
                collapsed ? 'w-12 items-center py-2' : 'w-[260px]',
            )}
        >
            {collapsed ? (
                <>
                    <button
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        onClick={() => setCollapsed(false)}
                    >
                        <PanelLeftOpen className="size-4" />
                    </button>
                    <button
                        className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        title="Search canvases (⌘K)"
                        onClick={() => {
                            setCollapsed(false);
                            setActiveView('canvas');
                            queueMicrotask(() => searchInputRef.current?.focus());
                        }}
                    >
                        <Search className="size-4" />
                    </button>
                    {activeView !== 'canvas' && (
                        <>
                            <button
                                className={cn(
                                    'rounded-lg p-2 transition-colors hover:bg-secondary hover:text-foreground',
                                    activeView === 'skills' && 'bg-secondary text-foreground',
                                )}
                                title="Skills"
                                onClick={() => openView('skills')}
                            >
                                <Sparkles className="size-4" />
                            </button>
                            <button
                                className={cn(
                                    'rounded-lg p-2 transition-colors hover:bg-secondary hover:text-foreground',
                                    activeView === 'themes' && 'bg-secondary text-foreground',
                                )}
                                title="Themes"
                                onClick={() => openView('themes')}
                            >
                                <Palette className="size-4" />
                            </button>
                        </>
                    )}
                    <button
                        className="mt-auto rounded-lg p-2 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        title={activeView === 'canvas' ? 'Settings' : 'Back to chat'}
                        onClick={() =>
                            activeView === 'canvas' ? openView('themes') : setActiveView('canvas')
                        }
                    >
                        {activeView === 'canvas' ? (
                            <Settings className="size-4" />
                        ) : (
                            <MessageSquare className="size-4" />
                        )}
                    </button>
                </>
            ) : (
                <>
                    {/* Brand header */}
                    <div className="flex shrink-0 items-center gap-2 px-3 pb-2 pt-4">
                        <span className="text-base">🍉</span>
                        <span className="flex-1 text-sm font-semibold tracking-tight text-card-foreground">
                            Melon
                        </span>
                        <button
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary"
                            onClick={() => setCollapsed(true)}
                        >
                            <PanelLeftClose className="size-4" />
                        </button>
                    </div>

                    {activeView === 'canvas' ? (
                        <>
                    {/* Primary action */}
                    <div className="space-y-2 px-3 pb-1">
                        <button
                            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-2 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-ring hover:bg-secondary hover:text-foreground"
                            onClick={addFolder}
                        >
                            <FolderPlus className="size-3.5" />
                            {pickingNative ? 'Opening Finder…' : 'Add folder'}
                        </button>
                        <div className="relative">
                            <Search className="pointer-events-none absolute left-2 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" />
                            <input
                                ref={searchInputRef}
                                type="search"
                                value={searchQuery}
                                placeholder="Search titles, cards, messages…"
                                aria-label="Search canvases by title, card, or message"
                                className="w-full rounded-lg border border-border bg-background py-1.5 pl-7 pr-7 text-xs text-card-foreground outline-none placeholder:text-muted-foreground focus:border-ring"
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (searchQuery) clearSearch();
                                        else (e.target as HTMLInputElement).blur();
                                    }
                                }}
                            />
                            {searchQuery ? (
                                <button
                                    type="button"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                    title="Clear search"
                                    onClick={clearSearch}
                                >
                                    <X className="size-3" />
                                </button>
                            ) : (
                                <kbd className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 rounded border border-border px-1 text-[9px] text-muted-foreground/80">
                                    {typeof navigator !== 'undefined' &&
                                    /Mac|iPhone|iPad/.test(navigator.platform)
                                        ? '⌘K'
                                        : 'Ctrl+K'}
                                </kbd>
                            )}
                        </div>
                    </div>

                    {/* Scrollable body */}
                    <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                        {searching ? (
                            <>
                                <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Search results
                                    {searchPending ? '…' : ''}
                                </p>
                                {searchStatus === 'error' && !searchPending ? (
                                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                                        Couldn’t search. Check that Melon is running.
                                    </p>
                                ) : searchResults.length === 0 && !searchPending ? (
                                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                                        No canvases match “{searchQuery.trim()}”.
                                    </p>
                                ) : searchResults.length === 0 && searchPending ? (
                                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                                        Searching…
                                    </p>
                                ) : (
                                    <div className="mb-2 space-y-0.5 pb-2">
                                        {searchResults.map((cv) => {
                                            const isActive = folder === cv.cwd && cv.id === canvasId;
                                            const when = formatModified(cv.modified);
                                            const kindLabel = matchKindLabel(cv.match);
                                            const displayName =
                                                cv.name === 'Untitled'
                                                    ? `Untitled · ${cv.folderName}`
                                                    : cv.name;
                                            const titleTip = [
                                                cv.name,
                                                cv.folderName,
                                                kindLabel,
                                                cv.snippet,
                                                when,
                                            ]
                                                .filter(Boolean)
                                                .join(' · ');
                                            return (
                                                <button
                                                    key={`${cv.cwd}::${cv.id}`}
                                                    className={cn(
                                                        'flex w-full flex-col gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors',
                                                        isActive ? 'bg-primary/10' : 'hover:bg-secondary/70',
                                                    )}
                                                    title={titleTip}
                                                    onClick={() => openCanvasHit(cv)}
                                                >
                                                    <span className="flex min-w-0 items-center gap-1.5">
                                                        <Layers
                                                            className={cn(
                                                                'size-3 shrink-0',
                                                                isActive ? 'text-primary' : 'text-muted-foreground',
                                                            )}
                                                        />
                                                        <span
                                                            className={cn(
                                                                'min-w-0 flex-1 truncate text-xs',
                                                                isActive
                                                                    ? 'font-medium text-primary'
                                                                    : 'text-card-foreground',
                                                            )}
                                                        >
                                                            <HighlightMatch
                                                                text={displayName}
                                                                query={searchQuery}
                                                            />
                                                            {switchingCanvasId === cv.id ? (
                                                                <span
                                                                    className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-blue-400"
                                                                    title="Loading..."
                                                                />
                                                            ) : canvasActivity[cv.id] === 'streaming' ? (
                                                                <span
                                                                    className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-400"
                                                                    title="AI is running"
                                                                />
                                                            ) : canvasActivity[cv.id] === 'error' ? (
                                                                <span
                                                                    className="ml-1 inline-block size-1.5 rounded-full bg-red-500"
                                                                    title="Error"
                                                                />
                                                            ) : null}
                                                        </span>
                                                        {kindLabel ? (
                                                            <span className="shrink-0 rounded border border-border px-1 text-[9px] text-muted-foreground">
                                                                {kindLabel}
                                                            </span>
                                                        ) : null}
                                                        {cv.worktreeMode === 'isolated' && cv.worktreeName ? (
                                                            <span className="shrink-0 truncate text-[9px] text-muted-foreground">
                                                                🌳 {cv.worktreeName}
                                                            </span>
                                                        ) : (
                                                            <span className="shrink-0 truncate text-[9px] text-muted-foreground">
                                                                📁 {cv.folderName}
                                                            </span>
                                                        )}
                                                    </span>
                                                    {cv.snippet && cv.match !== 'title' ? (
                                                        <span className="truncate pl-4 text-[9px] text-muted-foreground">
                                                            <HighlightMatch
                                                                text={cv.snippet}
                                                                query={searchQuery}
                                                            />
                                                        </span>
                                                    ) : null}
                                                    <span className="flex min-w-0 items-center justify-between gap-2 pl-4 text-[9px] text-muted-foreground">
                                                        <span className="truncate">📁 {cv.folderName}</span>
                                                        {when ? (
                                                            <span className="shrink-0 tabular-nums">{when}</span>
                                                        ) : null}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                        {recent.length > 0 && (
                            <>
                                <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                    Recent canvases
                                </p>
                                <div className="mb-2 space-y-0.5 pb-2">
                                    {recent.map((cv) => {
                                        const isActive = folder === cv.cwd && cv.id === canvasId;
                                        return (
                                            <button
                                                key={`${cv.cwd}::${cv.id}`}
                                                className={cn(
                                                    'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left transition-colors',
                                                    isActive ? 'bg-primary/10' : 'hover:bg-secondary/70',
                                                )}
                                                title={`${cv.name} — ${cv.folderName}${cv.worktreeMode === 'isolated' && cv.worktreeName ? ` · Isolated ${cv.worktreeName}` : ''}`}
                                                onClick={() => openCanvasHit(cv)}
                                            >
                                                <Layers
                                                    className={cn(
                                                        'size-3 shrink-0',
                                                        isActive ? 'text-primary' : 'text-muted-foreground',
                                                    )}
                                                />
                                                <span
                                                    className={cn(
                                                        'min-w-0 flex-1 truncate text-xs',
                                                        isActive
                                                            ? 'font-medium text-primary'
                                                            : 'text-card-foreground',
                                                    )}
                                                >
                                                    {cv.name}
                                                    {switchingCanvasId === cv.id ? (
                                                        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-blue-400" title="Loading..." />
                                                    ) : canvasActivity[cv.id] === "streaming" ? (
                                                        <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-400" title="AI is running" />
                                                    ) : canvasActivity[cv.id] === "error" ? (
                                                        <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" title="Error" />
                                                    ) : null}
                                                </span>
                                                <span className="shrink-0 truncate text-[9px] text-muted-foreground">
                                                    {cv.worktreeMode === 'isolated' && cv.worktreeName
                                                        ? `🌳 ${cv.worktreeName}`
                                                        : `📁 ${cv.folderName}`}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        {folders.length === 0 && (
                            <div className="mt-6 px-4 text-center">
                                <FolderOpen className="mx-auto size-6 text-muted-foreground/40" />
                                <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                                    No folders yet.
                                    <br />
                                    Add one to start your first canvas.
                                </p>
                            </div>
                        )}

                        {folders.length > 0 && (
                            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Workspaces
                            </p>
                        )}

                        {folders.map(({ cwd }) => {
                            const t = tree[cwd] ?? { canvases: [], loose: [] };
                            return (
                                <div key={cwd} className="mb-1">
                                    {/* Folder row */}
                                    <div className="group/folder flex items-center gap-0.5 rounded-lg pr-1 transition-colors hover:bg-secondary/70">
                                        <button
                                            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pl-1 text-left"
                                            onClick={() => toggleFolder(cwd)}
                                        >
                                            <ChevronRight
                                                className={cn(
                                                    'size-3 shrink-0 text-muted-foreground transition-transform',
                                                    openFolders.has(cwd) && 'rotate-90',
                                                )}
                                            />
                                            <span className="truncate text-xs font-medium text-card-foreground">
                                                {cwd.split('/').pop()}
                                            </span>
                                        </button>
                                        <button
                                            className="rounded p-1 opacity-0 transition-opacity hover:bg-background hover:text-primary group-hover/folder:opacity-100"
                                            title={`New canvas in ${cwd.split('/').pop()}`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                newCanvasInFolder(cwd);
                                            }}
                                        >
                                            <Plus className="size-3.5" />
                                        </button>
                                    </div>

                                    {/* Canvases + sessions */}
                                    {openFolders.has(cwd) && (
                                        <div className="ml-3 space-y-0.5 border-l border-border pl-2">
                                            {t.canvases.length === 0 && t.loose.length === 0 && (
                                                <p className="py-1 text-[11px] italic text-muted-foreground/70">
                                                    empty
                                                </p>
                                            )}

                                            {t.canvases.map((cv: any) => {
                                                const key = `${cwd}::${cv.id}`;
                                                const isActive =
                                                    folder === cwd && cv.id === canvasId;
                                                return (
                                                    <div key={cv.id}>
                                                        <div
                                                            data-sidebar-canvas-id={cv.id}
                                                            data-sidebar-cwd={cwd}
                                                            className={cn(
                                                                'group/cv flex items-center gap-1.5 rounded-lg py-1 pl-1 pr-1 transition-colors',
                                                                isActive
                                                                    ? 'bg-primary/10'
                                                                    : 'hover:bg-secondary/70',
                                                            )}
                                                        >
                                                            <ChevronRight
                                                                className={cn(
                                                                    'size-3 shrink-0 cursor-pointer text-muted-foreground transition-transform',
                                                                    openCanvasSessions.has(key) &&
                                                                        'rotate-90',
                                                                )}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    toggleCanvasSessions(key);
                                                                }}
                                                            />
                                                            <Layers
                                                                className={cn(
                                                                    'size-3 shrink-0',
                                                                    isActive
                                                                        ? 'text-primary'
                                                                        : 'text-muted-foreground',
                                                                )}
                                                            />
                                                            <span
                                                                className={cn(
                                                                    'min-w-0 flex-1 cursor-pointer truncate text-xs',
                                                                    isActive
                                                                        ? 'font-medium text-primary'
                                                                        : 'text-card-foreground',
                                                                )}
                                                                title={`${cv.name}${cv.worktreeMode === 'isolated' && cv.worktreeName ? ` · Isolated ${cv.worktreeName}` : ''} — click to open, double-click to rename`}
                                                                onClick={() => {
                                                                    openCanvasHit({ id: cv.id, cwd });
                                                                }}
                                                                onDoubleClick={(e) => {
                                                                    e.stopPropagation();
                                                                    renameCanvasRow(cwd, cv);
                                                                }}
                                                            >
                                                                {cv.name}
                                                                {cv.worktreeMode === 'isolated' ? (
                                                                    <span className="ml-1 text-[9px] font-normal text-muted-foreground">
                                                                        🌳{cv.worktreeName ? ` ${cv.worktreeName}` : ''}
                                                                    </span>
                                                                ) : null}
                                                                {canvasActivity[cv.id] === "streaming" ? (
                                                                    <span className="ml-1 inline-block size-1.5 animate-pulse rounded-full bg-amber-400" title="AI is running" />
                                                                ) : canvasActivity[cv.id] === "error" ? (
                                                                    <span className="ml-1 inline-block size-1.5 rounded-full bg-red-500" title="Error" />
                                                                ) : null}
                                                            </span>
                                                            <span className="shrink-0 rounded-full bg-secondary px-1.5 text-[9px] tabular-nums text-muted-foreground">
                                                                {cv.sessions.length}
                                                            </span>
                                                            <button
                                                                className="hidden rounded p-0.5 text-muted-foreground transition-colors hover:text-red-500 group-hover/cv:block"
                                                                title="Delete canvas"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    deleteCanvasRow(cwd, cv.id);
                                                                }}
                                                            >
                                                                <X className="size-3" />
                                                            </button>
                                                        </div>

                                                        {openCanvasSessions.has(key) &&
                                                            cv.sessions.map((sess: any) => (
                                                                <button
                                                                    key={sess.file}
                                                                    className="flex w-full items-center gap-1 truncate rounded-md py-0.5 pl-6 pr-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-card-foreground"
                                                                    title={sess.title}
                                                                    onClick={() =>
                                                                        resumeSession(sess.file)
                                                                    }
                                                                >
                                                                    <FileText className="size-2.5 shrink-0" />
                                                                    <span className="truncate">
                                                                        {sess.title ||
                                                                            sess.file
                                                                                .split('/')
                                                                                .pop()
                                                                                ?.slice(0, 24)}
                                                                    </span>
                                                                </button>
                                                            ))}
                                                    </div>
                                                );
                                            })}

                                            {t.loose.length > 0 && (
                                                <div>
                                                    <button
                                                        className="flex w-full items-center gap-1 rounded-lg py-1 pl-1 text-[10px] uppercase tracking-wide text-muted-foreground/80 transition-colors hover:bg-secondary/50"
                                                        onClick={() =>
                                                            toggleCanvasSessions(
                                                                `${cwd}::loose`,
                                                            )
                                                        }
                                                    >
                                                        <ChevronRight
                                                            className={cn(
                                                                'size-2.5 transition-transform',
                                                                openCanvasSessions.has(
                                                                    `${cwd}::loose`,
                                                                ) && 'rotate-90',
                                                            )}
                                                        />
                                                        loose ({t.loose.length})
                                                    </button>
                                                    {openCanvasSessions.has(`${cwd}::loose`) &&
                                                        t.loose.map((sess: any) => (
                                                            <button
                                                                key={sess.file}
                                                                className="flex w-full items-center gap-1 truncate rounded-md py-0.5 pl-4 pr-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-secondary/70 hover:text-card-foreground"
                                                                title={sess.title}
                                                                onClick={() =>
                                                                    resumeSession(sess.file)
                                                                }
                                                            >
                                                                <FileText className="size-2.5 shrink-0" />
                                                                <span className="truncate">
                                                                    {sess.title ||
                                                                        sess.file
                                                                            .split('/')
                                                                            .pop()
                                                                            ?.slice(0, 24)}
                                                                </span>
                                                            </button>
                                                        ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                            </>
                        )}
                    </div>

                        </>
                    ) : (
                        /* Settings mode: navbar body becomes the two pages */
                        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                            <p className="px-2 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                                Settings
                            </p>
                            <div className="space-y-0.5">
                                <button
                                    onClick={() => openView('skills')}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                        activeView === 'skills'
                                            ? 'bg-secondary font-medium text-card-foreground'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                >
                                    <Sparkles className="size-3.5 shrink-0" /> Skills
                                </button>
                                <button
                                    onClick={() => openView('themes')}
                                    className={cn(
                                        'flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-xs transition-colors',
                                        activeView === 'themes'
                                            ? 'bg-secondary font-medium text-card-foreground'
                                            : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
                                    )}
                                >
                                    <Palette className="size-3.5 shrink-0" /> Themes
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Footer: build version + workspace breadcrumb + settings */}
                    <div className="flex shrink-0 flex-col gap-1 border-t border-border px-3 py-2">
                        <p
                            className="truncate text-[11px] font-medium text-foreground"
                            data-testid="app-build-version"
                            title={appVersion ? `Melon ${appVersion}` : 'Melon'}
                        >
                            {appVersion ? `Melon ${appVersion}` : 'Melon'}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                            {footerLabel ? (
                                <button
                                    type="button"
                                    className="min-w-0 truncate rounded-sm text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                    title={footerTitle}
                                    onClick={copyAgentCwd}
                                >
                                    {cwdCopied ? 'Copied pwd' : footerLabel}
                                </button>
                            ) : (
                                <span className="min-w-0 truncate text-[10px] text-muted-foreground" />
                            )}
                            <button
                                className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                                title={activeView === 'canvas' ? 'Settings' : 'Back to chat'}
                                onClick={() =>
                                    activeView === 'canvas' ? openView('themes') : setActiveView('canvas')
                                }
                            >
                                {activeView === 'canvas' ? (
                                    <Settings className="size-3.5" />
                                ) : (
                                    <MessageSquare className="size-3.5" />
                                )}
                            </button>
                        </div>
                    </div>

                </>
            )}

        </div>
    );
}
