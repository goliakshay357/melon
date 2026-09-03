# Cursor Provider Integration Plan (Melon × pi-cursor-sdk)

Status: proposed, not started
Scope: desktop shell + melon-server. No changes to `packages/ai`, `packages/coding-agent`, or the GUI components.

## Goal

Make Cursor models (`cursor/grok-4.6`, `cursor/gpt-5.5@1m:high`, …) first-class citizens in Melon: visible in the provider list, configurable with a Cursor SDK API key from the GUI, selectable per card, and streamable through pi's normal session flow.

## Non-goals

- No native Cursor provider in `packages/ai` (Cursor has no public completions API; pi-cursor-sdk runs the official `@cursor/sdk` agent loop in-process — porting it would be a large, perpetually-drifting rewrite).
- No OpenAI-compatible proxy process.
- No UI changes beyond what the existing dynamic endpoints already render.
- No Cursor Cloud runtime opt-in (`/cursor-cloud`); local runtime only.

## Approach (one sentence)

Ship `pi-cursor-sdk` as a bundled npm dependency of the desktop app, load it through pi's existing extension machinery into both the session runtime and the GUI model runtime, and fix the one real blocker: GUI-entered provider keys are never persisted to `auth.json`.

KISS notes:

- We reuse the extension loader that sessions already run. Nothing new is invented for provider registration, model discovery, auth resolution, or streaming.
- We do NOT materialize the extension into `~/.melon/agent/extensions/` (copying `node_modules` into user space adds version-drift and upgrade logic for zero benefit — the bundled-path approach needs no filesystem writes at all).
- Rejected alternatives: native provider in `packages/ai` (see non-goals); OpenAI-compatible proxy (wrong abstraction for pi, extra process); `pi install npm:pi-cursor-sdk` into `~/.melon` (requires users to have the CLI and manual steps; app should ship complete).

## Verified facts this plan relies on

Researched in this repo + https://github.com/fitchmultz/pi-cursor-sdk (v0.3.6):

1. pi-cursor-sdk is a standard pi extension (`"pi": {"extensions": ["./dist/index.js"]}`) that calls `pi.registerProvider("cursor", { name, baseUrl, apiKey: <placeholder>, models, streamSimple })` after `discoverModels()`. Discovery uses `Cursor.models.list()` with a bundled fallback catalog when no key is present, cached on disk (24h TTL).
2. Streaming goes through the extension's `streamSimple` (Cursor SDK agent loop); the `api: "cursor-sdk"` string is model metadata only. Auth is resolved at turn time from `auth.json` entry `cursor` (via `readStoredCredential`) or `CURSOR_API_KEY` — the registered `apiKey` is a literal placeholder, not a secret.
3. Melon's GUI is fully dynamic: `GET /auth/providers` and `GET /models?provider=` in `packages/melon-server/src/index.ts` are built from `ModelRuntime` + `auth.json`. No hardcoded provider lists anywhere in `melon-web`.
4. Gap A — GUI runtime: `getModelRuntime()` is a bare `ModelRuntime.create()`; it never loads extensions. Sessions, in contrast, load extensions via `createAgentSessionServices()` → `DefaultResourceLoader` and flush `pendingProviderRegistrations` into each session's fresh `ModelRuntime` (`agent-session-services.ts`).
5. Gap B — key persistence: `POST /auth/:provider/key` calls `ModelRuntime.setRuntimeApiKey()`, which is an in-memory runtime overlay only. It never reaches `auth.json`, so sessions (fresh `ModelRuntime` each) never see GUI-entered keys. This is a pre-existing bug for every provider, and fatal for Cursor specifically since the extension reads `auth.json` directly.
6. `DefaultResourceLoaderOptions.additionalExtensionPaths` exists and is treated like explicitly-configured CLI extension paths (not gated by project trust, loaded in addition to global/project discovery).
7. The installed `@earendil-works/pi-coding-agent` dist exports `discoverAndLoadExtensions(configuredPaths, cwd, agentDir)` (it also loads global extensions from `agentDir/extensions` — acceptable: the GUI then mirrors what sessions see). The low-level `loadExtensions` is not exported.
8. `ModelRuntime.registerProvider(providerId, config)` is public — that is the flush target for the GUI runtime.
9. Electron 43 embeds Node 24.18.1, satisfying the SDK's `>=22.19` engines requirement. The desktop's pi-coding-agent is branded `configDir: ".melon"`, so extension discovery and credential reads land in `~/.melon/agent` automatically.
10. There is no public "persist an API key" API for extension providers (`Models.login` requires a provider-owned login flow). A direct, small `auth.json` write in melon-server is the simplest correct option, consistent with the endpoint's existing direct `auth.json` read.

## Implementation

Four changes, three files. Everything else already works.

### 1. `desktop/package.json` — bundle the extension

- Add `"pi-cursor-sdk": "0.3.6"` (exact pin) to `dependencies`. It pins `@cursor/sdk@1.0.27` itself.
- Extend `asarUnpack` so native binaries and spawned executables can run:

```json
"asarUnpack": [
  "node_modules/@earendil-works/pi-coding-agent/**/*",
  "node_modules/pi-cursor-sdk/**/*",
  "node_modules/@cursor/**/*",
  "node_modules/@connectrpc/**/*",
  "node_modules/@modelcontextprotocol/**/*",
  "node_modules/@hono/**/*"
]
```

Exact unpack list to be finalized by inspecting `desktop/node_modules` layout after install (hoisting may relocate packages; unpack generously — the risk is silent breakage in the packaged DMG only).

Dep change is reviewed code per repo rules: exact version pin, `npm install --ignore-scripts` in `desktop/`, commit the resulting `desktop/package-lock.json`.

### 2. `packages/melon-server/src/cursor-extension.ts` — new, ~30 lines

One module owns everything Cursor-specific:

```ts
import { dirname } from "node:path";
import { createRequire } from "node:module";
import { discoverAndLoadExtensions, getAgentDir, type ModelRuntime } from "@earendil-works/pi-coding-agent";

const require = createRequire(import.meta.url);

/** Bundled pi-cursor-sdk package dir, or null when not installed (feature absent, not an error). */
export function cursorExtensionPath(): string | null {
  try { return dirname(require.resolve("pi-cursor-sdk/package.json")); } catch { return null; }
}

/** Register the cursor provider (and any global extensions) into a ModelRuntime. */
export async function loadCursorProviderInto(runtime: ModelRuntime): Promise<void> {
  const extPath = cursorExtensionPath();
  if (!extPath) return;
  const agentDir = getAgentDir();
  const result = await discoverAndLoadExtensions([extPath], agentDir, agentDir);
  for (const { name, config } of result.runtime.pendingProviderRegistrations) {
    try { runtime.registerProvider(name, config); } catch (e) { console.error(`[melon] ${name} provider registration failed:`, e); }
  }
  await runtime.refresh({ allowNetwork: false });
}
```

Notes:
- Passing the package directory (not `dist/index.js`) lets pi's discovery resolve the `pi` manifest itself.
- Passing `agentDir` as `cwd` means no project-local `.pi/extensions` scan; global extensions load too, which keeps the GUI consistent with sessions.
- Fail-open: any failure leaves builtin providers untouched. Log and continue.

### 3. `packages/melon-server/src/index.ts` — two wiring points + key persistence

a) Sessions — add one line to `createRuntimeFor()`'s `resourceLoaderOptions`:

```ts
const resourceLoaderOptions = {
  skillsOverride, appendSystemPromptOverride,
  additionalExtensionPaths: cursorExtensionPath() ? [cursorExtensionPath()!] : [],
};
```

b) GUI singleton — register into `getModelRuntime()`:

```ts
async function getModelRuntime(): Promise<ModelRuntime> {
  if (!_modelRuntime) {
    _modelRuntime = await ModelRuntime.create();
    await loadCursorProviderInto(_modelRuntime);
  }
  return _modelRuntime;
}
```

The extension's disk-cached catalog keeps this a no-network call on warm starts; first start with a key present does one `Cursor.models.list()` round-trip.

c) Persist keys — extend `POST /auth/:provider/key` to also write `auth.json` (mode `0600`, merge-don't-clobber):

```ts
// after setRuntimeApiKey(...) succeeds:
const authPath = join(getAgentDir(), "auth.json");
const auth = existsSync(authPath) ? JSON.parse(readFileSync(authPath, "utf8")) : {};
auth[provider] = { type: "api_key", key };
mkdirSync(getAgentDir(), { recursive: true });
writeFileSync(authPath, JSON.stringify(auth, null, "\t"), { mode: 0o600 });
```

Also extend `DELETE /auth/:provider` to remove the entry. This closes Gap B for every provider, not just Cursor.

### 4. No changes needed

- `melon-web`: provider picker, model picker, and settings page render whatever `/auth/providers` and `/models` return.
- `packages/ai` / `packages/coding-agent`: the extension path is fully supported machinery.
- `build-dmg.sh`: unchanged (electron-builder picks up the new dependency via `desktop/package.json`).

## Runtime behavior after integration

- Cold start, no key: `cursor` provider registers with the fallback catalog → appears in the provider list, models selectable, runs fail with the extension's setup hint (key required). Same behavior as the TUI.
- Key entry in GUI: `POST /auth/cursor/key` → runtime overlay + `auth.json`. New sessions run live discovery → full catalog. Existing cards keep their old list until re-attached; acceptable for v1.
- Model selection: `cursor/<id>` flows through the existing `splitModel` / `getModel` path unchanged.
- No key change after startup on the extension side requires either a new session (re-discovers) or a server restart — `/cursor-refresh-models` is a TUI slash command and is out of scope for v1 (see Phase 2).

## Test plan

1. `npm run check` at repo root after melon-server changes.
2. New melon-server vitest: `buildApp()` with the dependency present registers a `cursor` provider — `GET /models?provider=cursor` returns non-empty and `/auth/providers` contains `cursor` (skip if `pi-cursor-sdk` unresolvable, so CI without the dep still passes). Add a test that `POST /auth/:provider/key` writes `auth.json` with mode 0600 and merges with existing entries.
3. Dev smoke (`cd desktop && npm start`): provider list shows Cursor → enter Cursor SDK API key → new card with `cursor/grok-4.6` → prompt round-trip streams.
4. Concurrency check (highest-risk behavior, see risks): two cards on Cursor models prompting simultaneously; verify no cross-card bleed (each card's replies reference their own prompts) and clean abort on one card.
5. Packaged smoke: `./build-dmg.sh`; repeat steps from 3 inside the DMG build. asar-related failures only appear here.

## Risks and mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| pi-cursor-sdk is designed for one TUI session per process; Melon runs many concurrently | High | The extension keys agent/HTTP state by session scope (`cursor-session-scope.ts`), so concurrent sessions are plausible but unproven. Test #4 is a release gate; if it fails, fall back to serializing Cursor turns per process. |
| ESM/native binaries inside asar | Medium | `asarUnpack` entries; verify only in packaged build (step 5). pi-coding-agent already proves the unpack pattern works. |
| electron-builder + optional platform deps of `@cursor/sdk` | Medium | Build on the target OS (already macOS arm64-only); confirm the unpacked tree contains the platform binary after packaging. |
| Extension load slows GUI runtime creation (discovery round-trip) | Low | 24h disk cache in the extension; fail-open registration; fallback catalog when unkeyed. |
| App size grows (SDK + platform packages) | Low | Accept; measured during implementation. |
| GUI shows `cursor` as "configured" via the placeholder apiKey even without a real key | Low | Cosmetic; Phase 2. |
| melon-server auto-prune denylists Cursor models after transient provider errors | Low | Existing `denylistedModels` mechanism already has touch-clears-on-select behavior; observe, don't pre-engineer. |

## Phase 2 (deferred, do not build now)

- `POST /models/refresh` endpoint: unload/reload the cursor provider on the GUI runtime to refresh the live catalog after key entry without restarting; optional "refresh" affordance in the picker.
- `/auth/providers`: report `cursor` configured only when a real key exists (auth.json `cursor` entry or `CURSOR_API_KEY`), papering over the extension's placeholder `apiKey`.
- Surface the extension's fallback-catalog warning (it currently emits a TUI warning event) as a Melon status banner.

## Open questions

1. Bundle Cursor in every DMG by default (assumed yes), or behind a settings toggle?
2. Key entry UX: is the generic "Enter an API key for this provider" dialog sufficient for Cursor, or should it link to Cursor Dashboard → API Keys (the key is an SDK API key, not the subscription login)?

## Work order

1. `desktop/package.json` dep + install.
2. `cursor-extension.ts` + melon-server wiring (GUI runtime first — verifiable via curl before any UI work).
3. `auth.json` persistence + tests.
4. Session wiring (`additionalExtensionPaths`) + dev smoke with a real key.
5. Concurrency test, then packaged DMG smoke.
