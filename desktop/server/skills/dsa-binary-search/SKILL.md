---
name: dsa-binary-search
description: 'Binary search — from linear scan to logarithmic by repeatedly halving the search space'
---

# Binary Search Pattern

## The Psychology
Linear scan checks every element: "Is it here? No. Is it here? No." For n elements, that's n checks. But if the array is sorted, one check at the middle tells you which HALF the answer is in. You just eliminated n/2 possibilities in ONE step. Do that repeatedly and you find anything in log₂(n) steps.

The psychological question: "Given one check at position mid, can I PROVE that the answer is NOT in the left half?"

## Physical Metaphor
Looking for a word in a dictionary. Open to the middle. Is your word alphabetically before or after this page? Throw away the half that CAN'T contain it. Repeat. A 1000-page dictionary: at most 10 opens.

## Recognition Signals
1. Input is **sorted** or search space is **monotonic**
2. Finding an element, insertion point, or boundary
3. "Minimum", "maximum", "first/last occurrence"

## Brute Force → Optimized

### Step 1: Brute Force
```python
# O(n) — checks EVERY element linearly
for i in range(len(arr)):
    if arr[i] == target:
        return i
```

### Step 2: The Insight
"At position 5, arr[5]=15. Target is 7. Since arr is sorted, everything AFTER position 5 is ≥ 15. Target CANNOT be there. Eliminate positions 5 through n-1 in one comparison."

### Step 3: Optimized
```python
left, right = 0, len(arr) - 1
while left <= right:
    mid = left + (right - left) // 2
    if arr[mid] == target: return mid
    elif arr[mid] < target: left = mid + 1
    else: right = mid - 1
```

## Visualization Data
For binary search viz, show:
- The sorted array as a row of tiles
- left/right boundary markers that CLOSE IN
- The mid pointer and the comparison result
- Grayed-out tiles for the eliminated half
- A counter: "comparisons: X / log₂(n) = Y"

## Example Problems
1. **Binary Search** — basic template
2. **Search Insert Position** — find where target WOULD go
3. **Find First and Last Position** — two binary searches
4. **Koko Eating Bananas** — binary search on ANSWER (not array)
