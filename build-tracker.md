<!-- version: build-tracker-27.md -->

# Bitterroot Dashboard — Build Tracker

Global counter: **27**. Living document. Each phase entry carries its outcome,
validation surface, deliverables, and the upload set required to start the next
phase.

---

## Phase 7 — calcPicks fine-tune + independent per-gauge rigs — **COMPLETE**

Two independent parts, one file (`index.html`), two commits.

### Part A — calcPicks reads flow dynamics (was level-blind)

**Symptom (owner):** calc picks said "high water → bigger" on gauges that were
actually dropping and clearing.

**Root cause (traced on live `data.json`, 2026-07-12, all 8 gauges):**
`calcPicks` received its conditions from `liveConditions`, which returned only
`{temp, flow, flowRatio, cloud, precipPct}` — no `spike`/`clearing`. Those lived
on `g._flowTrend`, read separately by `categoryScores`. So calc sized flies off
LEVEL alone (`ratio>=1.25` → "high water → bigger") through its own private
step-buckets, blind to dynamics. On the live snapshot the whole drainage was in a
clearing recession (`spike=0` everywhere; `clearing` 0.4–0.75 on 5 of 8 gauges) at
high level (ratio 1.2–2.05×), so calc read the high level and upsized on every
gauge — the exact opposite of what the dynamics (and `categoryScores`, which reads
`_flowTrend`) said. Same level-vs-dynamics confusion Phase 6 fixed in
`categoryScores`, one layer down in the picks.

**Fix:**
1. **Wiring — extend `liveConditions`** to carry `spike`/`clearing` from
   `g._flowTrend`, so one conditions object feeds both the score engine and the
   calc picks. Chosen over passing `g._flowTrend` separately into `calcPicks`
   because that would re-introduce the two-source split that caused the bug and
   break the plain-conditions-object contract (`computeBlocks`/`categoryScores`
   take a plain object, never gauge `g`).
2. **Logic — replace calc's private level buckets** with the same dynamics-first
   continuous read as `categoryScores` (same branch order, same thresholds, **no
   new constants**): `spike>=0.35` → bigger/darker (streamer bias); `clearing>=0.3`
   → downsize, seam dries; level (`>=1.2` / `<=0.8`) only as coarse location context
   ("bigger water → fish edges & seams"), never a size penalty.
3. **Reason string** rewritten to the score engine's language so a pick's reason
   can never contradict its score.
4. **TODAY-ONLY** — no forecast horizon, no separate RT source.

**Validation:** `node --check` on full inline script; edited `calcPicks` +
`liveConditions` run headless against live `data.json`, all 8 gauges × 4
categories, before/after shown. **13/32 primary flies changed**, all
correct-direction; **zero gauges still read "high water → bigger."** Clearing
gauges now downsize (Golden Stimulator → Yellow Sally, Golden Stone Nymph →
Drowned Ant); the 3 genuinely-flat high gauges keep their flies and take the mild
location note.

**Scope guards honored:** `categoryScores`, `_bandFor`, the two 66s,
`HOOT_OWL_F`/`STRESS_RED_F`, the welfare ceiling, `hatchesForMonth` all untouched.
Phase 6 remains closed.

**Deliverable:** `index-7-1.html` (commits as `index.html`), `commit-7-1.txt`.

### Part B — independent per-gauge rigs

**Confirmed placeholder:** two duplicate rig groups existed — the three mainstem
gauges (darby, bell, msla) were byte-identical Bell copies (owed since Phase 3),
and the two Lolo Creek gauges (lolo, lolo-hwy93) were also byte-identical to each
other.

**Fix:** every gauge now carries its own rig, authored to that gauge's live
character. Patterns/sizes/colors **derived from the repo's own local knowledge**
(`HATCH_FLY` + the existing sanctioned gauge rigs) — not invented. No engine
change; tables only. Colors map through `FLY_COLORS`.

Per-gauge character:
- **lolo** (upper Lolo, ~56 °F cold small creek): tighter cold-creek attractors,
  PT-led nymphs, smaller Bugger/Muddler.
- **lolo-hwy93** (lower Lolo, ~59 °F, bigger near mouth): caddis/early-hopper
  forward, Rubber Legs + Prince, meatier Bugger.
- **darby** (upper mainstem, ~56 °F, browns + rainbow): brown streamer game
  (Sculpzilla, brown Bugger), Chubby up top, Pat's Rubber Legs.
- **msla** (lowest mainstem, ~66 °F warmest, rainbow/brown): hopper-forward,
  San Juan for off-color, meatiest #4–6 streamers.
- **bell** unchanged (already fits the middle mainstem).
- **wf-painted, ef-connor, wf-conner** unchanged (already location-authored).

**Validation:** `node --check` passes; all 8 rigs re-hashed → **zero duplicates**
(previously two dup groups); every color across all rigs resolves in `FLY_COLORS`.

**Scope note — logged:** differentiating the two Lolo gauges is **beyond the Phase
7 prompt's stated triplet scope.** Done at owner request for one-gauge-one-rig
independence (upper Lolo ~56 °F vs. lower ~59 °F — a real but small gap). Recorded
here as an owner-requested addition, not silent scope drift.

**Refinement path:** these rigs are derived-from-hatch-table starting points.
Fly-shop ground truth (`calibration/shop-reports.md`) plus summer/fall field use
will refine them. Not a placeholder anymore, but not yet locally-verified truth.

**Deliverable:** `index-7-2.html` (commits as `index.html`), `commit-7-2.txt`.

### Design clarification (recorded for future reference)

The `rig` is an **authored menu** per gauge; `calcPicks` is a **condition-driven
selector** over a pool of {this month's hatch flies + that gauge's rig + search +
universal}, scoring each candidate on live water and emitting one pri/alt pair.
Part B made the menus independent; Part A made the selector read dynamics. The rig
strings are static; the *selection over them* is live — proven by the A/B trace
where the same static rig produced different picks after the dynamics fix.

---

## Phase 7 doc audit

| Logic file | Touched by | Audit action | Status |
|-----------|-----------|--------------|--------|
| `05-whats-working-now` | Part A (`calcPicks`), Part B (rigs) | rewrite §5c to dynamics-first; update §5b rig note, Data-lineage, Status; close the §293 "one real coupling logged for Phase 7" | **done (`05-7-1`)** |
| `07-flow` | — (calc now reuses 07's spike/clearing) | add cross-ref: calc consumes `flowTrend` via `liveConditions` (intro note, §7d addition, Outputs, Status) | **done (`07-7-1`)** |
| `06-thermal…` | untouched | none (scope-guarded) | n/a |

**Decision — calc engine documentation:** calc stays documented **in 05** (§5c),
cross-referenced to `07` for the flow-dynamics logic it now reuses, rather than
spawning its own logic doc. Rationale: post-Phase-7 `calcPicks` mirrors
`categoryScores`' flow branch exactly (same thresholds, same order); a separate doc
would duplicate 05 §5a's flow discussion and 07's source-grounding. Revisit only if
a future phase gives calc logic that diverges from the score engine.

**Source-citation split (per audit rule):** no new science claims introduced in
Phase 7 — Part A reuses Phase 6 / `07`'s already-cited rate-of-rise + clearing
logic (derived-in-repo, sourced in 07); Part B patterns are **authored local
knowledge** (owner-supplied via the hatch tables), flagged for fly-shop
ground-truthing. No new cited-source rows required.

**Phase 7 doc audit: COMPLETE.** Both touched logic docs reconciled against
shipped code — `05-7-1` (§5c rewrite + rig note + lineage/Status) and `07-7-1`
(calc-consumer cross-ref: intro, §7d, Outputs, Status). Nothing pending.

---

## Phases 1–7 — status roll-up

With the Phase 7 doc audit closed, phases 1–7 are each **complete and closed as
scoped**:

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Westslope-cutthroat response curve (`_bandFor`) | **closed** — flipped PROVISIONAL→done at Phase 6 (`05` Status) |
| 2 | Bite engine / block scoring | **closed** |
| 3 | 8-gauge expansion + forecast-warning callout system + stress chiclet split | **closed**, live-verified |
| 4 | Flow dynamics-first (`spike`/`clearing`/`flowAdj`); `07-flow` created | **closed** |
| 5 | Where-to-fish / gauge ranking (`04`) | **closed** |
| 6 | `categoryScores` re-anchored to `_bandFor`; flow level fully demoted | **closed** |
| 7 | `calcPicks` dynamics-first + independent per-gauge rigs + doc audit | **closed** |

**Two items carry forward — both now placed as scoped phases, neither dangling:**
1. **Forecast `max` derivation for measured gauges** → **Phase 8b** (placed below,
   with trigger, upload set, and scope guard). Not a correctness bug; a fidelity
   refinement, deliberately scope-guarded out of Phases 4–7.
2. **Ground-truth calibration** — Phase 7 rigs and score magnitudes are
   derived/anchored but **not** yet reconciled against fly-shop reports → **Phase 8**
   (planned below with its own upload set). That is the substance of Phase 8, not a
   gap in 1–7.

Interpretation: the system is **feature-complete and internally consistent through the
fly-selection engine**; it is **not yet field-calibrated** (Phase 8). "1–7 closed"
means every phase shipped, was validated, and had its docs reconciled — it does not
mean the rigs/scores are locally ground-truthed.

---

## On the horizon

### Phase 8 — fly-shop harvest → calibration dataset

**Reframed from the original "score-calibration" stub.** The owner's actual goal is
NOT to calibrate score magnitudes against a "Good = 7–8" anchor — it is to **harvest
real, current fly recommendations from local shops** and (a) validate/refine the Phase 7
rig tables against them, and (b) build a **dated training dataset** tying each report to
that day's gauge conditions, so over a season the app can answer "under THIS
temp/flow/normal/weather state, here's what has historically worked." The shops are how
we harvest the fly half of each training row; the gauge pipeline already has the
conditions half.

**Architecture — a separate pipeline, isolated from the gauge pipeline.** A standalone
`fetch-shop-reports.mjs` writes its own append-only `calibration/shop-reports.json`.
Never merged into `fetch-data.mjs`: shop reports are irregular, prose-formatted,
per-shop, and map to reaches/rivers not gauges. If a shop scrape breaks, calibration
goes stale but the dashboard keeps running. **Append-only is load-bearing** — shop pages
overwrite (no history), so the dated time series only exists if we scrape on a schedule
and never overwrite. Seed now, schedule, accumulate.

**Source list (confirmed).** Two difficulty tiers, staged easy-first:
- *Structured tier (backbone, wired first):* three Orvis pages — West Fork (Jim
  Mitchell), East Fork (Jim Mitchell), Bitterroot mainstem (Blackfoot River Outfitters).
  Fixed HTML with a real fly table (name/colors/sizes, ranked). Covers 5 of 8 gauges
  (wf-painted, wf-conner, ef-connor via the forks; darby, bell, msla via the mainstem).
- *Prose tier (added second, onto a working foundation):* Grizzly Hackle (richest COLOR
  source — patterns named with colors in running prose) and Fly Fish Food (structured
  "hot flies" list with sizes). These need the prose-to-structured-fly extraction step.
- *Notes:* Blackfoot's own `blackfootriver.com` report duplicates their Orvis feed — use
  one, not both (Orvis, cleaner). The two forks share one Jim Mitchell rig list. Missoula
  and the two Lolo gauges still lack a dedicated shop; future add.

**Second signal confirmed scrapable — the day RATING (2026-07-12, from raw Orvis HTML).**
Each Orvis report carries a conditions rating that maps to our 0–10 and is a check on
whether our day score is in the ballpark. It is NOT an image — it is a static JS data
block in the page source (amCharts `chart.data`), trivially parsed, no vision needed:
```
chart.data = [{"rating":"Poor","number":10},{"rating":"Standard","number":10},
              {"rating":"Good","number":50},{"rating":"Excellent","number":10},
              {"rating":"Hot","number":10}];
```
Scrape rule: the entry with the highest `number` is the active rating (here "Good").
Scale is **5 levels** — Poor / Standard / Good / Excellent / Hot — mapping to our 0–10 as
~1–2 / ~3–4 / **~7–8** / ~9 / ~10. This confirms the memory anchor ("shop Good = dawn/dusk
peak 7–8"). CAVEAT: "Hot" renders in the hoot-owl orange (`#f85928`) — may mean *water*
hot (warning) rather than *fishing* hot; confirm against a live "Hot" day before trusting
it as a high score. Blackfoot's OWN-site 5-fish rating is now ALSO solved (sourced 2026-07-12 from
raw HTML). It is not 5 separate fish images — it is a single CSS fill bar: an
inactive-fish SVG background with an active-fish SVG layer clipped to a width
percentage. Scrape rule: read `width:XX%` from `.report-condition-rating-value`.
Today's Bitterroot = `width:80.0%` = 4/5 fish = ~7–8 on our 0–10 (matches the
Orvis "Good" anchor). Because it's a continuous percentage, half-fish resolve
naturally (3.5 fish = 70%). Both rating systems now confirmed plain-text
scrapable, no vision: Orvis = JS chart.data (highest `number` wins);
Blackfoot-own = CSS width%. Minor build note: Blackfoot's own page may carry a
fresher/different rating than its Orvis feed — scrape own-site for the rating
if it ever diverges.

Fly table is also attribute-structured (`data-shop-name`, `data-shop-id`, price) — pull
names from attributes, even cleaner than visible text. Entire Orvis page is static
server-rendered HTML: a plain fetch in GitHub Actions gets rating + temp + flies + date +
tip. Easy, cheap, repeatable — confirmed.

**Two signals, two purposes (both now in scope):**
- Fly tables → refine rig tables (harvest). Proven scrapable.
- Day rating (Poor→Hot) → sanity-check our 0–10 day score per gauge. Proven scrapable
  (Orvis); Blackfoot-own-site fish-rating TBD.

**Build order (dependency-correct):**
1. **Fly-name alias / normalization layer — FIRST, the keystone. — DONE (Chat 1,
   2026-07-12).** Every shop names the same fly differently ("Adams" / "Parachute Adams";
   "Fly Formerly Known As Prince" / "Prince"; "Bead Head Hare's Ear" / "Hare's Ear"). Until
   names normalize, you cannot count cross-shop repeats, cannot weight, cannot diff against
   the rig. Cheap, unblocks everything, proven needed by the seed comparison (matcher
   under-matched on aliases).
   **Delivered:** `fly-aliases.json` (17 canonicals, 32 aliases) + `fly-aliases.mjs`
   (`normKey` punctuation/case-insensitive matcher, `canon()` lookup, `inRig` set).
   Validated headless: `node --check` clean, no alias collisions, all 25 seed `nameRaw`
   round-trip to their seed `nameCanonical` (0 failures). Two owner-confirmed merges beyond
   the seed flies table: generic `Rubber Legs` -> `Pat's Rubber Legs`, and `PT` -> `Pheasant
   Tail`. Five canonicals carry `inRig:false` (Sparkle Pupa, Quigley Cripple, Double Bunny,
   Kreelex, TJ Hooker) -- counted for cross-shop agreement but flagged as absent from the rig
   tables (candidate-add / diff signal, per the "consider not auto-add" guardrail). Rig/hatch
   atoms with no shop variant yet are intentionally NOT pre-seeded -- the map normalizes shop
   names, not every rig fly; new rig-only flies get aliases when a shop first names them.
2. **Scraper + all sources — SECOND. — STRUCTURED TIER DONE (Chat 2, 2026-07-12).**
   `fetch-shop-reports.mjs`: Orvis x3 first (structured), then Grizzly Hackle + Fly Fish
   Food (prose tier). Adding shops lives here, not earlier — scraping un-normalizable
   names just yields noise.
   **Delivered this chat (Orvis structured tier only):** `fetch-shop-reports.mjs` +
   `.github/workflows/fetch-shop-reports.yml` (separate pipeline, own twice-daily schedule,
   `contents:write` only, concurrency-guarded) + reconciled seed as the append target.
   Parses fly table from `data-shop-name`/`data-shop-id` attrs, day rating from the
   amCharts `chart.data` block (highest `number` wins, orvis-5step), plus temp/date/
   hatches/tip. Canonicalizes every `nameRaw` through `canon()`; honors the UNKNOWN-NAME
   CONTRACT (see below). APPEND-only with dedup on `id` (source+idSlug+reportDate).
   **Validated headless (fixtures; live fetch blocked in sandbox by `host_not_allowed`,
   GitHub Actions egress is open):** `node --check` clean; scrape of all 3 fixtures
   reproduces the seed field-for-field (canonicals, rank, type, colors, sizes, rating,
   temp, gauges, drainage); re-run dedups to 0 appended; a planted unmapped name
   ("Sex Dungeon") logged, landed with `nameRaw` preserved + `nameCanonical:null`, and
   appended once to `_unmappedNames[]` without blocking the run.
   **`id` scheme note:** `id = source-idSlug-reportDate`, where `idSlug` is an explicit
   per-source field (`westfork`/`eastfork`/`bitterroot`) rather than URL-derived — a
   URL-derived slug produced `west-fork-bitterroot` and would not match the seed ids,
   duplicating every report on every run. Locked to match the seed exactly.
   **PROSE TIER DEFERRED** to the next chat (Grizzly Hackle + Fly Fish Food), which needs
   the prose-to-structured-fly extraction step. `tipFlies:[]` is emitted empty until then.
   **RATING SOURCE — primary/fallback (decided Chat 2):** the rating is a per-source
   *chain*, not a single source. Mainstem's true primary is the Blackfoot **own-site**
   `width:XX%` fish-bar (fresher, river-native → pct/8); Orvis amCharts is the **fallback**
   (→ orvis-5step/7.5). The forks have no own-site page, so Orvis is their only source.
   THIS CHAT SHIPS ORVIS-ONLY: the mainstem rating is Orvis (`Good`/7.5) for now. Seed's
   mainstem rating was reconciled from the hand-authored own-site `80%`/pct/8 down to
   `Good`/orvis-5step/7.5 so the seed reflects exactly what the live pipeline emits today
   (no phantom value no shipped code can reproduce). Wiring the own-site parser as the
   mainstem **primary** (with Orvis fallback, and a `rating.ratingSource` tag on the record
   so the time series never silently switches scales) is the **FIRST TASK OF THE NEXT
   CHAT.** When it lands, the mainstem rating upgrades to own-site pct via the normal
   append flow — the Orvis rows already banked are untouched (append-only).
   **Seed provenance (recorded):** the seed was hand-authored during design (pre-pipeline)
   by reading the live pages directly; its canonicals were pre-decided and the alias layer
   (step 1) was fit to reproduce them. The mainstem `80%` came from the owner reading the
   own-site width bar by eye. Chat 2 is the seed's first repo landing; from here the
   scraper maintains the file, so seed/scraper agreement is now enforced (reconciled above).
   **ISOLATION RE-AFFIRMED:** nothing the scraper writes feeds the day score or bite
   windows. `index.html` does not read `shop-reports.json`; all scoring runs off `data.json`
   (gauge pipeline). Shop rating = human sanity-check on the day score, not an engine input;
   shop temp = soft cross-check. Rig-table influence remains diff-and-review, never auto-fed.
   **UNKNOWN-NAME CONTRACT (LOCKED 2026-07-12, owner):** when the scraper hits a `nameRaw`
   that `canon()` cannot resolve, it **logs-and-keeps-going -- never blocks the scrape.** The
   full record still lands (raw name preserved on the fly), and the unresolved name is
   appended to a **single top-level review list** in `shop-reports.json` (e.g.
   `_unmappedNames[]`, deduped) -- one place to scan after each run, not per-fly inline tags.
   Review loop: open the list, and for each name decide one of three buckets -- (a) same fly,
   different spelling/shorthand -> add an alias line under the existing canonical; (b) new fly
   with no rig counterpart -> new canonical with `inRig:false`; (c) noise -> ignore. Add the
   line(s) to `fly-aliases.json`; no re-scrape needed because the raw name is banked in the
   record. A new/unknown fly name must WARN, never break a run (mirrors "if the shop scrape
   breaks, the dashboard keeps working," one level down).
3. **Per-river shop weighting — THIRD.** Credibility is river-specific: Jim Mitchell
   strong on the forks, Blackfoot/Grizzly strong on the mainstem. A fly's priority for a
   river = sum of (shop weight on that river) across shops recommending it; cross-shop
   repeats = high confidence. Meaningless until multiple shops are flowing (step 2).
4. **Condition-join — FOURTH/LAST.** Tie each dated report to that day's gauge conditions
   (temp/flow/normal/weather/forecast) to form training rows. Last because it needs all
   the above PLUS accumulated time to be valuable.

**Seed status:** `calibration/shop-reports.json` seeded (2026-07-12) with the 3 Orvis
reports in row schema; the shop-vs-rig comparison was demonstrated headless across the 5
covered gauges (strong agreement on Prince/Chubby/Sparkle Minnow/Purple Haze/PT; flagged
real candidate adds — Adams Purple Parachute, Elk Hair Caddis grid-wide; Stimulator on
the mainstem). Method proven; pipeline not yet built.

**Guardrail — harvest is "consider," not "auto-add."** Shop lists include patterns that
may not fit the cutthroat-focused tables (articulated streamers — Double Bunny, Kreelex;
commercial one-offs — TJ Hooker). Diff-and-review, never blind-merge. Water temps from
shops (e.g. Jim's hand-typed 52F) are a SOFT cross-check only — our sensors are
authoritative.

**Storage + schema — LOCKED (2026-07-12, schemaVersion 2).**
*Storage:* ONE append-only file, `calibration/shop-reports.json` — a flat `reports[]`
array. NOT per-river files, NOT per-shop files (both fragment overlapping-river data and
complicate the condition-join). Each record is self-tagged with river/shop/date, so
filtering is in-code (`reports.filter(r => r.gauges.includes('darby'))`). Separate from
`data.json`; written by the separate `fetch-shop-reports.mjs`; never overwritten. Shards
by YEAR only if it ever exceeds ~5MB (years out) — never by river.

*Record = one shop report for one river on one day.* Fields:
- `id`, `scrapedAt` (when WE pulled), `reportDate` (shop's stamp) — two dates: reports go
  stale, and scrapedAt is how the timeline is built from overwrite-only pages.
- `source` (platform), `reporter` (actual guide — **weighting keys on this**, not source,
  because Jim Mitchell and Blackfoot both publish on Orvis), `url`.
- `river` + `gauges[]` — the crosswalk that attaches a report to our gauge(s).
- `rating: {raw, scale, value0to10}` — THREE forms: raw as-shown ("80%"|"Good"), the
  source scale ("pct"|"orvis-5step"), and OUR normalized 0-10 (80% -> 8, Good -> 7.5).
  Keep all three so re-tuning the mapping never requires re-scraping. `value0to10` is what
  the app checks its own day score against.
- `shopWaterTempF` — SOFT cross-check only; our sensors are authoritative.
- `hatches[]`, `bestTime`, `technique` — context.
- `flies[]`: each `{rank, nameRaw, nameCanonical, type(dry|nymph|dd|streamer), colors[],
  sizes}`. `rank` preserves the shop's priority order (information — don't discard).
  **`nameCanonical` is the load-bearing field**: raw shop names vary ("Adams" /
  "Parachute Adams"; "Fly Formerly Known As Prince" / "Prince"), so cross-shop agreement
  counting is impossible without a normalized name. Populated by the alias layer
  (build-step 1); `nameRaw` preserves the original.
- `tip` + `tipFlies[]` — prose cross-check; catches flies the table omits.
- `drainage` (e.g. "bitterroot", "clark-fork") + `active` (bool) — see PULL-AND-PARK below.

**DRAINAGE BUCKETS (LOCKED 2026-07-12) — grouped by FISHING DESTINATION, shop-style, not
strict watershed.** Hydrologically the Clark Fork is the master basin that the Bitterroot,
Blackfoot, and Rock Creek all drain into; but for this app `drainage` groups rivers the
way anglers/shops treat them as distinct destinations. Four buckets:
- `bitterroot` — Lolo Creek (x2), West Fork, East Fork, mainstem Darby->Missoula. ACTIVE
  (the current 8 gauges).
- `clark-fork` — Clark Fork proper + Rock Creek. PARKED until the owner builds this
  drainage (stated intent).
- `blackfoot` — Blackfoot River. PARKED.
- `georgetown-lake` — its own bucket. PARKED.
Only `bitterroot` rivers are `active: true` today; the rest are pull-and-park
(`active: false`, `gauges: []`) per below.

**PULL-AND-PARK — collect all rivers now, park the off-gauge ones (LOCKED 2026-07-12).**
Shops that cover multiple rivers (Blackfoot RO publishes Bitterroot, Clark Fork, Rock
Creek, Blackfoot, Georgetown Lake) get **all** their rivers scraped — but rivers with no
gauge in THIS app are stored with `gauges: []` and `active: false`, tagged by `drainage`.
Rationale: the owner will build a **Clark Fork drainage (incl. Rock Creek)** later; parked
reports are collected + dated from day one, so that drainage starts with **banked history**
instead of from zero. Same scraper, same schema, same file — activation later = fill
`gauges[]` + flip `active: true`, no re-scrape, no reformat. Active-dataset queries filter
`active: true` (or `gauges.length > 0`), so parked rows never dilute the Bitterroot
calibration/training set. Cost: ~2-3x reports per run (same cheap fetch), file-size still
trivial for years. This is the flip-a-flag path — cheapest to incorporate later, which is
why it beats "Bitterroot-only now" (starts future drainages cold) and "all in one flat
set" (dilutes now, untangle later).

*The four load-bearing fields* (if tracking only a few): `reportDate`, `gauges`,
`nameCanonical`, `rating.value0to10`. Everything else supports the condition-join
(build-step 4): join records to that date's gauge conditions to form training rows.

*Seed status:* `calibration/shop-reports.json` upgraded to schemaVersion 2 with all 3
Orvis reports in the locked shape (nameCanonical filled, 3-form ratings). NOTE: the seed's
nameCanonical values already encode alias decisions (e.g. Jim's "Adam's Purple Parachute"
-> our `Purple Haze`); build-step 1 formalizes these into an explicit alias map rather
than per-record guesses.

**FILE LIFECYCLE — where shop-reports.json lives + when it hits the repo (LOCKED).**
`calibration/shop-reports.json` does NOT exist on the repo yet — it is a seed built during
design. Lifecycle:
- *Now / Chat 1 (alias layer):* seed is a local working file only; no push. Chat 1 just
  reads it to build the name map.
- *Chat 2 (scraper) = first repo landing.* **DONE 2026-07-12.** Commit
  `fetch-shop-reports.mjs` (new) + `calibration/shop-reports.json` (reconciled seed, as the
  append target) + `.github/workflows/fetch-shop-reports.yml` (new, separate schedule).
  Orvis structured tier only; prose tier + own-site-primary rating deferred to Chat 3.

Hard rules for the pipeline:
1. **Separate from `fetch-data.mjs` — never merged.** `fetch-shop-reports.mjs` ->
   `shop-reports.json` is its own script with its own output. If the shop scrape breaks,
   the gauge dashboard keeps working. Two scripts, two files, two concerns.
2. **Its own workflow, its own (less-frequent) schedule.** Gauge cron stays as-is; the shop
   scraper gets a separate Action/job — shop reports change every few days, not hourly.
3. **APPEND, never overwrite.** Unlike `data.json` (overwritten each run), the shop
   workflow READS the existing `shop-reports.json`, APPENDS new dated records, writes back,
   and commits. All history is preserved — that append-and-commit pattern is exactly why
   this is a separate pipeline. Dedup on `id` (source+river+reportDate) so re-scraping an
   unchanged report doesn't create duplicates.

**UI (deferred to build):** likely a collapsible per-gauge "Shop Report" panel (date,
shop flies, tip, and a your-rig-vs-shop agreement indicator). Decided at build time.

### Phase 8b — forecast `max` derivation for measured gauges (placed residual)
**Origin:** flagged during Phase 3 (diel-band work) and again at the Phase-6 close as a
"re-touch later" item; deliberately **not** addressed in Phase 4–7 (each scope-guarded
away from it). Promoted here from a loose catalog line to a placed, scoped slot so it
does not dangle.

**What it is:** measured-gauge forecast rows derive their daily `max` (and the diel band
around it) from observed spread. The current derivation is the Phase-3 average-spread
approach; the open question is whether the forecast `max` should be hardened (e.g. to a
condition-aware or max-spread basis) for measured gauges specifically. Related to the
frontend `tempCallout` fallback bump, which was deliberately left flat (average observed
spread) at the Phase-6 doc pass — that decision stands and is the reason this is a
*measured-gauge forecast-derivation* question, not a callout question.

**Trigger / dependency:** best done alongside any future pass that re-touches the
forecast pipeline or the continuous-curve derivation; not urgent, no correctness bug —
it is a fidelity refinement. Sequence after Phase 8 (calibration) so shop-report
ground-truth can inform whether the current band is even biased.

**Required to start (upload set):** `build-tracker` (latest) first; then `fetch-data.mjs`
(the derivation lives in the pipeline, `waterTempForecast`), `index.html` (the frontend
`tempCallout` fallback, ~L1140), a fresh `data.json`, and `02-chart-forecasts.md`.
**Scope guard:** forecast-`max`/diel-band derivation for measured gauges only. Does not
touch `_bandFor`, the two 66s, `HOOT_OWL_F`/`STRESS_RED_F`, the welfare ceiling, or the
scoring engines. Any band change is validated headless on live `data.json` before ship.

### Phase 9 — documentation & IP consolidation
Reconcile all logic docs against shipped code into one authoritative artifact.

### Phase 10 — hatch calendar re-plumb
`hatchesForMonth` stays a calendar (explicitly out of Phase 7 scope). Phase 10
makes it condition-aware if warranted — this is also where the logged thermal→
hatch-timing coupling (`05` Appendix) lands.

---

## Required to start — Phase 8 (upload set)

**First task = the alias/normalization layer (build-order step 1). Start there.**

**Must-have:**
- `build-tracker-25.md` (this file) — upload first.
- `index.html` (current, post-7-2) — source of the per-gauge rig tables to diff against.
- fresh `data.json` — for the eventual condition-join (step 4) and gauge crosswalk.
- `calibration/shop-reports.json` — **seeded** 2026-07-12 (schemaVersion 3) with 3 Orvis reports; the
  append target and schema reference. (Note: `.json`, not the old `.md`.)

**Source URLs (for the scraper, step 2):**
- Orvis West Fork: `https://fishingreports.orvis.com/west/montana/west-fork-bitterroot-river`
- Orvis East Fork: `https://fishingreports.orvis.com/west/montana/east-fork-bitterroot-river`
- Orvis Bitterroot mainstem: `https://fishingreports.orvis.com/west/montana/bitterroot-river`
- Grizzly Hackle (prose): `https://grizzlyhackle.com/pages/bitterroot-river-fishing-report`
- Fly Fish Food (prose): `https://www.flyfishfood.com/blogs/fly-fishing-reports/bitterroot-river`

**Referenced:**
- `05-whats-working-now-7-1` (rig/selection detail, §5b/5c).
- `07-flow-7-1`.

**Optional:**
- `06-thermal-response-and-stress` (only if a shop-vs-app temp gap prompts a look at the
  stress ladder — unlikely; shop temps are soft cross-check only).

**Scope guard:** Phase 8 is shop-harvest + calibration-dataset work only. The
`fetch-shop-reports.mjs` pipeline is SEPARATE from `fetch-data.mjs` and never merges into
it. No gauge-engine restructure; `_bandFor`, the 66s, `HOOT_OWL_F`/`STRESS_RED_F`, the
welfare ceiling, and the Phase-6/7 flow logic are closed. Rig-table changes are
diff-and-review (never auto-merge from shop data) and, when made, validated headless
(node --check + color-resolve + distinctness) exactly as Phase 7 Part B was.
