# 03 · Bite Windows, Day Score & Optimum Window

The vertical list of twelve 2-hour windows for the selected gauge — each a 0–10
bar — plus the day-score badge on the card and the "Optimum window" readout below
the chart. All three come from one pure engine, `computeBlocks`.

---

## What it is

- **Bite-window chart:** twelve 2-hour blocks, each scored 0–10, a star on the
  single best block, and a short reason on weaker blocks.
- **Day-score badge:** one 0.0–10.0 number summarizing fishable daylight.
- **Optimum window:** the strongest contiguous **6-hour** stretch within fishable
  daylight, with a context sentence.

**Block layout.** Block `i` spans clock hours `[2i, 2i+2)`: block 0 = 12–2 AM,
block 3 = 6–8 AM, block 9 = 6–8 PM, block 11 = 10 PM–midnight. **6 AM–8 PM is
blocks 3 through 9.**

---

## Inputs — the conditions object

`computeBlocks` is a **pure function of a `conditions` object**, never the gauge.
Today's object is built from the live snapshot; a future day's from the forecast
(`02`/`01`). Identical math, different inputs.

```
conditions = { waterTempF, flowRatio, flowTrend, cloudPct,
               precipPct, waterType, sunriseHr, sunsetHr, month }
```

---

## Logic / calculation

### The engine — `computeBlocks`

Each block's score is a product of independent factors:

```
score = 10 × bandMult × light × flowAdj × precipAdj   (rounded, clamped 0–10)
```

**1. Water-temperature band** (`_bandFor`) — the dominant driver:

| Band | Range (°F) | Multiplier |
|------|-----------|-----------|
| cold | < 40 | 0.35 |
| cool | 40–50 | 0.70 |
| prime | 50–60 | 1.00 |
| warm | 60–68 | 0.90 |
| stress | 68–73 | 0.70 |
| hoot-owl | 73–77 | 0.40 |
| lethal | ≥ 77 | 0.12 |
| unknown | (null) | 0.55 |

**2. Time-of-day light curve (0–1).** Near-dark before sunrise / after sunset; a
dawn ramp; a gentle midday plateau (never the high point); and a **dusk peak**.
Dawn and dusk amplitudes are **co-equal at baseline** — neither twilight gets a
structural lead. Which one wins is left to:
- **Seasonal dusk placement (`duskC`):** the evening peak sits ~1 h before sunset
  at high summer (last light) and pulls back to ~2.5 h before sunset in
  spring/fall as evenings cool and shorten. `month` drives this.
- **Thermal-refuge tilt (`heatX`):** only in hot water (band heat ≳ 0.55) does
  dawn pull ahead — the coldest water of the day is at first light — while the warm
  late afternoon eases back. Below ~66 °F the two stay co-equal.

The decimal-hour sunrise/sunset parser respects AM/PM (a prior bug parsed a 9:34
PM sunset as 9:34 AM and blacked out the afternoon — fixed).

**3. Cloud cover.** On warm-water days, bright midday sun (≈11 AM–5 PM) is
suppressed up to 35%; overcast relieves that and lifts the daylight curve ~12%
generally (the BWO/emerger effect).

**4. Flow vs normal** (`flowRatio`): ≥1.5× → ×0.80, ≥1.25× → ×0.90 (off-color high
water dampens the sight bite); very low clear water (≤0.7×) trims harsh midday.

**4b. Flow dynamics** (`flowTrend`, from `flowTrendFrom()`): turbidity is a
dynamics problem, not a level problem — a fat snowpack year runs 2× the median
for weeks and fishes fine, and mud settles on a falling river even at elevated
absolute flow. So this signal is entirely **self-relative** to the gauge's own
recent trace (~10-day lookback); it never compares against `normal.flow`.

- **`spike`** (0..1, whole-day ×`(1 − 0.55·spike)`): fires on (a) rising hard
  *right now* — day-over-day rise as a fraction of yesterday's own flow, +10%/day
  starts, +60%/day = fully blown — or (b) residual murk after a genuine runoff
  **event**: a recent crest ≥1.30× its pre-rise base. Residual scales with event
  severity (1.30× → 0 … 2.20× → 1) and decays on a falling-day clock: full at the
  crest, ~half after 1 falling day, gone after 2 (plateaus decay at half speed —
  sediment settles even without a drop).
- **`clearing`** (0..1, whole-day ×`(1 + 0.18·clearing)`): the prime post-storm
  window. Requires a genuine event **and** real falling days (a falling day is a
  ≥2% drop below the prior day, so plateau wobble can't fake it): 0.5 on falling
  day 1, prime (1.0) on days 2–3, tapering to 0 by day 6 as the recession goes
  stale. Scaled by event severity and multiplied by `(1 − spike)` — still-murky
  water isn't clearing yet.
- A **smooth seasonal recession** (no rise anywhere in the lookback) produces no
  event: spike = clearing = 0 and only the static factor-4 dampener applies.
- Today's `flowTrend` is **reused unchanged for forecast days** — it's a
  multi-day condition, not a per-block one.

*History:* the original formulation keyed spike off `flowRatio` level (≥1.3× normal
started it, ≥2.2× pinned it at 1.0) and gated clearing at ratio < 1.6. That pinned
"blown out" onto every gauge for days after a storm crested — and onto rivers with
no storm at all whenever a low prior year dragged `normal` down (July 2026: five
days into a clean recession, whole drainage scoring 2s while fishing Good). Replaced
2026-07-05 with the self-relative event model above.

**5. Precip:** light chance (30–69%) → ×1.05 (bugs knocked down, low light); heavy
(≥70%) → ×0.92 (muddies, suppresses).

### Day score — `dayScore`

Headline 0–10 badge, calibrated so local guide ratings map onto our scale
(their 3.5/5 ≈ our 7). A flat daytime average diluted good days, so it blends the
best sustained window with the daytime average:

```
day  = blocks[3..9]                 // 6–8a … 6–8p  (fishable daylight only)
avg  = mean(day)
best = max over i in 3..8 of (blocks[i] + blocks[i+1]) / 2   // best 4h, both blocks within 6a–8p
score = round( (0.35 × best + 0.65 × avg) × 10 ) / 10
```

Blocks 0–2 (midnight–6 AM) and 10–11 (8 PM–midnight) are excluded so the badge
reflects fishable daylight, not dead overnight hours. The best-window loop stops
at `i=8` so both blocks of the 4-hour window stay inside 6 AM–8 PM.

### Optimum window

The strongest contiguous **6-hour (3-block) window, restricted to 6 AM–8 PM.**
Block `i` covers `[2i, 2i+2)`, so a 3-block window `[2i, 2i+6)` stays inside
6 AM–8 PM (hours 6–20) only for start `i = 3..7`:

```
for i in 3..7:  avg = (blocks[i] + blocks[i+1] + blocks[i+2]) / 3
pick the highest avg;  earliest window wins on an exact tie
```

This is a true highest-average window, not a peak grown outward, and it can never
begin before 6 AM or end after 8 PM. The context sentence keys off the window's
midpoint and season (last-light hatch / morning rise / midday).

### The star — `bestBlockIdx`

The single highest block, **earliest-wins on exact ties** (no dawn/dusk bias).

---

## Assumptions

- Water temperature dominates; everything else modulates around it.
- These are freestone streams with a real evening rise, but dawn and dusk are
  co-equal by default — the evening only leads through season (`duskC`) or the
  thermal tilt in hot water, not a hardcoded thumb.
- The "fishing day" is a fixed **6 AM–8 PM**, not derived per-day from sunrise/
  sunset — both the badge and the optimum window use that fixed slice.
- Bands follow standard trout science, including the MT FWP hoot-owl trigger at
  73 °F and the ~77 °F lethal threshold.

---

## Data lineage & fallbacks

| Input | Today's source | Future day | Fallback chain → null behavior |
|-------|---------------|-----------|-------------------------------|
| `waterTempF` | `series.watertemp.latest.value` | `g._series.fcTemp[i]` | → today's mean → `normal.watertemp` → **null** → "unknown" band 0.55× (see `01`) |
| `flowRatio` | `series.flow.latest ÷ normal.flow` | `g._series.fcFlow[i] ÷ normal.flow` | flow → today's mean; `normal.flow` missing → **ratio = 1.0** |
| `cloudPct` | daytime mean of `weather.hourly[].cloudPct` | same | **only hourly carries cloud** → absent → **40%** |
| `precipPct` | proxy from `weather.daily[].precipIn` | same | → aggregated hourly → **0%** |
| `sunriseHr`/`sunsetHr` | `weather.daily[].sunrise`/`.sunset` | same | absent → **~5.7 / ~21.5** |
| `waterType` | `type` | `type` | absent → **freestone** |
| `month` | calendar month | calendar month | → `CUR_MONTH` constant |
| Band thresholds | inline in `_bandFor` (40/50/60/68/73/77) | — | match `constants.hootOwlThresholdF`/`lethalF`; if engine reads `constants`, note here |

---

## Outputs

- `g.blocks` — the twelve 0–10 scores driving the bars and their colors
  (`scoreClass`: 9+ prime, 7–8 good, 4–6 fair, <4 poor).
- `g.optIdx` — the starred block (`bestBlockIdx`).
- The **day-score badge** (`dayScore`) and the **optimum-window** label + sentence.
- `g.blocks` is the sole input to where-to-fish (`04`).

---

## Status

The engine is **built, pure, and deterministic** and produces realistic shapes
against real data. The remaining work is wiring today's `conditions` from the live
snapshot and each future day's from the forecast. Until that lands, the chart may
render a hardcoded `g.blocks` array; once `computeBlocks` is fed live, the badge,
chart, and optimum window all become live with no change to the math.
