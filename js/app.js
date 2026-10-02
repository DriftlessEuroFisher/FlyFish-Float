/* ============================================================
   USGS WATER DATA — modernized OGC API (api.waterdata.usgs.gov)
   - latest-continuous : current discharge (00060)
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
RIVERS.forEach(r => {
  if(r.cz && !r.coords) r.coords = Array.isArray(r.cz) ? r.cz.map(decodePolyline) : decodePolyline(r.cz);
  delete r.cz;
});

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

   Everything below asks for MANY SITES PER REQUEST instead. Same data,
   measured at 67 requests for a full cold load instead of ~1,530 — 7 for
   every latest value on the map, 56 for the whole history backfill, 4 for
   metadata. A steady-state refresh is 7.

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

/* Which region each gauge belongs to. Batches are built per region so the
   water you're actually looking at loads first and the rest trickles in —
   see refreshAll(). */
// The far-western states and their parks batch by STATE, not by region tag:
// every park and state is its own region, and a bucket of one gauge still
// costs a latest call and seven history calls of its own -- thirty small
// buckets roughly doubled a cold load against the 1,000/hour budget.
const STATE_BUCKET = new Set(["CA","OR","WA","MT","CO","UT","AK","MI","SD","NM","AZ","NV"]);
function regionOfRiver(r){
  if(STATE_BUCKET.has(r.state) && r.region!=="yellowstone" && r.region!=="grandteton") return "w-"+r.state;
  if(r.region) return r.region;               // "driftless" | "northshore"
  if(r.state==="ID" || r.state==="WY") return "west";
  if(r.state==="IA") return "ciowa";
  return "uppermidwest";                      // MN/WI big water + Northwoods
}
const GAUGE_REGION = {};
RIVERS.forEach(r => (r.gauges||[]).forEach(g => {
  if(!GAUGE_REGION[g]) GAUGE_REGION[g] = regionOfRiver(r);
}));
// A gauge listed in GAUGES but not referenced by any river would otherwise
// belong to no region and never be fetched at all. Park it in "other".
Object.keys(GAUGES).forEach(k => { if(!GAUGE_REGION[k]) GAUGE_REGION[k] = "other"; });
const REGION_KEYS = [...new Set(Object.values(GAUGE_REGION))];
function gaugesInRegion(reg){ return Object.keys(GAUGES).filter(k => GAUGE_REGION[k] === reg); }

/* ---------- tiny storage layer (works even where localStorage
   is unavailable, e.g. sandboxed previews) ---------- */
const mem = {};
const store = {
  get(k){ try { return JSON.parse(localStorage.getItem(k)); } catch(e){ return mem[k] ?? null; } },
  set(k,v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch(e){ mem[k]=v; } },
};

const flows = {};   // gaugeKey -> {cfs, time, fetchedAt, stale}
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
   CORS-open. DWR allows 1,000 requests a day per client; a cold load is
   one latest call and seven history calls per 40 stations. */
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
  });
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
    monitoring_location_id: siteOf(key), parameter_code:"00060", limit:"4"
  });
  try{
    const j = await fetchJSON(url, 15000);
    const f = (j.features||[]).find(x=>x.properties && x.properties.value != null);
    const cfs = f ? parseFloat(f.properties.value) : NaN;
    if(!isFinite(cfs)) throw new Error("no data");
    flows[key] = {cfs, time:f.properties.time, fetchedAt:Date.now(), stale:false};
    store.set("flow:"+key, flows[key]);
  }catch(e){ markStale([key]); }
}

/* Latest discharge for many gauges in ONE request. Each returned feature
   carries its own monitoring_location_id, so the response is split back
   out per gauge. */
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
    parameter_code: "00060",
    limit: String(keys.length * 4)
  });
  try{
    const j = await fetchJSON(url, 20000);
    const feats = (j.features||[]).filter(f=>f.properties && f.properties.value != null);
    const sites = new Set(feats.map(f=>f.properties.monitoring_location_id));
    // asked for many, heard about at most one -> the list wasn't honoured
    if(sites.size <= 1 && keys.length > 1){
      batchSupported = false;
      for(const k of keys) await fetchOneLatest(k);
      return;
    }
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
  const now = new Date();
  return `stats:${GAUGES[key].site}:${now.getFullYear()}w${Math.floor(dayOfYear(now)/7)}:y${STAT_YEARS}`;
}

/* Day-of-year median for many gauges at once.

   Same shape as before — daily means (statistic 00003) from a +/-STAT_WINDOW
   day window around today's date in each of the last STAT_YEARS years — but
   the loop is inverted. It used to be one request per gauge per year
   (170 x 7 = ~1,190 calls). Now it's one request per year per chunk of
   sites: 7 years x ceil(n/30) chunks, so 56 calls for the whole map. */
async function fetchStatsBatch(keys){
  const dwrWant = keys.filter(k => isDWR(k) && stats[k] === undefined);
  if(dwrWant.length) await fetchDWRStats(dwrWant);
  keys = keys.filter(k=>!isDWR(k));
  const want = keys.filter(k => stats[k] === undefined);
  if(!want.length) return;
  // serve whatever is already cached, request only the rest
  const need = [];
  want.forEach(k=>{
    const c = store.get(statsCacheKey(k));
    if(c) stats[k] = c; else need.push(k);
  });
  if(!need.length) return;

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
    }catch(e){ /* fall through to the unverified default below */ }
    group.forEach(k=>{
      if(!meta[k]) meta[k] = {name: GAUGES[k].label, verified:false};
    });
  }
}

function dayOfYear(d){ return Math.floor((d - new Date(d.getFullYear(),0,0))/864e5); }

/* ---------- flow interpretation ---------- */
function statusOf(key){
  const f = flows[key], s = stats[key];
  if(!f || f.cfs==null) return {cls:"na", label:"No data", color:"var(--st-na)", ratio:null};
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
/* Overlay toggles are wired in after the marker layers exist — see
   layerControl.addOverlay() calls further down. */
const layerControl = L.control.layers(
  {"USGS Topo":usgsTopo,"USGS Imagery + Topo":usgsImgTopo,"Google Hybrid":gHyb,"Google Satellite":gSat,"Esri Satellite":sat,"OpenTopoMap":topo},
  null, {position:"bottomleft"}).addTo(map);

/* region quick-jump */
const REGIONS = [
  ["Jump to region…", null],
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
const regionCtl = L.control({position:"topright"});
regionCtl.onAdd = function(){
  const d = L.DomUtil.create("div");
  d.innerHTML = '<select id="regionsel" style="font:600 12px \'Public Sans\',sans-serif;padding:7px 8px;border-radius:9px;border:1px solid var(--line);background:var(--paper-2);color:var(--txt);box-shadow:0 1px 4px rgba(15,30,22,.2);max-width:200px">'+
    REGIONS.map((r,i)=>`<option value="${i}">${r[0]}</option>`).join("")+'</select>';
  L.DomEvent.disableClickPropagation(d);
  d.querySelector("select").addEventListener("change",e=>{
    const r = REGIONS[+e.target.value][1];
    if(r) map.setView([r[0],r[1]], r[2]);
    e.target.value = 0;
  });
  return d;
};
regionCtl.addTo(map);

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
  const poly = L.polygon(k.ring, {pane:"lakePane", color:"#0e5f72", weight:1.8,
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

function openLake(id){
  const k = LAKES.find(x => x.id === id); if(!k) return;
  curRiver = null;
  $("#sw").style.background = "#3aa7c2";
  $("#sh-title").textContent = k.name;
  const grte = k.park === "grandteton";
  // the western parks answer from PARK_INFO; Yellowstone and Grand Teton keep their own copy
  const pk = PARK_INFO[k.park];
  const stateName = {WY:"Wyoming", OR:"Oregon", WA:"Washington", CA:"California", MT:"Montana",
                     CO:"Colorado", UT:"Utah", AK:"Alaska", ID:"Idaho", MI:"Michigan", SD:"South Dakota",
                     NM:"New Mexico", AZ:"Arizona", NV:"Nevada"}[k.state] || k.state;
  $("#sh-sub").textContent = pk ? stateName + pk.sub + " · lake"
                         : grte ? "Wyoming · Grand Teton National Park · lake"
                                : "Wyoming · Yellowstone National Park · lake";
  sheet.classList.add("open");
  body.innerHTML =
    `<p style="margin:12px 2px 2px;font-size:13.5px">${k.blurb}</p>` +
    `<div class="flowcard"><div class="gname">Still water — ${k.areaKm2} km²</div>` +
    `<div class="plain">No gauge and no flow number: a lake doesn't have one. What "in shape" means here is ice-off, water temperature and wind, not CFS — and on the big lakes the wind is the thing that decides the day.</div></div>` +
    `<div class="secthead">Fishing notes</div><div class="fishnote">🎣 ${k.fish}</div>` +
    `<div class="secthead">${(pk && pk.heading) || "Park regulations"}</div><div class="fishnote">` +
      `<span class="badge" style="background:#4a6f8a">${pk ? pk.badge : grte ? "Grand Teton · Wyoming regs" : "National Park Service"}</span> ` +
      `<span style="font-size:11.5px">${k.regs}</span>` +
      `<div style="font-size:10.5px;color:var(--txt-dim);margin-top:8px">${pk ? pk.note : grte
        ? `From the National Park Service's Grand Teton fishing information, which follows <b>Wyoming Game &amp; Fish</b> regulations. Bait is allowed on park lakes that aren't otherwise restricted — the artificial-only rule covers the streams. Seasons and limits are re-issued every year; check the current Wyoming regulations and carry a Wyoming licence.`
        : `From the park's <b>2026</b> fishing regulations. A park permit is required at 16 and over and a state licence is not valid; tackle is lead-free artificial lures or flies, barbless. Attractors such as dodgers and lake trolls may be used <b>in lakes only</b>. Re-issued every year — read the current edition before you fish.`}</div>` +
    `</div>` +
    `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Lake outline: ${k.src==="osm" ? "OpenStreetMap" : "USGS NHD waterbodies"}. Verify regulations with ${pk ? pk.regBody : grte
      ? "WY Game &amp; Fish and the park — Grand Teton takes a <b>Wyoming licence</b>, unlike Yellowstone"
      : "the National Park Service (a state fishing licence is <b>not</b> valid in the park)"}.</p>`;
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
const closureLayer = L.layerGroup().addTo(map);
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
  for(const r of RIVERS){
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
        dashArray:"6 24", className:"flow-line " + cls}).addTo(flowLayer);
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
    // Yellowstone sits between the two: the park fills the screen around
    // zoom 9, and 40 labels at 8 is soup while 10 hides the whole region.
    /* `minor` water — the 166 named Yellowstone creeks nobody has written
       about — stays unlabelled until you are close enough to be choosing
       between them. Two hundred labels over the park is not a map. */
    let min = (l.river && l.river.minor) ? 12
              : (reg === "driftless" || reg === "northshore" || reg === "doorcounty"
                 || reg === "tetonvalley" || reg === "swanvalley") ? 10
              : (reg === "yellowstone" || reg === "grandteton") ? 9
              : PARK_INFO[reg] ? (PARK_INFO[reg].labelZoom || 9) : 8;
    // lesser classes need more zoom before their names are worth the clutter
    const t = tierNow.get(l.river.id);
    if(t && t.tier === "2") min += 1;
    else if(t && t.tier === "3") min += 2;
    l.lbl.setOpacity(z >= min ? 1 : 0);
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
};
const TROUT_SOURCE = {
  iadnr:{agency:"Iowa DNR",      what:"trout-stream layer",          regs:"Iowa DNR trout regulations"},
  wdnr: {agency:"Wisconsin DNR", what:"classified trout water layer", regs:"Wisconsin DNR trout regulations"},
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
let tierFilter = {gold:true, "1":true, "2":true, "3":false};
try{
  const saved = JSON.parse(localStorage.getItem("tierFilter")||"null");
  if(saved && TIER_KEYS.every(k => typeof saved[k]==="boolean")) tierFilter = saved;
}catch(e){}
/* ---------- Field Book storage ----------
   One localStorage key, loaded once into memory and written through on every
   change. It lives up here, above tierShown(), because tierShown() asks it
   about favourites during the first applyFilters() at startup — declared
   lower it would still be in its temporal dead zone (same trap as PARK_INFO).
   Every read and write is wrapped: in a private window storage can throw, and
   then the book simply works for the session and is gone on reload. Nothing
   here is ever sent anywhere. */
const FB_KEY = "fieldBook";
let fbState = {v:1, rivers:{}};
try{
  const saved = JSON.parse(localStorage.getItem(FB_KEY)||"null");
  if(saved && saved.v===1 && saved.rivers && typeof saved.rivers==="object") fbState = saved;
}catch(e){}
function fbPersist(){ try{ localStorage.setItem(FB_KEY, JSON.stringify(fbState)); }catch(e){} }
function fbGet(id){
  const e = fbState.rivers[id];
  return e ? e : {fav:false, fished:false, fishedOn:null, notes:"", updated:0};
}
function fbSet(id, patch){
  const e = Object.assign({}, fbGet(id), patch, {updated:Date.now()});
  if(!e.fav && !e.fished && !(e.notes||"").trim()) delete fbState.rivers[id];   // nothing left to keep
  else fbState.rivers[id] = e;
  fbPersist();
  return e;
}
function fbAll(){ return fbState.rivers; }
function fbIsFav(id){ const e = fbState.rivers[id]; return !!(e && e.fav); }

const tempShown = new Set();          // hidden rivers opened on purpose (search, gauge tap)
const tierNow = new Map();            // river id → tierOf() for today
function refreshTiers(){ RIVERS.forEach(r => tierNow.set(r.id, tierOf(r))); }
refreshTiers();
function tierShown(r){
  const t = tierNow.get(r.id);
  /* A favourite is a persistent tempShown: you starred it, so a class filter
     doesn't get to hide it. */
  return tempShown.has(r.id) || fbIsFav(r.id) || (t ? tierFilter[t.tier] : tierFilter["3"]);
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
   in six places; this table is one place instead. Each entry answers the
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


const riverLayers = {}, rampMarkers = {}, gaugeDots = {};
let highlight = null;

RIVERS.forEach(r=>{
  const line = L.polyline(r.coords,{color:riverColor(r), weight:tierWeight(r), opacity:.92,
    lineCap:"round", lineJoin:"round", smoothFactor:1.2, pane:"riversPane"}).addTo(map);
  onTap(line, ()=>openRiver(r.id));
  const mid = midCoord(r.coords);
  const lbl = L.marker(mid,{interactive:false,icon:L.divIcon({className:"riv-label",html:r.name.split("—")[0].split("(")[0].trim(),iconSize:null})}).addTo(map);
  riverLayers[r.id]={line,lbl,river:r};
});
syncLabels();

/* boat-ramp logo for launches/take-outs; fish for wade access */
function apGlyph(role){
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

     Boat ramps          off by default — opt in when you're floating.
     Wade access/parking on  by default — this is the whole game on a
                             Driftless spring creek, where "access" means a
                             signed gravel pull-off, not a ramp.
     USGS gauges         on  by default — they're the live data.

   syncMarkers() additionally zoom-gates membership so the groups stay empty
   at statewide zoom and fill in as you get close enough for them to mean
   something. */
const rampLayer   = L.layerGroup();              // launch / takeout / both
const wadeLayer   = L.layerGroup().addTo(map);   // role:"wade" parking & walk-in
const gaugeLayer  = L.layerGroup().addTo(map);
const RAMP_MIN_ZOOM = 8, WADE_MIN_ZOOM = 9;

RAMPS.forEach(p=>{
  const m = L.marker(p.pos,{icon:apIcon(p,"")});
  m.bindPopup(`<b>${p.name}</b><br><span style="font-size:11px">${roleWord(p.role)} · ${p.note}</span>`);
  m.on("click",()=>{ openRiver(p.river); });
  rampMarkers[p.id]=m;
});
function groupFor(p){ return p.role==="wade" ? wadeLayer : rampLayer; }
function minZoomFor(p){ return p.role==="wade" ? WADE_MIN_ZOOM : RAMP_MIN_ZOOM; }
/* Membership is (passes the filter chips) AND (zoomed in far enough).
   Toggling the group itself on/off is the layer control's job, so this
   stays independent of whether the user has that group showing. */
function syncMarkers(){
  const z = map.getZoom();
  RAMPS.forEach(p=>{
    const m = rampMarkers[p.id], g = groupFor(p);
    const show = rampPassesFilter(p) && z >= minZoomFor(p);
    const has = g.hasLayer(m);
    if(show && !has) g.addLayer(m);
    else if(!show && has) g.removeLayer(m);
  });
}
map.on("zoomend", syncMarkers);
function apIcon(p, sel){ return L.divIcon({className:"", html:`<div class="ap ${p.role} ${sel}">${apGlyph(p.role)}</div>`, iconSize:[28,28], iconAnchor:[14,14]}); }
function roleWord(r){ return {launch:"Put-in (boat launch)", takeout:"Take-out (boat ramp)", both:"Put-in & take-out ramp", wade:"Wade-fishing access"}[r]; }

Object.keys(GAUGE_POS).forEach(key=>{
  const m = L.marker(GAUGE_POS[key],{icon:gIcon(key), zIndexOffset:300}).addTo(gaugeLayer);
  m.on("click",()=>{
    const r = RIVERS.find(rv=>rv.gauges.includes(key));
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
const publicLand = L.layerGroup().addTo(map);
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

layerControl.addOverlay(publicLand, "Public land (state, federal, county)");
layerControl.addOverlay(wadeLayer,  "Wade access &amp; parking");
layerControl.addOverlay(rampLayer,  "Boat ramps");
layerControl.addOverlay(gaugeLayer, "USGS gauges");
layerControl.addOverlay(closureLayer, "Closed water (year-round)");

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
  // "iadnr" (NE Iowa) or "widnr" (Door Peninsula) — either way, leave it alone
  if(r.geom){ layer.real = true; layer.tried = true; return; }
  layer.tried = true;
  const ck = "nhd:"+r.id;
  const cached = store.get(ck);
  if(cached && cached.g && (Date.now()-(cached.t||0) < 1000*60*60*24*30)){
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

   * `iadnr` / `widnr` rivers are never touched. Those lines are the state
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
     OSM rivers are refined from OSM itself, never from NHD -- mixing two
     sources along one channel fragments the line wherever they disagree by
     more than REFINE_BUFFER_KM. The baked OSM line is simplified (40 m, 80 m
     in Alaska); the refinement is the same ways at full resolution. */
  if(r.geom === "iadnr" || r.geom === "widnr" || r.geom === "midnr"){ layer.refined = true; return; }
  layer.refining = true;
  const ck = "nhdfine:" + r.id;
  const cached = store.get(ck);
  if(cached && cached.g && (Date.now() - (cached.t || 0) < 1000*60*60*24*30)){
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
  const stateName = {ID:"Idaho", WY:"Wyoming", IA:"Iowa", MN:"Minnesota", WI:"Wisconsin", IL:"Illinois",
                     CA:"California", OR:"Oregon", WA:"Washington", MT:"Montana",
                     CO:"Colorado", UT:"Utah", AK:"Alaska", MI:"Michigan", SD:"South Dakota",
                     NM:"New Mexico", AZ:"Arizona", NV:"Nevada"}[r.state] || r.state;
  const subRegion = {driftless:" · Driftless Area", northshore:" · North Shore",
                     doorcounty:" · Door Peninsula",
                     yellowstone:" · Yellowstone National Park",
                     grandteton:" · Grand Teton National Park",
                     tetonvalley:" · Teton Valley", swanvalley:" · Swan Valley"}[r.region]
                    || (PARK_INFO[r.region] && PARK_INFO[r.region].sub) || "";
  return stateName + subRegion;
}
function riverStateName(r){ return riverPlace(r).split(" · ")[0]; }

async function openRiver(id, focusGauge){
  const r = RIVERS.find(x=>x.id===id); if(!r) return;
  curRiver = id;
  if(!tierShown(r)){ tempShown.add(id); applyFilters(); }   // opened on purpose: show it
  $("#sw").style.background = riverColor(r);
  $("#sh-title").textContent = r.name;
  $("#sh-sub").textContent = riverPlace(r);
  fbShowRow(r);
  sheet.classList.add("open");
  loadRealRiver(r);                    // snap this river to exact USGS linework
  renderSheet(r);                      // instant paint with whatever we have
  // lazy-load stats + metadata for this river's gauges, then repaint.
  // Batched across the river's gauges: opening the Mississippi Headwaters
  // (6 gauges) is 2 requests, not 48.
  await Promise.all([fetchStatsBatch(r.gauges), verifyGaugesBatch(r.gauges)]);
  if(curRiver===id){ renderSheet(r); repaintGauges(); }
  if(focusGauge) map.panTo(GAUGE_POS[focusGauge]);
}

function tierChipHTML(r){
  const t = tierNow.get(r.id) || tierOf(r), info = TIER_INFO[t.tier], base = TIER_INFO[t.base];
  let line = "";
  if(t.state === "closed") line = `Closed ${winText(t.wins)}${t.why ? " — "+t.why : ""}`;
  else if(t.state === "best") line = `${t.tier!==t.base ? "Usually "+base.label+" — " : ""}Prime time now (${winText(t.wins)}).${t.why ? " "+t.why : ""}`;
  else if(t.state === "poor") line = `Usually ${base.label} — off this time of year (${winText(t.wins)}).${t.why ? " "+t.why : ""}`;
  else if(t.why) line = t.why;
  return `<div class="tierline"><span class="tierbadge" style="--tc:${info.color}">${info.label}${t.state==="closed"?" · closed":""}</span>`+
         (line ? `<span class="tierwhy">${line}</span>` : `<span class="tierwhy">${info.blurb}</span>`)+`</div>`;
}

/* Who to check with. Inside a national park the state agency has nothing to
   do with it — a Wyoming or Montana licence is not valid in Yellowstone, and
   pointing a reader at Game & Fish for these rivers would be actively wrong. */
function regBodyFor(r){
  return PARK_INFO[r.region] ? PARK_INFO[r.region].regBody
    : r.region==="yellowstone"
    ? "the National Park Service (a state fishing licence is <b>not</b> valid in the park)"
    : r.region==="grandteton"
    ? "WY Game &amp; Fish and the park — Grand Teton takes a <b>Wyoming licence</b>, unlike Yellowstone"
    : (r.region==="tetonvalley" || r.region==="swanvalley")
    ? "Idaho Fish &amp; Game (Upper Snake Region)"
    : {IA:"the Iowa DNR", MN:"the Minnesota DNR", WI:"the Wisconsin DNR", IL:"the Illinois DNR", ID:"Idaho Fish &amp; Game", WY:"Wyoming Game &amp; Fish"}[r.state]
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
   federal land and the state's streambed law doesn't govern it. State rows in
   PARK_INFO have sub:"" and do get the row. fbEsc is declared further down but
   only called at render time, well after it exists. */
function accessLawHTML(r){
  const pi = PARK_INFO[r.region];
  if(r.region==="yellowstone" || r.region==="grandteton" || (pi && /National Park|Park Complex/.test(pi.sub||""))) return "";
  const a = typeof ACCESS_LAW!=="undefined" && ACCESS_LAW[r.state]; if(!a) return "";
  return `<div class="rc-lic rc-access"><span class="rc-lab">Wading &amp; access</span>`+
    `<div style="font-size:13px;line-height:1.35;margin-top:2px">${fbEsc(a.head)}</div>`+
    `<details class="rc-law"><summary>${a.quote ? "The law, in its own words" : "Source"}</summary>`+
    (a.quote ? `<blockquote>${fbEsc(a.quote)}</blockquote>` : "")+
    `<div class="fb-note">Source: <a href="${fbEsc(a.url)}" target="_blank" rel="noopener">${fbEsc(a.src)}</a></div></details></div>`;
}

function rulesCardHTML(r){
  const m = new Date().getMonth() + 1;
  const e = TIERS[r.id], s = e && e.season, closed = s && s.closed && s.closed.length ? s.closed : null;
  const hasText = !!(r.parkRegs || r.troutRegs);
  let dot, head, sub = "";
  if(closed && inWindow(m, closed)){
    dot = "#9a4a2e"; head = "Closed season";
    sub = `Closed ${winText(closed)}${s.why ? " — "+s.why : ""}`;
  } else if(closed && closed.some(([a,b]) => m === (a===1 ? 12 : a-1) || m === (b%12)+1)){
    dot = "#c48a17"; head = "Season opens or closes this month";
    sub = `Closed ${winText(closed)}. Check the exact date in the rules below.`;
  } else if(closed){
    dot = "#2f7d4f"; head = "In season"; sub = `Closed ${winText(closed)}`;
  } else {
    dot = "#8b9690";
    if(hasText){ head = "Season set by the rules below"; }
    else { head = "No season on file"; sub = `Check ${regBodyFor(r)}`; }
  }

  let lic = PARK_INFO[r.region] && PARK_INFO[r.region].licence;
  const src = r.parkRegsSrc || (r.region==="yellowstone" ? "yell" : "");
  if(!lic){
    if(r.region==="yellowstone") lic = "Yellowstone park fishing permit — a state licence is <b>not</b> valid";
    else if(r.region==="grandteton" || src==="grte") lic = "<b>Wyoming</b> fishing licence (Grand Teton follows Wyoming regulations)";
    else if(r.region==="tetonvalley" || r.region==="swanvalley") lic = "<b>Idaho</b> fishing licence — Idaho Fish &amp; Game, Upper Snake Region";
    else {
      const dn = r.region==="driftless" || r.region==="northshore";
      lic = r.state==="IA" ? (r.region==="driftless" ? "<b>Iowa</b> fishing licence + trout fee for trout water" : "<b>Iowa</b> fishing licence")
          : r.state==="MN" ? "<b>Minnesota</b> fishing licence" + (dn ? " + trout stamp" : "")
          : r.state==="WI" ? "<b>Wisconsin</b> fishing licence" + (r.troutClass || r.region==="driftless" || r.region==="doorcounty" ? " + trout stamp" : "")
          : r.state==="IL" ? "<b>Illinois</b> fishing licence"
          : r.state==="ID" ? "<b>Idaho</b> fishing licence"
          : r.state==="WY" ? "<b>Wyoming</b> fishing licence"
          : `Licence: see ${regBodyFor(r)}`;
    }
  }

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
    [/gold medal/i, "Gold Medal"],
    [/must be killed/i, "Mandatory kill"],
    [/closed to (all )?(fishing|angling)/i, "Closures listed"],
  ];
  const noArt = txt.replace(/artificial (flies|lures)( (and|or) (flies|lures))? only/gi, "");   // "artificial flies only" is Artificial only, not Fly fishing only
  const tags = TAGS.filter(([re]) => re.test(re.source.startsWith("fly") ? noArt : txt)).map(t => t[1]);

  return `<div class="rulescard"><div class="rc-status"><span class="rc-dot" style="background:${dot}"></span>`+
    `<div><div class="rc-head">${head}</div>${sub ? `<div class="rc-sub">${sub}</div>` : ""}</div></div>`+
    `<div class="rc-lic">${lic}</div>`+
    accessLawHTML(r)+
    (tags.length ? `<div class="rc-tags"><span class="rc-lab">Named in this river's rules:</span>${tags.map(t=>`<span class="tierbadge" style="--tc:#5a6f66">${t.replace("&","&amp;")}</span>`).join("")}</div>` : "")+
    `</div>`;
}

function renderSheet(r){
  /* The rules come first: the card, then the full text folded under it, then
     everything else. `full` collects the verbatim regulation blocks. */
  let full = "";
  let h = tierChipHTML(r) + `<p style="margin:12px 2px 2px;font-size:13.5px">${r.blurb}</p>`;

  if(r.gauges.length){
    r.gauges.forEach(k=>{ h += flowCardHTML(k, r.id); });
  } else {
    h += noGaugeHTML(r);
  }

  h += `<div class="secthead">Fishing notes</div><div class="fishnote">🎣 ${r.fish}</div>`;

  /* Regulation class, straight from the state's own trout-stream layer.
     The special-regulation text is reproduced verbatim rather than
     paraphrased — on a catch-and-release or artificial-only stretch the
     exact wording is the thing that keeps you legal. */
  if(r.troutClass){
    const tc = TROUT_CLASS[r.troutClass];
    const src = TROUT_SOURCE[r.troutSource || "iadnr"];
    full += `<div class="secthead">Trout class &amp; regulations</div><div class="fishnote">`+
      `<span class="badge" style="background:${tc.color}">${tc.label}</span>`+
      (r.wildTrout ? ` <span style="font-size:11.5px">Wild trout present: <b>${r.wildTrout}</b></span>` : "")+
      (r.troutRegs ? `<div style="margin-top:8px"><b>Regulations:</b> ${r.troutRegs}</div>` : "")+
      `<div style="font-size:10.5px;color:var(--txt-dim);margin-top:8px">Classification and any special-regulation wording come from the ${src.agency} ${src.what}. Regulations change — confirm against the current ${src.regs} before you fish.</div>`+
      `</div>`;
  }

  /* Yellowstone's rules are the reason the park is its own region, and they
     are specific enough per river that a single park-wide note wouldn't do:
     one reach opens May 1 and another July 15, one is fly-fishing-only, and
     in the Lamar drainage releasing a rainbow alive is illegal. Wording is
     taken from the Park Service's own regulations rather than paraphrased. */
  if(r.parkRegs){
    /* Two parks, two authorities, and the difference is the single most
       useful thing on this card: Yellowstone issues its own permit and a
       state licence is void there, while Grand Teton is Wyoming water with
       a Wyoming licence. Crediting the wrong one would send someone to the
       wrong counter. The Snake, Buffalo Fork and Gros Ventre carry a Grand
       Teton note without being in that region, so the source is a field. */
    const src = r.parkRegsSrc || (r.region==="yellowstone" ? "yell" : "grte");
    const pk = PARK_INFO[src];
    const badge = pk ? pk.badge : src==="idfg" ? "Idaho Fish &amp; Game"
                : src==="grte" ? "Grand Teton · Wyoming regs" : "National Park Service";
    const note  = pk ? pk.note : src==="idfg"
      ? `From Idaho Fish &amp; Game's <b>2025–2027 Seasons &amp; Rules</b>, Upper Snake Region. Idaho re-issues the book every two years and the special-rule list changes with it — check the current one before you fish.`
      : src==="grte"
      ? `From the National Park Service's Grand Teton fishing information, which follows <b>Wyoming Game &amp; Fish</b> regulations. Seasons and closures are re-issued every year — check the current Wyoming regulations, and carry a Wyoming licence.`
      : `From the park's <b>2026</b> fishing regulations. Seasons, closures and possession limits are re-issued every year and streams close on short notice in low water — read the current edition before you fish, and carry your park permit.`;
    full += `<div class="secthead">${(pk && pk.heading) || (src==="idfg" ? "Regulations" : "Park regulations")}</div><div class="fishnote">`+
      `<span class="badge" style="background:#4a6f8a">${badge}</span> `+
      `<span style="font-size:11.5px">${r.parkRegs}</span>`+
      `<div style="font-size:10.5px;color:var(--txt-dim);margin-top:8px">${note}</div>`+
      `</div>`;
  }

  const secs = SECTIONS.filter(s=>s.river===r.id && passFilter(s));
  const allSecs = SECTIONS.filter(s=>s.river===r.id);
  if(allSecs.length){
    h += `<div class="secthead">Float sections</div>`;
    if(!secs.length) h += `<div class="fishnote">No sections match the current filters — clear a chip up top to see all ${allSecs.length}.</div>`;
    secs.forEach(s=>{ h += sectionHTML(s); });
  } else if(WADE_ONLY[r.id]) {
    h += `<div class="secthead">Floating</div><div class="fishnote">🛶 ${WADE_ONLY[r.id]}</div>`;
  }
  h += researchLinksHTML(r);
  const regBody = regBodyFor(r);
  h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Flow data: USGS Water Data OGC API${r.state==="CO"?" and Colorado Division of Water Resources":""}. River lines simplified — not for navigation. Verify regulations with ${regBody}.</p>`;
  if(r.region==="driftless"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🚶 Driftless access is mostly <b>walk-and-wade</b>, and a lot of the best water runs through <b>private land under a public angling easement</b> — you may fish and walk the stream corridor, but not leave it. Park only in the marked pull-offs, and check the state's current easement map and trout regulations (including any catch-and-release or artificial-only stretches) before you go. Iowa also requires a <b>trout fee</b> on top of a fishing license.</p>`;
  }
  if(r.region==="northshore"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🌊 North Shore streams drop fast and cold straight off the ridge — spring steelhead runs are driven by snowmelt timing more than the calendar, so check current run reports before making the drive. Most access is <b>state park or DNR wayside</b> parking (many require a vehicle permit); a Minnesota <b>trout stamp</b> is required in addition to a fishing license. The Pigeon River and Grand Portage River cross into tribal or international jurisdiction — check current Grand Portage Band and Ontario licensing before fishing those reaches.</p>`;
  }
  if(r.region==="tetonvalley" || r.region==="swanvalley"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🐟 <b>Idaho's cutthroat programme runs both these valleys.</b> On the Teton and the South Fork and their tributaries there is <b>no harvest of cutthroat trout</b> and <b>no limit at all on rainbow trout or hybrids</b> — non-native rainbows displace and interbreed with the native Yellowstone cutthroat, so the state protects one and turns the other loose. The <b>tributaries close June 1–30</b> for the spawning run while the mainstems stay open; Upper Snake water is otherwise open all year. Brook trout are limited to 25 and bull trout are catch-and-release region-wide. ${r.region==="tetonvalley" ? "The Teton Range canyons cross into <b>Wyoming</b> part-way up and a Wyoming licence is needed above the line — which is where this zone ends." : "Palisades Reservoir and its tributaries sit at the top of the valley; Big Elk Creek's drainage reaches into Wyoming."}</p>`;
  }
  if(r.region==="grandteton"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🏔 <b>Grand Teton is not Yellowstone.</b> It takes a <b>Wyoming fishing licence</b> and is fished under <b>Wyoming regulations</b>, not a park permit of its own. The rule that shapes a season here: <b>park streams are closed December 1 – July 31</b>, so most of this water opens <b>August 1</b> — the exceptions the park names are the <b>Snake, Buffalo Fork, Pacific Creek, Gros Ventre and Polecat Creek</b>. Streams are <b>artificial flies or lures only</b> apart from those same five, the stream creel is three trout with no more than one over sixteen inches, and the lakes are six trout of which at most three may be cutthroat. Lakes are open year-round except Jackson Lake, which closes October 1–31. Check the current Wyoming Game &amp; Fish regulations before you go.</p>`;
  }
  if(r.region==="yellowstone"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🏞 <b>Yellowstone runs its own fishery.</b> A <b>park fishing permit</b> is required at 16 and over and a state licence is not valid — $40 for three days, $55 for seven, $75 for the season, through Recreation.gov. The standard season is the <b>Saturday of Memorial Day weekend through October 31</b>; the Firehole, the Gibbon below the bridge and the Madison above the state line open <b>May 1</b>, and the Madison below the state line and the Gardner from Osprey Falls down are <b>open year-round</b>. Tackle is <b>lead-free artificial lures or flies only, barbless or barbs pinched</b> — no bait — and up to two flies on a leader; the Firehole, Madison and lower Gibbon are <b>fly fishing only</b>. <b>All native fish go back unharmed</b> — cutthroat, mountain whitefish, Arctic grayling. In the <b>Lamar drainage</b> every rainbow, brook trout and cutthroat/rainbow hybrid <b>must be killed</b>, as must every lake trout from Yellowstone Lake. Closures and opening dates move year to year — check the park's current fishing regulations before you go.</p>`;
  }
  if(PARK_INFO[r.region]){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">${PARK_INFO[r.region].footer}</p>`;
  }
  if(r.region==="doorcounty"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🌊 Door County has <b>no USGS gauge anywhere in the county</b> — every stream here is ungauged on purpose, and the nearest gauged water is a long way off. These creeks are small and rain-driven: judge them on the water. Almost all of them are <b>Great Lakes tributary</b> water, which carries its own season, a 10" minimum, a hook-gap limit and a <b>night-fishing closure</b> from September 15 — read the current Wisconsin regs before you go. Access is county park, state park and land-trust ground rather than DNR easement; there are no angling easements on the peninsula.</p>`;
  }
  if(r.state==="IA" && r.region!=="driftless"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">⚠ Central Iowa rivers have low-head dams — the "drowning machine" recirculating hydraulic at the base is dangerous at almost any flow. Scout unfamiliar stretches and check <a href="https://www.iowawhitewater.org/lhd/LHDrivers.html" target="_blank" rel="noopener">Iowa Whitewater's low-head dam list</a> before you put in.</p>`;
  }
  body.innerHTML = rulesCardHTML(r) +
    (full ? `<details class="rulesfull"><summary>Full regulations — tap to read</summary>${full}</details>` : "") + h;

  body.querySelectorAll("[data-zoom]").forEach(el=>el.addEventListener("click",()=>{
    const s = SECTIONS.find(x=>x.id===el.dataset.zoom);
    zoomSection(s);
  }));
  body.querySelectorAll("[data-river]").forEach(el=>el.addEventListener("click",()=>{
    openRiver(el.dataset.river);
  }));
}

function flowCardHTML(key, riverId){
  const f=flows[key], s=stats[key], st=statusOf(key), m=meta[key];
  const name = (m&&m.name) || GAUGES[key].label;
  // optional per-river "good fishing flow" range (see rivers-data.js goodFlow field)
  const riverObj = RIVERS.find(r=>r.id===riverId);
  const gf = riverObj && riverObj.goodFlow;
  const inGoodFlow = (gf && f && f.cfs!=null && key===riverObj.primaryGauge)
    ? (f.cfs>=gf.min && f.cfs<=gf.max) : null;
  const loading = !f;
  const cfsTxt = loading ? `<span class="skel">0000</span>` :
    (f.cfs==null ? "—" : Math.round(f.cfs).toLocaleString());
  const when = f&&f.time ? new Date(f.time).toLocaleString([], {month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}) : "";
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
    ${curLeft!=null?`<div class="staff"><div class="bar"></div><div class="tick" style="left:45%"></div><div class="cur" style="left:${curLeft}%"></div></div>`:""}
    <div class="flowmeta">
      ${s?`<span>median <b>${Math.round(s.median).toLocaleString()}</b></span><span>range <b>${Math.round(s.min)}–${Math.round(s.max).toLocaleString()}</b></span><span>${STAT_YEARS}-yr, ±${STAT_WINDOW}d</span>`:`<span>${loading?"loading history…":"history unavailable"}</span>`}
      ${when?`<span>read <b>${when}</b></span>`:""}
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
function noGaugeHTML(r){
  const near = nearestGaugedRiver(r);
  let proxy = "";
  if(near){
    const k = near.primaryGauge, f = flows[k], st = statusOf(k);
    const cfs = f && f.cfs!=null ? Math.round(f.cfs).toLocaleString()+" CFS" : "—";
    /* No stream-level class on Driftless water. These creeks have no gauge,
       so any "Below average / Around average" badge here is a classification
       of a *different* stream several valleys over — it reads as this creek's
       level whether or not the caption says otherwise. The raw number stays
       as a regional-wetness hint; the judgement call doesn't. */
    const showClass = r.region !== "driftless" && r.region !== "doorcounty";
    const badge = showClass
      ? ` <span class="badge" style="background:${st.color};vertical-align:middle">${st.label}</span>`
      : "";
    proxy = `<div class="plain" style="margin-top:8px">Nearest gauged water is the <b>${near.name}</b>, currently <b>${cfs}</b>${badge}.
      That's a <i>different stream</i> — treat it only as a rough read on how wet the region is, not as this creek's flow.
      <button class="zoom" data-river="${near.id}" style="margin-top:8px">Open ${near.name.split("—")[0].trim()} →</button></div>`;
  }
  /* Door County has no gauge at all — not on these creeks, not anywhere in
     the county — and nearestGaugedRiver() stays inside a region, so there is
     deliberately no proxy reading offered here. The note says so rather than
     leaving an empty card that looks like a loading failure. */
  const ungaugedNote = PARK_INFO[r.region] ? PARK_INFO[r.region].ungauged
    : (r.region==="tetonvalley" || r.region==="swanvalley")
    ? "No gauge on this creek — in these two valleys the gauges are on the mainstems, and that is the right place to look anyway. Both rivers run through irrigated valleys, so late summer flow here is as much about diversions as about snowpack, and the tributaries drop and warm well before the river does. The nearest gauged water below is the useful read; remember the <b>June 1–30 closure</b> on the tributaries as well as the level."
    : r.region==="grandteton"
    ? "Only three gauges bear on Grand Teton's own water and none of them is on this one. Several of these creeks <i>have</i> USGS site numbers — Spread, Cottonwood, Ditch, Taggart, Pilgrim, Lake Creek — and not one has reported discharge since the 1990s or 2010, so there is nothing live to show. The nearest gauged water below is the useful read: these streams share one snowpack off the same range and rise and fall together. Remember the season here as well as the level — most park streams are shut until <b>August 1</b>."
    : r.region==="yellowstone"
    ? "Nine gauges cover the park's main rivers and none of them is on this one — most Yellowstone water is backcountry and ungauged, and the app won't put a number on it that isn't measured. The nearest gauged river below is the useful read: on this plateau the whole park rises and falls together with snowmelt, so a neighbouring drainage tracks this one far more closely than it would in farm country. Runoff usually has the park high and off-colour into late June, and the backcountry streams come into shape as it drops."
    : r.region==="doorcounty"
    ? "There is <b>no USGS discharge gauge anywhere in Door County</b> — not on this creek and not on a neighbouring one — so there is no number to show and nothing close enough to borrow as a regional read. Nearly all of this water is short and rain-driven: <b>clarity and recent rain</b> are the whole story. On the Great Lakes tributaries the other half of the question is whether fish have run yet, which is driven by lake temperature and a rise in the creek, not by the calendar — a soaking rain in spring or from mid-September on is what turns them on."
    : r.region==="northshore"
    ? "Most North Shore streams are too small to gauge — there's no live number for this one, and the app doesn't invent one. Judge it on arrival: <b>clarity</b> is the thing that matters most. These are rain- and snowmelt-driven freestone streams, not spring creeks — they blow out fast after a heavy rain or a warm melt day and can take several days to clear and drop back into shape, longer than a Driftless spring creek would."
    : "Most Driftless spring creeks are too small to gauge — there's no live number for this one, and the app doesn't invent one. Judge it on arrival: <b>clarity</b> is the thing that matters most. If you can see the bottom in two feet of water it's on; chocolate-brown after a storm means give it a day or two. Spring-fed creeks clear far faster than the bigger freestone rivers, and often fish well the day after rain that has the mainstems blown out.";
  return `<div class="flowcard">
    <div class="gname">No USGS gauge on this water</div>
    <div class="flowrow"><span class="cfs">—<small> CFS</small></span>
      <span class="badge" style="background:var(--st-na)">Ungauged</span></div>
    <div class="plain">${ungaugedNote}</div>
    ${proxy}
  </div>`;
}

function sectionHTML(s){
  const est = floatEstimate(s);
  const kCls = s.klass.includes("III")?"k3":(s.klass.includes("II")?"k2":"k1");
  const put = RAMPS.find(p=>p.id===s.put), take = RAMPS.find(p=>p.id===s.take);
  return `<div class="sec">
    <div class="top"><h3>${s.name}</h3><span class="klass ${kCls}">Class ${s.klass}</span></div>
    <div class="meta">
      <span><b>${s.miles}</b> river mi</span>
      <span class="time">⏱ <b>${est.text}</b></span>
      <span class="est">${est.scaled?"estimate · scaled to today's flow":"estimate · typical flow"}</span>
    </div>
    ${s.beginner?`<span class="beg">✓ Beginner-friendly</span>`:""}
    <div class="notes">${s.notes}</div>
    <div class="notes" style="margin-top:4px"><span style="color:#1d7a46;font-weight:700">●</span> Put-in <b>${put.name}</b> &nbsp;→&nbsp; <span style="color:#8c4a1d;font-weight:700">●</span> Take-out <b>${take.name}</b></div>
    <div class="shuttle"><b>Shuttle/outfitters:</b> ${s.shuttle}</div>
    <button class="zoom" data-zoom="${s.id}">Show on map →</button>
  </div>`;
}

function zoomSection(s){
  const put = RAMPS.find(p=>p.id===s.put), take = RAMPS.find(p=>p.id===s.take);
  // zooming to a float is an explicit "show me the ramps" gesture, so switch
  // the boat-ramp layer on even though it's off by default
  if(!map.hasLayer(rampLayer)) rampLayer.addTo(map);
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
  if(filters.cls==="1" && s.klass!=="I") return false;
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
function applyFilters(){
  RIVERS.forEach(r=>{
    const L_ = riverLayers[r.id];
    if(!tierShown(r)){                       // hidden by class: off the map, not dimmed
      if(map.hasLayer(L_.line)) map.removeLayer(L_.line);
      if(map.hasLayer(L_.lbl))  map.removeLayer(L_.lbl);
      return;
    }
    if(!map.hasLayer(L_.line)) L_.line.addTo(map);
    if(!map.hasLayer(L_.lbl))  L_.lbl.addTo(map);
    const on = riverVisible(r);
    L_.line.setStyle({color:on?riverColor(r):"#9aa49b", opacity:on?0.92:0.35, weight:on?tierWeight(r):3});
  });
  syncGaugeDots(); syncLabels(); syncFlow(); refreshZoneCounts();
  syncMarkers();
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
}
/* Does this access point survive the current filter chips? Visibility also
   depends on zoom and on whether its group is switched on — see syncMarkers. */
function rampPassesFilter(p){
  if(filters.act==="float" && p.role==="wade") return false;
  if((filters.beg||filters.dur||filters.cls) && p.role!=="wade"){
    return SECTIONS.some(s=>(s.put===p.id||s.take===p.id) && passFilter(s));
  }
  return true;
}

/* Chip toolbar removed from index.html for now. filters{} stays at its
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

/* ---------- Field Book: river panel row ----------
   The favourite / fished / notes controls live in #fbrow, a sibling that sits
   just above #sheetbody, NOT inside it. renderSheet() rewrites #sheetbody's
   innerHTML every time stats load or a filter changes; a textarea in there
   would lose its focus and caret mid-sentence. Outside it, nothing re-renders
   it: fbShowRow() rebuilds it only when the river changes (or after an
   import), and the buttons update themselves in place. */
let fbRowFor = null;
const fbEsc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function fbToday(){ const d = new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function fbDateText(iso){
  const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(iso||""); if(!m) return "";
  return new Date(+m[1], +m[2]-1, +m[3]).toLocaleDateString([], {month:"short", day:"numeric"});
}
function fbRowHTML(e){
  return `<button type="button" class="fb-btn fb-fav${e.fav?" on":""}" aria-pressed="${e.fav}">${e.fav?"★":"☆"} Favourite</button>`+
    `<button type="button" class="fb-btn fb-fished${e.fished?" on":""}" aria-pressed="${e.fished}">✓ ${e.fished && e.fishedOn ? "Fished · "+fbDateText(e.fishedOn) : "Fished"}</button>`+
    `<button type="button" class="fb-btn fb-notes${(e.notes||"").trim()?" has":""}" aria-expanded="false">Notes</button>`+
    `<div class="fb-ta"><textarea rows="3" maxlength="20000" placeholder="Flies that worked, where you parked, water clarity…" aria-label="Notes for this river"></textarea>`+
    `<span class="fb-saved" aria-live="polite"></span></div>`;
}
function fbShowRow(r, force){
  const row = $("#fbrow");
  if(!force && fbRowFor === r.id) return;
  fbRowFor = r.id;
  const id = r.id, e = fbGet(id);
  row.innerHTML = fbRowHTML(e);
  const favB = row.querySelector(".fb-fav"), fishB = row.querySelector(".fb-fished"),
        notesB = row.querySelector(".fb-notes"), box = row.querySelector(".fb-ta"),
        ta = row.querySelector("textarea"), saved = row.querySelector(".fb-saved");
  ta.value = e.notes || "";
  const openNotes = on => { box.classList.toggle("show", on); notesB.setAttribute("aria-expanded", on); };
  openNotes(!!(e.notes||"").trim());
  const paint = () => {
    const c = fbGet(id);
    favB.classList.toggle("on", c.fav); favB.setAttribute("aria-pressed", c.fav);
    favB.textContent = (c.fav ? "★" : "☆") + " Favourite";
    fishB.classList.toggle("on", c.fished); fishB.setAttribute("aria-pressed", c.fished);
    fishB.textContent = "✓ " + (c.fished && c.fishedOn ? "Fished · "+fbDateText(c.fishedOn) : "Fished");
  };
  favB.addEventListener("click", () => {
    fbSet(id, {fav:!fbGet(id).fav}); paint();
    applyFilters();                        // a favourite stays on the map whatever the class filter says
  });
  fishB.addEventListener("click", () => {
    const on = !fbGet(id).fished;
    fbSet(id, {fished:on, fishedOn:on ? fbToday() : null}); paint();
  });
  notesB.addEventListener("click", () => {
    const on = !box.classList.contains("show");
    openNotes(on); if(on) ta.focus();
  });
  let t = null;
  ta.addEventListener("input", () => {
    saved.textContent = "";
    clearTimeout(t);
    t = setTimeout(() => {
      fbSet(id, {notes:ta.value});
      notesB.classList.toggle("has", !!ta.value.trim());
      saved.textContent = "Saved";
      setTimeout(() => { if(saved.textContent==="Saved") saved.textContent = ""; }, 1600);
    }, 400);
  });
}

/* ---------- Field Book: research links ----------
   Plain outbound searches built from the river's name. Nothing is fetched. */
function fbCleanName(r){ return r.name.split("—")[0].split("(")[0].trim(); }
function researchLinksHTML(r, bare){
  const n = fbCleanName(r), st = riverStateName(r), q = encodeURIComponent;
  const links = [
    ["Reddit — posts about this river", "https://www.reddit.com/search/?q="+q(`"${n}" ${st} fishing`)],
    ["r/flyfishing — this river", "https://www.reddit.com/r/flyfishing/search/?restrict_sr=1&q="+q(n)],
    ["Current fishing report (web search)", "https://www.google.com/search?q="+q(`${n} ${st} fishing report`)],
  ];
  const list = `<div class="fb-links">${links.map(([t,u]) => `<a href="${fbEsc(u)}" target="_blank" rel="noopener">${t} ↗</a>`).join("")}</div>`;
  if(bare) return list;
  return `<div class="secthead">Research</div>${list}<p class="fb-note">Links open outside the app; posts belong to their authors.</p>`;
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

function bookRowsHTML(ids, fishedTab){
  return ids.map(id => {
    const r = RIVERS.find(x => x.id===id); if(!r) return "";
    const e = fbGet(id), k = r.primaryGauge;
    // Live status chip only when a reading has actually loaded — same
    // statusOf() the flow card uses, so the colours are the gauge's own.
    const st = k && flows[k] && flows[k].cfs!=null ? statusOf(k) : null;
    const note = (e.notes||"").trim();
    return `<button type="button" class="bk-row" data-fbopen="${fbEsc(id)}">`+
      `<span class="bk-main"><span class="bk-name">${fbEsc(r.name)}</span>`+
      `<span class="bk-place">${fbEsc(riverPlace(r))}</span>`+
      (fishedTab && e.fishedOn ? `<span class="bk-fished">Fished · ${fbEsc(fbDateText(e.fishedOn))}</span>` : "")+
      (note ? `<span class="bk-snip">${fbEsc(note.length>90 ? note.slice(0,90).trim()+"…" : note)}</span>` : "")+
      `</span>`+
      (st ? `<span class="badge" style="background:${st.color}">${st.label}</span>` : "")+
      `</button>`;
  }).join("");
}
const fbIdsWhere = fn => Object.keys(fbAll()).filter(id => RIVERS.some(r => r.id===id) && fn(fbAll()[id]));
const fbByName = ids => ids.sort((a,b) => RIVERS.find(r=>r.id===a).name.localeCompare(RIVERS.find(r=>r.id===b).name));
const fbEmpty = t => `<div class="bk-empty">${t}</div>`;

/* Add a section here to add a tab. render(el) fills the panel; the shell owns
   the tab bar, remembers the last tab, and makes any [data-fbopen] inside
   it fly to that river. */
const BOOK_SECTIONS = [
  {id:"fav", label:"Favourites", render(el){
    const ids = fbByName(fbIdsWhere(e => e.fav));
    el.innerHTML = ids.length ? bookRowsHTML(ids) : fbEmpty("No favourites yet.<br>Tap <b>☆ Favourite</b> on any river to keep it here — and on the map, whatever the class filter says.");
  }},
  {id:"fished", label:"Fished", render(el){
    const ids = fbIdsWhere(e => e.fished).sort((a,b) => (fbGet(b).fishedOn||"").localeCompare(fbGet(a).fishedOn||""));
    el.innerHTML = ids.length ? bookRowsHTML(ids, true) : fbEmpty("Nothing logged yet.<br>Tap <b>✓ Fished</b> on a river after you've been, and it lands here with the date.");
  }},
  {id:"notes", label:"Notes", render(el){
    const ids = fbIdsWhere(e => (e.notes||"").trim()).sort((a,b) => fbGet(b).updated - fbGet(a).updated);
    el.innerHTML = ids.length ? ids.map(id => {
      const r = RIVERS.find(x => x.id===id);
      return `<button type="button" class="bk-row" data-fbopen="${fbEsc(id)}"><span class="bk-main">`+
        `<span class="bk-name">${fbEsc(r.name)}</span><span class="bk-place">${fbEsc(riverPlace(r))}</span>`+
        `<span class="bk-full">${fbEsc(fbGet(id).notes.trim())}</span></span></button>`;
    }).join("") : fbEmpty("No notes yet.<br>Tap <b>Notes</b> on any river to jot down flies, parking and water clarity.");
  }},
  {id:"research", label:"Research", render(el){
    const ids = fbByName(fbIdsWhere(e => e.fav));
    let h = `<p class="bk-intro">Research for your favourite rivers — more research tools will appear here.</p>`;
    h += ids.length ? ids.map(id => {
      const r = RIVERS.find(x => x.id===id);
      return `<div class="bk-res"><button type="button" class="bk-name" data-fbopen="${fbEsc(id)}">${fbEsc(r.name)}</button>${researchLinksHTML(r, true)}</div>`;
    }).join("") + `<p class="fb-note">Links open outside the app; posts belong to their authors.</p>`
      : fbEmpty("Favourite a river to get research links for it here.<br>Tap <b>☆ Favourite</b> on any river.");
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
  $("#book-tabs").innerHTML = BOOK_SECTIONS.map(s => `<button type="button" role="tab" data-tab="${s.id}">${s.label}</button>`).join("");
  $("#book-msg").textContent = "";
  showBookTab(bookTab);
  bookEl.classList.add("show");
}
function closeBook(){ bookEl.classList.remove("show"); }
$("#btn-book").addEventListener("click", openBook);
$("#book-x").addEventListener("click", closeBook);
window.addEventListener("keydown", e => { if(e.key==="Escape" && bookEl.classList.contains("show")) closeBook(); });
$("#book-tabs").addEventListener("click", e => { const b = e.target.closest("button[data-tab]"); if(b) showBookTab(b.dataset.tab); });
bookBody.addEventListener("click", e => {
  const b = e.target.closest("[data-fbopen]"); if(!b) return;
  const r = RIVERS.find(x => x.id===b.dataset.fbopen); if(!r) return;
  closeBook();
  hideZones();                               // no-op unless the region chooser is up
  const pts = flatCoords(r.coords);
  if(pts.length) goTo(L.latLngBounds(pts).pad(0.1));
  openRiver(r.id);
});

/* Export / import. Import is a merge, never a replace: per river the newer
   `updated` wins, so restoring an old backup can't wipe newer notes. The
   file is untrusted input — shape-checked and each entry rebuilt field by
   field, and rivers this build doesn't know are skipped. */
$("#book-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(fbState, null, 2)], {type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = `field-book-${fbToday()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$("#book-import").addEventListener("click", () => $("#book-file").click());
$("#book-file").addEventListener("change", async ev => {
  const f = ev.target.files[0]; ev.target.value = "";
  if(!f) return;
  const msg = $("#book-msg");
  try{
    const d = JSON.parse(await f.text());
    if(!d || d.v!==1 || !d.rivers || typeof d.rivers!=="object" || Array.isArray(d.rivers)) throw 0;
    let n = 0;
    for(const [id, e] of Object.entries(d.rivers)){
      if(!e || typeof e!=="object" || !RIVERS.some(r => r.id===id)) continue;
      const inc = {
        fav: e.fav===true, fished: e.fished===true,
        fishedOn: e.fished===true && /^\d{4}-\d\d-\d\d$/.test(e.fishedOn||"") ? e.fishedOn : null,
        notes: typeof e.notes==="string" ? e.notes.slice(0,20000) : "",
        updated: Number.isFinite(e.updated) ? e.updated : 0,
      };
      if(!inc.fav && !inc.fished && !inc.notes.trim()) continue;
      if(inc.updated > fbGet(id).updated){ fbState.rivers[id] = inc; n++; }
    }
    fbPersist(); applyFilters();
    if(curRiver){ const r = RIVERS.find(x => x.id===curRiver); if(r) fbShowRow(r, true); }
    showBookTab(bookTab);
    msg.textContent = n ? `Imported ${n} river${n===1?"":"s"}.` : "Nothing newer to import.";
  }catch(e){ msg.textContent = "That file isn't a Field Book export."; }
});

/* ---------- refresh loop ----------
   Ordered by region, nearest first. The region you're looking at is fetched
   and painted before anything else, then the rest fill in behind it. With
   batching that's ~4 requests for every latest value on the map instead of
   170, so a refresh comfortably fits the API's hourly budget. */
function regionsByDistance(){
  const c = map.getCenter();
  const score = reg => {
    const pts = gaugesInRegion(reg).map(k=>GAUGE_POS[k]).filter(Boolean);
    if(!pts.length) return Infinity;
    return Math.min(...pts.map(p=>Math.hypot(p[0]-c.lat, (p[1]-c.lng)*0.73)));
  };
  return REGION_KEYS.slice().sort((a,b)=>score(a)-score(b));
}
function paintFlows(){
  const anyLive = Object.values(flows).some(f=>f && !f.stale);
  const anyData = Object.values(flows).some(f=>f && f.cfs!=null);
  $("#netpill").classList.toggle("show", !anyLive && anyData);
  $("#updwhen").textContent = anyLive ? new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
    : (anyData ? "cached" : "unavailable");
  repaintGauges();
  if(typeof syncFlow === "function") syncFlow();   // speeds follow the new readings
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
}
async function refreshAll(manual){
  const btn=$("#btn-refresh"); btn.classList.add("spin");
  for(const reg of regionsByDistance()){
    for(const group of chunk(gaugesInRegion(reg), MAX_SITES_LATEST)){
      await fetchLatestBatch(group);
    }
    paintFlows();          // nearest region shows up without waiting for the rest
  }
  btn.classList.remove("spin");

  // Historical medians backfill the same way — region by region, nearest
  // first — so status badges upgrade from a bare CFS reading to a real
  // comparison. 56 requests for the whole map rather than ~1,190.
  if(!refreshAll.statsKicked){
    refreshAll.statsKicked = true;
    (async()=>{
      for(const reg of regionsByDistance()){
        await fetchStatsBatch(gaugesInRegion(reg));
        paintFlows();
        await new Promise(r=>setTimeout(r, 400));
      }
      verifyGaugesBatch(Object.keys(GAUGES)).then(()=>{
        if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
      });
    })();
  }
}
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
   flies there and dismisses the picker; the Regions button brings it back.
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
  const v = pendingView; pendingView = null; goTo(v.target, v.zoom);
});
function goTo(target, zoom){
  const s = map.getSize();
  if(!s.x || !s.y){
    // A zero-size container doesn't only break the animation: fitBounds
    // derives its zoom from the container too, and with no width the
    // answer is the whole world. That is how the opening chooser once
    // landed on a zoom-0 view of the globe with every zone a few pixels
    // wide. Hold the move until the map has real dimensions.
    pendingView = {target, zoom};
    setTimeout(() => {
      if(pendingView && map.getSize().x){
        const v = pendingView; pendingView = null; goTo(v.target, v.zoom);
      }
    }, 200);
    return;
  }
  if(target instanceof L.LatLngBounds){
    if(canAnimate()) map.flyToBounds(target, {duration:0.9});
    else map.fitBounds(target, {animate:false});
  } else {
    if(canAnimate()) map.flyTo(target, zoom, {duration:0.7});
    else map.setView(target, zoom, {animate:false});
  }
}

const zoneCards = [];   // {zone, marker, poly}

function enterZone(z){
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

function showZones(){
  if(zonesShown) return;
  zonesShown = true;
  zoneLayer.addTo(map);
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
  // strip of slivers. Pan up to it, or take it from "Jump to region".
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
  syncRegionLabels();
  if(typeof syncFlow === "function") syncFlow();
  if(typeof syncLakes === "function") syncLakes();
  if(typeof syncClosures === "function") syncClosures();
}

buildZones();
showZones();
syncRegionLabels();
syncFlow();
syncLakes();
syncClosures();

/* Regions button — always available, so you can get back to the chooser
   without hunting for the right zoom level. Top *left*, under the app bar
   (the zoom +/− now lives bottom-right): top-right is taken by the layer control and sheet, and the
   Regions button is the one control that gets you back out. */
const zoneCtl = L.control({position:"topleft"});
zoneCtl.onAdd = function(){
  const d = L.DomUtil.create("div");
  d.innerHTML = `<button id="btn-zones" title="Back to region chooser">◄ Regions</button>`;
  L.DomEvent.disableClickPropagation(d);
  d.querySelector("button").addEventListener("click", ()=>{
    if(zonesShown) hideZones(); else showZones();
  });
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
const TIER_LABEL = {gold:"Gold rivers", "1":"Class 1 rivers", "2":"Class 2 rivers", "3":"All other rivers (Class 3)"};
let refreshMenuCounts = () => {};      // set by tierCtl once its buttons exist
function syncTierChips(){
  TIER_KEYS.forEach(k => {
    const b = document.querySelector('#tierchips [data-tier="'+k+'"]');
    if(b) b.classList.toggle("on", !!tierFilter[k]);
  });
  refreshMenuCounts();
}
TIER_KEYS.forEach(k => {
  const g = tierGroups[k] = L.layerGroup();
  const set = on => {
    if(tierFilter[k] === on) return;
    tierFilter[k] = on;
    tempShown.clear();
    try{ localStorage.setItem("tierFilter", JSON.stringify(tierFilter)); }catch(e){}
    syncTierChips(); applyFilters();
  };
  g.on("add", ()=>set(true));
  g.on("remove", ()=>set(false));
  layerControl.addOverlay(g, `<span class="tier-sw" style="background:${TIER_INFO[k].color}"></span>${TIER_LABEL[k]}`);
});
/* Map-layer chips beside the class chips: the same layer groups the layer
   control drives, so ticking either one stays in sync via add/remove events.
   A new map layer (e.g. the planned bridge access points) is one more row in
   this table. */
const LAYER_CHIPS = [
  ["ramps",  "Boat ramps",   rampLayer,    "#e07b1a"],
  ["wade",   "Wade access",  wadeLayer,    "#5b6e3a"],
  ["gauges", "Gauges",       gaugeLayer,   "#2b7fb8"],
  ["closed", "Closed water", closureLayer, "#c0392b"],
  ["land",   "Public land",  publicLand,   "#3f8f4f"],
];
/* The chips live in two collapsed menus ("Rivers", "Map layers") rather than
   two always-open columns, which covered a lot of a phone-sized map. Only one
   panel is open at a time; a map tap or Escape closes it. Always starts
   collapsed — nothing is remembered. */
const tierCtl = L.control({position:"topleft"});
tierCtl.onAdd = function(){
  const d = L.DomUtil.create("div");
  d.id = "chipbar";
  d.innerHTML =
    `<button type="button" class="menubtn" data-menu="tierchips" aria-expanded="false" aria-controls="tierchips">`+
      `<span class="mlabel">Rivers</span> <span class="mcount"></span><span class="mcaret" aria-hidden="true">\u25BE</span></button>`+
    `<div id="tierchips" class="chipcol menupanel" role="group" aria-label="River classes shown" hidden>`+
    TIER_KEYS.map(k =>
      `<button data-tier="${k}" class="${tierFilter[k]?"on":""}" aria-pressed="${!!tierFilter[k]}" style="--tc:${TIER_INFO[k].color}">`+
      `${k==="3" ? "All" : k==="gold" ? "Gold" : "Class "+k}</button>`).join("")+
    `</div>`+
    `<button type="button" class="menubtn" data-menu="layerchips" aria-expanded="false" aria-controls="layerchips">`+
      `<span class="mlabel">Map layers</span> <span class="mcount"></span><span class="mcaret" aria-hidden="true">\u25BE</span></button>`+
    `<div id="layerchips" class="chipcol menupanel" role="group" aria-label="Map markers shown" hidden>`+
    LAYER_CHIPS.map(([id,label,g,c]) =>
      `<button data-layer="${id}" class="${map.hasLayer(g)?"on":""}" aria-pressed="${map.hasLayer(g)}" style="--tc:${c}">${label}</button>`).join("")+
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
      m.setAttribute("aria-expanded", "true");
      d.querySelector("#"+m.dataset.menu).hidden = false;
    }
  }));
  map.on("click", closeMenus);
  document.addEventListener("keydown", e => { if(e.key === "Escape") closeMenus(); });
  // Labels carry a count so a closed menu still says what is on the map.
  refreshMenuCounts = () => {
    const nt = TIER_KEYS.filter(k => tierFilter[k]).length;
    const nl = LAYER_CHIPS.filter(([,,g]) => map.hasLayer(g)).length;
    menus[0].querySelector(".mcount").textContent = "\u00B7 " + nt;
    menus[1].querySelector(".mcount").textContent = "\u00B7 " + nl;
  };
  d.querySelectorAll("[data-tier]").forEach(b => b.addEventListener("click", ()=>{
    const g = tierGroups[b.dataset.tier];
    if(map.hasLayer(g)) map.removeLayer(g); else map.addLayer(g);
    b.setAttribute("aria-pressed", String(!!tierFilter[b.dataset.tier]));
  }));
  LAYER_CHIPS.forEach(([id,,g]) => {
    const b = d.querySelector('[data-layer="'+id+'"]');
    const sync = () => { b.classList.toggle("on", map.hasLayer(g)); b.setAttribute("aria-pressed", String(map.hasLayer(g))); refreshMenuCounts(); };
    g.on("add remove", sync);
    b.addEventListener("click", ()=>{ if(map.hasLayer(g)) map.removeLayer(g); else map.addLayer(g); });
  });
  refreshMenuCounts();
  return d;
};
tierCtl.addTo(map);
TIER_KEYS.forEach(k => { if(tierFilter[k]) tierGroups[k].addTo(map); });
refreshMenuCounts();

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

   The position is never stored or sent anywhere: it lives in this closure
   for as long as the dot is drawn, not in localStorage, not in a URL, and
   not in anything the analytics script can see. */
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
  <p>See your position on the map while you drive and fish. Your location stays on this phone \u2014 it\u2019s never saved or sent anywhere.</p>
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
  const boot = () => setTimeout(() => {
    if(locPerm === "denied" || locState !== "off") return;
    const pref = locPrefGet();
    if(pref === "on") locStart("located");
    else if(pref === null) locAsk.classList.add("show");
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
                grte: r => r.region==="grandteton" || ["snake","buffalofork","grosventre"].includes(r.id)};
  Object.entries(PARK_INFO).forEach(([reg, p]) => { sets[p.zone] = r => r.region === reg; });
  document.querySelectorAll(".zone-card .zc-count[data-zone]").forEach(el => {
    const f = sets[el.dataset.zone]; if(!f) return;
    const all = RIVERS.filter(f), shown = all.filter(tierShown).length;
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
