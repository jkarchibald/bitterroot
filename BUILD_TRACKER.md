# Bitterroot Dashboard — Build Tracker & Handoff

*Single source of truth for the fly-fishing conditions engine. Feed this file at
the top of a new chat whenever a conversation gets truncated. The **Status Log**
at the bottom is the live state — read it first, then the section for whatever
phase is in flight.*

---

## How to use this doc

1. **On restart:** paste this file first. Everything Claude needs to resume
   without re-deriving context is here.
2. **Every iteration that changes or produces a downloadable output:** the
   Status Log at the bottom gets a new dated entry (newest on top) — last file
   version, what changed, what's verified, what's next. Nothing else in the doc
   moves except the phase-status lines in §4.
3. **Rigor grades** (A/B/C) tell Claude how hard to push on published science vs.
   how much to leave as a hook for local Bitterroot knowledge. Don't overwrite an
   A-grade curve with intuition; don't hard-code a C-grade local call as if it
   were universal.
4. **End-of-phase doc rule (standing):** at the close of every phase, Claude audits
   the affected logic docs (`logic/00`–`05`, `README`, `MIGRATION`) and either
   delivers the updated markdown(s) or explicitly states "no update needed" for each.
   No phase closes silently on the docs.

---

## 1. The system in one paragraph

Single-file `index.html` (HTML/JS, no build) renders a keyless, subscription-free
conditions dashboard for the Bitterroot drainage. Every score is a function of a
few environmental drivers (water temp, flow ratio, cloud, precip, light) feeding
**two independent engines**: `computeBlocks` → twelve 2-hour bite blocks +
`dayScore` (the "bite window" side), and `categoryScores` → the DRY/NYMPH/DD/
STREAMER rig ranking. Species assumption: **westslope cutthroat** (colder thermal
curve) is the governing species; on mixed reaches the coldest-adapted species
sets the welfare ceiling. Calibration anchor: fly-shop **"Good" (3.5–4/5) ≈ a
dawn/dusk peak of 7–8** on the app's 0–10 scale.

---

## 2. Guardrails / invariants — do NOT break these

- **Validate before delivering.** Extract the inline `<script>`, run `node
  --check`, and (for engine changes) run the function headless against real gauge
  conditions in Node before copying to `/mnt/user-data/outputs/`. Never reason
  abstractly about an engine change — run it.
- **Two load-bearing `66`s are NOT thresholds — leave them.** `HEAT=[…,[66,0.72],…]`
  (thermal-stress-index anchor, ~line 953) and the `t>=66` dawn-dominant
  crepuscular hinge (~lines 1301/1305/1311) are response-curve science, not the
  old "66" holdover. Do not "promote" them to 73.
- **Two-tier temperature line is deliberate.** `HOOT_OWL_F = 73` = FWP legal/chart
  line (fixed, drives the red chart line + any "hoot-owl likely" text). `STRESS_RED_F
  = 70` = conservative cutthroat welfare red (tunable, the on-the-water number).
  `68` = orange/elevated. Pre-73 feeding degradation lives ENTIRELY in `_bandFor`'s
  continuous curve — never add a competing threshold constant.
- **Coldest species governs.** A mixed reach must not use a blended median curve;
  the welfare ceiling is set by the coldest-adapted governing species (cutthroat).
  Feeding-peak offsets can vary by reach (universal-science vs. local-override).
- **No zeros on a live trout river.** Live blocks floor at 1; every rendered bar
  needs exactly one science-based caption (water temp, flow, or light — never air
  temp). Air temp is informational only (it feeds water-temp forecasting).
- **DNRC timezone trap.** StAGE timestamps are Mountain wall-clock stored as UTC
  epochs — read UTC face components directly (`stageDayKey`/`stageStamp`), never
  timezone-convert them.
- **Static/hardcoded content ghosts into the UI.** Placeholder `blocks` arrays and
  hardcoded copy have caused repeat bugs — everything user-visible must be
  live-derived.
- **Docs move with code.** Any calculation change updates the matching logic doc in
  the same pass. **Ask before creating or restructuring `06-…md`, `index`, or any
  associated `.md`.**

---

## 3. File & function map

**Files**
- `index.html` — single-file frontend (working copy: `/home/claude/index.html`;
  delivered: `/mnt/user-data/outputs/index.html`; original upload:
  `/mnt/user-data/uploads/index__7_.html`).
- `fetch-data.mjs` — Node pipeline → `data.json` (USGS IV, DNRC StAGE, Open-Meteo,
  GloFAS). *Note: the giant `EMBEDDED_DATA` array inside index.html is test-fixture
  noise — ignore it; signal is ~15 code lines.*
- Docs: `README.md`, `MIGRATION.md`, `logic/` (00-overview + 01–05 + README),
  `06-thermal-response-and-stress.md`, `LOGIC_TRAINS.md` (superseded earlier design).

**Key functions**
- `_bandFor(t)` → `{key, mult, heat}` — the continuous temp→feeding response curve
  (MULT + HEAT tables). **Consumed by the bite engine only right now.**
- `computeBlocks(conditions)` → 12 blocks (0–10); `dayScore(g)` — bite engine.
- `categoryScores(g)` → rig ranking. **Uses its own step-bands, NOT `_bandFor`.**
- `waterStress(wt)` → `{level, label, reason}`; `stressChiclet(g)` — welfare signal
  + its chiclet.
- Supporting: `liveConditions`, `buildRecommendation`, `buildChart`, `flowTrendFrom`,
  `bestBlockIdx`, `optimumNote`, `hrDec`, `fmtClock`, `stageDayKey`/`stageStamp`,
  `ymdLocal`, `todayLocal`, `latestSample`.

---

## 4. The 8-item audit plan

Ordering principle: **data-flow order, hardest-science-first**, and each driver
split into two separate reviews — the *response curve* (given water temp X, how
should the fish behave? pure biology, lock to literature) vs. the *estimation*
(what IS water temp X now/tomorrow? a data/modeling problem). Fix the ruler before
arguing about the number you put into it.

Status legend: ☐ not started · ◐ in progress · ☑ done & integrated · ⚠ built but
review/integration incomplete. **☑ PROVISIONAL** = deliverable complete and live,
but subject to re-verification when a downstream phase it couples to is done (not
re-opened, just re-checked).

1. **Water temperature — response curve** · rigor **A** · **☑ PROVISIONAL — temp-complete, pending downstream re-verification (Phase 6 recalibration; Phase 3 null branch)**
   The temp→feeding-activity curve (`_bandFor`), **literature-locked to westslope
   cutthroat** (*O. clarkii lewisi*): optimum 55–59°F + chronic-lethal ~67°F (Bear
   et al. 2007, TAFS 136:1113), aerobic-scope peak ~15°C + acute-lethal ~77°F
   (Macnaughton et al. 2021). Continuous piecewise `MULT` (feeding, peak 0.88 across
   55–59°F → 0.10 at 77°F) + `HEAT` (stress index for the dawn/dusk tilt). Replaced
   the old step-bands. FWP anchors (73 legal via `HOOT_OWL_F`, 77 lethal) kept
   separate from the feeding curve.
   *Status:* **complete as biology and integrated into the bite engine**
   (`computeBlocks` line 1044 → `dayScore`), the chart red line, and the
   banner/hoot-owl/lethal warnings. Species decision (cutthroat governs) baked in.
   *Two items deliberately deferred, NOT Phase-1 defects:* (a) `categoryScores` still
   runs parallel step-bands → single-authority-across-both-engines is **Phase 6**
   (the "four identical scores"); (b) the `t==null` neutral-0.80 branch should go
   rare/dead once **Phase 3** guarantees an estimate.
   *Touches:* both engines, banner, hoot-owl/lethal warnings, fly-size logic.

2. **Dissolved oxygen + the stress ladder** · rigor **A** · **⚠ (science independent; coupling = soft dep on Phase 3)**
   The mechanism behind the 68/70/73 penalties (gas solubility = physical chemistry;
   biology on top well-studied), coupled to temp and to elevation (differs by gauge).
   *Status:* `waterStress` + `stressChiclet` built and wired; constants clean; label
   now always reads "Stress" (est tag carries provenance).
   **Gap A (science) — INDEPENDENT, doable now:** thresholds set and defensible but
   NOT yet DO-anchored — this phase confirms they're science-shaped (gas solubility +
   elevation) rather than eyeballed. Needs no Phase-3 inputs.
   **Gap B (coupling) — soft dep:** the ladder must always be fed a value; the
   `unknown → orange` branch is a symptom of a missing estimate. NOTE: in live
   `data.json` every gauge currently carries a series (measured 11-day or estimated
   8-day), so this branch is **latent, not firing in production** — Phase 3 makes it
   formally dead code but isn't blocking today. Also open: terminal-day outlier guard.
   *Touches:* stress chiclet, welfare red, elevation.

3. **Water temperature — estimation & forecast** · rigor **B** · ◐ **(lead fix landed early 2026-07-05; rest open)**
   Lives in `fetch-data.mjs`, NOT the frontend — `index.html` only renders what
   `data.json` provides. **DONE EARLY — measured-gauge forecast coupling
   (`waterTempForecast`):** was `air_forecast + flat_offset` (rides air 1:1, badly
   over-warms buffered forks — projected East Fork 56→74°F and tripped a false stress
   red). Now anchors on the latest real reading and rides only the air *change* at the
   gauge's own least-squares air→water slope (clamped [0.2, 0.6], fork empirical ~0.4;
   fell back-compatible with the estimator's 0.5 damping). Verified: East Fork fcMax
   70.4→60.0 (red→green), Lolo below 68.4→61.2 (orange→green), estimated gauges
   untouched. Self-re-anchors each run, so it still catches a genuine sustained warm-up. **Mandate:** every gauge must carry a measured-or-estimated
   value for discharge, stage, water temp, AND trend *before* anything scores off it —
   no legitimate "no data / unknown" state at score time. Audit the *number*: two-pass
   estimate, 0.5× air-trend damping, 0.80 multiplier, `shiftLastYearTemp`, and the big
   open question — single daily value vs. diel min/max (an afternoon touching 73
   matters even if the mean is fine). First concrete item: estimated gauges carry an
   **8-day series vs. 11 for measured** — window mismatch. **Bias:** Open-Meteo highs
   run ~3–6°F above weather.com — may sit the forecast warm.
   *Docs to land WITH this code:* rewrite `01-temperature.md` (the estimation model —
   currently the retired `(hi+lo)/2 − 6`) and `02-chart-forecasts.md` (forecast) to
   match the real water-minus-air-offset engine.
   *Touches:* every temp-driven output; Tomorrow column; banner; makes the Phase-2
   `unknown` branch dead code.

4. **Flow** · rigor **B** · ☐ **(REFRAMED — dynamics-first, not level-vs-normal)**
   **DESIGN REFRAME (Uber, 2026-07-05):** flow *level* mostly **relocates** fish
   (high → edges/seams; low → deep holds), it does NOT gate feeding — so a static
   "high flow → lower score" penalty is conceptually wrong. The real feeding signal is
   **dynamics**: a fast rise mobilizes sediment and clouds the water → fish can't see
   the fly → bite suppressed; the falling/clearing window right after is often the best
   fishing of the week. These are **self-relative** (measured vs the river's OWN recent
   flow), which sidesteps the broken "normal" baseline entirely.
   *Work:* demote the static level-vs-normal `flowAdj` bands (the `≥1.5×→0.80` step that
   pins the score); make `flowTrend.spike` (blowout, −55%) and `flowTrend.clearing`
   (dropping & clearing, +18%) the PRIMARY flow signal — and first verify they're even
   firing (a dead `flowTrend` is a prime suspect for the day score being frozen across
   days of changing flow). Keep absolute level only as a guardrail at the extremes
   (true unfishable blowout; very low water × thermal). Turbidity is inferred from rise
   rate (no sensor).
   *Consequence:* "normal" demotes to informational context, not a scoring driver —
   which largely **defuses the multi-year-storage question** (may not need a true
   climatological normal for the bite at all). The "big water" caption + the
   ≥1.4× band-flattening fold into this rework.
   *Touches:* both engines; block-caption flow logic; `flowTrend`; dayScore
   responsiveness.

5. **Light & time-of-day** · rigor **B** · ☐
   Cloud response + the crepuscular block engine: dawn/dusk amplitudes, `duskC`
   seasonal placement, `heatX` refuge tilt, the valid-block window (blocks 3–9).
   Crepuscular feeding is real & documented but amplitude is the softest B-tier, so
   it comes after the harder drivers.
   *Touches:* block shape; optimum-window scan.

6. **Engine integration & re-calibration** · rigor **B** · ☐
   With trustworthy drivers + curves, verify how they combine in each engine and
   **re-anchor `categoryScores` to the same cutthroat numbers** (and make the ≥1.4×
   flow branch scale with ratio) so the rig engine stops disagreeing with the bite
   engine. Re-check against the fly-shop "Good ≈ 7–8" reality. This phase kills the
   "four identical scores" symptom at the assembly level.
   *Touches:* closes the Phase 1 integration gap; both engines; calibration anchor.

7. **Fly selection** · rigor **C** (mostly local) · ☐ *(deferred)*
   The rig/pattern layer. Build a hook and let local Bitterroot knowledge fill it.

8. **Current fly recommendations from a local shop** · **external / user-owned** · ☐
   Uber pulls current shop fly ratings and real-water observations; these are the
   ground-truth the model calibrates against (and the eventual input to Phase 7).

---

## 4b. Section → phase readiness map

*Which on-screen section becomes trustworthy after which phase. Rule of thumb: DATA
sections settle early (Phase 2–3); every SCORE section improves as drivers land but
only LOCKS at Phase 6 (recalibration). Freshness ≠ correctness — the header timestamp
tells you if data refreshed; the phase tells you if the logic is final.*

| App section | Settles / focused after | Watch for |
|---|---|---|
| Raw readings (discharge, stage, temp, weather) | **Phase 3** | Every gauge real-or-estimated, no "missing," full-length series. Temp-forecast fix already improved this. |
| Chiclets — Height/Flow/Temp/**Stress** dots | **Phase 3** (Stress shape confirmed **Phase 2**) | Already moving from temp fix: East Fork red→green, Lolo-below orange→green once deployed. |
| Temp value + forecast line | **Phase 3** (curve was Phase 1) | Forecast stops over-warming (East Fork no longer projects 70°F). Mostly done. |
| **Day score** (0–10 badge) | Responsive after **Phase 4**; final at **Phase 6** | After 4 it should move day-to-day (today frozen by pinned flow). After 6, re-anchored to guide "Good ≈ 7–8." |
| Today's bite windows (bars + captions) | Shape right after **Phase 5**; final **Phase 6** | Phase 4: "big water" becomes magnitude/dynamics-aware. Phase 5: dawn/dusk shape. |
| Where to fish (Today/Tomorrow ranking) | **Phase 6** (needs Phase 4 first) | Phase 4: gauges stop tying, start differentiating. Phase 6: ranking stable/calibrated. |
| What's working now (dry/nymph/DD/streamer) | **Phase 6** (patterns at **Phase 7**) | The "four identical scores" section — on the OLD rig engine BY DESIGN until Phase 6. Expect it unchanged/static until then; not a new bug. |
| Chart forecast lines | temp **Phase 3** · flow **Phase 4** | Temp line already corrected; flow/clearing dynamics arrive with Phase 4. |

**Quick read:** *Now* (once `fetch-data.mjs` is committed + a run fires) only the Temp
forecast line and Stress chiclet should visibly change — that's the deploy check.
*After Phase 4* is the big unlock: day score starts responding, gauges differentiate,
"big water" gets smart. *After Phase 6* all score sections settle to final calibrated
values and "what's working now" finally comes right.

---

## 5. Decisions & calibration anchors

- **Two-tier threshold** — law is a lagging fact (73, fixed); forecast needs a
  leading welfare signal (70, tunable). Both explicit everywhere.
- **Mixed-species reach** — coldest-adapted governing species sets the ceiling;
  no blended median. Optional per-reach feeding-peak offsets.
- **Calibration reality check** — fly-shop "Good" (3.5–4/5) ≈ dawn/dusk 7–8 on the
  app scale. Score labels: Poor / Fair / Good / Very Good / Hot.
- **Universal-science vs. local-override** — species curves are universal; which
  species lives in which gauge is local knowledge. Same split for feeding-peak
  timing.
- **Diagnostic method** — replicate the function in Node against each gauge's real
  banner conditions and compare outputs directly; don't reason from memory.
- **Data-provenance rule (three-tier, Uber 2026-07-05)** — Tier 1: all inputs
  measured → true color, no tag. Tier 2: any input estimated → true color **+ "est"**.
  Tier 3: derive-when-truly-stuck → should essentially never fire. There is no
  legitimate "no data / unknown" state at score time; the estimation layer must
  supply discharge, stage, water temp, and trend (measured or estimated) *before*
  anything forecasts off them. The frontend already honors Tier 1/2 from
  `wt.estimated`; closing Tier 3 is Phase-3 pipeline work, after which the
  `unknown → orange` branch is dead code.

---

## 6. Open questions / pending decisions

- Diel min/max vs. single daily water-temp value (Phase 3) — likely the biggest
  estimation call.
- Open-Meteo highs run ~3–6°F above weather.com in the credible window — may bias
  the water-temp forecast slightly warm (Phase 3).
- Whether Phase 2's DO grounding shifts the 68/70 numbers at all, or just confirms
  them.
- Doc-drift: `logic/01-temperature.md` and `logic/02-chart-forecasts.md` still
  describe the superseded recession-factor-`k` + `(hi+lo)/2 − 6` model, not the
  GloFAS-trend + water-minus-air-offset engine actually in use (flagged in README
  and MIGRATION, not yet resolved). Rewrites land WITH Phase 3.
- **True normal vs. 2-year median (Phase 4 / data-architecture):** `computeNormal`
  is a this+last-year median, not a climatological normal. Do we pull and store 2–3+
  prior years ourselves to get a real baseline? What's USGS IV / DNRC retention, and
  where would we persist the history (repo JSON, Actions cache, external store)?

---

## ── STATUS LOG (living — newest on top) ──

### 2026-07-05 (g) · Flow model reframed (Phase 4) + day-score staticness diagnosed
- **Day score frozen 3 days despite fresh `data.json`** traced to flow: each block is
  `10·tempMult·light·flowAdj·precipAdj`; tempMult/light/precip were ~flat, and
  `flowAdj` is a step function pinned at 0.80 (ratio ≥1.5) — so a river that's actually
  dropping/clearing doesn't move the score. Not the averaging window (that change won't
  unfreeze it; in summer `[sunrise+1,sunset−1]` ≈ the same blocks).
- **DECISION — flow is dynamics-first, not level-vs-normal (Uber).** Level relocates
  fish, doesn't gate feeding; the bite signal is the rise→turbidity→can't-see-fly
  suppression and the clearing rebound. Self-relative, so it sidesteps the bad
  "normal" baseline and largely defuses the multi-year-storage question. See Phase 4.
  `flowTrend` spike/clearing become primary; static bands demoted; verify `flowTrend`
  is firing.
- **dayScore weight (0.35 best-4hr / 0.65 daytime avg):** confirmed a hand-tuned
  calibration knob (rigor C), set to hit "guide Good ≈ 7–8", not a derived constant —
  re-justify at Phase 6. Uber's `[sunrise+1, sunset−1]` averaging-window idea also
  pulls dawn/dusk OUT of the average (best-4hr term still catches them); do it WITH the
  Phase-6 weight re-anchor, not piecemeal.

### 2026-07-05 (f) · Phase-3 lead fix pulled forward — measured-gauge temp forecast
- **File delivered:** `/mnt/user-data/outputs/fetch-data.mjs`. `waterTempForecast`
  rewritten: was `air_forecast + flat_offset` (air 1:1 → over-warmed forks, false East
  Fork red at a real 56°F). Now anchors on the latest reading + rides the air *change*
  at the gauge's own least-squares air→water slope (clamp [0.2,0.6]; forks empirical
  ~0.4). `node --check` clean; end-to-end tested against live data.
- **Result:** East Fork forecast max 70.4→60.0 (red→green); Lolo below 68.4→61.2
  (a bonus false orange→green); estimated gauges untouched. New maxes sit inside the
  observed 48–62°F envelope, matching on-the-water reality.
- **Deploy:** commit `fetch-data.mjs`; next Actions run (or a manual "Run workflow")
  regenerates `data.json` with corrected forecasts. **Frontend unchanged** — no
  `index.html` redeploy needed.
- **Still open in Phase 3:** estimation completeness (8-vs-11 day series), diel min/max
  question, Open-Meteo warm-bias + terminal-day outlier guard, `01`/`02` doc rewrites.
  Phase 2 (DO/stress-ladder science) remains the planned next full phase.

### 2026-07-05 (e) · Phase 1 held; flow caveats folded in; next-phase call
- **Phase 1 held (☑ PROVISIONAL).** Pausing here per Uber.
- **Flow work expanded (Phase 4):** (a) generalize the Lolo finding — the ≥1.5× flat
  `flowAdj=0.80` can't differentiate gauges (Lolo above 1.89× == below 2.72×); build
  a response that scales with the multiple across all rivers. (b) **"normal" is a
  this+last-year median, NOT a true normal** (confirmed `fetch-data.mjs` L611–613;
  USGS last-year window may be empty beyond retention). `flowRatio` ≈ "vs last year."
  True normal needs pulling + storing 2–3+ prior years — added to open questions as a
  data-architecture decision.
- **Docs:** `01` + `02` rewrites now formally scheduled to land WITH Phase 3 code.
- **Corrected next-phase recommendation → PHASE 2, not 3.** Earlier Phase-3 lean
  over-weighted the visible estimation gaps, which are polish, not blockers. Phase 2's
  DO-threshold science is rigor A (hardest-science-first), same thermal domain as
  Phase 1, independent of estimation, and needs no missing inputs. The "Phase 2 blocked
  on Phase 3" framing was too strong — the no-unknown edge isn't firing in live data.
  Phase 3 is the bigger data-foundation lift (+ the true-normal decision) to schedule
  deliberately after. *Awaiting Uber's pick.*

### 2026-07-05 (d) · Phase 1 closed (provisional) — session wrap
- **Phase 1 → ☑ PROVISIONAL (temp-complete, pending other phases).** Response curve
  done, literature-anchored, live, and integrated in the bite engine. Final sign-off
  waits only on Phase 6 recalibration (cross-engine unification) and Phase 3 (null
  branch) — not re-opened, just re-checked when those land.
- **Deployed set verified current.** `index__9_.html` = live site; both edits
  (`HOOT_OWL_F`, always-"Stress") already present → no version gap, nothing to
  re-apply. Live `data.json` (generated 2026-07-05 16:27Z) is internally consistent
  for all 6 gauges — no Temp/Stress contradiction. Earlier "green Temp + orange-est
  Stress" was the old sandbox artifact, not production.
- **Phase-1 doc audit (per standing end-of-phase rule):**
  - `06-thermal-response-and-stress.md` → **DELIVERED** — authoritative Phase-1/2
    thermal doc (`_bandFor` curve + stress ladder + `HOOT_OWL_F` + three-tier
    provenance rule), matched to deployed code.
  - `01-temperature.md` → **NO Phase-1 update.** Its content is the temperature
    *estimation* model (the drifted `(hi+lo)/2 − 6`), which is **Phase-3** work —
    land it with the `fetch-data.mjs` changes, same as `02`. Only Phase-1-relevant
    touch is a one-line pointer ("response curve → see `06`"); needs `01` uploaded.
  - `02-chart-forecasts.md` → **update needed but DEFERRED to Phase 3** (same drift;
    forecast/estimation territory).
  - `00`, `03`, `04`, `05`, `README` → **no update needed** for Phase 1.
- **Carried into Phase 3 (open):** estimated gauges (West Fork Painted, West Fork
  Conner, Bell) carry an 8-day series vs. 11 for measured gauges — estimation-window
  completeness is the first Phase-3 item. `fetch-data.mjs` now in hand.

### 2026-07-05 (c) · Phase 1 closed + correction
- **Phase 1 → ☑.** Response curve verified literature-anchored (Bear et al. 2007,
  Macnaughton et al. 2021) and integrated in the bite engine. No further index.html
  change needed to close it. `categoryScores` unification = Phase 6; null branch =
  Phase 3.
- **Correction to (b):** the gauge screenshots are **live `data.json`, not the stale
  embed.** Lolo Creek below Highway 93 isn't in this file's embedded fixture (embed
  has 5 gauges; header still says "5 gauges"; static config has 6), so the page
  fetched live data. Earlier "stale June-22 fixture / deploy fixes it" was wrong for
  those shots — Bell's 61°F is live too.
- **Lolo below bug = data contradiction, pipeline-side.** Its live record shows Temp
  green (`meta.measuredTemp:true`) AND Stress est/orange (`watertemp.estimated:true`
  or empty series) — internally inconsistent. Frontend is correct for every
  self-consistent gauge (invariant holds for all 5 in-file). Not patching the
  frontend.
- **To proceed (Phase 3, which Phase 2 is blocked on) upload:** `fetch-data.mjs`,
  the live `data.json`, and the currently-deployed `index.html` (this sandbox's copy
  is a version behind).

### 2026-07-05 (b) · index.html — stress chiclet label
- **Delivered:** `/mnt/user-data/outputs/index.html`. `stressChiclet` now always
  renders "Stress" (was "Status" when estimated); "est" tag still flags estimated
  input. `node --check` clean; measured → "Stress", estimated → "Stress est".
- **Decision locked:** three-tier data-provenance rule (see §5). No "unknown" state
  at score time. `unknown → orange` is NOT recolored — it becomes dead code once
  Phase 3 fills estimates upstream.
- **Key finding:** temp estimation is **pipeline-side** (`fetch-data.mjs`); the
  frontend only renders `data.json`. "Temp missing" (West Fork above Painted) and
  orange-unknown stress both trace to the pipeline emitting `watertemp:null`, not to
  the frontend. Frontend already honors Tier 1/2.
- **Sandbox note:** the embedded fixture is `generatedAt 2026-06-22` (~13 days
  stale). Odd *values* (e.g. Bell ~61°F) are staleness — deploy refreshes them.
  Structural items (label, unknown-orange, missing-vs-estimable) are code and survive
  deploy.
- **Blocker / next:** to do Phase 3, upload `fetch-data.mjs` (+ ideally a current
  `data.json`). Open plan question: keep phase order, or pull Phase 3 forward since
  Phase 2 is blocked on it?

### 2026-07-05 (a) · index.html (Task-1 constants + chiclet)
- **Delivered file:** `/mnt/user-data/outputs/index.html` (from upload `index__7_.html`).
- **Work completed:**
  - Introduced `const HOOT_OWL_F = 73` as the single named legal/chart constant;
    wired `buildChart` threshold line + `73` axis label to it (byte-identical output,
    pure refactor). Left the two load-bearing `66`s and `STRESS_RED_F = 70` untouched.
  - Reformatted `stressChiclet` so the estimated tag composes exactly like the Temp
    chiclet — visible text now "Status est" (was "Status (est.)"), same `.sub` span,
    fits one line. `waterStress` return contract unchanged (tooltip still "Status (est.)").
  - Both changes `node --check`-clean; chiclet markup verified identical to Temp tag.
- **Verified state of Phases 1 & 2:** response curve integrated in the **bite engine
  only** — `categoryScores` still on parallel step-bands (the "four identical scores"
  cause). Stress ladder built + wired but **not DO-grounded** (Phase 2 science pending).
- **What's left / next:**
  - Decide filing: does the stress ladder count as "done" (wired) or wait on Phase 2
    (DO-grounded)? Tracker currently marks both Phase 1 & 2 as ⚠.
  - Doc-side (ask-first): note in `06-…md` that `HOOT_OWL_F` now exists as the named
    constant and that the visible chiclet tag is now "Status est".
  - When ready, Phase 3 (temp estimation) is the next data-flow node.
