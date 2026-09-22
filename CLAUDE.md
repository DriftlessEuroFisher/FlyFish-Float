# River Conditions — ID, WY, Central Iowa & the Driftless — Fly Fishing / Float Map

A single-page, no-build, mobile-first web app: a Leaflet map of Idaho &
Wyoming trout rivers, the Central Iowa (Des Moines area) state water
trail system, and the trout streams of the Driftless Area, with live USGS
flow conditions, built for checking "is it worth driving out today?"
from a phone.

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

128 rivers across three regions. Full list and gauge IDs live in
`js/rivers-data.js`; this file doesn't duplicate it since the code is the
source of truth. Rivers carry a `region` field — `"driftless"` on the new
ones, absent on the original western rivers, `"ciowa"` conceptually for the
Des Moines water trails (the code tests `state==="IA" && region!=="driftless"`
so the central Iowa entries didn't need editing).

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

**All 72 Driftless rivers are `null`.** That's on purpose, not an oversight:
published CFS guidance barely exists for streams this small, and on a creek
running single-digit to low-double-digit CFS a made-up range would be worse
than none. On Driftless water, **clarity is the number that matters** —
judge it on arrival. The ungauged card in the UI says exactly this.

**TODO for me:** replace the researched starting points with my own
experience-based numbers over time, and fill in the rest for whichever
rivers I end up fishing most — starting with the Driftless creeks I actually
get to, where the 19 real gauges (Waterloo Creek, Bloody Run, Black Earth,
Silver Creek at Angelo, Stillwell, the Kinni) sit right on the water and so
are worth calibrating first.

## Conventions

- No frameworks, no build tooling — keep it editable by hand.
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
  ≥ 10 for Driftless ones, because the coulee creeks sit almost on top of
  each other and 72 labels at regional zoom is soup.
- Adding a new region means touching five things: the `region` field on the
  rivers, the state-name map and `regBody` in `openRiver`/`renderSheet`, the
  `REGIONS` quick-jump list, and the legend/safety copy in `index.html`.
