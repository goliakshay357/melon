# Melon — Infinite Canvas of Forkable Coding-Agent Sessions

> A spatial research whiteboard where every card is a live coding-agent chat,
> visualization-first, and every new card is a **fork** of a parent conversation.

---

## 1. Feasibility Verdict

**Highly feasible. Nothing here is research-risky; it's all integration work.**

| Piece | Risk | Why |
|---|---|---|
| Infinite canvas (pan/zoom/drag/edges) | None | Solved problem — React Flow (@xyflow/react). Wondering-style canvases are literally built on this class of library. |
| Chat session inside each box | Low | pi SDK exposes `createAgentSession` + streaming events; embed in a Node backend, stream deltas over WebSocket/SSE. |
| Forking sessions (the "beauty") | ~~Medium~~ → **Low** | pi sessions are JSONL trees (`id`/`parentId`) with native `runtime.fork(entryId)`. A canvas edge = a fork pointer. This is the single biggest de-risk. |
| Visualization-first output (3.js etc.) | Medium | LLMs don't reliably emit runnable viz code. Solve with a **block protocol**: the agent returns typed blocks (text / diagram-spec / 3d-scene / table), and we render specs deterministically. Free-form generated three.js code goes into a sandboxed iframe later. |

**Honest constraints:**
- Cost/latency: N cards can stream simultaneously; need per-card abort + queueing.
- Context bloat: deep forks inherit long histories → lean on pi compaction + branch summaries.
- Viz quality: deterministic spec-blocks first; free-form code-gen viz is a stretch goal, not v1.

---

## 2. Product Shape (v1)

- Beige/calm infinite canvas, dotted grid. Pan (space/drag), zoom (wheel), cards drag freely.
- Root action: "What do you want to understand?" → spawns Card #0.
- Each card:
  - Header: title (auto from first prompt), status dot (idle / thinking / streaming / error).
  - Body toggle: **Chat view ⇄ Viz view** (the visualization toggle).
  - Footer input: type → response streams into this card only.
- Every card has a **"+" on its edge** → creates a connected child card that
  **forks the parent's conversation at its latest entry**. Child sees everything above; new turns diverge.
- Edges drawn as soft curves; deleting a card orphans its subtree (v1: confirm dialog).

---

## 3. Architecture

```
┌────────────── Browser ──────────────┐   WebSocket/SSE    ┌────────── Node Server ──────────┐
│  React Flow canvas                  │ ◄──────────────►   │  Session Manager                │
│  ├─ CardNode (chat ⇄ viz)           │  per-session       │  ├─ Map<sessionId, AgentSession> │
│  ├─ EdgeRenderer (fork links)       │  event streams     │  ├─ runtime.fork(parentEntry)    │
│  ├─ CanvasStore (zustand)           │                    │  └─ pi SDK (@earendil-works/     │
│  └─ BlockRenderer                   │                    │      pi-coding-agent)            │
│     ├─ TextBlock  MermaidBlock      │                    │                                  │
│     ├─ TableBlock ChartBlock        │                    │  Persistence:                    │
│     └─ ThreeBlock (r3f / iframe)    │                    │  canvas.json + native .jsonl     │
└─────────────────────────────────────┘                    └──────────────────────────────────┘
```

### Key decisions

1. **Canvas ≠ sessions.** Two stores:
   - `canvas.json` — node positions, edges, titles, viewport (layout only).
   - pi's own `.jsonl` session files — ground truth of every conversation tree.
   Never duplicate message history into canvas state.
2. **Fork = one call.** `+` button → server calls `runtime.fork(parentSession.lastEntryId)`
   → new sessionId → client adds a node at `parent.pos + offset` with an edge.
3. **Block protocol (viz-first contract).** Agent is instructed (system prompt/skill)
   to answer as JSON-ish fenced blocks:

   ````
   ```block { "type": "three-scene", "spec": { ... } } ```
   ````

   Renderer maps `type → React component`. v1 types:
   - `text`, `table`, `chart` (Recharts), `diagram` (Mermaid/React Flow),
     `three-scene` (react-three-fiber reading a small declarative spec:
     objects[], camera, animation).
4. **Toggle semantics.** Chat view = raw stream. Viz view = parsed blocks rendered
   full-card. Toggle is per-card, purely client-side.
5. **Streaming transport.** One SSE endpoint `/sessions/:id/events`; subscribe on
   card focus, unsubscribe on blur (keeps N-card cost bounded).

### Stack

- Frontend: **Vite + React + TypeScript**, `@xyflow/react`, zustand, react-three-fiber, Recharts, mermaid.
- Backend: **Node + Fastify**, WS/SSE, pi SDK (`createAgentSessionRuntime`), `SessionManager`.
- Monorepo: pnpm workspaces — `apps/web`, `apps/server`, `packages/block-protocol`.

---

## 4. Build Plan (phases, each ends demoable)

### Phase 0 — Canvas skeleton *(½ day)*
Vite app + React Flow: draggable cards, curved edges, pan/zoom, beige theme,
"+ fork" button that spawns a connected dummy child. No AI yet.
✅ *Demo: manual graph grows like the video.*

### Phase 1 — One real chat card *(1 day)*
Fastify server wrapping pi SDK: POST prompt → SSE text deltas. Wire into one card.
Multi-card = same endpoint keyed by sessionId.
✅ *Demo: two independent cards, both chatting.*

### Phase 2 — Fork wiring *(½–1 day)*
`+` → server `fork()` → new node + edge + inherited transcript rendered collapsed
("↳ forked from 'world models' · 6 messages"). Test divergence: parent continues,
child diverges.
✅ *Demo: the core magic works.*

### Phase 3 — Block protocol + Viz toggle *(2–3 days)*
System-prompt the agent toward block output; build renderer for text/table/chart/
diagram; per-card Chat⇄Viz toggle; graceful fallback (unparseable → plain text).
✅ *Demo: ask "explain quicksort" → card shows animated diagram.*

### Phase 4 — Three.js scenes *(2–3 days)*
Declarative scene spec → r3f component (objects, transforms, orbit camera,
play/pause). Later: free-form generated code in sandboxed iframe.
✅ *Demo: "show me a rotation matrix acting on a cube" → spinning cube.*

### Phase 5 — Persistence & polish *(1–2 days)*
Autosave canvas.json, resume sessions, left history sidebar, abort buttons,
error states, keyboard nav, minimap.
✅ *Demo: close browser, reopen, everything's there.*

---

## 5. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Model ignores block format | Few-shot system prompt + tolerant parser + fallback to text. Phase 3 gate. |
| Fork context explosion | Show token count on fork badge; auto-suggest compaction (pi has it built-in). |
| Many concurrent streams | Stream only focused/visible cards; per-card abort; server caps concurrent sessions. |
| Generated JS security | v1: declarative specs only. Free-form code always inside sandboxed iframe (no network, no DOM access to host). |

## 6. First Concrete Step

```bash
pnpm create vite apps/web --template react-ts && pnpm add @xyflow/react zustand
```
Build Phase 0. Everything else hangs off a working canvas.
