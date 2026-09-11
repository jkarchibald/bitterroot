// version: fetch-shop-reports-8-3.mjs
// fetch-shop-reports.mjs — Phase 8, build-step 2 (parsers corrected in 8-3).
// FIRST repo landing of the calibration pipeline. Separate from fetch-data.mjs:
// own script, own output (calibration/shop-reports.json), own workflow, own
// (less-frequent) schedule. If this breaks, the gauge dashboard keeps running.
//
// 8-3 fix: the 8-2 parsers were written against fixtures that GUESSED the DOM.
// Run #2 showed the real Orvis pages (Joomla/com_fishing_reports) differ, so
// reportDate came back empty and every source was skipped. Parsers below are
// rewritten against the ACTUAL live HTML captured from the runner:
//   - date:    <p class="last-updated">Last Updated: <span>M/D/YY</span></p>
//   - reporter:<span class="text-brand">NAME's </span> (fly-patterns header)
//   - rating:  amCharts chart.data (MULTILINE) -> highest number wins
//   - temp:    <p class="report-temp__degrees">67</p>
//   - flies:   <tr class="gear-row" data-shop-name="..."> with 3 <td>s:
//                name(<strong>) | colors | sizes  (NO rank attr, NO type column)
//              rank = DOM order; type inferred from canonical (see TYPE_BY_CANON)
//   - hatches: text after <h2>Hatches:</h2>
//   - bestTime:text after <h2>Best Time to Fish:</h2>
//   - tip:     "Tip of the Week" widget <p>
//   - technique:"Techniques & Tips" alert body <p>
//
// What it does (structured tier only — Orvis x3):
//   1. fetch static server-rendered HTML for each configured Orvis page
//   2. parse fly table from data-shop-name attrs + the row's <td> cells
//   3. parse day rating from the amCharts chart.data block (highest number wins)
//   4. parse water temp (SOFT cross-check), report date, hatches, tip, technique
//   5. canonicalize every nameRaw through calibration/fly-aliases.mjs canon()
//   6. honor the UNKNOWN-NAME CONTRACT: unresolved names log-and-keep-going,
//      record still lands with raw name preserved, name appended to a single
//      top-level _unmappedNames[] review list (deduped)
//   7. APPEND to calibration/shop-reports.json, dedup on id (never overwrite)
//
// Pull-and-park: each source declares which gauges it maps to. Off-gauge rivers
// (future drainages) would be stored gauges:[], active:false, drainage-tagged.
// All three Orvis pages here are bitterroot/active.
//
// Prose tier (Grizzly Hackle, Fly Fish Food), per-river weighting, the
// condition-join, AND the Blackfoot own-site rating PRIMARY are LATER chats.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadAliases } from "./calibration/fly-aliases.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_PATH = join(__dirname, "calibration", "shop-reports.json");

const UA =
  "Mozilla/5.0 (compatible; CFTF-shop-scraper/1.0; +https://jkarchibald.github.io/bitterroot/)";

// ---- rating scale map -------------------------------------------------------
// Orvis 5-step -> our 0-10 (tracker). "Hot" flagged: may mean WATER hot
// (hoot-owl orange), not FISHING hot -- caveat rides in the tracker, not code.
const ORVIS_5STEP = {
  Poor: 1.5,
  Standard: 3.5,
  Good: 7.5,
  Excellent: 9,
  Hot: 10,
};

// ---- type inference ---------------------------------------------------------
// The Orvis table has NO type column (Name/Colors/Size only). The seed's
// dry/nymph/streamer/dd is real info we don't want to lose, so infer it from
// the CANONICAL name via this static map (owner-authored from the rig tables).
// Unknown canonical or unresolved name -> null (honest absence, never guessed
// as a default). This is the only place type is assigned.
//
// Entries below the divider (added 2026-09-11, alongside the alias-layer
// expansion for the 50 previously-unmapped names) are Claude-authored best
// guesses from general fly-fishing knowledge, NOT owner-verified against the
// rig tables the way the original set above was. Flagged as `assumption`,
// not `derived-in-repo` -- please sanity-check before treating these as
// settled the way the original 17 are.
const TYPE_BY_CANON = {
  "Parachute Adams": "dry",
  "Purple Haze": "dry",
  "Prince Nymph": "nymph",
  "Pheasant Tail": "nymph",
  "Hare's Ear": "nymph",
  "Chubby Chernobyl": "dry",
  "Elk Hair Caddis": "dry",
  Stimulator: "dry",
  "Sparkle Minnow": "streamer",
  "San Juan Worm": "nymph",
  "Pat's Rubber Legs": "nymph",
  "Water Walker": "dry",
  "Sparkle Pupa": "nymph",
  "Quigley Cripple": "dry",
  "Double Bunny": "streamer",
  Kreelex: "streamer",
  "TJ Hooker": "streamer",
  // ---- assumption, not owner-verified (see note above) ----
  "Big Sky Salmon Fly": "dry",
  "20 Incher": "nymph",
  "Trina's Worm": "nymph",
  "Sparkle Yummy": "streamer",
  "Mini Bugger": "streamer",
  // "Woolly Bugger" deliberately has NO entry -- owner correction 2026-09-11:
  // buggers can be fished/tied as either nymph or streamer, no single fixed
  // answer is honest here. Left out entirely so canon()->null falls through
  // to `type: null`, matching this file's own "never guess a default" rule.
  // (BRO instances aren't affected -- BRO gets type from the tab, not this map.)
  "Zebra Midge": "nymph",
  Perdigon: "nymph",
  "Caddis Pupa": "nymph",
  "Spanish Bullet": "nymph",
  Duracell: "nymph",
  "Flash Cripple": "dry",
  "Chicago Overcoat": "streamer",
  "Zirdle Bug": "streamer",
  "Sili-Leg Stone": "nymph",
  "Trina's Carnage": "dry",
  "On Point Para Wulff": "dry",
  "Film Critic": "dry",
  "Henry's Fork Foam Stone": "dry",
  "Jake's Depth Charge Jig Worm": "nymph",
  "Power Worm": "nymph",
  "Thin Mint Bugger": "streamer",
  "Lil' Kim": "streamer",
  "Micro Chubby": "dry",
  "Hot Spot Para-Wulff": "dry",
};

// NOTE for later (owner correction 2026-09-11, not yet built): "hopper-dropper"
// is NOT a 5th value for `type` -- it's a two-fly RIG composed from the types
// above. The "hopper" (top/indicator fly) can be either a dry (Chubby
// Chernobyl, large foam pattern) OR a terrestrial (beetle, ant) -- both
// already canonicalize to `type: "dry"` here, so no schema change needed for
// that half. The "dropper" (trailed fly) is a nymph. When the Best
// Techniques prose-extraction step (tipFlies) gets built, it should tag each
// extracted fly with a RIG ROLE (top/dropper) separately from its `type`,
// not invent a new type value.

// ---- source registry (structured tier) --------------------------------------
// reporter is NOT hardcoded here anymore -- it is parsed from the page
// (text-brand span). gauges/drainage/active drive the crosswalk + pull-and-park.
const SOURCES = [
  {
    key: "west-fork-bitterroot-river",
    idSlug: "westfork", // id = orvis-westfork-<date>; must match seed exactly
    url: "https://fishingreports.orvis.com/west/montana/west-fork-bitterroot-river",
    source: "Orvis",
    river: "West Fork Bitterroot",
    gauges: ["wf-painted", "wf-conner"],
    drainage: "bitterroot",
    active: true,
  },
  {
    key: "east-fork-bitterroot-river",
    idSlug: "eastfork",
    url: "https://fishingreports.orvis.com/west/montana/east-fork-bitterroot-river",
    source: "Orvis",
    river: "East Fork Bitterroot",
    gauges: ["ef-connor"],
    drainage: "bitterroot",
    active: true,
  },
  {
    key: "bitterroot-river",
    idSlug: "bitterroot",
    url: "https://fishingreports.orvis.com/west/montana/bitterroot-river",
    source: "Orvis",
    river: "Bitterroot (mainstem)",
    gauges: ["darby", "bell", "msla"],
    drainage: "bitterroot",
    active: true,
  },
  // ---- pull-and-park (LOCKED 2026-07-12 design, actually wired 2026-09-11) --
  // Off-gauge rivers this app doesn't score yet. Collected + dated from day
  // one so future drainages start with banked history, not from zero.
  // active:false, gauges:[] — never enter the active calibration set.
  {
    key: "blackfoot-river",
    idSlug: "blackfoot",
    url: "https://fishingreports.orvis.com/west/montana/blackfoot-river",
    source: "Orvis",
    river: "Blackfoot",
    gauges: [],
    drainage: "blackfoot",
    active: false,
  },
  {
    key: "rock-creek",
    idSlug: "rockcreek",
    url: "https://fishingreports.orvis.com/west/montana/rock-creek",
    source: "Orvis",
    river: "Rock Creek",
    gauges: [],
    drainage: "clark-fork", // per locked bucket: Clark Fork proper + Rock Creek
    active: false,
  },
  {
    key: "clark-fork-river",
    idSlug: "clarkfork",
    url: "https://fishingreports.orvis.com/west/montana/clark-fork-river",
    source: "Orvis",
    river: "Clark Fork",
    gauges: [],
    drainage: "clark-fork",
    active: false,
  },
];

// ---- BRO (Blackfoot River Outfitters own site) source registry --------------
// Added 2026-09-11 — the "own-site rating PRIMARY" this file's original header
// deferred to "LATER chats." Trigger: the Orvis-hosted Bitterroot mainstem
// page went stale (no update Aug 28 -> Sep 11+) while BRO's own site kept
// updating normally (confirmed fresher, Sep 4) — exactly the gap the original
// design intended BRO-primary to cover.
//
// Structurally different site (Shopify, not Orvis' Joomla template) — own
// parser set below, NOT the Orvis parsers. Same pull-and-park pattern:
// Bitterroot mainstem is active (real gauges exist); Clark Fork, Blackfoot,
// Rock Creek are parked (active:false, gauges:[]) until those drainages exist.
//
// No standalone East/West Fork report on BRO's site — they publish ONE
// combined "Bitterroot River" report, unlike Orvis' three-way fork split. So
// BRO only covers the mainstem here; East Fork and West Fork stay Orvis-only.
//
// Data-quality note carried into buildRecordBRO(): BRO's page has no 5-step
// Poor/Fair/Good/VeryGood/Hot rating widget the way Orvis does — `rating`
// stays null for every BRO record rather than inventing one from prose.
const BRO_SOURCES = [
  {
    key: "bro-bitterroot-river",
    idSlug: "bitterroot", // NOT "bro-bitterroot" -- id template already prepends source ("bro-")
    url: "https://blackfootriver.com/blogs/fishing-reports/bitterroot-river-fishing-report",
    source: "BRO",
    river: "Bitterroot (mainstem)",
    gauges: ["darby", "bell", "msla"],
    drainage: "bitterroot",
    active: true,
  },
  {
    key: "bro-clark-fork-river",
    idSlug: "clarkfork",
    url: "https://blackfootriver.com/blogs/fishing-reports/clark-fork-river-fishing-report",
    source: "BRO",
    river: "Clark Fork",
    gauges: [],
    drainage: "clark-fork",
    active: false,
  },
  {
    key: "bro-blackfoot-river",
    idSlug: "blackfoot",
    url: "https://blackfootriver.com/blogs/fishing-reports/the-blackfoot-river-fishing-report",
    source: "BRO",
    river: "Blackfoot",
    gauges: [],
    drainage: "blackfoot",
    active: false,
  },
  {
    key: "bro-rock-creek",
    idSlug: "rockcreek",
    url: "https://blackfootriver.com/blogs/fishing-reports/rock-creek-fishing-report",
    source: "BRO",
    river: "Rock Creek",
    gauges: [],
    drainage: "clark-fork",
    active: false,
  },
];

// ---- tiny HTML helpers ------------------------------------------------------
function decodeEntities(s) {
  return String(s)
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&#x27;/g, "'")
    .replace(/&deg;/g, "\u00b0")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

function stripTags(s) {
  return decodeEntities(String(s).replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function firstMatch(html, re) {
  const m = re.exec(html);
  return m ? m[1] : null;
}

// ---- parsers ----------------------------------------------------------------

// amCharts chart.data (multiline in the real page): highest `number` wins.
// We can't JSON.parse the block directly (trailing formatting), so pull the
// rating/number pairs with a tolerant regex.
function parseRating(html) {
  const block = firstMatch(html, /chart\.data\s*=\s*(\[[\s\S]*?\]);/);
  if (!block) return null;
  const pairRe = /"rating"\s*:\s*"([^"]+)"\s*,\s*"number"\s*:\s*(\d+)/g;
  let m;
  let best = null;
  while ((m = pairRe.exec(block))) {
    const num = Number(m[2]);
    if (!best || num > best.number) best = { rating: m[1], number: num };
  }
  if (!best) return null;
  const raw = best.rating;
  return { raw, scale: "orvis-5step", value0to10: ORVIS_5STEP[raw] ?? null };
}

// <p class="last-updated">Last Updated: <span>7/10/26</span></p> -> YYYY-MM-DD
function parseReportDate(html) {
  const span = firstMatch(
    html,
    /class="last-updated"[^>]*>[\s\S]*?<span>\s*([\d]{1,2}\/[\d]{1,2}\/[\d]{2,4})\s*<\/span>/i
  );
  if (!span) return null;
  const parts = span.split("/");
  if (parts.length !== 3) return null;
  let [mo, da, yr] = parts.map((x) => x.trim());
  if (yr.length === 2) yr = "20" + yr; // 26 -> 2026
  const mm = String(Number(mo)).padStart(2, "0");
  const dd = String(Number(da)).padStart(2, "0");
  if (mm === "NaN" || dd === "NaN" || !/^\d{4}$/.test(yr)) return null;
  return `${yr}-${mm}-${dd}`;
}

// <span class="text-brand">Jim Mitchell's </span> -> "Jim Mitchell"
function parseReporter(html, fallback) {
  const raw = firstMatch(html, /<span class="text-brand">\s*([^<]*?)\s*<\/span>/i);
  if (!raw) return fallback;
  return decodeEntities(raw).replace(/'s\s*$/i, "").trim() || fallback;
}

// <p class="report-temp__degrees">67</p>  (SOFT cross-check only)
function parseWaterTemp(html) {
  const v = firstMatch(html, /class="report-temp__degrees"[^>]*>\s*(\d{2,3})\s*</i);
  return v ? Number(v) : null;
}

// text after an <h2>LABEL</h2> inside a report-widget block
function parseAfterH2(html, label) {
  const re = new RegExp(
    `<h2[^>]*>\\s*${label}\\s*<\\/h2>([\\s\\S]*?)<\\/div>`,
    "i"
  );
  const m = re.exec(html);
  return m ? stripTags(m[1]) || null : null;
}

function parseHatches(html) {
  const txt = parseAfterH2(html, "Hatches:");
  if (!txt) return [];
  return txt
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBestTime(html) {
  return parseAfterH2(html, "Best Time to Fish:");
}

// "Tip of the Week" widget body
function parseTip(html) {
  const m = /Tip of the Week<\/h2>\s*<p>([\s\S]*?)<\/p>/i.exec(html);
  return m ? stripTags(m[1]) : null;
}

// "Techniques & Tips" alert body (technique context)
function parseTechnique(html) {
  const m = /class="alert__body"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  return m ? stripTags(m[1]) : null;
}

// normalize sizes. Real Orvis pages use THREE forms:
//   range with '-'    : "14-18", "#10-14", "#04-08"  -> "14-18","10-14","4-8"
//   range with '/'    : "12/18", "6/2"                -> "12-18","6-2"
//   discrete comma set: "16,14,12"                    -> "16,14,12" (kept as set)
// Rule: strip leading '#'. If it's a comma list, treat as a discrete size SET
// (keep commas, just de-zero-pad each). Otherwise it's a range: '/' -> '-',
// de-zero-pad each end. A bare single size ("#6") stays "6".
function deZeroPad(t) {
  const s = t.trim();
  return /^\d+$/.test(s) ? String(Number(s)) : s;
}
function normalizeSizes(raw) {
  if (raw == null) return null;
  let s = decodeEntities(String(raw)).replace(/^#/, "").trim();
  if (!s || /^n\/?a$/i.test(s)) return null;
  if (s.includes(",")) {
    // discrete set -- preserve as comma-joined, de-zero-pad each
    return s.split(",").map(deZeroPad).filter(Boolean).join(",") || null;
  }
  // range (or single) -- unify '/' to '-'
  s = s
    .replace(/\//g, "-")
    .split("-")
    .map(deZeroPad)
    .filter(Boolean)
    .join("-");
  return s || null;
}

// colors: real pages separate with ',' OR '/' ("Yellow, Orange", "Olive/White").
// Preserve each token verbatim (do not re-case -- the shop's own casing is data).
function parseColors(raw) {
  const t = decodeEntities(raw || "");
  if (!t || /^n\/?a$/i.test(t)) return [];
  return t
    .split(/[,/]/)
    .map((c) => c.trim())
    .filter(Boolean);
}

// Fly table: <tr class="gear-row" data-shop-name="..."> with <td>s:
//   [0] name (<strong>), [1] colors, [2] sizes. rank = DOM order (1-based).
function parseFlies(html, canon, onUnmapped) {
  const flies = [];
  const rowRe = /<tr[^>]*class="[^"]*\bgear-row\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  let rank = 0;
  while ((rm = rowRe.exec(html))) {
    const rowTag = rm[0];
    const rowInner = rm[1];
    const nameRaw = decodeEntities(
      firstMatch(rowTag, /data-shop-name="([^"]*)"/) || ""
    );
    if (!nameRaw) continue;
    rank += 1;

    // pull the <td> cells in order
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    let tm;
    while ((tm = tdRe.exec(rowInner))) tds.push(tm[1]);

    const colors = parseColors(tds[1] != null ? stripTags(tds[1]) : "");
    const sizes = normalizeSizes(tds[2] != null ? stripTags(tds[2]) : "");

    const nameCanonical = canon(nameRaw);
    if (nameCanonical === null) onUnmapped(nameRaw); // log-and-keep-going

    const type = nameCanonical ? TYPE_BY_CANON[nameCanonical] ?? null : null;

    flies.push({
      rank,
      nameRaw, // raw name always preserved (contract)
      nameCanonical, // null when unresolved -- record still lands
      type, // inferred from canonical; null if unknown
      colors,
      sizes,
    });
  }
  return flies;
}

// ---- BRO parsers (Shopify site — structurally different from Orvis) --------
// CAUTION, read before trusting this in production: these were written
// against a markdown-RENDERED capture of the live pages (fetched via a tool
// that converts HTML to markdown), not the raw HTML tags the scraper will
// actually receive. This is exactly the failure mode this file's own header
// already documents burning the original Orvis parsers ("8-2 parsers were
// written against fixtures that GUESSED the DOM... reportDate came back
// empty and every source was skipped"). Recommended before this ships: the
// same debug-dump workflow already used once for Orvis (a temporary
// debug-bro-dump.yml capturing real HTML, then deleted) to confirm these
// regexes actually match, the same way `-8-3` fixed the Orvis parsers against
// real captured markup instead of guesses.

const BRO_MONTHS = { January:1, February:2, March:3, April:4, May:5, June:6,
  July:7, August:8, September:9, October:10, November:11, December:12 };

// "Last updated: September 4, 2026" -> "2026-09-04"
function parseBRODate(html) {
  const m = /Last updated:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/i.exec(html);
  if (!m) return null;
  const mo = BRO_MONTHS[m[1]];
  if (!mo) return null;
  const dd = String(Number(m[2])).padStart(2, "0");
  const mm = String(mo).padStart(2, "0");
  return `${m[3]}-${mm}-${dd}`;
}

// "Water temperature at mid-day" ... "70"  (SOFT cross-check only, same as Orvis)
function parseBROWaterTemp(html) {
  const m = /Water temperature at mid-day[\s\S]{0,80}?(\d{2,3})/i.exec(html);
  return m ? Number(m[1]) : null;
}

// 8-4 fix: parseBROTip/parseBROOutlook/parseBROWaterCondition below were
// rewritten 2026-09-11 against RAW HTML captured via debug-bro-dump.yml.
// The prior versions bounded on markdown syntax ("**Label:**", "##") that
// only existed in web_fetch's rendered markdown, not the real Shopify page
// -- exact same failure class the file's own 8-3 header describes for the
// original Orvis break. Confirmed working against all 4 live BRO pages.

// Real markup: <p><strong>Tip of the Week:</strong> body text...</p>
function parseBROTip(html) {
  const m = /<strong>\s*Tip of the Week:?\s*<\/strong>\s*([\s\S]*?)<\/p>/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// Real markup: <p>...<strong>7 Day Outlook:</strong> body text...</p>
function parseBROOutlook(html) {
  const m = /<strong>\s*7 Day Outlook:?\s*<\/strong>\s*([\s\S]*?)<\/p>/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// Real markup: <p>...<strong>Best Techniques:</strong> body text...</p>
// Added 2026-09-11 -- this is BRO's genuine rig/technique recommendation
// (dry-dropper combos, specific fly names by role) and belongs in the same
// `technique` slot Orvis' own "Techniques & Tips" alert__body fills. It was
// previously missing entirely; `technique` was a repurposed placeholder
// holding the 7 Day Outlook text instead (now split out to its own field).
// Flagged by owner review: this prose is the shop's actual "what to use"
// call, distinct from and more authoritative than the "Featured Flies"
// tabbed carousel, which is closer to a shop-the-catalog upsell.
function parseBROTechnique(html) {
  const m = /<strong>\s*Best Techniques:?\s*<\/strong>\s*([\s\S]*?)<\/p>/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// Real markup: <h4>Water Condition</h4><p>Clear and Dropping</p>
function parseBROWaterCondition(html) {
  const m = /<h4>\s*Water Condition\s*<\/h4>\s*<p>\s*([^<]+?)\s*<\/p>/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// Fly names from the "[River] {Dries,Nymph,Streamer(s)} Recommendations"
// tabbed product carousel ("Featured Flies" section). type comes from the
// tab label itself (more reliable here than Orvis' canonical-name inference,
// since BRO groups by category explicitly) rather than TYPE_BY_CANON. NOTE:
// these are BRO's curated shop category listings for that river, not
// necessarily a literal ranked "what's hot today" pick list the way Orvis'
// gear-row table claims to be -- lower-confidence provenance, flagged via
// `flySource` on the record.
//
// 8-4 rewrite (2026-09-11), confirmed against real HTML from debug-bro-dump.yml
// and cross-checked against live screenshots of all 3 tabs on all 4 rivers:
// the page is a radio-input tab widget (<input id="tab-...ID">). Anchoring on
// the "## Label" heading text (leftover from a markdown-rendered draft) was
// wrong twice over: (1) raw HTML has no "##" at all, and (2) even matched on
// a real HTML heading, that heading sits INSIDE the NEXT tab's pane, not its
// own -- so a heading-anchored block silently grabs the wrong category's
// products (confirmed: earlier draft labeled real nymph patterns "dry").
// Fix: map each tab's id -> category from the nav <label for="tab-ID">, then
// pull products from that id's own <input id="tab-ID">...next <input> slice.
// This is DOM-position-correct regardless of where decorative headings land.
function parseBROFlies(html, canon, onUnmapped) {
  const flies = [];
  const typeMap = { dries: "dry", nymph: "nymph", streamer: "streamer", streamers: "streamer" };

  const idToType = {};
  const labelRe = /<label for="tab-([^"]+)"[^>]*>\s*[^<]*?(Dries|Nymph|Streamers?)\s+Recommendations\s*<\/label>/gi;
  let lm;
  while ((lm = labelRe.exec(html))) {
    idToType[lm[1]] = typeMap[lm[2].toLowerCase()] ?? null;
  }

  const inputRe = /<input\s+class="#tabs-pane-input"[^>]*id="tab-([^"]+)"[^>]*>/g;
  const inputs = [];
  let im;
  while ((im = inputRe.exec(html))) inputs.push({ id: im[1], idx: im.index + im[0].length });

  let rank = 0;
  for (let i = 0; i < inputs.length; i++) {
    const type = idToType[inputs[i].id] ?? null;
    if (type === null) continue; // not a Dries/Nymph/Streamers pane -- skip
    const start = inputs[i].idx;
    const end = i + 1 < inputs.length ? inputs[i + 1].idx : html.length;
    const block = html.slice(start, end);
    const nameRe = /<a href="\/products\/[^"]+" class="stretched-link">([^<]+)<\/a>/g;
    let nm;
    const seenInBlock = new Set(); // dedup (carousel tiles + stretched-link repeat the name)
    while ((nm = nameRe.exec(block))) {
      const nameRaw = decodeEntities(nm[1]).trim();
      if (!nameRaw || seenInBlock.has(nameRaw)) continue;
      seenInBlock.add(nameRaw);
      rank += 1;
      const nameCanonical = canon(nameRaw);
      if (nameCanonical === null) onUnmapped(nameRaw);
      flies.push({ rank, nameRaw, nameCanonical, type, colors: [], sizes: null });
    }
  }
  return flies;
}

// ---- assemble one record (BRO) -----------------------------------------------
function buildRecordBRO(src, html, canon, onUnmapped) {
  const reportDate = parseBRODate(html);
  const flies = parseBROFlies(html, canon, onUnmapped);
  const id = `${src.source.toLowerCase()}-${src.idSlug}-${reportDate}`;

  return {
    id,
    scrapedAt: new Date().toISOString(),
    reportDate,
    source: src.source,
    reporter: "Blackfoot River Outfitters", // no named individual on BRO's own site
    url: src.url,
    river: src.river,
    gauges: src.active ? src.gauges : [],
    rating: null, // BRO's own site has no 5-step rating widget -- never invented
    shopWaterTempF: parseBROWaterTemp(html), // SOFT cross-check only
    hatches: [], // no equivalent structured hatch list found on BRO's template
    bestTime: null,
    technique: parseBROTechnique(html), // BRO's real rig/technique recommendation (was a placeholder; see 8-4 note above)
    outlook: parseBROOutlook(html), // BRO-only field: "7 Day Outlook" weather/timing prose (previously squatting in `technique`)
    waterCondition: parseBROWaterCondition(html), // BRO-only field, not on Orvis records
    flies,
    flySource: "shop-recommendations", // Featured Flies carousel -- shop catalog picks, lower confidence than `technique`'s named rig recs or Orvis' ranked gear-row table
    tip: parseBROTip(html),
    tipFlies: [], // prose-tier extraction (pulling named flies out of `tip`/`technique` text) is a later chat -- same as Orvis; needs alias-layer work first (see unmapped-names backlog)
    drainage: src.drainage,
    active: src.active,
  };
}

// ---- assemble one record ----------------------------------------------------
function buildRecord(src, html, canon, onUnmapped) {
  const reportDate = parseReportDate(html);
  const reporter = parseReporter(html, src.source);
  const rating = parseRating(html);
  const flies = parseFlies(html, canon, onUnmapped);
  // id = source+river+reportDate (tracker); idSlug is the locked seed river slug.
  const id = `${src.source.toLowerCase()}-${src.idSlug}-${reportDate}`;

  return {
    id,
    scrapedAt: new Date().toISOString(),
    reportDate,
    source: src.source,
    reporter,
    url: src.url,
    river: src.river,
    gauges: src.active ? src.gauges : [],
    rating,
    shopWaterTempF: parseWaterTemp(html), // SOFT cross-check only
    hatches: parseHatches(html),
    bestTime: parseBestTime(html),
    technique: parseTechnique(html),
    flies,
    tip: parseTip(html),
    tipFlies: [], // prose-tier extraction is a later chat; empty for now
    drainage: src.drainage,
    active: src.active,
  };
}

// ---- fetch (with fixture fallback for sandboxed / blocked envs) -------------
async function fetchHtml(src) {
  const fixtureDir = process.env.SHOP_FIXTURE_DIR;
  if (fixtureDir) {
    const p = join(fixtureDir, `${src.key}.html`);
    if (existsSync(p)) {
      console.log(`[fixture] ${src.key} <- ${p}`);
      return readFileSync(p, "utf8");
    }
  }
  const res = await fetch(src.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${src.url}`);
  return await res.text();
}

// ---- append-only store ------------------------------------------------------
function loadStore() {
  if (!existsSync(REPORTS_PATH)) {
    throw new Error(
      `seed missing: ${REPORTS_PATH} must exist (append target). Refusing to create blind.`
    );
  }
  const store = JSON.parse(readFileSync(REPORTS_PATH, "utf8"));
  if (!Array.isArray(store.reports)) store.reports = [];
  if (!Array.isArray(store._unmappedNames)) store._unmappedNames = [];
  return store;
}

function main() {
  return (async () => {
    const { canon } = loadAliases();
    const store = loadStore();
    const existingIds = new Set(store.reports.map((r) => r.id));
    const unmappedSeen = new Set(store._unmappedNames.map((u) => u.nameRaw));

    let appended = 0;
    let skipped = 0;
    let parsedOk = 0; // sources that produced a valid record (append OR dedup)
    let sourcesTried = 0;
    const runUnmapped = [];

    const allSources = [...SOURCES, ...BRO_SOURCES];
    for (const src of allSources) {
      sourcesTried += 1;
      let html;
      try {
        html = await fetchHtml(src);
      } catch (err) {
        console.warn(`[warn] fetch failed for ${src.key}: ${err.message}`);
        continue;
      }

      const onUnmapped = (nameRaw) => {
        console.warn(`[unmapped] "${nameRaw}" (${src.river}) -> kept raw, flagged`);
        if (!unmappedSeen.has(nameRaw)) {
          unmappedSeen.add(nameRaw);
          store._unmappedNames.push({
            nameRaw,
            firstSeen: new Date().toISOString().slice(0, 10),
            source: src.source,
            river: src.river,
          });
        }
        runUnmapped.push(nameRaw);
      };

      let rec;
      try {
        rec = src.source === "BRO"
          ? buildRecordBRO(src, html, canon, onUnmapped)
          : buildRecord(src, html, canon, onUnmapped);
      } catch (err) {
        console.warn(`[warn] parse failed for ${src.key}: ${err.message}`);
        continue;
      }

      if (!rec.reportDate) {
        console.warn(
          `[warn] no reportDate for ${src.key}; skipping (cannot form stable id)`
        );
        continue;
      }
      if (!rec.flies.length) {
        console.warn(`[warn] no flies parsed for ${src.key}; skipping (likely DOM drift)`);
        continue;
      }

      parsedOk += 1;

      if (existingIds.has(rec.id)) {
        console.log(`[dedup] ${rec.id} already present; skipping`);
        skipped++;
        continue;
      }

      store.reports.push(rec);
      existingIds.add(rec.id);
      appended++;
      console.log(
        `[append] ${rec.id} — ${rec.flies.length} flies, rating ${rec.rating?.raw ?? "?"}, temp ${rec.shopWaterTempF ?? "?"}`
      );
    }

    if (appended > 0 || runUnmapped.length > 0) {
      writeFileSync(REPORTS_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
    }

    console.log(
      `\nDone. appended=${appended} skipped(dedup)=${skipped} ` +
        `parsedOk=${parsedOk}/${sourcesTried} ` +
        `unmapped_this_run=${runUnmapped.length} ` +
        `total_reports=${store.reports.length} ` +
        `total_unmapped=${store._unmappedNames.length}`
    );

    // Guard: if NOTHING parsed across all sources, the run is broken even though
    // each source failed "gracefully." Exit non-zero so the job goes RED instead
    // of a green all-skip (the exact failure mode that hid behind run #2).
    if (parsedOk === 0) {
      console.error(
        "FATAL: 0 of " + sourcesTried + " sources parsed a valid record. " +
          "Likely DOM drift or all fetches failed. Failing the run."
      );
      process.exitCode = 1;
    }

    return { appended, skipped, parsedOk, runUnmapped, store };
  })();
}

const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  main().catch((err) => {
    console.error("fatal:", err);
    process.exit(1);
  });
}

export {
  parseRating,
  parseFlies,
  parseReportDate,
  parseReporter,
  parseWaterTemp,
  parseHatches,
  parseBestTime,
  parseTip,
  parseTechnique,
  normalizeSizes,
  buildRecord,
  SOURCES,
  BRO_SOURCES,
  buildRecordBRO,
  parseBRODate,
  parseBROWaterTemp,
  parseBROTip,
  parseBROOutlook,
  parseBROTechnique,
  parseBROWaterCondition,
  parseBROFlies,
  ORVIS_5STEP,
  TYPE_BY_CANON,
};
