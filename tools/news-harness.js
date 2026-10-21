/* See news-harness.html. Plain module, no test framework: each check is a
   row in a table, and window.HARNESS holds the totals for scripted runs. */
import * as R from "../worker/render.js";

const PM = globalThis.PostMD;
const SB = "https://kbdrxtyacmihabwadzzz.supabase.co";
const KEY = "sb_publishable_DqfPce_UmTyHAfrnky9gQg_w2N0DmFK";
const BASE = PM.imageBase(SB);
const rows = [];
const check = (group, name, ok, detail) => rows.push({group, name, ok:!!ok, detail:detail == null ? "" : String(detail)});

/* ---------- sample posts ---------- */
const LOCAL = location.origin + "/img/";       // real files, so the views show photos
const now = Date.now(), day = 864e5;
const iso = t => new Date(t).toISOString();
const HOSTILE_TITLE = `</title><script>alert("t")</script> "quotes" & 'apostrophes' <b>bold</b>`;
function samples(base){
  return [
    {id:5, kind:"announcement", slug:"spring-gauges-are-back", title:"Spring gauges are back on the Driftless creeks",
     summary:"Waterloo Creek and Bloody Run are reporting again after the winter outage.", body:"Short notice.\n\n**Thanks** for the reports.",
     link_url:null, link_source:null, cover_path:null, cover_alt:null, pinned:true, show_until:iso(now + 5 * day),
     published_at:iso(now - 1 * day), updated_at:iso(now - 1 * day)},
    {id:4, kind:"news", slug:null, title:"Iowa DNR stocks 30 more streams this spring",
     summary:"The DNR's spring stocking list adds catchable rainbows to thirty streams in northeast Iowa.", body:null,
     link_url:"https://www.iowadnr.gov/news?a=1&b=2", link_source:"Iowa DNR", cover_path:null, cover_alt:null, pinned:false, show_until:null,
     published_at:iso(now - 2 * day), updated_at:iso(now - 2 * day)},
    {id:3, kind:"blog", slug:"reading-the-snake-in-october", title:"Reading the Snake in October",
     summary:"What the Wilson gauge says about the fall float, and what it doesn't.",
     body:`The Snake below **Jackson Lake** drops fast after Labor Day.\n\n## What the number means\n\nAt the Wilson gauge, *around average* in October is lower than you'd think.\n\n- Check the [gauge](/app) before you drive\n- Read the [WGFD rules](https://wgfd.wyo.gov/fishing)\n\n> Low and clear: long leaders.\n\n![A drift boat below the bridge](${base}flow.webp)\n\n### Where to launch\n\n1. Wilson\n2. South Park`,
     link_url:null, link_source:null, cover_path:"river.webp", cover_alt:"The Snake River in fall", pinned:false, show_until:null,
     published_at:iso(now - 3 * day), updated_at:iso(now - 2.5 * day)},
    {id:2, kind:"news", slug:"new-access-rules-on-the-teton", title:"New access rules on the Teton",
     summary:"IDFG changed two access sites; my notes on what it means for wading.", body:"My notes: park on the **north** side.",
     link_url:"https://idfg.idaho.gov/news", link_source:"Idaho Fish and Game", cover_path:null, cover_alt:null, pinned:false, show_until:null,
     published_at:iso(now - 4 * day), updated_at:iso(now - 4 * day)},
  ];
}
const hostile = base => ({id:9, kind:"blog", slug:"hostile-test", title:HOSTILE_TITLE,
  summary:`<img src=x onerror=alert("s")> "summary" & more`,
  body:`<script>alert("b")</script>\n\n[click](javascript:alert(1)) [data](data:text/html,hi) [ok](https://example.com/a"onmouseover="x)\n\n![x" onerror="alert(1)](${base}a.jpg) ![evil](https://evil.example/a.jpg)\n\n**bold *nested* bold** and ***both***`,
  link_url:`javascript:alert("l")`, link_source:`<b>src</b>`, cover_path:"../../etc/passwd", cover_alt:`"><script>alert(1)</script>`,
  pinned:false, show_until:null, published_at:iso(now - day), updated_at:iso(now - day)});

/* ---------- what a safe render may contain ---------- */
const TAGS = new Set(["P", "H2", "H3", "STRONG", "EM", "A", "UL", "OL", "LI", "BLOCKQUOTE", "FIGURE", "IMG", "BR"]);
const ATTRS = {A:["href", "rel"], IMG:["src", "alt", "loading", "decoding"], OL:["start"]};
function audit(html, base){
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const bad = [];
  doc.body.querySelectorAll("*").forEach(el => {
    if(!TAGS.has(el.tagName)) bad.push("tag " + el.tagName);
    for(const a of el.attributes){
      if(!(ATTRS[el.tagName] || []).includes(a.name)) bad.push(`${el.tagName}@${a.name}`);
    }
    if(el.tagName === "A"){
      const h = el.getAttribute("href");
      if(!/^(https?:\/\/[^\/]|mailto:|\/(?!\/))/i.test(h)) bad.push("href " + h);
    }
    if(el.tagName === "IMG" && !el.getAttribute("src").startsWith(base)) bad.push("src " + el.getAttribute("src"));
  });
  return bad;
}

async function run(){
  /* ---------- PostMD ---------- */
  const md = [
    ["script tag", `<script>alert(1)</script>`, h => h.includes("&lt;script&gt;") && !h.includes("<script")],
    ["img onerror", `<img src=x onerror=alert(1)>`, h => !/<img/i.test(h)],
    ["javascript: link", `[x](javascript:alert(1))`, h => !/href/.test(h) && h.includes("x")],
    ["JAVASCRIPT: upper", `[x](JaVaScRiPt:alert(1))`, h => !/href/.test(h)],
    ["entity-encoded scheme", `[x](jav&#x61;script:alert(1))`, h => !/href/.test(h)],
    ["data: link", `[x](data:text/html;base64,PHNjcmlwdD4=)`, h => !/href/.test(h)],
    ["vbscript: link", `[x](vbscript:msgbox)`, h => !/href/.test(h)],
    ["protocol-relative", `[x](//evil.example/a)`, h => !/href/.test(h)],
    ["backslash host", `[x](/\\evil.example)`, h => !/href/.test(h)],
    ["quote in url", `[x](https://a.example/"onmouseover="alert)`, h => !/onmouseover="/.test(h.replace(/&quot;/g, "")) || !/href/.test(h)],
    ["quote in alt", `![a" onerror="alert(1)](${BASE}2026/a.jpg)`, h => /alt="a&quot; onerror=&quot;alert\(1\)"/.test(h)],
    ["outside image", `![x](https://evil.example/a.jpg)`, h => !/<img/.test(h)],
    ["other bucket", `![x](${SB}/storage/v1/object/public/other/a.jpg)`, h => !/<img/.test(h)],
    ["dot-dot in photo", `![x](${BASE}../../x.jpg)`, h => !/<img/.test(h)],
    ["good photo alone", `![A boat](${BASE}2026/abc.jpg)`, h => h.startsWith("<figure><img ") && /loading="lazy"/.test(h)],
    ["https link", `[DNR](https://www.iowadnr.gov/?a=1&b=2)`, h => /href="https:\/\/www\.iowadnr\.gov\/\?a=1&amp;b=2" rel="noopener noreferrer"/.test(h)],
    ["site path link", `[map](/app)`, h => /href="\/app">map</.test(h) && !/rel=/.test(h)],
    ["mailto", `[mail](mailto:a@b.co)`, h => /href="mailto:a@b\.co"/.test(h)],
    ["nested emphasis", `**bold *it* bold** and ***both***`, h => h === "<p><strong>bold <em>it</em> bold</strong> and <strong><em>both</em></strong></p>"],
    ["bold inside italic", `*it **bold** it*`, h => h === "<p><em>it <strong>bold</strong> it</em></p>"],
    ["misnested stays balanced", `**a *b** c*`, h => !audit(h, BASE).length && (h.match(/<em>/g) || []).length === (h.match(/<\/em>/g) || []).length],
    ["spaced stars are literal", `5 * 3 * 2 and ** x **`, h => h === "<p>5 * 3 * 2 and ** x **</p>"],
    ["italic around a link", `*see [map](/app)*`, h => h === '<p><em>see <a href="/app">map</a></em></p>'],
    ["star in url not italic", `[x](https://a.example/a*b*c)`, h => /href="https:\/\/a\.example\/a\*b\*c"/.test(h)],
    ["unclosed", `**never closed and *also`, h => h === "<p>**never closed and *also</p>"],
    ["backslash escape", `\\*not italic\\* and \\[x\\](y)`, h => h === "<p>*not italic* and [x](y)</p>"],
    ["headings", `## Two\n### Three\n# One\n#### Four`, h => h.includes("<h2>Two</h2>") && h.includes("<h3>Three</h3>") && h.includes("# One")],
    ["lists", `- a\n- b\n\n3. c\n4. d`, h => h.includes("<ul><li>a</li><li>b</li></ul>") && h.includes('<ol start="3"><li>c</li><li>d</li></ol>')],
    ["quote", `> one\n> two\n>\n> three`, h => h === "<blockquote><p>one<br>\ntwo</p><p>three</p></blockquote>"],
    ["NUL can't forge a placeholder", `a\u00000\u0000b [x](https://a.example)`, h => !audit(h, BASE).length && h.startsWith("<p>a0b")],
    ["control chars stripped", `a\u0007b‮c`, h => !/\u0007/.test(h)],
    ["attribute break via link text", `["><script>x</script>](https://a.example)`, h => !/<script/.test(h) && !audit(h, BASE).length],
  ];
  for(const [name, src, ok] of md){
    const dropped = [];
    const h = PM.render(src, {imageBase:BASE, dropped});
    const bad = audit(h, BASE);
    check("PostMD", name, ok(h) && !bad.length, (bad.length ? "AUDIT: " + bad.join(", ") + " | " : "") + h);
  }
  const dr = []; PM.render("[a](javascript:x) ![b](https://evil.example/b.jpg)", {imageBase:BASE, dropped:dr});
  check("PostMD", "dropped list reports both", dr.length === 2 && dr.some(d => d.kind === "link" && d.url === "javascript:x") && dr.some(d => d.kind === "image"), JSON.stringify(dr));
  check("PostMD", "no imageBase = no photos", !/<img/.test(PM.render(`![x](${BASE}a.jpg)`, {})), "");
  check("PostMD", "slugify", PM.slugify("Don't Miss: Spring Creeks & Trout — Café Notes!") === "dont-miss-spring-creeks-and-trout-cafe-notes", PM.slugify("Don't Miss: Spring Creeks & Trout — Café Notes!"));
  const long = PM.slugify("word ".repeat(40));
  check("PostMD", "slugify caps at 80 on a word", long.length <= 80 && PM.isSlug(long), long.length);
  check("PostMD", "isSlug", PM.isSlug("a-b-1") && !PM.isSlug("a--b") && !PM.isSlug("-a") && !PM.isSlug("A") && !PM.isSlug("a_b") && !PM.isSlug("x".repeat(81)), "");
  check("PostMD", "excerpt", PM.excerpt("## Head\n\nSome **bold** and a [link](https://x.example) ![p](y). " + "word ".repeat(60), 80).endsWith("…"),
    PM.excerpt("## Head\n\nSome **bold** and a [link](https://x.example) ![p](y). " + "word ".repeat(60), 80));

  /* ---------- render.js against hostile data ---------- */
  const opt = {site:"https://trailwatermaps.com", imageBase:BASE};
  const hp = hostile(BASE);
  const page = R.postPage(hp, opt);
  const doc = new DOMParser().parseFromString(page, "text/html");
  const scripts = [...doc.querySelectorAll("script")];
  check("render", "hostile post: only the JSON-LD script", scripts.length === 1 && scripts[0].type === "application/ld+json", scripts.map(s => s.type).join());
  let ld = null; try{ ld = JSON.parse(scripts[0].textContent); }catch(e){}
  check("render", "JSON-LD parses and keeps the title intact", ld && ld.headline === HOSTILE_TITLE.slice(0, 110), ld && ld.headline);
  const onAttrs = [...doc.querySelectorAll("*")].flatMap(el => [...el.attributes].filter(a => /^on/i.test(a.name)).map(a => el.tagName + "@" + a.name));
  check("render", "no on* attributes anywhere", !onAttrs.length, onAttrs.join());
  check("render", "title text is literal", doc.title === HOSTILE_TITLE + " — TrailWaterMaps", doc.title);
  check("render", "h1 is literal", doc.querySelector("h1").textContent === HOSTILE_TITLE, doc.querySelector("h1").textContent);
  check("render", "javascript: link_url dropped", !doc.querySelector(".post-orig") && !/javascript:/i.test([...doc.querySelectorAll("a")].map(a => a.href).join()), "");
  check("render", "../ cover path dropped", !doc.querySelector(".post-cover") && !doc.querySelector('meta[property="og:image:alt"]'), "");
  check("render", "og:image falls back to the icon", (doc.querySelector('meta[property="og:image"]') || {}).content === "https://trailwatermaps.com/icons/icon-512.png", "");
  check("render", "meta description is the literal summary", doc.querySelector('meta[name="description"]').content === hp.summary, "");
  check("render", "canonical", doc.querySelector('link[rel="canonical"]').href === "https://trailwatermaps.com/news/hostile-test", "");
  const body = doc.querySelector(".post-body");
  check("render", "body passes the PostMD audit", body && !audit(body.innerHTML, BASE).length, body && audit(body.innerHTML, BASE).join());

  const good = R.postPage(samples(BASE)[2], opt), gd = new DOMParser().parseFromString(good, "text/html");
  const m = p => (gd.querySelector(`meta[property="${p}"]`) || {}).content;
  check("render", "blog: og tags", m("og:type") === "article" && m("og:image") === BASE + "river.webp" && m("og:image:alt") === "The Snake River in fall"
    && (gd.querySelector('meta[name="twitter:card"]') || {}).content === "summary_large_image", "");
  const gld = JSON.parse(gd.querySelector('script[type="application/ld+json"]').textContent);
  check("render", "blog: BlogPosting with image and dates", gld["@type"] === "BlogPosting" && gld.image[0] === BASE + "river.webp" && gld.datePublished && gld.dateModified, JSON.stringify(gld).slice(0, 200));
  const nd = new DOMParser().parseFromString(R.postPage(samples(BASE)[3], opt), "text/html");
  check("render", "news with body: NewsArticle + read the original", JSON.parse(nd.querySelector('script[type="application/ld+json"]').textContent)["@type"] === "NewsArticle"
    && /Read the original at Idaho Fish and Game/.test(nd.querySelector(".post-orig").textContent), "");

  const list = R.listPage({posts:samples(BASE).concat([hostile(BASE)]), page:2, hasMore:true, kind:"blog", site:opt.site, imageBase:BASE});
  const ld2 = new DOMParser().parseFromString(list, "text/html");
  const out = [...ld2.querySelectorAll(".ncard h2 a")].map(a => a.getAttribute("href"));
  check("render", "list: link-only news goes straight out, others to /news/<slug>",
    out[1] === "https://www.iowadnr.gov/news?a=1&b=2" && out[2] === "/news/reading-the-snake-in-october" && out[3] === "/news/new-access-rules-on-the-teton", out.join(" "));
  check("render", "list: outside link has rel noopener", ld2.querySelectorAll('.ncard h2 a[rel="noopener noreferrer"]').length === 1, "");
  check("render", "list: pager keeps kind", ld2.querySelector('.news-pager a[rel="prev"]').getAttribute("href") === "/news?kind=blog" &&
    ld2.querySelector('.news-pager a[rel="next"]').getAttribute("href") === "/news?kind=blog&page=3", "");
  check("render", "list: filter marks current", ld2.querySelector('.news-filter a[aria-current="page"]').textContent === "Blog", "");
  check("render", "list: no script, no on*", !ld2.querySelector("script:not([type='application/ld+json'])") && ![...ld2.querySelectorAll("*")].some(el => [...el.attributes].some(a => /^on/i.test(a.name))), "");

  const feed = R.feedXML({posts:samples(BASE).concat([hostile(BASE)]), site:opt.site, imageBase:BASE});
  const fx = new DOMParser().parseFromString(feed, "application/xml");
  check("render", "RSS parses as XML", !fx.querySelector("parsererror"), fx.querySelector("parsererror") && fx.querySelector("parsererror").textContent);
  check("render", "RSS: 5 items, hostile title intact", fx.querySelectorAll("item").length === 5 && fx.querySelectorAll("item title")[4].textContent === HOSTILE_TITLE, "");
  check("render", "RSS: link-only item links out", fx.querySelectorAll("item link")[1].textContent === "https://www.iowadnr.gov/news?a=1&b=2", "");
  const sm = new DOMParser().parseFromString(R.sitemapXML({posts:samples(BASE), site:opt.site}), "application/xml");
  const locs = [...sm.querySelectorAll("loc")].map(l => l.textContent);
  check("render", "sitemap: home, app, news + 3 post pages", !sm.querySelector("parsererror") && locs.length === 6 && locs.includes("https://trailwatermaps.com/news/reading-the-snake-in-october"), locs.join(" "));
  check("render", "robots", /Disallow: \/admin\n/.test(R.robotsTxt(opt)) && /Sitemap: https:\/\/trailwatermaps\.com\/sitemap\.xml/.test(R.robotsTxt(opt)), "");

  await workerTests();
}

/* ---------- worker/index.js, with everything around it stubbed ---------- */
async function workerTests(){
  const store = new Map();
  const cache = {
    async match(req){ const r = store.get(req.url); return r ? r.clone() : undefined; },
    async put(req, res){ store.set(req.url, res.clone()); },
  };
  try{ caches.default = cache; }catch(e){}
  if(caches.default !== cache){ check("worker", "stub caches.default", false, "couldn't stub"); return; }

  let mode = "ok", calls = [];
  const realFetch = window.fetch;
  const data = samples(BASE).concat([hostile(BASE)]);
  window.fetch = async (url, init) => {
    url = String(url);
    if(!url.startsWith(SB)) return realFetch(url, init);
    calls.push({url, headers:Object.assign({}, init && init.headers)});
    if(mode === "down") throw new TypeError("Failed to fetch");
    if(mode === "500") return new Response('{"message":"boom"}', {status:500});
    if(mode === "404table") return new Response('{"code":"PGRST205","message":"Could not find the table"}', {status:404});
    const q = new URL(url).searchParams;
    let r = data.slice();
    const slug = q.get("slug"), kind = q.get("kind");
    if(slug && slug.startsWith("eq.")) r = r.filter(p => p.slug === slug.slice(3));
    if(slug === "not.is.null") r = r.filter(p => p.slug);
    if(kind) r = r.filter(p => p.kind === kind.slice(3));
    const off = +(q.get("offset") || 0), lim = +(q.get("limit") || 1000);
    return new Response(JSON.stringify(r.slice(off, off + lim)), {status:200, headers:{"Content-Type":"application/json"}});
  };
  const W = (await import("../worker/index.js")).default;
  const env = {SUPABASE_URL:SB, SUPABASE_KEY:KEY, SITE_URL:"https://trailwatermaps.com",
    ASSETS:{fetch:async req => new Response("asset " + new URL(req.url).pathname, {status:200, headers:{"Content-Type":"text/plain"}})}};
  const waits = [];
  const ctx = {waitUntil:p => waits.push(p)};
  const go = async (path, init) => { const res = await W.fetch(new Request("https://trailwatermaps.com" + path, init), env, ctx); await Promise.all(waits.splice(0)); return res; };
  const text = async res => res.status === 204 || !res.body ? "" : await res.text();

  try{
    let res = await go("/news"), t = await text(res);
    const c0 = calls[0] || {url:"", headers:{}};
    check("worker", "GET /news 200 html", res.status === 200 && /text\/html/.test(res.headers.get("content-type")) && /Reading the Snake/.test(t), res.status);
    check("worker", "CSP: no script, supabase images", /default-src 'none'/.test(res.headers.get("content-security-policy")) && !/script-src/.test(res.headers.get("content-security-policy")) && /img-src 'self' https:\/\/\*\.supabase\.co/.test(res.headers.get("content-security-policy")), res.headers.get("content-security-policy"));
    check("worker", "nosniff + max-age=300", res.headers.get("x-content-type-options") === "nosniff" && res.headers.get("cache-control") === "public, max-age=300", res.headers.get("cache-control"));
    check("worker", "Supabase: apikey only, no Authorization", c0.headers.apikey === KEY && !("Authorization" in c0.headers) && !("authorization" in c0.headers), JSON.stringify(c0.headers));
    check("worker", "Supabase query shape", /\/rest\/v1\/posts\?select=id,kind,slug,title,summary,link_url,link_source,cover_path,cover_alt,pinned,show_until,published_at,updated_at&status=eq\.published&order=published_at\.desc,id\.desc&limit=21&offset=0$/.test(c0.url), c0.url);
    let n = calls.length; res = await go("/news?utm_source=x"); await text(res);
    check("worker", "second hit served from cache (junk query shares it)", calls.length === n && res.status === 200, calls.length - n);
    check("worker", "reader never sees X-News-Built", !res.headers.get("x-news-built"), "");
    res = await go("/news?kind=blog"); await text(res);
    check("worker", "?kind=blog filters", /kind=eq\.blog/.test(calls[calls.length - 1].url), calls[calls.length - 1].url);
    n = calls.length; res = await go("/news?kind=<x>"); await text(res);
    check("worker", "?kind=bogus = all (cached)", calls.length === n && res.status === 200, "");
    res = await go("/news?page=2");
    check("worker", "page past the end is 404", res.status === 404, res.status);
    res = await go("/news/reading-the-snake-in-october"); t = await text(res);
    check("worker", "post page 200 with og:image", res.status === 200 && /og:image" content="https:\/\/kbdrxtyacmihabwadzzz\.supabase\.co\/storage\/v1\/object\/public\/post-images\/river\.webp"/.test(t), res.status);
    check("worker", "post query by slug", /slug=eq\.reading-the-snake-in-october/.test(calls[calls.length - 1].url) && /,body$|,body&/.test(calls[calls.length - 1].url.replace(/&status.*/, "")), calls[calls.length - 1].url);
    res = await go("/news/no-such-post");
    check("worker", "unknown slug 404 page", res.status === 404 && /That post isn't here/.test(await text(res)), res.status);
    n = calls.length; res = await go("/news/Bad_Slug!!");
    check("worker", "invalid slug 404 without a query", res.status === 404 && calls.length === n, calls.length - n);
    res = await go("/news/My-Post");
    check("worker", "uppercase slug redirects", res.status === 301 && res.headers.get("location") === "https://trailwatermaps.com/news/my-post", res.headers.get("location"));
    res = await go("/news/?kind=blog");
    check("worker", "/news/ redirects to /news", res.status === 301 && res.headers.get("location") === "https://trailwatermaps.com/news?kind=blog", res.headers.get("location"));
    res = await go("/news/x/");
    check("worker", "trailing slash redirects", res.status === 301 && res.headers.get("location") === "https://trailwatermaps.com/news/x", res.headers.get("location"));
    res = await go("/news/a/b");
    check("worker", "deeper path 404", res.status === 404, res.status);
    res = await go("/news/feed.xml"); t = await text(res);
    check("worker", "feed is RSS and parses", res.status === 200 && /application\/rss\+xml/.test(res.headers.get("content-type")) && !new DOMParser().parseFromString(t, "application/xml").querySelector("parsererror"), res.headers.get("content-type"));
    res = await go("/sitemap.xml"); t = await text(res);
    check("worker", "sitemap", res.status === 200 && /application\/xml/.test(res.headers.get("content-type")) && /news\/hostile-test/.test(t) && /slug=not\.is\.null/.test(calls[calls.length - 1].url), "");
    res = await go("/robots.txt"); t = await text(res);
    check("worker", "robots.txt", res.status === 200 && /^User-agent: \*/.test(t) && /text\/plain/.test(res.headers.get("content-type")), "");
    res = await go("/app"); t = await text(res);
    check("worker", "other paths go to the assets", t === "asset /app", t);
    res = await go("/newsletter"); t = await text(res);
    check("worker", "/newsletter is not a news path", t === "asset /newsletter", t);
    res = await go("/news", {method:"POST", body:"x"});
    check("worker", "POST is 405", res.status === 405 && res.headers.get("allow") === "GET, HEAD", res.status);
    res = await go("/news", {method:"HEAD"});
    check("worker", "HEAD has no body", res.status === 200 && (await text(res)) === "", "");

    // Stale copy when Supabase is down after the 5 minutes are up.
    const realNow = Date.now;
    Date.now = () => realNow() + 6 * 60 * 1000;
    try{
      mode = "down";
      res = await go("/news"); t = await text(res);
      check("worker", "Supabase down: stale copy served", res.status === 200 && res.headers.get("x-news-stale") === "1" && /Reading the Snake/.test(t) && res.headers.get("cache-control") === "public, max-age=60", res.headers.get("cache-control"));
      store.clear();
      res = await go("/news"); t = await text(res);
      check("worker", "down with no copy: 503 page, no-store", res.status === 503 && /News couldn't load right now/.test(t) && res.headers.get("cache-control") === "no-store" && res.headers.get("retry-after") === "120", res.status);
      res = await go("/news/feed.xml"); t = await text(res);
      check("worker", "feed down: plain 503", res.status === 503 && /text\/plain/.test(res.headers.get("content-type")), res.headers.get("content-type"));
      mode = "404table";
      res = await go("/news/reading-the-snake-in-october");
      check("worker", "table missing (posts.sql not run): 503, not 404", res.status === 503, res.status);
      mode = "500";
      res = await go("/sitemap.xml");
      check("worker", "5xx: 503", res.status === 503, res.status);
      mode = "ok";
      res = await go("/news"); await text(res);
      check("worker", "recovers after the outage", res.status === 200 && !res.headers.get("x-news-stale"), "");
    }finally{ Date.now = realNow; }

    // No vars: still a clean 503, never a raw error.
    store.clear();
    res = await W.fetch(new Request("https://trailwatermaps.com/news"), {ASSETS:env.ASSETS}, ctx);
    check("worker", "missing vars: 503 page", res.status === 503, res.status);
  }finally{
    window.fetch = realFetch;
  }
}

function show(){
  const pass = rows.filter(r => r.ok).length, fail = rows.length - pass;
  window.HARNESS = {pass, fail, failed:rows.filter(r => !r.ok)};
  document.getElementById("summary").textContent = `${pass} passed, ${fail} failed`;
  document.getElementById("out").innerHTML = `<table><tr><th>Group</th><th>Check</th><th>Result</th><th>Detail</th></tr>${
    rows.map(r => `<tr><td>${R.esc(r.group)}</td><td>${R.esc(r.name)}</td><td class="${r.ok ? "pass" : "fail"}">${r.ok ? "pass" : "FAIL"}</td><td><pre>${R.esc(r.detail.slice(0, 600))}</pre></td></tr>`).join("")}</table>`;
}

/* ---------- go: ?view=… shows one page full screen, else run the checks ---------- */
const view = new URLSearchParams(location.search).get("view");
if(view){
  const opts = {site:"https://trailwatermaps.com", imageBase:LOCAL};
  const all = samples(LOCAL);
  const html = view === "list" ? R.listPage(Object.assign({posts:all, page:1, hasMore:true}, opts))
    : view === "list-empty" ? R.listPage(Object.assign({posts:[], page:1, kind:"blog"}, opts))
    : view === "post" ? R.postPage(all[2], opts)
    : view === "news-body" ? R.postPage(all[3], opts)
    : view === "post-hostile" ? R.postPage(hostile(LOCAL), opts)
    : view === "notfound" ? R.notFoundPage(opts)
    : R.unavailablePage(opts);
  document.open(); document.write(html); document.close();
}else{
  run().catch(e => { check("harness", "ran to the end", false, e && e.stack || e); }).finally(show);
}

