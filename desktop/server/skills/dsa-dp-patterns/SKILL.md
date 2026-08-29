---
name: dsa-dp-patterns
description: 'The 12 dynamic programming sub-patterns — recognition-first, interview-focused. Spot the pattern in 10 seconds, then talk through it correctly.'
---

# Dynamic Programming — 12 Patterns

## The Meta-Insight

DP has one psychology, repeated in 12 shapes:

> "Am I recomputing the same subproblem again and again? If yes, store it."

Brute force recursion recomputes the same `f(i)` exponentially. The fix is always: compute once, store, reuse. Memoization (top-down notebook) or tabulation (bottom-up table) are the same idea in two directions.

The 12 patterns differ only in **what the state is** and **what the transition reads**. Recognize the state, and you recognize the pattern.

## The Recognition Decision Tree

Given a DP problem, ask in this order:

1. **What is the input shape?**
   - A single integer `n` → 1D DP (P61, P62, P63, P69, P71, P72)
   - A grid `m × n` → 2D grid DP (P64)
   - Two strings/sequences → 2D two-string DP (P65, P68)
   - Items + a capacity/target → Knapsack (P66, P67)
   - One string, interval questions → interval DP (P70)

2. **What is inside the transition?**
   - Pure sum, no decision (`dp[i] = dp[i-1] + dp[i-2]`) → Fibonacci family (P61)
   - A `max(...)` skip-or-take decision → House Robber (P62) or Knapsack (P66/P67)
   - A `min(...)` over coin choices → Coin Change (P63)
   - A `min(...)` over insert/delete/replace → Edit Distance (P65)

3. **Is there a "used/unused" axis?**
   - Each item used at most once → 0/1 Knapsack (P66), capacity loop DESCENDING
   - Each item usable unlimited times → Unbounded Knapsack (P67), capacity loop ASCENDING

4. **Is there a pivot/root choice?**
   - Sum over pivot choices → Catalan numbers (P72)

## The 12 Patterns

### P61 — 1D DP — Fibonacci-family +

**Spot it in 10 seconds:**
• Keywords: number of ways, distinct ways, climb 1 or 2 steps, fibonacci, minimum cost, reach the top, count the number of. • Data-structure giveaway: a single integer index drives the recurrence. The optimal solution holds at most a small fixed window — usually two or three scalars — and never needs a full array beyond the tabulation form. • The "aha" moment: the same subproblem f(i) is re-computed exponentially in the naive recursion because the call tree branches into f(i-1) and f(i-2) , both of which branch again into f(i-2) and f(i-3) . Memoisation collapses the call tree to O(n) unique states. Tabulation does the same iteratively. Once you see this overlap, you have seen the entire DP family. Learn & Excel · learnandexcel.in · Page 1

**What to say while solving (opening script):**
"This is a 1D DP problem from the Fibonacci family — the answer at step i only depends on the answers at i-1 and i-2 , so the same subproblems repeat exponentially in naive recursion. I will start by stating the recurrence, then walk the complexity ladder: O(2^n) naive, O(n) with memoisation, O(n) with bottom-up tabulation, O(1) space with rolling scalars. I will code the rolling-scalars form directly because the recurrence only reaches back two states. Edge cases I will watch: n = 0 , n = 1 , and the base values being correct for the specific problem framing."

**What NOT to say:**
• "Let me start with pure recursion." — why it hurts: at any altitude above complete fresher, jumping into O(2^n) recursion without immediately flagging it as a memoisation candidate signals you do not see the overlapping subproblems. Mention naive recursion as a complexity anchor, then write memoised or tabulated directly. • "I will use a dictionary to memoise." — why it hurts: not wrong, but for integer-keyed 1D DP a plain list or @lru_cache is the idiomatic Python choice. Reaching for a dict here suggests you have not internalised the difference between general memoisation and 1D DP. • "The base case is dp[0] = 0 and dp[1] = 1 ." — why it hurts: this is the Fibonacci base, not the Climbing Stairs base. Mixing them up on the whiteboard is the most common interviewer-catch in this family. State the base in terms of the problem framing ( ways to reach step 0 = 1 because you are already there). Learn & Excel · learnandexcel.in · Page 5

### P62 — 1D DP — House Robber +

**Spot it in 10 seconds:**
• Keywords: cannot pick adjacent, no two consecutive, maximise total, robber, alarm triggers if neighbours, cannot pick i and i+1. • Data-structure giveaway: a 1D value array with an adjacency constraint on the picks. The optimal solution holds two integer scalars walking the array — prev1 for "best up to and including the previous index" and prev2 for "best up to and including two indices back". • The "aha" moment: at index i you compare two futures — the best you could do ending at i-1 (skipping the current) versus the best you could do ending at i-2 plus the current value (taking it). The max of those two is dp[i] . Once you see this, you have seen House Robber, Delete and Earn, Paint House (with a small extension), and the entire skip-or-take family.

**What to say while solving (opening script):**
"This is a 1D DP with a binary skip-or-take decision at each index. The recurrence is dp[i] = max(dp[i-1], dp[i-2] + nums[i]) — skip current and inherit the previous best, or take current and build on the answer from two steps back. I will go straight to the rolling-scalars form because only two prior states matter, which gives O(n) time and O(1) space. Edge cases I will check: empty array, single element, and the circular variant where the first and last cannot both be taken."

**What NOT to say:**
• "I will use a 2D DP with a taken/not_taken flag." — why it hurts: the flag is unnecessary because the transition already encodes the constraint. Adding a second dimension doubles the state space and signals you have not reduced the problem to its 1D form. Interviewers ask "can you collapse this to 1D?" specifically to test for this gap. • "House Robber II is just the same as House Robber." — why it hurts: it is not — the circular adjacency means index 0 and index n-1 cannot both be taken. Missing the circular constraint produces a wrong answer on inputs like [2, 3, 2] (linear answer is 4, circular answer is 3). • "Delete and Earn needs a different DP — it has the value constraint." — why it hurts: it does not need a different DP. The bucket transformation reduces it to House Robber on the value-indexed array, and missing that reduction means you re-derive the recurrence from scratch and run over the interview budget. The whole point of pattern recognition is to spot this collapse.

### P63 — 1D DP — Coin Change (min coins

**Spot it in 10 seconds:**
• Keywords: fewest coins, minimum coins, number of ways, combinations to make amount, make change, unlimited supply, perfect squares summing to. • Data-structure giveaway: a 1D array dp indexed by amount, sized amount + 1 . Coins / denominations are read-only inside the loop. The count-ways variant uses the same shape but with the outer loop over coins instead of over amounts. • The "aha" moment: for min-coins, dp[a] is the minimum of dp[a - c] + 1 over every coin c . For count-ways, the outer loop must be over coins so each multiset is counted once — looping amount-outer gives permutations, not combinations. The order of the two nested loops is the entire correctness pivot.

**What to say while solving (opening script):**
"This is unbounded-knapsack 1D DP — unlimited supply of each coin, single integer target. For min-coins, dp[a] is the minimum over dp[a - c] + 1 for each coin c <= a . For count-ways, loop order matters: outer on coins, inner on amounts, otherwise you count permutations. I will use bottom-up tabulation because the loop structure makes the order explicit. Edge cases: amount = 0 and unreachable amounts."

**What NOT to say:**
• "I will use greedy and pick the largest coin." — why it hurts: greedy is wrong in general, and interviewers know it. On coins = [1, 3, 4], amount = 6 , greedy gives 3 coins; DP gives 2. Defaulting to greedy without naming the counterexample signals you have not internalised when greedy fails. • "I will use 2D DP with coin index as the second dimension." — why it hurts: 2D works but is wasteful — the unbounded supply collapses cleanly to 1D. Mentioning 2D as a step and then dropping to 1D is fine; coding 2D directly signals you have not seen the unbounded- knapsack collapse. • "Loop order does not matter — both produce the count." — why it hurts: it absolutely matters in Coin Change 2. Outer-amount counts permutations, outer-coin counts combinations. The interviewer will trace coins = [1, 2], amount = 3 and you will be caught with answer 3 instead of 2.

### P64 — 2D DP — Unique Paths / Grid

**Spot it in 10 seconds:**
• Keywords: number of unique paths, grid from top-left to bottom-right, only right or down, minimum path sum, obstacle grid, count paths. • Data-structure giveaway: an m x n grid. The optimal solution is a dp table of the same shape, or a single 1D rolling row of width n when space matters. Each cell reads two neighbours that have already been filled — the cell above and the cell to the left. • The "aha" moment: at any cell, the only way to be standing there is to have arrived from the cell above or the cell to the left (given the move restriction). So dp[i][j] is the sum (for count) or the optimal-combine (for min-cost) of those two parents. The whole grid fills in one pass with no recursion at all.

**What to say while solving (opening script):**
"This is 2D grid DP — the answer at any cell depends on the answer at the cell above and the cell to the left because moves are restricted to right or down. I will fill row by row, left to right, so both parents are always already computed. The base case is the first row and first column, which have a single ancestor each. The full table is O(m * n) space, but only the previous row is needed at any moment, so I will collapse to a 1D rolling row of size n for O(n) space." Learn & Excel · learnandexcel.in · Page 4

**What NOT to say:**
• "I will use BFS / DFS to explore all paths." — why it hurts: this signals you missed the DP. Explicit path exploration is exponential and ignores the overlapping-subproblem structure. The interviewer asks "how many paths can there be?" — for a 30x30 grid it is C(58, 29), roughly 3 * 10^16 — clearly not enumerable. • "I will use a 2D dp array." — why it hurts: it works, but interviewers expect you to flag the rolling-row optimisation. Stopping at 2D leaves an "and could you reduce to 1D?" follow-up on the table; saying it yourself shows seniority. • "The first row and first column do not need a base case." — why it hurts: they absolutely do. Without setting dp[0][j] = 1 (count) or dp[0][j] = prefix sum (min path), the recurrence reads from uninitialised cells. The base case is the single most-asked correctness point in 2D DP.

### P65 — 2D DP — Min Path Sum / Edit

**Spot it in 10 seconds:**
• Keywords: minimum operations to convert, edit distance, insert delete replace, longest common subsequence, number of distinct subsequences, minimum deletions to make equal. • Data-structure giveaway: two input strings of lengths m and n . The DP table is (m + 1) x (n + 1) with the extra row and column for the empty-prefix base case. Each cell reads at most three already-computed parents — top, left, top-left diagonal. • The "aha" moment: when a[i-1] == b[j-1] , the two characters cancel and dp[i][j] = dp[i-1][j-1] . When they do not match, the answer is 1 + min of the three operation cost cells. The whole problem is encoded in those two branches. Recognising this collapses a seemingly hard string-transformation problem to a O(m * n) table fill.

**What to say while solving (opening script):**
"This is 2D DP on two strings — state is (i, j) standing for prefix lengths from each string, and the transition branches on whether the current characters match. The table is (m + 1) x (n + 1) with the extra row and column for the empty-prefix base case. I will index the table 1-based against the 0-indexed strings, which means s[i - 1] and t[j - 1] inside the loop — that off-by-one is the trap I want to call out before coding. The match branch inherits the diagonal cell; the no-match branch takes 1 plus the min of three neighbours."

**What NOT to say:**
• "I will solve this with brute-force string transformation." — why it hurts: at any altitude above complete fresher, this signals you do not see the DP. The interviewer is specifically testing whether you recognise the (m + 1) x (n + 1) table shape — defaulting to brute means you are not playing the game they posed. • "I will use a 3D DP — i, j, and the last operation taken." — why it hurts: the third dimension is unnecessary. The optimum at (i, j) does not depend on which operation produced it; only the cost matters. Adding a dimension you cannot justify multiplies the state space and signals you have not reduced the problem to its tightest form. • "The base case is dp[0][0] = 0 and the rest is filled by the loop." — why it hurts: it is not — you also need dp[i][0] = i (delete cost) and dp[0][j] = j (insert cost). Missing either makes the recurrence read from zero-initialised cells and produces a wrong answer. The first-row and first-column base cases are the most-asked correctness point in 2D DP- on-strings.

### P66 — 0/1 Knapsack — Subset Sum /

**Spot it in 10 seconds:**
• Keywords: partition into two equal subsets, can we reach sum S, minimum difference between two groups, target sum with + / -, each element used at most once. • Data-structure giveaway: a 1D boolean array dp indexed by capacity, sized target + 1 . Items are read-only in the outer loop; the descending inner loop over capacity is the at- most-once enforcement. • The "aha" moment: with items outer and capacity descending inner, dp[c - num] on the right-hand side is the previous-iteration value (item not yet considered). Ascending would re-use the same item multiple times, collapsing to unbounded Coin Change.

**What to say while solving (opening script):**
"This is 0/1 Knapsack — each item used at most once. The 1D DP form has items outer and capacity descending inner; descending enforces the at-most-once constraint because dp[c - num] on the right is still the previous-iteration value. For Partition Equal Subset Sum I reframe to Subset Sum at total / 2 after early-returning on odd total. For Target Sum I Learn & Excel · learnandexcel.in · Page 4 reframe to subset sum at (total + target) / 2 . The reframing is the harder half; once it lands, the recurrence is the same 0/1 routine."

**What NOT to say:**
• "I will use a 2D dp[i][c] array because each item is binary." — why it hurts: 2D works but is wasteful. The 1D rolling form with descending inner loop captures the same at-most-once semantics in half the space. Coding 2D directly without flagging the 1D optimisation signals you have not internalised the descending-loop trick. • "I will go ascending so the loop reads more naturally." — why it hurts: ascending breaks 0/1. The same item gets re-used in the same pass, silently solving unbounded Coin Change instead. On nums = [2, 3], target = 4 , ascending says True; the correct 0/1 answer is False. • "Partition Equal Subset Sum is just sorting and greedy split." — why it hurts: greedy partition is wrong in general. On nums = [1, 5, 11, 5] , greedy (largest-first into the smaller pile) gives {11, 1} and {5, 5} — sums 12 and 10. The DP gives True via {1, 5, 5} and {11} .

### P67 — Unbounded Knapsack — Rod

**Spot it in 10 seconds:**
• Keywords: "cut a rod", "unlimited coins", "any number of times", "minimum number of coins", "number of ways to make sum", "reuse allowed". • Data-structure giveaway: a 1D dp array indexed by target (capacity, sum, or length) plus a small list of item sizes / denominations. No second axis is needed because items can be picked again. • The "aha" moment: the absence of a "used / unused" axis is the whole point. You sweep target from low to high; for each target, you try every item once in the inner loop, and the fact that dp[c - w] was already updated in this same pass is what allows reuse. Compare to 0/1 where the reverse sweep blocks reuse — same skeleton, opposite direction.

**What to say while solving (opening script):**
"This is unbounded knapsack — each piece (rod length, integer factor, ordered element) can be picked any number of times, so I will use a 1D dp of size target + 1 and let dp[c] mean either the maximum revenue, the maximum product, or the count of compositions for that target, depending on the question. The base case dp[0] carries the meaning of the empty solution — 0 for max / sum forms, 1 for the counting form. For the counting form I will be careful about loop order — items outside means combinations, capacity outside means Learn & Excel · learnandexcel.in · Page 4 permutations. The recurrence is one line and runs in O(target * items). I will sanity-check target = 0 and unreachable cases."

**What NOT to say:**
• "I will use 0/1 knapsack." — why it hurts: signals you did not register that each piece can be reused. The backward inner-loop sweep blocks reuse, which is exactly wrong here. Interviewers ask you to verify on a small input — 0/1 vs unbounded answers diverge once any single piece appears twice in the optimum, e.g. prices = [1, 5] , n = 4 : unbounded answers 4 (cut into four pieces of length 1), 0/1 caps at 2. • "Order of loops does not matter." — why it hurts: it matters in the counting form, and that is the single most-asked follow-up. Mixing combinations with permutations changes the count by an order of magnitude. Treating loop order as cosmetic signals that the buyer has memorised one form without understanding what each axis means. • "Integer Break — I will just multiply 3s." — why it hurts: the 3-heavy heuristic is correct for n >= 4 but proving it on the spot is harder than running the DP. Interviewers want the recurrence first; the heuristic is the senior follow-up earning extra credit, not the lead answer. Lead with dp[i] = max over j of dp[j] * dp[i - j] and mention the heuristic.

### P68 — Longest Common Subsequence

**Spot it in 10 seconds:**
• Keywords: "longest common", "subsequence", "common to both", "order-preserving overlap", "shortest supersequence", "minimum delete to align". • Data-structure giveaway: two strings (or two sequences) on the input, no fixed lengths. The optimal solution carries a (m + 1) x (n + 1) integer grid; brute force enumerates subsequences exponentially. • The "aha" moment: the answer for the full strings is composed of answers for prefix pairs (i, j) . A single match at the trailing characters adds 1 to the diagonal predecessor; a mismatch defers to whichever neighbour — left or top — already holds the best so far. That two-case recurrence collapses 2^n brute force to O(m * n).

**What to say while solving (opening script):**
"This is the two-string LCS pattern, so I will set up a (m + 1) x (n + 1) grid where dp[i] [j] holds the LCS length of the first i and first j characters. If the trailing characters match, I extend the diagonal; otherwise I take the max of dropping from either side. That gives O(m * n) time and space — I can roll to O(n) space if I only need the length, but I will start with the full grid because the follow-up usually asks me to reconstruct the subsequence. I will watch out for empty strings and confirm the base row and column stay zero."

**What NOT to say:**
• "Take the diagonal on mismatch." — why it hurts: factual error — on a mismatch the answer is max(dp[i - 1][j], dp[i][j - 1]) , not the diagonal. The bug passes simple test cases ("abc" vs "abc") because matches dominate; it fails on "ab" vs "ba" returning 0 instead of 1. Senior interviewers test this exact case to catch the misremember. • "I will reduce space to O(1)." — why it hurts: impossible. Two adjacent cells in the same row depend on the previous row, so two 1D arrays is the floor — O(min(m, n)) space, not O(1). Claiming O(1) signals you have not actually unrolled the dependency. • "Subsequence is the same as substring." — why it hurts: subsequence preserves order but allows gaps; substring is contiguous. Longest Common Substring uses a different recurrence and resets on mismatch. Conflating them eats interview time and signals the foundational distinction was never internalised. Learn & Excel · learnandexcel.in · Page 5

### P69 — Longest Increasing Subsequence

**Spot it in 10 seconds:**
• Keywords: "longest increasing subsequence", "strictly increasing", "non-decreasing", "longest chain", "russian doll", "envelopes", "max length such that x[i] < x[j]". • Data-structure giveaway: a single 1D sequence on input. The O(n^2) form uses a dp array of the same length; the O(n log n) form uses a tails array and bisect_left for the binary search. • The "aha" moment: the answer at each index depends only on earlier indices with smaller values. Sorting / scanning the previous answers via binary search on tails is what collapses the inner loop. The tails[k] invariant — smallest possible tail of any length- (k+1) subsequence — is the key that makes the binary-search form correct.

**What to say while solving (opening script):**
"I have two ways to do LIS — O(n^2) with a dp array tracking the longest chain ending at each index, or O(n log n) with a tails array updated via binary search. Given the constraint, I will go with the patience-sort form: for each element I binary-search where it belongs in tails and either append or overwrite. The length of tails at the end is the LIS length. I will be careful to use bisect_left for strictly increasing and bisect_right if the problem allows equals. If asked to reconstruct an actual subsequence I will fall back to the O(n^2) form with a parent array."

**What NOT to say:**
• "The tails array is the actual LIS." — why it hurts: it is not — it is a length witness, and overwriting destroys the path. Claiming you can read off the LIS from tails falls apart on [10, 9, 2, 5, 3, 7, 101, 18] where tails ends as [2, 3, 7, 18] but the actual LIS Learn & Excel · learnandexcel.in · Page 5 [2, 3, 7, 18] happens to match — coincidence, not correctness. Interviewers test inputs where the two diverge to expose this. • "I will use a TreeMap / SortedList for the binary search." — why it hurts: in Python you reach for bisect_left on a list; introducing sortedcontainers or SortedList brings an external dependency. The stdlib bisect is exactly the right tool. Mentioning Java's TreeMap suggests you have not internalised the Python idiom. • "O(n log n) is the only acceptable solution." — why it hurts: for n <= 2500 the O(n^2) form is fine and is easier to reason about for reconstruction and counting variants. Insisting on O(n log n) when the problem asks you to count distinct LIS or reconstruct the actual chain signals you are pattern-matching on the headline complexity rather than the question.

### P70 — DP on Strings — Palindrome /

**Spot it in 10 seconds:**
• Keywords: "longest palindromic substring", "palindrome partitioning", "minimum cuts", "regex match", "wildcard", "pattern with . and * ", "contains all of T". • Data-structure giveaway: a 2D dp table (boolean for palindrome detection, integer for cost) indexed by (i, j) for intervals or (i, j) for text-pattern. No graph, no heap — the recurrence walks the table. • The "aha" moment: a palindrome on s[i..j] exists iff s[i] == s[j] and s[i + 1..j - 1] is a palindrome (or the interval is length 0 or 1). The two-character carve-out is what makes the recurrence terminate cleanly. For regex, the * row depends on the row two cells back (zero copies) or the column one back (one or more copies) — that double-fork is the whole game.

**What to say while solving (opening script):**
"This is DP on strings — I will need a 2D table either over intervals (i, j) of the string or over (text_index, pattern_index) for matching. For the palindrome family I will build a boolean is_pal[i][j] table filling by increasing interval length, with the length-2 carve-out. For regex matching I will set the empty-text-empty-pattern base True, handle the leading x* cases, and split the recurrence by whether the current pattern character is * , . , or a literal. Both forms are O(m * n) time and space, reducible to O(n) for length-only."

**What NOT to say:**
• "Palindromic substring is the same as palindromic subsequence." — why it hurts: substring is contiguous; subsequence allows gaps. Longest Palindromic Subsequence (P68) uses a different recurrence and produces a different answer. Conflating them eats interview time on "abcdba" and signals the foundational distinction was never internalised. • "I will skip the boolean palindrome table and recompute inside the cuts loop." — why it hurts: that is the O(n^3) DP. For n = 2000 that is 8 * 10^9 operations — well over the interview ceiling. The two-pass form (precompute then cut) is the textbook O(n^2). Learn & Excel · learnandexcel.in · Page 5 • "Regex matching is too hard for an interview." — why it hurts: it is on every senior product- co loop and is solvable in 15 minutes with the table. The correct move is to write the empty- text base row, then the two * arms, and verify on s = "aab", p = "c*a*b" .

### P71 — DP — Stock Buy/Sell variants

**Spot it in 10 seconds:**
• Keywords: "buy and sell stock", "at most k transactions", "unlimited transactions", "with cooldown", "with fee", "maximise profit". • Data-structure giveaway: a 1D array prices of length n, sometimes with parameters k (max transactions), fee (per-trade cost), or a cooldown rule. Optimal solutions use either two rolling scalars ( cash , held ) or a 2D dp[k][2] table for the bounded-transaction form. • The "aha" moment: each day has two states — holding a share or not — and the transition between them is the buy / sell decision. Tracking both states as scalars is sufficient when transactions are unlimited; layering a third axis for "transactions used so far" handles the bounded-k case. Cooldown and fee are constants in the transition, not new axes.

**What to say while solving (opening script):**
"This is the stock buy / sell family — I will recognise which variant by the number of allowed transactions and any cooldown or fee. For at most one transaction, running minimum and running max-profit; for unlimited, sum the positive day-to-day deltas or carry two scalars cash and held . For at most k transactions, allocate a 2D dp[k + 1][2] table — not holding and holding — and roll forward day by day, decrementing transactions only on buy. The iteration order over k must be reverse so each cell reads the previous day's value. Time is O(n * k), space is O(k)." Learn & Excel · learnandexcel.in · Page 4

**What NOT to say:**
• "I will iterate the transaction axis forward." — why it hurts: in the bounded-k DP, forward iteration reads an already-updated dp[t - 1][0] and double-counts — the same buy is registered against two transactions. Reverse iteration is what makes the rolling 1D form correct. Senior interviewers test on prices = [1, 2, 4], k = 2 to catch this — correct answer is 3, the buggy forward iteration returns 6. • "The greedy summing form works for every variant." — why it hurts: it only works for unlimited transactions with no fee. Adding a fee invalidates it (small positive deltas may not cover the fee); adding cooldown invalidates it (cannot capture every up-day); bounding k invalidates it (must choose which k profitable trades to take). Generalising greedy to "all stock variants" signals you have memorised the easy case without internalising the family. • "Stock 1-transaction needs DP." — why it hurts: the single-transaction case is the running- minimum collapse — O(n) time, O(1) space, no DP table needed. Pulling out a DP table for it suggests you cannot see when a problem degenerates. Name it as "the 1-transaction degenerate case of the family" to signal recognition.

### P72 — DP — Catalan Numbers / Tree

**Spot it in 10 seconds:**
• Keywords: "unique BSTs", "generate parentheses", "valid sequences", "number of distinct structures", "triangulations", "balanced strings", "number of ways to nest". • Data-structure giveaway: usually a single integer n (the size). For generation problems, the output is a list of strings or trees. The count DP carries a 1D array of size n + 1 . • The "aha" moment: the answer for n is built by choosing a pivot — a root for BSTs, a matching parenthesis for the first ( , a chord splitting a polygon. The split produces two smaller independent sub-problems whose counts multiply in the recurrence. That product is what separates Catalan from additive 1D DP.

**What to say while solving (opening script):**
"This is a Catalan-number problem — the recurrence for size n sums over a pivot choice, with the left and right sub-problem counts multiplying. For Unique BSTs, the pivot is the root rank; for Generate Parentheses, the pivot is the position of the matching close-paren of the first open. The count form is a 1D DP of size n + 1 in O(n^2). For generation I will backtrack with the same root-choice loop, returning lists of sub-structures and cross-producting. I will Learn & Excel · learnandexcel.in · Page 4 check the base case — empty structure has count 1 — and verify the small values match 1, 1, 2, 5, 14 ."

**What NOT to say:**
• "I will sum the sub-counts." — why it hurts: the recurrence is a product, not a sum, of left and right sub-counts. Summing turns Catalan into a Fibonacci-shaped 1D DP and produces values like dp[1..5] = 1, 2, 4, 8, 16 — visibly wrong against the known Catalan sequence. Interviewers test on n = 3 because dp[3] = 5 exposes the bug immediately (sum gives 4). • "Recurse without memoisation and compute the count." — why it hurts: the recursive count without memo is exponential — branching factor n at depth n, identical sub-problems re-computed thousands of times for n = 19 . Interviewers ask "what is your time complexity?" specifically to surface this; "exponential, but Python is fast" is the wrong answer. Tabulate. • "Generate Parentheses is a string problem, not a Catalan problem." — why it hurts: it is both — and seeing the Catalan structure unlocks the count and the generalisation to "number of valid sequences of length 2n with constraint X". Treating it as a one-off backtracking exercise misses the family link that senior interviewers probe with "how many such strings exist?". Learn & Excel · learnandexcel.in · Page 5


## Deep References (read on demand)

The recognition data above is the index. For FULL detail on a specific pattern — the code blueprint, walkthroughs, edge cases, and follow-up questions — read the matching reference file:

| Pattern | Reference file |
|---------|---------------|
| P61 Fibonacci-family | `references/p61-fibonacci-family.md` |
| P62 House Robber | `references/p62-house-robber.md` |
| P63 Coin Change | `references/p63-coin-change.md` |
| P64 Unique Paths | `references/p64-unique-paths.md` |
| P65 Edit Distance | `references/p65-edit-distance.md` |
| P66 0/1 Knapsack | `references/p66-knapsack-01.md` |
| P67 Unbounded Knapsack | `references/p67-unbounded-knapsack.md` |
| P68 LCS | `references/p68-lcs.md` |
| P69 LIS | `references/p69-lis.md` |
| P70 Palindrome | `references/p70-palindrome.md` |
| P71 Stock | `references/p71-stock.md` |
| P72 Catalan | `references/p72-catalan.md` |

**When to drill into a reference:** once the learner has identified the pattern (recognition done), read the reference file to get the exact blueprint code, walkthrough steps, and edge cases. Do NOT read all 12 — only the one(s) the learner is working on.

## How to Use This Skill

1. When the learner brings a problem, FIRST walk the recognition decision tree together.
2. Ask them: "Which of the 12 patterns is this? What's the state? What does the transition read?"
3. Only after they identify the pattern, teach the brute force → optimized progression.
4. Coach them on the "what to say" opening script — name the pattern in the first sentence.
5. Quiz them on "what NOT to say" — the embarrassing mistakes interviewers catch.

## Visualization Data

For each pattern, generate the appropriate HTML:
- 1D DP → recursion tree (brute force) then rolling-scalar table
- 2D DP → DP table with dependency arrows (diagonal/up/left)
- Knapsack → DP table, items outer / capacity inner, descending vs ascending shown
- Interval DP → 2D table with length-based filling order

Use the templates in dsa-visual-teacher. For tabulation, ALWAYS show the dependency arrows — which cells the current cell reads from.

## Common Mistakes Across All DP

- Jumping to tabulation before the learner understands the recurrence
- Not naming the state clearly ("dp[i] = the answer for the first i items")
- Wrong iteration order (dependent cells must be computed first)
- Missing base cases
- Using O(n) space when only the last 1-2 values are needed
