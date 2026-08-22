# @earendil-works/melon-web

Melon's infinite-canvas frontend: every card is a live pi coding-agent session,
forkable, visualization-first. Built with Vite + React + TypeScript +
`@xyflow/react` (chartdb-style canvas UX).

## Run

```bash
npx vite --port 5173     # expects melon-server on :8788
```

The API base URL is `http://127.0.0.1:8788` (see `src/store/canvas-store.ts`).
