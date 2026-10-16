/* Lake trips — Field Book part 3a (2026-10-16). "Start fishing" on a pilot
   lake records where you went: a planner (launch and craft), a live panel
   (time on the water, distance, moving and stopped), and on End an ordinary
   Field Book trip that carries the track. Modelled on Float Mode (float.js),
   and the two never run at once.

   Loads after app.js and float.js and uses their globals (LAKES, RAMPS, map,
   goTo, focusFrame, lakeShapes, fbState, fbPersist, fbSnapTrip, fbNewId,
   fbEsc, fbRowPaint, fbRowGoPaint, locStart, locState, locPerm, locLast,
   encodePolyline, encodeDeltas, decodePolyline, floatBusy…). app.js reaches
   back only through guarded hooks: lakeOnFix (every location fix),
   lakeTripActiveNow / lakeTripBusy (one recorder at a time), lakeTripPilot,
   lakeTripButton and lakeTripOpenPlanner (the Field Book row),
   lakeTripLiveTrip / lakeTripSaveLive (a forecast that lands mid-trip), and
   lakeTripSummary / lakeTripToggleShow / lakeTripShownId / lakeTripHideShown
   (the Trips list).

   What is stored: this is the one place the app keeps positions. The live
   trip sits in localStorage.lakeTripActive, rewritten at every logged point
   so a reload resumes it; an ended one is a trip in fbState.trips with a
   `track` (see the Field Book comment in app.js). Both stay on this phone.
   Nothing is uploaded and there is no export, and the planner and the
   location wording say the track is saved here.

   iPhone limits: a web app gets no location once the screen locks or the app
   goes to the background. So the screen is held on with no opt-out (a
   float's is optional), the lock is asked for again whenever the app comes
   back, and a gap of more than two minutes between fixes starts a new
   segment. A gap is drawn as a gap, never as a line across the water. */

const LAKETRIP_LAKES = ["bigcreeklake","saylorvillelake"];   // the pilot gate (owner's scope, 2026-10-16)
const LT_CRAFT = {canoe:"Canoe", kayak:"Kayak", boat:"Boat", tube:"Float tube", shore:"Shore"};
const LT_CRAFT_KEYS = Object.keys(LT_CRAFT);
const LT_MAX_ACC   = 50;          // metres; a looser fix is dropped
const LT_STEP_M    = 15;          // log a point once we are this far from the last one…
const LT_STEP_MS   = 60000;       // …or this long after it, which is what keeps the stops
const LT_GAP_MS    = 120000;      // longer than this between accepted fixes: a new segment
const LT_STOP_MPH  = 0.4;         // slower than this between two points counts as stopped
const LT_STOP_MS   = 3*60000;     // a stretch that slow is a stop from three minutes
const LT_PAUSE_MS  = 5*60000;     // how long the "Paused…" line stays up after a gap
const LT_STALE_MS  = 18*3600e3;   // like a float: a day-old trip is saved or discarded, not resumed
const LT_NEAR_KM   = 0.5;         // the nearest launch is preselected only when you are this close
const LT_KEY = "lakeTripActive", LT_CRAFT_STORE = "lakeCraft";

/* ---------- small helpers ---------- */
const ltHav = (a, b) => {           // km between [lat,lng,…] points
  const R = 6371, rad = Math.PI/180;
  const dLa = (b[0]-a[0])*rad, dLo = (b[1]-a[1])*rad;
  const h = Math.sin(dLa/2)**2 + Math.cos(a[0]*rad)*Math.cos(b[0]*rad)*Math.sin(dLo/2)**2;
  return 2*R*Math.asin(Math.min(1, Math.sqrt(h)));
};
const ltR5 = v => Math.round(v*1e5)/1e5;    // the precision the track is stored at
const ltMi = km => (km*0.621371).toFixed(1);
const ltDurS = min => { min = Math.max(0, Math.round(min)); return min < 60 ? min + "m" : Math.floor(min/60) + "h " + String(min%60).padStart(2,"0") + "m"; };
const ltDay = d => d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
const ltHM = d => String(d.getHours()).padStart(2,"0") + ":" + String(d.getMinutes()).padStart(2,"0");
const ltLake = id => (typeof LAKES === "undefined" ? [] : LAKES).find(k => k.id === id);
const ltFloatBusy = () => typeof floatBusy === "function" && floatBusy();
function ltToast(msg){               // the same toast element as Float Mode's
  let t = document.getElementById("floattoast");
  if(!t){ t = document.body.appendChild(document.createElement("div")); t.id = "floattoast"; t.setAttribute("role","status"); }
  t.textContent = msg; t.classList.add("show");
  clearTimeout(ltToast.t); ltToast.t = setTimeout(() => t.classList.remove("show"), 3500);
}
function ltCraft(){
  try{ const c = localStorage.getItem(LT_CRAFT_STORE); if(LT_CRAFT[c]) return c; }catch(e){}
  return LT_CRAFT_KEYS[0];
}
// the Field Book row and an open river's Start float button follow the recorder's state
function ltRowPaint(){
  if(fbRowPaint) fbRowPaint();
  if(curRiver){ const r = RIVERS.find(x => x.id === curRiver); if(r) renderSheet(r); }
}

/* ---------- state, for app.js ---------- */
let LT = null;   // {lake, craft, ramp, start, trip, segs:[[ [lat,lng,t], … ], …], stale?}
function lakeTripPilot(id){ return LAKETRIP_LAKES.includes(id); }
function lakeTripActiveNow(){ return !!LT && !LT.stale; }
function lakeTripBusy(){ return !!LT; }            // running, or an unfinished one waiting to be saved
/* What the lake's button says. One recorder at a time: while a float runs it
   says so and does nothing, and while any lake trip runs it reads "Trip
   running" (a tap brings its panel back). */
function lakeTripButton(id){
  if(LT) return {label: LT.stale ? "Unfinished trip" : "Trip running", state:"running"};
  if(ltFloatBusy()) return {label:"Float running", state:"blocked"};
  return {label:"Start fishing", state:"idle"};
}
/* The trip being recorded, so a forecast that arrives after Start can still
   be filled in (fbWxSettle) before it reaches the book. */
/* syncMarkers() hides this lake's pins, all but the chosen launch, while it records. */
function lakeTripPinKeep(){ return LT && !LT.stale ? {lake:LT.lake, ramp:LT.ramp} : null; }
function lakeTripLiveTrip(id){ return LT && LT.trip && LT.trip.id === id ? LT.trip : null; }
function lakeTripSaveLive(){ ltSave(); }

/* ---------- the map: live track and a saved one ---------- */
const ltPane = map.createPane("lakeTripPane");
ltPane.style.zIndex = 416;           // over the rivers (410) and a float's route (415), under the markers (600)
ltPane.style.pointerEvents = "none";
/* One look for a live and a saved track: a dark line on a white casing,
   which reads on the lake's pale fill and on the topo alike. Each segment is
   its own piece of a multi-polyline, so a gap stays a gap. Stops are hollow
   dots on the line; the start is green and the end brown, like a float's
   put-in and take-out. */
function ltTrackLayer(lines, stops, start, end){
  const o = {pane:"lakeTripPane", lineCap:"round", lineJoin:"round", interactive:false};
  const casing = L.polyline(lines, Object.assign({color:"#fff", weight:7, opacity:.85}, o));
  const line = L.polyline(lines, Object.assign({color:"#0b4f6c", weight:3.5, opacity:1}, o));
  const g = L.layerGroup([casing, line]);
  g.lines = [casing, line];          // so a live track can grow without being rebuilt
  const dot = (p, fill, r) => L.circleMarker(p, {pane:"lakeTripPane", radius:r, color:fill === "#fff" ? "#0b4f6c" : "#fff",
    weight:fill === "#fff" ? 2.5 : 3, fillColor:fill, fillOpacity:1, interactive:false}).addTo(g);
  stops.forEach(s => dot([s.lat, s.lng], "#fff", 6));
  if(start) dot(start, "#1d7a46", 7);
  if(end) dot(end, "#8c4a1d", 7);
  return g;
}
let ltLiveLayer = null;
function ltClearLive(){ if(ltLiveLayer){ map.removeLayer(ltLiveLayer); ltLiveLayer = null; } }
// the segments as recorded, with the latest fix not yet logged on the end of the last
function ltSegsNow(){
  const segs = LT.segs.map(s => s.slice());
  if(ltTail && segs.length){ const s = segs[segs.length-1], last = s[s.length-1]; if(!last || ltTail[2] > last[2]) s.push(ltTail); }
  return segs;
}
/* Called at every fix, so the line is updated in place; the layer is only
   rebuilt when the dots change (a stop appears or grows, or the first point). */
function ltDraw(){
  if(!LT || LT.stale){ ltClearLive(); return; }
  const segs = ltSegsNow(), st = ltStatsNow();
  const lines = segs.filter(s => s.length > 1).map(s => s.map(p => [p[0], p[1]]));
  const first = segs.length && segs[0].length ? [segs[0][0][0], segs[0][0][1]] : null;
  const key = (first ? first.join(",") : "") + "|" + st.stops.map(s => s.t + ":" + s.ms).join(",");
  if(ltLiveLayer && ltLiveLayer.key === key){ ltLiveLayer.lines.forEach(l => l.setLatLngs(lines)); return; }
  ltClearLive();
  ltLiveLayer = ltTrackLayer(lines, st.stops, first, null).addTo(map);
  ltLiveLayer.key = key;
}
/* Fit into the part of the map a card at the bottom leaves clear. */
function ltFit(b, card){
  const bar = document.getElementById("appbar"), size = map.getSize();
  const top = (bar ? bar.offsetHeight : 0) + 12;
  if(window.innerWidth >= 900){
    // a wide screen has the card beside the map's lower left, not across it
    goTo(b, null, {paddingTopLeft:L.point((card ? card.offsetWidth : 0) + 30, top), paddingBottomRight:L.point(16, 16), maxZoom:16});
    return;
  }
  const bottom = Math.max(16, Math.min((card ? card.offsetHeight : 0) + 24, size.y - top - 120));
  goTo(b, null, {paddingTopLeft:L.point(16, top), paddingBottomRight:L.point(16, bottom), maxZoom:16});
}

/* Saved trips, from the Trips list: drawn over the lake until the sheet
   closes or another water's sheet replaces it. */
let ltShown = null;                  // {id, layer}
function lakeTripShownId(){ return ltShown ? ltShown.id : null; }
function lakeTripHideShown(){
  if(!ltShown) return false;
  map.removeLayer(ltShown.layer); ltShown = null;
  return true;
}
function lakeTripToggleShow(t, lake){
  if(ltShown && ltShown.id === t.id){ lakeTripHideShown(); return; }
  lakeTripHideShown();
  const tr = t && t.track;
  if(!tr || !Array.isArray(tr.segs)) return;
  const segs = tr.segs.filter(s => typeof s === "string")
    .map(s => decodePolyline(s).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1])))
    .filter(s => s.length);
  const pts = [].concat(...segs);
  if(!pts.length){ ltToast("This trip has no track to show"); return; }
  const stops = (Array.isArray(tr.stops) ? tr.stops : []).filter(s => s && Number.isFinite(s.lat) && Number.isFinite(s.lng));
  const last = segs[segs.length-1];
  ltShown = {id:t.id, layer:ltTrackLayer(segs.filter(s => s.length > 1), stops, segs[0][0], last[last.length-1]).addTo(map)};
  const {tl, br} = focusFrame();
  goTo(L.latLngBounds(pts).pad(0.12), null, {paddingTopLeft:tl, paddingBottomRight:br, maxZoom:16});
}
(function(){
  const sh = document.getElementById("sheet");
  if(!sh || !window.MutationObserver) return;
  new MutationObserver(() => {
    if(!sh.classList.contains("open") && lakeTripHideShown() && fbRowPaint) fbRowPaint();   // its button reads "Show on map" again
  }).observe(sh, {attributes:true, attributeFilter:["class"]});
})();

/* "Tracked · 2h 14m · 3.1 mi · Kayak · from 100th St. Boat Ramp" */
function lakeTripSummary(t){
  const tr = (t && t.track) || {}, parts = ["Tracked"];
  if(Number.isFinite(tr.end) && Number.isFinite(t.at) && tr.end >= t.at) parts.push(ltDurS((tr.end - t.at)/60000));
  if(Number.isFinite(tr.km)) parts.push(ltMi(tr.km) + " mi");
  if(LT_CRAFT[tr.craft]) parts.push(LT_CRAFT[tr.craft]);
  const ramp = typeof tr.ramp === "string" && RAMPS.find(p => p.id === tr.ramp);
  if(ramp) parts.push("from " + ramp.name);
  return parts.join(" · ");
}

/* ---------- planner ---------- */
const ltPlan = document.body.appendChild(document.createElement("section"));
ltPlan.id = "lakeplan"; ltPlan.className = "floatcard"; ltPlan.setAttribute("aria-label","Start a lake trip");
let ltPlanLake = null;

const ltDistText = km => km < 0.16 ? Math.max(10, Math.round(km*3280.84/10)*10) + " ft" : ltMi(km) + " mi";
/* The lake's own access pins. Nearest first when a fix is in memory, with
   the distance, since many of them are just called "Parking"; by name
   otherwise. The nearest is only preselected when you are standing by it:
   a launch you aren't at would be a wrong fact in the book, so otherwise the
   choice starts at "Where I am now". */
function ltLaunchOptions(lake){
  const pins = RAMPS.filter(p => p.lake === lake.id && Array.isArray(p.pos));
  const here = locLast ? [locLast.lat, locLast.lng] : null;
  let list;
  if(here) list = pins.map(p => ({p, km:ltHav(here, p.pos)})).sort((a,b) => a.km - b.km);
  else list = pins.map(p => ({p, km:null})).sort((a,b) => a.p.name.localeCompare(b.p.name));
  const near = here && list.length && list[0].km <= LT_NEAR_KM ? list[0].p.id : "";
  return `<option value=""${near ? "" : " selected"}>Where I am now</option>` + list.map(x =>
    `<option value="${fbEsc(x.p.id)}"${x.p.id === near ? " selected" : ""}>${fbEsc(x.p.name)}${x.km != null ? " · " + fbEsc(ltDistText(x.km)) : ""}</option>`).join("");
}
function ltRenderPlanner(){
  const k = ltPlanLake, craft = ltCraft();
  ltPlan.innerHTML = `
    <div class="fp-head"><div><h3>${fbEsc(k.name)}</h3>
      <div class="fp-meta">Record where you fish today</div></div>
      <button class="x" id="lp-x" type="button" aria-label="Close">✕</button></div>
    <label class="fp-launch lp-launch">Launch <select id="lp-ramp">${ltLaunchOptions(k)}</select></label>
    <div class="fp-craft lp-craft" role="radiogroup" aria-label="Craft">${LT_CRAFT_KEYS.map(c =>
      `<button type="button" role="radio" aria-checked="${c===craft}" data-craft="${c}" class="${c===craft?"on":""}">${LT_CRAFT[c]}</button>`).join("")}</div>
    <ul class="lp-info">
      <li>The screen stays on while the trip records.</li>
      <li>Locking the phone or switching apps pauses the track until you come back.</li>
      <li>GPS with the screen on uses battery. On a long day it adds up.</li>
      <li><b>The track is saved on this phone, in your Field Book.</b></li>
    </ul>
    ${locPerm === "denied" ? `<div class="fp-warn">Location is blocked for this site, so a track can't be recorded.</div>` : ""}
    <div class="fp-btns">
      <button type="button" class="go" id="lp-start">Start fishing</button>
      <button type="button" id="lp-cancel">Cancel</button>
    </div>`;
}
function ltClosePlanner(){ ltPlan.classList.remove("show"); ltPlanLake = null; }
function lakeTripOpenPlanner(id){
  const k = ltLake(id);
  if(!k || !lakeTripPilot(k.id)) return;
  if(LT){
    ltToast(LT.stale ? "Save or discard the unfinished trip first" : "A lake trip is already running");
    ltCollapsed = false; ltRenderLive(); return;
  }
  if(ltFloatBusy()){ ltToast("A float is in progress — end it before starting a lake trip"); return; }
  ltPlanLake = k;
  ltRenderPlanner();
  ltPlan.classList.add("show");
  if(window.innerWidth < 900) sheet.classList.remove("open");   // like Start float: show the lake, not the sheet
  const s = lakeShapes[k.id];
  if(s) ltFit(s.poly.getBounds(), ltPlan);
}
ltPlan.addEventListener("click", e => {
  const b = e.target.closest("button"); if(!b || !ltPlanLake) return;
  if(b.dataset.craft){
    try{ localStorage.setItem(LT_CRAFT_STORE, b.dataset.craft); }catch(err){}
    ltPlan.querySelectorAll("[data-craft]").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-checked", on); });
  } else if(b.id === "lp-x" || b.id === "lp-cancel") ltClosePlanner();
  else if(b.id === "lp-start") ltStart();
});

/* ---------- recording ---------- */
let ltLastT = 0;        // time of the last ACCEPTED fix (logged or not): what a gap is measured from
let ltLastWall = 0;     // when it arrived, by this phone's clock: the "last fix" age
let ltTail = null;      // the last accepted fix that wasn't logged — where we really are right now
let ltGotFix = false, ltLoose = 0, ltPause = null, ltWasHidden = false, ltSaveFailed = false;
let ltStats_ = null;    // cached totals for the panel and the map, dropped at every accepted fix
let ltTimer = null, ltWake = null, ltCollapsed = false;
function ltResetMem(){
  ltLastT = 0; ltLastWall = 0; ltTail = null; ltGotFix = false; ltLoose = 0; ltPause = null;
  ltWasHidden = false; ltSaveFailed = false; ltStats_ = null; ltCollapsed = false;
}

/* The trip that survives a reload. Returns whether the write landed: a full
   storage shows on the panel rather than failing silently. */
function ltSave(){
  if(!LT) return true;
  const o = {v:1, lake:LT.lake, craft:LT.craft, ramp:LT.ramp, start:LT.start, trip:LT.trip, segs:LT.segs};
  try{ localStorage.setItem(LT_KEY, JSON.stringify(o)); ltSaveFailed = false; return true; }
  catch(e){ ltSaveFailed = true; return false; }
}

/* No opt-out, unlike a float: a locked screen is a gap in the track. */
async function ltWakeAcquire(){
  if(!("wakeLock" in navigator) || !LT || LT.stale || ltWake || document.visibilityState !== "visible") return;
  try{ ltWake = await navigator.wakeLock.request("screen"); ltWake.addEventListener("release", () => { ltWake = null; }); }catch(e){}
}
function ltWakeRelease(){ if(ltWake){ try{ ltWake.release(); }catch(e){} ltWake = null; } }
document.addEventListener("visibilitychange", () => {
  if(!LT || LT.stale) return;
  if(document.visibilityState === "hidden") ltWasHidden = true;   // the next gap is the app's, not the GPS's
  else { ltWakeAcquire(); ltRenderLive(); }                        // iOS drops the lock in the background
});
// A lock asked for without a tap (after a reload) can be refused; any tap is a second chance.
document.addEventListener("pointerdown", () => { if(LT && !LT.stale && !ltWake) ltWakeAcquire(); }, {passive:true});

function ltStart(){
  const k = ltPlanLake;
  if(!k || LT) return;
  if(ltFloatBusy()){ ltToast("A float is in progress — end it before starting a lake trip"); return; }
  if(!navigator.geolocation || !window.isSecureContext){ ltToast("Location isn't available here, so a track can't be recorded"); return; }
  if(locPerm === "denied"){ locBlockedSay(); return; }
  const sel = document.getElementById("lp-ramp");
  const ramp = sel && sel.value && RAMPS.some(p => p.id === sel.value && p.lake === k.id) ? sel.value : null;
  const start = Date.now(), d = new Date(start);
  // an ordinary tap trip: its day, time and `at` are the moment of this tap
  const trip = {id:fbNewId(), kind:"lake", water:k.id, day:ltDay(d), time:ltHM(d), src:"tap", at:start};
  LT = {lake:k.id, craft:ltCraft(), ramp, start, trip, segs:[]};
  ltResetMem();
  ltClosePlanner();
  // The tap on Start is the user gesture iOS wants before asking for location.
  if(locState === "off") locStart("following");
  ltWakeAcquire();
  // the conditions at the start, from what the app already has — exactly as ✓ Fished does
  fbSnapTrip(trip, "lake", k);
  ltSave();
  ltBeginLive();
  ltDraw();
  ltRowPaint();
  if(typeof syncMarkers === "function") syncMarkers();
}
function ltBeginLive(){
  ltRenderLive();
  clearInterval(ltTimer); ltTimer = setInterval(ltRenderLive, 5000);   // the clock and the fix age
}

/* One location fix. Fixes looser than 50 m are dropped. A point is logged
   when it is 15 m from the last logged one or a minute after it, so a stop
   still leaves a point a minute. More than two minutes since the last
   accepted fix starts a new segment. */
function lakeOnFix(pos){
  if(!LT || LT.stale || !pos || !pos.coords) return;
  const c = pos.coords;
  if(!(c.accuracy <= LT_MAX_ACC)){ ltLoose = Math.round(c.accuracy) || 0; ltRenderLive(); return; }
  if(!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
  const t = Number.isFinite(pos.timestamp) ? pos.timestamp : Date.now();
  if(ltLastT && t <= ltLastT) return;            // a repeated or out-of-order fix
  ltLoose = 0;
  const p = [ltR5(c.latitude), ltR5(c.longitude), t];
  let seg = LT.segs.length ? LT.segs[LT.segs.length-1] : null;
  if(ltLastT && t - ltLastT > LT_GAP_MS){
    // Nothing was recorded for a while: the app was in the background, the
    // screen locked, or there was no usable fix. End this stretch where we
    // really last were and start a new one.
    ltFlushTail();
    seg = null;
    ltPause = {min:Math.round((t - ltLastT)/60000), bg:ltWasHidden, at:Date.now()};
  }
  ltWasHidden = false;
  if(!seg){ seg = []; LT.segs.push(seg); }
  const last = seg[seg.length-1];
  const log = !last || ltHav(last, p)*1000 >= LT_STEP_M || t - last[2] >= LT_STEP_MS;
  if(log){ seg.push(p); ltTail = null; }
  else ltTail = p;
  ltLastT = t; ltLastWall = Date.now(); ltGotFix = true; ltStats_ = null;
  if(log) ltSave();
  ltDraw();
  ltRenderLive();
}
/* The last accepted fix, onto the end of the stretch it belongs to, before a
   gap or at End. */
function ltFlushTail(){
  if(ltTail && LT && LT.segs.length){
    const seg = LT.segs[LT.segs.length-1], last = seg[seg.length-1];
    if(!last || ltTail[2] > last[2]) seg.push(ltTail);
  }
  ltTail = null; ltStats_ = null;
}

/* Totals, only ever within a segment: the time and distance across a gap are
   unknown, so they are neither moving nor stopped and add no miles. A pair of
   points slower than 0.4 mph is stopped time, and a run of them lasting three
   minutes is a stop, placed at the middle of its points. */
function ltStats(segs){
  let km = 0, movMs = 0, stopMs = 0;
  const stops = [];
  for(const s of segs){
    let run = -1;
    const close = end => {
      if(run < 0) return;
      const ms = s[end][2] - s[run][2];
      if(ms >= LT_STOP_MS){
        let la = 0, lo = 0;
        for(let j = run; j <= end; j++){ la += s[j][0]; lo += s[j][1]; }
        const n = end - run + 1;
        stops.push({lat:la/n, lng:lo/n, t:s[run][2], ms});
      }
      run = -1;
    };
    for(let i = 1; i < s.length; i++){
      const dt = s[i][2] - s[i-1][2]; if(dt <= 0) continue;
      const d = ltHav(s[i-1], s[i]); km += d;
      if(d*0.621371 / (dt/3600e3) >= LT_STOP_MPH){ movMs += dt; close(i-1); }
      else { stopMs += dt; if(run < 0) run = i-1; }
    }
    close(s.length-1);
  }
  return {km, movMs, stopMs, stops};
}
function ltStatsNow(){ return ltStats_ || (ltStats_ = ltStats(ltSegsNow())); }

/* ---------- live panel ----------
   Built once per mode (full card, collapsed pill, unfinished), then only its
   numbers change, so a fix landing mid-tap can't swap the End button out
   from under a finger. */
const ltLive = document.body.appendChild(document.createElement("section"));
ltLive.id = "laketrip"; ltLive.className = "floatcard"; ltLive.setAttribute("aria-label","Lake trip in progress");

function ltShell(mode){
  const k = ltLake(LT.lake), name = k ? k.name : LT.lake;
  if(mode === "stale") return `<div class="fl-head"><b>Unfinished lake trip</b></div>
    <p class="fl-note">${fbEsc(name)} was started ${fbEsc(new Date(LT.start).toLocaleString([], {month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}))} and never ended. Save what was recorded, or discard it?</p>
    <div class="fl-btns"><button type="button" class="go" data-lt="save">Save it</button><button type="button" data-lt="discard">Discard</button></div>`;
  if(mode === "pill") return `<button type="button" class="fl-pill" data-lt="expand"><span class="mono" data-v="pill"></span><span class="fl-up">▲</span></button>`;
  const wake = "wakeLock" in navigator
    ? "The screen stays on while this records."
    : "This browser can't hold the screen on, so stop it locking while you fish.";
  return `
    <div class="fl-head"><span class="fl-title">${fbEsc(name)} · ${fbEsc(LT_CRAFT[LT.craft])}</span>
      <button type="button" class="fl-min" data-lt="collapse" aria-label="Collapse">▼</button></div>
    <div class="fl-eta"><span class="lbl">On the water</span><span class="mono big" data-v="elapsed"></span></div>
    <div class="fl-grid">
      <div><span class="mono" data-v="mi"></span><i>miles</i></div>
      <div><span class="mono" data-v="mov"></span><i>moving</i></div>
      <div><span class="mono" data-v="stop"></span><i>stopped</i></div>
    </div>
    <div class="lt-status" data-v="status"></div>
    <p class="fl-note">${wake} Locking the phone or switching apps pauses the track. The track is saved on this phone, in your Field Book.</p>
    <div class="fl-btns"><button type="button" class="end" data-lt="end">End trip</button></div>`;
}
function ltAgo(ms){
  const s = Math.max(0, Math.round(ms/1000));
  return s < 10 ? "just now" : s < 60 ? s + " s ago" : Math.round(s/60) + " min ago";
}
function ltStatusHTML(){
  const lines = [], line = (txt, warn) => `<div${warn ? ' class="warn"' : ""}>${fbEsc(txt)}</div>`;
  if(locState === "off") lines.push(line(locPerm === "denied"
    ? "Location is blocked for this site, so nothing is being recorded."
    : "Location is off. Tap the locate button to keep recording.", true));
  else if(!ltGotFix) lines.push(line(ltLoose ? `Waiting for a closer GPS fix (±${ltLoose} m)…` : "Waiting for GPS…"));
  else lines.push(line(`Last fix ${ltAgo(Date.now() - ltLastWall)}${ltLoose ? ` · GPS rough right now (±${ltLoose} m)` : ""}`));
  if(ltPause && Date.now() - ltPause.at < LT_PAUSE_MS)
    lines.push(line(ltPause.bg ? `Paused for ${ltPause.min} min, the app was in the background.`
                               : `Paused for ${ltPause.min} min with no GPS fix.`));
  if(ltSaveFailed) lines.push(line("This phone's storage is full, so the track isn't being saved. Keep the app open until you End.", true));
  return lines.join("");
}
function ltRenderLive(){
  if(!LT){ ltLive.classList.remove("show"); return; }
  const mode = LT.stale ? "stale" : ltCollapsed ? "pill" : "full";
  if(ltLive.dataset.mode !== mode){ ltLive.dataset.mode = mode; ltLive.innerHTML = ltShell(mode); }
  ltLive.classList.toggle("collapsed", mode === "pill");
  ltLive.classList.add("show");
  if(mode === "stale") return;
  const st = ltStatsNow(), el = ltDurS((Date.now() - LT.start)/60000);
  const set = (k, v) => { const x = ltLive.querySelector(`[data-v="${k}"]`); if(x) x.textContent = v; };
  if(mode === "pill"){ set("pill", `${el} · ${ltMi(st.km)} mi`); return; }
  set("elapsed", el); set("mi", ltMi(st.km));
  set("mov", ltDurS(st.movMs/60000)); set("stop", ltDurS(st.stopMs/60000));
  const s = ltLive.querySelector('[data-v="status"]'), h = ltStatusHTML();
  if(s && s.innerHTML !== h) s.innerHTML = h;
}
ltLive.addEventListener("click", e => {
  const b = e.target.closest("[data-lt]"); if(!b || !LT) return;
  const act = b.dataset.lt;
  if(act === "collapse"){ ltCollapsed = true; ltRenderLive(); }
  else if(act === "expand"){ ltCollapsed = false; ltRenderLive(); }
  else if(act === "end") ltEnd(false);
  else if(act === "save") ltEnd(true);
  else if(act === "discard"){ if(confirm("Discard this lake trip? Its track won't be saved.")) ltFinish(); }
});

/* ---------- end ---------- */
function ltFinish(){
  clearInterval(ltTimer); ltTimer = null;
  ltWakeRelease();
  LT = null; ltResetMem();
  try{ localStorage.removeItem(LT_KEY); }catch(e){}
  ltClearLive();
  ltLive.classList.remove("show", "collapsed"); ltLive.innerHTML = ""; delete ltLive.dataset.mode;
  ltRowPaint();
  if(typeof syncMarkers === "function") syncMarkers();
}
/* Save to the book. If the book can't be written (storage full) the trip is
   taken back out and stays live, so nothing recorded is thrown away. */
function ltEnd(stale){
  if(!LT) return;
  if(!stale && !confirm("End this trip and save it to your Field Book?")) return;
  ltFlushTail();
  const segs = LT.segs.filter(s => s.length);
  if(!segs.length){ ltToast("No track was recorded, so nothing was saved"); ltFinish(); return; }
  const at = LT.trip.at, lastSeg = segs[segs.length-1], lastT = lastSeg[lastSeg.length-1][2];
  const end = stale ? Math.max(at, lastT) : Math.max(Date.now(), lastT);
  const st = ltStats(segs);
  const t = Object.assign({}, LT.trip, {track:{
    craft:LT.craft, ramp:LT.ramp || null, end,
    km:Math.round(st.km*100)/100, movMin:Math.round(st.movMs/60000), stopMin:Math.round(st.stopMs/60000),
    segs:segs.map(s => encodePolyline(s)),
    tt:segs.map(s => encodeDeltas(s.map(p => (p[2] - at)/1000))),   // seconds since the start, per point
    stops:st.stops.map(x => ({lat:ltR5(x.lat), lng:ltR5(x.lng), t:Math.round((x.t - at)/1000), min:Math.round(x.ms/60000)})),
  }});
  fbState.trips.push(t);
  if(!fbPersist()){
    fbState.trips = fbState.trips.filter(x => x !== t);
    ltSave(); ltDraw(); ltRenderLive();
    alert("This trip couldn't be saved: the app's storage on this phone is full. " +
      (stale ? "It is kept, so you can try again." : "It is still recording, so nothing is lost yet. Try End again later."));
    return;
  }
  ltFinish();
  ltToast("Trip saved to your Field Book");
  if(typeof bookEl !== "undefined" && bookEl.classList.contains("show")) showBookTab(bookTab);
}

/* ---------- resume after a reload ----------
   An old one (no point for 18 h) is offered for saving or discarding, like
   an unfinished float. */
function ltRestore(){
  let o = null;
  try{ o = JSON.parse(localStorage.getItem(LT_KEY) || "null"); }catch(e){}
  if(!o || typeof o !== "object") return;
  const k = ltLake(o.lake), tr = o.trip, num = Number.isFinite;
  if(!k || !lakeTripPilot(k.id) || !num(o.start) || !Array.isArray(o.segs) || !tr || typeof tr !== "object" || typeof tr.id !== "string" || !tr.id){
    try{ localStorage.removeItem(LT_KEY); }catch(e){} return;
  }
  const segs = o.segs.filter(Array.isArray)
    .map(s => s.filter(p => Array.isArray(p) && num(p[0]) && num(p[1]) && num(p[2])).map(p => [p[0], p[1], p[2]]))
    .filter(s => s.length);
  const d = new Date(o.start);
  LT = {lake:k.id, craft:LT_CRAFT[o.craft] ? o.craft : LT_CRAFT_KEYS[0],
        ramp:typeof o.ramp === "string" && RAMPS.some(p => p.id === o.ramp && p.lake === k.id) ? o.ramp : null,
        start:o.start, segs,
        trip:{id:tr.id.slice(0, 64), kind:"lake", water:k.id, day:ltDay(d), time:ltHM(d), src:"tap", at:o.start}};
  if(tr.cond && typeof tr.cond === "object" && !Array.isArray(tr.cond)) LT.trip.cond = tr.cond;
  ltResetMem();
  const lastSeg = segs[segs.length-1];
  ltLastT = lastSeg ? lastSeg[lastSeg.length-1][2] : 0;
  ltWasHidden = true;               // the app was closed: the next gap is the app's, not the GPS's
  if(Date.now() - (ltLastT || LT.start) > LT_STALE_MS){ LT.stale = true; ltRenderLive(); return; }
  if(typeof hideZones === "function") hideZones();   // the lake, not the state chooser
  ltDraw();
  if(locState === "off" && locPerm !== "denied") locStart("located");
  ltWakeAcquire();
  ltBeginLive();
  const pts = [].concat(...segs).map(p => [p[0], p[1]]);
  const s = lakeShapes[k.id];
  if(pts.length) ltFit(L.latLngBounds(pts).pad(0.15), ltLive);
  else if(s) ltFit(s.poly.getBounds(), ltLive);
}

ltRestore();
if(typeof syncMarkers === "function") syncMarkers();   // a resumed trip hides its lake's pins too
