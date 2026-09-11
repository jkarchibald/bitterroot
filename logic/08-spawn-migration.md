<!-- version: 08-spawn-migration-1-0.md -->
# 08 — Spawn migration

*New doc — design-complete for §1, not yet implemented in `index.html` or
`fetch-data.mjs`. Deliberately **one file covering multiple life histories**,
the same choice `06` makes for multi-species thermal response, and for the
same reason: fall brown trout and spring rainbow/cutthroat migration are
driven by **opposite-direction** mechanisms (declining vs. rising temperature;
flow absent vs. primary driver), so splitting into separate files risks one
being quietly copy-pasted onto the other. §1 (fall brown trout) is fully
specced and cited below. §8 (spring rainbow/cutthroat) is an intentional
placeholder — do not derive it from §1 without its own literature pass.
Citations follow the `06`/BUILD_TRACKER standing convention (cited /
derived-in-repo / assumption), with Montana / regional sources preferred
where they exist (flagged 🏔).*

Life-history scope: **§1 covers brown trout only** (fall, tributary-bound
spawning migration). Rainbow and westslope cutthroat are spring spawners with
a reversed trigger mechanism — see §8. Whether rainbow and cutthroat can share
one model is unconfirmed; do not assume it.

## 1. What it is

A per-tributary-system status — `{tier, phase}` shown as one badge (e.g.
"Watch · Staging"), plus a 7-day forward outlook line — for each independent
tributary system, live during the fall window (roughly September–November).
Not a 0–10 score like the bite engine (`03`); this is a state/phase read.

Two independent systems, each scored separately, no shared state between them:

| System | Tributary gauge(s) | Mainstem anchor(s) |
|---|---|---|
| East Fork | `ef-connor` | `darby`, `bell` |
| Lolo Creek | `lolo`, `lolo-hwy93` | `msla` |

**Both West Fork gauges (`wf-painted`, `wf-conner`) are excluded** —
`wf-conner` is a dam-controlled tailwater holding flat ~48°F year-round with
no seasonal signal; `wf-painted` was dropped alongside it to avoid a partial
West Fork presence in this feature specifically. This exclusion is scoped to
spawn migration only — it does not change how West Fork is treated elsewhere
(bite engine, rig ranking).

Gauge-role assignment lives in this feature's own config, not as a new field
on the shared gauge objects in `data.json` — keeps feature-specific meaning
out of infrastructure other code reads.

## 2. Inputs

- `series.watertemp.thisYear[]` — tributary gauge and mainstem anchor(s),
  daily `{date, min, max, mean, n}`
- `series.watertemp.forecast[]` — same gauges, ≤7 days used (`FORECAST_DAYS`
  already caps this in `fetch-data.mjs`)
- `series.watertemp.latest` — current instantaneous reading, display only
- `normal.watertemp` — seasonal baseline, contextual only, not a trigger input
- `series.flow.*` — **not used in §1**; see §4 (flow-direction note)

## 3. Logic / calculation

### 3a. Trigger 1 — leaving the mainstem (drives tier only, not phase)

Comparative, not absolute: `gradient = mainstemAnchorTemp − tributaryTemp`.
"Present" when the tributary is colder than its mainstem anchor; "widening"
when that gap has grown over the trailing multi-day window. A tributary can
show gradient-present-and-widening well before it reaches the range in §3b —
this moves **tier** from Quiet toward Watch, and only tier. The mainstem's
own absolute trend carries no independent meaning here; only the difference
matters ([S6]).

### 3b. Trigger 2 — phase, once inside the tributary

Read entirely off the tributary gauge's own trend-shape once temp is at or
near the **43–48°F range** ([S1], [S2]) — the mainstem plays no further role
once this trigger is being evaluated:

- **Staging** — temp falling *through* 43–48°F
- **Spawning** — temp **plateaus** within the range for multiple consecutive
  days — inferred from the spawning act's documented multi-day duration
  ([S5]), a proxy, not a direct observation
- **Dropback** — decline resumes and continues *past* 43°F after the plateau

Trend-shape is a **slope/variability threshold** computed from the existing
daily `thisYear` array — not a fixed day-count. *[assumption, pending
shop-report calibration — see §4.]*

### 3c. Tier × phase combination

Deliberately a **simple, HSI-style rule** ([S1] itself is structured this
way — combinable suitability curves, not regression weights), not a
weighted/fitted model. A weighted model becomes a real option once
`calibration/shop-reports.json` carries enough paired staging/spawning
mentions to fit against — assigning weights before that exists would be
false precision, the same failure mode `06` §6 already flagged for the
dropped flow-scaling branch.

### 3d. 7-day outlook

Same classifier, run across each forecast day (≤7). Reports the first
transition, if any:

| Transition | String | Bias |
|---|---|---|
| *(none)* | `"Remains [current state] through 7 days"` (dynamic) | — |
| Quiet → Watch | `"Entering Watch ~[Day]"` | 1°F early |
| Watch → Staging | `"Staging possible ~[Day]"` | 1°F early |
| Staging → Spawning | `"Spawning possible ~[Day]"` | 1°F early |
| Spawning → Dropback | `"Dropback possible ~[Day]"` | 1°F late |
| Dropback → Quiet | `"Returning to Quiet ~[Day]"` | 1°F late |

Bias is asymmetric on purpose: the three "more active" transitions fire a
degree early (missing a real window costs more than an early false flag);
the two "winding down" transitions require a degree of overshoot (calling it
over too soon is the worse failure there). Staging → Spawning is hedged
("possible"), not a hard crossing — a plateau's onset can't be forecast the
way a threshold crossing can.

The outlook only **confirms/extends an already-real historical trend**; it
cannot originate a transition from a forecast-only blip — same principle as
`TERMINAL_GUARD` in `fetch-data.mjs` and the flow forecast's
anchored-to-latest-reading behavior. This is a fourth, complementary
guardrail layered on those, addressing genuine-but-short-lived swings rather
than bad input data.

## 4. Assumptions

- **43–48°F range is an assumption pending local calibration** — built from
  out-of-region US sources ([S1], [S2]); no Montana or Rockies-region study
  surfaced a fitted numeric threshold. Local sources confirm *timing*
  (October–early November, [S3]) and *drainage location* ([S10] in `06`,
  West Fork below Painted Rocks specifically), not a temperature figure.
- **Flow is deliberately not a fall trigger** ([S7]). The "rising flow
  facilitates migration" literature comes from rain-pulse-driven river
  systems; the Bitterroot's actual September hydrograph (verified directly
  against `data.json`) is a steady seasonal decline — irrigation-diversion
  return, not a rain pulse. Flow is reserved as a primary, dual-edged driver
  for §8.
- Spawning-phase inference (§3b) is a proxy; a shop report explicitly
  describing staged/spawning fish should override it once available.
- A gauge missing `type` must not silently default into freestone/mainstem
  behavior. This feature's curated gauge list mostly sidesteps the risk, but
  any gauge added later to §1's role table should have `type` /
  `meta.measuredTemp` validated first.

## 5. Data lineage & fallbacks

| Input | Primary source | Fallback chain (in order) | Null behavior |
|---|---|---|---|
| Tributary watertemp (current) | `series.watertemp.latest` | → today's `thisYear[].mean` | System suppressed (no badge) rather than guessed |
| Mainstem watertemp (current) | `series.watertemp.latest` | → today's `thisYear[].mean` | Gradient trigger suppressed; phase-only read continues if tributary data is present |
| Tributary watertemp (trend) | `series.watertemp.thisYear[]`, trailing days | none — <3 days of history present disables trend-shape | Phase held at last-known state, or Quiet if no prior state |
| Tributary watertemp (forecast) | `series.watertemp.forecast[]` | none | Outlook line reads "Outlook unavailable" rather than guessed |
| Gauge-role assignment | feature-local config, not `data.json` | none | n/a — static, code-level, not a runtime fallback |

## 6. Outputs

Per system: `{tier, phase, outlookString}`. Consumed by a new spawn-watch UI
card (not yet built — see `09-*` build steps once scoped).

## 7. Status

**Design-only.** No code exists yet in `index.html` or `fetch-data.mjs`. All
inputs already exist in `data.json` — implementation requires new scoring
logic only, no new fetching or pipeline changes.

## 8. Spring rainbow / cutthroat — placeholder

**Not yet built.** Known from §1's design process, to avoid re-deriving from
scratch:

- Trigger direction flips: **rising** temp and **rising** flow (snowmelt),
  the seasonal norm here, unlike fall's decline
- Flow is a **primary, dual-edged** driver here — facilitates migration but
  can also scour redds if it overshoots; needs its own threshold logic, not
  an extension of §3a's gradient concept
- Whether rainbow and cutthroat share one model is unconfirmed — check
  whether their trigger windows actually overlap on the Bitterroot before
  assuming a shared mechanism
- `fetch-data.mjs` already has cutthroat-curve rig-engine work (`-6-1`:
  "re-anchor rig engine to cutthroat curve") — check before assuming no
  groundwork exists

## 9. Still open

- Implementation in `index.html` — not started
- Weighted scoring model (§3c) — deferred until `calibration/shop-reports.json`
  has enough paired observations
- §8 (spring) — needs its own literature pass, not started
- Backward transitions below Watch (gradient stalling/closing) — not
  designed; currently falls into the generic "no transition" case

## 10. Sources

Convention (standing rule, matches `06` §7): every logic assumption points to
a cited source where a published one exists; Montana / regional sources
preferred where they exist (flagged 🏔). Repo-computed values are
**derived-in-repo**; genuine judgement calls are **assumption**.

Cited science:
- **[S1] Onset trigger, 43–45°F (6–7°C).** USFWS Habitat Suitability Index
  model for brown trout: "Fall spawning migrations begin at water
  temperatures of 6 to 7°C," citing Frost & Brown 1967 and Needham 1969, in
  combination with decreasing day length and late-fall flow changes. (§3b)
- **[S2] Spawning-optimum range, 44–48°F.** Vermont Fish & Wildlife:
  "Spawning typically occurs from late October through December, when water
  temperatures reach an optimum range of 44°F to 48°F." Corroborated
  independently by Shenandoah National Park (NPS): onset of spawning at
  6.5–9°C (44–48°F). (§3b)
- **[S5] Spawning-act duration, days not weeks.** Vermont F&W: redd
  construction "takes several days." Tennessee state fisheries biologist
  (Habera), quoted directly: "the spawning process itself can take a few
  hours or a few days" per redd, often repeated across "several redds" by
  one female. Basis for reading a plateau, not a single-day touch, as the
  spawning-phase signal. (§3b)

Montana / regional (local support) 🏔:
- **[S3] Local timing, October onset.** Montana FWP Bitterroot drainage
  electrofishing report notes brown trout "may be migrating by October,"
  biasing fall population estimates — a direct Bitterroot-specific field
  observation. (§4)
- **[S4] Local phenology anchor, early-November fall movement.** USFS
  radiotelemetry study inside the Bitterroot drainage itself (Meadow Creek /
  Daly Creek headwaters): fall downstream movement in cutthroat and bull
  trout triggered by declining temperature, onset early November at one
  site, ~6 weeks later at a second due to differing ice/stream character.
  Different species from brown trout, closest available geographic match —
  used for timing corroboration only, not the temperature figure. (§4)

Derived-in-repo (method above; not cited to a paper):
- **[S6] Gradient/thermal-refuge mechanism as tier-only trigger.** No source
  fits a numeric threshold to "how much colder, for how long, constitutes a
  real draw" — engineering judgment built on the general facilitator role of
  a cooler refuge, flagged for recalibration once local shop-report data
  exists. (§3a)
- **[S7] Flow excluded as a fall trigger.** Verified directly against
  `data.json`: every active gauge showed a steady September flow decline
  (irrigation-return recession), not a rise. The "rising flow facilitates
  migration" literature is drawn from rain-pulse-driven systems and does not
  describe the Bitterroot's actual fall hydrograph. (§4)

Assumptions (judgement calls, flagged as such):
- Species governance: this doc covers brown trout only in §1; no shared
  curve with rainbow/cutthroat is assumed (§8 is separate and unconfirmed).
- Spawning-phase inference is a temperature/duration proxy, not a
  confirmed observation, and is explicitly subordinate to shop-report text
  once available (§4).
