<div align="center">
<img width="120" height="120" alt="bloub-demipasteque-attentif-rouge" src="https://github.com/user-attachments/assets/d72cc8dd-7de0-4527-8123-3838e4803e8d" />
</div>

  # Melon

> **Thinking with AI, without losing the context.**

Melon is a cross-platform desktop app for working with AI on an infinite canvas. Every branch is its own conversation with its own context, so side questions and rabbit holes never pollute the main thread.


```text
                         ┌─────────────┐
                         │  Main idea  │
                         └──────┬──────┘
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
        ┌──────────┐      ┌──────────┐      ┌──────────┐
        │ Research │      │ Explore  │      │  Build   │
        └────┬─────┘      └────┬─────┘      └────┬─────┘
             │                 │                 │
          ┌──┴──┐           ┌──┴──┐           ┌──┴──┐
          ▼     ▼           ▼     ▼           ▼     ▼
        chat   notes       ideas  tests      code  output
             \                |                /
              \_______________|_______________/
                              ▼
                         Main context
```
**The real thing I'm trying to manage is context.**

# Why Melon
Most work with AI starts as one question. Then it branches: a side question becomes a research thread, that thread leads somewhere else, and the useful context ends up spread across conversations, tabs, and notes.

The hard part isn't generating more answers. It's keeping the context of the thinking together.

Features
- Infinite canvas - lay out an entire problem in one place: the conversations, notes, and outputs that belong to it.
- Branching - start a branch without destroying the original conversation. Go down a rabbit hole, try another approach, bring back what matters, move on.
- Per-branch models - use a frontier model to set direction and cheaper models for exploration. The model changes with the context you're working on.
- Connected context - keep the useful parts of every branch attached to the problem they came from.


---

## And the models?

Not every branch needs the best model.

I might use a frontier model to figure out the direction, then use cheaper models for exploration, and switch back when something important needs deeper reasoning.

So the model can change **with the context I'm working on**.

---

# Status

Melon is in active development. Usable today, incomplete, expect rough edges.
