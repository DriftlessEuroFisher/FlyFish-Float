/* admin.html — the issue-report queue and a few usage counts, for accounts
   holding the admin role (supabase/auth.sql). Same sign-in as the app
   (js/signin.js), and the same session when opened in the same browser.

   Hiding things from a non-admin here is courtesy, not protection. The
   protection is row-level security: made by hand with a non-admin's token,
   these same requests get no reports back, change no status, and
   admin_stats() raises an error. Nothing on this page is secret; only what
   the database agrees to return differs.

   Every report field was typed by a stranger, so all of it goes through
   esc() before it touches innerHTML (and the page's Content-Security-Policy
   would refuse to run injected script anyway). */

(function(){
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const main = $("#adm-main"), who = $("#adm-who"), outBtn = $("#adm-out");
  const STATUS = {new:"New", fixed:"Fixed", wontfix:"Won't fix"};
  const FILTERS = [["new", "New"], ["fixed", "Fixed"], ["wontfix", "Won't fix"], ["all", "All"]];
  const PAGE = 50;
  const COLS = "id,created_at,river_id,river_name,issue,email,app_version,status";
  let filter = "new", lastId = null, seq = 0, listSeq = 0;
  try{ const f = localStorage.getItem("adminFilter"); if(FILTERS.some(x => x[0] === f)) filter = f; }catch(e){}

  const fmtWhen = iso => {
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString([], {month:"short", day:"numeric", year:"numeric", hour:"numeric", minute:"2-digit"});
  };

  function header(){
    const s = Auth.session();
    who.textContent = s ? s.user.email : "";
    outBtn.hidden = !s;
  }
  function problem(text, retry){
    main.innerHTML = `<div class="adm-card"><p>${esc(text)}</p>${retry ? `<button type="button" class="adm-btn" id="adm-retry">Try again</button>` : ""}</div>`;
    if(retry) $("#adm-retry").addEventListener("click", start);
  }

  async function start(){
    const my = ++seq;
    if(typeof Auth === "undefined" || !Auth.on()) return problem("Accounts aren't switched on: js/config.js names no Supabase project.");
    header();
    if(!Auth.session()){
      main.innerHTML = `<div class="adm-card"><h2>Sign in</h2><p class="adm-note">Use the email address that holds the admin role.</p><div id="adm-signin"></div></div>`;
      signInForm($("#adm-signin"), {id:"adm"});   // success arrives through Auth.onChange
      return;
    }
    main.innerHTML = `<p class="adm-note">Checking this account…</p>`;
    let admin;
    try{ admin = await Auth.rpc("is_admin"); }
    catch(err){
      if(my !== seq || err.kind === "gone") return;   // "gone" signs out, which calls start() again
      return problem(`Couldn't check this account. ${err.message}`, true);
    }
    if(my !== seq) return;
    if(admin !== true){
      main.innerHTML = `<div class="adm-card"><p>This account isn't an admin.</p></div>`;
      return;
    }
    main.innerHTML = `
      <section class="adm-stats" id="adm-stats" aria-label="Counts"><p class="adm-note">Loading counts…</p></section>
      <section aria-label="Issue reports">
        <div class="adm-rhead"><h2>Reports</h2>
          <div class="adm-tools" role="group" aria-label="Show reports">${FILTERS.map(([k, label]) =>
            `<button type="button" data-filter="${k}" aria-pressed="${k === filter}">${label}</button>`).join("")}<button type="button" class="adm-reload" id="adm-reload">Reload</button></div>
        </div>
        <div id="adm-list"></div>
        <button type="button" class="adm-btn adm-more" id="adm-more" hidden>Load more</button>
      </section>`;
    main.querySelectorAll("[data-filter]").forEach(b => b.addEventListener("click", () => {
      filter = b.dataset.filter;
      try{ localStorage.setItem("adminFilter", filter); }catch(e){}
      main.querySelectorAll("[data-filter]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      loadReports(true);
    }));
    $("#adm-reload").addEventListener("click", () => { loadStats(); loadReports(true); });
    $("#adm-more").addEventListener("click", () => loadReports(false));
    $("#adm-list").addEventListener("click", setStatus);
    loadStats();
    loadReports(true);
  }

  async function loadStats(){
    const el = $("#adm-stats"); if(!el) return;
    try{
      const d = await Auth.rpc("admin_stats") || {}, rep = d.reports || {};
      const tiles = [["Accounts", d.users_total], ["New accounts, last 7 days", d.users_7d]]
        .concat(Object.keys(STATUS).map(k => [`${STATUS[k]} reports`, rep[k] || 0]))
        // a status from before the new/fixed/wontfix rule, if any old row has one
        .concat(Object.keys(rep).filter(k => !STATUS[k]).map(k => [`"${k}" reports`, rep[k]]));
      el.innerHTML = tiles.map(([label, n]) => `<div class="adm-tile"><b>${esc(n == null ? "–" : n)}</b><span>${esc(label)}</span></div>`).join("");
    }catch(err){
      if(err.kind !== "gone") el.innerHTML = `<p class="adm-note">Counts didn't load. ${esc(err.message)}</p>`;
    }
  }

  function rowHTML(r){
    const id = Number(r.id);
    const place = r.river_name || r.river_id
      ? `${esc(r.river_name || r.river_id)}${r.river_name && r.river_id ? ` <span class="adm-id">${esc(r.river_id)}</span>` : ""}`
      : "No river given";
    return `<article class="adm-rep" data-id="${id}" data-status="${esc(r.status)}">
      <div class="adm-rep-top"><span class="adm-place">${place}</span><time datetime="${esc(r.created_at)}">${esc(fmtWhen(r.created_at))}</time></div>
      <p class="adm-issue">${esc(r.issue)}</p>
      <div class="adm-meta"><span class="mono">#${id}</span><span class="mono">${esc(r.app_version || "no version")}</span>${r.email
        ? `<a href="mailto:${esc(encodeURIComponent(r.email))}">${esc(r.email)}</a>` : "<span>no email</span>"}</div>
      <div class="adm-seg" role="group" aria-label="Status of report ${id}">${Object.keys(STATUS).map(k =>
        `<button type="button" data-st="${k}" aria-pressed="${r.status === k}">${STATUS[k]}</button>`).join("")}</div>
      <p class="adm-rowmsg" role="status" aria-live="polite"></p>
    </article>`;
  }

  /* Newest first, by id: it is an identity column, so its order is the order
     reports arrived. Pages are "older than the last id shown", not an
     offset, because triaging moves reports out of a filtered list and an
     offset would then skip the ones that slid up into its place. */
  async function loadReports(reset){
    const list = $("#adm-list"), more = $("#adm-more"); if(!list) return;
    const my = ++listSeq;
    if(reset){ lastId = null; list.innerHTML = `<p class="adm-note">Loading…</p>`; more.hidden = true; }
    more.disabled = true;
    const q = `reports?select=${COLS}&order=id.desc&limit=${PAGE}` +
      (filter === "all" ? "" : `&status=eq.${filter}`) + (lastId == null ? "" : `&id=lt.${lastId}`);
    try{
      const rows = await Auth.rest(q) || [];
      if(my !== listSeq) return;
      if(reset) list.innerHTML = rows.length ? "" : `<p class="adm-empty">No ${filter === "all" ? "" : STATUS[filter].toLowerCase() + " "}reports.</p>`;
      list.insertAdjacentHTML("beforeend", rows.map(rowHTML).join(""));
      if(rows.length) lastId = Number(rows[rows.length - 1].id);
      more.hidden = rows.length < PAGE; more.disabled = false;
    }catch(err){
      if(my !== listSeq || err.kind === "gone") return;
      if(reset) list.innerHTML = "";
      list.insertAdjacentHTML("beforeend", `<p class="adm-note">Reports didn't load. ${esc(err.message)}</p>`);
      more.disabled = false;
    }
  }

  async function setStatus(e){
    const b = e.target.closest(".adm-seg button"); if(!b) return;
    const card = b.closest(".adm-rep"), id = Number(card.dataset.id), st = b.dataset.st;
    if(card.dataset.status === st) return;
    const btns = card.querySelectorAll(".adm-seg button"), msg = card.querySelector(".adm-rowmsg");
    btns.forEach(x => { x.disabled = true; });
    msg.className = "adm-rowmsg"; msg.textContent = "Saving…";
    try{
      const rows = await Auth.rest(`reports?id=eq.${id}`, {method:"PATCH", body:{status:st}, prefer:"return=representation"});
      // RLS turns a refused update into "0 rows changed", not an error.
      if(!rows || !rows.length) throw new Error("Not saved: the database refused it. Is this account still an admin?");
      const now = rows[0].status;
      card.dataset.status = now;
      btns.forEach(x => x.setAttribute("aria-pressed", String(x.dataset.st === now)));
      const leaves = filter !== "all" && now !== filter;
      card.classList.toggle("adm-moved", leaves);
      msg.classList.add("ok");
      msg.textContent = leaves ? `Marked ${STATUS[now].toLowerCase()}. It drops off this list when the list reloads.` : "Saved.";
      loadStats();
    }catch(err){
      if(err.kind !== "gone") msg.textContent = err.message;
    }finally{
      btns.forEach(x => { x.disabled = false; });
    }
  }

  if(typeof Auth !== "undefined"){
    outBtn.addEventListener("click", () => Auth.signOut());
    Auth.onChange(start);                     // signed in or out here, or in the app's tab
  }
  start();
})();
