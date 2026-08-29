---
name: dsa-sliding-window
description: 'Sliding window pattern — from O(n²) brute force to O(n) window, with the psychology of why we optimize'
---

# Sliding Window Pattern

## The Psychology
Brute force checks every possible subarray. For an array of size n, there are ~n²/2 subarrays. For each, you recompute the sum from scratch. YOU ARE RECOMPUTING THE SAME ADDITIONS AGAIN AND AGAIN.

The insight: when you slide from subarray [i..j] to [i+1..j+1], you remove one element and add one element. 95% of the sum is the same. Why recompute the whole thing?

## Physical Metaphor
A caterpillar moving across a leaf. Its body stretches and contracts. When it moves forward, only the head and tail change — the middle stays the same. You don't re-measure the entire caterpillar at every step.

## Recognition Signals (teach the student to spot these)
1. Problem asks for a **contiguous subarray or substring**
2. There's a **constraint** that can be checked incrementally
3. You need **maximum/minimum length** satisfying the constraint

## Brute Force → Optimized Progression

### Step 1: Brute Force (the obvious way)
"For each starting position, try every ending position. Compute the sum from scratch each time."

```python
# O(n³) — recomputes EVERYTHING
for i in range(n):
    for j in range(i, n):
        total = sum(arr[i:j+1])  # recomputes entire sum
```

### Step 2: The Insight
"When I move from [2,1,5] to [1,5,1], the only change is: 2 leaves, 1 enters. Everything else (1+5=6) stays the same."

### Step 3: Optimized (Dynamic Window)
```python
left = 0
window_state = 0
for right in range(len(arr)):
    window_state += arr[right]  # ADD new element
    while constraint_violated:
        window_state -= arr[left]  # REMOVE from left
        left += 1
    result = max(result, right - left + 1)
```

## Visualization Data
For a sliding window viz, show:
- The array as a row of number tiles
- Two pointers (left in blue, right in yellow) with arrows
- The current window highlighted
- A "sum" display that updates as elements enter/leave
- An "answer" display tracking the best window found

## Example Problems (in teaching order)
1. **Maximum Sum Subarray of Size K** (fixed window) — easiest intro
2. **Longest Substring Without Repeating Characters** (dynamic, HashSet)
3. **Fruit Into Baskets** (dynamic, frequency map)
4. **Minimum Window Substring** (two-string, hardest)

## Common Mistakes
- Updating the window state AFTER checking the constraint (check first, then update)
- Off-by-one: window size = right - left + 1
- Using a Set when you need a Map (can't track counts with a Set)
