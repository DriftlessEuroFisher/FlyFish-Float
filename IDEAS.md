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

### Usability cleanup from the pilot regions — `done` (A 00b7a56, B 1d72473, C d725b45; 2026-10-10)
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

**Batch A — the river panel** — `done` 2026-10-10 (`build-opus-xhigh`: this is how regulations
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

**Batch B — controls and chrome** — `done` 2026-10-10 (`build-opus-high`). Left over: the first REGIONS group (Statewide view … Boise / Payette) and the Wyoming entries (Pinedale, Cody, Wind River, Saratoga) have no heading in the jump list; in the tour, the Change Region step shows the button with the chooser hidden, so the jump list it mentions isn't on screen.
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

**Batch C — help** — `done` 2026-10-10 (`build-sonnet-high`). Left over: the key's teal "Wild trout (IA, WI I)" row shortens Iowa's "fingerling stocked or natural reproduction"; the closed-water swatch doesn't pulse like the map.
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
per session (CLAUDE.md, "Rulebook streams"). Montana done (93, 7d267c5),
Colorado done (181, 29dc687), Utah done (39, 2026-10-13, uncommitted). Next:
California, Oregon, Washington, and New Mexico, Arizona, Nevada, Idaho and
Wyoming.
- **Utah, for the owner to decide:** whether to build the streams named only
  inside other entries (Dolores, Dirty Devil, lower Duchesne, Brush Creek,
  San Rafael, the Huntington and UM Creek forks…, full list in
  `west2/skipped_ut.txt`), and whether to add season windows on four
  reach-qualified closures (Swan, Duck Fork, Gooseberry, Otter Creeks).
  Fix `priceriver` and `strawberryriver` sheets (see CLAUDE.md).

### Lake depth charts — `new` (raised 2026-10-14)
**Proposal:** a depth chart on the lake sheet for the main lakes in the pilot
regions, then the same for other regions once it has been used for real.
Follows the pilot rule in CLAUDE.md: build and refine it in the pilot
regions first.
- **Why it fits:** on still water, depth is what the fish are doing. The lake
  sheet today has no gauge and no CFS (ice-off, temperature and wind decide
  the day), so depth is the one fixed fact about a lake worth having on a
  phone at the ramp.
- **Phase 1 — pilot lakes.** *Pilot West:* the lakes in and around Jackson,
  Teton Valley and Swan Valley. *Pilot Central:* the main lakes near Des
  Moines, plus any NE Iowa Driftless impoundments. *Parks:* Yellowstone Lake
  and the other Yellowstone and Grand Teton lakes. Which lakes count as
  "main" is the owner's call. **Not yet checked** which of these are in
  `LAKES` today (the 31 are Yellowstone's nine, Crater Lake and nine
  Idaho/Montana/Utah/Colorado/Oregon reservoirs), so some may need adding
  first.
- **Phase 2 — everywhere else,** one region at a time, after a week of real
  use of phase 1.
- **Open questions (nothing researched yet):**
  - **Source per lake.** Depth data comes from state agencies and the parks,
    and coverage will be uneven. Look for each state's lake bathymetry or
    contour layer first, and for a lake with none, show no chart rather than
    a guess. Same rule as "never fabricate a flow number".
  - **Form:** contour lines drawn on the lake outline, a shaded depth ramp,
    or a numeric strip (max and mean depth, depth at the ramp). The shaded
    ramp is probably the most legible at phone size.
  - **Storage:** a chart per lake is too big for `rivers-data.js`. The
    static tiled-data approach (`data/<layer>/`, `makeTiledLayer()`) already
    handles this and works offline through `sw.js`.
  - **Layer:** its own chip under Map Icons, or part of the lake sheet only.
  - **Datum and date:** water levels move and reservoirs draw down, so the
    sheet should say what level the soundings were taken at and the survey
    date, with the source credited.
- **Iowa DNR has bathymetry** (found 2026-10-15): Fishing Atlas MapServer
  layer 1, "Bathymetry (selected lakes)". Big Creek Lake (BIC77) has 33
  contour lines at 10 levels, 5–50 ft; the DNR page gives 51 ft max (2019).
  Saylorville has none there. A good first source for Pilot Central.
- **Related:** *Thousands of trout lakes* (the wider lake list) and *3D
  maps* (hillshade). A depth layer would sit on the same lake outlines.

### Bridge access: only bridges over mapped water — `new` (raised 2026-10-14)
**Proposal:** the bridge layer should mark only bridges that cross a river or
stream that is on this map. Follow-up to *Bridge access points* (done,
`data/bridges/`).
- **Why:** the layer holds 129,214 bridges in the 18 states, kept by "route
  over a waterway, open, public". That includes every bridge over a creek
  nobody fishes here. On a phone, a pin that isn't on one of this app's
  rivers says nothing about where to go, and it hides the ones that are.
- **Today:** the build (`~/.cache/flyfish-osm/bridges/build.py`) filters on
  the NBI record alone and drops canals, ditches, drains, spillways and
  laterals. It never looks at the drawn river lines.
- **Open questions (not decided, nothing built):**
  - **Where to filter:** at build time (smaller tiles, but a new river means
    a rebuild) or at draw time against the rivers in view. The 4,000-tile
    cap and the offline cache favour build time.
  - **"Part of the map":** the drawn line (geometry runs 22–80 m off the
    real channel in places) or a distance from it. The ramp and parking
    builds use 300–400 m. NBI coordinates are the structure's, so pick a
    tolerance, then check it on a handful of known bridges.
  - **Lakes:** do bridges over mapped lakes count, or rivers only?
  - **Rivers that aren't the focus:** with Class 3 rivers hidden by default,
    do bridges over those still show? The simplest reading is that any
    mapped river counts, tier or not.
  - **Naming:** NBI "feature carried/crossed" names are messy. Matching by
    name alone is unsafe (Clear Creek and Pine Creek repeat all over), so
    use distance.
- **Check after:** count bridges before and after per state, and spot-check
  a few rivers in the pilot regions (Jackson Hole, the NE Iowa Driftless,
  Des Moines) to confirm the access bridges people use are still there.

### Fished more than once, lake trips with a breadcrumb track, and Field Book pages — `refining` (raised 2026-10-14; privacy, screen-on and forecast decided)
Four connected parts. Build them in this order, one per session.

**1. "Fished" works every time.** — `done` (be70c8e, 2026-10-15; past trips can be logged after the fact, with no conditions) — all regions (pure UI and storage, so per
the pilot rule it ships everywhere at once)
- **Today:** the button is a toggle. `fbState.rivers[id]` holds
  `fished:true` and one `fishedOn` date (`fbSet`, app.js), so a second trip
  overwrites the first and a second tap un-fishes it.
- **Wanted:** each tap on a river or lake records **one trip** with the date
  *and time*, plus the conditions (part 2). The button then reads something
  like "Fished 3× · last Oct 12", and the Field Book keeps every trip.
- **Data:** a `fbState.trips` list beside `fbState.floats`, each
  `{id, kind:"river"|"lake", water, start, end?, craft?, ramp?, track?,
  conditions?, note?}`. Existing `fished` + `fishedOn` migrate to one trip
  with a date and no time. **No export of trips** (decided, below), so there
  is no import merge to write. `fbState.v` is checked as `1` on load, so
  bump it deliberately or a phone's saved Field Book won't load.
- **A mistaken tap needs an undo** now that a tap adds something: a short
  "Added — Undo" toast, plus delete and edit (date/time, note) on the
  water's page. Also decide whether a trip can be **logged after the
  fact** with a date and time picker. If so, conditions can't be a snapshot
  of now (see part 2).

**2. Conditions saved with each trip.** — `done` (368c996, 2026-10-15;
built as `t.cond` + lake `t.wtUser`, see CLAUDE.md Field Book; a forecast
that loads after the tap is filled in only within the hour, this session)
Temperature, wind, sky and so on, taken at the moment of the tap.
- **Reuse what exists:** the wind & weather card already pulls the NWS
  hourly forecast for the river or lake (`api.weather.gov`, cached 30 min).
  A trip stores a small snapshot from it: temp, wind speed and direction,
  sky. **No gusts**, because the feed doesn't carry them.
- **Rivers:** also store the primary gauge's CFS, its status bucket and the
  gauge water temperature, under the same 24-hour freshness rule as the
  sheet. An ungauged creek stores none, and that is correct.
- **Lakes have no gauge**, so no water temperature unless the user types it
  in. An optional field is cheap.
- **DECIDED 2026-10-14: the NWS forecast for that hour is enough.** The
  owner doesn't need it detailed. Label it as the forecast, not a measured
  reading, and keep it small (temp, wind, sky). No station observations.
- **Never backfill with now.** A trip logged after the fact shows
  "conditions not recorded" rather than today's weather.

**3. Trips with a breadcrumb track, on lakes and on rivers** — modelled on
Float Mode (`js/float.js`).
**DECIDED 2026-10-14: the first release covers only the pilot lakes in
Central Iowa and Pilot West.** Not Yellowstone, and not the other regions,
until it has been used for real there. Parts 1 and 2 ship everywhere.
- **Pilot West lakes already mapped** (in `LAKES`): in Grand Teton, Jackson,
  Jenny, Leigh, Phelps, Taggart, String, Two Ocean, Emma Matilda, Bradley,
  Swan, Bearpaw and Elk Ranch Reservoir; and Soda Lake. Which of these
  count as "pilot" is the owner's call. Henrys Lake (Island Park, ID) is
  mapped but not in the listed pilot area.
- **Central Iowa: Big Creek Lake and Saylorville Lake** (owner's pick,
  2026-10-14). **Added 2026-10-15** (uncommitted): `bigcreeklake` and
  `saylorvillelake` in `LAKES`, 56 Iowa DNR access pins carrying `lake:`,
  and a `PARK_INFO.iowa` row (CLAUDE.md, "Central Iowa lakes"). Ramp choice
  for the trip planner can read `RAMPS.filter(p => p.lake === id)`.
- **River tracks** (below) follow the same limit: start with the Pilot West
  float rivers and the Central Iowa water trails, not every river.
**DECIDED 2026-10-14: river trips get a track too**, so a user can see where
they floated before. Lakes and rivers share one recorder, one stored track
format and one page layout; they differ only in what the page draws under
the track.
- **Flow:** the lake sheet gets a **Start fishing** button next to Fished.
  A planner asks **ramp** (launch point) and **craft** (canoe, kayak, boat,
  float tube, shore). A live panel runs and records the track. **End**
  saves the trip. Ramp choices come from the ramp pins near the lake.
  **Not checked:** whether lakes have pins today. If not, offer the nearest
  mapped access, else "other" and the start position.
- **Rivers (decided).** The trip button on a river sheet starts the same
  recorder, asking **craft** (drift boat, raft, canoe, kayak, float tube,
  wading, bank) and **put-in**. On a float section it is the existing
  **Start float**, and the two should become one flow, not two buttons that
  each record a trip.
  - **Float Mode logs `{t, a}` today** (time, fraction along the section)
    and stores no coordinates. With location storage now allowed, new floats
    keep real coordinates as well. **Keep `a`:** it is what drives the
    ETA, miles done and the medians from past floats. Floats already saved
    have no coordinates, so draw them as a stretch of the river line
    between their start and end fractions rather than dropping them.
  - **Show the track over the river line.** On a river most of the value is
    the **stretch** covered, not the squiggle: a drift boat's track is
    the river. So the river page also shades the river line by how many
    trips covered each part, which gives a "floated / not floated" view.
  - **Wading is a different track.** A wading or bank trip is a walk along
    one bank, often in a canyon where phone GPS drifts tens of metres.
    Record it, draw it, and don't claim more precision than the phone has.
    Stops matter most here (the run someone fished for an hour).
  - **Only rivers with a drawn line can be shaded** against it. Rivers
    drawn in pieces (`coords` as a list of pieces) must be handled through
    `flatCoords()`, and a gap in the line must not become a covered stretch.
- **Track:** latitude/longitude samples with a time, thinned by distance so
  it stays small, drawn as a line. Record when the phone was **stopped** too,
  since stops are where the fishing happened.
- **DECIDED 2026-10-14, privacy: the app may store location.** A lake has
  no line to project onto, so a lake track keeps real coordinates. The user
  is told **it is stored on their phone**, and the wording must not promise
  "never sent". **DECIDED 2026-10-14: trip and track location will be stored
  in the Supabase database, which the owner will build out later** (see the
  *Server roadmap*, which needs login first). So:
  - **Now:** tracks live on the phone only, in the Field Book. Change the
    "coordinates are never stored or sent" wording in the location card, the
    tour, the legend and CLAUDE.md to say what is true: **location for lake
    trips is saved on this phone.** The plain location dot still stores
    nothing.
  - **Later, in Supabase** (the same project as the report form,
    `kbdrxtyacmihabwadzzz`): needs the user signed in (*Server roadmap* step
    1, Supabase Auth), and the sentence updated to say what leaves the
    phone. Don't upload anything before that wording exists. Rules for the
    tables, to settle when they are built:
    - **Not the report form's policy.** `reports` is insert-only so the
      public key can never read anything back. Trip tables must be
      **read and written by their owner only** (row-level security on
      `auth.uid()`), because a track shows where someone fishes. Every table
      needs an explicit `grant` (this project grants nothing by default).
      Never put the service_role key in the app.
    - **Size:** a track is many points. Store one row per trip with the
      thinned line as one compact value (the app already uses encoded
      polylines for rivers), not one row per point.
    - **Phone first, then sync.** The phone stays the working copy, so a
      trip recorded with no signal is kept and uploaded later, and the
      Field Book works signed out. Decide how a trip is matched between
      phone and database (the trip `id` already planned) and what wins on
      a conflict.
    - **Open decisions:** whether upload is automatic for signed-in users or
      per trip; whether any of it is ever visible to other users (private,
      or pooled as anonymous fish data, which the parked "pooled float
      tracks" idea assumes); and delete: a user can delete a trip and
      **delete my account** removes their tracks.
    - Until then, trips stay on the phone only, and with Export removed a
      phone has no backup. The database is what would fix that.
  - **DECIDED 2026-10-14: no export for now.** Users can't export their
    data yet, so trips, tracks and the trip image are **not** added to the
    Field Book export, and there is no "save as image" or share button on a
    lake or river page. It may come back later, and it should come back
    with a note that the file shows where someone fishes. **The existing
    Field Book Export button was removed 2026-10-14** (Import of old files
    still works), so the phone holds the only copy of a user's Field Book.
- **iPhone limits. DECIDED 2026-10-14: force the screen on while tracking**
  (the Wake Lock `float.js` already uses, but not an option the user can
  untick here). A web app is not given location once the screen locks or the
  app is backgrounded, so tell the user once when they start: keep the app
  open, the screen stays on, and switching apps or locking the phone pauses
  the track. Re-request the lock when the app returns to the foreground,
  since iOS drops it. Draw gaps as gaps, not as a straight line across the
  lake. Battery is a real cost on a long day, so say so.
  **Storage:** `localStorage` is small, and many long tracks may not fit.
  Thin hard, and consider IndexedDB for tracks. Not measured.

**4. The Field Book as pages.** The user's idea: each water fished adds a
page they can flip through.
- **Front page** keeps the stats: trips, waters fished, days on the water,
  distance paddled or motored, this year against all time, most-fished
  water, longest trip, a count by region. The existing tabs (Favourites,
  Fished, Notes, Research, Offline, Floats) stay reachable from it.
- **One page per river or lake fished,** flipped by swipe or arrows, in
  order of most recent trip. The page is built from `BOOK_SECTIONS`, which
  is the extension point for this.
- **Lake page:** an image of the lake outline with **every trip's track
  drawn together**, and a list of trips by date and time with craft, ramp
  and conditions. **Tap a trip** and its track highlights while the others
  fade. **Tap off it** and all tracks show again, so the user sees where
  they have been and where they haven't.
- **River page (decided: has tracks):** the river drawn as a line with every
  trip's track over it, and the list of trips with date, time, craft,
  conditions and the gauge reading at each. Tap a trip and its track
  highlights; tap off and all tracks show. Shading by stretch (above) shows
  which sections are fished most and which have never been.
- **The image:** draw the lake outline and tracks on a canvas from the data
  already in the app, not a screenshot of map tiles. That works offline, so
  it is legible in the parking lot. It is view-only for now: no save or share
  (see the export decision above).

**More detailed ways to show a lake** (the user asked for ideas). None of
this is decided:
- **Unfished water:** on a lake, shade the part farther than, say, 100 m
  from any track. On a river, the same idea is the unshaded stretches of the
  line (never floated or waded). This is what answers "where haven't I been?", so it is
  probably the first one to build.
- **Colour the track** by speed (paddling, trolling, drifting, stopped) or
  by time of day.
- **Mark stops** as dots sized by minutes stopped.
- **Filter the page** by season, craft, wind or temperature band, so "my
  tracks on windy days" is one tap.
- **"Fish on" marks:** an optional one-tap marker dropped where a fish was
  caught, kept separate from the track. This is what turns the aggregate
  into "where to find more fish". It is an extra tap while fishing, so it is
  optional.
- **Compare two trips** side by side with their conditions.
- **Depth underneath,** once *Lake depth charts* above exists, so tracks sit
  on contours.

**Open questions for the owner:** what goes to the database and who can see
it (above); which Pilot West lakes are in the first release (Central Iowa is
Big Creek and Saylorville); whether Start float and the new river
trip button become one flow (proposed: yes); and where the Big Creek and
Saylorville outlines and rules come from, since neither is mapped yet.
**When built,** this touches location and storage,
which the project rules class as the careful tier. Plan it at Max and build
it at xhigh.

### Welcome card and guided tour — `done` (5327238, 2026-10-07)
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

### Server roadmap: accounts, community access points, admin — `refining` (raised 2026-10-13)
**Source:** the owner's eight-step list. It has two purposes: build the app
out, and **learn skills reusable for small-business client tools**. So each
step ends with a short "what we did and why" note in `supabase/README.md`
(RLS, auth flow, storage policies, deploy), written so it can be lifted into a
client project. Claude explains the reasoning as it builds. One step per
session, finished before the next (CLAUDE.md, "How we work").

**This consolidates and supersedes** *Community access points with on-site
verification*, *Top-rated access areas* (viable now that there are accounts)
and the account half of *Angler profile*. It is the shared base for *Float
leaderboards*, which reuses step 1's login and profile instead of building
its own. *Waypoints with photos* stays a separate, on-phone-only idea.

**Decisions this takes (the "fork in the road", branch 2):** the app gains a
small server, so CLAUDE.md's "no backend" rule is rewritten when step 1
ships: the app stays a static, no-build site, and only accounts and
community content talk to Supabase. **The signed-out app stays fully
usable.** Login is needed only to submit, rate, verify or post. The Field
Book stays on the phone.

**Already in place:** a Supabase project (`kbdrxtyacmihabwadzzz`), the
publishable key in `js/config.js`, the insert-only `reports` table, the
keep-alive workflow and a `supabase/` folder of SQL files. **Reuse the
project; don't create a second one.** Remember the project grants no table
access by default: every table needs an explicit `grant` plus RLS.

**Refinements to the order.** Steps 1–8 stay in the owner's order, with one
recommendation:
- **Step 4 (deploy and domain) should be decided first, even if built
  later.** Supabase's login redirect URLs and the email sender both need the
  final domain, and every origin change costs users their on-phone data
  (see step 4).

#### 1. Login and profiles — `ready`
- **Supabase Auth, email only.** Sign-up, login and logout from one form.
  **Recommend a 6-digit email code, not a clickable magic link.** On an
  iPhone, a link in the mail app opens Safari, and a home-screen web app has
  separate storage from Safari, so the session would land in the wrong place
  and the installed app would stay signed out. A code typed into the app
  avoids that. Email + password is the alternative; it means we store and
  reset passwords. Owner to choose. Google/Apple sign-in is later.
- **Profile:** a `profiles` table keyed to the auth user: `display_name`,
  `created_at`. Created by a database trigger on sign-up. **Only the display
  name is ever visible to other users; the email never is.** Owners can edit
  their own row only (RLS).
- **UI:** an account button in the header beside the Field Book; a sheet for
  sign-in, profile and sign-out. Include **delete my account** (privacy,
  and a skill clients will ask for).
- **Session:** `supabase-js` from a pinned CDN script (no build step), or
  plain `fetch` like the report form. `sw.js` must not intercept Supabase
  calls.
- **Teaches:** auth flow, RLS, triggers, why the anon key is safe.
- **Builder:** `build-opus-xhigh` (login and permissions).

#### 2. User-submitted access points — `refining`
- **Table `access_points`:** `id`, `user_id` (default `auth.uid()`),
  `river_id` (nullable), `name`, `lat`, `lng`, `type` (launch, parking,
  bridge, wade access), `notes`, `status`, `created_at`. RLS: read what is
  visible; insert as yourself; edit or delete your own while unverified.
- **Pick the location by tapping the map or "use my location"**, then snap to
  the nearest mapped river within a stated distance (the existing
  nearest-river logic) and **check the point against PAD-US**. Warn when the
  land is private or unknown.
- **Trespass is the real risk** (from the earlier community-pin note), so
  these ship with the first public pin, not after it:
  - Report button on every pin; hide automatically after N reports.
  - A landowner removal path (an email link).
  - Short community guidelines and terms.
  - Rate limits per user per day, and CAPTCHA on sign-up.
- **Moderation before step 8 exists:** new pins are `pending`, visible only
  to their author and to you. Approve them in the Supabase dashboard until
  the admin view is built.
- **Verification** (needed by step 7's emails) is its own sub-design: 2–3
  other users within ~100 yd on site, Verified / Disputed, last-verified date.
  A browser can't prove where it is, so this raises the bar and isn't
  security. Decide the rules before step 7.
- **Builder:** `build-opus-xhigh` (permissions, a costly mistake).

#### 3. Photos — `refining`
- **Supabase Storage bucket**, path `{user_id}/{access_point_id}/{uuid}.jpg`;
  table `photos` (`access_point_id`, `user_id`, `kind`: launch / parking /
  bridge, `path`, `created_at`). Storage policy: you may write only inside
  your own folder; cap the file size and allow images only.
- **Resize on the phone before upload** (canvas, about 1600 px, JPEG).
  Redrawing on a canvas also **strips EXIF, which carries GPS**, so a photo
  can't leak where someone lives. State this on the upload button.
- **Free-tier limits:** 1 GB storage and 5 GB a month of downloads, which
  shapes how large photos can be. `sw.js` shouldn't cache them heavily.
- Photos are `pending` like pins, with a report button, and admins can
  delete one.
- **Builder:** `build-opus-high`.

#### 4. Deploy: Vercel, private repo, custom domain — `refining` (needs the owner's call)
The app is a static site today on **GitHub Pages at a sub-path**, with every
URL relative. Findings that change the plan:
- **Moving origin costs users their phone data.** `localStorage` (Field Book,
  floats, welcome flag), the offline tile cache and the home-screen install
  are all per origin. A new domain means export, import and reinstall. **Do
  it once, early, before more testers accumulate data.** Ship a "we've moved"
  banner with Export on the old site first, and leave it up.
- **Private repo:** GitHub Pages on a private repo needs a paid GitHub plan,
  which is one reason to move. Vercel deploys from a private repo for free.
- **Vercel Hobby is for personal, non-commercial use.** Fine for this app;
  client tools would need Pro or another host. Netlify and Cloudflare Pages
  are comparable.
- **No build step stays.** Project preset "Other", no build command, output
  directory is the repo root. A `vercel.json` sets headers (`sw.js` must not
  be cached long) and nothing else.
- Check the private repo first: nothing secret in `js/config.js` (publishable
  key only) or in git history. **Pushing to main deploys.** The keep-alive
  workflow stays in GitHub.
- **Domain:** a few dollars a year. Needed before email (step 7) because the
  sender domain has to be verified.
- **Builder:** `build-opus-high` (service worker and origin).

#### 5. Map of access points — `ready` (small, once 2 is in)
Not a new map: a layer on the existing Leaflet map. **A ninth Map Icons chip,
"Community access"**, in `LAYER_CHIPS`, off by default like the rest. Loaded
by bounding box from zoom 11 straight from Supabase (RLS filters), cached for
a few minutes. Verified pins draw solid, unverified with a dashed ring.
River focus shows a river's own pins. Offline, show the last fetch. Once
verified, Float Mode could use them as ramps.
- **Builder:** `build-sonnet-high` (follows the existing layer pattern).

#### 6. Search and filters — `refining`
- **By river:** reuse the report form's river autocomplete.
- **By rating:** needs a `ratings` table (one per user per point), distinct
  from verification. Show the average with the count, and "no ratings yet"
  rather than a blank.
- **By distance:** straight-line from the location dot. If location is off,
  say so instead of guessing. Sort by nearest. Drive time stays the separate
  *Shuttle times* idea.
- Also filter by type, craft (boat or wade) and verified. It lives in a "Find
  access" sheet, not a toolbar.
- **Builder:** `build-opus-high`.

#### 7. Notifications and email — `refining` (blocked on step 2's verification rules and step 4's domain)
- Triggers: your point verified, disputed or hidden; your photo removed.
- **Supabase's built-in email is rate-limited and meant for testing.** For
  real use it needs custom SMTP, such as Resend's free tier, on the verified
  domain. Mechanism: database trigger → Edge Function → email.
- Opt-in per type with an unsubscribe link, instant or a daily digest.
  Emails never go to other users.
- **An in-app notification list is the no-email alternative.** Web push on
  iPhone works only for home-screen installs and is its own project.
- **Builder:** `build-opus-high`.

#### 8. Admin dashboard and roles — `refining`
- **Roles** in a `user_roles` table: user, moderator (trusted verifier,
  later) and admin. **Never store roles in `user_metadata`, which users can
  edit.** Policies use a `security definer` `is_admin()` function, so a
  non-admin's query returns nothing. Hiding a button isn't protection.
- **`admin.html`** as a separate page (still no build). It shows:
  - the moderation queue: pending pins and photos, reports, and the existing
    `reports` table, which needs an admin read policy;
  - counts only for usage: sign-ups, submissions a week, active users. No
    third-party analytics.
- **Never put the `service_role` key in the app** (CLAUDE.md). Anything that
  needs it goes in an Edge Function. Turn on two-factor sign-in for your
  admin account.
- **Builder:** `build-opus-xhigh`.

**Cross-cutting:** RLS and explicit grants on every table; migrations as SQL
files in `supabase/`; a privacy policy and terms before any public content;
free projects pause after about a week idle (the keep-alive covers that);
update CLAUDE.md at the end of each step.

### Photo points: a game for photos at bridges, launches and parking — `new` (raised 2026-10-14)
**Proposal:** once a user has a profile, they earn **points** for taking a
photo of the river or lake from a bridge, a launch or landing, or a parking
lot, so every access point on the map ends up with a picture of what the
water looks like there. A photo only counts if its **location is verified**.
- **Problem it solves here:** from a parking lot, deciding where to go, a
  pin says *there is a bridge* and nothing about what is under it. A photo
  answers "can I wade it, is it a ditch, is the ramp usable, how big is
  the water" before the drive. It also fills the access layers (the NBI
  bridges, parking, launches) with content no data source has.
- **Builds on the Server roadmap:** needs **login and profiles** (step 1),
  and is the game layer on **Photos** (step 3) and the verification rules
  in step 2. It shares the points and leaderboard thinking with *Float
  leaderboards*. Don't build before step 1 exists.
- **Which sites count.** Bridges (`data/bridges/`), parking, campsites and
  trailheads (`data/poi/`), ramps and wade access (`RAMPS`), and lake
  launches. The bridge follow-up above (*only bridges over mapped water*)
  decides which bridges are eligible, so do it first; otherwise people earn
  points for creeks the app doesn't cover.

**Verification** (the hard part)
- **A browser can't prove where it is.** Say so, as step 2 does: this raises
  the bar and isn't security. A friendly local game can accept that.
- **Take the photo inside the app** with the camera, not from the photo
  library, and read the phone's location at the moment of capture. Require
  a good GPS accuracy and a position within a set distance of the site (a
  starting point is 100 m; bridges and lots differ). Store the capture
  position, accuracy and time with the photo. Not decided: whether the
  in-app camera or the phone's camera input is used, since each has trade-offs
  on iPhone that need testing.
- **EXIF is not the check.** Step 3 strips EXIF by redrawing on a canvas,
  so a photo's own GPS never reaches the server. Verification uses the
  position read at capture.
- **The server has to know the sites.** If the phone sends "I'm at bridge
  X" with its own coordinates, nothing checks that bridge X is there. The
  database needs the site list (129k bridges plus the pins; it is not large)
  so a database function can compute the distance, and the phone sends only
  a site id and the capture position.
- **Also check:** one photo per user per site per period, a daily cap, a
  plausible speed between consecutive photos, and the photo must not be a
  re-upload of one already there. Photos are `pending` until approved.
- **Safe to claim:** "taken within N m of this bridge, on this date". Not
  safe: "this proves the photo shows this river".

**Points** (to decide; a starting sketch)
- More for a **first photo** at a site, then a smaller amount for a
  **refresh** once the newest photo is over a year old, since a river
  changes after a flood.
- A bonus for completing a set: every access on one river, or every bridge
  in a county. Coverage is the point, so reward the sites with no photo.
- A small bonus when the photo is tied to **what the water was doing**: the
  gauge reading at capture time is stored with it. A photo that says
  "Raccoon River, 1,900 CFS" is more useful than one with no number. The
  app already has the flow card for this.
- Leaderboards by region and by season, display name only, opt-in, as
  *Float leaderboards* does. Badges are cheap and a good reward. No money
  or prizes.
- Guard against farming: points only for pending-approved photos, no points
  for a rejected one, and a cap per day.

**Where photos show**
- On the access pin's popup and on the river or lake sheet as a short
  gallery, newest first, each labelled with date and the flow at capture.
  Offline, show none (don't let `sw.js` cache them heavily).
- **Resize on the phone** to about 1600 px before upload, as step 3 says.
  **Free-tier limit:** 1 GB of storage, which is a few thousand photos at
  roughly 300 KB each. Photos are the thing that will fill it, so size and
  count need a plan before this is public.

**Risks to design for, not around**
- **Safety:** points for standing on a bridge deck or road shoulder invite
  people into traffic. Say so in the prompt, and consider limiting photos
  to a pull-off or the bridge approach. Don't reward speed.
- **Trespass:** only public sites count (NBI public ownership, PAD-US check,
  the same warning step 2 plans). A launch on private land earns nothing.
- **People and plates:** photos may catch faces and number plates. Terms say
  so, there is a report button, and an admin can delete.
- **Rights:** the user grants the app the right to display the photo. Needs
  the terms and privacy policy step 2 already lists.
- **The photo is stored in Supabase,** so the location rule above applies:
  the capture position leaves the phone, and the sentence the user sees
  must say so before their first upload.

**Rollout:** pilot regions first, per the project rule: the Central Iowa
water trails and the NE Iowa Driftless (many bridges, few photos) and Pilot
West. Expand once a week of real use turns up nothing wrong.
**Open questions for the owner:** what points are worth and whether there are
badges; private to the user or shown to everyone, and whether a photo is
shown before approval; the verify distance per site type; and whether this
is part of the same game as the float leaderboards or a second one.
**Builder when built:** `build-opus-xhigh` (location, permissions, user
content).

### Float leaderboards — `ready` (decided 2026-10-07; build in a fresh session, after server step 1)
**Update 2026-10-13:** reuses the login and profile from *Server roadmap*
step 1 instead of its own sign-in.
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

#### Gold Medal / Blue Ribbon fisheries — `done` (29dc687, `js/designations.js`: CPW Gold Medal, Utah and WGFD Blue Ribbon, Montana's statutory blue-ribbon streams) · fit: strong
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

#### Parking, boat ramps, campsites, trailheads — `done` (ramps + fishing access 6e1b584; parking, campsites, trailheads 4c283f7, `data/poi/`) · fit: strong
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

#### Top-rated access areas — `refining` · now step 6 of the *Server roadmap* · fit: weak without accounts, medium with them
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

#### Float Mode (personal) — `building` (v1 in `js/float.js`, a785368; 19 of 20 sections trace after the agency ramp fix; New Fork sections drafted but unclassed — likely Class I / not whitewater, unconfirmed) · fit: strong for the on-phone parts
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

#### Community access points with on-site verification — `refining` · superseded by *Server roadmap* above (steps 2, 3, 5, 7); kept for the original notes · fit: needs a server
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
- **Water temperature:** `done` (2026-10-10, uncommitted; see CLAUDE.md). USGS 00010 where the gauge reports it. Also the
  trout-stress cue (warm afternoons in August).
- **Weather & wind:** `done` (2026-10-10, hourly strip, no gusts). National Weather Service API, free, no key — forecast,
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
  (00b7a56, 2026-10-10). 34 trails, 200 DNR sections. Start float is
  offered on Beginner/Intermediate sections with no dam, canoe or kayak only.
  Follow-ups: apply brochure ratings to the 110 "Not Rated" sections; the
  doubled "DNR: Beginner" + "Beginner-friendly" badge and the statewide
  low-head-dam note were handled in Batch A of the usability cleanup.

- **Location pop-up + auto-start, collapsible Rivers/Map layers menus, zoom bottom-right, park cards hidden below z6** (cbe940a).

- **Field Book**: favourites, fished, notes, Research links (Reddit/web search), export/import; extensible `BOOK_SECTIONS` tabs (2026-10-02).

- **Live location dot + follow mode** (2026-10-02).
- **Double-tap zoom, one-finger zoom, two-finger tap out, smoother pinch**
  (2026-10-02).
- **"Read me first" banner moved into the ? panel** (2026-10-02).

## Dropped

- **Map rotation:** Leaflet can't rotate the map.
