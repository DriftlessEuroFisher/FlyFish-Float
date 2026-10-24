/* ============================================================
   USGS WATER DATA — modernized OGC API (api.waterdata.usgs.gov)
   - latest-continuous : current discharge (00060) and, in the same
                         request, water temperature (00010) where reported
   - daily             : historical daily means -> day-of-year median
   - monitoring-locations : runtime verification of gauge IDs
   Legacy waterservices.usgs.gov is NOT used (being decommissioned).
   The API sends CORS headers for browser use; if your network
   blocks it, point API_BASE at a lightweight same-origin proxy.
   ============================================================ */
/* ---------- river geometry: encoded polylines ----------
   Generated rivers carry their channel as `cz` -- Google's encoded-polyline
   format at 1e5, one string per piece -- instead of a literal `coords`
   array: the same points at about a quarter of the bytes, which is most of
   what a phone downloads. They are decoded here, before anything reads
   `coords`, so every other line of this file sees plain [lat,lng] lists. A
   hand-written river can still use `coords:[...]` directly.
   (Regenerate with ~/.cache/flyfish-osm/encode_coords.py after any apply.) */
function decodePolyline(str){
  const out = []; let i = 0, lat = 0, lng = 0;
  while(i < str.length){
    for(let k = 0; k < 2; k++){
      let b, shift = 0, res = 0;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while(b >= 32);
      const d = (res & 1) ? ~(res >> 1) : (res >> 1);
      if(k === 0) lat += d; else lng += d;
    }
    out.push([lat / 1e5, lng / 1e5]);
  }
  return out;
}
/* The other direction, for lake-trip tracks (js/laketrip.js): a recorded
   track is stored in the same format at 1e5 (about a metre), so a four-hour
   trip is a few KB in the Field Book rather than a long JSON array. One
   string per segment of the track: a gap is never encoded as a join. */
function polyEncNum(v){
  let n = v < 0 ? ~(v << 1) : (v << 1), s = "";
  while(n >= 0x20){ s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
  return s + String.fromCharCode(n + 63);
}
function encodePolyline(pts){
  let lat = 0, lng = 0, out = "";
  for(const p of pts){
    const la = Math.round(p[0] * 1e5), lo = Math.round(p[1] * 1e5);
    out += polyEncNum(la - lat) + polyEncNum(lo - lng);
    lat = la; lng = lo;
  }
  return out;
}
/* One dimension of the same scheme: whole numbers stored as differences from
   the previous one. A track's point times (seconds since the start) go this
   way, so a point every minute costs a character or two. */
function encodeDeltas(nums){
  let prev = 0, out = "";
  for(const v of nums){ const n = Math.round(v); out += polyEncNum(n - prev); prev = n; }
  return out;
}
function decodeDeltas(str){
  const out = []; let i = 0, v = 0;
  while(i < str.length){
    let b, shift = 0, res = 0;
    do { b = str.charCodeAt(i++) - 63; res |= (b & 31) << shift; shift += 5; } while(b >= 32);
    v += (res & 1) ? ~(res >> 1) : (res >> 1);
    out.push(v);
  }
  return out;
}
RIVERS.forEach(r => {
  if(r.cz && !r.coords) r.coords = Array.isArray(r.cz) ? r.cz.map(decodePolyline) : decodePolyline(r.cz);
  delete r.cz;
});

/* Full state names, for the sheet subtitles (rivers and lakes) and the bridge
   popups. Up here so nothing that runs at startup meets it in its temporal
   dead zone. */
const STATE_NAME = {ID:"Idaho", WY:"Wyoming", IA:"Iowa", MN:"Minnesota", WI:"Wisconsin", IL:"Illinois",
  CA:"California", OR:"Oregon", WA:"Washington", MT:"Montana", CO:"Colorado", UT:"Utah", AK:"Alaska",
  MI:"Michigan", SD:"South Dakota", NM:"New Mexico", AZ:"Arizona", NV:"Nevada", PA:"Pennsylvania", NY:"New York", VA:"Virginia", ME:"Maine", MO:"Missouri"};

const API_BASE = "https://api.waterdata.usgs.gov/ogcapi/v0/collections";
const STAT_YEARS = 7;        // years of history for the median
const STAT_WINDOW = 7;       // +/- days around today's date
const REFRESH_MS = 15 * 60 * 1000;

/* ---------- request budget ----------
   api.waterdata.usgs.gov allows 1000 requests/hour anonymously and replies
   429 OVER_RATE_LIMIT past that. One request per gauge blew straight through
   it once this map grew to 170 gauges: 170 latest-value calls plus 7 history
   calls each (~1,190) is ~1,360 per load against a 1,000/hour budget, which
   is why the header used to read "flows unavailable".

   Everything below asks for MANY SITES PER REQUEST instead, and asks for
   history only where the map is looking:
     - latest values: every gauge on the map, 50 a request, nearest the
       middle of the view first — 17 requests for 833 gauges, on load and
       on every REFRESH_MS refresh.
     - history: 7 requests (one per year) for each 30 gauges, only for the
       gauges in view from zoom 8 and an opened river's, with favourites and
       nearby gauges riding in spare room (loadViewStats(), statsRiders()).
       Cached for the week.
     - metadata: those same gauges, alongside their history. Cached for good.
   Measured against a stubbed API on 2026-10-17, on a phone-sized screen: a
   cold load sitting on the chooser is 17 requests. Entering Wyoming adds
   none, zooming to Jackson Hole 8, then Des Moines another 8; tapping the
   Snake from the Wyoming view is 8 with the view it frames. The old
   whole-map history backfill had grown to 322 for a cold load (32 latest,
   273 history, 17 metadata), so three loads an hour from one phone ran out
   the budget.

   A free API key from https://api.waterdata.usgs.gov/signup/ raises the
   limit. To use one:  localStorage.setItem("usgsApiKey", "<your key>")
   and reload. It's optional — the batched app fits in the anonymous
   budget on its own. */
const MAX_SITES_LATEST = 50;   // sites per latest-continuous request
const MAX_SITES_DAILY  = 30;   // sites per daily request (x ~15 days of rows)
const API_KEY = (()=>{ try { return localStorage.getItem("usgsApiKey") || ""; } catch(e){ return ""; } })();
function apiURL(path, params){
  const q = new URLSearchParams({f:"json", ...params});
  if(API_KEY) q.set("api_key", API_KEY);
  return `${API_BASE}/${path}?${q}`;
}
const chunk = (arr, n) => Array.from({length:Math.ceil(arr.length/n)}, (_,i)=>arr.slice(i*n,(i+1)*n));
const siteOf = key => GAUGES[key].site;
// site id -> gauge key, so a multi-site response can be demultiplexed
const KEY_BY_SITE = {};
Object.keys(GAUGES).forEach(k => { KEY_BY_SITE[GAUGES[k].site] = k; });

/* Batches used to be built per region (and per state out west), nearest
   region first. Every bucket then paid for itself however small it was:
   Teton Valley's two gauges cost a latest request and seven history
   requests of their own, and so did Swan Valley's two. Across 22 buckets
   the whole map's history came to 273 requests where one line of chunks
   needs 196. Now gauges are put in one line, nearest the middle of the map
   first (gaugesNearestFirst()), and chunked across region lines, so the
   nearby water still loads first. */

/* ---------- tiny storage layer (works even where localStorage
   is unavailable, e.g. sandboxed previews) ---------- */
const mem = {};
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return mem[k] ?? null; } },
  set(k,v){ const s = JSON.stringify(v); if(!lsSetSafe(k, s)) mem[k]=v; },
};

/* ---------- making room in localStorage ----------
   The Field Book (`fieldBook`) shares this origin's ~5 MB (iOS Safari) with
   caches the app can always fetch again, and it is the only copy of the
   user's trips: there is no export. Left alone the caches only grow — a new
   `stats:` key per gauge every week, a river's geometry for every river ever
   looked at — until the book's next write throws and the trip is lost on
   reload. So every write goes through lsSetSafe(): when a write doesn't fit,
   caches are deleted, oldest and least useful first, until it does.

   Only keys under these prefixes are ever deleted. Everything else — the
   book and its v1 copy, a live float or lake trip, offline areas, settings,
   the report draft, the API key — is the user's and is never touched.
   `metrics:` is the queue of usage stats not yet sent (js/metrics.js): it
   can't be fetched again, but it is worth less to the user than anything
   else here, so it goes first. */
const LS_CACHE_PREFIXES = ["nhdfine:", "nhd:", "stats:", "nwsFc:", "agname:", "temp:", "meta:", "flow:", "nwsPt:", "metrics:"];
const LS_ROOM_BYTES = 512*1024;              // freed per batch; one write rarely needs more
const GEOM_CACHE_MS = 1000*60*60*24*30;      // nhd:/nhdfine: geometry is refetched after this
const lsCacheKind = k => LS_CACHE_PREFIXES.find(p => k.startsWith(p)) || null;
/* The week-and-years tag a stats key ends with this week. Any other tag is a
   past week (or a different STAT_YEARS) that will never be read again. */
function statsWeekTag(){
  const now = new Date();
  return `${now.getFullYear()}w${Math.floor(dayOfYear(now)/7)}:y${STAT_YEARS}`;
}
/* A geometry cache's save time, read off the end of the string — store.set
   writes {g, t}, so `t` is last — rather than parsing 60 KB to get one
   number. 0 (unknown) sorts as oldest. */
function lsGeomTime(v){ const m = /"t":(\d+)\}$/.exec(v || ""); return m ? +m[1] : 0; }
/* Deletes cache keys until at least `minBytes` (string length × 2, which is
   how browsers count) are freed, or no cache is left. Returns bytes freed.
   Order: dead weight first (unsent usage stats, past weeks' stats, geometry
   past its 30 days), then refined geometry oldest first (the biggest and the
   most easily refetched), then base geometry, then this week's stats, then
   the rest. */
function lsMakeRoom(minBytes){
  minBytes = minBytes || LS_ROOM_BYTES;
  let freed = 0;
  try{
    const tag = statsWeekTag(), now = Date.now(), cand = [];
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i), kind = k && lsCacheKind(k);
      if(!kind) continue;
      if(kind === "metrics:"){ cand.push({k, rank:0, t:0}); continue; }
      if(kind === "stats:"){ cand.push({k, rank:k.endsWith(":"+tag) ? 3 : 0, t:0}); continue; }
      if(kind === "nhd:" || kind === "nhdfine:"){
        const t = lsGeomTime(localStorage.getItem(k));
        cand.push({k, rank:now - t >= GEOM_CACHE_MS ? 0 : kind === "nhdfine:" ? 1 : 2, t});
        continue;
      }
      // short-lived forecasts before the small, long-lived lookups
      cand.push({k, rank:4 + ["nwsFc:", "temp:", "flow:", "meta:", "agname:", "nwsPt:"].indexOf(kind), t:0});
    }
    cand.sort((a, b) => a.rank - b.rank || a.t - b.t);
    for(const c of cand){
      if(freed >= minBytes) break;
      const v = localStorage.getItem(c.k);
      localStorage.removeItem(c.k);
      freed += (c.k.length + (v ? v.length : 0)) * 2;
    }
  }catch(e){}
  return freed;
}
/* setItem that makes room when the write doesn't fit. Returns whether the
   value landed; callers holding the user's data must not pretend it did. */
function lsSetSafe(k, s){
  for(;;){
    try{ localStorage.setItem(k, s); return true; }
    catch(e){ if(!lsMakeRoom()) return false; }   // nothing left to delete: it really is full
  }
}
/* Once per launch, a few seconds in: clear what will never be read again, so
   the caches don't wait for a failed write to be trimmed. The keys are
   listed first and removed after: removing while walking localStorage.key(i)
   skips keys in Chrome, even walking backwards (40 of 300 survived a test). */
function lsPrune(){
  try{
    const tag = statsWeekTag(), now = Date.now(), dead = [];
    for(let i = 0; i < localStorage.length; i++){
      const k = localStorage.key(i);
      if(!k) continue;
      if(k.startsWith("stats:")){ if(!k.endsWith(":"+tag)) dead.push(k); }
      else if(k.startsWith("nhd:") || k.startsWith("nhdfine:")){
        if(now - lsGeomTime(localStorage.getItem(k)) >= GEOM_CACHE_MS) dead.push(k);
      }
    }
    dead.forEach(k => localStorage.removeItem(k));
  }catch(e){}
}
setTimeout(lsPrune, 4000);

const flows = {};   // gaugeKey -> {cfs, time, fetchedAt, stale}
const temps = {};   // gaugeKey -> {c, time, fetchedAt}  water temperature (00010), USGS only
const stats = {};   // gaugeKey -> {median, mean, min, max, n}
const meta  = {};   // gaugeKey -> {name, verified}

/* Once the water API answers 429 its retry-after gets pushed further out by
   every additional request, so the worst thing to do is keep trying. Back
   off wholesale for a while and serve cached readings instead. Only
   api.waterdata.usgs.gov is gated — NHD geometry and basemap tiles are a
   different host with their own budget. */
const API_COOLDOWN_MS = 12 * 60 * 1000;
let apiPausedUntil = 0;
const apiPaused = () => Date.now() < apiPausedUntil;

function fetchJSON(url, timeout=12000){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), timeout);
  return fetch(url, {signal:ctl.signal, headers:{accept:"application/geo+json,application/json"}})
    .then(r => {
      if(r.status === 429 && /api\.waterdata\.usgs\.gov/.test(url)){
        apiPausedUntil = Date.now() + API_COOLDOWN_MS;
      }
      if(!r.ok) throw new Error("HTTP "+r.status);
      return r.json();
    })
    .finally(()=>clearTimeout(t));
}

/* ---------- Colorado Division of Water Resources gauges ----------
   Many Colorado rivers are gauged by the state, not the USGS -- the Rio
   Grande at Del Norte, the Poudre at the canyon mouth, the Conejos -- and
   those rivers read "ungauged" while a live state gauge sat on the water.
   A GAUGES entry with site "CODWR-<abbrev>" is read from DWR's telemetry
   REST API instead: live discharge in CFS, same as the USGS gauges, and the
   same 7-year day-of-year median built from DWR's daily means. Batched by
   comma-separated abbrev, verified against DWR's own station metadata, and
   CORS-open. DWR allows 1,000 requests a day per client; a load is one
   latest call per 40 stations, and seven history calls per 40 of them that
   come into view (loadViewStats()). */
const DWR_BASE = "https://dwr.state.co.us/Rest/GET/api/v2/telemetrystations/";
const isDWR = key => GAUGES[key] && GAUGES[key].site.startsWith("CODWR-");
const dwrAbbrev = key => GAUGES[key].site.slice(6);
const MAX_DWR = 40;
async function fetchDWRLatest(keys){
  for(const group of chunk(keys, MAX_DWR)){
    try{
      const j = await fetchJSON(DWR_BASE + "telemetrystation/?format=json&parameter=DISCHRG&abbrev="
                                + group.map(dwrAbbrev).join(","), 20000);
      const got = new Set();
      (j.ResultList||[]).forEach(r=>{
        const key = KEY_BY_SITE["CODWR-"+r.abbrev];
        const cfs = parseFloat(r.measValue);
        if(!key || !isFinite(cfs) || !r.measDateTime) return;
        flows[key] = {cfs, time:r.measDateTime, fetchedAt:Date.now(), stale:false};
        store.set("flow:"+key, flows[key]);
        meta[key] = {name:r.stationName, verified:true};
        store.set("meta:"+GAUGES[key].site, meta[key]);
        got.add(key);
      });
      markStale(group.filter(k=>!got.has(k)));
    }catch(e){ markStale(group); }
  }
}
async function fetchDWRStats(keys){
  const need = [];
  keys.forEach(k=>{ const c = store.get(statsCacheKey(k)); if(c) stats[k] = c; else need.push(k); });
  if(!need.length) return;
  const now = new Date(), vals = {};
  const us = d => `${String(d.getMonth()+1).padStart(2,"0")}/${String(d.getDate()).padStart(2,"0")}/${d.getFullYear()}`;
  need.forEach(k => vals[k] = []);
  let failed = false;
  for(const group of chunk(need, MAX_DWR)){
    for(let y=1; y<=STAT_YEARS; y++){
      const c = new Date(now); c.setFullYear(now.getFullYear()-y);
      const a = new Date(c); a.setDate(c.getDate()-STAT_WINDOW);
      const b = new Date(c); b.setDate(c.getDate()+STAT_WINDOW);
      try{
        const j = await fetchJSON(DWR_BASE + "telemetrytimeseriesday/?format=json&parameter=DISCHRG&abbrev="
          + group.map(dwrAbbrev).join(",") + `&startDate=${us(a)}&endDate=${us(b)}`, 25000);
        (j.ResultList||[]).forEach(r=>{
          const k = KEY_BY_SITE["CODWR-"+r.abbrev], v = parseFloat(r.measValue);
          if(k && vals[k] && isFinite(v)) vals[k].push(v);
        });
      }catch(e){ failed = true; }
    }
  }
  need.forEach(k=>{
    const v = vals[k].sort((a,b)=>a-b);
    if(!v.length){ if(!failed) stats[k] = null; return; }   // same rule as USGS: don't latch on a failure
    const st = {median:v[Math.floor(v.length/2)], mean:v.reduce((a,b)=>a+b,0)/v.length,
                min:v[0], max:v[v.length-1], n:v.length};
    stats[k] = st; store.set(statsCacheKey(k), st);
  });
}

/* Fall back to whatever was last saved for these gauges. Used when a batch
   request fails outright, and for any site the batch came back without. */
function markStale(keys){
  keys.forEach(key=>{
    // Keep showing the last known number, but say it's old. Callers only pass
    // keys that just came back empty, so this never overwrites a fresh read —
    // and on a failed refresh the reading correctly stops claiming to be live
    // rather than riding on the previous cycle's value.
    const prev = flows[key] || store.get("flow:"+key);
    flows[key] = prev && prev.cfs != null
      ? {...prev, stale:true}
      : {cfs:null, stale:true, error:true};
    // the saved temperature comes back with it; the 24 h rule in
    // flowCardHTML still keeps an old one off the card
    if(!temps[key]){ const t = store.get("temp:"+key); if(t && t.c != null) temps[key] = t; }
  });
}

/* Water temperature rides along in the latest-continuous request as a second
   parameter (00010), so it costs no extra calls. A site can answer with
   several 00010 rows (more than one sensor); the most recent wins. Only rows
   with a reading are passed here, and a missing row leaves any earlier
   reading in place to age out under the 24 h rule. */
function keepTemp(key, p){
  const c = parseFloat(p.value);
  if(!isFinite(c) || !p.time) return;
  if(temps[key] && temps[key].time > p.time) return;
  temps[key] = {c, time:p.time, fetchedAt:Date.now()};
  store.set("temp:"+key, temps[key]);
}

/* Does this endpoint honour a comma-separated monitoring_location_id list?
   Every multi-site request below assumes it does. If the API ever ignores
   the extra ids and answers for one site only, batching would silently
   blank out the rest of the map — so the first multi-site response is
   checked, and a failure permanently falls back to one-site-at-a-time for
   the session. Costs nothing when batching works, which is the normal case. */
let batchSupported = true;

async function fetchOneLatest(key){
  if(apiPaused()){ markStale([key]); return; }
  const url = apiURL("latest-continuous/items", {
    // limit 8: room for the temperature rows without crowding out discharge
    monitoring_location_id: siteOf(key), parameter_code:"00060,00010", limit:"8"
  });
  try{
    const j = await fetchJSON(url, 15000);
    const rows = (j.features||[]).filter(x=>x.properties && x.properties.value != null);
    rows.filter(x=>x.properties.parameter_code === "00010").forEach(x=>keepTemp(key, x.properties));
    const f = rows.find(x=>x.properties.parameter_code === "00060");
    const cfs = f ? parseFloat(f.properties.value) : NaN;
    if(!isFinite(cfs)) throw new Error("no data");
    flows[key] = {cfs, time:f.properties.time, fetchedAt:Date.now(), stale:false};
    store.set("flow:"+key, flows[key]);
  }catch(e){ markStale([key]); }
}

/* Latest discharge for many gauges in ONE request. Each returned feature
   carries its own monitoring_location_id, so the response is split back
   out per gauge — and its parameter_code, so the water temperature asked
   for alongside (00010) is split off into `temps`. */
async function fetchLatestBatch(keys){
  const dwr = keys.filter(isDWR);
  if(dwr.length){ await fetchDWRLatest(dwr); keys = keys.filter(k=>!isDWR(k)); }
  if(!keys.length) return;
  if(apiPaused()){ markStale(keys); return; }
  if(!batchSupported || keys.length === 1){
    for(const k of keys) await fetchOneLatest(k);
    return;
  }
  const url = apiURL("latest-continuous/items", {
    monitoring_location_id: keys.map(siteOf).join(","),
    parameter_code: "00060,00010",
    limit: String(keys.length * 6)      // 4 per site as before, plus room for temperature rows
  });
  try{
    const j = await fetchJSON(url, 20000);
    const rows = (j.features||[]).filter(f=>f.properties && f.properties.value != null);
    // counted over every row, discharge and temperature alike: a temperature
    // row can only add sites, so this never trips where it didn't before
    const sites = new Set(rows.map(f=>f.properties.monitoring_location_id));
    // asked for many, heard about at most one -> the list wasn't honoured
    if(sites.size <= 1 && keys.length > 1){
      batchSupported = false;
      for(const k of keys) await fetchOneLatest(k);
      return;
    }
    rows.forEach(f=>{
      const p = f.properties, key = KEY_BY_SITE[p.monitoring_location_id];
      if(key && p.parameter_code === "00010") keepTemp(key, p);
    });
    const feats = rows.filter(f=>f.properties.parameter_code === "00060");
    const got = new Set();
    feats.forEach(f=>{
      const p = f.properties;
      const key = KEY_BY_SITE[p.monitoring_location_id];
      if(!key) return;
      const cfs = parseFloat(p.value);              // values arrive as strings
      if(!isFinite(cfs)) return;
      // a site can return several rows; keep the most recent
      if(flows[key] && !flows[key].stale && flows[key].time > p.time) return;
      flows[key] = {cfs, time:p.time, fetchedAt:Date.now(), stale:false};
      store.set("flow:"+key, flows[key]);
      got.add(key);
    });
    markStale(keys.filter(k=>!got.has(k)));         // sites the batch didn't cover
  }catch(e){
    markStale(keys);
  }
}

function statsCacheKey(key){
  return `stats:${GAUGES[key].site}:${statsWeekTag()}`;
}

/* Day-of-year median for many gauges at once.

   Same shape as before — daily means (statistic 00003) from a +/-STAT_WINDOW
   day window around today's date in each of the last STAT_YEARS years — but
   the loop is inverted. It used to be one request per gauge per year
   (170 x 7 = ~1,190 calls). Now it's one request per year per chunk of
   sites: 7 requests carry 30 gauges. Which gauges are asked for, and when,
   is loadViewStats()'s decision, plus an opened river's own (openRiver).

   A gauge already being fetched for another caller is waited on, not asked
   for again. The view loader and an opened river's sheet often want the
   same gauges at the same moment, and each ask is seven requests. */
const statsInflight = new Map();     // gaugeKey -> promise of the fetch carrying it
async function fetchStatsBatch(keys){
  // serve whatever is known, cached or already on its way; request only the rest
  const need = [], waits = new Set();
  new Set(keys).forEach(k=>{
    if(stats[k] !== undefined) return;
    if(statsInflight.has(k)){ waits.add(statsInflight.get(k)); return; }
    const c = store.get(statsCacheKey(k));
    if(c) stats[k] = c; else need.push(k);
  });
  // Colorado DWR's gauges answer from another host, so the two run side by side
  [[need.filter(isDWR), fetchDWRStats], [need.filter(k=>!isDWR(k)), fetchUSGSStats]].forEach(([ks, fetchFn])=>{
    if(!ks.length) return;
    const p = fetchFn(ks).finally(()=>ks.forEach(k=>statsInflight.delete(k)));
    ks.forEach(k=>statsInflight.set(k, p));
    waits.add(p);
  });
  await Promise.all(waits);
}
async function fetchUSGSStats(need){
  const now = new Date();
  const iso = d => d.toISOString().slice(0,10);
  const vals = {};                       // gaugeKey -> number[]
  need.forEach(k => vals[k] = []);

  for(const group of chunk(need, batchSupported ? MAX_SITES_DAILY : 1)){
    if(apiPaused()) break;
    const ids = group.map(siteOf).join(",");
    for(let y=1; y<=STAT_YEARS; y++){
      if(apiPaused()) break;
      const c = new Date(now); c.setFullYear(now.getFullYear()-y);
      const a = new Date(c); a.setDate(c.getDate()-STAT_WINDOW);
      const b = new Date(c); b.setDate(c.getDate()+STAT_WINDOW);
      const url = apiURL("daily/items", {
        monitoring_location_id: ids,
        parameter_code: "00060",
        statistic_id: "00003",
        time: `${iso(a)}T00:00:00Z/${iso(b)}T00:00:00Z`,
        limit: String(group.length * (STAT_WINDOW*2 + 4))
      });
      try{
        const j = await fetchJSON(url, 25000);
        (j.features||[]).forEach(f=>{
          const p = f.properties; if(!p) return;
          const k = KEY_BY_SITE[p.monitoring_location_id];
          const v = parseFloat(p.value);
          if(k && vals[k] && isFinite(v)) vals[k].push(v);
        });
      }catch(e){ /* a missing year just narrows the sample */ }
    }
  }

  need.forEach(k=>{
    const v = vals[k].sort((a,b)=>a-b);
    // Nothing came back. If that's because we backed off mid-run, leave the
    // entry *undefined* so a later call retries it — writing null here would
    // latch "no history" for the session even after the cooldown expires.
    if(!v.length){ if(!apiPaused()) stats[k] = null; return; }
    const s = {
      median: v[Math.floor(v.length/2)],
      mean: v.reduce((a,b)=>a+b,0)/v.length,
      min: v[0], max: v[v.length-1], n: v.length,
    };
    stats[k] = s;
    store.set(statsCacheKey(k), s);
  });
}
/* History saved on this phone earlier in the week costs no request, so it is
   all read back at once: a status shows wherever the phone already knows the
   median, in view or not (a favourite's chip in the Field Book, say). Only
   what's missing waits for loadViewStats(). */
Object.keys(GAUGES).forEach(k=>{ const c = store.get(statsCacheKey(k)); if(c) stats[k] = c; });

/* Verify the hardcoded site IDs against monitoring-location metadata
   instead of trusting them blindly — batched, lazy and cached. */
async function verifyGaugesBatch(keys){
  keys = keys.filter(k=>!isDWR(k));     // DWR stations are verified by their own latest read
  const need = [];
  keys.forEach(k=>{
    if(meta[k]) return;
    const c = store.get("meta:"+GAUGES[k].site);
    if(c) meta[k] = c; else need.push(k);
  });
  if(!need.length) return;
  for(const group of chunk(need, batchSupported ? MAX_SITES_LATEST : 1)){
    if(apiPaused()) break;
    /* The monitoring-locations collection names this parameter `id`, not
       `monitoring_location_id` the way latest-continuous and daily do.
       Asking for the wrong one is a 400 InvalidQuery — "At least one
       requested property wasn't found" — and since a failed verify falls
       through to the unverified default, the only symptom was every gauge
       on the map quietly reading "(unverified)". It still takes a
       comma-separated list, so the batching is unchanged. */
    const url = apiURL("monitoring-locations/items", {
      id: group.map(siteOf).join(","),
      limit: String(group.length + 5)
    });
    try{
      const j = await fetchJSON(url, 20000);
      (j.features||[]).forEach(f=>{
        const p = f.properties || {};
        const k = KEY_BY_SITE[f.id || p.id ||
                  (p.monitoring_location_number ? "USGS-"+p.monitoring_location_number : "")];
        if(!k) return;
        meta[k] = {name: p.monitoring_location_name || GAUGES[k].label, verified:true};
        store.set("meta:"+GAUGES[k].site, meta[k]);
      });
    }catch(e){
      /* Backed off (a 429): nothing was checked, so nothing is marked, and
         these are asked again after the cooldown — the same rule as the
         history. "(unverified)" is for a site the metadata didn't confirm,
         never for one that wasn't asked. Any other failure falls through to
         the unverified default below. */
      if(apiPaused()) break;
    }
    group.forEach(k=>{
      if(!meta[k]) meta[k] = {name: GAUGES[k].label, verified:false};
    });
  }
}

function dayOfYear(d){ return Math.floor((d - new Date(d.getFullYear(),0,0))/864e5); }

/* ---------- flow interpretation ---------- */
/* A reading the API hands back is not necessarily today's. A gauge USGS has
   stopped keeps answering with its last value: the Raccoon at Walnut Woods
   stopped on 2026-09-15 at 1,320 CFS and the app showed that as the current
   level, badge and map colour included, while the river ran ~8,700. Past
   READING_MAX_AGE_MS a reading gets its own status with ratio:null, so
   everything keyed off the ratio (dot colour, flow speed, float estimate,
   good-flow badge) treats it as no data, and every place that prints the
   number labels it as the last reading. "Not reporting" is the API saying
   so; "Out of date" is this phone's saved copy when the API couldn't be
   reached (f.stale), which says nothing about the gauge itself. */
const READING_MAX_AGE_MS = 24*60*60*1000;
function readingIsOld(f){
  const t = f && f.time ? new Date(f.time).getTime() : NaN;
  return isFinite(t) && Date.now() - t > READING_MAX_AGE_MS;
}
function readingWhen(time){
  const d = new Date(time);
  if(isNaN(d)) return "";
  const o = {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"};
  if(d.getFullYear() !== new Date().getFullYear()) o.year = "numeric";
  return d.toLocaleString([], o);
}
function statusOf(key){
  const f = flows[key], s = stats[key];
  if(!f || f.cfs==null) return {cls:"na", label:"No data", color:"var(--st-na)", ratio:null};
  if(readingIsOld(f)) return {cls:"old", label:f.stale ? "Out of date" : "Not reporting", color:"var(--st-na)", ratio:null};
  if(!s) return {cls:"na", label:"Live", color:"var(--st-na)", ratio:null};
  const r = f.cfs / s.median;
  if(r < 0.40) return {cls:"vlow",  label:"Very low",        color:"var(--st-vlow)",  ratio:r};
  if(r < 0.75) return {cls:"low",   label:"Below average",   color:"var(--st-low)",   ratio:r};
  if(r <=1.25) return {cls:"avg",   label:"Around average",  color:"var(--st-avg)",   ratio:r};
  if(r <=1.80) return {cls:"high",  label:"Above average",   color:"var(--st-high)",  ratio:r};
  return {cls:"vhigh", label:"Very high ⚠", color:"var(--st-vhigh)", ratio:r};
}

function plainLanguage(key, riverId){
  const st = statusOf(key), f = flows[key], s = stats[key];
  if(st.cls==="old") return f.stale
    ? `The newest reading this phone has is from ${readingWhen(f.time)}, and it couldn't reach ${isDWR(key)?"Colorado DWR":"USGS"} for a newer one — so there's no current level here. Don't read the last number as today's.`
    : `This gauge hasn't reported since ${readingWhen(f.time)}. It may be shut down for the season or out of service, so there's no current level here — don't read the last number as today's. Another gauge on this water, or a local shop, is the better read.`;
  if(st.ratio==null) return "No comparison available yet — use the raw CFS and ask a local shop how it fishes at this level.";
  const pct = Math.round(Math.abs(st.ratio-1)*100);
  const tail = riverId==="southfork" ? " (Remember: this is dam-controlled — the number can step up or down with releases.)" : "";
  switch(st.cls){
    case "vlow": return `Running ~${pct}% below the seasonal norm — skinny, slow, gin-clear water. Fish are spooky (go light and long), and floats will drag in the riffles. Watch afternoon water temps.${tail}`;
    case "low":  return `~${pct}% below average — clear and technical. Great sight-fishing, slower-than-usual floats; you may scrape in shallow braids.${tail}`;
    case "avg":  return `Within the normal band for this week of the year. Expect typical clarity, typical float times — the conditions most local advice assumes.${tail}`;
    case "high": return `~${pct}% above average — water is fast, cold, and likely off-color. Better for rafting than fishing; nymph the soft edges if you fish. Floats run quick.${tail}`;
    case "vhigh":return `More than ${pct}% above the norm — pushy, cold, debris-laden water. Fishing is largely off; floating is for experienced boaters and commercial trips only.${tail}`;
  }
}

/* float time estimate scaled by flow ratio (sqrt damping, clamped).
   Ungauged rivers (primaryGauge null) fall back to the typical-flow
   estimate rather than throwing. */
function floatEstimate(sec){
  const key = RIVERS.find(r=>r.id===sec.river).primaryGauge;
  const st = key ? statusOf(key) : {ratio:null};
  const scale = st.ratio ? Math.min(1.5, Math.max(0.6, Math.sqrt(st.ratio))) : 1;
  const eff = sec.typSpeed * scale;
  const lo = sec.miles/(eff*1.15), hi = sec.miles/(eff*0.85);
  const fmt = h => h<1 ? Math.round(h*60)+" min" : (Math.round(h*2)/2)+" hr";
  return {lo, hi, text:`${fmt(lo)}–${fmt(hi)}`, scaled:!!st.ratio};
}

/* ============================================================
   MAP
   ============================================================ */
/* zoomSnap .25 lets a pinch settle where the fingers stopped instead of
   snapping a whole level, so getZoom() is fractional: compare it with >= / <
   but never use it as a key or with === (use Math.floor). */
/* zoomControl is off here and added bottom-right further down, above the
   locate button: that is where a thumb is, and the top-left is now the menus. */
const map = L.map("map",{zoomControl:false, attributionControl:true,
    zoomSnap:0.25, zoomDelta:1, wheelPxPerZoomLevel:90, wheelDebounceTime:30,
    bounceAtZoomLimits:false, inertiaDeceleration:2600})
  .setView([43.6,-100.5], 4);        // whole-country view; the zone picker opens over it

/* ============================================================
   TAPS AND GESTURES
   Every interactive layer on this map (rivers, lakes, public land, the
   zone chooser) used to act on the first click. That is fatal to
   double-tap-to-zoom: tap one opens a sheet or popup, which autoPans the
   map out from under tap two, and Leaflet never sees a double click.
   Google and Apple Maps solve it by waiting a beat before committing to a
   single tap, so onTap() does the same: the action runs ~250 ms after the
   click unless a dblclick or a zoom turns up first. Point targets (gauge
   dots, access pins) stay immediate — nobody double-taps a 28 px pin.
   Leaflet propagates a path's dblclick to the map, which is what actually
   zooms; nothing here stops it. Markers do not bubble by default, so the
   lake and zone-card markers are created with bubblingMouseEvents:true.
   ============================================================ */
const TAP_DELAY = 250;
let tapTimer = null;
function cancelTap(){ if(tapTimer){ clearTimeout(tapTimer); tapTimer = null; } }
map.on("dblclick zoomstart", cancelTap);
function onTap(layer, fn){
  layer.on("click", e => {
    cancelTap();
    tapTimer = setTimeout(() => { tapTimer = null; fn(e); }, TAP_DELAY);
  });
  layer.on("dblclick", cancelTap);
}

/* One-finger zoom and two-finger tap, the two touch gestures Leaflet lacks.
   Double-tap-and-hold, then drag: down zooms in, up zooms out (Google's
   direction), around the point you touched. A second tap that lifts without
   moving is left alone and zooms in as an ordinary double tap. Two fingers
   landing together and lifting quickly, without moving or pinching, zooms
   out one level around the midpoint. The hold-drag zoom uses the same
   internal path Leaflet's own pinch does (_moveStart, then _move with
   pinch:true each frame, then one _animateZoom/_resetView on release), so
   zoomend and moveend fire once at the end rather than every frame.
   Dragging is switched off from the moment the second touch lands, so the
   map cannot pan before the zoom takes over, and restored on every exit. */
(function(){
  const el = map.getContainer();
  const MOVE_PX = 8, PX_PER_ZOOM = 110;
  let lastTap = null;          // {t,x,y} of the previous short, still tap
  let one = null;              // single-finger tracking
  let two = null;              // two-finger tap tracking
  let firstDown = 0;           // when the first finger of this touch landed
  let raf = 0, pendingZ = null;

  const pt = t => { const r = el.getBoundingClientRect(); return L.point(t.clientX - r.left, t.clientY - r.top); };

  // the map centre that keeps the anchor's lat/lng under the finger at zoom z
  function centerFor(z){
    return map.unproject(map.project(one.anchorLL, z)
      .subtract(one.anchor.subtract(map.getSize().divideBy(2))), z);
  }
  function finishHold(){
    if(!one || !one.second) return;
    map.dragging.enable();
    if(!one.active) return;
    if(raf){ cancelAnimationFrame(raf); raf = 0; }
    // A quick flick can lift before the next frame has drawn the last move;
    // apply it now, or the centre is still null and Leaflet throws.
    if(pendingZ != null) applyZoom();
    pendingZ = null;
    const z = map._limitZoom(one.z), center = one.center || centerFor(z);
    if(map.options.zoomAnimation) map._animateZoom(center, z, true, map.options.zoomSnap);
    else map._resetView(center, z);
    // the browser still fires a dblclick after this touchend; keep the
    // handler off a moment longer so it cannot add a level on top
    setTimeout(() => map.doubleClickZoom.enable(), 450);
  }
  function applyZoom(){
    raf = 0;
    if(pendingZ == null || !one || !one.active) return;
    const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), pendingZ));
    pendingZ = null;
    one.z = z; one.center = centerFor(z);
    map._move(one.center, z, {pinch:true, round:false});
  }

  el.addEventListener("touchstart", e => {
    const n = e.touches.length;
    if(n === 1){
      firstDown = Date.now();
      two = null;
      const p = pt(e.touches[0]);
      const second = lastTap && firstDown - lastTap.t < 300 && Math.hypot(p.x-lastTap.x, p.y-lastTap.y) < 40;
      one = {x:p.x, y:p.y, anchor:p, anchorLL:map.containerPointToLatLng(p),
        z0:map.getZoom(), z:map.getZoom(), center:null, active:false, second, t:firstDown};
      if(second) map.dragging.disable();
    } else if(n === 2){
      if(one) finishHold();
      one = null; lastTap = null;
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      if(e.changedTouches.length === 2) firstDown = Date.now();   // both fingers in one event, common on iOS
      two = (Date.now() - firstDown < 150)
        ? {t:firstDown, a, b, d:a.distanceTo(b), moved:false} : null;
    } else { one = null; two = null; }
  }, {passive:true});

  el.addEventListener("touchmove", e => {
    if(two && e.touches.length === 2){
      const a = pt(e.touches[0]), b = pt(e.touches[1]);
      if(a.distanceTo(two.a) > 10 || b.distanceTo(two.b) > 10 || Math.abs(a.distanceTo(b) - two.d) > 10) two.moved = true;
      return;
    }
    if(!one || e.touches.length !== 1) return;
    const p = pt(e.touches[0]);
    if(!one.active){
      if(!one.second || Math.abs(p.y - one.y) <= MOVE_PX) return;
      one.active = true;
      map.doubleClickZoom.disable();
      cancelTap();
      map._stop();
      map._moveStart(true, false);
    }
    e.preventDefault();
    pendingZ = one.z0 + (p.y - one.y) / PX_PER_ZOOM;
    if(!raf) raf = requestAnimationFrame(applyZoom);
  }, {passive:false});

  el.addEventListener("touchend", e => {
    if(e.touches.length) return;
    const now = Date.now();
    if(two){
      if(!two.moved && now - two.t < 300){
        const mid = two.a.add(two.b).divideBy(2);
        map.setZoomAround(mid, Math.max(map.getMinZoom(), map.getZoom() - 1));
      }
      two = null; lastTap = null; one = null;
      return;
    }
    if(one){
      if(one.second){ finishHold(); lastTap = null; }
      else {
        const tap = now - one.t < 250;
        // a second tap ends the chain, so a third starts fresh
        lastTap = (tap && !one.second) ? {t:now, x:one.x, y:one.y} : null;
      }
    }
    one = null;
  }, {passive:true});
  el.addEventListener("touchcancel", () => { if(one) finishHold(); one = null; two = null; lastTap = null; }, {passive:true});
})();

/* USGS "US Topo" — the default. Same quadrangle cartography the paper
   sheets use: cream ground, blue hydrography in italic serif, green
   public land, tan contours, and the PLSS section grid. It reads better
   than imagery for the job this app actually does — seeing where the
   public land, the access two-track and the contour lines are before you
   drive out. Cached tiles stop at z16, so maxNativeZoom lets the map keep
   zooming past that on upscaled tiles instead of refusing to zoom in. */
const usgsTopo = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}",{
  maxZoom:20, maxNativeZoom:16, attribution:'Topo © <a href="https://www.usgs.gov/">USGS</a> The National Map'});
const usgsImgTopo = L.tileLayer("https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryTopo/MapServer/tile/{z}/{y}/{x}",{
  maxZoom:20, maxNativeZoom:16, attribution:'Imagery+Topo © <a href="https://www.usgs.gov/">USGS</a> The National Map'});
const topo = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png",{
  maxZoom:17, attribution:'© OpenStreetMap, SRTM | © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'});
const sat = L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",{
  maxZoom:18, attribution:"Imagery © Esri & contributors"});
/* Google Earth-style imagery. Keyless tile endpoints — fine for personal
   use; for anything public-facing, switch to the Google Maps JS API with
   an API key to stay inside Google's terms. lyrs: s=satellite, y=hybrid */
const gSat = L.tileLayer("https://{s}.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",{
  maxZoom:20, subdomains:["mt0","mt1","mt2","mt3"], attribution:"Imagery © Google"});
const gHyb = L.tileLayer("https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",{
  maxZoom:20, subdomains:["mt0","mt1","mt2","mt3"], attribution:"Imagery © Google"});
usgsTopo.addTo(map);
/* Overlays: only the river classes (tierGroups, further down). The icon
   layers are switched from the Map Icons menu (LAYER_CHIPS). */
const layerControl = L.control.layers(
  {"USGS Topo":usgsTopo,"USGS Imagery + Topo":usgsImgTopo,"Google Hybrid":gHyb,"Google Satellite":gSat,"Esri Satellite":sat,"OpenTopoMap":topo},
  null, {position:"bottomleft"}).addTo(map);

/* Named areas for the "Jump to…" list beside Change Region (zoneCtl, further
   down). A null target is a group heading in the list, not a destination. */
const REGIONS = [
  ["Statewide view", [44.30,-112.90,6]],
  ["Jackson Hole / Tetons", [43.55,-110.80,9]],
  ["Eastern Idaho (Henry's Fork / SF)", [43.95,-111.55,9]],
  ["Sun Valley / Wood River", [43.50,-114.25,9]],
  ["Central Idaho (Salmon country)", [44.90,-114.60,7]],
  ["North Idaho (Clearwater / Panhandle)", [46.90,-116.00,7]],
  ["Boise / Payette", [43.90,-116.00,9]],
  ["── Teton Valley & Swan Valley (ID) ──", null],
  ["Teton Valley — whole valley", [43.78,-111.18,10]],
  ["Driggs / Teton & Darby Creek", [43.72,-111.12,12]],
  ["Victor / Trail & Fox Creek", [43.62,-111.12,12]],
  ["Tetonia / Badger & Bitch Creek", [43.90,-111.20,11]],
  ["Teton canyon (Canyon Creek)", [43.88,-111.42,11]],
  ["Swan Valley — whole valley", [43.42,-111.30,10]],
  ["Irwin / Rainey & Palisades Creek", [43.42,-111.23,12]],
  ["Palisades Reservoir (Big Elk, McCoy)", [43.25,-111.15,11]],
  ["South Fork canyon (Heise–Swan Valley)", [43.55,-111.50,11]],
  ["── Grand Teton National Park ──", null],
  ["Grand Teton — whole park", [43.81,-110.68,10]],
  ["Moose / Jenny Lake creeks", [43.71,-110.72,12]],
  ["Moran / Pacific & Spread Creek", [43.85,-110.52,11]],
  ["Colter Bay / Christian & Pilgrim", [43.89,-110.60,12]],
  ["Phelps Lake / Granite Canyon", [43.61,-110.80,12]],
  ["North park backcountry (Berry/Owl/Moose)", [43.99,-110.80,11]],
  ["Flagg Ranch / Rockefeller Parkway", [44.10,-110.67,12]],
  ["── Yellowstone National Park ──", null],
  ["Yellowstone — whole park", [44.60,-110.50,9]],
  ["Madison / Firehole / Gibbon", [44.64,-110.86,11]],
  ["Lamar Valley & Slough Creek", [44.89,-110.25,10]],
  ["Soda Butte / Pebble / Cache", [44.92,-110.10,11]],
  ["Gardner River / Mammoth", [44.95,-110.70,11]],
  ["Yellowstone Lake & upper river", [44.45,-110.30,10]],
  ["Lewis / Snake (south entrance)", [44.20,-110.65,10]],
  ["Bechler / Cascade Corner", [44.20,-110.98,11]],
  ["Green River Valley / Pinedale", [42.75,-110.05,9]],
  ["Cody / Bighorn Basin", [44.30,-108.70,8]],
  ["Wind River / Thermopolis", [43.40,-108.50,9]],
  ["Saratoga / North Platte", [42.00,-106.70,8]],
  ["Central Iowa / Des Moines", [41.65,-93.75,10]],
  ["── Driftless Area ──", null],
  ["Driftless — whole region", [43.55,-91.30,7]],
  ["Decorah / NE Iowa", [43.30,-91.60,10]],
  ["Allamakee / Yellow River", [43.15,-91.35,11]],
  ["Lanesboro / Root River (MN)", [43.72,-92.00,11]],
  ["Whitewater / Elba (MN)", [44.08,-92.02,11]],
  ["Coon Valley / Timber Coulee (WI)", [43.55,-90.95,11]],
  ["Kickapoo / West Fork (WI)", [43.58,-90.70,10]],
  ["Grant County spring creeks (WI)", [43.02,-90.65,11]],
  ["Black Earth / Madison (WI)", [43.13,-89.72,11]],
  ["Kinnickinnic / River Falls (WI)", [44.84,-92.66,11]],
  ["── North Shore (Lake Superior) ──", null],
  ["North Shore — whole region", [47.30,-90.80,8]],
  ["Duluth shore (Lester–Knife)", [46.92,-91.90,10]],
  ["Two Harbors (Gooseberry–Baptism)", [47.20,-91.35,10]],
  ["Tofte / Lutsen (Temperance–Cascade)", [47.65,-90.70,10]],
  ["Grand Marais to Grand Portage", [47.85,-90.05,9]],
  ["Bois Brule (WI)", [46.55,-91.58,11]],
  ["── Door Peninsula ──", null],
  ["Door County — whole peninsula", [44.95,-87.25,9]],
  ["Jacksonport (Hibbards / Logan)", [44.99,-87.20,12]],
  ["Baileys Harbor / Heins", [45.02,-87.16,12]],
  ["Ephraim / Sister Bay", [45.14,-87.17,12]],
  ["Little Sturgeon (Keyes Creek)", [44.77,-87.58,12]],
  ["Ahnapee River / Algoma", [44.66,-87.47,11]],
  ["Mink River / Rowleys Bay", [45.24,-87.05,12]],
  ["── Wisconsin South Shore & Central Sands ──", null],
  ["South Shore (Bayfield / Ashland)", [46.50,-91.00,9]],
  ["Central sands (Mecan / Tomorrow)", [44.10,-89.30,9]],
  ["── East-Central MN / St. Croix ──", null],
  ["Stillwater / St. Croix", [45.15,-92.75,10]],
  ["Twin Cities (Mississippi/Minnesota)", [44.98,-93.20,10]],
  ["Rum / Snake / Kettle (north metro)", [45.65,-93.10,9]],
  ["Cannon River (Northfield/Welch)", [44.47,-92.95,10]],
  ["── Lakes Country / Northwoods ──", null],
  ["Brainerd / Crow Wing (MN)", [46.40,-94.40,9]],
  ["Park Rapids / Itasca headwaters (MN)", [46.95,-95.05,9]],
  ["Grand Rapids / Aitkin (MN)", [46.95,-93.60,9]],
  ["Chippewa / Eau Claire (WI)", [44.85,-91.55,9]],
  ["Flambeau / Northwoods (WI)", [45.70,-90.60,8]],
  ["Minocqua / Manitowish (WI)", [45.95,-89.80,9]],
  ["Wolf River (WI)", [44.90,-88.70,8]],
  ["Lower Wisconsin Riverway", [43.20,-90.20,9]],
  ["── West Coast & Montana ──", null],
  ["California", [37.27,-119.31,5]],
  ["Eastern Sierra / Owens", [37.55,-118.70,9]],
  ["Shasta / McCloud / Pit", [41.05,-122.10,9]],
  ["Oregon", [44.15,-120.58,6]],
  ["Deschutes / Metolius", [44.75,-121.15,9]],
  ["McKenzie / Willamette", [44.10,-122.40,9]],
  ["Rogue / Umpqua", [42.80,-123.00,8]],
  ["Washington", [47.27,-120.88,6]],
  ["Yakima / Cle Elum", [47.00,-120.60,9]],
  ["Methow / Wenatchee", [47.95,-120.40,8]],
  ["Olympic Peninsula rivers", [47.85,-124.20,9]],
  ["Montana", [46.68,-110.04,5]],
  ["Madison / Ennis", [45.20,-111.60,9]],
  ["Missouri / Craig", [47.10,-111.90,10]],
  ["Bighorn / Fort Smith", [45.50,-107.80,10]],
  ["Missoula (Blackfoot / Bitterroot / Clark Fork)", [46.85,-113.95,8]],
  ["Big Hole / Beaverhead", [45.40,-112.90,9]],
  ["── Colorado & Utah ──", null],
  ["Colorado", [39.00,-105.55,6]],
  ["South Platte (Dream Stream–Deckers)", [39.10,-105.40,9]],
  ["Blue / Colorado (Silverthorne–Kremmling)", [39.85,-106.25,9]],
  ["Roaring Fork / Fryingpan", [39.40,-106.95,10]],
  ["Gunnison / Taylor", [38.65,-106.95,9]],
  ["Arkansas (Leadville–Cañon City)", [38.80,-106.00,8]],
  ["Rio Grande / Conejos", [37.55,-106.50,9]],
  ["Animas / Dolores / San Juan", [37.45,-107.90,8]],
  ["Yampa / Elk / North Park", [40.50,-106.70,8]],
  ["Utah", [39.40,-111.70,6]],
  ["Green River (Flaming Gorge)", [40.90,-109.30,10]],
  ["Provo / Weber", [40.70,-111.40,9]],
  ["Logan / Cache Valley", [41.80,-111.70,9]],
  ["Uinta Basin (Duchesne / Strawberry)", [40.45,-110.50,8]],
  ["── National parks, West Coast & Montana ──", null],
  ["Olympic", [47.87,-123.93,8]],
  ["Mount Rainier", [46.85,-121.68,10]],
  ["North Cascades", [48.69,-121.14,9]],
  ["Crater Lake", [42.93,-122.13,10]],
  ["Glacier", [48.62,-113.86,9]],
  ["Redwood", [41.46,-124.00,9]],
  ["Lassen Volcanic", [40.50,-121.41,10]],
  ["Yosemite", [37.84,-119.54,9]],
  ["Kings Canyon", [36.92,-118.66,9]],
  ["Sequoia", [36.50,-118.58,9]],
  ["Pinnacles", [36.49,-121.17,10]],
  ["Death Valley", [36.47,-117.14,8]],
  ["Joshua Tree", [33.90,-115.86,9]],
  ["Channel Islands", [33.77,-119.74,8]],
  ["── National parks, Colorado & Utah ──", null],
  ["Rocky Mountain", [40.35,-105.70,10]],
  ["Black Canyon of the Gunnison", [38.57,-107.72,11]],
  ["Great Sand Dunes", [37.80,-105.55,10]],
  ["Mesa Verde", [37.20,-108.48,10]],
  ["Capitol Reef", [38.20,-111.17,9]],
  ["Zion", [37.30,-113.03,10]],
  ["Canyonlands", [38.25,-109.90,9]],
  ["Arches", [38.73,-109.58,10]],
  ["Bryce Canyon", [37.57,-112.18,10]],
  ["── Alaska ──", null],
  ["Alaska", [61.50,-151.00,5]],
  ["Kenai Peninsula (Kenai / Russian / Kasilof)", [60.40,-150.80,8]],
  ["Mat-Su (Deshka / Willow / Little Su)", [61.85,-150.30,8]],
  ["Copper basin (Gulkana / Klutina)", [62.20,-145.40,8]],
  ["Fairbanks (Chena / Delta Clearwater)", [64.50,-146.80,7]],
  ["Bristol Bay (Naknek / Kvichak / Alagnak)", [59.10,-156.20,7]],
  ["Iliamna (Copper / Gibraltar / Newhalen)", [59.80,-155.20,8]],
  ["Kuskokwim Bay (Kanektok / Goodnews)", [59.70,-161.10,8]],
  ["Kodiak (Karluk / Ayakulik)", [57.50,-153.70,8]],
  ["Southeast (Situk / Prince of Wales)", [57.00,-134.50,6]],
  ["── Pennsylvania ──", null],
  ["Pennsylvania", [41.00,-77.60,7]],
  ["Cumberland Valley (Letort / Yellow Breeches)", [40.15,-77.20,10]],
  ["── New York ──", null],
  ["New York", [42.90,-75.60,6]],
  ["Catskills (Beaver Kill / Delaware)", [41.95,-74.80,9]],
  ["Adirondacks (Ausable / Saranac)", [44.30,-73.90,8]],
  ["Salmon River (Pulaski)", [43.55,-76.00,9]],
  ["── Virginia ──", null],
  ["Virginia", [37.70,-79.40,7]],
  ["Shenandoah National Park / Rapidan", [38.45,-78.35,9]],
  ["── Maine ──", null],
  ["Maine", [45.30,-69.20,7]],
  ["The Forks (Kennebec / Dead / Moose)", [45.34,-69.95,9]],
  ["Rangeley (Rapid / Kennebago / Magalloway)", [44.95,-70.75,9]],
  ["── Missouri ──", null],
  ["Missouri", [37.60,-92.40,7]],
  ["Current River trout water (Montauk / Akers)", [37.45,-91.60,10]],
  ["Lake Taneycomo / Table Rock", [36.65,-93.20,10]],
  ["── Michigan ──", null],
  ["Au Sable (Grayling / Mio)", [44.65,-84.40,9]],
  ["Manistee / Pere Marquette", [44.10,-85.80,8]],
  ["Upper Peninsula (Two Hearted / Fox)", [46.40,-86.30,8]],
  ["── Black Hills, New Mexico, Arizona & Nevada ──", null],
  ["Black Hills (Rapid / Spearfish)", [44.10,-103.65,9]],
  ["San Juan Quality Waters", [36.80,-107.65,12]],
  ["Northern New Mexico (Chama / Rio Grande)", [36.40,-106.10,8]],
  ["Lees Ferry", [36.90,-111.55,11]],
  ["White Mountains (AZ)", [33.95,-109.60,9]],
  ["Truckee / East Walker (NV)", [39.20,-119.40,8]],
  ["Grand Canyon", [36.10,-112.10,9]],
  ["Great Basin", [38.98,-114.25,11]],
  ["── National parks, Alaska ──", null],
  ["Katmai", [58.70,-154.90,8]],
  ["Lake Clark", [60.60,-153.90,7]],
  ["Denali", [63.30,-150.50,7]],
  ["Wrangell-St. Elias", [61.70,-142.90,7]],
  ["Gates of the Arctic", [67.70,-153.30,6]],
  ["Kobuk Valley", [67.40,-159.10,8]],
  ["Glacier Bay", [58.70,-136.70,7]],
  ["Kenai Fjords", [59.90,-150.00,8]],
];

/* ============================================================
   SPECIES FILTER — "where can I catch a brown trout?"

   js/species.js (generated by ~/.cache/flyfish-osm/species/) lists, water
   by water, the fish a fisheries agency or the park names there, or that
   the water's own regulations have a rule for. Nothing is inferred from
   the region. Picking a species takes every river and lake without it off
   the map, the way the Other class goes, and that includes waters with no
   species data yet: keeping the unknowns would draw a map of guesses.

   A river opened on purpose (tempShown) and the one in focus stay, and so
   do the open lake and a lake with a trip recording. A favourite doesn't:
   the question is where the fish are, and a starred creek without them
   isn't an answer to it. Never remembered: every launch starts at "Any
   species", like the class filter.

   Declared up here, above the lake layer and tierPicked(), because both
   read it at startup. Every use is guarded: with species.js missing the
   filter simply isn't offered.
   ============================================================ */
const SP_ON = typeof SPECIES !== "undefined" && typeof SPECIES_LIST !== "undefined" && typeof SPECIES_SRC !== "undefined";
const SP_SETS = new Map();               // water key ("id" or "lake:id") -> Set of species keys
if(SP_ON) Object.keys(SPECIES).forEach(k => SP_SETS.set(k, new Set(SPECIES[k].map(e => e[0]))));
let speciesPick = null;                  // a SPECIES_LIST key, or null for "Any species"
let curLake = null;                      // the lake whose sheet is open
const speciesHas = (key, sp) => { const s = SP_SETS.get(key); return !!(s && s.has(sp)); };
/* Inside the area species.js has been built for (SPECIES_SCOPE), a water
   with no entry has been looked for, so its sheet can say "No species data
   yet"; outside it the sheet says nothing about species at all. */
function speciesInScope(kind, w){
  const s = SP_ON && typeof SPECIES_SCOPE !== "undefined" ? SPECIES_SCOPE : null;
  if(!s || !w) return false;
  return kind === "lake" ? (s.lakePark || []).includes(w.park)
                         : (s.state || []).includes(w.state) || (s.region || []).includes(w.region);
}
function lakeSpeciesShown(id){
  if(!speciesPick || id === curLake) return true;
  const lt = typeof lakeTripPinKeep === "function" ? lakeTripPinKeep() : null;
  return (lt && lt.lake === id) || speciesHas("lake:" + id, speciesPick);
}

/* ============================================================
   LAKES — still water, marked as still water.

   Rivers get a line and a current. A lake gets a shape and a shimmer: the
   outline breathes slowly instead of drifting, because there is no
   direction to point and pretending otherwise would be the same mistake as
   animating a river the wrong way. Lakes sit *under* the river lines so an
   inlet or outlet still reads on top of the water it runs into.
   ============================================================ */
const lakePane = map.createPane("lakePane");
lakePane.style.zIndex = 405;                 // under the rivers, over public land
const lakeLayer = L.layerGroup().addTo(map);
const lakeShapes = {};
const LAKE_LABEL_ZOOM = 8;

(typeof LAKES === "undefined" ? [] : LAKES).forEach(k => {
  /* A lake in genuine pieces (Taneycomo is three) carries the extra outlines
     in `parts`, each a ring. Leaflet reads a list of ring-lists as a
     multipolygon, so it is still one layer: one tap, one lake. */
  const shape = k.parts && k.parts.length ? [[k.ring]].concat(k.parts.map(q => [q])) : k.ring;
  const poly = L.polygon(shape, {pane:"lakePane", color:"#0e5f72", weight:1.8,
    fillColor:"#3aa7c2", fillOpacity:.34, className:"lake-shape"}).addTo(lakeLayer);
  onTap(poly, () => openLake(k.id));
  poly.bindTooltip(`<b>${k.name}</b>`, {direction:"top", className:"zone-tip"});
  const mark = L.marker(k.at, {pane:"lakePane", riseOnHover:true, bubblingMouseEvents:true,
    icon:L.divIcon({className:"", iconSize:null,
      html:`<div class="lake-label"><span>${k.short}</span></div>`})}).addTo(lakeLayer);
  onTap(mark, () => openLake(k.id));
  lakeShapes[k.id] = {lake:k, poly, mark};
});
function syncLakes(){
  const z = map.getZoom();
  Object.values(lakeShapes).forEach(({lake, mark}) => {
    // a big lake earns its name earlier than a pond does
    const min = lake.areaKm2 > 20 ? LAKE_LABEL_ZOOM
              : lake.areaKm2 > 1  ? LAKE_LABEL_ZOOM + 2 : LAKE_LABEL_ZOOM + 4;
    const el = mark.getElement();
    if(el) el.style.display = (!zonesShown && z >= min) ? "" : "none";
  });
}
map.on("zoomend moveend", syncLakes);
/* A species pick takes the lakes without that fish off the map, shape and
   label both (their access pins follow in syncMarkers). */
function syncLakeFilter(){
  Object.values(lakeShapes).forEach(({lake, poly, mark}) => {
    const show = lakeSpeciesShown(lake.id);
    [poly, mark].forEach(l => {
      const has = lakeLayer.hasLayer(l);
      if(show && !has) lakeLayer.addLayer(l);
      else if(!show && has) lakeLayer.removeLayer(l);
    });
  });
  syncLakes();                          // a label put back takes its zoom rule again
}

function openLake(id){
  const k = LAKES.find(x => x.id === id); if(!k) return;
  unfocusRiver();                       // the sheet stays open, but it is no longer a river's
  curRiver = null;
  curLake = k.id;
  if(speciesPick){ syncLakeFilter(); syncMarkers(); }   // opened from the Field Book while the filter hides it: show it, pins too
  $("#sw").style.background = "#3aa7c2";
  $("#sh-title").textContent = k.name;
  /* Every lake names its PARK_INFO row in `park` -- a park's, or a state's for
     the state lakes. A lake that names none reads as Yellowstone's, the first
     lakes this sheet was written for. */
  const pk = PARK_INFO[k.park] || PARK_INFO.yellowstone;
  $("#sh-sub").textContent = lakePlace(k);
  fbShowRow(k, false, "lake");          // the lake's own Field Book row, never the last river's
  sheet.classList.add("open");
  if(typeof Metrics !== "undefined") Metrics.track("lake_open", k.id, k.name);
  delete body.dataset.river;            // renderSheet's fold memory is per river; this is a lake
  const wx = {key:"lake:" + k.id, pt:wxLakePoint(k)};    // on a lake the wind is the forecast that matters
  const fish = speciesRowHTML("lake", k);
  /* Private water (Lake Halice, an HOA lake) says so before anything else:
     this is a map people use to decide where to go, and nothing on the sheet
     may read as an invitation. The amber of the Iowa low-head-dam row. */
  const priv = k.private ? `<div class="rc-dam">Private water — residents and guests only. No public access.</div>` : "";
  body.innerHTML =
    (priv || desigHTML(k.id) || fish ? `<div class="rulescard">${priv}${desigHTML(k.id)}${fish}</div>` : "") +
    `<p style="margin:12px 2px 2px;font-size:13.5px">${k.blurb}</p>` +
    `<div class="flowcard"><div class="gname">Still water — ${k.areaKm2} km²</div>` +
    `<div class="plain">No gauge and no flow number: a lake doesn't have one. What "in shape" means here is ice-off, water temperature and wind, not CFS — and on the big lakes the wind is the thing that decides the day.</div></div>` +
    wxCardHTML(wx) +
    (k.fish ? `<div class="secthead">Fishing notes</div><div class="fishnote">🎣 ${k.fish}</div>` : "") +
    `<div class="secthead">${pk.heading || "Park regulations"}</div><div class="fishnote">` +
      `<span class="badge" style="background:#4a6f8a">${pk.badge}</span> ` +
      `<span style="font-size:11.5px">${k.regs}</span>` +
      // a lake the row's note doesn't describe (Lake Halice: no DNR fish list) carries its own
      `<div style="font-size:10.5px;color:var(--txt-dim);margin-top:8px">${k.regsNote || pk.lakeNote || pk.note}</div>` +
    `</div>` +
    `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Lake outline: ${k.src==="osm" ? "OpenStreetMap" : k.src==="wgfd" ? "Wyoming Game &amp; Fish's lakes map (NHDPlus HR)" : k.src==="iadnr" ? "Iowa DNR Fishing Atlas lakes layer" : k.src==="mndnr" ? "Minnesota DNR hydrography (public waters basins, and the DNR 24K lakes layer for the pits and the pond)" : "USGS NHD waterbodies"}. Verify regulations with ${pk.regBody}.</p>` +
    `<div class="rp-wrap"><button type="button" class="rp-link" data-report="${fbEsc(k.id)}">Report an issue with this lake</button></div>`;
  wxLoad(wx);
}

/* ============================================================
   CLOSED WATER — the reaches that are shut whatever day you show up.

   Yellowstone describes these by landmark ("Fishing Bridge and an area one
   mile downstream"), which is unusable on a phone in a pullout: you cannot
   tell from the bank where a mile downstream ends. So they are drawn.
   `CLOSURES` in rivers-data.js is built by walking the drawn channel
   between located points — USGS gauges, the USGS gazetteer, the park
   boundary — and every reach's length was checked against the regulation's
   own wording.

   It is drawn as hazard tape over the river rather than as a colour change
   on it: a closed reach has to read as closed even on top of the animated
   current, and recolouring the line would collide with the trout-class
   colours the Driftless and Door County water already uses. Red appears
   nowhere else on this map — survey orange is reserved for the live
   readout, teal is water.

   Only PERMANENT closures are here. Seasonal ones are dates, not places,
   and they live in each river's parkRegs where they can say when.
   ============================================================ */
const closurePane = map.createPane("closurePane");
closurePane.style.zIndex = 418;          // over the rivers and the current, under the labels
const closureLayer = L.layerGroup();      // off at launch; on while a river with a closure is open (focusSays)
const closureShapes = [];
const CLOSURE_MIN_ZOOM = 9;

(typeof CLOSURES === "undefined" ? [] : CLOSURES).forEach(c => {
  const tip = `<b>\u26d4 Closed &mdash; ${c.label}</b><br><span style="font-size:11px">${c.note}</span>`;
  c.coords.forEach(seg => {
    // a wide translucent bar under a dashed line: the bar is what you see at
    // a glance, the dashes are what say "barrier" rather than "another river"
    const bar = L.polyline(seg, {pane:"closurePane", color:"#b3261e", weight:9,
      opacity:.30, lineCap:"round", lineJoin:"round", className:"closed-bar"}).addTo(closureLayer);
    const hatch = L.polyline(seg, {pane:"closurePane", color:"#8c1d16", weight:3.2,
      opacity:.95, lineCap:"butt", dashArray:"2 7", className:"closed-line"}).addTo(closureLayer);
    [bar, hatch].forEach(l => {
      l.bindTooltip(tip, {direction:"top", className:"zone-tip", sticky:true});
      closureShapes.push(l);
    });
  });
});
/* Zoom-gated for the same reason the labels are: at regional zoom these are
   a few pixels long and just stipple the river red. */
function syncClosures(){
  const on = !zonesShown && map.getZoom() >= CLOSURE_MIN_ZOOM;
  closureShapes.forEach(l => {
    const has = closureLayer.hasLayer(l);
    if(on && !has) closureLayer.addLayer(l);
    else if(!on && has) closureLayer.removeLayer(l);
  });
}
map.on("zoomend moveend", syncClosures);

/* ============================================================
   FLOW ANIMATION — a slow travelling highlight down each river.

   It is a dashed overlay stroke whose dash offset animates, which makes the
   dashes crawl along the path. Three things had to be true for it to be
   worth having:

   1. It has to run DOWNSTREAM. A flow animation pointing the wrong way is
      worse than none, and NHD linework arrives in whatever order the fetch
      and the welding left it. `FLOW_REV` (baked in rivers-data.js) says,
      per run, whether to reverse it. A run marked "?" is one whose fall was
      inside the noise of the elevation model — it gets no animation rather
      than a guessed direction.
   2. It has to be cheap. 327 rivers animating at once is a phone-melting
      repaint; the overlay is built only for the rivers on screen, only past
      FLOW_MIN_ZOOM, and capped at FLOW_MAX_LINES.
   3. It has to mean something. Speed comes from the river's live status
      bucket, so high water visibly runs faster. Water with no gauge gets
      one neutral speed shared by all of it — the motion is never a stand-in
      for a reading the app doesn't have.
   ============================================================ */
const FLOW_MIN_ZOOM  = 9;
/* The budget is PATHS, not rivers. Capping rivers looked fine until
   Yellowstone: 43 rivers there are 224 separate runs, and it is the path
   count that the browser repaints every frame. */
const FLOW_MAX_PATHS = 80;
const FLOW_MIN_PX    = 22;     // a run too short to see isn't worth a path
const FLOW_CALM = "flow-calm";
const FLOW_SPEED = {vlow:"flow-vlow", low:"flow-low", avg:"flow-avg",
                    high:"flow-high", vhigh:"flow-vhigh"};
const flowPane = map.createPane("flowPane");
flowPane.style.zIndex = 415;            // over the river lines, under the markers
flowPane.style.pointerEvents = "none";
const flowLayer = L.layerGroup().addTo(map);
const flowLines = {};                   // riverId -> [polyline]
const reducedMotion = window.matchMedia
  && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* FLOW_REV indexes the *baked* runs, but the drawn line is not always the
   baked one — it gets snapped to NHD after first paint and refined again as
   you zoom in. So the baked table is turned into oriented reference
   segments once, and whatever geometry is currently drawn is oriented by
   comparing against them. Indexing the drawn runs positionally would break
   the moment a refresh changed how many pieces the river comes in. */
function bakedFlowRefs(r){
  if(r._flowRefs) return r._flowRefs;
  const runs = isMulti(r.coords) ? r.coords : [r.coords];
  const marks = (typeof FLOW_REV === "undefined") ? null : FLOW_REV[r.id];
  const refs = [];
  if(marks){
    runs.forEach((run, i) => {
      const mark = marks.charAt(i) || "?";
      if(mark === "?" || run.length < 2) return;    // unknown — don't fake it
      const a = mark === "1" ? run[run.length-1] : run[0];
      const b = mark === "1" ? run[0] : run[run.length-1];
      refs.push({head:a, tail:b, mid:run[Math.floor(run.length/2)]});
    });
  }
  r._flowRefs = refs;
  return refs;
}
function ll(p){ return Array.isArray(p) ? {lat:p[0], lng:p[1]} : p; }
function distKm(a, b){
  a = ll(a); b = ll(b);
  return Math.hypot((b.lat-a.lat)*111.0,
                    (b.lng-a.lng)*111.0*Math.cos(a.lat*Math.PI/180));
}
function flowRunsFor(r){
  /* whatever is drawn right now, every run turned downstream */
  const layer = riverLayers[r.id];
  if(!layer) return [];
  let runs = layer.line.getLatLngs();
  if(!runs.length) return [];
  if(!Array.isArray(runs[0])) runs = [runs];       // single-segment river
  const refs = bakedFlowRefs(r);
  if(!refs.length) return runs.map(() => null);
  return runs.map(run => {
    if(run.length < 2) return null;
    const mid = run[Math.floor(run.length/2)];
    let best = null, bestD = Infinity;
    for(const ref of refs){
      const d = distKm(ref.mid, mid);
      if(d < bestD){ bestD = d; best = ref; }
    }
    if(!best || bestD > 12) return null;           // nothing to orient against
    const a = run[0], b = run[run.length-1];
    const byHead = distKm(a, best.head) - distKm(b, best.head);
    if(Math.abs(byHead) < 0.02) return null;       // a loop — can't tell
    return byHead < 0 ? run : run.slice().reverse();
  });
}
function flowClassFor(r){
  if(!r.primaryGauge) return FLOW_CALM;
  const st = statusOf(r.primaryGauge);
  return FLOW_SPEED[st.cls] || FLOW_CALM;
}
function clearFlow(id){
  (flowLines[id] || []).forEach(l => flowLayer.removeLayer(l));
  delete flowLines[id];
}
function syncFlow(){
  const z = map.getZoom();
  const on = !reducedMotion && !zonesShown && z >= FLOW_MIN_ZOOM;
  if(!on){ Object.keys(flowLines).forEach(clearFlow); return; }
  const view = map.getBounds();
  const pxLen = run => {
    const b = L.latLngBounds(run);
    const a = map.latLngToLayerPoint(b.getNorthWest());
    const c = map.latLngToLayerPoint(b.getSouthEast());
    return Math.hypot(c.x-a.x, c.y-a.y);
  };
  const want = [];
  let budget = FLOW_MAX_PATHS;
  // the river whose sheet is open is the one being looked at: it gets the budget first
  const order = focusId ? [riverLayers[focusId].river].concat(RIVERS.filter(r => r.id !== focusId)) : RIVERS;
  for(const r of order){
    const l = riverLayers[r.id];
    if(!l || !riverVisible(r)) continue;
    if(!view.intersects(l.line.getBounds())) continue;
    const runs = flowRunsFor(r).filter(run =>
      run && run.length >= 2 && view.intersects(L.latLngBounds(run)) && pxLen(run) >= FLOW_MIN_PX);
    if(!runs.length) continue;
    if(runs.length > budget) break;
    want.push({river:r, runs});
    budget -= runs.length;
    if(budget <= 0) break;
  }
  const keep = new Set(want.map(w => w.river.id));
  Object.keys(flowLines).forEach(id => { if(!keep.has(id)) clearFlow(id); });
  for(const {river:r, runs} of want){
    const cls = flowClassFor(r);
    if(flowLines[r.id]){
      // already drawn — only the speed can have changed under it
      flowLines[r.id].forEach(l => {
        const el = l.getElement();
        if(el && !el.classList.contains(cls)){
          el.classList.remove(FLOW_CALM, ...Object.values(FLOW_SPEED));
          el.classList.add(cls);
        }
      });
      continue;
    }
    const lines = [];
    runs.forEach(run => {
      /* round caps and joins so each mark is a capsule that follows the
         bend of the channel instead of a flat tick cutting across it */
      const l = L.polyline(run, {pane:"flowPane", interactive:false,
        color:"#ffffff", opacity:.95, weight:3, lineCap:"round",
        lineJoin:"round", smoothFactor:0,
        dashArray:"6 24", className:"flow-line " + cls + (r.id === focusId ? " rv-on" : "")}).addTo(flowLayer);
      lines.push(l);
    });
    if(lines.length) flowLines[r.id] = lines;
  }
}
map.on("zoomend moveend", syncFlow);

/* river labels only at regional zoom — 100+ labels at statewide zoom is
   soup. The Driftless streams sit almost on top of each other, so they
   need a tighter zoom than the big western rivers before labels help. */
function syncLabels(){
  const z = map.getZoom();
  Object.values(riverLayers).forEach(l => {
    const reg = l.river && l.river.region;
    /* Each region's row sets its own (labelZoom): 10 for the small-stream
       regions, 9 for Yellowstone, which sits between the two -- the park
       fills the screen around zoom 9, and 40 labels at 8 is soup while 10
       hides the whole region. Rivers with no region start at 8.
       `minor` water — the 166 named Yellowstone creeks nobody has written
       about — stays unlabelled until you are close enough to be choosing
       between them. Two hundred labels over the park is not a map. */
    let min = (l.river && l.river.minor) ? 12
              : PARK_INFO[reg] ? (PARK_INFO[reg].labelZoom || 9) : 8;
    // lesser classes need more zoom before their names are worth the clutter
    const t = tierNow.get(l.river.id);
    if(t && t.tier === "2") min += 1;
    else if(t && t.tier === "3") min += 2;
    // the open river keeps its name at any zoom; the rest fade with it (css: .rv-focus)
    const mine = l.river.id === focusId;
    l.lbl.setOpacity(z >= min || mine ? 1 : 0);
    const el = l.lbl.getElement();
    if(el) el.classList.toggle("rv-on", mine);
  });
}
map.on("zoomend", syncLabels);

/* Stacking order. Everything vector used to share Leaflet's default
   overlayPane, where paint order is just DOM order — and because the public
   land layer is cleared and re-added on every map move, its polygons ended
   up drawn ON TOP of the rivers, washing the water out behind a green wash.
   Explicit panes fix the order for good:
     landPane   390  public land, under everything
     riversPane 410  river lines, over the land, under the markers (600)
   The halo on riversPane lives in css/styles.css. */
map.createPane("landPane").style.zIndex = 390;
map.createPane("riversPane").style.zIndex = 410;

/* A river's `coords` is either a single [lat,lng] list or — for rivers
   snapped to real NHD linework — a list of those, one per channel segment.
   Leaflet draws both, but the rest of the app wants a flat point list to
   measure against, so everything that isn't the polyline itself goes
   through here. Keeping the segments separate matters: chaining them into
   one line draws a false channel across every gap between them. */
const isMulti = c => Array.isArray(c[0]) && Array.isArray(c[0][0]);
const flatCoords = c => isMulti(c) ? c.flat() : c;
function midCoord(c){ const f = flatCoords(c); return f[Math.floor(f.length/2)]; }

/* Where a state agency publishes a regulation class for a stream, that class
   drives the line colour instead of the river's own arbitrary hue — on trout
   water the rules you fish under matter more than telling two adjacent creeks
   apart. Currently populated for the Iowa DNR's northeast Driftless streams;
   any river without a troutClass keeps its own colour. */
/* Two states, two vocabularies, deliberately kept apart. Iowa's classes are
   a *regulation* class (what you may do); Wisconsin's I/II/III is a
   *biological* classification (whether the trout reproduce there). Folding
   them into one set of three would have meant labelling a Wisconsin stream
   with an Iowa rule it isn't under. The colours are a family — teal means
   wild fish either way — but the wording is each state's own. */
const TROUT_CLASS = {
  restrictive:{color:"#7b2d8e", label:"Restrictive regulations"},
  wild:       {color:"#0e6f7d", label:"Fingerling / natural reproduction"},
  stocked:    {color:"#a8552a", label:"Catchable stocked"},
  wi1:        {color:"#0e6f7d", label:"Class I — wild, self-sustaining"},
  wi2:        {color:"#5a9ea8", label:"Class II — partial natural reproduction"},
  /* Pennsylvania's four, from the Fish & Boat Commission's own section lines.
     Like Wisconsin's, kept separate from Iowa's: these are the PFBC's
     designations (what the Commission calls each section), and folding them
     into Iowa's regulation classes would put an Iowa label on a PA stream.
     Colours follow the family -- teal wild, rust stocked, purple special --
     and "inland" is a blue-grey that matches no other class. */
  pa_special: {color:"#7b2d8e", label:"Special regulation area"},
  pa_stocked: {color:"#a8552a", label:"Stocked trout water"},
  pa_wild:    {color:"#0e6f7d", label:"Wild trout (natural reproduction)"},
  pa_inland:  {color:"#6b7f8f", label:"Commonwealth inland water"},
  /* New York's, from NYSDEC's Inland Trout Stream Fishing layer: each reach's
     management category (MGMTCAT), as the Categorization of New York State
     Trout Stream Reaches defines them. A management category, not a
     regulation and not a biological class, so it shares no key with Iowa,
     Wisconsin or Pennsylvania. Teal for the wild categories, rust for the
     stocked ones; "Other" is the layer's own word for a reach in none of the
     five. */
  ny_wp:      {color:"#0e6f7d", label:"Wild-Premier — DEC's top wild-trout category"},
  ny_wq:      {color:"#3d8f9b", label:"Wild-Quality — DEC wild-trout water"},
  ny_se:      {color:"#8c4f2b", label:"Stocked-Extended — trout can last into summer"},
  ny_st:      {color:"#a8552a", label:"Stocked — DEC stocked trout water"},
  ny_ot:      {color:"#6d5a8e", label:"Other — not one of DEC's five categories"},
  /* Virginia's three, from the DWR's own trout-water layers (stocked trout
     waters and wild trout streams). Kept apart from Pennsylvania's even
     though the family is the same -- purple special, rust stocked, teal wild --
     because "special regulation" and "wild" mean what the Virginia booklet
     says they mean (catch-and-release, 9-inch, 16-inch/2 fish and the like). */
  va_special: {color:"#7b2d8e", label:"Special regulation trout water"},
  va_stocked: {color:"#a8552a", label:"Designated stocked trout water"},
  va_wild:    {color:"#0e6f7d", label:"Wild trout stream"},
  /* Missouri's, from the Missouri Department of Conservation: the trout-area
     types its 2026 Summary of Fishing Regulations defines (pp. 24-27). Their
     own keys, because a Blue Ribbon area is MDC's term and means what the
     booklet says it means. Colours stay in the family and add no meaning:
     teal for the naturally reproducing Blue Ribbon water, rust for the
     stocked White Ribbon water and Taneycomo, purple for the Red Ribbon
     catch-and-release water, and the brown of New York's extended stocking
     for the daily-stocked trout parks. (There is no key for the Smallmouth
     Bass Special Management Areas: they are not trout water.) */
  mo_park:      {color:"#8c4f2b", label:"Trout Park"},
  mo_blue:      {color:"#0e6f7d", label:"Blue Ribbon Trout Area"},
  mo_white:     {color:"#a8552a", label:"White Ribbon Trout Area"},
  mo_red:       {color:"#7b2d8e", label:"Red Ribbon Trout Area"},
  mo_taneycomo: {color:"#a8552a", label:"Lake Taneycomo"},
};
const TROUT_SOURCE = {
  iadnr:{agency:"Iowa DNR",      what:"trout-stream layer",          regs:"Iowa DNR trout regulations"},
  wdnr: {agency:"Wisconsin DNR", what:"classified trout water layer", regs:"Wisconsin DNR trout regulations"},
  pfbc: {agency:"Pennsylvania Fish &amp; Boat Commission", what:"section lines", regs:"Pennsylvania Fish &amp; Boat Commission regulations",
         url:"https://www.pa.gov/agencies/fishandboat"},
  nydec:{agency:"NYSDEC", what:"Inland Trout Stream Fishing layer", regs:"NYSDEC freshwater fishing regulations",
         url:"https://dec.ny.gov/things-to-do/freshwater-fishing/regulations"},
  vdwr:{agency:"Virginia Department of Wildlife Resources (DWR)", what:"trout-water layers", regs:"Virginia DWR regulations",
         url:"https://dwr.virginia.gov/fishing/regulations/"},
  mdc:{agency:"Missouri Department of Conservation (MDC)", what:"Fishing Atlas trout-stream layer", regs:"Missouri Summary of Fishing Regulations",
         url:"https://mdc.mo.gov/sites/default/files/2026-02/Fishing%20Summ%202026_508.pdf"},
};
function riverColor(r){
  const c = r.troutClass && TROUT_CLASS[r.troutClass];
  return c ? c.color : r.color;
}

/* ---------- river tiers (see js/tiers.js) ----------
   Class 3 is hidden by default: ~480 rivers drawn at once is a map with no
   answer to "where do I start?". Hidden means off the map entirely — not
   dimmed — so it also costs no labels, flow animation or geometry fetches
   (riverVisible() is what the flow and refine loops already ask). */
const TIER_KEYS = ["gold","1","2","3"];
/* Every launch starts on these defaults; the choice is not remembered
   (an old `tierFilter` key left in localStorage is simply never read). */
let tierFilter = {gold:true, "1":true, "2":true, "3":false};
/* ---------- Field Book storage ----------
   One localStorage key, loaded once into memory and written through on every
   change. It lives up here, above tierShown(), because tierShown() asks it
   about favourites during the first applyFilters() at startup — declared
   lower it would still be in its temporal dead zone (same trap as PARK_INFO).
   Every read and write is wrapped: in a private window storage can throw, and
   then the book simply works for the session and is gone on reload. Nothing
   here is ever sent anywhere.

   v2 (2026-10-15): "Fished" is a list of trips, not a flag. `rivers` holds
   favourite / notes / updated per water — rivers by id, lakes as "lake:"+id
   so a lake can never collide with a river of the same id. `trips` holds
   {id, kind:"river"|"lake", water, day:"YYYY-MM-DD", time:"HH:MM"|null,
   src:"tap"|"manual"|"migrated", at, note?}. `at` is the epoch ms of the
   tap and is null for anything else: a later conditions snapshot belongs
   only to a trip logged at the water, never to one typed in afterwards.
   `floats` belongs to float.js and is carried through untouched.

   Part 2 (2026-10-15): a tap trip may carry `cond`, what the app knew at
   the moment of the tap (fbSnapshot), and nothing else ever does:
     cond.wx   = {t, u, ws, wd, sf, s} — the NWS hourly *forecast* period
                 containing `at` (s = its start). A forecast, never a
                 reading, and the Trips list says so.
     cond.flow = {g, cfs, time, st?:{cls,label}, wtF?} — rivers only, the
                 primary gauge's reading if it passes the 24 h rule; `st`
                 only when there was a real status bucket, `wtF` (°F) only
                 for a fresh water temperature. Ungauged → no `flow`.
   An empty `cond` is left off. If the forecast wasn't loaded yet, the tap
   leaves an in-memory pending fill (fbWxPending, never persisted): the next
   forecast fetch for that point fills `cond.wx` only while the trip still
   exists, is still that same tap and is under an hour old. Editing a trip's
   day or time deletes `cond` — no backfilling "now" onto another moment.
   `wtUser` (°F, lakes only) is the user's own typed water temperature. It
   lives on the trip, not in `cond`, because it isn't the app's snapshot and
   is allowed on any trip.

   Part 3a (2026-10-16): a lake trip recorded with Start fishing (laketrip.js)
   is an ordinary tap trip — day, time and `at` from the moment Start was
   tapped, `cond` snapped then — plus `track`:
     {craft, ramp, end, km, movMin, stopMin, segs, tt, stops}
   `segs` is a list of encoded polylines, one per stretch the phone was
   recording (a gap is a new segment, never a join), `tt` the matching list
   of point times in seconds since `at`, delta-encoded the same way, and
   `stops` [{lat, lng, t, min}]. A tracked trip's day and time are the
   recording's own and can't be edited; its note and water temp can. This
   is a real position history, kept on this phone only. */
const FB_KEY = "fieldBook", FB_V1_KEY = "fieldBook_v1";
let fbState = {v:2, rivers:{}, trips:[]};
try{
  const raw = localStorage.getItem(FB_KEY);
  const saved = JSON.parse(raw||"null");
  if(saved && saved.rivers && typeof saved.rivers==="object"){
    if(saved.v===2){ if(!Array.isArray(saved.trips)) saved.trips = []; fbState = saved; }
    else if(saved.v===1) fbState = fbMigrateV1(saved, raw);
  }
  // anything else: start empty, and leave the stored key alone until a write
}catch(e){}
/* v1 → v2. The untouched v1 string is copied aside first (once; it is never
   deleted), then each `fished:true` becomes one trip on its `fishedOn` day.
   v1 never recorded a time, so there is none. Everything else — favourites,
   notes, `updated`, floats — is carried over exactly. */
function fbMigrateV1(saved, raw){
  try{ if(localStorage.getItem(FB_V1_KEY)===null) localStorage.setItem(FB_V1_KEY, raw); }catch(e){}
  const rivers = {}, trips = [];
  for(const [id, e] of Object.entries(saved.rivers)){
    if(!e || typeof e!=="object"){ rivers[id] = e; continue; }
    const {fished, fishedOn, ...rest} = e;
    rivers[id] = rest;
    if(fished===true) trips.push({id:fbNewId(), kind:"river", water:id,
      day:fbValidDay(fishedOn) ? fishedOn : fbToday(), time:null, src:"migrated", at:null});
  }
  const st = Object.assign({}, saved, {v:2, rivers, trips});
  try{ localStorage.setItem(FB_KEY, JSON.stringify(st)); }catch(e){}
  return st;
}
/* Returns whether the write landed. lsSetSafe() first deletes caches to make
   room, so a false here means the phone's storage is full of things that
   aren't caches. Then no caller may say "saved": the change is undone in
   memory, so what the screen shows is what a reload will show, and the user
   is told (fbSaveWarn). A recorded lake trip is the exception — it can't be
   recreated, so it stays live rather than vanish (laketrip.js). */
function fbPersist(){
  try{ return lsSetSafe(FB_KEY, JSON.stringify(fbState)); }
  catch(e){ return false; }
}
const FB_FULL_MSG = "Couldn't save — this phone's storage is full";
let fbWarnAt = 0;
// once per 10 s: typing in a full book shouldn't strobe the toast
function fbSaveWarn(){
  if(Date.now() - fbWarnAt < 10000) return;
  fbWarnAt = Date.now();
  fbToast(FB_FULL_MSG);
}
function fbGet(id){
  const e = fbState.rivers[id];
  return e ? e : {fav:false, notes:"", updated:0};
}
// Returns the saved entry, or null when it couldn't be written (and nothing changed).
function fbSet(id, patch){
  const prev = fbState.rivers[id];
  const e = Object.assign({}, fbGet(id), patch, {updated:Date.now()});
  if(!e.fav && !(e.notes||"").trim()) delete fbState.rivers[id];   // nothing left to keep (trips live apart)
  else fbState.rivers[id] = e;
  if(!fbPersist()){
    if(prev) fbState.rivers[id] = prev; else delete fbState.rivers[id];
    fbSaveWarn();
    return null;
  }
  return e;
}
function fbAll(){ return fbState.rivers; }
function fbIsFav(id){ const e = fbState.rivers[id]; return !!(e && e.fav); }

/* Trips. Newest first by the day and time the user sees; a tie (two taps in
   one minute, or two days with no time) goes to the one logged later. */
function fbNewId(){ return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function fbValidDay(s){
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s||""); if(!m) return false;
  const d = new Date(+m[1], +m[2]-1, +m[3]);
  return d.getFullYear()===+m[1] && d.getMonth()===+m[2]-1 && d.getDate()===+m[3];
}
const fbValidTime = s => /^([01]\d|2[0-3]):[0-5]\d$/.test(s||"");
const fbTripSort = t => t.day + (t.time||"");
function fbTrips(kind, water){
  return fbState.trips.filter(t => t.kind===kind && t.water===water).reverse()
    .sort((a,b) => fbTripSort(b).localeCompare(fbTripSort(a)));
}
function fbAddTrip(kind, water, day, time, src, at, note, wtUser){
  const t = {id:fbNewId(), kind, water, day, time:time||null, src, at:at||null};
  if(note && note.trim()) t.note = note.trim().slice(0, 500);
  if(kind==="lake" && wtUser!=null && isFinite(wtUser)) t.wtUser = wtUser;
  fbState.trips.push(t);
  if(!fbPersist()){                    // not saved, so not logged
    fbState.trips = fbState.trips.filter(x => x !== t);
    fbSaveWarn();
    return null;
  }
  return t;
}
// false when the delete couldn't be written; the trip is then still there
function fbDelTrip(id){
  const before = fbState.trips;
  fbState.trips = before.filter(t => t.id!==id);
  if(fbState.trips.length===before.length) return true;
  if(!fbPersist()){ fbState.trips = before; fbSaveWarn(); return false; }
  return true;
}
/* Only day, time, note and (lakes) the user's water temp can change. Moving a
   trip's day or time makes it a manual entry: whatever was true at the moment
   of the tap no longer describes it, so its conditions snapshot goes too.
   A note or a water temp alone leaves a tap trip a tap trip. A tracked trip
   keeps its day and time whatever the patch says: they are when the track
   was recorded, and its point times count from that moment. */
function fbEditTrip(id, patch){
  const i = fbState.trips.findIndex(x => x.id===id); if(i < 0) return null;
  const t = fbState.trips[i], prev = JSON.parse(JSON.stringify(t));   // to put back if it can't be saved
  if(("day" in patch || "time" in patch) && !t.track){
    const day = "day" in patch ? patch.day : t.day, time = "time" in patch ? (patch.time||null) : t.time;
    if(day!==t.day || time!==t.time){ t.day = day; t.time = time; t.src = "manual"; t.at = null; delete t.cond; }
  }
  if("note" in patch){
    const n = (patch.note||"").trim().slice(0, 500);
    if(n) t.note = n; else delete t.note;
  }
  if("wtUser" in patch && t.kind==="lake"){
    if(patch.wtUser!=null && isFinite(patch.wtUser)) t.wtUser = patch.wtUser; else delete t.wtUser;
  }
  if(!fbPersist()){ fbState.trips[i] = prev; fbSaveWarn(); return false; }   // false: not saved
  return t;
}

const tempShown = new Set();          // hidden rivers opened on purpose (search, gauge tap)
const tierNow = new Map();            // river id → tierOf() for today
function refreshTiers(){ RIVERS.forEach(r => tierNow.set(r.id, tierOf(r))); }
refreshTiers();
/* Is this river's class switched on, and with a species picked, does it
   hold that fish? Ignores where the map is looking — which is what a zone
   card's count wants ("rivers in this park"). */
function tierPicked(r){
  if(tempShown.has(r.id)) return true;
  /* A species pick comes first, and only the river in focus is exempt: a
     favourite without that fish is no answer to "where are they" (see
     SPECIES FILTER above). */
  if(speciesPick && r.id !== focusId && !speciesHas(r.id, speciesPick)) return false;
  const t = tierNow.get(r.id);
  /* A favourite is a persistent tempShown: you starred it, so a class filter
     doesn't get to hide it. */
  return fbIsFav(r.id) || (t ? tierFilter[t.tier] : tierFilter["3"]);
}
/* "All" (the Other class) is some five hundred lines. Drawn at once they are
   seconds of work on a phone and a map of nothing but line, so Other rivers
   are drawn only where the map is looking, from OTHER_MIN_ZOOM in:
   otherInView holds the ones whose bounds meet the (padded) view, and the
   river in focus, so an opened river never vanishes from under its sheet.
   tempShown and favourites are exempt too. Everything that asks tierShown()
   — labels, the current, gauge dots, geometry fetches — follows the gate;
   syncOtherRivers() keeps it current on moveend. */
const OTHER_MIN_ZOOM = 8;            // compare with >= : zoom is fractional
const OTHER_VIEW_PAD = 0.25;
let otherInView = new Set();
const riverBoundsCache = new Map();
function riverBounds(r){
  let b = riverBoundsCache.get(r.id);
  if(!b){ b = L.latLngBounds(flatCoords(r.coords)); riverBoundsCache.set(r.id, b); }
  return b;
}
const isOther = r => { const t = tierNow.get(r.id); return !t || t.tier === "3"; };
function tierShown(r){
  if(!tierPicked(r)) return false;
  if(tempShown.has(r.id) || fbIsFav(r.id) || !isOther(r)) return true;
  return otherInView.has(r.id);
}
const TIER_WEIGHT = {gold:5.5, "1":4.5, "2":3.6, "3":3};
function tierWeight(r){ const t = tierNow.get(r.id); return TIER_WEIGHT[t ? t.tier : "3"]; }

/* Declared here, above the river layers, on purpose: syncLabels() reads it
   on its first call at startup. Declared further down -- next to the sheet
   code that also uses it -- it was still in its temporal dead zone at that
   call, the ReferenceError killed the rest of app.js, and the map came up
   with no chooser and no sheet. */
/* ============================================================
   WESTERN NATIONAL PARKS — per-park sheet copy, as data.

   Yellowstone and Grand Teton each grew their own branch in every function
   that names an authority. Ten more parks would have been ten more branches
   in six places; this table is one place instead, and Yellowstone, Grand
   Teton and the older regions have since moved in too (the block after the
   Wyoming row). Each entry answers the
   questions the sheet asks: what to call the place, whose licence it takes,
   who to check with, the rule summary for the footer, and what to say when
   a creek has no gauge.

   Every regulation line here is from the park's own fishing page, fetched
   2026-10-01. The licence rule is the line that matters most and it differs
   park to park: Olympic, Mount Rainier and Crater Lake need no state licence
   at all; North Cascades needs Washington's; the California parks need
   California's; Glacier needs none on the North Fork from park land but
   Montana's on the Middle Fork. Crediting the wrong one sends someone to
   the wrong counter, or to the river without the licence they need.
   ============================================================ */
const SEKI_FOOTER = `🏔 <b>A California fishing licence is required</b> at 16 and over, and the parks follow California's regulations with one important addition: in waters <b>below 9,000 feet</b> outside developed areas, <b>only barbless artificial flies or lures</b> are allowed, and <b>rainbow trout, Kern rainbow, Sacramento sucker, riffle sculpin and California roach must be released</b>. Most of this water is a long walk from any road — check the parks' current fishing information before you go.`;
const SEKI_UNGAUGED = "There is almost no live gauging inside these two parks — the one active station is on the Marble Fork of the Kaweah near Lodgepole. These are Sierra snowmelt rivers: high and cold into early summer, dropping through late summer and fall.";
const PARK_INFO = {
  olympic: {zone:"olym", sub:" · Olympic National Park", badge:"Olympic · park rules",
    note:`From Olympic National Park's <b>2026</b> fishing regulations. Seasons are set by zone and species and change every year — read the current edition before you fish.`,
    licence:"<b>No Washington licence</b> in the park (Pacific from shore excepted); catch record card for salmon, steelhead",
    regBody:"the National Park Service (no Washington licence inside the park; a catch record card for salmon and steelhead)",
    footer:`🏞 <b>No Washington licence is needed</b> to fish inside Olympic — except in the Pacific from shore. A free <b>catch record card</b> is required for salmon and steelhead. Most fresh water is <b>artificial lures with a barbless single-point hook</b>. <b>All wild fish are released</b> unless a rule specifically allows keeping them, and <b>fishing for bull trout and Dolly Varden is prohibited in all park waters</b>. Two adipose-clipped hatchery steelhead may be kept. The <b>Elwha is closed</b>, the <b>Queets closes October 1 – November 30</b>, and seasons are set by zone — check which zone a river is in before you go.`,
    ungauged:"Olympic's gauges are where the big rivers leave the park, and none is on this one. The nearest gauged river is the useful read: the peninsula's rivers take the same Pacific storms and rise and fall with them."},
  rainier: {zone:"mora", sub:" · Mount Rainier National Park", badge:"Mount Rainier · park rules",
    note:`From Mount Rainier National Park's fishing regulations. Seasons and closures are set by the park — check the current page before you fish.`,
    licence:"<b>No Washington licence</b> in the park; catch record card for salmon and steelhead",
    regBody:"the National Park Service (no Washington licence inside the park; a catch record card for salmon and steelhead)",
    footer:`🏔 <b>No Washington licence is needed</b> inside Mount Rainier, but a <b>catch record card</b> is required for salmon and steelhead. Streams are <b>artificial lures and flies only, single-point barbless hooks</b>, and <b>lead tackle is prohibited</b> parkwide. <b>Every native fish goes back</b>; brook trout and kokanee may be kept, with no minimum size. There are two seasons: the <b>White, Huckleberry, West Fork, Carbon and Mowich</b> open the first Saturday in June and close on <b>Labor Day</b>, while the <b>Puyallup, Nisqually, Cowlitz and Ohanapecosh</b> watersheds stay open to <b>October 31</b>. Klickitat, Ipsut, Laughingwater, Edith and Fryingpan Creeks are closed above their water supplies.`,
    ungauged:"No live gauge on this one. Several of Mount Rainier's rivers are glacier-fed and run highest and greyest on hot summer afternoons rather than in spring — the nearest gauged river is the useful read, and a cool morning is the window."},
  northcascades: {zone:"noca", sub:" · North Cascades National Park Complex", badge:"North Cascades · Washington regs",
    note:`From the North Cascades park complex's fishing information, which follows <b>Washington Department of Fish &amp; Wildlife</b> regulations. Licences are not sold in the park — buy one before you go.`,
    licence:"<b>Washington licence</b> — not sold at park facilities, buy one before you go",
    regBody:"WDFW and the park — North Cascades takes a <b>Washington licence</b>, unlike Olympic and Mount Rainier",
    footer:`🏔 <b>North Cascades is fished on a Washington licence</b> under WDFW regulations — and licences are not sold at park facilities. The park adds its own rules: hook and line only with the rod attended, <b>no bait fish or amphibians</b> except in designated waters, and no chumming. <b>Ruby Creek is closed</b> from the Ross Lake markers to its headwaters, and <b>Big Beaver Creek</b> is closed for its first quarter mile above Ross Lake. The Stehekin and the Skagit run through the complex's two <b>National Recreation Areas</b> — Lake Chelan and Ross Lake — rather than the national park itself.`,
    ungauged:"No live gauge on this one, though the park complex is better gauged than most — Thunder, Big Beaver and Ruby Creeks, the Skagit at Newhalem and the Stehekin all report. Its east side drains to Lake Chelan and the west to the Skagit; the nearest gauged water on the same side of the crest is the read to trust."},
  craterlake: {zone:"crla", sub:" · Crater Lake National Park", badge:"Crater Lake · park rules",
    note:`From Crater Lake National Park's fishing information. Check the current page before you fish.`,
    licence:"<b>No fishing licence</b> needed anywhere inside the park",
    regBody:"the National Park Service (no licence is required inside the park)",
    footer:`🌋 <b>No fishing licence is needed</b> anywhere inside Crater Lake National Park. <b>Artificial lures only</b> — organic bait of any kind, worms included, is prohibited. There are <b>no size or catch limits</b> on rainbow trout or kokanee from the lake, or on brook and brown trout from the streams. <b>Sun Creek and Lost Creek are closed</b> to protect bull trout, and any bull trout caught elsewhere goes straight back. At the lake, fishing is not allowed within 200 feet of the Cleetwood Cove boat docks.`,
    ungauged:"There is <b>no live gauge on any Crater Lake stream</b>, and nothing close enough to borrow — the gauges nearby are on the Rogue and the Wood River, outside the park and on different water. These are short, cold creeks off the caldera: judge them on the water."},
  glacier: {zone:"glac", sub:" · Glacier National Park", badge:"Glacier · park rules",
    note:`From Glacier National Park's fishing regulations. Closures and spawning-season rules move year to year — read the current page before you fish.`,
    licence:"<b>North Fork</b> from park land: no Montana licence. <b>Middle Fork</b>: Montana licence",
    regBody:"the National Park Service — and Montana FWP on the Middle Fork, which takes a Montana licence",
    footer:`🏔 <b>Glacier sets its own rules.</b> Streams are open the <b>third Saturday in May through November 30</b>; lakes are open all year. <b>Artificial flies and lures only</b> — bait is allowed only in the Two Medicine drainage above Running Eagle Falls and in the Many Glacier valley above the Swiftcurrent Lake outlet. <b>No felt-soled wading boots</b>, <b>no lead</b>, and no treble hooks on the North or Middle Fork. <b>No bull trout may be kept</b>, and <b>all native fish must be released</b>. On the <b>North Fork</b>, fishing from park land needs <b>no Montana licence</b>; on the <b>Middle Fork</b> a Montana licence is required and state rules apply. A long list of creeks is <b>closed for its entire length</b> — Ole, Park, Muir, Coal, Nyack, Fish, Lee, Otatso, Boulder and Kennedy among them — so check the park's list before you fish anything small.`,
    ungauged:"No live gauge on this one. Glacier's gauges are on the North and Middle Forks of the Flathead, the St. Mary and Swiftcurrent Creek; on this side of the divide, the nearest of those is the useful read."},
  redwood: {zone:"redw", sub:" · Redwood National & State Parks", badge:"Redwood · California regs",
    note:`Redwood National and State Parks follow <b>California Department of Fish &amp; Wildlife</b> regulations, which vary by species and location — open seasons, bag and possession limits, and fishing hours. CDFW: 707-445-6493.`,
    licence:"<b>California fishing licence</b>, required anywhere in the parks",
    regBody:"the California Department of Fish &amp; Wildlife (a California licence is required)",
    footer:`🌲 <b>A California fishing licence is required</b> to fish anywhere in the parks, and the rules are the state's: <b>open seasons, daily bag and possession limits, and fishing hours all vary by species and by river</b>. The park's own guidance is to check with the California Department of Fish &amp; Wildlife — 707-445-6493 — before you fish.`,
    ungauged:"No live gauge on this creek — the park's gauges are on Redwood Creek at Orick and on the Smith. These are coastal streams that rise and fall with rain off the Pacific; the nearest gauged river is the read on whether a storm has the region blown out."},
  lassen: {zone:"lavo", sub:" · Lassen Volcanic National Park", badge:"Lassen · California regs",
    note:`From Lassen Volcanic National Park's fishing information; California state regulations apply otherwise.`,
    licence:"<b>California fishing licence</b>, required in the park",
    regBody:"the California Department of Fish &amp; Wildlife and the park (a California licence is required)",
    footer:`🌋 <b>A California fishing licence is required</b> in the park. <b>Manzanita Lake is catch-and-release only</b>, with a single barbless hook and lures or flies — no bait of any kind. Fishing is not permitted at the Manzanita, Butte or Juniper Lake boat launches, and <b>Juniper Lake holds no game fish</b>.`,
    ungauged:"There is no live gauge on Lassen's streams. These are small snowmelt and spring creeks high on a volcano — judge them on the water."},
  yosemite: {zone:"yose", sub:" · Yosemite National Park", badge:"Yosemite · park rules",
    note:`From Yosemite National Park's fishing regulations — several changed in <b>2026</b>, including year-round seasons on the Merced and Tuolumne. Check the current page before you fish.`,
    licence:"<b>California fishing licence</b>, required at 16 and over",
    regBody:"the park and CDFW (a California licence is required)",
    footer:`🏞 <b>A California fishing licence is required</b> at 16 and over. <b>All park waters are open year-round</b>, and <b>live, dead or scented bait is prohibited</b> everywhere. On the <b>Merced, the South Fork Merced and the Tuolumne</b>: artificial lures or flies with <b>barbless hooks</b> only, <b>rainbow trout are catch-and-release</b>, and brown and brook trout are five a day and ten in possession. Elsewhere the limit is five trout a day and ten in possession. Adair and Hanging Basket Lakes are catch-and-release only.`,
    ungauged:"No live gauge on this one — Yosemite's are on the Merced in the valley and the Tuolumne above Hetch Hetchy. This is Sierra snowmelt water: high and cold in late spring and early summer, dropping through late summer."},
  kingscanyon: {zone:"kica", sub:" · Kings Canyon National Park", badge:"Sequoia & Kings Canyon · park rules",
    note:`From Sequoia and Kings Canyon National Parks' fishing information; the parks otherwise conform to California state regulations.`,
    licence:"<b>California fishing licence</b>, required at 16 and over",
    regBody:"the parks and CDFW (a California licence is required)", footer:SEKI_FOOTER, ungauged:SEKI_UNGAUGED},
  sequoia: {zone:"sequ", sub:" · Sequoia National Park", badge:"Sequoia & Kings Canyon · park rules",
    note:`From Sequoia and Kings Canyon National Parks' fishing information; the parks otherwise conform to California state regulations.`,
    licence:"<b>California fishing licence</b>, required at 16 and over",
    regBody:"the parks and CDFW (a California licence is required)", footer:SEKI_FOOTER, ungauged:SEKI_UNGAUGED},
};
/* The four western states fished under their own agencies' rules. Same table
   shape as the parks, so every place the sheet names an authority answers
   from one row: the river's own regulation entry comes from the state's 2026
   booklet verbatim (see parkRegs on each river), and these rows supply the
   badge, the source note, the licence footer and who to check with. */
/* Colorado and Utah, and their parks. Rocky Mountain, Black Canyon and Great
   Sand Dunes all take a Colorado licence; Capitol Reef, Zion and Canyonlands a
   Utah one -- the parks add their own rules on top, and Rocky Mountain's are
   the stricter ones (catch-and-release and closed waters by name). */
Object.assign(PARK_INFO, {
  colorado: {zone:"co", sub:"", heading:"Regulations", labelZoom:8, badge:"CPW · 2026",
    note:`From Colorado Parks &amp; Wildlife's <b>2026 Colorado Fishing</b> brochure — this water's own entry in <i>Special Regulations: Fishing Waters</i>, then the statewide limits. If a water isn't on that list, the statewide regulations apply. The brochure's online version is the most current.`,
    licence:"<b>Colorado fishing licence</b>, required at 16 and older",
    regBody:"Colorado Parks &amp; Wildlife",
    footer:`🎣 <b>Colorado</b>: a fishing licence is required at 16 and older, and the licence year runs <b>March 1 to March 31</b> of the following year. Statewide, trout are <b>4 a day and 8 in possession</b>, with 10 extra brook trout of 8 inches or less. <b>Greenback cutthroat trout may not be taken.</b> A <b>Gold Medal</b> water — marked on the river's own entry — is CPW's designation for the best trout water in the state, and not every Gold Medal water carries special regulations. The brochure's own warning: <i>it is illegal to go onto private land to fish</i>.`,
    ungauged:"No live gauge on this river — neither USGS nor Colorado's Division of Water Resources reports discharge on it. The nearest gauged river is the regional read — snowmelt drives all of it, peaking in late May and June."},
  utah: {zone:"ut", sub:"", heading:"Regulations", labelZoom:8, badge:"Utah DWR · 2026",
    note:`From the Utah Division of Wildlife Resources' <b>2026 Utah Fishing Guidebook</b> — this water's own entry in <i>Rules for specific waters</i>, which takes precedence over the general rules. Emergency changes are posted at wildlife.utah.gov.`,
    licence:"<b>Utah fishing licence</b>, required at 12 and older",
    regBody:"the Utah Division of Wildlife Resources",
    footer:`🎣 <b>Utah</b>: a licence is required at 12 and older — younger anglers may fish without one and take a full limit. The general season is <b>January 1 through December 31</b>, 24 hours a day. The general limit is <b>4 trout</b> (trout, kokanee and Arctic grayling combined), and you may not possess kokanee anywhere from September 10 through November 30. A water's own rules take precedence, and many of the best are artificial-flies-and-lures-only with slot limits.`,
    ungauged:"No live gauge on this river. The nearest gauged water in Utah is the read on regional conditions; most of these rivers run on Wasatch and Uinta snowmelt, and the tailwaters on what the dam releases."},
  rockymountain: {zone:"romo", sub:" · Rocky Mountain National Park", badge:"Rocky Mountain · park rules",
    note:`From Rocky Mountain National Park's fishing regulations — a Colorado licence, under the park's own rules on tackle, possession and its catch-and-release and closed waters. Check the current page before you fish.`,
    licence:"<b>Colorado fishing licence</b>, 16 and older; Second Rod Stamp not honored",
    regBody:"the National Park Service (a Colorado licence is required)",
    footer:`🏔 <b>A Colorado fishing licence is required</b> at 16 and older, and a Second Rod Stamp is not honored. <b>Only artificial flies or lures with one hook</b> — children 12 and under may use worms or preserved eggs outside catch-and-release water. <b>Greenback cutthroat trout must go back</b>, parkwide. Possession is capped at 18 trout, no more than 2 of them anything but brook trout. The park names its <b>catch-and-release</b> waters (barbless, no bait) and its <b>closed</b> waters — Bear Lake, Hague Creek above the Mummy Pass junction, the South Fork Poudre above Pingree Park and Columbine Creek above 9,000 feet among them.`,
    ungauged:"No live gauge on this one. The park's only USGS gauge is on the Big Thompson at Moraine Park; east and west of the divide run on different snowpacks, so read the nearest gauge on the same side."},
  blackcanyon: {zone:"blca", sub:" · Black Canyon of the Gunnison National Park", badge:"Black Canyon · park rules",
    note:`From Black Canyon of the Gunnison National Park's fishing page, which follows Colorado regulations with its own tackle and limit rules.`,
    licence:"<b>Colorado fishing licence</b> required",
    regBody:"the National Park Service (a Colorado licence is required)",
    footer:`🏞 <b>A Colorado fishing licence is required.</b> Artificial flies or lures only, no bait. <b>Every rainbow trout goes back</b>; brown trout are 4 a day, 8 in possession. The river inside the park is <b>Gold Medal &amp; Wild Trout Water</b>. Inner-canyon routes need a wilderness permit (day use from East Portal does not), and vehicles over 22 feet are prohibited on the East Portal Road.`,
    ungauged:"No live gauge inside the canyon — the release from Crystal Dam is what sets the flow."},
  sanddunes: {zone:"grsa", sub:" · Great Sand Dunes National Park & Preserve", badge:"Great Sand Dunes · Colorado regs",
    note:`From Great Sand Dunes National Park &amp; Preserve's fishing page, which follows the State of Colorado's licence requirements and regulations.`,
    licence:"<b>Colorado licence</b>, under state regulations",
    regBody:"the park and Colorado Parks &amp; Wildlife (a Colorado licence is required)",
    footer:`🏜 Fished on a <b>Colorado licence</b> under state regulations, in the <b>Medano and Sand Creek drainages</b>. <b>Rio Grande cutthroat trout are catch and release only.</b> Hook and line only with the rod attended; no bait fish and no chumming.`,
    ungauged:"No live gauge here. Medano Creek is a snowmelt creek off the Sangre de Cristo whose flow across the dunefield peaks in late May and June."},
  capitolreef: {zone:"care", sub:" · Capitol Reef National Park", badge:"Capitol Reef · Utah regs",
    note:`From Capitol Reef National Park's fish page; the park adopts Utah's non-conflicting fishing regulations.`,
    licence:"<b>Utah licence</b>, under Utah's regulations",
    regBody:"the Utah Division of Wildlife Resources (a Utah licence is required)",
    footer:`🏜 Fished under <b>Utah's regulations</b> on a Utah licence. The Fremont gorge above Fruita holds brown trout; below Fruita there is no sport fishery.`,
    ungauged:"No live gauge inside the park. The Fremont is gauged near Bicknell, upstream; a summer thunderstorm can blow these canyons out in an hour."},
  zion: {zone:"zion", sub:" · Zion National Park", badge:"Zion · Utah regs",
    note:`From Zion National Park's fish page — a Utah licence is required for everyone 12 or older.`,
    licence:"<b>Utah fishing licence</b>, required for everyone 12 or older",
    regBody:"the Utah Division of Wildlife Resources (a Utah licence is required)",
    footer:`🏜 <b>A Utah fishing licence is required</b> for everyone 12 or older. The park says plainly that fishing is far more productive at nearby reservoirs than in the park, and that its four native fish — Virgin spinedace, desert sucker, flannelmouth sucker and speckled dace — are under conservation agreements.`,
    ungauged:"No live gauge here worth borrowing. Flash floods, not snowmelt, are what decide a day in Zion's canyons — check the park's flash-flood forecast."},
  canyonlands: {zone:"cany", sub:" · Canyonlands National Park", badge:"Canyonlands · Utah regs",
    note:`From Canyonlands National Park: a valid Utah licence and Utah's fishing regulations.`,
    licence:"<b>Utah fishing licence</b> and Utah's regulations",
    regBody:"the Utah Division of Wildlife Resources (a Utah licence is required)",
    footer:`🏜 <b>A Utah fishing licence</b> and Utah's regulations. A backcountry trip on the Green or Colorado inside the park needs a river permit from Recreation.gov. This is big warm desert river, not trout water, and the endangered native fish here must be released immediately.`,
    ungauged:"No gauge inside the park. The Green is gauged at Green River, Utah, and the Colorado near Cisco — both upstream."},
});

/* Alaska and its parks. Every Alaska park is fished on an Alaska licence under
   ADF&G's rules -- except Denali's old Mount McKinley park, which needs none --
   and the Park Service adds its own on top: Brooks River is fly-fishing-only
   and catch-and-release above the bridge, and bears set the distance. */
Object.assign(PARK_INFO, {
  alaska: {zone:"ak", sub:"", heading:"Regulations", labelZoom:8, badge:"ADF&G · 2026",
    note:`From the Alaska Department of Fish &amp; Game's <b>2026 sport fishing regulation summaries</b> — this water's own entry, then the area's general regulations. <b>Emergency orders</b> change Alaska's rules in-season, often for king salmon: check www.adfg.alaska.gov/sf/EONR before you cast.`,
    licence:"<b>Alaska sport fishing licence</b> (resident 18+, nonresident 16+); king salmon stamp",
    regBody:"the Alaska Department of Fish &amp; Game",
    footer:`🎣 <b>Alaska</b>: an Alaska sport fishing licence is required for resident anglers <b>18 and older</b> and nonresident anglers <b>16 and older</b>, in your possession, paper or electronic. King salmon need a <b>king salmon stamp</b> as well, and some harvests must be recorded on the licence as you take them. Rules are set by region and area — Southcentral, Southwest, Southeast and Northern — and by drainage within each, with dates that open and close by species. The 2026 booklets already carry <b>king salmon closures by emergency order</b> — the Susitna drainage, the Karluk and the Ayakulik among them.`,
    ungauged:"No live gauge on this river. Alaska's gauges are few and far apart; the nearest one is a read on whether rain or glacier melt has the region high, not on this water."},
  katmai: {zone:"katm", sub:" · Katmai National Park & Preserve", badge:"Katmai · Alaska regs + park rules",
    note:`From Katmai National Park &amp; Preserve's fishing pages, which follow Alaska's regulations and add the park's own — on the Brooks River above all.`,
    licence:"<b>Alaska sport fishing licence</b> required",
    regBody:"ADF&amp;G and the National Park Service (an Alaska licence is required)",
    footer:`🐻 <b>An Alaska sport fishing licence</b> is required, and fishing falls under ADF&amp;G's Bristol Bay, Kodiak/Aleutian and Lower Cook Inlet areas. <b>Keep 50 yards from every bear, and stop fishing when one is within 50 yards</b> — at Brooks no lure may stay in the water. The <b>Brooks River is fly fishing only and catch-and-release above the bridge</b>, no rainbow trout may be kept there, and permits are needed in the Brooks River corridor June 15 – October 31.`,
    ungauged:"No live gauge in the park. These are lake-fed rivers, steadier than most — the lakes buffer them."},
  lakeclark: {zone:"lacl", sub:" · Lake Clark National Park & Preserve", badge:"Lake Clark · Alaska regs",
    note:`From Lake Clark National Park &amp; Preserve's fishing page: Alaska licences and tags, under State of Alaska regulations.`,
    licence:"<b>Alaska licence and tags</b>, under State of Alaska regulations",
    regBody:"ADF&amp;G (an Alaska licence is required)",
    footer:`🏔 <b>Alaska licences and tags</b> and the <b>State of Alaska's regulations</b> — the park and the state manage the fish together. Most of this water is in ADF&amp;G's Bristol Bay area.`,
    ungauged:"No live gauge in the park. Fly-in water: the lake levels and the weather decide the day more than any gauge could."},
  denali: {zone:"dena", sub:" · Denali National Park & Preserve", badge:"Denali · park rules",
    note:`From Denali National Park &amp; Preserve's fishing page. The old park and the newer additions run under different rules.`,
    licence:"<b>No licence</b> in the former Mount McKinley park; <b>Alaska licence</b> in the additions and preserve",
    regBody:"the National Park Service — and ADF&amp;G in the park additions and preserve",
    footer:`🏔 In the <b>former Mount McKinley National Park no licence is required</b>, and the limit is 10 fish, not to exceed 10 lbs and one fish (lake trout 2, including those hooked and released). In the <b>park additions and preserve</b> an Alaska licence is required and state rules apply. Hook and line only, no bait of any kind, no chumming; lead tackle is discouraged.`,
    ungauged:"No live gauge on this one. Many of Denali's rivers are glacial — highest and muddiest on warm afternoons."},
  wrangell: {zone:"wrst", sub:" · Wrangell-St. Elias National Park & Preserve", badge:"Wrangell-St. Elias · Alaska regs",
    note:`From Wrangell-St. Elias National Park &amp; Preserve's fishing page: an Alaska licence, under ADF&amp;G's Upper Copper–Upper Susitna and Yakutat area regulations.`,
    licence:"<b>Alaska fishing licence</b>, though exceptions may apply",
    regBody:"ADF&amp;G (an Alaska licence is required, though exceptions may apply)",
    footer:`🏔 A valid <b>Alaska fishing licence</b> is required, though exceptions may apply; anglers under 18 (16 for nonresidents) don't need one but must record harvest. Limits vary by species and area under ADF&amp;G's <b>Upper Copper–Upper Susitna</b> and <b>Yakutat</b> management areas.`,
    ungauged:"No live gauge on this one. Most of the park's rivers are glacial; clearwater creeks and lakes are where the fishing is."},
  gatesarctic: {zone:"gaar", sub:" · Gates of the Arctic National Park & Preserve", badge:"Gates of the Arctic · Alaska regs",
    note:`From Gates of the Arctic National Park &amp; Preserve's fishing page: 36 CFR 2.3 and State of Alaska regulations where they don't conflict.`,
    licence:"<b>State of Alaska fishing licence</b> required",
    regBody:"the National Park Service and ADF&amp;G (an Alaska licence is required)",
    footer:`🏔 A <b>State of Alaska fishing licence</b> is required — available in Fairbanks, Bettles, Coldfoot or online. <b>Hook and line only</b>; live bait and dead minnows are prohibited.`,
    ungauged:"No live gauge in the park — this is roadless Arctic water reached by floatplane."},
  kobukvalley: {zone:"kova", sub:" · Kobuk Valley National Park", badge:"Kobuk Valley · Alaska regs",
    note:`From Kobuk Valley National Park's fishing page: an Alaska licence and Alaska's regulations.`,
    licence:"<b>Alaska state fishing licence</b> required",
    regBody:"ADF&amp;G (an Alaska licence is required)",
    footer:`🏜 An <b>Alaska state fishing licence</b> is required — available in Kotzebue or online — and Alaska's regulations apply.`,
    ungauged:"No live gauge in the park."},
  glacierbay: {zone:"glba", sub:" · Glacier Bay National Park & Preserve", badge:"Glacier Bay · Alaska regs + park rules",
    note:`From Glacier Bay National Park &amp; Preserve's sport fishing regulations, which add NPS freshwater rules to ADF&amp;G's.`,
    licence:"<b>Alaska sportfishing licence</b>: nonresidents 16+, residents 18–59",
    regBody:"ADF&amp;G and the National Park Service (an Alaska licence is required)",
    footer:`🏔 An <b>Alaska sportfishing licence</b> is required for nonresidents 16 and older and Alaska residents 18–59. In fresh water the park allows <b>hook and line only</b>, with no bait, no unpreserved eggs or roe and no chumming. On the <b>Bartlett River</b>, harvested fish must stay within six feet of you and be packed out whole. Travel on the Alsek needs a park river permit.`,
    ungauged:"No live gauge in the park."},
  kenaifjords: {zone:"kefj", sub:" · Kenai Fjords National Park", badge:"Kenai Fjords · Alaska regs",
    note:`From Kenai Fjords National Park's fishing page: state regulations and an Alaska licence.`,
    licence:"<b>Alaska licence</b>, per state regulations",
    regBody:"ADF&amp;G (an Alaska licence is required)",
    footer:`🌊 Fished <b>per state regulations</b> on an Alaska licence. The park's fishing is mostly salt water; in the backcountry, salmon and Dolly Varden.`,
    ungauged:"No live gauge in the park."},
});

/* Wisconsin's South Shore and central sands: WDNR trout-regulation reaches,
   with each reach's own rule text from the department's layer. */
Object.assign(PARK_INFO, {
  wisouthshore: {zone:"wi", sub:" · South Shore", heading:"Regulations", labelZoom:10, badge:"WDNR trout regulations",
    note:`From the Wisconsin DNR's trout regulations map — each reach's category, season, bag and gear rule, in the department's own words. Reach boundaries move; check the map before you fish.`,
    licence:"<b>Wisconsin licence + Inland Trout Stamp</b> (Great Lakes Salmon &amp; Trout Stamp below the first barrier)",
    regBody:"the Wisconsin DNR",
    footer:`🎣 <b>Wisconsin</b>: a fishing licence and an <b>Inland Trout Stamp</b> (or a Great Lakes Salmon &amp; Trout Stamp on Lake Superior tributaries below the first barrier). The lower reaches here are <b>Great Lakes tributary</b> water — a different season and bag from the inland water upstream — and the <b>Bad River's lower reach runs through the Bad River Reservation</b>, under tribal jurisdiction.`,
    ungauged:"No live gauge on this stream. The South Shore streams rise and fall with rain and snowmelt off the clay hills; the nearest gauged one is the read on whether they're running high and red."},
  wicentralsands: {zone:"wi", sub:" · Central Sands", heading:"Regulations", labelZoom:10, badge:"WDNR trout regulations",
    note:`From the Wisconsin DNR's trout regulations map — each reach's category, season, bag and gear rule, in the department's own words.`,
    licence:"<b>Wisconsin licence + Inland Trout Stamp</b>",
    regBody:"the Wisconsin DNR",
    footer:`🎣 <b>Wisconsin</b>: a fishing licence and an <b>Inland Trout Stamp</b>. The general inland season opens the first Saturday in April and runs to October 15, with a catch-and-release, artificial-lures-only early season from the first Saturday in January. These are spring-fed sand-country streams — steady, cold and clear — and much of the water is on state fishery areas.`,
    ungauged:"No live gauge on this stream. Central sands streams are groundwater-fed and change slowly; the nearest gauged one is a fair read."},
});

/* Idaho as a state row -- used by Henrys Lake. Idaho's rivers carry no
   regulation text (the original western set), so only still water reads it. */
Object.assign(PARK_INFO, {
  idaho: {zone:"id", sub:"", heading:"Regulations", labelZoom:8, badge:"IDFG · 2025–27",
    note:`From Idaho Fish and Game's <b>2025–2027 Fishing Seasons &amp; Rules</b> (2nd edition) — the water's own special rule in the Upper Snake Region.`,
    licence:"<b>Idaho fishing licence</b>, required at 14 and older",
    regBody:"Idaho Fish and Game",
    footer:`🎣 <b>Idaho</b>: any person 14 years of age or older must buy a fishing licence. Rules are set by region; a water's special rule replaces the regional general rule for the items it lists.`,
    ungauged:"No live gauge on this water."},
});
/* Iowa as a state row -- used by the central Iowa lakes (Big Creek, Saylorville)
   through their `park` field. Iowa's rivers never reach it: their region is
   "driftless" or none, and they name their agency through stateLicence() and
   regBodyFor(). No `zone`, unlike Idaho's: refreshZoneCounts() would build an
   "ia" set of rivers whose region is "iowa", which is none of them. `sub` is
   "" so lakePlace() reads "Iowa · lake". Every licence word is quoted from the
   2026 booklet, page given. */
Object.assign(PARK_INFO, {
  iowa: {sub:"", heading:"Regulations", badge:"Iowa DNR · 2026",
    note:`From the Iowa DNR's <b>2026 Iowa Fishing Regulations</b>: every rule in the booklet that names this water, then the statewide limits it falls back to, word for word. Read the current booklet and the signs at the access before you fish.`,
    lakeNote:`From the Iowa DNR's <b>2026 Iowa Fishing Regulations</b>: the rules that name this lake, then the statewide limits for the fish the DNR lists here, word for word. Read the current booklet and the signs at the access before you fish.`,
    licence:`<b>Iowa fishing licence</b> — “Iowa residents and nonresidents 16 years and older must have a valid fishing license on their person while fishing, and have paid all applicable fees.” (p. 3)`,
    regBody:"the Iowa DNR",
    footer:`🎣 <b>Iowa</b>, from the 2026 booklet: “Iowa residents and nonresidents 16 years and older must have a valid fishing license on their person while fishing, and have paid all applicable fees.” (p. 3) “When fishing by hook-and-line, you cannot use more than two lines or more than two hooks on each line when still fishing or trolling.” “You can use a third line if you have a valid third line fishing permit.” (p. 6) “You cannot possess live Gizzard Shad at any lake.” (p. 5)`},
});

/* Pennsylvania: the Fish & Boat Commission's own section lines (geom "pfbc").
   No `zone` -- zones are states and PA has none yet, and a `zone` would make
   refreshZoneCounts() build an empty set. Every licence word below is from
   the 2026 Pennsylvania Fishing Summary, page given. */
Object.assign(PARK_INFO, {
  pennsylvania: {sub:"", heading:"Regulations", labelZoom:8, badge:"PFBC · 2026",
    note:`From the <b>2026 Pennsylvania Fishing Summary</b> (Pennsylvania Fish &amp; Boat Commission): the water's own special-regulation entries in the Commission's words, with the booklet's page cites, then the statewide rule they fall back to.`,
    licence:"<b>Pennsylvania fishing licence</b> (age 16 and over) <b>+ trout permit</b> to fish for trout",
    regBody:"the Pennsylvania Fish &amp; Boat Commission",
    footer:`🎣 <b>Pennsylvania</b>: a current fishing license is required of persons age 16 and over (Summary, p. 4), and <b>a current Pennsylvania trout permit is required to fish for trout</b> in Pennsylvania waters &mdash; that includes special-regulation water, Class A Wild Trout Waters and, February 16 through May 31, stocked trout waters (p. 5). Lake Erie and its listed tributaries need a Lake Erie permit as well.`,
    ungauged:"No live gauge on this water. Judge clarity and level on arrival."},
});
/* New York: NYSDEC's Inland Trout Stream Fishing reaches (geom "nydec"). The
   sheet looks a row up by r.region, so the four New York regions each need
   one, but only `sub` differs -- the rest is one shared body. No `zone`: the
   state zone "ny" is counted by state, and a `zone` here would build a set of
   rivers whose region matches none. Every
   word below is from the 2026 New York State Freshwater Fishing Regulations
   Guide, page given. The guide names no trout stamp, so none is claimed. The
   statewide trout row (p. 4, footnote p. 5) excludes the Great Lakes
   tributaries, which is why the Ontario streams' own entries matter more. */
(function(){
  const body = {heading:"Regulations", labelZoom:8, badge:"NYSDEC · 2026",
    note:`From the <b>2026 New York State Freshwater Fishing Regulations Guide</b> (NYSDEC; in effect April 1, 2026): the stream's own Inland Trout Stream Special Regulations entries in DEC's words, with the guide's page cites, then DEC's management category and harvest or catch-and-release rule for each mapped reach.`,
    licence:`<b>New York fishing licence</b> — “Everyone must have a valid fishing license in their possession while fishing or helping someone to fish” except persons under 16 and a few listed cases. (p. 89)`,
    regBody:"NYSDEC",
    footer:`🎣 <b>New York</b>, from the 2026 guide: a fishing licence is required of everyone 16 and over (p. 89), and “No license or stamp authorizes the holder to trespass upon private lands or waters” (p. 90). Statewide on Inland Trout Streams, April 1–Oct 15 the limit is 5 trout with only 2 longer than 12 inches, and Oct 16–Mar 31 is catch and release, artificial lures only (p. 4). Great Lakes and Finger Lakes tributaries below their first barrier are not Inland Trout Streams (p. 5), and special regulations for the water you are on come first.`,
    ungauged:"No live gauge on this water. Judge clarity and level on arrival."};
  const subs = {nycatskills:" · Catskills", nyadirondacks:" · Adirondacks", nyontario:" · Lake Ontario tributaries", nycentral:" · Central and Western"};
  for(const k in subs) PARK_INFO[k] = Object.assign({sub:subs[k]}, body);
  // reached only through REGS_SRC_ROW (parkRegsSrc "nydec"); no river carries region "newyork"
  PARK_INFO.newyork = Object.assign({sub:""}, body);
})();
/* Virginia: the DWR's own stocked- and wild-trout layers (geom "vdwr") for the
   trout streams, and OSM channel for the big float rivers; all of it region
   "virginia", so every Virginia river reads this row. No `zone`: Virginia is
   counted by state, and a `zone` would make refreshZoneCounts() build an empty
   set. Every licence word is from the 2026 Freshwater Fishing & Boating in
   Virginia booklet, printed page given. The booklet says nothing about wading
   or the streambed, so none is claimed. */
Object.assign(PARK_INFO, {
  virginia: {sub:"", heading:"Regulations", labelZoom:8, badge:"Virginia DWR · 2026",
    note:`From the <b>2026 Freshwater Fishing &amp; Boating in Virginia</b> booklet (Virginia Department of Wildlife Resources): the water's own entries in the Department's words, with the booklet's page cites, then the rules they fall back to.`,
    licence:"<b>Virginia freshwater fishing licence</b> (age 16 and over); a <b>trout licence</b> as well in designated stocked trout waters, Oct 1–Jun 15",
    regBody:"the Virginia Department of Wildlife Resources",
    footer:`🎣 <b>Virginia</b>, from the 2026 booklet: a resident or nonresident freshwater fishing licence is required at age 16 and older (p. 10). “A valid trout license (annual or lifetime) is required in addition to other resident licenses only if you are fishing in designated stocked trout waters (October 1–June 15)” (p. 10), and “from June 16 through September 30 anglers can fish in stocked trout waters without a trout license” (p. 29). “Fishing in wild trout and most special regulation waters? Some require a signed landowner permit card” (p. 29). A National Forest Permit is also required on National Forest lands, with the exceptions listed (p. 12). “Any person who fishes on another’s property must have the landowner’s permission to do so except on designated stocked trout waters along which signs have been placed indicating that the waters are open to public fishing” (p. 14).`,
    ungauged:"No live gauge on this water. Judge clarity and level on arrival."},
});
/* Maine: the 2026 Maine Fishing Laws booklet (MDIFW), whose own entries are
   quoted on each river (OSM/NHD channel, region "maine"). No `zone`: Maine is
   counted by state, and a `zone` would make refreshZoneCounts() build an empty
   set. Every licence and season word is the booklet's, with its page; the
   booklet says no stamp or extra trout permit, and names no stream-access
   rule, so none is claimed. "Not valid after December 31, 2026". */
Object.assign(PARK_INFO, {
  maine: {sub:"", heading:"Regulations", labelZoom:8, badge:"Maine IFW · 2026",
    note:`From the <b>2026 Maine Fishing Laws</b> booklet (Maine Department of Inland Fisheries and Wildlife; “not valid after December 31, 2026”): the river's own entries in the Department's words, with the booklet's page cites, then the North or South Zone rule they fall back to. The booklet sets the zones by county; where a river crosses the line, both rules are shown.`,
    licence:"<b>Maine fishing licence</b> (age 16 and over); the booklet names no stamp or extra trout permit",
    regBody:"the Maine Department of Inland Fisheries and Wildlife",
    footer:`🎣 <b>Maine</b>, from the 2026 booklet: “A valid Maine fishing license is required for anyone 16 years of age or older to fish in inland waters or transport fish taken from inland waters” (p. 51). Free Fishing Days are February 14–15 and May 30–31, 2026, when anyone may fish without a license and all other laws still apply (p. 2). The booklet names no stamp or extra permit for trout or salmon. Unless a river's own entry says otherwise, rivers are open April 1–August 15, then <b>artificial lures or flies only</b> August 16–September 30 with a bag of one landlocked salmon and one brook trout, and closed October 1–March 31 (inside front cover flap). Live fish as bait are prohibited in the North Zone and permitted in the South. <b>Sea-run Atlantic salmon</b> share some of these waters: “Sea-run salmon are listed as endangered by the U.S. Fish and Wildlife Service and therefore may not be fished or harvested,” and “Any sea-run Atlantic salmon incidentally caught must be released immediately, alive and uninjured” (p. A-1, the S-33 code).`,
    ungauged:"No live gauge on this water. Judge clarity and level on arrival."},
});
/* Missouri: the Missouri Department of Conservation's 2026 Summary of Missouri
   Fishing Regulations (effective March 1, 2026), with MDC's own trout-area
   lines (geom "mdc") and OSM channel for the float rivers; every Missouri
   river and lake is region "missouri" (lakes name it in `park`). No `zone`:
   there is none yet, and a `zone` would make refreshZoneCounts() build an
   empty set. Every licence word is the booklet's, with its page. The
   booklet's only statement on access is the "Don't Trespass!" box
   (ACCESS_LAW.MO), and none is claimed beyond it. */
Object.assign(PARK_INFO, {
  missouri: {sub:"", heading:"Regulations", labelZoom:8, badge:"MDC · 2026",
    note:`From the <b>2026 Summary of Missouri Fishing Regulations</b> (Missouri Department of Conservation): the water's own entries in the Department's words, with the booklet's page cites, then the statewide rule they fall back to. A water with no entry of its own says so and shows the statewide rule alone.`,
    lakeNote:`From the <b>2026 Summary of Missouri Fishing Regulations</b> (Missouri Department of Conservation): the rules that name this lake, with the booklet's page cites, then the statewide rules the booklet gives for the fish it lists.`,
    licence:"<b>Missouri fishing permit</b> (unless exempt) <b>+ trout permit</b> to possess trout outside the trout parks; <b>daily trout tag</b> in the trout parks",
    regBody:"the Missouri Department of Conservation",
    footer:`🎣 <b>Missouri</b>, from the 2026 booklet: “Anyone who fishes must have the appropriate lifetime, annual, or daily fishing permit or qualify for an exemption” (p. 4). “In addition to a fishing permit, you will need a trout permit to possess trout on all waters outside of the trout parks and a daily tag while fishing in the trout parks” (p. 24). A trout permit is required “for all winter fishing in trout parks and for all fishing year-round in Lake Taneycomo upstream from the U.S. Highway 65 bridge” (p. 6). The daily trout tag is $5 for anglers 16 and older and $3 for anglers 15 and younger (p. 24). Exempt from the fishing permit, but still needing a daily trout tag or trout permit where required: any Missouri resident 65 or older and anyone 15 or younger (p. 4).`,
    ungauged:"No live gauge on this water. Judge clarity and level on arrival."},
});
/* Minnesota's designated stream trout lakes (mnlakes/build.py). Only lakes name
   this row: no Minnesota river has region "minnesota", so it never reaches a
   river sheet, and it has no `zone` (it would build an empty set). Every word
   of licence below is from the 2026 Minnesota Fishing Regulations, page given. */
Object.assign(PARK_INFO, {
  minnesota: {sub:"", heading:"Regulations", labelZoom:8, badge:"Minnesota DNR · 2026",
    note:`From the Minnesota DNR's <b>2026 Minnesota Fishing Regulations</b>, word for word, with the booklet's page numbers. Read the current booklet before you fish.`,
    lakeNote:`From the Minnesota DNR's <b>2026 Minnesota Fishing Regulations</b>: the booklet's rules for designated stream trout lakes, word for word. It names none of these lakes individually. Read the current booklet and the DNR's designation list before you fish.`,
    licence:`<b>Minnesota fishing licence + trout/salmon stamp</b> — “anglers need a Minnesota trout/salmon stamp validation and a fishing or sports license when fishing in designated trout streams, designated trout lakes, Lake Superior, or when possessing trout on waters that are not designated trout water.” (p. 25)`,
    regBody:"the Minnesota DNR",
    footer:`🎣 <b>Minnesota</b>, from the 2026 booklet: “Except as noted, anglers need a Minnesota trout/salmon stamp validation and a fishing or sports license when fishing in designated trout streams, designated trout lakes, Lake Superior, or when possessing trout on waters that are not designated trout water.” “Trout/salmon stamps are not required for children younger than 18 years old, adults who are 65 and older, people fishing with a 24-hour or 72-hour license or people who are exempt from fishing license requirements or who receive a fishing license at no charge.” (p. 25)`},
});
/* Michigan, South Dakota, New Mexico, Arizona and Nevada, plus the two of
   their parks with trout water. Each sheet quotes the state's own booklet. */
Object.assign(PARK_INFO, {
  michigan: {zone:"mi", sub:"", heading:"Regulations", labelZoom:9, badge:"Michigan DNR · 2026",
    note:`From the <b>2026 Michigan Fishing Regulations</b> (April 1, 2026 – March 31, 2027): the river's Gear Restricted Stream entries in the DNR's own words, then the stream-Type rules for each Type the DNR has assigned to its reaches.`,
    licence:"Licence: see the Michigan DNR",
    regBody:"the Michigan DNR",
    footer:`🎣 <b>Michigan</b>: Type 1 and Type 2 trout streams open the <b>last Saturday in April through September 30</b>; Type 3 and Type 4 are open all year, with possession seasons that vary. On <b>Gear Restricted Streams</b> live, dead or preserved bait and organic or processed food are unlawful on the water or on shore, and scented material is unlawful on flies-only water. Which reach is which Type is on the DNR's Inland Trout &amp; Salmon maps.`,
    ungauged:"No live gauge on this river. Michigan's trout rivers are mostly groundwater-fed and steady; the nearest gauged river is a fair regional read after rain."},
  southdakota: {zone:"sd", sub:" · Black Hills", heading:"Regulations", labelZoom:9, badge:"SD GFP · 2026",
    note:`From the <b>2026 South Dakota Fishing Handbook</b> — the Black Hills exceptions to statewide harvest and length limits, then the statewide limit.`,
    licence:"Licence: see South Dakota Game, Fish and Parks",
    regBody:"South Dakota Game, Fish and Parks",
    footer:`🎣 <b>South Dakota</b>: inside the <b>Black Hills Fish Management Area</b> only one trout 14 inches or longer from any Black Hills stream may be kept in the daily limit, and high grading is prohibited. Waters not listed as Black Hills exceptions fall under the statewide harvest and length limits.`,
    ungauged:"No live gauge on this creek. Black Hills creeks are spring- and reservoir-fed; the nearest gauged creek is a fair read."},
  newmexico: {zone:"nm", sub:"", heading:"Regulations", labelZoom:8, badge:"NMDOW · 2026–27",
    note:`From the <b>2026–2027 New Mexico Fishing Rules and Info</b> — the river's Special Trout Water designations (Red, Green and Xmas Chile Water) word for word, then the general trout bag.`,
    licence:"<b>New Mexico fishing licence</b>, anglers 12 and older",
    regBody:"the New Mexico Department of Wildlife",
    footer:`🎣 <b>New Mexico</b>: anglers 12 and older need a New Mexico fishing licence, valid April 1 through March 31. <b>Special Trout Waters</b> are posted with chile symbols: <b>Red</b> is catch-and-release with single barbless artificials, <b>Green</b> is a two-trout bag with the same tackle rule, and <b>Xmas</b> is a two-trout bag with any legal tackle. Fishing in a Special Trout Water must stop once its bag is taken.`,
    ungauged:"No live gauge on this water. In New Mexico the snowmelt runoff peaks in May and June and the summer monsoon can blow small streams out in an afternoon."},
  arizona: {zone:"az", sub:"", heading:"Regulations", labelZoom:8, badge:"AZGFD · 2025–26",
    note:`From Arizona Game and Fish's <b>2025 &amp; 2026 Fishing Regulations</b>, Commission Order 40 — the water's own special regulation, then the statewide daily bag.`,
    licence:"<b>Arizona fishing or combination licence</b>, ten and older",
    regBody:"the Arizona Game and Fish Department",
    footer:`🎣 <b>Arizona</b>: a fishing or combination licence for anglers ten and older. The statewide daily bag is <b>4 trout</b> in any combination, and the possession limit is twice the daily bag unless a water says otherwise. Several White Mountains streams are closed January 1 – April 30.`,
    ungauged:"No live gauge on this water."},
  nevada: {zone:"nv", sub:"", heading:"Regulations", labelZoom:8, badge:"NDOW · 2026–27",
    note:`From the Nevada Board of Wildlife Commissioners' <b>Fishing Seasons and Regulations, CR 25-16</b> (January 1, 2026 – December 31, 2027), set county by county.`,
    licence:"<b>Nevada fishing licence</b> — residents 12 and older need one",
    regBody:"the Nevada Department of Wildlife",
    footer:`🎣 <b>Nevada</b>: residents 12 and older need a fishing licence. Unless a water is listed, it is open year around with a daily limit of 5 trout and 5 mountain whitefish, and the possession limit is twice the daily limit.`,
    ungauged:"No live gauge on this water."},
  grandcanyon: {zone:"grca", sub:" · Grand Canyon National Park", badge:"Grand Canyon · Arizona regs",
    note:`From Grand Canyon National Park's fishing information, which follows Arizona's regulations reach by reach down the Colorado.`,
    licence:"<b>Arizona licence</b>, required at ten and older",
    regBody:"Arizona Game and Fish and the National Park Service (an Arizona licence is required)",
    footer:`🏜 An <b>Arizona licence</b> is required at ten and older. Down the Colorado the limit changes by reach: 6 rainbow trout from the Paria riffle to Navajo Bridge, no limit on trout from Navajo Bridge to Separation Canyon. The Colorado is closed for half a mile either side of the Little Colorado confluence, and humpback chub and other native fish are protected.`,
    ungauged:"No live gauge on this water."},
  greatbasin: {zone:"grba", sub:" · Great Basin National Park", badge:"Great Basin · Nevada regs",
    note:`From Great Basin National Park's fishing page: Nevada licence and regulations, plus the park's own rules.`,
    licence:"<b>Nevada licence</b>, plus the park's own rules",
    regBody:"the National Park Service and NDOW (a Nevada licence is required)",
    footer:`🏔 Fished on a <b>Nevada licence</b>. Johnson and Baker Lakes are catch-and-release with single barbless artificial lures, and catch and release is encouraged on Snake Creek, where Bonneville cutthroat were reintroduced in 2019.`,
    ungauged:"No live gauge on most of these creeks."},
});

Object.assign(PARK_INFO, {
  montana: {zone:"mt", sub:"", heading:"Regulations", labelZoom:8, badge:"Montana FWP · 2026",
    note:`From Montana Fish, Wildlife &amp; Parks' <b>2026 Fishing Regulations</b> — this water's own entry in the District Exceptions to Standard Regulations, then the district standard. A water's exceptions replace the standard for the items they list. FWP posts temporary and seasonal closures not in the booklet at fwp.mt.gov — check before you go.`,
    licence:"<b>Conservation + Fishing Licence and AIS Prevention Pass</b> (most anglers)",
    regBody:"Montana Fish, Wildlife &amp; Parks",
    footer:`🎣 <b>Montana</b>: most anglers need a <b>Conservation License, a Fishing License and an AIS Prevention Pass</b>; children 11 and under need no licence but must observe all limits and regulations. Rules are set by district — Western, Central and Eastern — and a water's own exceptions take the place of the district standard for the items they list. Bull trout are closed to angling statewide unless an exception says otherwise.`,
    ungauged:"No live gauge on this river. The nearest gauged water in Montana is the read on how runoff and rain have the region — Montana's rivers are snowmelt-driven, high and cold through spring and early summer, and the small ones clear long before the big ones do."},
  california: {zone:"ca", sub:"", heading:"Regulations", labelZoom:8, badge:"CDFW · 2026",
    note:`From the California Department of Fish &amp; Wildlife's <b>2026 Freshwater Sport Fishing Regulations</b> — this water's own entry in §7.50 (trout waters) or §7.40 (salmon and steelhead waters), otherwise the statewide stream rule in §5.85.`,
    licence:"<b>California sport fishing licence</b>, required at 16 and older",
    regBody:"the California Department of Fish &amp; Wildlife",
    footer:`🎣 <b>California</b>: a <b>sport fishing licence is required at 16 and older</b>. Rivers follow the statewide stream rule — open the last Saturday in April through November 15, five trout — unless listed in the special regulations, and many of the best trout waters are listed, with zero-bag, barbless or artificial-only reaches. The Eel, Mad, Mattole, Redwood Creek, Smith and Van Duzen are subject to <b>low-flow closures</b> from September 1 through April 30.`,
    ungauged:"No live gauge on this river. The nearest gauged water in California is the read on regional conditions — Sierra and Cascade rivers run on snowmelt, the coast ranges on rain."},
  oregon: {zone:"or", sub:"", heading:"Regulations", labelZoom:8, badge:"ODFW · 2026",
    note:`From the Oregon Department of Fish &amp; Wildlife's <b>2026 Sport Fishing Regulations</b> — this water's own exception entry, then the standard rules for its zone.`,
    licence:"<b>Oregon Angling License</b>, everyone 12 and older",
    regBody:"the Oregon Department of Fish &amp; Wildlife",
    footer:`🎣 <b>Oregon</b>: <b>everyone 12 and older needs an Oregon Angling License</b> in possession. Rules are set by zone and a river's exceptions take precedence; in most zones streams open May 22 and trout are 2 a day with an 8-inch minimum — except the <b>Willamette Zone, which is catch-and-release for trout in streams</b> unless an exception says otherwise.`,
    ungauged:"No live gauge on this river. The nearest gauged water in Oregon is the read on regional conditions — Cascade rivers run on snowmelt, coastal ones on rain."},
  washington: {zone:"wa", sub:"", heading:"Regulations", labelZoom:8, badge:"WDFW · 2026–27",
    note:`From the Washington Department of Fish &amp; Wildlife's <b>Sport Fishing Rules</b>, in effect July 1, 2026 – June 30, 2027 — this water's own Special Rules entry, otherwise the statewide freshwater rules. Emergency rules change often: (360) 902-2700 or wdfw.wa.gov.`,
    licence:"<b>Washington fishing licence</b> (annual licences include a Catch Record Card)",
    regBody:"the Washington Department of Fish &amp; Wildlife",
    footer:`🎣 <b>Washington</b>: annual licences include a <b>Catch Record Card</b> for salmon, steelhead and sturgeon, and anglers 15 and older fishing for salmon or steelhead on the Columbia or its tributaries need the <b>Columbia River Salmon and Steelhead Endorsement</b>. Unless a river's Special Rules say otherwise, rivers open the Saturday before Memorial Day through October 31, trout are 2 a day with an 8-inch minimum, Dolly Varden/bull trout are closed, and every wild steelhead goes back.`,
    ungauged:"No live gauge on this river. The nearest gauged water in Washington is the read on regional conditions — the west side runs on rain, the east side and the Cascades on snowmelt."},
});

/* Wyoming Area 1 (the Snake River drainage), for the streams drawn from Wyoming
   Game & Fish's own Fishing Guide map. Wyoming rivers carry no `region` (a
   region picks a PARK_INFO row and the behaviour that comes with it), so this
   row is found through `parkRegsSrc:"wgfd"` instead -- and it has no `zone`,
   because refreshZoneCounts() would otherwise count it as Wyoming's set. Soda
   Lake reads it through its `park` field like the other state lakes. */
Object.assign(PARK_INFO, {
  wgfd: {sub:"", heading:"Regulations", labelZoom:8, badge:"WGFD · Chapter 46 · 2026",
    note:`From the Wyoming Game and Fish Commission's <b>Chapter 46, Fishing Regulations</b>, effective January 1, 2026 — Area 1, the Snake River drainage: this water's own entry where it has one, then the rules for every stream and water in Area 1, word for word. Wyoming re-issues Chapter 46; check the current regulations at wgfd.wyo.gov before you fish.`,
    licence:`<b>Wyoming fishing licence</b> — on request, anyone who has been fishing must produce “a valid license and conservation stamp, if required” (Ch. 46 §15)`,
    regBody:"Wyoming Game &amp; Fish",
    footer:`🎣 <b>Wyoming, Area 1</b> — the Snake, Salt, Greys, Hoback, Gros Ventre and Buffalo Fork drainages and everything west of the Teton and Snake River Ranges. Chapter 46 (effective January 1, 2026): “Fishing is permitted year-round twenty-four (24) hours a day in any waters of this state except as otherwise provided by Commission regulation for specific areas, streams, lakes, or portions thereof”, and “The use or possession of live baitfish in Area 1 is prohibited.” Stream class and species are from WGFD's Fishing Guide map.`,
    ungauged:"No live gauge on this stream, and the app won't put a number on it that isn't measured. The nearest gauged water below is the read on how runoff and rain have the region."},
});

/* The regions that came before this table: Yellowstone and Grand Teton, the
   two Idaho valleys, and the three small-stream regions of the Upper Midwest.
   Same row shape, with these differences worth knowing:
   - No `zone`. refreshZoneCounts() builds the park cards' sets itself for
     these two parks (Grand Teton's includes GRTE_SHARED), and a row with a
     zone would replace that set with the region alone.
   - The two parks' lakes carry a different source note from their rivers
     (attractors in Yellowstone's lakes, bait on Grand Teton's), so they have
     `lakeNote`, which openLake() prefers to `note`.
   - The Driftless, the North Shore and Door County have no `licence` or
     `regBody`: both go by state there (stateLicence(), regBodyFor()), and the
     licence also by whether the water takes a trout fee or stamp. The
     Driftless has no `ungauged` either -- its spring-creek text is
     noGaugeHTML()'s default, and a Driftless river that is also a water trail
     (the Upper Iowa) gets the water-trail text before it.
   - The two Idaho valleys share everything but the last sentence of the
     footer (UPPER_SNAKE). */
const UPPER_SNAKE = {badge:"Idaho Fish &amp; Game",
  note:`From Idaho Fish &amp; Game's <b>2025–2027 Seasons &amp; Rules</b>, Upper Snake Region. Idaho re-issues the book every two years and the special-rule list changes with it — check the current one before you fish.`,
  licence:"<b>Idaho</b> fishing licence — Idaho Fish &amp; Game, Upper Snake Region",
  regBody:"Idaho Fish &amp; Game (Upper Snake Region)",
  ungauged:"No gauge on this creek — in these two valleys the gauges are on the mainstems, and that is the right place to look anyway. Both rivers run through irrigated valleys, so late summer flow here is as much about diversions as about snowpack, and the tributaries drop and warm well before the river does. The nearest gauged water below is the useful read; remember the <b>June 1–30 closure</b> on the tributaries as well as the level."};
const UPPER_SNAKE_FOOTER = `🐟 <b>Idaho's cutthroat programme runs both these valleys.</b> On the Teton and the South Fork and their tributaries there is <b>no harvest of cutthroat trout</b> and <b>no limit at all on rainbow trout or hybrids</b> — non-native rainbows displace and interbreed with the native Yellowstone cutthroat, so the state protects one and turns the other loose. The <b>tributaries close June 1–30</b> for the spawning run while the mainstems stay open; Upper Snake water is otherwise open all year. Brook trout are limited to 25 and bull trout are catch-and-release region-wide.`;
Object.assign(PARK_INFO, {
  yellowstone: {sub:" · Yellowstone National Park", labelZoom:9, badge:"National Park Service",
    note:`From the park's <b>2026</b> fishing regulations. Seasons, closures and possession limits are re-issued every year and streams close on short notice in low water — read the current edition before you fish, and carry your park permit.`,
    lakeNote:`From the park's <b>2026</b> fishing regulations. A park permit is required at 16 and over and a state licence is not valid; tackle is lead-free artificial lures or flies, barbless. Attractors such as dodgers and lake trolls may be used <b>in lakes only</b>. Re-issued every year — read the current edition before you fish.`,
    licence:"Yellowstone park fishing permit — a state licence is <b>not</b> valid",
    regBody:"the National Park Service (a state fishing licence is <b>not</b> valid in the park)",
    footer:`🏞 <b>Yellowstone runs its own fishery.</b> A <b>park fishing permit</b> is required at 16 and over and a state licence is not valid — $40 for three days, $55 for seven, $75 for the season, through Recreation.gov. The standard season is the <b>Saturday of Memorial Day weekend through October 31</b>; the Firehole, the Gibbon below the bridge and the Madison above the state line open <b>May 1</b>, and the Madison below the state line and the Gardner from Osprey Falls down are <b>open year-round</b>. Tackle is <b>lead-free artificial lures or flies only, barbless or barbs pinched</b> — no bait — and up to two flies on a leader; the Firehole, Madison and lower Gibbon are <b>fly fishing only</b>. <b>All native fish go back unharmed</b> — cutthroat, mountain whitefish, Arctic grayling. In the <b>Lamar drainage</b> every rainbow, brook trout and cutthroat/rainbow hybrid <b>must be killed</b>, as must every lake trout from Yellowstone Lake. Closures and opening dates move year to year — check the park's current fishing regulations before you go.`,
    ungauged:"Nine gauges cover the park's main rivers and none of them is on this one — most Yellowstone water is backcountry and ungauged, and the app won't put a number on it that isn't measured. The nearest gauged river below is the useful read: on this plateau the whole park rises and falls together with snowmelt, so a neighbouring drainage tracks this one far more closely than it would in farm country. Runoff usually has the park high and off-colour into late June, and the backcountry streams come into shape as it drops."},
  grandteton: {sub:" · Grand Teton National Park", labelZoom:9, badge:"Grand Teton · Wyoming regs",
    note:`From the National Park Service's Grand Teton fishing information, which follows <b>Wyoming Game &amp; Fish</b> regulations. Seasons and closures are re-issued every year — check the current Wyoming regulations, and carry a Wyoming licence.`,
    lakeNote:`From the National Park Service's Grand Teton fishing information, which follows <b>Wyoming Game &amp; Fish</b> regulations. Bait is allowed on park lakes that aren't otherwise restricted — the artificial-only rule covers the streams. Seasons and limits are re-issued every year; check the current Wyoming regulations and carry a Wyoming licence.`,
    licence:"<b>Wyoming</b> fishing licence (Grand Teton follows Wyoming regulations)",
    regBody:"WY Game &amp; Fish and the park — Grand Teton takes a <b>Wyoming licence</b>, unlike Yellowstone",
    footer:`🏔 <b>Grand Teton is not Yellowstone.</b> It takes a <b>Wyoming fishing licence</b> and is fished under <b>Wyoming regulations</b>, not a park permit of its own. The rule that shapes a season here: <b>park streams are closed December 1 – July 31</b>, so most of this water opens <b>August 1</b> — the exceptions the park names are the <b>Snake, Buffalo Fork, Pacific Creek, Gros Ventre and Polecat Creek</b>. Streams are <b>artificial flies or lures only</b> apart from those same five, the stream creel is three trout with no more than one over sixteen inches and no more than one cutthroat over twelve inches, and the lakes are six trout of which at most three may be cutthroat. Lakes are open year-round except Jackson Lake, which closes October 1–31. Check the current Wyoming Game &amp; Fish regulations before you go.`,
    ungauged:"Only three gauges bear on Grand Teton's own water and none of them is on this one. Several of these creeks <i>have</i> USGS site numbers — Spread, Cottonwood, Ditch, Taggart, Pilgrim, Lake Creek — and not one has reported discharge since the 1990s or 2010, so there is nothing live to show. The nearest gauged water below is the useful read: these streams share one snowpack off the same range and rise and fall together. Remember the season here as well as the level — most park streams are shut until <b>August 1</b>."},
  tetonvalley: {sub:" · Teton Valley", labelZoom:10, ...UPPER_SNAKE,
    footer:UPPER_SNAKE_FOOTER + " The Teton Range canyons cross into <b>Wyoming</b> part-way up and a Wyoming licence is needed above the line — which is where this zone ends."},
  swanvalley: {sub:" · Swan Valley", labelZoom:10, ...UPPER_SNAKE,
    footer:UPPER_SNAKE_FOOTER + " Palisades Reservoir and its tributaries sit at the top of the valley; Big Elk Creek's drainage reaches into Wyoming."},
  driftless: {sub:" · Driftless Area", labelZoom:10},
  northshore: {sub:" · North Shore", labelZoom:10,
    footer:`🌊 North Shore streams drop fast and cold straight off the ridge — spring steelhead runs are driven by snowmelt timing more than the calendar, so check current run reports before making the drive. Most access is <b>state park or DNR wayside</b> parking (many require a vehicle permit); a Minnesota <b>trout stamp</b> is required in addition to a fishing license. The Pigeon River and Grand Portage River cross into tribal or international jurisdiction — check current Grand Portage Band and Ontario licensing before fishing those reaches.`,
    ungauged:"Most North Shore streams are too small to gauge — there's no live number for this one, and the app doesn't invent one. Judge it on arrival: <b>clarity</b> is the thing that matters most. These are rain- and snowmelt-driven freestone streams, not spring creeks — they blow out fast after a heavy rain or a warm melt day and can take several days to clear and drop back into shape, longer than a Driftless spring creek would."},
  doorcounty: {sub:" · Door Peninsula", labelZoom:10,
    footer:`🌊 Door County has <b>no USGS gauge anywhere in the county</b> — every stream here is ungauged on purpose, and the nearest gauged water is a long way off. These creeks are small and rain-driven: judge them on the water. Almost all of them are <b>Great Lakes tributary</b> water, which carries its own season, a 10" minimum, a hook-gap limit and a <b>night-fishing closure</b> from September 15 — read the current Wisconsin regs before you go.`,
    ungauged:"There is <b>no USGS discharge gauge anywhere in Door County</b> — not on this creek and not on a neighbouring one — so there is no number to show and nothing close enough to borrow as a regional read. Nearly all of this water is short and rain-driven: <b>clarity and recent rain</b> are the whole story. On the Great Lakes tributaries the other half of the question is whether fish have run yet, which is driven by lake temperature and a rise in the creek, not by the calendar — a soaking rain in spring or from mid-September on is what turns them on."},
});
/* Regulation sources that are not PARK_INFO keys, and the row each one reads
   instead. Deliberately not rows of their own: the Snake, Buffalo Fork, Gros
   Ventre and the park creeks WGFD carries past the boundary have no region and
   parkRegsSrc "grte", and a "grte" row would be found by every
   PARK_INFO[r.parkRegsSrc] lookup -- handing them Grand Teton's footer as well.
   Only the regulation fold's badge and note, the licence line and the
   ungauged copy look here. */
const REGS_SRC_ROW = {yell:"yellowstone", grte:"grandteton", idfg:"tetonvalley", pfbc:"pennsylvania", nydec:"newyork", vdwr:"virginia", mdc:"missouri"};
function regsSrcRow(r){ return PARK_INFO[REGS_SRC_ROW[r.parkRegsSrc]]; }
/* Rivers that run through Grand Teton but carry no region of their own: the
   three Jackson Hole rivers, the park creeks WGFD's line carries on past the
   boundary, and the two WGFD streams that rise inside it. Each carries a
   Grand Teton note (parkRegsSrc "grte"); the Parkway's Snake and Polecat do
   too but are not in the park. refreshZoneCounts() counts these with the
   park's own region; keep in step with zones.js grte `count`. Declared up
   here, above anything that can run at startup. */
const GRTE_SHARED = ["snake","buffalofork","grosventre",
  "pacificcreek","ditchcreek","spreadcreek","lakecreekgt","granitecreekgt","pilgrimcreek","arizonacreek",
  "wg_fishcreekwilson","wg_springcreekjackson"];


const riverLayers = {}, rampMarkers = {}, gaugeDots = {};
let highlight = null;
/* The river whose sheet is open and the map has turned to (see "RIVER
   FOCUS" further down), or null. Declared up here because syncLabels() and
   syncMarkers() read it on their first calls at startup. */
let focusId = null;

/* Per-reach colours. The Iowa DNR designates a stream reach by reach -- a
   catch-and-release stretch inside catchable water -- and `reachClass` gives
   one class per piece of `coords`. The river's own line keeps the colour of
   its longest class and stays the one layer everything else works with (flow
   animation, Float Mode routing, refinement); each piece of another class gets
   an overlay in its own colour, drawn over the line in the same pane and
   style, so the creek reads as one stream that changes colour where its
   designation does. Only those few pieces get a layer. applyFilters() shows,
   hides and greys them with the line. If the line is ever redrawn from other
   geometry the overlays no longer describe it, so they go. */
function reachOverlays(r, line){
  const out = [];
  if(!r.reachClass || !isMulti(r.coords)) return out;
  r.coords.forEach((run, i) => {
    const cls = r.reachClass[i], tc = TROUT_CLASS[cls];
    if(!tc || cls === r.troutClass || run.length < 2) return;
    const o = L.polyline(run, {color:tc.color, weight:tierWeight(r), opacity:.92,
      lineCap:"round", lineJoin:"round", smoothFactor:1.2, pane:"riversPane"}).addTo(map);
    o.reachColor = tc.color;
    onTap(o, e=>openRiver(r.id, null, {at:e.latlng}));
    out.push(o);
  });
  if(out.length){
    const set = line.setLatLngs;
    line.setLatLngs = function(ll){
      out.forEach(o => map.removeLayer(o)); out.length = 0;
      return set.call(this, ll);
    };
  }
  return out;
}
/* [[class, miles], ...] longest first, measured along the drawn pieces; a
   river with one class gets [[class, null]]. */
function reachMiles(r){
  if(!r.reachClass || !isMulti(r.coords)) return [[r.troutClass, null]];
  const mi = {};
  r.coords.forEach((run, i) => {
    let km = 0;
    for(let j = 1; j < run.length; j++) km += distKm(run[j-1], run[j]);
    mi[r.reachClass[i]] = (mi[r.reachClass[i]] || 0) + km / 1.609344;
  });
  return Object.entries(mi).sort((a, b) => b[1] - a[1]);
}

RIVERS.forEach(r=>{
  const line = L.polyline(r.coords,{color:riverColor(r), weight:tierWeight(r), opacity:.92,
    lineCap:"round", lineJoin:"round", smoothFactor:1.2, pane:"riversPane"}).addTo(map);
  // An NHD snap or a zoom refinement redraws the line in place; the gold
  // focus outline has to follow it rather than keep tracing the old one.
  const setLL = line.setLatLngs;
  line.setLatLngs = function(ll){
    const out = setLL.call(this, ll);
    if(focusId === r.id) drawFocus();
    return out;
  };
  onTap(line, e=>openRiver(r.id, null, {at:e.latlng}));   // where it was tapped: see fitFocus
  const mid = midCoord(r.coords);
  const lbl = L.marker(mid,{interactive:false,icon:L.divIcon({className:"riv-label",html:r.name.split("—")[0].split("(")[0].trim(),iconSize:null})}).addTo(map);
  riverLayers[r.id]={line,lbl,river:r,reaches:reachOverlays(r, line)};
});
syncLabels();

/* boat-ramp logo for launches/take-outs; fish for wade access */
function apGlyph(p){
  const role = p.role;
  // a DNR parking lot is a P, drawn as a path so iOS renders it like every other glyph
  if(role==="wade" && p.kind==="parking"){
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+
      '<path fill="#fff" fill-rule="evenodd" d="M8.2 5 H13.2 A4.3 4.3 0 0 1 13.2 13.6 H11.2 V19 H8.2 Z M11.2 7.5 V11.1 H13 A1.8 1.8 0 0 0 13 7.5 Z"/></svg>';
  }
  if(role==="wade"){
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'+
      '<ellipse cx="10.5" cy="12" rx="7" ry="3.1" fill="#fff"/>'+
      '<path d="M16.5 12 L22 8.5 L22 15.5 Z" fill="#fff"/>'+
      '<circle cx="6.6" cy="11.3" r="0.95" fill="#5b6e3a"/></svg>';
  }
  // side-view boat above two water ripples = boat launch
  return '<svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
    '<path d="M4 11.4 L16.6 11.4 L14.2 15 L6.3 15 Z" fill="#fff" stroke="none"/>'+
    '<path d="M8.2 11.4 L9.5 8.9 L12.2 8.9 L12.4 11.4" fill="#fff" stroke="none"/>'+
    '<path d="M2.6 18.2 q2 -1.7 4 0 t4 0 t4 0 t2.8 0"/>'+
    '<path d="M2.6 21 q2 -1.7 4 0 t4 0 t4 0 t2.8 0"/></svg>';
}
/* Marker layers. The map used to drop all ~280 access points and ~170 gauge
   dots on at once, at every zoom — unreadable at statewide view and not much
   better at regional. Now each kind lives in its own toggleable group:

     Boat ramps          launch / take-out / both
     Wade access/parking role:"wade" — on a Driftless spring creek "access"
                         means a signed gravel pull-off, not a ramp.
     USGS gauges         the live data, as coloured dots.

   Every group starts OFF at launch, so the map opens on the rivers alone.
   Which ones come on after that — the user's taps, an open river's sheet,
   or zooming in close — is decided in one place, iconWanted() (see "MAP
   ICONS" further down).

   syncMarkers() additionally zoom-gates membership so the groups stay empty
   at statewide zoom and fill in as you get close enough for them to mean
   something — and while a river's sheet is open, only that river's access
   points show. */
const rampLayer   = L.layerGroup();              // launch / takeout / both
const wadeLayer   = L.layerGroup();              // role:"wade" parking & walk-in
const gaugeLayer  = L.layerGroup();
const RAMP_MIN_ZOOM = 8, WADE_MIN_ZOOM = 9;

RAMPS.forEach(p=>{
  const m = L.marker(p.pos,{icon:apIcon(p,"")});
  m.bindPopup(`<b>${p.name}</b><br><span style="font-size:11px">${p.kind==="parking" ? "Parking" : roleWord(p.role)} · ${p.note}</span>`+
    (p.src ? `<br><span style="font-size:10.5px;color:var(--txt-dim)">Source: ${p.src}</span>` : ""));
  // A lake's access (Big Creek, Saylorville) carries `lake` and no `river`: its pin opens the lake's sheet.
  m.on("click",()=>{ if(p.lake) openLake(p.lake); else openRiver(p.river, null, {at:p.pos}); });
  rampMarkers[p.id]=m;
});
function groupFor(p){ return p.role==="wade" ? wadeLayer : rampLayer; }
function minZoomFor(p){ return p.role==="wade" ? WADE_MIN_ZOOM : RAMP_MIN_ZOOM; }
/* Membership is (passes the filter chips) AND (zoomed in far enough).
   Toggling the group itself on/off is the layer control's job, so this
   stays independent of whether the user has that group showing.
   While a river is in focus (its sheet open) every other river's access
   points step aside, so the pins on screen are the ones that answer "where
   do I get on this water?" — put-ins and take-outs included, since focus
   switches both groups on. The zoom gates still apply to the focused river:
   showing its pins at any zoom put eighteen of them on the Snake at zoom 7,
   one clump sitting on the very line they were meant to explain. A lake's
   pins have no river, so they step aside for every river's focus; with no
   focus (a lake's own sheet ends one) they follow the same chips and zoom
   gates as the rest. */
function syncMarkers(){
  const z = map.getZoom();
  RAMPS.forEach(p=>{
    const m = rampMarkers[p.id], g = groupFor(p);
    // While a lake trip records, that lake's pins would bury the track (Big Creek
    // has 49), so only the launch the user picked stays: it is the way back.
    const lt = typeof lakeTripPinKeep === "function" ? lakeTripPinKeep() : null;
    const show = rampPassesFilter(p) && (!focusId || (!!p.river && p.river === focusId)) && z >= minZoomFor(p)
      && !(lt && p.lake === lt.lake && p.id !== lt.ramp)
      && !(p.lake && !lakeSpeciesShown(p.lake));          // a lake the species filter hides takes its pins with it
    const has = g.hasLayer(m);
    if(show && !has) g.addLayer(m);
    else if(!show && has) g.removeLayer(m);
  });
}
map.on("zoomend", syncMarkers);
function apIcon(p, sel){ return L.divIcon({className:"", html:`<div class="ap ${p.role} ${sel}">${apGlyph(p)}</div>`, iconSize:[28,28], iconAnchor:[14,14]}); }
function roleWord(r){ return {launch:"Put-in (boat launch)", takeout:"Take-out (boat ramp)", both:"Put-in & take-out ramp", wade:"Wade-fishing access"}[r]; }

Object.keys(GAUGE_POS).forEach(key=>{
  const m = L.marker(GAUGE_POS[key],{icon:gIcon(key), zIndexOffset:300}).addTo(gaugeLayer);
  m.on("click",()=>{
    const r = RIVERS.find(rv=>rv.gauges.includes(key));
    if(typeof Metrics !== "undefined") Metrics.track("gauge_tap", key);
    if(r) openRiver(r.id, key);
  });
  gaugeDots[key]=m;
});
function gIcon(key){
  const st = statusOf(key);
  return L.divIcon({className:"", html:`<div class="gdot" style="background:${st.color}"></div>`, iconSize:[14,14], iconAnchor:[7,7]});
}
/* A gauge dot belongs to the rivers that list it; when every one of them is
   filtered out by class, the dot goes too — it is a flow marker for water
   you have chosen not to see. */
function syncGaugeDots(){
  Object.keys(gaugeDots).forEach(k => {
    const on = RIVERS.some(r => r.gauges.includes(k) && tierShown(r));
    const m = gaugeDots[k], has = gaugeLayer.hasLayer(m);
    if(on && !has) gaugeLayer.addLayer(m);
    else if(!on && has) gaugeLayer.removeLayer(m);
  });
}
function repaintGauges(){ Object.keys(gaugeDots).forEach(k=>gaugeDots[k].setIcon(gIcon(k))); }

/* ============================================================
   PUBLIC LAND — PAD-US (USGS Protected Areas Database)
   On a Driftless creek or a Northwoods river the question isn't only
   "how's the water", it's "can I legally stand in it". This shades the
   ground the streams actually run through, coloured by who manages it,
   because the manager is what decides the rules you fish under:

     National forest   Chequamegon-Nicolet, Superior, Ottawa, Hiawatha.
     Other federal     NPS, USFWS refuges, BLM, Corps.
     State wildlife    WMAs and Aquatic Management Areas.
     State other       State forests, state parks, DNR holdings.
     County / city     Local parks and forests, often river frontage.
     Private w/ access Easements and NGO land that PAD-US records as
                       publicly accessible. Deliberately NOT green —
                       it's someone's land and the access can lapse.

   All of them are drawn at the same weight. Fly fishing has the most
   generous access rules of any use of public land, so none of these is
   more fishable than another and none gets to look it.

   Pub_Access: OA = open access, RA = restricted (permit, seasonal, or
   limited entry) and gets a dashed outline. XA (closed) and UK (unknown)
   are left off — a closed parcel shaded green is worse than none.

   Loaded per-viewport rather than all at once: these are detailed
   polygons and the whole multi-state set would be many megabytes. At
   wider zooms only the big units are requested, so the map stays legible
   and the response stays under the service's record cap.
   ============================================================ */
const PADUS_URL = "https://services.arcgis.com/v01gqwM5QqNysAAi/ArcGIS/rest/services/PADUS_Public_Access/FeatureServer/0/query";
const PUBLIC_LAND_MIN_ZOOM = 8;
const publicLand = L.layerGroup();               // off at launch, like every Map Icons layer
let padusKey = null, padusBusy = false;

/* Manager -> colour, all drawn at the SAME weight.

   An earlier version ranked these visually — faint national forest, bold
   WMA — on the theory that the WMA is what you're hunting for. That's wrong
   for this app. Fly fishing has the most generous access rules of any use
   of public land: if it's open ground with water on it you can fish it,
   whether that's a national forest, a county park or a state wildlife area.
   So none of them gets to look more fishable than another. Colour still
   distinguishes the manager, because the manager decides the regulations,
   but nothing is emphasised or de-emphasised. */
const PAD_FILL_OPACITY = 0.20;
const PAD_WEIGHT = 1.2;
const PAD_CLASS = {
  nforest: {label:"National forest",      color:"#1f6b3a", fill:"#3f8f57"},
  federal: {label:"Federal land",         color:"#1f6f8b", fill:"#4a97ad"},
  wildlife:{label:"State wildlife / fishing area", color:"#1d7a2e", fill:"#5fbf62"},
  state:   {label:"State forest / park",  color:"#2f7d3f", fill:"#6fae70"},
  local:   {label:"County / city land",   color:"#5f7a3a", fill:"#93ad6e"},
  private: {label:"Private land with public access", color:"#9c7a2a", fill:"#c8a94e"}
};
function padClass(p){
  const mgr = (p.MngNm_Desc || "").toLowerCase();
  const des = (p.DesTp_Desc || "").toLowerCase();
  if(mgr.includes("forest service")) return "nforest";
  if(mgr.includes("fish and wildlife") && mgr.includes("state")) return "wildlife";
  if(des.includes("wildlife management") || des.includes("aquatic management")
     || des.includes("wildlife area") || des.includes("fishery")) return "wildlife";
  if(/national park|u\.s\. fish|bureau of|department of defense|army corps|tennessee valley/.test(mgr)) return "federal";
  if(mgr.includes("state") || mgr.includes("territory")) return "state";
  if(mgr.includes("city") || mgr.includes("county") || mgr.includes("local") || mgr.includes("regional")) return "local";
  if(mgr.includes("private") || mgr.includes("non-governmental")) return "private";
  return "state";
}
/* Smallest unit worth drawing at this zoom. Zoomed out you want the forests
   and the big WMAs, not every half-acre village park. */
function padMinAcres(z){
  if(z >= 12) return 0;
  if(z >= 11) return 20;
  if(z >= 10) return 60;
  if(z >= 9)  return 400;
  return 2000;
}
async function loadPublicLand(){
  if(!map.hasLayer(publicLand)) return;
  const z = map.getZoom();
  if(z < PUBLIC_LAND_MIN_ZOOM){ publicLand.clearLayers(); padusKey = null; return; }
  const b = map.getBounds().pad(0.15);
  // before the container has been laid out, getBounds() collapses to a point —
  // querying that returns nothing and poisons the cache key. Wait for a real box.
  if(b.getWest() === b.getEast() || b.getNorth() === b.getSouth()) return;
  const minAc = padMinAcres(z);
  // round the key so small pans don't refetch the same ground; the acreage
  // floor is part of it so a zoom change does refetch
  const key = [b.getWest(),b.getSouth(),b.getEast(),b.getNorth()].map(v=>v.toFixed(2)).join(",")+"@"+minAc;
  if(key === padusKey || padusBusy) return;
  padusBusy = true;
  try{
    const where = `Pub_Access IN ('OA','RA')` + (minAc ? ` AND GIS_Acres >= ${minAc}` : "");
    const url = `${PADUS_URL}?where=${encodeURIComponent(where)}`+
      `&geometry=${b.getWest()},${b.getSouth()},${b.getEast()},${b.getNorth()}`+
      `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`+
      `&outFields=Unit_Nm,Pub_Access,MngNm_Desc,MngTp_Desc,DesTp_Desc,GIS_Acres`+
      `&returnGeometry=true&outSR=4326&maxAllowableOffset=${z>=12?0.0002:0.0006}`+
      `&geometryPrecision=5&resultRecordCount=1200&f=geojson`;
    const j = await fetchJSON(url, 20000);
    publicLand.clearLayers();
    L.geoJSON(j, {
      pane: "landPane",
      style: f => {
        const c = PAD_CLASS[padClass(f.properties)];
        // Restricted parcels get a dashed outline — that's a real gate
        // (permit, season, limited entry), not a ranking — but the same
        // weight and fill as everything else.
        const restricted = f.properties.Pub_Access === "RA";
        return {color:c.color, weight:PAD_WEIGHT, fillColor:c.fill,
                fillOpacity:PAD_FILL_OPACITY,
                dashArray: restricted ? "5 4" : null};
      },
      onEachFeature: (f, lyr) => {
        const p = f.properties, c = PAD_CLASS[padClass(p)];
        const acres = p.GIS_Acres ? Math.round(p.GIS_Acres).toLocaleString()+" acres" : "";
        const open = p.Pub_Access === "OA"
          ? '<span style="color:#1d7a2e;font-weight:700">Open access</span>'
          : '<span style="color:#9c7a2a;font-weight:700">Restricted access</span> — permit, season or limited entry';
        // not bindPopup: its built-in click opens at once and breaks a double-tap
        const html =
          `<b>${p.Unit_Nm || c.label}</b><br>`+
          `<span style="font-size:11px">`+
          `<span style="color:${c.color};font-weight:700">${c.label}</span> · ${open}<br>`+
          `${[p.DesTp_Desc, p.MngNm_Desc, acres].filter(Boolean).join(" · ")}<br>`+
          `<i>PAD-US boundaries are approximate — check the state's current maps and the signage at the parcel.</i></span>`;
        onTap(lyr, e => L.popup().setLatLng(e.latlng).setContent(html).openOn(map));
      }
    }).addTo(publicLand);
    padusKey = key;
  }catch(e){
    /* leave whatever is drawn; the basemap still shades public land */
  }finally{ padusBusy = false; }
}
map.on("moveend", loadPublicLand);
publicLand.on("add", () => { padusKey = null; loadPublicLand(); });
publicLand.on("remove", () => { publicLand.clearLayers(); padusKey = null; });

/* The icon layers are switched from the Map Icons menu (LAYER_CHIPS) only.
   The layer control keeps the basemaps and the river classes: once one chip
   came to drive two layers, a checkbox per layer there could split a chip in
   half. */

/* ============================================================
   ALL USGS GAUGES — every live discharge gauge in view
   Includes rivers this map doesn't carry. Tap one for a popup (not the river
   sheet): name, live CFS, reading time, and the same relative-to-median status
   the curated gauges get.

   - OFF by default. Each 1-degree cell is a request against the 1,000/hour
     anonymous budget, and the curated gauges already cost 17 a load plus
     their history for whatever is in view. Nobody pays for this until they
     ask for it.
   - Cached per 1-degree cell, and whole cells are fetched, not the viewport.
     A viewport bbox is different on every pan, so nothing would ever be
     reused; a cell is the same request however you arrive at it, so panning
     back and forth costs nothing for 15 minutes. If more than MAX_AG_CELLS
     cells are in view (zoomed too far out) nothing new is fetched.
   - Curated gauges are skipped: their dot already shows them, with the river
     sheet behind it, and a second marker would just sit underneath.
   - Discharge only (00060), like everything else here. Stage-only sites are
     never requested, so they never appear.
   - Statuses reuse statusOf()/fetchStatsBatch() unchanged. fetchStatsBatch
     only knows GAUGES keys, so a tapped site is registered under a temporary
     NON-ENUMERABLE key (invisible to Object.keys(GAUGES), so the refresh
     loops never see it) for the duration of that one call. */
const allGaugePane = map.createPane("allGaugePane");
allGaugePane.style.zIndex = 590;                 // under the curated dots (marker pane, 600)
const allGaugeLayer = L.layerGroup();            // off until switched on
const AG_MIN_ZOOM = 8, MAX_AG_CELLS = 12, AG_MAX_MARKERS = 400, AG_TTL_MS = 15*60*1000;
const AG_COLOR = "#5a7894";
const agCells = new Map();      // "lat,lng" -> {at, feats:[{id,lat,lng,cfs,time}]}
const agInflight = new Set();
const agMarkers = new Map();    // id -> circleMarker
const agNames = {};             // id -> monitoring_location_name
let agTimer = null;

const agBare = id => id.replace(/^USGS-/, "");
const agOn = () => map.hasLayer(allGaugeLayer) && !zonesShown && map.getZoom() >= AG_MIN_ZOOM;
const agEsc = s => String(s).replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function agCellsFor(b){
  const out = [];
  for(let la = Math.floor(b.getSouth()); la <= Math.floor(b.getNorth()); la++)
    for(let ln = Math.floor(b.getWest()); ln <= Math.floor(b.getEast()); ln++) out.push([la, ln]);
  return out;
}

async function agFetchCell(la, ln){
  const k = la+","+ln;
  agInflight.add(k);
  try{
    const j = await fetchJSON(apiURL("latest-continuous/items", {
      bbox: `${ln},${la},${ln+1},${la+1}`, parameter_code:"00060", limit:"500"
    }), 20000);
    const feats = [];
    (j.features||[]).forEach(f=>{
      const p = f.properties || {}, c = f.geometry && f.geometry.coordinates;
      const cfs = parseFloat(p.value);
      if(!c || !isFinite(cfs) || !p.monitoring_location_id) return;
      feats.push({id:p.monitoring_location_id, lat:c[1], lng:c[0], cfs, time:p.time});
    });
    agCells.set(k, {at:Date.now(), feats});
  }catch(e){ /* a missing cell is retried on the next move */ }
  finally{ agInflight.delete(k); }
}

async function agUpdate(){
  if(!agOn()){ agClear(); return; }
  const b = map.getBounds().pad(0.1);
  const cells = agCellsFor(b);
  const stale = cells.filter(([la,ln]) => {
    const c = agCells.get(la+","+ln);
    return (!c || Date.now()-c.at > AG_TTL_MS) && !agInflight.has(la+","+ln);
  });
  if(cells.length <= MAX_AG_CELLS && stale.length && !apiPaused()){
    for(const g of chunk(stale, 3)){
      if(apiPaused()) break;
      await Promise.all(g.map(([la,ln]) => agFetchCell(la, ln)));
      if(!agOn()) return;
      agDraw(b);                      // paint as cells land
    }
  }
  agDraw(b);
}

function agDraw(b){
  const curated = new Set(Object.keys(GAUGES).map(k => GAUGES[k].site));
  const c = b.getCenter(), want = new Map();
  agCellsFor(b).forEach(([la,ln])=>{
    const cell = agCells.get(la+","+ln);
    if(!cell) return;
    cell.feats.forEach(f=>{
      if(curated.has(f.id) || !b.contains([f.lat, f.lng]) || want.has(f.id)) return;
      want.set(f.id, f);
    });
  });
  // keep the 400 nearest the middle of the view
  const keep = [...want.values()]
    .sort((a,z) => (a.lat-c.lat)**2+(a.lng-c.lng)**2 - ((z.lat-c.lat)**2+(z.lng-c.lng)**2))
    .slice(0, AG_MAX_MARKERS);
  const keepIds = new Set(keep.map(f=>f.id));
  agMarkers.forEach((m,id)=>{ if(!keepIds.has(id)){ allGaugeLayer.removeLayer(m); agMarkers.delete(id); } });
  keep.forEach(f=>{
    if(agMarkers.has(f.id)) return;
    const m = L.circleMarker([f.lat, f.lng], {
      pane:"allGaugePane", radius:5, weight:1.5, color:"#fff", fillColor:AG_COLOR,
      fillOpacity:.95, interactive:true
    }).addTo(allGaugeLayer);
    m._ag = f;
    m.on("click", () => agOpen(m));
    agMarkers.set(f.id, m);
  });
}

function agClear(){ allGaugeLayer.clearLayers(); agMarkers.clear(); }

function agPopupHTML(f, key){
  const name = agNames[f.id];
  const t = new Date(f.time);
  const st = statusOf(key), s = stats[key];
  const cfs = f.cfs >= 100 ? Math.round(f.cfs) : +f.cfs.toFixed(1);
  /* latest-continuous by bbox also returns sites that stopped long ago, with
     their last value: that one is a dated last reading, not the big number */
  const old = st.cls === "old";
  const when = isNaN(t) ? "" : old ? `last reading <b>${cfs.toLocaleString()} cfs</b> · ${readingWhen(f.time)}`
             : "read " + t.toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
  const line = s || old ? `<span class="badge" style="background:${st.color}">${st.label}</span>`
             : s === null ? `<span class="ag-note">No history to compare</span>`
             : `<span class="ag-note">Comparing with the last 7 years…</span>`;
  return `<div class="ag-pop"><div class="gname">USGS ${agEsc(name || f.id)}</div>`+
    `<div class="flowrow"><span class="cfs">${old ? "—" : cfs.toLocaleString()} <small>cfs</small></span>${line}</div>`+
    `<div class="ag-note">${when}</div>`+
    `<a href="https://waterdata.usgs.gov/monitoring-location/${agBare(f.id)}/" target="_blank" rel="noopener">USGS station page</a></div>`;
}

function agOpen(m){
  const f = m._ag, key = "ag:"+f.id;
  if(typeof Metrics !== "undefined") Metrics.track("gauge_tap", f.id);
  // the reading we already have, so statusOf() can compare it
  flows[key] = {cfs:f.cfs, time:f.time, fetchedAt:Date.now(), stale:false};
  const refresh = () => { if(m.isPopupOpen && m.isPopupOpen()) m.getPopup().setContent(agPopupHTML(f, key)); };
  if(!m.getPopup()) m.bindPopup("", {maxWidth:260, className:"ag-popup"});
  m.getPopup().setContent(agPopupHTML(f, key));
  m.openPopup();
  if(!agNames[f.id]){
    const c = store.get("agname:"+f.id);
    if(c){ agNames[f.id] = c; refresh(); }
    else if(!apiPaused()){
      fetchJSON(apiURL("monitoring-locations/items", {id:f.id, limit:"2"}), 12000).then(j=>{
        const p = j.features && j.features[0] && j.features[0].properties;
        if(p && p.monitoring_location_name){
          agNames[f.id] = p.monitoring_location_name;
          store.set("agname:"+f.id, agNames[f.id]);
          refresh();
        }
      }).catch(()=>{});
    }
  }
  // a site that stopped reporting has no reading to compare, so don't spend requests on its history
  if(stats[key] === undefined && !apiPaused() && !readingIsOld(f)){
    const hide = {value:undefined, enumerable:false, configurable:true, writable:true};
    Object.defineProperty(GAUGES, key, {...hide, value:{site:f.id, label:f.id}});
    KEY_BY_SITE[f.id] = key;
    fetchStatsBatch([key]).finally(()=>{
      delete GAUGES[key]; delete KEY_BY_SITE[f.id];
      refresh();
    });
  }
}

function agSchedule(){ clearTimeout(agTimer); agTimer = setTimeout(agUpdate, 600); }
map.on("moveend", agSchedule);
allGaugeLayer.on("add", agSchedule);
allGaugeLayer.on("remove", agClear);

/* ============================================================
   STATIC TILED DATA — the pattern for layers too big for a JS file
   This app has no backend, so a large dataset is pre-cut at build time into
   1-degree cells and served as plain static files:
       data/<layer>/index.json            ["45_-112", …]  cells that exist
       data/<layer>/<floor(lat)>_<floor(lng)>.json   [row, row, …]
   makeTiledLayer() is the whole client: it reads the index once (the first
   time the layer is switched on), and on each pause in panning fetches only
   the cells under the view (padded 20%), keeps the latest ~40 in memory,
   and draws markers for the cells in view alone. A layer is one call with a
   `rowToMarker`; the next big layer should be too. URLs are RELATIVE — the
   site lives at a sub-path on GitHub Pages. sw.js caches cells cache-first
   (they never change within a release), so viewed areas work offline.
   Fails quietly: a missing index or cell just means the layer shows nothing.
   - Off-view cells are cheap to keep and costly to draw, so markers are
     built once per cell and added/removed as the cell enters/leaves view.
   - If the view needs more than maxCells cells (zoomed too far out for the
     layer's density) nothing is fetched; cells already loaded still draw. */
/* One fetch per URL, shared by every layer reading the same directory (the
   three POI layers use one set of cells). A failure is forgotten so the next
   move retries it. `filter` keeps only some rows of a cell for this layer. */
const TILE_JSON = new Map();
function tileJSON(url){
  if(!TILE_JSON.has(url))
    TILE_JSON.set(url, fetch(url).then(r => r.ok ? r.json() : Promise.reject())
      .catch(e => { TILE_JSON.delete(url); throw e; }));
  return TILE_JSON.get(url);
}
function makeTiledLayer({dir, minZoom, maxCells, pane, rowToMarker, filter}){
  const group = L.layerGroup();
  const rows = new Map();        // cell key -> rows (insertion order = age)
  const drawn = new Map();       // cell key -> [markers currently in `group`]
  const inflight = new Set();
  const KEEP = 40, PARALLEL = 4;
  let index = null, indexP = null, timer = null;

  const on = () => map.hasLayer(group) && !zonesShown && map.getZoom() >= minZoom;
  function loadIndex(){
    if(!indexP) indexP = tileJSON(dir + "/index.json")
      .then(a => { index = new Set(a); }, () => { indexP = null; });   // retry next time
    return indexP;
  }
  async function fetchCell(k){
    inflight.add(k);
    try{
      const all = await tileJSON(dir + "/" + k + ".json");
      {
        rows.set(k, filter ? all.filter(filter) : all);
        while(rows.size > KEEP){
          const old = rows.keys().next().value;       // oldest that isn't on screen
          const gone = [...rows.keys()].find(c => !drawn.has(c));
          const victim = gone !== undefined ? gone : old;
          rows.delete(victim); undraw(victim);
        }
      }
    }catch(e){ /* retried on the next move */ }
    finally{ inflight.delete(k); }
  }
  function undraw(k){
    (drawn.get(k) || []).forEach(m => group.removeLayer(m));
    drawn.delete(k);
  }
  function draw(keys){
    const want = new Set(keys);
    [...drawn.keys()].forEach(k => { if(!want.has(k)) undraw(k); });
    keys.forEach(k => {
      if(drawn.has(k) || !rows.has(k)) return;
      const ms = [];
      rows.get(k).forEach(row => { const m = rowToMarker(row); if(m){ m.addTo(group); ms.push(m); } });
      drawn.set(k, ms);
    });
  }
  async function update(){
    if(!on()){ draw([]); return; }
    await loadIndex();
    if(!index || !on()) return;
    const b = map.getBounds().pad(0.2), cells = [];
    for(let la = Math.floor(b.getSouth()); la <= Math.floor(b.getNorth()); la++)
      for(let ln = Math.floor(b.getWest()); ln <= Math.floor(b.getEast()); ln++){
        const k = la + "_" + ln;
        if(index.has(k)) cells.push(k);
      }
    const need = cells.filter(k => !rows.has(k) && !inflight.has(k));
    if(need.length && need.length <= maxCells){
      for(const g of chunk(need, PARALLEL)){
        await Promise.all(g.map(fetchCell));
        if(!on()) return;
        draw(cells);                       // paint as cells land
      }
    }
    draw(cells);
  }
  const schedule = () => { clearTimeout(timer); timer = setTimeout(update, 300); };
  map.on("moveend", schedule);
  group.on("add", schedule);
  group.on("remove", () => draw([]));
  return group;
}

/* ============================================================
   BRIDGE ACCESS — public-owned bridges over water (data/bridges/)
   FHWA National Bridge Inventory 2025, public owners only, canals and
   ditches removed. Row: [lat, lng, water, road, owner, year, state].
   A bridge is where a public road crosses the water, which is how most
   people get to a stretch they can't otherwise reach — but it is NOT an
   access sign, and whether you may step off it varies by state, so the popup
   leads with that state's rule (ACCESS_LAW) rather than implying access.
   Iowa and Illinois can have thousands of rows in one cell, hence plain
   circleMarkers on one canvas renderer instead of a DOM node apiece. Warm
   grey-brown: orange is the live-data readout, red is closed water. */
const BR_COLOR = "#8a7560";
const bridgePane = map.createPane("bridgePane");
bridgePane.style.zIndex = 580;                   // over the rivers, under every dot
const bridgeRenderer = L.canvas({pane:"bridgePane", padding:.3});
function bridgePopupHTML(row){
  const [, , water, road, owner, year, st] = row;
  const law = typeof ACCESS_LAW !== "undefined" && ACCESS_LAW[st];
  return `<div class="ag-pop tl-pop">`+
    `<div class="tl-title">${fbEsc(water || "Unnamed waterway")}</div>`+
    (road ? `<div>${fbEsc(road)} bridge</div>` : `<div>Bridge</div>`)+
    `<div class="ag-note">${fbEsc(owner || "Public")}${year ? " · built " + fbEsc(year) : ""}</div>`+
    (law ? `<div class="tl-label">Access from a bridge isn’t automatic — in ${fbEsc(STATE_NAME[st] || st)}:</div>`+
           `<div>${fbEsc(law.head)}</div>` : "")+
    `<div class="ag-note">Bridge location from the National Bridge Inventory; it is not a parking or access sign.</div></div>`;
}
const bridgeLayer = makeTiledLayer({
  dir:"data/bridges", minZoom:11, maxCells:9, pane:"bridgePane",
  rowToMarker: row => L.circleMarker([row[0], row[1]], {
      renderer:bridgeRenderer, pane:"bridgePane", radius:4.5, weight:1.5, color:"#fff",
      fillColor:BR_COLOR, fillOpacity:.95
    }).bindPopup(() => bridgePopupHTML(row), {maxWidth:270, className:"ag-popup"})
});
/* The canvas takes no taps; bridges are matched to a tap here instead.
   A Leaflet canvas answers every tap that lands on it, bridge or not, and
   passes none of them down — and its renderer stays on the map after the
   layer is switched off. So once bridges had been on (which every open
   river now does), the canvas sat over the rivers, the falls and dams, the
   parking pins and the region chooser, and none of them could be tapped:
   tapping a second river didn't open it, and tapping a state didn't enter
   it. Now the pane is pass-through and a map tap within BR_HIT_PX of a
   drawn bridge opens that bridge. It beats a river line tapped at the same
   spot (the bridge is drawn on top: cancelTap() stops the river's delayed
   open) and loses to any marker, since markers don't pass a tap to the map. */
bridgePane.style.pointerEvents = "none";
const BR_HIT_PX = 10;
map.on("click", e => {
  if(zonesShown || !map.hasLayer(bridgeLayer) || !e.containerPoint) return;
  let best = null, bestD = BR_HIT_PX;
  bridgeLayer.eachLayer(m => {
    const d = map.latLngToContainerPoint(m.getLatLng()).distanceTo(e.containerPoint);
    if(d < bestD){ bestD = d; best = m; }
  });
  if(best){ cancelTap(); best.openPopup(); }
});

/* ============================================================
   WATERFALLS, RAPIDS & DAMS — a safety layer (data/hazards/)
   USGS National Hydrography Dataset. Row: [lat, lng, type, name|null],
   type "falls" | "rapids" | "dam". Off at launch like every Map Icons layer,
   but it comes on whenever a river's sheet is open: knowing there is a
   low-head dam below the next bend matters more than any other marker here,
   and the open river is the water you are about to be on. Glyphs are
   inline SVG with a white outline so they read over blue topo water; they sit
   in a pane above the rivers (410) and below the markers (600). */
const hazardPane = map.createPane("hazardPane");
hazardPane.style.zIndex = 430;
const HZ_COLOR = "#3b4a56";
const HZ_GLYPH = {
  falls:  `<polyline points="3,4 8,4 8,9 13,9 13,14 16,14"`,         // stepped drop
  rapids: `<path d="M2 6q2-3 4 0t4 0t4 0M2 12q2-3 4 0t4 0t4 0"`,      // wavy lines
  dam:    `<rect x="2.5" y="6.5" width="13" height="5" rx="1"`,       // solid bar
};
const HZ_LABEL = {falls:"Waterfall", rapids:"Rapids", dam:"Dam or weir"};
function hazardIcon(type){
  const g = HZ_GLYPH[type] || HZ_GLYPH.dam;
  const shape = (extra) => g + ` fill="none" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`;
  const svg = type === "dam"
    ? `<svg viewBox="0 0 18 18" width="18" height="18">${g} fill="${HZ_COLOR}" stroke="#fff" stroke-width="2"/></svg>`
    : `<svg viewBox="0 0 18 18" width="18" height="18">${shape('stroke="#fff" stroke-width="4.6"')}${shape(`stroke="${HZ_COLOR}" stroke-width="2.2"`)}</svg>`;
  return L.divIcon({className:"hz-icon", html:svg, iconSize:[18,18], iconAnchor:[9,9], popupAnchor:[0,-9]});
}
function hazardPopupHTML(row){
  const [, , type, name, x] = row;       // x (optional): {s source, k DNR dam type, h height ft, p portage, r river, l location}
  const say = type === "rapids"
    ? "Rapids — difficulty changes with flow. Scout first."
    : "Scout before you float — portage if in doubt. Low-head dams are deadly at almost any flow.";
  const facts = x ? [x.k ? fbEsc(x.k) : "", x.h ? "about " + fbEsc(x.h) + " ft high" : ""].filter(Boolean).join(" · ") : "";
  return `<div class="ag-pop tl-pop">`+
    `<div class="tl-title">${HZ_LABEL[type] || "Hazard"}</div>`+
    (name ? `<div>${fbEsc(name)}</div>` : "")+
    (x && (x.r || x.l) ? `<div class="ag-note">${[x.r, x.l].filter(Boolean).map(fbEsc).join(" — ")}</div>` : "")+
    (facts ? `<div>${facts}</div>` : "")+
    (x && x.p ? `<div><b>Portage:</b> ${fbEsc(x.p.charAt(0).toLowerCase() + x.p.slice(1))}</div>` : "")+
    `<div class="tl-warn">${say}</div>`+
    `<div class="ag-note">Source: ${x && x.s ? "Iowa DNR Paddling Hazards (Dams) layer" : "USGS National Hydrography Dataset"}.</div></div>`;
}
const hazardLayer = makeTiledLayer({
  dir:"data/hazards", minZoom:10, maxCells:9, pane:"hazardPane",
  rowToMarker: row => L.marker([row[0], row[1]], {icon:hazardIcon(row[2]), pane:"hazardPane", keyboard:false})
    .bindPopup(() => hazardPopupHTML(row), {maxWidth:270, className:"ag-popup"})
});

/* ============================================================
   PARKING, CAMPSITES & TRAILHEADS (data/poi/) — three layers, one set of cells
   OpenStreetMap. Row: [lat, lng, type, name|null, river_id|null, extra|null],
   type "parking" | "camp" | "trailhead". Each layer filters the shared cells
   by type. All off by default (they are a lot of pins) and from zoom 11.
   Glyphs are small inline SVG with a white outline, in a pane between the
   hazards (430) and the markers (600). Colours avoid orange (live data),
   red (closures) and the public-land greens. */
const poiPane = map.createPane("poiPane");
poiPane.style.zIndex = 440;
const POI = {
  parking:   {label:"Parking",    none:"Unnamed parking",    color:"#5d7a70",
              glyph:`<rect x="2" y="2" width="14" height="14" rx="3.5" fill="C" stroke="#fff" stroke-width="1.6"/><path d="M7 13V5h2.6a2.3 2.3 0 010 4.6H7" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>`},
  camp:      {label:"Campsite",   none:"Unnamed campsite",   color:"#0e6b55",
              glyph:`<path d="M9 2L1.5 15.5h15z" fill="C" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/><path d="M9 7.5l-2.6 8h5.2z" fill="#fff"/>`},
  trailhead: {label:"Trailhead",  none:"Unnamed trailhead",  color:"#7a5230",
              glyph:`<rect x="8" y="2" width="2" height="15" rx="1" fill="C" stroke="#fff" stroke-width="1.2"/><path d="M10 3.5h6l1.6 2.2L16 7.9h-6z" fill="C" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 9.5H2.4L.8 11.7 2.4 13.9H8z" fill="C" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/>`},
};
function poiIcon(type){
  const d = POI[type];
  return L.divIcon({className:"hz-icon", iconSize:[18,18], iconAnchor:[9,9], popupAnchor:[0,-9],
    html:`<svg viewBox="0 0 18 18" width="18" height="18">${d.glyph.replace(/"C"/g, `"${d.color}"`)}</svg>`});
}
function poiPopupHTML(row){
  const [, , type, name, rid, extra] = row, d = POI[type] || POI.parking;
  const rv = rid && RIVERS.find(x => x.id === rid);
  return `<div class="ag-pop tl-pop">`+
    `<div class="tl-label" style="margin-top:0">${d.label.toUpperCase()}</div>`+
    `<div class="tl-title">${fbEsc(name || d.none)}</div>`+
    (extra ? `<div>${fbEsc(extra)}</div>` : "")+
    (rv ? `<div class="ag-note">Near <a href="#" class="poi-river" data-rid="${fbEsc(rv.id)}">${fbEsc(rv.name)}</a></div>` : "")+
    `<div class="ag-note">From OpenStreetMap — check signs; access can change.</div></div>`;
}
const poiLayers = {};
Object.keys(POI).forEach(type => {
  poiLayers[type] = makeTiledLayer({
    dir:"data/poi", minZoom:11, maxCells:9, pane:"poiPane", filter: row => row[2] === type,
    rowToMarker: row => L.marker([row[0], row[1]], {icon:poiIcon(type), pane:"poiPane", keyboard:false})
      .bindPopup(() => poiPopupHTML(row), {maxWidth:270, className:"ag-popup"})
  });
});
document.addEventListener("click", e => {
  const a = e.target.closest && e.target.closest("a.poi-river"); if(!a) return;
  e.preventDefault(); map.closePopup(); openRiver(a.dataset.rid);
});

/* ============================================================
   EXACT RIVER GEOMETRY — live USGS NHD high-resolution flowlines
   Pulls the real channel linework (1:24,000 NHD, layer 6) from The
   National Map and replaces the built-in approximation. The built-in
   hand-digitized line stays as the offline/failure fallback, so the
   map always shows something even with no cell service in a canyon.
   Geometry is simplified server-side (maxAllowableOffset) and cached
   ~30 days in local storage so it loads instantly next time.
   ============================================================ */
const NHD_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query";
const NHD_TIMEOUT = 9000;
// GNIS_NAME keyword per river; others derive from the river name.
const NHD_KEYWORD = {
  snake:"SNAKE RIVER", southfork:"SNAKE RIVER", snakeid:"SNAKE RIVER",
  hellscanyon:"SNAKE RIVER", teton:"TETON RIVER", grosventre:"GROS VENTRE RIVER",
  hoback:"HOBACK RIVER", flatcreek:"FLAT CREEK", buffalofork:"BUFFALO FORK",
  salt:"SALT RIVER", greys:"GREYS RIVER", henrysfork:"HENRYS FORK",
  fallriver:"FALL RIVER", sfboise:"SOUTH FORK BOISE RIVER",
  nfpayette:"NORTH FORK PAYETTE RIVER", sfpayette:"SOUTH FORK PAYETTE RIVER",
  mfsalmon:"MIDDLE FORK SALMON RIVER", sfclearwater:"SOUTH FORK CLEARWATER RIVER",
  nfclearwater:"NORTH FORK CLEARWATER RIVER", nfshoshone:"NORTH FORK SHOSHONE RIVER",
  clarksfork:"CLARKS FORK YELLOWSTONE RIVER", cda:"COEUR D'ALENE RIVER",
  bighorn:"BIGHORN RIVER", wind:"WIND RIVER", nplatteupper:"NORTH PLATTE RIVER",
  nplattereef:"NORTH PLATTE RIVER", green:"GREEN RIVER", newfork:"NEW FORK RIVER",
  /* Driftless — where the display name doesn't match the GNIS name.
     Everything else derives correctly from the river name (the bbox
     around each stream keeps same-named creeks in other counties out). */
  troutrunia:"TROUT RUN",                 // Iowa's is GNIS "Trout Run", not "Trout Run Creek"
  troutrunmn:"TROUT RUN",                 // and so is Minnesota's, in Fillmore County
  bloodyrun:"BLOODY RUN",                 // GNIS "Bloody Run", not "Bloody Run Creek"
  springbranchia:"SPRING BRANCH",
  richmondsprings:"MAQUOKETA RIVER",      // Richmond Springs feeds the Maquoketa in Backbone SP
  castlerock:"FENNIMORE FORK",            // locally "Castle Rock Creek"; GNIS calls it the
                                          // Fennimore Fork (of the Blue River), Grant County WI
  wforkkickapoo:"WEST FORK KICKAPOO RIVER",
  sbranchroot:"SOUTH BRANCH ROOT RIVER",
  nbranchroot:"NORTH BRANCH ROOT RIVER",
  mbranchroot:"MIDDLE BRANCH ROOT RIVER",
  sfroot:"SOUTH FORK ROOT RIVER",
  nfwhitewater:"NORTH FORK WHITEWATER RIVER",
  mfwhitewater:"MIDDLE FORK WHITEWATER RIVER",
  sfwhitewater:"SOUTH FORK WHITEWATER RIVER",
  ebpecatonica:"EAST BRANCH PECATONICA RIVER",
};
function riverKeyword(r){
  const raw = NHD_KEYWORD[r.id] ||
    r.name.split("—")[0].split("(")[0].replace(/&amp;[^]*$/,"").trim();
  // GNIS always spells it out — "Saint Croix River", never "St. Croix River".
  // Without this the St. Croix, St. Louis and St. Joe all silently match nothing.
  return raw.replace(/\bST\.?\s+/i, "SAINT ").toUpperCase();
}
function bboxOf(coords, pad){
  pad = pad||0.025;
  let a=90,b=-90,c=180,d=-180;
  coords.forEach(p=>{a=Math.min(a,p[0]);b=Math.max(b,p[0]);c=Math.min(c,p[1]);d=Math.max(d,p[1]);});
  return [c-pad, a-pad, d+pad, b+pad];   // xmin,ymin,xmax,ymax (lng/lat)
}
function nhdURL(where, bb, offset){
  return `${NHD_URL}?where=${encodeURIComponent(where)}&geometry=${bb.join(",")}`+
    `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`+
    `&outFields=GNIS_NAME&returnGeometry=true&outSR=4326`+
    `&maxAllowableOffset=${offset || 0.0006}&geometryPrecision=5&resultRecordCount=4000&f=geojson`;
}
function nhdSegments(j){
  const segs = [];
  (j.features||[]).forEach(f=>{
    const g = f.geometry; if(!g) return;
    if(g.type==="LineString") segs.push(g.coordinates.map(c=>[c[1],c[0]]));
    else if(g.type==="MultiLineString") g.coordinates.forEach(l=>segs.push(l.map(c=>[c[1],c[0]])));
  });
  return segs;
}
async function loadRealRiver(r){
  const layer = riverLayers[r.id];
  if(!layer || layer.real || layer.tried) return;
  /* Geometry from a state fisheries agency outranks NHD and must not be
     overwritten by it. NHD draws the whole creek; the DNR layer draws the
     reach that is actually designated trout water, which is the reach you
     may fish. It also disambiguates names NHD can't — a plain
     "BEAR CREEK" lookup in this corner of Iowa can match any of four
     different Bear Creeks, and there is another one in Door County. */
  // "iadnr" (NE Iowa), "iawt" (Iowa water trails), "widnr" (Door Peninsula)… — any tag: leave it alone
  if(r.geom){ layer.real = true; layer.tried = true; return; }
  layer.tried = true;
  const ck = "nhd:"+r.id;
  const cached = store.get(ck);
  if(cached && cached.g && (Date.now()-(cached.t||0) < GEOM_CACHE_MS)){
    layer.line.setLatLngs(cached.g); layer.real = true; return;
  }
  const bb = bboxOf(flatCoords(r.coords));
  // ' is the SQL string delimiter — doubling escapes it. Stripping it (the old
  // behaviour) turned "Coeur d'Alene River" into a name that matches nothing.
  const kw = riverKeyword(r).replace(/%/g,"").replace(/'/g,"''");
  try{
    // Exact GNIS name first. LIKE '%SALMON RIVER%' also drags in the Little
    // Salmon, the East Fork, the Middle Fork and so on, so the river you tapped
    // gets drawn as a web of its own tributaries rather than a channel. Fall
    // back to LIKE only when the exact name matches nothing — some streams
    // (the Bad Axe, Castle Rock) exist in NHD only as their named forks.
    // Short timeout on purpose. A healthy NHD query answers in ~1.5s; when
    // the service is having a bad day it hangs instead of refusing, and a
    // long timeout parks one of the few concurrent slots doing nothing.
    // Failing fast and sweeping again beats waiting.
    let segs = nhdSegments(await fetchJSON(nhdURL(`UPPER(GNIS_NAME) = '${kw}'`, bb), NHD_TIMEOUT));
    if(!segs.length){
      segs = nhdSegments(await fetchJSON(nhdURL(`UPPER(GNIS_NAME) LIKE '%${kw}%'`, bb), NHD_TIMEOUT));
    }
    if(segs.length){
      layer.line.setLatLngs(segs);
      layer.real = true;
      store.set(ck, {g:segs, t:Date.now()});
    } else {
      layer.tried = false;   // nothing matched (likely a name miss) — allow a later retry
    }
  }catch(e){
    layer.tried = false;     // network/CORS failure — keep fallback, retry later
  }
}
/* Background pass that fills the map in with real linework.
   Two things matter here: what order, and how fast.

   Order — rivers you can actually see come first. Re-sorted on every map
   move, so panning to a new area snaps that area next instead of waiting
   out the rest of the queue.

   Speed — this used to run strictly one river at a time with a 500ms gap,
   which is ~93 seconds to cover 181 rivers. Long enough that the straight
   fallback lines looked like the finished map. A few in flight at once
   with a short gap covers the visible area in a second or two while still
   being gentle on The National Map. */
const GEOM_CONCURRENCY = 5, GEOM_GAP = 60;
let geomQueue = null, geomRunning = 0;
function visibleFirst(list){
  const b = map.getBounds();
  const seen = r => flatCoords(r.coords).some(p => b.contains(p));
  return list.slice().sort((a, c) => (seen(c) ? 1 : 0) - (seen(a) ? 1 : 0));
}
/* The National Map drops a fair share of requests when several are in
   flight — the failure surfaces in the browser as a CORS error, because an
   error response from the CDN comes back without the CORS header the good
   ones carry. loadRealRiver() already resets `tried` on failure so the
   river is eligible again; these sweeps are what actually retry it, rather
   than leaving a third of the map straight until you happen to pan. */
const GEOM_SWEEPS = 6, GEOM_SWEEP_GAP = 5000;
let geomSweeps = 0;
/* ============================================================
   ZOOM REFINEMENT — a closer look deserves a truer line.

   The baked geometry is simplified for load time: the first NHD snap asks
   for 0.0006 degrees of tolerance, about 66 m, which is a pixel at zoom 8
   and twenty-seven of them at zoom 15. So once you are actually looking at
   a single river, it is re-fetched at 0.00005 (~5 m) and redrawn.

   Two guards on what may be refined:

   * `iadnr` / `iawt` / `widnr` / `midnr` / `wgfd` / `pfbc` / `nydec` / `vdwr` / `mdc` rivers are never touched. Those lines are the state
     fisheries agency's own drawing of the reach that is *designated trout
     water*, which is a different claim from "where the channel runs", and
     NHD would happily replace it with the whole creek or the wrong Bear
     Creek entirely. Agency geometry stays exactly as the agency drew it.
   * `nhd` rivers were clipped to a park or a state boundary when they were
     baked. A fresh fetch does not know about that clip, so the refined
     geometry is filtered to what lies within REFINE_BUFFER_KM of the line
     already drawn. Detail is added; reach is never extended.
   ============================================================ */
const REFINE_ZOOM = 13;
/* 0.0002 deg is ~22 m: three times finer than the 0.0006 the first snap
   asks for, and a fraction of the payload of a truly fine 5 m fetch, which
   the service will not answer for a river the size of the Snake. */
const NHD_FINE = 0.0002;
/* A refinement is worth waiting longer for than the background snap: you
   asked for it by zooming in, and a slow answer still improves the map. */
const REFINE_TIMEOUT = 20000;
const REFINE_BUFFER_KM = 0.15;
const REFINE_AT_ONCE = 2;
let refineRunning = 0;

function nearPolyline(p, run, tolKm){
  for(let i = 0; i < run.length; i++){
    if(distKm(p, run[i]) <= tolKm) return true;     // vertex proximity is
  }                                                  // enough at these scales
  return false;
}
function clipToDrawn(segs, drawnRuns){
  /* keep only the parts of a fresh fetch that retrace what is already
     drawn, so a park or state clip survives the refresh */
  const out = [];
  segs.forEach(seg => {
    let cur = [];
    seg.forEach(p => {
      const near = drawnRuns.some(run => nearPolyline(p, run, REFINE_BUFFER_KM));
      if(near) cur.push(p);
      else { if(cur.length > 1) out.push(cur); cur = []; }
    });
    if(cur.length > 1) out.push(cur);
  });
  return out;
}
/* Full-resolution OSM ways for a river, by its own OSM name(s), welded where
   ways share an end node. Overpass sends CORS headers; one small query per
   river, only at REFINE_ZOOM, cached for a month like the NHD refinement. */
const OVERPASS = "https://overpass-api.de/api/interpreter";
async function osmSegments(r, bb){
  const names = (r.osmName || r.name.replace(/\s*\(.*\)\s*/g, "")).split("|");
  const box = `(${bb[1]},${bb[0]},${bb[3]},${bb[2]})`;
  const q = `[out:json][timeout:25];(${names.map(n =>
    `way["waterway"~"^(river|stream)$"]["name"="${n.replace(/\\/g,"\\\\").replace(/"/g,'\\"')}"]${box};`).join("")});out geom;`;
  const ctl = new AbortController(); const t = setTimeout(()=>ctl.abort(), REFINE_TIMEOUT);
  let js;
  try{
    const res = await fetch(OVERPASS, {method:"POST", signal:ctl.signal, body:"data="+encodeURIComponent(q),
                                       headers:{"Content-Type":"application/x-www-form-urlencoded"}});
    if(!res.ok) throw new Error("HTTP "+res.status);
    js = await res.json();
  } finally { clearTimeout(t); }
  let runs = (js.elements || []).filter(e => e.type === "way" && e.geometry && e.geometry.length > 1)
                                 .map(e => e.geometry.map(p => [p.lat, p.lon]));
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  let joined = true;
  while(joined){
    joined = false;
    outer: for(let i = 0; i < runs.length; i++) for(let j = 0; j < runs.length; j++){
      if(i === j) continue;
      if(same(runs[i][runs[i].length-1], runs[j][0])){
        runs[i] = runs[i].concat(runs[j].slice(1)); runs.splice(j, 1); joined = true; break outer;
      }
    }
  }
  return runs;
}

async function refineRiver(r){
  const layer = riverLayers[r.id];
  if(!layer || layer.refined || layer.refining) return;
  /* Agency geometry is left alone: for iadnr/widnr the line IS the
     designated trout reach, and NHD would replace it with the whole creek.
     iawt is the Iowa DNR's (or ICON's) drawing of a designated water trail,
     which starts and stops where the designation does, not where the river does.
     wgfd is Wyoming Game & Fish's own line for the water it rates, and a
     Grand Teton creek extended past the park on it must not be clipped back
     to the park by a cached NHD refinement. nydec is NYSDEC's own line for
     each reach it manages as trout water, gaps and all.
     OSM rivers are refined from OSM itself, never from NHD -- mixing two
     sources along one channel fragments the line wherever they disagree by
     more than REFINE_BUFFER_KM. The baked OSM line is simplified (40 m, 80 m
     in Alaska); the refinement is the same ways at full resolution. */
  if(r.geom === "iadnr" || r.geom === "iawt" || r.geom === "widnr" || r.geom === "midnr" || r.geom === "wgfd" || r.geom === "pfbc" || r.geom === "nydec" || r.geom === "vdwr" || r.geom === "mdc"){ layer.refined = true; return; }
  layer.refining = true;
  const ck = "nhdfine:" + r.id;
  const cached = store.get(ck);
  if(cached && cached.g && (Date.now() - (cached.t || 0) < GEOM_CACHE_MS)){
    layer.line.setLatLngs(cached.g);
    layer.refined = true; layer.refining = false;
    syncFlow();
    return;
  }
  try{
    const drawn0 = layer.line.getLatLngs();
    const drawnRuns = (Array.isArray(drawn0[0]) ? drawn0 : [drawn0]);
    const bb = bboxOf(flatCoords(r.coords));
    const kw = riverKeyword(r).replace(/%/g,"").replace(/'/g,"''");
    let segs = r.geom === "osm" ? await osmSegments(r, bb)
             : nhdSegments(await fetchJSON(nhdURL(`UPPER(GNIS_NAME) = '${kw}'`, bb, NHD_FINE), REFINE_TIMEOUT));
    if(segs.length){
      if(r.geom) segs = clipToDrawn(segs, drawnRuns);
      // a refinement that loses most of the river is a bad match, not a better line
      const len = rs => rs.reduce((t, run) =>
        t + run.reduce((u, p, i) => i ? u + distKm(run[i-1], p) : 0, 0), 0);
      if(segs.length && len(segs) > len(drawnRuns) * 0.6){
        layer.line.setLatLngs(segs);
        layer.refined = true;
        store.set(ck, {g:segs, t:Date.now()});
        syncFlow();
      } else {
        layer.refined = true;       // nothing better on offer; stop asking
      }
    }
  }catch(e){ /* leave it; a later pass can try again */ }
  layer.refining = false;
}
function refineVisible(){
  if(map.getZoom() < REFINE_ZOOM || zonesShown) return;
  const view = map.getBounds();
  for(const r of RIVERS){
    if(refineRunning >= REFINE_AT_ONCE) break;
    const layer = riverLayers[r.id];
    if(!layer || layer.refined || layer.refining || !riverVisible(r)) continue;
    if(!view.intersects(layer.line.getBounds())) continue;
    refineRunning++;
    refineRiver(r).finally(() => { refineRunning--; });
  }
}
map.on("zoomend moveend", refineVisible);

function trickleGeometry(){
  if(geomQueue) return;
  geomQueue = visibleFirst(RIVERS);
  const pump = async () => {
    while(geomRunning < GEOM_CONCURRENCY && geomQueue && geomQueue.length){
      const r = geomQueue.shift();
      geomRunning++;
      loadRealRiver(r).finally(() => {
        geomRunning--;
        if(geomQueue && (geomQueue.length || geomRunning)) setTimeout(pump, GEOM_GAP);
        else if(geomQueue && !geomQueue.length && !geomRunning){
          geomQueue = null;
          // anything that failed transiently is now retryable — sweep again
          const left = RIVERS.some(r => !riverLayers[r.id].real && riverLayers[r.id].tried === false);
          if(left && geomSweeps < GEOM_SWEEPS){
            geomSweeps++;
            setTimeout(trickleGeometry, GEOM_SWEEP_GAP);
          }
        }
      });
    }
  };
  pump();
}
// panning somewhere new re-prioritises whatever is now on screen
map.on("moveend", () => {
  if(geomQueue && geomQueue.length) geomQueue = visibleFirst(geomQueue);
  else if(!geomQueue && RIVERS.some(r => !riverLayers[r.id].real)){
    geomSweeps = 0;                 // a deliberate move earns a fresh set of sweeps
    trickleGeometry();
  }
});

/* ============================================================
   UI — sheet, filters, legend, refresh
   ============================================================ */
const $ = s => document.querySelector(s);
const sheet=$("#sheet"), body=$("#sheetbody");
let curRiver = null;

/* "Idaho", "Wisconsin · Driftless Area" — the sheet subtitle, shared with the
   Field Book rows so the two can't drift apart. */
function riverPlace(r){
  const subRegion = (PARK_INFO[r.region] && PARK_INFO[r.region].sub)
                    // Iowa water trails run statewide now, so "Central" no longer fits them all
                    || (r.state==="IA" && r.region!=="driftless" && r.waterTrail ? " · Water trail" : "");
  return (STATE_NAME[r.state] || r.state) + subRegion;
}
function riverStateName(r){ return riverPlace(r).split(" · ")[0]; }
/* "Wyoming · Yellowstone · lake" — the lake sheet's subtitle, shared with the
   Field Book rows the same way. A lake that names no PARK_INFO row reads as
   Yellowstone's, the first lakes the sheet was written for. */
function lakePlace(k){
  const pk = PARK_INFO[k.park] || PARK_INFO.yellowstone;
  return (STATE_NAME[k.state] || k.state) + pk.sub + " · lake";
}
/* A lake opened from the Field Book is framed the way a river is: in the part
   of the map the sheet and the controls leave clear (focusFrame). */
function frameLake(k){
  const s = lakeShapes[k.id]; if(!s) return;
  const {tl, br} = focusFrame();
  goTo(s.poly.getBounds(), null, {paddingTopLeft:tl, paddingBottomRight:br, maxZoom:FOCUS_MAX_ZOOM});
}

/* opts.fit === false opens the sheet without moving the map — the tour, and
   the tour putting back a river that was open before it. A gauge tap
   (focusGauge) pans to that gauge instead, and a live float keeps the map on
   the boat; every other way in is someone choosing this river, so the map
   frames it (focusRiver). opts.at is where on the river they chose it — the
   point tapped on the line, or the access pin tapped — which is what a river
   too long to show whole is framed on (fitFocus). */
async function openRiver(id, focusGauge, opts){
  const r = RIVERS.find(x=>x.id===id); if(!r) return;
  curRiver = id;
  if(curLake){ curLake = null; if(speciesPick) syncLakeFilter(); }   // the lake's sheet is gone: the filter has it again
  if(!tierShown(r)){ tempShown.add(id); applyFilters(); }   // opened on purpose: show it
  $("#sw").style.background = riverColor(r);
  $("#sh-title").textContent = r.name;
  $("#sh-sub").textContent = riverPlace(r);
  fbShowRow(r);
  sheet.classList.add("open");
  if(typeof Metrics !== "undefined" && !(opts && opts.demo)) Metrics.track("river_open", r.id, r.name);   // the tour's Snake is a demo
  loadRealRiver(r);                    // snap this river to exact USGS linework
  const floating = typeof floatActiveNow === "function" && floatActiveNow();
  focusRiver(r, !focusGauge && !(opts && opts.fit === false) && !floating, opts && opts.at);
  renderSheet(r);                      // instant paint with whatever we have
  // a gauge tapped on the map may be one of the folded ones: show it (the fold then stays open on repaint)
  if(focusGauge && focusGauge !== primaryGaugeOf(r)){
    const d = body.querySelector('details[data-fold="gauges"]'); if(d) d.open = true;
  }
  // lazy-load stats + metadata for this river's gauges, then repaint.
  // Batched across the river's gauges: opening the Mississippi Headwaters
  // (6 gauges) is 8 requests, not 48, and none when the view already
  // brought its history in (loadViewStats). An ungauged creek's card shows
  // the nearest gauged river's status instead, where it shows one at all
  // (noGaugeHTML), so that gauge's history is the one it needs.
  const near = !r.gauges.length && nearShowsClass(r) && nearestGaugedRiver(r);
  const own = near ? [near.primaryGauge] : r.gauges;
  // The spare room carries the gauges around where the river is about to be
  // framed, so the view that frame brings needn't pay for a chunk of its own.
  const riders = statsRiders(own, (opts && opts.at) || GAUGE_POS[r.primaryGauge] || midCoord(r.coords));
  await Promise.all([fetchStatsBatch(own.concat(riders)), verifyGaugesBatch(r.gauges.concat(riders))]);
  paintStatus();                       // the sheet, the dots and this river's current
  if(focusGauge) map.panTo(GAUGE_POS[focusGauge]);
}

function tierChipHTML(r){
  const t = tierNow.get(r.id) || tierOf(r), info = TIER_INFO[t.tier], base = TIER_INFO[t.base];
  // the ranking names are labels, not words in the sentence, so they are quoted
  const usually = `Usually ranked “${base.label}” — `;
  let line = "";
  if(t.state === "closed") line = `Closed ${winText(t.wins)}${t.why ? " — "+t.why : ""}`;
  else if(t.state === "best") line = `${t.tier!==t.base ? usually+"prime" : "Prime"} time now (${winText(t.wins)}).${t.why ? " "+t.why : ""}`;
  else if(t.state === "poor") line = `${usually}off this time of year (${winText(t.wins)}).${t.why ? " "+t.why : ""}`;
  else if(t.why) line = t.why;
  return `<div class="tierline"><span class="tierbadge" style="--tc:${info.color}">${info.label}${t.state==="closed"?" · closed":""}</span>`+
         (line ? `<span class="tierwhy">${line}</span>` : `<span class="tierwhy">${info.blurb}</span>`)+`</div>`;
}

/* Who to check with. Inside a national park the state agency has nothing to
   do with it — a Wyoming or Montana licence is not valid in Yellowstone, and
   pointing a reader at Game & Fish for these rivers would be actively wrong. */
function regBodyFor(r){
  return (PARK_INFO[r.region] && PARK_INFO[r.region].regBody)
    // no row, or a row that leaves it to the state (the Driftless, North Shore, Door County)
    || {IA:"the Iowa DNR", MN:"the Minnesota DNR", WI:"the Wisconsin DNR", IL:"the Illinois DNR", ID:"Idaho Fish &amp; Game", WY:"Wyoming Game &amp; Fish", MO:"the Missouri Department of Conservation"}[r.state]
    || "WY Game &amp; Fish / Idaho Fish &amp; Game";
}

/* "Rules today": the three things you need standing at the river — is it in
   season, whose licence, and what the rules name — before flows and notes.
   Season comes from the class table's closed windows, which are month-grained,
   so the months either side of a window are called "opens or closes this
   month" rather than guessed; "In season" never appears without the window
   that qualifies it. Colours are muted on purpose: the closure-tape red is
   reserved for closed water on the map. */
/* State stream-access law: whether you may wade a private streambed is a
   state rule, not a fishing rule, so it gets its own row. Park water is
   federal land and the state's streambed law doesn't govern it. A park is
   known by its row's sub ("· Yellowstone National Park"); state and valley
   rows ("", "· Teton Valley", "· Driftless Area") do get the row. fbEsc is
   declared further down but only called at render time, well after it exists. */
function stateLaw(r){
  const pi = PARK_INFO[r.region];
  if(pi && /National Park|Park Complex/.test(pi.sub||"")) return null;
  return (typeof ACCESS_LAW!=="undefined" && ACCESS_LAW[r.state]) || null;
}
/* On Driftless and Door County water the question standing at the creek is
   not the state's streambed law but whose ground the bank is, so the card
   gives that rule and the state law moves into the Regulations fold
   (stateLawFoldHTML). The Driftless runs through private land under public
   angling easements; Door County has no easements at all, and its access is
   county park, state park and land-trust ground. */
const ACCESS_ROW = {
  driftless:"Much of the best water crosses private land under a public angling easement: fish and walk the stream corridor, and don't leave it. Park in the marked pull-offs.",
  doorcounty:"Reach the water from county park, state park and land-trust ground — there are no angling easements on the peninsula. Park only where parking is marked.",
};
function accessLawHTML(r){
  if(ACCESS_ROW[r.region]) return `<div class="rc-lic rc-access"><span class="rc-lab">Wading &amp; access</span>`+
    `<div style="font-size:13px;line-height:1.35;margin-top:2px">${ACCESS_ROW[r.region]}</div></div>`;
  const a = stateLaw(r); if(!a) return "";
  return `<div class="rc-lic rc-access"><span class="rc-lab">Wading &amp; access</span>`+
    `<div style="font-size:13px;line-height:1.35;margin-top:2px">${fbEsc(a.head)}</div>`+
    `<details class="rc-law" data-fold="law"><summary>${a.quote ? "The law, in its own words" : "Source"}</summary>`+
    (a.quote ? `<blockquote>${fbEsc(a.quote)}</blockquote>` : "")+
    `<div class="fb-note">Source: <a href="${fbEsc(a.url)}" target="_blank" rel="noopener">${fbEsc(a.src)}</a></div></details></div>`;
}
function stateLawFoldHTML(r){
  const a = ACCESS_ROW[r.region] && stateLaw(r); if(!a) return "";
  return `<div class="fishnote rg-law"><b>Wading &amp; access — ${fbEsc(riverStateName(r))} law</b>`+
    `<div style="margin-top:3px;color:var(--txt)">${fbEsc(a.head)}</div>`+
    (a.quote ? `<blockquote>${fbEsc(a.quote)}</blockquote>` : "")+
    `<div class="rg-src">Source: <a href="${fbEsc(a.url)}" target="_blank" rel="noopener">${fbEsc(a.src)}</a></div></div>`;
}

/* Iowa's low-head dams are the hazard on its paddling water, at almost any
   flow, so the warning sits in the rules card rather than the footer: every
   non-trout Iowa river, and every water trail wherever it runs (a water trail
   on a Driftless river is paddling water like any other). */
function damWarnHTML(r){
  if(!((r.state==="IA" && r.region!=="driftless") || r.waterTrail)) return "";
  return `<div class="rc-dam">⚠ Iowa rivers have low-head dams — the "drowning machine" recirculating hydraulic at the base is dangerous at almost any flow. Scout unfamiliar stretches and check <a href="https://www.iowawhitewater.org/lhd/LHDrivers.html" target="_blank" rel="noopener">Iowa Whitewater's low-head dam list</a> before you put in. Dams the DNR maps are on the <b>Falls, rapids &amp; dams</b> layer, with the portage side.</div>`;
}

/* The Iowa DNR states the season reach by reach ("Continuous open season;
   …"). Only when every reach says so is the stream "Open all year". The
   DNR stream page's own species lines are not a reach and aren't tested. */
const DNR_PAGE_LABEL = "<b>On the DNR stream page:</b>";
function openAllYear(r){
  if(!r.troutRegs || r.parkRegs) return false;
  const reaches = r.troutRegs.split(/<br\s*\/?>/i).map(s => s.trim()).filter(s => s && !s.startsWith(DNR_PAGE_LABEL));
  return reaches.length > 0 && reaches.every(s => /continuous open season/i.test(s));
}

/* An agency's own designation (Gold Medal, Blue Ribbon), from designations.js.
   Gold Medal wears gold; Blue Ribbon a deep blue, not gauge blue. */
function desigHTML(id){
  const d = typeof DESIGNATIONS !== "undefined" && DESIGNATIONS[id], s = d && DESIG_SRC[d.src];
  if(!s) return "";
  const col = /gold/i.test(s.label) ? "#c79a1c" : "#1f3f8f";
  return `<div class="rc-desig"><span class="tierbadge" style="--tc:${col}">${fbEsc(s.label)}</span>`+
    `<span class="rc-dsub"><a href="${fbEsc(s.url)}" target="_blank" rel="noopener">${fbEsc(s.by)}</a> · ${fbEsc(d.reach)}</span></div>`;
}

/* "Fish here": the fish species.js lists for this water, with whose word it
   is. A species only the water's own regulations name is marked as such and
   shows the rule it came from; every other one is an agency's or the park's
   own list. Inside the area species.js covers, a water with nothing listed
   says "No species data yet"; elsewhere the sheet says nothing about fish
   rather than imply an empty creek. fbEsc and WT_MONTHS are declared further
   down but only used at render time. */
function speciesRowHTML(kind, w){
  if(!SP_ON || !w) return "";
  const rows = SPECIES[kind === "lake" ? "lake:" + w.id : w.id];
  const head = `<span class="rc-lab">Fish here</span>`;
  if(!rows || !rows.length)
    return speciesInScope(kind, w) ? `<div class="rc-fish">${head}<div class="rc-fishnone">No species data yet</div></div>` : "";
  const label = sp => (SPECIES_LIST.find(s => s.key === sp) || {label:sp}).label;
  const a = (url, text) => url ? `<a href="${fbEsc(url)}" target="_blank" rel="noopener">${fbEsc(text)}</a>` : fbEsc(text);
  /* "updated Feb 2022" is the agency's own date on the page; "checked Oct
     2026" is the day the pipeline read a page that carries none. An edition
     year already in the name isn't repeated. */
  const when = s => {
    const m = /^(\d{4})-(\d\d)/.exec(s.date || "");
    if(!m) return s.date && !String(s.name).includes(s.date) ? s.date : "";
    return (s.checked ? "checked " : "updated ") + WT_MONTHS[+m[2]-1] + " " + m[1];
  };
  const chips = [], agency = [], regs = [];
  rows.forEach(([sp, src, how, note]) => {
    const s = SPECIES_SRC[src] || {name:src};
    // "stocked" is said once: an Idaho note already reads "survey 2023 · stocked 2026"
    const bits = (how && !(note && !s.regs && note.toLowerCase().includes(how)) ? [how] : []).concat(note && !s.regs ? [note] : []);
    chips.push(`<span class="fishchip${s.regs ? " regs" : ""}">${fbEsc(label(sp))}${bits.length ? `<small>${fbEsc(bits.join(" · "))}</small>` : ""}</span>`);
    if(s.regs) regs.push(`<div class="rc-fishreg"><b>${fbEsc(label(sp))}</b> — named in this ${kind === "lake" ? "lake" : "river"}'s ${fbEsc(s.date || "")} regulations${note ? `: “${fbEsc(note)}”` : ""} (${a(s.url, s.name)})</div>`);
    else if(!agency.includes(src)) agency.push(src);
  });
  /* One line per agency. A per-page source (an Iowa DNR stream or reach
     page, an IDFG water) links its page by the page's own title, so a water
     trail resting on three reach pages names the three reaches. */
  const byName = new Map();
  agency.forEach(k => { const s = SPECIES_SRC[k] || {name:k}; if(!byName.has(s.name)) byName.set(s.name, []); byName.get(s.name).push(s); });
  const srcs = [...byName].map(([name, ss]) => {
    const d = w => when(w) ? ` <span class="rc-fishdate">${fbEsc(when(w))}</span>` : "";
    if(!ss[0].page) return a(ss[0].url, name) + d(ss[0]);
    const same = ss.every(w => when(w) === when(ss[0]));            // one date for all: say it once, at the end
    return `${fbEsc(name)}: ` + ss.map(w => a(w.url, w.page) + (same ? "" : d(w))).join(", ") + (same ? d(ss[0]) : "");
  });
  return `<div class="rc-fish">${head}<div class="rc-fishlist">${chips.join("")}</div>`+
    (srcs.length ? `<div class="rc-fishsrc">${srcs.length > 1 ? "Sources" : "Source"}: ${srcs.join(" · ")}</div>` : "")+
    regs.join("") + `</div>`;
}

/* The licence line where no row states one: the Upper Midwest and the
   original Idaho and Wyoming rivers. It goes by state, and then by whether the
   water takes the state's trout fee or stamp -- which differs inside one
   region (a Minnesota North Shore stream needs the stamp; a Wisconsin one only
   if it is classified trout water), so it can't be one string per row. */
function stateLicence(r){
  const dn = r.region==="driftless" || r.region==="northshore";
  return r.state==="IA" ? (r.region==="driftless" ? "<b>Iowa</b> fishing licence + trout fee for trout water" : "<b>Iowa</b> fishing licence")
       : r.state==="MN" ? "<b>Minnesota</b> fishing licence" + (dn ? " + trout stamp" : "")
       : r.state==="WI" ? "<b>Wisconsin</b> fishing licence" + (r.troutClass || r.region==="driftless" || r.region==="doorcounty" ? " + trout stamp" : "")
       : r.state==="IL" ? "<b>Illinois</b> fishing licence"
       : r.state==="ID" ? "<b>Idaho</b> fishing licence"
       : r.state==="WY" ? "<b>Wyoming</b> fishing licence"
       : r.state==="MO" ? "<b>Missouri fishing permit</b> (unless exempt) <b>+ trout permit</b> to possess trout outside the trout parks; <b>daily trout tag</b> in the trout parks"
       : `Licence: see ${regBodyFor(r)}`;
}

function rulesCardHTML(r){
  const m = new Date().getMonth() + 1;
  const e = TIERS[r.id], s = e && e.season, closed = s && s.closed && s.closed.length ? s.closed : null;
  const hasText = !!(r.parkRegs || r.troutRegs);
  /* A closure on one reach only (partClosed in tiers.js): the stream keeps its
     class and its place on the map, and only this row says part of it is shut.
     The closure sentence and the reach are the booklet's own words. The card
     points to "the rules below" for the reach only where that text states it;
     otherwise it gives the reach itself. */
  const partWin = !closed && s && s.partClosed && s.partClosed.length ? s.partClosed : null;
  const edge = wins => wins.some(([a,b]) => m === (a===1 ? 12 : a-1) || m === (b%12)+1);   // the month either side
  const sent = t => /[.!?]$/.test(t) ? t : t + ".";
  let dot = "", head = "", sub = "";
  if(closed && inWindow(m, closed)){
    dot = "#9a4a2e"; head = "Closed season";
    sub = `Closed ${winText(closed)}${s.why ? " — "+s.why : ""}`;
  } else if(closed && edge(closed)){
    dot = "#c48a17"; head = "Season opens or closes this month";
    sub = `Closed ${winText(closed)}. Check the exact date in the rules below.`;
  } else if(closed){
    dot = "#2f7d4f"; head = "In season"; sub = `Closed ${winText(closed)}`;
  } else if(partWin){
    const w = winText(partWin), reach = s.partReach ? fbEsc(s.partReach) : "", why = s.partWhy ? fbEsc(s.partWhy) : "";
    const plain = ((r.parkRegs || "") + " " + (r.troutRegs || "")).replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
    const inRules = !!s.partReach && plain.includes(s.partReach);
    if(inWindow(m, partWin)){
      dot = "#c48a17"; head = "Part of this stream is closed";
      sub = `Closed ${w} on part of this stream${reach ? ": "+sent(reach) : "."}${why ? " "+sent(why) : ""} The rest is open.`+
            (inRules ? " The rules below give the reach." : "");
    } else if(edge(partWin)){
      dot = "#c48a17"; head = "Part of this stream opens or closes this month";
      sub = `Closed ${w} on part of this stream` +
            (reach && !inRules ? `: ${sent(reach)} Check the exact date in the rules below.` : ". Check the exact date and reach in the rules below.");
    } else {
      dot = "#2f7d4f"; head = "In season"; sub = `Part of this stream closes ${w}${reach ? ": "+sent(reach) : "."}`;
    }
  } else if(openAllYear(r)){
    dot = "#2f7d4f"; head = "Open all year";
  } else if(!hasText){
    dot = "#8b9690"; head = "No season on file"; sub = `Check ${regBodyFor(r)}`;
  }
  /* Otherwise the season is somewhere in the rule text, which no window here
     can summarise; a row saying so told the reader nothing, so there is no
     row and the licence line leads the card. */

  /* A river with no region (Wyoming's WGFD streams) finds its row through
     parkRegsSrc. Every existing parkRegsSrc that names a PARK_INFO row
     equals the river's own region, so this changes nothing for them. The
     Snake and the other region-less rivers under Grand Teton's rules read
     the park's line through REGS_SRC_ROW. */
  const piRow = PARK_INFO[r.region] || PARK_INFO[r.parkRegsSrc], srcRow = regsSrcRow(r);
  const lic = (piRow && piRow.licence) || (srcRow && srcRow.licence) || stateLicence(r);

  /* Tags are phrase matches in this river's own rule text, not interpretations,
     and a tag may apply to one reach only. State rivers' parkRegs end with the
     state's standard rule, so scanning stops at its heading. */
  let txt = (r.troutRegs || "") + " " + (r.parkRegs || "");
  const cut = /<b>[^<]*(standard|statewide)[^<]*<\/b>/i.exec(txt);
  if(cut) txt = txt.slice(0, cut.index);
  txt = txt.replace(/<[^>]*>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
  const TAGS = [
    [/catch[- ]and[- ]release/i, "Catch & release"],
    [/fly[- ]fishing only|flies only/i, "Fly fishing only"],
    [/artificial (flies|lures)( (and|or) (flies|lures))? only|artificial lures with/i, "Artificial only"],
    [/barbless/i, "Barbless"],
    ...(typeof DESIGNATIONS !== "undefined" && DESIGNATIONS[r.id] ? [] : [[/gold medal/i, "Gold Medal"]]),
    [/must be killed/i, "Mandatory kill"],
    [/closed to (all )?(fishing|angling)/i, "Closures listed"],
  ];
  const noArt = txt.replace(/artificial (flies|lures)( (and|or) (flies|lures))? only/gi, "");   // "artificial flies only" is Artificial only, not Fly fishing only
  const tags = TAGS.filter(([re]) => re.test(re.source.startsWith("fly") ? noArt : txt)).map(t => t[1]);
  /* On an Iowa stream designated reach by reach, the special rules are the
     restrictive reach's, not the whole stream's -- so the chip says so. */
  const part = r.reachClass && ["restrictive","pa_special","va_special"].some(k => r.reachClass.includes(k) && r.reachClass.some(c => c !== k));

  return `<div class="rulescard">${desigHTML(r.id)}`+
    (head ? `<div class="rc-status"><span class="rc-dot" style="background:${dot}"></span>`+
      `<div><div class="rc-head">${head}</div>${sub ? `<div class="rc-sub">${sub}</div>` : ""}</div></div>` : "")+
    `<div class="rc-lic${head ? "" : " rc-lead"}">${lic}</div>`+
    accessLawHTML(r)+
    speciesRowHTML("river", r)+
    (tags.length ? `<div class="rc-tags"><span class="rc-lab">Named in this river's rules:</span>${tags.map(t=>`<span class="tierbadge" style="--tc:#6b5c50">${t.replace("&","&amp;")}${part ? " · part of stream" : ""}</span>`).join("")}</div>` : "")+
    damWarnHTML(r)+
    `</div>`;
}

/* The DNR stream page lists its rules species by species and repeats the
   same sentences under each: Waterloo Creek gives the whole "Artificial lure
   means …" definition once for browns and again for rainbows. A sentence
   that more than one species carries is shown once, under the names of every
   species that carries it ("Brown Trout, Rainbow Trout — Other: …", the form
   the page itself uses when it groups species). It is never dropped from one
   species and left on another, which would read as though the rule didn't
   apply there. Every word is the DNR's; only the grouping changes, and
   anything that doesn't parse as "Species — Field: text; Field: text" is
   shown exactly as it came. */
function dnrPageLinesHTML(txt){
  if(/</.test(txt)) return txt;
  const sentences = v => { const p = v.split(/\.\s+(?=[A-Z])/); return p.map((s, i) => i < p.length - 1 ? s + "." : s); };
  const items = txt.split(" · ").map(part => {
    const m = /^([^—]+?) — (.+)$/.exec(part.trim());
    if(!m) return null;
    const fields = m[2].split(/;\s+(?=[A-Z][A-Za-z ]*:\s)/).map(f => {
      const fm = /^([A-Z][A-Za-z ]*):\s+(.+)$/.exec(f.trim());
      return fm && {name:fm[1], sents:sentences(fm[2].trim())};
    });
    return fields.every(Boolean) ? {sp:m[1].trim(), fields} : null;
  });
  if(!items.length || items.some(x => !x)) return txt;
  // which species carry each field-and-sentence
  const key = (f, s) => f + "\u0001" + s, owners = new Map();
  items.forEach((it, i) => it.fields.forEach(f => f.sents.forEach(s => {
    const k = key(f.name, s);
    if(!owners.has(k)) owners.set(k, new Set());
    owners.get(k).add(i);
  })));
  const shared = k => owners.get(k).size > 1;
  const fieldText = fs => fs.map(f => `${f.name}: ${f.sents.join(" ")}`).join("; ");
  const lines = [];
  items.forEach(it => {
    const own = it.fields.map(f => ({name:f.name, sents:f.sents.filter(s => !shared(key(f.name, s)))})).filter(f => f.sents.length);
    if(own.length) lines.push(`${it.sp} — ${fieldText(own)}`);
  });
  // the shared sentences, grouped by exactly which species carry them, in first-seen order
  const groups = new Map();
  items.forEach(it => it.fields.forEach(f => f.sents.forEach(s => {
    const k = key(f.name, s); if(!shared(k)) return;
    const who = [...owners.get(k)].sort((a, b) => a - b).join(",");
    if(!groups.has(who)) groups.set(who, []);
    const g = groups.get(who);
    if(!g.some(u => u.k === k)) g.push({k, name:f.name, s});
  })));
  groups.forEach((units, who) => {
    const names = who.split(",").map(i => items[+i].sp);
    const label = names.join(", ");      // the page's own form when it groups species ("Brown Trout, Rainbow Trout — …")
    const fs = [];
    units.forEach(u => { const last = fs[fs.length - 1]; if(last && last.name === u.name) last.sents.push(u.s); else fs.push({name:u.name, sents:[u.s]}); });
    lines.push(`${label} — ${fieldText(fs)}`);
  });
  // belt and braces: if any sentence of the page went missing, show the page as it came
  const out = lines.join("\n");
  if(items.some(it => it.fields.some(f => f.sents.some(s => !out.includes(s))))) return txt;
  return lines.map(l => `<div class="rg-sp">${l}</div>`).join("");
}
function troutRegsHTML(t){
  const i = t.indexOf(DNR_PAGE_LABEL);
  if(i < 0) return t;
  return t.slice(0, i) + DNR_PAGE_LABEL + " " + dnrPageLinesHTML(t.slice(i + DNR_PAGE_LABEL.length).trim());
}

/* A long state entry arrives folded in its own <details> ("This river's own
   rules — 6 reaches, tap to read"). Inside the Regulations fold that would be
   a fold in a fold, so it is opened out and its summary kept as a plain
   heading, minus the "tap to read"; the count goes up to the fold's own
   summary. */
function unfoldRegs(html){
  let count = "";
  const out = html.replace(/<details>\s*<summary>([^<]*)<\/summary>/g, (m, s) => {
    const label = s.replace(/,?\s*tap to read\s*$/i, "");
    if(!count){ const c = /— (\d+ \w+)$/.exec(label); if(c) count = c[1]; }
    return `<div class="rg-sub">${label}</div>`;
  }).replace(/<\/details>/g, "");
  return {html:out, count};
}

/* Everything the rules card summarises, in full, in one fold: for an Iowa
   or Wisconsin trout stream the class badges with their miles, then the
   regulation text reach by reach, then the DNR page's lines (repeats shown
   once), then whose wording it is; for park and state rivers the agency's
   own entry and its source. The text is reproduced verbatim rather than
   paraphrased — on a catch-and-release or artificial-only stretch the exact
   wording is the thing that keeps you legal. On Driftless and Door County
   water the state's streambed law sits here too, since the card gives the
   easement rule instead. */
function regsFoldHTML(r){
  let inner = "", count = "";
  if(r.troutClass || r.troutRegs){
    const src = TROUT_SOURCE[r.troutSource || "iadnr"];
    /* A stream the DNR designates reach by reach gets one badge per class with
       its miles along the drawn line, longest first -- the colours it wears on
       the map. */
    const reaches = r.troutClass ? reachMiles(r) : [];
    const badges = reaches.map(([cls, mi]) => `<span class="badge" style="background:${TROUT_CLASS[cls].color}">`+
      `${TROUT_CLASS[cls].label}${mi != null ? " · " + mi.toFixed(1) + " mi" : ""}</span>`).join(" ");
    const page = r.dnrCode
      ? ` <a href="https://programs.iowadnr.gov/lakemanagement/FishIowa/TroutStreamDetails/${encodeURIComponent(r.dnrCode)}" target="_blank" rel="noopener">Iowa DNR stream page</a>`
      : (src.url ? ` <a href="${src.url}" target="_blank" rel="noopener">${src.agency}</a>` : "");
    inner += `<div class="fishnote">`+
      (reaches.length > 1 ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${badges}</div>` : badges)+
      (r.wildTrout ? `<div style="margin-top:6px;font-size:11.5px">Wild trout present: <b>${r.wildTrout}</b></div>` : "")+
      (r.troutRegs ? `<div class="rg-text">${troutRegsHTML(r.troutRegs)}</div>` : "")+
      `<div class="rg-src">Classification and any special-regulation wording come from the ${src.agency} ${src.what}. Regulations change — confirm against the current ${src.regs} before you fish.${page}</div>`+
      `</div>`;
  }
  /* Park rules are specific enough per river that one park-wide note won't
     do: in Yellowstone one reach opens May 1 and another July 15, one is
     fly-fishing-only, and in the Lamar drainage releasing a rainbow alive is
     illegal. Two parks, two authorities, and the difference is the single
     most useful thing here: Yellowstone issues its own permit and a state
     licence is void there, while Grand Teton is Wyoming water with a Wyoming
     licence. The Snake, Buffalo Fork and Gros Ventre carry a Grand Teton note
     without being in that region, so the source is a field: the badge and
     note come from the row the source names (through REGS_SRC_ROW where it
     isn't a row itself), else from the river's region. */
  if(r.parkRegs){
    const src = r.parkRegsSrc || r.region;
    const pk = PARK_INFO[REGS_SRC_ROW[src] || src] || {};
    const u = unfoldRegs(r.parkRegs);
    count = u.count;
    inner += `<div class="fishnote">`+
      (pk.badge ? `<span class="badge" style="background:#4a6f8a">${pk.badge}</span> ` : "")+
      `<span style="font-size:11.5px">${u.html}</span>`+
      (pk.note ? `<div class="rg-src">${pk.note}</div>` : "")+
      `</div>`;
  }
  inner += stateLawFoldHTML(r);
  if(!inner) return "";
  return `<details class="rulesfull fold" data-fold="regs"><summary><span>Regulations</span>`+
    `<span class="rf-hint">full wording${count ? " · " + count : ""}</span></summary>${inner}</details>`;
}

/* "Des Moines River Water Trail · State water trail (Iowa DNR) · Designated
   Jun 2010 · 19.1 designated miles · Trail map →". A designation is a fact
   about the water, not a rule for fishing it, so it sits with the blurb
   rather than in the rules card. Every field but the name may be missing. */
const WT_MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function waterTrailHTML(r){
  const w = r.waterTrail;
  if(!w || !w.name) return "";
  const bits = [`<b>${fbEsc(w.name)}</b>`, w.src === "Iowa DNR" ? "State water trail (Iowa DNR)" : fbEsc(w.src || "Water trail")];
  // read "YYYY-MM-DD" as text: new Date() takes it as UTC midnight, and in
  // Iowa a trail designated on the 1st would read as the month before
  const d = /^(\d{4})-(\d{2})/.exec(w.designated || "");
  if(d && WT_MONTHS[+d[2]-1]) bits.push(`Designated ${WT_MONTHS[+d[2]-1]} ${d[1]}`);
  if(Number.isFinite(w.miles)) bits.push(`${w.miles} designated miles`);
  if(w.url) bits.push(`<a href="${fbEsc(w.url)}" target="_blank" rel="noopener">Trail map →</a>`);
  return `<div class="wtrow">🛶 ${bits.join(" · ")}</div>`;
}

/* The gauge a river is read by: its primary, else the first it has. */
function primaryGaugeOf(r){ return r.gauges.includes(r.primaryGauge) ? r.primaryGauge : r.gauges[0]; }

/* The fishing note, minus what the blurb already says. The NE Iowa notes and
   blurbs were both written from the DNR's stream page, so the note's "Wild
   brown trout are present." restates the blurb's own wild-brown sentence,
   while the stocking figures after it are new and stay. Whole sentences
   only: one goes when it is in the blurb word for word, or when it is that
   "Wild … trout are present." line and the blurb already names wild or
   naturally reproducing fish of every species it lists. */
const FISH_SP = "brown|brook|rainbow|tiger|cutthroat";
const WILD_PRESENT = new RegExp(`^Wild ((?:${FISH_SP})(?:(?:, | and )(?:${FISH_SP}))*) trout are present\\.$`, "i");
function fishNoteText(r){
  if(!r.fish) return "";
  const blurb = (r.blurb || "").toLowerCase();
  const parts = r.fish.split(/\.\s+(?=[A-Z])/), sents = parts.map((s, i) => i < parts.length - 1 ? s + "." : s);
  return sents.filter(s => {
    if(s.length >= 20 && blurb.includes(s.toLowerCase())) return false;
    const w = WILD_PRESENT.exec(s);
    return !(w && /\bwild\b|reproduc|natural/.test(blurb) && w[1].toLowerCase().split(/, | and /).every(sp => blurb.includes(sp)));
  }).join(" ");
}

/* ============================================================
   WIND & WEATHER — the National Weather Service hourly forecast.
   A gauge says what the river is doing; whether the day is worth the drive
   is as often decided by wind (casting, a drift boat on flat water, a big
   lake) and by rain. api.weather.gov is free, needs no key and is CORS-open.
   Two calls: /points/{lat},{lng} names the forecast office's grid cell and
   its hourly-forecast URL (that never changes for a point, so it is kept
   forever), then the hourly forecast itself (kept 30 minutes). Neighbouring
   rivers often share a grid cell, so the forecast is cached by its URL.
   This is not the USGS host, so none of it touches the request budget or
   apiPaused(). The hourly product carries no gusts and none are invented.
   ============================================================ */
const NWS_POINTS = "https://api.weather.gov/points/";
const WX_FRESH_MS = 30*60*1000;      // reuse a forecast this long
const WX_RETRY_MS = 2*60*1000;       // after a failure, don't retry on every re-render
const WX_PRUNE_MS = 6*60*60*1000;    // saved forecasts older than this are deleted
const WX_CELLS = 6, WX_STEP = 2;     // the strip: six cells, two hours apart
const WX_WINDY = 15, WX_STRONG = 25; // mph, top of the forecast range
const WX_LIGHT = 10;                 // under this all strip long: "light wind"
const WX_RAIN_MIN = 20;              // % chance worth printing
const wxPtMem = {};                  // point id -> hourly URL, or null outside NWS coverage
const wxFcMem = {};                  // hourly URL -> {fetchedAt, updated, periods}
const wxBusy = {};                   // point id / URL -> in-flight promise (one per URL)
const wxFailedAt = {};               // point id -> last failure

/* Where the forecast is for, and how the card says so. A river is read at
   its primary gauge — the same water the flow card describes — or, with no
   gauge, near the middle of its line. A lake at the centre of its outline. */
function wxPoint(lat, lng, label){
  // 4 decimals is what /points takes; trailing zeros dropped so it doesn't redirect
  const id = `${+lat.toFixed(4)},${+lng.toFixed(4)}`;
  return {id, label};
}
function wxRiverPoint(r){
  const pg = r.gauges.length ? primaryGaugeOf(r) : null;
  const p = pg && GAUGE_POS[pg];
  if(p) return wxPoint(p[0], p[1], `Forecast at the ${GAUGES[pg].label} gauge`);
  const m = midCoord(r.coords);
  return wxPoint(m[0], m[1], "Forecast near the middle of the river");
}
function wxLakePoint(k){
  const b = k.bounds;
  return b ? wxPoint((b[0][0]+b[1][0])/2, (b[0][1]+b[1][1])/2, "Forecast on the lake")
           : wxPoint(k.at[0], k.at[1], "Forecast on the lake");
}

/* The point's hourly URL: memory, then this phone's store, then /points. A
   404 there means the point is outside NWS coverage, and the card is hidden. */
function wxURLKnown(pt){
  if(pt.id in wxPtMem) return wxPtMem[pt.id];
  const s = store.get("nwsPt:"+pt.id);
  if(s && s.url) return wxPtMem[pt.id] = s.url;
  return undefined;
}
async function wxHourlyURL(pt){
  const known = wxURLKnown(pt);
  if(known !== undefined) return known;
  try{
    const j = await fetchJSON(NWS_POINTS + pt.id, 10000);
    const url = j.properties && j.properties.forecastHourly;
    if(url) store.set("nwsPt:"+pt.id, {url});
    return wxPtMem[pt.id] = url || null;
  }catch(e){
    if(/HTTP 404/.test(e.message)) return wxPtMem[pt.id] = null;   // not for the session's store: could be a blip
    throw e;
  }
}
function wxCached(url){
  if(!url) return null;
  if(!wxFcMem[url]){ const s = store.get("nwsFc:"+url); if(s && s.periods) wxFcMem[url] = s; }
  return wxFcMem[url] || null;
}
/* Saved forecasts are only ever worth half an hour, but each is a few KB and
   one is kept per grid cell looked at. Old ones are cleared so they can't
   creep up on the Field Book's share of localStorage. */
function wxPrune(){
  try{
    for(let i = localStorage.length - 1; i >= 0; i--){
      const k = localStorage.key(i);
      if(!k || !k.startsWith("nwsFc:")) continue;
      const v = store.get(k);
      if(!v || !(Date.now() - v.fetchedAt < WX_PRUNE_MS)) localStorage.removeItem(k);
    }
  }catch(e){}
}
async function wxFetchForecast(url){
  if(wxBusy[url]) return wxBusy[url];
  return wxBusy[url] = (async () => {
    try{
      const j = await fetchJSON(url, 10000);
      const pr = j.properties || {}, now = Date.now();
      // only what the card uses, and only hours not already over
      const periods = (pr.periods || []).filter(p => new Date(p.endTime).getTime() > now).slice(0, 24).map(p => ({
        s:p.startTime, e:p.endTime, t:p.temperature, u:p.temperatureUnit, ws:p.windSpeed || "", wd:p.windDirection || "",
        pop:p.probabilityOfPrecipitation ? p.probabilityOfPrecipitation.value : null, sf:p.shortForecast || ""}));
      if(!periods.length) throw new Error("empty forecast");
      const fc = {fetchedAt:now, updated:pr.updateTime || pr.generatedAt || null, periods};
      wxFcMem[url] = fc;
      wxPrune();
      store.set("nwsFc:"+url, fc);
      return fc;
    } finally { delete wxBusy[url]; }
  })();
}

/* Kick a fetch if this point has no fresh forecast. renderSheet calls it on
   every re-render, so it does nothing while one is in flight, while the
   cached copy is fresh, or for a couple of minutes after a failure. */
function wxLoad(target){
  const pt = target.pt;
  const url = wxURLKnown(pt);
  if(url === null) return;                                    // outside NWS coverage
  const fc = wxCached(url);
  if(fc && Date.now() - fc.fetchedAt < WX_FRESH_MS) return;
  if(wxBusy[pt.id]) return;
  if(wxFailedAt[pt.id] && Date.now() - wxFailedAt[pt.id] < WX_RETRY_MS) return;
  wxBusy[pt.id] = (async () => {
    try{
      const u = await wxHourlyURL(pt);
      if(u) await wxFetchForecast(u);
      delete wxFailedAt[pt.id];
    }catch(e){ wxFailedAt[pt.id] = Date.now(); }
    finally{ delete wxBusy[pt.id]; }
    wxFill(target);
    fbWxSettle(pt);           // here, not in a caller: a tap may be waiting on a fetch the sheet started
  })();
}
/* Only into the sheet it was asked for: the placeholder carries the river's
   or lake's id, so if the sheet has moved on there is nothing to fill. */
function wxFill(target){
  const el = body.querySelector(`[data-wx="${target.key}"]`);
  if(!el) return;
  const html = wxCardHTML(target);
  if(html) el.outerHTML = html; else el.remove();
}

/* ---------- Field Book: conditions at the tap ----------
   What the app already knew when ✓ Fished was tapped — nothing is fetched
   for it beyond what the sheet's own forecast load does. The forecast is the
   hour containing the tap; the flow is the primary gauge under the same 24 h
   rule the flow card uses, so an old number is never saved as that day's. */
const FB_WX_LATE_MS = 60*60*1000;    // a forecast that arrives later than this no longer describes the tap
const FB_ST_REAL = ["vlow","low","avg","high","vhigh"];
const fbWxPending = [];              // {tripId, ptId, at} — this page only, never stored
function fbWxTarget(kind, water){
  return kind==="lake" ? {key:"lake:"+water.id, pt:wxLakePoint(water)}
                       : {key:"river:"+water.id, pt:wxRiverPoint(water)};
}
function fbWxPeriodAt(pt, at){
  const url = wxURLKnown(pt), fc = url ? wxCached(url) : null;
  const p = fc && fc.periods.find(p => new Date(p.s).getTime() <= at && at < new Date(p.e).getTime());
  return p ? {t:p.t, u:p.u, ws:p.ws, wd:p.wd, sf:p.sf, s:p.s} : null;
}
function fbSnapshot(kind, water, at){
  const cond = {};
  const wx = fbWxPeriodAt(fbWxTarget(kind, water).pt, at);
  if(wx) cond.wx = wx;
  if(kind==="river" && water.gauges.length){
    const pg = primaryGaugeOf(water), f = flows[pg];
    if(f && f.cfs!=null && !readingIsOld(f)){
      const flow = {g:pg, cfs:Math.round(f.cfs), time:f.time};
      const st = statusOf(pg);
      if(FB_ST_REAL.includes(st.cls)) flow.st = {cls:st.cls, label:st.label};
      const tp = temps[pg];
      if(tp && tp.c!=null && !readingIsOld(tp)) flow.wtF = Math.round(tp.c * 9/5 + 32);
      cond.flow = flow;
    }
  }
  return Object.keys(cond).length ? cond : null;
}
/* Called once per tap. A forecast that isn't here yet is waited for only if
   a fetch is actually going — otherwise nothing would ever settle it and the
   row would say "loading" for an hour. */
/* Returns false only when there were conditions and the book couldn't take
   them; the trip itself (already saved) is kept without them. A live lake
   trip isn't in the book yet — laketrip.js saves it with its own key. */
function fbSnapTrip(t, kind, water){
  let ok = true;
  const cond = fbSnapshot(kind, water, t.at);
  if(cond){
    t.cond = cond;
    if(fbState.trips.includes(t) && !fbPersist()){ delete t.cond; ok = false; }
  }
  if(!ok || (cond && cond.wx)) return ok;
  const target = fbWxTarget(kind, water);
  if(wxURLKnown(target.pt) === null) return ok;               // outside NWS coverage
  wxLoad(target);
  if(wxBusy[target.pt.id]) fbWxPending.push({tripId:t.id, ptId:target.pt.id, at:t.at});
  return ok;
}
const fbWxIsPending = id => fbWxPending.some(p => p.tripId===id);
/* A forecast fetch for this point has finished, well or badly. Every trip
   waiting on it is filled or let go now, so none waits on a fetch that
   will never come. */
function fbWxSettle(pt){
  const rows = new Set();
  for(let i = fbWxPending.length - 1; i >= 0; i--){
    const p = fbWxPending[i];
    if(p.ptId !== pt.id) continue;
    fbWxPending.splice(i, 1);
    let t = fbState.trips.find(x => x.id===p.tripId), live = false;
    // a lake trip still recording isn't in the book until End; laketrip.js holds it
    if(!t && typeof lakeTripLiveTrip === "function"){ t = lakeTripLiveTrip(p.tripId); live = !!t; }
    if(!t) continue;
    rows.add(t.kind + "|" + t.water);           // its row stops saying "Forecast loading…" either way
    if(t.src!=="tap" || t.at!==p.at || (t.cond && t.cond.wx) || Date.now() - p.at >= FB_WX_LATE_MS) continue;
    const wx = fbWxPeriodAt(pt, p.at);
    if(!wx) continue;
    const prev = t.cond;
    t.cond = Object.assign({}, prev || {}, {wx});
    if(live) lakeTripSaveLive();
    else if(!fbPersist()){ if(prev) t.cond = prev; else delete t.cond; fbSaveWarn(); }
  }
  if(fbRowPaint && rows.has(fbRowFor)) fbRowPaint();
}

const wxTop = ws => Math.max(0, ...(String(ws).match(/\d+/g) || ["0"]).map(Number));   // "10 to 15 mph" -> 15
const wxEmph = top => top >= WX_STRONG ? " wx-w2" : top >= WX_WINDY ? " wx-w1" : "";
/* The hour as the forecast gives it — local time at the river, from the
   offset in startTime — not the phone's, which may be a time zone away. */
function wxHour(p){
  const h = +String(p.s).slice(11, 13);
  return isFinite(h) ? `${h % 12 || 12}${h < 12 ? "a" : "p"}` : "";
}
function wxCardHTML(target){
  const url = wxURLKnown(target.pt);
  if(url === null) return "";
  const head = `<div class="gname">Wind &amp; weather</div>`;
  const shell = inner => `<div class="wxcard" data-wx="${target.key}">${head}${inner}</div>`;
  const fc = wxCached(url);
  const now = Date.now();
  const periods = fc ? fc.periods.filter(p => new Date(p.e).getTime() > now) : [];
  const fresh = fc && now - fc.fetchedAt < WX_FRESH_MS;
  // an older copy stands in while its refresh is on the way, but not once
  // that refresh has failed: then it is no longer the current forecast
  const failed = wxFailedAt[target.pt.id] && !wxBusy[target.pt.id];
  if(!periods.length || (!fresh && failed)){
    return failed
      ? shell(`<div class="wx-off">Forecast unavailable — no connection to the National Weather Service.</div>`)
      : shell(`<div class="wx-now wx-dim">Loading forecast…</div>`);
  }
  const unit = u => u === "F" || !u ? "°F" : "°" + u;
  const p0 = periods[0], top0 = wxTop(p0.ws);
  const wind = (p, full) => wxTop(p.ws) === 0 ? "calm"
    : full ? `${p.wd} ${p.ws}`.trim() : `${p.wd} ${wxTop(p.ws)}`.trim();
  const nowBits = [`<b>${p0.t}${unit(p0.u)}</b>`, `Wind <span class="wx-wtxt${wxEmph(top0)}">${wind(p0, true)}</span>`];
  if(p0.pop != null && p0.pop >= WX_RAIN_MIN) nowBits.push(`${p0.pop}% rain`);
  if(p0.sf) nowBits.push(fbEsc(p0.sf));

  const cells = [];
  for(let n = 1; n <= WX_CELLS; n++){ const p = periods[n * WX_STEP]; if(p) cells.push(p); }
  const strip = cells.map(p => {
    const top = wxTop(p.ws);
    return `<div class="wx-cell${wxEmph(top)}"><div class="wx-h">${wxHour(p)}</div><div class="wx-t">${p.t}°</div>`+
      `<div class="wx-wind">${wind(p, false)}${top ? "<small>mph</small>" : ""}</div>`+
      `<div class="wx-pop">${p.pop != null && p.pop >= WX_RAIN_MIN ? p.pop + "%" : ""}</div></div>`;
  }).join("");

  // the summary reads only the hours on the card: now, then the strip
  const seen = [p0, ...cells];
  let windiest = p0;
  seen.forEach(p => { if(wxTop(p.ws) > wxTop(windiest.ws)) windiest = p; });
  const last = seen[seen.length - 1];
  const sum = wxTop(windiest.ws) < WX_LIGHT
    ? (seen.length > 1 ? `Light wind through ${wxHour(last)} (under ${WX_LIGHT} mph)` : `Light wind (under ${WX_LIGHT} mph)`)
    : `Windiest ${windiest === p0 ? "now" : "around " + wxHour(windiest)} (${windiest.ws.replace(/ to /, "–")})`;

  const issued = fc.updated ? readingWhen(fc.updated) : "";
  return shell(
    `<div class="wx-now">${nowBits.join(" · ")}</div>` +
    (strip ? `<div class="wx-strip">${strip}</div>` : "") +
    `<div class="wx-sum">${sum}</div>` +
    `<div class="wx-src">National Weather Service hourly forecast · ${fbEsc(target.pt.label)}${issued ? ` · issued ${issued}` : ""}</div>`);
}

function renderSheet(r){
  /* A re-render (stats arriving, a flow refresh) must not snap shut a fold
     the reader opened, so the open ones are noted by name and put back.
     Another river starts with everything folded. */
  const keepOpen = body.dataset.river === r.id
    ? [...body.querySelectorAll("details[data-fold]")].filter(d => d.open).map(d => d.dataset.fold) : [];

  /* The order answers "can I fish it, and is it worth the drive today": the
     rules card, the full rules folded under it, the ranking, the river's own
     gauge, the floats, then the description. A river with several gauges
     leads with its primary and folds the rest, so the float sections aren't
     pushed a screen down by readings from other reaches. */
  let h = tierChipHTML(r);
  // the forecast sits right under the river's own reading: the two together
  // are "is it worth the drive"; a cached forecast paints at once, no flicker
  const wx = {key:"river:" + r.id, pt:wxRiverPoint(r)};
  if(r.gauges.length){
    const pg = primaryGaugeOf(r), rest = r.gauges.filter(k => k !== pg);
    h += flowCardHTML(pg, r.id) + wxCardHTML(wx);
    if(rest.length) h += `<details class="fold morefold" data-fold="gauges"><summary><span>${rest.length} more gauge${rest.length > 1 ? "s" : ""} along the river</span></summary>`+
      rest.map(k => flowCardHTML(k, r.id)).join("") + `</details>`;
  } else {
    h += noGaugeHTML(r) + wxCardHTML(wx);
  }

  const secs = SECTIONS.filter(s=>s.river===r.id && passFilter(s));
  const allSecs = SECTIONS.filter(s=>s.river===r.id);
  let tip = "";
  if(allSecs.length){
    h += `<div class="secthead">Float sections</div>`;
    if(!secs.length) h += `<div class="fishnote">No sections match the current filters — clear a chip up top to see all ${allSecs.length}.</div>`;
    secs.forEach(s=>{ h += sectionHTML(s); });
  } else if(WADE_ONLY[r.id]) {
    /* Every Driftless creek is wade water, so "Floating: Wade only." says
       nothing there. What follows those words is a fishing tip ("short rod,
       roll casts…"), which joins the description rather than being lost. */
    const w = WADE_ONLY[r.id];
    if(r.region === "driftless" && /^Wade only\b/i.test(w)) tip = w.replace(/^Wade only\.\s*/i, "");
    else h += `<div class="secthead">Floating</div><div class="fishnote">🛶 ${w}</div>`;
  }

  /* The description: the blurb, then the fishing note and any wade tip as
     more of the same, with no headings of their own. */
  const fish = fishNoteText(r);
  h += `<div class="secthead">About</div><div class="desc">${waterTrailHTML(r)}<p>${r.blurb}</p>`+
    (fish ? `<p>🎣 ${fish}</p>` : "") + (tip ? `<p>${tip}</p>` : "") + `</div>`;
  h += reportSearchHTML(r);
  const regBody = regBodyFor(r);
  h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Flow data: USGS Water Data OGC API${r.state==="CO"?" and Colorado Division of Water Resources":""}. River lines simplified — not for navigation. Verify regulations with ${regBody}.</p>`;
  /* The footer is the row's (a region-less WGFD stream's by parkRegsSrc).
     No Driftless footer: the easement rule is the card's access row, the
     trout fee is on its licence line, and the special-regulation stretches
     are in the Regulations fold. Door County's footer leaves out who owns the
     bank for the same reason: that is the card's access row too. */
  const piFoot = PARK_INFO[r.region] || PARK_INFO[r.parkRegsSrc];
  if(piFoot && piFoot.footer){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">${piFoot.footer}</p>`;
  }
  // The Iowa low-head-dam warning is in the rules card (damWarnHTML), not down here.
  body.innerHTML = rulesCardHTML(r) + regsFoldHTML(r) + h +
    `<div class="rp-wrap"><button type="button" class="rp-link" data-report="${fbEsc(r.id)}">Report an issue with this river</button></div>`;
  body.dataset.river = r.id;
  wxLoad(wx);
  keepOpen.forEach(k => { const d = body.querySelector(`details[data-fold="${k}"]`); if(d) d.open = true; });

  body.querySelectorAll("[data-zoom]").forEach(el=>el.addEventListener("click",()=>{
    const s = SECTIONS.find(x=>x.id===el.dataset.zoom);
    zoomSection(s);
  }));
  body.querySelectorAll("[data-float]").forEach(el=>el.addEventListener("click",()=>{
    if(typeof floatOpenPlanner==="function") floatOpenPlanner(el.dataset.float);
  }));
  body.querySelectorAll("[data-river]").forEach(el=>el.addEventListener("click",()=>{
    openRiver(el.dataset.river);
  }));
}

/* Water temperature on trout water. Thresholds are common catch-and-release
   guidance for trout, not a regulation anywhere this map covers. */
const TROUT_WARM_F = 68;      // fish early, land and release fast
const TROUT_REST_F = 72;      // give them a rest
/* Trout water, decided by where the river is before what its text says.
   Everything outside IA/MN/WI/IL is western or Great Lakes trout water, and
   so are the small-stream regions inside them; text alone missed the Snake
   (named only as "cutthroat") and the Henry's Fork (no species at all). The
   warmwater left over -- Iowa water trails, MN/WI big rivers -- gets the cue
   only where its own text names trout reaches. Missouri is the same kind of
   mixed state: its trout is the MDC trout-area water (a troutClass) and
   Lake Taneycomo; the Ozark float rivers are smallmouth water unless their
   own text names trout (the Current, Jacks Fork, Eleven Point, North Fork,
   Niangua and Meramec mainstems carry trout reaches and say so). */
const TROUT_REGIONS = new Set(["driftless","northshore","doorcounty","wisouthshore","wicentralsands"]);
function isTroutWater(r){
  return !!(r && (r.troutClass || TROUT_REGIONS.has(r.region) || !["IA","MN","WI","IL","MO"].includes(r.state) ||
    /trout|steelhead|salmon|cutthroat|grayling/i.test((r.fish || "") + " " + (r.blurb || ""))));
}
/* The temperature line under the flow number. Same 24 h rule as discharge:
   an old temperature is not today's, so it isn't shown at all. */
function waterTempHTML(key, riverObj){
  const t = temps[key];
  if(!t || t.c == null || readingIsOld(t)) return "";
  const f = Math.round(t.c * 9/5 + 32);
  const cue = !isTroutWater(riverObj) ? ""
    : f >= TROUT_REST_F ? "Too warm for trout — give them a rest today."
    : f >= TROUT_WARM_F ? "Warm for trout — fish early, land and release fish fast." : "";
  return `<div class="wtemp">Water <b>${f}°F</b> (${t.c.toFixed(1)}°C)</div>` +
    (cue ? `<div class="tempwarn">🌡 ${cue}</div>` : "");
}

function flowCardHTML(key, riverId){
  const f=flows[key], s=stats[key], st=statusOf(key), m=meta[key];
  const name = (m&&m.name) || GAUGES[key].label;
  // optional per-river "good fishing flow" range (see rivers-data.js goodFlow field)
  const riverObj = RIVERS.find(r=>r.id===riverId);
  const gf = riverObj && riverObj.goodFlow;
  // a reading over a day old is not today's level: no big number, no good-flow verdict
  const old = st.cls === "old";
  const inGoodFlow = (!old && gf && f && f.cfs!=null && key===riverObj.primaryGauge)
    ? (f.cfs>=gf.min && f.cfs<=gf.max) : null;
  const loading = !f;
  const cfsTxt = loading ? `<span class="skel">0000</span>` :
    (f.cfs==null || old ? "—" : Math.round(f.cfs).toLocaleString());
  const when = f&&f.time ? readingWhen(f.time) : "";
  // staff-gauge position: log scale around median, median pinned at 45%
  let curLeft=null;
  if(st.ratio!=null){
    const x = 45 + 28*Math.log2(st.ratio);          // 1x median -> 45%
    curLeft = Math.min(97, Math.max(3, x));
  }
  return `<div class="flowcard">
    <div class="gname">${name}${m&&m.verified===false?' <span title="Could not verify this site ID against the agency station metadata">(unverified)</span>':''}</div>
    <div class="flowrow">
      <span class="cfs">${cfsTxt}<small> CFS</small></span>
      <span class="badge" style="background:${st.color}">${st.label}</span>
    </div>
    ${waterTempHTML(key, riverObj)}
    ${curLeft!=null?`<div class="staff"><div class="bar"></div><div class="tick" style="left:45%"></div><div class="cur" style="left:${curLeft}%"></div></div>`:""}
    <div class="flowmeta">
      ${s?`<span>median <b>${Math.round(s.median).toLocaleString()}</b></span><span>range <b>${Math.round(s.min)}–${Math.round(s.max).toLocaleString()}</b></span><span>${STAT_YEARS}-yr, ±${STAT_WINDOW}d</span>`:`<span>${loading?"loading history…":"history unavailable"}</span>`}
      ${!when ? "" : old ? `<span>last reading <b>${Math.round(f.cfs).toLocaleString()} CFS</b> · <b>${when}</b></span>` : `<span>read <b>${when}</b></span>`}
    </div>
    ${isDWR(key)?`<div class="flowsrc">Colorado Division of Water Resources gauge</div>`:""}
    <div class="plain">${plainLanguage(key, riverId)}</div>
    ${inGoodFlow!=null?`<div class="goodflow ${inGoodFlow?'in':'out'}">${inGoodFlow?'✓ In your good-flow range':'Outside your good-flow range'} (${gf.min}–${gf.max} CFS)</div>`:""}
    ${f&&f.stale?`<div class="stale">⚠ Couldn't reach ${isDWR(key)?"Colorado DWR":"USGS"} — showing the last saved reading${f.fetchedAt?` from ${new Date(f.fetchedAt).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:""}. Cell service is patchy in these canyons; treat as out-of-date.</div>`:""}
  </div>`;
}

/* Rivers with no USGS discharge gauge — most Driftless spring creeks.
   Rather than borrow a number from another watershed and present it as
   this stream's flow, show an honest "no gauge" card and point at the
   nearest gauged river as a regional wetness read, clearly labelled as
   a different stream. */
function nearestGaugedRiver(r){
  const mid = midCoord(r.coords);
  let best = null, bestD = Infinity;
  RIVERS.forEach(o=>{
    if(!o.primaryGauge || o.id===r.id) return;
    if(r.region && o.region !== r.region) return;   // stay inside the region
    const p = GAUGE_POS[o.primaryGauge]; if(!p) return;
    // straight-line distance, longitude squeezed for latitude ~43.5N,
    // then penalised across state lines. Without that penalty the
    // nearest gauge to a Wisconsin coulee creek is often something on
    // the Iowa side of the Mississippi — close on the map, wrong
    // watershed, and under a different agency's regulations.
    let d = Math.sqrt(Math.pow(p[0]-mid[0],2) + Math.pow((p[1]-mid[1])*0.73,2));
    if(o.state !== r.state) d *= 1.8;
    if(d < bestD){ bestD = d; best = o; }
  });
  return best;
}
/* No stream-level class on Driftless water. These creeks have no gauge,
   so any "Below average / Around average" badge here is a classification
   of a *different* stream several valleys over — it reads as this creek's
   level whether or not the caption says otherwise. The raw number stays
   as a regional-wetness hint; the judgement call doesn't. (openRiver asks
   the same question: where no badge shows, no history is fetched for it.) */
const nearShowsClass = r => r.region !== "driftless" && r.region !== "doorcounty";
function noGaugeHTML(r){
  const near = nearestGaugedRiver(r);
  let proxy = "";
  if(near){
    const k = near.primaryGauge, f = flows[k], st = statusOf(k);
    const cfs = f && f.cfs!=null ? Math.round(f.cfs).toLocaleString()+" CFS" : "—";
    const showClass = nearShowsClass(r);
    const badge = showClass
      ? ` <span class="badge" style="background:${st.color};vertical-align:middle">${st.label}</span>`
      : "";
    /* A reading over a day old is no read on today's region at all, so it is
       given as the last reading with its date, never as "currently". */
    const said = st.cls === "old"
      ? `Nearest gauged water is the <b>${near.name}</b>, but ${f.stale ? "the newest reading this phone has from it is" : "its gauge has stopped reporting — the last reading was"} <b>${cfs}</b> on <b>${readingWhen(f.time)}</b>${badge}.
      That's a <i>different stream</i>, and an old number isn't a read on how wet the region is today either.`
      : `Nearest gauged water is the <b>${near.name}</b>, currently <b>${cfs}</b>${badge}.
      That's a <i>different stream</i> — treat it only as a rough read on how wet the region is, not as this creek's flow.`;
    proxy = `<div class="plain" style="margin-top:8px">${said}
      <button class="zoom" data-river="${near.id}" style="margin-top:8px">Open ${near.name.split("—")[0].trim()} →</button></div>`;
  }
  /* The copy is the row's: the river's region, else its regulation source
     (region-less WGFD streams; and through REGS_SRC_ROW, Grand Teton's for the
     park creeks carried on past the boundary). Door County has no gauge at
     all — not on these creeks, not anywhere in the county — and
     nearestGaugedRiver() stays inside a region, so there is deliberately no
     proxy reading offered there; its row says so rather than leaving an empty
     card that looks like a loading failure. The Driftless row has no copy of
     its own: its text is the default below, after the water-trail one. */
  const piUng = PARK_INFO[r.region] || PARK_INFO[r.parkRegsSrc], srcUng = regsSrcRow(r);
  const ungaugedNote = (piUng && piUng.ungauged) || (srcUng && srcUng.ungauged)
    || (r.waterTrail      // the default below is about Driftless spring creeks, and wrong for paddling water
    ? "There's no live USGS discharge gauge on this water trail, and the app doesn't invent a number for it. The nearest gauged river below is only a rough read on how wet the region is — a different river, not this one's level. Look at the water at the access before you put in."
    : "Most Driftless spring creeks are too small to gauge — there's no live number for this one, and the app doesn't invent one. Judge it on arrival: <b>clarity</b> is the thing that matters most. If you can see the bottom in two feet of water it's on; chocolate-brown after a storm means give it a day or two. Spring-fed creeks clear far faster than the bigger freestone rivers, and often fish well the day after rain that has the mainstems blown out.");
  /* On the small-stream regions nearly every creek is ungauged, and the
     card's whole message is one line. The nearby river's reading (a
     different stream, and labelled so before it is even opened) and the
     longer explanation fold underneath it. */
  if(r.region==="driftless" || r.region==="doorcounty" || r.region==="northshore"){
    const what = /\briver\b/i.test(r.name) ? "river" : "creek";
    const label = near ? `Nearest gauge: <b>${near.name.split("—")[0].trim()}</b> — a different stream`
                       : "Why there's no reading here";
    return `<div class="flowcard ungauged">
    <div class="ung-line">No gauge on this ${what} — judge clarity on arrival.</div>
    <details class="fold ung-more" data-fold="ungauged"><summary><span>${label}</span></summary>${proxy}<div class="plain">${ungaugedNote}</div></details>
  </div>`;
  }
  return `<div class="flowcard">
    <div class="gname">No USGS gauge on this water</div>
    <div class="flowrow"><span class="cfs">—<small> CFS</small></span>
      <span class="badge" style="background:var(--st-na)">Ungauged</span></div>
    <div class="plain">${ungaugedNote}</div>
    ${proxy}
  </div>`;
}

/* The rating chip on a float section. Western sections carry a whitewater
   class; Iowa water-trail sections carry the DNR's paddler-skill rating in
   `level` and klass:null. They are different claims by different people, so
   the chip names whose rating it is, and reuses the class colours only as
   easy / middling / hard. */
const DNR_LEVEL_CLS = {Beginner:"k1", Intermediate:"k2", Advanced:"k3"};
function sectionChipHTML(s){
  if(typeof s.klass === "string" && s.klass.trim()){
    const kCls = s.klass.includes("III")?"k3":(s.klass.includes("II")?"k2":"k1");
    return `<span class="klass ${kCls}">Class ${s.klass}</span>`;
  }
  if(typeof s.level !== "string") return "";
  return DNR_LEVEL_CLS[s.level] ? `<span class="klass ${DNR_LEVEL_CLS[s.level]}">DNR: ${s.level}</span>`
                                : `<span class="klass k0">Not rated by the DNR</span>`;
}

function sectionHTML(s){
  const est = floatEstimate(s);
  const put = RAMPS.find(p=>p.id===s.put), take = RAMPS.find(p=>p.id===s.take);
  const canFloat = typeof floatEligible==="function" && floatEligible(s);
  /* A low-head dam is the one thing on an Iowa section that must not be
     missed, so it sits above the notes, one line per dam, with the DNR's
     portage side where the DNR gives one. */
  const dams = Array.isArray(s.dams) ? s.dams : [];
  const damHTML = dams.map(d => `<div class="dam">⚠ Low-head dam on this section: <b>${fbEsc(d.name)}</b>`+
    `${d.portage ? ` — portage ${fbEsc(d.portage)}` : ""}</div>`).join("");
  /* A DNR-rated section already says "DNR: Beginner" in its chip; a second
     "Beginner-friendly" badge would say it twice, and in our words rather
     than the DNR's. The badge stays for sections nobody else has rated. */
  const begBadge = s.beginner && typeof s.level !== "string";
  return `<div class="sec">
    <div class="top"><h3>${s.name}</h3>${sectionChipHTML(s)}</div>
    <div class="meta">
      <span><b>${s.miles}</b> river mi</span>
      <span class="time">⏱ <b>${est.text}</b></span>
      <span class="est">${est.scaled?"estimate · scaled to today's flow":"estimate · typical flow"}</span>
    </div>
    ${begBadge?`<span class="beg">✓ Beginner-friendly</span>`:""}
    ${damHTML}
    <div class="notes">${s.notes}</div>
    <div class="notes" style="margin-top:4px"><span style="color:#1d7a46;font-weight:700">●</span> Put-in <b>${put.name}</b> &nbsp;→&nbsp; <span style="color:#8c4a1d;font-weight:700">●</span> Take-out <b>${take.name}</b></div>
    <div class="shuttle"><b>Shuttle/outfitters:</b> ${s.shuttle}</div>
    <button class="zoom" data-zoom="${s.id}">Show on map →</button>
    ${canFloat ? `<div class="floatbtns">
      <button class="zoom floatgo" data-float="${s.id}">${typeof lakeTripBusy === "function" && lakeTripBusy() ? "🛶 Lake trip running" : "🛶 Start float"}</button>
      <a class="zoom shuttle-link" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${put.pos[0]},${put.pos[1]}&destination=${take.pos[0]},${take.pos[1]}">Shuttle directions →</a>
    </div>` : typeof s.level === "string" && typeof floatEligible === "function"
      ? `<div class="nofloat">Start float is offered on DNR Beginner and Intermediate sections without a dam.</div>` : ""}
  </div>`;
}

function zoomSection(s){
  const put = RAMPS.find(p=>p.id===s.put), take = RAMPS.find(p=>p.id===s.take);
  // zooming to a float is an explicit "show me the ramps" gesture, so switch
  // the boat-ramp layer on even though it's off by default. It is recorded
  // as the user's own choice: on a phone this closes the sheet, which ends
  // the river focus, and that must not take the ramps away again.
  iconUserSet("ramps", true); syncIconLayers();
  // restyle the two ramps as put-in / take-out
  RAMPS.forEach(p=>rampMarkers[p.id].setIcon(apIcon(p,"")));
  rampMarkers[put.id].setIcon(apIcon(put,"sel-put"));
  rampMarkers[take.id].setIcon(apIcon(take,"sel-take"));
  map.fitBounds(L.latLngBounds([put.pos,take.pos]).pad(0.35));
  if(window.innerWidth<900) sheet.classList.remove("open");
}

/* ---------- filters ---------- */
const filters = {act:"all", beg:false, dur:null, cls:null};
function passFilter(s){
  if(filters.beg && !s.beginner) return false;
  // an Iowa water-trail section has no class; the DNR's Beginner stands in for Class I
  const classOne = (typeof s.klass === "string" && s.klass) ? s.klass === "I" : s.level === "Beginner";
  if(filters.cls==="1" && !classOne) return false;
  if(filters.dur){
    const est = floatEstimate(s), mid=(est.lo+est.hi)/2;
    if(filters.dur==="half" && mid>4.2) return false;
    if(filters.dur==="full" && mid<=4.2) return false;
  }
  return true;
}
function riverVisible(r){
  if(!tierShown(r)) return false;
  if(filters.act==="fish") return true;
  const hasSecs = SECTIONS.some(s=>s.river===r.id);
  if(!hasSecs) return filters.act!=="float";   // wade-only rivers hide only in float mode
  if(filters.act==="float" || filters.beg || filters.dur || filters.cls){
    return SECTIONS.some(s=>s.river===r.id && passFilter(s));
  }
  return true;
}
function applyRiver(r){
  const L_ = riverLayers[r.id];
  if(!tierShown(r)){                       // hidden by class: off the map, not dimmed
    if(map.hasLayer(L_.line)) map.removeLayer(L_.line);
    if(map.hasLayer(L_.lbl))  map.removeLayer(L_.lbl);
    L_.reaches.forEach(o => { if(map.hasLayer(o)) map.removeLayer(o); });
    return;
  }
  const readd = !map.hasLayer(L_.line);
  if(readd) L_.line.addTo(map);
  if(!map.hasLayer(L_.lbl))  L_.lbl.addTo(map);
  const on = riverVisible(r);
  L_.line.setStyle({color:on?riverColor(r):"#9aa49b", opacity:on?0.92:0.35, weight:on?tierWeight(r):3});
  // per-reach overlays follow their line: shown, greyed and weighted with it, and kept on top of it
  L_.reaches.forEach(o => {
    if(!map.hasLayer(o)) o.addTo(map); else if(readd) o.bringToFront();
    o.setStyle({color:on?o.reachColor:"#9aa49b", opacity:on?0.92:0.35, weight:on?tierWeight(r):3});
  });
}
function applyFilters(){
  otherInView = otherViewSet();
  RIVERS.forEach(applyRiver);
  syncGaugeDots(); syncLabels(); syncFlow(); refreshZoneCounts();
  syncLakeFilter();
  syncMarkers();
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
  statsSoon();                         // a class switched on can bring gauges into view that need history
}
/* The Other rivers the view gate lets through right now (see tierShown). */
function otherViewSet(){
  const set = new Set();
  if(focusId) set.add(focusId);
  if(!tierFilter["3"] || zonesShown || map.getZoom() < OTHER_MIN_ZOOM || !map.getSize().x) return set;
  const view = map.getBounds().pad(OTHER_VIEW_PAD);
  RIVERS.forEach(r => {
    if(!isOther(r)) return;
    const b = riverBounds(r);
    if(b.isValid() && view.intersects(b)) set.add(r.id);
  });
  return set;
}
/* On moveend, only the Other rivers that came into or went out of the gate
   are redrawn — not a full applyFilters() over every river on each pan. */
function syncOtherRivers(){
  const next = otherViewSet(), changed = [];
  next.forEach(id => { if(!otherInView.has(id)) changed.push(id); });
  otherInView.forEach(id => { if(!next.has(id)) changed.push(id); });
  otherInView = next;
  if(!changed.length) return;
  changed.forEach(id => { const r = riverLayers[id] && riverLayers[id].river; if(r) applyRiver(r); });
  syncGaugeDots(); syncLabels(); syncFlow(); syncMarkers();
}
let otherT = null;
function syncOtherLater(){
  clearTimeout(otherT);
  otherT = setTimeout(() => {
    if(map._animatingZoom){ syncOtherLater(); return; }      // not mid-animation
    syncOtherRivers();
  }, 150);
}
map.on("moveend", syncOtherLater);
map.on("zoomstart", () => clearTimeout(otherT));
/* Does this access point survive the current filter chips? Visibility also
   depends on zoom and on whether its group is switched on — see syncMarkers. */
function rampPassesFilter(p){
  if(filters.act==="float" && p.role==="wade") return false;
  if((filters.beg||filters.dur||filters.cls) && p.role!=="wade"){
    return SECTIONS.some(s=>(s.put===p.id||s.take===p.id) && passFilter(s));
  }
  return true;
}

/* Chip toolbar removed from app.html for now. filters{} stays at its
   defaults (everything visible) and the machinery below it — passFilter(),
   riverVisible(), applyFilters() — is untouched, so re-adding the markup
   and this listener is all it takes to get the filters back. */

/* ---------- sheet drag / close ---------- */
$("#sheet-x").addEventListener("click",()=>{ sheet.classList.remove("open"); curRiver=null; });
let dragY=null;
$("#grab").addEventListener("pointerdown",e=>{ dragY=e.clientY; });
window.addEventListener("pointermove",e=>{
  if(dragY==null) return;
  const dy=e.clientY-dragY;
  if(dy<-40){ sheet.classList.add("tall"); dragY=null; }
  if(dy>50){ if(sheet.classList.contains("tall")) sheet.classList.remove("tall"); else {sheet.classList.remove("open");curRiver=null;} dragY=null; }
});
window.addEventListener("pointerup",()=>dragY=null);

/* ---------- legend ---------- */
const scrim=$("#scrim"), legend=$("#legend");
$("#btn-legend").addEventListener("click",()=>{scrim.classList.add("show");legend.classList.add("show");});
$("#legend-x").addEventListener("click",closeLegend);
scrim.addEventListener("click",closeLegend);
function closeLegend(){scrim.classList.remove("show");legend.classList.remove("show");}

/* ---------- Field Book: river and lake panel row ----------
   The favourite / fished / notes / trips controls live in #fbrow, a sibling
   that sits just above #sheetbody, NOT inside it. renderSheet() rewrites
   #sheetbody's innerHTML every time stats load or a filter changes; a
   textarea in there would lose its focus and caret mid-sentence. Outside it,
   nothing re-renders it: fbShowRow() rebuilds it only when the water changes
   (or after an import), and everything in it updates itself in place.
   A lake gets the same row; fbRowFor is kind + id, so a river and a lake that
   happen to share an id are never the same row. */
let fbRowFor = null, fbRowWater = null, fbRowKind = null, fbRowPaint = null, fbRowGoPaint = null;
const fbEsc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function fbToday(){ const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function fbDateText(iso){
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso||""); if(!m) return "";
  // the year only when it isn't this one: "Oct 12" vs "Oct 12, 2025"
  const o = {month:"short", day:"numeric"};
  if(+m[1] !== new Date().getFullYear()) o.year = "numeric";
  return new Date(+m[1], +m[2]-1, +m[3]).toLocaleDateString([], o);
}
function fbTimeText(hm){
  if(!fbValidTime(hm)) return "";
  const [h, m] = hm.split(":");
  return new Date(2000, 0, 1, +h, +m).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
}
const fbNowHM = () => { const d = new Date(); return String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); };
const fbKeyOf = (kind, id) => kind==="lake" ? "lake:" + id : id;
function fbFishedLabel(trips){
  return trips.length ? `✓ Fished ${trips.length}× · ${fbDateText(trips[0].day)}` : "✓ Fished";
}
/* `tracks`: this lake records trips (laketrip.js's pilot lakes), so Start
   fishing sits next to ✓ Fished. Its label is set by paint(). */
function fbRowHTML(e, trips, kind, tracks){
  const what = kind==="lake" ? "lake" : "river";
  return `<button type="button" class="fb-btn fb-fav${e.fav?" on":""}" aria-pressed="${e.fav}">${e.fav?"★":"☆"} Favorite</button>`+
    `<button type="button" class="fb-btn fb-fished${trips.length?" on":""}">${fbEsc(fbFishedLabel(trips))}</button>`+
    (tracks ? `<button type="button" class="fb-btn fb-lakego">Start fishing</button>` : "")+
    `<button type="button" class="fb-btn fb-notes${(e.notes||"").trim()?" has":""}" aria-expanded="false">Notes</button>`+
    `<button type="button" class="fb-btn fb-tripsb" aria-expanded="false">Trips</button>`+
    `<div class="fb-ta"><textarea rows="3" maxlength="20000" placeholder="Flies that worked, where you parked, water clarity…" aria-label="Notes for this ${what}"></textarea>`+
    `<span class="fb-saved" aria-live="polite"></span></div>`+
    `<div class="fb-trips"></div>`;
}
/* The date/time/note inputs shared by Edit and "+ Add a past trip". max=today
   is a hint to the picker; save checks it again because a typed date can
   ignore it. A lake trip also takes the user's own water temperature: a lake
   has no gauge, so the thermometer in their pocket is the only reading. */
const FB_WT_MIN = 32, FB_WT_MAX = 95;
/* A tracked trip has no date or time inputs: those are when the track was
   recorded (fbEditTrip refuses to change them too). */
function fbTripFormHTML(t, kind){
  const wt = kind==="lake"
    ? `<label><span>Water temp °F</span><input type="number" inputmode="decimal" step="any" min="${FB_WT_MIN}" max="${FB_WT_MAX}" class="fbt-wt" value="${t.wtUser!=null ? fbEsc(t.wtUser) : ""}" placeholder="Optional"></label>`
    : "";
  const when = t.track
    ? `<div class="fbt-fixed">Recorded ${fbEsc(fbDateText(t.day))}${t.time ? " · " + fbEsc(fbTimeText(t.time)) : ""}. The date and time are the recording's own.</div>`
    : `<label><span>Date</span><input type="date" class="fbt-day" max="${fbToday()}" value="${fbEsc(t.day)}" required></label>`+
      `<label><span>Time</span><input type="time" class="fbt-time" value="${fbEsc(t.time||"")}"></label>`;
  return `<div class="fbt-form">`+ when + wt +
    `<label class="fbt-wide"><span>Note</span><input type="text" class="fbt-note" maxlength="500" value="${fbEsc(t.note||"")}" placeholder="Optional"></label>`+
    `<div class="fbt-err" aria-live="polite"></div>`+
    `<div class="fbt-acts"><button type="button" class="fbt-btn fbt-primary" data-act="save">Save</button>`+
    `<button type="button" class="fbt-btn" data-act="cancel">Cancel</button></div></div>`;
}
/* The conditions under a trip in the Trips list. The forecast line starts
   with "Forecast" because it is what NWS expected for that hour, not what
   anyone measured; the gauge line is a real reading. A trip typed in later
   says outright that nothing was recorded, so a blank is never mistaken for
   "nothing notable". */
function fbCondHTML(t){
  const lines = [], c = t.cond || {};
  const line = (txt, title) => `<span class="fbt-cond"${title ? ` title="${fbEsc(title)}"` : ""}>${fbEsc(txt)}</span>`;
  if(t.src==="tap"){
    if(c.wx){
      const w = c.wx, wind = wxTop(w.ws)===0 ? "calm" : `${w.wd} ${w.ws}`.trim();
      const hr = wxHour(w);
      lines.push(line([`Forecast ${w.t}°${w.u}`, `Wind ${wind}`, w.sf].filter(Boolean).join(" · "),
        `National Weather Service hourly forecast${hr ? " for the hour from " + hr : ""}`));
    }else if(fbWxIsPending(t.id)) lines.push(line("Forecast loading…"));
    if(c.flow){
      const f = c.flow, g = GAUGES[f.g];
      lines.push(line(["Gauge " + f.cfs.toLocaleString() + " CFS", f.st && f.st.label, f.wtF!=null && `Water ${f.wtF}°F`].filter(Boolean).join(" · "),
        g ? `${g.label} gauge` : ""));
    }
    if(!lines.length) lines.push(line("No conditions available at the time"));
  }else lines.push(line("Conditions not recorded"));
  if(t.wtUser!=null) lines.push(line(`Water ${t.wtUser}°F (your reading)`));
  return lines.join("");
}
function fbShowRow(water, force, kind){
  kind = kind || "river";
  const row = $("#fbrow"), rowKey = kind + "|" + water.id;
  // same water: keep the row (and anything half-typed in it), but a float or
  // lake trip may have started or ended since, so its Start label is redone
  if(!force && fbRowFor === rowKey){ if(fbRowGoPaint) fbRowGoPaint(); return; }
  // a track shown from this row's list belongs to this water's sheet
  if(fbRowFor !== rowKey && typeof lakeTripHideShown === "function") lakeTripHideShown();
  fbRowFor = rowKey; fbRowWater = water; fbRowKind = kind;
  const id = fbKeyOf(kind, water.id), e = fbGet(id);
  const tracks = kind==="lake" && typeof lakeTripPilot === "function" && lakeTripPilot(water.id);
  row.innerHTML = fbRowHTML(e, fbTrips(kind, water.id), kind, tracks);
  const favB = row.querySelector(".fb-fav"), fishB = row.querySelector(".fb-fished"),
        notesB = row.querySelector(".fb-notes"), tripsB = row.querySelector(".fb-tripsb"),
        box = row.querySelector(".fb-ta"), ta = row.querySelector("textarea"),
        saved = row.querySelector(".fb-saved"), list = row.querySelector(".fb-trips"),
        goB = row.querySelector(".fb-lakego");
  ta.value = e.notes || "";
  const openNotes = on => { box.classList.toggle("show", on); notesB.setAttribute("aria-expanded", on); };
  openNotes(!!(e.notes||"").trim());
  // list state: which trip is being edited, which is asking "delete?", and the add form
  let editing = null, confirming = null, adding = false;
  const openTrips = on => {
    list.classList.toggle("show", on); tripsB.setAttribute("aria-expanded", on);
    if(on) paintTrips();
  };
  function paintTrips(){
    if(!list.classList.contains("show")) return;
    const trips = fbTrips(kind, water.id);
    list.innerHTML = trips.map(t => {
      if(t.id === editing) return `<div class="fbt-row" data-trip="${fbEsc(t.id)}">${fbTripFormHTML(t, kind)}</div>`;
      const when = fbDateText(t.day) + " · " + (t.time ? fbTimeText(t.time) : "time not recorded");
      // a recorded track: its own summary line, and a button to draw it over the lake
      const tracked = !!(t.track && typeof t.track === "object");
      const shown = tracked && typeof lakeTripShownId === "function" && lakeTripShownId() === t.id;
      const showB = tracked && typeof lakeTripToggleShow === "function"
        ? `<button type="button" class="fbt-btn${shown ? " fbt-primary" : ""}" data-act="show" aria-pressed="${shown}">${shown ? "Hide on map" : "Show on map"}</button>` : "";
      const acts = t.id === confirming
        ? `<span class="fbt-ask">Delete this trip${tracked ? " and its track" : ""}?</span><button type="button" class="fbt-btn fbt-danger" data-act="yes">Yes</button><button type="button" class="fbt-btn" data-act="no">No</button>`
        : showB + `<button type="button" class="fbt-btn" data-act="edit">Edit</button><button type="button" class="fbt-btn" data-act="del">Delete</button>`;
      return `<div class="fbt-row" data-trip="${fbEsc(t.id)}"><div class="fbt-main"><span class="fbt-when">${fbEsc(when)}</span>`+
        (tracked ? `<span class="fbt-track">${fbEsc(typeof lakeTripSummary === "function" ? lakeTripSummary(t) : "Tracked")}</span>` : "")+
        (t.note ? `<span class="fbt-note">${fbEsc(t.note)}</span>` : "")+ fbCondHTML(t)+
        `</div><div class="fbt-acts">${acts}</div></div>`;
    }).join("") + (adding
      ? `<div class="fbt-row fbt-add" data-trip="">${fbTripFormHTML({day:fbToday(), time:null}, kind)}</div>`
      : `<button type="button" class="fbt-btn fbt-addb" data-act="add">+ Add a past trip</button>`);
  }
  const paint = () => {
    const c = fbGet(id), trips = fbTrips(kind, water.id);
    favB.classList.toggle("on", c.fav); favB.setAttribute("aria-pressed", c.fav);
    favB.textContent = (c.fav ? "★" : "☆") + " Favorite";
    fishB.classList.toggle("on", trips.length > 0);
    fishB.textContent = fbFishedLabel(trips);
    paintGo();
    paintTrips();
  };
  // "Start fishing", or why it can't right now: one recorder at a time
  function paintGo(){
    if(!goB || typeof lakeTripButton !== "function") return;
    const s = lakeTripButton(water.id);
    goB.textContent = s.label;
    goB.classList.toggle("on", s.state === "running");
    goB.classList.toggle("busy", s.state === "blocked");
  }
  paintGo();
  fbRowPaint = paint; fbRowGoPaint = paintGo;
  if(goB) goB.addEventListener("click", () => { if(typeof lakeTripOpenPlanner === "function") lakeTripOpenPlanner(water.id); });
  favB.addEventListener("click", () => {
    fbSet(id, {fav:!fbGet(id).fav}); paint();
    if(typeof Metrics !== "undefined" && fbIsFav(id)) Metrics.track("favourite_add", kind);   // only a favourite that saved
    if(kind==="river") applyFilters();     // a favourite river stays on the map whatever the class filter says
  });
  // Not a toggle: every tap is another trip, and the toast's Undo is the way back.
  fishB.addEventListener("click", () => {
    const t = fbAddTrip(kind, water.id, fbToday(), fbNowHM(), "tap", Date.now());
    // never "Trip logged" for a trip a reload would lose; always said, whatever the rate limit
    if(!t){ paint(); fbWarnAt = Date.now(); fbToast(FB_FULL_MSG); return; }
    if(typeof Metrics !== "undefined") Metrics.track("trip_logged", kind);
    const condOk = fbSnapTrip(t, kind, water);
    paint();
    fbToast(`Trip logged · ${fbDateText(t.day)}, ${fbTimeText(t.time)}` + (condOk ? "" : " · conditions not saved, storage full"), () => {
      fbDelTrip(t.id);
      if(fbRowFor === rowKey) fbRowPaint();     // the row may have been rebuilt since (an import)
    });
  });
  notesB.addEventListener("click", () => {
    const on = !box.classList.contains("show");
    openNotes(on); if(on) ta.focus();
  });
  tripsB.addEventListener("click", () => {
    editing = confirming = null; adding = false;
    openTrips(!list.classList.contains("show"));
  });
  list.addEventListener("click", ev => {
    const b = ev.target.closest("[data-act]"); if(!b) return;
    const rowEl = b.closest(".fbt-row"), tid = rowEl ? rowEl.dataset.trip : null, act = b.dataset.act;
    if(act==="edit"){ editing = tid; confirming = null; adding = false; }
    else if(act==="del"){ confirming = tid; editing = null; }
    else if(act==="no"){ confirming = null; }
    else if(act==="yes"){
      // the track goes with the trip, and off the map if it was drawn
      if(typeof lakeTripShownId === "function" && lakeTripShownId() === tid) lakeTripHideShown();
      fbDelTrip(tid); confirming = null;
    }
    else if(act==="show"){
      const tr = fbState.trips.find(x => x.id===tid);
      if(tr && typeof lakeTripToggleShow === "function") lakeTripToggleShow(tr, water);
    }
    else if(act==="add"){ adding = true; editing = confirming = null; }
    else if(act==="cancel"){ editing = null; adding = false; }
    else if(act==="save"){
      const dayIn = rowEl.querySelector(".fbt-day"), timeIn = rowEl.querySelector(".fbt-time"),
            note = rowEl.querySelector(".fbt-note").value, err = rowEl.querySelector(".fbt-err");
      const patch = {note};
      // a tracked trip's form has no date or time: they are the recording's own
      if(dayIn){
        const day = dayIn.value, time = timeIn ? timeIn.value : "";
        if(!fbValidDay(day)){ err.textContent = "Pick a date."; return; }
        if(day > fbToday()){ err.textContent = "That date hasn't happened yet."; return; }
        if(time && !fbValidTime(time)){ err.textContent = "That time isn't valid."; return; }
        patch.day = day; patch.time = time||null;
      }
      const wtIn = rowEl.querySelector(".fbt-wt");
      if(wtIn){
        // badInput: the field holds text that isn't a number, which .value reports as ""
        const raw = wtIn.value.trim().replace(",", "."), v = raw==="" ? null : Number(raw);
        if(wtIn.validity.badInput || (v!==null && !(isFinite(v) && v>=FB_WT_MIN && v<=FB_WT_MAX))){
          err.textContent = `Water temp should be ${FB_WT_MIN}–${FB_WT_MAX} °F.`; return;
        }
        patch.wtUser = v===null ? null : Math.round(v*10)/10;
      }
      // Not saved: leave the form open with what was typed, so nothing is lost and it can be tried again
      const done = tid ? fbEditTrip(tid, patch) !== false
                 : !patch.day || !!fbAddTrip(kind, water.id, patch.day, patch.time, "manual", null, note, patch.wtUser);
      if(!done){ err.textContent = FB_FULL_MSG + "."; return; }
      editing = null; adding = false;
    }
    paint();                  // no auto-focus: on an iPhone it would throw the date wheel up unasked
  });
  let t = null;
  ta.addEventListener("input", () => {
    saved.textContent = ""; saved.classList.remove("warn");
    clearTimeout(t);
    t = setTimeout(() => {
      if(!fbSet(id, {notes:ta.value})){ saved.textContent = "Not saved — storage full"; saved.classList.add("warn"); return; }
      notesB.classList.toggle("has", !!ta.value.trim());
      saved.textContent = "Saved";
      setTimeout(() => { if(saved.textContent==="Saved") saved.textContent = ""; }, 1600);
    }, 400);
  });
}
/* A small app-level toast with one action, for "Trip logged · Undo". Its own
   element, not float.js's, so the Field Book works without Float Mode. A new
   toast replaces the old one, and its Undo then belongs to the new trip. */
function fbToast(msg, undo){
  const el = $("#fbtoast"); if(!el) return;
  el.querySelector(".fbt-msg").textContent = msg;
  const b = el.querySelector("button");
  b.hidden = !undo;
  b.onclick = () => { clearTimeout(fbToast.t); el.classList.remove("show"); if(undo) undo(); };
  el.classList.add("show");
  clearTimeout(fbToast.t);
  fbToast.t = setTimeout(() => { el.classList.remove("show"); b.onclick = null; }, 6000);
}

/* ---------- Field Book: research links ----------
   Plain outbound searches built from the river's name. Nothing is fetched. */
function fbCleanName(r){ return r.name.split("—")[0].split("(")[0].trim(); }
function reportSearchURL(r){ return "https://www.google.com/search?q="+encodeURIComponent(`${fbCleanName(r)} ${riverStateName(r)} fishing report`); }
// The Field Book's Research tab: every link, Reddit included.
function researchLinksHTML(r){
  const n = fbCleanName(r), st = riverStateName(r), q = encodeURIComponent;
  const links = [
    ["Reddit — posts about this river", "https://www.reddit.com/search/?q="+q(`"${n}" ${st} fishing`)],
    ["r/flyfishing — this river", "https://www.reddit.com/r/flyfishing/search/?restrict_sr=1&q="+q(n)],
    ["Current fishing report (web search)", reportSearchURL(r)],
  ];
  return `<div class="fb-links">${links.map(([t,u]) => `<a href="${fbEsc(u)}" target="_blank" rel="noopener">${t} ↗</a>`).join("")}</div>`;
}
/* The river sheet: one link, not a Research section. The Reddit searches
   live in the Field Book, for the rivers you've starred. */
function reportSearchHTML(r){
  return `<div class="fb-links rp-search"><a href="${fbEsc(reportSearchURL(r))}" target="_blank" rel="noopener">Search for fishing reports ↗</a></div>`;
}

/* ---------- Offline map areas ----------
   Only the USGS Topo basemap is saved: the other basemaps' terms forbid
   offline copies. Tiles go into the same "tiles-saved" cache the service
   worker reads first. Saving is a page job (not the worker's) so it can show
   progress and be cancelled. */
const TOPO_URL = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}";
const TILE_KB = 18, TILE_CAP = 4000;
const offFmt = n => n.toLocaleString("en-US");
function offAreas(){ try{ const a = JSON.parse(localStorage.getItem("offlineAreas")||"[]"); return Array.isArray(a) ? a : []; }catch(e){ return []; } }
function offSave(a){ try{ localStorage.setItem("offlineAreas", JSON.stringify(a)); }catch(e){} }
function offRange(b, z){
  const n = 2**z, X = lng => Math.floor((lng+180)/360*n),
    Y = lat => { const p = lat*Math.PI/180; return Math.floor((1 - Math.log(Math.tan(p)+1/Math.cos(p))/Math.PI)/2*n); },
    cl = v => Math.max(0, Math.min(n-1, v));
  return {x0:cl(X(b[0][1])), x1:cl(X(b[1][1])), y0:cl(Y(b[1][0])), y1:cl(Y(b[0][0]))};   // north edge has the smaller y
}
function offCount(b, z0, z1){
  let t = 0;
  for(let z = z0; z <= z1; z++){ const r = offRange(b, z); t += (r.x1-r.x0+1)*(r.y1-r.y0+1); }
  return t;
}
function offUrls(b, z0, z1){
  const out = [];
  for(let z = z0; z <= z1; z++){
    const r = offRange(b, z);
    for(let x = r.x0; x <= r.x1; x++) for(let y = r.y0; y <= r.y1; y++) out.push(TOPO_URL.replace("{z}",z).replace("{y}",y).replace("{x}",x));
  }
  return out;
}
/* Plan the view: zmax as deep as the 4,000-tile cap allows, from 16 down to 14. */
function offPlan(){
  const bb = map.getBounds(), b = [[bb.getSouth(), bb.getWest()], [bb.getNorth(), bb.getEast()]];
  const zmin = Math.max(6, Math.floor(map.getZoom())-2);
  for(const zmax of [16, 15, 14]){
    if(zmax < zmin) continue;
    const count = offCount(b, zmin, zmax);
    if(count <= TILE_CAP) return {b, zmin, zmax, count};
  }
  return null;
}
let offJob = null;   // {cancel:bool} while a download runs

function renderOffline(el){
  if(!("caches" in window) || !("serviceWorker" in navigator)){
    el.innerHTML = `<p class="bk-intro">Offline saving isn't supported in this browser.</p>`; return;
  }
  const draw = () => {
    const areas = offAreas();
    el.innerHTML = `<p class="bk-intro">The app itself and your last flow readings already work without signal. Save map areas here to keep the topo basemap too. Only the USGS Topo basemap is saved — the other basemaps' terms don't allow it.</p>`+
      `<div id="of-ctl"><button type="button" class="fb-btn" id="of-go" style="width:100%">Save this area</button></div>`+
      `<div class="secthead">Saved areas</div>`+
      (areas.length ? areas.map(a => `<div class="of-area" data-id="${fbEsc(a.id)}"><div class="of-main"><b>${fbEsc(a.name)}</b>`+
          `<span>${fbEsc(new Date(a.saved).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}))} · ${offFmt(a.count)} tiles · z${a.zmin}–${a.zmax}</span></div>`+
          `<button type="button" class="fb-btn" data-of="show">Show</button><button type="button" class="fb-btn" data-of="del">Delete</button></div>`).join("")
        : `<p class="fb-note">Nothing saved yet.</p>`)+
      `<p class="fb-note" id="of-use"></p>`;
    if(navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(s => {
      const u = el.querySelector("#of-use"); if(u && s && s.usage!=null) u.textContent = `Using ${Math.round(s.usage/1048576)} MB on this phone.`;
    }).catch(()=>{});
    const ctl = el.querySelector("#of-ctl");
    el.querySelector("#of-go").addEventListener("click", () => {
      const p = offPlan();
      if(!p){ ctl.insertAdjacentHTML("beforeend", `<p class="fb-note" style="color:#9a4a2e">Zoom in closer — this view would be over ${offFmt(TILE_CAP)} tiles.</p>`); return; }
      const c = map.getCenter(), open = curRiver && RIVERS.find(x => x.id===curRiver);
      const name = open ? open.name : `Area near ${c.lat.toFixed(2)}, ${c.lng.toFixed(2)}`;
      ctl.innerHTML = `<div class="of-box"><div>≈ ${offFmt(p.count)} tiles, about ${Math.max(1, Math.round(p.count*TILE_KB/1024))} MB (z${p.zmin}–${p.zmax})</div>`+
        `<input type="text" id="of-name" maxlength="60" aria-label="Area name" value="${fbEsc(name)}">`+
        `<div class="of-row"><button type="button" class="fb-btn on" id="of-ok">Save</button><button type="button" class="fb-btn" id="of-no">Cancel</button></div></div>`;
      ctl.querySelector("#of-no").addEventListener("click", draw);
      ctl.querySelector("#of-ok").addEventListener("click", () => offDownload(el, ctl, p, ctl.querySelector("#of-name").value.trim() || name, draw));
    });
    el.querySelectorAll(".of-area").forEach(row => row.addEventListener("click", ev => {
      const act = ev.target.dataset.of, a = areas.find(x => x.id===row.dataset.id); if(!act || !a) return;
      if(act==="show"){ closeBook(); goTo(L.latLngBounds(a.bounds)); }
      else offDelete(a.id).then(draw);
    }));
  };
  draw();
}

async function offDownload(el, ctl, p, name, done){
  const cache = await caches.open("tiles-saved");
  try{ navigator.storage && navigator.storage.persist && await navigator.storage.persist(); }catch(e){}
  const urls = offUrls(p.b, p.zmin, p.zmax), job = offJob = {cancel:false};
  let n = 0, failed = 0, i = 0;
  ctl.innerHTML = `<div class="of-box"><div id="of-txt">0 / ${offFmt(urls.length)}</div><div class="of-bar"><i id="of-fill"></i></div>`+
    `<div class="of-row"><button type="button" class="fb-btn" id="of-stop">Cancel</button></div></div>`;
  ctl.querySelector("#of-stop").addEventListener("click", () => { job.cancel = true; });
  const txt = ctl.querySelector("#of-txt"), fill = ctl.querySelector("#of-fill");
  const tick = () => { txt.textContent = `${offFmt(n)} / ${offFmt(urls.length)}`; fill.style.width = (n/urls.length*100)+"%"; };
  const one = async u => {
    if(await cache.match(u)) return true;
    for(let t = 0; t < 2; t++){                      // one retry per tile
      try{ const r = await fetch(u, {mode:"cors"}); if(r.ok){ await cache.put(u, r); return true; } }catch(e){}
    }
    return false;
  };
  const worker = async () => {
    while(!job.cancel && i < urls.length){
      const u = urls[i++];
      if(!(await one(u))) failed++;
      n++; tick();
    }
  };
  await Promise.all(Array.from({length:6}, worker));
  offJob = null;
  if(job.cancel){ await offPrune(); done(); return; }   // drop what a cancelled save left behind
  const areas = offAreas();
  areas.unshift({id:"a"+Date.now().toString(36), name, bounds:p.b, zmin:p.zmin, zmax:p.zmax, count:urls.length-failed, saved:Date.now()});
  offSave(areas);
  if(typeof Metrics !== "undefined") Metrics.track("offline_save");
  done();
  if(failed) el.querySelector("#of-ctl").insertAdjacentHTML("beforeend", `<p class="fb-note" style="color:#9a4a2e">${offFmt(failed)} tiles couldn't be downloaded (saved the rest). Try again with a better signal.</p>`);
}
/* Delete every saved tile no remaining area needs: recompute the URL sets
   rather than counting references, so overlapping areas keep shared tiles. */
async function offPrune(){
  const keep = new Set();
  offAreas().forEach(a => offUrls(a.bounds, a.zmin, a.zmax).forEach(u => keep.add(u)));
  const cache = await caches.open("tiles-saved");
  for(const k of await cache.keys()) if(!keep.has(k.url)) await cache.delete(k);
}
async function offDelete(id){
  offSave(offAreas().filter(a => a.id!==id));
  try{ await offPrune(); }catch(e){}
}

/* ---------- Field Book page ---------- */
/* Offline: the service worker caches the app and, by hand-off, the topo
   tiles. Needs https (or localhost); a relative path keeps it working at the
   GitHub Pages sub-path. */
if("serviceWorker" in navigator && (location.protocol==="https:"||location.hostname==="localhost")) navigator.serviceWorker.register("sw.js").catch(()=>{});

const bookEl = $("#book"), bookBody = $("#book-body");

/* A water in the book is {kind, id}: a river by its id, a lake by its LAKES
   id (stored under "lake:"+id). Waters this build doesn't know are left in
   storage but not listed. */
function fbWater(kind, id){
  const w = kind==="lake" ? (typeof LAKES==="undefined" ? null : LAKES.find(x => x.id===id)) : RIVERS.find(x => x.id===id);
  return w ? {kind, id, w, key:fbKeyOf(kind, id)} : null;
}
// every stored favourite/notes entry, rivers and lakes alike, that passes fn
const fbWatersWhere = fn => Object.keys(fbAll()).map(k => k.startsWith("lake:") ? fbWater("lake", k.slice(5)) : fbWater("river", k))
  .filter(x => x && fn(fbAll()[x.key]));
const fbByName = list => list.sort((a,b) => a.w.name.localeCompare(b.w.name));
const fbEmpty = t => `<div class="bk-empty">${t}</div>`;
// a row that opens its water: data-fbopen for a river, data-fblake for a lake
const fbOpenAttr = x => x.kind==="lake" ? `data-fblake="${fbEsc(x.id)}"` : `data-fbopen="${fbEsc(x.id)}"`;
const fbPlace = x => x.kind==="lake" ? lakePlace(x.w) : riverPlace(x.w);

function bookRowsHTML(list, fishedLine){
  return list.map(x => {
    const e = fbGet(x.key), k = x.kind==="river" ? x.w.primaryGauge : null;
    // Live status chip only when a reading has actually loaded — same
    // statusOf() the flow card uses, so the colours are the gauge's own.
    const st = k && flows[k] && flows[k].cfs!=null ? statusOf(k) : null;
    const note = (e.notes||"").trim(), fl = fishedLine ? fishedLine(x) : "";
    return `<button type="button" class="bk-row" ${fbOpenAttr(x)}>`+
      `<span class="bk-main"><span class="bk-name">${fbEsc(x.w.name)}</span>`+
      `<span class="bk-place">${fbEsc(fbPlace(x))}</span>`+
      (fl ? `<span class="bk-fished">${fbEsc(fl)}</span>` : "")+
      (note ? `<span class="bk-snip">${fbEsc(note.length>90 ? note.slice(0,90).trim()+"…" : note)}</span>` : "")+
      `</span>`+
      (st ? `<span class="badge" style="background:${st.color}">${st.label}</span>` : "")+
      `</button>`;
  }).join("");
}

/* Add a section here to add a tab. render(el) fills the panel; the shell owns
   the tab bar, remembers the last tab, and makes any [data-fbopen] inside
   it fly to that river ([data-fblake] to that lake). */
const BOOK_SECTIONS = [
  {id:"fav", label:"Favorites", render(el){
    const list = fbByName(fbWatersWhere(e => e.fav));
    el.innerHTML = list.length ? bookRowsHTML(list) : fbEmpty("No favorites yet.<br>Tap <b>☆ Favorite</b> on any river to keep it here — and on the map, whatever the class filter says.");
  }},
  {id:"fished", label:"Fished", render(el){
    // one row per water, the most recently fished first
    const by = new Map();
    fbState.trips.forEach(t => {
      const k = t.kind + "|" + t.water;
      if(!by.has(k)){ const x = fbWater(t.kind, t.water); if(!x) return; by.set(k, x); }
    });
    const list = [...by.values()].map(x => Object.assign(x, {trips:fbTrips(x.kind, x.id)}))
      .sort((a,b) => fbTripSort(b.trips[0]).localeCompare(fbTripSort(a.trips[0])));
    el.innerHTML = list.length
      ? bookRowsHTML(list, x => `${x.trips.length} trip${x.trips.length===1?"":"s"} · last ${fbDateText(x.trips[0].day)}`)
      : fbEmpty("Nothing logged yet.<br>Tap <b>✓ Fished</b> each time you go — every trip is kept here with its date.");
  }},
  {id:"notes", label:"Notes", render(el){
    const list = fbWatersWhere(e => (e.notes||"").trim()).sort((a,b) => fbGet(b.key).updated - fbGet(a.key).updated);
    el.innerHTML = list.length ? list.map(x =>
      `<button type="button" class="bk-row" ${fbOpenAttr(x)}><span class="bk-main">`+
        `<span class="bk-name">${fbEsc(x.w.name)}</span><span class="bk-place">${fbEsc(fbPlace(x))}</span>`+
        `<span class="bk-full">${fbEsc(fbGet(x.key).notes.trim())}</span></span></button>`
    ).join("") : fbEmpty("No notes yet.<br>Tap <b>Notes</b> on any river to jot down flies, parking and water clarity.");
  }},
  {id:"research", label:"Research", render(el){
    // rivers only: the research links are built for a river's name and state
    const list = fbByName(fbWatersWhere(e => e.fav).filter(x => x.kind==="river"));
    let h = `<p class="bk-intro">Research for your favorite rivers — more research tools will appear here.</p>`;
    h += list.length ? list.map(x =>
      `<div class="bk-res"><button type="button" class="bk-name" data-fbopen="${fbEsc(x.id)}">${fbEsc(x.w.name)}</button>${researchLinksHTML(x.w)}</div>`
    ).join("") + `<p class="fb-note">Links open outside the app; posts belong to their authors.</p>`
      : fbEmpty("Favorite a river to get research links for it here.<br>Tap <b>☆ Favorite</b> on any river.");
    el.innerHTML = h;
  }},
  {id:"offline", label:"Offline", render: renderOffline},
];

let bookTab = "fav";
try{ const t = localStorage.getItem("bookTab"); if(BOOK_SECTIONS.some(s => s.id===t)) bookTab = t; }catch(e){}
function showBookTab(id){
  const sec = BOOK_SECTIONS.find(s => s.id===id) || BOOK_SECTIONS[0];
  bookTab = sec.id;
  try{ localStorage.setItem("bookTab", bookTab); }catch(e){}
  $("#book-tabs").querySelectorAll("button").forEach(b => {
    const on = b.dataset.tab===bookTab; b.classList.toggle("on", on); b.setAttribute("aria-selected", on);
  });
  sec.render(bookBody);
  bookBody.scrollTop = 0;
}
function openBook(){
  if(typeof Metrics !== "undefined") Metrics.track("fieldbook_open");
  $("#book-tabs").innerHTML = BOOK_SECTIONS.map(s => `<button type="button" role="tab" data-tab="${s.id}">${s.label}</button>`).join("");
  $("#book-msg").textContent = "";
  showBookTab(bookTab);
  bookEl.classList.add("show");
}
function closeBook(){ bookEl.classList.remove("show"); }
$("#btn-book").addEventListener("click", openBook);
$("#book-x").addEventListener("click", closeBook);
window.addEventListener("keydown", e => { if(e.key==="Escape" && bookEl.classList.contains("show")) closeBook(); });

/* ---------- Report an issue ----------
   Sends river, issue text, optional email and the app version to Supabase
   (js/config.js). Nothing else — no location. Draft survives a dropped signal. */
const APP_VERSION = "flyroutes-v33";
const reportEl = $("#report"), rpForm = $("#report-form");
let rpRiverId = null;
function rpNames(){
  const m = new Map();
  RIVERS.forEach(r => m.set(r.name.toLowerCase(), {id:r.id, name:r.name}));
  (typeof LAKES==="undefined" ? [] : LAKES).forEach(k => { if(!m.has(k.name.toLowerCase())) m.set(k.name.toLowerCase(), {id:k.id, name:k.name}); });
  return m;
}
let rpMap = null;
function rpOn(){ return typeof SUPABASE !== "undefined" && !!SUPABASE.url && !!SUPABASE.anonKey; }
function rpEmailOk(v){ return !v || /@.+\./.test(v); }
function rpIssueOk(){ return $("#rp-issue").value.replace(/\s/g,"").length >= 3; }
function rpSync(){
  const on = rpOn();
  $("#rp-send").hidden = !on; $("#rp-off").hidden = on;
  $("#rp-send").disabled = !rpIssueOk();
}
function rpSaveDraft(){
  try{ localStorage.setItem("reportDraft", JSON.stringify({river:$("#rp-river").value, issue:$("#rp-issue").value, email:$("#rp-email").value})); }catch(e){}
}
function rpClearDraft(){ try{ localStorage.removeItem("reportDraft"); }catch(e){} }
function openReport(riverId){
  if(!rpMap){
    rpMap = rpNames();
    $("#rp-list").innerHTML = [...rpMap.values()].map(v => `<option value="${fbEsc(v.name)}"></option>`).join("");
  }
  rpForm.hidden = false; $("#rp-done").hidden = true; $("#rp-msg").textContent = "";
  $("#rp-send").textContent = "Send";
  let d = {};
  try{ d = JSON.parse(localStorage.getItem("reportDraft") || "{}") || {}; }catch(e){}
  const ctx = riverId ? (RIVERS.find(r => r.id===riverId) || (typeof LAKES==="undefined" ? null : LAKES.find(k => k.id===riverId))) : null;
  if(ctx){
    rpRiverId = ctx.id; $("#rp-river").value = ctx.name;
    $("#rp-issue").value = d.issue || ""; $("#rp-email").value = d.email || "";
  } else {
    rpRiverId = null;
    $("#rp-river").value = d.river || ""; $("#rp-issue").value = d.issue || ""; $("#rp-email").value = d.email || "";
    const hit = rpMap.get($("#rp-river").value.trim().toLowerCase()); rpRiverId = hit ? hit.id : null;
  }
  $("#rp-web").value = "";
  rpSync();
  closeLegend();
  reportEl.classList.add("show");
  setTimeout(() => { try{ $("#rp-issue").focus({preventScroll:true}); }catch(e){} }, 50);
}
function closeReport(){ reportEl.classList.remove("show"); }
$("#report-x").addEventListener("click", closeReport);
window.addEventListener("keydown", e => { if(e.key==="Escape" && reportEl.classList.contains("show")) closeReport(); });
document.addEventListener("click", e => {
  const b = e.target.closest("[data-report]"); if(b) openReport(b.dataset.report || null);
});
/* Header flag: always reachable. Prefills the river whose sheet is open, if any. */
$("#btn-report").addEventListener("click", () => openReport(sheet.classList.contains("open") ? curRiver : null));
$("#rp-river").addEventListener("input", () => {
  const hit = rpMap && rpMap.get($("#rp-river").value.trim().toLowerCase());
  rpRiverId = hit ? hit.id : null; rpSaveDraft();
});
$("#rp-issue").addEventListener("input", () => { rpSync(); rpSaveDraft(); });
$("#rp-email").addEventListener("input", rpSaveDraft);
rpForm.addEventListener("submit", async e => {
  e.preventDefault();
  if(!rpOn() || !rpIssueOk()) return;
  const msg = $("#rp-msg"), btn = $("#rp-send");
  const email = $("#rp-email").value.trim(), issue = $("#rp-issue").value.trim();
  if(!rpEmailOk(email)){ msg.textContent = "That email doesn't look right — fix it or clear it."; return; }
  const done = () => {
    rpClearDraft(); rpForm.hidden = true;
    const dn = $("#rp-done");
    dn.innerHTML = `<p><b>Thanks — report sent.</b>${email ? `<br>We'll reply to ${fbEsc(email)}` : ""}</p><button type="button" class="rp-close" id="rp-close">Close</button>`;
    dn.hidden = false;
    $("#rp-close").addEventListener("click", closeReport);
  };
  if($("#rp-web").value){ done(); return; }          // honeypot: pretend success, send nothing
  msg.textContent = ""; btn.disabled = true; btn.textContent = "Sending…";
  const name = $("#rp-river").value.trim();
  try{
    const res = await fetch(`${SUPABASE.url}/rest/v1/reports`, {method:"POST",
      headers:Object.assign({apikey:SUPABASE.anonKey, "Content-Type":"application/json", Prefer:"return=minimal"},
        // a legacy anon key is a JWT and goes in Authorization too; a new sb_publishable_ key must not
        SUPABASE.anonKey.startsWith("sb_") ? {} : {Authorization:`Bearer ${SUPABASE.anonKey}`}),
      body:JSON.stringify({river_id:rpRiverId, river_name:name || null, issue, email:email || null, app_version:APP_VERSION})});
    if(!res.ok) throw new Error(res.status);
    if(typeof Metrics !== "undefined") Metrics.track("report_sent");
    done();
  }catch(err){
    msg.textContent = "Couldn't send — check your signal and try again.";
    btn.textContent = "Send"; btn.disabled = !rpIssueOk();
  }
});
$("#book-tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if(b) showBookTab(b.dataset.tab); });
bookBody.addEventListener("click", e => {
  const lb = e.target.closest("[data-fblake]");
  if(lb){
    const k = typeof LAKES==="undefined" ? null : LAKES.find(x => x.id===lb.dataset.fblake); if(!k) return;
    closeBook();
    hideZones();
    openLake(k.id);
    frameLake(k);                            // after the sheet opens, so the frame clears it
    return;
  }
  const b = e.target.closest("[data-fbopen]"); if(!b) return;
  const r = RIVERS.find(x => x.id===b.dataset.fbopen); if(!r) return;
  closeBook();
  hideZones();                               // no-op unless the region chooser is up
  openRiver(r.id);                           // frames the river clear of the sheet (focusRiver)
});

/* Import. The Export button was removed 2026-10-14 (owner: no user data
   export yet), so this only reads files made before then — all v1. It is a
   merge, never a replace: per river the newer `updated` wins for favourite
   and notes, so restoring an old backup can't wipe newer notes. A v1
   `fished:true` with its `fishedOn` day becomes a migrated trip, unless that
   river already has a trip that day — so importing the same file twice adds
   nothing. The file is untrusted input — shape-checked and each entry
   rebuilt field by field, and rivers this build doesn't know are skipped. */
$("#book-import").addEventListener("click", () => $("#book-file").click());
$("#book-file").addEventListener("change", async ev => {
  const f = ev.target.files[0]; ev.target.value = "";
  if(!f) return;
  const msg = $("#book-msg");
  try{
    const d = JSON.parse(await f.text());
    if(!d || d.v!==1 || !d.rivers || typeof d.rivers!=="object" || Array.isArray(d.rivers)) throw 0;
    let n = 0, nt = 0;
    const before = JSON.stringify(fbState);     // put back whole if the merge can't be saved
    const nf = window.floatImport ? floatImport(d.floats) : 0;
    for(const [id, e] of Object.entries(d.rivers)){
      if(!e || typeof e!=="object" || !RIVERS.some(r => r.id===id)) continue;
      if(e.fished===true && fbValidDay(e.fishedOn) &&
         !fbState.trips.some(t => t.kind==="river" && t.water===id && t.day===e.fishedOn)){
        fbState.trips.push({id:fbNewId(), kind:"river", water:id, day:e.fishedOn, time:null, src:"migrated", at:null});
        nt++;
      }
      const inc = {
        fav: e.fav===true,
        notes: typeof e.notes==="string" ? e.notes.slice(0,20000) : "",
        updated: Number.isFinite(e.updated) ? e.updated : 0,
      };
      if(!inc.fav && !inc.notes.trim()) continue;
      if(inc.updated > fbGet(id).updated){ fbState.rivers[id] = inc; n++; }
    }
    if((n || nt || nf) && !fbPersist()){
      fbState = JSON.parse(before);
      fbPersist();     // floatImport may have saved its part already; the old book is smaller, so it fits
      msg.textContent = "Nothing was imported: this phone's storage is full.";
      return;
    }
    applyFilters();
    if(fbRowWater) fbShowRow(fbRowWater, true, fbRowKind);
    showBookTab(bookTab);
    const parts = [n&&`${n} river${n===1?"":"s"}`, nt&&`${nt} trip${nt===1?"":"s"}`, nf&&`${nf} float${nf===1?"":"s"}`].filter(Boolean);
    msg.textContent = parts.length ? "Imported " + (parts.length > 1 ? parts.slice(0,-1).join(", ") + " and " + parts[parts.length-1] : parts[0]) + "." : "Nothing newer to import.";
  }catch(e){ msg.textContent = "That file isn't a Field Book export."; }
});

/* ---------- refresh loop ----------
   Latest values for every gauge on the map, nearest the middle of the map
   first and painted as each chunk lands, so the water you're looking at
   colours in before the rest of the country: 17 requests for 833 gauges,
   where per-region batches took 32. The history behind the status buckets
   is fetched separately, only for where the map is looking (loadViewStats). */
function gaugesNearestFirst(keys, at){
  const c = at ? L.latLng(at) : map.getCenter(), sq = Math.cos(c.lat*Math.PI/180);
  const d = k => { const p = GAUGE_POS[k]; return p ? Math.hypot(p[0]-c.lat, (p[1]-c.lng)*sq) : Infinity; };
  return keys.map(k => [d(k), k]).sort((a,b) => a[0]-b[0]).map(x => x[1]);
}
function paintFlows(){
  const anyLive = Object.values(flows).some(f=>f && !f.stale);
  const anyData = Object.values(flows).some(f=>f && f.cfs!=null);
  $("#netpill").classList.toggle("show", !anyLive && anyData);
  $("#updwhen").textContent = anyLive ? new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
    : (anyData ? "cached" : "unavailable");
  paintStatus();
}
/* Everything a status bucket feeds, without touching the header's "flows"
   time: history arriving later (loadViewStats, openRiver) is not a newer
   reading, and the header shouldn't say it is. */
function paintStatus(){
  repaintGauges();
  if(typeof syncFlow === "function") syncFlow();   // speeds follow the new readings
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
}
async function refreshAll(manual){
  const btn=$("#btn-refresh"); btn.classList.add("spin");
  const keys = gaugesNearestFirst(Object.keys(GAUGES));
  // Colorado DWR's gauges answer from another host with its own budget: one request, alongside
  const dwr = keys.filter(isDWR);
  const dwrDone = dwr.length ? fetchLatestBatch(dwr).then(paintFlows) : null;
  for(const group of chunk(keys.filter(k=>!isDWR(k)), MAX_SITES_LATEST)){
    await fetchLatestBatch(group);
    paintFlows();          // the nearest water shows up without waiting for the rest
  }
  await dwrDone;
  btn.classList.remove("spin");
  statsSoon();             // history for wherever the map is now
}

/* ---------- history where the map is looking ----------
   The 7-year median behind a status bucket matters only where a status is
   drawn: the speed of the current on the rivers (from FLOW_MIN_ZOOM), the
   gauge dots, an open river's sheet and the Field Book's chips. Fetching it
   for every gauge on the map at the first open of each week had grown to 273
   of a cold load's 322 requests, for a country the opening chooser doesn't
   colour at all.

   So history is fetched for the gauges in the padded view, from
   STATS_MIN_ZOOM: one level before the current starts to move, so the
   speeds are ready when you get there (and where the Other rivers and the
   all-gauges layer start). The state views the chooser lands on (zoom
   5.5–7.25 on a phone) fetch nothing; there only the Gauges dots, if switched
   on, show a status, and a dot whose history isn't on the phone yet stays
   grey until you zoom in. Never while the chooser is up. An opened river
   fetches its own (openRiver). Nearest the middle of the map first, one
   chunk at a time, and the view is read again after every chunk, so moving
   on drops the rest of a view you've left.

   A chunk costs STAT_YEARS requests whether it carries one gauge or thirty,
   so one with room left takes riders (statsRiders). */
const STATS_MIN_ZOOM = 8;            // compare with >= : zoom is fractional
const STATS_VIEW_PAD = 0.5;
const GAUGE_RIVERS = {};             // gauge key -> the rivers that list it
RIVERS.forEach(r => (r.gauges||[]).forEach(g => (GAUGE_RIVERS[g] = GAUGE_RIVERS[g] || []).push(r)));
let statsTimer = null, statsRunning = false;
/* Gauges the loader has asked for this session. An answer leaves a median,
   or null, in `stats`; a gauge it couldn't get (a DWR failure) isn't asked
   for again on every pan. One the back-off cut short is taken out again, so
   it is asked once the cooldown is over. */
const statsAsked = new Set();

/* Does this gauge still need its history, and would anything show it? One
   that has stopped reporting has nothing to compare (statusOf() reads "Not
   reporting" whatever the median), and one whose rivers are all filtered out
   by class has no dot and no current on screen (syncGaugeDots). */
function statsWanted(k){
  if(stats[k] !== undefined || statsInflight.has(k) || statsAsked.has(k)) return false;
  const f = flows[k];
  if(f && !f.stale && readingIsOld(f)) return false;
  return (GAUGE_RIVERS[k] || []).some(tierShown);
}
/* Spare room in a chunk of history that is going out anyway. Seven requests
   carry thirty gauges as cheaply as one, so the room is filled: favourites
   first (the Field Book's chips), then the gauges nearest `at` that still
   want history, which the next look around usually does. Nothing is fetched
   only to fill a chunk: no riders unless one of `keys` needs the network. */
function statsRiders(keys, at){
  const size = batchSupported ? MAX_SITES_DAILY : 1;
  const going = keys.filter(k => !isDWR(k) && stats[k] === undefined && !statsInflight.has(k)).length;
  const room = going ? (size - going % size) % size : 0;
  const have = new Set(keys), out = [];
  if(!room) return out;
  const favs = Object.keys(fbAll()).filter(fbIsFav).map(id => (RIVERS.find(r => r.id === id) || {}).primaryGauge);
  for(const k of favs.concat(gaugesNearestFirst(Object.keys(GAUGES).filter(statsWanted), at))){
    if(out.length >= room) break;
    if(k && !isDWR(k) && !have.has(k) && statsWanted(k)){ out.push(k); have.add(k); }
  }
  return out;
}
async function loadViewStats(){
  if(statsRunning) return;           // the pass under way reads the view again after its chunk
  statsRunning = true;
  try{
    while(!apiPaused() && !zonesShown && map.getZoom() >= STATS_MIN_ZOOM && map.getSize().x){
      const view = map.getBounds().pad(STATS_VIEW_PAD);
      const inView = gaugesNearestFirst(Object.keys(GAUGES).filter(k =>
        GAUGE_POS[k] && view.contains(GAUGE_POS[k]) && statsWanted(k)));
      if(!inView.length) break;
      // Colorado DWR: another host with its own budget, fetched alongside
      const dwr = inView.filter(isDWR);
      if(dwr.length){ dwr.forEach(k => statsAsked.add(k)); fetchStatsBatch(dwr).then(paintStatus); }
      const group = inView.filter(k => !isDWR(k)).slice(0, batchSupported ? MAX_SITES_DAILY : 1);
      if(!group.length) continue;
      group.push(...statsRiders(group));       // the gauges just beyond the view: the next pan
      group.forEach(k => statsAsked.add(k));
      await Promise.all([fetchStatsBatch(group), verifyGaugesBatch(group)]);
      if(apiPaused()) group.forEach(k => { if(stats[k] === undefined) statsAsked.delete(k); });
      paintStatus();
    }
  }finally{ statsRunning = false; }
}
function statsSoon(){ clearTimeout(statsTimer); statsTimer = setTimeout(loadViewStats, 800); }
map.on("moveend", statsSoon);

$("#btn-refresh").addEventListener("click",()=>refreshAll(true));
window.addEventListener("online",()=>refreshAll());
setInterval(refreshAll, REFRESH_MS);
refreshAll();
// fill in exact USGS NHD linework across the map after first paint
/* ============================================================
   ZONE PICKER
   The map opens on the country with the covered areas drawn over it, so the
   first question ("where am I fishing?") is answered by pointing rather than
   by panning around a continent looking for coloured lines. Picking a zone
   flies there and dismisses the picker; the Change Region button brings it back.
   ============================================================ */
const zonePane = map.createPane("zonePane");
zonePane.style.zIndex = 450;
const zoneLayer = L.layerGroup();
let zonesShown = false;

const ZONE_STYLE = {
  state: {color:"#12566b", fillColor:"#2f8fa8", fillOpacity:.22, weight:2.2},
  region:{color:"#12566b", fillColor:"#2f8fa8", fillOpacity:.26, weight:2.5},
  park:  {color:"#8a5a12", fillColor:"#e0ac48", fillOpacity:.34, weight:2.8, dashArray:"6 4"},
};

/* Leaflet's fly* animations divide by the container size. If the map is laid
   out at zero size when this runs — a hidden tab, a pane that hasn't been
   shown yet, a slow first paint — that arithmetic produces NaN and throws
   "Invalid LatLng", which kills the rest of the script. Fall back to an
   un-animated setView until the container has real dimensions. */
function canAnimate(){
  const s = map.getSize();
  // Animations run on requestAnimationFrame, which is paused while the
  // document is hidden — a fly started in a background tab never finishes
  // and the map silently stays put. Jump instead when we can't animate.
  return s.x > 0 && s.y > 0 && document.visibilityState !== "hidden";
}
let pendingView = null;
map.on("resize", () => {
  if(!pendingView) return;
  const v = pendingView; pendingView = null; goTo(v.target, v.zoom, v.opts);
});
/* `opts` is passed through to a bounds fit — paddingTopLeft/BottomRight and
   maxZoom — so a river can be framed in the part of the map the sheet
   leaves uncovered. */
function goTo(target, zoom, opts){
  const s = map.getSize();
  if(!s.x || !s.y){
    // A zero-size container doesn't only break the animation: fitBounds
    // derives its zoom from the container too, and with no width the
    // answer is the whole world. That is how the opening chooser once
    // landed on a zoom-0 view of the globe with every zone a few pixels
    // wide. Hold the move until the map has real dimensions.
    pendingView = {target, zoom, opts};
    setTimeout(() => {
      if(pendingView && map.getSize().x){
        const v = pendingView; pendingView = null; goTo(v.target, v.zoom, v.opts);
      }
    }, 200);
    return;
  }
  if(target instanceof L.LatLngBounds){
    if(canAnimate()) map.flyToBounds(target, Object.assign({duration:0.9}, opts));
    else map.fitBounds(target, Object.assign({animate:false}, opts));
  } else {
    if(canAnimate()) map.flyTo(target, zoom, {duration:0.7});
    else map.setView(target, zoom, {animate:false});
  }
}

const zoneCards = [];   // {zone, marker, poly}

function enterZone(z){
  if(typeof Metrics !== "undefined") Metrics.track("zone_pick", z.id, z.label);
  hideZones();
  goTo(L.latLngBounds(z.bounds).pad(0.08));
}
/* A park crest for the two national-park cards.

   Deliberately NOT the National Park Service arrowhead: that emblem is
   restricted federal insignia, and copying it onto a personal map would be
   borrowing an authority this app doesn't have. This is the same arrowhead
   silhouette — which is what reads as "national park" at 20 pixels — with
   an original composition inside it, drawn in the app's own park palette
   (the browns already on the park zone outline, cream for the figures).

   Solid fills, no thin strokes: at 20px tall one SVG unit is under half a
   pixel, and a hairline conifer would render as grey mush. */
function parkCrest(){
  return '<svg class="zc-crest" viewBox="0 0 40 48" aria-hidden="true" focusable="false">'+
    '<path d="M6.4 2.2h27.2a2.6 2.6 0 0 1 2.6 2.6V20c0 11.2-6.9 20.3-16.2 26.7C10.7 40.3 3.8 31.2 3.8 20V4.8a2.6 2.6 0 0 1 2.6-2.6z" fill="#7a4f14" stroke="#f2ece0" stroke-width="2.1"/>'+
    '<path d="M6.6 31.8 14.8 18.6 20.2 26.2 26 15.4 33.4 31.8Z" fill="#d8c49c"/>'+
    /* The conifer is outlined in the field colour, not just filled: cream on
       cream, it merged into the ridge behind it and the badge read as one
       pale blob. The outline is what makes it a silhouette. */
    '<g fill="#f2ece0" stroke="#7a4f14" stroke-width="1.7" stroke-linejoin="round">'+
      '<path d="M13 9.6 16.7 16.8 14.9 16.8 18.3 22.6 16.4 22.6 19.6 28.4 6.4 28.4 9.6 22.6 7.7 22.6 11.1 16.8 9.3 16.8Z"/>'+
      '<path d="M11.9 27.6h2.2v4.1h-2.2z"/>'+
    '</g>'+
    '<path d="M7.6 34.6q3-2.1 6 0t6 0 6 0" fill="none" stroke="#a8d4e6" stroke-width="2.6" stroke-linecap="round"/>'+
    '</svg>';
}

function buildZones(){
  /* States first, parks last, because a park is inside a state and both are
     drawn: Leaflet paints in insertion order within a pane, so the park ends
     up on top and takes the tap. They overlap on purpose now — that is what
     a national park inside a state looks like — where the old region zones
     were a strict partition. */
  ZONES.slice().sort((a,b)=> (a.kind==="park") - (b.kind==="park")).forEach(z=>{
    // rings[0] is the outer boundary, any further rings are holes; Leaflet
    // paints with fill-rule evenodd, so a hole is genuinely not part of the
    // shape — it doesn't take clicks either
    /* `rings` is one polygon — outer ring first, any further rings are holes.
       `parts` holds additional *detached* polygons, each in that same shape,
       for a zone that is genuinely in pieces: Channel Islands is five
       islands, Olympic is the massif plus a coastal strip, North Cascades is
       two units. Leaflet reads a list of ring-lists as a multipolygon, so
       they all become ONE layer — one hover, one tap, one zone. Before this,
       a detached piece could only have been expressed as a hole, which is
       why the earlier note said a park could not be in pieces. */
    const shape = z.parts && z.parts.length ? [z.rings].concat(z.parts) : z.rings;
    const poly = L.polygon(shape, {...ZONE_STYLE[z.kind], pane:"zonePane"}).addTo(zoneLayer);
    onTap(poly, ()=>enterZone(z));
    /* Hover carries more weight now that the states have no card, so it
       lifts the fill *and* thickens the border — a fill change on its own is
       easy to miss on a pale state at country zoom. */
    const hov = ZONE_STYLE[z.kind];
    poly.on("mouseover", ()=>poly.setStyle({fillOpacity:hov.fillOpacity+0.20, weight:hov.weight+1.2}));
    poly.on("mouseout",  ()=>poly.setStyle({fillOpacity:hov.fillOpacity,      weight:hov.weight}));

    const tip = `<b>${z.label}</b><br><span style="font-size:11px">${z.sub}</span>`;

    /* States carry no card. A name and a river count stamped on each of six
       outlines is a lot of furniture over a map whose only job at this zoom
       is "which part of the country", and a state's shape is already the
       most legible label it could have — nobody needs "Wisconsin" written
       across Wisconsin. The name still comes up on hover and the fill lifts
       under the cursor, so you can tell what you are about to tap.

       Parks keep theirs: an NPS boundary is not a shape anyone reads at a
       glance, and Grand Teton especially is a narrow strip inside Wyoming
       that would otherwise look like an unexplained gap in the fill. */
    if(z.kind === "state"){
      poly.bindTooltip(tip, {sticky:true, className:"zone-tip"});
      zoneCards.push({zone:z, marker:null, poly});
      return;
    }

    const has = z.count > 0;
    const m = L.marker(L.latLngBounds(z.bounds).getCenter(),
      {pane:"zonePane", riseOnHover:true, bubblingMouseEvents:true,
       icon:L.divIcon({className:"", iconSize:null, html:
        `<div class="zone-card ${z.kind} ${has?"":"empty"}">
           ${parkCrest()}
           <div class="zc-text">
             <div class="zc-label">${z.label}</div>
             <div class="zc-short">${z.short || z.label}</div>
             <div class="zc-count" data-zone="${z.id}">${has ? z.count+" rivers" : "not mapped yet"}</div>
           </div>
         </div>`})}).addTo(zoneLayer);
    m.bindTooltip(tip, {direction:"top", offset:[0,-16], className:"zone-tip"});
    onTap(m, ()=>enterZone(z));
    zoneCards.push({zone:z, marker:m, poly});
  });
}

/* ---- keeping a zone's name inside its own boundary ----
   A label parked at the bounding-box centre sits outside the shape as soon
   as the shape isn't rectangular — and slides off screen entirely once you
   zoom into one corner of a zone. So the label is placed at the pole of
   inaccessibility (the interior point furthest from any edge) of the part
   of the zone you can currently *see*. That keeps the name inside its own
   boundary at every zoom, and inside the visible part of it when you're
   only looking at a corner of the zone.

   Cards still can't be allowed to sit on top of each other, so placement
   picks among the roomiest interior points rather than only the single
   best one — but every candidate is an interior point, so avoiding a
   neighbour never pushes a name out of its own zone. If nothing fits, the
   card goes tight (smaller) instead of moving out. */
function clipToRect(poly, r){          // Sutherland-Hodgman against the viewport
  const edges = [
    p => p.x >= r.min.x, p => p.x <= r.max.x,
    p => p.y >= r.min.y, p => p.y <= r.max.y ];
  const isect = [
    (a,b) => ({x:r.min.x, y:a.y+(b.y-a.y)*((r.min.x-a.x)/((b.x-a.x)||1e-9))}),
    (a,b) => ({x:r.max.x, y:a.y+(b.y-a.y)*((r.max.x-a.x)/((b.x-a.x)||1e-9))}),
    (a,b) => ({y:r.min.y, x:a.x+(b.x-a.x)*((r.min.y-a.y)/((b.y-a.y)||1e-9))}),
    (a,b) => ({y:r.max.y, x:a.x+(b.x-a.x)*((r.max.y-a.y)/((b.y-a.y)||1e-9))}) ];
  let out = poly;
  for(let e=0;e<4 && out.length;e++){
    const inp = out; out = [];
    for(let i=0;i<inp.length;i++){
      const cur = inp[i], prv = inp[(i-1+inp.length)%inp.length];
      const ci = edges[e](cur), pi = edges[e](prv);
      if(ci){ if(!pi) out.push(isect[e](prv,cur)); out.push(cur); }
      else if(pi) out.push(isect[e](prv,cur));
    }
  }
  return out;
}
function pointInPoly(pt, poly){
  let ins = false;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i], b=poly[j];
    if((a.y>pt.y)!==(b.y>pt.y) && pt.x < (b.x-a.x)*(pt.y-a.y)/((b.y-a.y)||1e-9)+a.x) ins=!ins;
  }
  return ins;
}
function distToEdges(pt, poly){
  let best = Infinity;
  for(let i=0,j=poly.length-1;i<poly.length;j=i++){
    const a=poly[i], b=poly[j];
    const dx=b.x-a.x, dy=b.y-a.y, L2=dx*dx+dy*dy;
    let t = L2 ? ((pt.x-a.x)*dx + (pt.y-a.y)*dy)/L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(pt.x-(a.x+dx*t), pt.y-(a.y+dy*t)));
  }
  return best;
}
function sampleInterior(poly, box, N){
  const out=[];
  for(let i=0;i<=N;i++) for(let j=0;j<=N;j++){
    const pt={x:box.minx+(box.maxx-box.minx)*i/N, y:box.miny+(box.maxy-box.miny)*j/N};
    if(!pointInPoly(pt, poly)) continue;
    pt.d = distToEdges(pt, poly);
    out.push(pt);
  }
  return out;
}
function labelSpots(poly){
  const xs=poly.map(p=>p.x), ys=poly.map(p=>p.y);
  let box = {minx:Math.min(...xs), maxx:Math.max(...xs),
             miny:Math.min(...ys), maxy:Math.max(...ys)};
  const coarse = sampleInterior(poly, box, 12);
  if(!coarse.length) return {best:null, spots:[]};
  coarse.sort((a,b)=>b.d-a.d);
  let best = coarse[0];
  for(let pass=0; pass<3; pass++){          // refine around the current winner
    const rx=(box.maxx-box.minx)/6, ry=(box.maxy-box.miny)/6;
    box = {minx:best.x-rx, maxx:best.x+rx, miny:best.y-ry, maxy:best.y+ry};
    const fine = sampleInterior(poly, box, 6);
    for(const p of fine) if(p.d > best.d) best = p;
  }
  return {best, spots:coarse};
}
function rectAt(pt, w, h){
  return {x0:pt.x-w/2, y0:pt.y-h/2, x1:pt.x+w/2, y1:pt.y+h/2};
}
function rectOverlap(a, b){
  const w = Math.min(a.x1,b.x1) - Math.max(a.x0,b.x0);
  const h = Math.min(a.y1,b.y1) - Math.max(a.y0,b.y0);
  return (w>0 && h>0) ? w*h : 0;
}
function offScreenArea(r, size){
  const vis = rectOverlap(r, {x0:8, y0:8, x1:size.x-8, y1:size.y-8});
  return Math.max(0, (r.x1-r.x0)*(r.y1-r.y0) - vis);
}
const PARK_CARD_ZOOM = 6;
function layoutZoneCards(){
  if(!zonesShown) return;
  const size = map.getSize();
  if(!size.x || !size.y) return;
  // Container space, not layer space: after a drag the map pane carries a
  // CSS offset, so projecting against the pixel origin would put the
  // viewport rectangle in the wrong place — the clip would then decide a
  // zone was off screen while you were looking straight at it.
  const rect = {min:{x:0,y:0}, max:{x:size.x, y:size.y}};

  const plans = [];
  /* At the national view forty-odd park cards cover the states they sit
     in, and on a phone that is most of the screen. They come in once you
     zoom toward a region; the park outlines stay drawn and tappable. */
  const parksHidden = map.getZoom() < PARK_CARD_ZOOM;
  zoneCards.forEach(c => {
    if(!c.marker) return;          // states are drawn without a card
    if(parksHidden){ const el=c.marker.getElement(); if(el) el.style.display="none"; return; }
    // outer ring only — the holes (national parks punched out of a region)
    // are small next to the region, and excluding them would push the name
    // off the part of the zone the label is actually describing
    const ring = c.zone.rings[0].map(ll => {
      const p = map.latLngToContainerPoint(L.latLng(ll[0], ll[1]));
      return {x:p.x, y:p.y};
    });
    const vis = clipToRect(ring, rect);
    const poly = vis.length >= 3 ? vis : ring;
    const s = labelSpots(poly);
    if(s.best){
      /* Zones tile now, so a cell reaches well beyond the water in it and
         the pole of inaccessibility can land 80 km from the valley the zone
         is named after. Prefer the middle of the zone's *rivers* when that
         point is inside the visible cell; fall back to the pole when it
         isn't (zoomed into a corner, or the rivers are off screen). */
      const b = map.latLngToContainerPoint(L.latLngBounds(c.zone.bounds).getCenter());
      const home = {x:b.x, y:b.y};
      const useHome = pointInPoly(home, poly) && distToEdges(home, poly) > 14;
      plans.push({c, best:s.best, anchor: useHome ? home : s.best,
                  spots:(useHome ? [home] : []).concat(s.spots), room:s.best.d});
    }
    else { const el=c.marker.getElement(); if(el) el.style.display="none"; }
  });

  // Tightest zone first: a cramped cell has almost no choice of interior
  // point, so it should claim its one good spot before a roomy neighbour —
  // which has plenty of other interior points — parks a card on it.
  // ...but a park with mapped water outranks one without: in the crowded
  // Southwest a card for Arches (no fishing) shouldn't push Capitol Reef or
  // Black Canyon off the chooser.
  plans.sort((a,b) => ((a.c.zone.count ? 0 : 1) - (b.c.zone.count ? 0 : 1)) || (a.room - b.room));

  const placed = [];
  plans.forEach(p => {
    const el = p.c.marker.getElement();
    const card = el && el.querySelector(".zone-card");
    if(el) el.style.display = "";
    // Three sizes, chosen by how much room the zone actually has. Grand
    // Teton is a narrow north–south strip: at country zoom it is a few
    // pixels wide, and a full-size card on it would read as Wyoming's.
    if(card){
      card.classList.toggle("tight", p.room < 46 && p.room >= 20);
      card.classList.toggle("mini",  p.room < 20);
    }
    // Measured, never assumed — a two-line label ("Minnesota & North Shore")
    // makes a taller card, and one fixed height under-reserves for those.
    const w = card ? card.offsetWidth  : 144;
    const h = card ? card.offsetHeight : 46;

    // Candidates need to be spread out, not just the 24 highest-scoring
    // interior points — those all sit in the same small neighbourhood as
    // the pole itself, so the card would have nowhere to go to dodge a
    // neighbour. Every interior sample with reasonable clearance is fair
    // game; there are at most a couple of hundred and the maths is cheap.
    const cand = [p.anchor, p.best].concat(p.spots.filter(s => s.d >= p.room * 0.45));
    let pick = p.best, bestScore = Infinity, bestOver = 0;
    for(const s of cand){
      const r = rectAt(s, w, h);
      let over = 0;
      for(const q of placed) over += rectOverlap(r, q);
      let score = over * 3;
      score += offScreenArea(r, size) * 6;   // a clipped card is unreadable
      // Measured against the room this zone actually has, not a fixed
      // ideal: a narrow zone's best point may only be 20px from an edge,
      // and penalising every candidate against an unreachable 30 would
      // pin the card to that one point and let it sit on a neighbour.
      score += Math.max(0, Math.min(34, p.room) - (s.d === undefined ? p.room : s.d)) * 12;
      score += Math.hypot(s.x-p.anchor.x, s.y-p.anchor.y) * 4;   // stay near the water
      if(score < bestScore){ bestScore = score; pick = s; bestOver = over; }
    }
    // Names never leave their own zone to dodge a neighbour — that was the
    // old behaviour and it put labels on the wrong water. When a zone is
    // too small at this zoom to hold its name clear of one already placed,
    // the card drops out and comes back as you zoom in. The polygon stays
    // drawn and stays clickable either way.
    // 12%: overlapping cards stack into an unreadable pile at country zoom
    // (the Four Corners parks did exactly that), and a dropped card comes
    // back one zoom step in.
    if(bestOver > 0.12 * w * h){ if(el) el.style.display = "none"; return; }
    placed.push(rectAt(pick, w, h));
    p.c.marker.setLatLng(map.containerPointToLatLng(L.point(pick.x, pick.y)));
  });
}
map.on("zoomend moveend", layoutZoneCards);

/* ---- named places that cross state lines ----
   The Driftless is one landscape over four states and four rulebooks, so it
   can't be a zone any more — the zones are the rulebooks. It is still a real
   place and worth naming, so it and its siblings fade in as map labels once
   you're zoomed past the chooser and out again once you're on a single
   creek, where the name of the region tells you nothing you don't know. */
const REGION_LABEL_ZOOM = {min:6, max:11};
const regionLabelPane = map.createPane("regionLabelPane");
regionLabelPane.style.zIndex = 425;                 // over the rivers, under the zones
regionLabelPane.style.pointerEvents = "none";
const regionLabelLayer = L.layerGroup().addTo(map);
const regionLabels = (typeof REGION_LABELS === "undefined" ? [] : REGION_LABELS).map(r => ({
  def: r,
  marker: L.marker(r.at, {pane:"regionLabelPane", interactive:false,
    icon:L.divIcon({className:"", iconSize:null, html:
      `<div class="region-label"><span>${r.text}</span><small>${r.states}</small></div>`})})
}));
function syncRegionLabels(){
  const z = map.getZoom();
  const on = !zonesShown && z >= REGION_LABEL_ZOOM.min && Math.floor(z) <= REGION_LABEL_ZOOM.max;
  const view = map.getBounds();
  regionLabels.forEach(rl => {
    const show = on && view.intersects(L.latLngBounds(rl.def.bounds || [rl.def.at, rl.def.at]));
    const has = regionLabelLayer.hasLayer(rl.marker);
    if(show && !has) regionLabelLayer.addLayer(rl.marker);
    else if(!show && has) regionLabelLayer.removeLayer(rl.marker);
  });
}
map.on("zoomend moveend", syncRegionLabels);

let zoneCollapseJump = () => {};    // set by zoneCtl: folds the "Jump to…" list away
let closeIconMenus = () => {};      // set by tierCtl: the jump list and the menus overlap, so one open closes the other
function showZones(){
  if(zonesShown) return;
  unfocusRiver();                     // the chooser is "which part of the country", not one river
  zonesShown = true;
  zoneLayer.addTo(map);
  // the cards are rebuilt from their original html when the layer comes
  // back, so a class switched on or off since the last look must be recounted
  refreshZoneCounts();
  document.body.classList.add("zones-open");
  syncRegionLabels();
  if(typeof syncFlow === "function") syncFlow();
  if(typeof syncLakes === "function") syncLakes();
  if(typeof syncClosures === "function") syncClosures();
  // Fit the covered area rather than a fixed zoom: z4 fills a laptop but
  // shows a fraction of the country on a phone, which is the screen this
  // actually gets opened on.
  // Alaska and its parks are `far`: drawn and tappable, but left out of the
  // fit, because a frame wide enough for Anchorage shrinks the lower 48 to a
  // strip of slivers. Pan up to it, take the Alaska ▲ button, or pick an
  // Alaska area from the "Jump to…" list beside Change Region.
  goTo(L.latLngBounds([].concat(...ZONES.filter(z=>!z.far).map(z=>z.bounds))).pad(0.04));
  map.once("moveend", layoutZoneCards);
  setTimeout(layoutZoneCards, 60);
  setTimeout(layoutZoneCards, 400);   // after a move deferred for container size
}
function hideZones(){
  if(!zonesShown) return;
  zonesShown = false;
  map.removeLayer(zoneLayer);
  document.body.classList.remove("zones-open");
  zoneCollapseJump();
  syncRegionLabels();
  if(typeof syncFlow === "function") syncFlow();
  if(typeof syncLakes === "function") syncLakes();
  if(typeof syncClosures === "function") syncClosures();
  statsSoon();                        // Change Region can close the chooser without moving the map
}

buildZones();
showZones();
syncRegionLabels();
syncFlow();
syncLakes();
syncClosures();

/* Change Region button — always available, so you can get back to the
   chooser without hunting for the right zoom level. Top *left*, under the app bar
   (the zoom +/− now lives bottom-right): top-right is taken by the layer control and sheet, and the
   Change Region button is the one control that gets you back out.

   It is also the one region control. While the chooser is up, a "Jump to…"
   list of named areas (REGIONS) sits beside the button, so the states and
   the places that aren't states are chosen in the same spot. It opens
   expanded when the button opened the chooser, and collapsed to its header
   when the chooser came up by itself at launch: expanded, it sits over the
   northern states on a phone's first view. Absolutely placed to the right of
   the button so it pushes none of the controls below it. */
const zoneCtl = L.control({position:"topleft"});
zoneCtl.onAdd = function(){
  const d = L.DomUtil.create("div", "zonectl");
  d.innerHTML = `<button id="btn-zones" title="Back to region chooser">◄ Change Region</button>`+
    `<div id="jump">`+
      `<button type="button" id="jump-btn" aria-expanded="false" aria-controls="jumplist">`+
        `Jump to\u2026<span class="mcaret" aria-hidden="true">\u25BE</span></button>`+
      `<div id="jumplist" role="group" aria-label="Jump to a named area" hidden>`+
      REGIONS.map((r,i) => r[1]
        ? `<button type="button" data-jump="${i}">${r[0]}</button>`
        : `<div class="jl-group">${r[0].replace(/^[\u2500\s]+|[\u2500\s]+$/g, "")}</div>`).join("")+
      `</div>`+
    `</div>`;
  L.DomEvent.disableClickPropagation(d);
  L.DomEvent.disableScrollPropagation(d);
  const jbtn = d.querySelector("#jump-btn"), list = d.querySelector("#jumplist");
  const setJump = open => { jbtn.setAttribute("aria-expanded", String(open)); list.hidden = !open; };
  d.querySelector("#btn-zones").addEventListener("click", ()=>{
    if(zonesShown){ hideZones(); return; }
    showZones();
    list.scrollTop = 0;
    setJump(true);
  });
  jbtn.addEventListener("click", () => { if(list.hidden) closeIconMenus(); setJump(list.hidden); });
  list.addEventListener("click", e => {
    const b = e.target.closest("[data-jump]"); if(!b) return;
    const r = REGIONS[+b.dataset.jump][1];
    if(typeof Metrics !== "undefined") Metrics.track("zone_pick", REGIONS[+b.dataset.jump][0]);
    hideZones();
    goTo(L.latLng(r[0], r[1]), r[2]);         // never map.setView: see goTo()
  });
  map.on("click", () => setJump(false));      // a tap on the map, like the menus
  // hidden with the chooser (css), and collapsed for next time
  zoneCollapseJump = () => setJump(false);
  return d;
};
zoneCtl.addTo(map);

/* Alaska is left out of the chooser's opening frame (see showZones), which
   makes it easy to miss entirely. While the chooser is up, one button jumps
   between the lower 48 and Alaska; it says which way it will go. */
const farCtl = L.control({position:"topleft"});
farCtl.onAdd = function(){
  const d = L.DomUtil.create("div");
  d.innerHTML = `<button id="btn-far" title="Jump to Alaska">Alaska ▲</button>`;
  L.DomEvent.disableClickPropagation(d);
  const btn = d.querySelector("button");
  const inAlaska = () => map.getCenter().lng < -129 && map.getCenter().lat > 51;
  const label = () => { btn.textContent = inAlaska() ? "Lower 48 ▼" : "Alaska ▲"; };
  btn.addEventListener("click", ()=>{
    const far = ZONES.filter(z=>z.far), near = ZONES.filter(z=>!z.far);
    const set = inAlaska() ? near : far;
    goTo(L.latLngBounds([].concat(...set.map(z=>z.bounds))).pad(0.04));
    map.once("moveend", ()=>{ label(); layoutZoneCards(); });
  });
  map.on("moveend", label);
  return d;
};
farCtl.addTo(map);

/* ---------- river class filter: layer-control checkboxes + chip row ----------
   One source of truth: four empty layer groups. Ticking a box in the layer
   control (same pattern as "Boat ramps") or tapping a chip adds/removes the
   group, and the add/remove events are what flip tierFilter. */
const tierGroups = {};
const TIER_LABEL = {gold:"Top pick rivers", "1":"Worth it rivers", "2":"Local rivers", "3":"Other rivers (all the rest)"};
let refreshMenuCounts = () => {};      // set by tierCtl once its buttons exist
function syncTierChips(){
  TIER_KEYS.forEach(k => {
    const b = document.querySelector('#tierchips [data-tier="'+k+'"]');
    if(b){ b.classList.toggle("on", !!tierFilter[k]); b.setAttribute("aria-pressed", String(!!tierFilter[k])); }
  });
  refreshMenuCounts();
}
TIER_KEYS.forEach(k => {
  const g = tierGroups[k] = L.layerGroup();
  const set = on => {
    if(tierFilter[k] === on) return;
    tierFilter[k] = on;
    tempShown.clear();
    syncTierChips(); applyFilters();
  };
  g.on("add", ()=>set(true));
  g.on("remove", ()=>set(false));
  layerControl.addOverlay(g, `<span class="tier-sw" style="background:${TIER_INFO[k].color}"></span>${TIER_LABEL[k]}`);
});
/* Map Icons. A chip is the unit of the user's choice, and one chip can own
   several layers: "Parking & access" is the wade layer (which carries the DNR
   P lots and fishing access) plus the OSM parking points, and "Hazards &
   closures" is falls/rapids/dams plus closed water — nobody wants one of a
   pair without the other. A chip reads "on" when its layers are on. A new map
   layer is one more row, or one more layer in a row. */
const LAYER_CHIPS = [
  ["ramps",   "Boat ramps",         [rampLayer],                     "#e07b1a"],
  ["access",  "Parking &amp; access", [wadeLayer, poiLayers.parking], "#5b6e3a"],
  ["gauges",  "Gauges",             [gaugeLayer],                    "#2b7fb8"],
  ["hazards", "Hazards &amp; closures", [hazardLayer, closureLayer], "#3b4a56"],
  ["bridges", "Bridge access",      [bridgeLayer],                   "#8a7560"],
  ["camps",   "Campsites",          [poiLayers.camp],                POI.camp.color],
  ["trailheads", "Trailheads",      [poiLayers.trailhead],           POI.trailhead.color],
  ["land",    "Public land",        [publicLand],                    "#3f8f4f"],
];
/* Options shown inside a chip while that chip is on: [id, label, layers,
   colour, parent chip]. Its own id keeps the user's choice for it separate,
   so it comes back with its parent (after a river focus, say). It is not
   counted as a chip. */
const ICON_SUBS = [
  ["allgauges", "Every USGS gauge", [allGaugeLayer], "#5a7894", "gauges"],
];
const ICON_ITEMS = LAYER_CHIPS.map(([id, label, layers]) => ({id, label, layers, parent:null}))
  .concat(ICON_SUBS.map(([id, label, layers, , parent]) => ({id, label, layers, parent})));
const ICON_BY_ID = Object.fromEntries(ICON_ITEMS.map(it => [it.id, it]));
const chipOn = id => ICON_BY_ID[id].layers.some(g => map.hasLayer(g));
/* Every chip button reflects its layers; a sub-option shows only while its
   parent chip is on. Called on every icon layer add/remove. */
function syncIconChips(){
  ICON_ITEMS.forEach(it => {
    const b = document.querySelector('#layerchips [data-layer="'+it.id+'"]'); if(!b) return;
    const on = chipOn(it.id);
    b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on));
    if(it.parent) b.hidden = !chipOn(it.parent);
  });
  refreshMenuCounts();
}
/* The species picker, under the class chips in River Filters: "Any species"
   and every species with at least one water, grouped, each with its count of
   waters (rivers and lakes, every class). The line under it says what a pick
   leaves out: the waters with no species data yet, and the matching rivers
   the class filter is hiding, with the way to show them. */
let spCountMemo = null;
function speciesCounts(){
  if(spCountMemo) return spCountMemo;
  const keys = RIVERS.map(r => r.id).concat((typeof LAKES === "undefined" ? [] : LAKES).map(k => "lake:" + k.id));
  const by = {}; let withData = 0;
  keys.forEach(k => {
    const s = SP_SETS.get(k); if(!s || !s.size) return;
    withData++; s.forEach(sp => { by[sp] = (by[sp] || 0) + 1; });
  });
  return spCountMemo = {by, withData, total:keys.length};
}
function speciesPickerHTML(){
  if(!SP_ON) return "";
  const n = speciesCounts(), groups = [...new Set(SPECIES_LIST.map(s => s.group))];
  return `<div class="sp-pick"><label class="sp-lab" for="sp-sel">Species</label>`+
    `<select id="sp-sel"><option value="">Any species</option>`+
    groups.map(g => {
      const opts = SPECIES_LIST.filter(s => s.group === g && n.by[s.key]);
      return opts.length ? `<optgroup label="${fbEsc(g)}">` + opts.map(s =>
        `<option value="${fbEsc(s.key)}">${fbEsc(s.label)} (${n.by[s.key]})</option>`).join("") + `</optgroup>` : "";
    }).join("")+
    `</select><div class="sp-count" aria-live="polite" hidden></div></div>`;
}
function refreshSpeciesCount(){
  const el = document.querySelector("#tierchips .sp-count"); if(!el) return;
  if(!speciesPick){ el.hidden = true; el.innerHTML = ""; return; }
  const n = speciesCounts(), sp = SPECIES_LIST.find(s => s.key === speciesPick) || {label:speciesPick};
  // rivers with the fish that the class filter keeps off the map (a favourite or a river opened on purpose never is)
  const off = RIVERS.filter(r => speciesHas(r.id, speciesPick) && !tempShown.has(r.id) && !fbIsFav(r.id)
    && !tierFilter[(tierNow.get(r.id) || {tier:"3"}).tier]);
  el.hidden = false;
  el.innerHTML = `<b>${fbEsc(sp.label)}</b> · ${(n.by[speciesPick] || 0).toLocaleString()} waters · `+
    `${(n.total - n.withData).toLocaleString()} have no species data yet`+
    (off.length ? `<div class="sp-off">+${off.length.toLocaleString()} ${off.every(isOther) ? "in Other" : "in classes switched off"} — `+
      `<button type="button" class="sp-all">turn on All</button></div>` : "");
}

/* The chips live in two collapsed menus ("River Filters", "Map Icons") rather
   than two always-open columns, which covered a lot of a phone-sized map. Only
   one panel is open at a time; a map tap or Escape closes it. Always starts
   collapsed — nothing is remembered. */
const tierCtl = L.control({position:"topleft"});
tierCtl.onAdd = function(){
  const d = L.DomUtil.create("div");
  d.id = "chipbar";
  d.innerHTML =
    `<button type="button" class="menubtn" data-menu="tierchips" aria-expanded="false" aria-controls="tierchips">`+
      `<span class="mlabel">River Filters</span> <span class="mcount"></span><span class="mcaret" aria-hidden="true">\u25BE</span></button>`+
    `<div id="tierchips" class="chipcol menupanel" role="group" aria-label="River filters: classes and species shown" hidden>`+
    TIER_KEYS.map(k =>
      `<button data-tier="${k}" class="${tierFilter[k]?"on":""}" aria-pressed="${!!tierFilter[k]}" style="--tc:${TIER_INFO[k].color}">`+
      `${k==="3" ? "All" : TIER_INFO[k].label}</button>`).join("")+
    speciesPickerHTML()+
    `</div>`+
    `<button type="button" class="menubtn" data-menu="layerchips" aria-expanded="false" aria-controls="layerchips">`+
      `<span class="mlabel">Map Icons</span> <span class="mcount"></span><span class="mcaret" aria-hidden="true">\u25BE</span></button>`+
    `<div id="layerchips" class="chipcol menupanel" role="group" aria-label="Map icons shown" hidden>`+
    LAYER_CHIPS.map(([id,label,,c]) =>
      `<button data-layer="${id}" aria-pressed="false" style="--tc:${c}">${label}</button>`+
      ICON_SUBS.filter(x => x[4] === id).map(([sid,sl,,sc]) =>
        `<button data-layer="${sid}" class="sub" aria-pressed="false" hidden style="--tc:${sc}">${sl}</button>`).join("")
    ).join("")+
    `</div>`;
  L.DomEvent.disableClickPropagation(d);
  L.DomEvent.disableScrollPropagation(d);
  const menus = [...d.querySelectorAll(".menubtn")];
  const closeMenus = () => menus.forEach(m => {
    m.setAttribute("aria-expanded", "false");
    d.querySelector("#"+m.dataset.menu).hidden = true;
  });
  menus.forEach(m => m.addEventListener("click", ()=>{
    const open = m.getAttribute("aria-expanded") !== "true";
    closeMenus();
    if(open){
      zoneCollapseJump();
      m.setAttribute("aria-expanded", "true");
      d.querySelector("#"+m.dataset.menu).hidden = false;
    }
  }));
  map.on("click", closeMenus);
  closeIconMenus = closeMenus;
  document.addEventListener("keydown", e => { if(e.key === "Escape") closeMenus(); });
  // Labels carry a count so a closed menu still says what is on the map.
  refreshMenuCounts = () => {
    const nt = TIER_KEYS.filter(k => tierFilter[k]).length;
    const nl = LAYER_CHIPS.filter(([id]) => chipOn(id)).length;     // chips, not layers: out of 8
    const sp = speciesPick && SPECIES_LIST.find(s => s.key === speciesPick);
    menus[0].querySelector(".mcount").textContent = "\u00B7 " + nt + (sp ? " \u00B7 " + (sp.short || sp.label) : "");
    menus[1].querySelector(".mcount").textContent = "\u00B7 " + nl;
    refreshSpeciesCount();                           // a class switched on or off changes "+14 in Other"
  };
  // One species at a time, from a native select: on an iPhone that is the
  // system's own picker wheel, one thumb. Not remembered between launches.
  const spSel = d.querySelector("#sp-sel");
  if(spSel) spSel.addEventListener("change", () => {
    speciesPick = spSel.value || null;
    if(speciesPick && typeof Metrics !== "undefined") Metrics.track("species_filter", speciesPick);
    tempShown.clear();                               // like a class change: what was opened on purpose hides again
    applyFilters();
    refreshMenuCounts();
  });
  const spCount = d.querySelector(".sp-count");
  if(spCount) spCount.addEventListener("click", e => {
    if(!e.target.closest(".sp-all")) return;
    const all = d.querySelector('[data-tier="3"]');
    if(all && !map.hasLayer(tierGroups["3"])) all.click();          // the All chip's own path: every class on
  });
  d.querySelectorAll("[data-tier]").forEach(b => b.addEventListener("click", ()=>{
    const k = b.dataset.tier, g = tierGroups[k];
    if(map.hasLayer(g)) map.removeLayer(g);          // turning a class off never touches the others
    else{
      /* "All" means all: turning Other ("3") on also turns Top pick, Worth it and Local on, so the
         count reads 4. They go first, while Other is still off, so each repaint is the cheap one. */
      if(k === "3") TIER_KEYS.forEach(o => { if(o !== "3" && !map.hasLayer(tierGroups[o])) map.addLayer(tierGroups[o]); });
      map.addLayer(g);
    }
    syncTierChips();                                 // aria-pressed on every chip, not just this one
  }));
  // A chip tap is the user's choice for the whole chip; syncIconLayers()
  // then puts every one of its layers where that choice says.
  d.querySelectorAll("[data-layer]").forEach(b => b.addEventListener("click", ()=>{
    if(typeof Metrics !== "undefined" && !chipOn(b.dataset.layer)) Metrics.track("layer_on", b.dataset.layer);
    iconUserSet(b.dataset.layer, !chipOn(b.dataset.layer));
    syncIconLayers();
  }));
  refreshMenuCounts();
  return d;
};
tierCtl.addTo(map);
TIER_KEYS.forEach(k => { if(tierFilter[k]) tierGroups[k].addTo(map); });
syncIconChips();

/* ============================================================
   MAP ICONS — one answer to "which icon layers are on?"
   Three things have a say, and as separate add/remove paths they would undo
   each other (focus restoring a layer that close zoom had just turned on,
   or zooming out taking away one the user asked for). So there is one
   function, iconWanted(), computed from:

     1. The user's own choice: a Map Icons chip, or "Show on map" on a
        float section. Everything is off at launch and nothing is
        remembered between launches. Choices are per chip (LAYER_CHIPS),
        not per layer: a chip's layers always come and go together.
     2. River focus: while a river's sheet is open, its access points,
        parking, bridges and the safety layers come on and the gauges step
        aside — unless the user taps that chip during the focus, after which
        it is theirs, and stays theirs when the sheet closes.
     3. Close zoom: from AUTO_ICON_ZOOM in, access, boat ramps, parking and
        trailheads come on by themselves and go again below it. One the user
        switches off while zoomed in stays off until they zoom back out; one
        they switched on stays on both ways.

   syncIconLayers() applies the answer and is the only code that adds or
   removes these layers on the app's behalf; any other add or remove is the
   user's and is recorded as such (iconUserSet). Ending a focus is therefore
   just recomputing without it — no snapshot to restore, and nothing the
   user changed in the meantime gets overwritten.
   ============================================================ */
const AUTO_ICON_ZOOM  = 12;          // compare with >= : zoomSnap is 0.25, so zoom is fractional
const AUTO_ICON_DELAY = 400;         // ms after zoomend, so a pinch passing through 12 doesn't flap
const AUTO_ICONS      = new Set(["access", "ramps", "trailheads"]);
const FOCUS_ICONS_ON  = new Set(["access", "ramps", "bridges", "hazards"]);
const FOCUS_ICONS_OFF = new Set(["gauges", "allgauges"]);
const iconChoice   = {};             // chip id -> the user's own on/off (absent = off)
const autoVeto     = new Set();      // switched off by hand while zoomed in close
const focusTouched = new Set();      // tapped during the current focus: the user's call now
let autoZoomed = false;              // the last *settled* zoom was close (never mid-animation)
let autoT = null, applyingIcons = false;

function focusSays(id){
  if(!focusId || focusTouched.has(id)) return null;
  if(FOCUS_ICONS_OFF.has(id)) return false;
  // Hazards now carry closed water with them; closureLayer draws only the
  // permanent closures (and only from zoom 9, syncClosures), so on a river
  // without one it simply adds nothing.
  if(FOCUS_ICONS_ON.has(id)) return true;
  return null;
}
function iconWanted(id){
  const it = ICON_BY_ID[id];
  if(it.parent && !iconWanted(it.parent)) return false;    // an option goes with its chip
  const f = focusSays(id);
  if(f !== null) return f;
  if(iconChoice[id]) return true;
  return autoZoomed && AUTO_ICONS.has(id) && !autoVeto.has(id);
}
function syncIconLayers(){
  applyingIcons = true;
  try{
    ICON_ITEMS.forEach(it => {
      const want = iconWanted(it.id);
      it.layers.forEach(g => {
        const has = map.hasLayer(g);
        if(want && !has) map.addLayer(g);
        else if(!want && has) map.removeLayer(g);
      });
    });
  } finally { applyingIcons = false; }
}
function iconUserSet(id, on){
  iconChoice[id] = on;
  if(focusId) focusTouched.add(id);
  if(on) autoVeto.delete(id);
  else if(autoZoomed && AUTO_ICONS.has(id)) autoVeto.add(id);
}
/* Nothing else adds or removes these layers today, but if anything ever
   does, it counts as the user's choice for that whole chip, and the chip's
   other layers follow. */
ICON_ITEMS.forEach(it => it.layers.forEach(g => {
  const by = on => () => {
    if(!applyingIcons){ iconUserSet(it.id, on); syncIconLayers(); }
    syncIconChips(); iconNudge();
  };
  g.on("add", by(true));
  g.on("remove", by(false));
}));
/* Close zoom acts only once the zoom has settled: zoomstart cancels a
   pending check, so a pinch or a fly that passes through 12 on its way
   somewhere else never switches anything. */
function autoIconsLater(){
  clearTimeout(autoT);
  autoT = setTimeout(() => {
    if(map._animatingZoom){ autoIconsLater(); return; }
    autoZoomed = !zonesShown && map.getZoom() >= AUTO_ICON_ZOOM;
    if(!autoZoomed) autoVeto.clear();          // zoomed back out: a fresh start next time in
    syncIconLayers();
  }, AUTO_ICON_DELAY);
}
map.on("zoomend", autoIconsLater);
map.on("zoomstart", () => clearTimeout(autoT));

/* ============================================================
   RIVER FOCUS — the map turns to the river whose sheet is open.
   Opening a river outlines it in gold, fades the rest of the water back,
   frames it clear of the sheet (fitFocus), shows that river's own access
   points (put-ins and take-outs included) and no other river's,
   switches on parking, bridges and the safety layers, and takes
   the gauge dots away — the sheet already has the flow. Closing the sheet
   puts the map back as it was (iconWanted() without the focus) and leaves
   the view where it is. Going straight from one river to another moves the
   focus without putting anything back in between.

   The fading is ONE opacity on the rivers pane (css: #map.rv-focus), not a
   restyle of a thousand polylines, and so that the open river isn't faded
   with them it is drawn again at full strength in its own pane above,
   over a gold casing. That copy takes no taps: they fall through to the
   river's real line underneath, which is what everything else uses.
   ============================================================ */
const focusPane = map.createPane("focusPane");
focusPane.style.zIndex = 412;          // over the faded rivers (410), under the current (415) and floats (415)
focusPane.style.pointerEvents = "none";
const FOCUS_GOLD = "#e2b33c";
const FOCUS_MAX_ZOOM = 14;             // a 1 km creek shouldn't fill the screen at z17
const FOCUS_MIN_ZOOM = 10;             // below this a whole river is a thread: frame a reach of it (fitFocus)
let focusDrawn = null;                 // the gold casing + the full-strength copy, as one group

function drawFocus(){
  if(focusDrawn){ map.removeLayer(focusDrawn); focusDrawn = null; }
  const lay = focusId && riverLayers[focusId];
  if(!lay) return;
  const r = lay.river, w = tierWeight(r), ll = lay.line.getLatLngs();
  const opt = {pane:"focusPane", interactive:false, lineCap:"round", lineJoin:"round", smoothFactor:1.2};
  focusDrawn = L.layerGroup([
    L.polyline(ll, {...opt, color:FOCUS_GOLD, weight:w + 14, opacity:.25}),   // soft glow
    L.polyline(ll, {...opt, color:FOCUS_GOLD, weight:w + 6,  opacity:.95}),   // the casing
    L.polyline(ll, {...opt, color:riverColor(r), weight:w, opacity:.95}),
    // per-reach trout colours stay on top, exactly as on the real line
    ...lay.reaches.map(o => L.polyline(o.getLatLngs(), {...opt, color:o.reachColor, weight:w, opacity:.95})),
  ]).addTo(map);
}
function markFocusFlow(){
  Object.keys(flowLines).forEach(id => flowLines[id].forEach(l => {
    const el = l.getElement();
    if(el) el.classList.toggle("rv-on", id === focusId);
  }));
}
/* The part of the map the sheet and the controls leave uncovered, as
   padding in pixels: a bottom sheet on a phone, the right-hand panel from
   900px (styles.css), the Change Region / menu stack top-left and the region
   picker top-right. On a phone that leaves a strip, but a river framed under
   the buttons is a river you can't see. The sheet is measured with
   offsetHeight/Width, not getBoundingClientRect: it is mid-slide when this
   runs, and the transform would put it off screen. */
function focusFrame(){
  const size = map.getSize();
  let top = ($("#appbar") ? $("#appbar").offsetHeight : 0) + 12, left = 16, right = 16, bottom = 16;
  if(window.innerWidth >= 900) right = sheet.offsetWidth + 14 + 16;
  else bottom = sheet.offsetHeight + 12;
  const tl = $(".leaflet-top.leaflet-left"), tr = $(".leaflet-top.leaflet-right");
  const a = tl && tl.getBoundingClientRect(), b = tr && tr.getBoundingClientRect();
  if(a && a.width && a.right < size.x / 2) left = Math.max(left, a.right + 8);
  if(b && b.width && b.left < size.x - right) top = Math.max(top, b.bottom + 8);
  // a sheet pulled tall still leaves some map to frame against
  bottom = Math.max(16, Math.min(bottom, size.y - top - 120));
  return {size, tl:L.point(left, top), br:L.point(right, bottom)};
}
/* Frame the open river in the part of the map the sheet leaves uncovered.

   A river that fits there at a readable zoom (FOCUS_MIN_ZOOM or closer) is
   shown whole, and left alone when it already is — unless it is so far off
   that it is a squiggle (two zoom levels short of fitting), where staying
   put would show a gold dot rather than a river.

   A river that doesn't is framed where it was chosen instead. The whole
   Snake through Jackson Hole fits a phone's clear strip only at about zoom
   7, where it is a thread under a clump of pins; at 10, centred on the reach
   that was tapped, it reads. The zoom is FOCUS_MIN_ZOOM or wherever closer
   the user already is — never out — and the map isn't moved at all when
   they are already that close and the spot is in the clear. */
function fitFocus(r, at){
  const lay = riverLayers[r.id]; if(!lay) return;
  const b = lay.line.getBounds(); if(!b.isValid()) return;
  const {size, tl, br} = focusFrame();
  const whole = () => goTo(b, null, {paddingTopLeft:tl, paddingBottomRight:br, maxZoom:FOCUS_MAX_ZOOM});
  if(!size.x || !size.y){ whole(); return; }          // no size yet: goTo holds the move until there is
  const z = map.getZoom();
  const clear = p => p.x >= tl.x && p.y >= tl.y && p.x <= size.x - br.x && p.y <= size.y - br.y;
  const fitZ = Math.min(FOCUS_MAX_ZOOM, map.getBoundsZoom(b, false, tl.add(br)));
  if(fitZ >= FOCUS_MIN_ZOOM){
    const inView = clear(map.latLngToContainerPoint(b.getNorthWest())) && clear(map.latLngToContainerPoint(b.getSouthEast()));
    if(!(inView && fitZ - z < 2)) whole();
    return;
  }
  const anchor = focusAnchor(r, at);
  if(z >= FOCUS_MIN_ZOOM && clear(map.latLngToContainerPoint(anchor))) return;
  const tz = Math.max(z, FOCUS_MIN_ZOOM);
  // The anchor goes in the middle of the CLEAR area, not of the map: the sheet
  // and the controls cover it unevenly, so the map's centre is offset by the
  // difference between the two.
  const mid = L.point((tl.x + size.x - br.x) / 2, (tl.y + size.y - br.y) / 2);
  goTo(map.unproject(map.project(anchor, tz).add(size.divideBy(2).subtract(mid)), tz), tz);
}
/* Where to frame a river too long to show whole: the spot it was chosen at
   (a tap on the line, or an access pin); otherwise the part of it already
   on screen nearest the middle, since that is the reach being looked at;
   otherwise its gauge, the reach the flow card is about; otherwise the
   middle of the line. Measured on the line as drawn, in screen pixels, and
   only the on-screen part of each segment counts. */
function focusAnchor(r, at){
  if(at) return L.latLng(at);
  const size = map.getSize(), view = L.bounds([0, 0], [size.x, size.y]), c = size.divideBy(2);
  const ll = riverLayers[r.id].line.getLatLngs();
  let best = null, bestD = Infinity;
  (Array.isArray(ll[0]) ? ll : [ll]).forEach(run => {
    const px = run.map(p => map.latLngToContainerPoint(p));
    for(let i = 1; i < px.length; i++){
      const seg = L.LineUtil.clipSegment(px[i-1], px[i], view, false, false);
      if(!seg) continue;
      const p = L.LineUtil.closestPointOnSegment(c, seg[0], seg[1]), d = p.distanceTo(c);
      if(d < bestD){ bestD = d; best = p; }
    }
  });
  if(best) return map.containerPointToLatLng(best);
  if(r.primaryGauge && GAUGE_POS[r.primaryGauge]) return L.latLng(GAUGE_POS[r.primaryGauge]);
  return L.latLng(midCoord(r.coords));
}
function focusRiver(r, fit, at){
  if(zonesShown) return;                       // the chooser is up: nothing to focus over
  focusId = r.id;
  syncOtherRivers();                            // the focused river is exempt from the view gate
  map.getContainer().classList.add("rv-focus");
  drawFocus();
  syncMarkers(); syncLabels(); markFocusFlow(); syncIconLayers(); iconNudge();
  if(fit) fitFocus(r, at);
  syncFlow();                                   // this river first in the animation budget
}
function unfocusRiver(){
  if(!focusId) return;                         // also what makes this safe to call at startup
  const was = riverLayers[focusId] && riverLayers[focusId].river;
  focusId = null;
  // focus kept it past the species filter; without focus the filter has it again
  if(speciesPick && was){ applyRiver(was); syncGaugeDots(); }
  syncOtherRivers();                            // and drops back under it
  focusTouched.clear();
  map.getContainer().classList.remove("rv-focus");
  drawFocus();                                  // with no focus, this just clears it
  syncMarkers(); syncLabels(); markFocusFlow(); syncIconLayers(); syncFlow();
}
/* The sheet closes in many places — ✕, a drag down, a float section on a
   phone, the tour backing out — so the class is watched rather than every
   one of them being hooked. openLake keeps it open and ends the focus
   itself; showZones does too. */
new MutationObserver(() => {
  if(!sheet.classList.contains("open")){
    unfocusRiver();
    if(curLake){ curLake = null; if(speciesPick){ syncLakeFilter(); syncMarkers(); } }   // likewise the open lake
  }
  iconNudge();
}).observe(sheet, {attributes:true, attributeFilter:["class"]});

/* ============================================================
   EMPTY-MAP NUDGE — every launch starts with no icons, which is right for
   reading the rivers but leaves someone zoomed in on a creek wondering
   where the parking went. Between zoom 9 and AUTO_ICON_ZOOM (past it the
   access icons come on by themselves), with no sheet open and not one icon
   layer on, the Map Icons button pulses — teal, the water colour; orange is
   reserved for live data — and once a session a small tip points at it.
   The ring goes the moment anything is switched on or a sheet opens; the
   tip doesn't come back once dismissed or once the menu has been opened.
   Shown after the view has sat still for a moment, so it doesn't flash
   during the fly-in from the chooser. Never over the welcome card, the tour
   or the chooser.
   ============================================================ */
const NUDGE_MIN_ZOOM = 9, NUDGE_DELAY = 800;
const iconTip = document.body.appendChild(document.createElement("div"));
iconTip.id = "icontip"; iconTip.setAttribute("role", "status");
iconTip.innerHTML = `<button type="button" class="it-text">No icons on the map — tap <b>Map Icons</b> to show parking, access, gauges and more.</button>` +
  `<button type="button" class="it-x" aria-label="Dismiss tip">✕</button>`;
let nudgeT = null, tipDoneMem = false;
const iconMenuBtn = () => document.querySelector('#chipbar [data-menu="layerchips"]');
const menuOpen = () => !!document.querySelector("#chipbar .menubtn[aria-expanded=true]");
function tipDone(){ try{ return sessionStorage.getItem("iconTipDone") === "1" || tipDoneMem; }catch(e){ return tipDoneMem; } }
function tipDoneSet(){ tipDoneMem = true; try{ sessionStorage.setItem("iconTipDone", "1"); }catch(e){} hideIconTip(); }
function nudgeWanted(){
  const z = map.getZoom();
  return !zonesShown && z >= NUDGE_MIN_ZOOM && z < AUTO_ICON_ZOOM
    && !sheet.classList.contains("open")
    && !document.body.classList.contains("touring")
    && !(typeof welcomePending === "function" && welcomePending())
    && !LAYER_CHIPS.some(([id]) => chipOn(id));
}
function iconNudge(){
  clearTimeout(nudgeT);
  if(!nudgeWanted()){ nudgeOff(); return; }      // going away is immediate
  nudgeT = setTimeout(() => { if(nudgeWanted()) nudgeOn(); else nudgeOff(); }, NUDGE_DELAY);
}
function nudgeOn(){
  const b = iconMenuBtn(); if(!b) return;
  b.classList.add("nudge");
  if(tipDone() || menuOpen()){ hideIconTip(); return; }
  iconTip.classList.add("show");
  placeIconTip();
}
function nudgeOff(){
  const b = iconMenuBtn(); if(b) b.classList.remove("nudge");
  hideIconTip();
}
function hideIconTip(){ iconTip.classList.remove("show"); }
/* Beside the button when there is room (a 375 px phone has ~230 px to its
   right), otherwise under it. */
function placeIconTip(){
  const b = iconMenuBtn(); if(!b || !iconTip.classList.contains("show")) return;
  const r = b.getBoundingClientRect(), room = innerWidth - r.right - 10 - 12;
  const beside = room >= 170;
  iconTip.classList.toggle("below", !beside);
  iconTip.style.width = (beside ? Math.min(250, room) : Math.min(300, innerWidth - 24)) + "px";
  if(beside){
    iconTip.style.left = (r.right + 10) + "px";
    iconTip.style.top = Math.max(8, r.top + r.height / 2 - iconTip.offsetHeight / 2) + "px";
  } else {
    iconTip.style.left = Math.max(12, r.left) + "px";
    iconTip.style.top = (r.bottom + 10) + "px";
  }
}
iconTip.querySelector(".it-x").addEventListener("click", tipDoneSet);
iconTip.querySelector(".it-text").addEventListener("click", () => { const b = iconMenuBtn(); if(b) b.click(); });
// Opening Map Icons is what the tip asks for; any menu open would sit under the tip.
document.querySelectorAll("#chipbar .menubtn").forEach(m => m.addEventListener("click", () => {
  if(m.dataset.menu === "layerchips") tipDoneSet(); else hideIconTip();
  iconNudge();
}));
map.on("moveend zoomend click", iconNudge);       // a map tap is also what closes a menu
addEventListener("resize", placeIconTip);
// zones-open (the chooser) and touring (the tour) are body classes
new MutationObserver(iconNudge).observe(document.body, {attributes:true, attributeFilter:["class"]});

/* My location — a dot on the map and a button to follow it.

   Nothing asks for location until the first tap: a permission prompt on page
   load, before you've said why you want it, is both rude and the quickest way
   to a permanent "Block". One tap starts the watch and follows the dot. The
   map chases the position only while following, and only when the dot has
   wandered out of the middle third of the view, so a truck on a bumpy road
   doesn't make the map twitch. Dragging the map is you saying "I'm looking
   somewhere else": it drops to `located` (dot stays, map stops chasing), and
   a tap brings you back. A tap while following turns it all off.

   The watch is released while the page is hidden — a GPS left running in a
   pocket is what flattens a phone on the drive between rivers — and resumed
   when the page is visible again.

   Asking up front: a page can't change iOS location settings, it can only
   trigger the system prompt (which needs a tap) and explain how to undo a
   block. So one friendly card (#locask) asks once, before the system prompt,
   and the answer is remembered in localStorage.locPref ("on"/"off" — a
   preference, never a position). Later launches with "on" start the watch
   by themselves in `located`, not `following`: the dot appears but the map
   stays where it is, so we don't yank it away from the zone chooser or the
   river you opened; the button is already lit and one tap recentres.
   "Not now" is permanent on purpose — nagging every launch is how an app
   gets deleted; the button still works any time.

   The blue dot itself isn't saved: its position lives in this closure for as
   long as the dot is drawn, not in localStorage, not in a URL, and not in
   anything the analytics script can see. The one exception is a lake trip
   the user starts on purpose (laketrip.js): its track is saved on this
   phone, in the Field Book. Don't promise "never sent" anywhere — trips are
   planned to sync to the owner's database once accounts exist. */
const locatePane = map.createPane("locatePane");
locatePane.style.zIndex = 650;      // above the markers: it must never hide under a gauge
locatePane.style.pointerEvents = "none";

const LOC_ICON = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M12 2v3.5M12 18.5V22M2 12h3.5M18.5 12H22"/></svg>`;
let locState = "off";               // "off" | "following" | "located"
let locWatch = null;                // watchPosition id while a watch is live
let locLast = null;                 // latest fix, in memory only
let locFirst = true;
let locDot = null, locAcc = null, locBtn = null, locPillT = null;

const locPill = document.body.appendChild(document.createElement("div"));
locPill.id = "locpill"; locPill.setAttribute("role", "status");
function locSay(msg, ms){
  locPill.textContent = msg; locPill.classList.add("show");
  clearTimeout(locPillT);
  locPillT = setTimeout(() => locPill.classList.remove("show"), ms || 5000);
}
let locPerm = "unknown";            // "granted" | "prompt" | "denied" | "unknown"
function locPrefGet(){ try{ return localStorage.getItem("locPref"); }catch(e){ return null; } }
function locPrefSet(v){ try{ localStorage.setItem("locPref", v); }catch(e){} }
const LOC_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function locBlockedSay(){
  locSay(LOC_IOS
    ? "Location is blocked for this site. On iPhone: Settings \u203A Privacy & Security \u203A Location Services \u203A Safari Websites \u203A While Using the App \u2014 then reopen the app."
    : "Location is blocked \u2014 allow it for this site in your browser settings.", 9000);
}
function locSetState(s){
  locState = s;
  if(!locBtn) return;
  locBtn.classList.toggle("following", s === "following");
  locBtn.classList.toggle("located", s === "located");
  locBtn.setAttribute("aria-pressed", String(s === "following"));
  locBtn.setAttribute("aria-label", s === "off" ? "Show my location"
    : s === "following" ? "Stop following my location" : "Recentre on my location");
}
function locClear(){
  if(locDot){ map.removeLayer(locDot); locDot = null; }
  if(locAcc){ map.removeLayer(locAcc); locAcc = null; }
  locLast = null;
}
function locStop(){
  if(locWatch !== null && navigator.geolocation) navigator.geolocation.clearWatch(locWatch);
  locWatch = null;
  locClear();
  locSetState("off");
}
function locDraw(c){
  const ll = L.latLng(c.latitude, c.longitude);
  locLast = ll;
  const moving = typeof c.heading === "number" && !isNaN(c.heading) && c.speed > 1;
  if(!locDot){
    locDot = L.marker(ll, {
      pane:"locatePane", interactive:false, keyboard:false,
      icon:L.divIcon({className:"loc-icon", iconSize:[16,16], iconAnchor:[8,8],
        html:`<span class="loc-halo"></span><span class="loc-wedge"></span><span class="loc-core"></span>`})
    }).addTo(map);
  } else locDot.setLatLng(ll);
  const wedge = locDot.getElement() && locDot.getElement().querySelector(".loc-wedge");
  if(wedge){
    wedge.style.display = moving ? "block" : "none";
    if(moving) wedge.style.transform = "rotate(" + c.heading + "deg)";
  }
  // The accuracy ring only earns its place when the fix is loose enough to matter.
  if(c.accuracy > 25){
    if(!locAcc) locAcc = L.circle(ll, {pane:"locatePane", interactive:false, radius:c.accuracy,
      color:"#1a73e8", weight:1, opacity:.5, fillColor:"#1a73e8", fillOpacity:.1}).addTo(map);
    else locAcc.setLatLng(ll).setRadius(c.accuracy);
  } else if(locAcc){ map.removeLayer(locAcc); locAcc = null; }
  return ll;
}
function locInMiddleThird(ll){
  const s = map.getSize(), p = map.latLngToContainerPoint(ll);
  return p.x > s.x/3 && p.x < s.x*2/3 && p.y > s.y/3 && p.y < s.y*2/3;
}
function locFix(pos){
  const ll = locDraw(pos.coords);
  if(locFirst){
    locFirst = false;
    if(zonesShown) hideZones();
    goTo(ll, Math.max(map.getZoom(), 11));
  } else if(locState === "following" && !locInMiddleThird(ll)){
    goTo(ll, map.getZoom());
  }
  if(window.floatOnFix) floatOnFix(pos);   // float.js: tracks progress down the river
  if(window.lakeOnFix) lakeOnFix(pos);     // laketrip.js: records a lake trip's track
}
function locError(e){
  if(e.code === 1){ locStop(); locPerm = "denied"; locBlockedSay(); }
  else locSay("Can't get a location fix right now.");   // keep watching; fixes often come back
}
function locWatchStart(){
  if(locWatch !== null) return;
  locWatch = navigator.geolocation.watchPosition(locFix, locError,
    {enableHighAccuracy:true, maximumAge:10000, timeout:20000});
}
function locStart(mode){            // mode: "following" (tap) | "located" (auto-start, map stays put)
  if(!navigator.geolocation || !window.isSecureContext){ locSay("Location isn't available here."); return; }
  locFirst = mode !== "located";    // the first fix only flies the map when the user asked for it
  locSetState(mode);
  locWatchStart();
}
function locToggle(){
  if(locState === "off"){
    if(locPerm === "denied"){ locBlockedSay(); return; }
    locPrefSet("on");
    locStart("following");
  } else if(locState === "located"){
    locSetState("following");
    if(locLast) goTo(locLast, map.getZoom());
  } else if((window.floatActiveNow && floatActiveNow()) || (window.lakeTripActiveNow && lakeTripActiveNow())){
    // mid-float or mid-lake-trip the dot is the whole point: tapping cycles follow/free, never off
    locSetState("located");
  } else { locPrefSet("off"); locStop(); }
}
map.on("dragstart", () => { if(locState === "following") locSetState("located"); });
document.addEventListener("visibilitychange", () => {
  if(locState === "off") return;
  if(document.visibilityState === "hidden"){
    if(locWatch !== null){ navigator.geolocation.clearWatch(locWatch); locWatch = null; }
  } else locWatchStart();
});

const locCtl = L.control({position:"bottomright"});
locCtl.onAdd = function(){
  const d = L.DomUtil.create("div", "loc-ctl");
  d.innerHTML = `<button id="btn-locate" type="button" aria-label="Show my location" aria-pressed="false">${LOC_ICON}</button>`;
  L.DomEvent.disableClickPropagation(d);
  locBtn = d.querySelector("button");
  locBtn.addEventListener("click", locToggle);
  return d;
};
locCtl.addTo(map);
// Zoom +/- sits directly above the locate button: bottom controls stack upward
// in the order added, so it has to be added after the locate control.
const zoomCtl = L.control.zoom({position:"bottomright"}).addTo(map);
// The one-time ask (see the comment above) and the quiet auto-start.
const locAsk = document.body.appendChild(document.createElement("div"));
locAsk.id = "locask"; locAsk.setAttribute("role", "dialog"); locAsk.setAttribute("aria-label", "Show where you are");
locAsk.innerHTML = `<div class="la-ic">${LOC_ICON}</div><div class="la-body"><h3>Show where you are?</h3>
  <p>See your position on the map while you drive and fish. The blue dot isn\u2019t saved. If you record a lake trip, its track is saved on this phone, in your Field Book.</p>
  <div class="la-btns"><button type="button" id="la-yes">Turn on location</button><button type="button" id="la-no">Not now</button></div></div>`;
document.getElementById("la-yes").addEventListener("click", () => {
  locAsk.classList.remove("show"); locPrefSet("on");
  if(locState === "off") locStart("following");     // this tap is the gesture iOS needs for its prompt
});
document.getElementById("la-no").addEventListener("click", () => { locAsk.classList.remove("show"); locPrefSet("off"); });
(function(){
  if(!navigator.geolocation || !window.isSecureContext) return;
  let q = null;
  try{
    q = navigator.permissions && navigator.permissions.query({name:"geolocation"});
  }catch(e){ q = null; }
  // The welcome card (js/tour.js) owns a first launch: the location ask waits
  // behind it and is handed back by locAskLater() once the welcome is dismissed.
  window.locAskLater = () => {
    if(locPerm === "denied" || locState !== "off" || locPrefGet() !== null) return;
    locAsk.classList.add("show");
  };
  const boot = () => setTimeout(() => {
    if(locPerm === "denied" || locState !== "off") return;
    const pref = locPrefGet();
    if(pref === "on") locStart("located");
    else if(pref === null && !(typeof welcomePending === "function" && welcomePending())) locAsk.classList.add("show");
  }, 1200);
  if(q && q.then) q.then(st => {
    locPerm = st.state;
    st.addEventListener("change", () => {
      locPerm = st.state;
      if(st.state === "denied" && locState !== "off") locStop();
    });
    boot();
  }, boot);
  else boot();
})();
// The sheet slides up over the bottom of the map and would cover the buttons;
// watching its class is simpler than hooking every place it opens or closes.
(function(){
  const sheetEl = document.getElementById("sheet");
  if(!sheetEl || !window.MutationObserver) return;
  const sync = () => {
    const open = sheetEl.classList.contains("open");
    locCtl.getContainer().classList.toggle("loc-hide", open);
    zoomCtl.getContainer().classList.toggle("loc-hide", open);   // zoom stays on the chooser, locate doesn't
  };
  new MutationObserver(sync).observe(sheetEl, {attributes:true, attributeFilter:["class"]});
  sync();
})();

/* A park's card counts what the map is actually showing, not everything
   mapped there — Yellowstone reading 208 over a handful of lines is the
   clutter this exists to remove. */
function refreshZoneCounts(){
  const sets = {yell: r => r.region==="yellowstone",
                grte: r => r.region==="grandteton" || GRTE_SHARED.includes(r.id)};
  Object.entries(PARK_INFO).forEach(([reg, p]) => { sets[p.zone] = r => r.region === reg; });
  document.querySelectorAll(".zone-card .zc-count[data-zone]").forEach(el => {
    const f = sets[el.dataset.zone]; if(!f) return;
    // the class filter only: a count is "rivers in this zone", not "in view"
    const all = RIVERS.filter(f), shown = all.filter(tierPicked).length;
    el.textContent = shown === all.length ? shown+" rivers" : shown+" of "+all.length+" rivers";
  });
}
applyFilters();

syncMarkers();          // seed marker groups for the starting zoom
loadPublicLand();
setTimeout(trickleGeometry, 600);


/* The app bar floats over the map and its height isn't fixed: the title
   wraps to two lines on a narrow phone. The top control stacks clear it by
   its measured height (--appbar-h in styles.css), not a guessed constant. */
(function(){
  const bar = document.getElementById("appbar");
  if(!bar) return;
  const set = () => document.documentElement.style.setProperty("--appbar-h", bar.offsetHeight + "px");
  set();
  if(window.ResizeObserver) new ResizeObserver(set).observe(bar);
  else window.addEventListener("resize", set);
})();
