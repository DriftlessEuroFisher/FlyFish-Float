# River Conditions — ID, WY & Central Iowa Fly Fishing / Float Map

A single-page, no-build, mobile-first web app: a Leaflet map of Idaho &
Wyoming trout rivers plus the Central Iowa (Des Moines area) state water
trail system, with live USGS flow conditions, built for checking "is it
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

56 rivers: 49 Idaho/Wyoming trout rivers (24 ID, 25 WY) plus 7 Central Iowa
water trail rivers (Des Moines River, Raccoon River and its North/Middle/
South forks, South Skunk River, Beaver Creek), each with one or more USGS
gauges. Full list and gauge IDs live in `js/rivers-data.js`; this file
doesn't duplicate it since the code is the source of truth.

The Iowa rivers are warmwater fisheries (catfish, smallmouth bass, walleye,
carp) tied to the official Iowa DNR water trail / paddling system rather
than trout wade-fishing — same data model (gauges, ramps, sections,
goodFlow), different character. They also carry a low-head-dam safety note
in the UI (a real, documented hazard on these rivers) that the ID/WY rivers
don't need.

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

28 of the 56 rivers were pre-filled with starting-point ranges pulled from
public fly shop/guide/paddler reports (each has a short source note in its
comment, e.g. "sweet spot at the Glenwood gauge" or "Skunk River Paddlers
guidance"). These are generic numbers from other people, **not my own
experience** — treat them as a rough first draft and overwrite with your own
numbers as you fish or float each river through the season. The remaining
28 rivers (smaller, less-documented, or wilderness/permit water without
published flow guidance) are still `null`.

**TODO for me:** replace the researched starting points with my own
experience-based numbers over time, and fill in the rest for whichever
rivers I end up fishing most.

## Conventions

- No frameworks, no build tooling — keep it editable by hand.
- USGS gauge IDs are verified at runtime against USGS monitoring-locations
  metadata; unresolved ones show "(unverified)" in the UI rather than failing
  silently.
- River geometry is simplified hand-digitized polylines — not
  navigation-grade. `trickleGeometry()` upgrades to real NHD linework after
  first paint.
