# @earendil-works/melon-server

HTTP/SSE bridge that lets the Melon canvas web app drive live pi sessions.
Melon web is a pi frontend — a peer of the TUI — so sessions are created in
pi's **default** store (`~/.pi/agent/sessions/<project-slug>/`), meaning the
terminal TUI and canvas share history for the same folder.

## API

| Route | Purpose |
|---|---|
| `POST /sessions` `{cardId, cwd}` | New pi session in the chosen folder |
| `POST /sessions/resume` `{cardId, sessionFile}` | Resume an existing .jsonl |
| `GET /projects` | Sidebar data: projects → their sessions |
| `GET /sessions/:cardId/events` | SSE stream: `delta`, `status`, `tool`, `error` |
| `POST /sessions/:cardId/prompt` `{text}` | Send user message (deltas flow via SSE) |
| `POST /sessions/:cardId/abort` | Abort current run |

## Config (env)

| Var | Default |
|---|---|
| `MELON_PORT` | `8788` |
| `MELON_DEFAULT_MODEL` | `opencode-go/ox-alpha-free` |
| `MELON_DEFAULT_THINKING` | `high` |
| `MELON_DEFAULT_CWD` | `~/Desktop/workspace/melon` |

## Run

```bash
npm run build && npm start        # or: npm run dev (watch)
```

## Test

```bash
npm test                # unit + route tests, no LLM needed
MELON_E2E=1 npm test    # + live model round-trip
```

Docs: see `docs/` (plan.md, PHASE-1.md, PHASE-2.md, VIZ-GOAL.md).
