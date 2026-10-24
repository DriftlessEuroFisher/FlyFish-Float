/* News for the homepage mockups (home-a/b/c). Reads the latest posts from
   Supabase like js/home-news.js. If there are none (or no signal), it shows
   clearly labelled SAMPLE cards so the layout can be judged. Not for the live
   homepage. [data-nw="lead"] takes the first post, [data-nw="list"] the next
   data-count; every field is escaped. */
(function(){
  "use strict";
  const lead = document.querySelector('[data-nw="lead"]'), list = document.querySelector('[data-nw="list"]');
  if(!lead && !list) return;
  const want = (lead ? 1 : 0) + (list ? +list.dataset.count || 3 : 0);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const KINDS = {announcement:"Announcement", blog:"Blog", news:"News", sample:"Sample"};
  const SAMPLE = [
    {kind:"sample", title:"Snake River runs above average after the October storm", summary:"What the gauges say, and which sections are worth the drive this weekend.", published_at:"2026-10-23T12:00:00Z", href:"news"},
    {kind:"sample", title:"New: Maine and Missouri join the map", summary:"Sixty-five more rivers, each with its own fishing rules.", published_at:"2026-10-22T12:00:00Z", href:"news"},
    {kind:"sample", title:"Reading a flow number against the median", summary:"Why 'below average' beats a raw CFS figure on a spring creek.", published_at:"2026-10-20T12:00:00Z", href:"news"},
    {kind:"sample", title:"Driftless streams: fall regulation changes to check", summary:"Catch-and-release windows that start in the next two weeks.", published_at:"2026-10-18T12:00:00Z", href:"news"},
    {kind:"sample", title:"Field Book tips for tracking a season", summary:"Log the day in one tap, read it back next spring.", published_at:"2026-10-15T12:00:00Z", href:"news"}
  ];
  const day = iso => { const d = new Date(iso); return isNaN(d) ? "" : d.toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}); };
  const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  function target(p){
    if(p.href) return {href:p.href, out:false};
    if(typeof p.slug === "string" && SLUG.test(p.slug)) return {href:"news/" + p.slug, out:false};
    return /^https:\/\/[^\s"<>\\`]+$/i.test(p.link_url || "") ? {href:p.link_url, out:true} : null;
  }
  function card(p, base){
    const to = target(p); if(!to) return "";
    const path = String(p.cover_path || "");
    const img = base && /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(path) && path.indexOf("..") < 0 ? base + path : "";
    const k = KINDS[p.kind] ? p.kind : "news";
    return `<li class="nw-card">${img ? `<img class="nw-img" src="${esc(img)}" alt="" loading="lazy">` : `<div class="nw-ph" aria-hidden="true"></div>`}
      <div class="nw-txt"><p class="nw-meta"><span class="nw-kind">${KINDS[k]}</span><time>${esc(day(p.published_at))}</time></p>
      <h3><a href="${esc(to.href)}"${to.out ? ' rel="noopener noreferrer"' : ""}>${esc(p.title)}</a></h3>
      ${p.summary ? `<p class="nw-sum">${esc(p.summary)}</p>` : ""}
      ${to.out ? `<p class="nw-out">${p.link_source ? "At " + esc(p.link_source) : "Outside article"} ↗</p>` : ""}</div></li>`;
  }
  function paint(rows, base, sample){
    const lh = lead && rows[0] ? card(rows[0], base) : "";
    if(lead) lead.innerHTML = lh ? `<ul class="nw-list">${lh}</ul>` : "";
    if(list){
      list.innerHTML = rows.slice(lead ? 1 : 0, want).map(r => card(r, base)).join("");
      const sec = list.closest("[hidden]"); if(sec) sec.hidden = false;
    }
    if(sample){
      const n = document.querySelector("[data-nw-sample]"); if(n) n.hidden = false;
    }
  }
  const cfgOK = typeof SUPABASE !== "undefined" && SUPABASE.url && SUPABASE.anonKey;
  if(!cfgOK){ paint(SAMPLE, "", true); return; }
  const BASE = String(SUPABASE.url).replace(/\/+$/, "");
  fetch(`${BASE}/rest/v1/posts?select=id,kind,slug,title,summary,link_url,link_source,cover_path,published_at&status=eq.published&order=published_at.desc,id.desc&limit=${want}`,
        {headers:{apikey:SUPABASE.anonKey, Accept:"application/json"}})
    .then(r => r.ok ? r.json() : Promise.reject())
    .then(rows => Array.isArray(rows) && rows.length ? paint(rows, BASE + "/storage/v1/object/public/post-images/", false) : paint(SAMPLE, "", true))
    .catch(() => paint(SAMPLE, "", true));
})();
