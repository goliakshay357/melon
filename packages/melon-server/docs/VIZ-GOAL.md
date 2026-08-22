# Melon Viz — End Goal

> Every card can flip from chat to a living visualization: real three.js scenes,
> charts, diagrams — generated as code by the agent, validated before you ever
> see them, and permanent once rendered.

## The End Goal (what "done" feels like)

You ask a card *"show me how a quaternion rotates a cube"*. The card switches to
viz mode. Behind the curtain, the agent writes a self-contained HTML scene,
**tests it in headless Chromium**, fixes its own mistakes, and only then does
the finished, animated 3D scene fade into your card. You never see a broken
frame, never wait on a CDN, never re-pay to see it again tomorrow.

Reload next week: every viz is still there, instant, rendered from the session
file. Zoom out and 50 viz cards become crisp thumbnails; zoom in and they come
alive. Nothing melts.

## Principles

1. **Code, not specs.** The agent writes real HTML/JS (three.js, d3, anything).
   A coding-agent product should flex its actual muscle.
2. **Validate-before-render.** Headless Chromium runs every scene first.
   Console errors + screenshot feed back into the session for self-correction.
   The user is never the error handler.
3. **Render once, keep forever.** Validated HTML persists in the pi session
   (`custom_message`). Re-rendering is free and instant; regeneration only on
   request.
4. **Respect the machine.** WebGL contexts are capped (~8–16/page). Iframes
   mount only when visible + in viz mode; animation pauses off-screen;
   zoomed-out cards show their validation screenshot instead of a live scene.
5. **Hard security floor.** `sandbox="allow-scripts"`, never `allow-same-origin`.
   Vendored, version-pinned libraries via import map from our own origin.
   No network access unless explicitly granted per card.

## Architecture in One Line Each

- **Transport:** agent reply contains a `viz-html` fenced block → server extracts it.
- **Validation:** Playwright run → console errors + thumbnail screenshot → retry loop (agent fixes itself).
- **Storage:** HTML + thumbnail persisted in session entries; canvas.json only holds layout.
- **Render:** one iframe per active card (`srcDoc` created once), HTML streamed in via `postMessage` — no remount flicker.
- **Lifecycle:** IntersectionObserver + React Flow visibility decide mount / pause / thumbnail swap.
- **Error UX:** user sees "rendering…" → fade-in, or an honest failure card with the agent's explanation. Never raw stack traces.

## Milestones (order, not dates)

1. **Working slice** — iframe harness, Chat⇄Viz toggle, persist HTML, manual generation.
2. **Trustworthy** — headless validation loop + honest-failure state.
3. **Scale** — visibility-based mounting, pausing, zoom-out thumbnails.
4. **Fast path** — declarative spec blocks for boring-common cases (bar charts,
   mermaid) that skip the iframe entirely.

## What This Unlocks

The fork tree becomes a tree of *explanations*: fork a card asking "same rotation,
but show it as a matrix transformation" and watch two visual arguments diverge
side by side on one canvas. That's the product nobody else has.
