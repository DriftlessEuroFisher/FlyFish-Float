# Feature ideas

A working backlog, refined with Claude as ideas come in — often borrowed from
other apps. Each idea keeps where it came from, what problem it solves *here*
(a phone in a parking lot deciding where to fish), and any decision made about
it. Move an idea to **Done** when it ships, with the commit.

Status: `new` → `refining` → `ready` (agreed spec) → `building` → `done`, or
`parked` / `dropped` with the reason.

## Ideas

### Regulations first in the river panel — `done` (2026-10-02, uncommitted)
- **Source:** our own discussion, 2026-10-02.
- **Problem:** the rules sit fourth in the river panel, under the flow cards
  and notes; "can I fish this today, and how?" is the first question.
- **Proposal:**
  - A "Rules today" card at the top, showing open/closed only where a dated
    season is known (otherwise "season varies by reach") and the licence
    needed.
  - Verbatim-phrase tags (Catch & release, Flies & lures only, Fly fishing
    only, Barbless, Gold Medal, Must kill rainbows).
  - The full official text folded below.
- **Open question:** also a small state pill ("Montana · FWP · standard
  season") when zoomed into one state?
- **Decided:** no paraphrased summaries; the wording is what keeps you legal.

### Bigger tap target on thin river lines — `parked`
- **Source:** Google/Apple Maps feel, 2026-10-02.
- **Problem:** creek lines are 2–3 px and hard to hit with a thumb.
- **Why parked:** an invisible wide line per river is ~1,100 extra SVG paths;
  CLAUDE.md warns that costs frames on a phone. Revisit with a canvas
  renderer or a nearest-river-on-tap lookup instead.

### Batch 2026-10-02: a fishing-app feature list (source app to be confirmed)

Rated against what is already here and what fits a no-backend, no-build
phone app. **Fit:** strong / medium / weak.

#### Offline maps — `building` · fit: strong
- **Problem:** service is patchy exactly where this app gets used.
- **Already have:** baked geometry and last-saved flow readings.
- **Gap:** the app shell and the basemap tiles.
- **Proposal:**
  - A service worker caches the app and data files.
  - A "Save this area for offline" button stores USGS Topo tiles z8–z15 for
    the view, using the Cache API.
- **Notes:**
  - USGS tiles are public domain. OpenTopoMap's policy forbids bulk download,
    so only USGS is offered for offline.
  - Show the storage used and let the user delete saved areas.

#### State water access laws — `building` · fit: strong (18 states researched, `js/access-laws.js`)
- **Problem:** whether you may wade or anchor on a streambed changes at the
  state line, and it is the most expensive thing to get wrong.
  - Montana: open to the high-water mark.
  - Colorado: you can't touch the bed through private land.
  - Wyoming: you can float through, but can't touch the bed or anchor.
- **Proposal:**
  - One sourced paragraph per state, from the statute or the agency's own
    page, quoted and cited.
  - Shown in the river panel next to the licence line, and in the state pill
    if that idea goes ahead.
- **Rule:** sourced, never from memory, the same as the regulations.

#### Gold Medal / Blue Ribbon fisheries — `new` · fit: strong
- **Proposal:** tag rivers and reaches with *official* designations: CPW Gold
  Medal, Montana Blue Ribbon, Wyoming Blue Ribbon, and similar where a state
  publishes one.
- **Note:** keep them distinct from this app's own Gold tier, which is a
  personal ranking.
- **Data:** CPW publishes Gold Medal reaches as GIS. The others need checking.

#### Nationwide stream gauges + real-time data — `new` · fit: strong
- **Already have:** 747 gauges attached to mapped rivers.
- **Proposal:**
  - A layer showing *every* active USGS discharge gauge in view, fetched per
    viewport like public land.
  - Tap a gauge for its live CFS and how it compares with normal, even when
    the river it sits on isn't mapped.
- **Watch:** the USGS request budget of 1,000 an hour. Fetch by bbox from
  zoom 8 and batch the reads.

#### Parking, boat ramps, campsites, trailheads — `new` · fit: strong
- **Already have:** ramps and fishing access in progress (OSM access pipeline).
- **Proposal:** extend the same pipeline with OSM `amenity=parking` near
  rivers, `tourism=camp_site` and `highway=trailhead`, each its own toggle.
- **Alternative for campsites:** Recreation.gov (RIDB) has federal campsites
  but needs an API key, which means a key in client code. Prefer OSM.

#### Waypoints with photos — `new` · fit: medium
- **Proposal:**
  - Drop a pin (long-press), with a name, a note and photos.
  - Stored on the phone in IndexedDB. No account, no server.
- **Limit:** stays on the one device. Sync or sharing would need a backend,
  which this app deliberately has none of. Add export/import as a file to
  cover backup.

#### Fish finder (species search) — `new` · fit: medium
- **Proposal:** search or filter "brook trout", "grayling", "steelhead" and
  show the rivers that hold them.
- **Watch:** species must come from a source field: agency species lists,
  regulation text naming the species, or Iowa/Wisconsin `wildTrout`. Not a
  guess from a blurb. Coverage will be uneven, and the app should say so.

#### Wild trout sections — `new` · fit: medium
- **Already have:** Iowa and Wisconsin classes, and Michigan Types.
- **Proposal:** add state wild-trout designations where published, e.g.
  Pennsylvania Class A and wild trout streams, or Montana and Idaho wild
  trout management areas.
- **Note:** this depends on expanding to those states, and is state by state.

#### Easements & SWAs / walk-in access — `new` · fit: medium
- **Already have:** PAD-US shows public land, including easements and state
  wildlife areas.
- **Gap:** the state walk-in programs: Montana Block Management, Colorado
  STL/Walk-In, Wyoming Walk-In Fishing, Iowa IHAP, and others.
- **Note:** each is a separate state GIS layer with its own rules and dates.
  Add them one state at a time, starting with the states fished most.

#### Trails + trail access points — `new` · fit: medium
- **Proposal:** a trails overlay (USFS/NPS trails or the USGS National Map
  trails service) fetched per viewport, plus trailheads from the item above.
- **Note:** the USGS Topo basemap already draws many trails. Check whether
  the overlay adds enough to be worth its own layer.

#### Nationwide public lands — `new` · fit: mostly done
- **Already have:** PAD-US is a nationwide service.
- **Gap:** verify it renders in every state on the map, and in Alaska.

#### 3D maps — `new` · fit: weak
- **Why weak:** Leaflet can't do 3D. True 3D means rewriting on MapLibre GL.
- **Cheap middle ground:** a USGS 3DEP **hillshade/shaded relief** layer, so
  valleys and canyons read in relief. Offer that instead.

#### Expert river picks — `new` · fit: weak as stated
- **Problem:** other apps pay guides to write these. Writing them here
  without that knowledge would be invented content, which the app rules out.
- **Alternative:** the tiers already are picks. Add a "My notes" field per
  river (on the phone), and let your own picks become the expert layer.

#### Top-rated access areas — `new` · fit: weak
- **Problem:** ratings by other users need accounts and a server.
- **Alternative:** personal stars on access points, stored on the phone, and
  sort by your own ratings.

### Batch 2026-10-02 (2): scale and points of interest

#### Enabler: static tiled data — `new` · needed by several items below
- **Problem:** 55k streams or 350k bridges can't be baked into one JS file.
  The current 2.6 MB `rivers-data.js` is already the ceiling for a phone.
- **Proposal:**
  - Precompute per-grid JSON files (e.g. 1° cells) into the repo.
  - GitHub Pages serves them as static files, and the app loads only the
    cells in view.
- **Fit:** still no backend and no build step for the app; the pipelines in
  `~/.cache/flyfish-osm` write the cells.
- **Limit:** GitHub Pages sites cap at 1 GB, so points are cheap and line
  geometry for a whole country is not.

#### 55k trout streams / 225k rivers — `new` · fit: medium (a different kind of entry)
- **Today:** 1,100 hand-curated rivers with blurbs, gauges and quoted rules.
- **Proposal:** a second, lighter tier called **"Discover" water**:
  - From zoom 11, draw the state *designated trout water* layers live from
    the state services, the way the Wisconsin, Michigan and Iowa layers are
    already read.
  - Elsewhere, NHD named flowlines.
  - Name, class and agency rule text only. No invented blurb.
- **Note:** the curated rivers stay as they are, and Discover water says
  plainly that it isn't curated.
- **Data:** state coverage varies. List which states publish a
  trout-water layer before committing.

#### Thousands of trout lakes — `new` · fit: medium
- **Proposal:** state stocked-lake and trout-lake layers, e.g. Colorado
  stocking, Minnesota LakeFinder, Wisconsin, Michigan. These go in
  Discover-style entries with the stocking record and the agency link.
- **Note:** same pattern as above. Today's 31 lakes stay curated.

#### River regulations (everywhere) — `new` · fit: medium
- **Already have:** quoted rules on every mapped river in 14 states, plus the
  parks.
- **Proposal:** where a state publishes regulations *as GIS* (Wisconsin
  FM_TROUT_REGS, Michigan Types, Iowa special regs), attach them to
  Discover water automatically.
- **Elsewhere:** the state's standard rule plus a link to the booklet. No
  paraphrase.

#### Bridge access points (350k+) — `new` · fit: strong (uses the enabler)
- **Data:** the FHWA **National Bridge Inventory**, public domain, about
  620k bridges with coordinates. Filter it to bridges carrying a public road
  over a waterway (NBI item 42B, "service under" = waterway). That should
  land near the 350k figure. Ship it as static tiled points.
- **Watch:**
  - A public road bridge is **not** legal access in every state. Some forbid
    entering from a bridge right-of-way, or treat the bed as private.
  - Each bridge pin should carry that state's water-access-law line, from the
    water-access-laws idea above.

#### Fly shops & retailers — `new` · fit: medium
- **Data:** OSM `shop=fishing` / `shop=outdoor` (free, patchy coverage).
  Google Places has better coverage but needs a paid key in client code, so
  avoid it.
- **Proposal:** OSM shops shipped as static tiled points, each with a phone
  number and website when OSM has them. Allow adding a favourite shop by hand.

#### Waterfalls & rapids — `new` · fit: strong
- **Problem:** this is a safety feature for anyone floating.
- **Data:** OSM `waterway=waterfall`, `waterway=rapids` / `whitewater=*`,
  and GNIS falls.
- **Proposal:** extend the access pipeline. Show them on the line from zoom
  11, and list them under "Float sections" on the river panel.
- **Note:** Iowa's low-head dams belong in the same layer.

#### Angler profile — `new` · fit: weak as an account
- **Problem:** accounts mean a server and stored personal data.
- **Alternative:** on-device settings with no sign-in:
  - Home location, used for "nearest first" and drive time.
  - Licences held, so a river panel can flag "you need a Colorado licence".
  - Favourite rivers and species.
- **Export:** to a file, together with the waypoints.

### Batch 2026-10-02 (3): AI fly box

#### Fly box scanner + AI fly recommendations — `new` · fit: medium (needs care)
- **Idea:** photograph your fly box; AI identifies the flies, suggests what
  to fish, suggests flies to add, and shows pictures and where to buy.

**How it can run without a server:**
- The phone calls the Claude API directly, with **your own API key** stored
  on the phone, the same pattern as the optional `usgsApiKey`.
- Anthropic allows browser calls with the
  `anthropic-dangerous-direct-browser-access` header.
- A key built into the app's code would be public on GitHub and usable by
  anyone, so that is ruled out.
- Cost: a few cents per photo.

**Pieces:**
1. **Scan:**
   - The photo goes to a Claude vision model, which returns a list:
     pattern, type (dry, nymph, streamer, emerger), approximate size, colour,
     count and a confidence for each.
   - You confirm or correct each one before it is saved.
   - Saved as your **fly inventory** on the phone, in IndexedDB with your
     cropped photos.
2. **What to tie on:** grounded in real data first.
   - Today's flow status from the gauge (high and off-colour points to
     streamers and big nymphs).
   - The month, the river's species, and its gear rules (flies only,
     barbless).
   - Only then the AI's pattern knowledge, **labelled as AI suggestion**,
     matched against what is in your box.
3. **Flies to add:**
   - The gaps between your box and those suggestions.
   - Each comes with a **shop search link** built from the pattern name and
     size (e.g. the retailer's own search page for "Parachute Adams 16").

**Watch:**
- **No invented product links.** AI makes up URLs. Build search URLs from
  the name instead.
- **No copied product photos.** Retailers' images are theirs. Show your own
  cropped photos, and for recommended flies a description plus the shop
  link, or a photo you take once you own it.
- **ID accuracy is limited.** Size is hard to judge from a photo, and many
  patterns look alike. Always show confidence and let you correct.
- **Privacy:** the photo goes to Anthropic. Say so on the scan button.
- **Hatch charts:** no sourced hatch data in the app yet. A real hatch table
  per region would make the recommendations much better than AI memory.

**Possible later:** affiliate links on shop searches could pay for the API
use.

## Future upgrades that need a paid key or subscription — `parked` (on the radar)

Not for now. Kept so the cost side of each idea is visible. Prices change,
so check current pricing before committing. Most have a free tier that
would cover one person's use.

### The one that unlocks many others
- **A small server (e.g. Cloudflare Workers, Supabase, Firebase)**
  - **Unlocks:** a shared API key nobody can steal; accounts; syncing
    waypoints, fly box and profile across devices; other people's ratings of
    access points; shared trip logs; push alerts.
  - **Cost:** free tiers are generous; paid is usage-based.
  - **Trade-off:** the app stops being "no backend", and stored personal data
    brings privacy duties.

### AI
- **Claude API**
  - **Unlocks:** fly-box scan, fly recommendations, and a plain-English
    "where should I fish today?" over live flows, seasons and rules.
  - **Cost:** pay per use, cents per request.
  - **Note:** works today with your own key on the phone. A shared key needs
    the server.

### Maps
- **Licensed satellite imagery for offline (Mapbox, MapTiler)**
  - **Unlocks:** saving satellite imagery to the phone. Google and Esri terms
    forbid caching their imagery offline; USGS Topo can already be saved
    free.
  - **Cost:** tiered subscription.
- **3D terrain (Mapbox GL / MapTiler terrain on MapLibre)**
  - **Unlocks:** a real 3D view of a canyon.
  - **Cost:** tiered.
  - **Note:** also means moving off Leaflet.
- **Private land parcels and owner names (Regrid or a county parcel
  aggregator)**
  - **Unlocks:** the "whose land is this?" layer that makes onX/HuntWise
    valuable for access.
  - **Cost:** paid licence. The biggest-value and most expensive item on the
    list.

### Places and routes
- **Google Places API**
  - **Unlocks:** fly shops with hours, phone, reviews and better coverage
    than OpenStreetMap.
  - **Cost:** per request, with a monthly free credit.
- **Drive time (Google Directions, Mapbox Directions; OpenRouteService has a
  free key)**
  - **Unlocks:** "2 h 10 min from you" on every river, and sorting by drive
    time.
  - **Cost:** per request.

### Weather (beyond the free sources)
- **Tomorrow.io, OpenWeather One Call**
  - **Unlocks:** hourly wind, gusts, pressure trend and lightning alerts per
    river.
  - **Cost:** free tier, then paid.
  - **Note:** the National Weather Service API is free with no key and covers
    forecasts. Start there.

### Community research (Reddit and forums)
- **Reddit Data API**
  - **Unlocks:** pulling recent posts about a river into the app: titles,
    dates and links, with attribution.
  - **Cost:** you register an app and accept Reddit's Data API terms. It is
    free at low volume for non-commercial use; commercial use is paid.
  - **Now:** the Field Book uses Reddit **search links** per river, which
    need no key. Posts belong to their authors, so link to them; don't copy
    their text into the app.

### Content (licensing or partnerships, not code)
- **Fishing reports from fly shops:** licensed or partnered content.
  Scraping their sites isn't OK.
- **Hatch charts by region:** licensed from a guide or author, or built from
  your own logs.

### Distribution
- **Apple App Store developer account ($99/yr), Google Play ($25 one-time)**
  - **Unlocks:** a native app with background GPS, reliable push and app
    store presence.
  - **Note:** only if the home-screen web app stops being enough.
- **Custom domain:** a few dollars a year, instead of the github.io address.

### Revenue side (offsets the costs above)
- **Affiliate programs (e.g. AvantLink for Orvis and others)** on shop
  links.

### Free sources worth using first (no key, no cost)
- National Weather Service forecasts and alerts.
- NRCS **SNOTEL** snowpack (predicts runoff).
- **USGS water temperature** (parameter 00010) on gauges that report it.
- State fish **stocking** reports.
- Sunrise, sunset and moon phase, computed on the phone.

## Done

- **Field Book**: favourites, fished, notes, Research links (Reddit/web search), export/import; extensible `BOOK_SECTIONS` tabs (2026-10-02, uncommitted).

- **Live location dot + follow mode** (2026-10-02, uncommitted).
- **Double-tap zoom, one-finger zoom, two-finger tap out, smoother pinch**
  (2026-10-02, uncommitted).
- **"Read me first" banner moved into the ? panel** (2026-10-02, uncommitted).

## Dropped

- **Map rotation:** Leaflet can't rotate the map.
