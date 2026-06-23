# 01 · Water Temperature

Water temperature is the single most important input on the dashboard — it
dominates the bite-window math (`03`) and the fly category scoring (`05`). This
file is the source of truth for how temperature is determined in all three cases:
**measured**, **estimated** (no sensor), and **forecast** (future days).

---

## What it is

The water temperature value used everywhere downstream, for any given day. On the
card it appears as the displayed temp (with a `°F est` tag when estimated). It is
never shown as a raw weather number — it is always the *water* temperature, real
or modeled.

---

## Inputs

- `series.watertemp.latest.value` — newest instantaneous water-temp reading.
- `series.watertemp.thisYear[].mean` — today's running daily mean.
- `normal.watertemp` — the gauge's long-run normal water temp.
- `meta.measuredTemp` — boolean; `false` means this gauge has no thermometer.
- `weather.daily[].hiF` / `.loF` — air-temp forecast, drives the forward model.
- (forecast anchor) `series.watertemp.thisYear[]` / `.latest`.

---

## Logic / calculation

### A. Today's temperature — measured vs. estimated

Resolved in this order, each step used only if the previous is missing:

```
series.watertemp.latest.value
  → last series.watertemp.thisYear[].mean
  → normal.watertemp
  → null
```

When `meta.measuredTemp = false`, the gauge has no sensor and the resolved value
is an **estimate** — the UI marks it (`°F est`, orange styling). A gauge with no
temperature series at all resolves to `normal.watertemp`; if even that is absent,
the temperature is `null`, and the bite engine uses its neutral "unknown" band
(0.55×) rather than guessing a number.

### B. Forecast temperature — `buildTempForecast`

For days right of TODAY, water temp is modeled forward from the air-temp forecast,
damped and lagged toward the recent water trend (water changes temperature far
more slowly than air). For each forward day:

1. **Target** from that day's forecast mid-temp minus 6 °F:
   `target = (hiF + loF)/2 − 6`.
2. **Move 55% of the gap**, with the per-day step **capped at ±4 °F**.
3. **Clamp** to a physical **33–75 °F**.

The forward series is anchored on the gauge's recent real water temp, so it
continues the actual current water, not a generic seasonal curve.

---

## Assumptions

- Water temperature lags and damps air temperature; it never tracks it one-for-one.
  The 6 °F offset and 55%/±4 °F step encode that lag.
- An estimated (unmeasured) temp is good enough to drive band logic but must be
  surfaced as estimated — never presented as a sensor reading.
- When no temperature is available at all, a neutral "unknown" band is safer than
  a fabricated value.
- 33–75 °F bounds the physically plausible range for these waters.

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain (in order) | Null behavior |
|-------|---------------|---------------------------|---------------|
| Today's water temp | `series.watertemp.latest.value` | → last `series.watertemp.thisYear[].mean` → `normal.watertemp` | **null** → downstream "unknown" temp band (0.55×) |
| Estimated flag | `meta.measuredTemp` | (none) | absent → treated as **measured** (no `est` tag) |
| Forecast anchor | `series.watertemp.latest` | → last `series.watertemp.thisYear[].mean` | no anchor → forecast temp not produced; future day falls back to today's resolved temp |
| Forecast driver | `weather.daily[].hiF`/`.loF` | (none) | absent → no forward movement; holds anchor value |
| Physical clamp | inline 33–75 °F | (constant) | always applied |

---

## Outputs

- **Today:** a single resolved `waterTempF`, plus the measured/estimated flag.
- **Forecast:** `g._series.fcTemp[]`, the forward water-temp array.
- **Consumed by:** the chart temp line (`02`), the bite-window temperature band
  (`03`), and the fly category scoring (`05`). For a future day, `fcTemp[i]` is the
  `waterTempF` that day's conditions object carries.

---

## Status

**Live.** Both today's resolution and the forward model run off real data.
