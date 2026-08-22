# Phase 1 — Canvas Foundation (chartdb-style base)

Goal: melon's infinite canvas **feels** like chartdb's editor page before any AI exists.

Reference implementation: `/Users/akshay/Desktop/workspace/chartdb/src/pages/editor-page/canvas/canvas.tsx`

## 1. Project setup (mirror chartdb configs)
- [ ] Vite + React 18 + TypeScript app at `apps/web`
- [ ] `vite.config.ts`: react plugin, `@ → ./src` alias
- [ ] tsconfig strict, ES2022 target
- [ ] Tailwind + PostCSS, shadcn/new-york conventions (`components.json`)
- [ ] Deps: `@xyflow/react@^12`, zustand, lucide-react, clsx + tailwind-merge, react-hotkeys-hook

## 2. Canvas shell (`src/canvas/canvas.tsx`) — chartdb's exact ReactFlow settings
- [ ] `<ReactFlow>` with:
  - [ ] `panOnScroll` from a `scrollAction` local-config ('pan' default, persisted localStorage)
  - [ ] `minZoom={0.1} maxZoom={5}`, `fitView={false}`
  - [ ] `onlyRenderVisibleElements`
  - [ ] `snapToGrid={[20,20]}` when Shift held (useKeyPress) or magnet toggle
  - [ ] `selectionMode={SelectionMode.Full}`
  - [ ] `multiSelectionKeyCode={['Shift','Meta','Control']}`, `deleteKeyCode={['Backspace','Delete']}`
  - [ ] `<Background variant={Dots} gap={16} size={1} />`
- [ ] Beige theme via HSL CSS variables in `globals.css`

## 3. Nodes & edges (melon domain)
- [ ] `ChatCardNode` — rounded white card: title bar + status dot (idle/streaming), body, footer input stub
- [ ] Card size ~380×420 min, resizable later
- [ ] `ForkEdge` — soft curved edge, custom marker
- [ ] "+" fork button on card header → spawns child node at offset + connected edge (dummy state, no agent yet)

## 4. Chrome
- [ ] Bottom toolbar: zoom % live display, zoom in/out (200ms duration), fit-view button
- [ ] MiniMap bottom-right (toggleable)
- [ ] Right-click canvas context menu (Radix) — "New card", "Fit view"
- [ ] Escape closes/demotes any active overlay interaction

## 5. State & persistence
- [ ] Zustand store: `{ nodes, edges }` layout ONLY (no conversation history)
- [ ] Debounced autosave to localStorage `melon:canvas:v1`; hydrate on load
- [ ] Node ids = future sessionId placeholders (nanoid)

## 6. UX polish gates (the "sweetness" checklist)
- [ ] Dragging a card never selects the pane; pane drag never moves cards
- [ ] Scroll = pan feels natural on trackpad; pinch = zoom
- [ ] Multi-select rubber band fully-encloses nodes (SelectionMode.Full feel)
- [ ] No jank with ~50 dummy cards (`onlyRenderVisibleElements` verified)

## 7. Patterns lifted from chartdb source (verified 2025 exploration)
- [ ] `focused = !!selected && !dragging` on card body (note-node pattern) — typing never drags
- [ ] Inputs get `className="nodrag"` + `onClick/onKeyDown stopPropagation`
- [ ] Drag starts from title bar only; scroll = pan via localStorage-persisted toggle
- [ ] "Show all" button via useIsLostInCanvas-style viewport intersection check
- [ ] rAF-throttled mousemove for any cursor-following overlay

## 8. Pi spike (de-risks Phase 2, run anytime in Phase 1)
- [ ] Script: createAgentSession + SessionManager.inMemory → prompt("hello") →
      print text_delta stream → dispose. Confirms event model end-to-end.

## Demo gate
Open app → pan/zoom freely → create card → fork twice → rearrange → reload → layout intact.
Type into a card input while dragging it by its header — no focus steal, no drag.
