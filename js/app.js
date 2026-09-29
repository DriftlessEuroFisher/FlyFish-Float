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
const map = L.map("map",{zoomControl:true, attributionControl:true})
  .setView([43.6,-100.5], 4);        // whole-country view; the zone picker opens over it

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
  poly.on("click", () => openLake(k.id));
  poly.bindTooltip(`<b>${k.name}</b>`, {direction:"top", className:"zone-tip"});
  const mark = L.marker(k.at, {pane:"lakePane", riseOnHover:true,
    icon:L.divIcon({className:"", iconSize:null,
      html:`<div class="lake-label"><span>${k.short}</span></div>`})}).addTo(lakeLayer);
  mark.on("click", () => openLake(k.id));
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
  $("#sh-sub").textContent = "Wyoming · Yellowstone National Park · lake";
  sheet.classList.add("open");
  body.innerHTML =
    `<p style="margin:12px 2px 2px;font-size:13.5px">${k.blurb}</p>` +
    `<div class="flowcard"><div class="gname">Still water — ${k.areaKm2} km²</div>` +
    `<div class="plain">No gauge and no flow number: a lake doesn't have one. What "in shape" means here is ice-off, water temperature and wind, not CFS — and on the big lakes the wind is the thing that decides the day.</div></div>` +
    `<div class="secthead">Fishing notes</div><div class="fishnote">🎣 ${k.fish}</div>` +
    `<div class="secthead">Park regulations</div><div class="fishnote">` +
      `<span class="badge" style="background:#4a6f8a">National Park Service</span> ` +
      `<span style="font-size:11.5px">${k.regs}</span>` +
      `<div style="font-size:10.5px;color:var(--txt-dim);margin-top:8px">From the park's <b>2026</b> fishing regulations. A park permit is required at 16 and over and a state licence is not valid; tackle is lead-free artificial lures or flies, barbless. Attractors such as dodgers and lake trolls may be used <b>in lakes only</b>. Re-issued every year — read the current edition before you fish.</div>` +
    `</div>` +
    `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Lake outlines: USGS NHD waterbodies. Verify regulations with the National Park Service (a state fishing licence is <b>not</b> valid in the park).</p>`;
}

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
    const min = (l.river && l.river.minor) ? 12
              : (reg === "driftless" || reg === "northshore" || reg === "doorcounty"
                 || reg === "tetonvalley" || reg === "swanvalley") ? 10
              : (reg === "yellowstone" || reg === "grandteton") ? 9 : 8;
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

const riverLayers = {}, rampMarkers = {}, gaugeDots = {};
let highlight = null;

RIVERS.forEach(r=>{
  const line = L.polyline(r.coords,{color:riverColor(r), weight:4.5, opacity:.92,
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
async function refineRiver(r){
  const layer = riverLayers[r.id];
  if(!layer || layer.refined || layer.refining) return;
  if(r.geom === "iadnr" || r.geom === "widnr"){ layer.refined = true; return; }
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
    let segs = nhdSegments(await fetchJSON(nhdURL(`UPPER(GNIS_NAME) = '${kw}'`, bb, NHD_FINE), REFINE_TIMEOUT));
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

async function openRiver(id, focusGauge){
  const r = RIVERS.find(x=>x.id===id); if(!r) return;
  curRiver = id;
  $("#sw").style.background = riverColor(r);
  $("#sh-title").textContent = r.name;
  const stateName = {ID:"Idaho", WY:"Wyoming", IA:"Iowa", MN:"Minnesota", WI:"Wisconsin", IL:"Illinois"}[r.state] || r.state;
  const subRegion = {driftless:" · Driftless Area", northshore:" · North Shore",
                     doorcounty:" · Door Peninsula",
                     yellowstone:" · Yellowstone National Park",
                     grandteton:" · Grand Teton National Park",
                     tetonvalley:" · Teton Valley", swanvalley:" · Swan Valley"}[r.region] || "";
  $("#sh-sub").textContent = stateName + subRegion;
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

  /* Regulation class, straight from the state's own trout-stream layer.
     The special-regulation text is reproduced verbatim rather than
     paraphrased — on a catch-and-release or artificial-only stretch the
     exact wording is the thing that keeps you legal. */
  if(r.troutClass){
    const tc = TROUT_CLASS[r.troutClass];
    const src = TROUT_SOURCE[r.troutSource || "iadnr"];
    h += `<div class="secthead">Trout class &amp; regulations</div><div class="fishnote">`+
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
    const badge = src==="idfg" ? "Idaho Fish &amp; Game"
                : src==="grte" ? "Grand Teton · Wyoming regs" : "National Park Service";
    const note  = src==="idfg"
      ? `From Idaho Fish &amp; Game's <b>2025–2027 Seasons &amp; Rules</b>, Upper Snake Region. Idaho re-issues the book every two years and the special-rule list changes with it — check the current one before you fish.`
      : src==="grte"
      ? `From the National Park Service's Grand Teton fishing information, which follows <b>Wyoming Game &amp; Fish</b> regulations. Seasons and closures are re-issued every year — check the current Wyoming regulations, and carry a Wyoming licence.`
      : `From the park's <b>2026</b> fishing regulations. Seasons, closures and possession limits are re-issued every year and streams close on short notice in low water — read the current edition before you fish, and carry your park permit.`;
    h += `<div class="secthead">${src==="idfg" ? "Regulations" : "Park regulations"}</div><div class="fishnote">`+
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
  /* Inside a national park the state agency has nothing to do with it — a
     Wyoming or Montana licence is not valid in Yellowstone, and pointing a
     reader at Game & Fish for these rivers would be actively wrong. */
  const regBody = r.region==="yellowstone"
    ? "the National Park Service (a state fishing licence is <b>not</b> valid in the park)"
    : r.region==="grandteton"
    ? "WY Game &amp; Fish and the park — Grand Teton takes a <b>Wyoming licence</b>, unlike Yellowstone"
    : (r.region==="tetonvalley" || r.region==="swanvalley")
    ? "Idaho Fish &amp; Game (Upper Snake Region)"
    : {IA:"the Iowa DNR", MN:"the Minnesota DNR", WI:"the Wisconsin DNR", IL:"the Illinois DNR"}[r.state]
      || "WY Game &amp; Fish / Idaho Fish &amp; Game";
  h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Flow data: USGS Water Data OGC API. River lines simplified — not for navigation. Verify regulations with ${regBody}.</p>`;
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
  if(r.region==="doorcounty"){
    h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:4px">🌊 Door County has <b>no USGS gauge anywhere in the county</b> — every stream here is ungauged on purpose, and the nearest gauged water is a long way off. These creeks are small and rain-driven: judge them on the water. Almost all of them are <b>Great Lakes tributary</b> water, which carries its own season, a 10" minimum, a hook-gap limit and a <b>night-fishing closure</b> from September 15 — read the current Wisconsin regs before you go. Access is county park, state park and land-trust ground rather than DNR easement; there are no angling easements on the peninsula.</p>`;
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
  const ungaugedNote = (r.region==="tetonvalley" || r.region==="swanvalley")
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
    riverLayers[r.id].line.setStyle({color:on?riverColor(r):"#9aa49b", opacity:on?0.92:0.35, weight:on?4.5:3});
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
    const poly = L.polygon(z.rings, {...ZONE_STYLE[z.kind], pane:"zonePane"}).addTo(zoneLayer);
    poly.on("click", ()=>enterZone(z));
    poly.on("mouseover", ()=>poly.setStyle({fillOpacity:ZONE_STYLE[z.kind].fillOpacity+0.16}));
    poly.on("mouseout",  ()=>poly.setStyle({fillOpacity:ZONE_STYLE[z.kind].fillOpacity}));

    const has = z.count > 0;
    const m = L.marker(L.latLngBounds(z.bounds).getCenter(),
      {pane:"zonePane", riseOnHover:true,
       icon:L.divIcon({className:"", iconSize:null, html:
        `<div class="zone-card ${z.kind} ${has?"":"empty"}">
           <div class="zc-label">${z.label}</div>
           <div class="zc-short">${z.short || z.label}</div>
           <div class="zc-count">${has ? z.count+" rivers" : "not mapped yet"}</div>
         </div>`})}).addTo(zoneLayer);
    m.bindTooltip(`<b>${z.label}</b><br><span style="font-size:11px">${z.sub}</span>`,
                  {direction:"top", offset:[0,-16], className:"zone-tip"});
    m.on("click", ()=>enterZone(z));
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
  zoneCards.forEach(c => {
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
  plans.sort((a,b) => a.room - b.room);

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
    if(bestOver > 0.45 * w * h){ if(el) el.style.display = "none"; return; }
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
  const on = !zonesShown && z >= REGION_LABEL_ZOOM.min && z <= REGION_LABEL_ZOOM.max;
  const view = map.getBounds();
  regionLabels.forEach(rl => {
    const show = on && view.intersects(L.latLngBounds(rl.def.bounds));
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
  // Fit the covered area rather than a fixed zoom: z4 fills a laptop but
  // shows a fraction of the country on a phone, which is the screen this
  // actually gets opened on.
  goTo(L.latLngBounds([].concat(...ZONES.map(z=>z.bounds))).pad(0.04));
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
}

buildZones();
showZones();
syncRegionLabels();
syncFlow();
syncLakes();

/* Regions button — always available, so you can get back to the chooser
   without hunting for the right zoom level. Top *left*, under the zoom
   control: the safety panel opens over the top-right corner the moment you
   enter a zone, and it was burying the one control that gets you back. */
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

syncMarkers();          // seed marker groups for the starting zoom
loadPublicLand();
setTimeout(trickleGeometry, 600);

