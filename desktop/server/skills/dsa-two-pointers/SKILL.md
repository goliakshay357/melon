---
name: dsa-two-pointers
description: 'Two pointers — from nested loops to linear scan by exploiting sorted order'
---

# Two Pointers Pattern

## The Psychology
Brute force checks every pair: for each left element, scan every right element. That's O(n²). But if the array is SORTED, the answer to "should I move left or right?" is deterministic. You're not guessing — the sorted order tells you which way to go. So why check pairs you KNOW won't work?

## Physical Metaphor
Two people at opposite ends of a sorted bookshelf. They're looking for two books whose combined page count equals a target. If the sum is too high, the person on the right moves left (to a smaller book). If too low, the person on the left moves right (to a bigger book). They never backtrack — because the shelf is sorted, moving backwards would undo progress.

## Recognition Signals
1. Input is **sorted** (or can be sorted without losing information)
2. Finding **pairs, triplets, or subarrays** satisfying a condition
3. Comparing elements from both ends

## Brute Force → Optimized

### Step 1: Brute Force
```python
# O(n²) — checks every pair, even ones that CAN'T work
for i in range(n):
    for j in range(i+1, n):  # recomputes comparisons
        if arr[i] + arr[j] == target:
            return [i, j]
```

### Step 2: The Insight
"If arr[left] + arr[right] > target, then arr[left] + arr[ANYTHING to the right of 'right'] is even BIGGER. Those pairs are guaranteed wrong. Skip them ALL by moving right left."

### Step 3: Optimized (Converging Pointers)
```python
left, right = 0, len(arr) - 1
while left < right:
    current = arr[left] + arr[right]
    if current == target: return [left, right]
    elif current < target: left += 1   # need bigger
    else: right -= 1                   # need smaller
```

## Visualization Data
For two-pointers viz, show:
- The sorted array as a row of tiles
- Left pointer (blue arrow from above), Right pointer (red arrow from above)
- The current sum displayed between them
- Arrows showing which pointer moves and why
- A counter: "pairs skipped: X" to show the work avoided

## Example Problems
1. **Two Sum II** (sorted) — classic converging pointers
2. **Valid Palindrome** — two pointers with skip logic
3. **3Sum** — fix one, two-sum the rest
4. **Container With Most Water** — converging with area calculation
