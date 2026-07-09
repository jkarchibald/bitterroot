# 06 — Thermal response curve & stress ladder

*Authoritative doc for Phase-1 (response curve) and Phase-2 (stress ladder).
Matches deployed code as of 2026-07-05. Supersedes the thermal material in the
older `01-temperature.md`, which still describes the retired `(hi+lo)/2 − 6`
model — see the doc table in `BUILD_TRACKER.md`.*

Species assumption: **westslope cutthroat trout** (*Oncorhynchus clarkii lewisi*)
across all Bitterroot-drainage reaches. Cutthroat are colder-adapted than the
browns/rainbows the statewide FWP 73°F rule was written around, so this drainage
runs a colder curve. Where mixed brown/rainbow water later warrants a warmer
curve, add it as a per-reach override — the universal science stays locked.

## 1. Feeding-response curve — `_bandFor(tempF)` → `{key, mult, heat}`

`mult` is the temp→feeding/catchability multiplier used by `computeBlocks`
(`v = 10 * mult * light * flowAdj * precipAdj`). It is a **continuous
piecewise-linear curve**, not step-bands — so two reaches a few degrees apart
score differently instead of snapping to one shared value (the old bug: every
gauge in 50–66°F returned an identical 0.88).

Published anchors (all for westslope cutthroat):
- optimum growth **13–15 °C (55–59 °F)** — Bear, McMahon & Zale 2007, *TAFS* 136:1113–1121
- aerobic-scope peak **~15 °C**, declines beyond — Macnaughton et al. 2021, *CJFAS* 78:1247
- chronic upper incipient lethal **19.6 °C (~67 °F)** — Bear et al. 2007
- acute lethal **~25 °C (~77 °F)** — Macnaughton et al. 2021

`mult` anchors (°F → mult): 36→0.28, 44→0.58, 48→0.72, 52→0.80, **56→0.88,
59→0.88** (peak, the optimum band), 62→0.80, 65→0.66, **67→0.54** (chronic-lethal
crossing), 70→0.40, 73→0.25, 75→0.16, **77→0.10** (acute lethal), 82→0.06.
Peak held at **0.88** to preserve the existing fly-shop calibration (guide
"Good" ≈ our dawn/dusk 7–8; 52°F snowmelt fishes good-to-very-good).

Because the curve is continuous, sub-band differences resolve: e.g. **54.6°F
scores above 52.3°F** (mult 0.851 vs 0.807) because 54.6 sits nearer the 55–59°F
feeding peak — under the old step-bands both were "50–60 prime" and tied. (This
is the live Lolo below > Lolo above result.)

`heat` (0..1) is the thermal-stress index that drives the crepuscular dawn/dusk
tilt; it climbs with water temp (40→0.00 … 66→0.72 … 76→1.00). At hot water
(heat ~0.55→0.92) the dawn block pulls clearly ahead (coldest water at first
light).

`key` is a descriptive zone label kept for compatibility only — block captions
read the **raw** water temp, not `key`, and flag "water too warm" at >67°F (the
cutthroat chronic-lethal), so nothing downstream depends on `key`.

`t==null` returns a neutral `{mult:0.80, heat:0.22}`. Under the provenance rule
(§4) this branch should become rare-to-dead once the pipeline guarantees an
estimated temp for every gauge (Phase 3).

## 2. Legal / chart line vs. welfare line — the two-tier constants

Two different numbers, deliberately kept apart:
- `HOOT_OWL_F = 73` — the **FWP legal/chart** reference (statewide hoot-owl
  trigger: 73°F daily max, 3 consecutive days). **Fixed.** Drives the red chart
  line and any "hoot-owl likely" reference. Feeding/welfare logic is **not** tied
  to it — that lives in `_bandFor` (§1) and `STRESS_RED_F` (§3).
- `STRESS_RED_F = 70` — the conservative **cutthroat welfare** red (tunable);
  the on-the-water number, ahead of the legal line.

## 3. Thermal-stress ladder — `waterStress(wt)` → `{level, label, reason}`

A fish-**welfare** indicator, **not** a legal/hoot-owl claim. It reads our own
**daily-MAX** water temp only; FWP's hoot-owl determinations fold in gauges,
manual readings, flow and pressure we can't mirror, so we never imply legality.

Rule (cutthroat-tuned; cumulative, mirroring FWP's own 3-consecutive-day logic):
- 🔴 **red** — daily max ≥ **70 °F** on **3 consecutive days** anywhere in the
  trailing-10 ∪ forecast window ("rest the fish"; also where hoot-owl becomes
  likely as it climbs toward 73).
- 🟠 **orange** — recent/near-term daily max ≥ **68 °F** but not the sustained red.
- 🟢 **green** — below the cutthroat stress band.

Guards:
- **Terminal forecast day dropped** (`STRESS_FC_DROP = 1`) — the last day of the
  Open-Meteo window is an unreliable edge point (observed to spike ~10°F on the
  final day) and must never flip a badge. See also the pipeline-side outlier
  guard (pending in `fetch-data.mjs`), which fixes the same spike for the chart
  and Tomorrow column.
- Forecast **max** derived from forecast mean + the gauge's own observed diel
  (max−mean) spread when the forecast carries only a mean.

Constants: `HOOT_OWL_F=73` (legal/chart, §2), `STRESS_ORANGE_F=68`,
`STRESS_RED_F=70` (welfare), `STRESS_RED_DAYS=3`, `STRESS_FC_DROP=1`.

## 4. UI + data-provenance rule (three-tier)

`stressChiclet(g)` renders a fourth chiclet next to Height · Flow · Temp, using
`waterStress(g._wt)`. `g._wt` is the raw water-temp series stashed during the
data mapping. Colors: `dot-green` / `dot-orange` / `dot-red`.

**Dot color and the "est" tag are decoupled** (Uber, 2026-07-05):
- **Dot color = the data/stress STATE** — the real computed stress level.
- **"est" tag = provenance** — some input feeding it was estimated. A consequence
  to surface, not a problem.

Three tiers:
1. **All inputs measured** → true color, no tag.
2. **Any input estimated** (e.g. `wt.estimated`) → true color **+ "est"**.
3. **Derive-when-truly-stuck** → should essentially never fire.

The chiclet label always reads **"Stress"** (measured → `Stress`, estimated →
`Stress est`); it no longer switches the word to "Status". There is **no
legitimate "no data / unknown" state at score time**: the estimation layer must
supply discharge, stage, water temp, and trend (measured or estimated) *before*
anything scores. The current `unknown → orange` fallback in `stressChiclet` is
therefore a symptom of a missing estimate — it is **not** to be recolored; it
becomes dead code once Phase 3 guarantees the input upstream.

## 5. Still open (in coupling order)

- **Phase 3 — estimation completeness (pipeline, `fetch-data.mjs`):** guarantee
  every gauge a measured-or-estimated series for discharge, stage, temp, and
  trend before scoring; this closes the §4 no-unknown mandate. First item: the
  estimated gauges carry an 8-day series vs. 11 for measured — window mismatch.
  Also the terminal-day outlier guard (chart + Tomorrow column).
- **Phase 6 — `categoryScores` (rig ranking):** re-anchor its temp thresholds to
  the same cutthroat curve and make the ≥1.4× flow branch scale with ratio, so
  the DRY/NYMPH/DD/STREAMER numbers differentiate too (separate function,
  separate risk from this pass — the "four identical scores").
- **Bias check (Phase 3):** Open-Meteo highs run ~3–6°F above weather.com in the
  credible window — may sit the water-temp forecast slightly warm.
