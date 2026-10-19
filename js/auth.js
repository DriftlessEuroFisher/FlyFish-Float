/* Accounts — sign in with a 6-digit email code, against Supabase Auth
   ("GoTrue") over plain fetch, the way the report form posts. No supabase-js:
   nothing more to download or keep cached for offline use, and every step of
   the flow is here to read. No UI in this file; js/signin.js (the form),
   js/account.js (the app's sheet) and js/admin.js (admin.html) drive it.

   The flow:
   1. POST /auth/v1/otp {email, create_user:true} — Supabase emails a code.
      An address it hasn't seen becomes an account; the profile row is made
      by a database trigger (supabase/auth.sql).
   2. POST /auth/v1/verify {type:"email", email, token} — the code buys a
      session: an access token (a JWT, good for about an hour) and a refresh
      token.
   3. Signed-in calls carry the access token in Authorization. Row-level
      security reads the user's id out of it (auth.uid()).
   4. Before the access token runs out, POST /auth/v1/token?grant_type=
      refresh_token trades the refresh token for a new pair. Refresh tokens
      rotate (each works once), so two refreshes racing could sign the user
      out: only one is ever in flight (`refreshing`).

   Headers: `apikey` always carries the publishable key from js/config.js. It
   is public by design and is not a JWT, so it never goes in Authorization;
   Authorization is only ever the user's own access token.

   The session lives in localStorage.sbSession as {access_token,
   refresh_token, expires_at, user:{id, email}}. It is the user's, not a
   cache, so it has no LS_CACHE_PREFIXES prefix and lsMakeRoom() never
   deletes it. Pages on this origin share it (the app and admin.html). On an
   iPhone a home-screen app keeps its storage apart from Safari's, so each
   signs in on its own. */

const Auth = (() => {
  const KEY = "sbSession", PENDING = "authPending";
  const REFRESH_EARLY_S = 60;          // refresh when the access token has less than this left
  const TIMEOUT_MS = 15000;            // a paused project or a dead bar of signal can hang far longer
  const PENDING_MS = 60*60*1000;       // how long "a code was sent to …" is remembered across a reload
  const MSG = {
    off:     "Accounts aren't switched on in this version of the app.",
    offline: "You're offline. Signing in needs a connection.",
    down:    "The sign-in service is asleep or unreachable. Check your signal and try again in a minute.",
    code:    "That code is wrong or has expired. Check it, or send a new one.",
    email:   "That email address doesn't look right.",
    gone:    "You've been signed out. Sign in again to carry on.",
    denied:  "This account isn't allowed to do that.",
  };

  class AuthError extends Error {
    constructor(kind, message, extra){ super(message); this.kind = kind; Object.assign(this, extra || {}); }
  }

  const on = () => typeof SUPABASE !== "undefined" && !!SUPABASE.url && !!SUPABASE.anonKey;
  const nowS = () => Math.floor(Date.now()/1000);
  const looksValid = s => !!(s && typeof s.access_token === "string" && typeof s.refresh_token === "string" && s.user && s.user.id);

  /* ---------- storage ----------
     `mem` holds the session when storage can't: blocked (private mode,
     previews) or full even after lsSetSafe() has made room. Then the user
     stays signed in until the page reloads, and no longer. */
  let mem = null, memOnly = false;
  function read(){
    let s;
    try{ s = JSON.parse(localStorage.getItem(KEY) || "null"); }catch(e){ return mem; }
    if(!s && memOnly) return mem;
    return looksValid(s) ? s : null;
  }
  function write(s){
    mem = s; memOnly = false;
    try{
      if(!s){ localStorage.removeItem(KEY); return; }
      const str = JSON.stringify(s);
      const ok = typeof lsSetSafe === "function" ? lsSetSafe(KEY, str) : (localStorage.setItem(KEY, str), true);
      // A stale copy left behind would come back on the next read: remove it.
      if(!ok){ memOnly = true; localStorage.removeItem(KEY); }
    }catch(e){ memOnly = true; try{ localStorage.removeItem(KEY); }catch(_){} }
  }

  /* ---------- listeners ----------
     Fired when who is signed in changes (in, out, another account), not on
     every token refresh: a sheet that re-rendered on each refresh would wipe
     whatever the user was typing. Another tab's sign-in or sign-out arrives
     through the storage event. */
  const listeners = [];
  let lastUid = (read() || {user:{}}).user.id || null;
  function changed(){
    const s = read(), uid = s ? s.user.id : null;
    if(uid === lastUid) return;
    lastUid = uid;
    listeners.slice().forEach(fn => { try{ fn(s); }catch(e){ console.error(e); } });
  }
  window.addEventListener("storage", e => { if(e.key === KEY || e.key === null) changed(); });

  /* ---------- talking to Supabase ---------- */
  async function send(path, opts){
    opts = opts || {};
    if(!on()) throw new AuthError("off", MSG.off);
    if(navigator.onLine === false) throw new AuthError("offline", MSG.offline);
    const headers = Object.assign({apikey:SUPABASE.anonKey}, opts.headers || {});
    if(opts.body !== undefined) headers["Content-Type"] = "application/json";
    if(opts.token) headers.Authorization = "Bearer " + opts.token;
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try{
      return await fetch(SUPABASE.url + path, {method:opts.method || "GET", headers, cache:"no-store", signal:ctl.signal,
        body:opts.body === undefined ? undefined : JSON.stringify(opts.body)});
    }catch(e){
      // No answer at all. A paused free project often fails this way too:
      // its error page comes back without CORS headers, so the browser
      // reports a network error rather than a status.
      throw navigator.onLine === false ? new AuthError("offline", MSG.offline) : new AuthError("down", MSG.down);
    }finally{ clearTimeout(t); }
  }

  function waitText(s){
    return s < 90 ? `${s} second${s===1?"":"s"}` : `${Math.ceil(s/60)} minutes`;
  }
  /* Turns a failed response into plain words. GoTrue answers
     {code, error_code, msg} (older versions {error, error_description});
     PostgREST answers {code, message}. `where` says which call it was. */
  async function errorOf(res, where){
    let d = {};
    try{ d = await res.json(); }catch(e){}
    const code = String(d.error_code || d.error || d.code || ""), text = String(d.msg || d.message || d.error_description || "");
    const extra = {status:res.status, code, detail:text};
    if(res.status >= 500) return new AuthError("down", MSG.down, extra);
    if(res.status === 429 || /rate_limit/.test(code)){
      // "For security purposes, you can only request this after 42 seconds."
      const m = /after (\d+) second/i.exec(text);
      const wait = m ? +m[1] : (+res.headers.get("retry-after") || 0);
      return new AuthError("rate", wait ? `Too many tries. Try again in ${waitText(wait)}.` : "Too many tries. Wait a few minutes and try again.",
        Object.assign(extra, {wait}));
    }
    if(where === "verify" && (code === "otp_expired" || res.status === 401 || res.status === 403)) return new AuthError("code", MSG.code, extra);
    if(where === "otp"){
      if(/email_address_invalid|validation_failed/.test(code) || /invalid format|validate email/i.test(text)) return new AuthError("email", MSG.email, extra);
      if(code === "email_address_not_authorized") return new AuthError("other", "Sign-in email isn't set up for this address yet. Try again later.", extra);
      if(/signup_disabled|otp_disabled|email_provider_disabled/.test(code)) return new AuthError("other", "Signing in is switched off right now.", extra);
    }
    // PostgREST can't find the table or function: supabase/auth.sql hasn't been run.
    if(/^(PGRST202|PGRST205|42P01|42883)$/.test(code)) return new AuthError("setup", "Accounts aren't set up on the server yet.", extra);
    if(res.status === 403 || code === "42501") return new AuthError("denied", MSG.denied, extra);
    return new AuthError("other", `Something went wrong (error ${res.status}). Try again.`, extra);
  }

  /* A token response becomes the stored session. Expiry is counted from
     expires_in on this phone's own clock rather than the server's
     expires_at, so a phone whose clock is off still refreshes on time. */
  function fromToken(d){
    if(!d || !d.access_token || !d.refresh_token || !d.user || !d.user.id)
      throw new AuthError("other", "The sign-in service sent back something unexpected. Try again.");
    return {access_token:d.access_token, refresh_token:d.refresh_token,
      expires_at:nowS() + (+d.expires_in || 3600), user:{id:d.user.id, email:d.user.email || ""}};
  }

  /* ---------- refresh ---------- */
  let refreshing = null;
  function fresh(force){
    const s = read();
    if(!s) return Promise.resolve(null);
    if(!force && s.expires_at - nowS() > REFRESH_EARLY_S) return Promise.resolve(s);
    if(!refreshing) refreshing = doRefresh(s).finally(() => { refreshing = null; });
    return refreshing;
  }
  async function doRefresh(s){
    // The app and admin.html share this session. If another tab refreshed
    // since `s` was read, its new pair is already stored, and spending the
    // old refresh token again would be reuse.
    const cur = read();
    if(!cur) return null;
    if(cur.refresh_token !== s.refresh_token && cur.expires_at - nowS() > REFRESH_EARLY_S) return cur;
    // No signal or the project is asleep: send() throws, the session stays,
    // and the next call tries again.
    const res = await send("/auth/v1/token?grant_type=refresh_token", {method:"POST", body:{refresh_token:cur.refresh_token}});
    const now = read();
    if(!now || now.refresh_token !== cur.refresh_token){
      // Signed out, or another tab won, while this one was in flight.
      return now;
    }
    if(res.ok){ const n = fromToken(await res.json()); write(n); changed(); return n; }
    if(res.status === 400 || res.status === 401){
      // invalid_grant: revoked, already used, signed out everywhere, or the
      // account was deleted. The session is dead; sign out on this phone.
      write(null); changed(); return null;
    }
    throw await errorOf(res, "refresh");                    // 429, 5xx: keep the session
  }

  /* Was this answer a refusal of the token itself? 401 from either service,
     or GoTrue's 403 for a session or user that no longer exists (signed out
     everywhere, account deleted on another phone). */
  async function tokenRefused(res){
    if(res.status === 401) return true;
    if(res.status !== 403) return false;
    try{ const d = await res.clone().json(); return /session_not_found|user_not_found|bad_jwt/.test(String(d.error_code || d.code || "")); }
    catch(e){ return false; }
  }

  /* fetch for signed-in calls: refreshes first when the token is nearly
     out, and once more if the server refuses a token this phone's clock
     thought was fine. Signed out, it sends the publishable key alone. */
  async function authFetch(path, opts){
    opts = opts || {};
    const had = !!read();
    let s = await fresh(false);
    // The refresh found the session dead: don't quietly go on signed out.
    if(had && !s) throw new AuthError("gone", MSG.gone);
    let res = await send(path, Object.assign({}, opts, {token:s && s.access_token}));
    if(s && await tokenRefused(res)){
      s = await fresh(true);
      if(!s) throw new AuthError("gone", MSG.gone);
      res = await send(path, Object.assign({}, opts, {token:s.access_token}));
    }
    return res;
  }

  /* ---------- the API ---------- */
  async function sendCode(email){
    email = String(email || "").trim().toLowerCase();
    const res = await send("/auth/v1/otp", {method:"POST", body:{email, create_user:true}});
    if(!res.ok) throw await errorOf(res, "otp");
    return true;
  }
  async function verify(email, code){
    email = String(email || "").trim().toLowerCase();
    const res = await send("/auth/v1/verify", {method:"POST", body:{type:"email", email, token:String(code || "").trim()}});
    if(!res.ok) throw await errorOf(res, "verify");
    const s = fromToken(await res.json());
    write(s); pendingClear(); changed();
    return s;
  }
  /* Signs out on this phone at once, then tells Supabase in the background
     (scope=local: this phone only, the user's other devices stay signed in).
     {remote:false} skips the call, e.g. after the account is deleted. */
  function signOut(opts){
    const s = read();
    write(null); changed();
    if(!s || (opts && opts.remote === false)) return;
    (async () => {
      let token = s.access_token;
      if(s.expires_at - nowS() <= REFRESH_EARLY_S){
        // an expired token can't sign itself out; if this fails it's already dead
        const r = await send("/auth/v1/token?grant_type=refresh_token", {method:"POST", body:{refresh_token:s.refresh_token}});
        if(!r.ok) return;
        token = (await r.json()).access_token;
      }
      await send("/auth/v1/logout?scope=local", {method:"POST", token});
    })().catch(() => {});
  }
  /* The current user from Supabase (not the stored copy). Keeps the stored
     email current; signs out here if the account is gone. */
  async function getUser(){
    const res = await authFetch("/auth/v1/user");
    if(!res.ok) throw await errorOf(res, "user");
    const u = await res.json(), s = read();
    if(s && u && u.id === s.user.id && u.email && u.email !== s.user.email){ s.user.email = u.email; write(s); }
    return u;
  }
  /* PostgREST: rest("profiles?id=eq.…", {method:"PATCH", body, prefer}). */
  async function rest(path, opts){
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    if(opts.prefer) headers.Prefer = opts.prefer;
    const res = await authFetch("/rest/v1/" + path, {method:opts.method || "GET", body:opts.body, headers});
    if(!res.ok) throw await errorOf(res, "rest");
    const txt = await res.text();
    return txt ? JSON.parse(txt) : null;
  }
  const rpc = (name, args) => rest("rpc/" + name, {method:"POST", body:args || {}});

  /* "A code was sent to …", remembered so the code step survives the app
     being reloaded while the user is over in Mail (iOS often does that to a
     home-screen app). `next` is when Resend is allowed again. */
  function pendingGet(){
    try{
      const p = JSON.parse(localStorage.getItem(PENDING) || "null");
      return p && p.email && Date.now() - p.at < PENDING_MS ? p : null;
    }catch(e){ return null; }
  }
  function pendingSet(email, waitS){
    try{ localStorage.setItem(PENDING, JSON.stringify({email:String(email).trim().toLowerCase(), at:Date.now(), next:Date.now() + waitS*1000})); }catch(e){}
  }
  function pendingClear(){ try{ localStorage.removeItem(PENDING); }catch(e){} }

  return {
    on, session:read, user:() => (read() || {}).user || null,
    sendCode, verify, signOut, getUser, rest, rpc, authFetch,
    onChange(fn){ listeners.push(fn); return () => { const i = listeners.indexOf(fn); if(i >= 0) listeners.splice(i, 1); }; },
    pendingGet, pendingSet, pendingClear, AuthError,
  };
})();
