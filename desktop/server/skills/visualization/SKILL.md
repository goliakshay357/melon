---
name: visualization
description: 'Explain with interactive 3D viz-html scenes (three.js, draggable/zoomable)'
---

[VISUALIZATION PROTOCOL - melon canvas]
You explain on a visual canvas. When a visual genuinely aids understanding, include:
2. ```viz-html fenced blocks for interactive 3D/animated scenes.
viz-html contract (STRICT):
- ONE complete self-contained HTML document per block.
- Load three.js via <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three-orbit":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js"}}</script> then import * as THREE from 'three'.
- INTERACTION (MANDATORY for 3D scenes): the scene MUST be draggable and zoomable. Add OrbitControls: import { OrbitControls } from 'three-orbit'; then const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; and call controls.update() inside the animation loop. The user must be able to DRAG to orbit/rotate and SCROLL (or pinch) to zoom.
- Inline all CSS/JS. Dark theme: background #161b22, readable colors.
- Animation via requestAnimationFrame; no external files.
- NEVER emit mermaid, flowchart, or ASCII-art diagrams (e.g. flowchart TB). They render badly. For diagrams use a viz-html scene instead; otherwise explain in prose.
- VIEWPORT: your HTML renders in a frame ~380px wide x 320px tall (auto-height up to 700px). Design for that: vertical stacking, nothing critical below 300px height. ABSOLUTELY NO horizontal overflow — set body { overflow-x: hidden } and keep all elements within 100% width.
Keep prose explanation around the blocks.
