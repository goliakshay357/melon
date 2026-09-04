# pi-cursor-sdk multicard session isolation patch (Melon)

`pi-cursor-sdk@0.3.6` assumes one pi session per Node process. Melon runs every
canvas card in one process, so two Cursor cards fight over the same globals:

- one process-global pi tool bridge, disposed when another session loads the
  extension, surfacing as `Cursor pi bridge tool call is no longer pending`
  and ask_question panels that never open (or open on the wrong card)
- one global session scope (`cursor-session-scope`), so the card that bound
  last decides which session key, cwd and trust flag every other card sees
- one global resume/lineage state, so card B's `turn_end` can write card A's
  `cursor-sdk-agent-resume` handle into B's transcript

This folder is the durable Melon-owned fix until upstream ships multi-session
support. After `npm install` in `desktop/`, re-apply:

```bash
node desktop/scripts/apply-pi-cursor-sdk-multicard-patch.mjs
```

## How it works

`cursor-host-session.js` (new module) holds an `AsyncLocalStorage` with the
session running the current turn. The host opts in per turn:

```js
runInCursorHostSession({ sessionFile, sessionId, cwd }, () => session.prompt(text));
```

Every patched module then resolves its state from that context instead of from
"whoever bound last":

- `cursor-pi-tool-bridge`: bridges live per extension runner and are indexed by
  session scope key; `getRegisteredCursorPiToolBridge()` returns the bridge of
  the calling session. Registering a new card never disposes siblings.
- `cursor-session-scope`: keeps a scope snapshot per session; the getters
  (`getCursorSessionScopeKey`, `getCursorSessionCwd`, …) read the caller's.
- `cursor-session-agent-resume` / `cursor-session-agent-lineage`: one state per
  session, with `appendEntry` bound to that session's transcript.
- `cursor-session-agent-lifecycle`: shutdown, compaction, tree edits and model
  switches dispose/invalidate the Cursor agent of the session that fired the
  event. Upstream used the global scope, so card B closing (or compacting)
  disposed card A's live agent. For the same reason a scope change is now
  tracked per extension runner: a sibling card binding is not "this session
  moved to a new scope". Process-global HTTP/1 configuration is cleared only
  after the last Cursor session exits, never while a sibling is live.
- `index`: compaction preparation uses the session manager from the event,
  rather than relying on whichever async context happens to be current.

Outside a host session context — the pi TUI, tests, single-session hosts —
`isCursorHostSessionIsolationEnabled()` stays false and every module keeps the
original last-session-wins behaviour.
