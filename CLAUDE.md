# River Conditions — ID, WY, Iowa, Minnesota & Wisconsin — Fly Fishing / Float Map

A single-page, no-build, mobile-first web app: a Leaflet map of Idaho &
Wyoming trout rivers, the Central Iowa (Des Moines area) state water
trail system, the trout streams of the Driftless Area, the steelhead/
trout tributaries of Minnesota's North Shore of Lake Superior, the
big warmwater float rivers of east-central Minnesota and the St. Croix
valley, and the north-central Minnesota lakes country and Wisconsin
Northwoods, with live USGS flow conditions, built for checking "is it
worth driving out today?" from a phone.

## How I use this

Almost always on my phone, usually standing in a parking lot or driveway
deciding where to go. Load time and one-thumb usability matter more than
desktop polish. It's added to my home screen (see `manifest.json`) so it opens
like an app, not a browser tab.

## Project layout

- `index.html` — markup only (app bar, map container, bottom sheet, legend).
- `css/styles.css` — all styling. Design direction: "river gauge field
  instrument" — dark spruce chrome, cool gauge-paper panels, teal for water,
  survey-flagging orange reserved for the live data readout only.
- `js/rivers-data.js` — the file to edit when adding a river, fixing a gauge
  ID, or setting a good-flow range. Contains `GAUGES`, `GAUGE_POS`, `RIVERS`,
  `RAMPS`, `SECTIONS`, `WADE_ONLY`.
- `js/app.js` — fetch/render/status logic. Talks directly to the USGS OGC API
  (`api.waterdata.usgs.gov`) client-side — no backend, no API key.
- `manifest.json` + `icons/` — home-screen install support.
- No build step, no framework, no bundler. Edit and reload.

## Rivers covered

181 rivers. Full list and gauge IDs live in `js/rivers-data.js`; this file
doesn't duplicate it since the code is the source of truth. Rivers carry a
`region` field — `"driftless"` and `"northshore"` on the two small-stream
sub-regions, absent on the original western rivers *and* on the two
Minnesota/Wisconsin big-water clusters (see below), `"ciowa"` conceptually
for the Des Moines water trails (the code tests `state==="IA" &&
region!=="driftless"` so the central Iowa entries didn't need editing).

The `region` tag exists to drive *UI behavior* (ungauged cards, easement
notes, tighter label zoom), not to catalogue geography. That's why only
the two small-stream regions have one: if a cluster is fully gauged and
needs no special copy, it deliberately gets no tag.

**West (49).** Idaho/Wyoming trout rivers — 24 ID, 25 WY. All gauged.

**Central Iowa (7).** Des Moines River, Raccoon River and its North/Middle/
South forks, South Skunk River, Beaver Creek. Warmwater fisheries (catfish,
smallmouth, walleye, carp) tied to the official Iowa DNR water trail /
paddling system rather than trout wade-fishing — same data model, different
character. They carry a low-head-dam safety note in the UI (a real,
documented hazard on these rivers) that no other region needs.

**Driftless (72).** 20 IA, 21 MN, 30 WI, 1 IL. Spring-fed limestone trout
streams across the unglaciated region: the Upper Iowa and the Allamakee /
Clayton county creeks, the Root River system and the Whitewater in SE
Minnesota, Vernon County's coulees and the Kickapoo watershed, the Grant
County spring creeks, the Dane County limestone streams, and the
Kinnickinnic / Rush / Trimbelle cluster up in Pierce County.

Only **19 of the 72** Driftless rivers have a USGS gauge. That's the
defining constraint of the region and it drove two deliberate decisions:

- **No borrowed gauges.** A stream with no gauge gets `gauges: []` and
  `primaryGauge: null`, and the sheet renders an "Ungauged" card
  (`noGaugeHTML()`) instead of a fabricated number. It offers the nearest
  gauged river as a *regional wetness* read, explicitly labelled as a
  different stream. `nearestGaugedRiver()` applies a 1.8× distance penalty
  across state lines — without it the nearest gauge to a Wisconsin coulee
  creek is often something across the Mississippi in Iowa: close on the
  map, wrong watershed, wrong agency.
- **Discharge only.** Several Driftless USGS sites (Rush Creek and Crooked
  Creek in MN, Campbell Creek, Root River above Rushford) publish *stage*
  (00065) but not *discharge* (00060). They are deliberately **not** in
  `GAUGES` — the status logic needs CFS. Those rivers are carried as
  ungauged, and their blurbs say why. Don't "fix" this by adding them.

Driftless water is walk-and-wade; `RAMPS` entries there are `role:"wade"`
parking/access anchors (state parks, DNR fishery areas, county parks,
hatcheries, bridge pull-offs), not boat ramps, and there are no `SECTIONS`.
The exceptions — the Upper Iowa, Root, Kickapoo, Turkey and a few other
mainstems — are genuinely paddleable and say so in `WADE_ONLY`.

Every Driftless river also triggers a public-angling-easement note in the
sheet: a lot of the best water crosses private land under a state easement
(fish and walk the stream corridor, don't leave it), and several streams
carry catch-and-release or artificial-only stretches whose boundaries
change. The blurbs point at the current state regs rather than asserting a
rule that may be stale.

**No stream-level class on Driftless water.** An ungauged Driftless creek
shows the nearest gauged river's raw CFS as a regional-wetness hint, but
*not* its status badge — see `noGaugeHTML()`'s `showClass`. A "Below
average" chip next to a creek with no gauge reads as that creek's level no
matter what the caption says, and it's really a classification of different
water a valley over. Gauged Driftless streams (Waterloo, Bloody Run, Black
Earth, the Kinni…) still show a real class, because theirs is real. The
North Shore keeps the badge; only `region==="driftless"` is suppressed.

**Driftless geometry was re-snapped to real NHD channel linework.** The
hand-drawn coords were correctly *located* — they ran through the true USGS
gauge and access-point coordinates — but were straight chords between those
anchors, so on a topo basemap they visibly cut across ridges instead of
following the creek. 69 of the 72 now resolve to real channel geometry.

Two traps to know if you ever redo this:

- **Don't measure "is this river misplaced" by distance from its line to
  the NHD channel.** A straight chord between two *correct* endpoints
  scores terribly on that metric. It flagged 53 of 72 as misplaced when
  almost all were fine. Measure distance from the line to that river's own
  gauge/ramp anchors instead — those are authoritative coordinates.
- **Don't pick the NHD match nearest a centroid.** Names like Clear Creek,
  Pine Creek, Rush Creek and Coon Creek repeat all over the region, and
  centroid-nearest happily grabbed a creek 16 km away. Choose the connected
  cluster that minimises total distance to *all* the river's anchors.

Ten creeks genuinely were on the wrong ground (Timber Coulee sat ~10 km
south of Coon Valley) and were relocated, with their access markers
re-projected onto the corrected channel. Each was confirmed twice: NHD
returns that exact GNIS name there, *and* the town named in the river's own
blurb sits on it.

Three stay hand-drawn because NHD has no flowline under that name at that
location: **Coldwater Creek** (IA — the only NHD "Coldwater Creek" in range
is in Franklin County, ~60 mi from the Winneshiek County creek the blurb
describes, so there's nothing safe to snap to), **Spring Coulee Creek** and
**Bohemian Valley Creek** (both local Coon Valley-area names). Bohemian
Valley's coords are already correct near Chaseburg; Spring Coulee's are
still approximate.

**North Shore (24).** 22 MN, 1 WI (the Bois Brule), plus the Pigeon River
which is itself the US–Canada border. Steelhead/brown-trout tributaries of
Lake Superior running Duluth → Grand Portage along Hwy 61: the Duluth-area
creeks (Lester, French, Sucker, Talmadge), the Knife/Stewart/Silver cluster,
the state-park run (Gooseberry, Split Rock, Baptism/Tettegouche, Temperance,
Cascade), the Grand Marais cluster (Devil Track, Kadunce, Brule/Magney,
Flute Reed), and the border rivers (Pigeon, Grand Portage). Added because
they're within a 5-hour drive of Forest Lake, MN, the same "worth driving
today" test as everything else in this app.

Same ungauged-stream philosophy as the Driftless, verified against the live
USGS site list on 2026-09-21: only **6 of the 24** have an active discharge
gauge (Knife River, St. Louis River ×2, Nemadji, Pigeon, Grand Portage, Bois
Brule) — `nearestGaugedRiver()` handles the rest exactly like a Driftless
creek, no code changes needed since that function is already generic on
`r.region`. Devil Track has a USGS site number but it isn't reporting live
discharge, so — same rule as Rush/Crooked/Campbell Creek in the Driftless —
it's carried as ungauged rather than shown as stale.

Public access here is mostly **state-park and DNR-wayside parking**, not
private-land easements — no angling-easement note fires for this region.
Instead `openRiver`/`renderSheet` fires a North-Shore-specific note about
snowmelt-driven run timing, vehicle permits, the MN trout stamp, and the
Pigeon River / Grand Portage River's international/tribal jurisdiction. Zoom
gating for labels uses the same ≥10 threshold as the Driftless (`syncLabels()`
in `js/app.js`) since these streams are packed almost as tightly along the
shore.

**East-Central Minnesota / St. Croix (13).** 10 MN, 3 WI. Big warmwater
float rivers within roughly two hours of Forest Lake, MN — the St. Croix
(National Scenic Riverway), the Namekagon and Apple River (both St. Croix
tributaries), the Rum, Snake (MN's own, not the western one), Kettle, Crow,
Cannon and Sauk Rivers, the Mississippi's Twin Cities stretch, the
Minnesota River, Elk River, and Minnehaha Creek. Smallmouth, walleye,
musky, catfish, and a real Lake Superior-run sturgeon fishery on the St.
Croix — a completely different character from the Driftless/North Shore
trout water.

Deliberately **no new `region` tag** for this cluster: every one of the 13
is actively gauged (unlike Driftless/North Shore, where most streams
aren't), so the ungauged-card machinery, the angling-easement note, and the
North-Shore-style footer don't apply — these rivers behave exactly like the
original western ones (default 8-zoom label threshold, no special sheet
copy). Several — the St. Croix, Mississippi, Minnesota River, and Cannon —
are multi-gauge rivers with several USGS sites along their length, same
pattern as the Snake River through Jackson Hole.

Real low-head dams exist on this water (Coon Rapids Dam and the downtown
St. Anthony Falls locks on the Mississippi, the old Cannon Falls milldam
site) but there's no new UI mechanism for it — the hazard is called out
inline in that river's `blurb`/`RAMPS` note rather than a new per-region
flag, since only a few specific spots need it rather than the whole
cluster the way Central Iowa's low-head-dam note works.

**North-Central MN Lakes Country / WI Northwoods (16).** 5 MN, 11 WI. The
outer ring of the 5-hour radius: the Mississippi Headwaters (Itasca →
Bemidji → Grand Rapids → Aitkin → Brainerd → Royalton, where the Twin
Cities entry picks it up), the Crow Wing and Long Prairie, the Straight
River near Park Rapids, and Itasca County's Prairie River; then the
Wisconsin Northwoods — Chippewa, Flambeau and its South Fork, Red Cedar,
Jump, Wisconsin, Wolf, Black, Tomahawk, Bear, and the Prairie at Merrill.

Two things make this cluster different from the others:

- **Multi-gauge rivers are the norm, not the exception.** The Mississippi
  Headwaters carries 6 gauges, the Wisconsin 6, the Chippewa 5, the Wolf
  and Black 3 each. These rivers run 100–430 miles and a single number
  describes only the reach around its gauge — same pattern as the Snake
  through Jackson Hole, and the reason `primaryGauge` matters here.
- **Two genuine coldwater trout streams outside the trout regions.** The
  Straight River near Park Rapids and the Prairie River at Merrill are
  spring-fed brown/brook trout water sitting in the middle of musky and
  walleye country. They're `role:"wade"` and flagged wade-only despite
  being in an otherwise big-water cluster. Note there are *two* Straight
  Rivers in Minnesota — this is the Park Rapids one, not the Cannon
  tributary near Faribault.

Real whitewater exists here and is called out in `WADE_ONLY` and the
safety copy: the Wolf above Shawano is Class III–IV through the Menominee
Reservation (tribal permit required), and the South Fork Flambeau's Little
Falls and Slough Gundy are real drops. Like the East-Central cluster,
these are all actively gauged and carry no `region` tag.

## Status

**Finished / working:**
- Core app: Leaflet map, bottom sheet, live USGS flow fetch/render, the
  `statusOf()` relative-to-median status bucketing, home-screen install
  (`manifest.json` + icons).
- All 181 rivers in place (49 West, 7 Central Iowa, 72 Driftless, 24 North
  Shore, 13 East-Central MN/St. Croix, 16 Lakes Country/Northwoods), with
  gauges, ramps/access points, blurbs, and region-aware copy in the sheet.
- Ungauged-river handling: the "Ungauged" card, `nearestGaugedRiver()`
  regional-wetness fallback with the cross-state-line distance penalty —
  reused as-is for the North Shore, no code changes needed.
- Real NHD geometry upgrade (`trickleGeometry()`) and zoom-gated labels.
  The background snap runs a few requests in parallel and re-prioritises
  whatever is on screen on every map move, so the visible area resolves in
  a second or two. It used to be strictly serial with a 500 ms gap — about
  93 seconds to cover 181 rivers, long enough that the straight fallback
  lines looked like the finished map.
- `goodFlow` scaffolding, with starting-point ranges filled in for 28 of
  the original 56 West/Central Iowa rivers from public source reports.

**In progress / TODO:**
- Replace the 28 researched starting-point `goodFlow` ranges with your
  own experience-based numbers as you actually fish/float each river.
- Fill in `goodFlow` for the remaining West/Central Iowa rivers that are
  still `null`.
- All 72 Driftless rivers and all 24 North Shore rivers are `goodFlow:
  null` on purpose (see below) — decide per-river, as you fish them,
  whether a range is worth adding at all.
- North Shore and East-Central MN coordinates are approximate (gauge
  metadata plus source/mouth anchor points and reasonable interpolation,
  not hand-traced like the West rivers) — `trickleGeometry()` should snap
  most of them to real NHD linework on first load, but worth spot-checking
  a few against the map once you've actually driven to them.
- The 5-hour-from-Forest-Lake expansion is now essentially complete for
  the major named rivers. What's left is thinner: the Madison-area Dane
  County spring creeks that are arguably Driftless but weren't in the
  original 72, the Fox/Wolf lower system around Green Bay, and the far
  northern Wisconsin South Shore streams (Bad, White, Marengo, Brule
  tributaries) out past the Bois Brule. All are edge-of-radius and lower
  priority than filling in `goodFlow` on what's already here.

## Always / Never

- **Never** fabricate a flow number for an ungauged river — render the
  "Ungauged" card instead of guessing.
- **Never** add a stage-only or non-reporting USGS site into `GAUGES` — the
  status logic needs live discharge (CFS). This has already been decided
  for Rush Creek, Crooked Creek, Campbell Creek, and Root River above
  Rushford (stage-only) and Devil Track River (has a site number but isn't
  reporting live discharge); don't "fix" it by adding them.
- **Always** keep this a no-build, no-framework, hand-editable
  single-page app — don't introduce a bundler, framework, or backend.
- **Always** verify USGS gauge IDs against monitoring-locations metadata
  at runtime rather than trusting a hardcoded ID silently.

## Talking to the flow API (request budget)

`api.waterdata.usgs.gov` allows **1,000 requests/hour** anonymously and
answers `429 OVER_RATE_LIMIT` past that, with a `retry-after` that gets
*extended* by further probing — so when you hit it, stop and wait rather
than retrying.

One request per gauge blew through that budget the moment this map grew to
170 gauges: 170 latest-value calls plus 7 history calls each (~1,190) plus
170 metadata calls is roughly **1,530 per load**. That's the whole reason
the header used to read "flows unavailable".

Everything now asks for **many sites per request** — `monitoring_location_id`
takes a comma-separated list and each returned feature carries its own
`monitoring_location_id`, so one response demultiplexes back out per gauge.
Measured against a stubbed API, a full cold load is **67 requests instead of
~1,530**: 7 latest, 56 daily, 4 metadata. A steady-state refresh is 7.

- `fetchLatestBatch(keys)` — up to `MAX_SITES_LATEST` (50) sites per call.
- `fetchStatsBatch(keys)` — the loop is inverted versus the old code: one
  request per year-window per chunk of `MAX_SITES_DAILY` (30) sites, so
  7 × ceil(n/30) rather than 7 × n.
- `verifyGaugesBatch(keys)` — same idea against monitoring-locations.

**Ordered by region, nearest first.** `regionsByDistance()` sorts the five
buckets (`west`, `ciowa`, `driftless`, `northshore`, `uppermidwest`, from
`regionOfRiver()`) by distance from the map centre, and `paintFlows()` runs
after each one — so the water you're looking at colours in before the rest
of the country is fetched.

Two things to preserve if you touch this:

- **`batchSupported` is a safety net, not decoration.** If a multi-site
  response ever comes back covering one site only, the API has ignored the
  list and batching would silently blank most of the map — so it flips to
  one-site-at-a-time for the session. A 429 deliberately does *not* trip it;
  only a successful-but-narrow response does. (The multi-site syntax is
  verified working against the live API for latest-continuous, a 30-site
  batch, and the daily collection.)
- **`apiPaused()` is the circuit breaker.** A 429 sets `apiPausedUntil` and
  every batch function bails for `API_COOLDOWN_MS`, serving cached readings
  instead. This matters because retry-after *grows with each further
  request* — observed going 1217s → 3000s under probing, then falling back
  to ~205s once the breaker stopped the bleeding. Only
  `api.waterdata.usgs.gov` is gated; NHD and basemap tiles are separate
  hosts with their own budgets.
- **Don't write `stats[k] = null` when the breaker tripped.** `null` means
  "asked, genuinely no history" and is sticky for the session; leaving it
  `undefined` is what lets a later call retry after the cooldown.
- **An API key is optional but supported.** Get a free one at
  https://api.waterdata.usgs.gov/signup/ and set it with
  `localStorage.setItem("usgsApiKey", "<key>")`. It's appended as `api_key`
  automatically. The batched app fits inside the anonymous budget without
  one; the key just adds headroom.

## How flow status works

`statusOf()` in `js/app.js` compares the live CFS reading against the
7-year historical median for that week of the year (not a fixed number),
and buckets it:

- **Very low** — under 40% of median: skinny, slow, spooky fish.
- **Below average** — 40–75%: clear and technical.
- **Around average** — 75–125%: the "normal" window.
- **Above average** — 125–180%: fast, cold, likely off-color.
- **Very high** — over 180%: pushy water, experts/guides only.

This adapts automatically per river and per season, which is why it was kept
as the primary status system rather than fixed CFS thresholds.

## Good-flow ranges (per-river, optional)

Each river in `js/rivers-data.js` has a `goodFlow` field:

```js
goodFlow: {min:300, max:600}, // starting point from public guide reports (...) — adjust to your own experience
goodFlow: null, // TODO: set {min:___, max:___} (CFS) for YOUR good-flow range
```

When set, the flow card for that river's primary gauge shows an extra
"✓ In your good-flow range" / "Outside your good-flow range" badge, on top of
(not replacing) the relative status above.

28 of the original 56 rivers were pre-filled with starting-point ranges
pulled from public fly shop/guide/paddler reports (each has a short source
note in its comment, e.g. "sweet spot at the Glenwood gauge" or "Skunk River
Paddlers guidance"). These are generic numbers from other people, **not my
own experience** — treat them as a rough first draft and overwrite with your
own numbers as you fish or float each river through the season.

**All 72 Driftless rivers and all 24 North Shore rivers are `null`.** That's
on purpose, not an oversight: published CFS guidance barely exists for
streams this small, and on a creek running single-digit to low-double-digit
CFS a made-up range would be worse than none. On this water, **clarity is
the number that matters** — judge it on arrival. The ungauged card in the
UI says exactly this.

**All 29 East-Central MN/St. Croix and Lakes Country/Northwoods rivers are
also `null`**, for a simpler reason: no research pass has been done on
public guide/paddler reports for these two clusters yet, unlike the 28
West/Central Iowa rivers that got a starting-point pass. These are prime
candidates for that same treatment — smallmouth/walleye/paddling good-flow
ranges are genuinely published for water like the St. Croix, the Cannon,
the Lower Wisconsin Riverway and the Flambeau.

**TODO for me:** replace the researched starting points with my own
experience-based numbers over time, and fill in the rest for whichever
rivers I end up fishing most — starting with the Driftless creeks I actually
get to, where the 19 real gauges (Waterloo Creek, Bloody Run, Black Earth,
Silver Creek at Angelo, Stillwell, the Kinni) sit right on the water and so
are worth calibrating first.

## Conventions

- No frameworks, no build tooling — keep it editable by hand.
- The default basemap is **USGS "US Topo"** (`basemap.nationalmap.gov`,
  service `USGSTopo`) — the same quadrangle cartography as the paper
  sheets: cream ground, blue hydrography in italic serif, green public
  land, tan contours, PLSS section grid. It was picked over satellite
  imagery because it shows the things that actually decide a trip —
  public land boundaries, the access two-track, the contour of the
  valley. Its cached tiles stop at z16, so the layer sets
  `maxNativeZoom:16` with `maxZoom:20`; without that Leaflet refuses to
  zoom past 16 instead of upscaling. Imagery layers (Google, Esri, USGS
  Imagery+Topo) are still available in the layer control.
- **Map layers and marker density.** Markers live in toggleable
  `L.layerGroup`s wired into the layer control: *Wade access & parking* and
  *USGS gauges* on by default, *Boat ramps* off, *Public hunting / fishing
  land* on. Dropping ~280 access pins at every zoom made the map unreadable,
  so `syncMarkers()` also zoom-gates membership — boat ramps from z8, wade
  access from z9 — independently of whether the group is switched on. On a
  Driftless creek "access" means a signed gravel pull-off, not a ramp, which
  is why wade access is the one that defaults on. Zooming to a float section
  switches boat ramps on, since that's an explicit "show me the ramps" move.
- **Public land** is PAD-US (USGS Protected Areas Database) via its
  `PADUS_Public_Access` FeatureServer — state Wildlife Management Areas,
  Aquatic Management Areas (public fishing water by definition), state
  forests, county parks. Drawn from z10 and fetched per-viewport, because the
  whole five-state set is far too big to ship. Only `Pub_Access` OA (open)
  and RA (restricted) are drawn; closed and unknown parcels are deliberately
  left off — a closed parcel shaded green is worse than no parcel at all.
  Boundaries are approximate and the popup says so.
- USGS gauge IDs are verified at runtime against USGS monitoring-locations
  metadata; unresolved ones show "(unverified)" in the UI rather than failing
  silently.
- River geometry is simplified hand-digitized polylines — not
  navigation-grade. `trickleGeometry()` upgrades to real NHD linework after
  first paint, matching on GNIS name within each river's bounding box. When
  a display name doesn't match the GNIS name, add an override to
  `NHD_KEYWORD` in `js/app.js` (e.g. Iowa's creek is GNIS "Trout Run", not
  "Trout Run Creek"; Richmond Springs feeds the Maquoketa River).
- Labels are zoom-gated in `syncLabels()`: zoom ≥ 8 for the western rivers,
  ≥ 10 for Driftless and North Shore ones, because those creeks sit almost
  on top of each other and dozens of labels at regional zoom is soup.
- Adding a new region means touching five things: the `region` field on the
  rivers, the state-name map and `regBody` in `openRiver`/`renderSheet`, the
  `REGIONS` quick-jump list, and the legend/safety copy in `index.html`.
