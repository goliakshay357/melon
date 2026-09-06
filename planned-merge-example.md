---
id: ho_m7xk2q
kind: merge
title: compaction flake + prompt v2
revision: 1
created: 2026-09-06T14:22:10Z
updated: 2026-09-06T14:35:44Z
edited: true
sources:
  - cardTitle: "flaky compaction test"
    sessionFile: ~/.pi/agent/sessions/--Users-akshay-workspace-pi--/2026-09-05T11-04-12_0198ab.jsonl
    sessionId: 0198ab-...
    leafEntryId: e_91f2
    cwd: /Users/akshay/workspace/pi
    handoffId: ho_3f9kx2
  - cardTitle: "compaction prompt v2"
    sessionFile: ~/.pi/agent/sessions/--Users-akshay-workspace-pi--/2026-09-05T16-40-33_0198cd.jsonl
    sessionId: 0198cd-...
    leafEntryId: e_77a1
    cwd: /Users/akshay/workspace/pi
    handoffId: ho_8w2nd1
generatedBy: { model: glm-4.6, thinkingLevel: high, promptVersion: merge-1 }
history:
  - r1 generated from 2 sources (2026-09-06T14:22:10Z)
  - r1 edited via AI refine: "fold in the flush-ordering constraint" (14:31)
  - r1 edited by user (14:35)
wires: []
---

## Shared goal
Make session compaction deterministic so `test/compaction.test.ts` stops
flaking, without losing the token savings from the prompt v2 rewrite.

## What "flaky compaction test" established
- Flake reproduces ~1/20 runs: `assert(summary before entry_92)` fails.
- Root cause candidate: `buildContextEntries` reads entries appended by the
  summarizer *before* the file flush lands (async gap in `_persist`,
  session-manager.ts:1015). Repro command:
  `for i in $(seq 1 30); do node --test test/compaction.test.ts || break; done`
- Ruled out: clock skew in entry timestamps, parentId chain corruption.

## What "compaction prompt v2" established
- New SUMMARIZATION_SYSTEM_PROMPT cuts compaction output ~38% (14.2k -> 8.8k
  tokens) across 40 sampled sessions. Measurement script survives at
  scripts/measure-compaction.py.
- Prompt rewrite did NOT touch _persist or buildContextEntries.

## Decisions
- Keep the v2 prompt; do not revert (B measured, A did not dispute).
- Fix belongs in flush/replay ordering, not in the test (do not add retries).

## Conflicts to resolve
1. B shipped a workaround: test waits 50ms before asserting
   (test/compaction.test.ts:112). A's root cause says timing sleeps mask the
   race, they don't fix it. B's session never saw A's root cause. Default
   stance taken below; flip it here if you disagree.
2. A says "do not add retries"; B's workaround is effectively a retry.

## Open questions
- Does the 50ms sleep in B's branch hide the flake fully or only locally?
- Should compaction entries fsync before publish, or is in-process ordering
  enough once the await gap is closed?

## Evidence (do not re-derive)
- Repro loop above: 30 iterations, fails on ~2nd for seed 7.
- Token table: 14.2k -> 8.8k mean over 40 sessions (before/after v2 prompt).

## Next steps
1. Close the await gap in _persist -> buildContextEntries ordering.
2. Remove the 50ms sleep; run the repro loop 100x.
3. Re-run measure-compaction.py to confirm savings survive the fix.

## Handoff notes (mine)
Work on branch akshay/compaction-flake. The repro loop is the acceptance
gate — no fix PR without 100 clean iterations. Do not touch the v2 prompt.
