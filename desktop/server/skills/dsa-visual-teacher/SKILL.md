---
name: dsa-visual-teacher
description: 'Teach a DSA / dynamic-programming / algorithm problem to a beginner through an interactive, self-contained HTML walkthrough. Use when the user gives a new algorithm or DP problem statement and wants it explained step by step, visually, with animations — especially if they say they are new, find DP hard, want it "phase by phase", want finger/pointer tracing, want live code sync, or reference this teaching style. Produces one single .html file named after the problem, containing phased explanations, a pointer-tracing panel, an animated DP table, interview-style KISS Python code with per-step line highlighting, and a live variables panel.'
---

# DSA Visual Teacher

Teach algorithm problems to a beginner by building ONE self-contained interactive HTML page. No frameworks, no CDNs, no external files — inline CSS + vanilla JS only, works offline by double-clicking.

## Non-negotiables (learned from the user)

1. **Phases, never a wall of text.** Split the lesson into 4–6 named phases, each phase = ONE small idea. Buttons: Next / Back / Replay phase, plus a phase-jump bar.
2. **Concrete before abstract.** Use the problem's actual data everywhere (real strings/arrays, real indices). Never explain with generic "i, j, k" before showing real values.
3. **Physical metaphor first.** Two sequences = two fingers pointing at letters. A DP table cell = "one pair of finger positions". A diagonal lookup = "both fingers step back". Draw the finger positions in chat too when explaining.
4. **KISS code.** Interview-style Python, short variable names, a comment on every meaningful line. No optimizations, no tricks, no type-hint noise beyond basics.
5. **Everything moves together on each Next click:** explanation text, finger pointers, grid cell, highlighted code line, live variable values.
6. **One file, named after the problem**, e.g. `Longest Common Substring.html`, saved to `/mnt/agents/output/` and tagged with KIMI_REF.
7. **User controls pace.** No auto-play; every step waits for a click.
8. If the user is confused, ask "which step number breaks first" and re-explain only that step — never restart everything.

## Standard page structure (top to bottom)

1. Title = problem name; subtitle "Click through slowly. Each phase is one small idea."
2. Phase bar (buttons; active = blue, completed = green checkmark styling).
3. Explanation box (min-height, plain English, `b` highlights in yellow, key rule in cyan).
4. **Pointer-tracing panel**: each input sequence as a row of letter/number tiles; 👆 marker under the current index of each pointer; current tiles yellow, contributing tiles (e.g. current streak/window) green.
5. **DP table / grid**: headers = sequence values; filled cells light up; current cell yellow glow, dependency cell(s) (diagonal/top/left) blue, max/answer cells green.
6. **Code panel**: full solution shown from step 1; per step, the line(s) that "execute" get a yellow left border + background. Header shows `● ready` / `● running`.
7. **Live variables panel**: small boxes for `i`, `j`, `dp[i][j]`, `best` (and problem-specific ones), updating every step.
8. Answer box (big, green) once the answer is derivable.
9. Controls (Back / Next / Replay phase) + "Phase X/Y — step a/b" indicator.

## Standard phase arc (adapt to the problem)

1. **The goal** — what the problem asks, with a tiny concrete example; why brute force is slow; DP = "notebook so we never re-check".
2. **The grid/state idea** — what a cell MEANS, in one sentence ("streak ENDING here" / "best answer USING first i items"). Highlight the setup code lines (def, lengths, table init, best/answer var).
3. **The one rule** — the recurrence, stated as at most 2 cases (match/extend vs reset/skip), each mapped to its exact code line. Explain why the dependency direction (diagonal/up/left) is just "how the problem shrinks".
4. **Fill the table** — one cell per click. For every cell: which letters/values compared, which code line ran, what got written, live variables updated. This phase is the core; never compress it.
5. **Read the answer** — where the answer lives in the table (max cell / last cell), how to reconstruct, final recap: 3–5 numbered takeaways + time/space complexity + "in an interview, this code is enough".

## Implementation guidance

- Start from `assets/template_dp_grid.html` (a complete working example: Longest Common Substring). Replace: input data, dp recurrence, explanation texts, per-step `trace` / `codeHl` / `vars` mappings, and the code listing with its line-number constants.
- Build steps programmatically in JS (loop over cells, push step objects `{html, cells, current, diag, trace, codeHl, vars}`) — never hand-write 30 steps.
- Keep color semantics fixed: **yellow = current**, **blue = dependency**, **green = answer/streak**, red emoji 🔴 = reset case, 🟢 = match/extend case.
- Verify the finished file opens (no console errors) before delivering. Save the site to `/mnt/agents/output/app/` and call build_version (type `html`) for preview, AND copy the same file to `/mnt/agents/output/<Problem Title>.html` tagged with KIMI_REF.

## In-chat teaching style (when explaining, not just building)

- Short sentences. One idea per message block. Numbered sequences, not prose.
- After each phase, ask the user to say back what they understood before moving on.
- If asked "how did you know to use this approach": answer with the trigger chain — number of sequences → fingers → grid dimensions; "how does the problem shrink" → dependency direction; "can small answer build big answer — if not, make the state more specific".
- Admit uncertainty; never fake a step.
