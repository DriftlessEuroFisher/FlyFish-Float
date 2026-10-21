/* admin.html — the issue-report queue, a few account counts, the usage
   stats (supabase/metrics.sql) and the news/blog post editor
   (supabase/posts.sql), for accounts holding the admin role
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
   name: they are escaped the same way. Posts are the owner's own words, and
   are escaped all the same; their bodies are rendered by js/postmd.js, the
   renderer the published /news pages use, so the preview is the page. */

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
    ed = null;
    main.classList.remove("adm-editing");
    main.innerHTML = `
      <section class="adm-stats" id="adm-stats" aria-label="Counts"><p class="adm-note">Loading counts…</p></section>
      <section class="adm-posts" aria-label="Posts">
        <div class="adm-rhead"><h2>Posts</h2>
          <div class="adm-tools"><button type="button" class="adm-newpost" id="adm-newpost">New post</button></div>
        </div>
        <div id="adm-postlist"></div>
        <button type="button" class="adm-btn adm-more" id="adm-postmore" hidden>Load more</button>
      </section>
      <section class="adm-editor" id="adm-editor" aria-label="Post editor" hidden></section>
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
    $("#adm-reload").addEventListener("click", () => { loadStats(); loadUsage(); loadReports(true); loadPosts(true); });
    $("#adm-more").addEventListener("click", () => loadReports(false));
    $("#adm-list").addEventListener("click", setStatus);
    $("#adm-newpost").addEventListener("click", () => openEditor(null));
    $("#adm-postmore").addEventListener("click", () => loadPosts(false));
    $("#adm-postlist").addEventListener("click", e => {
      const b = e.target.closest("[data-edit]"); if(b) openEditor(+b.dataset.edit);
    });
    loadStats();
    loadPosts(true);
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

  /* ---------- Posts: announcements, blog posts, news links ----------
     The table is supabase/posts.sql; the public pages are built by the
     Worker (worker/index.js) and the homepage reads the latest few. Here an
     admin lists every post, drafts included, and writes them.

     Saving is plain PostgREST: POST to make a post, PATCH to change one. A
     change is sent only "where updated_at is still what I loaded", so a
     second tab can't be silently overwritten: zero rows back means someone
     saved in between (or the post is gone, or RLS refused), and the editor
     says which. Unsaved work is kept on this device as it is typed
     (localStorage adminPostDraft:<id>), offered back the next time that post
     is opened, and cleared once saved.

     Photos are resized here (canvas, 1600 px on the long edge, JPEG 0.85),
     then uploaded to the post-images bucket under <year>/<random uuid>.jpg.
     The upload carries the user's token like every admin call; the bucket's
     policies let only admins write. Nothing is deleted from the bucket when
     a photo is removed or a post deleted: the file may be in another post. */
  const POST_COLS = "id,kind,slug,title,summary,body,link_url,link_source,cover_path,cover_alt,status,pinned,show_until,published_at,created_at,updated_at";
  const POST_LIST_COLS = "id,kind,slug,title,status,pinned,show_until,published_at,updated_at";
  const POST_PAGE = 20;
  const PKIND = {announcement:"Announcement", blog:"Blog post", news:"News link"};
  const KIND_HINT = {
    announcement:"A short notice from you. Pin it to make it the banner at the top of the homepage.",
    blog:"Your own article, with a page of its own at trailwatermaps.com/news/….",
    news:"A link to someone else's article, with a one-line summary. Leave the body empty and the list links straight to the article; write a body (your own notes on it) and it gets a page too.",
  };
  const PHOTO_EDGE = 1600, PHOTO_MAX = 2 * 1024 * 1024, PHOTO_Q = 0.85;
  const PHOTO_ALT = "Describe the photo";               // the placeholder a body photo is inserted with
  const draftKey = id => `adminPostDraft:${id || "new"}`;
  const fmtDay = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString([], {month:"short", day:"numeric", year:"numeric"}); };
  const oneLine = s => String(s || "").replace(/[\u0000-\u001F\u007F\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  const pad = n => String(n).padStart(2, "0");
  // <input type=datetime-local> speaks local time with no zone; the table
  // speaks timestamptz.
  const toLocalInput = iso => { const d = new Date(iso); return !iso || isNaN(d) ? "" :
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const fromLocalInput = v => { const d = new Date(v); return !v || isNaN(d) ? null : d.toISOString(); };
  const photoBase = () => PostMD.imageBase(SUPABASE.url);
  let postLast = null, postSeq = 0, ed = null, slugTimer = null, prevTimer = null, draftTimer = null;

  /* ---------- the list ---------- */
  function postState(p){
    if(p.status !== "published") return {cls:"draft", text:"Draft"};
    if(Date.parse(p.published_at) > Date.now()) return {cls:"sched", text:`Scheduled ${fmtWhen(p.published_at)}`};
    return {cls:"live", text:`Published ${fmtDay(p.published_at)}`};
  }
  function bannerState(p){
    if(p.kind !== "announcement" || !p.pinned) return "";
    if(p.show_until && Date.parse(p.show_until) <= Date.now()) return "Banner ended";
    if(p.status !== "published") return "Banner once published";
    return p.show_until ? `Banner until ${fmtDay(p.show_until)}` : "Banner";
  }
  function postRowHTML(p){
    const st = postState(p), ban = bannerState(p), id = Number(p.id);
    return `<article class="adm-post" data-id="${id}">
      <div class="adm-post-top"><span class="adm-pkind">${esc(PKIND[p.kind] || p.kind)}</span><span class="adm-pst adm-pst-${st.cls}">${esc(st.text)}</span>${
        ban ? `<span class="adm-pst adm-pst-ban">${esc(ban)}</span>` : ""}</div>
      <button type="button" class="adm-ptitle" data-edit="${id}">${esc(p.title)}</button>
      <div class="adm-meta"><span class="mono">${p.slug ? `/news/${esc(p.slug)}` : "no page: links out"}</span><span class="mono">#${id}</span></div>
    </article>`;
  }
  /* Newest first by id (the order they were made), drafts included; paged
     by "older than the last id shown", like the reports. */
  async function loadPosts(reset){
    const list = $("#adm-postlist"), more = $("#adm-postmore"); if(!list) return;
    const my = ++postSeq;
    if(reset){ postLast = null; list.innerHTML = `<p class="adm-note">Loading posts…</p>`; more.hidden = true; }
    more.disabled = true;
    try{
      const rows = await Auth.rest(`posts?select=${POST_LIST_COLS}&order=id.desc&limit=${POST_PAGE}` + (postLast == null ? "" : `&id=lt.${postLast}`)) || [];
      if(my !== postSeq) return;
      if(reset) list.innerHTML = rows.length ? "" : `<p class="adm-empty adm-empty-sm">No posts yet. "New post" writes the first one.</p>`;
      list.insertAdjacentHTML("beforeend", rows.map(postRowHTML).join(""));
      if(rows.length) postLast = Number(rows[rows.length - 1].id);
      more.hidden = rows.length < POST_PAGE; more.disabled = false;
    }catch(err){
      if(my !== postSeq || err.kind === "gone") return;
      list.innerHTML = `<p class="adm-note">${err.kind === "setup"
        ? "Posts aren't set up on the server yet: run supabase/posts.sql in the SQL Editor."
        : `Posts didn't load. ${esc(err.message)}`}</p>`;
      more.disabled = false;
    }
  }

  /* ---------- the editor ---------- */
  function editorHTML(){
    const kinds = Object.keys(PKIND).map(k =>
      `<label><input type="radio" name="pe-kind" value="${k}"><span>${esc(PKIND[k])}</span></label>`).join("");
    return `
    <div class="adm-edhead">
      <button type="button" class="adm-back" id="pe-back">← Posts</button>
      <h2 id="pe-h">${ed.id ? "Edit post" : "New post"}</h2>
      <span class="adm-edstate" id="pe-state" role="status"></span>
    </div>
    <div class="adm-restore" id="pe-restore" hidden></div>
    <div class="adm-edgrid">
      <form class="adm-form" id="pe-form" novalidate>
        <fieldset class="adm-kinds"><legend>Kind</legend><div class="adm-seg adm-kindseg">${kinds}</div></fieldset>
        <p class="adm-hint" id="pe-kindhint"></p>

        <label for="pe-title">Title</label>
        <input id="pe-title" type="text" maxlength="140" autocomplete="off">

        <div id="pe-slugrow">
          <label for="pe-slug">Address</label>
          <div class="adm-slug"><span aria-hidden="true">/news/</span><input id="pe-slug" type="text" maxlength="80" autocomplete="off" autocapitalize="off" spellcheck="false" aria-describedby="pe-slugmsg"></div>
          <p class="adm-fieldmsg" id="pe-slugmsg"></p>
        </div>
        <p class="adm-hint" id="pe-nopage" hidden>No page of its own: with no body, the news list links straight to the article.</p>

        <div id="pe-linkrow">
          <label for="pe-link">Article address</label>
          <input id="pe-link" type="url" inputmode="url" maxlength="2000" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="https://…">
          <label for="pe-source">Source</label>
          <input id="pe-source" type="text" maxlength="80" autocomplete="off" placeholder="e.g. Iowa DNR">
        </div>

        <label for="pe-summary">Summary <span class="adm-count" id="pe-sumcount"></span></label>
        <textarea id="pe-summary" maxlength="300" rows="2"></textarea>
        <p class="adm-hint">One or two sentences: the text on cards, in search results and in link previews.</p>

        <label for="pe-body">Body</label>
        <div class="adm-toolbar" role="toolbar" aria-label="Formatting" aria-controls="pe-body">
          <button type="button" data-md="heading">Heading</button><button type="button" data-md="bold"><b>Bold</b></button><button type="button" data-md="italic"><i>Italic</i></button><button type="button" data-md="link">Link</button><button type="button" data-md="list">List</button><button type="button" data-md="photo">Photo</button>
        </div>
        <textarea id="pe-body" rows="14" maxlength="50000" spellcheck="true"></textarea>
        <input type="file" id="pe-bodyfile" accept="image/*" hidden>
        <p class="adm-upmsg" id="pe-bodyup" role="status" aria-live="polite"></p>
        <p class="adm-hint">## Heading · **bold** · *italic* · [words](https://…) · - list · 1. list · &gt; quote · a blank line between paragraphs.</p>

        <fieldset class="adm-coverbox"><legend>Cover photo</legend>
          <div class="adm-cover" id="pe-cover"></div>
          <div class="adm-coverbtns">
            <label class="adm-filebtn"><input type="file" id="pe-coverfile" accept="image/*"><span id="pe-coverpick">Choose photo</span></label>
            <button type="button" class="adm-linkbtn" id="pe-coverdel" hidden>Remove</button>
          </div>
          <p class="adm-upmsg" id="pe-coverup" role="status" aria-live="polite"></p>
          <div id="pe-altrow">
            <label for="pe-alt">Describe the photo</label>
            <input id="pe-alt" type="text" maxlength="300" autocomplete="off" placeholder="e.g. A drift boat below the Wilson bridge in October">
          </div>
          <p class="adm-hint">Shown at the top of the post and in link previews. Resized to 1600 px before it uploads.</p>
        </fieldset>

        <fieldset class="adm-pinbox" id="pe-pinrow"><legend>Homepage banner</legend>
          <label class="adm-check"><input type="checkbox" id="pe-pinned"> Show this announcement as the banner on the homepage</label>
          <label for="pe-until">Until (optional)</label>
          <input id="pe-until" type="datetime-local">
          <p class="adm-hint">After this it stops being the banner and stays on the news page.</p>
        </fieldset>

        <label for="pe-date">Publish date</label>
        <input id="pe-date" type="datetime-local">
        <p class="adm-hint" id="pe-datehint">Empty: the moment you publish. A date in the future schedules it: it stays hidden until then.</p>

        <div class="adm-formmsg" id="pe-msg" role="status" aria-live="polite"></div>
        <div class="adm-actions">
          <button type="button" class="adm-act" id="pe-save">Save draft</button>
          <button type="button" class="adm-act adm-primary" id="pe-publish">Publish</button>
          <button type="button" class="adm-act" id="pe-unpublish" hidden>Unpublish</button>
          <button type="button" class="adm-act adm-danger" id="pe-delete" hidden>Delete</button>
        </div>
        <p class="adm-hint" id="pe-live"></p>
      </form>
      <section class="adm-prevwrap" aria-labelledby="pe-prevh">
        <h3 class="adm-prevh" id="pe-prevh">Preview</h3>
        <div class="adm-warn" id="pe-warn" role="status"></div>
        <div class="adm-preview news-main" id="pe-preview"></div>
      </section>
    </div>`;
  }

  async function openEditor(id){
    const host = $("#adm-editor"); if(!host) return;
    main.classList.add("adm-editing");
    host.hidden = false;
    host.innerHTML = `<p class="adm-note">Loading…</p>`;
    window.scrollTo(0, 0);
    let row = null;
    if(id != null){
      try{
        row = (await Auth.rest(`posts?select=${POST_COLS}&id=eq.${Number(id)}`) || [])[0];
        if(!row) throw new Error("That post isn't there any more.");
      }catch(err){
        if(err.kind === "gone") return;
        host.innerHTML = `<div class="adm-card"><p>${esc(err.message)}</p><button type="button" class="adm-btn" id="pe-back">← Posts</button></div>`;
        $("#pe-back").addEventListener("click", () => closeEditor(true));
        return;
      }
    }
    ed = {id:row ? Number(row.id) : null, loaded:row || null, dirty:false, slugTouched:!!(row && row.slug),
          cover_path:row ? row.cover_path : null, slugTaken:"", busy:false, slugSeq:0, savedAt:null};
    host.innerHTML = editorHTML();
    wireEditor();
    fillForm(row ? valuesOf(row) : {kind:"blog"});
    offerDraft();
    refresh(true);
    $("#pe-title").focus();
  }
  function closeEditor(force){
    if(!force && ed && ed.dirty && !confirm("Leave the editor? Your unsaved changes stay on this device, and you're offered them back when you open this post again.")) return;
    clearTimeout(draftTimer); clearTimeout(prevTimer); clearTimeout(slugTimer);
    ed = null;
    main.classList.remove("adm-editing");
    const host = $("#adm-editor"); if(host){ host.hidden = true; host.innerHTML = ""; }
    loadPosts(true);
  }
  window.addEventListener("beforeunload", e => { if(ed && ed.dirty){ e.preventDefault(); e.returnValue = ""; } });

  /* The form's own values (what a draft keeps), and back. */
  const fv = id => $("#" + id);
  function readForm(){
    const k = main.querySelector('input[name="pe-kind"]:checked');
    return {kind:k ? k.value : "blog", title:fv("pe-title").value, slug:fv("pe-slug").value, slugTouched:ed.slugTouched,
      summary:fv("pe-summary").value, body:fv("pe-body").value, link:fv("pe-link").value, source:fv("pe-source").value,
      cover_path:ed.cover_path || null, alt:fv("pe-alt").value, pinned:fv("pe-pinned").checked,
      until:fv("pe-until").value, date:fv("pe-date").value};
  }
  function fillForm(v){
    const k = main.querySelector(`input[name="pe-kind"][value="${PKIND[v.kind] ? v.kind : "blog"}"]`); if(k) k.checked = true;
    fv("pe-title").value = v.title || ""; fv("pe-slug").value = v.slug || ""; fv("pe-summary").value = v.summary || "";
    fv("pe-body").value = v.body || ""; fv("pe-link").value = v.link || ""; fv("pe-source").value = v.source || "";
    fv("pe-alt").value = v.alt || ""; fv("pe-pinned").checked = !!v.pinned; fv("pe-until").value = v.until || "";
    fv("pe-date").value = v.date || "";
    ed.slugTouched = !!v.slugTouched; ed.cover_path = v.cover_path || null;
  }
  function valuesOf(row){
    return {kind:row.kind, title:row.title, slug:row.slug || "", slugTouched:!!row.slug, summary:row.summary || "",
      body:row.body || "", link:row.link_url || "", source:row.link_source || "", cover_path:row.cover_path || null,
      alt:row.cover_alt || "", pinned:!!row.pinned, until:toLocalInput(row.show_until), date:toLocalInput(row.published_at)};
  }

  /* What gets saved, from the form. A datetime box shows minutes only, so a
     date nobody touched keeps its stored value to the microsecond. */
  function collect(v){
    v = v || readForm();
    const body = String(v.body || "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    const hasBody = !!body.trim(), news = v.kind === "news", ann = v.kind === "announcement";
    const L = ed.loaded;
    const keep = (input, stored) => L && stored && input === toLocalInput(stored) ? stored : fromLocalInput(input);
    return {
      kind:v.kind,
      title:oneLine(v.title),
      slug:news && !hasBody ? null : (String(v.slug || "").trim() || null),
      summary:oneLine(v.summary) || null,
      body:hasBody ? body : null,
      link_url:news ? (String(v.link || "").trim() || null) : null,
      link_source:news ? (oneLine(v.source) || null) : null,
      cover_path:v.cover_path || null,
      cover_alt:v.cover_path ? (oneLine(v.alt) || null) : null,
      pinned:ann && !!v.pinned,
      show_until:ann && v.until ? keep(v.until, L && L.show_until) : null,
      published_at:v.date ? keep(v.date, L && L.published_at) : null,
    };
  }
  /* Plain-words reasons a save can't go ahead. The database checks all of
     this too (posts.sql); these say it before the round trip. */
  function problems(f){
    const out = [], pub = f.status === "published";
    if(!f.title) out.push("Give it a title.");
    if(f.kind === "news" && !f.link_url) out.push("A news link needs the article's address.");
    if(f.link_url && !/^https:\/\/[^\s"<>]+$/i.test(f.link_url)) out.push("The article address must start with https:// and have no spaces.");
    if(!(f.kind === "news" && !f.body)){
      if(!f.slug) out.push("It needs an address: the part after /news/.");
      else if(!PostMD.isSlug(f.slug)) out.push("The address can use only lowercase letters, numbers and single hyphens.");
      else if(ed.slugTaken) out.push(`The address /news/${f.slug} is already used by “${ed.slugTaken}”.`);
    }
    if(f.body && f.body.length > 50000) out.push("The body is over 50,000 characters.");
    if(f.show_until && Date.parse(f.show_until) <= Date.parse(f.published_at || new Date().toISOString())) out.push("The banner's end date is before the publish date.");
    if(pub && f.kind === "news" && !f.summary) out.push("A news link needs a one-line summary before it's published.");
    if(pub && f.kind === "blog" && !f.body) out.push("There's nothing in the body yet.");
    if(pub && f.cover_path && !f.cover_alt) out.push("Describe the cover photo before publishing (for people who can't see it, and for link previews).");
    if(pub && f.body && f.body.indexOf(`![${PHOTO_ALT}](`) >= 0) out.push(`A photo in the body still says “${PHOTO_ALT}”: type what it shows instead.`);
    return out;
  }

  function wireEditor(){
    const form = fv("pe-form");
    form.addEventListener("submit", e => e.preventDefault());
    form.addEventListener("input", e => {
      if(e.target.id === "pe-slug") ed.slugTouched = !!e.target.value.trim();
      if(e.target.id === "pe-title" && !ed.slugTouched) fv("pe-slug").value = PostMD.slugify(e.target.value);
      if(e.target.id === "pe-slug" || e.target.id === "pe-title") checkSlugSoon();
      changed();
    });
    form.addEventListener("change", e => { if(e.target.name === "pe-kind" || e.target.id === "pe-pinned") changed(); });
    fv("pe-back").addEventListener("click", () => closeEditor(false));
    fv("pe-save").addEventListener("click", () => save("save"));
    fv("pe-publish").addEventListener("click", () => save("publish"));
    fv("pe-unpublish").addEventListener("click", () => save("unpublish"));
    fv("pe-delete").addEventListener("click", removePost);
    form.querySelector(".adm-toolbar").addEventListener("click", e => {
      const b = e.target.closest("[data-md]"); if(b) toolbar(b.dataset.md);
    });
    fv("pe-bodyfile").addEventListener("change", e => photoPicked(e.target, "body"));
    fv("pe-coverfile").addEventListener("change", e => photoPicked(e.target, "cover"));
    fv("pe-coverdel").addEventListener("click", () => { ed.cover_path = null; changed(); });
  }
  function changed(){
    if(!ed) return;
    ed.dirty = true;
    const m = fv("pe-msg");
    if(m && m.classList.contains("ok")) m.textContent = "";   // "Saved." no longer true; errors stay until the next try
    clearTimeout(draftTimer);
    draftTimer = setTimeout(draftWrite, 500);
    refresh(false);
  }

  /* Everything that follows from the form: which rows show, counters, the
     state line, which buttons, and (soon) the preview. */
  function refresh(now){
    if(!ed) return;
    const v = readForm(), f = collect(v), L = ed.loaded;
    const news = v.kind === "news", hasPage = !(news && !f.body);
    fv("pe-kindhint").textContent = KIND_HINT[v.kind] || "";
    fv("pe-linkrow").hidden = !news;
    fv("pe-pinrow").hidden = v.kind !== "announcement";
    fv("pe-slugrow").hidden = !hasPage;
    fv("pe-nopage").hidden = hasPage;
    fv("pe-sumcount").textContent = `${v.summary.length} / 300`;
    const cover = PostMD.photoURL(photoBase(), ed.cover_path);
    fv("pe-cover").innerHTML = cover ? `<img src="${esc(cover)}" alt="">` : `<span class="adm-note">No cover photo.</span>`;
    fv("pe-coverpick").textContent = cover ? "Replace photo" : "Choose photo";
    fv("pe-coverdel").hidden = !cover;
    fv("pe-altrow").hidden = !cover;
    slugMessage();
    const published = !!(L && L.status === "published");
    fv("pe-save").textContent = published ? "Save changes" : "Save draft";
    fv("pe-publish").hidden = published;
    fv("pe-unpublish").hidden = !published;
    fv("pe-delete").hidden = !ed.id;
    fv("pe-h").textContent = ed.id ? "Edit post" : "New post";
    const at = L && L.published_at;
    const state = !L ? "New · not saved yet"
      : !published ? "Draft"
      : Date.parse(at) > Date.now() ? `Scheduled for ${fmtWhen(at)}`
      : `Published ${fmtDay(at)}`;
    fv("pe-state").textContent = state + (ed.dirty ? " · unsaved changes" : ed.savedAt ? ` · saved ${new Date(ed.savedAt).toLocaleTimeString([], {hour:"numeric", minute:"2-digit"})}` : "");
    const live = published && L.slug && Date.parse(at) <= Date.now() ? L.slug : "";
    fv("pe-live").innerHTML = live ? `Live at <a href="news/${esc(live)}" target="_blank" rel="noopener">trailwatermaps.com/news/${esc(live)}</a>` : "";
    clearTimeout(prevTimer);
    if(now) preview(); else prevTimer = setTimeout(preview, 150);
  }

  /* The preview: the same markup worker/render.js articleHTML() writes, the
     same css/news.css, and the same PostMD.render, so it reads as the page
     will. Links and photos PostMD refused are listed above it. */
  function preview(){
    if(!ed) return;
    const f = collect(), base = photoBase(), dropped = [];
    const body = f.body ? PostMD.render(f.body, {imageBase:base, dropped}) : "";
    const cover = PostMD.photoURL(base, f.cover_path);
    const when = f.published_at || (ed.loaded && ed.loaded.status === "published" ? ed.loaded.published_at : null);
    const out = f.link_url && /^https:\/\/[^\s"<>\\`]+$/i.test(f.link_url) ? f.link_url : "";
    const kind = ["announcement", "blog", "news"].includes(f.kind) ? f.kind : "news";
    fv("pe-preview").innerHTML = `<article class="post">
      <p class="post-back"><a href="news" target="_blank" rel="noopener">← All news</a></p>
      <header class="post-head">
        <p class="post-meta"><span class="nkind nkind-${kind}">${esc({announcement:"Announcement", blog:"Blog", news:"News"}[kind])}</span><time>${
          esc(when ? new Date(when).toLocaleDateString("en-US", {month:"long", day:"numeric", year:"numeric"}) : "Not published yet")}</time></p>
        <h1>${esc(f.title || "Title")}</h1>${f.summary ? `<p class="post-lede">${esc(f.summary)}</p>` : ""}
      </header>${cover ? `<figure class="post-cover"><img src="${esc(cover)}" alt="${esc(f.cover_alt || "")}"></figure>` : ""}${
      body ? `<div class="post-body">${body}</div>` : ""}${out ? `<p class="post-orig"><a href="${esc(out)}" target="_blank" rel="noopener noreferrer">Read the original${
        f.link_source ? ` at ${esc(f.link_source)}` : ""} <span aria-hidden="true">↗</span></a></p>` : ""}
    </article>`;
    const warn = dropped.map(d => d.kind === "image"
      ? `A photo isn't from this site's photo storage, so it won't show: ${esc(d.url)}. Use the Photo button to upload it.`
      : `A link isn't https://, http://, mailto: or a /path, so it shows as plain text: ${esc(d.url)}`);
    if(f.kind === "news" && !f.body) warn.unshift("With no body there's no page: on the news list and the homepage this title links straight to the article.");
    fv("pe-warn").innerHTML = warn.map(w => `<p>${w}</p>`).join("");
  }

  /* ---------- the address (slug) ---------- */
  function slugMessage(){
    const el = fv("pe-slugmsg"), s = fv("pe-slug").value.trim();
    el.className = "adm-fieldmsg";
    if(!s){ el.textContent = "Needed: the post's page lives at /news/<address>."; return; }
    if(!PostMD.isSlug(s)){ el.textContent = "Only lowercase letters, numbers and single hyphens, like river-levels-in-may."; el.classList.add("bad"); return; }
    if(ed.slugTaken){ el.textContent = `Already used by “${ed.slugTaken}”. Change it before saving.`; el.classList.add("bad"); return; }
    el.textContent = `trailwatermaps.com/news/${s}`;
  }
  function checkSlugSoon(){
    clearTimeout(slugTimer);
    ed.slugTaken = "";
    slugTimer = setTimeout(checkSlug, 400);
  }
  async function checkSlug(){
    if(!ed) return;
    const s = fv("pe-slug").value.trim(), my = ++ed.slugSeq;
    if(!PostMD.isSlug(s)) return;
    try{
      const rows = await Auth.rest(`posts?select=id,title&slug=eq.${s}` + (ed.id ? `&id=neq.${ed.id}` : "") + "&limit=1") || [];
      if(!ed || my !== ed.slugSeq) return;
      ed.slugTaken = rows.length ? (rows[0].title || `post #${rows[0].id}`) : "";
      slugMessage();
    }catch(err){ /* the save will say so if it really is taken */ }
  }

  /* ---------- saving ---------- */
  // Constraint names in posts.sql, in plain words.
  const CHECKS = [
    [/posts_page_check/, "It needs an address, unless it's a news link with no body."],
    [/posts_news_link_check/, "A news link needs the article's address."],
    [/posts_slug_check/, "The address can use only lowercase letters, numbers and single hyphens."],
    [/posts_link_url_check/, "The article address must start with https:// and have no spaces."],
    [/posts_title_check/, "The title is empty, too long, or has a line break in it."],
    [/posts_summary_check/, "The summary is too long."],
    [/posts_body_check/, "The body is too long."],
    [/posts_cover_alt_check/, "The photo description is too long."],
    [/posts_link_source_check/, "The source name is too long."],
    [/posts_pinned_check/, "Only an announcement can be the homepage banner."],
  ];
  function saveError(err){
    if(err.code === "23505") return "That address is already used by another post. Change it and save again.";
    if(err.code === "23514"){ const c = CHECKS.find(([re]) => re.test(err.detail || "")); return `Not saved. ${c ? c[1] : err.detail || err.message}`; }
    if(err.kind === "setup") return "Posts aren't set up on the server yet: run supabase/posts.sql in the SQL Editor.";
    if(err.kind === "denied") return "Not saved: this account isn't allowed to change posts.";
    return `Not saved. ${err.message}`;
  }
  function say(lines, ok){
    const el = fv("pe-msg"); if(!el) return;
    lines = [].concat(lines).filter(Boolean);
    el.className = "adm-formmsg" + (ok ? " ok" : "");
    el.innerHTML = lines.length > 1 ? `<ul>${lines.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : esc(lines[0] || "");
  }
  function busy(on){
    ed.busy = on;
    fv("pe-form").querySelectorAll(".adm-act").forEach(b => { b.disabled = on; });
  }

  async function save(action){
    if(!ed || ed.busy) return;
    const f = collect(), L = ed.loaded;
    f.status = action === "publish" ? "published" : action === "unpublish" ? "draft" : (L ? L.status : "draft");
    if(action === "publish" && !f.published_at) f.published_at = new Date().toISOString();
    const errs = problems(f);
    if(errs.length) return say(errs);
    busy(true); say(action === "publish" ? "Publishing…" : "Saving…", true);
    try{
      let rows;
      if(!ed.id){
        rows = await Auth.rest(`posts?select=${POST_COLS}`, {method:"POST", body:f, prefer:"return=representation"});
      }else{
        rows = await Auth.rest(`posts?id=eq.${ed.id}&updated_at=eq.${encodeURIComponent(L.updated_at)}&select=${POST_COLS}`,
          {method:"PATCH", body:f, prefer:"return=representation"});
        if(!rows || !rows.length) throw new Error(await whyNotSaved());
      }
      const row = rows && rows[0];
      if(!row) throw new Error("Not saved: the database sent nothing back. Is this account still an admin?");
      const wasNew = !ed.id;
      draftClear(ed.id);
      if(wasNew) draftClear(null);
      ed.id = Number(row.id); ed.loaded = row; ed.dirty = false; ed.savedAt = Date.now();
      // Put back what the database stored (the trigger may have set the
      // publish date), keeping the cursor where it is in the body.
      const v = valuesOf(row), b = fv("pe-body"), at = [b.selectionStart, b.selectionEnd];
      fillForm(Object.assign(readForm(), {date:v.date, until:v.until, slug:v.slug || fv("pe-slug").value, slugTouched:ed.slugTouched || !!row.slug}));
      try{ b.setSelectionRange(at[0], at[1]); }catch(e){}
      refresh(true);
      say(action === "publish" ? (Date.parse(row.published_at) > Date.now() ? `Scheduled: it goes public ${fmtWhen(row.published_at)}.` : "Published.")
        : action === "unpublish" ? "Unpublished: it's a draft again and off the site (the news page can take up to 5 minutes to catch up)."
        : "Saved.", true);
    }catch(err){
      if(err.kind === "gone") return;
      say(err instanceof Auth.AuthError ? saveError(err) : err.message);
    }finally{
      if(ed) busy(false);
    }
  }
  /* A PATCH that matched no row: deleted, saved elsewhere, or refused. */
  async function whyNotSaved(){
    try{
      const now = (await Auth.rest(`posts?select=id,updated_at&id=eq.${ed.id}`) || [])[0];
      if(!now) return "Not saved: this post has been deleted. Your text is kept on this device; copy it out before leaving.";
      if(now.updated_at !== ed.loaded.updated_at) return "Not saved: this post was changed somewhere else (another tab?) since you opened it. Your text is kept on this device; open the post again from the list to see the newer version and restore yours.";
    }catch(e){}
    return "Not saved: the database refused it. Is this account still an admin?";
  }

  async function removePost(){
    if(!ed || !ed.id || ed.busy) return;
    const title = oneLine(fv("pe-title").value) || "this post";
    if(!confirm(`Delete “${title}”? This can't be undone. Its photos stay in storage.`)) return;
    busy(true); say("Deleting…", true);
    try{
      const rows = await Auth.rest(`posts?id=eq.${ed.id}&select=id`, {method:"DELETE", prefer:"return=representation"});
      if(!rows || !rows.length) throw new Error("Not deleted: the database refused it, or it was already gone.");
      draftClear(ed.id);
      ed.dirty = false;
      closeEditor(true);
    }catch(err){
      if(err.kind === "gone") return;
      say(err instanceof Auth.AuthError ? saveError(err).replace(/^Not saved/, "Not deleted") : err.message);
      if(ed) busy(false);
    }
  }

  /* ---------- the unsaved draft on this device ---------- */
  function draftWrite(){
    if(!ed || !ed.dirty) return;
    try{ localStorage.setItem(draftKey(ed.id), JSON.stringify({at:Date.now(), base:ed.loaded ? ed.loaded.updated_at : null, v:readForm()})); }catch(e){}
  }
  function draftRead(id){
    try{ const d = JSON.parse(localStorage.getItem(draftKey(id)) || "null"); return d && d.v && typeof d.v === "object" ? d : null; }
    catch(e){ return null; }
  }
  function draftClear(id){ try{ localStorage.removeItem(draftKey(id)); }catch(e){} }
  function offerDraft(){
    const d = draftRead(ed.id), box = fv("pe-restore");
    if(!d) return;
    const cur = readForm(), same = ["kind", "title", "slug", "summary", "body", "link", "source", "cover_path", "alt", "pinned", "until", "date"]
      .every(k => String(d.v[k] == null ? "" : d.v[k]) === String(cur[k] == null ? "" : cur[k]));
    if(same){ draftClear(ed.id); return; }
    const newer = ed.loaded && d.base && d.base !== ed.loaded.updated_at;
    box.innerHTML = `<p>Unsaved changes from ${esc(fmtWhen(new Date(d.at).toISOString()))} are kept on this device.${
      newer ? " The post has been saved since then, so restoring replaces that newer version once you save." : ""}</p>
      <div class="adm-restorebtns"><button type="button" class="adm-btn" id="pe-restoreyes">Restore them</button><button type="button" class="adm-linkbtn" id="pe-restoreno">Discard</button></div>`;
    box.hidden = false;
    fv("pe-restoreyes").addEventListener("click", () => {
      fillForm(Object.assign({}, cur, d.v));
      box.hidden = true; box.innerHTML = "";
      changed(); checkSlugSoon();
    });
    fv("pe-restoreno").addEventListener("click", () => { draftClear(ed.id); box.hidden = true; box.innerHTML = ""; });
  }

  /* ---------- the body toolbar ---------- */
  function toolbar(what){
    const t = fv("pe-body");
    if(what === "photo"){ fv("pe-bodyfile").click(); return; }
    const s = t.selectionStart, e = t.selectionEnd, sel = t.value.slice(s, e);
    const put = (text, selFrom, selTo) => {
      t.focus();
      t.setRangeText(text, s, e, "end");
      if(selFrom != null) t.setSelectionRange(s + selFrom, s + selTo);
      changed();
    };
    if(what === "bold" || what === "italic"){
      const m = what === "bold" ? "**" : "*", inner = sel.trim() || (what === "bold" ? "bold words" : "italic words");
      return put(m + inner + m, m.length, m.length + inner.length);
    }
    if(what === "link"){
      const url = prompt("Link address (https://…, or a page on this site like /app):", "https://");
      if(url == null) return t.focus();
      const u = url.trim(), words = sel.trim() || "link words";
      return put(`[${words}](${u})`, 1, 1 + words.length);
    }
    // Heading and list work on whole lines.
    const a = t.value.lastIndexOf("\n", s - 1) + 1;
    let b = t.value.indexOf("\n", Math.max(e - (e > s && t.value[e - 1] === "\n" ? 1 : 0), s)); if(b < 0) b = t.value.length;
    const lines = t.value.slice(a, b).split("\n");
    const mark = what === "heading" ? "## " : "- ";
    const strip = l => l.replace(/^(#{2,3} |[-*+] |\d{1,9}[.)] )/, "");
    const all = lines.every(l => l.startsWith(mark) || !l.trim());
    const out = lines.map(l => !l.trim() ? l : all ? l.slice(mark.length) : mark + strip(l)).join("\n");
    t.focus();
    t.setRangeText(out, a, b, "select");
    changed();
  }

  /* ---------- photos ---------- */
  function loadImage(file){
    // An <img> rather than createImageBitmap: every current browser draws it
    // the right way up (EXIF orientation), and it reads what Safari reads.
    return new Promise((ok, no) => {
      const url = URL.createObjectURL(file), im = new Image();
      im.onload = () => { URL.revokeObjectURL(url); ok(im); };
      im.onerror = () => { URL.revokeObjectURL(url); no(new Error("decode")); };
      im.src = url;
    });
  }
  const toBlob = (c, q) => new Promise((ok, no) => c.toBlob(b => b ? ok(b) : no(new Error("encode")), "image/jpeg", q));
  async function shrink(file){
    if(file.type && !/^image\//.test(file.type)) throw new Error("That file isn't a photo.");
    let im;
    try{ im = await loadImage(file); }catch(e){ throw new Error("This photo couldn't be read here. Try a JPEG or PNG."); }
    const w0 = im.naturalWidth, h0 = im.naturalHeight;
    if(!w0 || !h0) throw new Error("This photo couldn't be read here. Try a JPEG or PNG.");
    const k = Math.min(1, PHOTO_EDGE / Math.max(w0, h0)), w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);            // a transparent PNG would turn black as JPEG
    g.imageSmoothingQuality = "high";
    g.drawImage(im, 0, 0, w, h);
    let blob = await toBlob(c, PHOTO_Q);
    if(blob.size > PHOTO_MAX) blob = await toBlob(c, 0.7);
    if(blob.size > PHOTO_MAX) throw new Error("Even resized, this photo is over 2 MB.");
    return {blob, w, h};
  }
  function uuid(){
    if(crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); b[6] = b[6] & 15 | 64; b[8] = b[8] & 63 | 128;
    const x = Array.from(b, n => n.toString(16).padStart(2, "0")).join("");
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
  }
  async function storageError(res){
    let d = {};
    try{ d = await res.json(); }catch(e){}
    const text = `${d.error || ""} ${d.message || ""} ${d.statusCode || ""}`;
    if(res.status === 413 || /payload too large|maximum allowed size|exceeded/i.test(text)) return "The photo is over the 2 MB limit.";
    if(/bucket not found/i.test(text)) return "Photo storage isn't set up yet: run supabase/posts.sql in the SQL Editor.";
    if(/mime|invalid_mime_type/i.test(text)) return "That kind of file isn't allowed (JPEG, PNG or WebP only).";
    if(res.status === 401 || res.status === 403 || /row-level security|unauthorized|403/i.test(text)) return "This account isn't allowed to upload photos.";
    if(res.status >= 500) return "Photo storage didn't answer properly. Try again in a minute.";
    return `The upload failed (error ${res.status}).`;
  }
  async function upload(blob){
    const path = `${new Date().getFullYear()}/${uuid()}.jpg`;
    const res = await Auth.authFetch(`/storage/v1/object/post-images/${path}`, {method:"POST", raw:blob, timeout:60000,
      // The name is random and never reused, so the file can be cached for a year.
      headers:{"Content-Type":"image/jpeg", "Cache-Control":"max-age=31536000", "x-upsert":"false"}});
    if(!res.ok) throw new Error(await storageError(res));
    return path;
  }
  async function photoPicked(input, where){
    const file = input.files && input.files[0];
    input.value = "";                                        // the same file can be picked again
    if(!file || !ed) return;
    const msg = fv(where === "cover" ? "pe-coverup" : "pe-bodyup");
    const my = ed;
    msg.className = "adm-upmsg"; msg.textContent = "Resizing the photo…";
    try{
      const {blob, w, h} = await shrink(file);
      msg.textContent = `Uploading ${Math.max(1, Math.round(blob.size / 1024))} KB (${w} × ${h})…`;
      const path = await upload(blob);
      if(ed !== my) return;                                  // the editor was closed meanwhile
      if(where === "cover"){
        ed.cover_path = path;
        changed();
        msg.className = "adm-upmsg ok"; msg.textContent = "Uploaded. Describe it below.";
        fv("pe-alt").focus();
      }else{
        const t = fv("pe-body"), url = photoBase() + path, alt = PHOTO_ALT;
        const s = t.selectionStart, before = t.value.slice(0, s), lead = !before || /\n\n$/.test(before) ? "" : /\n$/.test(before) ? "\n" : "\n\n";
        const text = `${lead}![${alt}](${url})\n\n`;
        t.focus();
        t.setRangeText(text, s, t.selectionEnd, "end");
        t.setSelectionRange(s + lead.length + 2, s + lead.length + 2 + alt.length);   // type over the description
        changed();
        msg.className = "adm-upmsg ok"; msg.textContent = `Uploaded and added to the body. Type over “${PHOTO_ALT}”.`;
      }
    }catch(err){
      if(err.kind === "gone") return;
      msg.className = "adm-upmsg bad"; msg.textContent = err.message;
    }
  }

  if(typeof Auth !== "undefined"){
    outBtn.addEventListener("click", () => Auth.signOut());
    Auth.onChange(start);                     // signed in or out here, or in the app's tab
  }
  start();
})();
