# 02 · Chart Forecasts (Flow, Stage & Confidence)

Everything to the **right of the TODAY line** on the charts: the forward flow and
gauge-height (stage) curves, and the confidence figure in each chart's corner.
This is modeled — it deliberately replaces the raw flood model's forecast tail,
which spiked implausibly in the back half of the window.

> Water temperature's forward model is in [`01-temperature.md`](01-temperature.md).
> It produces the temp chart line the same way this file produces flow and stage.

---

## What it is

The forward continuation of each chart: flow, stage, (temp via `01`), plus a
per-day confidence percentage. The engine builds forward from trustworthy signals
only, with hard physical clamps so a line can never explode.

---

## Inputs

- `series.flow.thisYear[]` means + `series.flow.latest.value` — the recession anchor.
- `series.flow.lastYear[]` means — last year's recession *shape*.
- `weather.daily[].precipIn` / `.hiF` — the bounded flow nudge.
- `series.stage.latest` (or last `.thisYear` mean) + today's flow — stage rating anchor.
- `weather.lastYearDaily[]` — confidence comparison baseline.
- `normal.flow` — the absolute ceiling.

---

## Logic / calculation

### 2a. Flow — `buildForecast`

Flow is the anchor; stage derives from it. For each forward day, from the most
recent real reading:

1. **Recession baseline.** `v = prev × k`, where `k` is a daily recession factor
   fit to the last up-to-six real days (average of day-over-day log ratios,
   `_recessionK`), **clamped 0.93–1.04** — can't free-fall or spuriously climb.
2. **Seasonal shape blend.** Last year's day-over-day *ratios* over the same
   calendar dates (`_lyShape`, each clamped 0.90–1.12) blended in at **35%
   weight** — imports the shape of last year's recession, not its magnitude.
3. **Bounded weather nudge.** Rain → up by `precipIn (cap 1") × 0.06`; high above
   75 °F → up by `(hiF − 75)/100`, cap +0.05 (small snowmelt bump).
4. **Hard clamps, in order:** day-over-day **0.80×–1.12×** of prior day; never
   **>1.8× the last real reading** (no flood spikes); ceiling **3× normal flow**;
   floor **1 cfs**.

The clamped value becomes `prev`; the loop steps forward.

### 2b. Stage (gauge height)

**Not modeled independently** — derived from forecast flow through the gauge's own
flow→stage rating curve (square-root relationship anchored on today's stage/flow
pair, with a conservative floor). Keeps stage physically consistent with flow.

### 2c. Confidence — `forecastConfidence`

Per forward day: start at **96 − 5 × (days out)**, then knock down for weather
divergence from last year over the same dates — precip difference costs up to
**25**, a high-temp gap beyond 8 °F up to **20**, a day with weather but no
last-year comparison a flat **8**. Floor **5**, cap **99**. Chart shows the per-day
value at hover and an overall average. The logic: a forecast leaning hard on the
weather nudge (conditions unlike last year) is inherently less certain.

---

## Assumptions

- Recession is the dominant physics; last year is a shape hint, not a magnitude
  predictor.
- Weather can only nudge within tight bounds; it can't drive the forecast.
- Stage must stay tied to flow through the rating curve — the two never drift apart.
- USGS timestamps are true UTC; DNRC StAGE timestamps are face-value Mountain local
  (handled upstream in `alignSeries`, not here).

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain (in order) | Null behavior |
|-------|---------------|---------------------------|---------------|
| Recession anchor | `series.flow.latest.value` | → last `series.flow.thisYear[].mean` | no flow history → no forecast produced; chart shows history only |
| Recession factor `k` | fit to last ≤6 real days | → clamp midpoint if too few points | defaults toward mild recession within 0.93–1.04 |
| Seasonal shape | `series.flow.lastYear[]` ratios | (none) | absent → blend weight contributes nothing; pure recession |
| Flow nudge | `weather.daily[].precipIn`/`.hiF` | (none) | absent → no nudge applied |
| Stage | forecast flow + `series.stage.latest` | → last `series.stage.thisYear[].mean` | no stage anchor → stage line not drawn |
| Ceiling | `normal.flow` | (none) | absent → only the relative clamps apply |
| Confidence baseline | `weather.lastYearDaily[]` | (none) | absent → flat −8 "no comparison" penalty |

---

## Outputs

- `g._series.fcFlow[]`, `g._series.fcStage[]` (and `fcTemp[]` via `01`) — the
  forward arrays spliced onto each history line at the TODAY index.
- Per-day + average **confidence** shown in the chart corner.
- `fcFlow[i]` becomes the `flowRatio` numerator in a **future** day's conditions
  object (`00`), feeding bite windows (`03`) and fly picks (`05`).

---

## Status

**Live** off real conditions — the most complete of the engines.
