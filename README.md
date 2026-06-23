# Bitterroot Fishing Conditions

A subscription-free, keyless fishing-conditions dashboard for the Bitterroot drainage. A
scheduled GitHub Action pulls live gauge and weather data, normalizes it, and commits a
single `data.json` file. GitHub Pages serves the repo, and a static HTML front-end reads
that file to render gauge cards, year-over-year charts, modeled forecasts, bite windows,
and a hatch calendar. No backend, no database, no API keys.

This README is also the playbook for replicating the system for the other four drainages.
The full step-by-step is in [`MIGRATION.md`](MIGRATION.md); the summary is under
[Expanding to other drainages](#expanding-to-other-drainages). The original repo is named
`bitterroot`, but the design is drainage-agnostic — the only drainage-specific pieces are
the gauge list and the hatch chart.

> **Where the math is documented.** This README covers the *data layer* (how
> `data.json` is built). The *decision logic* layered on top of it — day scores, bite
> windows, where-to-fish ranking, fly picks — is documented in the [`logic/`](logic/)
> folder, starting with [`logic/00-overview.md`](logic/00-overview.md). See
> [A note on the two doc sets](#a-note-on-the-two-doc-sets) for how they relate.

## How it works

```
                 ┌─────────────────────────────────────────────┐
                 │  GitHub Action (.github/workflows/           │
                 │  update-data.yml) — runs on a cron schedule  │
                 └───────────────────┬─────────────────────────┘
                                     │ runs
                                     ▼
                 ┌─────────────────────────────────────────────┐
                 │  fetch-data.mjs (Node 20, built-in fetch)    │
                 │   • USGS IV  — discharge, gage height        │
                 │   • DNRC StAGE (ArcGIS) — stage, flow, temp  │
                 │   • Open-Meteo — weather + sun + flood trend │
                 │   normalizes units, computes per-gauge       │
                 │   "normal", models forecasts                 │
                 └───────────────────┬─────────────────────────┘
                                     │ writes
                                     ▼
                              ┌────────────┐
                              │ data.json  │  ← committed back to repo by the Action
                              └─────┬──────┘
                                    │ fetch()
                                    ▼
                 ┌─────────────────────────────────────────────┐
                 │  index.html (static front-end)               │
                 │   served by GitHub Pages; renders gauge      │
                 │   cards, charts, bite windows, hatch grid    │
                 └─────────────────────────────────────────────┘
```

### The pieces

| File | Role |
|------|------|
| `fetch-data.mjs` | The data layer. Pulls all three sources, normalizes, writes `data.json`. This is where the gauge list lives. |
| `data.json` | Generated output. Committed by the Action. **Do not hand-edit** — it is overwritten every run. |
| `index.html` | The front-end. Reads `data.json` at load; falls back to its own embedded sample data if the file can't be fetched (e.g. when opened directly from disk). |
| `.github/workflows/update-data.yml` | The scheduler. Runs `fetch-data.mjs` on a cron and commits `data.json` if it changed. |
| `.github/workflows/health-check.yml` | Runs the fetch without committing and validates the output, so a broken source is caught early. |
| `.github/workflows/codeql.yml` | Static security analysis. |
| `.github/dependabot.yml` | Dependency update automation. |
| [`logic/`](logic/) | Documentation of the decision logic that the front-end applies on top of `data.json` (scores, bite windows, fly picks). |

### The gauges (current Bitterroot list)

Six gauges, defined in the `GAUGES` array near the top of `fetch-data.mjs`:

| id | Name | Type | Source | Temp |
|----|------|------|--------|------|
| `lolo` | Lolo Creek abv Sleeman Creek | freestone | StAGE | measured |
| `lolo-hwy93` | Lolo Creek below Highway 93 | freestone | StAGE | measured |
| `wf-painted` | West Fork Bitterroot abv Painted Rocks | freestone | StAGE | measured |
| `ef-connor` | East Fork Bitterroot nr Conner | freestone | StAGE | measured |
| `wf-conner` | West Fork Bitterroot nr Conner | tailwater | USGS | estimated |
| `bell` | Bitterroot at Bell Crossing nr Victor | mainstem | USGS | estimated |

The two USGS sites report discharge and gage height but **no water temp**, so their
temperature is estimated (see Forecasting below). Swapping this array for another
drainage's gauges is the bulk of porting the system.

### Data sources (all keyless today)

- **USGS Instantaneous Values (IV)** — `waterservices.usgs.gov/nwis/iv/`. Discharge
  (`00060`) and gage height (`00065`). Water temp (`00010`) is requested but absent for
  the two USGS sites, so temp is estimated from air temp for those.
- **DNRC StAGE (ArcGIS MapServer)** — Montana stream gauges. Layer 4 maps sensors to
  parameters; layer 2 carries the timeseries. Provides stage (HG), discharge (QR), and
  water temp (TW). Celsius is converted to °F on the way in.
- **Open-Meteo** — air temp, precip, cloud, pressure, sunrise/sunset (forecast endpoint),
  plus the GloFAS flood endpoint for relative discharge-trend forecasting. Last-year
  weather uses the archive endpoint, which fails soft (it's omitted if unavailable rather
  than breaking the run).

### Forecasting (all clearly flagged, never presented as measured)

These are the models actually implemented in `fetch-data.mjs`:

- **Flow forecast** uses the Open-Meteo **GloFAS** flood endpoint (5 km, *not*
  bias-corrected) as a *relative trend only*, anchored to the gauge's latest real
  reading: `forecastFlow_i = latestRealFlow × (glofas_i / glofas_today)`. Honest units
  tied to observed conditions, trend only — GloFAS is trusted for the *shape* of the
  hydrograph (rising/falling and roughly how fast), never for absolute magnitude.
- **Stage forecast** fits `stage ≈ a + b·√flow` from recent paired daily means, then
  applies that rating curve to the flow forecast — so stage stays physically tied to flow.
- **Water-temp forecast** rides the air-temp trend forward, damped ~0.5×, carrying the
  recently observed (water − air) offset so the forecast continues the real water signal
  rather than tracking air one-for-one.
- **Water-temp estimation** (for gauges with no probe, or a dead probe) follows a cascade,
  every result flagged `estimated: true`:
  1. measured-freestone average (the real water signal from sibling gauges);
  2. tailwater → a seasonal dam cold-release setpoint, capped below stress (never
     hoot-owl);
  3. a measured freestone whose own probe is dead but has last-year temp → last year's
     temp on this date, shifted by the sign of the flow spacing (higher flow → colder),
     small and capped;
  4. last resort → seasonal normal, then air-minus-offset.
- **"Normal"** is currently the median of all fetched daily means (this year + last). Once
  the Action has accumulated enough history, this should be swapped for a day-of-year
  climatology (noted inline in `fetch-data.mjs`).

## Running it locally

Requires Node 18+ (Node 20 in CI). No `npm install` — it uses built-in `fetch`.

```bash
node fetch-data.mjs        # writes ./data.json
```

To preview the front-end with live data, serve the repo root over HTTP (opening
`index.html` from disk uses the embedded sample data, not `data.json`):

```bash
python3 -m http.server 8000
# then open http://localhost:8000/index.html
```

## Deploying (GitHub Pages)

Settings → Pages → Deploy from branch → root of `main`. The committed `data.json` is then
served at `https://<user>.github.io/<repo>/data.json`, which the front-end fetches.

The workflow needs `contents: write` permission (already set in the workflow file) so it
can commit `data.json` back to the repo.

## The schedule

The cron in `update-data.yml` controls refresh cadence. It can also be triggered manually
from the Actions tab (`workflow_dispatch`). The commit step only commits when `data.json`
actually changed, so quiet periods don't produce empty commits.

## Known future maintenance

- **USGS legacy IV decommission (~Q1 2027).** USGS is moving to
  `api.waterdata.usgs.gov/ogcapi`, which requires a key. When that happens: add the key as
  an Actions repo secret and read it via `process.env` in `fetch-data.mjs`. This is the
  one source that will eventually need a credential.
- **Open-Meteo archive endpoint** (last-year weather) fails soft and is the weakest-
  validated source. Confirm it before relying on last-year weather overlays.
- **"Normal" baseline** should graduate from "median of fetched window" to a day-of-year
  climatology once enough history accrues.

## Expanding to other drainages

There are five drainages total; Bitterroot is one. **The full runbook is
[`MIGRATION.md`](MIGRATION.md)** — follow it top to bottom. The short version:

The cleanest structure is a single repo (e.g. `CFTF`) with **one folder per drainage**,
sharing the same `fetch-data.mjs` engine and a GitHub Actions **matrix** that builds each
drainage once per run. (Folder-per-drainage on one branch — not branch-per-drainage —
so an engine fix lands once for everyone.)

What is actually drainage-specific is small:

1. **The `GAUGES` array in `fetch-data.mjs`.** Each entry is one gauge: its `id`, display
   `name`, `type` (freestone/tailwater/mainstem), `source` (`stage` or `usgs`), the
   source-specific identifiers (`locationId` + `code` for StAGE; `site` for USGS), and
   `lat`/`lon` for the per-gauge weather pull. The migration extracts this array into
   `drainages/<name>/gauges.json`. Swap that list and the entire data layer follows.
2. **The hatch calendar and any drainage-labeled copy in `index.html`** (title, the
   "<drainage> drainage · N gauges" subheader, the hatch chart transcription).

Everything else — normalization, forecasting, the chart/card/bite-window rendering, the
Action — is reusable as-is.

Until that refactor lands, the quick path is: copy this repo, replace the `GAUGES` array
and the hatch chart, rename, and you have the next drainage. The refactor is worth doing
before the *third* drainage, when copy-paste maintenance starts to hurt.

## A note on the two doc sets

There are two layers of documentation, and they describe different things:

- **This README** documents the **data layer** — `fetch-data.mjs`, the three sources, and
  the forecast models that produce `data.json`. It is current with the code.
- **[`logic/`](logic/)** documents the **decision layer** — how `index.html` turns
  `data.json` into scores, bite windows, rankings, and fly picks.

> ⚠️ **Known doc drift to reconcile.** The `logic/` forecast files (`logic/01`,
> `logic/02`) were written from an earlier design note and describe a *recession-factor +
> last-year-shape* flow model and a *(hi+lo)/2 − 6* temp model. **That is not what
> `fetch-data.mjs` actually does** — the real engine is the GloFAS-trend flow and
> water-minus-air temp model described above. When you next touch the logic docs, update
> `logic/01` and `logic/02` to match this README (the data layer is the source of truth
> for forecasting; the logic folder should only *consume* `data.json`, not re-document the
> forecast engine differently).

## Repo hygiene

Stale, renamed snapshots (`indexv1.html` … `indexv6.html`) are not part of the running
system and can be deleted — `index.html` is the only front-end that ships. See
`cleanup.sh` for a safe, reviewable removal. Historical versions remain recoverable from
git history if ever needed.
