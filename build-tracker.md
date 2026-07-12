<!-- version: build-tracker-13.md -->
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
   the affected logic docs (every file in `logic/` — currently `00`–`06` + `README`,
   plus any **new** doc a phase introduces, e.g. Phase 4's `07-flow.md` — and
   `MIGRATION`) and either delivers the updated markdown(s), delivers a new doc, or
   explicitly states "no update needed" for each. No phase closes silently on the docs.
5. **File-naming / versioning rule (standing):** every file Claude produces for
   download carries a version stamp `-x-y` inserted immediately BEFORE the extension,
   regardless of file type (`.html`, `.md`, `.mjs`, `.yml`, …). **Base filenames are
   lowercase kebab-case — hyphens only, never spaces or underscores** (`build-tracker`,
   not `build-tracker`). `x` = the phase currently being worked on; `y` = a counter that
   increments on each document Claude produces within that phase, restarting at 1 when
   the phase (`x`) changes. Files delivered together in the same iteration SHARE the
   same `x-y` so companions stay matched. Examples: `index-3-2.html`,
   `fetch-data-3-2.mjs`, `06-thermal-response-and-stress-3-2.md`. (A doc's own
   logic-folder number like `06` is its identity; the trailing `-x-y` is the version
   stamp — two separate things.) Purpose: tell current vs. stale downloads apart.
   **Tracker exception:** `build-tracker.md` is cross-phase, so it uses a single
   global counter `-y` (no phase `x`): `build-tracker-1.md`, `-2`, … Highest number =
   newest; always re-upload the highest one.
6. **Commit-message rule (standing):** every file Claude delivers that goes into the
   repo (`index.html`, `fetch-data.mjs`, `update-data.yml`, logic `.md`s, and the
   tracker) ships with a paste-ready commit message in a copy block — a subject line plus a
   short body saying what changed and why, so git history reads as a real changelog.
   **Subject format (Uber, 2026-07-10):** `type: (versioned-filename.ext): subject`, e.g.
   `feat: (fetch-data-3-3.mjs): emit real forecast diel band`. Type is Conventional-Commits
   (`feat:` / `fix:` / `docs:` / `chore:`); the versioned filename goes in parens; then the
   subject. Body follows as a separate block (plain ASCII, ~72-col wrap, so it pastes into a
   terminal cleanly). Files commit under their plain repo names — the version lives in the
   in-file stamp and the commit subject, not the committed filename.
7. **Citation rule (standing):** every logic-doc assumption points to a **cited**
   published source where one exists (author/agency, year, venue, and a locator —
   DOI / doc number). Values Claude computes from the app's own data are labeled
   **derived-in-repo** (traceable to method, not a paper). Genuine judgement calls
   with no source are labeled **assumption**. Each logic doc carries a `Sources`
   section using this three-way split; inline claims reference it (e.g. `[S3]`). The
   point: any number in a logic doc can be traced to a reason. `06-…-2-3` is the
   reference example. **Prefer Montana / regional sources where they exist** (MSU,
   University of Montana, Montana FWP, Montana DEQ), flagged 🏔, for local support —
   the app is a Bitterroot-specific tool and regional literature/regulation carries
   more weight for calibration than generic references.
8. **Phase-inputs rule (standing):** every phase entry in §4 declares a **"Required
   to start (upload set)"** — the exact files that must be uploaded before that phase
   begins, split must-have / referenced / optional, with a scope guard. On restart,
   the operator gathers that set and pastes the tracker first. Phase 3's set is the
   worked example.

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
- Docs: `README.md`, `MIGRATION.md`, and the `logic/` folder. **Actual logic files
  (as of 2026-07-10):** `00-overview.md`, `01-temperature.md`, `02-chart-forecasts.md`,
  `03-bite-windows.md`, `04-where-to-fish.md`, `05-whats-working-now.md`,
  `06-thermal-response-and-stress.md`, `README.md`. **Note:** there is **no flow doc yet** —
  `04` is **where-to-fish** (gauge ranking), NOT flow. The Phase-4 flow doc is a **NEW file,
  `07-flow.md`** (next free number; do not rewrite `04`). `LOGIC_TRAINS.md` is a superseded
  earlier design. Files commit under plain names (no `-x-y` in the filename); the version
  stamp lives in-file only.

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

## 4. The 9-item audit plan

Ordering principle: **data-flow order, hardest-science-first**, and each driver
split into two separate reviews — the *response curve* (given water temp X, how
should the fish behave? pure biology, lock to literature) vs. the *estimation*
(what IS water temp X now/tomorrow? a data/modeling problem). Fix the ruler before
arguing about the number you put into it.

Status legend: ☐ not started · ◐ in progress · ☑ done & integrated · ⚠ built but
review/integration incomplete. **☑ PROVISIONAL** = deliverable complete and live,
but subject to re-verification when a downstream phase it couples to is done (not
re-opened, just re-checked).

### Phase status at a glance (as of 2026-07-10)

| Phase | State | What's done | What (if anything) is still pending |
|---|---|---|---|
| 1 · Response curve | **☑ PROVISIONAL** — *not fully closed* | `_bandFor` literature-locked to westslope cutthroat, integrated in the bite engine, chart red line, banner/warnings. | Two downstream couplings, not Phase-1 defects: **Phase 6** recalibration (`categoryScores` still on parallel step-bands — the "four identical scores") and the **Phase 3** `t==null` null branch. Flips to full ☑ when those land. |
| 2 · DO + stress ladder | **☑ CLOSED (done & integrated)** | Gap A: 68/70 confirmed science-shaped (O₂ scissors, not DO-sat numbers); elevation analyzed, deliberately not wired; two-tier 70/73 split reinforced. Validated headless; DO-grounded doc `06-…-2-3` (cited). No index/fetch change. | Nothing in Phase-2 remit. Gap B (coupling) **relocated to Phase 3** — it was pipeline work, never Phase-2 science. |
| 3 · Temp estimation & forecast | **☑ CLOSED (done, integrated, live-deploy verified 2026-07-10)** | Lead fix (measured `waterTempForecast`) + **all four items**: (1) 8-vs-11-day window fixed; (2) diel decision resolved + **measured-gauge forecast rows carry a real diel band from observed spread** (`-3-3`); (3) Open-Meteo warm-bias characterised + terminal-day guard; (4) no-unknown mandate closed. **Mainstem:** Darby + Missoula added (measured); **Bell = Darby↔Missoula gradient**. Frontend: 6→8 roster, forecast-warning callout (card pill + chart legend chiclet with temps+dates hover), stress chiclet redefined to **current-only (today's peak, 70/73)**. **Live deploy verified:** 8 gauges render, chart hover works, Missoula shows green Stress + amber callout (no contradiction). `01`/`02` rewritten; `06` stress-meaning patch specced (below). | **Nothing in Phase-3 remit.** Flips Phase 1's `t==null` branch to dead code and satisfies Phase 2's coupling — both re-checked at Phase 6. Darby/Missoula placeholder rigs (Bell's, copied) owed to Phase 7. |
| 4 · Flow | **☑ (done & integrated, 2026-07-12)** — dynamics-first | Dead `flowTrend.clearing` root-caused (crest gate made it structurally 0 in any recession — confirmed 0 on all 8 live gauges) and rewritten: `clearing` = falling-day × drawdown, no crest gate; `spike` = rate-of-rise (steepest day in a 2-day window). Static level penalties (`≥1.5×→0.80`, `≥1.25×→0.90`) removed; dynamics primary; clearing ceiling +18%→+25%. `normal` demoted to informational context. New doc `07-flow.md`. `index.html` only (pipeline unchanged). Validated headless vs live data + synthetic controls. | Last-year-**gradient** signal + true-climatological-normal storage specced in `07`, not built (data-coverage precondition). Rig-score magnitudes still owed to **Phase 6** (no re-anchor this pass). |
| 5 · Light/time-of-day | **☑ (done & integrated, 2026-07-12)** — evening-peak placement fixed | The crepuscular block engine reviewed end-to-end against live data. **Root cause found:** `duskC` placed the evening Gaussian ~0.8 h before sunset with heat pushing it *later* → center ~20.5 in July → peak landed in the **post-sunset 8–10 PM bin** (block 10), so the "best window" star fell after last light on all 8 prime/cool gauges. Rewritten to `ssHr − (1.8 + 1.2·springFall + 0.4·heat)` → peak now in the **6–8 PM** hatch block; heat pulls it slightly *earlier*. Amplitudes (`dawnAmp`/`duskAmp`), `heatX` tilt, `midBase`, cloud response reviewed and science-anchored where the literature reaches (Ovidio 2002 dusk-peak + seasonal-homogeneity shift; drift literature), derived/assumption elsewhere. `03-bite-windows` rewritten + given a `Sources` section. `index.html` only. | Score *magnitudes* (bite vs rig) still unified at **Phase 6**; exact amplitudes remain soft B-tier, natural target for Phase-8 shop-report ground-truth. |
| 6 · Integration & recalibration | ☐ not started | — | Re-anchors `categoryScores`; flips Phase 1 to full ☑. |
| 7 · Fly selection | ☐ deferred | — | — |
| 8 · Shop reports (external) | ☐ user-owned | — | — |
| 9 · Doc/IP consolidation | ☐ final (after Phase 6) | — | — |

**Read:** four phases are done & integrated (Phase 2, Phase 3, Phase 4, **Phase 5**).
Phase 1 is complete as biology and live, but **provisional** — it cannot close until
Phase 6 (recalibration) lands (its `t==null` null branch is now dead code as of Phase 3,
but the `categoryScores` re-anchor is still owed). Don't mark Phase 1 ☑ before Phase 6.
**Next full phase: Phase 6 (integration & recalibration)** — re-anchors `categoryScores`
to the cutthroat numbers, kills the "four identical scores" at the assembly level, and
flips Phase 1 to full ☑.


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

2. **Dissolved oxygen + the stress ladder** · rigor **A** · **☑ (done & integrated, 2026-07-09) — Gap A DO science complete; Gap B coupling relocated to Phase 3**
   The mechanism behind the 68/70/73 penalties (gas solubility = physical chemistry;
   biology on top well-studied), coupled to temp and to elevation (differs by gauge).
   *Status:* `waterStress` + `stressChiclet` built and wired; constants clean; label
   now always reads "Stress" (est tag carries provenance).
   **Gap A (science) — DONE (2026-07-09), confirm-not-change:** 68/70 confirmed
   science-shaped — they are **thermal-welfare thresholds whose mechanism is the O₂
   supply/demand scissors**, NOT DO-saturation numbers (the DOsat ceiling doesn't cross
   the cold-water salmonid sublethal band ~6.5–7 mg/L until ~76–81°F, i.e. above the
   73° hoot-owl line). No threshold moved. **Elevation:** real physics (high forks carry
   ~4–5% less DO, ≈−3.4°F/1,000 ft equal-cushion) but deliberately **not wired** —
   anti-correlated with exposure (the high gauges are the cold ones that never reach
   68–70°F; the warm gauges that do — Bell, Lolo below — sit at the valley reference
   where the offset is ~0). Two-tier 70/73 split reinforced (70 leads both limits by
   3–6°F; do not merge). Validated headless against real `data.json`; **no `index.html`
   or `fetch-data.mjs` change required.** Ground truth in `06-thermal-response-and-stress-2-2.md`.
   *Parked (optional):* default-off, welfare-line-only elevation offset
   `ΔF ≈ −3.4×(elev_ft−3300)/1000` clamped [−5,0] — near-inert here; sign-off before wiring.
   **Gap B (coupling) — MOVED TO PHASE 3 (2026-07-09).** The ladder must always be fed
   a value; the `unknown → orange` branch is a symptom of a missing estimate, and the fix
   is entirely upstream in `fetch-data.mjs` (Phase 3's domain), not in this phase. It was
   never Phase-2 science. Latent, not firing in live data today. Tracked as an explicit
   Phase-3 deliverable — see item 3. This is why Phase 2 can close at full ☑ rather than
   provisional: nothing in Phase 2's own remit remains.
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
   no legitimate "no data / unknown" state at score time. **Absorbed from Phase 2 (Gap B),
   2026-07-09:** satisfying this mandate is what makes the stress ladder's frontend
   `unknown → orange` fallback (`stressChiclet`/`waterStress`) formally dead code — no
   frontend recolor, close it upstream. The terminal-day outlier guard (chart + Tomorrow
   column) rides here too. Audit the *number*: two-pass
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
   ***REQUIRED TO START (upload set) — do not begin Phase 3 without these:***
   - **Must-have:** (1) `build-tracker` (highest number) — paste first; (2)
     `fetch-data.mjs` — the pipeline, where Phase 3 lives; (3) a **current
     `data.json`** — from the live site (`jkarchibald.github.io/bitterroot/data.json`)
     or a fresh Actions run (the fixture embedded in `index.html` is stale ~Jun 22 and
     must not be used to validate).
   - **Rewritten/referenced this phase:** (4) `01-temperature.md` — rewrite target
     (retired `(hi+lo)/2 − 6` model); (5) `02-chart-forecasts.md` — rewrite target
     (forecast/estimation); (6) the **deployed** `index.html` (live copy, not a
     sandbox one) — to close the `unknown → orange` branch correctly, since the
     frontend consumes the series.
   - **Optional:** (7) `06-thermal-response-and-stress` (highest) for the response-
     curve cross-ref; (8) `update-data.yml` only if the cron is touched.
   - **Scope guard:** the *true climatological normal* question is **Phase 4**, NOT
     Phase 3 — don't let it pull scope in. First Phase-3 items: 8-vs-11-day window
     mismatch → diel min/max decision → Open-Meteo warm-bias + terminal-day guard →
     close the no-unknown mandate.
   - **Stamping:** Phase-3 files reset to `x=3` (`fetch-data-3-2.mjs`,
     `01-temperature-3-2.md`, …); tracker keeps its global counter (`build-tracker-7`
     next).

4. **Flow** · rigor **B** · ☑ **(done & integrated 2026-07-12 — dynamics-first; see Status Log top + `07-flow.md`)**
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
   *Doc deliverable:* a **NEW `07-flow.md`** (stamp `-4-1`; commits as `07-flow.md`).
   There is no flow doc today — `04` is where-to-fish, not flow. Do not rewrite `04`.
   *Required to start (upload set):* `build-tracker` (highest); `index.html` (deployed);
   `fetch-data.mjs`; a **fresh `data.json`** from a live run; `02-chart-forecasts` (flow
   forecast is documented there). Optional: `06` (coldwater×low-flow guardrail cross-ref),
   `update-data.yml` (only if the cron changes). *Scope guard:* dynamics-first only; do NOT
   re-anchor `categoryScores` (Phase 6); the true-climatological-normal storage decision is
   a data-architecture question to raise, not necessarily build this pass.

5. **Light & time-of-day** · rigor **B** · ☑ **(done & integrated 2026-07-12 — evening-peak placement fixed; see Status Log top + `03-bite-windows-5-1.md`)**
   Cloud response + the crepuscular block engine: dawn/dusk amplitudes, `duskC`
   seasonal placement, `heatX` refuge tilt, `midBase`, the valid-block window.
   Crepuscular feeding is real & documented but amplitude is the softest B-tier, so
   it came after the harder drivers.
   **Root cause found (traced through live `data.json`, not memory):** the light
   engine looked fine in isolation but the seasonal `duskC` placement put the evening
   Gaussian center at ~20.5 h in July (offset only ~0.8 h before sunset, *with heat
   pushing it later still*). Block 9 (6–8 PM) has midpoint 19; block 10 (8–10 PM) has
   midpoint 21 — so the center overshot the real evening-hatch block and landed on the
   post-sunset bin. Since both the star (`bestBlockIdx`) and the day-score best-4 h term
   reward the single highest block, the app's "best window" fell **after last light** on
   **all 8** prime/cool gauges, and block 10 (its own caption reads "fading light")
   outscored block 9. That is the Phase-5 defect.
   **Fix (index.html, one formula + its comment block):** `duskC = ssHr − (1.8 +
   1.2·springFall + 0.4·heat)`. Peak now sits ~1.8 h before sunset at high summer (July
   center ≈ 19.4 → block 9), ~3.0 h in the shoulders (mid-evening), and heat pulls it
   slightly **earlier** (warm late-afternoon = lowest-margin water, consistent with the
   `heatX` dusk-easing). **Amplitudes/tilt reviewed, not re-tuned:** `dawnAmp=0.40+0.18·heat`,
   `duskAmp=0.50+0.20·heat` (dusk's modest lead is literature-supported in *direction* —
   Ovidio 2002, drift literature — the magnitudes are derived-in-repo against the "Good ≈ 7–8"
   anchor); `heatX` refuge tilt and `midBase` left as-is and documented honestly. **Scope
   guards honored:** SHAPE only — no `_bandFor` MULT/HEAT edit, the two load-bearing `66`s
   (HEAT anchor + `t>=66` hinge) and `HOOT_OWL_F`/`STRESS_RED_F` byte-identical (verified),
   no `categoryScores` re-anchor (Phase 6).
   *Result (headless, live 8 gauges):* post-sunset stars 8/8 → **0/8**; evening star now
   6–8 PM; day scores on prime gauges rose ~0.3–0.7 toward the "Good ≈ 7–8" anchor;
   Missoula (hot) correctly keeps its dawn/thermal-refuge star. Seasonal controls (May/Sep/Oct)
   pull the peak earlier as days shorten; hot-water (66/70 °F) dawn-leads; overcast lifts
   midday; null-temp floors with no NaN.
   *Doc:* `03-bite-windows.md` **rewritten → `-5-1`** (light-curve section rebuilt to match
   shipped code; `duskC` fix documented inline; new `Sources` section with the three-way split).
   *Touches:* block shape; the star; optimum-window scan; day-score best-4 h term.
   *Required to start (upload set):* `build-tracker` (highest); `index.html` (deployed);
   a fresh `data.json`; `03-bite-windows.md` (rewrite target). Optional: `06` (the `heat`/`66`
   cross-ref), `README-logic.md`. *Scope guard:* light/time-of-day block SHAPE only; do NOT
   re-anchor `categoryScores` (Phase 6); do NOT touch the two `66`s or the stress/hoot-owl
   thresholds; `_bandFor` MULT/HEAT is Phase-1 biology — light multiplies it, never redefines it.
   *Stamping:* Phase-5 files `-5-1` (`index-5-1.html`, `03-bite-windows-5-1.md`); tracker keeps
   its global counter (`build-tracker-13`).

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

9. **Documentation & IP consolidation** · **FINAL — runs after Phase 6** · ☐
   Single authoritative pass reconciling every logic doc against the shipped code.
   Uber provides the full program (`index.html`, `fetch-data.mjs`, `update-data.yml`)
   plus all logic docs (`00`–`06`, `README`); Claude folds/supersedes the drifted
   `01`/`02`, aligns `06`, refreshes `04`/`README`, so `logic/` becomes a true,
   self-consistent description of the system. **This is the deliverable that defines
   the intellectual property** — the encoded fisheries reasoning, calibration
   decisions, and estimation methods documented as one coherent, defensible artifact.
   **Timing matters:** doing a full sweep before Phase 6 documents moving targets
   (Phases 3–6 would invalidate it); the consolidation earns its keep only once the
   engines are unified and recalibrated. **Does NOT replace the per-phase doc rule** —
   at each phase close Claude still delivers updated markdown or says "no update
   needed"; Phase 9 pulls those incremental updates into the final IP-packaged set.

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
| **Day score** (0–10 badge) | **Responsive as of Phase 4 (done)**; final at **Phase 6** | Phase 4 landed: static level pinning removed, `flowTrend` revived → the score now moves day-to-day with changing flow and gauges differentiate. Still re-anchored to "Good ≈ 7–8" at Phase 6. |
| Today's bite windows (bars + captions) | **Shape settled at Phase 5 (done)**; final **Phase 6** | Phase 4 made "big water" magnitude/dynamics-aware. Phase 5 fixed the evening peak — the star/optimum window now lands in the 6–8 PM hatch, not the post-sunset bin. Magnitudes recalibrate at Phase 6. |
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
- ~~Whether Phase 2's DO grounding shifts the 68/70 numbers at all, or just confirms
  them.~~ **RESOLVED 2026-07-09 — confirms, no shift.** 68/70 are thermal-welfare
  thresholds via the O₂ scissors; DO-saturation alone would sit the line ~6–8°F higher.
  Elevation real but not wired (anti-correlated with exposure). See §4 item 2 / `06-…-2-2`.
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

### 2026-07-12 (b) · Phase 5 CLOSED — light & time-of-day; evening-peak placement fixed
- **Files delivered:** `index-5-1.html`, `03-bite-windows-5-1.md` (rewritten),
  `build-tracker-13.md`. `fetch-data.mjs` **unchanged** — Phase 5 is entirely frontend
  block-shape logic; the pipeline already emits everything the light curve reads.
- **Root cause found (traced through live `data.json`, not memory).** Ran the shipped
  `computeBlocks` headless against all 8 live gauges (extracted the inline `<script>`,
  `node --check` clean, isolated `_bandFor`/`bestBlockIdx`/`computeBlocks`). The engine
  *looked* fine in code review, but the seasonal `duskC` placement was
  `ssHr − ((1.0 + 1.5·springFall) − 0.8·heat)` → center **~20.5 h** in July (only ~0.8 h
  before a 21.3 sunset, *with heat pushing it later still*). Block 9 (6–8 PM) has midpoint
  19; block 10 (8–10 PM) has midpoint 21 — the center overshot the true evening-hatch block
  and landed on the **post-sunset** bin. Because the star (`bestBlockIdx`) and the day-score
  best-4 h term both reward the single highest block, the app's "best window" fell **after
  last light** on **8/8** prime/cool gauges, and block 10 — captioned "fading light" — outscored
  the real hatch window. Confirmed live: 8/8 starred 8–10 PM before the fix.
- **Fix (index.html — one formula + its comment block).** `duskC = ssHr − (1.8 +
  1.2·springFall + 0.4·heat)`:
  - high summer: peak ~1.8 h before sunset (July center ≈ 19.4) → lands in **block 9 (6–8 PM)**;
  - shoulders: ~3.0 h before sunset → mid-evening (blocks 8–9), matching earlier spring/fall bugs;
  - heat pulls the window slightly **earlier** (was later) — warm late-afternoon is the day's
    lowest-margin water, directionally consistent with the `heatX` dusk-easing already present.
  The comment block was rewritten to document the fix and the bin-alignment reasoning.
- **Amplitudes / tilt reviewed, deliberately NOT re-tuned.** `dawnAmp = 0.40 + 0.18·heat`,
  `duskAmp = 0.50 + 0.20·heat` (dusk's modest lead), `heatX` thermal-refuge tilt, `pw`,
  `midBase`, and the cloud response are all left as shipped. The dusk-lead **direction** and
  the seasonal-homogeneity spread are literature-supported (Ovidio et al. 2002 — dusk-peak in
  all seasons + spring/summer homogenization; invertebrate-drift dusk peak); the specific
  amplitude magnitudes are **derived-in-repo** against the fly-shop "Good ≈ 7–8" anchor, and
  the refuge-tilt magnitudes / light floors are labeled **assumption**. All three splits are
  written into the new `03` `Sources` section.
- **Scope guards honored.** SHAPE only. No `_bandFor` MULT/HEAT edit (Phase-1 biology — light
  multiplies it, never redefines it). The two load-bearing `66`s (HEAT anchor `[66,0.72]` +
  the `t>=66` caption hinge) and `HOOT_OWL_F=73` / `STRESS_RED_F=70` confirmed **byte-identical**
  (only line numbers shifted +8 from the added comment lines). No `categoryScores` re-anchor
  (Phase 6). `06-*.md` untouched (ask-first).
- **Validation.** Extracted inline script → `node --check` clean. Headless run of the shipped
  engine vs live `data.json` (generatedAt 2026-07-12 14:08Z, 8 gauges): **post-sunset (8–10 PM)
  stars 8/8 → 0/8**; evening star now 6–8 PM; day scores on prime gauges rose ~0.3–0.7 (e.g.
  Lolo abv 6.0→6.4, East Fork 5.9→6.4) toward "Good ≈ 7–8"; Missoula (66.2 °F, heat 0.73)
  correctly keeps its **dawn** thermal-refuge star, confirming `heatX` untouched. Synthetic
  controls: May/Sep/Oct pull the peak progressively earlier as the day shortens (Oct even drops
  a post-sunset block 9 to the dark floor — correct, the fishable evening genuinely ends earlier);
  hot water (66/70 °F) dawn-leads; overcast lifts the midday blocks; null-temp floors at 1 with
  no NaN. `diff` vs `index-4-1` shows only the `duskC` line + its comment changed (plus the
  version stamp).
- **Deploy:** commit `index.html` (frontend-only). No `fetch-data.mjs`/`data.json` change; next
  Actions run unaffected. On the live site the "Optimum window"/star should shift from an
  8–10 PM read to the 6–8 PM evening hatch on prime-temp gauges — the visible Phase-5 change.

#### End-of-phase doc audit (standing rule — every logic file)
| Doc | Action | Note |
|---|---|---|
| `00-overview.md` | **no update needed** | System map; the shared conditions object and the block engine's *place* in the system are unchanged. Light-curve internals live in `03`. |
| `01-temperature.md` | **no update needed** | Temp estimation/forecast; untouched by a block-shape change. |
| `02-chart-forecasts.md` | **no update needed** | Forecast series (flow/stage/temp lines + confidence); Phase 5 changed block scoring, not any forecast line. |
| `03-bite-windows.md` | **REWRITTEN → `-5-1`** | Light-curve section (§Logic/calc 2) rebuilt to match shipped code: the fixed `duskC` placement with an inline Phase-5-fix note, `dawnAmp`/`duskAmp`/`heatX`/`pw`/`midBase` and cloud response documented, block-midpoint framing made explicit, flow section pointed to `07`, day-score note updated, and a new `Sources` section added (three-way cited/derived/assumption split, 🏔 regional preferred). |
| `04-where-to-fish.md` | **no update needed** | Gauge ranking; consumes `g.blocks` unchanged in shape. Rankings may shift slightly downstream but the doc's logic is untouched. |
| `05-whats-working-now.md` | **no update needed** | Rig engine copy; runs the old engine by design until Phase 6. Not touched. |
| `06-thermal-response-and-stress.md` | **no update needed** | Thermal/stress; ask-first doc, not touched. `03` cross-refs it for `band.mult`/`band.heat` and the two `66`s; `06` remains authoritative on the temp curve. |
| `07-flow.md` | **no update needed** | Flow dynamics (Phase 4); `03`'s flow paragraph now points to it, no reciprocal edit required. |
| `README.md` / `README-logic.md` | **no update needed this pass** | Logic-file listing still needs `07-flow.md` added (carried from Phase 4) — bundle that housekeeping with the Phase-9 consolidation so it isn't lost. |
| `MIGRATION.md` | **no update needed** | No data-shape migration; frontend scoring only. |

### 2026-07-12 (a) · Phase 4 CLOSED — flow, dynamics-first
- **Files delivered:** `index-4-1.html`, `07-flow-4-1.md` (new), `build-tracker-12.md`.
  `fetch-data.mjs` **unchanged** — all Phase-4 logic is frontend; the pipeline already
  emits the raw flow series the engine needs.
- **Root cause found (traced through live `data.json`, not memory).** Ran the actual
  `flowTrendFrom` against all 8 live gauges: `spike=0, clearing=0` on every one.
  `clearing` was **structurally dead** — it required a prior in-window crest (≥1.30× off a
  pre-rise base), but in a recession the peak is the *oldest* sample so no base precedes
  it, `isEvent` is always false, and `clearing` can never fire. Four gauges were falling
  10 days straight (the prime dropping-and-clearing window) and scored zero clearing while
  simultaneously eating a −20% static level penalty. That dead signal + the pinning level
  bands are why the day score froze across days of changing flow.
- **Fix (index.html):**
  - `flowTrendFrom` rewritten. `clearing` = `dayShape × drawdownShape × (1−spike)`, **no
    crest gate** — a clean recession is the signal (falling-day clock × drawdown off recent
    peak). `spike` = **rate-of-rise**: steepest single day-over-day rise in a 2-day window
    (one sharp day trips it; window filters lone sensor wobble).
  - `computeBlocks` `flowAdj`: removed the static `≥1.5×→0.80` / `≥1.25×→0.90` level
    penalties (they pinned 6/8 gauges to one step, 1.5×==2.7×). Dynamics now primary:
    spike −55%, clearing **+25%** (was +18%). Kept only the low-water × harsh-midday
    guardrail. True blowout is caught by `spike`, not a level threshold.
  - `blockReasons`: dropped the `ratio≥1.4 → 'big water'` level limiter (elevated-but-green
    water isn't a limiter); spike-driven off-color caption kept.
  - `categoryScores`: dynamics-aware notes (clearing → seams; spike → streamer); level
    bands reworded as fish-*location* context, not "×normal" penalty. **No score re-anchor
    (Phase 6).**
  - Context line: `ratio` relabeled "× recent median" (was "× normal").
- **`normal` demoted.** `computeNormal` is a this+last-year median (Bell "normal" 557 sits
  between this year's 1100+ and last year's ~600) — meaningless as a divisor. It's now
  informational context only; nothing in the bite score divides by it. This defuses the
  true-normal storage question for the bite. Specced (not built) in `07`: last-year as a
  **gradient/slope** reference (this-yr vs last-yr recession at the same calendar date) —
  precondition is verifying per-gauge `lastYear` calendar overlap (coverage is uneven).
- **Science, cited in `07`.** Rate-of-rise → turbidity and clockwise hysteresis (falling
  limb runs cleaner at equal flow) are the physical basis; turbidity → reduced reactive
  distance/feeding is the fish side (Sweka & Hartman 2001; Barrett et al. 1992). Westslope
  fine-sediment sensitivity flagged 🏔 (Weaver & Fraley 1991 via MT Chapter AFS). Thresholds
  honestly labeled derived-in-repo / assumption; hysteresis papers are general fluvial, not
  Bitterroot/cutthroat-specific — direction cited, magnitudes not overclaimed.
- **Validation.** Extracted inline script → `node --check` clean. Headless run of the
  shipped `flowTrendFrom`+`computeBlocks` vs live data: `clearing` now fires 0.4–0.75 on
  recessing gauges, `flowAdj` ranges 1.0–1.188 (reward, not flat penalty), gauges
  differentiate; two Lolo gauges that ticked up ~1% at the bottom correctly stay neutral.
  Synthetic controls: fast rise → spike 1.0; one sharp +57% day → spike 0.94; 3 gentle
  +5% days → spike 0; clean 5-day recession → clearing 1.0. Confirmed the two load-bearing
  `66`s, `HOOT_OWL_F=73`, `STRESS_RED_F=70` byte-identical (only line numbers shifted).
- **Scope guards honored:** flow only; no `categoryScores` re-anchor (Phase 6); no touch to
  the `66`s or stress/callout thresholds. `06-*.md` and `04` untouched.
- **Deploy:** commit `index.html` (frontend-only). No `fetch-data.mjs`/`data.json` change
  needed; next Actions run is unaffected. Day score should now respond day-to-day and
  gauges differentiate — the Phase-4 unlock in §4b.

#### End-of-phase doc audit (standing rule — every logic file)
| Doc | Action | Note |
|---|---|---|
| `00-overview.md` | **no update needed** | High-level map; flow's role unchanged at the overview level. Optional one-line pointer to `07` at Phase 9 consolidation. |
| `01-temperature.md` | **no update needed** | Temp estimation; untouched by flow. |
| `02-chart-forecasts.md` | **no update needed** | Flow *forecast tail* (GloFAS-anchored) and the terminal guard are unchanged; Phase 4 changed the *scoring* of flow dynamics, not the forecast series. `07` cross-refs it; no edit required. |
| `03-bite-windows.md` | **no update needed this pass** | The block engine's flow *inputs* changed but `03` describes block structure/light; its factor-4 flow mention now points conceptually to `07`. Flagged for a one-line cross-ref at Phase 6 when the engines unify. |
| `04-where-to-fish.md` | **no update needed** | Gauge ranking; **not** flow (the recurring naming trap). Untouched. |
| `05-whats-working-now.md` | **no update needed** | Rig engine copy; runs the old engine by design until Phase 6. `categoryScores` wording nudged but magnitudes unchanged — no doc change owed until the Phase-6 re-anchor. |
| `06-thermal-response-and-stress.md` | **no update needed** | Thermal/stress; ask-first doc, not touched. Low-water×thermal guardrail cross-refs it; no edit. |
| `07-flow.md` | **NEW — delivered** | Authoritative flow doc (`-4-1`). Dynamics-first logic, the dead-signal root cause, cited science, the demoted-`normal` note, and the specced last-year-gradient / true-normal open items. |
| `README.md` | **no update needed this pass** | Add `07-flow.md` to the logic-file listing at the next housekeeping/Phase-9 pass (noted here so it isn't lost). |
| `MIGRATION.md` | **no update needed** | No data-shape migration; frontend scoring only. |

### 2026-07-10 (e) · Tracker housekeeping — real logic-file map; flow doc = new 07-flow
- **File delivered:** `build-tracker-11.md` (docs-only; no code touched).
- **Corrected the logic-file map (§3)** to list the actual `logic/` files
  (`00`–`06` + `README`) instead of the vague "00–05 + README". Key fix: there is **no
  flow doc** — `04` is **where-to-fish**, not flow — so the Phase-4 flow doc is a **new
  `07-flow.md`** (next free number). The earlier Phase-4 prompt wrongly said "rewrite
  `04-flow`"; that file never existed.
- **§3 (standing end-of-phase doc rule)** made range-agnostic (audits every `logic/` file
  incl. new docs a phase introduces), and the **Phase-4 spec (§4 item 4)** now names its
  doc deliverable (`07-flow.md`) + upload set + scope guards.
- **Confirmed committed (Uber's repo screenshot):** `01-temperature` (rewrite), `02-chart-
  forecasts` (real-band doc), and `06-thermal-response-and-stress-3-3` are all in `logic/`.
  Phase 3 doc set fully landed.
- **No open items.** Phase 3 stays ☑ CLOSED. Next full phase: Phase 4 (flow, dynamics-first)
  — prompt + upload list ready; flow doc will be `07-flow-4-1.md`; tracker next is `-12`.

### 2026-07-10 (d) · Phase 3 CLOSED — live deploy verified; 06 rewritten (-3-3)
- **Live deploy verified (Uber).** The deployed site renders all 8 gauges; the chart
  forecast-warning chiclet + temps/dates hover work live; **Missoula reads green Stress +
  amber "Water Temp" callout** (screenshot confirmed) — the current-vs-forecast split holds
  on the real site, no contradiction. This was the last Phase-3 gate.
- **Phase 3 → ☑ CLOSED.** All four items done + integrated, mainstem gauges added, forecast
  band shipped, callout (card + chart) shipped, stress chiclet redefined to current-only.
  Consequences: Phase 1's `t==null` null branch is now **dead code** (an estimate always
  exists); Phase 2's coupling is satisfied. Both are re-checked (not re-opened) at Phase 6.
- **Doc audit (phase close) — explicit per-doc table:**
  | Doc | Status |
  |---|---|
  | `fetch-data` | Shipped `-3-3` (real forecast diel band). |
  | `index.html` | Shipped `-3-3` (roster 6→8, callout card+chart, stress current-only). |
  | `01-temperature` | No update needed (estimation model unchanged; band is presentation). |
  | `02-chart-forecasts` | Rewritten `-3-3` (real observed-spread band; callout consumer; `[S4]`). |
  | `06-thermal-response-and-stress` | **REWRITTEN → `-3-3`** — §3 stress ladder redefined to current-only (today's peak, `STRESS_TODAY_ORANGE_F=70` / `STRESS_TODAY_RED_F=73`); new §3b documents the forecast-warning callout (`tempCallout`, card pill + chart chiclet + hover); §3a trace re-run against live 8-gauge data; §5 `unknown→orange` marked dead code (Phase 3 closed); §6 Phase 3 → ☑ CLOSED. DO grounding (§4), curve (§1), citations (§7) untouched. |
  | `build-tracker` | This file → `-10` (bumped for the `06` rewrite + close-out edits; `-9` was the prior in-session version). |
  | `00`, `03`, `04`, `05`, `README`, `MIGRATION` | No update needed. |
- **Placeholder debt (owed to Phase 7):** Darby + Missoula carry Bell's mainstem rig
  verbatim as placeholders — real per-gauge rigs are a Phase-7 (fly selection) item, logged
  here so they don't silently become permanent.
- **Next full phase: Phase 4 (flow, dynamics-first).** Prompt + upload set prepared. First
  Phase-4 job: verify `flowTrend.spike`/`clearing` actually fire in live data (a dead
  `flowTrend` is the prime suspect for the frozen day score).

### 2026-07-10 (c) · Stress chiclet redefined: current-only (today's peak), not forecast
- **File delivered:** `index-3-3.html` (same version — this refines the same iteration's
  frontend). `node --check` clean; headless-tested against live `data.json`.
- **Problem (Uber spotted on Missoula):** the Stress chiclet read **red** while the
  forecast callout read **amber** on the same river — a visible contradiction. Root cause
  traced through real data: `waterStress` blended the 10-day measured trail **plus the
  forecast** on a flat **70/3-day** rule, and Missoula's measured water never reaches 70
  (peaks ~68.4 °F today) — the red run was **entirely forecast** (07-11/12/13 ≥70). So the
  chiclet was firing red off days the callout was (correctly) calling amber.
- **Decision (Uber):** **separate the two signals by meaning.** Stress = "is it stressful
  **right now**" → **today's peak (daily max) only**, measured or estimated, no trail, no
  forecast. The forward look belongs entirely to the callout. Single-day thresholds match
  the callout's language: **today's peak ≥70 → orange, ≥73 → red**, else green. (Red is the
  73 hoot-owl line in both places; orange starts at 70 in both — chosen to match the callout
  exactly rather than the old softer 68 nudge.)
- **Implementation:** `waterStress(wt)` rewritten to read the most-recent `thisYear` row's
  `max` (the pipeline writes a row dated `data.today` as the last entry). New constants
  `STRESS_TODAY_ORANGE_F=70` / `STRESS_TODAY_RED_F=73`. The old blended-trail-plus-forecast
  ladder is gone. Callout (`tempCallout`) unchanged — still forecast-only, amber ≥70 / red
  ≥73 over 3 consecutive days.
- **Invariants preserved:** `STRESS_RED_F=70` / `HOOT_OWL_F=73` constants retained (callout
  references them); the two load-bearing `66`s (HEAT anchor + dawn-hinge) untouched — they
  live in the bite engine, not `waterStress`.
- **Result (headless, live data):** every gauge's Stress now reflects today's real peak —
  all 8 green today (Missoula ~67, Bell ~64, forks 51–61). **Missoula: green Stress + amber
  callout** — the intended "fine now, warming Jul 11–13" story. No gauge shows red-Stress
  beside a non-red callout.
- **Doc flag (ask-first `06`):** this changes what "Stress" *means* (current-condition, not
  forward-looking), which is `06-thermal-response-and-stress` territory. **Not touched** —
  needs Uber's OK to edit. When approved, `06` should record: stress chiclet = today's peak,
  70/73 single-day; forecast warning = callout, 70/73 over 3 consecutive forecast days; the
  two are deliberately split by time horizon. Until then this log entry is the record.

### 2026-07-10 (b) · Forecast-max pipeline + forecast-warning callout + 6→8 roster — ☑ live-confirmed
- **Files delivered:** `fetch-data-3-3.mjs`, `index-3-3.html`, `02-chart-forecasts-3-3.md`,
  `build-tracker-9.md`. Both code files `node --check` clean; new logic headless-tested
  against the **live 8-gauge `data.json`** (generatedAt 2026-07-10 14:48Z — the pending
  live pull from the (a) entry is now in hand and confirms the gradient design).
- **Live-pull confirmation (traced through real data, not memory):** the uploaded `data.json`
  carries all 8 gauges (`…, darby, bell, msla`); Bell `estMethod:"mainstem-gradient"`,
  Darby/Missoula measured probes. Phase 3's "pending live pull" is satisfied.
- **PIPELINE half — real forecast diel band (`fetch-data-3-3.mjs`).** Root cause traced:
  `waterTempForecast` emitted **mean-only** rows for measured gauges (verified: all 5
  measured gauges' live forecast rows lacked `min`/`max`; the 3 estimated gauges already
  carried a band), so the frontend faked a forecast max with a render-time bump. Fix:
  derive each gauge's diel band from its **own `thisYear` observed spread** (avg `max−mean`
  up, `mean−min` down) and attach `min`/`max` to every forecast row; ±3 °F symmetric
  fallback only if no min/max history. Labeled in-file "from real observed spread —
  Phase-6 re-touch candidate." Verified with the real function: Missoula forecast now
  `{mean,min,max}`, band ≈ ±2.4 °F, means byte-identical to the pre-change file (band added,
  anchor/slope math untouched).
- **FRONTEND half (`index-3-3.html`).**
  - **Forecast-warning callout** — bottom-right of each card on the same flex row as
    "VIEWING BELOW" (`.viewing-row`, `justify-content:space-between`; hidden when nothing
    fires). Two tiers on the **forecast** daily max, `STRESS_RED_DAYS`/3-consecutive rule
    with `STRESS_FC_DROP=1`: amber **"Water Temp"** (≥`STRESS_RED_F` 70) and red
    **"Hoot-Owl Likely"** (≥`HOOT_OWL_F` 73). Reads the real forecast `max` from `data.json`,
    bump only as fallback. New `tempCallout(g)` fn (reads `g._wt`, same series as
    `stressChiclet`); CSS reuses `--t3-status-orange` / `--t3-status-red`. Fires on **every**
    warm gauge's card (grid-wide scan), not just the selected one.
    - **Mirrored onto the Flow & water-temp chart** (Uber, 2026-07-10): the same warning
      renders as a `.status-pill` in the temp chart's `legend-status` row (via `statusPills`,
      temp mode only), alongside the "last year — no data" pills, amber/red to match the card.
      **Hover shows the one-line why** (temps + dates only) via `title`, e.g. *"Forecast highs
      71–74°F, Jul 11–13"*. Chart is selected-gauge-only by nature (one chart shows at a
      time), so the explanation is inherently scoped to the open gauge. `tempCallout` now
      also returns the triggering run's date span + max range so card pill and chart
      hover draw from one computation.
  - **Roster 6→8** — Darby (`darby`) + Missoula (`msla`) added to `GAUGES` (Bell's mainstem
    rig copied verbatim per handoff), and to all five index-aligned arrays (`NEXT10`,
    `DAYFACTOR`, `DAYREASONS`, `SHORT`, `GAUGE_KEY`) in original pre-sort order. Header
    "5 gauges" → "8 gauges". Hydration is generic (`applyRealData` maps id→`_key`), so both
    new gauges auto-hydrate.
- **Acceptance check (headless, real data.json):** all 8 gauges render + hydrate (`_wt` set
  on every one). **Missoula → amber "Water Temp"** (forecast maxes 72.2 / 71.4 / 73.6 on
  07-11→07-13 = 3 consec ≥70; only 07-13 clears 73, so no red) — **matches the handoff's
  "Missoula amber on 2026-07-13" against this newer file.** Darby (peak ~65) and Bell (peak
  ~66.6) → no callout. Cards still sort alphabetically. Provenance intact: Missoula/Darby
  measured → "Stress" (no est tag); Bell estimated → "Status (est.)".
- **Note (not a contradiction):** Missoula's **stress chiclet** reads red while its callout
  reads amber. Different signals by design — the stress ladder blends history+forecast on
  one 70/3-day threshold (Missoula's forecast max ≥70×3 → red), the callout is
  forward-only and splits 70 (amber) from 73 (red, hoot-owl). Temp chiclet stays green
  (measured). Green-Temp + red-Stress on a *measured* gauge is the intended two-tier split,
  not the old green-Temp + orange-**est**-Stress artifact.
- **Deploy:** commit `fetch-data.mjs` (regenerates `data.json` with the real forecast band
  on next Actions run) **and** `index.html` (8 cards + callout). The callout works off the
  live file immediately via the bump fallback; the committed pipeline upgrades it to the
  real band.
- **Doc audit (per standing rule) — explicit per-doc table:**
  | Doc | Status this iteration |
  |---|---|
  | `02-chart-forecasts` | **REWRITTEN → `-3-3`** — §2c now documents the real observed-spread diel band on measured-gauge forecast rows (was mean-only → render-time bump); Outputs note the callout consumer; new source `[S4]`. |
  | `build-tracker` | **UPDATED → `-9`** — this entry + Phase-3 glance row (band + roster + callout + live-pull confirmed). |
  | `01-temperature` | **No update needed** — the estimation model (anchor+slope, gradient, seasonal floor) is unchanged; the band is a forecast-row *presentation* of the existing mean, not a change to how the mean is estimated. Cross-ref in `02-3-3 §2c`. |
  | `06-thermal-response-and-stress` | **No update needed / not touched** (ask-first doc). The callout reuses existing constants (`STRESS_RED_F`, `HOOT_OWL_F`, `STRESS_RED_DAYS`, `STRESS_FC_DROP`); no threshold or response-curve change. Flag for Uber: if the callout's two-tier forecast semantics should be recorded in `06`, that's a one-paragraph add — say the word. |
  | `00`, `03`, `04`, `05`, `README`, `MIGRATION` | No update needed. |
- **Still open (unchanged):** Phase 4 (flow dynamics), Phase 6 (recalibration incl. the
  forecast-band re-touch and `categoryScores` re-anchor). The `EMBEDDED_DATA` fallback
  fixture in `index.html` remains the old 6-gauge June-22 sample (cosmetic; live fetch
  supersedes it) — left as-is per handoff "optional."

### 2026-07-10 (a) · Phase 3 worked + mainstem gauges added — ☑ pending live pull
- **Files delivered:** `fetch-data-3-2.mjs`, `01-temperature-3-2.md`,
  `02-chart-forecasts-3-2.md`, `build-tracker-8.md`. `node --check` clean; new logic
  headless-tested against the real `data.json` (gradient, terminal guard, seasonal floor).
- **All four Phase-3 items done, each traced through real code + live `data.json`
  (not from memory):**
  1. **8-vs-11-day window** — root cause: estimated history was built off the weather
     axis (`past_days=7` → 8 rows) while measured came off the gauge feed (`HISTORY_DAYS`
     → 11). Fix: `PAST_WX_DAYS = HISTORY_DAYS`. Open-Meteo caps `past_days` at 92;
     `anchorIdx` is date-matched so “today”/split/anchor don’t move. All six gauges now
     share an 11-day axis.
  2. **Diel min/max (the big call)** — finding: the stress ladder already keys entirely on
     `.max` (68/70 are max thresholds), so “an afternoon touching 73 matters even if the
     mean is fine” is already baked in. The defect was on the *supply* side: estimated
     gauges fabricated a flat `max = mean+3`, understating the afternoon peak (Bell peak
     mean 63.7 → fake max 66.7, under the 68 line; a realistic +6 diel → ~69.7, over
     orange). **Decision: keep the single daily model, but derive estimated `max` from real
     data, not a constant** — resolved via the mainstem gradient below (Bell inherits real
     neighbour diel) and, for the small freestone estimate, the measured-freestone signal.
  3. **Warm bias + terminal guard** — the retired `(hi+lo)/2−6` model runs 5–7 °F warm vs
     real water (measured offset is −11 to −13 °F, not −6). But the *current* engine mostly
     cancels the bias because the forecast rides air **change**, not level, and history
     uses measured-water anchors — so no blanket correction (documented, not double-counted).
     **Terminal-day guard added upstream** in `fetch-data.mjs` (was frontend-only, stress-
     only): clamps a lone far-horizon air spike (observed 98→103→98) toward the local trend
     while leaving sustained warming/cooling trends untouched — verified on the real spike +
     smooth-trend controls.
  4. **No-unknown mandate** — closed the one structural hole: `estimateWaterTempV2` could
     return `mean:null`; it now falls to a seasonal floor and **never emits null**. Live
     `data.json` already shows no gauge hitting the unknown branch; this makes it true
     structurally too. The frontend `unknown → orange` branch (index.html L1440) and the
     `t==null` bite/band branches (L605/L943) are now provably dead — **closed upstream,
     no frontend recolor** (Phase 1’s null branch → can flip to full ☑ once verified live).
- **SCOPE EXPANSION (approved by Uber): two mainstem temp gauges added.** Uber’s call —
  Bell (1,963 mi², ~1,408 cfs) was borrowing a diel from 150–290 cfs forks, which is
  physically backwards (a big river damps its swing). Added **Darby (12344000, upstream,
  ~1,050 mi²)** and **Missoula (12352500, downstream, ~2,824 mi²)**, both mainstem probes.
  **Bell is now interpolated on the Darby↔Missoula gradient by drainage area** (Bell frac
  ≈ 0.515, mid-river), inheriting real big-river diel. Fallbacks per Uber’s spec:
  Darby missing → extrapolate Bell/Darby **cooler** (upstream); Missoula missing →
  extrapolate Bell/Missoula **warmer** (downstream); both missing → freestone estimator.
  Roster made explicitly extensible (add-a-gauge instructions in the config; mainstem
  gauges take a `drainageMi2` gradient axis; temp presence is auto-detected).
  - **Regulatory bonus:** the two gauges are FWP’s own reference stations — Darby = the
    **66 °F cutthroat** reach (upper), Missoula = the **73 °F** reach (lower) [🏔 FWP
    drought/hoot-owl plan]. Flag for **Phase 6**: this reach’s FWP cutthroat trigger is
    66 °F/3-day, stricter than the statewide 73 the two-tier line is anchored to.
- **Could NOT verify from the sandbox:** `waterservices.usgs.gov` is not in the egress
  allowlist, so a **live pull must run in CI/Actions (or locally)** to generate the
  regenerated `data.json`. **UPDATE 2026-07-10 — probe presence verified live** (Uber ran
  the USGS IV temp-only queries): Darby (12344000) 00010 ✓ real series (~10.6–15.3 °C ≈
  51–59 °F); Missoula (12352500) 00010 ✓ and warmest (~17.2–20.2 °C ≈ 63–68 °F, real
  afternoon peak already brushing the 68 °F orange line); **Bell (12350250) 00010 absent**
  (empty `timeSeries`; the ALL-params pull shows only 00060 discharge). So Darby + Missoula
  resolve as **measured** mainstem anchors and Bell as the **gradient fill** — exactly the
  design case. Validated the gradient against the real probe numbers: °C→°F conversion
  correct, Darby mean ≈ 54.9 → Missoula ≈ 65.7 (an ~11 °F mainstem rise), Bell interpolates
  to ≈ 60.4 (frac 0.515, correctly ordered) with a real ~6.5 °F diel. Note Darby's series can
  start a few days short (07-03 in the sample) and probes can gap — the gradient's per-date
  one-sided fallback covers any date a neighbour is missing.
- **Browser checks (temp-only; empty `timeSeries` = no probe):**
  `https://waterservices.usgs.gov/nwis/iv/?sites=12344000&parameterCd=00010&period=P7D&format=json`
  (Darby), `…sites=12352500…` (Missoula), `…sites=12350250…` (Bell — worth checking; if it
  returns temp, Bell flips to *measured* and instead anchors the gradient).
- **Run to regenerate `data.json`:** `node fetch-data.mjs` where USGS is reachable, or
  trigger the Actions workflow (`update-data.yml`, “Run workflow”).
- **Phase-3 doc audit (standing end-of-phase rule):**

  | Doc | Action |
  |---|---|
  | `01-temperature.md` | **REWRITTEN → `01-temperature-3-2.md`** — retires `(hi+lo)/2−6`; documents measured/estimated/forecast, the mainstem gradient, terminal guard, no-unknown floor; cited `Sources` (🏔). |
  | `02-chart-forecasts.md` | **REWRITTEN → `02-chart-forecasts-3-2.md`** — corrects the temp-forecast model to slope-coupling; adds the terminal-day guard section; cited. |
  | `06-thermal-response-and-stress.md` | **No update needed** — response curve + stress thresholds unchanged; Phase 3 only changed how the *number* feeding it is produced. (Phase-6 note logged re: 66 °F reach trigger.) |
  | `00`, `03`, `04`, `05`, `README`, `MIGRATION` | **No update needed** for Phase 3. `04` (flow baseline) still owns the true-normal question — untouched, per scope guard. |

- **Supersedes `build-tracker-6`.** Next full phase: **Phase 4 (flow, dynamics-first)** —
  and the multi-year “true normal” data-architecture decision, deliberately kept out of
  Phase 3.

### 2026-07-09 (e) · Phase-3 required-upload set captured as a requirement
- **Added rule 8 (phase-inputs rule):** every §4 phase declares a "Required to start
  (upload set)". Phase 3's set now embedded in §4 item 3 as a hard requirement (not
  just chat): must-have = tracker + `fetch-data.mjs` + current `data.json`;
  referenced = `01-temperature.md`, `02-chart-forecasts.md`, deployed `index.html`;
  optional = `06` (highest), `update-data.yml`. Scope guard: true climatological
  normal is Phase 4, not 3.
- **No code change.** Supersedes `build-tracker-5`. Prepared for a fresh Phase-3 chat.

### 2026-07-09 (d) · Montana / regional citations added to 06 (local support)
- **`06-thermal-response-and-stress-2-4.md` delivered** — adds Montana/regional
  sources (flagged 🏔), all verified via search:
  - **[S1] Bear, McMahon & Zale 2007** re-annotated as a **Montana study** (MSU +
    USGS Montana Coop Fishery Research Unit) — the primary local anchor for the
    response curve.
  - **[S6] Bell et al. 2021, *Science Advances* eabj5471** (**University of
    Montana** + USGS + FWP; ~22k Montana FWP surveys) — cutthroat cold-limited/
    declining under warming; supports species-specific "cutthroat governs."
  - **[S7] Montana FWP drought/hoot-owl policy** — the **regulatory basis for
    `HOOT_OWL_F=73`** (≥73 °F max, 3 consecutive days; ≥77 °F lethal); FWP's Jul-2024
    action names the **Bitterroot (E/W Fork confluence → Clark Fork)** as a hoot-owl
    reach — this drainage.
  - **[S8] Montana DEQ Circular DEQ-7 (2019)** — Montana's cold-water (salmonid)
    DO standard; state-level local counterpart to EPA 1986 for the DO floor.
  - **[S9] Drinan et al. 2012, *TAFS* 141:872–880** (MSU) — local adaptation in
    WSCT; supports per-reach overrides over a blended median.
- **Rule 7 extended:** prefer Montana/regional sources (🏔) where they exist.
- **No code change.** Supersedes `06-…-2-3` and `build-tracker-4`.

### 2026-07-09 (c) · Citation standing rule + phase-status summary + cited 06
- **Added standing rule 7 (citation discipline for logic docs):** every assumption
  → cited source where one exists; repo-computed values → **derived-in-repo**;
  judgement calls → **assumption**; each logic doc carries a `Sources` section with
  that three-way split. `06-…-2-3` is the reference example.
- **`06-thermal-response-and-stress-2-3.md` delivered** — same content as `-2-2`
  with the DO section's claims cited: Benson & Krause 1984 (DO-sat), U.S. EPA 1986
  EPA 440/5-86-003 (salmonid DO band), Macnaughton 2021 (metabolic/aerobic scope),
  Bear 2007 (thermal), USGS OWQ Tech Memo 2011.03 (altitude correction). Elevation
  table + floor-crossing temps explicitly labeled derived-in-repo; the actual-vs-sat
  fraction labeled assumption. Verified sources via search (not from memory).
- **Added "Phase status at a glance" table to §4.** Records exactly one phase fully
  CLOSED: **Phase 2**. **Phase 1 stays ☑ PROVISIONAL — NOT closed** (pending Phase 3
  null branch + Phase 6 recalibration); folding Gap B into Phase 3 does not touch
  Phase 1's own dependencies. Guard against marking Phase 1 done prematurely.
- **Supersedes `build-tracker-3.md`** (commit `-4`). No `index.html`/`fetch-data.mjs`
  change. `06-…-2-3` supersedes `-2-2`.

### 2026-07-09 (b) · Gap B folded into Phase 3 → Phase 2 CLOSED (☑)
- **Phase 2 → full ☑ (done & integrated).** Gap A (DO science) was already complete;
  Gap B (the `unknown → orange` coupling) **relocated to Phase 3**, where the actual fix
  lives (`fetch-data.mjs` guaranteeing every gauge an estimate — the no-unknown mandate).
  Gap B was never Phase-2 science, so this is a scope correction, not a status fudge:
  nothing in Phase 2's own remit remains open.
- **Phase 3 item 3** now carries Gap B explicitly: the no-unknown mandate is what makes
  the frontend `unknown → orange` fallback dead code (close upstream, no frontend recolor);
  terminal-day outlier guard tracked here too.
- **Docs:** no `06-…-2-2.md` change needed — it already frames the coupling as Phase-3
  work (§5/§6). This is a tracker-only reorganization. `index.html` / `fetch-data.mjs`
  unchanged. Supersedes `build-tracker-2.md` (commit `-3`).
- **Next:** Phase 3 (estimation completeness). It's now the single gate that flips
  Phase 1 (pending Phase 6 + null branch) and formally retires the ex-Gap-B branch.

### 2026-07-09 (a) · Phase 2 (DO / stress ladder) — Gap A closed, ☑ PROVISIONAL
- **Phase 2 Gap A (DO science) DONE, confirm-not-change.** Traced `waterStress`
  verbatim from the deployed `index.html`, `node --check` clean, ran headless against
  each gauge's real `series.watertemp` (= `g._wt`) + boundary/forecast/provenance
  scenarios. Behaves to spec: green <68 near-window max; orange when near-window
  (yesterday→+2 fc days) ≥68; red only on ≥70 for 3 consecutive days; lone 71 spike →
  orange (acute-vs-chronic split); `STRESS_FC_DROP` trims terminal fc day; provenance +
  null branch intact.
- **DO verdict:** 68/70 confirmed **science-shaped** — thermal-welfare thresholds whose
  mechanism is the O₂ supply/demand scissors, NOT DO-saturation numbers. DOsat ceiling
  (grounded in each gauge's own station pressure from the weather feed) doesn't cross the
  cold-water salmonid sublethal band (~6.5–7 mg/L) until ~76–81°F — above the 73° legal
  line. So the thresholds sit safely *inside* the DO danger zone; **no move.**
- **Elevation:** real physics (valley ~3,300 ft vs forks ~4,160–4,690 ft → high forks
  ~4–5% less DO/°; equal-cushion ≈ −3.4°F/1,000 ft) but **not wired** — anti-correlated
  with exposure (high gauges are the cold ones that never hit 68–70; warm gauges that do
  are at the valley reference). Parked as an optional default-off welfare-only offset.
- **Two-tier split reinforced:** welfare red 70 leads both the 73 legal line and the
  ~76–81°F DO cliff by 3–6°F — do not merge.
- **Code:** **no `index.html` / `fetch-data.mjs` change.** Thresholds unchanged; ladder
  already consumes the `wt.thisYear`/`wt.forecast` (`.max`/`.mean`/`.date`) the pipeline
  emits. Phase 2 changed a conclusion, not a number.
- **Gap B (coupling):** unchanged — soft dep on Phase 3; `unknown → orange` latent, not
  firing in live data. Full ☑ for Phase 2 waits on Phase 3 (makes that branch dead code),
  same way Phase 1 is provisional pending Phase 6.
- **Docs:** `06-thermal-response-and-stress-2-2.md` delivered (integrates the DO section
  into the Phase-1 doc; supersedes the accidental `-2-1` merge-section stub). `01`/`02` —
  Phase-3 territory, untouched. `00`,`03`,`04`,`05`,`README`,`MIGRATION` — no update.
- **Next:** Phase 3 (estimation completeness) — the bigger data-foundation lift; also the
  gate that flips both Phase 1 and Phase 2 from provisional to full ☑.

### 2026-07-05 (i) · Versioning + commit rules; first version-stamped delivery
- **Added rule 5 (file `-x-y` stamp), rule 5 tracker exception (`build-tracker-y.md`,
  global counter), rule 6 (paste-ready commit message on every repo file).**
- **This save point (NOT "end of Phase 2" — Phase 2/DO not started):** delivered
  `build-tracker-1.md`, `fetch-data-3-2.mjs` (the Phase-3 temp-forecast fix, to
  commit + deploy), `06-thermal-response-and-stress-1-1.md` (current thermal doc; also
  replaces the accidental `06-…(1).md` duplicate in the repo). `index.html` unchanged
  since deployed v9 — no re-deliver/commit needed.
- **Next:** Uber opted to go to **Phase 3** next (estimation completeness), deferring
  Phase 2 (DO grounding) — independent, can be picked up later.

### 2026-07-05 (h) · Phase 9 added — Documentation & IP consolidation
- **Added Phase 9** (final, runs after Phase 6): one authoritative pass reconciling all
  logic docs (`00`–`06`, `README`) against shipped code — the IP-defining artifact.
  Deferred past Phase 6 so it documents stable logic, not moving targets. Per-phase doc
  rule still applies in the meantime. Plan is now 9 items.
- **Housekeeping flag:** repo has `06-thermal-response-and-stress (1).md` — the `(1)`
  means GitHub kept a duplicate instead of replacing; dedupe. `01`/`02`/`04` remain the
  2-week-old drifted docs (Phase 9 / Phase 3 territory).

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
