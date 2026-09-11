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
};

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
    idSlug: "bro-bitterroot",
    url: "https://blackfootriver.com/blogs/fishing-reports/bitterroot-river-fishing-report",
    source: "BRO",
    river: "Bitterroot (mainstem)",
    gauges: ["darby", "bell", "msla"],
    drainage: "bitterroot",
    active: true,
  },
  {
    key: "bro-clark-fork-river",
    idSlug: "bro-clarkfork",
    url: "https://blackfootriver.com/blogs/fishing-reports/clark-fork-river-fishing-report",
    source: "BRO",
    river: "Clark Fork",
    gauges: [],
    drainage: "clark-fork",
    active: false,
  },
  {
    key: "bro-blackfoot-river",
    idSlug: "bro-blackfoot",
    url: "https://blackfootriver.com/blogs/fishing-reports/the-blackfoot-river-fishing-report",
    source: "BRO",
    river: "Blackfoot",
    gauges: [],
    drainage: "blackfoot",
    active: false,
  },
  {
    key: "bro-rock-creek",
    idSlug: "bro-rockcreek",
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

// "Tip of the Week:" ... up to the next real section label ("**Label:**") or
// a markdown heading. NOTE: bounding on "next bold text" alone is wrong here
// -- BRO's prose itself contains inline bold (city names, temp ranges, e.g.
// "**Stevensville, Montana**") that isn't a section boundary. Real section
// labels take the specific "**Label:**" shape (colon inside the bold run,
// right before the closing **); inline emphasis doesn't. Bound on that
// specific shape instead. Caught by testing against real fetched content
// (2026-09-11) -- an earlier version of this parser truncated mid-sentence
// on the first inline bold it hit.
function parseBROTip(html) {
  const m = /Tip of the Week:?\*{0,2}\s*([\s\S]{0,600}?)(?=\*\*[A-Za-z0-9][^*]{0,40}:\*\*|\n\s*\n\s*#|$)/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// "7 Day Outlook:" ... same bounding fix as parseBROTip.
function parseBROOutlook(html) {
  const m = /7 Day Outlook:?\*{0,2}\s*([\s\S]{0,600}?)(?=\*\*[A-Za-z0-9][^*]{0,40}:\*\*|\n\s*\n\s*#|$)/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

function parseBROWaterCondition(html) {
  const m = /Water Condition[\s\S]{0,60}?\n+\s*([A-Za-z][A-Za-z ]{2,40})/i.exec(html);
  return m ? stripTags(m[1]).trim() || null : null;
}

// Fly names from the "[River] {Dries,Nymph,Streamer(s)} Recommendations"
// product-card sections. type comes from the section heading itself (more
// reliable here than Orvis' canonical-name inference, since BRO groups by
// category explicitly) rather than TYPE_BY_CANON. NOTE: these are BRO's
// curated shop category listings for that river, not necessarily a literal
// ranked "what's hot today" pick list the way Orvis' gear-row table claims to
// be -- lower-confidence provenance, flagged via `flySource` on the record.
//
// BUG FOUND BY TESTING AGAINST REAL CAPTURED CONTENT (2026-09-11): each
// category name appears TWICE on the page -- once in a plain nav-style list
// near "Featured Flies" ("Bitterroot River Dries Recommendations" as bare
// text, no products following), and again as the real heading directly
// before that category's actual product cards. An earlier version matched
// either occurrence indiscriminately and pulled flies into the wrong
// category. Fix: anchor on the markdown "## " heading prefix specifically,
// which in the captured content marks the real section, not the nav mention.
// Confirmed working against real fetched Bitterroot page content. Still
// unverified against raw HTML (see file-level caution above) -- if the real
// DOM doesn't preserve an equivalent heading-vs-plain-text distinction after
// full HTML parsing, this needs re-checking via the recommended debug-dump.
function parseBROFlies(html, canon, onUnmapped) {
  const flies = [];
  const catRe = /##[^\n]{0,30}?(Dries|Nymph|Streamers?)\s+Recommendations([\s\S]{0,4000}?)(?=##[^\n]{0,30}?(?:Dries|Nymph|Streamers?)\s+Recommendations|##\s*About This Water|$)/gi;
  const typeMap = { dries: "dry", nymph: "nymph", streamer: "streamer", streamers: "streamer" };
  let cm;
  let rank = 0;
  while ((cm = catRe.exec(html))) {
    const type = typeMap[cm[1].toLowerCase()] || null;
    const block = cm[2];
    const nameRe = /\/products\/[^)\]\s"]+[)\]]?\s*\n*!?\[([^\]]+)\]/g;
    let nm;
    while ((nm = nameRe.exec(block))) {
      const nameRaw = decodeEntities(nm[1]).trim();
      if (!nameRaw) continue;
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
    technique: parseBROOutlook(html), // repurposed slot: BRO's "7 Day Outlook" prose
    waterCondition: parseBROWaterCondition(html), // BRO-only field, not on Orvis records
    flies,
    flySource: "shop-recommendations", // lower confidence than Orvis' ranked gear-row table
    tip: parseBROTip(html),
    tipFlies: [],
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
  parseBROWaterCondition,
  parseBROFlies,
  ORVIS_5STEP,
  TYPE_BY_CANON,
};
