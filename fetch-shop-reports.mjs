// version: fetch-shop-reports-8-2.mjs
// fetch-shop-reports.mjs — Phase 8, build-step 2.
// FIRST repo landing of the calibration pipeline. Separate from fetch-data.mjs:
// own script, own output (calibration/shop-reports.json), own workflow, own
// (less-frequent) schedule. If this breaks, the gauge dashboard keeps running.
//
// What it does (structured tier only this chat — Orvis x3):
//   1. fetch static server-rendered HTML for each configured Orvis page
//   2. parse fly table from data-shop-name / data-shop-id attrs (no vision)
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
// Prose tier (Grizzly Hackle, Fly Fish Food), per-river weighting, and the
// condition-join are LATER chats — deliberately not built here.

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadAliases } from "./calibration/fly-aliases.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_PATH = join(__dirname, "calibration", "shop-reports.json");

const UA =
  "Mozilla/5.0 (compatible; CFTF-shop-scraper/1.0; +https://jkarchibald.github.io/bitterroot/)";

// ---- rating scale maps ------------------------------------------------------
// Orvis 5-step -> our 0-10 (tracker §202-213). "Hot" flagged: may mean WATER
// hot (hoot-owl orange), not FISHING hot -- do not trust as a high score until
// a live "Hot" day is confirmed. We record value0to10 but the caveat rides in
// the note. Poor/Standard/Good/Excellent/Hot -> ~1.5/3.5/7.5/9/10.
const ORVIS_5STEP = {
  Poor: 1.5,
  Standard: 3.5,
  Good: 7.5,
  Excellent: 9,
  Hot: 10,
};

// ---- source registry (structured tier) --------------------------------------
// Each entry: the crosswalk that attaches a scraped report to our gauge(s),
// plus drainage/active for pull-and-park. reporter is what weighting keys on
// (step 3), NOT source -- Jim Mitchell and Blackfoot both publish on Orvis.
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

// ---- tiny HTML helpers (no DOM dep; static server-rendered pages) -----------
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

// amCharts chart.data block: highest `number` wins -> active rating.
function parseRating(html) {
  const block = firstMatch(html, /chart\.data\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!block) return null;
  let rows;
  try {
    rows = JSON.parse(block);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || !rows.length) return null;
  let best = null;
  for (const r of rows) {
    if (r && typeof r.number === "number") {
      if (!best || r.number > best.number) best = r;
    }
  }
  if (!best) return null;
  const raw = String(best.rating);
  const value0to10 = ORVIS_5STEP[raw] ?? null;
  return { raw, scale: "orvis-5step", value0to10 };
}

function parseReportDate(html) {
  // <time ... datetime="YYYY-MM-DD">
  const iso = firstMatch(html, /datetime="(\d{4}-\d{2}-\d{2})"/);
  return iso || null;
}

function parseWaterTemp(html) {
  // "Water Temp: 52°F" (soft cross-check only)
  const m = /Water Temp:\s*(\d{2,3})\s*(?:&deg;|\u00b0)?\s*F/i.exec(html);
  return m ? Number(m[1]) : null;
}

function parseByClass(html, cls) {
  const re = new RegExp(
    `<[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</`,
    "i"
  );
  const m = re.exec(html);
  return m ? stripTags(m[1]) : null;
}

function parseHatches(html) {
  const out = [];
  const re = /<span[^>]*class="[^"]*\bhatch\b[^"]*"[^>]*>([\s\S]*?)<\/span>/gi;
  let m;
  while ((m = re.exec(html))) out.push(stripTags(m[1]));
  return out;
}

function parseBestTime(html) {
  const raw = parseByClass(html, "best-time");
  if (!raw) return null;
  return raw.replace(/^Best Fishing:\s*/i, "").trim() || null;
}

function parseTip(html) {
  // report-tip block, tags stripped
  const m = /<div[^>]*class="[^"]*\breport-tip\b[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(
    html
  );
  return m ? stripTags(m[1]) : null;
}

// Fly table: one <tr class="fly-row" data-shop-id data-shop-name> per fly.
// Name comes from data-shop-name (cleaner than visible text, per tracker).
function parseFlies(html, canon, onUnmapped) {
  const flies = [];
  const rowRe = /<tr[^>]*class="[^"]*\bfly-row\b[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi;
  let rm;
  while ((rm = rowRe.exec(html))) {
    const rowTag = rm[0];
    const rowInner = rm[1];
    const nameRaw = decodeEntities(
      firstMatch(rowTag, /data-shop-name="([^"]*)"/) || ""
    );
    if (!nameRaw) continue;
    const rank = Number(
      (parseByClassInner(rowInner, "rank") || "").replace(/\D/g, "")
    ) || null;
    const type = (parseByClassInner(rowInner, "fly-type") || "").toLowerCase() || null;
    const colorsRaw = parseByClassInner(rowInner, "fly-colors") || "";
    const colors = colorsRaw
      ? colorsRaw.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    const sizes = parseByClassInner(rowInner, "fly-sizes") || null;

    const nameCanonical = canon(nameRaw);
    if (nameCanonical === null) onUnmapped(nameRaw); // log-and-keep-going

    flies.push({
      rank,
      nameRaw, // raw name always preserved (contract)
      nameCanonical, // null when unresolved -- record still lands
      type,
      colors,
      sizes,
    });
  }
  return flies;
}

function parseByClassInner(rowInner, cls) {
  const re = new RegExp(
    `<td[^>]*class="[^"]*\\b${cls}\\b[^"]*"[^>]*>([\\s\\S]*?)</td>`,
    "i"
  );
  const m = re.exec(rowInner);
  return m ? stripTags(m[1]) : null;
}

function parseAuthor(html) {
  return parseByClass(html, "report-author");
}

// ---- assemble one record ----------------------------------------------------
function buildRecord(src, html, canon, onUnmapped) {
  const reportDate = parseReportDate(html);
  const reporter = parseAuthor(html) || src.source;
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
    technique: parseByClass(html, "technique"),
    flies,
    tip: parseTip(html),
    tipFlies: [], // prose-tier extraction is a later chat; empty for now
    drainage: src.drainage,
    active: src.active,
  };
}

// ---- fetch (with fixture fallback for sandboxed / blocked envs) -------------
async function fetchHtml(src) {
  // Allow a local fixture override for offline validation:
  //   SHOP_FIXTURE_DIR=./fixtures node fetch-shop-reports.mjs
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
    const runUnmapped = [];

    for (const src of SOURCES) {
      let html;
      try {
        html = await fetchHtml(src);
      } catch (err) {
        // one source failing must not kill the whole run
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
        console.warn(`[warn] no reportDate for ${src.key}; skipping (cannot form stable id)`);
        continue;
      }
      if (existingIds.has(rec.id)) {
        console.log(`[dedup] ${rec.id} already present; skipping`);
        skipped++;
        continue;
      }

      store.reports.push(rec);
      existingIds.add(rec.id);
      appended++;
      console.log(
        `[append] ${rec.id} — ${rec.flies.length} flies, rating ${rec.rating?.raw ?? "?"}`
      );
    }

    if (appended > 0 || runUnmapped.length > 0) {
      writeFileSync(REPORTS_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
    }

    console.log(
      `\nDone. appended=${appended} skipped(dedup)=${skipped} ` +
        `unmapped_this_run=${runUnmapped.length} ` +
        `total_reports=${store.reports.length} ` +
        `total_unmapped=${store._unmappedNames.length}`
    );
    return { appended, skipped, runUnmapped, store };
  })();
}

// run when invoked directly
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
  parseWaterTemp,
  parseHatches,
  buildRecord,
  SOURCES,
  ORVIS_5STEP,
};
