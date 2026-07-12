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

    for (const src of SOURCES) {
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
        rec = buildRecord(src, html, canon, onUnmapped);
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
  ORVIS_5STEP,
  TYPE_BY_CANON,
};
