/* The Cloudflare Worker in front of trailwatermaps.com. It does one job:
   build the /news pages, the RSS feed, the sitemap and robots.txt on the
   server, so Google can index posts and a shared link shows a title and a
   photo (link-preview crawlers don't run JavaScript).

   It runs ONLY for those paths. wrangler.jsonc's assets.run_worker_first
   lists them; every other request (/, /app, /admin, js/, data/ …) is
   answered by the static assets exactly as before, without the Worker. A
   request for a file that doesn't exist falls through to here too, and goes
   straight back to the assets for their own 404.

   Posts come from Supabase (supabase/posts.sql) with the publishable key
   only, never a user token, so row-level security hands it published posts
   whose date has come and nothing else. Both values are public and live in
   wrangler.jsonc "vars" (the same ones as js/config.js).

   Caching: each page is kept in the edge cache (caches.default) and rebuilt
   after 5 minutes. A copy is kept for a week past that, so if Supabase is
   asleep or down the last good page is served instead (marked
   X-News-Stale). With no copy at all the reader gets a plain "News couldn't
   load right now" page with a 503, never a raw error.

   Untestable locally without wrangler. tools/news-harness.html runs this
   file in a browser against a stubbed Supabase, cache and assets binding. */

import "../js/postmd.js";
import {SITE, PAGE_SIZE, FEED_SIZE, KINDS, listPage, postPage, notFoundPage, unavailablePage,
        feedXML, sitemapXML, robotsTxt} from "./render.js";

const FRESH_MS = 5 * 60 * 1000;          // rebuild a page after this
const KEEP_S = 7 * 24 * 3600;            // keep the last good copy this long, for when Supabase is down
const BROWSER_S = 300;                   // Cache-Control max-age the reader's browser gets
const FETCH_MS = 8000;                   // a paused free project can hang far longer
const CACHE_V = "1";                     // bump to retire every cached page after a template change
const MAX_PAGE = 500;
const LIST_COLS = "id,kind,slug,title,summary,link_url,link_source,cover_path,cover_alt,pinned,show_until,published_at,updated_at";
const POST_COLS = LIST_COLS + ",body";
// No script runs on these pages at all. Photos come from Supabase Storage.
const CSP = "default-src 'none'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; " +
            "img-src 'self' https://*.supabase.co; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const TYPES = {html:"text/html; charset=utf-8", rss:"application/rss+xml; charset=utf-8",
               xml:"application/xml; charset=utf-8", text:"text/plain; charset=utf-8"};

export default {
  async fetch(request, env, ctx){
    let route = null;
    try{
      const url = new URL(request.url);
      route = routeOf(url.pathname);
      if(!route) return env.ASSETS.fetch(request);
      if(request.method !== "GET" && request.method !== "HEAD"){
        return new Response("Method not allowed\n", {status:405, headers:baseHeaders("text", {Allow:"GET, HEAD"})});
      }
      return await serve(route, url, request, env, ctx);
    }catch(err){
      console.error("worker: unhandled", err && err.stack || err);
      if(!route) return new Response("Something went wrong\n", {status:500, headers:baseHeaders("text")});
      return unavailable(request, route);
    }
  },
};

/* ---------- routes ---------- */
function routeOf(path){
  if(path === "/sitemap.xml") return {name:"sitemap"};
  if(path === "/robots.txt") return {name:"robots"};
  if(path === "/news") return {name:"list"};
  if(!path.startsWith("/news/")) return null;
  const rest = path.slice(6);
  if(rest === "") return {name:"redirect", to:"/news", keepQuery:true};
  if(rest === "feed.xml") return {name:"feed"};
  const m = /^([^/]+)(\/)?$/.exec(rest);
  if(!m) return {name:"notfound"};
  if(m[2]) return {name:"redirect", to:`/news/${m[1]}`};      // a trailing slash
  const slug = m[1];
  if(globalThis.PostMD.isSlug(slug)) return {name:"post", slug};
  // /news/My-Post -> /news/my-post, when that is a valid slug.
  const lower = slug.toLowerCase();
  if(lower !== slug && globalThis.PostMD.isSlug(lower)) return {name:"redirect", to:`/news/${lower}`};
  return {name:"notfound"};
}

async function serve(route, url, request, env, ctx){
  const site = siteOf(env);
  const imageBase = globalThis.PostMD.imageBase(env.SUPABASE_URL);
  switch(route.name){
    case "robots":
      return finish(request, new Response(robotsTxt({site}), {headers:baseHeaders("text", {"Cache-Control":"public, max-age=3600"})}));
    case "redirect": {
      const to = site + route.to + (route.keepQuery ? url.search : "");
      return new Response(null, {status:301, headers:baseHeaders("text", {Location:to, "Cache-Control":"public, max-age=3600"})});
    }
    case "notfound":
      return finish(request, new Response(notFoundPage({site}), {status:404, headers:baseHeaders("html", {"Cache-Control":`public, max-age=${BROWSER_S}`})}));
    case "list": {
      const kind = KINDS[url.searchParams.get("kind")] ? url.searchParams.get("kind") : "";
      const n = parseInt(url.searchParams.get("page") || "1", 10);
      const page = n >= 1 && n <= MAX_PAGE ? n : 1;
      // The key holds only what the page depends on, so ?utm_source=… and
      // other junk share one cached copy instead of each costing a query.
      return cached(request, ctx, route, `${site}/news?kind=${kind}&page=${page}&v=${CACHE_V}`, async () => {
        const rows = await rest(env, `posts?select=${LIST_COLS}&status=eq.published` +
          (kind ? `&kind=eq.${kind}` : "") +
          `&order=published_at.desc,id.desc&limit=${PAGE_SIZE + 1}&offset=${(page - 1) * PAGE_SIZE}`);
        if(page > 1 && !rows.length) return {status:404, type:"html", body:notFoundPage({site})};
        return {status:200, type:"html", body:listPage({posts:rows.slice(0, PAGE_SIZE), hasMore:rows.length > PAGE_SIZE, kind, page, site, imageBase})};
      });
    }
    case "post":
      return cached(request, ctx, route, `${site}/news/${route.slug}?v=${CACHE_V}`, async () => {
        const rows = await rest(env, `posts?select=${POST_COLS}&status=eq.published&slug=eq.${route.slug}&limit=1`);
        if(!rows.length) return {status:404, type:"html", body:notFoundPage({site})};
        return {status:200, type:"html", body:postPage(rows[0], {site, imageBase})};
      });
    case "feed":
      return cached(request, ctx, route, `${site}/news/feed.xml?v=${CACHE_V}`, async () => {
        const rows = await rest(env, `posts?select=${POST_COLS}&status=eq.published&order=published_at.desc,id.desc&limit=${FEED_SIZE}`);
        return {status:200, type:"rss", body:feedXML({posts:rows, site, imageBase})};
      });
    case "sitemap":
      return cached(request, ctx, route, `${site}/sitemap.xml?v=${CACHE_V}`, async () => {
        const rows = await rest(env, `posts?select=slug,published_at,updated_at&status=eq.published&slug=not.is.null` +
          `&order=published_at.desc,id.desc&limit=5000`);
        return {status:200, type:"xml", body:sitemapXML({posts:rows, site})};
      });
  }
  return unavailable(request, route);
}

/* ---------- Supabase ---------- */
async function rest(env, query){
  const base = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
  if(!/^https:\/\//.test(base) || !env.SUPABASE_KEY) throw new Error("SUPABASE_URL or SUPABASE_KEY is not set in wrangler.jsonc vars");
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), FETCH_MS);
  try{
    // The publishable key goes in apikey only. It is not a JWT, so it never
    // goes in Authorization; with no Authorization the request is `anon`.
    const res = await fetch(`${base}/rest/v1/${query}`, {headers:{apikey:env.SUPABASE_KEY, Accept:"application/json"}, signal:ctl.signal});
    if(!res.ok){
      // 404 PGRST205 here means posts.sql hasn't been run yet.
      let detail = "";
      try{ detail = (await res.text()).slice(0, 200); }catch(e){}
      throw new Error(`Supabase answered ${res.status} ${detail}`);
    }
    const rows = await res.json();
    if(!Array.isArray(rows)) throw new Error("Supabase sent something that isn't a list");
    return rows;
  }finally{ clearTimeout(t); }
}

/* ---------- the edge cache ----------
   Stored copies carry their build time and a week-long max-age (so the
   cache keeps them as a fallback); readers get BROWSER_S. A copy younger
   than FRESH_MS is served as it is. Older, the page is rebuilt; if that
   fails, the old copy is served. Only 200s and 404s are stored. */
const edgeCache = () => typeof caches !== "undefined" && caches.default ? caches.default : null;

async function cached(request, ctx, route, key, build){
  const cache = edgeCache(), keyReq = new Request(key);
  let hit = null;
  if(cache){ try{ hit = await cache.match(keyReq); }catch(e){ hit = null; } }
  const builtAt = hit ? +hit.headers.get("X-News-Built") || 0 : 0;
  if(hit && Date.now() - builtAt < FRESH_MS) return finish(request, hit);
  let out;
  try{ out = await build(); }
  catch(err){
    console.error(`worker: ${key} failed:`, err && err.message || err);
    if(hit) return finish(request, hit, true);
    return unavailable(request, route);
  }
  const res = new Response(out.body, {status:out.status, headers:baseHeaders(out.type, {
    "Cache-Control":`public, max-age=${KEEP_S}`, "X-News-Built":String(Date.now())})});
  if(cache && (out.status === 200 || out.status === 404)){
    const put = cache.put(keyReq, res.clone()).catch(e => console.error("worker: cache put failed", e));
    if(ctx && ctx.waitUntil) ctx.waitUntil(put);
  }
  return finish(request, res);
}

/* What the reader gets: the reader's max-age, no build stamp, no body for HEAD. */
function finish(request, res, stale){
  const h = new Headers(res.headers);
  if(h.has("X-News-Built") || stale) h.set("Cache-Control", stale ? "public, max-age=60" : `public, max-age=${BROWSER_S}`);
  h.delete("X-News-Built");
  if(stale) h.set("X-News-Stale", "1");
  return new Response(request.method === "HEAD" ? null : res.body, {status:res.status, headers:h});
}

function unavailable(request, route){
  const html = route && /^(feed|sitemap)$/.test(route.name) ? null : unavailablePage();
  const res = new Response(html || "News couldn't load right now. Try again in a minute.\n", {status:503,
    headers:baseHeaders(html ? "html" : "text", {"Cache-Control":"no-store", "Retry-After":"120"})});
  return finish(request, res);
}

function baseHeaders(type, extra){
  const h = new Headers({
    "Content-Type": TYPES[type] || TYPES.text,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  });
  for(const k in extra || {}) h.set(k, extra[k]);
  return h;
}

// The canonical origin (www redirects to the bare domain at the zone).
function siteOf(env){
  const s = String(env.SITE_URL || "").replace(/\/+$/, "");
  return /^https:\/\/[^\/?#\s]+$/.test(s) ? s : SITE;
}
