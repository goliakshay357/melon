---
name: dsa-hash-table
description: 'Hash tables — O(1) lookup by trading space for time; the most fundamental optimization pattern'
---

# Hash Table / Dictionary / Set

## The Psychology
This is the purest example of "trade space for time." Brute force: for each element, scan the entire array looking for its complement. O(n²). The insight: "What if I could just ASK 'does 7 exist?' in one step instead of scanning?" A hash table lets you do exactly that.

The cost: extra memory. But for most problems, O(n) extra space is worth dropping from O(n²) to O(n) time. This trade-off is the heart of DSA optimization.

## Physical Metaphor
A wall of labeled mailboxes. Each person in the building has one box. To get Bob's mail, you walk straight to BOB's box — you don't open every box looking for Bob's name. That's O(1): constant time, no matter how many boxes there are.

## Recognition Signals
1. Need to **count frequencies**
2. Need **O(1) lookup/insert/delete**
3. **"Does X exist?"** or **"Have I seen X before?"**
4. **Finding complements** (two-sum: target - current = complement)
5. **Removing duplicates** or checking **uniqueness**

## The Complement Pattern (Two-Sum)
The classic: "For each element x, check if (target - x) has been seen before."
Without hash table: scan array for each element = O(n²).
With hash table: one lookup per element = O(n).

## Visualization Data
For hash table viz, show:
- The array being scanned left to right
- A 3D "wall of lockers" (the hash table) growing as elements are added
- Current array element highlighted
- An arrow from the element to its complement lookup in the table
- Hit: locker glows green. Miss: new locker slides in.
- Counter: "lookups: X, hits: Y"

## Example Problems
1. **Two Sum** — complement lookup
2. **Contains Duplicate** — set for existence
3. **First Unique Character** — frequency + order scan
4. **Group Anagrams** — sorted string as hash key
5. **Subarray Sum Equals K** — prefix sum + frequency map

## Common Mistakes
- Using a list for O(n) lookups when a set would be O(1)
- Forgetting that dict keys must be hashable (lists can't be keys; tuples can)
- Not using .get(key, default) when key might be missing
