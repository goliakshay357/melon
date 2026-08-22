import { create } from 'zustand';
import { newCardId, type SessionCard } from '@/types/session-card';

const STORAGE_KEY = 'melon:canvas:v1';
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

function loadCards(): SessionCard[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as SessionCard[]) : [];
    } catch {
        return [];
    }
}

function persist(cards: SessionCard[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cards));
}

type ScrollAction = 'pan' | 'zoom';

interface CanvasState {
    cards: SessionCard[];
    scrollAction: ScrollAction;
    setScrollAction: (a: ScrollAction) => void;
    addCard: (
        position: { x: number; y: number },
        parentId?: string | null,
        forcedId?: string,
    ) => string;
    forkCard: (parentId: string) => string;
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

export const useCanvasStore = create<CanvasState>((set, get) => ({
    cards: loadCards(),
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
        set((s) => {
            const cards = [...s.cards, card];
            persist(cards);
            return { cards };
        });
        return card.id;
    },

    forkCard(parentId) {
        const parent = get().cards.find((c) => c.id === parentId);
        return get().addCard(
            {
                x: (parent?.position.x ?? 0) + 140,
                y: (parent?.position.y ?? 0) + 180,
            },
            parentId,
        );
    },

    moveCard(id, position) {
        get().updateCard(id, { position });
    },

    updateCard(id, patch) {
        set((s) => {
            const cards = s.cards.map((c) =>
                c.id === id ? { ...c, ...patch } : c,
            );
            persist(cards);
            return { cards };
        });
    },

    resizeCard(id, width, height) {
        get().updateCard(id, { size: { width: Math.round(width), height: Math.round(height) } });
    },

    deleteCards(ids) {
        const dead = new Set(ids);
        set((s) => {
            // Orphan children rather than cascading — forks survive parents in v1.
            const cards = s.cards
                .filter((c) => !dead.has(c.id))
                .map((c) =>
                    c.parentId && dead.has(c.parentId)
                        ? { ...c, parentId: null }
                        : c,
                );
            persist(cards);
            return { cards };
        });
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
            const url = opts?.sessionFile
                ? `${MELON_API}/sessions/resume`
                : `${MELON_API}/sessions`;
            pushLog(cardId, `→ ATTACH ${new URL(url).pathname} cwd=${opts?.cwd ?? opts?.sessionFile ?? '(default)'}`);
            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify(
                        opts?.sessionFile
                            ? { cardId, sessionFile: opts.sessionFile }
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
