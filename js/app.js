/* ============================================================
   USGS WATER DATA — modernized OGC API (api.waterdata.usgs.gov)
   - latest-continuous : current discharge (00060)
   - daily             : historical daily means -> day-of-year median
   - monitoring-locations : runtime verification of gauge IDs
   Legacy waterservices.usgs.gov is NOT used (being decommissioned).
   The API sends CORS headers for browser use; if your network
   blocks it, point API_BASE at a lightweight same-origin proxy.
   ============================================================ */
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
function regionOfRiver(r){
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
  const need = [];
  keys.forEach(k=>{
    if(meta[k]) return;
    const c = store.get("meta:"+GAUGES[k].site);
    if(c) meta[k] = c; else need.push(k);
  });
  if(!need.length) return;
  for(const group of chunk(need, batchSupported ? MAX_SITES_LATEST : 1)){
    if(apiPaused()) break;
    const url = apiURL("monitoring-locations/items", {
      monitoring_location_id: group.map(siteOf).join(","),
      limit: String(group.length + 5)
    });
    try{
      const j = await fetchJSON(url, 20000);
      (j.features||[]).forEach(f=>{
        const p = f.properties || {};
        const k = KEY_BY_SITE[p.monitoring_location_id];
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
const map = L.map("map",{zoomControl:true, attributionControl:true})
  .setView([44.30,-112.90], 6);

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

/* river labels only at regional zoom — 100+ labels at statewide zoom is
   soup. The Driftless streams sit almost on top of each other, so they
   need a tighter zoom than the big western rivers before labels help. */
function syncLabels(){
  const z = map.getZoom();
  Object.values(riverLayers).forEach(l => {
    const min = l.river && (l.river.region === "driftless" || l.river.region === "northshore") ? 10 : 8;
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

const riverLayers = {}, rampMarkers = {}, gaugeDots = {};
let highlight = null;

RIVERS.forEach(r=>{
  const line = L.polyline(r.coords,{color:r.color, weight:4.5, opacity:.92,
    lineCap:"round", lineJoin:"round", smoothFactor:1.2, pane:"riversPane"}).addTo(map);
  line.on("click",()=>openRiver(r.id));
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
        lyr.bindPopup(
          `<b>${p.Unit_Nm || c.label}</b><br>`+
          `<span style="font-size:11px">`+
          `<span style="color:${c.color};font-weight:700">${c.label}</span> · ${open}<br>`+
          `${[p.DesTp_Desc, p.MngNm_Desc, acres].filter(Boolean).join(" · ")}<br>`+
          `<i>PAD-US boundaries are approximate — check the state's current maps and the signage at the parcel.</i></span>`);
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
function nhdURL(where, bb){
  return `${NHD_URL}?where=${encodeURIComponent(where)}&geometry=${bb.join(",")}`+
    `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`+
    `&outFields=GNIS_NAME&returnGeometry=true&outSR=4326`+
    `&maxAllowableOffset=0.0006&geometryPrecision=5&resultRecordCount=4000&f=geojson`;
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

async function openRiver(id, focusGauge){
  const r = RIVERS.find(x=>x.id===id); if(!r) return;
  curRiver = id;
  $("#sw").style.background = r.color;
  $("#sh-title").textContent = r.name;
  const stateName = {ID:"Idaho", WY:"Wyoming", IA:"Iowa", MN:"Minnesota", WI:"Wisconsin", IL:"Illinois"}[r.state] || r.state;
  $("#sh-sub").textContent = r.region==="driftless" ? stateName+" · Driftless Area" : r.region==="northshore" ? stateName+" · North Shore" : stateName;
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

function renderSheet(r){
  let h = `<p style="margin:12px 2px 2px;font-size:13.5px">${r.blurb}</p>`;

  if(r.gauges.length){
    r.gauges.forEach(k=>{ h += flowCardHTML(k, r.id); });
  } else {
    h += noGaugeHTML(r);
  }

  h += `<div class="secthead">Fishing notes</div><div class="fishnote">🎣 ${r.fish}</div>`;

  const secs = SECTIONS.filter(s=>s.river===r.id && passFilter(s));
  const allSecs = SECTIONS.filter(s=>s.river===r.id);
  if(allSecs.length){
    h += `<div class="secthead">Float sections</div>`;
    if(!secs.length) h += `<div class="fishnote">No sections match the current filters — clear a chip up top to see all ${allSecs.length}.</div>`;
    secs.forEach(s=>{ h += sectionHTML(s); });
  } else if(WADE_ONLY[r.id]) {
    h += `<div class="secthead">Floating</div><div class="fishnote">🛶 ${WADE_ONLY[r.id]}</div>`;
  }
  const regBody = {IA:"the Iowa DNR", MN:"the Minnesota DNR", WI:"the Wisconsin DNR", IL:"the Illinois DNR"}[r.state]
    || "WY Game &amp; Fish / Idaho Fish &amp; Game";
  h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Flow data: USGS Water Data OGC API. River lines simplified — not for navigation. Verify regulations with ${regBody}.</p>`;
  if(r.region==="driftless"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🚶 Driftless access is mostly <b>walk-and-wade</b>, and a lot of the best water runs through <b>private land under a public angling easement</b> — you may fish and walk the stream corridor, but not leave it. Park only in the marked pull-offs, and check the state's current easement map and trout regulations (including any catch-and-release or artificial-only stretches) before you go. Iowa also requires a <b>trout fee</b> on top of a fishing license.</p>`;
  }
  if(r.region==="northshore"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🌊 North Shore streams drop fast and cold straight off the ridge — spring steelhead runs are driven by snowmelt timing more than the calendar, so check current run reports before making the drive. Most access is <b>state park or DNR wayside</b> parking (many require a vehicle permit); a Minnesota <b>trout stamp</b> is required in addition to a fishing license. The Pigeon River and Grand Portage River cross into tribal or international jurisdiction — check current Grand Portage Band and Ontario licensing before fishing those reaches.</p>`;
  }
  if(r.state==="IA" && r.region!=="driftless"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">⚠ Central Iowa rivers have low-head dams — the "drowning machine" recirculating hydraulic at the base is dangerous at almost any flow. Scout unfamiliar stretches and check <a href="https://www.iowawhitewater.org/lhd/LHDrivers.html" target="_blank" rel="noopener">Iowa Whitewater's low-head dam list</a> before you put in.</p>`;
  }
  body.innerHTML = h;

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
    <div class="gname">${name}${m&&m.verified===false?' <span title="Could not verify this site ID against USGS metadata">(unverified)</span>':''}</div>
    <div class="flowrow">
      <span class="cfs">${cfsTxt}<small> CFS</small></span>
      <span class="badge" style="background:${st.color}">${st.label}</span>
    </div>
    ${curLeft!=null?`<div class="staff"><div class="bar"></div><div class="tick" style="left:45%"></div><div class="cur" style="left:${curLeft}%"></div></div>`:""}
    <div class="flowmeta">
      ${s?`<span>median <b>${Math.round(s.median).toLocaleString()}</b></span><span>range <b>${Math.round(s.min)}–${Math.round(s.max).toLocaleString()}</b></span><span>${STAT_YEARS}-yr, ±${STAT_WINDOW}d</span>`:`<span>${loading?"loading history…":"history unavailable"}</span>`}
      ${when?`<span>read <b>${when}</b></span>`:""}
    </div>
    <div class="plain">${plainLanguage(key, riverId)}</div>
    ${inGoodFlow!=null?`<div class="goodflow ${inGoodFlow?'in':'out'}">${inGoodFlow?'✓ In your good-flow range':'Outside your good-flow range'} (${gf.min}–${gf.max} CFS)</div>`:""}
    ${f&&f.stale?`<div class="stale">⚠ Couldn't reach USGS — showing the last saved reading${f.fetchedAt?` from ${new Date(f.fetchedAt).toLocaleString([],{month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})}`:""}. Cell service is patchy in these canyons; treat as out-of-date.</div>`:""}
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
    const showClass = r.region !== "driftless";
    const badge = showClass
      ? ` <span class="badge" style="background:${st.color};vertical-align:middle">${st.label}</span>`
      : "";
    proxy = `<div class="plain" style="margin-top:8px">Nearest gauged water is the <b>${near.name}</b>, currently <b>${cfs}</b>${badge}.
      That's a <i>different stream</i> — treat it only as a rough read on how wet the region is, not as this creek's flow.
      <button class="zoom" data-river="${near.id}" style="margin-top:8px">Open ${near.name.split("—")[0].trim()} →</button></div>`;
  }
  const ungaugedNote = r.region==="northshore"
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
    const on = riverVisible(r);
    riverLayers[r.id].line.setStyle({color:on?r.color:"#9aa49b", opacity:on?0.9:0.35, weight:on?5:3});
  });
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

document.querySelectorAll(".chip").forEach(ch=>{
  ch.addEventListener("click",()=>{
    const f=ch.dataset.f, v=ch.dataset.v;
    if(f==="act"){
      document.querySelectorAll('.chip[data-f="act"]').forEach(c=>c.classList.remove("on"));
      ch.classList.add("on"); filters.act=v;
    } else {
      const on = ch.classList.toggle("on");
      if(f==="beg") filters.beg=on;
      if(f==="cls") filters.cls=on?v:null;
      if(f==="dur"){
        document.querySelectorAll('.chip[data-f="dur"]').forEach(c=>{ if(c!==ch)c.classList.remove("on"); });
        filters.dur=on?v:null;
      }
    }
    applyFilters();
  });
});

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

/* ---------- legend / safety ---------- */
const scrim=$("#scrim"), legend=$("#legend");
$("#btn-legend").addEventListener("click",()=>{scrim.classList.add("show");legend.classList.add("show");});
$("#legend-x").addEventListener("click",closeLegend);
scrim.addEventListener("click",closeLegend);
function closeLegend(){scrim.classList.remove("show");legend.classList.remove("show");}
$("#safety-x").addEventListener("click",()=>{ $("#safety").style.display="none"; store.set("safetyDismissed", Date.now()); });
if(store.get("safetyDismissed")) $("#safety").style.display="none";

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
syncMarkers();          // seed marker groups for the starting zoom
loadPublicLand();
setTimeout(trickleGeometry, 600);

