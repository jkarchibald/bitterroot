# 01 · Water Temperature — Estimation & Forecast

*Phase 3 rewrite. Supersedes the pre-Phase-3 version, which described a retired
`(hi+lo)/2 − 6` air-proxy model that is no longer used and ran 5–7 °F too warm
against real measured water (see “What changed” below). This file now documents the
engine actually shipping in `fetch-data.mjs`.*

Water temperature is the single most important input on the dashboard — it dominates
the bite-window math (`03`), the fly-category scoring (`05`), and the entire stress
ladder (`06`). This file is the source of truth for how the *number* is determined
in every case: **measured**, **estimated (no probe)**, and **forecast (future days)**.

> The temperature *response curve* (given water temp X, how should the fish behave?)
> lives in `06-thermal-response-and-stress.md`. This file is only about *what the
> water temperature IS* now and tomorrow — a data/modeling problem, not biology.

---

## What it is

For every gauge and every day (history + forecast), a daily water-temperature record
`{min, mean, max}` in °F, plus a provenance flag. `mean` anchors the displayed value;
**`max` (the daily afternoon peak) is what the stress ladder reads** — the 68/70 °F
thresholds in `06` are max-based, so the diel band is not cosmetic, it is load-bearing.

Everything is flagged: measured gauges carry no tag; estimated gauges carry
`estimated: true` (and an `estMethod` naming which estimator produced them), which the
frontend renders as the `est` provenance icon.

---

## Inputs

- `series.watertemp.latest.value` — newest instantaneous probe reading (measured gauges).
- `series.watertemp.thisYear[].{min,mean,max}` — daily measured record (measured gauges).
- **Measured mainstem neighbours** — the `thisYear`/`forecast` records of other
  `type:"mainstem"` gauges that have a probe (drives the mainstem gradient).
- **Measured-freestone average by date** — the drainage’s real snowmelt-water signal,
  built pass-1 from every freestone gauge that reports temp (drives the freestone estimator).
- `gauge.drainageMi2` — the mainstem gradient axis (upstream small area = cooler,
  downstream large area = warmer).
- `weather.daily[].hiF`/`.loF` — air-temp forecast; drives the forward model. Passed
  through the **terminal-day guard** first (see `02`).
- `normal.watertemp` — the gauge’s short-window normal (a fallback rung only).

---

## Logic / calculation

### A. Measured gauges — today’s value

Resolved in order, each step used only if the previous is missing:

```
series.watertemp.latest.value
  → last series.watertemp.thisYear[].mean
  → normal.watertemp
```

A gauge with a probe reports its own real `{min, mean, max}`, so its diel swing is
real. USGS sites are auto-detected: if parameter `00010` returns data the gauge is
**measured**; if not, it is routed to estimation (pass 2) and flagged.

### B. Estimated gauges — two estimators, chosen by gauge type (pass 2)

Estimation runs in a second pass, after every gauge is pulled, because it needs the
drainage-wide measured signal. For each temp-less gauge:

1. **MAINSTEM gradient** *(mainstem gauges with `drainageMi2`, e.g. Bell).* The
   Bitterroot mainstem warms downstream — cool at Darby (~1,050 mi²) → warmer at Bell
   (~1,963) → warmest at Missoula (~2,824) [S1 🏔]. A temp-less mainstem gauge is placed
   **on the line between its measured mainstem neighbours** and inherits their **real
   diel band** (not a fabricated ±3):
   - both neighbours present → linear-interpolate `min`/`mean`/`max` by `drainageMi2`;
   - only the downstream neighbour present → extrapolate **up = cooler** (subtract the
     gradient), capped;
   - only the upstream neighbour present → extrapolate **down = warmer** (add the
     gradient), capped;
   - the extrapolation slope (°F per mi²) is fitted from the measured mainstem points
     when ≥2 exist on that date, else a documented default (`derived-in-repo` /
     `assumption`).
   Rationale: a big river’s daily swing is physically damped by its thermal mass, so a
   small-stream swing borrowed from the forks would be wrong for Bell. Reading it off
   real mainstem thermometers avoids the guess entirely.

2. **Freestone-average estimator** *(everything else, and any mainstem gauge with no
   measured mainstem anchor on a date).* Chain per date:
   1. **mainstem / dead-probe freestone** → the measured-freestone average (the real
      water signal);
   2. **tailwater** → dam cold-release setpoint (seasonal, hard-capped below the stress
      band so a dam release is never estimated into the hoot-owl zone) [S2 🏔];
   3. **measured freestone, probe dead, has last-year temp** → last year’s temp on this
      date, shifted by the *sign* of the year-over-year flow gap (higher flow → colder),
      small & capped;
   4. **seasonal floor** → a coarse seasonal default so the result is **never `null`**
      (see no-unknown mandate below).

All estimated results stay `estimated: true`.

### C. Forecast (future days) — `waterTempForecast` (measured) & the estimators

For days right of TODAY, water temp is modeled forward from the (guarded) air forecast:

- **Measured gauges** anchor on the latest real reading and ride only the air *change*
  at the gauge’s own least-squares **air→water coupling slope** (clamped `[0.2, 0.6]`,
  default `0.4`; Bitterroot forks cluster ~0.38–0.41). A flat water−air offset would
  track air 1:1 and badly over-warm a buffered river; riding the *change* at a damped
  slope preserves the observed offset. This is `derived-in-repo` from each gauge’s own
  history.
- **Estimated mainstem** gauges get forecast rows from the same gradient (their
  neighbours’ forecast rows are interpolated), so Bell’s forecast is as good as Darby’s
  and Missoula’s.
- **Estimated non-mainstem** gauges ride today’s value forward along the air trend,
  damped (~0.5×), anchored on today’s corrected value.

### D. Terminal-day guard

The far-horizon (last ~2) forecast days occasionally spike implausibly (observed air
high 98→103→98 °F on the 8–9-day tail). Before any forecast is built, each terminal
day is checked against the local trend (mean of the preceding few forecast days); a day
that jumps beyond the cap is clamped toward that local trend, while a *sustained* trend
(steady warming, a building heat wave) is left untouched. Full mechanism in `02`.

### E. No-unknown mandate (Phase 3)

Every gauge must reach score time with a measured-or-estimated `{min, mean, max}` — there
is no legitimate “no data / unknown” state. The estimator’s final rung is a seasonal
default, so it **never emits `mean: null`**. This makes the frontend’s
`unknown → orange` stress fallback dead code (closed upstream, not recoloured).

---

## What changed (Phase 3)

- **Retired** the `(hi+lo)/2 − 6` air proxy this doc used to describe. Measured against
  real water it runs **5–7 °F too warm** (`derived-in-repo`: on measured freestone the
  true water-minus-air-mid offset is ≈ −11 to −13 °F, not −6). Air is now used only for
  the *change* term (bias-cancelling) or as a last-resort level fallback.
- **Mainstem gradient** added (Darby ↔ Missoula), so Bell stops borrowing a small-stream
  diel and reads a real big-river band.
- **Diel decision resolved:** keep a single daily model, but the daily **max** for
  estimated gauges now comes from real neighbours (gradient) rather than a flat `mean+3`,
  because the stress ladder keys on max.
- **8-vs-11-day window fixed:** the weather past-window (`PAST_WX_DAYS`) is aligned to the
  gauge history window (`HISTORY_DAYS`), so estimated and measured series now share an
  11-day axis.
- **Terminal-day guard** + **no-unknown seasonal floor** added.

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain (in order) | Null behavior |
|-------|---------------|---------------------------|---------------|
| Measured today | `series.watertemp.latest.value` | → last `thisYear[].mean` → `normal.watertemp` | routed to estimation |
| Estimated mainstem | measured mainstem neighbours (gradient) | → freestone-average estimator | seasonal floor (never null) |
| Estimated other | measured-freestone avg | → tailwater setpoint → last-year shift → **seasonal floor** | seasonal floor (never null) |
| Forecast (measured) | air *change* × fitted slope, anchored on latest reading | → hold anchor if no air | forecast omitted for that day only |
| Forecast (estimated mainstem) | neighbours’ forecast rows (gradient) | → freestone estimator forward | seasonal floor |
| Diel band (estimated) | interpolated from real neighbours | → neighbour’s own spread (extrapolation) | — |
| Air axis | `weather.daily[].hiF`/`.loF` **after terminal guard** | (none) | no forward movement |

---

## Outputs

- **Per gauge:** `series.watertemp.thisYear[]` and `.forecast[]`, each row
  `{date, min, mean, max, n}`; `estimated`/`estMethod` on estimated gauges.
- **Consumed by:** the chart temp line (`02`), the bite-window temperature band (`03`),
  the fly-category scoring (`05`), and the stress ladder (`06`, which reads `max`).

---

## Sources

*Three-way split per standing rule 7. 🏔 = Montana/regional.*

- **[S1] 🏔 Bitterroot mainstem downstream-warming gradient & drainage areas** —
  USGS gauge metadata: 12344000 Darby (1,050 mi², elev ~3,942 ft), 12350250 Bell
  Crossing (1,963 mi²), 12352500 near Missoula (2,824 mi², elev ~3,110 ft); MT DEQ
  Bitterroot Temperature TMDL (2011) models the mainstem thermal profile Darby→Missoula.
  *derived-in-repo* for the interpolation-by-area method and the default slope
  (~0.0025 °F/mi², ≈ 4.4 °F across Darby→Missoula); *assumption* for the extrapolation
  cap (±6 °F).
- **[S2] 🏔 Tailwater cold-release setpoint** — West Fork below Painted Rocks Dam runs
  cold year-round (dam-controlled release); MT FWP drainage management notes the West
  Fork below the dam as a cold tailwater. *assumption* for the exact monthly setpoint
  values; *derived-in-repo* for the cap below the stress band.
- **[S3] Air→water coupling** — water lags and damps air; the fitted per-gauge slope
  (clamped [0.2, 0.6], default 0.4) is *derived-in-repo* from each gauge’s own
  measured history.
- **[S4] Warm-bias / retired-model error** — the −11 to −13 °F water-minus-air-mid
  offset (vs the retired model’s −6) is *derived-in-repo* from the current `data.json`.
- **[S5] Terminal-day artifact** — the far-horizon spike is *derived-in-repo* (observed
  in the live Open-Meteo forecast tail); guard thresholds are *assumption*.
