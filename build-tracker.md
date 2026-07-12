<!-- version: build-tracker-15.md -->
# Bitterroot Dashboard — Build Tracker & Handoff

*Phase-6 increment + post-Phase-6 roadmap revision (2026-07-12). Carries: the Phase-6
Status Log entry and end-of-phase doc audit (below), a species-composition decision
note (doc-only, `06` → `-6-3`), and a **revised roadmap for Phases 7–11** reflecting the
design discussion after Phase 6 closed. Everything above the Status Log in
build-tracker-13 is unchanged and carried forward verbatim; §4 phase-status lines for
Phase 1 and Phase 6 move, and the §4 numbered list for Phases 7–9 is superseded by the
"Revised roadmap (Phases 7–11)" section near the bottom. Paste this file's Status Log,
audit, and roadmap onto build-tracker-13's body when reconciling.*

---

## §4 phase-status line changes (apply to the table + numbered list)

- **Phase 1 · Response curve → ☑ (done & integrated).** Was ☑ PROVISIONAL. The two
  downstream couplings it waited on are now closed: the `t==null` null branch went to
  dead code at Phase 3, and the `categoryScores` re-anchor landed at Phase 6. No longer
  provisional.
- **Phase 6 · Integration & re-calibration → ☑ (done & integrated, 2026-07-12).** Was
  ☐. `categoryScores` re-anchored to `_bandFor` (shared cutthroat authority); flow level
  demoted to a coarse location cue (dynamics unchanged); forecast diel band made
  condition-aware. "Four identical scores" resolved at the assembly level on all measured
  gauges. Final score-magnitude calibration against fly-shop reports remains **Phase 8**.
- **Phases 7–9 · renumbered/rescoped + Phases 10–11 added.** The §4 numbered list's old
  entries for Phase 7 (fly selection) and Phase 9 (doc/IP) are **superseded** by the
  "Revised roadmap (Phases 7–11)" section near the bottom of this file: Phase 7 is now
  narrow (calc fine-tune + tables), Phase 8 gains the time-critical snapshot logger,
  Phase 10 (hatch-prediction engine) and Phase 11 (conditional IP update) are new. Apply
  by replacing the §4 7–9 list items with that section.

---

## Status Log

### 2026-07-12 · Phase 6 closed (done & integrated) — engine re-anchor + condition-aware band

**Three independent fixes, two files, all validated headless against the live 8-gauge
`data.json` before delivery.**

**Fix 1 — temperature re-anchor of `categoryScores` (`index-6-1.html`).** Replaced the
parallel 7-step temperature bands with a continuous read of `_bandFor`'s `mult` + `heat`
— the same westslope-cutthroat authority the bite engine uses. `mult` sets the activity
budget + surface drive; `heat` (via a **soft** suppression ramp) tilts share to
subsurface as water warms; a cold ramp handles the cold-water subsurface tilt. Root
cause confirmed on live data first: four measured gauges (56.1/56.4/57.5/59.6 °F) had
been collapsing onto one identical vector `{d39 n42 dd40 s38}`. **Result:** four-way tie
broken — every measured gauge now distinct; Missoula (66.2 °F) correctly nymph-led. An
initial hard-knee `hs` re-collapsed the plateau; switched to a soft ramp (gentle signal
below 0.42, steep above) so 56/57.5 °F differ slightly as they should. Invariants held:
no new threshold constants, the two `66`s and 73/70 byte-identical, `_bandFor` MULT/HEAT
untouched (read, not redefined).

**Fix 2 — flow level demotion (`index-6-1.html`, same function).** Science search
(turbidity/reactive-distance + rising-limb hysteresis) established that off-color/bite
suppression is a **rate-of-rise** phenomenon already carried by `spike`/`clearing`
(unchanged from Phase 4); absolute **level** only relocates fish and rides a
non-climatological `normal`. So the *original brief's* ratio-scaled ramp was dropped as
false precision on the wrong axis — the scaled `≥1.2×/≥1.4×/≤0.8×` branches collapse to
one small, coarse, **unscaled** location nudge labeled "vs. recent flow." The
turbidity/hysteresis-aware upgrade is logged for `07`, now with citations.

**Fix 3 — condition-aware forecast diel band (`fetch-data-6-1.mjs`).** The flat
per-gauge average band was systematically biased (daily range scales with the air–water
differential, reduced by volume/turbidity), **understating** `max` on hot/clear/low-flow
days — the days the stress ladder + hoot-owl callout most care about. Now each forecast
day's band scales by its air–water differential, bounded to the gauge's **observed**
swing extreme, never creating hoot-owl from band alone. **Result (live hot forecast):**
`max` +0.8–2.0 °F on hot days, surfacing stress days on lolo-hwy93 and additional
hoot-owl days on Missoula that the flat band left under 70/73 — all within each gauge's
measured extreme. Guardrails verified: envelope ceiling held on all gauges/days; the one
day flagged by an over-strict check (Missoula mean 69.5 → max 73.3) is real diel physics
at the gauge's observed 3.8 °F extreme, not band inflation.

**Frontend fallback decision (recorded for the docs, deliberately NOT changed):** the
`tempCallout` render-time `mean + average-spread` fallback (`index.html` ~line 1140) is
**left flat** (average, not hardened to max-spread). With Fix 3, every fresh measured-
gauge row carries a real `max`, so the fallback is dead code on any current `data.json`
and runs only on stale mean-only rows. User prioritizes **minimal swing variance**;
Option 1 (average) chosen over Option 2 (max-spread fail-safe).

**Validation surfaces:** `node --check` clean on both files; headless `categoryScores`
on live 8 gauges (tie broken); headless `waterTempForecast` before/after `max` deltas +
envelope-guard check on live data.

**Deliverables (this iteration):**
`index-6-1.html`, `fetch-data-6-1.mjs`, `05-whats-working-now-6-1.md`,
`02-chart-forecasts-6-1.md`, `06-thermal-response-and-stress-6-3.md`,
`07-flow-6-2.md`, `build-tracker-15.md`. (Option C preserved **inside** `05`
as an appendix — no standalone file. The scratch `option-c-preserved.md` is superseded
by `05`'s appendix and need not be committed.)

**Commit messages:** shipped with the code files (subject `type: (versioned.ext):
subject` + body).

---

## Phase-6 end-of-phase doc audit

*Standing rule: every logic file gets an updated markdown, a new doc, or an explicit
"no update needed."*

| Doc | Phase-6 status | Action |
|---|---|---|
| `00-overview.md` | No engine change affects the overview text. | **No update needed.** |
| `01-temperature.md` | Temp *estimation* + slope model unchanged; only the forecast *band* changed, which lives in `02`. Optional one-line pointer to `02` §2c. | **No update needed** (optional cross-ref only). |
| `02-chart-forecasts.md` | Forecast diel band method changed (flat → condition-aware). | **DELIVERED → `02-chart-forecasts-6-1.md`.** §2c rewritten; Sources [S4] added. |
| `03-bite-windows.md` | Bite engine already read `_bandFor`; Phase 6 didn't touch it. | **No update needed.** |
| `04-where-to-fish.md` | Ranking consumes scores but its own logic is unchanged; magnitudes settle at Phase 8. | **No update needed.** |
| `05-whats-working-now.md` | Primary rewrite target — rig engine re-anchored + flow demoted. | **DELIVERED → `05-whats-working-now-6-1.md`.** §5a rewritten; Option C appendix added; Sources added. |
| `06-thermal-response-and-stress.md` | `_bandFor` curve + `HOOT_OWL_F`/`STRESS_RED_F` + max-keyed stress ladder all **byte-identical** — Phase 6 *reads* `06`'s authority, doesn't change it. | **DELIVERED → `06-thermal-response-and-stress-6-3.md`.** Phase-6 edits (header; §1 rig-engine-reads-the-curve + `heat` second consumer; §3b condition-aware forecast max + flat-fallback decision; §6 Phase-6 CLOSED + flow-framing fix) **plus** the `-6-3` follow-up (§1a species-composition table + `[S10]`; single-curve decision recorded). No curve/threshold/DO/elevation change — verified byte-identical. |
| `07-flow.md` | Flow level demoted; the rate-of-rise/hysteresis science was **already cited** in this doc (it was written for the dynamics-first thesis). | **DELIVERED → `07-flow-6-2.md`.** §7d reconciled with shipped Phase-6 rig engine (scaled level bands → one coarse cue; the stale "not re-anchored — that is Phase 6" caveat resolved); header + Status updated; hysteresis-aware turbidity signal added as a future item. Sources block + §7a/7b/7c/7e byte-identical (verified). |
| `README.md` (logic) | File roster unchanged; no new doc introduced. | **No update needed.** |
| `MIGRATION.md` | No structural/data migration this phase. | **No update needed.** |

### Patch specs — both executed this pass

`06` and `07` were uploaded and delivered as `06-thermal-response-and-stress-6-3.md`
and `07-flow-6-2.md` (see audit rows above). Both edits were minimal and additive: no
change to any curve, threshold, the two `66`s, `HOOT_OWL_F`/`STRESS_RED_F`, the DO
grounding, the elevation table, or either Sources block (verified byte-identical by
diff). What changed: `06` §1/§3b/§6 now record that the rig engine reads `_bandFor`
(both engines share one temperature authority), the forecast max is condition-aware,
and Phase 6 is closed with the flow-framing corrected; `07` §7d is reconciled with the
shipped rig engine (scaled level bands collapsed to one coarse cue) and gains the
hysteresis-aware turbidity signal as a future item.

**Follow-up doc pass (2026-07-12, doc-only, no code):** `06` advanced `-6-2` → `-6-3`
with a new **§1a species-composition-by-reach** table + source **[S10]** (FWP
electrofishing, Lindstrom 2022 / SWFMP), recording the reviewed decision to KEEP the
single cutthroat curve — welfare ceiling locked to the coldest-adapted species
(conservatively protects warmer-tolerant browns/rainbows), feeding-window *timing*
shared across the three salmonids (bite chart already covers it). Curve/threshold/DO
byte-identical. **Confirms the current design; no program change.**

### Deferred to Phase 8 / later (logged)

- **Score-magnitude calibration** against fly-shop "Good ≈ 7–8" ground-truth (both
  engines) — Phase 8.
- **Last-year-as-gradient** flow signal (`07`) — precondition: verify per-gauge
  `lastYear` calendar overlap on live data.
- **Hysteresis-aware turbidity signal** (`07`) — event-state model addition; wants
  Phase-8 clarity ground-truth to calibrate.
- **True day-of-year climatological `normal`** (`07`) — needs 2–3+ prior years
  persisted against USGS IV / DNRC retention.
- **Thermal→hatch-timing coupling** — the degree-day emergence question; now scoped as
  its own **Phase 10** (see roadmap below), not a `05`-appendix footnote.

---

## Revised roadmap (Phases 7–11) — supersedes the §4 numbered list for 7–9

*Set during the post-Phase-6 design discussion (2026-07-12). Phases 1–6 are done &
integrated (see the status table). This section is the current plan for everything after.
The guiding decision from that discussion: **each phase must ship on data it actually
has** — which is why the big new science (the hatch engine) is sequenced LAST, after the
ground-truth and history it needs have been accumulating.*

### Phase 7 · Fly selection + `calcPicks` fine-tune — NARROW, actionable next
*rigor C (local) for the tables; rigor B for the calc fix.*

Two parts, both low-risk and buildable on current data:

1. **`calcPicks` fine-tune (the traced bug).** `calcPicks` (`index.html` ~L691) is the
   real-time / data-driven "today" suggestion, but it reads only a thin slice of the
   environmentals through its OWN coarse step-buckets (`t<50`, `ratio>=1.25`, cloud) and
   is **blind to flow dynamics**. Live trace (2026-07-12, all 8 gauges): the drainage is
   in a textbook clearing recession (`spike=0`, `drawdown 0.33–0.61` everywhere), yet
   calc reads the high *level* and says "high water → bigger" on every gauge — backwards;
   the dynamics say downsize & fish the clearing seams. This is the SAME level-vs-dynamics
   confusion Phase 6 fixed in `categoryScores`, one function over. Fix: feed calc the full
   conditions object (add `spike`/`clearing` + precip), replace its private step-buckets
   with the same continuous reads the rest of the system uses. **Today-only** (no forecast
   horizon — calc is today's pick by definition; there is no separate "RT" source). Same
   validate-first flow: trace → before/after picks on live 8 gauges → deliver.
2. **Fly tables + real rigs.** Enrich the authored tables (`HATCH_FLY`, per-gauge `rig`,
   `SEARCH_FLY`) with local Bitterroot knowledge; give Darby & Missoula real rigs (they
   currently carry Bell's, copied — owed since Phase 3).

*Scope guard:* narrow only. Does NOT build the hatch-emergence model (Phase 10) and does
NOT re-plumb the hatch calendar — `hatchesForMonth` stays a calendar this phase. Does NOT
touch the welfare ceiling or `_bandFor`.
*Ask-before-edit:* `index.html`.

### Phase 8 · Shop reports + dated environmental snapshot — external/user-owned + TIME-CRITICAL logger
*ground-truth acquisition; unblocks Phases 7-calibration and 10.*

- **Shop pull.** Auto-pull the fly shop's dated fishing report (picks + reported hatches).
  Role: a **confirmation/confidence signal** (badge when shop agrees with the model's top
  pick, like the existing "matches seasonal" flag) and the ground-truth for score-magnitude
  calibration ("Good ≈ 7–8"). NOT a symmetric 4th pick row — keep the layout tight.
- **Dated snapshot logger (TIME-CRITICAL).** On each shop-report date, freeze this app's
  own environmentals for ALL rivers — daily water temp + accumulated degree-days from
  season start, flow + `flowTrend`, the day's weather — stored PAIRED with the shop's
  report. Over a season this builds a labeled set: "conditions looked like X, shop
  confirmed bugs Y were hatching." **This logger must ship and start banking data as early
  as possible — it can only accumulate going forward; a passed date can't be
  retroactively snapshotted.** It is the data-acquisition engine for Phase 10.
- *Open technical risk:* is the target shop's report a stable dated page (clean fetch) or a
  fragile scrape? First Phase-8 task = verify pullability. Shop(s) TBD by Uber.

### Phase 9 · Doc / IP consolidation (current system) — FINAL for Phases 1–6/7
*runs after the engines are settled; documents the system AS IT STANDS.*

Single authoritative pass reconciling every logic doc against shipped code — the deliverable
that defines the IP as it exists today (encoded fisheries reasoning, calibration decisions,
estimation methods). Timing unchanged: after the engines are unified/recalibrated (Phase 6
done) so it documents a settled target, not a moving one.

### Phase 10 · Hatch-prediction engine — the big new science (build LAST)
*rigor A (new science); the largest single build in the roadmap.*

A degree-day + photoperiod + flow emergence model → live "what's ACTUALLY hatching this
year, now and imminent," replacing the flat calendar as `calcPicks`' candidate source. This
is the genuine bug-science layer: insect emergence is a THERMAL-HISTORY INTEGRAL
(accumulated degree-days), a fundamentally different input than the snapshot conditions the
fish engines read — which is why it can't live inside calc and must be its own engine.

**Hard preconditions (why it's last):** (a) a season+ of accumulated daily-temp history per
gauge to compute degree-days; (b) the Phase-8 paired shop snapshots to VALIDATE per-taxon
emergence thresholds against — these are regionally specific and worthless unguessed.
Building this before (a) and (b) exist = a confident-looking model that's quietly wrong (the
exact failure mode the project has avoided throughout). Also folds in the thermal→hatch-timing
coupling logged from `05`.

### Phase 11 · IP update (post-Phase-10) — CONDITIONAL on Phase 10 validating
*the "groundbreaking" layer — documented only if it proves out.*

Phases 1–9 encode ESTABLISHED science. Phase 10, if it works, PRODUCES NEW validated
knowledge: calibrated per-taxon emergence thresholds for this drainage, from a purpose-built
timestamped ground-truth set — not in the literature as a running system. Phase 11 consolidates
that new knowledge (the calibrated model, the snapshot-validation methodology, the results) as
its own defensible IP artifact. **Explicitly conditional:** its value is entirely downstream of
Phase 10 actually validating against real shop data. If the degree-day model doesn't beat the
flat calendar on the snapshots, there's no groundbreaking result to consolidate — only a
negative finding (worth recording, not an IP artifact). Written into the roadmap as contingent,
per the "validate before you claim it" discipline.

### Sequence & rationale

**7 → 8 → 9 → 10 → 11.** 7 ships now on current data (fixes the backwards calc advice). 8
starts the ground-truth + snapshot accumulation flowing (its logger is time-critical). 9
consolidates the settled current-system IP. 10 builds the hatch engine on the history + ground-
truth that 8 has been banking. 11 documents 10's new knowledge — if it validates. Each phase
ships on data it has; the biggest new engine is built last, on a real foundation, not in the dark.

### Species composition — CLOSED, no program change (2026-07-12)

Reviewed whether the multi-species reality (cutthroat-dominant upper → rainbow/brown lower;
FWP [S10]) needs a per-species bite chart or per-reach feeding curve. **Decision: no.** Welfare
ceiling stays locked to the coldest species (cutthroat) — conservatively protects the warmer-
tolerant species on mixed reaches; feeding-window *timing* is shared across the three salmonids,
already covered by the bite chart. Documented in `06` §1a (`-6-3`). No code change. A future
per-reach *feeding*-magnitude weighting remains an available hook (must keep the welfare ceiling
locked), but is not scheduled.
