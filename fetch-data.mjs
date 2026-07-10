#!/usr/bin/env node
// version: fetch-data-3-3.mjs
// Bitterroot Fishing Conditions — fetch & normalize
// ------------------------------------------------------------------
// Pulls the three VALIDATED data sources, normalizes units/intervals,
// computes a per-gauge "normal", and writes data.json for the static
// front-end (replaces the mockup's hand-authored GAUGES sample array).
//
// Run:  node fetch-data.mjs            (Node 18+, no npm install needed)
// Out:  ./data.json
//
// Sources (all confirmed by real fetches — see STAGE-DATA-LAYER.md):
//   • USGS IV JSON            — discharge(00060)+gage height(00065); NO temp(00010) -> estimated
//   • Open-Meteo forecast     — air temp / precip / cloud / pressure / sun, 7 past + 10 fcst
//   • DNRC StAGE ArcGIS       — layer 4 locationDatasets (sensor map) + layer 2 timeseries
//
// Year-over-year: this-year recent window + same calendar window one year ago.
//   StAGE & USGS last-year come from the SAME validated endpoints (different time params).
//   Last-year WEATHER uses Open-Meteo's archive endpoint, which is NOT yet validated by a
//   real fetch — it is isolated below and fails soft (omitted, app still works). Validate it
//   before relying on last-year weather. (Gauge charts are the YoY surface; weather feeds scoring.)
// ------------------------------------------------------------------

import { writeFile } from "node:fs/promises";

// ----------------------------- CONFIG -----------------------------
const HISTORY_DAYS  = 10;   // recent window pulled for gauges
const FORECAST_DAYS = 10;   // weather forecast horizon
// PHASE 3 (item 1): past_days was 7, which built the ESTIMATED gauges' history off an
// 8-row weather axis while MEASURED gauges carried 11 rows straight from the gauge feed
// (HISTORY_DAYS+1). That left estimated temp series 3 days short and mis-aligned on the
// chart. Match the weather past-window to the gauge history window so every gauge —
// measured or estimated — spans the same 11-day axis. Open-Meteo forecast endpoint caps
// past_days at 92, so 10 is safe; anchorIdx is resolved by DATE MATCH (not position), so
// lengthening the tail does not move "today", the forecast split, or the anchor.
const PAST_WX_DAYS  = HISTORY_DAYS;   // was 7 — see note above
const WADE_CFS      = 200;  // wade-safe flow line drawn on charts
const HOOT_OWL_F    = 66;   // MT cutthroat/bull-trout thermal threshold (NOT the statewide 73)

// PHASE 3: Open-Meteo far-horizon (terminal) forecast days occasionally spike
// implausibly (observed air hiF 98->103->98 on the 8-9 day tail). This guard clamps the
// terminal forecast day's air-temp toward the recent forecast trend before it can feed the
// water-temp forecast, the Tomorrow column, or the bite engine. Conservative: only the last
// TERMINAL_GUARD_DAYS day(s), only when the jump exceeds TERMINAL_GUARD_MAXJUMP vs the
// median of the preceding forecast days.
const TERMINAL_GUARD_DAYS    = 2;    // how many trailing forecast days to inspect (the far
                                     // tail is where GloFAS/Open-Meteo artifacts cluster;
                                     // observed a +10 F spike on the PENULTIMATE day, so 1
                                     // was too few)
const TERMINAL_GUARD_MAXJUMP = 7;    // deg F; a day-over-day air-mid jump beyond this within
                                     // the terminal window is treated as an artifact and the
                                     // day is clamped to trend + this cap

// Parameters we care about, by source code.
//   StAGE: HG=stage(ft), QR=discharge(cfs), TW=water temp(degC)
//   USGS : 00065=gage height(ft), 00060=discharge(cfs), 00010=water temp(degC, often present
//          on the mainstem, usually absent on the small tribs)
//
// TO ADD A GAUGE: append an entry below. Required: id, name, type, source, lat, lon, and
// either `site` (USGS) or `locationId`+`code` (DNRC StAGE). Optional:
//   • drainageMi2 — REQUIRED for type:"mainstem" gauges; it is the axis along which
//     mainstem water-temp is interpolated (upstream small area = cooler, downstream large
//     area = warmer). Order along the river is inferred from this number, so gauges may be
//     listed in any order.
//   • The pipeline auto-detects whether a USGS/StAGE site actually reports temp (00010/TW);
//     a site WITHOUT a probe is filled by the pass-2 estimator, flagged estimated:true.
const GAUGES = [
  { id: "lolo",      name: "Lolo Creek abv Sleeman Creek",      type: "freestone", source: "stage",
    locationId: "bfc4c4ef7d2d41b49f4fc3d2014584f7", code: "76HB 09500", lat: 46.742963, lon: -114.154763 },
  { id: "lolo-hwy93", name: "Lolo Creek below Highway 93", type: "freestone", source: "stage",
    locationId: "06a40d2c83a146618b6e1892ced47849", code: "76HB 09600", lat: 46.75, lon: -114.08 },
  { id: "wf-painted",name: "West Fork Bitterroot abv Painted Rocks", type: "freestone", source: "stage",
    locationId: "9cb056deb6004e67b3bc577f9a532969", code: "76H 1200",  lat: 45.668306, lon: -114.304849 },
  { id: "ef-connor", name: "East Fork Bitterroot nr Conner",    type: "freestone", source: "stage",
    locationId: "87e6c0581c47413fbbf2333afa396adc", code: "76HE 09000",lat: 45.88319,  lon: -114.06594 },
  { id: "wf-conner", name: "West Fork Bitterroot nr Conner",    type: "tailwater", source: "usgs",
    site: "12342500", lat: 45.7248, lon: -114.2823 },   // regulated below Painted Rocks dam; temp estimated
  // ---- Bitterroot MAINSTEM, upstream (cool) -> downstream (warm), by drainage area ----
  // Darby: ~10 mi below the E/W Fork confluence; FWP's regulatory reference gauge for the
  //        UPPER (cutthroat) reach — 66 F / 3-day trigger. Has a temp probe (00010).
  { id: "darby",     name: "Bitterroot River nr Darby",        type: "mainstem", source: "usgs",
    site: "12344000", lat: 45.97205, lon: -114.141233, drainageMi2: 1050 },
  // Bell: middle mainstem. Historically temp-ESTIMATED here; now interpolated on the
  //       Darby<->Missoula gradient (falls back to estimation only if a neighbor is missing).
  { id: "bell",      name: "Bitterroot at Bell Crossing nr Victor", type: "mainstem", source: "usgs",
    site: "12350250", lat: 46.4432, lon: -114.1238, drainageMi2: 1963 },
  // Missoula: lowest mainstem before the Clark Fork; warmest. FWP's reference gauge for the
  //           LOWER reach — 73 F / 3-day trigger. Has a temp probe (00010).
  { id: "msla",      name: "Bitterroot River nr Missoula",     type: "mainstem", source: "usgs",
    site: "12352500", lat: 46.831739, lon: -114.054861, drainageMi2: 2824 },
];

const STAGE_BASE = "https://gis.dnrc.mt.gov/arcgis/rest/services/WRD/WMB_StAGE/MapServer";
const USGS_IV    = "https://waterservices.usgs.gov/nwis/iv/";
const OM_FORECAST= "https://api.open-meteo.com/v1/forecast";
const OM_ARCHIVE = "https://archive-api.open-meteo.com/v1/archive"; // UNVALIDATED — fails soft
const OM_FLOOD   = "https://flood-api.open-meteo.com/v1/flood";     // GloFAS discharge forecast (server-side only; CORS disabled)
const M3S_TO_CFS = 35.3146667;

// --------------------------- utilities ----------------------------
const DAY = 86400_000;
const cToF = (c) => (c == null ? null : c * 9 / 5 + 32);
const round = (n, p = 2) => (n == null ? null : Math.round(n * 10 ** p) / 10 ** p);
const ymd = (d) => d.toISOString().slice(0, 10);
// "Today" in the gauge's timezone (America/Denver), as YYYY-MM-DD. Using UTC here would
// roll over to tomorrow in the evening and mis-anchor the forecast, so resolve it in the
// same timezone Open-Meteo returns its daily rows in.
const TZ = "America/Denver";
const todayLocal = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(new Date()); // en-CA → YYYY-MM-DD
const median = (xs) => {
  const a = xs.filter((x) => x != null).sort((p, q) => p - q);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const lastMean = (arr) => {
  if (!arr) return null;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i]?.mean != null) return arr[i].mean;
  return null;
};

// Local wall-clock ISO-ish timestamp ("YYYY-MM-DDTHH:mm") in the gauge timezone,
// so the front-end (which parses the T..:.. clock literally) shows the reading's
// Mountain time, not UTC.
const localStamp = (ms) => {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(new Date(ms)).reduce((o, x) => (o[x.type] = x.value, o), {});
  let hh = p.hour === "24" ? "00" : p.hour;
  return `${p.year}-${p.month}-${p.day}T${hh}:${p.minute}`;
};

// --- StAGE timestamp normalization -----------------------------------------
// DNRC's StAGE ArcGIS layer stores LOCAL Mountain wall-clock but tags it as UTC.
// e.g. a reading the gauge page labels "6/23 4:15 AM" is stored as epoch
// 2026-06-23T04:15:00Z. Read naively (new Date(ms) → convert to Denver) it lands
// at 10:15 PM the PREVIOUS day — which is exactly why StAGE "today" rendered a day
// behind while USGS (genuine UTC) was correct. Verified against the gauge page:
// the UTC *face components* of the stored epoch ARE the displayed Mountain clock.
//
// So for StAGE we DON'T timezone-convert. We read the UTC face directly:
//   stageDayKey(ms)  -> "YYYY-MM-DD" exactly as DNRC shows it
//   stageStamp(ms)   -> "YYYY-MM-DDTHH:mm" exactly as DNRC shows it
// (Trying to convert to America/Denver re-introduces a 1-hour error because DNRC
//  stamps fixed MST year-round while Denver observes MDT in summer.)
const _p2 = (n) => String(n).padStart(2, "0");
const stageDayKey = (ms) => {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${_p2(d.getUTCMonth() + 1)}-${_p2(d.getUTCDate())}`;
};
const stageStamp = (ms) => {
  const d = new Date(ms);
  return `${stageDayKey(ms)}T${_p2(d.getUTCHours())}:${_p2(d.getUTCMinutes())}`;
};

// --- StAGE clock-time correction (DST) -------------------------------------
// DNRC's UTC face holds a FIXED MST (UTC-7) wall-clock year-round. Reading it
// raw (stageStamp) therefore yields MST, which in summer is 1h behind the MDT
// clock the DNRC gauge page actually displays — the source of the -1h skew on
// the "now" reading (page 8:15a -> card 7:15a). To show the correct Mountain
// wall-clock, recover the TRUE UTC instant of the reading (MST face + 7h) and
// run it through the DST-aware localStamp. We do this ONLY for the displayed
// "latest" clock; stageDayKey stays on the raw face so daily bucketing (which
// was fixed to match DNRC's day) is unaffected and can't roll across midnight.
const STAGE_MST_OFFSET_MS = 7 * 3600 * 1000;
const stageLatestStamp = (ms) => localStamp(ms + STAGE_MST_OFFSET_MS);

// Newest non-null raw sample → the true "right now" snapshot for the gauge.
// `samples` are {t, v}; we don't assume they're pre-sorted. `stampFn` formats the
// display timestamp (StAGE passes stageStamp; USGS defaults to localStamp).
const latestSample = (samples, stampFn = localStamp) => {
  let best = null;
  for (const s of samples || []) {
    if (s == null || s.v == null || Number.isNaN(s.v)) continue;
    if (!best || s.t > best.t) best = s;
  }
  return best ? { value: round(best.v), ts: stampFn(best.t), tsUtc: new Date(best.t).toISOString() } : null;
};

async function fetchJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      if (j && j.error) throw new Error(`ArcGIS: ${j.error.message}`);
      return j;
    } catch (e) {
      if (i === tries - 1) { console.warn(`  ! fetch failed: ${url}\n    ${e.message}`); return null; }
      await new Promise((res) => setTimeout(res, 800 * (i + 1)));
    }
  }
}

// Aggregate irregular {t(ms), v} samples into per-day {date, min, mean, max, n}.
// Day key in the gauge's local timezone (America/Denver). Using ymd() (UTC) here
// misfiles samples near the day boundary into the wrong day, which is how an
// in-progress "today" bucket can fail to form / land under the prior day.
const ymdLocal = (d) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d instanceof Date ? d : new Date(d));

function toDaily(samples, dayKeyFn = ymdLocal) {
  const buckets = new Map();
  for (const { t, v } of samples) {
    if (v == null || Number.isNaN(v)) continue;
    const key = dayKeyFn(t);
    (buckets.get(key) || buckets.set(key, []).get(key)).push(v);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, vs]) => ({
      date,
      min: round(Math.min(...vs)), max: round(Math.max(...vs)),
      mean: round(vs.reduce((s, x) => s + x, 0) / vs.length), n: vs.length,
    }));
}

// Two windows: recent (this year) and the same calendar span one year ago.
function windows() {
  const now = Date.now();
  const thisStart = now - HISTORY_DAYS * DAY;
  // shift by 365d for the comparison window (good enough; leap-year drift is 1 day)
  return {
    thisYear: { start: thisStart, end: now },
    // extend the comparison window FORECAST_DAYS past "now" (those dates last year
    // are in the past → real data exists) so last-year spans the forecast region too.
    lastYear: { start: thisStart - 365 * DAY, end: now + FORECAST_DAYS * DAY - 365 * DAY },
  };
}

// --------------------------- DNRC StAGE ----------------------------
// Resolve which SensorID carries each parameter for a location, preferring the
// freshest sub-daily ("working"/raw) series over the "Daily Average" rollup.
async function stageSensors(locationId) {
  const url = `${STAGE_BASE}/4/query?where=LocationID%3D%27${locationId}%27&outFields=*&f=json`;
  const j = await fetchJson(url);
  const rows = (j?.features || []).map((f) => f.attributes).filter((a) => a.isPublished);
  const pick = (param) => {
    const cands = rows.filter((r) => r.Parameter === param);
    if (!cands.length) return null;
    cands.sort((a, b) => {
      const subDaily = (r) => (r.ComputationPeriod === "Daily" ? 1 : 0);   // prefer non-daily
      const labelRank = (r) => (/daily average/i.test(r.SensorLabel || "") ? 1 : 0);
      return subDaily(a) - subDaily(b) || labelRank(a) - labelRank(b);
    });
    const c = cands[0];
    return { sensorId: c.SensorID, unit: c.UnitOfMeasure, label: c.SensorLabel, code: c.SensorCode };
  };
  return { stage: pick("HG"), flow: pick("QR"), temp: pick("TW") };
}

async function stageSeries(sensorId, { start, end }) {
  // The Timestamp field is a Date — ArcGIS standardized queries reject raw epoch-ms,
  // so compare against date literals:  Timestamp >= timestamp 'YYYY-MM-DD HH:MM:SS'.
  // (Times are UTC per the layer's timeReference.)
  //
  // IMPORTANT: some StAGE gauges log far more than the once-assumed ~96/day. Lolo
  // runs ~530–570 samples/day, so a 10-day window is ~5,000–6,000 rows. The old
  // single request with resultRecordCount=2000 and NO orderBy returned the OLDEST
  // 2000 rows (service default order) and silently dropped the newest days — which
  // is exactly why "today" never appeared for high-frequency StAGE gauges while
  // lower-frequency USGS gauges were fine. Fix: order Timestamp DESC (so any cap
  // keeps the NEWEST rows) and page through with resultOffset until the window is
  // exhausted, so neither end is ever truncated.
  const lit = (ms) => `timestamp '${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}'`;
  const where = encodeURIComponent(
    `SensorID='${sensorId}' AND Timestamp >= ${lit(start)} AND Timestamp <= ${lit(end)}`
  );
  const PAGE = 2000;          // request size; service may clamp to its own maxRecordCount
  const MAX_ROWS = 24000;     // hard stop (~40 days at Lolo's rate) so a bad response can't loop forever
  const order = encodeURIComponent("Timestamp DESC");
  let provisional = false;
  const seen = new Set();      // dedupe by timestamp (guards layers that ignore resultOffset)
  const samples = [];
  // Advance the offset by the number of rows the service ACTUALLY returned, not by
  // PAGE — if the layer clamps pages to a smaller maxRecordCount (e.g. 1000), a fixed
  // +PAGE step would skip half the window and punch gaps in the series.
  let offset = 0;
  while (samples.length < MAX_ROWS) {
    const url = `${STAGE_BASE}/2/query?where=${where}`
      + `&outFields=Timestamp,RecordedValue,ApprovalName,GradeName`
      + `&orderByFields=${order}`
      + `&resultOffset=${offset}&resultRecordCount=${PAGE}&f=json`;
    const j = await fetchJson(url);
    const feats = j?.features || [];
    let added = 0;
    for (const f of feats) {
      const a = f.attributes;
      if (seen.has(a.Timestamp)) continue;   // skip rows a non-paging layer re-sent
      seen.add(a.Timestamp);
      if (/provisional/i.test(a.ApprovalName || "")) provisional = true;
      samples.push({ t: a.Timestamp, v: a.RecordedValue });
      added++;
    }
    // Stop when: empty page, or no NEW rows (layer ignored offset → would otherwise loop).
    if (feats.length === 0 || added === 0) break;
    offset += feats.length;                  // step by rows returned, not by PAGE
    // Stop when the service signals no more pages AND it gave us a short page.
    if (!j?.exceededTransferLimit && feats.length < PAGE) break;
  }
  samples.sort((p, q) => p.t - q.t);   // normalize to ascending for downstream bucketing
  return { samples, provisional };
}

async function pullStageGauge(g, win) {
  const sensors = await stageSensors(g.locationId);
  const out = { stage: null, flow: null, watertemp: null };
  const meta = { measuredTemp: !!sensors.temp, provisional: false };
  for (const [key, paramKey, conv] of [
    ["stage", "stage", (v) => v],            // ft
    ["flow", "flow", (v) => v],              // cfs
    ["watertemp", "temp", cToF],             // degC -> degF
  ]) {
    const s = sensors[paramKey];
    if (!s) continue;
    const ty = await stageSeries(s.sensorId, win.thisYear);
    const ly = await stageSeries(s.sensorId, win.lastYear);
    if (ty.provisional) meta.provisional = true;
    const tyConv = ty.samples.map((x) => ({ t: x.t, v: conv(x.v) }));
    // StAGE timestamps are local-as-UTC → read by face value, never tz-convert.
    out[key] = {
      unit: key === "watertemp" ? "°F" : (s.unit === "ft^3/s" ? "cfs" : s.unit),
      sensorCode: s.code,
      latest: latestSample(tyConv, stageLatestStamp),   // newest instantaneous reading = "now" snapshot (DST-aware clock)
      thisYear: toDaily(tyConv, stageDayKey),
      lastYear: toDaily(ly.samples.map((x) => ({ t: x.t, v: conv(x.v) })), stageDayKey),
    };
  }
  // A StAGE site without a temp sensor needs the pass-2 estimate, same as the
  // USGS path — omitting this left wf-painted with watertemp:null forever.
  return { series: out, meta, _needsTempEstimate: !sensors.temp };
}

// ----------------------------- USGS --------------------------------
function usgsValues(j, paramCode) {
  const ts = (j?.value?.timeSeries || []).find((t) => t.variable.variableCode[0].value === paramCode);
  if (!ts) return { samples: [], provisional: false };
  let provisional = false;
  const samples = (ts.values[0]?.value || []).map((v) => {
    if ((v.qualifiers || []).includes("P")) provisional = true;
    const num = parseFloat(v.value);
    return { t: Date.parse(v.dateTime), v: Number.isNaN(num) || num <= -999999 ? null : num };
  });
  return { samples, provisional };
}

async function usgsFetch(site, { start, end }) {
  const sd = new Date(start).toISOString().slice(0, 19);
  const ed = new Date(end).toISOString().slice(0, 19);
  // 00010 (temp) is absent for our two USGS sites; we still request it in case it ever appears.
  const url = `${USGS_IV}?sites=${site}&parameterCd=00060,00065,00010&startDT=${sd}&endDT=${ed}&format=json`;
  return fetchJson(url);
}

async function pullUsgsGauge(g, win) {
  const ty = await usgsFetch(g.site, win.thisYear);   // recent IV
  const ly = await usgsFetch(g.site, win.lastYear);   // same window last year (IV; may be empty if beyond retention)
  const flowTy = usgsValues(ty, "00060"), flowLy = usgsValues(ly, "00060");
  const stgTy  = usgsValues(ty, "00065"), stgLy  = usgsValues(ly, "00065");
  const tmpTy  = usgsValues(ty, "00010");
  const provisional = flowTy.provisional || stgTy.provisional;
  const series = {
    flow:  { unit: "cfs", latest: latestSample(flowTy.samples), thisYear: toDaily(flowTy.samples), lastYear: toDaily(flowLy.samples) },
    stage: { unit: "ft",  latest: latestSample(stgTy.samples),  thisYear: toDaily(stgTy.samples),  lastYear: toDaily(stgLy.samples) },
    watertemp: null,
  };
  const hasMeasuredTemp = tmpTy.samples.some((s) => s.v != null);
  if (hasMeasuredTemp) {
    const tmpConv = tmpTy.samples.map((s) => ({ t: s.t, v: cToF(s.v) }));
    series.watertemp = { unit: "°F", latest: latestSample(tmpConv), thisYear: toDaily(tmpConv), lastYear: [] };
  }
  return { series, meta: { measuredTemp: hasMeasuredTemp, provisional }, _needsTempEstimate: !hasMeasuredTemp };
}

// --------------------------- Open-Meteo ----------------------------
async function weatherForecast(lat, lon) {
  const url = `${OM_FORECAST}?latitude=${lat}&longitude=${lon}`
    + `&hourly=temperature_2m,precipitation,cloud_cover,surface_pressure`
    + `&daily=sunrise,sunset,temperature_2m_max,temperature_2m_min,precipitation_sum`
    + `&past_days=${PAST_WX_DAYS}&forecast_days=${FORECAST_DAYS}`
    + `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FDenver`;
  return fetchJson(url);
}

// UNVALIDATED endpoint — wrapped so a failure just omits last-year weather.
async function weatherArchive(lat, lon, { start, end }) {
  try {
    const url = `${OM_ARCHIVE}?latitude=${lat}&longitude=${lon}`
      + `&start_date=${ymd(new Date(start))}&end_date=${ymd(new Date(end))}`
      + `&daily=temperature_2m_max,temperature_2m_min,precipitation_sum`
      + `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=America%2FDenver`;
    return await fetchJson(url, 1);
  } catch { return null; }
}

function normalizeWeather(fc, archive) {
  if (!fc) return null;
  const h = fc.hourly || {}, d = fc.daily || {};
  const hourly = (h.time || []).map((t, i) => ({
    t, tempF: h.temperature_2m?.[i], precipIn: h.precipitation?.[i],
    cloudPct: h.cloud_cover?.[i], pressureHpa: h.surface_pressure?.[i],
  }));
  const daily = (d.time || []).map((date, i) => ({
    date, hiF: d.temperature_2m_max?.[i], loF: d.temperature_2m_min?.[i],
    precipIn: d.precipitation_sum?.[i], sunrise: d.sunrise?.[i], sunset: d.sunset?.[i],
  }));
  const ad = archive?.daily;
  const lastYearDaily = ad ? (ad.time || []).map((date, i) => ({
    date, hiF: ad.temperature_2m_max?.[i], loF: ad.temperature_2m_min?.[i], precipIn: ad.precipitation_sum?.[i],
  })) : null;
  return { hourly, daily, lastYearDaily };
}

// ----------------------- estimate water temp -----------------------
// USGS sites lack a temp probe. Estimate from air temp as a damped, lagged proxy:
//   Twater ≈ blend of recent daily-mean air temp (water lags & buffers air).
// Clearly flagged estimated; replace with a fitted model once paired data exists.
function estimateWaterTemp(weatherDaily) {
  if (!weatherDaily?.length) return [];
  const airMean = weatherDaily.map((d) => (d.hiF != null && d.loF != null ? (d.hiF + d.loF) / 2 : null));
  const est = [];
  let ema = null;
  const ALPHA = 0.4; // smoothing — water integrates ~2-3 days of air temp
  for (let i = 0; i < weatherDaily.length; i++) {
    const a = airMean[i];
    if (a == null) { est.push({ date: weatherDaily[i].date, mean: null }); continue; }
    // water runs a few degrees cooler than air mean in summer; clamp at/above freezing
    const target = Math.max(33, a - 4);
    ema = ema == null ? target : ALPHA * target + (1 - ALPHA) * ema;
    est.push({ date: weatherDaily[i].date, min: round(ema - 3), mean: round(ema), max: round(ema + 3), n: 0 });
  }
  return est;
}

// ===================== water-temp estimator v2 =====================
// Replaces the crude air-minus-4 proxy, which ran 5-9F too hot on snowmelt
// rivers (Bell read ~60F when the Bitterroot was ~52F, throwing off every
// downstream score). v2 anchors estimates to the drainage's MEASURED water
// signal instead of air. Chain, per gauge per date:
//   1. mainstem / dead-probe freestone -> simple avg of working freestone probes
//   2. tailwater                       -> dam cold-release setpoint (seasonal,
//                                         capped below stress; never hoot-owl)
//   3. measured freestone whose own probe is dead but has last-year temp ->
//        last year's temp on this date, shifted by the SIGN of flow spacing
//        (this vs last year; higher flow -> colder), small & capped
//   4. nothing usable -> seasonal normal -> air-minus-offset (true last resort)
// All results stay flagged estimated:true.
const STRESS_CAP_F = 60;   // tailwater estimate ceiling (below HOOT_OWL_F=66)
const LY_SHIFT_STEP = 2;   // fallback #3 directional step, degrees (capped, not proportional)

// pass-1 product: measured freestone water temp averaged across reporting probes,
// keyed by date. Built only from freestone gauges that actually measure temp.
function measuredFreestoneAvgByDate(gaugeList) {
  const acc = {};
  for (const g of gaugeList) {
    if (g.type !== "freestone") continue;
    if (!(g.meta && g.meta.measuredTemp)) continue;
    const ty = (g.series && g.series.watertemp && g.series.watertemp.thisYear) || [];
    for (const row of ty) {
      if (row && row.date != null && row.mean != null) {
        (acc[row.date] = acc[row.date] || { sum: 0, n: 0 });
        acc[row.date].sum += row.mean; acc[row.date].n += 1;
      }
    }
  }
  const out = {};
  for (const d in acc) out[d] = round(acc[d].sum / acc[d].n);
  return out;
}

// dam release: stable, cold, seasonal nudge; hard-capped below stress so it can
// never be estimated into the hoot-owl zone (matches observed "never goes hoot owl").
function tailwaterSetpoint(ymd) {
  const mo = +String(ymd).slice(5, 7);
  let base;
  if (mo >= 6 && mo <= 9) base = 48;        // Jun-Sep cold releases
  else if (mo === 5 || mo === 10) base = 46; // shoulder
  else base = 44;                            // winter
  return Math.min(base, STRESS_CAP_F - 1);
}

// fallback #3: shift last-year temp by the SIGN of the year-over-year flow gap
// (snowmelt proxy). Higher flow than last year -> colder water -> shift down.
// Air gap is a backup signal when last-year flow is unavailable. Directional &
// capped — a nudge in the right direction, not a precise prediction.
function shiftLastYearTemp(lyTemp, flowThis, flowLast, airThis, airLast) {
  if (lyTemp == null) return null;
  let dir = 0;
  if (flowThis != null && flowLast != null && flowLast > 0) {
    const rel = (flowThis - flowLast) / flowLast;
    if (rel > 0.08) dir = -1;
    else if (rel < -0.08) dir = +1;
  } else if (airThis != null && airLast != null) {
    if (airThis - airLast > 3) dir = +1;
    else if (airThis - airLast < -3) dir = -1;
  }
  return round(lyTemp + dir * LY_SHIFT_STEP);
}

// estimate one gauge's water temp for a single date. ctx supplies the drainage
// average plus the per-gauge fallback inputs. Returns {mean, via} or {mean:null}.
function estimateWaterTempV2(ctx) {
  const type = ctx.gauge.type;
  const avg = ctx.freestoneAvg[ctx.date];

  if (type === "tailwater") return { mean: tailwaterSetpoint(ctx.date), via: "tailwater-setpoint" };

  if (type === "mainstem" || type === "freestone") {
    if (avg != null) return { mean: avg, via: "freestone-avg" };
    const shifted = shiftLastYearTemp(ctx.lyTempOnDate, ctx.flowThisYr, ctx.flowLastYr, ctx.airThisYr, ctx.airLastYr);
    if (shifted != null) return { mean: shifted, via: "ly-shift" };
  }

  if (ctx.normalWaterT != null) return { mean: round(ctx.normalWaterT), via: "normal" };
  if (ctx.airMeanToday != null) return { mean: round(Math.max(33, ctx.airMeanToday - 4)), via: "air-fallback" };
  // PHASE 3 (item 4 — no-unknown mandate): this branch used to return {mean:null}, which
  // was the last structural way a gauge could reach score time with no temperature (the
  // frontend's dead "unknown -> orange" fallback). Guarantee a number: a coarse seasonal
  // default keeps the mandate true even in the pathological case where the whole drainage's
  // measured probes AND last-year AND normal AND air are all missing at once. Labeled via
  // "seasonal-floor" so provenance still reads as estimated, and it is clearly the weakest
  // rung — it should essentially never fire in practice.
  return { mean: seasonalDefaultTemp(ctx.date), via: "seasonal-floor" };
}

// Coarse seasonal water-temp default (deg F) for the true last resort only. Cutthroat-water
// summer band; deliberately conservative (never into the hoot-owl zone from a guess).
function seasonalDefaultTemp(ymd) {
  const mo = +String(ymd).slice(5, 7);
  if (mo >= 7 && mo <= 8) return 58;   // mid-summer
  if (mo === 6 || mo === 9) return 54;  // early summer / early fall
  if (mo === 5 || mo === 10) return 48; // shoulder
  return 40;                            // winter
}

// build a full estimated series (history + forecast) for one gauge over the
// supplied weather-daily date axis, using the drainage average + fallbacks.
// HISTORY uses the measured-freestone average (the real water signal). FORECAST
// dates have no future probe data, so instead of reverting to raw air (which
// reads 5-9F too hot), we anchor on the gauge's today value and carry it forward
// along the AIR-temp trend (preserving the water-minus-air offset we observed
// today). Tailwater stays flat at its setpoint regardless.
function buildEstimatedTempSeries(gauge, weatherDaily, freestoneAvg, anchorIdx) {
  const wd = weatherDaily || [];
  const airOf = (d) => (d && d.hiF != null && d.loF != null) ? (d.hiF + d.loF) / 2 : null;

  // resolve the HISTORY series first (this is what's been QA'd and approved)
  const histRows = wd.slice(0, anchorIdx + 1).map((d) => {
    const r = estimateWaterTempV2({
      gauge, date: d.date, freestoneAvg,
      airThisYr: airOf(d), airMeanToday: airOf(d),
      normalWaterT: gauge.normal && gauge.normal.watertemp,
    });
    return { date: d.date, mean: r.mean, _via: r.via };
  });

  // today's anchor value + today's air, to carry the offset into the forecast
  const todayRow = histRows[histRows.length - 1] || {};
  const todayVal = todayRow.mean;
  const todayAir = airOf(wd[anchorIdx]);
  const isTail = gauge.type === "tailwater";

  // NOTE: `date` is REQUIRED on every row — the front-end aligns all series by
  // date (alignSeries), so a date-less estimated row silently fails to align and
  // the gauge renders "temp missing" even though the estimate exists.
  const mk = (mean, date) => ({ date, mean: round(mean), min: mean != null ? round(mean - 3) : null,
                          max: mean != null ? round(mean + 3) : null, n: 0 });

  const thisYear = histRows.map((r) => mk(r.mean, r.date));

  const forecast = wd.slice(anchorIdx + 1).map((d) => {
    let mean;
    if (isTail) {
      mean = tailwaterSetpoint(d.date);                 // dam release: stays flat
    } else if (todayVal != null && todayAir != null && airOf(d) != null) {
      mean = todayVal + (airOf(d) - todayAir) * 0.5;    // ride air trend, damped 0.5x,
      mean = Math.max(33, mean);                        // anchored on today's real value
    } else {
      const r = estimateWaterTempV2({ gauge, date: d.date, freestoneAvg,
        airThisYr: airOf(d), airMeanToday: airOf(d),
        normalWaterT: gauge.normal && gauge.normal.watertemp });
      mean = r.mean;
    }
    return { ...mk(mean, d.date), forecast: true };
  });

  return { thisYear, forecast };
}
// =================== end water-temp estimator v2 ===================

// ================ mainstem water-temp GRADIENT (Phase 3) ================
// The Bitterroot mainstem warms downstream: cool at Darby (drainage ~1,050 mi2) ->
// warmer at Bell (~1,963) -> warmest at Missoula (~2,824). A small-stream diel borrowed
// from the forks is physically wrong for a big river (5-9x the flow damps the swing), so
// instead of fabricating a band we place a temp-less mainstem gauge ON the line between
// its measured mainstem neighbours and carry their REAL min/mean/max.
//
// Per date, for a mainstem gauge that needs an estimate (e.g. Bell has no probe):
//   BOTH neighbours present  -> linear interpolate min/mean/max by drainageMi2.
//   only DOWNSTREAM present  -> extrapolate UP (cooler): subtract the mainstem gradient.
//   only UPSTREAM present    -> extrapolate DOWN (warmer): add the mainstem gradient.
//   gradient slope           -> derived from the measured mainstem points when >=2 exist
//                               (deg F per mi2); else a documented default.
// Returns per-date {min,mean,max,via} or null when no measured mainstem anchor exists
// (caller then falls through to the freestone-average estimator).
const MAINSTEM_DEFAULT_SLOPE_F_PER_MI2 = 0.0025; // ~4.4 F across Darby->Missoula (1,774 mi2);
                                                 // assumption, used only when <2 measured
                                                 // mainstem points exist to fit a slope.
const MAINSTEM_EXTRAP_CAP_F = 6;   // cap on how far an extrapolation may push beyond the
                                   // nearest measured neighbour (deg F), so a single anchor
                                   // can't run away.

// Build, per date, the measured mainstem temp points {area, min, mean, max}, and a fitted
// mean-vs-area slope for that date (least squares) when >=2 points exist.
function mainstemMeasuredByDate(gaugeList) {
  const byDate = {};              // date -> [{area,min,mean,max}]
  for (const g of gaugeList) {
    if (g.type !== "mainstem") continue;
    if (!(g.meta && g.meta.measuredTemp)) continue;   // only real probes anchor the line
    const area = g.drainageMi2;
    if (area == null) continue;
    const ty = (g.series && g.series.watertemp && g.series.watertemp.thisYear) || [];
    const fc = (g.series && g.series.watertemp && g.series.watertemp.forecast) || [];
    for (const row of [...ty, ...fc]) {
      if (row && row.date != null && row.mean != null) {
        (byDate[row.date] = byDate[row.date] || []).push({
          area, min: row.min != null ? row.min : row.mean, mean: row.mean,
          max: row.max != null ? row.max : row.mean,
        });
      }
    }
  }
  return byDate;
}

// slope (deg F per mi2) of mean-vs-area for one date's points; null if <2 points.
function fitMainstemSlope(points) {
  if (!points || points.length < 2) return null;
  const n = points.length;
  const mx = points.reduce((s, p) => s + p.area, 0) / n;
  const my = points.reduce((s, p) => s + p.mean, 0) / n;
  let sxy = 0, sxx = 0;
  for (const p of points) { sxy += (p.area - mx) * (p.mean - my); sxx += (p.area - mx) * (p.area - mx); }
  return sxx > 0 ? sxy / sxx : null;
}

// Estimate one temp-less mainstem gauge's {min,mean,max} for one date from the measured
// mainstem points on that date. Diel band comes from the neighbours (real big-river swing),
// not a fabricated +/-3.
function mainstemGradientEstimate(targetArea, pointsForDate, dateSlope) {
  if (!pointsForDate || !pointsForDate.length || targetArea == null) return null;
  const pts = [...pointsForDate].sort((a, b) => a.area - b.area);
  // exact hit (unlikely) -> use it
  const exact = pts.find((p) => p.area === targetArea);
  if (exact) return { min: exact.min, mean: exact.mean, max: exact.max, via: "mainstem-exact" };

  const below = pts.filter((p) => p.area < targetArea).pop();   // nearest upstream (cooler)
  const above = pts.find((p) => p.area > targetArea);           // nearest downstream (warmer)

  const lerp = (lo, hi, t) => lo + (hi - lo) * t;
  if (below && above) {
    const t = (targetArea - below.area) / (above.area - below.area);
    return {
      min:  round(lerp(below.min,  above.min,  t)),
      mean: round(lerp(below.mean, above.mean, t)),
      max:  round(lerp(below.max,  above.max,  t)),
      via: "mainstem-interp",
    };
  }
  // one-sided: extrapolate along the (fitted or default) slope, capped.
  const slope = dateSlope != null ? dateSlope : MAINSTEM_DEFAULT_SLOPE_F_PER_MI2;
  const anchor = below || above;                 // the single measured neighbour
  const dArea = targetArea - anchor.area;        // + => target is downstream (warmer)
  let dMean = slope * dArea;
  dMean = Math.max(-MAINSTEM_EXTRAP_CAP_F, Math.min(MAINSTEM_EXTRAP_CAP_F, dMean));
  const spreadUp = anchor.max - anchor.mean;     // preserve the neighbour's real diel band
  const spreadDn = anchor.mean - anchor.min;
  const mean = round(anchor.mean + dMean);
  return {
    min: round(mean - spreadDn), mean, max: round(mean + spreadUp),
    via: below ? "mainstem-extrap-down" : "mainstem-extrap-up",
  };
}

// Build a full estimated series (history + forecast) for a temp-less MAINSTEM gauge from
// the mainstem gradient. Returns {thisYear, forecast} or null if no measured mainstem
// anchor exists on ANY date (caller falls back to the freestone-average estimator).
function buildMainstemGradientSeries(gauge, weatherDaily, anchorIdx, measuredByDate) {
  const wd = weatherDaily || [];
  if (!wd.length) return null;
  const mk = (r, date, forecast) => (r == null || r.mean == null)
    ? null
    : { date, min: round(r.min), mean: round(r.mean), max: round(r.max), n: 0, ...(forecast ? { forecast: true } : {}) };

  let any = false;
  const rowFor = (d, forecast) => {
    const pts = measuredByDate[d.date];
    const slope = fitMainstemSlope(pts);
    const est = mainstemGradientEstimate(gauge.drainageMi2, pts, slope);
    if (est) any = true;
    return mk(est, d.date, forecast);
  };

  const thisYear = wd.slice(0, anchorIdx + 1).map((d) => rowFor(d, false)).filter(Boolean);
  const forecast = wd.slice(anchorIdx + 1).map((d) => rowFor(d, true)).filter(Boolean);
  return any ? { thisYear, forecast } : null;
}
// ============== end mainstem water-temp gradient (Phase 3) ==============

// ---------------- terminal-day forecast guard (Phase 3) ----------------
// Open-Meteo's far-horizon daily rows sometimes spike (observed air hiF 98->103->98 on the
// 8-9 day tail). Because water-temp/Tomorrow/bite all derive from this air axis, clamp the
// terminal day(s) toward the recent forecast trend BEFORE anything reads them. Mutates a
// COPY of weather.daily's forecast tail; measured/past rows are never touched.
function guardTerminalForecast(weatherDaily, anchorIdx) {
  const wd = (weatherDaily || []).map((d) => ({ ...d }));   // shallow copy each row
  const fcStart = anchorIdx + 1;
  const midOf = (d) => (d && d.hiF != null && d.loF != null) ? (d.hiF + d.loF) / 2 : null;
  const setMid = (row, newMid) => {
    const range = (row.hiF != null && row.loF != null) ? (row.hiF - row.loF) : 0;
    return { ...row, hiF: round(newMid + range / 2), loF: round(newMid - range / 2), _terminalGuarded: true };
  };
  // A far-horizon ARTIFACT is a lone day that jumps away from its IMMEDIATE neighbours; a
  // legitimate trend (steady warming/cooling, a building heat wave) moves smoothly and each
  // day stays close to the local run. So we judge each terminal-window day against the mean
  // of the LOOKBACK days just before it (a local expectation that follows the trend), not a
  // fixed early-window median. A day beyond +/-TERMINAL_GUARD_MAXJUMP of that local mean is
  // clamped toward it. This clamps the observed 103 F lone spike while leaving sustained
  // trends untouched.
  const LOOKBACK = 3;
  const firstGuarded = Math.max(fcStart + 1, wd.length - TERMINAL_GUARD_DAYS);
  for (let i = firstGuarded; i < wd.length; i++) {
    const mid = midOf(wd[i]);
    if (mid == null) continue;
    const window = [];
    for (let j = i - 1; j >= fcStart && window.length < LOOKBACK; j--) {
      const m = midOf(wd[j]);
      if (m != null) window.push(m);
    }
    if (window.length < 2) continue;                  // need a local run to compare against
    const localMean = window.reduce((s, v) => s + v, 0) / window.length;
    const dev = mid - localMean;
    if (Math.abs(dev) > TERMINAL_GUARD_MAXJUMP) {
      wd[i] = setMid(wd[i], localMean + Math.sign(dev) * TERMINAL_GUARD_MAXJUMP);
    }
  }
  return wd;
}
// -------------- end terminal-day forecast guard (Phase 3) --------------

// --------------------- river discharge forecast --------------------
// Open-Meteo Flood API = GloFAS v4 (5 km, NOT bias-corrected). It is reliable
// for the SHAPE of the hydrograph (rising/falling and roughly how fast), not for
// absolute local cfs, and at 5 km it may not pick the exact creek. So we use it
// only as a relative trend and ANCHOR it to the gauge's latest real reading:
//   forecastFlow_i = latestRealFlow * (glofas_i / glofas_today)
// Honest units, tied to observed conditions, flagged forecast (never "measured").
// Server-side only — the Flood API has CORS disabled, which suits CI/Action use.
async function floodForecast(lat, lon) {
  const url = `${OM_FLOOD}?latitude=${lat}&longitude=${lon}`
    + `&daily=river_discharge&past_days=${PAST_WX_DAYS}&forecast_days=${FORECAST_DAYS}`;
  const j = await fetchJson(url, 2);
  const d = j?.daily;
  if (!d?.time) return null;
  return d.time.map((date, i) => ({ date, q: d.river_discharge?.[i] })).filter((x) => x.q != null);
}

function anchorFlow(floodDaily, latestRealFlow, anchorDate, forecastDates) {
  if (!floodDaily?.length || latestRealFlow == null) return null;
  const byDate = new Map(floodDaily.map((x) => [x.date, x.q]));
  const atOrBefore = floodDaily.filter((x) => x.date <= anchorDate);
  const anchorQ = (byDate.get(anchorDate)) ?? (atOrBefore.length ? atOrBefore[atOrBefore.length - 1].q : floodDaily[0].q);
  if (!anchorQ) return null;
  const out = forecastDates.map((date) => {
    const q = byDate.get(date);
    return q == null ? { date, mean: null, forecast: true }
                     : { date, mean: round(latestRealFlow * (q / anchorQ)), forecast: true };
  });
  if (out.filter((o) => o.mean != null).length < 2) return null;   // degenerate → drop
  return out;
}

// Stage rating fit from recent paired daily means:  stage ≈ a + b·√flow.
function fitRating(flowDaily, stageDaily) {
  const fBy = new Map((flowDaily || []).map((d) => [d.date, d.mean]));
  const pts = [];
  for (const s of (stageDaily || [])) {
    const f = fBy.get(s.date);
    if (f != null && f > 0 && s.mean != null) pts.push([Math.sqrt(f), s.mean]);
  }
  if (pts.length < 3) return null;
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p[0], 0), sy = pts.reduce((a, p) => a + p[1], 0);
  const sxx = pts.reduce((a, p) => a + p[0] * p[0], 0), sxy = pts.reduce((a, p) => a + p[0] * p[1], 0);
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / den;
  return { a: (sy - b * sx) / n, b };
}
function stageForecastFrom(flowForecast, rating) {
  if (!flowForecast || !rating) return null;
  return flowForecast.map((f) => ({
    date: f.date,
    mean: f.mean == null ? null : round(rating.a + rating.b * Math.sqrt(f.mean)),
    forecast: true,
  }));
}

// Water-temp forecast from forecast air temp. Measured gauges: anchor on today's
// real reading and ride the air-temp *trend* forward at this gauge's own damped
// air→water coupling slope. A flat (water − air) offset tracks air 1:1, which badly
// over-warms buffered freestone forks on hot days — Bitterroot forks empirically
// couple at ~0.4, not 1.0 (observed: air swung 49→72°F while water held low 60s).
// So we learn the slope from the gauge's own history (least-squares water~air),
// clamp it to a physical range, and carry today's value along the air change only.
// Estimated gauges are handled by the estimator (already damps 0.5x).
function waterTempForecast(measuredThisYear, weatherDaily, forecastDates) {
  if (!weatherDaily?.length || !measuredThisYear?.length) return null;
  const airBy = new Map(weatherDaily.map((d) =>
    [d.date, (d.hiF != null && d.loF != null) ? (d.hiF + d.loF) / 2 : null]));

  // learn this gauge's air→water coupling from its own history (slope of water_mean
  // on air_mean). Clamp to [0.2, 0.6]; fall back to 0.4 (measured Bitterroot forks
  // cluster ~0.38–0.41) when the sample is too thin to trust.
  const pts = [];
  for (const w of measuredThisYear) {
    const a = airBy.get(w.date);
    if (a != null && w.mean != null) pts.push([a, w.mean]);
  }
  let slope = 0.4;
  if (pts.length >= 4) {
    const n = pts.length;
    const mx = pts.reduce((s, p) => s + p[0], 0) / n;
    const my = pts.reduce((s, p) => s + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    for (const [a, w] of pts) { sxy += (a - mx) * (w - my); sxx += (a - mx) * (a - mx); }
    if (sxx > 0) slope = Math.min(0.6, Math.max(0.2, sxy / sxx));
  }

  // anchor on the most recent real reading + its air; ride the air change from there.
  let anchor = null;
  for (let i = measuredThisYear.length - 1; i >= 0; i--) {
    const w = measuredThisYear[i];
    if (w && w.mean != null && airBy.get(w.date) != null) { anchor = w; break; }
  }
  if (!anchor) return null;
  const anchorAir = airBy.get(anchor.date), anchorWater = anchor.mean;

  // PHASE 3 (item 2 re-touch, from real observed spread — Phase-6 re-touch candidate):
  // The mean-only forecast left the frontend to fake a forecast max with a render-time
  // bump. Instead, carry a real diel band on each forecast row, derived from THIS gauge's
  // own measured thisYear swing: average (max-mean) for the upper half, (mean-min) for the
  // lower half. This is the gauge's characteristic daily range (a big-river gauge like
  // Missoula runs a tighter band than a small fork), so the forecast max the stress ladder
  // and the frontend callout read is grounded, not a guessed constant. Fallback to a modest
  // symmetric ±3 °F only if the gauge has no usable min/max history.
  const bandPts = measuredThisYear.filter((w) => w.max != null && w.mean != null && w.min != null);
  let spreadUp = 3, spreadDn = 3;
  if (bandPts.length) {
    spreadUp = bandPts.reduce((s, w) => s + (w.max - w.mean), 0) / bandPts.length;
    spreadDn = bandPts.reduce((s, w) => s + (w.mean - w.min), 0) / bandPts.length;
  }

  return forecastDates.map((date) => {
    const air = airBy.get(date);
    if (air == null) return { date, mean: null, min: null, max: null, forecast: true };
    const mean = round(Math.max(33, anchorWater + slope * (air - anchorAir)));
    return {
      date, mean,
      min: round(Math.max(32, mean - spreadDn)),
      max: round(mean + spreadUp),
      forecast: true,
    };
  });
}

// ------------------------- normal baseline -------------------------
// Handoff: "computes normal per gauge from its own history." With only a short
// window on hand, normal = median of all fetched daily means (this+last year).
// Once the scheduled Action accumulates history, swap this for a day-of-year climatology.
function computeNormal(series) {
  const norm = {};
  for (const key of ["flow", "stage", "watertemp"]) {
    const s = series[key];
    if (!s) continue;
    const vals = [...(s.thisYear || []), ...(s.lastYear || [])].map((d) => d.mean);
    norm[key] = median(vals);
  }
  return norm;
}

// ------------------------------ main -------------------------------
async function main() {
  const win = windows();
  const gauges = [];
  for (const g of GAUGES) {
    console.log(`• ${g.name} (${g.source})`);
    const base = g.source === "stage" ? await pullStageGauge(g, win) : await pullUsgsGauge(g, win);
    const weather = normalizeWeather(
      await weatherForecast(g.lat, g.lon),
      await weatherArchive(g.lat, g.lon, win.lastYear),
    );
    // NOTE: temp estimation is DEFERRED to pass 2 — it needs the drainage-wide
    // measured-freestone average, which doesn't exist until every gauge is pulled.
    // Here we only record that this gauge will need an estimate.
    const needsTempEstimate = !!base._needsTempEstimate;

    // ---- forecasts (modeled, clearly flagged — never presented as measured) ----
    // Flow/stage forecasts do NOT depend on temp, so they run here in pass 1.
    const wd = weather?.daily || [];
    // Resolve "today" by DATE MATCH, not by positional index. Open-Meteo's daily array is
    // not guaranteed to put today at index PAST_WX_DAYS — the count can shift, which was
    // making the whole dashboard read one day behind (anchor, forecast split, and the
    // front-end "today" marker all derive from this). Find today's actual row; if the
    // exact date isn't present yet (early-run race), fall back to the latest past row.
    const TODAY = todayLocal();
    let anchorIdx = wd.findIndex((d) => d.date === TODAY);
    if (anchorIdx < 0) {
      // today's row not present — use the most recent row that is <= today
      for (let i = wd.length - 1; i >= 0; i--) {
        if (wd[i].date <= TODAY) { anchorIdx = i; break; }
      }
    }
    if (anchorIdx < 0) anchorIdx = Math.min(PAST_WX_DAYS, wd.length - 1); // last resort
    const anchorDate = wd[anchorIdx]?.date;                    // == today (date-matched)
    // PHASE 3: clamp any Open-Meteo terminal-day air artifact before it feeds ANY forecast
    // (water temp, Tomorrow column, bite engine). Guarded copy used from here on; the raw
    // weather.daily stored on the gauge is left intact for transparency.
    const wdGuarded = guardTerminalForecast(wd, anchorIdx);
    const fcDates = wdGuarded.slice(anchorIdx + 1).map((d) => d.date);     // tomorrow → horizon
    if (fcDates.length) {
      const flood = await floodForecast(g.lat, g.lon);
      // Anchor on the true current snapshot when we have it; the in-progress day's
      // daily mean is a partial-day average and mis-anchors every prediction.
      const latestFlow = base.series.flow?.latest?.value ?? lastMean(base.series.flow?.thisYear);
      const flowFc = anchorFlow(flood, latestFlow, anchorDate, fcDates);
      if (flowFc && base.series.flow) {
        base.series.flow.forecast = flowFc;
        base.series.flow.forecastModel = "GloFAS 5km, anchored to latest reading (trend only)";
        const stageFc = stageForecastFrom(flowFc, fitRating(base.series.flow.thisYear, base.series.stage?.thisYear));
        if (stageFc && base.series.stage) base.series.stage.forecast = stageFc;
      }
      // Temp forecast for MEASURED gauges only (model from their own probe history).
      // Estimated gauges get both history + forecast filled in pass 2.
      if (base.series.watertemp && !needsTempEstimate) {
        const tFc = waterTempForecast(base.series.watertemp.thisYear, wdGuarded, fcDates);
        if (tFc) base.series.watertemp.forecast = tFc;
      }
    }
    // stash the guarded axis for pass-2 estimators (mainstem gradient / freestone est).
    base._wdGuarded = wdGuarded;

    const normal = computeNormal(base.series);
    gauges.push({
      id: g.id, name: g.name, type: g.type, source: g.source,
      code: g.code || g.site, locationId: g.locationId || null, lat: g.lat, lon: g.lon,
      meta: base.meta,            // { measuredTemp, provisional }
      series: base.series,        // { stage, flow, watertemp } each {unit, thisYear[], lastYear[]}
      weather,                    // { hourly[], daily[], lastYearDaily[] | null }
      normal,                     // { flow, stage, watertemp } baselines
      _needsTempEstimate: needsTempEstimate,   // pass-2 marker (stripped before output)
      _anchorIdx: anchorIdx,                   // pass-2: where history ends / forecast begins
      _wdGuarded: base._wdGuarded || wd,       // pass-2: terminal-guarded weather axis
      drainageMi2: g.drainageMi2 ?? null,      // pass-2: mainstem gradient axis (mainstem only)
    });
  }

  // ===================== PASS 2: water-temp estimation =====================
  // Now that every gauge is pulled, fill the temp-less gauges. Order of preference:
  //   • MAINSTEM gauge (e.g. Bell)  -> gradient between measured mainstem neighbours
  //       (Darby<->Missoula), carrying their REAL diel band; falls back to the
  //       freestone-average estimator only if no measured mainstem anchor exists.
  //   • everything else             -> freestone-average estimator (measured snowmelt
  //       water signal / tailwater setpoint / last-year shift / seasonal floor).
  // All estimated results stay flagged estimated:true and never emit mean:null (item 4).
  const freestoneAvg    = measuredFreestoneAvgByDate(gauges);
  const mainstemByDate  = mainstemMeasuredByDate(gauges);
  for (const G of gauges) {
    if (!G._needsTempEstimate) continue;
    const wd = G._wdGuarded || G.weather?.daily;
    let series = null, via = null;

    if (G.type === "mainstem" && G.drainageMi2 != null) {
      const grad = buildMainstemGradientSeries(G, wd, G._anchorIdx, mainstemByDate);
      if (grad && grad.thisYear.length) { series = grad; via = "mainstem-gradient"; }
    }
    if (!series) {
      const est = buildEstimatedTempSeries(G, wd, freestoneAvg, G._anchorIdx);
      series = { thisYear: est.thisYear, forecast: est.forecast };
      via = "freestone-estimator";
    }

    G.series.watertemp = { unit: "°F", estimated: true, estMethod: via,
                           thisYear: series.thisYear, lastYear: [] };
    if (series.forecast && series.forecast.length) G.series.watertemp.forecast = series.forecast;
    G.meta.measuredTemp = false;
    // recompute the temp normal now that the estimated history exists
    G.normal = computeNormal(G.series);
  }
  // strip pass-2 scratch fields so they don't leak into data.json
  for (const G of gauges) { delete G._needsTempEstimate; delete G._anchorIdx; delete G._wdGuarded; }

  const data = {
    generatedAt: new Date().toISOString(),
    today: todayLocal(),            // YYYY-MM-DD in America/Denver — the front-end should
                                    // use THIS to place the "today" marker and split
                                    // history/forecast, never derive it from generatedAt (UTC).
    timezone: TZ,
    constants: { hootOwlThresholdF: HOOT_OWL_F, lethalF: 77, wadeCfs: WADE_CFS },
    windows: {
      historyDays: HISTORY_DAYS, forecastDays: FORECAST_DAYS,
      thisYear: { start: new Date(win.thisYear.start).toISOString(), end: new Date(win.thisYear.end).toISOString() },
      lastYear: { start: new Date(win.lastYear.start).toISOString(), end: new Date(win.lastYear.end).toISOString() },
    },
    gauges,
  };
  await writeFile("data.json", JSON.stringify(data, null, 2));
  console.log(`\n✓ wrote data.json — ${gauges.length} gauges, ${(JSON.stringify(data).length / 1024).toFixed(1)} KB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
