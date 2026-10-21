/* The homepage's news: the pinned announcement banner under the header and
   the latest three posts as cards ("News & updates"). Read straight from
   Supabase (supabase/posts.sql) with the publishable key, so it works on the
   local dev server too; the /news pages themselves are built on the server
   by the Worker (worker/index.js).

   Both slots start hidden in index.html and stay hidden until there is
   something to show: no script, no signal, a paused project, posts.sql not
   run yet, or no posts all leave the homepage exactly as it was. Nothing is
   logged or retried; this page has no metrics and no service worker of its
   own.

   The publishable key goes in `apikey` only. It is not a JWT, so it never
   goes in Authorization; with no Authorization the request is `anon`, and
   row-level security returns published posts whose date has come.

   Every field is escaped before it touches innerHTML. */

(function(){
  "use strict";
  if(typeof SUPABASE === "undefined" || !SUPABASE.url || !SUPABASE.anonKey) return;
  const banner = document.getElementById("hn-banner");
  const section = document.getElementById("hn"), list = document.getElementById("hn-list");
  if(!banner && !(section && list)) return;

  const BASE = String(SUPABASE.url).replace(/\/+$/, "");
  const PHOTOS = BASE + "/storage/v1/object/public/post-images/";
  const COLS = "id,kind,slug,title,summary,link_url,link_source,cover_path,cover_alt,published_at";
  const KINDS = {announcement:"Announcement", blog:"Blog", news:"News"};
  const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const TIMEOUT_MS = 8000;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));

  async function get(query){
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try{
      const res = await fetch(`${BASE}/rest/v1/${query}`, {headers:{apikey:SUPABASE.anonKey, Accept:"application/json"}, signal:ctl && ctl.signal});
      if(!res.ok) throw new Error(String(res.status));
      const rows = await res.json();
      if(!Array.isArray(rows)) throw new Error("not a list");
      return rows;
    }finally{ if(t) clearTimeout(t); }
  }

  /* Its own page, or, for a news link with no page, the outside article. */
  function target(p){
    if(typeof p.slug === "string" && p.slug.length <= 80 && SLUG.test(p.slug)) return {href:"news/" + p.slug, outside:false};
    const u = typeof p.link_url === "string" && /^https:\/\/[^\s"<>\\`]+$/i.test(p.link_url) ? p.link_url : "";
    return u ? {href:u, outside:true} : null;
  }
  function photo(p){
    const path = String(p.cover_path || "");
    return path && path.length <= 200 && /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(path) && path.indexOf("..") < 0 ? PHOTOS + path : "";
  }
  function dateText(iso){
    const d = new Date(iso);
    return isNaN(d) ? "" : d.toLocaleDateString("en-US", {month:"short", day:"numeric", year:"numeric"});
  }
  const kind = k => KINDS[k] ? k : "news";

  function cards(rows){
    const html = rows.map(p => {
      const to = target(p);
      if(!to) return "";
      const img = photo(p);
      const iso = new Date(p.published_at);
      // The title is the link; CSS stretches it over the card. The photo is
      // decoration beside it (alt=""), or a screen reader hears it twice.
      return `<li class="hn-card${img ? "" : " hn-noimg"}">${img ? `<img class="hn-img" src="${esc(img)}" alt="" loading="lazy" decoding="async">` : ""}
        <div class="hn-txt">
          <p class="hn-meta"><span class="hn-kind hn-kind-${kind(p.kind)}">${esc(KINDS[kind(p.kind)])}</span>${isNaN(iso) ? "" : `<time datetime="${esc(iso.toISOString())}">${esc(dateText(p.published_at))}</time>`}</p>
          <h3><a href="${esc(to.href)}"${to.outside ? ` rel="noopener noreferrer"` : ""}>${esc(p.title)}</a></h3>
          ${p.summary ? `<p class="hn-sum">${esc(p.summary)}</p>` : ""}
          ${to.outside ? `<p class="hn-out">${p.link_source ? `At ${esc(p.link_source)}` : "Outside article"} <span aria-hidden="true">↗</span></p>` : ""}
        </div></li>`;
    }).join("");
    if(!html) return;
    list.innerHTML = html;
    // A photo that won't load (deleted from storage) goes, rather than
    // leaving a broken-image box on the homepage.
    list.querySelectorAll(".hn-img").forEach(img => img.addEventListener("error", () => {
      const card = img.closest(".hn-card"); img.remove(); if(card) card.classList.add("hn-noimg");
    }));
    section.hidden = false;
  }

  function showBanner(rows){
    const p = rows[0], to = p && target(p);
    if(!to) return;
    banner.innerHTML = `<div class="wrap"><span class="hn-tag">${esc(KINDS[kind(p.kind)])}</span><a href="${esc(to.href)}"${to.outside ? ` rel="noopener noreferrer"` : ""}>${esc(p.title)}</a>${
      p.summary ? `<span class="hn-bsum">${esc(p.summary)}</span>` : ""}</div>`;
    banner.hidden = false;
  }

  // Seconds, no fraction: the value sits inside PostgREST's or=(…) syntax,
  // quoted because it holds colons.
  const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
  if(section && list){
    get(`posts?select=${COLS}&status=eq.published&order=published_at.desc,id.desc&limit=3`).then(cards).catch(() => {});
  }
  if(banner){
    get(`posts?select=${COLS}&status=eq.published&kind=eq.announcement&pinned=is.true` +
        `&or=${encodeURIComponent(`(show_until.is.null,show_until.gt."${now}")`)}&order=published_at.desc,id.desc&limit=1`)
      .then(showBanner).catch(() => {});
  }
})();
