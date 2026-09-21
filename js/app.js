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

function fetchJSON(url, timeout=12000){
  const ctl = new AbortController();
  const t = setTimeout(()=>ctl.abort(), timeout);
  return fetch(url, {signal:ctl.signal, headers:{accept:"application/geo+json,application/json"}})
    .then(r => { if(!r.ok) throw new Error("HTTP "+r.status); return r.json(); })
    .finally(()=>clearTimeout(t));
}

async function fetchLatest(key){
  const g = GAUGES[key];
  const url = `${API_BASE}/latest-continuous/items?f=json&monitoring_location_id=${g.site}&parameter_code=00060&limit=5`;
  try{
    const j = await fetchJSON(url);
    const f = (j.features||[]).find(x => x.properties && x.properties.value != null);
    if(!f) throw new Error("no data");
    const cfs = parseFloat(f.properties.value);          // values arrive as strings
    if(!isFinite(cfs)) throw new Error("bad value");
    flows[key] = {cfs, time:f.properties.time, fetchedAt:Date.now(), stale:false};
    store.set("flow:"+key, flows[key]);
  }catch(e){
    const cached = store.get("flow:"+key);
    if(cached){ flows[key] = {...cached, stale:true}; }
    else { flows[key] = {cfs:null, stale:true, error:true}; }
  }
}

/* day-of-year median: N small windowed requests against the daily
   collection (statistic 00003 = daily mean), one per past year.
   Cached for 7 days, keyed by site + week-of-year. */
async function fetchStats(key){
  if(stats[key]) return stats[key];
  const g = GAUGES[key];
  const now = new Date();
  const week = Math.floor(dayOfYear(now)/7);
  const ck = `stats:${g.site}:${now.getFullYear()}w${week}:y${STAT_YEARS}`;
  const cached = store.get(ck);
  if(cached){ stats[key]=cached; return cached; }

  const reqs = [];
  for(let y=1; y<=STAT_YEARS; y++){
    const c = new Date(now); c.setFullYear(now.getFullYear()-y);
    const a = new Date(c); a.setDate(c.getDate()-STAT_WINDOW);
    const b = new Date(c); b.setDate(c.getDate()+STAT_WINDOW);
    const iso = d => d.toISOString().slice(0,10);
    const url = `${API_BASE}/daily/items?f=json&monitoring_location_id=${g.site}`+
      `&parameter_code=00060&statistic_id=00003&time=${iso(a)}T00:00:00Z/${iso(b)}T00:00:00Z&limit=60`;
    reqs.push(fetchJSON(url).then(j => (j.features||[]).map(f=>parseFloat(f.properties.value)).filter(isFinite)).catch(()=>[]));
  }
  const vals = (await Promise.all(reqs)).flat().sort((a,b)=>a-b);
  if(!vals.length){ stats[key] = null; return null; }
  const s = {
    median: vals[Math.floor(vals.length/2)],
    mean: vals.reduce((a,b)=>a+b,0)/vals.length,
    min: vals[0], max: vals[vals.length-1], n: vals.length,
  };
  stats[key]=s; store.set(ck,s);
  return s;
}

/* Verify the hardcoded site IDs against monitoring-location metadata
   instead of trusting them blindly. Lazy + cached. */
async function verifyGauge(key){
  if(meta[key]) return meta[key];
  const g = GAUGES[key];
  const cached = store.get("meta:"+g.site);
  if(cached){ meta[key]=cached; return cached; }
  try{
    const j = await fetchJSON(`${API_BASE}/monitoring-locations/items/${g.site}?f=json`, 9000);
    meta[key] = {name: j.properties?.monitoring_location_name || g.label, verified:true};
  }catch(e){
    meta[key] = {name: g.label, verified:false};
  }
  store.set("meta:"+GAUGES[key].site, meta[key]);
  return meta[key];
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

/* float time estimate scaled by flow ratio (sqrt damping, clamped) */
function floatEstimate(sec){
  const key = RIVERS.find(r=>r.id===sec.river).primaryGauge;
  const st = statusOf(key);
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
gHyb.addTo(map);
L.control.layers({"Google Hybrid":gHyb,"Google Satellite":gSat,"Topo":topo,"Esri Satellite":sat},null,{position:"bottomleft"}).addTo(map);

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

/* river labels only at regional zoom — 49 labels at statewide zoom is soup */
function syncLabels(){
  const show = map.getZoom() >= 8;
  Object.values(riverLayers).forEach(l => l.lbl.setOpacity(show ? 1 : 0));
}
map.on("zoomend", syncLabels);

const riverLayers = {}, rampMarkers = {}, gaugeDots = {};
let highlight = null;

RIVERS.forEach(r=>{
  const line = L.polyline(r.coords,{color:r.color,weight:5,opacity:.9,lineCap:"round"}).addTo(map);
  line.on("click",()=>openRiver(r.id));
  const mid = r.coords[Math.floor(r.coords.length/2)];
  const lbl = L.marker(mid,{interactive:false,icon:L.divIcon({className:"riv-label",html:r.name.split("—")[0].split("(")[0].trim(),iconSize:null})}).addTo(map);
  riverLayers[r.id]={line,lbl};
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
RAMPS.forEach(p=>{
  const m = L.marker(p.pos,{icon:apIcon(p,"")}).addTo(map);
  m.bindPopup(`<b>${p.name}</b><br><span style="font-size:11px">${roleWord(p.role)} · ${p.note}</span>`);
  m.on("click",()=>{ openRiver(p.river); });
  rampMarkers[p.id]=m;
});
function apIcon(p, sel){ return L.divIcon({className:"", html:`<div class="ap ${p.role} ${sel}">${apGlyph(p.role)}</div>`, iconSize:[28,28], iconAnchor:[14,14]}); }
function roleWord(r){ return {launch:"Put-in (boat launch)", takeout:"Take-out (boat ramp)", both:"Put-in & take-out ramp", wade:"Wade-fishing access"}[r]; }

Object.keys(GAUGE_POS).forEach(key=>{
  const m = L.marker(GAUGE_POS[key],{icon:gIcon(key), zIndexOffset:300}).addTo(map);
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
   EXACT RIVER GEOMETRY — live USGS NHD high-resolution flowlines
   Pulls the real channel linework (1:24,000 NHD, layer 6) from The
   National Map and replaces the built-in approximation. The built-in
   hand-digitized line stays as the offline/failure fallback, so the
   map always shows something even with no cell service in a canyon.
   Geometry is simplified server-side (maxAllowableOffset) and cached
   ~30 days in local storage so it loads instantly next time.
   ============================================================ */
const NHD_URL = "https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6/query";
// GNIS_NAME keyword per river; others derive from the river name.
const NHD_KEYWORD = {
  snake:"SNAKE RIVER", southfork:"SNAKE RIVER", snakeid:"SNAKE RIVER",
  hellscanyon:"SNAKE RIVER", teton:"TETON RIVER", grosventre:"GROS VENTRE RIVER",
  hoback:"HOBACK RIVER", flatcreek:"FLAT CREEK", buffalofork:"BUFFALO FORK",
  salt:"SALT RIVER", greys:"GREYS RIVER", henrysfork:"HENRYS FORK",
  fallriver:"FALLS RIVER", sfboise:"SOUTH FORK BOISE RIVER",
  nfpayette:"NORTH FORK PAYETTE RIVER", sfpayette:"SOUTH FORK PAYETTE RIVER",
  mfsalmon:"MIDDLE FORK SALMON RIVER", sfclearwater:"SOUTH FORK CLEARWATER RIVER",
  nfclearwater:"NORTH FORK CLEARWATER RIVER", nfshoshone:"NORTH FORK SHOSHONE RIVER",
  clarksfork:"CLARKS FORK YELLOWSTONE RIVER", cda:"COEUR D'ALENE RIVER",
  bighorn:"BIGHORN RIVER", wind:"WIND RIVER", nplatteupper:"NORTH PLATTE RIVER",
  nplattereef:"NORTH PLATTE RIVER", green:"GREEN RIVER", newfork:"NEW FORK RIVER",
};
function riverKeyword(r){
  if(NHD_KEYWORD[r.id]) return NHD_KEYWORD[r.id];
  return r.name.split("—")[0].split("(")[0].replace(/&amp;[^]*$/,"").trim().toUpperCase();
}
function bboxOf(coords, pad){
  pad = pad||0.025;
  let a=90,b=-90,c=180,d=-180;
  coords.forEach(p=>{a=Math.min(a,p[0]);b=Math.max(b,p[0]);c=Math.min(c,p[1]);d=Math.max(d,p[1]);});
  return [c-pad, a-pad, d+pad, b+pad];   // xmin,ymin,xmax,ymax (lng/lat)
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
  const bb = bboxOf(r.coords);
  const kw = riverKeyword(r).replace(/[%']/g,"");
  const where = encodeURIComponent(`UPPER(GNIS_NAME) LIKE '%${kw}%'`);
  const url = `${NHD_URL}?where=${where}&geometry=${bb.join(",")}`+
    `&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects`+
    `&outFields=GNIS_NAME&returnGeometry=true&outSR=4326`+
    `&maxAllowableOffset=0.0006&geometryPrecision=5&resultRecordCount=4000&f=geojson`;
  try{
    const j = await fetchJSON(url, 16000);
    const segs = [];
    (j.features||[]).forEach(f=>{
      const g = f.geometry; if(!g) return;
      if(g.type==="LineString") segs.push(g.coordinates.map(c=>[c[1],c[0]]));
      else if(g.type==="MultiLineString") g.coordinates.forEach(l=>segs.push(l.map(c=>[c[1],c[0]])));
    });
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
// gentle background pass so the whole map fills in with real linework
let geomQueue = null;
function trickleGeometry(){
  if(geomQueue) return; geomQueue = RIVERS.slice();
  (async function step(){
    const r = geomQueue.shift(); if(!r){ geomQueue=null; return; }
    await loadRealRiver(r);
    setTimeout(step, 500);
  })();
}

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
  $("#sh-sub").textContent = r.state==="ID" ? "Idaho" : "Wyoming";
  sheet.classList.add("open");
  loadRealRiver(r);                    // snap this river to exact USGS linework
  renderSheet(r);                      // instant paint with whatever we have
  // lazy-load stats + metadata for this river's gauges, then repaint
  await Promise.all(r.gauges.map(k=>Promise.all([fetchStats(k), verifyGauge(k)])));
  if(curRiver===id){ renderSheet(r); repaintGauges(); }
  if(focusGauge) map.panTo(GAUGE_POS[focusGauge]);
}

function renderSheet(r){
  let h = `<p style="margin:12px 2px 2px;font-size:13.5px">${r.blurb}</p>`;

  r.gauges.forEach(k=>{ h += flowCardHTML(k, r.id); });

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
  h += `<p style="font-size:10.5px;color:var(--txt-dim);margin-top:14px">Flow data: USGS Water Data OGC API. River lines simplified — not for navigation. Verify regulations with WY Game &amp; Fish / Idaho Fish &amp; Game.</p>`;
  body.innerHTML = h;

  body.querySelectorAll("[data-zoom]").forEach(el=>el.addEventListener("click",()=>{
    const s = SECTIONS.find(x=>x.id===el.dataset.zoom);
    zoomSection(s);
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
  RAMPS.forEach(p=>{
    let show = true;
    if(filters.act==="fish" && (p.role!=="wade")) show = true;      // ramps still useful for access
    if(filters.act==="float" && p.role==="wade") show = false;
    if((filters.beg||filters.dur||filters.cls) && p.role!=="wade"){
      show = SECTIONS.some(s=>(s.put===p.id||s.take===p.id) && passFilter(s));
    }
    const m = rampMarkers[p.id];
    show ? m.addTo(map) : map.removeLayer(m);
  });
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
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

/* ---------- refresh loop ---------- */
async function refreshAll(manual){
  const btn=$("#btn-refresh"); btn.classList.add("spin");
  const keys = Object.keys(GAUGES);
  for(let i=0; i<keys.length; i+=8){
    await Promise.all(keys.slice(i,i+8).map(fetchLatest));
  }
  const anyLive = Object.values(flows).some(f=>f && !f.stale);
  const anyData = Object.values(flows).some(f=>f && f.cfs!=null);
  $("#netpill").classList.toggle("show", !anyLive && anyData);
  $("#updwhen").textContent = anyLive ? new Date().toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
    : (anyData ? "cached" : "unavailable");
  repaintGauges();
  if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
  btn.classList.remove("spin");
  // trickle in historical stats in the background so badges upgrade
  // from "Live" to a real status without hammering the API
  if(!refreshAll.statsKicked){
    refreshAll.statsKicked=true;
    (async()=>{
      for(const k of Object.keys(GAUGES)){
        await fetchStats(k); repaintGauges();
        if(curRiver) renderSheet(RIVERS.find(r=>r.id===curRiver));
        await new Promise(r=>setTimeout(r,700));
      }
    })();
  }
}
$("#btn-refresh").addEventListener("click",()=>refreshAll(true));
window.addEventListener("online",()=>refreshAll());
setInterval(refreshAll, REFRESH_MS);
refreshAll();
// fill in exact USGS NHD linework across the map after first paint
setTimeout(trickleGeometry, 2500);

