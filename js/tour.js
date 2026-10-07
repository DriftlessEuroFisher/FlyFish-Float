/* Welcome card + guided tour. Loads after app.js and float.js.

   First launch shows the welcome card (localStorage.welcomeSeen); "?tour=1"
   forces it for testing. While it is up, app.js holds back its own location
   ask (welcomePending) and takes it up again through locAskLater().

   The tour is a spotlight: a ring whose huge box-shadow dims everything
   else, and a tooltip placed above or below it. Targets are looked up fresh
   on every step, because the sheet re-renders itself when stats arrive and
   would leave a held element reference pointing at a detached node. A step
   whose target is missing or hidden is skipped silently. The tour only
   highlights: it never starts a float, favourites anything or writes to the
   Field Book.

   Two parts, tagged on the steps: "Map" (the controls) and "River" (the Snake
   in the sheet, as an example). A checkpoint card between them lets someone
   stop at the map; it and the finish card are centred, number-less and have
   no target. */

(function(){
  const $ = s => document.querySelector(s);
  const seenGet = () => { try{ return localStorage.getItem("welcomeSeen") === "1"; }catch(e){ return false; } };
  const seenSet = () => { try{ localStorage.setItem("welcomeSeen", "1"); }catch(e){} };
  const forced = /[?&]tour=1\b/.test(location.search);
  let welcomeOn = forced || !seenGet();       // read by app.js through welcomePending()
  window.welcomePending = () => welcomeOn;

  /* ---------- welcome card ---------- */
  const welcome = document.body.appendChild(document.createElement("div"));
  welcome.id = "welcome"; welcome.setAttribute("role", "dialog"); welcome.setAttribute("aria-modal", "true");
  welcome.setAttribute("aria-label", "Welcome");
  welcome.innerHTML = `<div class="wl-card">
    <h2>Welcome — we’re excited you’re here.</h2>
    <p>This is live river flows, regulations and access for fly fishing, built for one question: <b>is it worth driving out today?</b></p>
    <p>An honest note: not every region is developed at the same rate, and we’re working on it. The areas with the most focus right now are <b>Jackson Hole and Swan Valley</b>, along with the <b>NE Iowa Driftless</b>.</p>
    <p>If you’d like to keep testing, send us a note with the report button (the flag, top right) and we’ll add more detail to your home water.</p>
    <div class="wl-btns"><button type="button" id="wl-go">Take the tour</button><button type="button" id="wl-skip">Skip for now</button></div>
  </div>`;
  function closeWelcome(){
    welcome.classList.remove("show"); welcomeOn = false; seenSet();
  }
  function showWelcome(){ welcome.classList.add("show"); const b = $("#wl-go"); if(b) b.focus({preventScroll:true}); }
  $("#wl-skip").addEventListener("click", () => { closeWelcome(); if(typeof locAskLater === "function") locAskLater(); });
  $("#wl-go").addEventListener("click", () => { closeWelcome(); startTour(); });
  if(welcomeOn) setTimeout(() => { if(welcomeOn) showWelcome(); }, 500);

  /* ---------- tour ---------- */
  const PAD = 6, GAP = 10, EDGE = 8;
  const ring = document.body.appendChild(document.createElement("div")); ring.id = "tour-ring";
  const block = document.body.appendChild(document.createElement("div")); block.id = "tour-block";
  const tip = document.body.appendChild(document.createElement("div")); tip.id = "tour-tip";
  tip.setAttribute("role", "dialog"); tip.setAttribute("aria-label", "Tour");
  tip.innerHTML = `<div class="tt-top"><span class="tt-n"></span><button type="button" class="tt-end">✕ End tour</button></div>
    <h3></h3><p class="tt-text"></p><div class="tt-extra"></div>
    <div class="tt-nav"><button type="button" class="tt-back">Back</button><button type="button" class="tt-next">Next</button></div>`;
  const q = s => tip.querySelector(s);

  const sheetEl = () => $("#sheet"), sheetBody = () => $("#sheetbody");
  const menusClosed = () => document.querySelectorAll("#chipbar .menubtn[aria-expanded=true]").forEach(b => b.click());

  // Blocked: a page can't ask again, so the location step offers no buttons, only the way to undo it.
  const LOC_DENIED = () => typeof locPerm !== "undefined" && locPerm === "denied";
  const LOC_ON = () => !LOC_DENIED() && typeof locState !== "undefined" && locState === "off" && typeof locPrefGet === "function" && locPrefGet() !== "on";
  // The wording locBlockedSay() (app.js) puts in the location pill, copied rather than reworded so the two agree on the path.
  const LOC_BLOCKED = () => typeof LOC_IOS !== "undefined" && LOC_IOS
    ? "Location is blocked for this site. On iPhone: Settings › Privacy & Security › Location Services › Safari Websites › While Using the App — then reopen the app."
    : "Location is blocked — allow it for this site in your browser settings.";
  // Opened from the Home Screen already: nothing to teach.
  const INSTALLED = () => navigator.standalone === true || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);

  // part: which half of the tour a step belongs to, for the "Map · 3 / 11" counter (counted from these tags).
  // check/finish cards carry no part and no number. skip(): true when the step has nothing to say right now.
  const STEPS = [
    {part:"Map", sel:["#btn-book"], title:"Field Book", text:"Your favourites, rivers you’ve fished, notes, research links and offline map saving. It’s all stored only on your phone — export it to back it up."},
    {part:"Map", sel:["#btn-legend"], title:"Legend & help", text:"What the colours and symbols mean, how river classes work, and where to replay this tour."},
    {part:"Map", sel:["#btn-report"], title:"The report flag", text:"Tell us anything the app gets wrong — or right — or ask for more detail on your area. Interested in continued testing? Say so in a report and we’ll build out your home water."},
    {part:"Map", sel:["#btn-refresh", "#updated"], title:"Live flows", text:"Readings come live from USGS gauges. Tap refresh to update them; the time beside it shows when they last updated."},
    {part:"Map", sel:[".leaflet-control-zoom"], title:"Zooming", text:"Use + and −, or double-tap to zoom in. Double-tap and drag with one finger for smooth zoom, and tap with two fingers to zoom out."},
    {part:"Map", id:"locate", sel:["#btn-locate"], title:"Your location",
      text:() => "The blue dot shows where you are while you drive and fish. Your location never leaves this phone — it isn’t saved or sent anywhere." + (LOC_DENIED() ? " " + LOC_BLOCKED() : ""),
      enter(){ if(typeof zonesShown !== "undefined" && zonesShown && typeof hideZones === "function"){ hideZones(); state.hid = true; } },
      extra(){ return LOC_ON() ? [["Turn on location", () => { locPrefSet("on"); if(locState === "off") locStart("following"); next(); }, "tt-primary"],
                                 ["Not now", () => { locPrefSet("off"); next(); }]] : null; }},
    {part:"Map", sel:["#btn-zones"], title:"Regions", text:"Tap to get back to the state chooser at any time."},
    {part:"Map", sel:["#regionsel"], title:"Jump to region", text:"Pick an area from this list to fly straight to it — national parks, Alaska and all."},
    {part:"Map", sel:['button[data-menu="tierchips"]'], title:"River classes", text:"Rivers are ranked Gold, Class 1, 2 and 3. Class 3 is hidden by default — open this menu and tap All to show everything. Your favourites always show."},
    {part:"Map", sel:['button[data-menu="layerchips"]'], title:"Map layers", text:"Open this menu to switch on what you need: wade access and boat ramps, USGS gauges, falls and dams, bridge access, parking, campsites, trailheads, closed water and public land. Some appear only as you zoom in."},
    {part:"Map", skip:INSTALLED, title:"Add it to your Home Screen", text:"On iPhone, tap Share, then Add to Home Screen. It opens like an app, and it keeps your Field Book safe: Safari can clear a website’s saved data after a week without a visit, but not a Home Screen app’s."},
    {check:true, title:"That’s the map", text:"Want a quick look inside a river? We’ll open the Snake River in Jackson Hole as an example.",
      extra(){ return [["Show me", () => { state.skipped = false; next(); }, "tt-primary"],
                       ["Done for now", () => { state.skipped = true; go(FINISH, 1); }]]; }},
    {part:"River", id:"snake", sheet:true, sel:["#sheetbody .rulescard"], title:"Rules today", text:"Before flows or notes: whether the season is open, whose licence you need, the rules this river names, and your right to wade. This is the Snake River as an example.",
      enter: openSnake},
    {part:"River", sheet:true, sel:["#sheetbody .flowcard"], title:"Live flow", text:"Right-now CFS from the gauge, compared with the 7-year median for this week of the year. The label (like “Around average”) says how it compares; where a good-flow range is set it shows too. Many small creeks — most of the NE Iowa Driftless — have no gauge. Those say “Ungauged” and point you to the nearest gauged river as a rough guide, rather than guessing a number."},
    {part:"River", sheet:true, sel:["#sheetbody .sec"], title:"Float sections", text:"Each stretch lists its launch and take-out, river miles and a float-time estimate — scaled to today’s flow when there’s a reading, otherwise for a typical day."},
    {part:"River", sheet:true, sel:["#sheetbody .floatgo"], title:"Start float", text:"On eligible sections this opens a planner, then a live tracker with miles left and your ETA. We won’t start one now.", scrollTo:"mid"},
    {part:"River", sheet:true, sel:["#fbrow"], title:"Your Field Book row", text:"☆ Favourite a river, mark it ✓ Fished, and keep notes. Saved on this phone only."},
    {part:"River", sheet:true, sel:["#sheetbody .rp-link"], title:"Report from any river", text:"Something off on this river? This opens a report already filled in with its name."},
    {finish:true, title:"That’s it.", text:"Tap the flag any time — good or bad, we want to hear it."},
  ];
  const CHECK = STEPS.findIndex(s => s.check), FINISH = STEPS.findIndex(s => s.finish);

  const state = {on:false, i:0, hid:false, prevRiver:null, wasOpen:false, openedSheet:false, skipped:false};
  let busy = false;

  const visibleRect = el => {
    if(!el) return null;
    const r = el.getBoundingClientRect();
    if(r.width < 2 || r.height < 2) return null;
    const cs = getComputedStyle(el);
    if(cs.display === "none" || cs.visibility === "hidden") return null;
    return r;
  };
  function targetRect(step){
    if(!step.sel) return null;
    let u = null;
    for(const s of step.sel){
      const r = visibleRect($(s));
      if(!r) continue;
      u = u ? {left:Math.min(u.left, r.left), top:Math.min(u.top, r.top), right:Math.max(u.right, r.right), bottom:Math.max(u.bottom, r.bottom)}
            : {left:r.left, top:r.top, right:r.right, bottom:r.bottom};
    }
    return u;
  }
  // Inside the sheet: put the target near the top of its scroller, or centred for a small button.
  function scrollSheetTo(step){
    const el = $(step.sel[0]), body = sheetBody();
    if(!el || !body || !body.contains(el)) return;
    const b = body.getBoundingClientRect(), r = el.getBoundingClientRect();
    const want = step.scrollTo === "mid" ? (b.height - r.height) / 2 : 8;
    body.scrollTop += r.top - b.top - want;
  }

  function place(){
    if(!state.on) return;
    const step = STEPS[state.i]; if(!step) return;
    const vw = innerWidth, vh = innerHeight;
    const w = Math.min(vw - 2 * 12, 360);
    tip.style.width = w + "px";
    const th = tip.offsetHeight;
    const r = step.finish ? null : targetRect(step);
    let top, left;
    if(!r){
      ring.style.display = "none"; block.classList.add("dim");
      top = Math.max(EDGE, (vh - th) / 2); left = (vw - w) / 2;
    } else {
      block.classList.remove("dim");
      const x = Math.max(0, r.left - PAD), y = Math.max(0, r.top - PAD);
      const rw = Math.min(vw, r.right + PAD) - x, rh = Math.min(vh, r.bottom + PAD) - y;
      Object.assign(ring.style, {display:"block", left:x + "px", top:y + "px", width:rw + "px", height:rh + "px"});
      const below = y + rh + GAP, above = y - GAP - th;
      const appbar = ($("#appbar") || {offsetHeight:0}).offsetHeight;
      if(step.sheet && appbar + EDGE + th <= y - GAP) top = appbar + EDGE;      // sheet steps: pin under the app bar, clear of the sheet
      else if(below + th <= vh - EDGE) top = below;
      else if(above >= EDGE) top = above;
      else top = y < vh / 2 ? vh - th - EDGE : EDGE;                            // nowhere clean: far end of the screen
      left = Math.min(Math.max(EDGE + 4, x + rw / 2 - w / 2), vw - w - EDGE - 4);
    }
    tip.style.top = Math.max(EDGE, top) + "px"; tip.style.left = left + "px";
  }

  function paint(){
    const step = STEPS[state.i];
    // "Map · 3 / 11": numbered within its part, so adding a step renumbers itself. Skipped steps aren't counted.
    const mine = step.part ? STEPS.filter(s => s.part === step.part && !(s.skip && s.skip())) : [];
    q(".tt-n").textContent = mine.length ? step.part + " · " + (mine.indexOf(step) + 1) + " / " + mine.length : "";
    q("h3").textContent = step.title;
    q(".tt-text").textContent = typeof step.text === "function" ? step.text() : step.text;
    const ex = q(".tt-extra"); ex.innerHTML = "";
    const items = step.extra && step.extra();
    if(items) items.forEach(([label, fn, cls]) => {
      const b = document.createElement("button"); b.type = "button"; b.textContent = label;
      if(cls) b.className = cls; b.addEventListener("click", fn); ex.appendChild(b);
    });
    ex.style.display = items ? "flex" : "none";
    q(".tt-back").disabled = state.i === 0;
    const nx = q(".tt-next");
    nx.textContent = step.finish ? "Start fishing" : state.i === STEPS.length - 1 ? "Done" : "Next";
    nx.style.visibility = step.check ? "hidden" : "";       // the checkpoint's own two buttons are the choice
    const fin = $("#tour-finish"); if(fin) fin.remove();
    if(step.finish){
      const b = document.createElement("button"); b.type = "button"; b.id = "tour-finish"; b.className = "tt-primary";
      b.textContent = "Report something";
      b.addEventListener("click", () => { end(); if(typeof openReport === "function") openReport(null); });
      ex.appendChild(b); ex.style.display = "flex";
    }
    if(step.sheet) scrollSheetTo(step);
    place();
  }

  async function openSnake(){
    const sh = sheetEl();
    state.openedSheet = true;
    if(typeof closeLegend === "function") closeLegend();
    sh.classList.remove("tall");
    if(typeof openRiver === "function"){
      // openRiver paints at once, then waits on the stats fetch; don't wait on a slow API.
      await Promise.race([openRiver("snake"), new Promise(ok => setTimeout(ok, 5000))]);
    }
    await new Promise(ok => setTimeout(ok, 350));     // let the sheet finish sliding up before anything is measured
  }

  async function go(i, dir){
    if(busy) return; busy = true;
    try{
      const prev = STEPS[state.i];
      if(state.started && prev && prev.leave) prev.leave();
      while(i >= 0 && i < STEPS.length){
        const step = STEPS[i];
        if(step.skip && step.skip()){ i += dir; continue; }
        // Back out of the demo: the sheet would otherwise sit over the map controls.
        if(!step.sheet && !step.finish && state.openedSheet && sheetEl().classList.contains("open")){
          sheetEl().classList.remove("open"); if(typeof curRiver !== "undefined") curRiver = null;
        }
        if(step.enter) await step.enter();
        if(step.sheet) await new Promise(ok => setTimeout(ok, 60));
        if(step.sel && !targetRect(step)){ if(step.leave) step.leave(); i += dir; continue; }   // no sel = a centred card, never skipped
        state.started = true; state.i = i; paint();
        return;
      }
      if(dir > 0) end();
    } finally { busy = false; }
  }
  function next(){ if(!state.on) return; if(state.i >= STEPS.length - 1) end(); else go(state.i + 1, 1); }
  function back(){
    if(!state.on || state.i <= 0) return;
    // "Done for now" jumps over the river steps, so Back from the finish card is the checkpoint, not a sheet that was never opened.
    go(STEPS[state.i].finish && state.skipped ? CHECK : state.i - 1, -1);
  }

  function startTour(){
    if(state.on) return;
    if(typeof closeLegend === "function") closeLegend();
    if(typeof closeReport === "function") closeReport();
    const sh = sheetEl();
    Object.assign(state, {on:true, i:0, hid:false, started:false, openedSheet:false, skipped:false,
      prevRiver: typeof curRiver !== "undefined" ? curRiver : null, wasOpen: sh.classList.contains("open")});
    document.body.classList.add("touring");
    ring.style.display = "none"; block.classList.add("dim");
    tip.classList.add("show"); block.classList.add("show");
    state.i = -1;
    go(0, 1);
  }

  function end(){
    if(!state.on) return;
    state.on = false;
    const cur = STEPS[state.i]; if(cur && cur.leave) cur.leave();
    menusClosed();
    tip.classList.remove("show"); block.classList.remove("show", "dim"); ring.style.display = "none";
    document.body.classList.remove("touring");
    const sh = sheetEl();
    if(state.openedSheet){
      if(state.wasOpen && state.prevRiver && typeof openRiver === "function") openRiver(state.prevRiver);
      else { sh.classList.remove("open"); if(typeof curRiver !== "undefined") curRiver = null; }
    }
    if(state.hid && typeof showZones === "function") showZones();
    if(typeof locAskLater === "function") locAskLater();     // no-op unless they never answered
  }

  q(".tt-end").addEventListener("click", end);
  q(".tt-next").addEventListener("click", next);
  q(".tt-back").addEventListener("click", back);
  addEventListener("resize", place);
  addEventListener("orientationchange", () => setTimeout(place, 200));
  document.addEventListener("keydown", e => {
    if(e.key !== "Escape") return;
    if(state.on) end();
    else if(welcome.classList.contains("show")) $("#wl-skip").click();
  });
  // The sheet repaints when stats land; keep the ring on the new node.
  sheetEl().addEventListener("transitionend", () => { if(state.on) place(); });
  const sb = sheetBody();
  if(sb && window.MutationObserver) new MutationObserver(() => { if(state.on) setTimeout(place, 0); }).observe(sb, {childList:true});
  const lt = $("#lg-tour"); if(lt) lt.addEventListener("click", startTour);
  window.startTour = startTour;
})();
