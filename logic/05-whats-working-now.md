# 05 · What to Use Now (Seasonal vs. Calculated Picks)

For each of four categories — dry, nymph, dry-dropper, streamer — the dashboard
shows up to four flies: two **seasonal** picks (from the month's hatch tables) and
two **calculated** picks (from live conditions), each a specific pattern + size +
color. It also scores the four categories so the strongest one "now" is flagged.

---

## What it is

Four category cells. Each shows a live score and "best now" flag, two seasonal
picks above a divider, two calculated picks below — each row with tag, pattern,
`#size`, color swatches, a short reason, and a "matches seasonal" flag where the
two engines agree.

---

## Inputs

- The same conditions as `03`: water temp, flow, `flowRatio`, cloud %, precip proxy.
- `CUR_MONTH` (UI constant) — which insects are in season.
- Authored tables: `HATCH_CALENDAR`, `HATCH_FLY`, per-gauge `rig`, `SEARCH_FLY`,
  `UNIVERSAL`, `FLY_COLORS`.

---

## Logic / calculation

### 5a. Category scoring — `categoryScores` (via `liveConditions`)

`liveConditions(g)` packages the gauge's live readings into a conditions object;
`categoryScores` accumulates points per category from trout-science rules:

- **Temperature band** (largest weight) — e.g. <40 °F loads nymph, zeroes dries;
  50–60 °F (prime) loads dries + dry-dropper; hoot-owl/lethal collapse everything
  and flag "minimize / don't fish."
- **Flow & clarity** — clarity keys off the `flowTrend` **spike** signal
  (`03` factor 4b), not the ratio level: rising/off-color water (spike ≥ 0.35)
  pushes streamer hard and trims dries; big-but-green water (≥1.4× with low
  spike) gets a milder bigger-profile / fish-the-edges nudge, tagged
  "dropping & clearing" when the clearing signal is ≥ 0.3;
  low/clear (≤0.8×) favors smaller subtle dries.
- **Light** — overcast (≥65%) lifts dries/emergers; bright sun (≤20%) pushes deeper
  nymphs and bank terrestrials.
- **Precip** — wet/rising adds to streamer and nymph.

Scores clamp at zero and return with human-readable "notes." The top category is
"best now"; each meter is the score as a percentage of the max. Same pattern as
`computeBlocks` — point it at the snapshot (today) or forecast (future day).

### 5b. Seasonal picks — `seasonalPicks`

Calendar-driven. `hatchesForMonth(m)` filters `HATCH_CALENDAR` to in-season
insects (ordered chronologically, most-specific-first). For the category, walk
those hatches, look each up in `HATCH_FLY` for a concrete pattern, take the first
two. If fewer than two, top up from the gauge's `rig`, then `UNIVERSAL`. Result:
two flies tagged with the insect they imitate.

### 5c. Calculated picks — `calcPicks`

Same candidate pool (this month's hatch flies + gauge rig + a search pattern +
universal), de-duplicated, but **ranked by fit to live readings**:

- **Size bias:** high/cold water → bigger flies (lower hook #); clear/low → smaller.
- **Color/pattern bias:** overcast rewards mayfly imitations on top
  (BWO/PMD/Drake/Mahogany/Dun); bright sun rewards flashy subsurface
  (Flash/Copper/Zebra/Bead/Prince/Bugger/Minnow/Sparkle).
- **In-season bonus:** a fly tied to a currently hatching insect beats fillers.

Top two become calc pri/alt, each tagged with a live reason ("high water →
bigger," "clear → smaller," "warm → terrestrial," "match-the-hatch"). A calc pick
that coincides with a seasonal pick is flagged "matches seasonal."

### How a specific pattern / size / color is chosen

- **Pattern** — lookup, never invented. `HATCH_FLY` maps each calendar insect to a
  named tie per category; `UNIVERSAL` and each gauge's `rig` are fallbacks;
  `SEARCH_FLY` covers dry-dropper/streamer when the hatch table doesn't.
- **Size** — a hook range on each fly entry (e.g. "14–18"). The calc ranker parses
  the smallest hook number for its big-vs-small bias; the **displayed** size is the
  table's stated range.
- **Color** — a fixed named list per fly (e.g. `["Olive","Gray"]`), mapped through
  `FLY_COLORS` to CSS palette vars by `colorPair`/`swatch`. Authored, not computed.

---

## Assumptions

- Seasonal answers "what's hatching this month here"; calculated answers "what do
  today's water and light favor." Showing both reveals where calendar and
  conditions agree or diverge — agreement is a confidence signal.
- Hatch calendar and per-gauge rigs encode local Bitterroot knowledge; the scoring
  rules encode general trout science. The engine **selects and ranks; it never
  generates a fly.**

---

## Data lineage & fallbacks

| Input | Primary source | Fallback chain → null behavior |
|-------|---------------|-------------------------------|
| Water temp | `series.watertemp.latest` | → today's mean → `normal.watertemp` → null → "unknown" band (see `01`) |
| Flow / `flowRatio` | `series.flow.latest ÷ normal.flow` | → today's mean; `normal.flow` missing → ratio 1.0 |
| Cloud | `weather.hourly[].cloudPct` daytime avg | **only hourly carries cloud** → absent → 40% |
| Precip proxy | `weather.daily[].precipIn` | → 0% |
| In-season insects | `CUR_MONTH` filtering `HATCH_CALENDAR` | month is a constant, not `data.json today` — flag if that changes |
| Pattern | `HATCH_FLY` | → per-gauge `rig` → `SEARCH_FLY` → `UNIVERSAL` (all authored); never from `data.json` |
| Size | hook range on the authored fly entry | (authored) — displayed as-is |
| Color | named list on the authored fly entry → `FLY_COLORS` | (authored) — never computed |
| Future day | `g._series.fcTemp/fcFlow`, that day's hourly cloud / daily precip | same chains as today |

---

## Outputs

- Four category scores + meters, "best now" flag on the top.
- Per category: two seasonal + two calculated flies, each with pattern, size,
  color swatches, reason, and "matches seasonal" where they agree.
- Leaf presentation step — no downstream consumer.

So: scoring and ranking are **data-driven** (live or forecast conditions); the
flies themselves — every pattern, size, color — come entirely from **authored
tables.** The engine selects and orders; it never generates a fly.

---

## Status

Category scoring is **data-driven and live** wherever a conditions object is
available (today now; any future day once forecast wiring lands). The fly tables
are authored and static by design.
