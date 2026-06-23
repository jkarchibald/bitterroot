# Bitterroot Fishing Dashboard — Logic Trains

How every recommendation on the dashboard is calculated, the assumptions baked
into each step, and how the result is presented. Five trains:

1. Day score (the card badge)
2. Future forecast on the line charts (flow / temp / stage)
3. The bite-window chart (the 12 two-hour blocks)
4. Where to fish (the cross-gauge ranking and best/backup times)
5. What to use now — seasonal vs calculated fly picks, and how a specific
   pattern / size / color is chosen

A note on status: trains 2 (forecast) and the **engine** behind trains 1 and 3
(`computeBlocks`) are live off real conditions. The wiring that feeds today's
snapshot and the per-day forecast *into* `computeBlocks` is the in-progress work
(Steps 2–3 of the build plan). Where a train still reads a hardcoded array, it
is called out explicitly.

Each train below includes an **Inputs / provenance** block naming every value
that feeds its decisions, traced to where it originates. Update that block
whenever an input is added, dropped, or re-sourced.

---

## Source legend

Every input traces to one of these. Paths are relative to a gauge object in
`data.json` unless noted.

| Source | Path | Contains |
|--------|------|----------|
| Live snapshot | `series.{flow,stage,watertemp}.latest` | newest instantaneous reading `{value, ts}` |
| This-year means | `series.{flow,stage,watertemp}.thisYear[]` | daily `{date, min, max, mean, n}` |
| Last-year means | `series.{flow,stage,watertemp}.lastYear[]` | same shape, prior year |
| Modeled forecast | `g._series.{fcFlow,fcTemp,fcStage}` | forward arrays built by the forecast engine (train 2) |
| Per-gauge normal | `normal.{flow,stage,watertemp}` | long-run normal values |
| Weather hourly | `weather.hourly[]` | `{t, tempF, precipIn, cloudPct, pressureHpa}`, ~9 days forward — **only source of cloud** |
| Weather daily | `weather.daily[]` | `{date, hiF, loF, precipIn, sunrise, sunset}` — no cloud |
| Last-year weather | `weather.lastYearDaily[]` | `{date, hiF, loF, precipIn}` |
| Constants | `constants` (top-level) | `hootOwlThresholdF`, `lethalF`, `wadeCfs` |
| Gauge metadata | `type`, `meta.measuredTemp`, `meta.provisional`, `lat`, `lon` | water type, temp-measured flag, provisional flag |
| Authored tables | in `index.html` | `HATCH_CALENDAR`, `HATCH_FLY`, `UNIVERSAL`, `SEARCH_FLY`, `FLY_COLORS`, per-gauge `rig` |

"Authored" = hand-curated in the code, not from `data.json`. When a live value is
missing, most trains fall back along a chain (snapshot → today's mean → normal);
each train's block states its own chain.

---

## 1. Day score (the card badge)

**What it is.** The single 0.0–10.0 number on each gauge card that summarizes
how good the fishing is during daylight.

**Calculation.** `dayScore(g)` takes the gauge's 12 two-hour bite blocks and
averages indices 3 through 9 — the seven blocks covering roughly 6 AM to 8 PM —
then rounds to one decimal:

```
day = blocks.slice(3, 10)          // indices 3..9  (6–8a … 6–8p)
score = round( mean(day) * 10 ) / 10
```

Blocks 0–2 (midnight–6 AM) and 10–11 (8 PM–midnight) are deliberately excluded
so the badge reflects *fishable daylight*, not the dead overnight hours that
would drag every average toward zero.

**Assumptions.**
- The "fishing day" is 6 AM–8 PM. This is a fixed window, not derived from each
  day's actual sunrise/sunset, so very early or very late season days use the
  same seven-block slice.
- Every block contributes equally; a great evening and a dead midday average to
  "fair" rather than being weighted toward the peak.

**The dependency that matters.** `dayScore` is a pure function of `g.blocks`. It
is correct and never needs to change — but it is only as live as the blocks
feeding it. While `g.blocks` is the hardcoded array baked into each gauge config,
**the badge does not move with conditions.** Once `g.blocks` is computed from
`computeBlocks` (Step 2), the badge becomes live automatically, with no change to
`dayScore` itself.

**Presentation.** The number is bucketed into a color class by `scoreClass`:
9+ = prime, 7–8 = good, 4–6 = fair, below 4 = poor. That class drives the badge
color on the card.

**Inputs / provenance.**
- `g.blocks` — the 12 bite scores. This is the *only* direct input.
  - **Currently:** the hardcoded array in each gauge config (authored). The badge
    is therefore static.
  - **After Step 2:** the output of `computeBlocks` (train 3), which carries that
    train's full provenance. The badge inherits whatever feeds train 3.
- No other source. `dayScore` reads nothing from `data.json` itself — it is a
  pure transform of train 3's output.

---

## 2. Future forecast on the line charts

**What it is.** Everything to the right of the TODAY line on each chart: the
forward flow, water-temp, and gauge-height curves, plus the confidence number in
the chart's upper-right. This is modeled — it deliberately replaces the raw flood
model's forecast tail, which spiked implausibly in the back half of the window.

The whole engine builds forward from trustworthy signals only, with hard physical
clamps so the line can never explode.

### 2a. Flow forecast — `buildForecast`

Flow is the anchor; temp and stage derive from it. For each forward day, starting
from the most recent real reading:

1. **Recession baseline.** `v = prev * k`, where `k` is a daily recession factor
   fit to the last up-to-six real days by averaging their day-over-day log
   ratios (`_recessionK`). `k` is clamped to **0.93–1.04** — a falling
   hydrograph that can't free-fall or spuriously climb.
2. **Seasonal shape blend.** Last year's day-over-day *ratios* over the same
   calendar dates (`_lyShape`, each ratio clamped 0.90–1.12) are blended in at
   **35% weight**. This imports the *shape* of last year's recession (when it
   tends to bend), not its magnitude.
3. **Bounded weather nudge.** If the day's forecast has rain, flow is nudged up
   by `precipIn (capped at 1") × 0.06`; if the high is above 75 °F, up by
   `(hiF − 75)/100`, capped at +0.05 — a small snowmelt bump.
4. **Hard clamps, in order:** day-over-day change limited to **0.80×–1.12×** of
   the prior day; never more than **1.8× the last real reading** (no flood
   spikes); absolute ceiling of **3× normal flow**; floor of 1 cfs.

The clamped value becomes `prev` and the loop steps forward.

### 2b. Water-temp forecast — `buildTempForecast`

Driven by the Open-Meteo **air**-temp forecast, damped and lagged toward the
recent water-temp trend. For each day: a target is set from that day's forecast
mid-temp minus 6 °F (`(hiF+loF)/2 − 6`), water moves toward it by **55% of the
gap, with the per-day step capped at ±4 °F**, and the result is clamped to a sane
**33–75 °F** physical range. The damping and lag reflect that water temperature
changes more slowly than air.

### 2c. Stage (gauge height) forecast

Not modeled independently — derived from forecast flow through the gauge's own
flow→stage rating curve (a square-root relationship anchored on today's
stage/flow pair, with a conservative floor). This keeps stage physically
consistent with flow rather than letting the two drift apart.

### 2d. Confidence — `forecastConfidence`

Per forward day, starts at **96 − 5 per day** of horizon, then is knocked down
when incoming weather diverges from what last year did over the same dates:
precip difference costs up to 25 points, a high-temp gap beyond 8 °F costs up to
20. A day with weather data but no last-year comparison loses a flat 8. Each day
is floored at 5 and capped at 99; the chart shows the per-day value at the hover
point and an overall average. The logic: a forecast leaning hard on the weather
nudge (because conditions are unlike last year) is inherently less certain.

**Assumptions.**
- Recession is the dominant physics; last year is a shape hint, not a predictor
  of magnitude.
- Weather can only nudge within tight bounds; it can't drive the forecast.
- USGS timestamps are true UTC; DNRC StAGE timestamps are read at face value as
  Mountain local (handled upstream, not in this engine).

**Presentation.** The forecast arrays are spliced onto the history line at the
TODAY index and drawn as the forward continuation, with last year overlaid for
context and the confidence figure in the corner.

**Inputs / provenance.**
- **Recession anchor & fit** — `series.flow.thisYear[]` means, with the final
  (today) point overwritten by `series.flow.latest.value` when present so the
  recession starts from what the gauge reads now, not a partial-day mean.
- **Seasonal shape** — `series.flow.lastYear[]` means, as day-over-day ratios
  over the matching calendar dates.
- **Weather nudge (flow)** — `weather.daily[].precipIn` and `.hiF`.
- **Temp forecast** — anchor from `series.watertemp.thisYear[]` / `.latest`;
  driven by `weather.daily[].hiF` and `.loF`.
- **Stage forecast** — derived from forecast flow + today's `series.stage.latest`
  (or last `.thisYear` mean) and today's flow, via the rating curve. No
  independent stage source.
- **Absolute ceiling** — `normal.flow`.
- **Confidence** — `weather.daily[]` (precip, hi) vs `weather.lastYearDaily[]`
  over matching dates; horizon index.
- **Timestamp interpretation** — USGS = true UTC; DNRC StAGE read at face value
  as Mountain local. Handled in `alignSeries`, upstream of this engine; it
  determines which day each `thisYear`/`latest` reading lands on.

---

## 3. The bite-window chart (the 12 two-hour blocks)

**What it is.** The vertical list of twelve 2-hour windows for the selected
gauge, each with a 0–10 bar, a star on the optimal block, and a short reason on
weaker blocks.

**Block layout.** Block `i` spans clock hours `[2i, 2i+2)`: block 0 = 12–2 AM,
block 9 = 6–8 PM, block 11 = 10 PM–midnight.

### The engine — `computeBlocks(conditions)`

This is a **pure function**: it takes a plain `conditions` object, never the
gauge object. That single choice is what lets the same math score today (from the
live snapshot) and any future day (from the forecast) — identical function,
different inputs.

```
conditions = {
  waterTempF, flowRatio, cloudPct, precipPct,
  waterType, sunriseHr, sunsetHr
}
```

For each of the 12 blocks the score is built as a product of independent factors:

```
score = 10 × bandMult × light × flowAdj × precipAdj   (rounded, clamped 0–10)
```

1. **Water-temperature band** (`_bandFor`) sets a whole-day activity multiplier —
   the dominant driver:

   | Band       | Range (°F) | Multiplier |
   |------------|-----------|-----------|
   | cold       | < 40      | 0.35 |
   | cool       | 40–50     | 0.70 |
   | prime      | 50–60     | 1.00 |
   | warm       | 60–68     | 0.90 |
   | stress     | 68–73     | 0.70 |
   | hoot-owl   | 73–77     | 0.40 |
   | lethal     | ≥ 77      | 0.12 |
   | unknown    | (null)    | 0.55 |

2. **Time-of-day light curve** (0–1). Near-dark (0.10) before sunrise and after
   sunset; a dawn ramp climbing from ~1 h before sunrise to ~2 h after; a gentle
   midday plateau (never the high point); and a Gaussian **evening peak centered
   ~2.5 h before sunset**, so for a ~9:30 PM sunset the peak lands in the 6–8 PM
   block (index 9) — the salmonfly/caddis emergence window these freestones show.

3. **Cloud cover** modifies *daytime* light: on warm-water days, bright midday
   sun (11 AM–5 PM) is suppressed up to 35%, and overcast relieves that penalty;
   overcast also lifts the daylight curve up to ~12% generally (the BWO/emerger
   effect).

4. **Flow vs normal** (`flowRatio`): ≥1.5× → ×0.80, ≥1.25× → ×0.90 (off-color
   high water dampens the sight bite); very low clear water (≤0.7×) trims the
   harsh midday hours slightly.

5. **Precip**: a light chance (30–69%) nudges up ×1.05 (bugs knocked down, low
   light); heavy rain (≥70%) muddies and suppresses ×0.92.

**Assumptions.**
- Water temperature dominates; everything else modulates around it.
- These are freestone streams with a pronounced evening rise, so the light curve
  is intentionally evening-weighted rather than a symmetric midday hump.
- Bands follow standard trout-science temperature guidance, including the
  MT FWP hoot-owl trigger at 73 °F and the ~77 °F lethal threshold.

**Status / the gap.** The engine is built, verified pure and deterministic, and
produces realistic shapes against real data. What remains (Steps 2–3) is feeding
it: today's `conditions` from the live snapshot, and each future day's
`conditions` from the forecast. Until that wiring lands, the chart still renders
the hardcoded `g.blocks` array. **Note the one data detail for the forecast
path:** per-day cloud cover lives in `weather.hourly` (which runs ~9 days
forward), not `weather.daily` — so a future day's `cloudPct` is derived by
averaging the daytime hourly cloud values.

**Presentation.** Each block renders a bar colored by `scoreClass`, a star on the
gauge's optimal block, and on poor/fair blocks a one-line reason from
`blockReasons` (e.g. "dark," "bright sun," "fading light"). These reason strings
are descriptive annotations keyed to time of day; they are not part of the score
math.

**Inputs / provenance.** `computeBlocks` reads only its `conditions` object; the
provenance is in how that object is assembled per day:

- **`waterTempF`**
  - *Today:* `series.watertemp.latest.value` → else last `series.watertemp.thisYear[].mean` → else `normal.watertemp`. (For temp-estimated gauges, `meta.measuredTemp=false`.)
  - *Future day i:* `g._series.fcTemp[i]` (train 2). Null if the gauge has no temp series → band falls back to the 0.55 "unknown" multiplier.
- **`flowRatio`** = day's flow ÷ `normal.flow`.
  - *Today:* flow from `series.flow.latest.value` → else last `series.flow.thisYear[].mean`.
  - *Future day i:* `g._series.fcFlow[i]` (train 2).
- **`cloudPct`** — daytime (≈8 AM–8 PM) average of `weather.hourly[].cloudPct`
  for that date. **Only `weather.hourly` carries cloud; `weather.daily` does
  not.** Hourly runs ~9 days forward, so future days are covered.
- **`precipPct`** — proxy derived from `weather.daily[].precipIn` for that date
  (mapped to a 0–100 band), or aggregated from `weather.hourly[].precipIn`.
- **`sunriseHr` / `sunsetHr`** — `weather.daily[].sunrise` / `.sunset` for that
  date, as decimal hours. Default ~5.7 / ~21.5 if absent.
- **`waterType`** — `type` (`freestone` / `tailwater` / `mainstem`).
- **Band thresholds** — currently inline constants in `_bandFor` (40/50/60/68/
  73/77). The top-level `constants.hootOwlThresholdF` (73) and `constants.lethalF`
  (77) match these; if the engine is changed to read `constants`, note it here.

**Status:** until Steps 2–3 wire the above, the chart renders the hardcoded
`g.blocks` array, and none of these inputs are actually consulted.

---

## 4. Where to fish (cross-gauge ranking + best/backup times)

**What it is.** The trip planner: for a given day and a time budget, which gauge
to fish first (primary) and which as backup, with the best window for each.

### Best window within one gauge — `bestWindow(blocks, k)`

Slides a window of `k` consecutive blocks across the 12 and returns the start,
the rounded average score, and a formatted clock span (`planSpan`) for the
highest-scoring run. `k` is the budget in 2-hour units: `k=1` → 2 hours,
`k=2` → 4 hours, `k=3` → 6 hours.

### Ranking across gauges — `rankPicks(dayBlocksFn, k)`

For every gauge, computes its best `k`-length window, then sorts all gauges by
that window's score, descending. The top gauge is the primary pick, second is the
backup. `planColumn` runs this for all three budgets (2/4/6 hours) and renders a
primary + backup row for each; `renderPlanner` builds a "Today" column and a
"Tomorrow" column.

**Assumptions.**
- "Where to fish" is entirely downstream of the bite blocks — it adds no new
  physics, only selection and comparison. So it is exactly as live as
  `computeBlocks` makes the blocks.
- The choice optimizes the *best contiguous window* for the budget, not the
  whole-day total — a gauge with one excellent evening can outrank a gauge that's
  mediocre-but-steady all day.

**Status / the gap.** `rankPicks` for *today* reads `g.blocks` directly, so once
Step 2 makes those live, today's ranking is live. The *Tomorrow* column currently
uses `tomorrowBlocks(g)` — a crude placeholder that shifts today's blocks by a
flow delta — and `renderPlanner` uses a hardcoded date. Both are replaced in
Step 3, when tomorrow's blocks come from `computeBlocks` fed with tomorrow's
forecast conditions (and "3 days out" = day +3 the same way).

**Presentation.** Each pick row shows rank (1 primary / 2 backup), gauge short
name, the window span, and the score colored by `scoreClass`.

**Inputs / provenance.**
- **Bite blocks per gauge** — the sole numeric input. *Today:* `g.blocks`
  (inherits train 3's provenance once live). *Tomorrow:* currently
  `tomorrowBlocks(g)`, a placeholder = today's `g.blocks` shifted by
  `g.next10[0]` (an authored array), **not** real forecast conditions yet —
  replaced in Step 3 by `computeBlocks` fed train 2's forecast.
- **Budget `k`** — UI constant (2/4/6 hours → 1/2/3 blocks). Not data-sourced.
- **Gauge identity/labels** — `g.short` / config. Not data-sourced.
- The "Tomorrow" date label currently comes from a hardcoded date in
  `renderPlanner`, not from `data.json` `today` — also replaced in Step 3.

---

## 5. What to use now (seasonal vs calculated picks)

**What it is.** For each of the four categories — dry, nymph, dry-dropper,
streamer — the dashboard shows up to four flies: two **seasonal** picks (from the
month's hatch tables) and two **calculated** picks (from live conditions), each as
a specific pattern + size + color pair. It also scores the four categories so the
strongest one "now" is flagged.

### 5a. Category scoring — `categoryScores` (via `liveConditions`)

`liveConditions(g)` packages the gauge's live readings into a conditions object:
water temp, flow, flow-vs-normal ratio, cloud %, and a precip-percent proxy.
`categoryScores` then accumulates points per category from trout-science rules:

- **Temperature band** (largest weight) — e.g. <40 °F loads nymph heavily and
  zeroes dries; 50–60 °F (prime) loads dries and dry-dropper; the hoot-owl and
  lethal bands collapse everything and flag "minimize / don't fish."
- **Flow & clarity** — high/off-color (≥1.4×) pushes streamer and trims dries;
  low/clear (≤0.8×) favors smaller subtle dries.
- **Light** — overcast (≥65%) lifts dries/emergers; bright sun (≤20%) pushes
  deeper nymphs and bank terrestrials.
- **Precip** — wet/rising adds to streamer and nymph.

Scores are clamped at zero and returned with a running list of human-readable
"notes" explaining each adjustment. The top-scoring category is marked best now;
each category's meter is its score as a percentage of the max.

This function already takes a conditions object internally, so pointing it at the
snapshot (today) or the forecast (a future day) is the same pattern as
`computeBlocks` — largely a verification step, not a rebuild.

### 5b. Seasonal picks — `seasonalPicks`

Purely calendar-driven. `hatchesForMonth(m)` filters `HATCH_CALENDAR` to insects
in season for the current month (entries are ordered roughly chronologically and
most-specific-first). For the requested category, it walks those hatches, looks up
each in `HATCH_FLY` to get a concrete pattern, and grabs the first two that supply
that category. If fewer than two, it tops up from the gauge's own curated `rig`,
then from the `UNIVERSAL` table. Result: two flies tagged with the insect name
they imitate (e.g. "Salmon Fly").

### 5c. Calculated picks — `calcPicks`

Same candidate pool as seasonal (this month's hatch flies + the gauge's rig +
a search pattern + universal), de-duplicated — but **ranked by fit to the live
readings** rather than by the calendar:

- **Size bias:** high or cold water favors bigger flies (lower hook number);
  clear/low water favors smaller.
- **Color/pattern bias:** overcast rewards mayfly imitations on top
  (BWO/PMD/Drake/Mahogany/Dun); bright sun rewards flashy subsurface
  (Flash/Copper/Zebra/Bead/Prince/Bugger/Minnow/Sparkle).
- **In-season bonus:** a fly tied to a currently hatching insect beats generic
  fillers.

The top two become calc pri/alt, each tagged with a compact live reason
("high water → bigger," "clear → smaller," "warm → terrestrial,"
"match-the-hatch"). If a calc pick coincides with a seasonal pick, it's flagged
"matches seasonal" — agreement between the two engines is a confidence signal.

### How a specific pattern / size / color is chosen

- **Pattern** comes from a lookup, never invented: `HATCH_FLY` maps each
  calendar insect to a named tie per category; `UNIVERSAL` and each gauge's `rig`
  supply fallbacks; `SEARCH_FLY` covers dry-dropper and streamer when the hatch
  table doesn't.
- **Size** is carried on each fly entry as a hook range (e.g. "14–18"). The calc
  ranker parses the smallest hook number out of that string to drive its
  big-vs-small bias, but the displayed size is the table's stated range.
- **Color** is a fixed list of named colors per fly (e.g. `["Olive","Gray"]`),
  rendered as swatches by `colorPair` → `swatch`, which maps each name through
  `FLY_COLORS` to a CSS palette variable. Colors are authored on the fly entries;
  they are not computed.

**Assumptions.**
- Seasonal answers "what's hatching this month here"; calculated answers "what do
  today's water and light favor." Showing both lets the angler see where the
  calendar and the conditions agree or diverge.
- The hatch calendar and per-gauge rigs encode local Bitterroot-drainage
  knowledge; the scoring rules encode general trout science. Specific patterns,
  sizes, and colors are all drawn from these authored tables — the engine selects
  and ranks, it does not generate flies.

**Presentation.** Each category cell shows its label, live score (with "best now"
on the top category) and meter, then the two seasonal picks above a divider and
the two calc picks below, each row showing tag, pattern, `#size`, color swatches,
a short reason, and the "matches seasonal" flag where they agree.

**Inputs / provenance.**
- **Category scoring (`liveConditions` → `categoryScores`)** — the same
  conditions inputs as train 3: water temp (`series.watertemp.latest` → mean →
  `normal.watertemp`), flow & `flowRatio` (`series.flow.latest` → mean, ÷
  `normal.flow`), cloud (`weather.hourly[].cloudPct` daytime avg), precip proxy
  (`weather.daily[].precipIn`). *Future day:* the forecast equivalents
  (`g._series.fcTemp/fcFlow`, that day's hourly cloud / daily precip).
- **Which insects are in season** — `CUR_MONTH` (UI constant) filtering
  `HATCH_CALENDAR` (authored). *Note:* month is a constant, not derived from
  `data.json.today` — flag if that changes.
- **Pattern** — authored lookups only: `HATCH_FLY` (insect→fly per category),
  per-gauge `rig`, `SEARCH_FLY`, `UNIVERSAL`. No pattern comes from `data.json`.
- **Size** — the hook-range string on each authored fly entry. The calc ranker
  parses the smallest hook number from it for its size bias; the displayed range
  is the table's.
- **Color** — the named color list on each authored fly entry, mapped through
  `FLY_COLORS` to CSS palette vars. Authored, not computed.
- **Calc ranking biases** — driven by the conditions above (flowRatio, temp band,
  cloud) plus regex matches on authored fly names (mayfly names for overcast,
  flashy/subsurface names for bright sun).

So: the *scoring and ranking* are data-driven (live or forecast conditions); the
*flies themselves* — every pattern, size, and color — come entirely from authored
tables. The engine selects and orders; it never generates a fly.

---

## Cross-cutting: the one architectural principle

Every scoring function takes a plain **`conditions` object, never the gauge
object `g`**. That is what makes trains 1, 3, 4, and 5 collapse into "feed
different inputs to the same function": today's conditions come from the live
snapshot, any future day's from the forecast (train 2). Get that right once and
the day-of, night-before, and 3-days-out views are the same code path with
different inputs — miss it, and the engine has to be built twice.

---

## Maintenance: keeping the trains honest

This document is only useful if it tracks the code. As we work the build plan,
**any change to a calculation updates its train in the same commit** — same
discipline as the build plan's "one step at a time." A train that's silently out
of date is worse than no doc.

When you change something, check:

- **Did a number change?** (a band multiplier, a clamp, a blend weight, a
  threshold) → update that train's calculation section *and* any table.
- **Did an input change?** (added, removed, or re-sourced — e.g. cloud moved
  from hourly to daily, or temp now reads a new fallback) → update that train's
  **Inputs / provenance** block and the source legend if a new path appears.
- **Did status change?** (a hardcoded array became live, a placeholder was
  replaced) → update the "Status" note in that train and the global status note
  near the top.

Expected status flips as Steps 2–5 land:
- **Step 2:** train 1 badge and train 3 chart go live for *today*; train 4
  today-ranking goes live. Remove the "currently hardcoded `g.blocks`" caveats.
- **Step 3:** train 3 future days + train 4 Tomorrow/3-days-out go live;
  `tomorrowBlocks` and the hardcoded planner date are gone.
- **Step 4:** train 5 confirmed live for any day.
- **Step 5:** train 2 presentation refinements only (numbers already drive
  decisions by Step 3).
