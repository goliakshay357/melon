import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { newCardId, type SessionCard } from '@/types/session-card';

const MELON_API = 'http://127.0.0.1:8788';

// cardId → live SSE stream state
const streams = new Map<string, { es: EventSource; buffer: string; thinkingBuffer: string }>();
const attached = new Set<string>(); // cardIds with an existing server-side session

function pushLog(cardId: string, line: string) {
    const t = new Date().toLocaleTimeString([], { hour12: false });
    useCanvasStore.setState((s) => ({
        cards: s.cards.map((c) =>
            c.id === cardId
                ? { ...c, logs: [...(c.logs ?? []), `${t}  ${line}`].slice(-40) }
                : c,
        ),
    }));
}

type ScrollAction = 'pan' | 'zoom';

export interface CanvasMeta {
    id: string;
    name: string;
    modified?: string;
}

interface CanvasState {
    cards: SessionCard[];
    folder: string | null; // real directory this canvas belongs to
    canvasId: string | null;
    canvasName: string;
    canvases: CanvasMeta[]; // canvases within current folder
    viewport?: { x: number; y: number; zoom: number };
    setViewport: (v: { x: number; y: number; zoom: number }) => void;
    openFolder: (folder: string) => Promise<void>;
    switchCanvas: (id: string) => Promise<void>;
    createCanvas: (name: string) => Promise<void>;
    saveCanvas: () => Promise<void>;
    scrollAction: ScrollAction;
    setScrollAction: (a: ScrollAction) => void;
    addCard: (
        position: { x: number; y: number },
        parentId?: string | null,
        forcedId?: string,
    ) => string;
    forkCard: (parentId: string) => Promise<string>;
    moveCard: (id: string, position: { x: number; y: number }) => void;
    updateCard: (id: string, patch: Partial<SessionCard>) => void;
    resizeCard: (id: string, width: number, height: number) => void;
    deleteCards: (ids: string[]) => void;
    sendMessage: (
        cardId: string,
        text: string,
        opts?: { cwd?: string; sessionFile?: string },
    ) => void;
    resumeSession: (sessionFile: string) => Promise<string | null>;
}

function loadLastLocation(): { folder: string | null; canvasId: string | null } {
    try {
        return {
            folder: localStorage.getItem('melon:lastFolder'),
            canvasId: localStorage.getItem('melon:lastCanvas'),
        };
    } catch {
        return { folder: null, canvasId: null };
    }
}

const loc = loadLastLocation();

export const useCanvasStore = create<CanvasState>((set, get) => ({
    cards: [],
    folder: loc.folder,
    canvasId: loc.canvasId,
    canvasName: '',
    canvases: [],

    setViewport(v) {
        set({ viewport: v });
    },

    async saveCanvas() {
        const { folder, canvasId, canvasName, cards, viewport } = get();
        if (!folder || !canvasId) return;
        await fetch(`${MELON_API}/canvases/${canvasId}`, {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                cwd: folder,
                canvas: {
                    id: canvasId,
                    name: canvasName || 'Untitled',
                    cwd: folder,
                    viewport,
                    cards,
                },
            }),
        }).catch(() => {});
    },

    async switchCanvas(id) {
        const folder = get().folder;
        if (!folder) return;
        const res = await fetch(
            `${MELON_API}/canvases/${id}?cwd=${encodeURIComponent(folder)}`,
        ).catch(() => null);
        if (!res?.ok) return;
        const cv = await res.json();
        set({
            cards: Array.isArray(cv.cards) ? cv.cards : [],
            canvasId: id,
            canvasName: cv.name ?? 'Untitled',
            viewport: cv.viewport,
        });
        localStorage.setItem('melon:lastCanvas', id);
    },

    async createCanvas(name) {
        if (!get().folder) return;
        const id = `cv_${nanoid(8)}`;
        set({ canvasId: id, canvasName: name || 'Untitled', cards: [] });
        localStorage.setItem('melon:lastCanvas', id);
        await get().saveCanvas();
        // refresh list
        const res = await fetch(
            `${MELON_API}/canvases?cwd=${encodeURIComponent(get().folder ?? '')}`,
        ).catch(() => null);
        if (res?.ok) set({ canvases: (await res.json()).canvases ?? [] });
    },

    async openFolder(rawFolder) {
        set({ folder: rawFolder, canvases: [], cards: [], canvasId: null });
        localStorage.setItem('melon:lastFolder', rawFolder);
        const res = await fetch(
            `${MELON_API}/canvases?cwd=${encodeURIComponent(rawFolder)}`,
        ).catch(() => null);
        let canvases: CanvasMeta[] = [];
        if (res?.ok) canvases = (await res.json()).canvases ?? [];
        if (canvases.length > 0) {
            set({ canvases });
            await get().switchCanvas(canvases[0].id);
        } else {
            await get().createCanvas('Canvas 1');
        }
    },
    scrollAction:
        (localStorage.getItem('melon:scroll_action') as ScrollAction) || 'pan',

    setScrollAction(a) {
        localStorage.setItem('melon:scroll_action', a);
        set({ scrollAction: a });
    },

    addCard(position, parentId = null, forcedId?: string) {
        const parent = parentId
            ? get().cards.find((c) => c.id === parentId)
            : undefined;
        const card: SessionCard = {
            id: forcedId ?? newCardId(),
            title: parent ? `↳ ${parent.title}`.slice(0, 44) : 'New card',
            position,
            parentId,
            status: 'idle',
            messages: [],
        };
        set((s) => ({ cards: [...s.cards, card] }));
        return card.id;
    },

    async forkCard(parentId) {
        const parent = get().cards.find((c) => c.id === parentId);
        const childCardId = newCardId();
        let sessionInfo: {
            sessionFile?: string;
            model?: string;
            forkedFromEntryId?: string;
        } | null = null;

        // Ask the server to clone the pi session (root→leaf → new .jsonl).
        try {
            const res = await fetch(`${MELON_API}/sessions/${parentId}/fork`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                newCardId: childCardId,
                sessionFile: parent?.sessionFile,
            }),
            });
            if (!res.ok) throw new Error(await res.text());
            sessionInfo = await res.json();
            attached.add(childCardId);
            pushLog(childCardId, `✓ FORKED from ${parentId} — full transcript inherited`);
        } catch (e) {
            pushLog(parentId, `⚠️ server fork failed, card will attach on first message: ${e instanceof Error ? e.message : e}`);
        }

        get().addCard(
            {
                x: (parent?.position.x ?? 0) + 140,
                y: (parent?.position.y ?? 0) + 180,
            },
            parentId,
            childCardId,
        );
        get().updateCard(childCardId, {
            title: parent ? `↳ ${parent.title}`.slice(0, 44) : 'New card',
            sessionFile: sessionInfo?.sessionFile,
            model: sessionInfo?.model,
            forkedFromEntryId: sessionInfo?.forkedFromEntryId,
        });
        return childCardId;
    },

    moveCard(id, position) {
        get().updateCard(id, { position });
    },

    updateCard(id, patch) {
        set((s) => ({
            cards: s.cards.map((c) => (c.id === id ? { ...c, ...patch } : c)),
        }));
    },

    resizeCard(id, width, height) {
        get().updateCard(id, { size: { width: Math.round(width), height: Math.round(height) } });
    },

    deleteCards(ids) {
        const dead = new Set(ids);
        set((s) => ({
            // Orphan children rather than cascading — forks survive parents in v1.
            cards: s.cards
                .filter((c) => !dead.has(c.id))
                .map((c) =>
                    c.parentId && dead.has(c.parentId)
                        ? { ...c, parentId: null }
                        : c,
                ),
        }));
    },

    async resumeSession(sessionFile) {
        const cardId = newCardId();
        try {
            const res = await fetch(`${MELON_API}/sessions/resume`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ cardId, sessionFile }),
            });
            if (!res.ok) throw new Error(await res.text());
        } catch {
            return null;
        }
        // Place resumed cards to the right of existing content.
        const cards = get().cards;
        const maxX = cards.length ? Math.max(...cards.map((c) => c.position.x)) : -400;
        get().addCard(
            { x: maxX + 440, y: cards.length ? cards[0].position.y : 0 },
            null,
            cardId,
        );
        get().updateCard(cardId, { title: 'Resumed session' });
        return cardId;
    },

    async sendMessage(cardId, text, opts) {
        const card = get().cards.find((c) => c.id === cardId);
        if (!card || !text.trim()) return;
        get().updateCard(cardId, {
            status: 'streaming',
            title: card.messages.length === 0 ? text.slice(0, 40) : card.title,
            messages: [...card.messages, { role: 'user', text }],
        });

        // Ensure a pi session exists for this card (idempotent).
        if (!attached.has(cardId)) {
            // RESUME-FIRST: if this card ever had a session file, always resume it —
            // server restarts and page refreshes must never cost us the conversation.
            const sessionFile = opts?.sessionFile ?? card.sessionFile;
            const url = sessionFile
                ? `${MELON_API}/sessions/resume`
                : `${MELON_API}/sessions`;
            pushLog(
                cardId,
                `→ ATTACH ${sessionFile ? `RESUME ${sessionFile.split('/').pop()}` : `NEW cwd=${opts?.cwd ?? '(default)'}`}`,
            );
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(
                        sessionFile
                            ? { cardId, sessionFile }
                            : { cardId, cwd: opts?.cwd ?? '~/Desktop/workspace/melon' },
                    ),
                });
                if (!res.ok) throw new Error(`attach ${res.status}: ${await res.text()}`);
                const info = (await res.json()) as { sessionFile?: string; sessionId?: string; model?: string };
                get().updateCard(cardId, {
                    sessionFile: info.sessionFile,
                    model: info.model,
                });
                attached.add(cardId);
                pushLog(cardId, `✓ ATTACHED session=${info.sessionId?.slice(0, 8)} model=${info.model}`);
            } catch (e) {
                pushLog(cardId, `✗ ATTACH FAILED: ${e instanceof Error ? e.message : e}`);
                get().updateCard(cardId, {
                    status: 'error',
                    messages: [
                        ...card.messages,
                        { role: 'assistant', text: `⚠️ Could not reach melon server (127.0.0.1:8788): ${e instanceof Error ? e.message : e}` },
                    ],
                });
                return;
            }
        } else {
            pushLog(cardId, '• already attached');
        }

        // Subscribe once per card; deltas append into the live assistant message.
        let st = streams.get(cardId);
        if (!st) {
            pushLog(cardId, `→ SSE connect /sessions/${cardId}/events`);
            const es = new EventSource(`${MELON_API}/sessions/${cardId}/events`);
            st = { es, buffer: '', thinkingBuffer: '' };
            streams.set(cardId, st);
            es.onopen = () => pushLog(cardId, '✓ SSE open — listening for deltas');
            es.onmessage = (ev) => {
                const data = JSON.parse(ev.data as string) as
                    | { type: 'delta'; text: string }
                    | { type: 'thinking'; text: string }
                    | { type: 'status'; status: 'idle' | 'streaming' | 'error' }
                    | { type: 'error'; message: string };
                const appendToLastAssistant = (patch: {
                    text?: string;
                    thinking?: string;
                }) => {
                    const cur = useCanvasStore
                        .getState()
                        .cards.find((c) => c.id === cardId);
                    if (!cur) return;
                    const msgs = [...cur.messages];
                    const last = msgs[msgs.length - 1];
                    if (last?.role === 'assistant')
                        msgs[msgs.length - 1] = { ...last, ...patch };
                    else
                        msgs.push({
                            role: 'assistant',
                            text: patch.text ?? '',
                            thinking: patch.thinking,
                        });
                    useCanvasStore.setState((s) => ({
                        cards: s.cards.map((c) =>
                            c.id === cardId ? { ...c, messages: msgs } : c,
                        ),
                    }));
                };
                if (data.type === 'thinking') {
                    st!.thinkingBuffer += data.text;
                    appendToLastAssistant({ thinking: st!.thinkingBuffer });
                } else if (data.type === 'delta') {
                    st!.buffer += data.text;
                    appendToLastAssistant({ text: st!.buffer });
                } else if (data.type === 'status') {
                    if (data.status === 'idle')
                        pushLog(cardId, `← agent_end (${st!.buffer.length} chars received)`);
                    if (data.status === 'idle') {
                        st!.buffer = '';
                        st!.thinkingBuffer = '';
                    }
                    useCanvasStore.getState().updateCard(cardId, {
                        status: data.status,
                    });
                } else if ((data as { type: string }).type === 'error') {
                    pushLog(cardId, `✗ agent error`);
                    useCanvasStore.getState().updateCard(cardId, {
                        status: 'error',
                        messages: [
                            ...(useCanvasStore.getState().cards.find((c) => c.id === cardId)?.messages ?? []),
                            { role: 'assistant', text: `⚠️ ${(data as { message: string }).message}` },
                        ],
                    });
                }
            };
        } else {
            st.buffer = '';
            st.thinkingBuffer = '';
        }
        st.es.onerror = () => {
            // Server restarted or connection dropped: force re-attach next send.
            pushLog(cardId, '✗ SSE dropped — will re-attach on next message');
            st!.es.close();
            streams.delete(cardId);
            attached.delete(cardId);
        };

        pushLog(cardId, `→ PROMPT "${text.slice(0, 40)}"`);
        const pres = await fetch(`${MELON_API}/sessions/${cardId}/prompt`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text }),
        });
        if (!pres.ok) {
            pushLog(cardId, `✗ PROMPT rejected HTTP ${pres.status}`);
            get().updateCard(cardId, {
                status: 'error',
                messages: [
                    ...card.messages,
                    { role: 'assistant', text: `⚠️ Prompt rejected (${pres.status}). Try again.` },
                ],
            });
        }
    },
}));
