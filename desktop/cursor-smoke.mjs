// Smoke: bundled layout only (desktop/server + desktop/node_modules).
// Validates cursor extension resolution, GUI-runtime registration, and
// session wiring — no Cursor key needed (fallback catalog registers offline).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.MELON_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "melon-cursor-smoke-"));

const { buildApp } = await import("./server/index.js");
const app = await buildApp();

const models = await app.inject({ method: "GET", url: "/models?provider=cursor" });
const list = models.json().models ?? [];
console.log(`[smoke] cursor models via /models: ${list.length}`);
console.log(`[smoke] sample: ${list.slice(0, 6).map((m) => m.id).join(", ")}`);

const providers = await app.inject({ method: "GET", url: "/auth/providers" });
const cursor = (providers.json() ?? []).find((p) => p.id === "cursor");
console.log(`[smoke] cursor provider entry: ${JSON.stringify(cursor)}`);

const s = await app.inject({
	method: "POST",
	url: "/sessions",
	payload: { cardId: "cursor-smoke", cwd: "/tmp", model: "cursor/grok-4.6" },
});
console.log(`[smoke] session create: status=${s.statusCode} model=${s.json().model} error=${s.json().error ?? "none"}`);

await app.close();
console.log("[smoke] done");
