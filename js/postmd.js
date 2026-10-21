/* PostMD — the small Markdown subset that news and blog posts are written in
   (supabase/posts.sql, `body`). One renderer for both places a post is shown:
   the live preview in admin.html's editor and the published page the
   Cloudflare Worker builds (worker/render.js). Same code, so the preview is
   what gets published.

   A plain script with no imports or exports: admin.html loads it with an
   ordinary <script>, and worker/index.js does `import "../js/postmd.js"` for
   its side effect (wrangler bundles it). Either way it sets
   globalThis.PostMD and reads no other globals: the photo address it allows
   comes in through `opts`.

   Safety, which is the point of it being a subset:
   - All HTML in the text is escaped before anything else happens. No raw
     HTML, ever: "<script>" in a post is shown as the characters <script>.
     Every tag in the output is one this file writes.
   - Links only to https:, http:, mailto: or a site path ("/news/…", not
     "//host"). Anything else (javascript:, data:, vbscript:, a typo) is shown
     as its plain link text. Outside links get rel="noopener noreferrer".
   - Images only from this project's post-images bucket, opts.imageBase
     ("<project>/storage/v1/object/public/post-images/"). Any other image
     address shows the alt text instead.
   - Attribute values are built from escaped text, so a quote in an alt or a
     URL can't close the attribute.

   The subset:
     ## Heading, ### Smaller heading
     **bold**, *italic*, [text](url), ![alt](photo url)
     - list item (or * or +), 1. numbered item
     > quote
     a blank line between paragraphs; a single line break is kept as a break
     \* \[ \# … a backslash shows the next character as itself

   PostMD.render(md, opts) -> HTML string. opts.imageBase allows photos;
     opts.dropped, if an array, collects {kind:"link"|"image", url} for every
     link or photo that was shown as text instead (the editor warns about them).
   PostMD.excerpt(md, n) -> plain text, first n characters at a word break.
   PostMD.slugify(title) -> "lowercase-words-with-hyphens", at most 80.
   PostMD.isSlug(s), PostMD.imageBase(supabaseUrl), PostMD.photoURL(base, path). */

(function(root){
  "use strict";

  const ESC = {"&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"};
  const UNESC = {amp:"&", lt:"<", gt:">", quot:'"', "#39":"'"};
  const esc = s => String(s).replace(/[&<>"']/g, c => ESC[c]);
  const unesc = s => String(s).replace(/&(amp|lt|gt|quot|#39);/g, (m, e) => UNESC[e]);

  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const SLUG_MAX = 80;
  const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/;   // an object path in the bucket

  /* Line endings to \n, tabs to spaces, and every other control character
     out. NUL in particular: it is the placeholder marker below, so text can
     never forge one. */
  function clean(md){
    return String(md == null ? "" : md)
      .replace(/\r\n?/g, "\n")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/\t/g, "    ")
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  }

  /* ---------- addresses ---------- */
  // Characters no link of ours needs, and that only ever help someone
  // smuggle something: whitespace, quotes, angle brackets, backslashes
  // ("/\evil.example" is "//evil.example" to a browser), backticks.
  const BAD_URL_CHARS = /[\s"'<>\\`\u0000-\u001F\u007F]/;
  function linkTarget(raw){
    const u = unesc(raw);
    if(!u || u.length > 2000 || BAD_URL_CHARS.test(u)) return null;
    if(/^https?:\/\/[^\/?#]+/i.test(u)) return {url:u, outside:true};
    if(/^mailto:[^@\/?#]+@[^@\/?#]+\.[^@\/?#]+(\?.*)?$/i.test(u)) return {url:u, outside:false};
    if(/^\/(?![\/])/.test(u)) return {url:u, outside:false};       // "/news/x", never "//host"
    return null;
  }
  function imageBase(supabaseUrl){
    const u = String(supabaseUrl || "").replace(/\/+$/, "");
    return /^https:\/\/[^\/?#\s]+$/i.test(u) ? u + "/storage/v1/object/public/post-images/" : "";
  }
  /* The public address of a photo in the bucket, or "" if the path isn't one. */
  function photoURL(base, path){
    path = String(path || "");
    if(!base || !path || path.length > 200 || !PATH_RE.test(path) || path.indexOf("..") >= 0) return "";
    return base + path;
  }
  function imageTarget(raw, base){
    const u = unesc(raw);
    if(!base || !u.startsWith(base) || BAD_URL_CHARS.test(u)) return null;
    return photoURL(base, u.slice(base.length)) || null;
  }

  /* ---------- inline: links, photos, bold, italic ----------
     Works on escaped text. Links and photos are swapped for numbered
     placeholders (NUL n NUL) as soon as they are built, so the bold and
     italic patterns can never reach inside an href or an alt. */
  const IMG_MD = /!\[([^\]\n]*)\]\(([^()\s]+)\)/g;
  const LINK_MD = /\[([^\]\n]*)\]\(([^()\s]+)\)/g;
  const PH = /\u0000(\d+)\u0000/g;

  /* Bold and italic. Each run of stars may close what is open (if it
     follows a non-space) and then open (if a non-space follows it): "*" is
     italic, "**" bold, "***" both. Only the innermost open marker can be
     closed, and tags are written only as matched pairs, so they always nest
     properly; any star left unmatched stays a plain star. */
  function emphasis(s){
    const out = [], open = [];
    const run = /\*+/g;
    let last = 0, m;
    while((m = run.exec(s))){
      out.push(s.slice(last, m.index));
      last = m.index + m[0].length;
      let left = m[0].length;
      if(left > 3){ out.push(m[0]); continue; }
      const before = m.index ? s[m.index - 1] : " ", after = last < s.length ? s[last] : " ";
      if(!/\s/.test(before)){
        while(left && open.length && open[open.length - 1].len <= left){
          const o = open.pop(), tag = o.len === 2 ? "strong" : "em";
          out[o.at] = `<${tag}>`;
          out.push(`</${tag}>`);
          left -= o.len;
        }
      }
      if(left && !/\s/.test(after)){
        // "***" opens bold outside italic.
        for(const len of left === 3 ? [2, 1] : [left]){ open.push({len, at:out.length}); out.push("*".repeat(len)); }
        left = 0;
      }
      if(left) out.push("*".repeat(left));
    }
    out.push(s.slice(last));
    return out.join("");
  }

  function inline(raw, opts, breaks){
    const held = [];
    const hold = html => "\u0000" + (held.push(html) - 1) + "\u0000";
    const drop = (kind, url) => { if(Array.isArray(opts.dropped)) opts.dropped.push({kind, url:unesc(url)}); };
    // 1. Backslash escapes, on the raw text: the character, escaped, held.
    let s = raw.replace(/\\([\\`*_\[\]()!#>+\-.~|{}])/g, (m, c) => hold(esc(c)));
    // 2. Everything else is escaped. From here on there is no "<" in s
    //    that this function didn't write.
    s = esc(s);
    // 3. Photos, then links (a photo's "![" would otherwise read as "!" + a link).
    s = s.replace(IMG_MD, (m, alt, url) => {
      const src = imageTarget(url, opts.imageBase);
      if(!src){ drop("image", url); return hold(alt); }
      return hold(`<img src="${esc(src)}" alt="${alt}" loading="lazy" decoding="async">`);
    });
    s = s.replace(LINK_MD, (m, text, url) => {
      const t = linkTarget(url);
      const label = text.trim() ? emphasis(text) : url;
      if(!t){ drop("link", url); return hold(label); }
      return hold(`<a href="${esc(t.url)}"${t.outside ? ` rel="noopener noreferrer"` : ""}>${label}</a>`);
    });
    // 4. Bold and italic on what is left.
    s = emphasis(s);
    if(breaks) s = s.replace(/\n/g, "<br>\n");
    // 5. Placeholders back. A held piece can hold earlier ones (an escaped
    //    star inside link text), so repeat until none are left.
    for(let i = 0; i < 4 && s.indexOf("\u0000") >= 0; i++) s = s.replace(PH, (m, n) => held[+n] != null ? held[+n] : "");
    return s.replace(/\u0000/g, "");
  }

  /* ---------- blocks ---------- */
  const H_RE = /^ {0,3}(#{2,3})[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$/;
  const QUOTE_RE = /^ {0,3}>[ ]?(.*)$/;
  const UL_RE = /^ {0,3}[-*+][ \t]+(.*)$/;
  const OL_RE = /^ {0,3}(\d{1,9})[.)][ \t]+(.*)$/;
  const LONE_IMG = /^!\[[^\]\n]*\]\([^()\s]+\)$/;

  function render(md, opts){
    opts = opts || {};
    const lines = clean(md).split("\n");
    const out = [];
    let para = [], list = null, quote = [];
    function flushPara(){
      if(!para.length) return;
      const text = para.join("\n").trim();
      para = [];
      // A photo on a line of its own is a figure, not a photo inside a paragraph.
      if(LONE_IMG.test(text)){
        const html = inline(text, opts, false);
        if(html.startsWith("<img ")){ out.push(`<figure>${html}</figure>`); return; }
      }
      out.push(`<p>${inline(text, opts, true)}</p>`);
    }
    function flushList(){
      if(!list) return;
      const start = list.type === "ol" && list.start !== 1 ? ` start="${list.start}"` : "";
      out.push(`<${list.type}${start}>` + list.items.map(it => `<li>${inline(it.join("\n").trim(), opts, true)}</li>`).join("") + `</${list.type}>`);
      list = null;
    }
    function flushQuote(){
      if(!quote.length) return;
      // Paragraphs inside a quote: a ">" line with nothing after it.
      const parts = quote.join("\n").split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
      out.push(`<blockquote>${parts.map(p => `<p>${inline(p, opts, true)}</p>`).join("")}</blockquote>`);
      quote = [];
    }
    const flush = () => { flushPara(); flushList(); flushQuote(); };

    for(const line of lines){
      let m;
      if(!line.trim()){ flush(); continue; }
      if((m = H_RE.exec(line))){
        flush();
        out.push(`<h${m[1].length}>${inline(m[2], opts, false)}</h${m[1].length}>`);
        continue;
      }
      if((m = QUOTE_RE.exec(line))){
        flushPara(); flushList();
        quote.push(m[1]);
        continue;
      }
      if((m = UL_RE.exec(line))){
        flushPara(); flushQuote();
        if(!list || list.type !== "ul"){ flushList(); list = {type:"ul", items:[]}; }
        list.items.push([m[1]]);
        continue;
      }
      if((m = OL_RE.exec(line))){
        flushPara(); flushQuote();
        if(!list || list.type !== "ol"){ flushList(); list = {type:"ol", items:[], start:Math.min(+m[1], 1e6)}; }
        list.items.push([m[2]]);
        continue;
      }
      // A line with no marker carries on whatever it follows.
      if(list){ list.items[list.items.length - 1].push(line.trim()); continue; }
      if(quote.length){ quote.push(line.trim()); continue; }
      para.push(line);
    }
    flush();
    return out.join("\n");
  }

  /* ---------- plain text ---------- */
  function plain(md){
    return clean(md)
      .replace(IMG_MD, "")
      .replace(LINK_MD, "$1")
      .replace(/^ {0,3}#{1,6}[ \t]+/gm, "")
      .replace(/^ {0,3}>[ ]?/gm, "")
      .replace(/^ {0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+/gm, "")
      .replace(/\*\*([^*\n]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/\\([\\`*_\[\]()!#>+\-.~|{}])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
  }
  function excerpt(md, n){
    n = Math.max(20, +n || 160);
    const t = plain(md);
    if(t.length <= n) return t;
    let cut = t.slice(0, n - 1);
    const sp = cut.lastIndexOf(" ");
    if(sp > n * 0.6) cut = cut.slice(0, sp);
    return cut.replace(/[\s.,;:!?\-–—]+$/, "") + "…";
  }

  /* ---------- slugs ---------- */
  function slugify(title){
    let s = String(title == null ? "" : title);
    if(s.normalize) s = s.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");   // é -> e
    s = s.toLowerCase()
      .replace(/&/g, " and ")
      .replace(/['\u2019]/g, "")            // "don't" -> "dont", not "don-t"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if(s.length > SLUG_MAX){
      s = s.slice(0, SLUG_MAX);
      const cut = s.lastIndexOf("-");
      if(cut > SLUG_MAX / 2) s = s.slice(0, cut);
      s = s.replace(/-+$/, "");
    }
    return s;
  }
  const isSlug = s => typeof s === "string" && s.length <= SLUG_MAX && SLUG_RE.test(s);

  root.PostMD = {render, excerpt, plain, slugify, isSlug, SLUG_RE, SLUG_MAX, imageBase, photoURL, esc};
})(typeof globalThis !== "undefined" ? globalThis : self);   // not `this`: bundled as a module it is undefined
