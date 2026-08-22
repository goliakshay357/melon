# Phase 2 — Pipe Cards to Pi

Goal: every card becomes a live pi session. Type → streamed response. "+" → real
forked session. Close app → reopen → resume everything, diagrams included.

## 0. Spike (do first, half-day)
- [ ] Script: `createAgentSession` + `SessionManager.inMemory` → `prompt("hello")` →
      print `message_update/text_delta` events → `dispose()`. Proves event model.
- [ ] Script: same with `SessionManager.create(melonDir)` → confirm `.jsonl`
      appears under `~/.pi/agent/sessions/<slug>/`.
- [ ] Script: `runtime.fork(entryId, { position: "at" })` → verify new file +
      `parentSession` header + copied path.

## 1. Server (`apps/server`) — owns ALL sessions
- [ ] Fastify + WS (or SSE) server; loads pi SDK.
- [ ] **One `AgentSessionRuntime` per card**, registry `Map<cardId, runtime>`.
      Never share a SessionManager across cards.
- [ ] Endpoints:
  - [ ] `POST /sessions` → new card-session (cwd = melon workspace)
  - [ ] `POST /sessions/:id/prompt` → starts run; stream events to subscriber
  - [ ] `GET  /sessions/:id/events` (SSE) → text_delta, agent_start/end,
        tool_execution_*, errors
  - [ ] `POST /sessions/:id/fork` → `fork(lastEntryId, {position:"at"})` →
        returns new sessionId
  - [ ] `POST /sessions/:id/abort`
  - [ ] `GET  /projects/:slug/sessions` → list for resume sidebar
  - [ ] `GET  /sessions/by-path?path=` → open existing .jsonl (resume)
- [ ] Concurrency guard: reject prompt while streaming; cap concurrent runs.

## 2. Canvas ↔ session binding
- [ ] `canvas.json` gains: `{ cardId ↔ sessionId }`, plus melon-owned
      `forkMap: { childCardId → parentEntryId }` (pi does NOT record fork point).
- [ ] Card creation flow: addCard → POST /sessions → store sessionId.
- [ ] Fork flow: click "+" → POST fork → new card node + edge + sessionId.

## 3. Streaming UI
- [ ] Replace stub reply in `sendMessage` with real stream; append deltas live.
- [ ] Status dot driven by real events: idle → streaming (agent_start) → idle
      (agent_end); error state on failures.
- [ ] Disable input + "+" while that card is streaming (can't fork mid-run).
- [ ] Abort button (■) replaces send while streaming.

## 4. Visualization pass-through (thin slice of VIZ-GOAL milestone 1)
- [ ] Server extracts ```viz-html fenced blocks from assistant messages;
      emits `viz` events alongside text.
- [ ] Card gets Viz toggle; renders block in sandboxed iframe (`allow-scripts`).
- [ ] Persisted automatically via session file (assistant message contains it).

## 5. Resume & history (the "tomorrow" requirement)
- [ ] Left sidebar: projects (folder slugs) → sessions (from
      `SessionManager.listAll`), named by first message / `session_info`.
- [ ] Clicking an old session → opens card(s): rebuild canvas nodes from
      `parentSession` headers + melon's forkMap; transcript rendered from
      entry history; viz blocks re-rendered in their iframes.
- [ ] Sessions with no canvas layout yet → auto-layout tree (simple vertical
      stack or tidy tree).

## Demo gate
Type in card A → answer streams in. Fork A → B asks follow-up using A's context.
Fork A → C diverges differently. Restart app → sidebar shows the project →
reopen → all three cards restored with transcripts AND working viz frames.
