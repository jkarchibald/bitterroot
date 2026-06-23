# Bitterroot Fishing Conditions

A subscription-free, keyless fishing-conditions dashboard for the Bitterroot drainage. A
scheduled GitHub Action pulls live gauge and weather data, normalizes it, and commits a
single `data.json` file. GitHub Pages serves the repo, and a static HTML front-end reads
that file to render gauge cards, year-over-year charts, modeled forecasts, bite windows,
and a hatch calendar. No backend, no database, no API keys.

This README is also the playbook for replicating the system for the other four drainages
(see [Expanding to other drainages](#expanding-to-other-drainages)). The original repo is
named `bitterroot`, but the design is drainage-agnostic — the only drainage-specific
pieces are the gauge list and the hatch chart.

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

### Data sources (all keyless today)

- **USGS Instantaneous Values (IV)** — `waterservices.usgs.gov/nwis/iv/`. Discharge
  (`00060`) and gage height (`00065`). Water temp (`00010`) is requested but absent for
  the two USGS sites, so temp is estimated from air temp for those.
- **DNRC StAGE (ArcGIS MapServer)** — Montana stream gauges. Layer 4 maps sensors to
  parameters; layer 2 carries the timeseries. Provides stage (HG), discharge (QR), and
  water temp (TW).
- **Open-Meteo** — air temp, precip, cloud, pressure, sunrise/sunset (forecast endpoint),
  plus the GloFAS flood endpoint for relative discharge-trend forecasting. Last-year
  weather uses the archive endpoint, which fails soft (it's omitted if unavailable rather
  than breaking the run).

### Forecasting (all clearly flagged, never presented as measured)

- **Flow forecast** anchors the GloFAS 5 km discharge *trend* to the gauge's latest real
  reading — honest units tied to observed conditions, trend only.
- **Stage forecast** fits `stage ≈ a + b·√flow` from recent paired readings, then applies
  it to the flow forecast.
- **Water-temp forecast** carries the recent (water − air) offset forward for measured
  gauges; estimated gauges use a damped/lagged air-temp proxy.
- **"Normal"** is currently the median of all fetched daily means. Once the Action has
  accumulated enough history, this should be swapped for a day-of-year climatology (noted
  inline in `fetch-data.mjs`).

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
- **Open-Meteo archive endpoint** (last-year weather) is not validated by a real fetch in
  the current code — it's isolated and fails soft. Validate before relying on last-year
  weather.
- **"Normal" baseline** should graduate from "median of fetched window" to a day-of-year
  climatology once enough history accrues.

## Expanding to other drainages

There are five drainages total; Bitterroot is one. The cleanest structure going forward —
and what this repo *should* have been from the start — is a single repo (e.g. `CFTF`) with
**one branch per drainage**, or a single branch with **one folder per drainage**, sharing
the same `fetch-data.mjs` engine.

What is actually drainage-specific is small:

1. **The `GAUGES` array in `fetch-data.mjs`.** Each entry is one gauge: its `id`, display
   `name`, `type` (freestone/tailwater/mainstem), `source` (`stage` or `usgs`), the
   source-specific identifiers (`locationId` + `code` for StAGE; `site` for USGS), and
   `lat`/`lon` for the per-gauge weather pull. Swap this list for the new drainage's
   gauges and the entire data layer follows.
2. **The hatch calendar and any drainage-labeled copy in `index.html`** (title, the
   "<drainage> drainage · N gauges" subheader, the hatch chart transcription).

Everything else — normalization, forecasting, the chart/card/bite-window rendering, the
Action — is reusable as-is.

### Recommended approach when you come back to this

Rather than forking six near-identical repos, restructure once into a shared engine:

```
CFTF/
├── fetch-data.mjs            # shared engine, reads a drainage config
├── drainages/
│   ├── bitterroot/gauges.json
│   ├── <drainage-2>/gauges.json
│   └── ...
├── <drainage>/data.json      # generated per drainage
├── index.html                # parameterized by drainage
└── .github/workflows/update-data.yml   # matrix over drainages
```

A GitHub Actions **matrix** can then run the same `fetch-data.mjs` once per drainage in a
single workflow. Until that refactor, the quick path is: copy this repo, replace the
`GAUGES` array and the hatch chart, rename, and you have the next drainage.

## Repo hygiene

Stale, renamed snapshots (`indexv1.html` … `indexv6.html`) are not part of the running
system and can be deleted — `index.html` is the only front-end that ships. See
`cleanup.sh` for a safe, reviewable removal. Historical versions remain recoverable from
git history if ever needed.
