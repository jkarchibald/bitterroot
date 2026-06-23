#!/usr/bin/env node
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
const PAST_WX_DAYS  = 7;    // Open-Meteo past_days (max 92 on forecast endpoint)
const WADE_CFS      = 200;  // wade-safe flow line drawn on charts
const HOOT_OWL_F    = 66;   // MT cutthroat/bull-trout thermal threshold (NOT the statewide 73)

// Parameters we care about, by source code.
//   StAGE: HG=stage(ft), QR=discharge(cfs), TW=water temp(degC)
//   USGS : 00065=gage height(ft), 00060=discharge(cfs), 00010=water temp(degC, usually absent)
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
  { id: "bell",      name: "Bitterroot at Bell Crossing nr Victor", type: "mainstem", source: "usgs",
    site: "12350250", lat: 46.4432, lon: -114.1238 },   // temp estimated
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
function toDaily(samples) {
  const buckets = new Map();
  for (const { t, v } of samples) {
    if (v == null || Number.isNaN(v)) continue;
    const key = ymd(new Date(t));
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
  // (Times are UTC per the layer's timeReference.) 15-min data → 10 days ≈ 960 rows.
  const lit = (ms) => `timestamp '${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}'`;
  const where = encodeURIComponent(
    `SensorID='${sensorId}' AND Timestamp >= ${lit(start)} AND Timestamp <= ${lit(end)}`
  );
  const url = `${STAGE_BASE}/2/query?where=${where}&outFields=Timestamp,RecordedValue,ApprovalName,GradeName&resultRecordCount=2000&f=json`;
  const j = await fetchJson(url);
  let provisional = false;
  const samples = (j?.features || []).map((f) => {
    const a = f.attributes;
    if (/provisional/i.test(a.ApprovalName || "")) provisional = true;
    return { t: a.Timestamp, v: a.RecordedValue };
  }).sort((p, q) => p.t - q.t);   // sort client-side (avoids orderBy edge cases)
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
    out[key] = {
      unit: key === "watertemp" ? "°F" : (s.unit === "ft^3/s" ? "cfs" : s.unit),
      sensorCode: s.code,
      thisYear: toDaily(ty.samples.map((x) => ({ t: x.t, v: conv(x.v) }))),
      lastYear: toDaily(ly.samples.map((x) => ({ t: x.t, v: conv(x.v) }))),
    };
  }
  return { series: out, meta };
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
    flow:  { unit: "cfs", thisYear: toDaily(flowTy.samples), lastYear: toDaily(flowLy.samples) },
    stage: { unit: "ft",  thisYear: toDaily(stgTy.samples),  lastYear: toDaily(stgLy.samples) },
    watertemp: null,
  };
  const hasMeasuredTemp = tmpTy.samples.some((s) => s.v != null);
  if (hasMeasuredTemp) {
    series.watertemp = { unit: "°F", thisYear: toDaily(tmpTy.samples.map((s) => ({ t: s.t, v: cToF(s.v) }))), lastYear: [] };
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

// Water-temp forecast from forecast air temp. Measured gauges: carry the recent
// (water − airMean) offset forward. Estimated gauges are handled by the estimator.
function waterTempForecast(measuredThisYear, weatherDaily, forecastDates) {
  if (!weatherDaily?.length || !measuredThisYear?.length) return null;
  const airBy = new Map(weatherDaily.map((d) =>
    [d.date, (d.hiF != null && d.loF != null) ? (d.hiF + d.loF) / 2 : null]));
  const offs = [];
  for (const w of measuredThisYear) {
    const air = airBy.get(w.date);
    if (air != null && w.mean != null) offs.push(w.mean - air);
  }
  const offset = offs.length ? offs.reduce((a, x) => a + x, 0) / offs.length : -4;
  return forecastDates.map((date) => {
    const air = airBy.get(date);
    return { date, mean: air == null ? null : round(Math.max(33, air + offset)), forecast: true };
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
    // Fill estimated water temp for USGS gauges that have no probe.
    if (base._needsTempEstimate && weather?.daily) {
      base.series.watertemp = { unit: "°F", estimated: true, thisYear: estimateWaterTemp(weather.daily), lastYear: [] };
      base.meta.measuredTemp = false;
    }

    // ---- forecasts (modeled, clearly flagged — never presented as measured) ----
    const wd = weather?.daily || [];
    const anchorDate = wd[PAST_WX_DAYS]?.date;                 // == today
    const fcDates = wd.slice(PAST_WX_DAYS + 1).map((d) => d.date);  // tomorrow → horizon
    if (fcDates.length) {
      const flood = await floodForecast(g.lat, g.lon);
      const latestFlow = lastMean(base.series.flow?.thisYear);
      const flowFc = anchorFlow(flood, latestFlow, anchorDate, fcDates);
      if (flowFc && base.series.flow) {
        base.series.flow.forecast = flowFc;
        base.series.flow.forecastModel = "GloFAS 5km, anchored to latest reading (trend only)";
        const stageFc = stageForecastFrom(flowFc, fitRating(base.series.flow.thisYear, base.series.stage?.thisYear));
        if (stageFc && base.series.stage) base.series.stage.forecast = stageFc;
      }
      if (base.series.watertemp) {
        if (base.series.watertemp.estimated) {
          base.series.watertemp.forecast = estimateWaterTemp(weather.daily)
            .slice(PAST_WX_DAYS + 1).map((x) => ({ ...x, forecast: true }));
        } else {
          const tFc = waterTempForecast(base.series.watertemp.thisYear, weather.daily, fcDates);
          if (tFc) base.series.watertemp.forecast = tFc;
        }
      }
    }

    const normal = computeNormal(base.series);
    gauges.push({
      id: g.id, name: g.name, type: g.type, source: g.source,
      code: g.code || g.site, lat: g.lat, lon: g.lon,
      meta: base.meta,            // { measuredTemp, provisional }
      series: base.series,        // { stage, flow, watertemp } each {unit, thisYear[], lastYear[]}
      weather,                    // { hourly[], daily[], lastYearDaily[] | null }
      normal,                     // { flow, stage, watertemp } baselines
    });
  }

  const data = {
    generatedAt: new Date().toISOString(),
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
