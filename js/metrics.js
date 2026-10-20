/* Usage stats, first-party (2026-10-19): a short list of events posted to
   this app's own Supabase project (supabase/metrics.sql), and no third-party
   counter. Loads after app.js, auth.js and account.js; every call into it
   elsewhere is one line guarded with `typeof Metrics`.

   What is recorded (KINDS): a launch, each river or lake opened, the state
   or park the map settles on, a chooser or Jump-to pick, and a handful of
   features. Each event carries this phone's lasting random id
   (localStorage.metricsDevice) and, while someone is signed in, their
   account id, so a signed-in history is a history of the rivers and lakes
   they open. Nothing else leaves: no location fix, no Field Book contents.
   Only admins can read it; deleting the account erases it (server side),
   and the phone then makes itself a new id (forgetDevice).

   There is no user switch during testing (owner, 2026-10-19): every phone
   sends. Local dev hosts (localhost, 127.0.0.1, [::1], *.localhost, *.test, *.pages.dev (Cloudflare previews))
   never record or send, so previews can't post to the live project. Nothing
   is sent while js/config.js names no Supabase project.

   The queue is localStorage "metrics:queue", which is under a cache prefix
   (LS_CACHE_PREFIXES in app.js): when the Field Book needs room,
   lsMakeRoom() deletes it first. Unsent stats are worth less than a trip.

   Sending: one POST of a JSON array to /rest/v1/events, ~20 s after
   launch, whenever 25 are waiting, and when the page is hidden (keepalive,
   so it can finish after the app is swiped away). Signed in, the user's
   token (Auth refreshes it); signed out, the publishable key alone. A
   network failure or a 5xx keeps the batch for next time; any other 4xx
   drops it, so one bad row can't wedge the queue; a missing table (the
   owner hasn't run metrics.sql yet) switches stats off for this page load
   and keeps the queue. None of this touches the USGS budget or apiPaused(). */

const Metrics = (() => {
  const QKEY = "metrics:queue", DEV = "metricsDevice";
  const KINDS = new Set(["launch", "river_open", "lake_open", "region_view", "zone_pick",
    "fieldbook_open", "trip_logged", "favourite_add", "float_start", "float_end",
    "laketrip_start", "laketrip_end", "offline_save", "report_sent", "signin", "signout",
    "tour_start", "layer_on", "gauge_tap"]);
  const CAP = 300;                      // queued events kept; the oldest go first
  const BATCH = 100;                    // rows per POST
  const FLUSH_AT = 25;                  // queue length that sends without waiting
  const FIRST_FLUSH_MS = 20000;         // after launch: the first opens are in, the map has settled
  const RETRY_GAP_MS = 60000;           // after a failed send, the 25-trigger waits this long
  const DEDUPE_MS = 30*60*1000;         // the same water or region counts once per half hour
  const DEDUPED = new Set(["river_open", "lake_open", "region_view"]);
  const MAX_AGE_MS = 29*24*3600*1000;   // the table refuses client_at over 30 days before arrival
  const KEEPALIVE_BYTES = 48*1024;      // keepalive bodies share a 64 KB budget per page
  const TOKEN_MIN_S = 60;               // a token this close to expiry can't be used without a refresh
  const TIMEOUT_MS = 15000;
  const REGION_SETTLE_MS = 1500, REGION_MIN_ZOOM = 6;

  const configured = () => typeof SUPABASE !== "undefined" && !!SUPABASE.url && !!SUPABASE.anonKey;
  let sessionOff = false;               // the events table isn't there: quiet until the next launch (the queue is kept)
  const devHost = (() => {
    const h = String(location.hostname || "").toLowerCase();
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1" ||
      h.endsWith(".localhost") || h.endsWith(".test") ||
      h.endsWith(".pages.dev");   // Cloudflare preview deploys
  })();
  const recording = () => configured() && !devHost;
  // Phones that switched stats off before the switch was removed start sending again.
  try{ localStorage.removeItem("metricsOff"); }catch(e){}
  const canSend = () => recording() && !sessionOff;

  /* ---------- ids ---------- */
  function uuid(){
    if(window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = new Uint8Array(16);
    if(window.crypto && crypto.getRandomValues) crypto.getRandomValues(b);
    else for(let i = 0; i < 16; i++) b[i] = Math.floor(Math.random()*256);
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;           // version 4, RFC 4122 variant
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
  }
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  /* The phone's lasting id. Not under a cache prefix, so storage clean-up
     never resets it; only forgetDevice() does. Storage blocked (private
     mode): an id for this page load only. */
  let devMem = null;
  function device(){
    if(devMem) return devMem;
    try{ const d = localStorage.getItem(DEV); if(d && UUID_RE.test(d)) return (devMem = d); }catch(e){}
    devMem = uuid();
    lsWrite(DEV, devMem);
    return devMem;
  }
  function lsWrite(k, v){
    try{ return typeof lsSetSafe === "function" ? lsSetSafe(k, v) : (localStorage.setItem(k, v), true); }
    catch(e){ return false; }
  }
  const signedInId = () => {
    const s = typeof Auth !== "undefined" && Auth.session();
    return s && s.user ? s.user.id : null;
  };
  const standalone = () => navigator.standalone === true ||
    !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches);

  /* ---------- the queue ----------
     Each entry: {k kind, t target, n name, at ms, u account id or null,
     v app version, sa home-screen app}. `gen` changes when the queue is
     thrown away (switched off, account deleted), so a batch that was on its
     way at the time is never put back. */
  let q = [], gen = 0;
  try{ const s = JSON.parse(localStorage.getItem(QKEY) || "[]"); if(Array.isArray(s)) q = s.filter(e => e && KINDS.has(e.k) && Number.isFinite(e.at)); }catch(e){}
  function persist(){
    try{ if(!q.length){ localStorage.removeItem(QKEY); return; } }catch(e){ return; }
    lsWrite(QKEY, JSON.stringify(q));     // can fail when storage is full; then the queue lives in memory
  }
  function putBack(batch, g){
    if(g !== gen || !recording()) return;
    q = batch.concat(q);
    if(q.length > CAP) q = q.slice(q.length - CAP);
    persist();
  }
  function prune(){
    const old = Date.now() - MAX_AGE_MS, n = q.length;
    q = q.filter(e => e.at >= old);
    if(q.length !== n) persist();
  }
  function clearQueue(){
    gen++; q = [];
    try{ localStorage.removeItem(QKEY); }catch(e){}
  }

  /* The database's own rules, checked here first so a row it would refuse
     never costs the rest of its batch: one line, no control characters, at
     most `max` characters (counted in code points, as Postgres does). */
  function clean(s, max){
    if(s === null || s === undefined) return null;
    const t = String(s).replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\s+/g, " ").trim();
    return t ? Array.from(t).slice(0, max).join("") : null;
  }

  const seen = new Map();               // "kind:target" -> when it was last counted
  function track(kind, target, name){
    if(!canSend() || !KINDS.has(kind)) return;
    target = clean(target, 64); name = clean(name, 120);
    const now = Date.now();
    if(DEDUPED.has(kind)){
      const key = kind + ":" + target, last = seen.get(key);
      if(last && now - last < DEDUPE_MS) return;
      seen.set(key, now);
    }
    q.push({k:kind, t:target, n:name, at:now, u:signedInId(),
      v:typeof APP_VERSION === "string" ? APP_VERSION : null, sa:standalone()});
    if(q.length > CAP) q = q.slice(q.length - CAP);
    persist();
    // Signing out is about to drop the token these rows need: send them now,
    // while it is still here (account.js calls this just before signOut()).
    if(kind === "signout") flushNow();
    else if(q.length >= FLUSH_AT) flush();
  }

  /* ---------- sending ---------- */
  /* Rows as the table takes them. An event keeps the account it was recorded
     under only if that account is the one sending: rows from before sign-in,
     or from an account since signed out, go without one. Signed out, no row
     has a user_id key at all; signed in, every row has one (some null), so
     the keys are the same on every row of the batch. */
  function rowsFor(batch, uid){
    const dev = device();
    return batch.map(e => {
      const r = {device_id:dev, kind:e.k, target:e.t, name:e.n, app_version:e.v,
        standalone:typeof e.sa === "boolean" ? e.sa : null, client_at:new Date(e.at).toISOString()};
      if(uid) r.user_id = e.u === uid ? uid : null;
      return r;
    });
  }
  let inflight = 0, failedAt = 0, sending = false;
  const warned = new Set();
  function warnOnce(key, text){ if(!warned.has(key)){ warned.add(key); console.warn("Usage stats: " + text); } }

  /* Plain fetch: anonymous sends, and the keepalive sends that can't wait
     for Auth to refresh a token. apikey is always the publishable key;
     Authorization is only ever the user's own access token. */
  function post(body, token, keepalive){
    const headers = {apikey:SUPABASE.anonKey, "Content-Type":"application/json", Prefer:"return=minimal"};
    if(token) headers.Authorization = "Bearer " + token;
    const opts = {method:"POST", headers, body, cache:"no-store"};
    let t = null;
    if(keepalive) opts.keepalive = true;
    else if(window.AbortController){ const c = new AbortController(); opts.signal = c.signal; t = setTimeout(() => c.abort(), TIMEOUT_MS); }
    inflight++;
    return fetch(SUPABASE.url + "/rest/v1/events", opts).finally(() => { inflight--; clearTimeout(t); });
  }
  /* What an answer means for the batch it carried. */
  async function judge(res, batch, g){
    if(res.ok){ failedAt = 0; return "ok"; }
    let code = "";
    try{ const d = await res.json(); code = String(d.code || d.error_code || ""); }catch(e){}
    if(res.status === 404 || code === "42P01" || code === "PGRST205"){
      sessionOff = true; putBack(batch, g);
      warnOnce("missing", "the events table isn't on the server yet (supabase/metrics.sql); nothing more is sent this session.");
      return "off";
    }
    if(res.status >= 500 || res.status === 408 || res.status === 429){
      putBack(batch, g); failedAt = Date.now(); return "keep";
    }
    // Refused for good (a check constraint, a policy): sending it again would
    // be refused again, so it goes, and the queue behind it moves on.
    warnOnce("refused", `the server refused a batch (${res.status}${code ? " " + code : ""}); it was dropped.`);
    return "drop";
  }

  /* The usual send, from a timer or the 25-trigger. Signed in, it goes
     through Auth.authFetch, which refreshes the token when it's nearly out
     and retries once if the server refuses it. */
  async function flush(){
    if(sending || !canSend()) return;
    if(failedAt && Date.now() - failedAt < RETRY_GAP_MS) return;
    if(navigator.onLine === false) return;            // offline: the queue waits
    prune();
    if(!q.length) return;
    sending = true;
    try{
      while(q.length && canSend()){
        const uid = signedInId(), g = gen;
        const batch = q.splice(0, BATCH); persist();
        let res;
        inflight++;                                     // forgetDevice() waits for this
        try{
          res = uid && typeof Auth !== "undefined"
            ? await Auth.authFetch("/rest/v1/events", {method:"POST", body:rowsFor(batch, uid), headers:{Prefer:"return=minimal"}})
            : await post(JSON.stringify(rowsFor(batch, null)), null, false);
        }catch(e){
          // No answer: offline, timed out, the project asleep, or the session
          // found dead on refresh (then the next send goes signed out).
          putBack(batch, g); failedAt = Date.now(); return;
        }finally{ inflight--; }
        const out = await judge(res, batch, g);
        if(out === "keep" || out === "off") return;
      }
    }finally{ sending = false; }
  }
  /* Right now, without waiting on anything: the page is being hidden (and may
     never run again), or a sign-out is about to take the token. The batch
     leaves the stored queue before it is sent, so if the page dies on the
     way it is sent at most once, never twice; if the page lives to hear a
     failure, the batch goes back. A signed-in token too close to expiry
     can't be refreshed in time: the queue waits for the next launch. */
  function flushNow(){
    if(!canSend() || navigator.onLine === false) return;
    prune();
    if(!q.length) return;
    const s = typeof Auth !== "undefined" ? Auth.session() : null;
    if(s && !(s.expires_at - Date.now()/1000 > TOKEN_MIN_S)) return;
    const uid = s ? s.user.id : null;
    let n = Math.min(q.length, BATCH), body;
    for(;;){
      body = JSON.stringify(rowsFor(q.slice(0, n), uid));
      if(n === 1 || new Blob([body]).size <= KEEPALIVE_BYTES) break;
      n = Math.ceil(n/2);
    }
    const g = gen, batch = q.splice(0, n);
    persist();
    post(body, s && s.access_token, true)
      .then(res => judge(res, batch, g), () => { putBack(batch, g); failedAt = Date.now(); })
      .catch(() => {});
  }

  document.addEventListener("visibilitychange", () => { if(document.visibilityState === "hidden") flushNow(); });
  setTimeout(flush, FIRST_FLUSH_MS);

  /* ---------- the region under the map ----------
     The state or park zone the map centre sits in, once the view has
     settled, from zoom 6, never while the chooser is up. Parks are tested
     first: they sit on top of their state, as on the map. */
  let zoneIdx = null, regionT = null, regionLast = null;
  function boxOf(ring){
    let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
    for(const p of ring){ if(p[0] < a) a = p[0]; if(p[0] > b) b = p[0]; if(p[1] < c) c = p[1]; if(p[1] > d) d = p[1]; }
    return [a, b, c, d];
  }
  function inRing(lat, lng, ring){
    let ins = false;
    for(let i = 0, j = ring.length - 1; i < ring.length; j = i++){
      const a = ring[i], b = ring[j];
      if((a[0] > lat) !== (b[0] > lat) && lng < (b[1] - a[1])*(lat - a[0])/((b[0] - a[0]) || 1e-12) + a[1]) ins = !ins;
    }
    return ins;
  }
  function zoneAt(ll){
    if(typeof ZONES === "undefined") return null;
    if(!zoneIdx) zoneIdx = ZONES.slice().sort((a, b) => (b.kind === "park") - (a.kind === "park"))
      .map(z => ({z, polys:[z.rings].concat(z.parts || []).filter(p => p && p.length).map(rings => ({rings, box:boxOf(rings[0])}))}));
    for(const {z, polys} of zoneIdx){
      for(const {rings, box} of polys){
        if(ll.lat < box[0] || ll.lat > box[1] || ll.lng < box[2] || ll.lng > box[3]) continue;
        // inside the outer ring and in none of its holes
        if(inRing(ll.lat, ll.lng, rings[0]) && !rings.slice(1).some(h => inRing(ll.lat, ll.lng, h))) return z;
      }
    }
    return null;
  }
  function regionCheck(){
    if(!canSend() || typeof map === "undefined") return;
    if(typeof zonesShown !== "undefined" && zonesShown) return;
    if(map.getZoom() < REGION_MIN_ZOOM) return;
    const z = zoneAt(map.getCenter());
    const id = z ? z.id : null;
    if(id === regionLast) return;
    regionLast = id;
    if(z) track("region_view", z.id, z.label);
  }
  if(typeof map !== "undefined") map.on("moveend", () => { clearTimeout(regionT); regionT = setTimeout(regionCheck, REGION_SETTLE_MS); });

  /* ---------- forgetting ---------- */
  /* Before "Delete my account": the server erases every event from this
     phone's id, so the phone stops using it. Anything queued (recorded under
     the old id) is dropped, a send already on its way is given a few
     seconds to land first (so it can't arrive after the erase), and a new
     id is made, so what this phone sends afterwards, signed out, isn't
     joined to the history that was erased. */
  async function forgetDevice(){
    clearQueue(); seen.clear(); regionLast = null;
    const until = Date.now() + 5000;
    while(inflight > 0 && Date.now() < until) await new Promise(ok => setTimeout(ok, 100));
    devMem = uuid();
    lsWrite(DEV, devMem);
  }

  track("launch");

  return {track, flush, forgetDevice, KINDS};
})();
