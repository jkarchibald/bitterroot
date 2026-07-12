<!-- version: 03-bite-windows-5-1.md -->
# 03 · Bite Windows, Day Score & Optimum Window

The vertical list of twelve 2-hour windows for the selected gauge — each a 0–10
bar — plus the day-score badge on the card and the "Optimum window" readout below
the chart. All three come from one pure engine, `computeBlocks`.

*Phase 5 (light & time-of-day) rewrote this file's light-curve section (§ "Logic /
calculation → 2") to match the shipped `computeBlocks`. The dominant change: the
evening peak is now placed to land in the **6–8 PM block** (the real evening-hatch
window) rather than the post-sunset 8–10 PM bin — see the `duskC` note. Flow
scoring moved to dynamics-first in Phase 4 and is documented in `07-flow.md`; this
file describes only how the flow signal enters a block, not how it is derived.*

---

## What it is

- **Bite-window chart:** twelve 2-hour blocks, each scored 0–10, a star on the
  single best block, and a short reason on weaker blocks.
- **Day-score badge:** one 0.0–10.0 number summarizing fishable daylight.
- **Optimum window:** the strongest contiguous **6-hour** stretch within fishable
  daylight, with a context sentence.

**Block layout.** Block `i` spans clock hours `[2i, 2i+2)`; its **midpoint hour is
`2i+1`** (the value the light curve is evaluated at). Block 0 = 12–2 AM (mid 1),
block 3 = 6–8 AM (mid 7), block 9 = 6–8 PM (mid 19), block 11 = 10 PM–midnight
(mid 23). **6 AM–8 PM is blocks 3 through 9.**

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
score = 10 × band.mult × light × flowAdj × precipAdj   (rounded, clamped 1–10)
```

The floor is **1, not 0** — a live, flowing trout river is never a literal
zero-chance, and a `0` renders as an empty, word-less bar (a load-bearing
invariant, see `build-tracker` §2).

**1. Water-temperature band** (`_bandFor`) — the dominant driver. `_bandFor(t)`
returns `{key, mult, heat}`, both `mult` and `heat` as **continuous** piecewise-
linear curves over westslope-cutthroat thermal biology (full detail in `06`). The
two values this engine consumes:

- **`band.mult`** (feeding / catchability, ~0.06–0.88) — multiplies the score
  directly. Peaks 0.88 across the 55–59 °F optimum, eases past 59 °F, crosses the
  ~67 °F chronic-lethal line, bottoms toward the ~77 °F acute-lethal. `06` is
  authoritative; this file does not restate the anchor table.
- **`band.heat`** (thermal-stress index, 0–1) — does **not** scale the score; it
  reshapes the *light curve* below (peak placement, amplitudes, midday depth). It
  climbs monotonically with water temperature. **The two load-bearing `66`s** — the
  `HEAT` anchor `[66, 0.72]` and the `t>=66` caption hinge — are response-curve
  science, not thresholds; see `06` and `build-tracker` §2. Do not promote them.

**2. Time-of-day light curve (0–1) — "Dawn Patrol."** The crepuscular heart of the
engine. Two Gaussians (dawn, dusk) sit on a midday plateau; heat reshapes all
three. For a block at midpoint hour `h`, with `srHr`/`ssHr` the decimal-hour
sunrise/sunset and `heat` from `_bandFor`:

- **Full dark.** `h < srHr − 1` or `h > ssHr + 0.35` → `light = 0.08` (night floor).
  Everything below applies only inside the lit window.

- **Dawn Gaussian.** Center `dawnC = srHr + (1.7 − 1.3·heat)` — ~1.7 h after
  sunrise in cool water, pulling toward first light as it heats (the coldest water
  of the day is at dawn). Amplitude:
  ```
  dawnAmp = 0.40 + 0.18·heat  (+ thermal-refuge tilt, below)
  ```

- **Dusk Gaussian.** Center **`duskC = ssHr − (1.8 + 1.2·springFall + 0.4·heat)`**
  where `springFall = 1 − max(0, 1 − |month−7|/3)` (0 at high summer, →1 toward
  the shoulder months). This places the peak:
  - **~1.8 h before sunset at high summer** (July: center ≈ 19.4 with a 21.3
    sunset) — squarely in the **6–8 PM block** (block 9), the classic evening
    hatch, **not** after last light;
  - **~3.0 h before sunset in the shoulders** (spring bugs come off earlier;
    fall days shorten and evenings cool), sliding the peak to mid-evening
    (blocks 8–9);
  - **slightly earlier still in hot water** (`+0.4·heat`) — the warm late
    afternoon is the day's lowest-margin water, so the productive edge slides
    toward the cooler side, directionally consistent with the `heatX` dusk-easing
    below.

  > **Phase-5 fix (2026-07-12).** The prior offset was `ssHr − ((1.0 + 1.5·springFall)
  > − 0.8·heat)`, i.e. only ~0.8 h before sunset at high summer *with heat pushing the
  > center later still*. In July that put the center at ~20.5 — past block 9's midpoint
  > (19) and **onto block 10's** (21, the 8–10 PM bin). Because the day-score best-4 h
  > term and the star both reward the single highest block, the app's "best window"
  > landed **after last light** on every prime-temp gauge, and block 10 (captioned
  > "fading light") outscored the true evening-hatch block. Verified across all 8 live
  > gauges: 8/8 prime/cool gauges starred 8–10 PM before, 0/8 after. The fix is a pure
  > peak-*placement* change; amplitudes and the temp curve are untouched.

- **Peak width.** `pw = 1.9 − 0.5·heat` — both Gaussians tighten as water warms
  (the bite compresses toward the twilight edges).

- **Amplitudes — dusk leads modestly, co-equal-ish at baseline.**
  ```
  dawnAmp = 0.40 + 0.18·heat
  duskAmp = 0.50 + 0.20·heat
  ```
  Dusk sits a step above dawn. Two reasons, one structural and one biological: the
  dusk Gaussian spreads across two blocks (its energy is shared) while dawn's lands
  cleanly on one, so a nominally higher `duskAmp` keeps the two *windows* roughly
  even in practice; and on these rivers the evening hatch / spinner fall genuinely
  leads in season. This dusk-lead is **literature-supported in direction** —
  stream salmonids are most active at dusk in all seasons, with drifting
  invertebrates most abundant at dusk `[S1][S3]`. The **specific amplitudes** are
  **derived-in-repo**, tuned so a prime-temp evening lands at the fly-shop
  calibration anchor (guide "Good" ≈ dawn/dusk 7–8).

- **Thermal-refuge tilt (`heatX`).** Only ramps in across the hot bands:
  ```
  heatX  = clamp01( (heat − 0.55) / 0.37 )     // 0 below ~66 °F, 1 by ~heat 0.92
  dawnAmp += 0.34·heatX     // dawn = coldest water of the day → boosted in heat
  duskAmp −= 0.20·heatX     // late day = warmest water → eased back in heat
  ```
  Below ~66 °F dawn and dusk keep their co-equal-ish baseline (dusk's modest lead).
  In genuinely hot water dawn pulls clearly ahead, because the stream hits its daily
  temperature **minimum** at first light after overnight cooling — the real refuge on
  a hot day — while the late afternoon is the warmest, lowest-margin water. This is
  **blended in, not a hard flip**, so the dusk bug-bump survives at prime. The
  `heat 0.55` gate and the `t>=66` caption hinge are the same response-curve science
  as the `HEAT` anchor; leave them (`build-tracker` §2). *Assumption on the tilt
  magnitude; the direction (dawn-refuge in heat) follows from diel thermal minima and
  is consistent with the seasonal-homogeneity findings `[S1]`.*

- **Midday plateau (`midBase`).**
  ```
  midBase = 0.52 − 0.26·heat
  ```
  Cool water keeps a real midday window (0.52 at heat 0); hot water craters it
  (~0.33 by heat 0.72). On top of that:
  - **Bright + warm guts midday.** For blocks spanning ~11 AM–5 PM (`h` in 11–16),
    `mid ×= (1 − 0.34·heat·(1−overcast))` — bright sun on warm water suppresses the
    midday bite up to ~34 %, and overcast relieves it.
  - **Overcast lifts generally.** `mid ×= (1 + 0.10·overcast)` — clouds lift surface
    activity across the day (the BWO / emerger effect). `overcast = cloudPct/100`.

- **Assemble.** `light = max(0.14, midBase′ + dawn + dusk)`, a 0.14 daytime floor so
  a lit block never reads as dark.

**3. Flow** (`flowAdj`) — **dynamics-first; see `07-flow.md` for the derivation.**
This engine only *consumes* the signal:
- **Level guardrail (the one static term kept).** Very low, clear water in harsh
  midday: `ratio ≤ 0.7` and `h` in 11–16 → `flowAdj = 0.90`. (`ratio` = the
  informational `flowRatio`; the old `≥1.5×→0.80` / `≥1.25×→0.90` *level* penalties
  were removed in Phase 4 — level relocates fish, it doesn't gate feeding.)
- **Dynamics (primary), from `flowTrend`.** `spike` (rising / off-color, 0..1) →
  whole-block `×(1 − 0.55·spike)`; `clearing` (the prime dropping-and-clearing
  window, 0..1) → `×(1 + 0.25·clearing)`. A true blowout is caught by `spike`, not a
  level threshold. Derivation, science, and the demoted-`normal` note live in `07`.

**4. Precip** (`precipPct`): heavy (`≥70%`) → `×0.92` (muddies, suppresses); light
chance (`30–69%`) → `×1.05` (bugs knocked down, low light).

### Day score — `dayScore`

Headline 0–10 badge, calibrated so local guide ratings map onto our scale
(their 3.5–4/5 ≈ our 7–8). A flat daytime average diluted good days, so it blends
the best sustained window with the daytime average:

```
day  = blocks[3..9]                 // 6–8a … 6–8p  (fishable daylight only)
avg  = mean(day)
best = max over i in 3..8 of (blocks[i] + blocks[i+1]) / 2   // best 4h, both blocks within 6a–8p
score = round( (0.35 × best + 0.65 × avg) × 10 ) / 10
```

Blocks 0–2 (midnight–6 AM) and 10–11 (8 PM–midnight) are excluded so the badge
reflects fishable daylight, not dead overnight hours. The best-window loop stops at
`i=8` so both blocks of the 4-hour window stay inside 6 AM–8 PM. Because the Phase-5
`duskC` fix moves the evening peak *into* the 6–8 PM block, `best` now captures the
real evening hatch rather than a fading-light bin — day scores on prime-temp
gauges rose ~0.3–0.7 toward the "Good ≈ 7–8" anchor (verified live, 8 gauges).

### Optimum window

The strongest contiguous **6-hour (3-block) window, restricted to 6 AM–8 PM.**
Block `i` covers `[2i, 2i+2)`, so a 3-block window `[2i, 2i+6)` stays inside
6 AM–8 PM (hours 6–20) only for start `i = 3..7`:

```
for i in 3..7:  avg = (blocks[i] + blocks[i+1] + blocks[i+2]) / 3
pick the highest avg;  earliest window wins on an exact tie
```

A true highest-average window, not a peak grown outward; it can never begin before
6 AM or end after 8 PM. The context sentence keys off the window's midpoint and
season (last-light hatch / morning rise / midday), and off the `t>=66` caption
hinge for the warm-water refuge wording.

### The star — `bestBlockIdx`

The single highest block, with an **evening tie-break**: dawn (block 3) and dusk
(block 9) are designed to be near-even, so a naive `max()` would return the first
(dawn) and wrongly park the star in the morning. So if any evening block (8–10,
i.e. 4–10 PM) reaches the top score, the **latest** such block wins. A genuine
morning peak (hot-water thermal refuge, where dawn outscores dusk outright) is a
strict max, not a tie, so it still correctly stars dawn. *Post-Phase-5, the top
evening block is 9 (6–8 PM), not 10 — the star no longer lands after last light.*

---

## Assumptions

- Water temperature dominates; everything else modulates around it.
- These are freestone streams with a real evening rise. Dusk leads modestly at
  baseline `[S1][S3]`; the evening only pulls *clearly* ahead of dawn through the
  hot-water thermal tilt (`heatX`), and dawn only leads outright in genuinely hot
  water. The seasonal peak-placement shift (last-light in summer, mid-evening in the
  shoulders) tracks the documented spring/summer→autumn/winter homogeneity shift
  `[S1]`.
- The "fishing day" is a fixed **6 AM–8 PM**, not derived per-day from sunrise/
  sunset — both the badge and the optimum window use that fixed slice. (Blocks
  outside it can still score; they're just excluded from the badge.)
- Bands follow standard salmonid science, including the MT FWP hoot-owl trigger at
  73 °F and the ~77 °F lethal threshold — detailed in `06`.

---

## Data lineage & fallbacks

| Input | Today's source | Future day | Fallback chain → null behavior |
|-------|---------------|-----------|-------------------------------|
| `waterTempF` | `series.watertemp.latest.value` | `g._series.fcTemp[i]` | → today's mean → `normal.watertemp` → **null** → `_bandFor` unknown branch (`mult 0.80`, `heat 0.22`) (see `01`/`06`) |
| `flowRatio` | `series.flow.latest ÷ normal.flow` | `g._series.fcFlow[i] ÷ normal.flow` | flow → today's mean; `normal.flow` missing → **ratio = 1.0**. *Informational only — see `07`* |
| `flowTrend` | `flowTrendFrom()` on the aligned flow series | reused unchanged | absent → `{spike:0, clearing:0}` (neutral). Derivation in `07` |
| `cloudPct` | daytime mean of `weather.hourly[].cloudPct` | same | **only hourly carries cloud** → absent → **40%** |
| `precipPct` | proxy from `weather.daily[].precipIn` | same | → aggregated hourly → **0%** |
| `sunriseHr`/`sunsetHr` | `weather.daily[].sunrise`/`.sunset` | same | absent → **~5.7 / ~21.5** |
| `waterType` | `type` | `type` | absent → **freestone** |
| `month` | calendar month | calendar month | → `CUR_MONTH` constant (defaults to 6 inside the engine) |
| Band thresholds | inline in `_bandFor` | — | see `06` (`HOOT_OWL_F` 73 / lethal 77 kept separate from the feeding curve) |

---

## Outputs

- `g.blocks` — the twelve 1–10 scores driving the bars and their colors
  (`scoreClass`: 9+ prime, 7–8 good, 4–6 fair, <4 poor).
- `g.optIdx` — the starred block (`bestBlockIdx`).
- The **day-score badge** (`dayScore`) and the **optimum-window** label + sentence.
- `g.blocks` is the sole input to where-to-fish (`04`).

---

## Status

**Live and integrated.** `computeBlocks` is fed today's `conditions` from the live
snapshot and each future day's from the forecast; the badge, chart, and optimum
window are all live. The light curve is at its Phase-5 shape (evening-peak
placement fixed, amplitudes/tilt reviewed and science-anchored where the literature
reaches, derived/assumption elsewhere). Flow inputs are at their Phase-4
dynamics-first shape (`07`). Score *magnitudes* across the bite and rig engines are
not yet unified/recalibrated — that is **Phase 6** (the "four identical scores"
work and the `categoryScores` re-anchor). No light-curve change is owed before then.

---

## Sources

Three-way split per the standing citation rule: **cited** (published source),
**derived-in-repo** (computed from the app's own data/method), **assumption**
(judgement call, no source). Regional 🏔 sources preferred where they exist.

- **[S1] cited —** Ovidio, M., Baras, E., Goffaux, D., Giroux, F. & Philippart,
  J.-C. (2002). *Seasonal variations of activity pattern of brown trout (Salmo
  trutta) in a small stream, as determined by radio-telemetry.* Hydrobiologia
  470:195–202. DOI:10.1023/A:1015625500918. **Supports:** trout most active at
  **dusk in all seasons**; a seasonal shift from concentrated crepuscular activity
  in autumn/winter to more homogeneous (flatter-midday) activity in spring/summer,
  still dusk-dominant; activity intensity proportional to water temperature and day
  length. Backs the dusk-lead amplitude, the seasonal peak-placement spread
  (`springFall`), and coupling amplitude/width to `heat`.
- **[S2] cited —** Bear, E. A., McMahon, T. E. & Zale, A. V. (2007). *Comparative
  thermal requirements of westslope cutthroat trout and rainbow trout.* Trans. Am.
  Fish. Soc. 136:1113–1121. 🏔 (MSU / USGS Montana Coop. Fishery Research Unit).
  **Supports:** the westslope-cutthroat thermal band that sets `band.mult`/`band.heat`
  (optimum 55–59 °F, chronic-lethal ~67 °F). *Primary detail in `06`; referenced here
  because `heat` reshapes the whole light curve.*
- **[S3] cited —** Invertebrate-drift literature (Elliott; Brittain & Eikeland
  1988, Hydrobiologia 166:77–93; and the drift-timing reviews): drifting stream
  invertebrates peak at **dusk/night**, the prey base that makes the evening window
  productive for drift-feeding salmonids. **Supports:** the direction of the
  evening (dusk) lead. General fluvial ecology, not Bitterroot/cutthroat-specific —
  cited for direction, not magnitude.
- **derived-in-repo —** the specific offset hours in `duskC`
  (`1.8 + 1.2·springFall + 0.4·heat`), the dawn/dusk amplitude constants
  (`0.40/0.18`, `0.50/0.20`), peak width `pw = 1.9 − 0.5·heat`, `midBase =
  0.52 − 0.26·heat`, the bright-midday `0.34·heat·(1−overcast)` suppression, the
  overcast `+0.10` lift, and the day-score blend weights (`0.35 best + 0.65 avg`).
  These are tuned against the fly-shop "Good ≈ 7–8" calibration anchor and the
  bin-alignment requirement (peak must land in block 9), then verified headless
  against live `data.json` (8 gauges) — traceable to method, not to a paper.
- **assumption —** the thermal-refuge tilt magnitudes (`heatX` gate at `heat 0.55`;
  `+0.34`/`−0.20` amplitude shifts), the 0.14 daytime light floor, the 0.08 night
  floor, and the block-1 score floor. Judgement calls consistent with the cited
  direction but not individually sourced.

*Calibration note.* The dusk-lead + seasonal-shift structure is the part with the
firmest literature footing `[S1][S3]`; the exact amplitudes remain the softest
B-tier in the model and are the natural place for local Bitterroot ground-truth
(shop reports, Phase 8) to tighten the numbers.
