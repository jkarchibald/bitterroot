# 00 · System Overview

This is the map. It shows how raw data becomes every recommendation on the
screen, defines the **conditions object** that the scoring engines share, and
states the global fallback philosophy that every file inherits.

Read this first. Then any individual file (`01`–`05`) stands on its own.

---

## The pipeline, end to end

```
   RAW DATA                  DERIVED                    ENGINES                  SCREEN
 ─────────────             ───────────              ───────────────          ──────────────
 series.flow      ──┐
 series.stage    ──┼──►  forecast engine  ──►  g._series.fcFlow/        ┌─► flow / temp / stage
 series.watertemp ──┘     (file 02 + 01)        fcTemp/fcStage           │   chart lines  (02,01)
                                                      │                   │
 weather.hourly  ──┐                                  ▼                   │
 weather.daily   ──┼──►  conditions assembly  ──►  conditions  ──┬──────►─┤─► bite-window chart (03)
 normal.*        ──┘     (defined below)           object        │        │   + day-score badge (03)
                                                                 │        │
 type / meta     ─────────────────────────────────────────────► │        ├─► where-to-fish ranking (04)
                                                                 │        │
 HATCH_* / rig / UNIVERSAL (authored) ─────────────────────────► └──────►─┴─► what-to-use-now flies (05)
```

Two things produce *every* recommendation:

1. **The forecast engine** (`02`, with temperature in `01`) turns recent real
   readings into the forward chart lines. Its temp/flow outputs also become the
   inputs for any **future** day's conditions object.
2. **The conditions object** (defined below) is the single packet that the three
   scoring engines — bite windows (`03`), where-to-fish (`04`), what-to-use-now
   (`05`) — all consume. Today's packet is built from the live snapshot; a future
   day's packet is built from the forecast. Same engines, different packet.

---

## The one architectural principle

Every scoring function takes a plain **`conditions` object, never the gauge
object `g`**. That single choice is what lets the same math score today (from the
live snapshot) and any future day (from the forecast): feed it today's packet for
the day-of view, tomorrow's packet for the night-before view, day+3's packet for
3-days-out. Get this right once and all three views are one code path. Miss it,
and the engine has to be built twice.

This is why `03`, `04`, and `05` all reduce to "feed different inputs to the same
function."

---

## The conditions object — defined in full

This is the canonical definition. The scoring files (`03`, `05`) repeat the
relevant rows in their own lineage tables so they stand alone, but **this is where
the object is specified.** It is the translation layer from raw weather + water
data into the packet the engines understand.

```
conditions = {
  waterTempF,    // °F, water temperature for the day
  flowRatio,     // day's flow ÷ gauge normal flow (1.0 = normal)
  flowTrend,     // {spike, clearing} 0..1 — self-relative runoff-event signal (see 03)
  cloudPct,      // 0–100, daytime mean cloud cover
  precipPct,     // 0–100 proxy, chance/intensity of rain
  waterType,     // freestone / tailwater / mainstem
  sunriseHr,     // decimal hour, e.g. 5.7
  sunsetHr,      // decimal hour, e.g. 21.5
  month          // 1–12, drives seasonal hatch + dusk timing
}
```

### How each field is assembled (and its fallback)

| Field | Today's source | Future day's source | Fallback chain → null behavior |
|-------|---------------|--------------------|-------------------------------|
| `waterTempF` | `series.watertemp.latest.value` | `g._series.fcTemp[i]` | → last `series.watertemp.thisYear[].mean` → `normal.watertemp` → **null** (engine uses neutral "unknown" temp band, 0.55×). Full detail in `01`. |
| `flowRatio` | `series.flow.latest.value ÷ normal.flow` | `g._series.fcFlow[i] ÷ normal.flow` | flow → last `series.flow.thisYear[].mean`; if `normal.flow` missing → **ratio defaults to 1.0** (treated as normal). |
| `flowTrend` | `flowTrendFrom()` — self-relative to the gauge's own ~10-day flow trace: rise rate, recent crest vs pre-rise base, consecutive falling days. **Does not use `normal.flow`** (only the informational `ratio` field does). | same signal reused for forecast days | → **null** (no adjustment) if today's flow is missing; with a short trace it degrades to `{spike:0, clearing:0}` (steady). |
| `cloudPct` | daytime (~8 AM–8 PM) mean of `weather.hourly[].cloudPct` | same (hourly runs ~9 days forward) | **Only `weather.hourly` carries cloud; daily does not.** → if hourly absent → **default 40%** (mild, neutral). |
| `precipPct` | proxy from `weather.daily[].precipIn`, or aggregated `weather.hourly[].precipIn` | same | → **0%** (dry) if neither present. |
| `waterType` | `type` | `type` | → treated as **freestone** (the local default) if absent. |
| `sunriseHr` / `sunsetHr` | `weather.daily[].sunrise` / `.sunset` as decimal hours | same | → defaults **~5.7 / ~21.5** if absent. |
| `month` | calendar month of the day | calendar month of the day | → `CUR_MONTH` UI constant. |

The decimal-hour parser respects AM/PM. (A historical bug parsed a 9:34 PM sunset
as 9:34 AM, which collapsed every afternoon block to darkness — fixed; the suffix
is now honored.)

---

## Weather → fishing conditions, stated plainly

Weather is not shown raw to the angler as a forecast; it is **translated into
fishing conditions** at two points, and that is the whole of how weather drives
recommendations:

1. **Into the forecast lines** (`02`/`01`): rain and heat *nudge* forecast flow
   within tight bounds; air temperature *drives* forecast water temperature
   (damped and lagged). Weather can nudge but never dominate the hydrograph.
2. **Into the conditions object** (above): cloud cover, precip, and sunrise/sunset
   times become `cloudPct`, `precipPct`, `sunriseHr`, `sunsetHr` — which then
   shape the bite-window light curve (`03`) and the fly category scoring (`05`):
   overcast lifts dry-fly/emerger activity, bright sun pushes deeper/flashier,
   rain adds to streamer and nymph weighting, and the sun times set where the
   dawn and dusk peaks land.

So "forecasting fishing conditions based on weather" happens here: weather → these
fields → the engines. No engine reads weather directly; it reads the translated
fields.

---

## Global fallback philosophy

Every file's lineage table obeys these rules, so they aren't repeated in full
each time:

- **Walk the chain, never fabricate.** Each input has an ordered fallback chain.
  The engine uses the first available value. It never invents a plausible number
  to fill a gap.
- **Degrade to neutral, not to zero.** When a chain is fully exhausted, the null
  behavior is a *neutral* default (e.g. unknown temp → 0.55× band, missing cloud →
  40%, missing flow ratio → 1.0×), chosen so a missing input neither inflates nor
  guts the result.
- **Surface inference.** A value that is estimated rather than measured (notably
  temperature on sensorless gauges) is flagged in the UI, never presented as a
  sensor reading.
- **Authored normals are the floor.** `normal.*` values are the last real
  fallback before a neutral default — they encode long-run truth for the gauge.

---

## Status at a glance

| Piece | File | Status |
|-------|------|--------|
| Forecast lines (flow/temp/stage/confidence) | 02, 01 | **Live** off real conditions |
| Temperature resolution & estimation | 01 | **Live** |
| Conditions object assembly | 00 (here) | Live for today; future-day wiring is the in-progress build |
| Bite windows + day score | 03 | Engine live & pure; today/forecast wiring is the in-progress build |
| Where to fish | 04 | Today live once blocks are live; tomorrow column in progress |
| What to use now | 05 | Scoring data-driven; flies authored |

Where a step still reads a hardcoded array instead of live conditions, its own
file's **Status** section says so explicitly.
