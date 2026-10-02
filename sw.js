/* Offline support. Three caches with different lifetimes:
   - VERSION: the app shell. Bumped on release; old ones are deleted on activate.
   - tiles-browse: USGS Topo tiles seen while browsing, trimmed to ~2500.
   - tiles-saved: tiles the user downloaded on purpose (Field Book > Offline).
     Deliberately unversioned so an app update never wipes saved areas.
   Every URL here is relative: the site lives at a sub-path on GitHub Pages. */
const VERSION = "flyroutes-v1";
const TILES_BROWSE = "tiles-browse", TILES_SAVED = "tiles-saved";
const TOPO = "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/";
const LEAFLET = [
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
];
const SHELL = ["./", "index.html", "css/styles.css", "js/app.js", "js/rivers-data.js", "js/tiers.js",
  "js/zones.js", "js/access-laws.js", "manifest.json", "icons/icon-192.png", "icons/icon-512.png", ...LEAFLET];
const BROWSE_MAX = 2500, TRIM_EVERY = 50, NET_TIMEOUT = 4000;
let puts = 0;

self.addEventListener("install", e => {
  // Individually, so one missing file doesn't abort the whole install.
  e.waitUntil(caches.open(VERSION).then(c => Promise.all(SHELL.map(u => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith("flyroutes-") && k!==VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// A dead connection can hang for a minute; on patchy signal the cache is better than waiting.
function fetchTimeout(req, ms){
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error("timeout")), ms);
    fetch(req).then(r => { clearTimeout(t); ok(r); }, e => { clearTimeout(t); no(e); });
  });
}
async function networkFirst(req, isNav){
  const cache = await caches.open(VERSION);
  try{
    const res = await fetchTimeout(req, NET_TIMEOUT);
    if(res.ok) cache.put(req, res.clone());
    return res;
  }catch(err){
    const hit = await cache.match(req, {ignoreSearch:true}) || (isNav ? await cache.match("index.html") : null);
    if(hit) return hit;
    throw err;
  }
}
async function cacheFirst(req){
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req);
  if(hit) return hit;
  const res = await fetch(req);
  if(res.ok || res.type==="opaque") cache.put(req, res.clone());
  return res;
}
async function trimBrowse(cache){
  const keys = await cache.keys();                 // insertion order, oldest first
  for(let i = 0; i < keys.length - BROWSE_MAX; i++) await cache.delete(keys[i]);
}
async function tile(req){
  const url = req.url;
  const saved = await caches.open(TILES_SAVED).then(c => c.match(url));
  if(saved) return saved;
  const browse = await caches.open(TILES_BROWSE);
  const hit = await browse.match(url);
  if(hit) return hit;
  // Re-ask in CORS mode (the server sends ACAO:*) so the stored copy is a real
  // response; an opaque one is padded to megabytes of quota each.
  const res = await fetch(url, {mode:"cors"});
  if(res.ok){
    await browse.put(url, res.clone());
    if(++puts % TRIM_EVERY === 0) trimBrowse(browse);
  }
  return res;
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method!=="GET") return;
  const url = new URL(req.url);
  if(req.url.startsWith(TOPO)){ e.respondWith(tile(req)); return; }
  if(url.origin===self.location.origin || LEAFLET.includes(req.url)){
    e.respondWith(networkFirst(req, req.mode==="navigate")); return;
  }
  if(url.hostname==="fonts.googleapis.com" || url.hostname==="fonts.gstatic.com"){
    e.respondWith(cacheFirst(req)); return;
  }
  // Everything else (USGS water, DWR, NHD, Overpass, PAD-US, other basemaps,
  // analytics) goes straight to the browser. Other tile servers' terms forbid
  // offline caching, so they are never stored.
});
