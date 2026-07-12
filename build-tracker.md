<!-- version: build-tracker-14.md -->
# Bitterroot Dashboard — Build Tracker & Handoff

*This is the Phase-6 increment. It carries the new Status Log entry (top) and the
Phase-6 end-of-phase doc audit. Everything above the Status Log in build-tracker-13
is unchanged and should be carried forward verbatim; only §4 phase-status lines for
Phase 1 and Phase 6 move, plus this new log entry. Paste this file's Status Log entry
and audit onto build-tracker-13's body when reconciling.*

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
`02-chart-forecasts-6-1.md`, `06-thermal-response-and-stress-6-2.md`,
`07-flow-6-2.md`, `build-tracker-14.md`. (Option C preserved **inside** `05`
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
| `06-thermal-response-and-stress.md` | `_bandFor` curve + `HOOT_OWL_F`/`STRESS_RED_F` + max-keyed stress ladder all **byte-identical** — Phase 6 *reads* `06`'s authority, doesn't change it. | **DELIVERED → `06-thermal-response-and-stress-6-2.md`.** Five targeted additive edits (header note; §1 rig-engine-now-reads-the-curve + `heat` second consumer; §3b condition-aware forecast max + flat-fallback decision; §6 Phase-6 marked CLOSED with the flow-framing correction). No curve/threshold/DO/elevation change — verified diff touches only those 5 regions. |
| `07-flow.md` | Flow level demoted; the rate-of-rise/hysteresis science was **already cited** in this doc (it was written for the dynamics-first thesis). | **DELIVERED → `07-flow-6-2.md`.** §7d reconciled with shipped Phase-6 rig engine (scaled level bands → one coarse cue; the stale "not re-anchored — that is Phase 6" caveat resolved); header + Status updated; hysteresis-aware turbidity signal added as a future item. Sources block + §7a/7b/7c/7e byte-identical (verified). |
| `README.md` (logic) | File roster unchanged; no new doc introduced. | **No update needed.** |
| `MIGRATION.md` | No structural/data migration this phase. | **No update needed.** |

### Patch specs — both executed this pass

`06` and `07` were uploaded and delivered as `06-thermal-response-and-stress-6-2.md`
and `07-flow-6-2.md` (see audit rows above). Both edits were minimal and additive: no
change to any curve, threshold, the two `66`s, `HOOT_OWL_F`/`STRESS_RED_F`, the DO
grounding, the elevation table, or either Sources block (verified byte-identical by
diff). What changed: `06` §1/§3b/§6 now record that the rig engine reads `_bandFor`
(both engines share one temperature authority), the forecast max is condition-aware,
and Phase 6 is closed with the flow-framing corrected; `07` §7d is reconciled with the
shipped rig engine (scaled level bands collapsed to one coarse cue) and gains the
hysteresis-aware turbidity signal as a future item.

### Deferred to Phase 8 / later (logged)

- **Score-magnitude calibration** against fly-shop "Good ≈ 7–8" ground-truth (both
  engines) — Phase 8.
- **Last-year-as-gradient** flow signal (`07`) — precondition: verify per-gauge
  `lastYear` calendar overlap on live data.
- **Hysteresis-aware turbidity signal** (`07`) — event-state model addition; wants
  Phase-8 clarity ground-truth to calibrate.
- **True day-of-year climatological `normal`** (`07`) — needs 2–3+ prior years
  persisted against USGS IV / DNRC retention.
- **Thermal→hatch-timing coupling** (`05` Appendix) — belongs in the hatch subsystem,
  candidate Phase 7.
