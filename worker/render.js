/* The /news pages, the RSS feed, the sitemap and robots.txt, as strings.
   Pure functions: data in, text out. No fetch, no cache, no env, so the
   Worker (worker/index.js) and the browser test page
   (tools/news-harness.html) run exactly the same code.

   Post bodies are rendered by globalThis.PostMD (js/postmd.js), the same
   renderer the admin editor's preview uses. Every other field is escaped
   here with esc() before it touches the markup: a title, summary or source
   is plain text whatever it contains.

   The pages carry no script at all (the Worker's Content-Security-Policy
   allows none). The JSON-LD block is data, not script: browsers don't run
   it and CSP doesn't apply to it; it is escaped so "</script>" in a title
   can't end it early.

   Keep articleHTML() in step with the editor's preview in js/admin.js
   (postPreviewHTML), which writes the same markup with the same classes. */

export const SITE = "https://trailwatermaps.com";
export const PAGE_SIZE = 20;
export const FEED_SIZE = 20;
export const KINDS = {announcement:"Announcement", blog:"Blog", news:"News"};
const FILTERS = [["", "All"], ["announcement", "Announcements"], ["blog", "Blog"], ["news", "News"]];
// Dates are shown as the owner's calendar day: a post published at 9 pm in
// Iowa is that day's post, not tomorrow's (which UTC would make it).
const NEWS_TZ = "America/Chicago";
const FONTS = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";
const MARK = `<svg class="brandmark" viewBox="-4 -4 108 108" aria-hidden="true" focusable="false"><path d="M8 12H44M24 12V62M44 12L56 62L68 32L80 62L92 12M10 88Q20 80 30 88T50 88T70 88T90 88"/></svg>`;

const ESC = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
export const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ESC[c]);
// XML 1.0 refuses most control characters outright, even escaped.
const xml = s => esc(String(s == null ? "" : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, ""));
const PM = () => globalThis.PostMD;

/* ---------- small helpers ---------- */
const okHttps = u => typeof u === "string" && u.length <= 2000 && /^https:\/\/[^\s"<>\\`]+$/i.test(u) ? u : "";
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
export function dateText(iso, short){
  const d = new Date(iso);
  if(!iso || isNaN(d)) return "";
  try{
    return new Intl.DateTimeFormat("en-US", {timeZone:NEWS_TZ, year:"numeric", month:short ? "short" : "long", day:"numeric"}).format(d);
  }catch(e){
    const m = MONTHS[d.getUTCMonth()];
    return `${short ? m.slice(0, 3) : m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  }
}
const isoOf = s => { const d = new Date(s); return s && !isNaN(d) ? d.toISOString() : ""; };
const imageType = u => /\.png$/i.test(u) ? "image/png" : /\.webp$/i.test(u) ? "image/webp" : "image/jpeg";
export function coverURL(post, imageBase){ return PM().photoURL(imageBase, post && post.cover_path); }
/* Where a post's title goes: its own page, or, for a news link with no page,
   straight to the outside article. */
export function postHref(p){
  if(p.slug && PM().isSlug(p.slug)) return {href:`/news/${p.slug}`, outside:false};
  const out = okHttps(p.link_url);
  return out ? {href:out, outside:true} : null;
}
function description(p){
  return p.summary || (p.body ? PM().excerpt(p.body, 160) : "") || "News from TrailWaterMaps.";
}
// For a <script type="application/ld+json">: "<" can't appear, so neither can "</script>".
const ldJSON = o => JSON.stringify(o).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026")
  .replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/* ---------- the page frame ---------- */
function headHTML(o){
  const m = (p, c) => c ? `\n<meta property="${p}" content="${esc(c)}">` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#1f1915">
<meta name="color-scheme" content="light">
<title>${esc(o.title)}</title>
<meta name="description" content="${esc(o.description)}">${o.noindex ? `\n<meta name="robots" content="noindex">` : ""}${o.canonical ? `\n<link rel="canonical" href="${esc(o.canonical)}">` : ""}${o.og ? m("og:type", o.og.type) + m("og:site_name", "TrailWaterMaps") + m("og:url", o.canonical) + m("og:title", o.og.title)
    + m("og:description", o.description) + m("og:image", o.og.image) + m("og:image:alt", o.og.imageAlt)
    + m("article:published_time", o.og.published) + m("article:modified_time", o.og.modified)
    + `\n<meta name="twitter:card" content="${o.og.large ? "summary_large_image" : "summary"}">` : ""}
<link rel="alternate" type="application/rss+xml" title="TrailWaterMaps news" href="/news/feed.xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONTS}" rel="stylesheet">
<link rel="stylesheet" href="/css/home.css">
<link rel="stylesheet" href="/css/news.css">
<link rel="icon" type="image/svg+xml" href="/icons/favicon.svg">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">${o.ld ? `\n<script type="application/ld+json">${ldJSON(o.ld)}</script>` : ""}
</head>`;
}
function barHTML(){
  return `<header class="bar bar-news">
  <a class="brand" href="/" aria-label="TrailWaterMaps home">${MARK}<span>TrailWaterMaps</span></a>
  <nav class="nav" aria-label="Site"><a class="nav-map" href="/app">Open the map</a></nav>
</header>`;
}
function footHTML(){
  return `<footer class="foot foot-news">
  <div class="wrap">
    <a class="brand" href="/" aria-label="TrailWaterMaps home">${MARK}<span>TrailWaterMaps</span></a>
    <ul class="foot-links">
      <li><a href="/">Home</a></li>
      <li><a href="/app">Open the map</a></li>
      <li><a href="/news">News</a></li>
      <li><a href="/news/feed.xml">RSS feed</a></li>
    </ul>
    <p class="legal">TrailWaterMaps is an independent project and is not affiliated with any agency. Always check current regulations with the agency before you fish.</p>
  </div>
</footer>`;
}
const pageHTML = (head, main) => `${head}\n<body class="news">\n${barHTML()}\n${main}\n${footHTML()}\n</body>\n</html>\n`;

/* ---------- one post ---------- */
const kindTag = k => `<span class="nkind nkind-${KINDS[k] ? k : "news"}">${esc(KINDS[k] || "News")}</span>`;

/* The article itself: also the shape of the editor's preview. */
export function articleHTML(p, opts){
  opts = opts || {};
  const cover = coverURL(p, opts.imageBase);
  const out = okHttps(p.link_url);
  const when = isoOf(p.published_at);
  const body = p.body ? PM().render(p.body, {imageBase:opts.imageBase}) : "";
  return `<article class="post">
  <p class="post-back"><a href="/news">← All news</a></p>
  <header class="post-head">
    <p class="post-meta">${kindTag(p.kind)}${when ? `<time datetime="${esc(when)}">${esc(dateText(when))}</time>` : ""}</p>
    <h1>${esc(p.title)}</h1>${p.summary ? `\n    <p class="post-lede">${esc(p.summary)}</p>` : ""}
  </header>${cover ? `
  <figure class="post-cover"><img src="${esc(cover)}" alt="${esc(p.cover_alt || "")}" decoding="async"></figure>` : ""}${body ? `
  <div class="post-body">
${body}
  </div>` : ""}${out ? `
  <p class="post-orig"><a href="${esc(out)}" rel="noopener noreferrer">Read the original${p.link_source ? ` at ${esc(p.link_source)}` : ""} <span aria-hidden="true">↗</span></a></p>` : ""}
</article>`;
}

export function postPage(p, opts){
  opts = opts || {};
  const site = opts.site || SITE;
  const canonical = `${site}/news/${p.slug}`;
  const cover = coverURL(p, opts.imageBase);
  const desc = description(p);
  const published = isoOf(p.published_at), modified = isoOf(p.updated_at) || published;
  const ld = {
    "@context":"https://schema.org",
    "@type": p.kind === "news" ? "NewsArticle" : "BlogPosting",
    headline: String(p.title).slice(0, 110),
    description: desc,
    url: canonical,
    mainEntityOfPage: {"@type":"WebPage", "@id":canonical},
    datePublished: published || undefined,
    dateModified: modified || undefined,
    image: cover ? [cover] : undefined,
    author: {"@type":"Organization", name:"TrailWaterMaps", url:`${site}/`},
    publisher: {"@type":"Organization", name:"TrailWaterMaps", logo:{"@type":"ImageObject", url:`${site}/icons/icon-512.png`}},
    isBasedOn: okHttps(p.link_url) || undefined,
  };
  const head = headHTML({
    title: `${p.title} — TrailWaterMaps`, description: desc, canonical, ld,
    og: {type:"article", title:p.title, image: cover || `${site}/icons/icon-512.png`, imageAlt: cover ? (p.cover_alt || "") : "",
         large: !!cover, published, modified},
  });
  return pageHTML(head, `<main class="news-main">\n${articleHTML(p, opts)}\n</main>`);
}

/* ---------- the list ---------- */
function cardHTML(p, opts){
  const to = postHref(p);
  const cover = coverURL(p, opts.imageBase);
  const when = isoOf(p.published_at);
  const rel = to && to.outside ? ` rel="noopener noreferrer"` : "";
  const title = to ? `<a href="${esc(to.href)}"${rel}>${esc(p.title)}</a>` : esc(p.title);
  // The photo is decoration beside a linked title, so alt="" (a screen
  // reader would otherwise hear the post twice).
  return `<li><article class="ncard${cover ? "" : " ncard-noimg"}">${cover ? `
    <img class="ncard-img" src="${esc(cover)}" alt="" loading="lazy" decoding="async">` : ""}
    <div class="ncard-txt">
      <p class="post-meta">${kindTag(p.kind)}${when ? `<time datetime="${esc(when)}">${esc(dateText(when, true))}</time>` : ""}</p>
      <h2>${title}</h2>${p.summary ? `
      <p class="ncard-sum">${esc(p.summary)}</p>` : ""}${to && to.outside ? `
      <p class="ncard-out">${p.link_source ? `At ${esc(p.link_source)}` : "Outside article"} <span aria-hidden="true">↗</span></p>` : ""}
    </div>
  </article></li>`;
}
const listQS = (kind, page) => { const q = []; if(kind) q.push(`kind=${kind}`); if(page > 1) q.push(`page=${page}`); return q.length ? "?" + q.join("&") : ""; };

/* posts: this page's rows (at most PAGE_SIZE); kind: "" or a KINDS key;
   page: from 1; hasMore: there is an older page. */
export function listPage(o){
  const site = o.site || SITE, kind = KINDS[o.kind] ? o.kind : "", page = Math.max(1, o.page | 0 || 1);
  const posts = o.posts || [];
  const label = kind ? FILTERS.find(f => f[0] === kind)[1] : "";
  const title = `${label ? label + " — " : ""}News & updates${page > 1 ? ` (page ${page})` : ""} — TrailWaterMaps`;
  const head = headHTML({
    title, canonical: `${site}/news${listQS(kind, page)}`,
    description: "Announcements, blog posts and news about rivers, fishing rules and access, from TrailWaterMaps.",
    og: {type:"website", title:"TrailWaterMaps news & updates", image:`${site}/icons/icon-512.png`, large:false},
  });
  const filters = FILTERS.map(([k, name]) =>
    `<a href="/news${listQS(k, 1)}"${k === kind ? ` aria-current="page"` : ""}>${esc(name)}</a>`).join("");
  const items = posts.length
    ? `<ul class="news-list">\n${posts.map(p => cardHTML(p, o)).join("\n")}\n</ul>`
    : `<p class="news-empty">${kind ? "Nothing here yet." : "Nothing posted yet."} Check back soon, or <a href="/app">open the map</a>.</p>`;
  const pager = page > 1 || o.hasMore ? `<nav class="news-pager" aria-label="More posts">${
      page > 1 ? `<a rel="prev" href="/news${listQS(kind, page - 1)}">← Newer</a>` : "<span></span>"}<span class="news-pageno">Page ${page}</span>${
      o.hasMore ? `<a rel="next" href="/news${listQS(kind, page + 1)}">Older →</a>` : "<span></span>"}</nav>` : "";
  return pageHTML(head, `<main class="news-main">
<header class="news-head">
  <h1>News &amp; updates</h1>
  <p class="news-intro">Announcements, the odd blog post, and links to news worth reading about the water on the map.</p>
</header>
<nav class="news-filter" aria-label="Show">${filters}</nav>
${items}
${pager}
</main>`);
}

/* ---------- errors ---------- */
export function notFoundPage(o){
  o = o || {};
  const head = headHTML({title:"Not found — TrailWaterMaps", description:"That page isn't here.", noindex:true});
  return pageHTML(head, `<main class="news-main news-msg">
<h1>That post isn't here</h1>
<p>It may have been taken down, or the address has a typo.</p>
<p><a class="pill" href="/news">All news</a></p>
</main>`);
}
export function unavailablePage(){
  const head = headHTML({title:"News couldn't load — TrailWaterMaps", description:"News couldn't load right now.", noindex:true});
  return pageHTML(head, `<main class="news-main news-msg">
<h1>News couldn't load right now</h1>
<p>Try again in a minute. The map doesn't depend on this page and still works.</p>
<p><a class="pill" href="/app">Open the map</a></p>
</main>`);
}

/* ---------- RSS 2.0 ---------- */
export function feedXML(o){
  const site = o.site || SITE, posts = o.posts || [];
  const items = posts.map(p => {
    const to = postHref(p);
    const link = to ? (to.outside ? to.href : site + to.href) : `${site}/news`;
    const when = isoOf(p.published_at);
    const cover = coverURL(p, o.imageBase);
    return `<item>
<title>${xml(p.title)}</title>
<link>${xml(link)}</link>
<guid isPermaLink="false">trailwatermaps.com/news/${xml(p.id)}</guid>${when ? `
<pubDate>${xml(new Date(when).toUTCString())}</pubDate>` : ""}
<category>${xml(KINDS[p.kind] || "News")}</category>
<description>${xml(description(p))}</description>${cover ? `
<enclosure url="${xml(cover)}" type="${imageType(cover)}" length="0"/>` : ""}
</item>`;
  }).join("\n");
  const newest = posts.length ? isoOf(posts[0].published_at) : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
<title>TrailWaterMaps news</title>
<link>${xml(site)}/news</link>
<description>Announcements, blog posts and news from TrailWaterMaps.</description>
<language>en-us</language>
<atom:link href="${xml(site)}/news/feed.xml" rel="self" type="application/rss+xml"/>${newest ? `
<lastBuildDate>${xml(new Date(newest).toUTCString())}</lastBuildDate>` : ""}
${items}
</channel>
</rss>
`;
}

/* ---------- sitemap and robots ---------- */
export function sitemapXML(o){
  const site = o.site || SITE;
  const day = s => { const i = isoOf(s); return i ? i.slice(0, 10) : ""; };
  const url = (loc, mod) => `<url><loc>${xml(loc)}</loc>${mod ? `<lastmod>${mod}</lastmod>` : ""}</url>`;
  const pages = (o.posts || []).filter(p => p.slug && PM().isSlug(p.slug));
  const newest = pages.length ? day(pages[0].updated_at || pages[0].published_at) : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[url(`${site}/`), url(`${site}/app`), url(`${site}/news`, newest)]
  .concat(pages.map(p => url(`${site}/news/${p.slug}`, day(p.updated_at || p.published_at)))).join("\n")}
</urlset>
`;
}
export function robotsTxt(o){
  const site = (o && o.site) || SITE;
  return `User-agent: *
Allow: /
Disallow: /admin

Sitemap: ${site}/sitemap.xml
`;
}
