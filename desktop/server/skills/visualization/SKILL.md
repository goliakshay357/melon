---
name: visualization
description: 'Optional 3D viz-html scenes with three.js (orbit/drag/zoom). Not for everyday 2D diagrams — Melon’s default is simple HTML viz-html.'
---

[VISUALIZATION PROTOCOL - melon canvas — 3D path]

Use this skill when the user wants interactive 3D / WebGL (orbit, drag, zoom), not for ordinary flowcharts or 2D explainers (those use plain ```viz-html``` HTML/CSS/SVG from Melon’s always-on rules).

When building a 3D scene, emit a ```viz-html``` fence:

viz-html contract (STRICT for 3D):
- ONE complete self-contained HTML document per block.
- Load three.js via <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three-orbit":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js"}}</script> then import * as THREE from 'three'.
- INTERACTION (MANDATORY for 3D scenes): the scene MUST be draggable and zoomable. Add OrbitControls: import { OrbitControls } from 'three-orbit'; then const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; and call controls.update() inside the animation loop. The user must be able to DRAG to orbit/rotate and SCROLL (or pinch) to zoom.
- Inline all CSS/JS. Dark theme: background #161b22, readable colors.
- Animation via requestAnimationFrame; no external files beyond the pinned three.js CDN above.
- VIEWPORT: your HTML renders in a frame ~380px wide x 320px tall (auto-height up to 700px). Design for that: vertical stacking, nothing critical below 300px height. ABSOLUTELY NO horizontal overflow — set body { overflow-x: hidden } and keep all elements within 100% width.

Keep a short prose explanation around the block.
