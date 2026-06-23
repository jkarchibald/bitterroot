# MIGRATION — single drainage → shared engine for all five

This is the runbook for the "come back to this in 6 months" refactor: turn the
Bitterroot-only repo into one repo (`CFTF`) that serves all five drainages from a single
shared engine, using folder-per-drainage config and a GitHub Actions matrix.

It is written to be followed top to bottom. Each step is small and reversible. Nothing
here is destructive until Step 9 (deleting the old hardcoded gauge list), and git history
keeps everything recoverable anyway.

---

> **Accuracy check (verified against the current `fetch-data.mjs`).** This runbook has
> **not** been started yet, and all of its premises still hold:
> - The gauge list is still a hardcoded `const GAUGES = [ … ]` (line ~35) — Step 1/2 apply
>   unchanged. It currently holds the six Bitterroot gauges (`lolo`, `lolo-hwy93`,
>   `wf-painted`, `ef-connor`, `wf-conner`, `bell`).
> - The engine still writes a single root `writeFile("data.json", …)` (line ~721) — Step 2's
>   target-path change still applies.
> - Only `writeFile` is imported from `node:fs/promises` (line ~23); Step 2 adds `readFile`
>   and `mkdir` — **merge them into that existing import line** rather than adding a second
>   `import` statement.
> - There is no `DRAINAGE` env var anywhere yet.
> - The workflows the matrix steps edit (`update-data.yml`, `health-check.yml`) and the
>   other CI files (`codeql.yml`, `dependabot.yml`) already exist, so Steps 5–6 are
>   *edits to existing files*, not new files.
>
> One note vs. older design docs: the engine's flow forecast is the **GloFAS-trend** model
> (`forecastFlow_i = latestRealFlow × glofas_i/glofas_today`) and temp is the
> **water-minus-air offset** model. The migration deliberately does **not** touch
> forecasting (Step 2 leaves the entire model untouched), so this changes no step here — it
> only matters if you cross-reference the `logic/` docs, which describe a different (stale)
> forecast engine. The README is the accurate one.

**Design decision (already made):** folder-per-drainage on ONE branch, not branch-per-
drainage. Branches drift and force you to cherry-pick engine fixes across six places
forever. One branch + one `drainages/<name>/gauges.json` per drainage + a matrix build
means a fix to `fetch-data.mjs` lands once for everyone.

---

## Target structure

```
CFTF/
├── fetch-data.mjs                      # shared engine (reads a drainage config, writes to a target path)
├── drainages/
│   ├── bitterroot/
│   │   ├── gauges.json                 # the GAUGES array, extracted
│   │   └── hatch.json                  # hatch calendar + drainage labels (optional, see Step 7)
│   ├── <drainage-2>/gauges.json
│   ├── <drainage-3>/gauges.json
│   ├── <drainage-4>/gauges.json
│   └── <drainage-5>/gauges.json
├── bitterroot/data.json                # generated, per drainage
├── <drainage-2>/data.json
├── ...
├── index.html                          # parameterized by ?drainage=<name>
├── .github/
│   ├── dependabot.yml
│   └── workflows/
│       ├── update-data.yml             # matrix over drainages
│       ├── health-check.yml            # matrix over drainages
│       └── codeql.yml
├── README.md
├── MIGRATION.md                        # this file
└── cleanup.sh
```

Serving: GitHub Pages from repo root. Each drainage's data lives at
`https://<user>.github.io/CFTF/<drainage>/data.json`. The front-end picks the drainage
from a URL query param, e.g. `…/index.html?drainage=bitterroot`.

---

## Step 0 — Branch and baseline

Do the whole refactor on a branch so `main` keeps serving the working Bitterroot site
until you're done.

```bash
git checkout -b refactor/multi-drainage
```

Confirm the current site still builds: `node fetch-data.mjs` should write `data.json`
without error. If it doesn't, fix that FIRST — you don't want to refactor on top of an
already-broken pipeline.

---

## Step 1 — Extract Bitterroot's gauge list to a config file

Open `fetch-data.mjs`, find the `const GAUGES = [ … ];` array, and move its contents into
a new file. The objects are already plain data, so this is a copy-paste into JSON (drop
the `const GAUGES =`, drop the trailing `;`, and quote the keys if they aren't already —
JSON requires `"id":` not `id:`).

Create `drainages/bitterroot/gauges.json`:

```json
{
  "drainage": "bitterroot",
  "displayName": "Bitterroot",
  "gauges": [
    { "id": "lolo", "name": "Lolo Creek abv Sleeman Creek", "type": "freestone", "source": "stage",
      "locationId": "bfc4c4ef7d2d41b49f4fc3d2014584f7", "code": "76HB 09500", "lat": 46.742963, "lon": -114.154763 }
    // … the rest of the existing gauges, comma-separated, JSON-quoted …
  ]
}
```

> Tip: JSON does not allow comments or trailing commas. If you want comments, name the file
> `gauges.jsonc` is NOT supported by `JSON.parse`; keep it `.json` and put any notes in a
> `"_comment"` field instead.

---

## Step 2 — Teach the engine to read a config and write to a target path

In `fetch-data.mjs`, make two small changes. The goal is: the engine is told WHICH
drainage to build via an env var, loads that drainage's gauges, and writes `data.json`
into that drainage's output folder.

**Imports.** The file currently imports only `writeFile`:

```js
import { writeFile } from "node:fs/promises";
```

Extend that existing line — don't add a second `import` from the same module:

```js
import { writeFile, readFile, mkdir } from "node:fs/promises";
```

Then, after the imports, add the drainage resolution:

```js
// Which drainage to build — set by the workflow matrix (or default to bitterroot locally).
const DRAINAGE = process.env.DRAINAGE || "bitterroot";
const CONFIG_PATH = `drainages/${DRAINAGE}/gauges.json`;
const OUTPUT_PATH = `${DRAINAGE}/data.json`;
```

Replace the hardcoded `const GAUGES = [ … ];` with a load from the config:

```js
const cfg = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const GAUGES = cfg.gauges;
```

Find the `writeFile("data.json", …)` call near the end of `main()` (around line 721) and
change the target, making sure the folder exists first. The existing log line already uses
the local `gauges` variable, so keep that:

```js
await mkdir(DRAINAGE, { recursive: true });
await writeFile(OUTPUT_PATH, JSON.stringify(data, null, 2));
console.log(`\n✓ wrote ${OUTPUT_PATH} — ${gauges.length} gauges`);
```

Optionally stamp the drainage into the output so the front-end can label itself. The `data`
object already exists (with `generatedAt`, `today`, `timezone`, `constants`, `windows`,
`gauges`) — just add two fields at the top of it:

```js
const data = {
  drainage: DRAINAGE,
  displayName: cfg.displayName || DRAINAGE,
  generatedAt: new Date().toISOString(),
  today: todayLocal(),
  // … the rest of the existing fields, unchanged …
};
```

(The front-end already relies on `data.today` for the today-marker — don't disturb it.)

That is the entire engine change. Everything else — normalization, forecasting, "normal" —
is untouched.

---

## Step 3 — Verify Bitterroot still builds, now from config

```bash
DRAINAGE=bitterroot node fetch-data.mjs
```

Expect `bitterroot/data.json` to be written. Diff it against the old root `data.json` to
confirm the output is equivalent (timestamps and forecast values will differ run-to-run;
the gauge list, units, and structure should match):

```bash
# rough structural sanity check
node -e "const a=require('./bitterroot/data.json'); console.log(a.gauges.map(g=>g.id))"
```

You should see the six Bitterroot ids:
`[ 'lolo', 'lolo-hwy93', 'wf-painted', 'ef-connor', 'wf-conner', 'bell' ]`. If that matches
what the site showed before, the extraction is correct. (Note `require()` needs the JSON to
exist; if you prefer, `node --input-type=module` with `readFile` works the same way.)

---

## Step 4 — Add the other four drainages' configs

For each remaining drainage, create `drainages/<name>/gauges.json` with the same shape.
You need, per gauge:

- `id` — short slug, unique within the drainage
- `name` — display name
- `type` — `freestone` | `tailwater` | `mainstem`
- `source` — `stage` (DNRC) or `usgs`
- For `stage`: `locationId` + `code`  (from the DNRC StAGE service)
- For `usgs`: `site`  (the USGS site number)
- `lat`, `lon` — for the per-gauge weather pull

**Where to find the identifiers:**
- USGS site numbers: waterdata.usgs.gov — find the gauge, the site number is in the URL.
- DNRC StAGE `locationId`/`code`: the StAGE map service. The existing Bitterroot entries
  are your worked examples of the exact format.

Build one drainage at a time and verify before moving on:

```bash
DRAINAGE=<name> node fetch-data.mjs
```

If a gauge returns no data, check the source type and identifiers first — a wrong `site`
or `locationId` is the usual culprit.

---

## Step 5 — Update the data-refresh workflow to a matrix

Replace `.github/workflows/update-data.yml`'s single job with a matrix that runs the
engine once per drainage and commits all changed `data.json` files.

```yaml
name: Update fishing data

on:
  schedule:
    - cron: "17 */3 * * *"
  workflow_dispatch: {}

permissions:
  contents: write

concurrency:
  group: update-data
  cancel-in-progress: true

jobs:
  fetch:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false                 # one drainage failing must not block the others
      matrix:
        drainage: [bitterroot, <drainage-2>, <drainage-3>, <drainage-4>, <drainage-5>]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
      - name: Fetch & normalize
        env:
          DRAINAGE: ${{ matrix.drainage }}
        run: node fetch-data.mjs
      - name: Commit if changed
        run: |
          if [ -n "$(git status --porcelain ${{ matrix.drainage }}/data.json)" ]; then
            git config user.name  "github-actions[bot]"
            git config user.email "github-actions[bot]@users.noreply.github.com"
            git pull --rebase --autostash    # matrix jobs commit in parallel; rebase avoids races
            git add ${{ matrix.drainage }}/data.json
            git commit -m "data(${{ matrix.drainage }}): refresh $(date -u +%FT%TZ)"
            git push
          else
            echo "No change for ${{ matrix.drainage }}"
          fi
```

> The `git pull --rebase --autostash` matters: matrix jobs run in parallel and each pushes
> to the same branch. Without the rebase, the second push can be rejected. If you still see
> occasional push races, the alternative is to upload each `data.json` as an artifact and
> commit them all in a single follow-up job — but rebase is usually enough at five
> drainages.

---

## Step 6 — Update the health-check workflow to a matrix

Same matrix treatment for `.github/workflows/health-check.yml`. Add the same `strategy`
block, set `env: DRAINAGE: ${{ matrix.drainage }}` on the fetch step, and point the
validator at `${DRAINAGE}/data.json` instead of `data.json`:

```yaml
    strategy:
      fail-fast: false
      matrix:
        drainage: [bitterroot, <drainage-2>, <drainage-3>, <drainage-4>, <drainage-5>]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: "20" }
      - name: Fetch & normalize (no commit)
        env: { DRAINAGE: "${{ matrix.drainage }}" }
        run: node fetch-data.mjs
      - name: Validate
        env: { DRAINAGE: "${{ matrix.drainage }}" }
        run: |
          node --input-type=module <<'EOF'
          import { readFile } from "node:fs/promises";
          const file = `${process.env.DRAINAGE}/data.json`;
          const data = JSON.parse(await readFile(file, "utf8"));
          // … same checks as before, but reading `file` …
          EOF
```

The check logic is identical to the existing one; only the path becomes drainage-aware.

---

## Step 7 — Parameterize the front-end

`index.html` currently hardcodes Bitterroot's labels, hatch chart, and the
`fetch('data.json')` path. Make it drainage-aware:

1. Read the drainage from the URL:
   ```js
   const params = new URLSearchParams(location.search);
   const drainage = params.get("drainage") || "bitterroot";
   ```
2. Fetch from the per-drainage path:
   ```js
   fetch(`${drainage}/data.json?t=${Date.now()}`)
   ```
3. Pull the title/subheader from the data file (`data.displayName`) instead of hardcoding.
4. **Hatch calendar:** this is the one piece that's genuinely per-drainage content, not
   just config. In `index.html` it lives as authored tables (`HATCH_CALENDAR`, `HATCH_FLY`,
   and friends — see `logic/05-whats-working-now.md` for how they're consumed), not in
   `data.json`. Two options:
   - Simplest: move each drainage's hatch table into its `drainages/<name>/` folder as
     `hatch.json`, and have the front-end fetch it alongside `data.json`, replacing the
     inline tables with the fetched ones.
   - Or, if the hatch charts are similar enough across drainages, keep one shared chart and
     accept minor inaccuracy until you have per-drainage charts in hand.

   Don't block the migration on perfect hatch data — wire the structure, fill charts later.
   Note the per-gauge `rig` arrays are also authored in `index.html`; if a new drainage's
   gauges need their own rigs, they travel with the hatch content, not the gauge config.

Test locally over HTTP (the file:// fallback won't load `data.json`):

```bash
python3 -m http.server 8000
# open http://localhost:8000/index.html?drainage=bitterroot
# then ?drainage=<drainage-2>, etc.
```

---

## Step 8 — Point GitHub Pages at the new layout

No settings change needed if Pages already serves the repo root from `main` — the new
`<drainage>/data.json` paths just work once merged. After merge, your links become:

```
https://<user>.github.io/CFTF/index.html?drainage=bitterroot
https://<user>.github.io/CFTF/index.html?drainage=<drainage-2>
…
```

If you rename the repo from `bitterroot` to `CFTF`, update any bookmarks/links — the repo
name is in the Pages URL.

---

## Step 9 — Remove the old hardcoded path and stale files

Once every drainage builds and the front-end renders each one:

- Delete the old root `data.json` (it's superseded by `<drainage>/data.json`).
- Confirm the `const GAUGES = [ … ]` array is fully gone from `fetch-data.mjs` (replaced
  by the config load in Step 2).
- Run `cleanup.sh --apply` if any stale `indexvN.html` snapshots remain.

---

## Step 10 — Merge

```bash
git add -A
git commit -m "refactor: shared engine + folder-per-drainage + matrix build"
git push -u origin refactor/multi-drainage
# open a PR, let CodeQL + health-check run on it, then merge to main
```

After merge, trigger `update-data.yml` manually (Actions tab → Run workflow) so every
drainage gets its first `data.json` committed, then check each `…?drainage=<name>` URL.

---

## Adding a 6th drainage later (the payoff)

Once this structure exists, a new drainage is:

1. `drainages/<new>/gauges.json` — the gauge list.
2. Add `<new>` to the `matrix.drainage` array in both workflows.
3. (Optional) `drainages/<new>/hatch.json`.

No engine changes, no new repo, no copy-paste. That's the whole point of doing the
refactor.

---

## Rollback

If anything goes sideways mid-refactor, `main` is untouched until Step 10. Just stay on
`main`:

```bash
git checkout main      # original working Bitterroot site, unchanged
```

The refactor branch can be fixed or abandoned without affecting the live site.
