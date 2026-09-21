# River Conditions — Idaho & Wyoming Fly Fishing Map

A single-page, no-build, mobile-first web app: a Leaflet map of Idaho & Wyoming
rivers with live USGS flow conditions, built for checking "is it worth driving
out today?" from a phone.

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

49 rivers across Idaho (24) and Wyoming (25), each with one or more USGS
gauges. Full list and gauge IDs live in `js/rivers-data.js`; this file
doesn't duplicate it since the code is the source of truth.

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

Each river in `js/rivers-data.js` has a `goodFlow` field, currently `null`
for all 49 rivers:

```js
goodFlow: null, // TODO: set {min:___, max:___} (CFS) for YOUR good-flow range
```

When set to e.g. `{min: 700, max: 1400}`, the flow card for that river's
primary gauge shows an extra "✓ In your good-flow range" / "Outside your
good-flow range" badge, on top of (not replacing) the relative status above.

**TODO for me:** fill these in over time for the rivers I actually fish,
based on my own experience — not generic guide advice. Leave the rest `null`;
the app works fine without them. Rivers I fish most and should prioritize
filling in first: _(add here as I decide)_.

## Conventions

- No frameworks, no build tooling — keep it editable by hand.
- USGS gauge IDs are verified at runtime against USGS monitoring-locations
  metadata; unresolved ones show "(unverified)" in the UI rather than failing
  silently.
- River geometry is simplified hand-digitized polylines — not
  navigation-grade. `trickleGeometry()` upgrades to real NHD linework after
  first paint.
