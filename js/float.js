/* Float Mode — "if I put in at 9, when am I at the take-out?", and on the
   water, "how far left, when do I get off?". Personal and on-phone only.

   Loads after app.js and uses its globals (RIVERS, SECTIONS, RAMPS, map,
   flows, statusOf, floatEstimate, goTo, fbState, fbPersist, locStart…).
   app.js reaches back through three guarded hooks: floatOpenPlanner (the
   section's "Start float" button), floatOnFix (every location fix) and
   floatActiveNow / floatImport.

   What is stored, and what is not: the active float lives in
   localStorage.floatActive and finished ones in fbState.floats. Both hold
   only {time, fraction-along-the-river} pairs — never a coordinate. The
   location feature promises coordinates are never stored; this keeps it. */

const FLOAT_RIVERS  = ["snake","teton","southfork","green"];   // add "newfork" here later
const FLOAT_EXCLUDE = ["s7"];   // Snake River Canyon West Table → Sheep Gulch: whitewater, not a fishing float
const FLOAT_LEVELS  = ["Beginner","Intermediate"];   // Iowa DNR skill ratings that get Start float

/* Two rules, by what the section is rated with. Neither applies to an id in
   FLOAT_EXCLUDE.

   Western sections carry a whitewater `klass`: Class III or easier, on a
   river in FLOAT_RIVERS. A section with no class is never offered, and
   anything naming IV or V never is.

   Iowa water-trail sections carry the DNR's own skill rating in `level`
   (and klass:null): offered only on a Beginner or Intermediate segment of a
   river with a `waterTrail`, and only when `dams` is an empty list. A
   low-head dam on a section means the route would run the live float
   straight over it, so that section is listed with its warning and never
   offered — and a section that doesn't say whether it has a dam isn't
   either: an unknown is not a no. Advanced and Not Rated are not offered. */
function floatEligible(s){
  if(!s || FLOAT_EXCLUDE.includes(s.id)) return false;
  if(typeof s.level === "string"){
    if(!FLOAT_LEVELS.includes(s.level)) return false;
    if(!Array.isArray(s.dams) || s.dams.length) return false;
    const r = RIVERS.find(x => x.id === s.river);
    return !!(r && r.waterTrail);
  }
  if(!FLOAT_RIVERS.includes(s.river)) return false;
  if(typeof s.klass !== "string" || !s.klass.trim()) return false;
  if(/IV|V/.test(s.klass)) return false;
  return /^(I{1,3})(-(I{1,3}))?$/.test(s.klass.trim());
}
/* What the section is rated, for the planner: a whitewater class on western
   water, the DNR's skill rating on an Iowa water trail. */
function floatRating(s){
  if(typeof s.klass === "string" && s.klass.trim()) return "Class " + s.klass;
  if(typeof s.level === "string") return ["Beginner","Intermediate","Advanced"].includes(s.level) ? "DNR " + s.level : "Not rated by the DNR";
  return "";
}

/* Speed factor against the section's typical speed. These are STARTING
   GUESSES — a pontoon is slower, a kayak quicker, a canoe taken as even with
   a drift boat — and they are replaced by your own history: once you have
   completed floats on a section, the planner leads with the median of those
   instead. */
const CRAFT = {
  drift:   {label:"Drift boat", f:1.0},
  raft:    {label:"Raft",       f:1.0},
  pontoon: {label:"Pontoon",    f:0.85},
  kayak:   {label:"Kayak",      f:1.15},
  canoe:   {label:"Canoe",      f:1.0},
};
/* Which crafts a section offers, first entry the default. An Iowa water
   trail is canoe-and-kayak water (owner's decision, 2026-10-10); the West
   keeps its four and never offers a canoe. Each list remembers its own
   choice, so picking a canoe in Iowa can't turn up as the Snake's default. */
const CRAFT_WEST = ["drift","raft","pontoon","kayak"];
const CRAFT_WT   = ["canoe","kayak"];
function floatCrafts(s){
  const r = s && RIVERS.find(x => x.id === s.river);
  return r && r.waterTrail ? CRAFT_WT : CRAFT_WEST;
}
const flCraftKey = s => floatCrafts(s) === CRAFT_WT ? "floatCraftIA" : "floatCraft";
const FLOAT_MIN_MPH   = 0.4;     // below this between two fixes, the time counts as stopped
const FLOAT_MAX_ACC   = 75;      // metres; looser fixes are ignored
const FLOAT_OFF_KM    = 0.3;     // further than this from the line: "off the river"
const FLOAT_JUMP_KM   = 3;       // forward jump this big in under 2 minutes is a bad fix
const FLOAT_LOG_GAP   = 10000;   // ms between logged points (a day's float stays well under the cap)
const FLOAT_LOG_MAX   = 3000;
const FLOAT_STALE_MS  = 18*3600e3;
const FLOAT_KEY = "floatActive";

/* ---------- geometry ---------- */
const flHav = (a, b) => {
  const R = 6371, rad = Math.PI/180;
  const dLa = (b[0]-a[0])*rad, dLo = (b[1]-a[1])*rad;
  const h = Math.sin(dLa/2)**2 + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
};
/* Project p onto segment a-b in a local flat plane (fine at a few km).
   Returns {t, km: distance from p to the projected point}. */
function flProject(p, a, b){
  const k = Math.cos(a[0]*Math.PI/180);
  const ax = a[1]*k, ay = a[0], bx = b[1]*k, by = b[0], px = p[1]*k, py = p[0];
  const dx = bx-ax, dy = by-ay, l2 = dx*dx + dy*dy;
  let t = l2 ? ((px-ax)*dx + (py-ay)*dy)/l2 : 0;
  t = Math.max(0, Math.min(1, t));
  const q = [ay + t*dy, (ax + t*dx)/k];
  return {t, km: flHav(p, q), q};
}

/* tiny binary min-heap for Dijkstra */
class FlHeap{
  constructor(){ this.a = []; }
  push(d, n){ const a = this.a; a.push([d,n]); let i = a.length-1;
    while(i){ const p = (i-1)>>1; if(a[p][0] <= a[i][0]) break; [a[p],a[i]] = [a[i],a[p]]; i = p; } }
  pop(){ const a = this.a, top = a[0], last = a.pop();
    if(a.length){ a[0] = last; let i = 0;
      for(;;){ let l = 2*i+1, r = l+1, m = i;
        if(l < a.length && a[l][0] < a[m][0]) m = l;
        if(r < a.length && a[r][0] < a[m][0]) m = r;
        if(m === i) break; [a[m],a[i]] = [a[i],a[m]]; i = m; } }
    return top; }
  get size(){ return this.a.length; }
}

/* The river as drawn right now, as a list of pieces of [lat,lng]. The drawn
   line is what an NHD snap or a zoom refinement actually replaces, so it is
   preferred over r.coords (which stays as baked). */
function floatLine(r){
  const layer = riverLayers[r.id];
  if(layer && layer.line){
    const ll = layer.line.getLatLngs();
    const flat = a => a.map(p => [p.lat, p.lng]);
    const pieces = ll.length && Array.isArray(ll[0]) ? ll.map(flat) : [flat(ll)];
    if(pieces.some(p => p.length > 1)) return pieces;
  }
  return isMulti(r.coords) ? r.coords : [r.coords];
}

/* Build the route for a section along the river's CURRENT drawn line.
   Vertices of every piece are nodes and consecutive vertices are edges. The
   pieces are kept apart on purpose elsewhere, but a braid or side channel
   re-joins the river part-way along a segment, not at a vertex, so the end
   of each piece is welded to the nearest point on any OTHER piece within
   0.5 km (a node is inserted there). A gap that small is a break in the
   data, not in the water. Put-in and take-out are snapped by interpolated projection
   onto the nearest segment — not the nearest vertex, which can be 400 m off —
   and inserted as nodes. Returns {pts, cum, len, putKm, takeKm} or {error}. */
function floatBuildRoute(sec){
  const r = RIVERS.find(x => x.id === sec.river);
  const put = RAMPS.find(p => p.id === sec.put), take = RAMPS.find(p => p.id === sec.take);
  if(!r || !put || !take || !r.coords || !r.coords.length) return {error:"no geometry"};
  const pieces = floatLine(r).filter(p => p.length > 1);
  if(!pieces.length) return {error:"no geometry"};

  const pts = [], adj = [], segs = [], ends = [];
  const link = (i, j, w) => { adj[i].push([j,w]); adj[j].push([i,w]); };
  for(const pc of pieces){
    const base = pts.length;
    pc.forEach(p => { pts.push(p); adj.push([]); });
    for(let i = 1; i < pc.length; i++){
      link(base+i-1, base+i, flHav(pc[i-1], pc[i]));
      segs.push([base+i-1, base+i, pieces.indexOf(pc)]);
    }
    ends.push([base, pieces.indexOf(pc)], [base+pc.length-1, pieces.indexOf(pc)]);
  }
  const nSeg = segs.length;
  for(const [e, pi] of ends){
    let best = null;
    for(let s = 0; s < nSeg; s++){
      const [a, b, sp_] = segs[s]; if(sp_ === pi) continue;
      const pr = flProject(pts[e], pts[a], pts[b]);
      if(pr.km <= 0.5 && (!best || pr.km < best.km)) best = {km:pr.km, a, b, q:pr.q};
    }
    if(!best) continue;
    const id = pts.length; pts.push(best.q); adj.push([]);
    link(id, best.a, flHav(best.q, pts[best.a])); link(id, best.b, flHav(best.q, pts[best.b]));
    link(id, e, best.km);
  }

  const snap = pos => {
    let best = null;
    for(let s = 0; s < nSeg; s++){
      const [a,b] = segs[s], pr = flProject(pos, pts[a], pts[b]);
      if(!best || pr.km < best.km) best = {km:pr.km, t:pr.t, a, b, q:pr.q};
    }
    return best;
  };
  const sp = snap(put.pos), st = snap(take.pos);
  if(!sp || !st) return {error:"no segments"};
  if(sp.km > 1.5 || st.km > 1.5) return {error:"ramp off line", putKm:sp.km, takeKm:st.km};

  const addNode = s => {   // (segs are never added to, so a snap stays on drawn line)
    const id = pts.length; pts.push(s.q); adj.push([]);
    link(id, s.a, flHav(s.q, pts[s.a])); link(id, s.b, flHav(s.q, pts[s.b]));
    return id;
  };
  const P = addNode(sp), T = addNode(st);
  if(sp.a === st.a && sp.b === st.b) link(P, T, flHav(sp.q, st.q));   // both on one segment

  const dist = new Float64Array(pts.length).fill(Infinity), prev = new Int32Array(pts.length).fill(-1);
  const h = new FlHeap(); dist[P] = 0; h.push(0, P);
  while(h.size){
    const [d, n] = h.pop();
    if(d > dist[n]) continue;
    if(n === T) break;
    for(const [m, w] of adj[n]){
      const nd = d + w;
      if(nd < dist[m]){ dist[m] = nd; prev[m] = n; h.push(nd, m); }
    }
  }
  if(!isFinite(dist[T])) return {error:"not connected", putKm:sp.km, takeKm:st.km};
  const idx = []; for(let n = T; n !== -1; n = prev[n]) idx.push(n);
  idx.reverse();
  const line = idx.map(n => pts[n]), cum = [0];
  for(let i = 1; i < line.length; i++) cum.push(cum[i-1] + flHav(line[i-1], line[i]));
  return {pts:line, cum, len:cum[cum.length-1], putKm:sp.km, takeKm:st.km};
}

/* where does a fix sit on the route? {along km, off km}. Several segments can
   be about equally close (an oxbow, braids); of those, take the one nearest
   where we already were, so the position can't hop to the wrong loop. */
function floatProject(route, ll, hintKm){
  const cand = []; let min = Infinity;
  for(let i = 1; i < route.pts.length; i++){
    const pr = flProject(ll, route.pts[i-1], route.pts[i]);
    const along = route.cum[i-1] + pr.t*(route.cum[i]-route.cum[i-1]);
    cand.push([pr.km, along]); if(pr.km < min) min = pr.km;
  }
  let best = null;
  for(const [off, along] of cand) if(off <= min + 0.05 && (!best || Math.abs(along-hintKm) < Math.abs(best[1]-hintKm))) best = [off, along];
  return {off:best[0], along:best[1]};
}
function floatPointAt(route, km){
  km = Math.max(0, Math.min(route.len, km));
  let i = 1; while(i < route.cum.length-1 && route.cum[i] < km) i++;
  const span = route.cum[i]-route.cum[i-1] || 1, t = (km-route.cum[i-1])/span;
  const a = route.pts[i-1], b = route.pts[i];
  return {ll:[a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t], i};
}

/* ---------- formatting ---------- */
const flClock = ms => new Date(ms).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"});
const flDur = min => {
  min = Math.max(0, Math.round(min));
  return min < 60 ? min + " min" : Math.floor(min/60) + " h " + String(min%60).padStart(2,"0") + " min";
};
const flDurS = min => { min = Math.max(0, Math.round(min)); return min < 60 ? min + "m" : Math.floor(min/60) + "h " + String(min%60).padStart(2,"0") + "m"; };
const flHr = h => (Math.round(h*10)/10) + " hr";
const flMaps = p => `https://maps.google.com/?q=${p.pos[0]},${p.pos[1]}`;
function flToast(msg){
  let t = document.getElementById("floattoast");
  if(!t){ t = document.body.appendChild(document.createElement("div")); t.id = "floattoast"; t.setAttribute("role","status"); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(flToast.t); flToast.t = setTimeout(() => t.classList.remove("show"), 3500);
}
/* the stored choice for this section's kind of water, if it offers it; else its first craft */
const flCraft = s => {
  const list = floatCrafts(s);
  try{ const c = localStorage.getItem(flCraftKey(s)); if(list.includes(c)) return c; }catch(e){}
  return list[0];
};
const flDefaultLaunch = () => {
  const d = new Date(Math.ceil(Date.now()/300000)*300000);
  return String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
};
const flMedian = a => { const s = a.slice().sort((x,y) => x-y), n = s.length; return n%2 ? s[(n-1)/2] : (s[n/2-1]+s[n/2])/2; };

/* The planner's numbers. Returns hours: {lo, hi, mid, hist:{n, median}|null, typ:{lo,hi,scaled}}.
   Typical-speed estimate = floatEstimate's range ÷ craft factor. If you have
   completed floats of this section, their median (each nudged for how the
   flow then compares with today's, sqrt-damped, 0.7–1.4) leads instead. */
function floatPlanNumbers(sec, craft){
  const est = floatEstimate(sec), f = CRAFT[craft].f;
  const typ = {lo:est.lo/f, hi:est.hi/f, scaled:est.scaled};
  typ.mid = (typ.lo+typ.hi)/2;
  const r = RIVERS.find(x => x.id === sec.river);
  const today = r.primaryGauge ? statusOf(r.primaryGauge).ratio : null;
  const done = (fbState.floats||[]).filter(x => x.section === sec.id && x.completed);
  if(!done.length) return {lo:typ.lo, hi:typ.hi, mid:typ.mid, hist:null, typ};
  const adj = done.map(x => {
    let k = 1;
    if(today && x.ratio) k = Math.min(1.4, Math.max(0.7, Math.sqrt(x.ratio/today)));
    return x.totalMin/60*k;
  });
  const mid = flMedian(adj);
  return {lo:mid*0.9, hi:mid*1.1, mid, typ,
    hist:{n:done.length, median:flMedian(done.map(x => x.totalMin/60))}};
}

/* ---------- route layer ---------- */
const floatPane = map.createPane("floatPane");
floatPane.style.zIndex = 415;           // over the river lines (410), under the markers (600)
floatPane.style.pointerEvents = "none";
let flLayer = null, flRem = null, flDone = null;
function flDrawRoute(route){
  flClearRoute();
  const ends = [route.pts[0], route.pts[route.pts.length-1]];
  flDone = L.polyline([], {pane:"floatPane", color:"#6f8f99", weight:6, opacity:.75, lineCap:"round", interactive:false});
  flRem  = L.polyline(route.pts, {pane:"floatPane", color:"#0f8fb8", weight:6, opacity:.95, lineCap:"round", interactive:false});
  const dot = (p, c) => L.circleMarker(p, {pane:"floatPane", radius:8, color:"#fff", weight:3, fillColor:c, fillOpacity:1, interactive:false});
  flLayer = L.layerGroup([flDone, flRem, dot(ends[0], "#1d7a46"), dot(ends[1], "#8c4a1d")]).addTo(map);
}
function flClearRoute(){ if(flLayer){ map.removeLayer(flLayer); flLayer = null; } flRem = flDone = null; }
function flPaintProgress(route, km){
  if(!flRem) return;
  const at = floatPointAt(route, km);
  flDone.setLatLngs([...route.pts.slice(0, at.i), at.ll]);
  flRem.setLatLngs([at.ll, ...route.pts.slice(at.i)]);
}
/* fit the route into the part of the screen the card leaves free (the top) */
function flFit(route){
  const b = L.latLngBounds(route.pts).pad(0.2);
  const h = b.getNorth()-b.getSouth();
  b.extend([b.getSouth()-h*0.9, b.getCenter().lng]);
  goTo(b);
}

/* ---------- planner ---------- */
const flPlan = document.body.appendChild(document.createElement("section"));
flPlan.id = "floatplan"; flPlan.className = "floatcard"; flPlan.setAttribute("aria-label","Plan a float");
let flSec = null, flRoute = null, flRouteErr = null;

function flShareText(sec, launchMs, window_){
  const put = RAMPS.find(p => p.id === sec.put), take = RAMPS.find(p => p.id === sec.take);
  const r = RIVERS.find(x => x.id === sec.river);
  return `Float plan — ${r.name}: ${sec.name}\n` +
    `Put-in: ${put.name} ${flMaps(put)}\n` +
    `Take-out: ${take.name} ${flMaps(take)}\n` +
    `Launch: ${flClock(launchMs)}\n` +
    `Expected off the water: ${window_}`;
}
async function flShare(text){
  try{
    if(navigator.share){ await navigator.share({text}); return; }
  }catch(e){ if(e && e.name === "AbortError") return; }
  try{ await navigator.clipboard.writeText(text); flToast("Float plan copied"); }
  catch(e){ flToast("Couldn't share or copy"); }
}

function flLaunchMs(){
  const v = (document.getElementById("fp-time")||{}).value || flDefaultLaunch();
  const [h,m] = v.split(":").map(Number), d = new Date();
  d.setHours(h, m, 0, 0);
  return d.getTime();
}
function flPlanEstimateHTML(){
  const craft = flCraft(flSec), n = floatPlanNumbers(flSec, craft), launch = flLaunchMs();
  const win = `${flClock(launch + n.lo*3600e3)} – ${flClock(launch + n.hi*3600e3)}`;
  const typLine = `${flHr(n.typ.lo)}–${flHr(n.typ.hi)}`;
  const label = n.typ.scaled ? "estimate · from typical speed and today's flow" : "estimate · from typical speed at typical flow";
  let h;
  if(n.hist){
    h = `<div class="fp-big mono">${win}</div>
      <div class="fp-sub">off the water · about ${flHr(n.mid)} · from your floats</div>
      <div class="fp-hist">Your floats here: <b>${n.hist.n}</b>, median <b>${flHr(n.hist.median)}</b></div>
      <div class="fp-small">${typLine} · ${label}</div>`;
  } else {
    h = `<div class="fp-big mono">${win}</div>
      <div class="fp-sub">off the water · ${typLine}</div>
      <div class="fp-small">${label}</div>`;
  }
  return h;
}
function flRenderPlanner(){
  const s = flSec, r = RIVERS.find(x => x.id === s.river);
  const put = RAMPS.find(p => p.id === s.put), take = RAMPS.find(p => p.id === s.take);
  const craft = flCraft(s);
  const routeOk = !!flRoute && !flRoute.error;
  flPlan.innerHTML = `
    <div class="fp-head"><div><h3>${fbEsc(s.name)}</h3>
      <div class="fp-meta">${fbEsc(r.name)}${floatRating(s) ? " · " + fbEsc(floatRating(s)) : ""} · <b>${s.miles}</b> mi</div></div>
      <button class="x" id="fp-x" type="button" aria-label="Close">✕</button></div>
    <div class="fp-ends"><span class="dot put"></span>${fbEsc(put.name)} <span class="arrow">→</span> <span class="dot take"></span>${fbEsc(take.name)}</div>
    <div class="fp-craft" role="radiogroup" aria-label="Craft">${floatCrafts(s).map(k =>
      `<button type="button" role="radio" aria-checked="${k===craft}" data-craft="${k}" class="${k===craft?"on":""}">${CRAFT[k].label}</button>`).join("")}</div>
    <label class="fp-launch">Launch time <input type="time" id="fp-time" value="${flDefaultLaunch()}"></label>
    <div class="fp-est" id="fp-est">${flPlanEstimateHTML()}</div>
    ${routeOk ? "" : `<div class="fp-warn">This section can't be traced on the river line yet.</div>`}
    <div class="fp-btns">
      <button type="button" class="go" id="fp-start" ${routeOk?"":"disabled"}>Start float</button>
      <button type="button" id="fp-share">Share float plan</button>
      <button type="button" id="fp-cancel">Cancel</button>
    </div>`;
}
function flClosePlanner(clearRoute){
  flPlan.classList.remove("show");
  if(clearRoute && !F) flClearRoute();
  flSec = null;
}
function floatOpenPlanner(id){
  const s = SECTIONS.find(x => x.id === id);
  if(!s || !floatEligible(s)) return;
  if(F){ flToast("A float is already in progress"); flRenderLive(); return; }
  flSec = s;
  flRoute = floatBuildRoute(s); flRouteErr = flRoute.error || null;
  flRenderPlanner();
  flPlan.classList.add("show");
  if(window.innerWidth < 900) sheet.classList.remove("open");   // like zoomSection: get the card out of the way
  if(!flRouteErr){ flDrawRoute(flRoute); flFit(flRoute); }
  else {
    flClearRoute();
    const put = RAMPS.find(p => p.id === s.put), take = RAMPS.find(p => p.id === s.take);
    goTo(L.latLngBounds([put.pos, take.pos]).pad(0.35));
  }
}
flPlan.addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b || !flSec) return;
  if(b.dataset.craft){
    try{ localStorage.setItem(flCraftKey(flSec), b.dataset.craft); }catch(err){}
    flPlan.querySelectorAll("[data-craft]").forEach(x => { const on = x===b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
    document.getElementById("fp-est").innerHTML = flPlanEstimateHTML();
  } else if(b.id === "fp-x" || b.id === "fp-cancel") flClosePlanner(true);
  else if(b.id === "fp-share"){
    const n = floatPlanNumbers(flSec, flCraft(flSec)), launch = flLaunchMs();
    flShare(flShareText(flSec, launch, `${flClock(launch + n.lo*3600e3)} – ${flClock(launch + n.hi*3600e3)}`));
  } else if(b.id === "fp-start") flStart();
});
flPlan.addEventListener("input", e => { if(e.target.id === "fp-time") document.getElementById("fp-est").innerHTML = flPlanEstimateHTML(); });

/* ---------- active float ---------- */
let F = null;            // {id, section, river, craft, start, planned:{lo,hi,mid}, log:[{t,a}]} + memory-only fields below
let flAlong = 0;         // km along the route, monotonic
let flOff = false;       // last accepted-accuracy fix was off the river line
let flGotFix = false;
let flLastT = 0;         // time of the last fix that passed the checks (not just the last one logged)
let flTimer = null, flWake = null;
let flCollapsed = false;
const flLive = document.body.appendChild(document.createElement("section"));
flLive.id = "floatlive"; flLive.className = "floatcard"; flLive.setAttribute("aria-label","Float in progress");

function floatActiveNow(){ return !!F && !F.stale; }   // a declaration, so app.js can see it on window
function flSave(){
  if(!F) return;
  const o = {id:F.id, section:F.section, river:F.river, craft:F.craft, start:F.start, planned:F.planned, log:F.log};
  try{ localStorage.setItem(FLOAT_KEY, JSON.stringify(o)); }catch(e){}
}
function flWakeWanted(){ try{ return localStorage.getItem("floatWake") !== "off"; }catch(e){ return true; } }
async function flWakeAcquire(){
  if(!("wakeLock" in navigator) || !flWakeWanted() || !F || document.visibilityState !== "visible") return;
  try{ flWake = await navigator.wakeLock.request("screen"); flWake.addEventListener("release", () => { flWake = null; }); }catch(e){}
}
function flWakeRelease(){ if(flWake){ try{ flWake.release(); }catch(e){} flWake = null; } }
document.addEventListener("visibilitychange", () => {
  if(document.visibilityState === "visible" && F){ flWakeAcquire(); flRenderLive(); }
});

function flStart(){
  if(!flSec || !flRoute || flRoute.error || F) return;
  const n = floatPlanNumbers(flSec, flCraft(flSec));
  F = {id:Math.random().toString(36).slice(2,10) + Date.now().toString(36), section:flSec.id, river:flSec.river,
       craft:flCraft(flSec), start:Date.now(), planned:{lo:n.lo, hi:n.hi, mid:n.mid}, log:[]};
  flAlong = 0; flLastT = 0; flOff = false; flGotFix = false; flCollapsed = false;
  flSave();
  flPlan.classList.remove("show"); flSec = null;
  // The tap on Start is the user gesture iOS wants before asking for location.
  if(locState === "off") locStart("following");
  flWakeAcquire();
  flBeginLive();
}
function flBeginLive(){
  flRenderLive(); flLive.classList.add("show");
  clearInterval(flTimer); flTimer = setInterval(flRenderLive, 30000);
}

/* totals from the {t,a} log. A pair of points counts as moving when the
   miles between them over the hours between them reach 0.4 mph, else
   stopped — including long gaps when the screen was off. */
function flStats(now){
  const s = SECTIONS.find(x => x.id === F.section), miles = s.miles, log = F.log;
  const base = log.length ? log[0].t : F.start;
  let movMs = 0;
  for(let i = 1; i < log.length; i++){
    const dt = log[i].t - log[i-1].t; if(dt <= 0) continue;
    const mph = (log[i].a - log[i-1].a)*miles / (dt/3600e3);
    if(mph >= FLOAT_MIN_MPH) movMs += dt;
  }
  const lastT = log.length ? log[log.length-1].t : base;
  const a = flRoute && flRoute.len ? Math.min(1, flAlong/flRoute.len) : 0;
  const done = a*miles, left = Math.max(0, miles-done);
  const elapsed = Math.max(0, now-base), spanMs = lastT-base;
  const live = done >= 0.3 && movMs >= 600000;
  let pace, ratio = 1;
  if(live){ pace = done/(movMs/3600e3); ratio = movMs > 0 ? spanMs/movMs : 1; }
  else pace = miles / Math.max(0.25, F.planned.mid);
  const etaMs = now + (left/pace)*3600e3*ratio;
  return {miles, a, done, left, elapsed, movMs, stoppedMs:Math.max(0, elapsed-movMs), pace, live, etaMs};
}

function flRenderLive(){
  if(!F){ flLive.classList.remove("show"); return; }
  const s = SECTIONS.find(x => x.id === F.section), r = RIVERS.find(x => x.id === F.river);
  if(F.stale){
    flLive.innerHTML = `<div class="fl-head"><b>Unfinished float</b></div>
      <p class="fl-note">${fbEsc(s.name)} was started ${fbEsc(new Date(F.start).toLocaleString([], {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}))} and never ended. Save what was recorded, or discard it?</p>
      <div class="fl-btns"><button type="button" class="go" data-fl="save">Save it</button><button type="button" data-fl="discard">Discard</button></div>`;
    flLive.classList.add("show"); return;
  }
  const st = flStats(Date.now()), atTake = st.a >= 0.97 || (flRoute && flRoute.len - flAlong <= 0.15 && flAlong > 0);
  const pill = `${st.left.toFixed(1)} mi left · ETA ${flClock(st.etaMs)}`;
  flLive.classList.toggle("collapsed", flCollapsed);
  if(flCollapsed){
    flLive.innerHTML = `<button type="button" class="fl-pill" data-fl="expand"><span class="mono">${pill}</span><span class="fl-up">▲</span></button>`
      + (atTake ? `<button type="button" class="fl-pillend" data-fl="end">End float</button>` : "");
    return;
  }
  const status = !flGotFix ? "Waiting for GPS…" : flOff ? "Off the river line" : st.live ? "" : "Using the planned pace until you've moved a bit";
  flLive.innerHTML = `
    <div class="fl-head"><span class="fl-title">${fbEsc(s.name)}</span>
      <button type="button" class="fl-min" data-fl="collapse" aria-label="Collapse">▼</button></div>
    <div class="fl-eta"><span class="lbl">ETA take-out</span><span class="mono big">${flClock(st.etaMs)}</span></div>
    <div class="fl-grid">
      <div><span class="mono">${st.left.toFixed(1)}</span><i>mi left</i></div>
      <div><span class="mono">${st.done.toFixed(1)}</span><i>mi done</i></div>
      <div><span class="mono">${flDurS(st.elapsed/60000)}</span><i>elapsed</i></div>
      <div><span class="mono">${flDurS(st.stoppedMs/60000)}</span><i>stopped</i></div>
      <div><span class="mono">${st.pace.toFixed(1)}</span><i>mph ${st.live ? "your pace" : "planned"}</i></div>
    </div>
    ${status ? `<div class="fl-status${flOff ? " warn" : ""}">${status}</div>` : ""}
    ${atTake ? `<div class="fl-take"><span>At the take-out?</span><button type="button" class="go" data-fl="end">End float</button></div>` : ""}
    ${"wakeLock" in navigator ? `<label class="fl-wake"><input type="checkbox" data-fl="wake" ${flWakeWanted()?"checked":""}> Keep screen on</label>` : ""}
    <p class="fl-note">iPhone pauses GPS when the screen locks — keep the app open, or the gap fills in at the next fix.</p>
    <div class="fl-btns"><button type="button" data-fl="share">Share plan</button><button type="button" class="end" data-fl="end">End float</button></div>`;
}
flLive.addEventListener("click", e => {
  const b = e.target.closest("[data-fl]"); if(!b || !F) return;
  const act = b.dataset.fl;
  if(act === "collapse"){ flCollapsed = true; flRenderLive(); }
  else if(act === "expand"){ flCollapsed = false; flRenderLive(); }
  else if(act === "share"){
    const s = SECTIONS.find(x => x.id === F.section), st = flStats(Date.now());
    flShare(flShareText(s, F.start, `about ${flClock(st.etaMs)} (live estimate, ${st.left.toFixed(1)} mi to go)`));
  }
  else if(act === "end") flEnd(false);
  else if(act === "save") flEnd(true);
  else if(act === "discard"){ if(confirm("Discard this float?")) flFinish(); }
});
flLive.addEventListener("change", e => {
  if(e.target.dataset.fl !== "wake") return;
  try{ localStorage.setItem("floatWake", e.target.checked ? "on" : "off"); }catch(err){}
  if(e.target.checked) flWakeAcquire(); else flWakeRelease();
});

/* One location fix. Only {t, a} is ever kept. */
function floatOnFix(pos){
  if(!F || F.stale || !flRoute || !pos || !pos.coords) return;
  const c = pos.coords;
  if(!(c.accuracy <= FLOAT_MAX_ACC)) return;
  const t = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
  flGotFix = true;
  const pr = floatProject(flRoute, [c.latitude, c.longitude], flAlong);
  if(pr.off > FLOAT_OFF_KM){ flOff = true; flRenderLive(); return; }
  flOff = false;
  const last = F.log[F.log.length-1];
  // a forward leap of more than 3 km in under two minutes is a bad fix, not a river
  if(flLastT && pr.along - flAlong > FLOAT_JUMP_KM && t - flLastT < 120000){ flRenderLive(); return; }
  flLastT = t;
  flAlong = Math.max(flAlong, pr.along);
  const a = Math.min(1, flAlong/flRoute.len);
  if(!last || t - last.t >= FLOAT_LOG_GAP){
    F.log.push({t, a:Math.round(a*1e5)/1e5});
    if(F.log.length > FLOAT_LOG_MAX) F.log = F.log.filter((_, i) => i === 0 || i % 2 === 0 || i === F.log.length-1);
    flSave();
  }
  flPaintProgress(flRoute, flAlong);
  flRenderLive();
}

function flFinish(){
  clearInterval(flTimer); flTimer = null;
  flWakeRelease();
  F = null; flAlong = 0; flLastT = 0; flRoute = null; flOff = false; flGotFix = false;
  try{ localStorage.removeItem(FLOAT_KEY); }catch(e){}
  flClearRoute();
  flLive.classList.remove("show"); flLive.innerHTML = "";
}
function flEnd(stale){
  if(!F) return;
  if(!stale && !confirm("End this float and save it to your Field Book?")) return;
  const s = SECTIONS.find(x => x.id === F.section), r = RIVERS.find(x => x.id === F.river);
  if(!F.log.length){ flToast("No track was recorded, so nothing was saved"); flFinish(); return; }
  const base = F.log[0].t, last = F.log[F.log.length-1];
  const end = stale ? last.t : Date.now();
  const st = flStats(stale ? last.t : end);
  const gk = r.primaryGauge, f = gk ? flows[gk] : null;
  const ratio = gk ? statusOf(gk).ratio : null;
  const a = last.a;
  const rec = {
    id:F.id, section:F.section, river:F.river, craft:F.craft, start:base, end,
    totalMin:Math.round((end-base)/60000), movingMin:Math.round(st.movMs/60000),
    stoppedMin:Math.round(Math.max(0, end-base-st.movMs)/60000),
    milesDone:Math.round(Math.max(a, flRoute ? flAlong/flRoute.len : 0)*s.miles*10)/10,
    // a reading over a day old isn't the flow you floated on (statusOf gives it no ratio either)
    cfs:f && f.cfs != null && !(typeof readingIsOld === "function" && readingIsOld(f)) ? f.cfs : null,
    ratio:ratio != null ? Math.round(ratio*100)/100 : null,
    completed:Math.max(a, flRoute ? flAlong/flRoute.len : 0) >= 0.9,
  };
  if(!Array.isArray(fbState.floats)) fbState.floats = [];
  fbState.floats.push(rec); fbPersist();
  flFinish();
  flToast(rec.completed ? "Float saved to your Field Book" : "Float saved (not finished, so it won't shape estimates)");
  if(typeof bookEl !== "undefined" && bookEl.classList.contains("show")) showBookTab(bookTab);
}

/* resume after a reload; an old one is offered for saving or discarding */
function flRestore(){
  let o = null;
  try{ o = JSON.parse(localStorage.getItem(FLOAT_KEY) || "null"); }catch(e){}
  if(!o || typeof o !== "object") return;
  const s = SECTIONS.find(x => x.id === o.section);
  if(!s || !floatEligible(s) || !Array.isArray(o.log) || !Number.isFinite(o.start) || !o.planned){
    try{ localStorage.removeItem(FLOAT_KEY); }catch(e){} return;
  }
  F = {id:String(o.id||"x").slice(0,64), section:s.id, river:s.river, craft:CRAFT[o.craft] ? o.craft : "drift", start:o.start,
       planned:{lo:+o.planned.lo||1, hi:+o.planned.hi||2, mid:+o.planned.mid||1.5},
       log:o.log.filter(x => x && Number.isFinite(x.t) && Number.isFinite(x.a)).map(x => ({t:x.t, a:Math.max(0, Math.min(1, x.a))}))};
  flRoute = floatBuildRoute(s);
  const lastT = F.log.length ? F.log[F.log.length-1].t : F.start;
  if(F.log.length) flLastT = F.log[F.log.length-1].t;
  if(!flRoute.error) flAlong = (F.log.length ? F.log[F.log.length-1].a : 0) * flRoute.len;
  if(Date.now() - lastT > FLOAT_STALE_MS){ F.stale = true; flRenderLive(); return; }
  if(flRoute.error){ flToast("Couldn't trace the float route again"); }
  else {
    flDrawRoute(flRoute); flPaintProgress(flRoute, flAlong);
    flFit(flRoute);
  }
  if(locState === "off" && locPerm !== "denied") locStart("located");
  flWakeAcquire();
  flBeginLive();
}

/* ---------- Field Book: Floats tab + import ---------- */
function flRowsHTML(){
  const list = (fbState.floats || []).slice().sort((a,b) => b.start - a.start);
  if(!list.length) return fbEmpty("No floats yet.<br>Open a float section on a river and tap <b>🛶 Start float</b>.");
  return list.map(x => {
    const s = SECTIONS.find(y => y.id === x.section), r = RIVERS.find(y => y.id === x.river);
    return `<div class="bk-row fl-row"><span class="bk-main">
      <span class="bk-name">${fbEsc(s ? s.name : x.section)}</span>
      <span class="bk-place">${fbEsc(new Date(x.start).toLocaleDateString([], {month:"short", day:"numeric", year:"numeric"}))} · ${fbEsc(r ? r.name : x.river)} · ${fbEsc(CRAFT[x.craft] ? CRAFT[x.craft].label : x.craft)}${x.completed ? "" : " · unfinished"}</span>
      <span class="bk-full">Total <b>${fbEsc(flDur(x.totalMin))}</b> · moving ${fbEsc(flDur(x.movingMin))} · stopped ${fbEsc(flDur(x.stoppedMin))}${x.cfs != null ? ` · ${fbEsc(Math.round(x.cfs).toLocaleString())} cfs` : ""}</span>
      </span><button type="button" class="fl-del" data-fldel="${fbEsc(x.id)}" aria-label="Delete this float">×</button></div>`;
  }).join("");
}
BOOK_SECTIONS.splice(Math.max(0, BOOK_SECTIONS.findIndex(s => s.id === "fished")+1), 0,
  {id:"floats", label:"Floats", render(el){ el.innerHTML = flRowsHTML(); }});
bookBody.addEventListener("click", e => {
  const b = e.target.closest("[data-fldel]"); if(!b) return;
  if(!confirm("Delete this float from your Field Book?")) return;
  fbState.floats = (fbState.floats || []).filter(x => x.id !== b.dataset.fldel);
  fbPersist(); showBookTab("floats");
});

/* Import is untrusted input: every field rebuilt, unknown sections skipped,
   duplicates (by id) ignored. Returns how many were added. */
function floatImport(list){
  if(!Array.isArray(list)) return 0;
  const num = (v, lo, hi) => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;
  const have = new Set((fbState.floats || []).map(x => x.id));
  let n = 0;
  for(const e of list.slice(0, 2000)){
    if(!e || typeof e !== "object") continue;
    const s = typeof e.section === "string" ? SECTIONS.find(x => x.id === e.section) : null;
    if(!s || typeof e.id !== "string" || !e.id || e.id.length > 64 || have.has(e.id)) continue;
    if(!num(e.start, 1e12, 4e12) || !num(e.end, e.start, 4e12) || !num(e.totalMin, 0, 20000) ||
       !num(e.movingMin, 0, 20000) || !num(e.stoppedMin, 0, 20000) || !num(e.milesDone, 0, 1000)) continue;
    const rec = {
      id:e.id, section:s.id, river:s.river, craft:CRAFT[e.craft] ? e.craft : "drift",
      start:e.start, end:e.end, totalMin:e.totalMin, movingMin:e.movingMin, stoppedMin:e.stoppedMin, milesDone:e.milesDone,
      cfs:num(e.cfs, 0, 1e7) ? e.cfs : null, ratio:num(e.ratio, 0, 100) ? e.ratio : null,
      completed:e.completed === true,
    };
    if(!Array.isArray(fbState.floats)) fbState.floats = [];
    fbState.floats.push(rec); have.add(rec.id); n++;
  }
  if(n) fbPersist();
  return n;
}

flRestore();
