<!-- version: 02-chart-forecasts-3-3.md -->
# 02 · Chart Forecasts (Flow, Stage, Temp Tail & the Terminal-Day Guard)

*Phase 3 rewrite. The pre-Phase-3 version described the water-temp forecast as a
`target = (hi+lo)/2 − 6`, “move 55 % of the gap, ±4 °F/day” model — that is retired.
The temp forecast is now a slope-coupled, anchor-based model (documented in `01` and
summarised here). This file also adds the **terminal-day guard**, new in Phase 3.*

Everything to the **right of the TODAY line** on the charts: the forward flow and
gauge-height (stage) curves, the water-temp forecast tail, and the per-day confidence
figure. All of it is modeled, hard-clamped, and — as of Phase 3 — passed through a
terminal-day artifact guard so a far-horizon spike can’t leak into any score.

---

## What it is

The forward continuation of each chart (flow, stage, temp) plus a per-day confidence
percentage. The engine builds forward from trustworthy signals only, with physical
clamps, and now with a guard on the unreliable far-horizon days.

---

## Inputs

- `series.flow.thisYear[]` means + `series.flow.latest.value` — the recession/GloFAS anchor.
- GloFAS river-discharge forecast (`floodForecast`) — trend shape, anchored to the latest
  real reading.
- `series.stage.latest` (or last `.thisYear` mean) + today’s flow — the stage rating anchor.
- `weather.daily[].hiF`/`.loF`/`.precipIn` — **after the terminal-day guard** — the air
  axis driving the temp forecast and the flow nudge.
- `normal.flow` — the absolute ceiling.

---

## Logic / calculation

### 2a. Flow — `anchorFlow` (GloFAS-anchored)

GloFAS gives the *shape* of the hydrograph (rising/falling, roughly how fast), not local
cfs. So the forecast is the GloFAS ratio applied to the latest real reading:
`forecastFlow_i = latestRealFlow × (glofas_i / glofas_today)`. Honest units, tied to the
observed snapshot, flagged forecast (never “measured”). Degenerate responses (fewer than
two usable days) are dropped rather than shown.

### 2b. Stage (gauge height)

**Not modeled independently** — derived from forecast flow through the gauge’s own
flow→stage rating (`fitRating`: `stage ≈ a + b·√flow`, fit from recent paired daily means),
so stage stays physically consistent with flow.

### 2c. Water temp — slope-coupled forecast (see `01`)

For **measured** gauges: anchor on the latest real probe reading and ride the air *change*
forward at the gauge’s own least-squares **air→water coupling slope** (clamped `[0.2, 0.6]`,
default `0.4`). For **estimated mainstem** gauges the forecast comes from the same
Darby↔Missoula gradient; for other estimated gauges it rides today’s value forward along
the air trend, damped. Full detail in `01-temperature.md`. The chart temp line is just this
forward array spliced onto the history at the TODAY index.

**Forecast diel band (Phase-3 re-touch, `-3-3`).** Each measured-gauge forecast row now
carries a real `min`/`max`, not just a `mean`. The band is the gauge’s **own observed daily
swing** — average `(max − mean)` for the upper half and `(mean − min)` for the lower half,
computed over that gauge’s real `thisYear` history — added symmetrically to the forecast
`mean`. This is characteristic per gauge (a big mainstem gauge like Missoula swings a
tighter band, ~±2.4 °F, than a small fork), so the forecast **max** that the stress ladder
and the frontend forecast-warning callout read is grounded in the gauge’s measured
behaviour, not a guessed constant or a render-time bump. Estimated gauges already carried a
band (mainstem gradient inherits its measured neighbours’ real min/mean/max; the freestone
estimator emits a modest ±3 °F). Fallback for a measured gauge with no usable min/max
history is a symmetric ±3 °F. **Phase-6 re-touch candidate** — a fixed diel offset is a
first approximation; a season- or flow-aware band is the eventual refinement. This closed
the gap where the frontend faked a forecast max by bumping the mean at render time; the
bump survives only as a fallback when a (stale, pre-band) `data.json` carries mean-only
forecast rows.

### 2d. Terminal-day guard (Phase 3, new)

**Problem.** Open-Meteo’s far-horizon daily rows occasionally spike implausibly — observed
air highs running 98 → **103** → 98 °F across the 8–9-day tail. Because the temp forecast,
the Tomorrow column, and the bite engine all derive from this air axis, an un-guarded spike
propagates into scores at the edge of the window.

**Fix.** Before any forecast is built, the last `TERMINAL_GUARD_DAYS` (= 2) forecast days
are each checked against a short **local trend** — the mean of the few forecast days
immediately before them. A day whose air-mid deviates from that local mean by more than
`TERMINAL_GUARD_MAXJUMP` (= 7 °F) is clamped toward the local trend (its diurnal hi–lo range
preserved). The guard operates on a **copy** of `weather.daily`; the raw feed is stored on
the gauge untouched, and any clamped day is tagged `_terminalGuarded`.

**Why local trend, not a fixed reference.** A lone far-horizon *artifact* jumps away from
its immediate neighbours; a legitimate *trend* (steady warming, a building heat wave) moves
smoothly and each day stays close to the local run. Judging against the local mean clamps
the artifact while leaving sustained trends alone — verified against the observed 103 °F
spike (clamped) and against smooth warming / cooling / heat-wave tails (all pass untouched).
This matters for welfare: flattening a genuine multi-day warming trend would *hide* a real
thermal-stress build, the opposite of what the stress ladder needs.

### 2e. Confidence

Per forward day, confidence starts high and decays with days-out, knocked down further when
the forecast leans on weather that diverges from last year over the same dates (a forecast
riding hard on the weather nudge is inherently less certain). Shown per-day on hover and as
an overall average in the chart corner.

---

## Assumptions

- GloFAS is a shape predictor, not a magnitude predictor; anchoring to the latest real
  reading supplies the magnitude.
- Stage must stay tied to flow through the rating curve — the two never drift apart.
- Water temperature lags and damps air; the forecast rides the air *change* at a damped
  slope, never air 1:1.
- The far-horizon (last ~2) forecast days are the least reliable and warrant a guard; the
  guard is deliberately conservative (clamps lone spikes, preserves trends).
- USGS timestamps are true UTC; DNRC StAGE timestamps are face-value Mountain local (handled
  upstream in the stage helpers, not here).

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain | Null behavior |
|-------|---------------|----------------|---------------|
| Flow anchor | `series.flow.latest.value` | → last `thisYear[].mean` | no forecast; history only |
| Flow shape | GloFAS `floodForecast` | (none) | no forecast produced |
| Stage | forecast flow + rating | → last `stage.thisYear[].mean` anchor | stage line not drawn |
| Temp forecast | air *change* × slope (measured) / gradient (est.) | → hold anchor | day omitted |
| Air axis | `weather.daily` **post terminal-guard** | (none) | no forward movement |
| Ceiling | `normal.flow` | (none) | relative clamps only |

---

## Outputs

- `series.flow.forecast[]`, `series.stage.forecast[]`, `series.watertemp.forecast[]` —
  forward arrays spliced onto each history line at the TODAY index. Measured-gauge
  `watertemp.forecast[]` rows now carry `{date, mean, min, max, forecast}` (real diel band,
  §2c); estimated gauges already did.
- Per-day + average **confidence** in the chart corner.
- Guarded air axis feeds the Tomorrow column and the bite engine (`03`), so the terminal
  spike is neutralised everywhere, not just on the chart.
- The forecast `max` is consumed by the frontend’s **forecast-warning callout** (amber
  “Water Temp” at ≥70 °F / 3 consecutive forecast days; red “Hoot-Owl Likely” at ≥73 °F /
  3 consecutive), which uses the same `STRESS_FC_DROP` terminal-day drop as the stress
  ladder. Before the band, that callout (and the stress ladder) fell back to a render-time
  mean-bump; the real band removes the guess.

---

## Status

**Live** off real conditions. Flow dynamics (self-relative rise/clearing) are reworked in
**Phase 4**; this file covers the forecast *tails* and the terminal guard as they ship now.

---

## Sources

- **[S1] Terminal-day artifact** — *derived-in-repo* (observed in the live Open-Meteo
  forecast tail, `data.json`); guard thresholds (`TERMINAL_GUARD_DAYS`, `MAXJUMP`,
  `LOOKBACK`) are *assumption*, tuned against the observed spike + smooth-trend controls.
- **[S2] GloFAS anchoring & rating curve** — *derived-in-repo* (method: ratio-anchoring to
  latest reading; `a + b·√flow` least-squares rating from paired daily means).
- **[S3] Air→water coupling slope** — *derived-in-repo* from each gauge’s measured history
  (clamped [0.2, 0.6], default 0.4). Cross-ref `01`.
- **[S4] Forecast diel band** — *derived-in-repo* from each gauge’s own `thisYear` observed
  spread (mean of `max−mean` up, `mean−min` down); ±3 °F symmetric fallback is *assumption*.
  Phase-6 re-touch candidate (season/flow-aware band).
