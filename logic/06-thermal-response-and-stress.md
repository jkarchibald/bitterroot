<!-- version: 06-thermal-response-and-stress-6-2.md -->
# 06 — Thermal response curve & stress ladder

*Authoritative doc for Phase-1 (response curve) and Phase-2 (stress ladder + DO
grounding), updated for the Phase-3 close (2026-07-10) and the **Phase-6 close
(2026-07-12)**. Matches deployed code as of 2026-07-12. The stress ladder (§3) was
redefined at Phase 3 to a **current-only** signal (today's peak), with the forward
look moved to a separate forecast-warning callout (§3b). **As of Phase 6 this doc is
the single temperature authority for BOTH scoring engines:** the bite engine
(`computeBlocks`) always read `_bandFor`; the rig engine (`categoryScores`) now reads
it too (§1 note), closing the "four identical scores" and flipping Phase 1 to fully
done. The curve, the two `66`s, and `HOOT_OWL_F`/`STRESS_RED_F` are **byte-identical**
across that change — Phase 6 *reads* this authority, it does not alter it. Citations
follow the §7 standing convention (cited / derived-in-repo / assumption), with
**Montana / regional sources for local support** (flagged 🏔 — MSU, University of
Montana, Montana FWP, Montana DEQ). Supersedes the thermal material in the older
`01-temperature.md`, which still describes the retired `(hi+lo)/2 − 6` model — see the
doc table in `BUILD_TRACKER.md`.*

Species assumption: **westslope cutthroat trout** (*Oncorhynchus clarkii lewisi*)
across all Bitterroot-drainage reaches. Cutthroat are colder-adapted than the
browns/rainbows the statewide FWP 73°F rule was written around ([S7]), so this drainage
runs a colder curve. Where mixed brown/rainbow water later warrants a warmer
curve, add it as a per-reach override — the universal science stays locked.

## 1. Feeding-response curve — `_bandFor(tempF)` → `{key, mult, heat}`

`mult` is the temp→feeding/catchability multiplier used by `computeBlocks`
(`v = 10 * mult * light * flowAdj * precipAdj`). It is a **continuous
piecewise-linear curve**, not step-bands — so two reaches a few degrees apart
score differently instead of snapping to one shared value (the old bug: every
gauge in 50–66°F returned an identical 0.88).

**Phase-6 note — now read by BOTH engines.** Through Phase 5 this curve was consumed
by the bite engine only; the rig engine (`categoryScores`, `05`) ran its own parallel
temperature step-bands — the *same* step-band failure, one level up: every measured
gauge in a bucket returned an identical DRY/NYMPH/DD/STREAMER vector (the "four
identical scores"). As of Phase 6, `categoryScores` reads `_bandFor` instead: `mult`
sets its activity budget + surface (dry/dd) drive, and **`heat` gained a second
consumer** — besides the bite engine's crepuscular dawn/dusk tilt, it now drives the
rig engine's surface→subsurface category tilt (via a soft ramp; derived-in-repo,
detailed in `05` §5a + Appendix). The curve itself, the `MULT`/`HEAT` anchors, and the
peak-0.88 calibration are unchanged — the rig engine *reads* this authority, it does
not redefine it. This makes `06` the single temperature source of truth for both
engines and closes the Phase-1 integration gap.

Published anchors (all for westslope cutthroat):
- optimum growth **13–15 °C (55–59 °F)** — Bear, McMahon & Zale 2007, *TAFS* 136:1113–1121 (Montana/MSU, [S1])
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
(§5) this branch should become rare-to-dead once the pipeline guarantees an
estimated temp for every gauge (Phase 3).

## 2. Legal / chart line vs. welfare line — the two-tier constants

Two different numbers, deliberately kept apart:
- `HOOT_OWL_F = 73` — the **FWP legal/chart** reference (statewide hoot-owl
  trigger: 73°F daily max, 3 consecutive days; 77°F lethal — Montana FWP drought
  policy [S7], which explicitly lists the Bitterroot from the E/W Fork confluence to
  the Clark Fork as a hoot-owl reach). **Fixed.** Drives the red chart line and any
  "hoot-owl likely" reference. Feeding/welfare logic is **not** tied to it — that
  lives in `_bandFor` (§1) and `STRESS_RED_F` (§3).
- `STRESS_RED_F = 70` — the conservative **cutthroat welfare** red (tunable);
  the on-the-water number, ahead of the legal line.

The Phase-2 DO analysis (§4) reinforces this split: the welfare red at 70 sits
**below both** the legal line (73) and the DO-saturation danger zone (~76–81 °F),
so it is a genuine early-warning margin of 3–6 °F ahead of the statutory and
physical-chemistry limits. **Do not merge 70 into 73** — that deletes the margin.

## 3. Thermal-stress ladder — `waterStress(wt)` → `{level, label, reason}`

A fish-**welfare** indicator, **not** a legal/hoot-owl claim. It answers **"is the
water stressful *right now*"** — it reads **today's peak** water temperature only
(the most recent `thisYear` daily `max`, measured or estimated) and nothing else:
**no history trail, no forecast.** FWP's hoot-owl determinations fold in gauges,
manual readings, flow and pressure we can't mirror, so we never imply legality.

**Current-vs-forecast split (Uber, 2026-07-10).** The stress chiclet is a
*current-condition* signal; the *forward look* is owned entirely by a separate
**forecast-warning callout** (§3b). The two speak the same 70/73 language so they
never contradict on-screen:

- 🔴 **red** — today's peak ≥ **73 °F** (`STRESS_TODAY_RED_F`) — at the FWP
  hoot-owl line today; rest the fish.
- 🟠 **orange** — today's peak ≥ **70 °F** (`STRESS_TODAY_ORANGE_F`) — in the
  cutthroat welfare stress band today.
- 🟢 **green** — below 70 °F today.

Single-day thresholds (no 3-consecutive-day rule — there is only one day). Red is
the 73 °F hoot-owl line in both the chiclet and the callout; orange starts at 70
in both — chosen to match the callout exactly rather than an earlier, softer 68
nudge.

**Why this replaced the old ladder.** The prior `waterStress` blended the
trailing-10 measured window **∪ the forecast** on a flat 70 °F / 3-consecutive-day
rule. Because a warm *forecast* could satisfy that run while the *measured* water
was still cool, the chiclet tripped **red off forecast days the callout was
correctly calling amber** — observed live on Missoula (measured daily-max peaked
~68 °F, yet the chiclet read red from a forecast run reaching 70–74 °F on
07-11..13). Splitting the signals by time horizon removed the contradiction: the
chiclet now reports only what the water is doing today, and the forecast run
drives the callout, not the chiclet.

Constants: `STRESS_TODAY_ORANGE_F = 70`, `STRESS_TODAY_RED_F = 73`. The
`STRESS_RED_F = 70` and `HOOT_OWL_F = 73` constants are **retained** — they are now
the *callout's* triggers (§3b) and the chart red line (§2) — as are
`STRESS_RED_DAYS = 3` and `STRESS_FC_DROP = 1`, used by the callout. `STRESS_ORANGE_F = 68`
is retained as a legacy reference constant only (no longer a live threshold).

## 3b. Forecast-warning callout — `tempCallout(g)` (the forward look)

A separate, purely **forward-looking** signal that answers "is a thermal problem
*coming*." It reads the **forecast** daily max only (never the history trail), on
the same 3-consecutive-day / `STRESS_FC_DROP=1` terminal-drop logic the old ladder
used, but with the two-tier split:

- 🟠 amber **"Water Temp"** — forecast max ≥ `STRESS_RED_F` (**70 °F**) for 3
  consecutive forecast days.
- 🔴 red **"Hoot-Owl Likely"** — forecast max ≥ `HOOT_OWL_F` (**73 °F**) for 3
  consecutive forecast days (supersedes amber).
- nothing fires → the callout is hidden entirely.

Rendered in **two places from one computation**: a pill bottom-right of each gauge
card (fires on *every* warm gauge — a grid-wide scan), and a matching chiclet in
the Flow & water-temp chart's legend row, whose hover shows a one-line "why"
(temps + dates, e.g. *"Forecast highs 71–74 °F, Jul 11–13"*). The chart chiclet is
selected-gauge-only by nature (one chart shows at a time). `tempCallout` returns
the triggering run's date span + max range so the card pill and the chart hover
can never disagree.

Forecast **max** comes straight from `data.json`. As of **Phase 6** the pipeline
writes a **condition-aware** diel band on measured-gauge forecast rows — each day's
band scales with its air–water differential, bounded to the gauge's own observed
swing extreme (see `02-chart-forecasts` §2c). This replaced the Phase-3 flat average
band, which systematically **understated** the forecast max on hot/clear/low-flow days
— the days the callout most cares about — so genuinely stressful afternoons could fall
just under the 70/73 lines unwarned. The render-time fallback (forecast mean + the
gauge's own observed `(max−mean)` spread) now fires **only** on a stale, pre-band row
carrying a mean only; it is dead code on any fresh `data.json`. It is deliberately left
**flat** (average spread, not hardened to the max spread): with the condition-aware
pipeline band the fallback no longer runs on live data, and minimal swing variance is
preferred (decision recorded 2026-07-12; see `BUILD_TRACKER.md`).

### 3a. Behavioral trace (validated headless, 2026-07-10)

`waterStress` and `tempCallout` were extracted and run in Node against each gauge's
real `series.watertemp` (the exact object that becomes `g._wt`) from the live
8-gauge `data.json`. Confirmed: **stress chiclet** reports today's peak per gauge —
all 8 green today (Missoula ~67 °F, Bell ~64 °F, forks 51–61 °F), orange only when
today's peak ≥70, red only when today's peak ≥73; provenance (`est`) unchanged.
**Callout** fires amber on Missoula (forecast maxes 72.2 / 71.4 / 73.6 on
07-11..13 = 3 consecutive ≥70; only one day clears 73, so no red run), and nothing
on Darby (peak ~65) or Bell (peak ~66.6). **Result: no gauge shows red Stress beside
a non-red callout** — the split holds. Live-deploy verified on the site
2026-07-10.

## 4. DO grounding of the ladder (Phase 2) — why 68/70, and why not per-elevation

**The driver is the O₂ supply/demand scissors, not DO saturation alone.** As water
warms, the solubility *ceiling* falls (DOsat ≈ 9.1 mg/L @68 °F → 8.9 @70 °F →
8.6 @73 °F at valley elevation — DOsat per Benson & Krause 1984 [S3], values
derived in-repo, see §7) while salmonid metabolic O₂ *demand* rises steeply
(roughly doubling per ~10 °C; Q10≈2 standard respiratory physiology, and the
cutthroat aerobic-scope collapse above ~15 °C in Macnaughton et al. 2021 [S2]).
Stress is the **ratio** of available-to-required O₂ — the margin for the added
load of being hooked and fought collapses well before the ceiling itself hits a
floor.

**Key finding — pure DO saturation would place the line HIGHER, not lower.** The
DOsat ceiling doesn't cross the accepted cold-water salmonid sublethal band
(~6.5–7.0 mg/L; U.S. EPA 1986 salmonid criteria — no-impairment ~8 mg/L,
slight-impairment onset ~6–6.5 mg/L [S4]; Montana's own cold-water DO standard,
Circular DEQ-7 [S8], is the state-level local counterpart) until ~76–81 °F even at
the highest
gauge (crossing temps derived in-repo, §7) — above the 73 °F hoot-owl line and
near the 77 °F acute-lethal point. So 68/70 are **not** DO-saturation numbers;
they are **thermal-welfare thresholds for which the O₂ scissors is the
mechanism**, pushed into the high 60s by three things:
1. **Demand side** — O₂ demand climbs fastest exactly here (Macnaughton et al.
   2021 [S2]).
2. **Saturation ≠ actual** — DOsat is a best-case ceiling; actual stream DO runs
   below it under respiration load (DO-solubility literature notes actual is
   commonly ~60–90 % of saturation [S3]; the exact fraction is site-specific — an
   **assumption**, not a measured value here), so *actual* DO at 70 °F can already
   be near the ~6.5–7 mg/L floor.
3. **Direct thermal physiology** — cutthroat incipient/chronic-lethal ~67 °F
   (Bear et al. 2007 [S1]); DO delivery failure is the mechanism by which that
   thermal limit bites.

**Verdict:** 68/70 are correctly shaped and placed; they sit safely *inside*
(below) the DO danger zone — appropriately conservative, DO corroborating rather
than contradicting. Keying off **daily MAX** is right: the diel thermal peak is
when the supply/demand margin is thinnest. **No change on DO grounds.**

**Elevation — real physics, deliberately not wired.** O₂ solubility scales with
barometric pressure, which falls with altitude (DOsat pressure correction
`DOsat(P) = DOsat(1 atm)·(P − Pwv)/(1 − Pwv)`; USGS OWQ Tech Memo 2011.03 / APHA
Standard Methods [S5]). Station elevations are **derived in-repo** by inverting
each gauge's own absolute station pressure (Open-Meteo `pressureHpa`) through the
barometric formula, cross-checked against config elevations (Lolo 3,313 ft, Bell
3,330 ft). All table values below are repo-derived, not cited to a paper:

| Gauge | Elev (ft) | Station P (atm) | DOsat @70 °F (mg/L) | vs valley |
|---|---:|---:|---:|---:|
| Lolo abv Sleeman | ~3,280 | 0.887 | 7.86 | — |
| Bitterroot at Bell Crossing | ~3,290 | 0.887 | 7.86 | — |
| East Fork nr Conner | ~4,160 | 0.859 | 7.61 | −3 % |
| West Fork nr Conner (tailwater) | ~4,640 | 0.843 | 7.47 | −5 % |
| West Fork abv Painted Rocks | ~4,690 | 0.842 | 7.45 | −5 % |

The high forks carry ~4–5 % less DO per degree than the valley gauges — an
equal-cushion shift of about **−3.4 °F per 1,000 ft** above the ~3,300 ft valley
reference. **We keep thresholds gauge-agnostic anyway, because the physics is
anti-correlated with exposure in this drainage:** the high-elevation gauges are
the *cold* ones (observed daily-max envelopes — wf-conner peak ~63.5 °F, dam-fed
~48 °F baseline; ef-connor ~63.4 °F; wf-painted cold freestone) that essentially
never reach 68–70 °F, while the gauges that actually approach the thresholds
(Bell mainstem, Lolo below Hwy 93) sit at the reference elevation where the
correction is ~0. A naive "lower thresholds with altitude" rule would tighten the
ladder where fish are coldest and leave it unchanged where they're warmest. (The
sea-level-equivalent framing of −10 to −15 °F is a strawman: 68/70 were never
sea-level-referenced; they are Rocky-Mountain cutthroat numbers already measured
at altitude.)

**Decision (recommended, adopted):** no per-gauge elevation offset. If ever
wanted, the only defensible form is a **documented, default-off, welfare-line-only**
offset `ΔF ≈ −3.4 × (elev_ft − 3300)/1000`, clamped `[−5, 0]` — but flagged
**near-inert** for this drainage and therefore low-priority polish, not a
correctness fix. Not to be wired without explicit sign-off (touches `index.html`).

## 5. UI + data-provenance rule (three-tier)

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
legitimate "no data / unknown" state at score time**: the estimation layer supplies
discharge, stage, water temp, and trend (measured or estimated) *before* anything
scores. As of the **Phase-3 close (2026-07-10)** the pipeline guarantees an estimate
for every gauge, so the `unknown → orange` fallback in `stressChiclet` is now
**dead code** (retained defensively; it should never fire on live data).

## 6. Still open (in coupling order)

- **Phase 3 — estimation completeness (pipeline, `fetch-data.mjs`): ☑ CLOSED
  (2026-07-10).** Every gauge now carries a measured-or-estimated series for
  discharge, stage, temp, and trend before scoring (closes the §5 no-unknown
  mandate — the `unknown → orange` branch is dead code). The 8-vs-11-day window
  mismatch was fixed, the terminal-day outlier guard added, measured-gauge forecast
  rows now carry a real diel band, and two mainstem temp gauges (Darby, Missoula)
  were added with Bell interpolated on the Darby↔Missoula gradient.
- **Phase 6 — `categoryScores` (rig ranking): ☑ CLOSED (2026-07-12).** Re-anchored
  to this cutthroat curve (`mult` + `heat`, §1 note), breaking the "four identical
  scores" on all measured gauges (verified headless on the live 8-gauge `data.json`).
  **Flow correction:** the original plan to *scale the ≥1.4× branch with ratio* was
  **dropped** — a turbidity/reactive-distance + rising-limb-hysteresis literature
  search established that off-color/bite suppression is a **rate-of-rise** phenomenon,
  already carried by `flowTrend.spike`/`clearing`, while absolute **level** only
  relocates fish and rides a non-climatological `normal`. Scaling level would have been
  false precision on the wrong axis, so the level branch was instead **demoted** to a
  small unscaled location cue (see `05` §5a, `07`). Score *magnitudes* still calibrate
  against fly-shop reports at **Phase 8**.
- **Bias check (characterised, Phase 3):** Open-Meteo highs run ~3–6°F above
  weather.com in the credible window; because the forecast rides the air *change*
  (not level) at a damped slope, this largely cancels — noted, not corrected.
- **Parked (optional, from Phase 2):** default-off, welfare-line-only elevation
  offset (§4). Near-inert for this drainage; do not wire without sign-off.
## 7. Sources

Convention (standing rule, BUILD_TRACKER): every logic assumption points to a
cited source where a published one exists; **Montana / regional sources are
preferred where they exist, for local support** (flagged 🏔 below). Repo-computed
values are labeled **derived-in-repo** (traceable to method, not a paper); genuine
judgement calls are labeled **assumption**.

Cited science:
- **[S1] Bear, E.A., McMahon, T.E., Zale, A.V. (2007).** 🏔 *Montana study* —
  Montana State University + USGS Montana Cooperative Fishery Research Unit,
  Bozeman. Comparative thermal requirements of westslope cutthroat trout and
  rainbow trout. *Transactions of the American Fisheries Society* 136(4):1113–1121.
  doi:10.1577/T06-072.1. — optimum growth 13–15 °C; chronic upper incipient lethal
  ~19.6 °C (~67 °F). The primary local anchor for the response curve. (§1, §4)
- **[S2] Macnaughton, C.J., et al. (2021).** *Canadian Journal of Fisheries and
  Aquatic Sciences* 78:1247. — cutthroat aerobic-scope peak ~15 °C, declining
  beyond; acute lethal ~25 °C (~77 °F). (§1, §4)
- **[S3] Benson, B.B., & Krause, D. (1984).** The concentration and isotopic
  fractionation of oxygen dissolved in freshwater and seawater in equilibrium with
  the atmosphere. *Limnology and Oceanography* 29(3):620–632.
  doi:10.4319/lo.1984.29.3.0620. — DO-saturation standard; implemented by USGS
  DOTABLES / USGS OWQ Tech Memo 2011.03. (The in-repo DOsat uses the APHA Standard
  Methods 4500-O 4-term ln-polynomial parameterization consistent with this.)
  Note on "actual < saturation": DO-solubility references note actual water DO is
  commonly ~60–90 % of saturation under biological O₂ demand. (§4)
- **[S4] U.S. EPA (1986).** Ambient Water Quality Criteria for Dissolved Oxygen.
  EPA 440/5-86-003. — salmonid DO: no production impairment ~8 mg/L, slight/
  moderate impairment onset ~6–6.5 mg/L; salmonids broadly 6–8 mg/L. Basis for the
  ~6.5–7.0 mg/L sublethal band. (§4)
- **[S5] DOsat altitude/pressure correction** — barometric formula
  `P = 101.325·(1 − 2.25577e-5·h)^5.25588` and `DOsat(P) = DOsat(1 atm)·
  (P − Pwv)/(1 − Pwv)`; standard limnology, per USGS OWQ Tech Memo 2011.03 / APHA
  Standard Methods 4500-O. (§4)

Montana / regional (local support) 🏔:
- **[S6] Bell, D.A., Kovach, R.P., Muhlfeld, C.C., Al-Chokhachy, R., Cline, T.J.,
  Whited, D.C., Schmetterling, D.A., Lukacs, P.M., Whiteley, A.R. (2021).**
  🏔 *University of Montana* (Wildlife Biology Program, W.A. Franke College of
  Forestry & Conservation) with USGS + Montana FWP; ~22,000 Montana FWP surveys.
  Climate change and expanding invasive species drive widespread declines of native
  trout in the northern Rocky Mountains, USA. *Science Advances* 7(52):eabj5471.
  doi:10.1126/sciadv.abj5471. — native cutthroat are cold-limited and declining in
  Montana under warming + reduced summer flow; explicitly argues conservation should
  be **tailored to each species** — direct local support for "cutthroat governs the
  welfare ceiling." (§ intro, §4)
- **[S7] Montana Fish, Wildlife & Parks — Drought Policy / Hoot-Owl restrictions.**
  🏔 fwp.mt.gov (Fisheries → Water Management → Drought). — the **regulatory basis
  for `HOOT_OWL_F = 73`**: FWP restricts angling when max daily water temp reaches
  **≥73 °F for 3 consecutive days**; **≥77 °F can be lethal to trout**. FWP's July
  2024 action explicitly named the **Bitterroot River (East/West Fork confluence →
  Clark Fork)** as a hoot-owl reach — this drainage. The ladder's 3-consecutive-day
  logic mirrors FWP's. (§2, §3)
- **[S8] Montana DEQ (2019).** 🏔 Circular DEQ-7, Montana Numeric Water Quality
  Standards (Helena, MT), plus DEQ *Dissolved Oxygen Assessment Method for Streams
  and Rivers*. — Montana's own cold-water (salmonid; use classes B-1/B-2/C-1/C-2)
  dissolved-oxygen standards. The Bitterroot is a cold-water fishery, so DEQ-7's
  salmonid DO standard is the **state-level local counterpart** to EPA 1986 [S4] for
  the sublethal band. (§4)
- **[S9] Drinan, D.P., Zale, A.V., Webb, M.A.H., Taper, M.L., Shepard, B.B.,
  Kalinowski, S.T. (2012).** 🏔 Montana State University / Montana cutthroat
  populations. Evidence of local adaptation in westslope cutthroat trout.
  *Transactions of the American Fisheries Society* 141(4):872–880. — supports the
  design split: the cutthroat thermal curve is universal science, but *which* stock
  lives in *which* reach is local — basis for per-reach overrides over a blended
  median. (§ intro, §1)

Derived-in-repo (method above; not cited to a paper):
- Per-gauge elevations (barometric inversion of Open-Meteo station `pressureHpa`,
  cross-checked vs config), the DOsat mg/L table, the ~76–81 °F floor-crossing
  temps, and the −3.4 °F/1,000 ft equal-cushion slope. (§4)
- Observed daily-max water-temp envelopes (from `data.json` `thisYear`). (§4)

Assumptions (judgement calls, flagged as such):
- Actual stream DO sits below saturation at the diel thermal max; exact fraction
  is site-specific and not measured here (we carry no DO sensor). (§4)
- Species governance: westslope cutthroat sets the welfare ceiling drainage-wide
  (§ intro).
