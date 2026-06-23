# Dashboard Logic

How every recommendation on the Bitterroot fishing dashboard is calculated — the
inputs each step reads, the assumptions baked in, the fallbacks when data is
missing, and how the result reaches the screen. This folder is the source of
truth for the math behind the UI.

Most of what's documented here is proprietary modeling logic. Treat it as
internal.

## Files

Start with `00`. Every other file is **fully standalone** — you can read any one
of them top to bottom and understand that piece without opening another.

| File | Covers |
|------|--------|
| [`00-overview.md`](00-overview.md) | The system map: how raw data becomes every on-screen recommendation, the shared **conditions object** defined in full, and the global fallback philosophy |
| [`01-temperature.md`](01-temperature.md) | Water temperature — measured, estimated when no sensor exists, and forecast forward |
| [`02-chart-forecasts.md`](02-chart-forecasts.md) | The forward lines on the charts: flow, gauge height (stage), and the confidence figure |
| [`03-bite-windows.md`](03-bite-windows.md) | Today's twelve 2-hour bite blocks, the day-score badge, and the optimum-window readout |
| [`04-where-to-fish.md`](04-where-to-fish.md) | Cross-gauge ranking and best/backup window selection, today and tomorrow |
| [`05-whats-working-now.md`](05-whats-working-now.md) | "What to use now" — seasonal vs. calculated fly picks and how a specific pattern/size/color is chosen |

## Document conventions

Each file follows the same skeleton, in this order:

1. **What it is** — the on-screen thing this produces.
2. **Inputs** — every value consumed.
3. **Logic / calculation** — the actual math, with constants called out.
4. **Assumptions** — what the model takes for granted.
5. **Data lineage & fallbacks** — a standard table: every input, its primary
   source, its fallback chain when that source is missing, and its **null
   behavior** (what the engine does when every fallback is exhausted).
6. **Outputs** — what leaves this step and who consumes it.
7. **Status** — live vs. placeholder, where applicable.

### The lineage table format

Fallbacks are documented the standard data-engineering way — as a lineage table,
one row per input:

| Input | Primary source | Fallback chain (in order) | Null behavior |
|-------|---------------|---------------------------|---------------|
| example | `series.x.latest` | → today's mean → `normal.x` | neutral default / feature suppressed |

"Primary source" is what's used when everything is healthy; the chain is walked
left to right until a value is found; "null behavior" is the guaranteed-safe
outcome when nothing is available. No engine ever fabricates a number to fill a
gap — it either falls back to an authored normal or degrades to a neutral default.

## Source legend

Every input traces to one of these. Paths are relative to a gauge object in
`data.json` unless noted.

| Source | Path | Contains |
|--------|------|----------|
| Live snapshot | `series.{flow,stage,watertemp}.latest` | newest instantaneous reading `{value, ts}` |
| This-year means | `series.{flow,stage,watertemp}.thisYear[]` | daily `{date, min, max, mean, n}` |
| Last-year means | `series.{flow,stage,watertemp}.lastYear[]` | same shape, prior year |
| Modeled forecast | `g._series.{fcFlow,fcTemp,fcStage}` | forward arrays from the forecast engine (`02`) |
| Per-gauge normal | `normal.{flow,stage,watertemp}` | long-run normal values |
| Weather hourly | `weather.hourly[]` | `{t, tempF, precipIn, cloudPct, pressureHpa}`, ~9 days forward — **only source of cloud** |
| Weather daily | `weather.daily[]` | `{date, hiF, loF, precipIn, sunrise, sunset}` — no cloud |
| Last-year weather | `weather.lastYearDaily[]` | `{date, hiF, loF, precipIn}` |
| Constants | `constants` (top-level) | `hootOwlThresholdF`, `lethalF`, `wadeCfs` |
| Gauge metadata | `type`, `meta.measuredTemp`, `meta.provisional`, `lat`, `lon` | water type, temp-measured flag, provisional flag |
| Authored tables | in `index.html` | `HATCH_CALENDAR`, `HATCH_FLY`, `UNIVERSAL`, `SEARCH_FLY`, `FLY_COLORS`, per-gauge `rig` |

"Authored" = hand-curated in the code, not from `data.json`.

## Keeping these docs honest

A doc that's silently out of date is worse than no doc. **Any change to a
calculation updates its file in the same commit.** When you change something:

- **A number changed** (band multiplier, clamp, blend weight, threshold) → update
  that file's calculation section *and* any table.
- **An input changed** (added, removed, re-sourced) → update that file's lineage
  table and the source legend above if a new path appears.
- **Status changed** (a hardcoded array became live, a placeholder was replaced) →
  update the status note in that file and the status column in `00`.
