# Feature ideas

A working backlog, refined with Claude as ideas come in — often borrowed from
other apps. Each idea keeps where it came from, what problem it solves *here*
(a phone in a parking lot deciding where to fish), and any decision made about
it. Move an idea to **Done** when it ships, with the commit.

Status: `new` → `refining` → `ready` (agreed spec) → `building` → `done`, or
`parked` / `dropped` with the reason.

## Ideas

**Pilot regions:** *Pilot West* (float features) is Jackson, Pinedale and
the Idaho side — Victor/Teton Valley and Swan Valley. *Pilot Central* is the
NE Iowa Driftless streams plus the Des Moines-area water trails, for field
testing close to home, including wade and hike-in-only water.
National-park features start in Grand Teton and Yellowstone. Expand only
after they've been used for real there. (See CLAUDE.md, "How we work".)

### Usability cleanup from the pilot regions — `ready` (decided 2026-10-09)
A self-review of what someone actually sees on a Driftless creek, the
Jackson Hole rivers and the Des Moines water trails. Theme: **the app says
the same thing three times and buries the one thing that matters.** Build
it after the river focus view / Map Icons / launch-defaults change has
landed (that one is rewriting the same menus and the tour). Build it in
three batches, one per session. Panel changes are pure UI and ship
everywhere at once.

**Decisions made**
- The app's own ranking is renamed so it can't be confused with an agency's
  class. Gold / Class 1 / Class 2 / Class 3 become **Top pick / Worth it /
  Local / Other**. Keep the `tiers.js` keys (`gold`, `"1"`, `"2"`, `"3"`)
  so no data changes. Top pick also needs a colour that isn't gold: gold now
  means "the river you opened" (focus highlight `#e2b33c`, close to the old
  tier `#c79a1c`). Avoid the survey orange, the closure red and the
  trout-class teal, rust and purple.
- The **"All" chip draws "Other" rivers only inside the view, from zoom 8**,
  instead of ~1,000 lines at once.

**Batch A — the river panel** — `done` 2026-10-10, not yet committed (`build-opus-xhigh`: this is how regulations
are displayed). Left over: the lake sheet still has a "Fishing notes" heading; Door's footer repeats the no-gauge note and Great Lakes rules; Door/North Shore "Floating: Wade only" rows unchanged; Top pick green sits close to the Public land chip green.
1. Rename the ranking everywhere: `TIER_INFO`, `TIER_LABEL`,
   `tierChipHTML()` ("Usually Class 1 — …"), the River Filters chips, the
   layer control, tour.js, the legend, any `why` text in tiers.js that says
   "Class", and CLAUDE.md.
2. **One regulations block.** Keep the rules-card tags as the summary. Below
   them goes a single fold, "Regulations", holding:
   - the per-reach class badges with miles
   - the verbatim text per reach
   - the DNR page lines, with repeated sentences shown once (Waterloo
     repeats the "artificial lure means…" definition for each species)
   - the source and the DNR link

   Drop the separate "Trout class & regulations" section. Use the same
   single fold for `parkRegs` rivers.
3. **Driftless access in the card.** On `region:"driftless"` (and
   `doorcounty`), the "Wading & access" row becomes the easement rule: fish
   and walk the stream corridor, don't leave it, park in the marked
   pull-offs. The state streambed law moves into the fold. Remove the grey
   Driftless footer line that duplicates it.
4. **Season row.** If every reach's rule text says "Continuous open season",
   show "Open all year". Drop the empty "Season set by the rules below" row;
   the licence line leads instead.
5. **Rows that tell nothing:**
   - Hide "Floating: Wade only." on Driftless creeks that have no
     `SECTIONS`.
   - The ungauged card becomes one line on Driftless, Door and North Shore
     water: "No gauge on this creek — judge clarity on arrival." The nearby
     river's reading folds underneath, labelled as a different stream. Keep
     the rule that no status badge appears there.
   - Fold `fish` into the description block. There's no separate "Fishing
     notes" heading when it repeats the description's stocking facts.
   - Research becomes one link, "Search for fishing reports ↗". The Reddit
     links stay in the Field Book Research tab.
6. **Multi-gauge rivers** (the Snake has 4, the Raccoon 4, the Des Moines
   3): the primary gauge card comes first, and the rest fold into "3 more
   gauges along the river". Float sections come right after the primary
   gauge, ahead of the notes.
7. **Des Moines water trails:** the low-head-dam warning moves into the
   rules card (state IA, not driftless), out of the footer.

**Batch B — controls and chrome** (`build-opus-high`)
1. Merge "◄ Change Region" and the "Jump to region…" dropdown into one
   control: tapping it opens the chooser, which also lists the jump targets.
2. Map Icons, 11 switches down to 8:
   - **Parking & access**: the wade layer, which carries the DNR P lots and
     fishing access, plus the OSM Parking layer.
   - **Gauges**, with "show every USGS gauge" as an option inside it,
     replacing the separate "All USGS gauges" chip.
   - **Hazards & closures**: falls, rapids & dams plus closed water, both
     safety layers.
   - Unchanged: Boat ramps, Trailheads, Campsites, Bridge access, Public
     land.

   Keep the close-zoom auto icons and focus mode behaving the same through
   the merge.
3. App bar on phones (under 768 px): drop the tagline and keep the title to
   one line. It currently takes about 20% of an iPhone screen.
4. The "All" chip draws Other rivers only in view, from zoom 8 (see the
   decisions above): recompute on `moveend`, using the existing
   `riverVisible()` / `tierShown()` path.

**Batch C — help** (`build-sonnet-high`)
1. The `?` panel becomes a one-screen key: line colours (trout classes and
   what a colour change part-way means), the ranking names, the icons
   including **P**, the gold focus highlight, closures and hazards. The
   current 35 notes move into a fold, "How this data was built", kept
   verbatim. Tour copy is checked against it.

**Check each batch on a phone-sized viewport** with Waterloo Creek, South
Bear, the Snake, the Raccoon and one Yellowstone creek. The test: from a
cold open, the rule and the nearest parking are findable in five seconds
without scrolling past a repeat.

### Rulebook streams, every western state — `building`
Every stream with its own entry in the state's 2026 regulations, one state
per session (CLAUDE.md, "Rulebook streams"). Montana done (93, 7d267c5).
Next: Colorado (163), Utah (~30), then California, Oregon, Washington, and
New Mexico, Arizona, Nevada, Idaho and Wyoming.

### Welcome card and guided tour — `done` (2026-10-07, not yet committed)
Owner's request: welcome new users, say honestly which regions get the most
attention, offer a tour of the header buttons, zoom, location, the left-side
menus and a Snake River panel, and push the report flag (including "want to
keep testing? tell us and we'll build out your home water"). Added from
review: Add to Home Screen (protects the Field Book from Safari's storage
clearing), the ungauged-creek note, and a Map/River split so people can stop
early. Details in CLAUDE.md, "Welcome card and tour".

### Pilot rivers coloured by class — `refining` (raised 2026-10-07)
Owner's question: standardise stream colours in the pilot regions by
category. West rivers will mostly class well; the Central Iowa test rivers
mostly won't. Counts on 2026-10-07: Pilot West 40 rivers (3 Gold, 2 Class 1,
9 Class 2, 26 Class 3), NE Iowa Driftless 65 (6/10/49 in Classes 1–3), Des
Moines water trails 7 (1 Class 2, 6 Class 3). **Class 3 is hidden by
default, so most of Pilot Central is off the map** while it's being field
tested. Proposed, awaiting the owner's answer:
1. Colour pilot rivers by tier (one colour each for Gold/1/2/3).
2. In Pilot Central, show Class 3 muted instead of hidden.
3. Move Iowa's DNR regulation class off the line colour (a chip in the
   panel, maybe a dashed line for restrictive water). This reverses the
   CLAUDE.md rule that trout regulations drive the line colour, but only in
   the pilot regions.

### Float leaderboards — `ready` (decided 2026-10-07; build in a fresh session)
- **Problem:** make floating fun: who has floated the most miles on each river
  around Jackson, Pinedale and Swan Valley, and overall. To be expanded later.
- **Decisions (2026-10-07):** this takes the server branch of *The fork in the
  road*. **Supabase** holds the boards (free tier; the app calls it directly
  from the browser, no build step). Sign-in is an **email magic link**, so
  miles follow you to a new phone. Only a display name is ever shown. The
  "no backend" rule in CLAUDE.md gets rewritten when this ships: the app
  stays static and only the leaderboard talks to a server.
- **Boards:** one per Float Mode river (Snake in Jackson Hole, Teton, South
  Fork, Green; the New Fork once it has sections), plus overall. "This season"
  and "all time".
- **Verified = recorded live in Float Mode.** Before posting, the phone checks
  that the float:
  - started near the put-in;
  - reached at least 90% of the section (`completed`);
  - had no long GPS gaps;
  - had a believable pace.
  Floats saved before this ships carry none of these checks, so they don't count.
- **No coordinates leave the phone.** A post is section, miles, season and
  user. The board never shows dates or times, so it can't tell anyone when
  you're away from home. Posting is opt-in and off by default.
- **Server rules** (Supabase row-level security): you can only write your
  own rows. Also enforce one post per section per day and a cap on miles
  per day.
- **Known limit:** someone who edits the app's code can fake a float. Catching
  that would need GPS tracks on the server, which breaks the location promise.
  That's accepted for a friendly local board.
- **Needs from Matt:** create the Supabase project (about 10 minutes, walked
  through). Only the project URL and the public "anon" key go in the app,
  which is safe because row-level security does the protecting.
- **Caveat:** free Supabase projects pause after 7 days with no traffic
  (off-season) and need a click in the dashboard to wake.

### Regulations first in the river panel — `done` (2026-10-02)
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

#### Offline maps — `done` (ff80c5b) · fit: strong
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

#### State water access laws — `done` (ff80c5b, `js/access-laws.js`) · fit: strong
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

#### Nationwide stream gauges + real-time data — `done` (fe062f7) · fit: strong
- **Already have:** 747 gauges attached to mapped rivers.
- **Proposal:**
  - A layer showing *every* active USGS discharge gauge in view, fetched per
    viewport like public land.
  - Tap a gauge for its live CFS and how it compares with normal, even when
    the river it sits on isn't mapped.
- **Watch:** the USGS request budget of 1,000 an hour. Fetch by bbox from
  zoom 8 and batch the reads.

#### Parking, boat ramps, campsites, trailheads — `building` (ramps + fishing access done 6e1b584; parking, campsites, trailheads to do) · fit: strong
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

#### Enabler: static tiled data — `done` (fe062f7, `makeTiledLayer`) · needed by several items below
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

#### Bridge access points (350k+) — `done` (fe062f7; 129k in the 18 states) · fit: strong (uses the enabler)
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

#### Waterfalls & rapids — `done` (a745121) · fit: strong
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

### Batch 2026-10-06: Float Mode, community access points, phased roadmap

Your own feature list. Half of it fits the app as built; the other half needs
accounts and a server, which CLAUDE.md currently rules out ("no backend").
That is your call to make, not the code's — see **The fork in the road** at
the end of this batch.

#### Float Mode (personal) — `building` (v1 in `js/float.js`, uncommitted 2026-10-06; 19 of 20 sections trace after the agency ramp fix; New Fork sections drafted but unclassed — likely Class I / not whitewater, unconfirmed) · fit: strong for the on-phone parts
- **Problem:** "if I put in here at 9, when am I at the take-out?" — and on
  the water, "am I behind?"
- **Scope (decided 2026-10-06): only rivers around Pinedale WY, Jackson WY
  and Victor ID.** Float Mode is not offered anywhere else.

  | Area | River | Sections offered | Notes |
  |---|---|---|---|
  | Jackson | Snake — Jackson Hole (`snake`) | 7: Jackson Lake Dam → … → West Table | All Class I–II. The canyon below West Table is excluded (see the whitewater rule). |
  | Victor | Teton (`teton`) | 5: Fox Creek → … → Harrops Bridge | All Class I. Hard stop at Harrops; below is Class IV–V. |
  | Victor / Swan Valley | South Fork of the Snake (`southfork`) | 7: Palisades Dam → … → Heise / Lorenzo | All Class I–II. Included as Victor's home float, 30 min over Pine Creek Pass. |
  | Pinedale | Green (`green`) | 1: Warren Bridge → Daniel | Thin: only 2 access points. |
  | Pinedale | New Fork (`newfork`) | 0 for now | A real drift-boat river with no ramps on the map. Needs access points first. |

- **Whitewater rule (decided 2026-10-06): Class III and lower, and no
  whitewater runs.**
  - Float Mode offers only `SECTIONS` whose `klass` is III or lower. A
    section with no `klass` isn't offered.
  - **Snake River Canyon (West Table → Sheep Gulch, `s7`) is excluded.** It
    is rated III, but it is a whitewater trip (Big Kahuna, Lunch Counter),
    not a fishing float. The judgement call: "Class III and lower" lets in a
    Class III riffle on a fishing reach; it doesn't let in a named
    whitewater run.
  - A route can't run past a section's end into harder water, so you can't
    draw your own put-in and take-out across one. Below Harrops on the
    Teton and below West Table on the Snake are never routed.
  - Any section added later must carry a `klass`.
- **Left out on purpose:**
  - Gros Ventre, Hoback, Buffalo Fork, Greys, Flat Creek, Fall River and
    Snake–Flagg Ranch: their `WADE_ONLY` notes say they are wade water or
    hazardous to float.
  - The Salt River (Etna → Alpine): Star Valley is about 35 mi from Jackson
    and isn't "around" any of the three towns. It's easy to add later.
- **Pinedale access points come from Wyoming Game & Fish.** For the New Fork
  and the upper Green, use the WGFD Public Access Area records (the agency's
  own list of where the public may launch and park), checked against BLM
  sites. Each New Fork section gets a `klass` from the same source, or from
  you, before it's offered. Your own put-ins can be added by hand on top.
  No pin is placed from guesswork.
- **Builds on `SECTIONS`.** Each section already has a put-in, a take-out,
  miles, a class, a beginner flag and a `typSpeed` (mph). The first version
  can let you pick a section instead of two arbitrary points, and use
  `typSpeed` as the baseline estimate before you launch.
- **Proposal:**
  - Tap a put-in and a take-out (snapping to `RAMPS` / OSM access points, or
    any point on the line). The route is the river's own drawn line between
    them, measured along the channel.
  - Live GPS progress: miles done, miles left, ETA at the take-out, using
    your actual pace so far, with stops (no movement for a few minutes)
    taken out of the pace.
  - **Baseline ETA before you launch:** craft speed (drift boat, raft,
    kayak, pontoon) plus a flow factor from the gauge's `statusOf()` bucket.
    Shown as **"estimate"**, never as a measured speed — USGS gauges report
    discharge, not velocity, so a "current speed" number would be
    fabricated.
  - Each finished float is saved to the Field Book (date, reach, gauge CFS
    that day, time on water, stops). Your own history then replaces the
    baseline for that reach at a similar flow.
- **Already have:** river geometry, access points, live CFS, Field Book
  storage, the location dot.
- **Watch:**
  - **A web app gets no GPS with the screen off.** iOS stops `watchPosition`
    when the phone locks or the app is backgrounded. Logging works with the
    screen on (a "keep awake" option via the Wake Lock API), and gaps are
    filled by the next fix. True background tracking needs a native app
    (see *Distribution* below).
  - **Routing has to cross gaps honestly.** `coords` comes in pieces; a lake
    or millpond in the middle of a float is real, and the distance across it
    should be measured as lake, not stitched as river.
  - GPS logging with no signal already works — the GPS chip doesn't need
    service. "Syncs when service returns" only matters once there is a
    server to sync to.
- **Depends on:** nothing new for the personal version.

#### Shuttle times — `new` · fit: medium
- **Proposal:** drive time between put-in and take-out on the Float Mode
  card.
- **Watch:** routing needs a directions service — OpenRouteService has a free
  key, others are paid (see *Places and routes* below). A key in client code
  is public. Until then: straight-line distance plus a "Directions" link that
  opens Apple/Google Maps between the two pins, which costs nothing.

#### Float plan sharing + late-arrival alert — `new` · fit: split
- **Now (no server):** "Share float plan" opens the phone's share sheet with
  a text: river, put-in, take-out, launch time, expected take-out time, a
  map link to each. The person you send it to *is* the alert.
- **Later (server):** an automatic text or push if you haven't checked in by
  a set time. That needs a server that runs on a timer and can send
  messages — it can't be done from a page on a phone that may have no
  signal.

#### Community access points with on-site verification — `new` · fit: needs a server
- **Proposal (as written):** user pins with type, craft, parking, land
  status, photos, notes → Unverified; 2–3 independent verifiers physically
  within ~100 yd → Verified; Disputed on disagreement; last-verified dates,
  re-verify prompts, report a problem; reputation, rate limits, badges.
- **What is good about it:** the GPS-on-site rule is the right shape —
  it is the only verification that actually means "someone stood there".
- **Watch:**
  - **A browser can't prove where it is.** Location from a web page can be
    faked from the developer tools in a minute. On-site verification raises
    the bar; it doesn't make it secure. A native app is harder (not
    impossible) to fool.
  - **Trespass is the real risk.** A wrong pin on private land sends people
    onto someone's property under this app's name. Quick-hide on report and
    a landowner removal path are not optional extras — they ship with the
    first public pin or the feature doesn't ship. The PAD-US layer already on
    the map is the land-status cross-check.
  - Accounts, moderation and stored photos mean personal data, a privacy
    policy, and someone (you) on the hook for takedown requests.
- **Now (no server):** your own pins, on the phone, with the same fields
  (this is the **Waypoints with photos** idea above, given access-point
  fields). They feed Float Mode just the same.

#### Pooled float tracks, AI ETA, main-channel mapping, stop heat maps — `parked` · needs a server and users
- Needs many people's real floats before any of it means anything; with one
  user it's your own history, which Float Mode already uses.
- **Privacy design in the list is right and should stay attached to it:**
  opt-in only, trim the first and last ~quarter mile of every track (that's
  where someone's house or truck is), and never show an aggregate built from
  fewer than N floats.

#### Conditions additions — `new` · fit: strong (mostly free sources)
- **Gauge height:** USGS 00065, same batched calls. Worth showing *beside*
  CFS, never instead — status still needs discharge (CLAUDE.md, Always/Never).
- **Water temperature:** USGS 00010 where the gauge reports it. Also the
  trout-stress cue (warm afternoons in August).
- **Weather & wind:** National Weather Service API, free, no key — forecast,
  wind and gusts at the river's midpoint.
- **Clarity outlook:** no source measures it. A rising-flow-after-rain
  heuristic could be offered **labelled as a guess**, or left out. Clarity
  on arrival is still the honest answer (same as the Driftless rule).
- **Hatch charts:** need a sourced table per region (see *Content* below).
- **Already have:** flow, regulations, closures, falls/rapids/dams.

#### Logistics & on-the-water additions — `new` · mostly covered elsewhere
- Land ownership: PAD-US (done); owner names are the paid parcel layer below.
- Camping/lodging: see *Parking, boat ramps, campsites, trailheads* above.
- Fly shop links: see *Fly shops & retailers* above.
- Fishing log / auto-filled journal / personal stats: the Field Book, extended
  — a catch entry can auto-fill river, date, gauge CFS, water temp and
  weather from what the app already fetched. On the phone, no account.
- Fly recommendations: see the *AI fly box* batch above.
- Hazard pins: your own, on the phone (waypoints); shared ones need the server.
- Gear checklists: on the phone, trivial, low value — `parked`.

#### Later: AI "where should I fish today", crowding, guide profiles — `parked`
- "Where today" works with your own Claude key on the phone, over live
  flows, seasons, tiers and your Field Book — see *AI* below.
- Crowding needs pooled data or a paid source. Guide/outfitter profiles are
  a business directory, not a fishing-map feature.

#### The fork in the road (decision for you)
Your phased roadmap is sound in its ordering — each phase does supply the
next. The catch is Phase 3: **accounts and cloud sync are the moment this
stops being a no-backend app**, and the "Always keep this no-build,
no-framework, no-backend" rule in CLAUDE.md would have to change. Two ways
to go:

1. **Stay single-user.** Do Phases 1–2 fully (they fit as built), plus the
   on-phone versions of 3–5 noted above. The app stays a free static site
   with nothing to run, secure or moderate.
2. **Add a small server** (Supabase / Cloudflare — see the top of the
   section below). Unlocks community pins, sync, alerts and pooled data, and
   brings accounts, privacy duties, moderation and a running cost.

Suggested next step either way: **Float Mode (personal)**, scoped to Pinedale / Jackson / Victor — it is the
biggest new feature that needs no decision on the above.

**Where the roadmap stands today:**
- Phase 1 (foundation): map, live USGS, regulations, offline maps — done.
  Local fishing log — partly (Field Book has notes and fished dates, not
  catches). Data model for floats / catches — not yet.
- Phase 2 (Float Mode, personal) — not started.
- Phases 3–5 — blocked on the fork above.

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

- **Iowa state water trails + ICON central Iowa trails, with float sections**
  (2026-10-10, not yet committed). 34 trails, 200 DNR sections. Start float is
  offered on Beginner/Intermediate sections with no dam, canoe or kayak only.
  Follow-ups: apply brochure ratings to the 110 "Not Rated" sections; the
  doubled "DNR: Beginner" + "Beginner-friendly" badge (Batch A of the
  usability cleanup); the low-head-dam note now fires on every Iowa water
  trail (Batch A item 7 applies statewide).

- **Location pop-up + auto-start, collapsible Rivers/Map layers menus, zoom bottom-right, park cards hidden below z6** (cbe940a).

- **Field Book**: favourites, fished, notes, Research links (Reddit/web search), export/import; extensible `BOOK_SECTIONS` tabs (2026-10-02).

- **Live location dot + follow mode** (2026-10-02).
- **Double-tap zoom, one-finger zoom, two-finger tap out, smoother pinch**
  (2026-10-02).
- **"Read me first" banner moved into the ? panel** (2026-10-02).

## Dropped

- **Map rotation:** Leaflet can't rotate the map.
