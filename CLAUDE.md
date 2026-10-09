# DeLanoit's Fly Routes — ID, WY, Iowa, Minnesota & Wisconsin

A single-page, no-build, mobile-first web app: a Leaflet map of Idaho &
Wyoming trout rivers, the Central Iowa (Des Moines area) state water
trail system, the trout streams of the Driftless Area, the steelhead/
trout tributaries of Minnesota's North Shore of Lake Superior, the
big warmwater float rivers of east-central Minnesota and the St. Croix
valley, the north-central Minnesota lakes country and Wisconsin
Northwoods, the trout creeks of the Door Peninsula, and the waters of
Yellowstone and Grand Teton National Parks, and the Teton Valley and Swan
Valley drainages in eastern Idaho, with live USGS flow conditions, built for
checking "is it worth driving out today?" from a phone.

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

  **`coords` takes two shapes.** Either a flat `[[lat,lng],…]` list, or —
  for a river whose channel comes back from NHD in disconnected pieces — a
  list of those, one per piece. Leaflet draws both. Anything that isn't the
  polyline itself must go through `flatCoords()` / `midCoord()` in
  `js/app.js`; don't index `r.coords[0]` directly. Segments are kept apart
  on purpose: welding them draws a channel across a gap that isn't there.
- `js/tiers.js` — **river classes.** `TIERS` ranks every river Gold / "1" /
  "2" / "3"; a river not listed is Class 3, and Class 3 is **hidden by
  default** (off the map entirely, not dimmed, so it also costs no labels,
  flow animation or geometry fetches — `riverVisible()` starts with
  `tierShown()`). The scale is **relative to the region**: the West has more
  Gold because it has more blue-ribbon water, and the Driftless list is a
  labelled draft to be overruled from experience. Optional `season` windows
  (`best` / `poor` / `closed`, months, may wrap the year) move a river one
  class up or down, or to Class 3 when closed — `tierOf(r, date)`. It is a
  window table, not a forecast; live CFS status still comes from the gauge
  and is deliberately not mixed into the class. The filter is four empty
  layer groups (layer control checkboxes + the "River Filters" menu). It is
  **not persisted**: every launch starts at Gold + 1 + 2 (owner's decision,
  2026-10-09). Opening a hidden river (gauge tap)
  shows it for the session (`tempShown`). Park zone cards count *visible*
  rivers ("14 of 208") via `refreshZoneCounts()`. Yellowstone's 166 `minor`
  creeks are never listed, so they are Class 3.
- `js/zones.js` — the opening zone chooser, plus the region labels.

  **Zones are states.** Fishing regulations are written by states, and the
  state line is the one border that actually changes what you may do, so it
  is the border the chooser draws. **Ten states, sixteen parks.** Six states
  carry rivers (ID, WY, IA, MN, WI, IL). **CA, OR, WA and MT are drawn as
  states with no rivers of their own yet**, but ten of their fourteen national
  parks now carry their fishing water — see *Western national parks* below.
  The four that don't (Joshua Tree, Death Valley, Pinnacles, Channel Islands)
  stay as zones reading "not mapped yet", on purpose. Montana had been skipped
  on the grounds that its only river, Specimen Creek, belongs to Yellowstone;
  it is now drawn because Glacier is in it.

  The fourteen added parks are Olympic, Mount Rainier, North Cascades,
  Crater Lake, Glacier, Redwood, Lassen Volcanic, Yosemite, Kings Canyon,
  Sequoia, Pinnacles, Death Valley, Joshua Tree and Channel Islands. Four of
  those have no fishable water to speak of (Joshua Tree, Death Valley,
  Pinnacles, Channel Islands) and say so in their `sub` line rather than
  implying a fishery — they are on the map because they are national parks
  in those states, not because they are destinations.

  A zone with no rivers takes its `bounds` from its own outline, since the
  usual rule — bounds come from the zone's *rivers*, so tapping flies to the
  water — has nothing to work with yet.

  **National parks keep their own NPS boundary** and are drawn *on top of*
  the state they sit in — states first, parks last, so the park takes the
  tap. They overlap on purpose: a park is inside a state, and Yellowstone
  spans three of them while answering to none. That is a deliberate change
  from the old strict partition. A park also wins the rivers inside it, so
  Wyoming reads 18 rather than 79.

  **This replaced a Voronoi tiling of river clusters** (kept in the
  scratchpad as `zones2_voronoi.py.bak`). The tiling gave every region a
  neighbour and shared borders, but the borders were *invented*: a bisector
  halfway between two river clusters means nothing to an angler, while a
  state line means the licence in your pocket. Everything that made the
  tiling work — cluster hulls, `REACH_KM`, the Voronoi clip, the
  state-line-first ordering, the park carve-out — went with it.

  **`REGION_LABELS` are the named places that cross state lines.** The
  Driftless is one landscape over four states and four rulebooks, so it
  cannot be a zone when the zones are the rulebooks — but it is a real place
  and worth naming. It and the North Shore, Door Peninsula, Teton Valley,
  Swan Valley and the Central Iowa water trails render as quiet map labels
  between zoom 6 and 11 (`REGION_LABEL_ZOOM` in `app.js`): no box, no
  shadow, `interactive:false`, nothing to tap. They are hidden while the
  chooser is up and again by zoom 12, where the name of a region tells you
  nothing you don't already know.

  State outlines are simplified to **0.6 km**, chosen against how they are
  actually seen: the chooser lives at zoom 4–5 where a pixel is 2.4–4.9 km,
  and it is hidden the moment you enter a zone. At 0.12 km the state rings
  alone were 160 KB of JavaScript for detail nobody can see on a phone.

  **States draw without a card.** A name and a river count stamped on each
  of six outlines is a lot of furniture over a map whose only job at this
  zoom is "which part of the country", and a state's shape is already the
  most legible label it could have. The name comes up on hover and the fill
  lifts under the cursor — `buildZones()` binds the tooltip to the polygon
  and pushes `{marker:null}`, so `layoutZoneCards()` skips them. **Parks
  keep their card**: an NPS boundary is not a shape anyone reads at a
  glance, and Grand Teton is a narrow strip inside Wyoming that would
  otherwise look like an unexplained gap in the fill.

  **The park cards wear a crest, and it is deliberately not the real one.**
  `parkCrest()` in `app.js` draws an arrowhead badge — the silhouette is
  what reads as "national park" at 19 pixels, long before the name is
  legible. It is *not* the National Park Service arrowhead: that emblem is
  restricted federal insignia, and stamping it on a personal map borrows an
  authority this app doesn't have. Same outline, original composition
  (ridge, conifer, water), drawn in the browns already on the park zone
  outline.

  Two things about it that came from looking at it rendered, not from
  writing it: the conifer carries a **field-coloured outline**, because
  cream on cream merged it into the ridge behind and the badge read as one
  pale blob; and it is all **solid fills**, because at 19px tall one SVG
  unit is under half a pixel and a hairline stroke renders as grey mush.
  The card is a flex **row** so the badge doesn't make it taller —
  `layoutZoneCards()` measures the card, and a taller one reserves more
  space and drops out of tight zones sooner.

  `bounds` comes from the zone's **rivers**, not its outline, so tapping
  Idaho flies to the water rather than to the whole state. `rings[0]` is the
  outer boundary and any further rings are holes.

  **`parts` is how a zone in genuine pieces is drawn.** It holds additional
  *detached* polygons, each shaped like `rings` (outer first, then its
  holes). Leaflet reads a list of ring-lists as a multipolygon, so a zone
  with `parts` is still **one layer — one hover, one tap, one zone**. This
  was needed the moment the chooser left the Rockies: Channel Islands *is*
  five islands, Olympic is the massif plus a detached coastal strip, North
  Cascades and Kings Canyon are each two units. Before `parts`, a second
  polygon could only have been expressed as a hole, so the first build drew
  one of the five Channel Islands and silently dropped the rest.

  Pieces are kept when they are worth at least **2% of the main one** and
  dropped below that. Olympic alone has 285 slivers under the threshold —
  drawing them is kilobytes of noise at a zoom where the whole park is a
  centimetre across. `short` is the name used
  when a zone is too small at the current zoom to carry the full one.
  `count` is rivers mapped there, and 0 renders as "not mapped yet".
  Regenerate with `zones2.py` in the scratchpad.

- `js/app.js` — fetch/render/status logic. Talks directly to the USGS OGC API
  (`api.waterdata.usgs.gov`) client-side — no backend, no API key.
- `manifest.json` + `icons/` — home-screen install support.
- No build step, no framework, no bundler. Edit and reload.

## Rivers covered

1,095 rivers and 31 lakes. Full list and gauge IDs live in `js/rivers-data.js`; this file
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

### Des Moines pilot: DNR access, gauges and dams (2026-10-07)
Pilot Central water. `raccoon` and `beavercreek` are now Class 2, so they
show by default.
- **Ramps come from the Iowa DNR's Paddling Access Sites**
  (`programs.iowadnr.gov/geospatial/…/Recreation/Recreation/MapServer`
  layer 4). The layer has **no river field**, so a site is matched by
  distance (≤300 m) to the drawn line. Boat ramps and paddling accesses
  are role `both`; fishing accesses are `wade`. They carry `src`, and the
  ramp popup now shows it. Script: `~/.cache/flyfish-osm/iowa/apply.py`
  (fence "central iowa dnr access"). **The server 403s Python's default
  User-Agent**, so send one.
- **Four hand pins were 0.65–5 km off the water** (Cottonwood, Yellow
  Banks, Walnut Woods, Lew Clarkson). They were moved onto the same-named
  agency site, keeping their ids. The old positions are in the build
  report.
- **Beaver Creek has no DNR site.** Its two accesses are OSM slipways.
- **Gauges:** added Raccoon at 63rd St (05484650, now the primary) and at
  Fleur Drive (05484900). **Walnut Woods (05484600) stopped reporting on
  2026-09-15**, and the app showed its last 1,320 CFS as today's level
  while the river ran about 8,700. That is why a reading older than 24 h
  now reads "Not reporting".
- **Low-head dams:** 25 records from the DNR's Paddling Hazards (Dams)
  layer are in `data/hazards/`, built by
  `~/.cache/flyfish-osm/hazards/iowa_dams.py`, which `build.py` calls at
  the end. The popup gives the portage side and the source. Heights are
  in feet, inferred because the layer states no unit.
- **Open:**
  - `riverwalk` ("Principal Riverwalk / Water Works Park") is still
    1.64 km off the Des Moines line and could be any of three DNR sites.
  - `rc2`'s stated 14 mi measures 17.6 along the line.
  - The North Raccoon's `booneville` pin sits ~25 km from the real
    Booneville Access, which is on the Raccoon.

### Northeast Iowa comes from the Iowa DNR, not NHD

The NE Iowa trout streams were rebuilt from the **Iowa DNR Fishing Atlas**
(`programs.iowadnr.gov/geospatial/…/Recreation/fishing/MapServer` layer 4,
"Trout Streams"). 65 streams, up from 20 — the app was missing about
two thirds of the designated trout water in those counties. 76 since the
Trout Stream Search pass below.

Use the DNR layer rather than NHD for this region, for three reasons:

- **NHD doesn't know which water you may fish.** The DNR layer draws the
  reach that is actually *designated trout water*; NHD draws the whole
  creek regardless.
- **NHD can't tell these creeks apart.** A plain `BEAR CREEK` lookup in
  these counties can match any of four — the DNR disambiguates them by
  county (Bear Creek, Bear Creek (Allamakee), (Clayton), (Fayette), plus
  North, South and Middle Bear).
- **It carries the regulations.** `TYPE` is the DNR's own three-way
  regulation class, and `SR_INFO` is the special-regulation wording.

So rivers sourced this way carry `geom:"iadnr"` (Door County's carry
`geom:"widnr"`), and **`loadRealRiver()` refuses to snap any river with a
`geom` tag to NHD** — state fisheries geometry outranks NHD here.
Don't remove that guard; without it the background sweep quietly replaces
the designated reach with the wrong Bear Creek.

Each carries `troutClass` (`restrictive` / `wild` / `stocked`), `wildTrout`
(species actually present) and, where there are special regulations,
`troutRegs` — reproduced **verbatim**, because on a catch-and-release or
artificial-only stretch the exact wording is what keeps you legal. The line
colour is driven by `troutClass` via `riverColor()` rather than the river's
own hue: on trout water the rules matter more than telling two neighbouring
creeks apart. Rivers with no `troutClass` keep their own colour.

Two corrections that came out of this, both of which the app previously had
wrong: **South Bear Creek** ran to the wrong ground entirely and stopped
short of its confluence — South Bear and North Bear join and continue as
**Bear Creek**, which was missing outright. And **Spring Branch Creek** is
in Delaware County near Manchester (a restrictive-regulation stream), not
near Elkader as its blurb claimed. **Village Creek** is kept but is *not*
on the DNR's designated trout list, and now says so rather than implying
trout water.

### Trout Stream Search pass (2026-10-08)
Every NE Iowa trout stream now answers to the DNR's **Trout Stream Search**
(`programs.iowadnr.gov/lakemanagement/FishIowa/TroutStreamDetails/<CODE>`),
whose page code is the trout layer's `lakeCode`. Pipeline in
`~/.cache/flyfish-osm/iowa/`. Run order: `dnr_trout.py [--refetch]`, then
(only if it reports changed geometry) `../flowdir.py --epqs --only <ids>`
and `dnr_trout.py` again, then `driftless_parking.py`, then
`../encode_coords.py`. A second run is byte-identical. Fetches are cached in
`dnr_trout/`, and contact names, phones and emails are never parsed.
- **`dnrCode`** on each river was matched by *geometry*, never by name. One
  code can sit on two app rivers: TSB96 is `southbear` and `iaBearCreek`.
- **Geometry** is the code's layer-4 features as pieces: Douglas-Peucker
  at 10 m, welded only between same-class ends ≤30 m apart. The old lines
  were 70 evenly spaced vertices, up to ~200 m off.
- **`reachClass`** holds one class per piece. `troutClass` is the class
  with the most length. `reachOverlays()` in app.js draws only the pieces
  that differ from it, on top of the line, and `applyFilters()` hides,
  greys and re-raises them with it. 10 rivers mix classes.
- **`troutRegs`** is per reach, with each SR_INFO verbatim and labelled.
  The page's own trout lines follow where they differ from the statewide
  rule. Rules-card tags gain "· part of stream" on mixed rivers.
- **Blurbs** are rewritten from the page's facts (location, miles,
  stocking, survey counts, private-land and camping notes) and dated to the
  page's "last updated". The old texts are in `iowa/old_blurbs.json`.
  `upperiowa` and `volgariver` kept theirs plus one DNR sentence.
  `villagecreek` is not on the DNR list and is untouched.
- **11 streams added** (`ia_*`, fence "ne iowa dnr trout streams", Class 2
  in tiers.js, Iowa zone count 72 → 83). That includes McLoud Run (Cedar
  Rapids) and three Mitchell County streams, which are tagged `driftless`
  though they sit outside it. 15 DNR pages have no layer-4 line and aren't
  drawn. The list is in `dnr_trout.log`.
- **Page "Coordinates" are not authoritative.** Hickory Creek's is 26.8 km
  from its stream. The page's location sentence and the layer-4 line agree,
  so the line wins.

**Access points** (`driftless_parking.py`, fence "ne iowa dnr parking"):
every Fishing Atlas amenity (layer 3) within 300 m of the nearest Driftless
IA line. Parking and Fishing Access become `wade` pins, and boat ramps
become `both`. Parking pins carry `kind:"parking"` and draw a **P** instead
of the fish.
- **Use the feature geometry, not the `lat`/`long` attributes**, which are
  sometimes 0 and sometimes ~100 m off.
- A hand pin within 300 m of a DNR point is moved onto it (watcr1, nbear1,
  uibluff, bloody1). Ones over 2 km from their line were deleted (sbear1/2,
  trupper, coldw1, canoe1, french1, clearia1, snymag1, bigspr1, grannis1).
- `KEEP_FAR` keeps turkey1/turkey2: the drawn `turkeyriver` is the DNR's
  1-mile hatchery reach, but the entry describes the mainstem.
- Flagged, not moved: paint2, yellow1, otteria1, backbone1 (1–1.6 km off).

**Driftless (128).** 76 IA (see above), 21 MN, 30 WI, 1 IL. Spring-fed limestone trout
streams across the unglaciated region: the Upper Iowa and the Allamakee /
Clayton county creeks, the Root River system and the Whitewater in SE
Minnesota, Vernon County's coulees and the Kickapoo watershed, the Grant
County spring creeks, the Dane County limestone streams, and the
Kinnickinnic / Rush / Trimbelle cluster up in Pierce County.

Only 19 Driftless rivers have a USGS gauge — almost none of the NE Iowa creeks do. That's the
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

Two stay hand-drawn because NHD has no flowline under that name at that
location (Coldwater Creek, IA, once a third, is now the DNR's line):
**Spring Coulee Creek** and
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

## Door Peninsula

**Door Peninsula (10).** All Wisconsin, all Door County. Eight classified
trout streams — Hibbards, Heins, Whitefish Bay, Logan, Lilly Bay, Ephraim,
Hidden Springs and Keyes — plus the **Ahnapee River** (Forestville Flowage
down to Lake Michigan at Algoma) and the **Mink River**, the spring-fed
estuary at Rowleys Bay.

Sourced from the **Wisconsin DNR**, not NHD, for the same reasons northeast
Iowa is:

- Geometry for the eight is the DNR's *classified trout water* line
  (`WY_FISHERIES_WATERS` layer 9, "Trout Stream Lines") — the reach that is
  actually trout water under trout regulations, not the whole drainage.
  They carry `geom:"widnr"` and `loadRealRiver()` refuses to snap them to
  NHD, exactly like `iadnr`.
- `TROUT_CLASS_CODE` gives the Class I/II classification, and
  `FM_TROUT_REGS` gives the regulation category and its wording, reproduced
  verbatim in `troutRegs`.
- The Ahnapee and the Mink are *not* classified trout water, so they use
  NHD linework and carry no class. They still carry a `geom` tag
  (`geom:"nhd"`) to stop the runtime snap from overwriting them: NHD hands
  back the Ahnapee in seven pieces, because the named flowline stops at each
  millpond, and the baked coords are those pieces chained in downstream
  order. A fresh snap would draw the gaps back in.

**Wisconsin's classes are kept separate from Iowa's, deliberately.** Iowa's
`restrictive` / `wild` / `stocked` is a *regulation* class (what you may
do); Wisconsin's Class I/II/III is a *biological* classification (whether
the trout reproduce there). Folding them together would label a Wisconsin
stream with an Iowa rule it isn't under, so `TROUT_CLASS` carries `wi1` and
`wi2` with Wisconsin's own wording, and `troutSource` picks which agency the
sheet footer credits. The colours are a family — teal means wild fish either
way — but nothing else is shared.

**Every one of these is ungauged, and there is no proxy.** There is not one
USGS discharge gauge in Door County. The dozen USGS site numbers on these
creeks are water-quality sampling points from the peninsula's groundwater
work, not gauges — don't add them. `nearestGaugedRiver()` stays inside a
region and so returns nothing here, which is correct: the closest gauged
water is 60+ miles away in a different watershed. The ungauged card says so
in as many words rather than leaving a card that looks like a failed load,
and the status badge is suppressed the same way it is on Driftless water.

**Almost all of it is Great Lakes tributary water** — a 10" minimum, a
hook-gap limit, and a night-fishing closure from September 15. Logan Creek
is the single exception, carried under ordinary inland trout regulations,
which is also the tell that it fishes as a resident stream rather than a
run. That distinction is worth preserving if this region is ever rebuilt.

**No `RAMPS` entries, on purpose.** The WDNR has no trout habitat sites and
no angling easements in Door County — access here is county park, state park
and land-trust ground, which PAD-US already shades on the map. Rather than
invent access pins from guesswork, there are none; add them from your own
knowledge of where you actually park.

**Left out and why:** Silver, Threemile, Casco, Scarboro and Little Scarboro
Creeks are classified trout water but sit in **Kewaunee** County, not Door.
Stony, Bear, Fish and Shivering Sands Creeks are in Door County but carry no
trout classification and no designated fishery, so they'd be lines on a map
with nothing to say.

## Yellowstone National Park

**Yellowstone (42).** Every named river inside the park — Yellowstone,
Madison, Firehole, Gibbon, Lamar, Gardner, Lewis, Snake, Bechler, Falls,
Heart, Gallatin, Little Firehole, Little Lamar — plus the creeks that carry
a recognised fishery: Slough, Soda Butte, Pebble, Cache, Miller, Tower,
Hellroaring, Blacktail Deer, Lava, Indian, Obsidian, Panther, Nez Perce,
Solfatara, Grayling, Duck, Cougar, Gneiss, Fan, Specimen, Pelican, Clear,
Cub, Beaverdam, Thorofare, Boundary, Mountain Ash and De Lacy.

**Plus the other 166.** Every named stream with at least 2 km inside the
boundary is now on the map — 208 in total. The park's own rule is that water
not listed by name in the regulations is open under general regulations, so
"fishable" here means *named, inside the boundary, and not closed*.

The 166 are deliberately a different kind of entry from the 42:

- They carry **only what can be stated as fact** — where the water is, how
  much of it is inside the park, what it is nearest to, and the park-wide
  rules. Their `fish` note says plainly that there is no published account
  of the water to repeat and none is invented. A creek nobody has written
  about does not get prose pretending otherwise.
- `minor:true` holds their labels back until **zoom 12**. Two hundred labels
  over the park is not a map; at zoom 9 you still see only the 42.
- Their geometry is **baked coarse (80 m)** on purpose. The zoom refinement
  sharpens whatever you actually look at, and 166 creeks at full resolution
  is a quarter of a megabyte of JavaScript for detail you only ever see one
  creek at a time.

Fetching them taught one thing worth keeping: **page the sweep to disk, not
to memory.** The first attempt held 3,000 features, failed on the fourth
page and wrote nothing — against a service that was taking 20+ seconds a
request, that is an hour thrown away. It now saves each page as it lands and
resumes from what is already there.

### The park boundary is the data model

Geometry is NHD linework **clipped to the real NPS boundary** (7,236 points,
not a thinned stand-in), because the boundary is the entire reason this is
its own region: the regulations start and stop at that line. Reaches inside
the big lakes are cut out too — a river's course across Yellowstone Lake or
Lewis Lake is real, but it is not river fishing and is under different
rules, so **a gap in a park river is a lake**.

Every entry carries `geom:"nhd"` so the runtime snap can't overwrite the
clip with the unclipped river.

Three traps, all of which cost real time here:

- **Don't page a spatial query without an ORDER BY.** A paged whole-park
  fetch (2,000 at a time, spatial filter, no ordering) silently dropped the
  Yellowstone and Madison Rivers *entirely* and returned a 4 km Slough
  Creek. Fetch per name instead; it is slower and it is right.
- **Don't filter NHD flowlines to `FTYPE=460`.** The Yellowstone and the
  Madison are wide enough to be mapped as river *areas*, so every flowline
  on them is an ArtificialPath (558) and a 460 filter returns literally
  zero features for the park's two most important rivers. Query without the
  filter and remove the lakes instead.
- **Don't chain runs across big gaps here.** The Ahnapee needed that (its
  gaps are millponds); in Yellowstone the gaps are the boundary and the
  lakes, and chaining stitched separate braids of the same-named creek into
  a line that zigzagged between them. The gap tolerance is 350 m.

### Closed water is drawn, not described

`CLOSURES` in `js/rivers-data.js` holds the seven reaches Yellowstone shuts
**all year**, as geometry. The park states them by landmark — "Fishing
Bridge and an area one mile downstream" — which is unusable standing in a
pullout, so each one is drawn on the channel: Fishing Bridge, LeHardys
Rapids, Hayden Valley, the Grand Canyon, lower Pelican Creek, and the two
Firehole closures at Old Faithful and the Midway footbridge.

Every endpoint is a **located point**, never an estimate: USGS monitoring
stations for Fishing Bridge and Old Faithful, the USGS gazetteer for
LeHardys Rapids, Sulphur Caldron, Silver Cord Cascade, the Upper Falls and
the geyser basins, Alum Creek's own geometry for its confluence, and the
Yellowstone Lake ring for Pelican Creek's mouth. `closures.py` in the
scratchpad rebuilds them and **prints each reach's length against the
regulation's own wording** — that check is the safeguard, and all seven
match (LeHardys 0.18 km for "100 yards either side", Pelican 3.22 km for
"two miles", Fishing Bridge 2.01 km for "a mile down and a quarter up").

Three traps, all of which produced a wrong-length closure first:

- **"Between two landmarks" is a path, not a slice.** The drawn Yellowstone
  is 28 pieces — NHD splits at every confluence, then this map clips to the
  boundary and cuts the lakes out. Taking the longest piece put every
  landmark 30–50 km from the channel. The builder welds pieces whose ends
  touch and walks the network.
- **Vertices are 300–440 m apart, wider than some closures.** A 100-yard
  radius measured vertex-to-vertex can only ever return the two vertices
  either side of the landmark, which is how LeHardys first came out 60 m
  long. Everything is cut at an **interpolated** position along the segment.
- **A piece's own orientation is not reliable.** Piece 26 has its downstream
  link off its *head*, so a walk trusting `FLOW_REV` went into the lake and
  Fishing Bridge came out 0.85 km of 2 km. Direction for the asymmetric
  closures is asked of the **lake ring** instead — away from the lake is
  downstream, which is true by construction at an outlet.

`WELD_KM` is 0.5, not the 0.35 the fetch used: the baked channel has holes a
few hundred metres wide below the lake outlet. It only decides what is
*connected* — `coords` stays a **list of pieces**, so a closure is never
drawn across a hole, a boundary or a lake.

**Seasonal closures are deliberately not in `CLOSURES`.** Those are dates,
not places, and they live in each river's `parkRegs` where they can say
when. Three described closures are also left off because nothing in the
data locates them — the Madison's 250 yards above Seven Mile Bridge, Trout
Lake's inlet, and the Yellowstone Lake shoreline from West Thumb Geyser
Basin to Little Thumb Creek. A guessed line on real water is worse than no
line.

Rendered as **hazard tape over the river**, not as a colour change on it: a
closed reach has to read as closed on top of the flow animation, and
recolouring would collide with the trout-class colours. Red is used nowhere
else on this map. `closurePane` is z418, above the rivers and the current;
zoom-gated at 9 like the park labels, and toggleable in the layer control.

### Regulations are the point, and they are sourced

`parkRegs` on each river comes from the **National Park Service's 2026
Yellowstone fishing regulations** — the park's own PDF, read directly — not
from recollection. That is where the regional boundaries, the permanently
closed reaches, the May 1 / July 1 / July 15 openers, the fly-fishing-only
water and the mandatory-kill rules come from. Some of it is genuinely
surprising and none of it is guessable:

- The **Firehole, Madison and lower Gibbon** are fly-fishing-only, open
  May 1, and are a *Nonnative Trout Tolerance Area* — keep five brook trout,
  release all rainbows and browns, and whitefish are native here.
- The **Yellowstone below the lake opens July 1**, and Fishing Bridge,
  LeHardys Rapids, Hayden Valley above Alum Creek and the Grand Canyon reach
  are permanently closed.
- **Yellowstone Lake tributaries open July 15**, and Pelican Creek is closed
  for its first two miles.
- In the **Lamar drainage** every rainbow, brook trout and cutthroat ×
  rainbow hybrid **must be killed** — releasing one alive is illegal. The
  same rule reaches the Yellowstone's north-side tributaries between the
  Lower Falls and Knowles Falls, which is why Tower, Hellroaring and
  Blacktail Deer Creek carry it and Lava Creek does not.
- The **Gardner below Osprey Falls** and the **Madison below the state
  line** are the only two reaches open year-round.

`renderSheet` credits **the National Park Service** rather than a state
agency for this region, because a Wyoming or Montana licence is not valid in
the park and pointing a reader at Game & Fish would be actively wrong.

### Lakes

Nine still waters: **Yellowstone, Shoshone, Lewis, Heart, Grebe, Ice, Wolf
and Trout Lakes, plus Blacktail Pond** — outlines from NHD waterbodies,
carried in `LAKES` in `rivers-data.js`.

**Which lakes is a sourced question, not a judgement call.** The park has
about 150 lakes and its own literature says **more than 40% of its waters
were historically barren of fish**, so "every lake" and "every fishable
lake" are very different lists. These nine are the ones Yellowstone's
fishing regulations name — which is the only source here that actually
distinguishes them — and each entry's `regs` is quoted from that document.
If you know others that fish, they are a one-line addition; I wasn't willing
to assert a fishery from a lake's presence on a map.

**Still water is marked as still water.** Lakes draw in their own pane
*under* the river lines, so an inlet or outlet still reads on top of the
water it runs into, and they carry a slow **shimmer** — the outline breathes
— rather than the rivers' directional drift. A lake has no direction to
point, and animating one as though it did would be the same mistake as
running a river's current backwards. The sheet says so too: no gauge, no CFS,
because ice-off, temperature and wind are what decide the day.

Labels appear by size — the big lakes from zoom 8, ponds not until 12 — so
Yellowstone Lake is named at the scale you can see it and Blacktail Pond
isn't shouting from three valleys away.

### Gauges

Nine live-discharge stations cover the park, verified against
latest-continuous on 2026-09-28: the Yellowstone at the lake outlet and at
Corwin Springs, the Madison and Firehole near West Yellowstone, the Firehole
at Old Faithful, the Gibbon at Madison Junction, the Lamar near Tower, Soda
Butte at the park boundary, and the Gardner near Mammoth. Everything else is
ungauged backcountry.

**Don't add the rest of the park's USGS site numbers.** There are ~185
stream sites inside the boundary and almost all of them are research and
water-quality sampling points from the park's thermal and nutrient work —
Tantalus Creek, supply springs, hot-spring outflows. Several look like
gauges and report nothing since the 1990s (Gibbon nr West Yellowstone last
reported in 1996, Blacktail Deer in 1993, Boundary Creek in 2004).

`nearestGaugedRiver()` works well here for once: it stays inside the region,
and on this plateau a neighbouring drainage genuinely tracks an ungauged
creek — Slough Creek gets Soda Butte, which is the right answer.

## Grand Teton National Park

**Grand Teton (17, plus three it shares with Jackson Hole).** Pacific,
Cottonwood, Ditch, Spread, Lake, Christian, Cascade, Taggart, Granite,
Leigh, Pilgrim, Arizona, Lizard, Moran, Berry, Owl and Moose Creeks, clipped
to the NPS boundary the same way Yellowstone's are.

**The Snake, the Buffalo Fork and the Gros Ventre are not duplicated.** Each
was already mapped as a Jackson Hole river and each runs far beyond the
park, so they carry a `parkRegs` note about the park reach instead of a
second entry. They are also the three that the zone builder already assigned
to the park, which is why the Grand Teton zone reads 20 rivers and not 17.

### Grand Teton is the opposite of Yellowstone, and that is the point

- **A Wyoming licence, not a park permit.** Grand Teton is fished under
  Wyoming state regulations. Yellowstone issues its own permit and a state
  licence is void there. `renderSheet` credits a different authority for
  each, and the `parkRegs` block carries a different badge and footer per
  source — `parkRegsSrc` (`"grte"` / `"yell"`), because the three Jackson
  Hole rivers carry a Grand Teton note without being in that region.
  Crediting the wrong agency would send someone to the wrong counter.
- **Most park streams are closed December 1 – July 31**, so the season on
  this water opens **August 1**. The park names five exceptions — the Snake,
  Buffalo Fork, Pacific Creek, Gros Ventre and Polecat Creek — which are
  also the only streams exempt from the **artificial flies or lures only**
  rule. Stream creel is three trout, no more than one over sixteen inches.
  All of that comes from the NPS Grand Teton fishing page, not recollection.

### The park is much smaller than it looks east of the Snake

Measured against the real boundary: **only ~9 km of Pacific Creek, ~8 km of
Spread Creek and ~6 km of the Gros Ventre are inside the park** — the rest of
each is Bridger-Teton forest. Worth knowing before assuming a Teton-country
creek is under park rules.

### Gauges, and the gap between the parks

Three live-discharge stations bear on this water: **Pacific Creek at Moran**,
**Granite Creek near Moose**, and **the Snake above Jackson Lake at Flagg
Ranch**. Spread, Cottonwood, Ditch, Taggart, Pilgrim and Lake Creek all have
USGS site numbers and **none has reported since the 1990s or 2010** — don't
add them.

The Flagg Ranch gauge turned up a genuine hole in the map: the Snake between
Yellowstone's south boundary and Jackson Lake, through the **John D.
Rockefeller, Jr. Memorial Parkway**, sat between this map's Yellowstone
headwaters reach and its Jackson Hole one and was covered by neither. It is
now `snakeflagg`. The Parkway is a separate NPS unit and is deliberately
**not** in the park zone: zone `rings[1..]` are holes, not separate polygons,
so a disjoint second ring would have rendered as a hole punched in the park.
(`parts` would express it now — see `js/zones.js` above — but the decision
stands on its own: the Parkway is a separate NPS unit under its own rules.)
It falls in the Wyoming zone, which is correct — it is outside both parks.
Polecat Creek is in the Parkway for the same reason and is left off.

## Jackson-area streams from Wyoming Game & Fish (2026-10-07)

**31 streams, Soda Lake, and seven Grand Teton creeks drawn past the park
boundary**, all from WGFD's own data. Pipeline: `~/.cache/flyfish-osm/wy/`
(`specs.py` holds the list, each decision and the verbatim rules; `apply.py`
gives the run order). Fenced in the data files as "wyoming wgfd streams".

- **Which water: WGFD's Fishing Guide map**
  (`services6.arcgis.com/cWzdqIyxbijuhPLw/…/Streams_FishingGuide_PublicView`).
  Every Area 1 (Snake drainage) stream near Jackson that WGFD rates
  **Yellow Ribbon or better** (≥50 lb of trout a mile), **whether or not it
  crosses private land**. The owner wants them all: public land is shaded,
  and the Wyoming wading row says you may float private water but not wade
  it. `LengthKM` in that layer is *not* the stream length; the geometry is
  the whole stream. Same-name streams are separate features, so pick one by
  location.
- **Rules: WGFD Chapter 46, effective January 1, 2026**, Area 1 (§16–17),
  verbatim. That's the stream's own entry where it has one (Nowlin Creek,
  the Salt tributaries above the Upper Narrows Bridge), then §17(a)/(b).
  Region-less Wyoming streams reach the `PARK_INFO.wgfd` row through
  `parkRegsSrc:"wgfd"`; the rules card, footer and ungauged copy fall back
  to `PARK_INFO[r.parkRegsSrc]`. **Don't give these streams a `region`**:
  region drives request bucketing.
- **Grand Teton creeks run as far as the trout do.** Pacific, Spread,
  Ditch, Lake, Granite, Pilgrim and Arizona continue on WGFD's line where
  WGFD rates the outside water as trout water. They are modelled like the
  Gros Ventre: no region, `parkRegsSrc:"grte"`, and `parkRegs` = "In Grand
  Teton: …" plus the Area 1 rules for the rest. **A `closed` window in
  tiers.js covers a whole river**, so an extended creek must not carry the
  park's December–July closure. The park text says it instead.
  `GRTE_SHARED` in app.js lists the region-less rivers the Grand Teton
  card counts. Keep it in step with the `grte` zone `count`.
- `geom:"wgfd"` is never snapped or refined, like `iadnr`.
- **The Gros Ventre, Flat Creek (renamed "Flat Creek (Jackson)") and the
  Hoback now run on WGFD's full lines** (lifted into the fence via
  `wy/remap_originals.json`). The Gros Ventre gaps at both Slide Lakes, and
  Flat Creek carries §17(c)/(d) (Elk Refuge) first. **Open:**
  - The `hoback` gauge (13019300) has never measured discharge; 13019500
    (Hoback near Jackson) is live.
  - The `hobw` and `fcref` pins sit 1.4 and 1.1 km off the line.
  - Labels sit at a line's midpoint, so the Gros Ventre's moved to the upper
    valley.
  - `tv_trailcreek` stops 1.3 km short of the Idaho line.
- **Gauges:** Crow Creek near Fairview and Fish Creek at Wilson are live.
  About twenty other USGS site numbers on these creeks are dead, and the
  list is in the build report. Don't add them.

## Western national parks

**112 rivers in ten parks** — Glacier 25, Olympic 16, Yosemite 16, Sequoia 12,
North Cascades 10, Mount Rainier 9, Kings Canyon 9, Redwood 7, Lassen 6 and
Crater Lake 2 — plus **Crater Lake itself** in `LAKES`. Each carries a tier,
and 31 live USGS gauges are attached. Joshua Tree, Death Valley, Pinnacles and
Channel Islands are zones with no rivers, by choice.

**Which water: the parks' own lists.** The rule is Yellowstone's — named
rivers, plus the creeks the park itself names, open, closed or under a
special rule. **Closed water is mapped on purpose** (the Elwha, Ruby Creek,
Sun Creek, Glacier's ten wholly closed creeks) and tiered Class 3 with
`closed:[[1,12]]`, so it is hidden by default but answers "can I fish this?"
when someone looks, rather than leaving a blank they have to guess about.

### The licence rule is the point, and it is different in every park

All regulation copy is from each park's own fishing page, fetched
2026-10-01, and lives in **`PARK_INFO`** in `app.js` — one table, keyed by
region, that every authority-naming spot in the sheet reads (subtitle, badge,
regulation note, "verify with", footer, ungauged copy, zone counts, label
zoom, and `openLake`). Ten more parks as ten more `if` branches in six places
was the alternative.

- **No state licence:** Olympic (except the Pacific from shore; a catch record
  card for salmon and steelhead), Mount Rainier (same card), Crater Lake.
- **Washington's:** North Cascades — and licences aren't sold in the park.
- **California's:** Yosemite, Sequoia, Kings Canyon, Lassen, Redwood.
- **Glacier is split:** no licence on the **North Fork** from park land,
  **Montana's** on the **Middle Fork**.

**`PARK_INFO` must be declared above the river layers.** `syncLabels()` reads
it on its first call at startup. Declared next to the sheet code it was still
in its temporal dead zone, the `ReferenceError` killed the rest of `app.js`,
and the map came up with no chooser and no sheet.

Seasons that are dates go in `tiers.js` windows: Mount Rainier has **two**
(White, Huckleberry, West Fork, Carbon and Mowich close on Labor Day; the
Puyallup, Nisqually, Cowlitz and Ohanapecosh on October 31 — so in October
its card reads "2 of 9"), Glacier's streams run the third Saturday in May to
November 30, and the Queets closes October 1 – November 30.

### Geometry: OSM, clipped to the real boundary

NHD's query endpoints were down for the whole of this pass, so the channel is
**OpenStreetMap**, clipped to the full-resolution NPS boundary simplified only
to 20 m, and carried as `geom:"osm"`. **North Cascades is clipped to its whole
complex** — NOCA, Ross Lake NRA and Lake Chelan NRA — because its rules are
written for the complex and the Stehekin and the Skagit are in the NRAs, not
the park proper.

Four traps, each of which produced wrong geometry first:

- **"Same river" is a question for the unclipped channel.** The Hoh leaves the
  park and re-enters miles downstream in Olympic's coastal strip; a proximity
  test on the clipped pieces called its own mouth a namesake.
- **A lake breaks a river in OSM** — the waterway stops at the inlet and starts
  again at the outlet — so lower McDonald Creek, below Lake McDonald, looked
  like a different creek. Pieces that *chain* (one's downstream end facing
  another's upstream start) are the same river, across up to 20 km.
- **…but namesakes can be closer than lakes are long.** Yosemite has two
  streams called just "Lyell Fork", to the Tuolumne and to the Merced, and a
  20 km allowance merged them into one 33 km creek. The allowance is per
  river: 3 km where a namesake is expected (`near` specs), 16 for McDonald
  Creek, which has both a lake and a namesake.
- **Boundary rivers aren't clipped.** Glacier's North and Middle Forks *are*
  the park line and are fished "from park lands"; clipping would shred them,
  so they keep the reach within 1.2 km of the boundary.

**Gauges are attached only if they are on that river** — the station name
names it *and* it sits within 1.5 km of the river's own line — and only if
NWIS's IV service returned a discharge reading within the last week.

**Not mapped, and why:** the **Klamath** has only 0.8 km inside the federal
boundary — Redwood is run jointly with three California state parks, and the
NPS boundary covers only the federal land. The Dickey (1.7 km) and Crater
Lake's Lost Creek (1.4 km) fall under the 2 km rule. Grassy Swale Creek and
Kings Canyon's Paradise Creek have no OSM flowline under those names, and the
East Fork Quinault is mapped in OSM as the Quinault River itself. Crater
Lake's outline doesn't subtract Wizard Island.

**The pipeline lives in `~/.cache/flyfish-osm/parks/`, not the scratchpad.**
The session scratchpad is wiped when a session ends, and one restart threw
away 59 cached fetches. `specs.py` (what to map and each river's rule),
`fetch.py`, `build.py`, `apply.py` — and `apply.py` is fenced and idempotent,
so re-running it replaces its own block rather than duplicating it.

**Overpass:** order the endpoints by what is *up*, not by preference — a dead
endpoint costs a full timeout on every request before the next is tried, and
for a while the mirrors were dead while the main instance had recovered. Wait
on `/api/status` (it wants a `User-Agent`) for a free slot rather than guessing
a backoff; a 429 means the request came before the slot did.

## California, Oregon, Washington & Montana

**169 state rivers** — Montana 38, California 45, Oregon 41, Washington 45 —
outside the parks: the recognised fly-fishing trout water, held to roughly
the density Idaho and Wyoming got rather than every creek with a trout in it.
Regions are `montana` / `california` / `oregon` / `washington`; geometry is
OSM (`geom:"osm"`) built by the same pipeline as the parks, with
`~/.cache/flyfish-osm/states/` (`specs.py`, `fetch.py`, `build.py`,
`apply.py`, all fenced and idempotent). The parks' rivers are excluded from
the state builds: a reach inside a park is under the park's rules.

Two geometry rules beyond the parks' four:

- **Pick a namesake by length *inside the state*.** Bishop Creek first came out
  as Nevada's. A `near` anchor plus in-state length decides it.
- **Big rivers are reaches, not whole rivers.** `between` gives two points
  and the build takes the shortest path across the run network between them
  (links up to 2 km, falling back to 10), so the Yakima is Easton to Roza —
  the water its regulation entry is written for — not the river to the Columbia.
  The Trinity's lower reach carries a different OSM name, hence `lonmax`.

### Every state river carries its own regulations, verbatim

Clicking a state river shows **that river's entry from the state's 2026
booklet**, reproduced word for word, then the standard rule it falls back to.
It uses the same `parkRegs` / `parkRegsSrc` fields and `PARK_INFO` rows the
parks do (`heading:"Regulations"`, `labelZoom:8`), so the sheet credits
Montana FWP, CDFW, ODFW or WDFW, and the footer carries the licence facts.
Entries over 1,400 characters fold into a `<details>` ("6 reaches, tap to
read") — the Madison is a page long. Where a river has no entry of its own
it shows the standard rule alone and says so (MT 13, CA 8, OR 1).

The booklets are PDFs, read with PyMuPDF (venv at `~/.cache/flyfish-osm/venv`),
and **each state's layout needed a different reading order** — a single
extractor garbled every one of them:

- **Montana:** the authored block order. Sorting blocks by position
  interleaves the two columns mid-entry.
- **California:** per-page column edges taken from where *that page's* "Open"
  and "Daily" headers sit — fixed x positions drifted page to page — and
  multi-period rows split line by line, each with its own bag limit. The
  §7.40 salmon/steelhead tables don't survive extraction, so they are
  **cited, not reproduced**: a half-garbled limit is worse than a pointer.
- **Oregon:** authored order, zone decided by page range — which is also how
  the Clatsop County John Day stopped being matched for the real one.
  Willamette Zone streams are catch-and-release for trout, not 2 a day; that
  was checked, because it is the opposite of every other zone.
- **Washington:** column-aware block sort, and an inline "Other game fish"
  row that has to be split off the trout row it shares a line with.

**A fenced writer must strip its own block before it reads the existing
gauge keys.** `states/apply.py` once read them first, took its own previous
gauges for ones already on the map, reused their keys, then deleted the block
they lived in: a re-run silently dropped 241 gauges, every river still
pointing at them. Count referenced against defined keys after any re-run.

The North Fork Lewis came in on a targeted fetch (`osm/WA_x_lewis.json`): in
OSM it is plain "Lewis River", and the state tile it fell in had missed it. The three Montana spring creeks (Armstrong, DePuy, Nelson's) aren't in OSM
under those names and are commented out of `specs.py`.

## Colorado, Utah & Alaska

**215 rivers** — Colorado 42 plus Rocky Mountain 21, Black Canyon 1 and Great
Sand Dunes 2; Utah 28 plus Capitol Reef 3, Zion 4 and Canyonlands 2; Alaska
63 plus Katmai 8, Lake Clark 8, Denali 8, Wrangell-St. Elias 9, Gates of the
Arctic 7, Kobuk Valley 4, Glacier Bay 4 and Kenai Fjords 1. Mesa Verde,
Arches and Bryce Canyon are zones with no rivers, like Joshua Tree. Pipeline:
`~/.cache/flyfish-osm/rockies/` — one directory for park and state rivers
(`specs.py`, `fetch.py` for state tiles, `fetch_ak.py` for Alaska area boxes,
`fetch_extra.py` for OSM spellings found missing after a build, `build.py`,
`apply.py`, `parkinfo.py`, `regs/`), fenced in the data files as
"rockies & alaska rivers". The zones come from `zones_add2.py`.

**A park can be two features.** The NPS boundary service returns Denali,
Gates of the Arctic, Glacier Bay, Katmai, Lake Clark, Wrangell-St. Elias and
Great Sand Dunes each as a National Park *and* a National Preserve under one
`UNIT_CODE`. Keying on the code kept whichever came last, so Great Sand Dunes
was drawn as its preserve alone and Katmai lost the preserve where Funnel
Creek runs. The zone script merges every feature of a unit.

**Alaska sits outside the opening frame** (`far:true` on its zones).
`showZones()` fits only the zones without it, because a frame wide enough
for Anchorage shrinks the lower 48 to slivers. Alaska is drawn and tappable,
reached by panning or from the Alaska entries in "Jump to region".

**Regulations, by booklet:**

- **Colorado** (CPW *2026 Colorado Fishing*, "Special Regulations: Fishing
  Waters"): keep only the 8.5–9 pt body faces, because the map pages are
  interleaved with the listings and their labels are other fonts. A sidebar
  set in the same 9 pt face runs on after some entries, so once an entry's
  numbered rules begin, only rules, reach headings and notes belong to it.
  Gold Medal reaches are kept and marked.
- **Utah** (DWR *2026 Utah Fishing Guidebook*, "Rules for specific waters"):
  a two-column layout read out of order, which put Green River section (b) on
  another page, so lines are sorted by column before parsing. "See X"
  entries resolve to X.
- **Alaska** (ADF&G 2026 Southcentral, Southwest, Southeast and Northern
  summaries): each river's entry is found by its exact heading and read until
  the next water heading. The body faces are Montserrat 8.8 pt; the font
  filter is what keeps map labels and photo captions out. Where the booklet
  sets a water's rules as tables and maps — the Kenai mainstem, the Gulkana's
  Middle Fork — the sheet cites the pages rather than reproducing a garbled
  table. Every Alaska river also points at its area's general regulations by
  page.

Park regulation lines are from each park's own fishing page, fetched
2026-10-01. Denali is the odd one out: no licence in the former Mount
McKinley park, an Alaska licence in the additions and preserve.

**Not mapped, and why:** OSM has no flowline for the West Fork Duchesne,
Mammoth Creek (only 1.6 km), the Agulowak, Lower Talarik Creek, the
Stuyahok, the Pasagshak, the Kadashan, the Kulik, Katmai's Battle Creek,
Lake Clark's Silver Salmon Creek or the East Alsek. Rocky Mountain's Fern
Creek and Kodiak's Olds River fall under 2 km, Gates of the Arctic's Wild
River has nothing inside the park under that name, and Kenai Fjords'
Resurrection River came out as eleven slivers along the boundary and was
dropped. OSM's "South Platte River" starts at Spinney Mountain Reservoir;
the Hartsel reach above it is drawn as the Middle Fork, which carries both
CPW entries. Alaska geometry is simplified at 80 m rather than 40: the
rivers are long and remote, and at 40 m they added 26,000 points.

## Michigan, the Black Hills, New Mexico, Arizona & Nevada

**Michigan (23).** The Au Sable and its North and South Branches, the
Manistee, Pere Marquette, Little Manistee, Pine, Muskegon, Rifle, Boardman,
Platte, Jordan, Pigeon, Sturgeon, Black, Betsie, White and Baldwin, and in
the Upper Peninsula the Two Hearted, Fox, Escanaba, Yellow Dog and
Salmon Trout. Geometry is **EGLE/DNR's designated-trout-stream layer**
(`gisagoegle.state.mi.us/.../MiEnviro/FeatureServer/32`): NHD 1:24k reaches,
each carrying the DNR's regulation Type. So these carry `geom:"midnr"` and,
like `iadnr`/`widnr`, are never re-snapped or refined. Regulations come from
the 2026 Michigan Fishing Regulations: the river's **Gear Restricted Stream**
entries verbatim (pp. 44–46, parsed by bold river heading), then the
stream-Type rows from the p. 43 table for every Type on the river's reaches.
Rivers that are only Type 1/2 close October–April in `tiers.js`.

**Wisconsin South Shore & central sands (22).** The Bad, White, Marengo,
Sioux, Cranberry, Siskiwit, Flag, Fish Creek, Iron, Brunsweiler and Tyler
Forks along Lake Superior; the Mecan, Tomorrow, Little Plover, White, Pine,
Willow, Lawrence, Chaffee, Emmons, Crystal and Wedde in the sands. From the
**WDNR trout-regulation layer** (`FM_Trout/FM_TROUT_REGS_WTM_Ext`, layer 0):
the line is the regulated reach and each piece carries its category,
season, bag and gear text, reproduced verbatim. Fetched **inside a box per
stream** — Wisconsin has a dozen White Rivers. They use the `parkRegs` /
`PARK_INFO` machinery with regions `wisouthshore` and `wicentralsands`, not
`troutRegs`, so the sheet's badge, note and footer come from one row.

**Black Hills (6), New Mexico (11), Arizona (7 + Grand Canyon 2), Nevada
(5 + Great Basin 3).** NHD flowlines by name (Overpass was failing for most
of this pass), built by the Colorado/Utah/Alaska pipeline with `src:"nhd"`.
Regulations are quoted from each booklet: South Dakota's Black Hills
exceptions; New Mexico's **Special Trout Waters**, parsed into Red, Green and
Xmas Chile designations so each river shows the reaches named under each;
Arizona's Commission Order 40 water list; Nevada's CR 25-16 county tables.

Two NHD traps:

- **Fallback files number their ways from -1**, so the builder's
  de-duplication by way id silently dropped every NHD river after the first
  in a state. It de-duplicates on (id, name) now.
- **NHD draws wide rivers as parallel flowlines** — the Middle Fork Salmon
  came out at 318 km, twice its length. For NHD rivers the builder keeps the
  longest run and drops any run lying mostly within 400 m of one kept.

**State outlines for these come from the Census *cartographic* (500K)
boundary** (`Generalized_ACS2024/State_County/MapServer/7`), not TIGER:
TIGER's Michigan includes its Great Lakes water and drew the state over Lake
Michigan. (The older states were built from TIGER and haven't been checked
for the same problem.)

**Parks with no rivers**, by choice: Isle Royale, Badlands, Wind Cave,
Carlsbad Caverns, White Sands, Petrified Forest and Saguaro.

## Gap fills, lakes, and the finishing pass

**Rivers people expected and didn't find**, added: Kelly Creek, the Middle
Fork Salmon and the Idaho Owyhee; the Greybull and Hams Fork; Panguitch,
Big Cottonwood and East Canyon Creeks and the Price River; Saguache Creek;
the Hoko, the lower Snake and the Columbia's Hanford Reach; the Russian; and
in Alaska the Aniak, Kisaralik, Kwethluk, Unalakleet, Ugashik, Eagle River,
Campbell, Bird, Ptarmigan, Cooper and Stariski Creeks, the Moose and Funny
Rivers, Lower Talarik Creek, the Stuyahok, the Kadashan and the East Alsek
(several from NHD where OSM has no line). Idaho and Wyoming additions carry
no region tag and no regulation text, like the rest of those states' rivers;
their zone counts are the original count plus these (`zone_base.json`).

**Still not mapped, and why:** Armstrong, DePuy and Nelson's spring creeks
(unnamed in both OSM and NHD — a hand-drawn line would be a guess), the
Kulik, the Pasagshak, Katmai's Battle Creek and Lake Clark's Silver Salmon
Creek (in neither source), and the Agulowak (NHD's line runs on through Lake
Nerka and the river's own ends aren't located).

**Lakes (9 more, 31 in all):** Henrys Lake, Hebgen Lake, Flaming Gorge and
Strawberry Reservoirs, East Lake, Crane Prairie, Spinney Mountain and Eleven
Mile Reservoirs, and North Delaney Butte Lake. Outlines from OSM (NHD for
Delaney), regulations from each state's entry for the lake (IDFG's Henrys
Lake rule, p. 43; Montana's Central District standard for Hebgen, which has
no entry of its own). `openLake` reads its heading, badge and agency from
the lake's `park` row, which for these is a state row.

**Colorado DWR gauges.** `GAUGES` entries with site `CODWR-<abbrev>` are read
from the Colorado Division of Water Resources telemetry API
(`dwr.state.co.us/Rest/GET/api/v2/telemetrystations/`) — CORS-open, batched by
comma-separated abbrev, 1,000 requests a day. Same 7-year day-of-year median
from DWR's daily means. 23 stations on 11 rivers that had no USGS gauge (the
Rio Grande at Del Norte, the Poudre at the canyon mouth, the Conejos…).
Only rivers with **no** USGS gauge get them, and spillways, outlets,
channels, ditches and confluence gauges are excluded.

**Season windows for state rivers** (`states/seasons.py`) are applied only
where nothing in the river's own entry could open water outside the
standard season — no year-round wording and no winter month named. Most
western rivers turned out to be open in winter in some reach, so only 18
qualify; ambiguity means no window, never a wrong closure.

**Encoded geometry.** Generated rivers carry `cz` — Google encoded
polylines at 1e5 — instead of `coords`, decoded at the top of `app.js`
before anything reads them. rivers-data.js went from 4.8 MB to 2.1 MB.
Run `~/.cache/flyfish-osm/encode_coords.py` **after every apply.py**; it is
idempotent. Encoded strings contain `[ ] { }`, so every script that finds the
end of `RIVERS` uses the string-aware matcher in `jsmatch.py` — plain bracket
counting would cut the array mid-string.

**Current direction for OSM/NHD/agency rivers** comes from terrain
(`flowdir.py`, the same least-squares method as the NHD rivers) instead of
assuming the line runs downstream. Elevations come from Open-Meteo until its
daily allowance runs out (it counts each point as a call), then from the
USGS EPQS point service. Results go to `flowrev_osm.json`, which every apply
script reads, so a re-run no longer resets them to "0".

**OSM rivers refine from OSM at zoom 13+** (`osmSegments()` in `app.js`): the
same ways at full resolution from Overpass, by the river's `osmName`,
clipped to the drawn line. Never from NHD — mixing sources fragments a line.

**Access points** come from OSM: `leisure=slipway` as ramps, `leisure=fishing`
and "… Fishing Access …" names as wade access, matched to the nearest mapped
river within 300/400 m (`access/build.py`, fenced in `RAMPS`). Private ones
are skipped.

**A fenced writer must strip its own block before reading existing gauge
keys** — see the state-rivers section; the Michigan, Wisconsin, lakes and
Colorado/Utah/Alaska writers all do.

## Phone-first features (October 2026)

Added on 2026-10-02 after using the app on an iPhone. Backlog and status for
everything here and to come: **`IDEAS.md`**.

### Rules today card (top of every river panel)
`rulesCardHTML(r)` renders first in `renderSheet`, then the full official
text folded in `<details class="rulesfull">`, then flows, blurb and the rest.
- **Season status comes only from `closed` windows in `tiers.js`, and those
  are whole months.** So the card never says a bare "Open": in the month
  before or after a closed window it says "Season opens or closes this
  month — check the exact date". No closed window → "Season set by the rules
  below" (or "No season on file").
- **Licence line** = `PARK_INFO[region].licence`, written only from text
  already in that row's footer/note/regBody, plus a small by-state fallback
  for the older regions. Michigan and South Dakota rows say "see …" because
  their rows never stated a licence.
- **Tags are phrase matches, not interpretations**, scanned from the river's
  own `troutRegs`/`parkRegs`, cut at the first bold "standard"/"statewide"
  heading so a state's standard rule doesn't tag every river. Trap: "artificial
  lures **or flies only**" contains "flies only" — it is stripped before the
  fly-only test, or 169 Yellowstone creeks read "Fly fishing only".
- The tier chip's best-season wording is **"Prime time now"**, not "In
  season" — "in season" now means legally open, on the card above it.

### Stream-access law — `js/access-laws.js`
`ACCESS_LAW[state] = {head, quote, src, url}` for all 18 states, shown as the
"Wading & access" row of the rules card. Every quote is verbatim from the
state's 2026 booklet or the agency's own page (working notes with page
numbers: `~/.cache/flyfish-osm/accesslaw/notes.md`). AZ, NV and IL publish no
stream-access rule and the entry says so (`quote:null`) instead of guessing.
Skipped for national-park rivers — federal land, not the state's streambed law.

### Field Book (book icon in the header)
Per-river ☆ Favourite / ✓ Fished (date) / notes, stored **on the phone only**
in `localStorage.fieldBook` (`fbGet`/`fbSet`/`fbAll`). The row lives in
`#fbrow`, *outside* `#sheetbody`, so `renderSheet` re-running doesn't steal
focus from the notes box. Favourites are always visible on the map
(`tierShown`). The page is a tab registry, **`BOOK_SECTIONS`** — a new research
feature is one more entry. Tabs: Favourites, Fished, Notes, Research (Reddit
and web-search *links* — posts are their authors', so link, don't copy),
Offline. Export/import JSON is the only backup. Notes are escaped (`fbEsc`).

### Offline — `sw.js`
Service worker at the repo root; every URL relative because the site is at a
GitHub Pages sub-path. App files are **network-first with a 4 s timeout** (so
updates still arrive, and dead signal falls back to cache). USGS Topo tiles
are cached while browsing (`tiles-browse`, ~2,500) and saved on purpose from
the Field Book's Offline tab (`tiles-saved`, `localStorage.offlineAreas`,
capped at 4,000 tiles per area). **Only USGS Topo is ever cached** —
OpenTopoMap, Esri and Google terms forbid offline storage. API calls (USGS
water, DWR, NHD, PAD-US, Overpass) are not intercepted. **Bump `VERSION` in
`sw.js` when the shell file list changes.**

### Location
Locate button bottom-right. On first launch a card (`#locask`) asks once,
and "Turn on" is the tap that triggers iOS's own prompt. A page can't change
iOS settings itself. After that, `localStorage.locPref="on"` starts the dot
on launch in **`located`** mode (dot shown, map not moved). "Not now" is
permanent. Denied → the pill gives the iPhone Settings path. Coordinates are
never stored or sent.

### Gestures and controls
- **Single taps on rivers, lakes, zones and public land wait 250 ms**
  (`onTap`) so a double tap zooms instead of opening something. Point
  markers stay immediate.
- **One-finger zoom** (double-tap-hold-drag) uses Leaflet's own pinch path
  (`_move` per frame, `_animateZoom` at the end) so `zoomend` fires once.
  `finishHold` applies any pending frame first — a quick flick otherwise
  handed Leaflet a null centre.
- **Two-finger tap** zooms out. Both fingers often land in one event on iOS.
- **`zoomSnap` is 0.25, so `getZoom()` is fractional.** Compare with `>=`/`<`;
  floor it before using it as a key or with `<=` on an integer maximum.
- **River Filters ▾ and Map Icons ▾ are collapsible menus** (renamed from
  Rivers / Map layers on 2026-10-09), built from `TIER_KEYS` and the
  **`LAYER_CHIPS`** table. A new layer is one more row. **Every icon layer
  starts off at launch.**
- **Icon layers have one owner: `syncIconLayers()`.** `iconWanted(id)`
  decides each layer from, in order: river focus, the user's own chip
  choices, then close zoom (`AUTO_ICON_ZOOM` 12 turns on wade, ramps,
  parking and trailheads, 400 ms after the zoom settles). Any add or remove
  not made by `syncIconLayers()` is recorded as the user's choice, and the
  user's choice always wins. Don't add or remove these layers anywhere else.
- **River focus** (`focusRiver` / `unfocusRiver`): opening a river frames it
  in the area clear of the sheet and the controls (`goTo` takes `padding`),
  draws it at full strength in `focusPane` with a gold casing while the
  rivers pane fades, shows only its own access points at any zoom, turns on
  parking, bridges and falls/dams (plus closed water if it has
  `CLOSURES`), and turns gauges off. A gauge tap, the tour and a live float
  open with `{fit:false}`. Closing the sheet, a lake or the chooser ends it.
  If the whole river would frame below `FOCUS_MIN_ZOOM` (10), the view
  centres on an anchor at zoom 10 instead: the tapped point, the tapped pin,
  the nearest on-screen point of the line, the primary gauge, or the line's
  middle, in that order. On a phone the clear area is only ~200×120 px.
- **Bridges draw on a canvas, and a Leaflet canvas swallows every tap that
  lands on it**, even after its layer is switched off. Once focus mode turned
  bridges on routinely, river and chooser taps underneath silently died. The
  bridge pane is `pointer-events:none`, and a map click within `BR_HIT_PX`
  (10 px) of a drawn bridge opens its popup. Markers beat bridges, and
  bridges beat river lines. Keep any future canvas layer the same way.
- **Pane CSS uses Leaflet's real class names**: `leaflet-rivers-pane`,
  `leaflet-land-pane`, `leaflet-allGauge-pane` (case matters),
  `leaflet-zone-pane`, which is the `createPane` name minus "Pane". Until
  2026-10-09 the selectors read `.riversPane`, matched nothing, and the
  river halo and the chooser's tap-blocking had never actually worked.
- **Empty-map nudge:** from zoom 9 to below 12, with no icons on, no sheet
  open and no chooser, welcome or tour showing, the Map Icons button gets a
  ring. A tip shows once per session (sessionStorage).
- **Zoom +/− is bottom-right** above locate. Top-left controls clear the app
  bar by its *measured* height (`--appbar-h`, set by a ResizeObserver): the
  title wraps to two lines on a phone.
- **Park cards are hidden below zoom 6** (`PARK_CARD_ZOOM`). The outlines
  stay tappable.

### Big layers: static tiled data (`data/<layer>/`)
Data too big for a JS file is cut into **1° cells** —
`data/<layer>/<floor(lat)>_<floor(lng)>.json` plus `index.json` listing the
cells that exist — served by GitHub Pages as plain files. `makeTiledLayer()`
in `app.js` loads the index on first use and only the cells in view, from a
minimum zoom. This is how the app stays no-backend at 100k+ points. `sw.js`
serves `data/` stale-while-revalidate, so viewed cells work offline and a
rebuilt layer still reaches phones.
- **Bridge access** (`data/bridges/`, `~/.cache/flyfish-osm/bridges/build.py`):
  FHWA **National Bridge Inventory 2025**, 129,214 bridges in the 18 states.
  Kept: route-on records over a waterway, open, publicly owned (no private,
  railroad or military). **Canals, ditches, drains, spillways and laterals are
  dropped**, which removed 15,412. Irrigation works aren't fishing water, and
  Montana's law excludes them. Row `[lat,lng,water,road,owner,year,state]`.
  The popup shows that state's `ACCESS_LAW.head`, because **a bridge is not
  legal access everywhere**. From zoom 11, canvas renderer, off by default.
- **Falls, rapids & dams** (`data/hazards/`, `~/.cache/flyfish-osm/hazards/`):
  NHD point layer FTYPE 487/431/343, deduplicated by permanent ID. Mostly
  waterfalls. NHD maps few rapids or dams as points, so absence of a marker
  means nothing, and the popup names the source. On by default, a safety
  layer, from zoom 10.

### All USGS gauges (off by default)
Every live **discharge** gauge in view, fetched from `latest-continuous` by
bbox per 1° cell (cached 15 min), from zoom 8, skipping gauges already in
`GAUGES`. Tapping one opens a popup with the live CFS and `statusOf()` against
the 7-year median (via `fetchStatsBatch` and a temporary non-enumerable key).
It honours `apiPaused()`. Off by default because each cell is a request
against the hourly budget.

### Rulebook streams — `~/.cache/flyfish-osm/west2/` (fence "western rulebook streams")
The user asked for **every stream with its own entry in a state's 2026
regulations**, one state per session. Montana is done (2026-10-03): **93
streams** from FWP's District Exceptions, ids ending `mt2`, region
`montana`, tier 2, creeks `minor:true` (labels from z12). Each carries its
exception text verbatim plus the district standard. `gen_<state>.py` is the
only state-specific file; see `west2/README.md`.
- **Parent rule:** a heading "(tributary to X)" means a candidate run must
  have an end within 1.5 km of a way named X. With no parent or anchor, a name
  is taken only if all its in-state runs form one cluster. Otherwise the
  stream is skipped and reported, never guessed. 19 Montana entries were
  skipped this way: no line in OSM/NHD, ambiguous Sage Creek, etc.
- Montana's booklet text: parse **`mt2026.raw.txt`**. The `.txt` variant
  squashes Central-district headings ("BEAVERCREEK(…)").
- Zone `count` for the state must be bumped by hand in `zones.js` (MT 38 → 131).
- **`mfsalmon` FLOW_REV is pinned to "0000000000".** A full `flowdir.py`
  run recomputes it to a mixed pattern. Restore it after any flowdir run.
- **Colorado done (2026-10-06): 181 streams** (ids ending `co2`) from CPW's
  2026 Special Regulations. Namesakes are resolved by **county**: a run must
  lie ≥50% inside the entry's county, using cached Census county polygons.
  45 entries were skipped, not guessed: no line, ambiguous inside the county,
  or park-only. Colorado zone count 43 → 224. Reasons are in `west2/build_co.log`.
- **`apply.py` now writes one fence for every state: run `python3 apply.py mt co`**
  (plus each new state). Running it with one state drops the others' rivers.
- Next states: Utah (~30, `ut_entries.json`), then California, Oregon and
  Washington, whose full heading lists still need parsing from their booklets.
- **Helpers must never disable the sandbox.** The Montana run did, to reach
  Overpass mirrors. If a network endpoint is blocked, stop and report.

### Official designations — `js/designations.js`
`DESIGNATIONS[riverOrLakeId] = {src, reach}` with `DESIG_SRC` naming the
agency, shown as the top row of the rules card and the lake sheet. 46 waters:
CPW Gold Medal (from the 2026 booklet's flags, so it can tag a river whose
own text lost the marker), Utah DWR Blue Ribbon, WGFD Blue Ribbon (>600 lb
trout/mile), and Montana's twelve statutory "blue ribbon" Murphy Right
streams. `reach` is the agency's own wording. It is a separate thing from
this app's Gold tier.

### Parking, campsites, trailheads (`data/poi/`)
OSM places near mapped rivers (parking ≤300 m, camp/trailhead ≤1.5 km), built
by `~/.cache/flyfish-osm/poi/`. Three layers share one cell cache
(`tileJSON`, `makeTiledLayer({filter})`), off by default, from zoom 11.

### Report an issue — `#report` (2026-10-07)
A form with three fields: river (optional, autocomplete), issue (required) and
email (optional, for a reply). It opens from the bottom of every river and
lake sheet, prefilled, from the ? legend, and from the **flag button in the
header** (`#btn-report`, added 2026-10-07 so testers can find it), which
prefills the river whose sheet is open. It may move into a menu later.
- Reports go to the Supabase table in **`supabase/reports.sql`**. Its RLS
  policy is insert-only, so the public key can never read reports back and
  reporters' emails stay private. Read reports in the Supabase dashboard.
- **`js/config.js`** holds `SUPABASE = {url, anonKey}`. While `url` is
  empty, the form opens but says reporting isn't switched on. Since
  2026-10-07 the config is set to project `kbdrxtyacmihabwadzzz`, using a
  `sb_publishable_` key. That key goes in `apikey` only, **not** in
  `Authorization` (it isn't a JWT). The project doesn't grant table access
  by default, so every table needs an explicit `grant` (see the SQL file).
- **Never put the service_role key in the app.**
- **Keep-alive:** free projects pause after about a week idle.
  `.github/workflows/supabase-keepalive.yml` calls `rpc/keepalive`
  (`supabase/keepalive.sql`) every 3 days. A failed run emails the owner,
  and that email is the signal to click Restore. GitHub turns scheduled jobs
  off after 60 days without commits.
- An unsent draft is kept in `localStorage.reportDraft`. A hidden honeypot
  field drops bot posts.
- **`APP_VERSION` in `app.js` must be bumped alongside `VERSION` in `sw.js`.**

### Welcome card and tour — `js/tour.js` (2026-10-07)
First launch shows a welcome card (`localStorage.welcomeSeen`; `?tour=1`
forces it). It says which areas get the most attention (Jackson Hole, Swan
Valley, NE Iowa Driftless; that is the owner's wording, keep it) and invites
testers to use the report flag. **Take the tour** or **Skip for now**. The
tour can be replayed from the `?` legend.
- **The welcome owns a first launch.** app.js holds back `#locask` while
  `welcomePending()` is true. Skip, or the end of the tour, hands it back
  through `locAskLater()`, which does nothing once location has an answer
  or is blocked.
- **Spotlight, not interaction.** `#tour-block` swallows every tap, so the
  demo can't favourite, start a float or write to the Field Book. Targets are
  looked up fresh on each step, because the sheet re-renders when stats
  arrive. A step whose `sel` matches nothing visible is skipped.
- **Two parts:** "Map" (header buttons, zoom, locate, Regions, the two
  menus, Add to Home Screen) and "River" (the Snake opened as an example:
  Rules today, Live flow, a float section, Start float, Field Book row,
  report link). A checkpoint card between them offers "Show me" or "Done
  for now". The counter reads "Map · 3 / 11", computed from each step's
  `part` tag, so adding a step renumbers itself.
- **Step options:** `skip()` hides a step for now (Add to Home Screen when
  already installed). `text` may be a function (the location step appends
  the app's own blocked-location wording, copied from `locBlockedSay()`, so
  keep the two in step). `extra()` gives the step's own buttons, and the
  location step uses it for Turn on / Not now, which only show when
  location can still be asked for.
- **Test in a visible pane.** A hidden preview pane runs timers at about
  1 Hz, so a scripted walk times out and screenshots lag the ring's glide.
  Read `#tour-ring` / `#tour-tip` with `getBoundingClientRect()` after a
  wait instead of trusting a screenshot.

### More than one session can work here at once
On 2026-10-06 a second session (Float Mode, `js/float.js`) committed while
this one had uncommitted work. Its commit swept up this session's
`app.js`/`index.html`/`sw.js` edits but not the new untracked
`js/designations.js`, so the live site briefly referenced a missing script.
It was harmless only because `desigHTML` checks `typeof DESIGNATIONS`.
**Before committing, check `git status` for untracked files your edits
depend on.** Guard any new global the same way.

### Float Mode — `js/float.js` (2026-10-06)
Personal, on-phone only. A section card's **🛶 Start float** opens a planner
(craft, launch time, take-out window, share plan), then a live panel (miles
left/done, ETA, pace, stopped time, keep-screen-on).
- **Scope is deliberate:** `FLOAT_RIVERS` (snake, teton, southfork, green;
  newfork once its sections have a class) and `floatEligible()`: Class III or
  lower, a `klass` required, and `FLOAT_EXCLUDE` (`s7`, the Snake canyon — a
  whitewater run, not a fishing float). Whole sections only, so a route never
  runs past a section's end into harder water.
- **Route** = Dijkstra along the *drawn* line (`riverLayers[id].line`), with
  piece ends welded to the nearest point on another piece within 0.5 km
  (braids rejoin mid-segment). Ramps must snap within 1.5 km or the planner
  says it can't trace the section — **don't raise that limit; fix the ramp.**
  Progress is fraction-along × the section's official `miles`.
- **No coordinates are stored.** The log is `{t, a}` (time, fraction along);
  the location feature's promise holds. Finished floats live in
  `fbState.floats` and come through Field Book export/import.
- Baseline ETA is `floatEstimate()` ÷ the `CRAFT` factor (guesses), replaced
  by the median of your completed floats on that section. Never show a water
  speed — gauges report discharge, not velocity.
- **Ramp pins come from the agencies** (2026-10-06), carried as `src` on the
  `RAMPS` entry: WGFD *All_River_Access_Points* (services6.arcgis.com/
  cWzdqIyxbijuhPLw — ordered upstream→down per river, with launch/egress
  flags) for the Snake, Green and New Fork; IDFG *Fishing and Boating Access
  Sites* for the Teton and Twin Bridges; USFS EDW Recreation Opportunities
  for Spring Creek and Fullmer; BLM Idaho Recreation Site Point for Conant,
  Byington and Heise. Nine pins had been 1.5–8 km off (Deadman's Bar by 5 km,
  South Park by 3.7). Section `miles` were then **re-measured along the
  channel** between them; the old figures were tied to the wrong pins.
- **19 of 20 sections trace.** f4 (Byington → Twin Bridges) doesn't: Twin
  Bridges is 3 km off the drawn South Fork. The Daniel take-out on g1 is
  listed by WGFD as **private** (Zach Roberts) and says so.
- **New Fork:** 9 WGFD access points (Hocker, private, left off) and its line
  rebaked from OSM — the NHD snap had missed the bend east past Boulder.
  **No New Fork sections yet**: no agency publishes a whitewater class for
  it, and `floatEligible()` needs one. Likely Class I or not whitewater at
  all; the measured draft sections sit in a comment at the end of `SECTIONS`.

### Access points (finished 2026-10-02)
All 139 OSM tiles fetched: 860 access points on 199 rivers (555 slipways,
305 fishing sites). Overpass refused this machine for most of a day after
heavy use; `fetch.py` resumes from saved tiles, so just re-run it later.

## How we work on this project

- **Plan at Max, build at the level the change needs** (decided
  2026-10-07). The first request for a change runs on Opus 5.5 at **Max**
  effort. That turn plans the change, writes a self-contained brief, and
  picks the builder, naming it in one line. The builders live in
  `.claude/agents/`, each with its own model and `effort`:
  - `build-sonnet-medium`: mechanical edits with a complete spec (copy,
    CSS, a data fix, one file).
  - `build-sonnet-high`: small features that follow a pattern already in
    the code.
  - `build-opus-high`: features that touch several files or existing state
    (the sheet, filters, the service worker, Field Book storage).
  - `build-opus-xhigh`: what every user hits, or where a subtle mistake is
    costly (first launch, permissions, Float Mode, regulation display).
  - `build-opus-max`: hard bugs and data correctness (geometry and
    regulation pipelines, the USGS request budget).

  Sonnet is the default; Opus has to be justified by the change. **Never
  build with the general-purpose agent**: a subagent with no `effort` of its
  own inherits the session's, which is Max. **Don't set
  `CLAUDE_CODE_EFFORT_LEVEL`**, which overrides every agent's `effort`. A
  session can't lower its own effort (the app refuses), so the planning
  session's later turns stay at Max unless you change it in the app.
  Housekeeping (CLAUDE.md, IDEAS.md, previews, git when asked) stays in the
  planning session. Review every diff against the data in the browser
  before calling it done. Most of the bugs this project has had looked fine
  in the diff.
- **Commit and push only when asked.**
- **Pilot regions (decided 2026-10-07).** New data-driven features are built
  and refined in a test region first, then rolled out a step at a time:
  - **Pilot West** — float features: Jackson, Pinedale and the Idaho side
    (Victor / Teton Valley, Swan Valley): the Snake in Jackson Hole, the
    Green and New Fork, the Teton, the South Fork.
  - **Pilot Central** — field testing close to home: the NE Iowa Driftless
    trout streams (`region:"driftless"`, `state:"IA"`) and the Central Iowa
    water trails around Des Moines (`state:"IA"`, no driftless tag). Covers
    walk-and-wade and hike-in-only water, not just floatable rivers, so
    wade/access features are tested here.
  - **National-park features:** Grand Teton and Yellowstone.

  Expand once a week of real use turns up nothing wrong. Pure UI changes,
  which run the same code on every river, ship everywhere at once.
- **One feature per session.** Finish it, update this file and `IDEAS.md`,
  push, start fresh. A long session re-reads its whole history on every
  reply. This file is what carries the context forward.

## Teton Valley & Swan Valley, Idaho

**Teton Valley (21).** The Teton River and its tributaries above the canyon —
Teton, Darby, Fox, Trail, Game, Moose, South and North Leigh, Badger and its
two forks, Bitch, Milk, Spring, Warm, Packsaddle, Horseshoe, Canyon, Bull Elk
and Mahogany Creeks.

**Swan Valley (12).** The South Fork of the Snake between Palisades and
Heise, plus Palisades, Rainey, Pine and its North Fork, Fall, Big Elk, McCoy,
Bear, Indian, Pritchard and Garden Creeks.

The Teton River and the South Fork were already on the map as western rivers;
they keep their entries and gained the region tag, so each valley's zone
includes its mainstem.

### The lines stop at the state line, and so does the zone

The Teton Range creeks run east out of the valley and **cross into Wyoming
part-way up their canyons** — Teton Canyon's trailhead is in Wyoming, not
Idaho. Fishing regulations change at that line, so the drawn lines stop
there and the Teton Valley zone borders Wyoming *on the state line* rather
than on a bisector drawn halfway between two river clusters. The border
itself is the real Census boundary, not the nominal 111°03' meridian: it
wanders about 225 m, and both sides are clipped with the same function so
they share one edge instead of two nearly-identical ones.

### Which creeks, decided by the state and by connectivity

The river list was checked against **Idaho Fish & Game's own lists** of the
tributaries its special rules name — "Bitch, Badger, Canyon, Fox, Trail,
Teton, and S Leigh creeks" for the Teton, "Burns, Palisades, Pine, and
Rainey creeks" for the South Fork. `parkRegs` on every entry comes from
IDFG's 2025–2027 Seasons & Rules, Upper Snake Region, with `parkRegsSrc:
"idfg"` so the sheet says *Regulations* rather than *Park regulations* and
credits Idaho Fish & Game.

The rule worth knowing: **no harvest of cutthroat trout and no limit at all
on rainbow trout or hybrids**, on both rivers and their tributaries, because
non-native rainbows displace and hybridise with the native Yellowstone
cutthroat. The **tributaries close June 1–30** while the mainstems stay
open.

Same-name creeks are thick here — Warm, Bear, Canyon, Trail, Fox, Darby and
Spring Creek all match more than one stream inside these envelopes. They
were sorted out by **growing a connected component from the real NHD
mainstem**, not by distance, which correctly split the two Warm Creeks and
threw out a Bear Creek and a Bulls Fork that drain somewhere else entirely.

Two traps from that pass:

- **A fetch box that clips a creek's mouth breaks the connectivity test.**
  Canyon Creek was rejected wholesale because its confluence with the Teton
  sat 1.6 km outside the box; re-fetched wider it joins the river at 0.00 km.
  Check rejects against the mainstem before believing them.
- **Burns Creek has no NHD flowline under that name**, despite IDFG naming
  it a South Fork tributary. It is left off rather than guessed at, the same
  call as Coldwater Creek in the Driftless.

## Status

**Finished / working:**
- Core app: Leaflet map, bottom sheet, live USGS flow fetch/render, the
  `statusOf()` relative-to-median status bucketing, home-screen install
  (`manifest.json` + icons).
- All 278 rivers in place (49 West, 7 Central Iowa, 117 Driftless incl. 65
  NE-Iowa trout streams from the DNR, 24 North Shore, 13 East-Central
  MN/St. Croix, 16 Lakes Country/Northwoods, 10 Door Peninsula, 42
  Yellowstone, 17 Grand Teton + the Flagg Ranch reach, 20 Teton Valley and
  11 Swan Valley), with
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

  **127 of 181 rivers now have real channel geometry baked into
  `rivers-data.js`**, so the map is correct the moment it loads and correct
  offline — which is the actual use case, a phone in a parking lot with
  patchy service. The runtime snap is now refinement, not the thing
  correctness depends on. The remaining 54 keep anchored placeholder lines
  and still upgrade at runtime when The National Map is healthy.

  Baking it took three attempts and the two failures are worth knowing:
  chaining every NHD segment into one line and keeping the longest run
  stranded the anchors of long rivers (92/144 rejected); replacing the
  cluster step with a flat distance filter then accepted a Coon Creek 18 km
  from the right one. What works is *both* — pick the connected cluster
  nearest the river's own anchors, then keep its segments separate. NHD
  splits a river at every confluence, so those segments then need welding
  where their endpoints genuinely touch: the Salmon arrived as 1,214 pieces
  and 3,004 points, and across all rivers that collapsed from 11,893
  segments to 162 runs, 42k points to 12k.

  Validation is split by anchor type, which both earlier attempts got wrong
  by treating them alike: a USGS gauge sits *on* the channel and is
  authoritative (tight tolerance), while a RAMPS point is a parking area and
  on a system with named forks can legitimately sit on a tributary (loose).

  **`hydro.nationalmap.gov` is periodically unreliable**, and it matters
  because a dropped call leaves a river drawn straight. In the browser the
  failure shows up confusingly as a *CORS error* — an error response from
  the CDN comes back without the `Access-Control-Allow-Origin` header the
  good ones carry, so it looks like a config problem rather than an outage.
  It isn't concurrency: during one episode 5 sequential curl requests
  returned `504, fail, 200, fail, 200`, the same hit rate as 5 parallel
  ones. Retrying genuinely recovers — 4 of 4 failed rivers snapped on a
  second attempt. Hence `NHD_TIMEOUT` is short (9s; a healthy query answers
  in ~1.5s, and a long timeout just parks one of the few slots) and
  `GEOM_SWEEPS` re-runs the queue after it drains.
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
- **Never** hand-enter a gauge coordinate. `GAUGE_POS` comes from the NWIS
  site service (`waterservices.usgs.gov/nwis/site`, `siteOutput=expanded`,
  which takes a comma-separated `sites=` list and is *not* on the
  `api.waterdata.usgs.gov` request budget). 36 of the 182 were once more
  than a kilometre from the station they name and 14 were more than five —
  the North Platte above Seminoe was **52 km** out. This was not a cosmetic
  problem: the hand-digitized river lines were drawn *through* these points,
  so a wrong gauge pulled its river off the channel with it, and
  `nearestGaugedRiver()` measured regional wetness from the wrong place.

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

**Ordered by region, nearest first.** `regionsByDistance()` sorts the
buckets (`west`, `ciowa`, `driftless`, `northshore`, `uppermidwest`, the
park and valley regions, and one `w-XX` bucket per far-western state, from
`regionOfRiver()`) by distance from the map centre, and `paintFlows()` runs
after each one — so the water you're looking at colours in before the rest
of the country is fetched.

**The far-western states batch by state, not by region tag**
(`STATE_BUCKET`: CA, OR, WA, MT, CO, UT, AK, MI, SD, NM, AZ, NV). Every park and every state is
its own `region`, and a bucket holding one gauge still costs its own latest
call and seven history calls; thirty small buckets roughly doubled a cold
load. Yellowstone and Grand Teton keep their own buckets as before.

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
- **`monitoring-locations` names its id parameter `id`.** The other two
  collections take `monitoring_location_id`; this one answers a 400
  `InvalidQuery` — "At least one requested property wasn't found" — to that
  name. Because a failed verify falls through to the unverified default, the
  only symptom was **every gauge on the map reading "(unverified)"**, which
  is exactly the silent failure the verify step exists to prevent. It still
  accepts a comma-separated list, so batching is unaffected. The response
  demultiplexes on the feature's `id`, not on a property.
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
- **Never move the map directly — use `goTo()`.** Leaflet's `fly*`
  animations divide by the container size and run on requestAnimationFrame,
  so in a zero-size container they produce `NaN` and throw "Invalid LatLng"
  (which killed the rest of app.js at startup once), and in a hidden tab
  they simply never finish and the map silently stays put. `goTo()` checks
  both and falls back to an un-animated `setView`/`fitBounds`.

  It also **defers any move made before the container has a size**, which
  is a separate trap: `fitBounds` derives its zoom from the container too,
  and with no width the answer is the whole world — that is how the opening
  chooser once came up as a zoom-0 view of the globe with every zone a few
  pixels wide. A pending move replays on the map's `resize`.
- **The filter chips are gone but their machinery isn't.** The toolbar was
  removed from `index.html` and its listener from `app.js`; `filters{}`,
  `passFilter()`, `riverVisible()` and `applyFilters()` are untouched and
  sitting at defaults (everything visible). Restoring the markup and the
  one listener brings the filters back — don't delete the rest.
- **Zone labels sit over the zone's water, not the middle of its outline.**
  Only the two parks carry a label now, but the rule is what keeps them
  honest and it applied to the states before them: a pole of inaccessibility
  is a shape's geographic middle, which for Idaho was a hundred miles from
  any river on this map. `layoutZoneCards()` prefers the centre of the
  zone's *rivers* when that point is comfortably inside the visible outline,
  and falls back to the pole when it isn't — zoomed into a corner, or the
  water off screen.
- **Park outlines are simplified by tolerance, not by point count.** A park
  boundary is long survey-line straights meeting at sharp corners, and
  even-interval decimation spends its budget on the straights and rounds the
  corners off. 900 evenly-spaced points sat 14 m from the Yellowstone
  boundary on average and **cut its corners by up to 2 km**. Douglas-Peucker
  at 50 m gives **486 points and a 52 m worst case** — better fidelity from
  fewer points, and it halved `zones.js`. `simplify()` in `zones2.py`; it
  splits the closed ring in two so DP can't shortcut across it.

  The same distinction bit the river assignment earlier: the ring used to
  decide *which rivers are in a park* is simplified to 20 m, because a
  coarse ring cut corners hard enough to push a creek that runs along the
  park line out of the park.
- **A zone's name stays inside that zone.** This governs the two park cards;
  the states carry no card at all (see `js/zones.js` above), which is also
  why the collision handling below rarely has anything to resolve now — keep
  it, it is what makes a label safe to add back. `layoutZoneCards()` puts each
  card at the pole of inaccessibility — the interior point furthest from
  any edge — of the part of the zone currently on screen, recomputed on
  every move. A bounding-box centre drifts outside any shape that isn't a
  rectangle, and it leaves the screen entirely when you zoom into one
  corner of a zone. Working on the *visible* part is what keeps the name
  with its zone when you're looking at a corner of it.

  Cards still mustn't stack, so placement chooses among all the roomy
  interior points rather than the single best one — every candidate is
  inside the zone, so dodging a neighbour never moves a name onto someone
  else's water. Three things matter and are easy to get wrong:

  - Candidates must be **spatially spread**. Taking the top N interior
    points by clearance returns N points in the same small neighbourhood
    as the pole itself, and the card then has nowhere to go.
  - The "stay well inside" term is measured against **the room this zone
    actually has** (`Math.min(34, p.room)`), not a fixed ideal. A narrow
    zone whose best point is 20px from an edge would otherwise be pinned
    to that one point and park itself on a neighbour.
  - Cards are **measured, not assumed** — a two-line label ("Minnesota &
    North Shore") is a taller card, and one fixed height under-reserves.

  When a zone is too small at this zoom to hold its name, the card shrinks
  (`tight`, then `mini` with the `short` name) and, failing that, drops out
  until you zoom in — it never moves outside its own boundary to fit. The
  polygon stays drawn and clickable either way.
- **The chooser has to own the clicks while it's up.** Gauge dots and
  access markers sit in Leaflet's marker pane at z-index 600, above the
  zone pane, so a tap meant for a zone was landing on whatever river
  furniture happened to be underneath and opening that river's sheet.
  `body.zones-open` sets `pointer-events:none` on the river panes *and on
  their children* — Leaflet marks every interactive marker and path
  `pointer-events:auto`, and a child that opts back in is hit-tested even
  when its pane says none.
- **The Alaska button sits under Regions while the chooser is up** (`#btn-far`).
  Alaska is outside the opening frame, so without it nobody finds Alaska; the
  button flips between "Alaska ▲" and "Lower 48 ▼" depending on where you are.
- **Park cards drop out at 12% overlap, not 45%**, and parks with mapped water
  are placed before parks without — the Four Corners cards stacked into an
  unreadable pile otherwise. A dropped card comes back one zoom step in.
- **The "◄ Change Region" button (`#btn-zones`) is top-left.** The safety
  panel opens over the top-right corner the moment you enter a zone, and
  it was burying the one control that gets you back out.
- **The flow animation has to be right before it is pretty.** River lines
  carry a dashed overlay whose `stroke-dashoffset` animates, so the dashes
  crawl along the path. Three constraints shaped it:

  - **The overlay follows whatever is drawn, not the baked coords.** The
    drawn line changes under it — snapped to NHD after first paint, refined
    again as you zoom — so orienting by baked run *index* breaks the moment
    a refresh changes how many pieces the river comes in. The baked table
    becomes oriented reference segments once, and the drawn runs are
    oriented by comparing against them.
  - **It runs downstream, or not at all.** NHD linework arrives in whatever
    order the fetch and the welding left it, so direction had to be derived:
    seven elevation samples along every run (Open-Meteo's batch endpoint,
    100 points a call — a build-time step, nothing in the app talks to it),
    least-squares fit of elevation against distance, cross-checked against
    the plain first-to-last drop. Both must agree and the fall must clear
    3 m, or the run is marked `"?"` in `FLOW_REV` and does not animate.
    Then a second pass makes each river internally consistent: a river's
    runs are pieces of one channel, so where one run's end meets another's
    start they must point the same way, and direction is propagated from the
    runs terrain was sure about into the ones it wasn't. That resolved 64
    unknowns and overruled 10 runs terrain had called against their
    neighbours — a river animating in two directions at once is worse than
    one not animating at all. 180 of 875 runs are reversed and 95 stay
    unknown, 2.3% of mapped river length, almost all short braids and flat
    spring creeks.

    **Every river is in `FLOW_REV`, including the all-"0" ones.** Omitting
    those saved 4 KB and silently switched the animation off on 194 rivers,
    because the reader treats a missing river as unknown. Don't re-optimise
    it.
  - **It is budgeted in paths, not rivers.** `FLOW_MAX_PATHS` (80) counts
    the SVG paths actually being repainted each frame. Capping *rivers*
    looked fine until Yellowstone, where 43 rivers are 224 separate runs.
    Runs shorter than `FLOW_MIN_PX` (22 px at the current zoom) are skipped
    — a dash crawling along 15 px of line is noise, not information — and
    nothing animates below `FLOW_MIN_ZOOM` (9), while the chooser is up, or
    under `prefers-reduced-motion`.
  - **Speed only means something where there is a gauge.** The duration
    comes from `statusOf()`'s bucket, so high water visibly runs faster.
    Ungauged water gets `flow-calm`, one neutral pace shared by all of it,
    because a speed that tracked nothing would be a fabricated reading in a
    different costume — the same rule as the "Ungauged" card.
- **A closer look gets a truer line.** The baked geometry is simplified for
  load time — the first NHD snap asks for 0.0006 deg, about 66 m, which is a
  pixel at zoom 8 and twenty-seven of them at zoom 15. From `REFINE_ZOOM`
  (13) the rivers in view are re-fetched at 0.0002 (~22 m) and redrawn, two
  at a time, cached for a month. Not finer: the service will not answer a
  5 m request for a river the size of the Snake, and when it is having one
  of its slow spells it will not answer at all — the refinement just fails
  and leaves the baked line, which is the point of it being an enhancement.

  Two guards on what may be refined, and both matter:

  - **`iadnr` / `widnr` rivers are never refined.** Those lines are a state
    fisheries agency's drawing of the reach that is *designated trout
    water*, which is a different claim from "where the channel runs". NHD
    would replace it with the whole creek, or the wrong Bear Creek.
  - **`nhd` rivers were clipped to a park or state boundary** when baked, and
    a fresh fetch knows nothing about that clip. The refined geometry is
    filtered to what lies within 150 m of the line already drawn, so detail
    is added and reach is never extended. Verified with a stub that returned
    geometry 100 km outside Yellowstone: it was dropped, and the refined
    Lamar still stops at the park boundary.
- **Vector stacking is explicit, via panes.** Everything used to share
  Leaflet's default overlayPane, where paint order is DOM order — and since
  the public land layer is cleared and re-added on every map move, its
  polygons ended up drawn *over* the rivers. `landPane` (390) sits under
  `riversPane` (410), which sits under the markers (600). The white halo on
  the river lines is one `drop-shadow` filter on `riversPane` in
  `css/styles.css`, not a second casing path per river — 181 extra polylines
  would cost real frames on a phone.
- **The icon is generated, not hand-drawn.** A Snell Roundhand capital D
  with a dry fly tied onto the letter: the thread body wraps the D's own
  outer downstroke and the hook bend continues where that stroke ends, so
  the letter's tail *is* the hook. The fly's coordinates were measured off
  the rasterised glyph rather than guessed, so they move if the font or
  size changes. Ground is flat, deliberately: a radial gradient looked
  richer but pushed the 512 PNG to ~256KB against 65KB flat.
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
  `L.layerGroup`s wired into the layer control, **all off at launch** (see
  the icon-layer rules above). Dropping ~280 access pins at every zoom made the map unreadable,
  so `syncMarkers()` also zoom-gates membership — boat ramps from z8, wade
  access from z9 — independently of whether the group is switched on. On a
  Driftless creek "access" means a signed gravel pull-off, not a ramp, which
  is why wade access is the one that defaults on. Zooming to a float section
  switches boat ramps on, since that's an explicit "show me the ramps" move.
- **Public land** is PAD-US (USGS Protected Areas Database) via its
  `PADUS_Public_Access` FeatureServer, fetched per-viewport because the whole
  multi-state set is far too big to ship. Verified working across Minnesota,
  Wisconsin and Michigan — Superior/Chequamegon-Nicolet/Ottawa/Hiawatha
  national forests, state forests, WMAs and AMAs all resolve.

  Shaded by **who manages it** (`padClass()` reads `MngNm_Desc`/`DesTp_Desc`),
  because the manager decides the rules you fish and hunt under:
  `nforest` national forest, `federal` NPS/USFWS/BLM/Corps, `wildlife` state
  WMAs and Aquatic Management Areas, `state` state forest/park, `local`
  county/city, `private` easement or NGO land recorded as publicly
  accessible. `private` is pointedly *not* green: it's someone's land and
  the access can lapse.

  **Every class draws at the same weight** — one `PAD_FILL_OPACITY` and one
  `PAD_WEIGHT`, no per-class values. An earlier version ranked them (faint
  national forest, bold WMA) and that was wrong for this app: fly fishing
  has the most generous access rules of any use of public land, so a
  national forest is no less fishable than a wildlife area and shouldn't
  look it. Colour carries the manager; nothing carries emphasis. If you're
  tempted to re-introduce per-class opacity to stop the big forests
  dominating a wide view, adjust `padMinAcres()` instead.

  Only `Pub_Access` OA (open) and RA (restricted, dashed outline) are drawn;
  closed and unknown parcels are deliberately left off — a closed parcel
  shaded green is worse than no parcel at all. The BWCAW correctly comes
  through as restricted, since it needs a permit.

  Drawn from z8, with `padMinAcres()` raising the minimum parcel size as you
  zoom out (2000ac at z8 down to everything at z12). Without that floor a
  wide view is thousands of half-acre village parks, which is both illegible
  and over the service's record cap.
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
- Adding a new region means touching seven things, as the Door Peninsula and
  Yellowstone passes both confirmed (Yellowstone needed an eighth: the
  `regBody` line, because inside a national park the state agency is the
  wrong authority to name): the `region` field on the rivers; the `subRegion` map in
  `openRiver` (the sheet subtitle); the per-region footer note in
  `renderSheet`; the ungauged-card copy in `noGaugeHTML()` if the region's
  streams aren't gauged — the default text talks about Driftless spring
  creeks and is wrong everywhere else; the zoom gate in `syncLabels()` if
  the streams sit close together; the `REGIONS` quick-jump list; and the
  legend copy in `index.html`. **A new national park is one `PARK_INFO`
  entry** in `app.js` instead of most of that list. A new region does **not** need
  a zone any more — zones are states. If the region is a named place worth
  showing on the map, add it to `REGION_LABELS` in `zones2.py` instead; if
  it brings a new *state* onto the map, add that state's FIPS code to the
  boundary fetch and a line to `STATE_SUB`.
