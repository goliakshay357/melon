---
name: dsa-dfs
description: 'DFS — go deep first, backtrack when stuck; explore all paths, detect cycles'
---

# Depth-First Search (DFS)

## The Psychology
DFS says: "Pick a direction and GO until you can't. Then backtrack to the last fork and try the next turn." Unlike BFS (which explores in rings), DFS explores one complete path before trying alternatives. This is naturally recursive — the call stack IS your trail of breadcrumbs back to the fork.

"When do I use DFS vs BFS?": DFS when you need to explore ALL paths (backtracking, permutations, cycle detection). BFS when you need shortest path. The key is: DFS goes deep, BFS goes wide.

## Physical Metaphor
Exploring a cave system with a rope tied at the entrance. You follow one tunnel to its end. Dead end? Follow the rope back to the last junction and try a different tunnel. The rope is your call stack.

## Recognition Signals
1. Explore **all paths** or **all possibilities**
2. **Cycle detection** in a graph
3. **Topological sort** (DFS post-order)
4. Tree traversal where order doesn't matter

## Three Tree Traversal Orders
- **Pre-order**: Process node, then children (root first)
- **In-order**: Process left child, then node, then right child (sorted for BST)
- **Post-order**: Process children, then node (children first — for cleanup/computation that needs child results)

## Visualization Data
For DFS viz, show:
- 3D tree or graph with nodes as spheres
- Current path highlighted in yellow (the "rope")
- Visited nodes in gray, unvisited in blue
- Backtracking shown as the yellow path SHRINKING back
- Call stack displayed on the side
- For backtracking problems: candidate solutions being built/destroyed in real-time

## Example Problems
1. **Maximum Depth of Binary Tree** — DFS post-order
2. **Number of Islands** — DFS flood-fill on grid
3. **Course Schedule** — DFS cycle detection
4. **All Paths From Source to Target** — DFS with backtracking

## Common Mistakes
- Not marking visited BEFORE recursive call → infinite recursion on cycles
- Stack overflow on deep graphs → use iterative with explicit stack
- Using DFS when BFS is needed (shortest path)
