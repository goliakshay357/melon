---
name: dsa-bfs
description: 'BFS — level-by-level exploration using a queue, finding shortest paths in unweighted graphs'
---

# Breadth-First Search (BFS)

## The Psychology
You want the shortest path from A to B. Brute force tries every possible path — but most paths wander off in wrong directions and come back. BFS says: "Explore in RINGS. Everything at distance 1 before anything at distance 2." The first time you reach B, that IS the shortest path. You never waste time exploring longer paths.

"What am I recomputing?": Without BFS, you might visit the same node through different paths and not know which path was shorter. BFS marks nodes "visited" the FIRST time you see them — guaranteeing shortest distance.

## Physical Metaphor
A rumor spreading through a school. You tell your immediate friends (distance 1). They tell their friends (distance 2), who haven't heard it yet. The rumor spreads outward in waves. The first time someone hears the rumor is through the shortest chain of people.

## Recognition Signals
1. **Shortest path** in unweighted graph/grid
2. **Level-by-level** processing
3. Finding all nodes within K steps

## The Queue — BFS's Engine
BFS uses a queue (FIFO = first in, first out). This guarantees level order:
- Enqueue starting node
- Dequeue node → enqueue all its unvisited neighbors
- Neighbors are processed in the order they were discovered = exactly level by level

## Visualization Data
For BFS viz, show:
- A 3D grid or graph with nodes as spheres
- Starting node in green, target in gold, walls in dark gray
- RINGS of color radiating outward (each BFS level a different shade)
- The queue displayed as a 3D row of waiting nodes
- Current node in yellow, visited nodes faded
- Step counter showing: "distance from start: X"

## Example Problems
1. **Binary Tree Level Order** — classic BFS on a tree
2. **Rotting Oranges** — multi-source BFS on a grid
3. **01 Matrix** — BFS from all zeros simultaneously
4. **Word Ladder** — BFS on implicit graph

## Common Mistakes
- Using a list instead of deque (list.pop(0) is O(n), deque.popleft() is O(1))
- Marking visited when DEQUEUEING instead of when ENQUEUEING → duplicates in queue
- Confusing BFS (queue) with DFS (stack/recursion)
