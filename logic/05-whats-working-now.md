<!-- version: 05-whats-working-now-6-1.md -->
# 05 · What to Use Now (Seasonal vs. Calculated Picks)

*Phase 6 rewrite. The category-scoring engine (`categoryScores`) was re-anchored to
the same westslope-cutthroat response authority the bite engine uses (`_bandFor`),
replacing its old parallel temperature step-bands — the root cause of the "four
identical scores." The flow block was simultaneously re-grounded: level demoted to a
coarse location cue, dynamics (rate-of-rise) left as the bite signal. The fly-table
machinery (§5b/5c) is unchanged. A new §Appendix records **Option C** — the deferred
full-rebuild alternative — and the fish-vs-bugs reasoning that selected the shipped
approach.*

For each of four categories — dry, nymph, dry-dropper, streamer — the dashboard
shows up to four flies: two **seasonal** picks (from the month's hatch tables) and
two **calculated** picks (from live conditions), each a specific pattern + size +
color. It also scores the four categories so the strongest one "now" is flagged.

---

## What it is

Four category cells. Each shows a live score and "best now" flag, two seasonal
picks above a divider, two calculated picks below — each row with tag, pattern,
`#size`, color swatches, a short reason, and a "matches seasonal" flag where the
two engines agree.

---

## Inputs

- The same conditions as `03`: water temp, flow, `flowRatio`, cloud %, precip proxy,
  plus the gauge's `flowTrend` (`spike`/`clearing`) from `07`.
- `CUR_MONTH` (UI constant) — which insects are in season.
- Authored tables: `HATCH_CALENDAR`, `HATCH_FLY`, per-gauge `rig`, `SEARCH_FLY`,
  `UNIVERSAL`, `FLY_COLORS`.

---

## Logic / calculation

### 5a. Category scoring — `categoryScores` (via `liveConditions`)

`liveConditions(g)` packages the gauge's live readings into a conditions object;
`categoryScores` accumulates points per category. As of Phase 6 the temperature term
and the flow term were both rebuilt:

#### Temperature (primary weight) — now continuous, re-anchored to `_bandFor`

**Before (retired):** a seven-step `if/else` on raw temp (`<40 / <50 / <60 / <68 /
<73 / <77 / >=77`), each bucket adding fixed integer weights per category. This was a
*second, parallel* temperature model, independent of `_bandFor` (the literature-locked
cutthroat curve the bite engine already used). Two consequences, both live-observed:
(1) every gauge whose temp fell in one bucket returned an **identical** category
vector regardless of its real temperature; (2) the 55–59 °F "prime" plateau — where
Bitterroot gauges cluster in summer — collapsed four measured gauges (56.1 / 56.4 /
57.5 / 59.6 °F) onto one byte-identical score. That is the "four identical scores."

**After (shipped, `-6-1`):** the temperature term reads `_bandFor(t)` — the **same**
response authority as the bite engine — and uses **both** of its outputs:

- `mult` (feeding drive, 0.06–0.88, peak across the 55–59 °F optimum) sets the total
  temperature **activity budget** (`BUDGET = 160 · mult`; ~141 at prime, falling as
  `mult` falls) and the surface (dry/dd) drive.
- `heat` (thermal-stress index, monotonic upward) tilts category **share** from
  surface (dry/dd) toward subsurface (nymph/streamer) as water warms.
- a **cold ramp** (`cold = clamp01((50 − t)/10)`, 1 at ≤40 °F, 0 at ≥50 °F) supplies
  the cold-water subsurface tilt that low `mult` alone can't distinguish from hot
  (both cold and hot water have low `mult`; `heat` and `cold` disambiguate direction).

Category shares before normalization:

```
dry      = (1 − hs)·(1 − cold)
dd       = (1 − 0.75·hs)·(1 − 0.8·cold)      // hopper-dropper more heat-robust than a bare dry
nymph    = 0.42 + 0.75·cold + 0.75·hs        // all-purpose subsurface: strong cold AND warm
streamer = 0.34 + 0.5·cold + 0.45·hs
```

where `hs` is a **soft** heat-to-suppression ramp:

```
hs = heat ≤ 0.42 ?  (heat / 0.42)·0.12
                 :  0.12 + ((heat − 0.42)/0.58)·0.88
```

The shares are normalized to sum 1 and multiplied by `BUDGET`, then rounded and
floored at 0.

**Why the soft ramp (a design record, not just a constant).** An earlier draft used a
*hard* knee — `hs = max(0, (heat − 0.42)/0.58)` — chosen to protect the prime band
from premature subsurface tilt. But it zeroed **all** heat signal below 0.42, which is
exactly where the plateau gauges live (heat 0.30–0.36), so it re-collapsed them to an
identical vector — the same bug, relocated. The soft ramp lets a *gentle* heat signal
through below 0.42 (so 56 °F and 57.5 °F differ **slightly**, as they biologically
should — both are prime, so they *should* score nearly, not exactly, the same) and
ramps steeply above it where real thermal stress begins. Live result: the four-way
measured-gauge tie is fully broken; each measured gauge returns a distinct vector, and
Missoula (66.2 °F, heat 0.73) correctly leads with nymph.

**Invariants held (verified byte-identical):** no new threshold constants were added;
all pre-73 feeding degradation remains **entirely** inside `_bandFor`'s continuous
curve; the two load-bearing `66`s (the HEAT anchor and the `t≥66` crepuscular hinge)
and `HOOT_OWL_F = 73` / `STRESS_RED_F = 70` are untouched. `_bandFor`'s `MULT`/`HEAT`
tables were **not** edited — the rig engine now *reads* the same curve; it does not
redefine it. See `06` for the curve itself.

The `t == null` branch is unchanged (fixed fallback favoring nymph). It is dead code
on any gauge with a resolved temp; making estimated-gauge temps non-null is **Phase 3**
territory, not Phase 6. Two `null`-temp estimated gauges will still share the fallback
vector until then — expected, not a Phase-6 defect.

#### Flow — dynamics drive the bite; level is only location context

**Before (retired):** the level branch applied *scaled* penalties by `flowRatio`
(`≥1.4× → streamer +16 …`, `≥1.2× → …`), on top of the `spike`/`clearing` dynamics.

**After (shipped, `-6-1`), science-grounded:** the turbidity/reactive-distance and
rising-limb hysteresis literature (see Sources; documented in `07`) establishes that
bite suppression from off-color water is a **rate-of-rise** phenomenon — first-flush
sediment peaks on the *rising limb*, before the discharge peak, so at equal cfs the
same water can be muddy rising and clear falling. That rate signal is already carried
by `flowTrend.spike` (rise) and `flowTrend.clearing` (falling-limb rebound), which are
**unchanged from Phase 4**. Absolute **level** (`flowRatio`) does *not* track clarity
or bite quality — it only **relocates** fish (up → edges/seams/bigger profile; low →
downsize). It also rides a **non-climatological** `normal` (≈ recent-flow median), a
further reason not to scale it. So the scaled level branches were replaced with a
single small, coarse, **unscaled** location nudge:

```
spike ≥ 0.35     → rising/off-color: push streamer, trim surface     (unchanged)
clearing ≥ 0.3   → dropping & clearing: prime seams window           (unchanged)
flowRatio ≥ 1.2  → bigger water (vs. recent flow): edges & seams      (coarse nudge)
flowRatio ≤ 0.8  → low water (vs. recent flow): downsize              (coarse nudge)
```

The high and low branches are labeled "vs. recent flow" to keep the non-normal
baseline honest to the reader. **Future (`07`):** a turbidity- or rate-aware signal
carrying the rising/falling-limb (hysteresis) asymmetry is the real upgrade — flagged,
not built this pass.

#### Light and precip

Unchanged: overcast (≥65%) lifts dries/emergers; bright sun (≤20%) pushes deeper nymph
and bank terrestrials; wet/rising precip adds to streamer and nymph.

Scores clamp at zero. The top category is "best now"; each meter is the score as a
percentage of the max. Same engine shape as `computeBlocks` — point it at the snapshot
(today) or any forecast day's conditions object.

### 5b. Seasonal picks — `seasonalPicks`

*(Unchanged in Phase 6.)* Calendar-driven. `hatchesForMonth(m)` filters
`HATCH_CALENDAR` to in-season insects (ordered chronologically, most-specific-first).
For the category, walk those hatches, look each up in `HATCH_FLY` for a concrete
pattern, take the first two. If fewer than two, top up from the gauge's `rig`, then
`UNIVERSAL`. Result: two flies tagged with the insect they imitate.

### 5c. Calculated picks — `calcPicks`

*(Unchanged in Phase 6.)* Same candidate pool (this month's hatch flies + gauge rig +
a search pattern + universal), de-duplicated, but **ranked by fit to live readings**:
size bias (high/cold → bigger; clear/low → smaller), color/pattern bias (overcast →
mayfly imitations on top; bright sun → flashy subsurface), and an in-season bonus. Top
two become calc pri/alt, each tagged with a live reason; a calc pick that coincides
with a seasonal pick is flagged "matches seasonal."

### How a specific pattern / size / color is chosen

*(Unchanged.)* **Pattern** — lookup, never invented (`HATCH_FLY` → gauge `rig` →
`SEARCH_FLY` → `UNIVERSAL`). **Size** — a hook range on each fly entry; the ranker
parses the smallest hook for its bias; the displayed size is the stated range.
**Color** — a fixed named list per fly, mapped through `FLY_COLORS`. Authored, not
computed.

---

## Assumptions

- Seasonal answers "what's hatching this month here"; calculated answers "what do
  today's water and light favor." Agreement between them is a confidence signal.
- Hatch calendar and per-gauge rigs encode local Bitterroot knowledge; the scoring
  rules encode general trout science. **The engine selects and ranks; it never
  generates a fly.**
- **Temperature governs *how and where* fish feed; the hatch tables govern *what* they
  eat.** The re-anchored temperature term is a fish-physiology signal (surface vs.
  subsurface, aggressive vs. sluggish). It carries **no** entomological resolution —
  which taxon, which life stage — by design. That lives entirely in §5b/5c. (See the
  Appendix for why this separation was kept.)

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain → null behavior |
|-------|---------------|-------------------------------|
| Water temp | `series.watertemp.latest` | → today's mean → `normal.watertemp` → null → `t==null` fixed nymph-default branch |
| Flow / `flowRatio` | `series.flow.latest ÷ normal.flow` | → today's mean; `normal.flow` missing → ratio 1.0 |
| Flow dynamics | `g._flowTrend.spike` / `.clearing` (`07`) | absent → 0 (no dynamics term; level nudge only) |
| Cloud | `weather.hourly[].cloudPct` daytime avg | absent → 40% |
| Precip proxy | `weather.daily[].precipIn` | → 0% |
| In-season insects | `CUR_MONTH` filtering `HATCH_CALENDAR` | month is a constant, not `data.json today` |
| Pattern / Size / Color | authored tables | authored — never from `data.json` |
| Future day | that day's conditions object (`fcTemp/fcFlow`, hourly cloud, daily precip) | same chains as today |

---

## Outputs

- Four category scores + meters, "best now" flag on the top.
- Per category: two seasonal + two calculated flies, each with pattern, size,
  color swatches, reason, and "matches seasonal" where they agree.
- Leaf presentation step — no downstream consumer.

Scoring and ranking are **data-driven** (live or forecast conditions); the flies
themselves come entirely from **authored tables.** The engine selects and orders; it
never generates a fly.

---

## Status

**Phase 6 complete.** Category scoring is data-driven and live, re-anchored to the
cutthroat response curve shared with the bite engine, and re-grounded on flow. The
"four identical scores" symptom is resolved at the assembly level on all measured
gauges. This flips Phase 1 (response curve) from PROVISIONAL to fully done. Fly tables
remain authored and static by design (patterns are Phase 7). Score *magnitudes* are
now anchored to the same `_bandFor` authority as the bite engine; final ground-truth
re-calibration against fly-shop reports is Phase 8.

---

## Appendix · Option C (deferred) — the full continuous rebuild

*Phase 6 considered and deliberately did **not** take a broader alternative. This
appendix preserves its design and the reasoning that selected the shipped approach, so
a future phase (candidate: a dedicated scoring-model phase, or Phase 9 consolidation)
can pick it up without re-deriving it.*

### What Option C was

Discard `categoryScores`'s additive point system (independent temp + flow + light +
precip blocks) and rebuild all four category scores as **continuous functions of the
full driver set** `(mult, heat, flowRatio, spike/clearing, cloud)`, tuned so the top
category's meter reproduces the fly-shop "Good ≈ 7–8" anchor directly.

### Why it was attractive

- Cleanest end state: rig and bite engines sharing a scoring *philosophy*, not just the
  temperature authority — the Phase 9 IP-consolidation target.
- Lets thermal state, light, and flow **compound** continuously instead of adding as
  independent blocks (a warm day *and* bright sky both push fish down; an additive
  model understates the combined effect).
- Removes the last hand-tuned magic numbers.

### Why it was deferred (not rejected)

- **Scope.** The Phase 6 brief was "re-anchor the engines + ratio-aware flow," not a
  model rebuild with new scoring philosophy — arguably Phase 9 work.
- **Blast radius.** Every category's order on every gauge shifts; a much larger
  validation surface than a targeted re-anchor.
- **Attribution.** More of C is assumption-tier (tuned), harder to trace than "read the
  same two curves the bite engine already trusts."

### The fish-vs-bugs finding that settled B over C

`categoryScores` ranks four **presentation methods**. A method's rank depends on two
**independent** biological facts:

1. **Where/how the fish feed** (surface vs. subsurface, aggressive vs. sluggish) — a
   **fish-physiology** question. Encoded by `mult` and `heat`.
2. **What's available and in what life stage** (taxa, nymph vs. dun vs. spinner) — an
   **insect** question. Encoded **entirely** in a separate subsystem (`HATCH_CALENDAR`,
   `HATCH_FLY`, `seasonalPicks`, `hatchesForMonth`; §5b/5c).

`mult` and `heat` encode **only** the fish side. Therefore Option C's extra continuous
machinery is **all** on the fish/hydrology axis — it adds **no** entomological
resolution, because the bug reasoning is a different engine, correctly kept separate. C
would bolt a more elaborate fish model onto the same bug-blind temperature read, with a
specific failure mode: a more-confident-looking dry/dd/nymph ranking that is still
driven only by fish thermal state, dressed in enough numerical sophistication to *look*
like it reasons about hatches when it does not — subtly **less** defensible.

The shipped approach (Option B) is more modest and therefore more honest: temperature
tells us how aggressively and how near the surface the fish feed; the hatch tables tell
us what to tie on. Two biological domains, two subsystems that actually encode each.

**Verdict:** on fish physiology, B and C are both defensible (C a hair more realistic
on thermal×light×flow compounding, deferred by scope). On **insects** they are
**identical** — both leave bug reasoning to the hatch subsystem. So "more defensible for
the bugs" does not distinguish them, and any impression that C reasons better about
hatches would be false.

### One real coupling neither B nor C captures (logged for Phase 7)

Warm water legitimately shifts hatch **timing** (compresses emergence into cooler
hours) and can favor certain taxa — a genuine temperature→insect coupling. It belongs
in the hatch/timing subsystem (candidate Phase 7), **not** smuggled into
`categoryScores` under either B or C.

### If a future phase builds C

Make it its own phase, after B is live and Phase 8 shop-reports give ground-truth to
calibrate the continuous meter against "Good ≈ 7–8." Keep the fish/bug separation
intact — C is a fish-side model; do not let it absorb hatch reasoning. Carry the
thermal→hatch-timing coupling as a separate insect-engine item.

---

## Sources

- **[S1] Westslope-cutthroat thermal response curve (`_bandFor`)** — *cited*, via `06`.
  Optimum 13–15 °C / 55–59 °F and chronic upper-incipient-lethal ~19.6 °C / 67 °F:
  **Bear, McMahon & Zale 2007**, *Trans. Am. Fish. Soc.* 136:1113 (MSU/USGS Montana
  Cooperative Fishery Research Unit 🏔). Aerobic-scope peak ~15 °C and acute-lethal
  ~25 °C / 77 °F: **Macnaughton et al. 2021**. The rig engine reads this curve; it does
  not redefine it.
- **[S2] `mult` + `heat` as the category-scoring drivers, and the `hs` soft ramp,
  cold ramp, and share coefficients** — *derived-in-repo*. The decision to drive method
  ranking from feeding-drive + thermal-stress is grounded in [S1]/[S3]; the specific
  coefficients and the 0.42 soft-ramp knee are tuned against the old engine's rank
  order and the "Good ≈ 7–8" anchor, verified headless on the live 8 gauges.
- **[S3] Warm-water behavioral shift (surface → subsurface / crepuscular refuge)** —
  *cited direction, derived magnitude*. Thermal stress reduces surface feeding and
  shifts activity to cooler microhabitats and low-light windows: general salmonid
  thermal-behavior literature; regional support in **Bell et al. 2021** (University of
  Montana, *Science Advances* 🏔) on thermal-refuge use. Magnitudes derived-in-repo.
- **[S4] Flow: rate-of-rise, not level, drives clarity/bite** — *cited*. Reactive
  distance of drift-feeding salmonids decreases with turbidity, cutthroat-specific:
  **USFS (Rosenfeld/Bahn-type) benthic-feeding-under-turbidity lab study** (cutthroat
  fed at ~70% of clear-water success at 100 NTU, ~0 at 400 NTU); **Sweka & Hartman 2001**,
  *Trans. Am. Fish. Soc.* 130:138 (reactive distance ↓ curvilinearly with turbidity);
  **Barrett, Grossman & Rosenfeld 1992**, TAFS 121:437. Rising-limb first-flush (sediment
  peaks before discharge peak; clockwise turbidity–discharge hysteresis): suspended-
  sediment hysteresis literature (Williams 1989; Gellis 2013). Discharge *change* affects
  invertebrate drift more than absolute level: **hydropeaking drift study**, *CJFAS*
  (drift biomass peaks on the rising limb, proportional to peak magnitude).
- **[S5] `normal` is a recent-flow median, not a climatology** — *derived-in-repo*
  (`fetch-data.mjs computeNormal`: median of this+last-year daily means; last-year window
  often empty past USGS retention). The level nudge is labeled "vs. recent flow"
  accordingly; a true day-of-year climatology is the catalogued upgrade.
