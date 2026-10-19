/* admin.html — the issue-report queue, a few account counts and the usage
   stats (supabase/metrics.sql), for accounts holding the admin role
   (supabase/auth.sql). Same sign-in as the app
   (js/signin.js), and the same session when opened in the same browser.

   Hiding things from a non-admin here is courtesy, not protection. The
   protection is row-level security: made by hand with a non-admin's token,
   these same requests get no reports back, change no status, and
   admin_stats() raises an error. Nothing on this page is secret; only what
   the database agrees to return differs.

   Every report field was typed by a stranger, so all of it goes through
   esc() before it touches innerHTML (and the page's Content-Security-Policy
   would refuse to run injected script anyway). The usage stats are posted
   with the app's public key, so anyone can put any text in a target or a
   name: they are escaped the same way. */

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
  const WINDOWS = [7, 30, 90];
  let usageDays = 30, usageSeq = 0, perDay = [];
  try{ const w = +localStorage.getItem("adminUsageDays"); if(WINDOWS.includes(w)) usageDays = w; }catch(e){}

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
      <section class="adm-usage" aria-label="Usage">
        <div class="adm-rhead"><h2>Usage</h2>
          <div class="adm-tools" role="group" aria-label="Usage window">${WINDOWS.map(n =>
            `<button type="button" data-days="${n}" aria-pressed="${n === usageDays}">${n} days</button>`).join("")}</div>
        </div>
        <div id="adm-usage"></div>
      </section>
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
    main.querySelectorAll("[data-days]").forEach(b => b.addEventListener("click", () => {
      usageDays = +b.dataset.days;
      try{ localStorage.setItem("adminUsageDays", String(usageDays)); }catch(e){}
      main.querySelectorAll("[data-days]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
      loadUsage();
    }));
    $("#adm-usage").addEventListener("pointerover", chartPoint);
    $("#adm-usage").addEventListener("click", chartPoint);
    $("#adm-reload").addEventListener("click", () => { loadStats(); loadUsage(); loadReports(true); });
    $("#adm-more").addEventListener("click", () => loadReports(false));
    $("#adm-list").addEventListener("click", setStatus);
    loadStats();
    loadUsage();
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

  /* ---------- Usage ----------
     Everything comes from one call, admin_metrics(days, tz): the active
     counts (always the last 1, 7 and 30 days), and for the chosen window the
     launches per day, the top rivers, lakes and regions, feature use, the
     home-screen split and app versions. tz is this browser's own zone, so a
     bar is a day here. Names travel with the events (the app sends the name
     it showed), because this page can't load the app's 3.7 MB river data;
     where there is no name, the id is shown. */
  const FEATURES = {
    fieldbook_open:"Field Book opened", trip_logged:"Trip logged (✓ Fished)", favourite_add:"Favorite added",
    float_start:"Float started", float_end:"Float ended", laketrip_start:"Lake trip started", laketrip_end:"Lake trip ended",
    offline_save:"Offline area saved", report_sent:"Report sent", signin:"Signed in", signout:"Signed out",
    tour_start:"Tour started", layer_on:"Map icon switched on", gauge_tap:"Gauge tapped", zone_pick:"Region picked (chooser or Jump to)",
  };
  const num = n => Number(n || 0).toLocaleString();
  const dayDate = s => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ""); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  const dayText = s => { const d = dayDate(s); return d ? d.toLocaleDateString([], {month:"short", day:"numeric"}) : String(s || ""); };
  const tile = (n, label, sub) => `<div class="adm-tile"><b>${esc(num(n))}</b><span>${esc(label)}</span>${sub ? `<span class="adm-sub">${esc(sub)}</span>` : ""}</div>`;
  const signedIn = n => n ? `${num(n)} signed in` : "";

  /* A plain table: rows of [label html, ...numbers]. The label is already
     escaped by the caller; numbers are formatted here. */
  function table(head, rows, empty){
    if(!rows.length) return `<p class="adm-empty adm-empty-sm">${esc(empty)}</p>`;
    return `<div class="adm-tblwrap"><table class="adm-tbl"><thead><tr>${head.map((h, i) => `<th${i ? ` class="n"` : ""} scope="col">${esc(h)}</th>`).join("")}</tr></thead><tbody>` +
      rows.map(r => `<tr><td>${r[0]}</td>${r.slice(1).map(n => `<td class="n">${esc(num(n))}</td>`).join("")}</tr>`).join("") +
      `</tbody></table></div>`;
  }
  const named = (name, id) => name
    ? `${esc(name)} <span class="adm-id">${esc(id)}</span>`
    : `<span class="adm-id adm-id-only">${esc(id)}</span>`;
  const fold = (title, inner, open) => `<details class="adm-fold"${open ? " open" : ""}><summary>${esc(title)}</summary>${inner}</details>`;

  /* Launches per day, one bar a day. viewBox units stretch to the width of
     the card (preserveAspectRatio none), so a bar is 10 units with a 2-unit
     gap at any width; labels live outside the SVG, in HTML, where stretching
     can't distort them. Every value is also in the table under it, and a
     tap or hover on a bar names that day. */
  function chartHTML(days){
    const n = days.length, W = n * 12, H = 100;
    const max = Math.max(1, ...days.map(d => +d.launches || 0));
    const bars = days.map((d, i) => {
      const v = +d.launches || 0, h = v ? Math.max(1.5, v / max * (H - 4)) : 0;
      // a full-height hit area per day, so a 3-pixel bar on a phone is still easy to tap
      return `<rect class="adm-hit" data-i="${i}" x="${i * 12}" y="0" width="12" height="${H}"></rect>` +
        (h ? `<rect class="adm-bar" data-i="${i}" x="${i * 12 + 1}" y="${(H - h).toFixed(2)}" width="10" height="${h.toFixed(2)}"></rect>` : "");
    }).join("");
    const total = days.reduce((a, d) => a + (+d.launches || 0), 0);
    return `<figure class="adm-chart">
      <figcaption><b>Launches per day</b><span class="adm-max">max ${esc(num(max))}</span></figcaption>
      <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(`Launches per day, ${num(total)} in ${n} days, most in one day ${num(max)}`)}">
        <line class="adm-base" x1="0" y1="${H - 0.5}" x2="${W}" y2="${H - 0.5}"></line>${bars}</svg>
      <div class="adm-axis"><span>${esc(dayText(days[0] && days[0].day))}</span><span>${esc(dayText(days[n - 1] && days[n - 1].day))}</span></div>
      <p class="adm-readout" id="adm-readout" aria-live="polite">Tap or point at a bar for that day.</p>
    </figure>` +
    fold("Per day, as a table", table(["Day", "Launches", "Phones"],
      days.slice().reverse().map(d => [esc(dayText(d.day)), d.launches, d.devices]), "No days."));
  }
  function chartPoint(e){
    const r = e.target.closest && e.target.closest(".adm-chart rect[data-i]"); if(!r) return;
    const d = perDay[+r.dataset.i], out = $("#adm-readout"); if(!d || !out) return;
    out.textContent = `${dayText(d.day)}: ${num(d.launches)} launch${+d.launches === 1 ? "" : "es"}, ${num(d.devices)} phone${+d.devices === 1 ? "" : "s"}`;
    $("#adm-usage").querySelectorAll(".adm-bar.on").forEach(b => b.classList.remove("on"));
    const bar = $("#adm-usage").querySelector(`.adm-bar[data-i="${+r.dataset.i}"]`); if(bar) bar.classList.add("on");
  }

  function usageHTML(d){
    const a = d.active || {}, sa = d.standalone || {};
    perDay = Array.isArray(d.per_day) ? d.per_day : [];
    const launches = perDay.reduce((x, p) => x + (+p.launches || 0), 0);
    const counts = {}; (d.features || []).forEach(f => { counts[f.kind] = f; });
    const feats = Object.keys(FEATURES).map(k => [k, counts[k] || {n:0, devices:0}])
      .sort((x, y) => y[1].n - x[1].n || FEATURES[x[0]].localeCompare(FEATURES[y[0]]));
    const list = k => Array.isArray(d[k]) ? d[k] : [];
    return `<div class="adm-stats adm-stats-usage">` +
        tile(a.d1_devices, "Phones, last 24 hours", signedIn(a.d1_users)) +
        tile(a.d7_devices, "Phones, last 7 days", signedIn(a.d7_users)) +
        tile(a.d30_devices, "Phones, last 30 days", signedIn(a.d30_users)) +
        tile(launches, `Launches, last ${d.days || usageDays} days`) +
        tile(d.returning, `Phones back on another day`, `of ${num(d.devices)} in ${d.days || usageDays} days`) +
      `</div>` +
      chartHTML(perDay) +
      fold("Rivers opened", table(["River", "Opens", "Phones"],
        list("rivers").map(r => [named(r.name, r.target), r.opens, r.devices]), "No rivers opened yet."), true) +
      fold("Lakes opened", table(["Lake", "Opens", "Phones"],
        list("lakes").map(r => [named(r.name, r.target), r.opens, r.devices]), "No lakes opened yet.")) +
      fold("Regions viewed", table(["State or park", "Views", "Phones"],
        list("regions").map(r => [named(r.name, r.target), r.views, r.devices]), "No regions viewed yet.")) +
      fold("Region picks (chooser and Jump to)", table(["Picked", "Times", "Phones"],
        list("zone_picks").map(r => [named(r.name, r.target), r.n, r.devices]), "No picks yet.")) +
      fold("Features", table(["Feature", "Times", "Phones"],
        feats.map(([k, f]) => [esc(FEATURES[k]), f.n, f.devices]), "")) +
      fold("Map icons switched on", table(["Chip", "Times", "Phones"],
        list("layers").map(r => [`<span class="adm-id adm-id-only">${esc(r.target)}</span>`, r.n, r.devices]), "No icons switched on yet.")) +
      fold("Home-screen app or browser", table(["Opened as", "Launches", "Phones"],
        [["Home-screen app", sa.app_launches, sa.app_devices], ["Browser tab", sa.browser_launches, sa.browser_devices]], "")) +
      fold("App versions", table(["Version", "Launches", "Phones"],
        list("versions").map(r => [`<span class="mono">${esc(r.app_version)}</span>`, r.launches, r.devices]), "No launches yet.")) +
      `<p class="adm-note adm-usage-note">Counts are of phones (one random ID each), not people: Safari and the home-screen app on one iPhone are two phones. Days are in ${esc(d.tz || "UTC")}.</p>`;
  }

  async function loadUsage(){
    const el = $("#adm-usage"); if(!el) return;
    const my = ++usageSeq;
    el.innerHTML = `<p class="adm-note">Loading usage…</p>`;
    let tz = "UTC";
    try{ tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"; }catch(e){}
    try{
      const d = await Auth.rpc("admin_metrics", {days:usageDays, tz}) || {};
      if(my !== usageSeq) return;
      el.innerHTML = usageHTML(d);
    }catch(err){
      if(my !== usageSeq || err.kind === "gone") return;
      el.innerHTML = `<p class="adm-note">${err.kind === "setup"
        ? "Usage stats aren't set up on the server yet: run supabase/metrics.sql in the SQL Editor."
        : `Usage didn't load. ${esc(err.message)}`}</p>`;
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
