# 04 · Where to Fish (Ranking + Best/Backup Times)

The trip planner: for a given day and time budget, which gauge to fish first
(primary) and which as backup, with the best window for each. It adds no new
physics — it's pure selection and comparison over the bite blocks from `03`.

---

## What it is

A "Today" column and a "Tomorrow" column, each showing — for 2-, 4-, and 6-hour
budgets — a primary and a backup gauge with the best window span and score for
each.

---

## Inputs

- `g.blocks` per gauge (today) — from `03`.
- Tomorrow's blocks per gauge — from `computeBlocks` fed the forecast conditions
  (`02`/`01`); placeholder today (see Status).
- Budget `k` — UI constant: 2 h → `k=1`, 4 h → `k=2`, 6 h → `k=3` blocks.
- `g.short` — gauge label.

---

## Logic / calculation

### Best window within one gauge — `bestWindow(blocks, k)`

Slides a `k`-block window across the 12 and returns the start, the rounded average
score, and a formatted clock span (`planSpan`) for the highest-scoring run.

### Ranking across gauges — `rankPicks(dayBlocksFn, k)`

For every gauge, compute its best `k`-window, then sort all gauges by that
window's score, descending. Top = primary, second = backup. `planColumn` runs this
for all three budgets; `renderPlanner` builds the Today and Tomorrow columns.

---

## Assumptions

- Where-to-fish is entirely downstream of the bite blocks — exactly as live as
  `computeBlocks` makes them.
- It optimizes the *best contiguous window* for the budget, not the whole-day
  total — a gauge with one excellent evening can outrank a steady-but-mediocre one.

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain → null behavior |
|-------|---------------|-------------------------------|
| Today's blocks | `g.blocks` (from `03`, live once wired) | if a gauge has no blocks → excluded from ranking |
| Tomorrow's blocks | `computeBlocks` + forecast conditions | **currently** `tomorrowBlocks(g)` placeholder = today's blocks shifted by `g.next10[0]` (authored) → replaced in build Step 3 |
| Budget `k` | UI constant | not data-sourced |
| Gauge label | `g.short` / config | not data-sourced |
| Tomorrow date label | (currently hardcoded in `renderPlanner`) | not from `data.json today` → replaced in Step 3 |

---

## Outputs

- Primary + backup gauge per budget, per day, each with window span and
  `scoreClass`-colored score.
- No downstream consumer — this is a leaf presentation step.

---

## Status

`rankPicks` for **today** reads `g.blocks` directly, so it goes live the moment
`03` is wired live. The **Tomorrow** column uses the `tomorrowBlocks` placeholder
and a hardcoded date today; both are replaced in build Step 3, when tomorrow's
blocks come from `computeBlocks` fed tomorrow's forecast conditions ("3 days out" =
day +3 the same way).
