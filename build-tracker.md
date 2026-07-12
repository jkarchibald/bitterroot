<!-- version: build-tracker-18.md -->

# Bitterroot Dashboard — Build Tracker

Global counter: **18**. Living document. Each phase entry carries its outcome,
validation surface, deliverables, and the upload set required to start the next
phase.

---

## Phase 7 — calcPicks fine-tune + independent per-gauge rigs — **COMPLETE**

Two independent parts, one file (`index.html`), two commits.

### Part A — calcPicks reads flow dynamics (was level-blind)

**Symptom (owner):** calc picks said "high water → bigger" on gauges that were
actually dropping and clearing.

**Root cause (traced on live `data.json`, 2026-07-12, all 8 gauges):**
`calcPicks` received its conditions from `liveConditions`, which returned only
`{temp, flow, flowRatio, cloud, precipPct}` — no `spike`/`clearing`. Those lived
on `g._flowTrend`, read separately by `categoryScores`. So calc sized flies off
LEVEL alone (`ratio>=1.25` → "high water → bigger") through its own private
step-buckets, blind to dynamics. On the live snapshot the whole drainage was in a
clearing recession (`spike=0` everywhere; `clearing` 0.4–0.75 on 5 of 8 gauges) at
high level (ratio 1.2–2.05×), so calc read the high level and upsized on every
gauge — the exact opposite of what the dynamics (and `categoryScores`, which reads
`_flowTrend`) said. Same level-vs-dynamics confusion Phase 6 fixed in
`categoryScores`, one layer down in the picks.

**Fix:**
1. **Wiring — extend `liveConditions`** to carry `spike`/`clearing` from
   `g._flowTrend`, so one conditions object feeds both the score engine and the
   calc picks. Chosen over passing `g._flowTrend` separately into `calcPicks`
   because that would re-introduce the two-source split that caused the bug and
   break the plain-conditions-object contract (`computeBlocks`/`categoryScores`
   take a plain object, never gauge `g`).
2. **Logic — replace calc's private level buckets** with the same dynamics-first
   continuous read as `categoryScores` (same branch order, same thresholds, **no
   new constants**): `spike>=0.35` → bigger/darker (streamer bias); `clearing>=0.3`
   → downsize, seam dries; level (`>=1.2` / `<=0.8`) only as coarse location context
   ("bigger water → fish edges & seams"), never a size penalty.
3. **Reason string** rewritten to the score engine's language so a pick's reason
   can never contradict its score.
4. **TODAY-ONLY** — no forecast horizon, no separate RT source.

**Validation:** `node --check` on full inline script; edited `calcPicks` +
`liveConditions` run headless against live `data.json`, all 8 gauges × 4
categories, before/after shown. **13/32 primary flies changed**, all
correct-direction; **zero gauges still read "high water → bigger."** Clearing
gauges now downsize (Golden Stimulator → Yellow Sally, Golden Stone Nymph →
Drowned Ant); the 3 genuinely-flat high gauges keep their flies and take the mild
location note.

**Scope guards honored:** `categoryScores`, `_bandFor`, the two 66s,
`HOOT_OWL_F`/`STRESS_RED_F`, the welfare ceiling, `hatchesForMonth` all untouched.
Phase 6 remains closed.

**Deliverable:** `index-7-1.html` (commits as `index.html`), `commit-7-1.txt`.

### Part B — independent per-gauge rigs

**Confirmed placeholder:** two duplicate rig groups existed — the three mainstem
gauges (darby, bell, msla) were byte-identical Bell copies (owed since Phase 3),
and the two Lolo Creek gauges (lolo, lolo-hwy93) were also byte-identical to each
other.

**Fix:** every gauge now carries its own rig, authored to that gauge's live
character. Patterns/sizes/colors **derived from the repo's own local knowledge**
(`HATCH_FLY` + the existing sanctioned gauge rigs) — not invented. No engine
change; tables only. Colors map through `FLY_COLORS`.

Per-gauge character:
- **lolo** (upper Lolo, ~56 °F cold small creek): tighter cold-creek attractors,
  PT-led nymphs, smaller Bugger/Muddler.
- **lolo-hwy93** (lower Lolo, ~59 °F, bigger near mouth): caddis/early-hopper
  forward, Rubber Legs + Prince, meatier Bugger.
- **darby** (upper mainstem, ~56 °F, browns + rainbow): brown streamer game
  (Sculpzilla, brown Bugger), Chubby up top, Pat's Rubber Legs.
- **msla** (lowest mainstem, ~66 °F warmest, rainbow/brown): hopper-forward,
  San Juan for off-color, meatiest #4–6 streamers.
- **bell** unchanged (already fits the middle mainstem).
- **wf-painted, ef-connor, wf-conner** unchanged (already location-authored).

**Validation:** `node --check` passes; all 8 rigs re-hashed → **zero duplicates**
(previously two dup groups); every color across all rigs resolves in `FLY_COLORS`.

**Scope note — logged:** differentiating the two Lolo gauges is **beyond the Phase
7 prompt's stated triplet scope.** Done at owner request for one-gauge-one-rig
independence (upper Lolo ~56 °F vs. lower ~59 °F — a real but small gap). Recorded
here as an owner-requested addition, not silent scope drift.

**Refinement path:** these rigs are derived-from-hatch-table starting points.
Fly-shop ground truth (`calibration/shop-reports.md`) plus summer/fall field use
will refine them. Not a placeholder anymore, but not yet locally-verified truth.

**Deliverable:** `index-7-2.html` (commits as `index.html`), `commit-7-2.txt`.

### Design clarification (recorded for future reference)

The `rig` is an **authored menu** per gauge; `calcPicks` is a **condition-driven
selector** over a pool of {this month's hatch flies + that gauge's rig + search +
universal}, scoring each candidate on live water and emitting one pri/alt pair.
Part B made the menus independent; Part A made the selector read dynamics. The rig
strings are static; the *selection over them* is live — proven by the A/B trace
where the same static rig produced different picks after the dynamics fix.

---

## Phase 7 doc audit

| Logic file | Touched by | Audit action | Status |
|-----------|-----------|--------------|--------|
| `05-whats-working-now` | Part A (`calcPicks`), Part B (rigs) | rewrite §5c to dynamics-first; update §5b rig note, Data-lineage, Status; close the §293 "one real coupling logged for Phase 7" | **done (`05-7-1`)** |
| `07-flow` | — (calc now reuses 07's spike/clearing) | add cross-ref: calc consumes `flowTrend` via `liveConditions` (intro note, §7d addition, Outputs, Status) | **done (`07-7-1`)** |
| `06-thermal…` | untouched | none (scope-guarded) | n/a |

**Decision — calc engine documentation:** calc stays documented **in 05** (§5c),
cross-referenced to `07` for the flow-dynamics logic it now reuses, rather than
spawning its own logic doc. Rationale: post-Phase-7 `calcPicks` mirrors
`categoryScores`' flow branch exactly (same thresholds, same order); a separate doc
would duplicate 05 §5a's flow discussion and 07's source-grounding. Revisit only if
a future phase gives calc logic that diverges from the score engine.

**Source-citation split (per audit rule):** no new science claims introduced in
Phase 7 — Part A reuses Phase 6 / `07`'s already-cited rate-of-rise + clearing
logic (derived-in-repo, sourced in 07); Part B patterns are **authored local
knowledge** (owner-supplied via the hatch tables), flagged for fly-shop
ground-truthing. No new cited-source rows required.

**Phase 7 doc audit: COMPLETE.** Both touched logic docs reconciled against
shipped code — `05-7-1` (§5c rewrite + rig note + lineage/Status) and `07-7-1`
(calc-consumer cross-ref: intro, §7d, Outputs, Status). Nothing pending.

---

## Phases 1–7 — status roll-up

With the Phase 7 doc audit closed, phases 1–7 are each **complete and closed as
scoped**:

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Westslope-cutthroat response curve (`_bandFor`) | **closed** — flipped PROVISIONAL→done at Phase 6 (`05` Status) |
| 2 | Bite engine / block scoring | **closed** |
| 3 | 8-gauge expansion + forecast-warning callout system + stress chiclet split | **closed**, live-verified |
| 4 | Flow dynamics-first (`spike`/`clearing`/`flowAdj`); `07-flow` created | **closed** |
| 5 | Where-to-fish / gauge ranking (`04`) | **closed** |
| 6 | `categoryScores` re-anchored to `_bandFor`; flow level fully demoted | **closed** |
| 7 | `calcPicks` dynamics-first + independent per-gauge rigs + doc audit | **closed** |

**Two items carry forward — both now placed as scoped phases, neither dangling:**
1. **Forecast `max` derivation for measured gauges** → **Phase 8b** (placed below,
   with trigger, upload set, and scope guard). Not a correctness bug; a fidelity
   refinement, deliberately scope-guarded out of Phases 4–7.
2. **Ground-truth calibration** — Phase 7 rigs and score magnitudes are
   derived/anchored but **not** yet reconciled against fly-shop reports → **Phase 8**
   (planned below with its own upload set). That is the substance of Phase 8, not a
   gap in 1–7.

Interpretation: the system is **feature-complete and internally consistent through the
fly-selection engine**; it is **not yet field-calibrated** (Phase 8). "1–7 closed"
means every phase shipped, was validated, and had its docs reconciled — it does not
mean the rigs/scores are locally ground-truthed.

---

## On the horizon

### Phase 8 — fly-shop ground-truth calibration
Reconcile the derived per-gauge rigs (Phase 7 Part B) and score magnitudes against
`calibration/shop-reports.md`. This is where the "true local knowledge" the owner
flagged gets folded in. Bias-detection against the "Good = 7–8 dawn/dusk" anchor.

### Phase 8b — forecast `max` derivation for measured gauges (placed residual)
**Origin:** flagged during Phase 3 (diel-band work) and again at the Phase-6 close as a
"re-touch later" item; deliberately **not** addressed in Phase 4–7 (each scope-guarded
away from it). Promoted here from a loose catalog line to a placed, scoped slot so it
does not dangle.

**What it is:** measured-gauge forecast rows derive their daily `max` (and the diel band
around it) from observed spread. The current derivation is the Phase-3 average-spread
approach; the open question is whether the forecast `max` should be hardened (e.g. to a
condition-aware or max-spread basis) for measured gauges specifically. Related to the
frontend `tempCallout` fallback bump, which was deliberately left flat (average observed
spread) at the Phase-6 doc pass — that decision stands and is the reason this is a
*measured-gauge forecast-derivation* question, not a callout question.

**Trigger / dependency:** best done alongside any future pass that re-touches the
forecast pipeline or the continuous-curve derivation; not urgent, no correctness bug —
it is a fidelity refinement. Sequence after Phase 8 (calibration) so shop-report
ground-truth can inform whether the current band is even biased.

**Required to start (upload set):** `build-tracker` (latest) first; then `fetch-data.mjs`
(the derivation lives in the pipeline, `waterTempForecast`), `index.html` (the frontend
`tempCallout` fallback, ~L1140), a fresh `data.json`, and `02-chart-forecasts.md`.
**Scope guard:** forecast-`max`/diel-band derivation for measured gauges only. Does not
touch `_bandFor`, the two 66s, `HOOT_OWL_F`/`STRESS_RED_F`, the welfare ceiling, or the
scoring engines. Any band change is validated headless on live `data.json` before ship.

### Phase 9 — documentation & IP consolidation
Reconcile all logic docs against shipped code into one authoritative artifact.

### Phase 10 — hatch calendar re-plumb
`hatchesForMonth` stays a calendar (explicitly out of Phase 7 scope). Phase 10
makes it condition-aware if warranted — this is also where the logged thermal→
hatch-timing coupling (`05` Appendix) lands.

---

## Required to start — Phase 8 (upload set)

**Must-have:**
- `build-tracker-18.md` (this file) — upload first.
- `index.html` (current, post-7-2).
- fresh `data.json`.
- `calibration/shop-reports.md` — the ground-truth log (core Phase 8 input).

**Referenced:**
- `05-whats-working-now` (post-Phase-7, once the §5c rewrite lands).
- `07-flow.md`.

**Optional:**
- `06-thermal-response-and-stress` (only if calibration touches the stress ladder).

**Scope guard:** Phase 8 is calibration/local-knowledge reconciliation only. No
engine restructure; `_bandFor`, the 66s, `HOOT_OWL_F`/`STRESS_RED_F`, the welfare
ceiling, and the Phase-6/7 flow logic are closed unless a shop-report bias forces a
tuning change, which is logged before any code.
