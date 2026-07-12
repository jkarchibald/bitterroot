<!-- version: 07-flow-6-2.md -->
# 07 · Flow (Dynamics-First)

*New in Phase 4; **reconciled with the shipped code at the Phase-6 close
(2026-07-12).** There was no flow doc before this — `04` is where-to-fish (gauge
ranking), not flow. This file is the authoritative description of how flow enters the
bite engine and the rig ranking after the Phase-4 dynamics-first rework. The Phase-6
update touches only the **rig-side** description (§7c/§7d): Phase 6 re-anchored
`categoryScores` and **finished** the level-demotion this doc already argued for —
collapsing the remaining scaled level bands into one coarse, unscaled location cue. The
bite-engine flow math (§7a–7c `spike`/`clearing`/`flowAdj`) is **unchanged** from
Phase 4. The science this doc already cited (rate-of-rise [S1], clockwise hysteresis
[S2], turbidity→reactive-distance [S3]) is exactly what grounded the Phase-6 flow
decision — Phase 6 completed the dynamics-first thesis rather than revising it.*

The one-line thesis: **flow *level* mostly relocates fish; flow *dynamics* gate the
bite.** A river running high on a fat snowpack fishes fine; a river rising fast runs
muddy and shuts off; the falling, clearing window right after is often the best
fishing of the week. So the primary flow signal is dynamics (rise → turbidity →
suppress; drop-and-clear → reward), measured **self-relative** to each gauge's own
recent flow — never against an absolute cfs number or the unreliable "normal."

---

## What it is

Two things layered on the bite score, plus a rig-ranking nudge:

- `flowTrend = {spike, clearing, ratio}` — derived per gauge for today (and carried to
  the Tomorrow column). `spike` and `clearing` each 0..1; `ratio` is informational only.
- `flowAdj` inside `computeBlocks` — the whole-day flow multiplier on each 2-hour block.
- The clarity/location block inside `categoryScores` — dynamics-aware rig ranking.

---

## Inputs

- `series.flow.thisYear[]` daily means, with the final (today) point anchored on the
  live latest snapshot (`series.flow.latest.value`) — the same aligned `cyFlow` array
  the chart draws.
- `normal.flow` — consumed **only** for the informational `ratio` string. **Not a
  scoring driver** (see the "normal" note below).

There is no turbidity sensor. Turbidity is *inferred* from rise rate.

---

## Logic / calculation

### 7a. `spike` — rate-of-rise turbidity

It is the **rate** of rise, not the **amount**, that clouds water. A fast-rising
hydrograph clears the sediment-entrainment threshold and mobilizes bed material; a slow
rise of the same total magnitude may never muddy at all [S1]. So `spike` keys on the
**steepest single day-over-day rise within a short 2-day window**, expressed as a
fraction of the river's own prior-day flow (self-relative, so a small fork and the
Missoula mainstem are judged identically — a point that matters because stage and cfs
scale differently by stream size [S5]):

    maxRise = max day-over-day (now − prev)/prev over the last 2 days
    spike   = clamp01( (maxRise − 0.10) / 0.50 )     // +10%/day → 0 … +60%/day → 1

A single sharp day *can* trip it (matching the physics: one heavy pulse blows a river
out); the 2-day window exists only to keep one lone sensor sample from dominating a
flat/falling trace. Three gentle up-days (+5%/day) correctly produce `spike = 0`.

### 7b. `clearing` — the prime dropping-and-clearing window

Clockwise hysteresis: at equal discharge the **falling limb of a hydrograph runs
measurably cleaner than the rising limb**, because the first flush already mobilized the
loose sediment and the supply exhausts through the event [S2]. So a river cleans up on
the way down *even while still running high* — which is exactly the window anglers prize.

Crucially, this does **not** require first catching a flood crest inside the lookback.
A sustained clean recession IS the clearing signal:

    clearing = dayShape × drawdownShape × (1 − spike)

    dayShape       ramps in on falling day 1 (0.5), prime on falling days 2–4 (1.0),
                   goes stale by ~day 8   (recession losing its edge)
    drawdownShape  clamp01( (drawdown − 0.05) / 0.25 )   // 5% off recent peak → 0 … 30% → 1
    drawdown       = (recentPeak − now) / recentPeak  over the 10-day lookback

`drawdownShape` ensures a river that has barely ticked down from its crest scores little,
while one well off its peak scores full. The `(1 − spike)` factor means still-rising or
still-murky water isn't credited as "clearing" yet.

**Why the rewrite was necessary (the dead-signal bug).** The pre-Phase-4 model gated
`clearing` on a prior in-window crest that rose ≥1.30× off a pre-rise base. In a
recession the peak is the *oldest* sample, so no base precedes it, the event test always
failed, and `clearing` was **structurally 0** — confirmed reading 0 on all 8 live gauges
during an ordinary post-runoff drop-out, i.e. exactly the prime window it existed to
reward. The crest gate is removed. On the same live data the rewrite fires `clearing`
0.4–0.75 across the recessing gauges (prime 5-day fallers highest; 10-day fallers lower
as the recession goes stale), and correctly holds two gauges at 0 that ticked up ~1% at
the bottom of their recession. [S4]

### 7c. `flowAdj` — dynamics primary, level a guardrail only

Inside `computeBlocks`, per block:

    flowAdj = 1
    if (ratio ≤ 0.7 and harsh midday)  flowAdj = 0.90     // low-water × midday sun (kept guardrail)
    if (spike > 0)   flowAdj ×= (1 − 0.55·spike)          // rising/off-color: up to −55%
    if (clear > 0)   flowAdj ×= (1 + 0.25·clear)          // prime clearing:   up to +25%

The old static level penalties (`ratio ≥ 1.5 → 0.80`, `ratio ≥ 1.25 → 0.90`) are
**removed**. They pinned six of eight live gauges to a single 0.80 step and treated 1.5×
and 2.7× identically, freezing the day score across days of changing flow. The only level
term kept is the low-water × harsh-midday trim — a genuine guardrail (very low, clear
water fishes poorly under bright midday sun). A true blowout is caught by `spike`, not by
a level threshold, so no absolute-level cutoff is needed [S4, S5].

The clearing ceiling is **+25%** (raised from the prior +18%). With dynamics now the
primary signal rather than a small bonus layered on a penalty, a prime clearing recession
should read as genuinely strong, and the clockwise-hysteresis basis [S2] justifies
treating it as real signal, not a token nudge. The +25% magnitude itself is a calibration
choice [S4].

### 7d. Rig ranking (`categoryScores`) — updated at Phase 6

Dynamics-aware, unchanged in intent from Phase 4: `spike ≥ 0.35` biases toward streamers
(fish hunt by lateral line in dirty water [S3]); a strong `clearing` (≥ 0.3) biases toward
dries/dry-dropper on the seams (the prime window). These two **rate** signals are the flow
drivers of the rig ranking and are byte-identical to Phase 4.

**Phase-6 change — level fully demoted, magnitudes re-anchored.** Phase 4 left this doc
noting "score magnitudes here are not re-anchored — that is Phase 6." Phase 6 did both:

- **Temperature magnitudes re-anchored.** `categoryScores`'s temperature term now reads
  the shared `_bandFor` cutthroat curve (`06` §1), not its old parallel step-bands —
  closing the "four identical scores." (Flow is not what re-anchored; this is noted here
  only because it removed the Phase-4 caveat above.)
- **Level collapsed to one coarse cue.** Phase 4 kept *reworded* level bands as location
  context. Phase 6 went further, on this doc's own logic: since bite quality is a
  rate-of-rise phenomenon ([S1]/[S2]/[S3]) already carried by `spike`/`clearing`, and
  absolute level only relocates fish *and* rides the non-climatological `normal`, the
  scaled level branches (`≥1.2×/≥1.4×/≤0.8×`) were replaced by a **single small, unscaled**
  location nudge — up → "bigger water (vs. recent flow): fish edges & seams"; low → "low
  water (vs. recent flow): downsize." Labeled "vs. recent flow" to keep the non-normal
  baseline honest. This is the rig-side completion of the same demotion §7c made on the
  bite side (where the static `≥1.5×→0.80` / `≥1.25×→0.90` penalties were already removed).

Net: on the rig side, **rate drives, level only locates**, consistent with the bite side.
See `05` §5a for the shipped rig-engine detail.

### 7e. Turbidity → feeding (why clarity matters to the fish)

The suppression side is well documented for salmonids: reactive distance decreases
curvilinearly with turbidity and the probability of reacting to a prey item falls with it;
in controlled work prey capture drops sharply from ~0 NTU to the tens-of-NTU range, with a
significant delay in response to prey by 20–60 NTU [S3]. Westslope cutthroat specifically
have long been regarded as sensitive to fine sediment [S3🏔]. This is the mechanism the
`spike` suppression stands in for.

---

## Assumptions

- Rise **rate** (not level, not cumulative rise) is the turbidity proxy; a fast rise
  muddies, a slow rise of equal magnitude may not [S1].
- The falling limb fishes cleaner than the rising limb at equal flow [S2]; a clean
  recession is a positive signal on its own, with no prior crest required.
- Self-relative thresholds (fractions of the river's own recent flow) are the right
  currency so small forks and big mainstems are scored on the same footing [S5].
- The specific numbers — 2-day spike window, +10%/+60% spike knees, 5%/30% drawdown
  knees, day-shape ramp, −55%/+25% ceilings — are calibration choices tuned against live
  `data.json`, not published constants [S4].

---

## The "normal" baseline — demoted to context

`computeNormal` (in `fetch-data.mjs`) is the **median of this-year + last-year daily
means**, not a climatological normal. On the live drainage it sits *between* this year's
post-runoff flows and last year's lower flows, so every gauge reads ~1.5–2× "normal"
during what is, by the calendar, an ordinary mid-July recession (runoff has typically
settled on the Bitterroot by mid-July [S6🏔]). Dividing a score by that number was
meaningless, which is the deeper reason the static level bands misfired.

Phase 4 therefore **demotes `ratio` to an informational context string only** (labeled
"× recent median", not "× normal"). Nothing in the bite score divides by it. This largely
**defuses** the true-climatological-normal storage question for the *bite* — self-relative
dynamics don't need a real normal.

**Open (data-architecture, raised not built this pass):** a genuine day-of-year
climatology would still improve the *context* line and any future level-aware feature. It
needs 2–3+ prior years pulled and persisted (repo JSON / Actions cache / external store),
against USGS IV and DNRC retention limits. Flagged for a later decision.

**Specced next — last-year as gradient, not magnitude (lead item for the next flow
pass).** Rather than use last year as a *level* ("normal"), use it as a **slope/shape**
reference: is the river ahead of or behind last year's recession at the *same calendar
date*, and receding faster or slower? That is honest, self-consistent information that
needs no invented normal, and it would sharpen the forecast/context. **Precondition:** it
requires each gauge's `lastYear` window to reliably overlap the same calendar dates as the
current window; last-year coverage is currently uneven across gauges (e.g. ~21 rows at
Bell, fewer elsewhere), so this must be verified gauge-by-gauge against live data before it
can be relied on — deferred here to keep this pass fully validated, not built half-tested.

**Also specced — hysteresis-aware turbidity signal (the real clarity upgrade).** Today
`spike` (rise rate) and `clearing` (falling-limb recession) are computed *separately* from
the same flow trace. The physically-honest next step is to make the clarity signal
explicitly **hysteresis-aware**: track position on the rising vs. falling limb *and* how
far the loose sediment supply has been exhausted through the event, so equal-discharge
days on the two limbs are scored differently by construction (clockwise Type-1 loop, the
basis already cited in [S1]/[S2]). This is what a real turbidity sensor would capture; in
its absence it is the best inference the flow trace supports. Deferred — it is a genuine
model addition (event-state tracking, not a threshold tweak), and it wants ground-truth
(shop turbidity/clarity reports, Phase 8) to calibrate against before it ships.

---

## Data lineage & fallbacks

| Input | Source | Fallback | Null behavior |
|-------|--------|----------|---------------|
| `cyFlow` today anchor | `series.flow.latest.value` | → last `thisYear[].mean` | `flowTrend` returns null; `flowAdj` = 1 |
| rise / drawdown | `series.flow.thisYear[]` daily means | (none) | short series → spike/clearing 0 |
| `ratio` (context only) | `flow / normal.flow` | (none) | ratio omitted from context string |

---

## Outputs

- `g._flowTrend = {spike, clearing, ratio}` — stashed for the block engine, the block
  captions, the "What's working now" context line, and the Tomorrow column.
- `flowAdj` per block inside `computeBlocks` → feeds `dayScore` and the bite bars.
- Dynamics-aware rig notes in `categoryScores` (no magnitude re-anchor — Phase 6).

---

## Status

**Live** off real conditions, `node --check` clean, validated headless against the live
`data.json` (all 8 gauges) plus synthetic rise/recession controls. Absolute-level scoring
is intentionally gone except the low-water × midday guardrail; as of **Phase 6** the rig
side matches — its scaled level bands are collapsed to one coarse location cue (§7d), and
`categoryScores` temperature magnitudes are re-anchored to `_bandFor` (`05`, `06`). The
last-year-gradient signal, the hysteresis-aware turbidity signal, and the
true-climatological-normal decision are specced above, not built this pass.

---

## Sources

- **[S1] Rate-of-rise mobilizes sediment (rising-limb shear stress / first flush)** —
  *cited.* Sediment-transport hysteresis literature: higher shear stress on the rising
  limb mobilizes bed sediment, with high, fast-rising peak flows producing the greatest
  mobilization; fast-rising hydrographs entrain sediment beyond classical thresholds.
  (Reviews & studies of storm-generated suspended-sediment concentration and
  discharge–sediment hysteresis, e.g. Gellis 2013; Hassan et al. 2023, *Water Resources
  Research*; Jing et al. 2025, *WRR* review.)
- **[S2] Clockwise hysteresis — falling limb cleaner than rising limb at equal flow** —
  *cited.* Suspended-sediment concentration on the rising limb exceeds that at equal
  discharge on the falling limb (first-flush + source exhaustion); concentration peaks
  before discharge. This is the physical basis for the "dropping & clearing = prime
  window" signal. (Same hysteresis literature as [S1]; clockwise/Type-1 loop is the most
  commonly reported pattern.)
- **[S3] Turbidity → reduced reactive distance & feeding in salmonids** — *cited.*
  Reactive distance decreases curvilinearly with turbidity and probability of reacting to
  prey falls with it (Sweka & Hartman 2001, *TAFS* 130; Barrett et al. 1992); prey capture
  drops from ~100% at 0 NTU with significant response delay by 20–60 NTU (Bash et al.
  2001, reviewed in USFWS sediment-effects syntheses). **Westslope cutthroat are regarded
  as sensitive to fine sediment** (Weaver & Fraley 1991, as compiled by the Montana
  Chapter, American Fisheries Society 🏔). *Note:* the reactive-distance work is
  brook-trout / other salmonids; read across to westslope cutthroat as a drift-feeding
  sight-feeder, not a cutthroat-specific measurement.
- **[S4] Self-relative thresholds, spike/clearing shapes, −55% / +25% ceilings** —
  *derived-in-repo / assumption.* Tuned against live `data.json` (8 gauges) and synthetic
  rise/recession controls; the crest-gate removal is a structural fix verified against the
  dead-signal observation. Magnitudes are calibration choices, not published constants.
- **[S5] Stage vs. cfs scale differently by stream size → keep signals self-relative** —
  *derived-in-repo.* The gauge's own flow→stage rating (`fitRating`, `stage ≈ a + b·√flow`)
  is non-linear and stream-size dependent; self-relative fractions avoid any absolute cfs
  threshold that would mean different things on a small fork vs. a big mainstem.
- **[S6] Bitterroot mid-July runoff has typically settled** — *cited* (context only).
  Regional angling/seasonal characterization of the Bitterroot drainage 🏔; supports that
  the observed multi-day recession is the ordinary seasonal pattern, not an anomaly.
