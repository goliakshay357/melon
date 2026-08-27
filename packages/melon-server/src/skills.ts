import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

export interface Skill {
	id: string;
	name: string;
	description?: string;
	instructions: string;
}

function parseSkillMd(id: string, md: string): Skill | null {
	const m = md.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
	const front = m ? m[1] : "";
	const body = m ? m[2].trim() : md.trim();
	if (!body) return null;
	const name = front.match(/name:\s*(.+)/)?.[1]?.trim() ?? id;
	const description = front.match(/description:\s*(.+)/)?.[1]?.trim();
	return { id, name, description, instructions: body };
}

/** Built-in melon skills (always available; custom skills.json can override). */
const BUILTIN: Record<string, Skill> = {
	visualization: {
		id: "visualization",
		name: "Visualization",
		description: "Explain with interactive 3D viz-html scenes (three.js, draggable/zoomable)",
		instructions: `[VISUALIZATION PROTOCOL - melon canvas]
You explain on a visual canvas. When a visual genuinely aids understanding, include:
2. \`\`\`viz-html fenced blocks for interactive 3D/animated scenes.
viz-html contract (STRICT):
- ONE complete self-contained HTML document per block.
- Load three.js via <script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js","three-orbit":"https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/controls/OrbitControls.js"}}</script> then import * as THREE from 'three'.
- INTERACTION (MANDATORY for 3D scenes): the scene MUST be draggable and zoomable. Add OrbitControls: import { OrbitControls } from 'three-orbit'; then const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; and call controls.update() inside the animation loop. The user must be able to DRAG to orbit/rotate and SCROLL (or pinch) to zoom.
- Inline all CSS/JS. Dark theme: background #161b22, readable colors.
- Animation via requestAnimationFrame; no external files.
- NEVER emit mermaid, flowchart, or ASCII-art diagrams (e.g. flowchart TB). They render badly. For diagrams use a viz-html scene instead; otherwise explain in prose.
- VIEWPORT: your HTML renders in a frame ~380px wide x 320px tall (auto-height up to 700px). Design for that: vertical stacking, nothing critical below 300px height. ABSOLUTELY NO horizontal overflow — set body { overflow-x: hidden } and keep all elements within 100% width.
Keep prose explanation around the blocks.`,
	},
	"product-manager": {
		id: "product-manager",
		name: "Product Manager",
		description: "Explain from a non-developer product POV: plain language, no code internals, k8s-style diagrams",
		instructions: `Explain from a PRODUCT MANAGER's point of view — the reader is a NON-DEVELOPER (a junior intern). Describe WHAT the system does: users, features, business flows, and how data moves between parts. NEVER show developer internals: function names, variables, file paths, code snippets, DB schemas, or API internals. If a technical term is unavoidable, give it a plain-language label.
DIAGRAM STYLE: prefer simple labeled box-and-arrow layouts (like Kubernetes architecture diagrams): components as labeled boxes, connections as arrows with plain-language labels. Use color only to distinguish roles (users, services, data stores).`,
	},
};

/**
 * Skill registry.
 * - built-in melon skills (visualization, product-manager)
 * - pi skills: discovered read-only from ~/.pi/agent/skills/<id>/SKILL.md
 * - custom melon skills: <agentDir>/melon/skills.json -> { id: {name?, description?, instructions} }
 * Later entries override earlier ones with the same id.
 */
export function loadSkills(): Record<string, Skill> {
	const all: Record<string, Skill> = { ...BUILTIN };
	try {
		const piSkillsDir = join(homedir(), ".pi", "agent", "skills");
		for (const dir of readdirSync(piSkillsDir)) {
			const md = join(piSkillsDir, dir, "SKILL.md");
			if (!existsSync(md)) continue;
			const skill = parseSkillMd(dir, readFileSync(md, "utf8"));
			if (skill) all[skill.id] = skill;
		}
	} catch {
		/* no pi skills dir */
	}
	try {
		const custom = JSON.parse(readFileSync(join(getAgentDir(), "melon", "skills.json"), "utf8"));
		for (const [id, s] of Object.entries(custom)) {
			const c = s as any;
			all[id] = {
				id,
				name: c.name ?? id,
				description: c.description,
				instructions: String(c.instructions ?? ""),
			};
		}
	} catch {
		/* no custom skills file */
	}
	return all;
}
