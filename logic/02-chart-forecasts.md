<!-- version: 02-chart-forecasts-6-1.md -->
# 02 · Chart Forecasts (Flow, Stage, Temp Tail & the Terminal-Day Guard)

*Phase 6 update. The **forecast diel band** (§2c) changed from a flat per-gauge
average to a **condition-aware** band that scales each forecast day with its
air–water differential, bounded to the gauge's own observed swing. Everything else —
the flow/stage forecasts, the slope-coupled temp mean, the terminal-day guard,
confidence — is unchanged from the Phase-3 rewrite. The retired band method and its
rationale are noted inline for git-history continuity.*

Everything to the **right of the TODAY line** on the charts: the forward flow and
gauge-height (stage) curves, the water-temp forecast tail, and the per-day confidence
figure. All of it is modeled, hard-clamped, and passed through a terminal-day
artifact guard so a far-horizon spike can't leak into any score.

---

## What it is

The forward continuation of each chart (flow, stage, temp) plus a per-day confidence
percentage. The engine builds forward from trustworthy signals only, with physical
clamps, and with a guard on the unreliable far-horizon days.

---

## Inputs

- `series.flow.thisYear[]` means + `series.flow.latest.value` — the recession/GloFAS anchor.
- GloFAS river-discharge forecast (`floodForecast`) — trend shape, anchored to the latest
  real reading.
- `series.stage.latest` (or last `.thisYear` mean) + today's flow — the stage rating anchor.
- `weather.daily[].hiF`/`.loF`/`.precipIn` — **after the terminal-day guard** — the air
  axis driving the temp forecast and the flow nudge.
- `normal.flow` — the absolute ceiling.

---

## Logic / calculation

### 2a. Flow — `anchorFlow` (GloFAS-anchored)

*(Unchanged.)* GloFAS gives the *shape* of the hydrograph, not local cfs, so the forecast
is the GloFAS ratio applied to the latest real reading:
`forecastFlow_i = latestRealFlow × (glofas_i / glofas_today)`. Honest units, tied to the
observed snapshot, flagged forecast. Degenerate responses (fewer than two usable days)
are dropped.

### 2b. Stage (gauge height)

*(Unchanged.)* Not modeled independently — derived from forecast flow through the gauge's
own flow→stage rating (`fitRating`: `stage ≈ a + b·√flow`), so stage stays physically
consistent with flow.

### 2c. Water temp — slope-coupled forecast + condition-aware diel band

For **measured** gauges: anchor on the latest real probe reading and ride the air
*change* forward at the gauge's own least-squares **air→water coupling slope** (clamped
`[0.2, 0.6]`, default `0.4`). For **estimated mainstem** gauges the forecast comes from
the Darby↔Missoula gradient; for other estimated gauges it rides today's value forward
along the air trend, damped. Full detail in `01-temperature.md`. The chart temp line is
this forward *mean* array spliced onto the history at the TODAY index.

**Forecast diel band (Phase-6, condition-aware, `-6-1`).**

*Retired (Phase-3 `-3-3`):* each forecast row carried a **flat** band — the gauge's
*average* observed half-swings (`avg(max−mean)` up, `avg(mean−min)` down), the same
constant added to every forecast day. This was labeled in-file a "Phase-6 re-touch
candidate," and the reason is now explicit: a flat band is **systematically biased**.
The daily temperature range is not constant — it is largest when the air–water
differential is greatest and is reduced by higher volume and turbidity (small summer
streams swing ~6 °C, large rivers less; low summer flows widen the swing; see Sources
[S4]). So the flat band **understates** the forecast `max` on hot / clear / low-flow
days — precisely the days the stress ladder and hoot-owl callout care about — and
overstates it on cool / high-water days. On the live hot mid-July forecast, the flat
band held every day at the gauge mean swing while real afternoon peaks ran 0.8–2.0 °F
higher, so genuinely stressful afternoons could fall just under the 70/73 lines
unwarned.

*Shipped (Phase-6):* the gauge's average half-swings remain the **baseline**
(`baseUp`/`baseDn`), but each forecast day's band is **scaled** by a condition factor
`f`:

```
f = |air_mid_day − forecast_mean_day| / baseDiff           // this day's differential vs the gauge's average
f = clamp(f, NARROW_FLOOR = 0.6, WIDEN_CAP = 1.6)
spreadUp = min(maxUp, baseUp · f)                          // never exceed the gauge's real observed extreme
spreadDn = min(maxDn, baseDn · f)
```

where `baseDiff` is the gauge's **mean historical** air–water differential (the
differential the average band is "sized for"), and `maxUp`/`maxDn` are the **widest real
half-swings the gauge has actually shown** — a hard envelope ceiling. So a hot day
(large differential) widens the band toward, but never beyond, the gauge's own measured
extreme; a cool day narrows it. The band is per-gauge characteristic (a big-river gauge
like Missoula runs ~±2.5 °F average vs ~±4.5 °F on the forks) and now also
per-**day** characteristic.

**Guards (verified headless on live data):**
- The band half-widths are capped at the gauge's **observed** extreme (`maxUp`/`maxDn`)
  — a scaled band can never invent a swing the gauge has not physically shown.
- The band never manufactures hoot-owl status on its own: where the forecast `max`
  reaches 73 °F, it is because the **mean** is already high (e.g. Missoula mean 69.5 °F +
  the gauge's real ±3.8 °F extreme swing = 73.3 °F), not because a cool mean was paired
  with a fabricated wide band.
- `min` floors at 32 °F; `mean` floors at 33 °F (unchanged).

**Fallbacks:** a measured gauge with no usable min/max history falls back to symmetric
±3 °F baseline (then scaled by `f`). Estimated gauges are unchanged — mainstem-gradient
gauges inherit their measured neighbours' real min/mean/max; the freestone estimator
emits a modest ±3 °F.

*(Frontend note: the `index.html` render-time callout has a legacy `mean + average-spread`
fallback for rows that arrive without a real `max`. With the condition-aware pipeline
band, every fresh measured-gauge forecast row now carries a real `max`, so that fallback
is dead code on any current `data.json` and runs only on stale mean-only rows. It is
deliberately left flat — see `05`/`06` doc notes — because the user prioritizes minimal
swing variance and the fallback no longer runs on live data.)*

### 2d. Terminal-day guard (Phase 3, unchanged)

Open-Meteo's far-horizon daily rows occasionally spike implausibly. Before any forecast
is built, the last `TERMINAL_GUARD_DAYS` (= 2) days are checked against a short local
trend; a day whose air-mid deviates from that local mean by more than
`TERMINAL_GUARD_MAXJUMP` (= 7 °F) is clamped toward the trend (its hi–lo range
preserved). Operates on a copy; raw feed stored untouched; clamped days tagged
`_terminalGuarded`. Local-trend judging clamps lone artifacts while leaving genuine
warming/heat-wave trends alone — important for welfare, since flattening a real warming
trend would hide a thermal-stress build.

### 2e. Confidence

*(Unchanged.)* Per forward day, confidence starts high and decays with days-out, knocked
down further when the forecast leans on weather diverging from last year over the same
dates. Shown per-day on hover and as an overall average in the chart corner.

---

## Assumptions

- GloFAS is a shape predictor, not a magnitude predictor; anchoring to the latest real
  reading supplies the magnitude.
- Stage must stay tied to flow through the rating curve.
- Water temperature lags and damps air; the forecast rides the air *change* at a damped
  slope, never air 1:1.
- **The diel range is condition-dependent, not constant** — it scales with the air–water
  differential and is bounded by the gauge's own observed extreme. A guessed band never
  exceeds real measured behaviour and never creates hoot-owl status on its own.
- The far-horizon (last ~2) forecast days are the least reliable and warrant a guard.
- USGS timestamps are true UTC; DNRC StAGE timestamps are face-value Mountain local
  (handled upstream).

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain | Null behavior |
|-------|---------------|----------------|---------------|
| Flow anchor | `series.flow.latest.value` | → last `thisYear[].mean` | no forecast; history only |
| Flow shape | GloFAS `floodForecast` | (none) | no forecast produced |
| Stage | forecast flow + rating | → last `stage.thisYear[].mean` anchor | stage line not drawn |
| Temp forecast mean | air *change* × slope (measured) / gradient (est.) | → hold anchor | day omitted |
| Diel band | condition-scaled from gauge's own observed swing | → flat average → ±3 °F symmetric | band = mean (no swing) |
| Air axis | `weather.daily` **post terminal-guard** | (none) | no forward movement |
| Ceiling | `normal.flow` | (none) | relative clamps only |

---

## Outputs

- `series.flow.forecast[]`, `series.stage.forecast[]`, `series.watertemp.forecast[]` —
  forward arrays spliced onto each history line at the TODAY index. Measured-gauge
  `watertemp.forecast[]` rows carry `{date, mean, min, max, forecast}` with a
  **condition-aware** diel band (§2c); estimated gauges carry their inherited/estimated band.
- Per-day + average **confidence** in the chart corner.
- Guarded air axis feeds the Tomorrow column and the bite engine (`03`).
- The forecast `max` is consumed by the frontend's **forecast-warning callout** (amber
  "Water Temp" at ≥70 °F / 3 consecutive forecast days; red "Hoot-Owl Likely" at ≥73 °F /
  3 consecutive), which uses the same `STRESS_FC_DROP` terminal-day drop as the stress
  ladder. The condition-aware band removes the systematic under-call the flat band
  produced on hot days — on the live forecast it surfaced stress days on lolo-hwy93 and
  additional hoot-owl days on Missoula that the flat band left under 70/73.

---

## Status

**Live** off real conditions. Flow dynamics (self-relative rise/clearing) are covered in
**Phase 4** / `07`; this file covers the forecast *tails*, the terminal guard, and the
Phase-6 condition-aware diel band as they ship now.

---

## Sources

- **[S1] Terminal-day artifact** — *derived-in-repo* (observed in the live Open-Meteo
  forecast tail); guard thresholds (`TERMINAL_GUARD_DAYS`, `MAXJUMP`, `LOOKBACK`) are
  *assumption*, tuned against the observed spike + smooth-trend controls.
- **[S2] GloFAS anchoring & rating curve** — *derived-in-repo* (ratio-anchoring to latest
  reading; `a + b·√flow` least-squares rating from paired daily means).
- **[S3] Air→water coupling slope** — *derived-in-repo* from each gauge's measured history
  (clamped [0.2, 0.6], default 0.4). Cross-ref `01`.
- **[S4] Condition-aware diel band** — *cited method, derived magnitudes*. The daily range
  of stream temperature is largest when the air–water differential is greatest and is
  reduced by higher volume and turbidity (classical result; small summer streams ~6 °C,
  larger rivers less): stream-thermal texts (e.g. **Brown 1969**, *predicting temperatures
  of small streams*; standard limnology — Ward 1992; Hynes 1970). Diurnal variation is
  greatest in mid-order streams and in low summer flows: **Vannote & Sweeney 1980**;
  regional/agency stream-temperature monitoring (USFS R6 stream-temperature reports 🏔
  document 2.4–5.4 °C summer diurnal ranges). The **baseline** half-swings, `baseDiff`,
  the observed-envelope ceiling, and the `[0.6, 1.6]` scale clamp are *derived-in-repo*
  from each gauge's own `thisYear` history; the clamp bounds are *assumption*, tuned so a
  guess never exceeds observed behaviour. Verified headless on the live 8 gauges (+0.8–2.0 °F
  on hot days, all within each gauge's measured extreme).
