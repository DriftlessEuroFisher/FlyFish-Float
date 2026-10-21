# Regulation sources

Every piece of regulation text the app shows, where it came from, which
edition is loaded now, and what reads it. The update procedure for each source
is in [UPDATING.md](UPDATING.md).

Written 2026-10-18, from the files in `~/.cache/flyfish-osm` and the PDFs
themselves.

**How the "next edition" column was worked out:** from the 2026 PDF's own
creation date and the validity the cover states, not from memory. Treat it as
the month to start checking, not as a promise.

**"URL"** is the address the 2026 file was downloaded from, recovered from
earlier session logs. Agency URLs change every year, so start from the agency's
regulations page if the old one 404s. "Not recorded" means the address wasn't
in any log.

Pipeline paths are relative to `~/.cache/flyfish-osm/`. App fences are the
`/* >>> name */` blocks in `js/rivers-data.js` (and in `js/tiers.js` for
season windows).

---

## Summary

| Source | Loaded edition | Valid | Next edition, start checking | App waters | Pipeline |
|---|---|---|---|---|---|
| Montana FWP booklet | 2026 | 2026 | Dec 2026 | 38 + 93 rivers, 1 lake | `states/`, `west2/` (mt) |
| California CDFW booklet | 2026, updated Jul 10 2026 | 2026 | Jan–Mar 2027, and mid-year reissues | 46 rivers | `states/` |
| Oregon ODFW booklet | 2026 | 2026 | Nov–Dec 2026 | 41 rivers, 2 lakes | `states/` |
| Washington WDFW pamphlet | 2026–27 | Jul 1 2026 – Jun 30 2027 | Jun 2027 | 48 rivers | `states/` |
| Colorado CPW brochure | 2026 | Mar 1 2026 – Mar 31 2027 | Feb 2027 | 43 + 181 rivers, 2 park creeks, 3 lakes | `rockies/`, `west2/` (co) |
| Utah DWR guidebook | 2026 | 2026 | Oct–Dec 2026 | 34 + 39 rivers, 2 lakes | `rockies/`, `west2/` (ut) |
| Alaska ADF&G summaries (4 regions) | 2026 | until the 2027 summary is issued | Apr–May 2027 | 79 rivers + park rivers | `rockies/` |
| Michigan DNR booklet | 2026 | Apr 1 2026 – Mar 31 2027 | Feb–Mar 2027 | 23 rivers | `east/` |
| South Dakota GFP handbook | 2026 | 2026 | Dec 2026 – Jan 2027 | 6 rivers | `rockies/regs/east_assemble.py` |
| New Mexico DGF Rules & Info | 2026–27 | Apr 1 2026 – Mar 31 2027 | Mar 2027 | 11 rivers | `rockies/regs/east_assemble.py` |
| Arizona AZGFD regulations | 2025 & 2026 (amended Jan 2026) | 2025–2026 | Dec 2026 – Jan 2027 | 7 + 2 Grand Canyon | `rockies/regs/east_assemble.py` |
| Nevada NDOW CR 25-16 | 2026–27 | Jan 1 2026 – Dec 31 2027 | Sep–Dec 2027 | 5 + 3 Great Basin | `rockies/regs/east_assemble.py` |
| Idaho IDFG Seasons & Rules | 2025–2027, 2nd ed. (2026) | through 2027 | Dec 2027 (2028–30 rules) | 33 rivers, 1 lake | **hand-entered** + `lakes/` |
| Wyoming WGFD Chapter 46 | effective Jan 1 2026 | until amended | each winter, check WGFD news | 41 rivers, 1 lake | `wy/` |
| Iowa DNR Trout Stream Search | live web pages, dated per stream | n/a | any time | 72 trout streams | `iowa/dnr_trout.py` |
| Iowa DNR fishing booklet | 2026 | 2026 | Nov 2026 | 3 lakes | `iowa/lakes/build.py` |
| Wisconsin WDNR trout-regs layer | live layer, fetched 2026-10 | WI season | spring, before the May opener | 22 rivers | `wi/` |
| Wisconsin WDNR (Door County) | layer, fetched 2026-09 | WI season | spring | 8 rivers | **hand-entered** |
| Yellowstone NPS regulations | 2026 | 2026 season | Mar–May 2027 | 208 rivers, 9 lakes, closures | **hand-entered** |
| Grand Teton NPS page | fetched 2026-09 | until changed | spring | 13 rivers + 11 extended, 12 lakes | **hand-entered** + `wy/` |
| Western national parks (10) | park pages fetched 2026-10-01 | until changed | spring | 112 rivers, 1 lake | `parks/` |
| CO/UT/AK/AZ/NV parks (16) | park pages fetched 2026-10-01 | until changed | spring | 88 rivers | `rockies/parkinfo.py` |
| Stream-access law | 2026 booklets + agency pages | until changed | with each state's booklet | all 18 states | **hand-entered** |
| Official designations | 2026 booklets + WGFD layer | yearly | with each booklet | 48 waters | **hand-entered** |

"Hand-entered" means no script that wrote the text survives: it was typed or
pasted in an earlier session whose scratch folder is gone. Those sources can
still be checked with the change report's `diff` mode, but the text itself has
to be edited by hand. See [UPDATING.md](UPDATING.md#hand-entered-sources).

Not covered by any regulation text: Idaho's 27 original rivers, Wyoming's 15
original rivers outside the WGFD fence, Minnesota (Driftless, North Shore and
the big rivers), Wisconsin's Driftless and Northwoods rivers, Illinois, and the
Iowa water trails. The app shows those without a regulations block on purpose.

---

## State booklets

### Montana — FWP *2026 Montana Fishing Regulations*
- **URL:** https://fwp.mt.gov/binaries/content/assets/fwp/fish/regulations/2026-fishing-regulations-final-for-web.pdf
- **File:** `states/regs/mt2026.pdf` (96 pp, PDF created 2025-12-01, sha256 `712121e0c2e6…`)
- **Text:** `states/regs/mt2026.raw.txt` is what the parsers read. `.txt` and `.mu.txt` are
  other extractions; the `.txt` one squashes Central-district headings. **The command
  that made `.raw.txt` was not saved** (see UPDATING.md, "Text extraction").
- **Scripts:** `states/mtregs.py` (headings per river) → `states/mt_final.py` (verbatim
  text per reach → `regs/mt_final.json`) → `states/regs_assemble.py` (adds
  `MT_STD[district]`, the district standard rules, typed into that script) →
  `states/apply.py` (which imports `seasons.py` for the windows). Rulebook streams: `west2/gen_mt.py` → `build.py mt`
  → `apply.py mt co ut`.
- **Feeds:** 38 rivers, fence "western state rivers", `region:"montana"` (`parkRegs`);
  93 rivers with ids ending `mt2`, fence "western rulebook streams"; Hebgen Lake
  (text typed into `lakes/build.py`, fence "state lakes"); the Montana row of
  `js/access-laws.js` (p. 18); the `closed:[[12,4]]` windows for Western District
  rivers in `js/tiers.js`.

### California — CDFW *2026 California Freshwater Sport Fishing Regulations*
- **URL:** https://nrm.dfg.ca.gov/FileHandler.ashx?DocumentID=209090&inline (the
  DocumentID changes with every reissue; start at https://wildlife.ca.gov/Regulations)
- **File:** `states/regs/ca.pdf` (103 pp, "Updated July 10, 2026", sha256 `7bd6c7ec0881…`)
- **CDFW reissues mid-year.** The loaded file is already the July update. Check for a
  newer "Updated …" date during the year too, not only at New Year.
- **Scripts:** `states/ca_final.py` (reads the PDF directly by word position →
  `regs/ca_final.json`) → `regs_assemble.py` (adds `CA_STD`, §5.85, typed in) → `states/apply.py`.
- **Feeds:** 46 rivers, fence "western state rivers", `region:"california"`. The §7.40
  salmon/steelhead tables are cited, not reproduced.

### Oregon — ODFW *2026 Oregon Sport Fishing Regulations*
- **URL:** https://www.eregulations.com/oregon/fishing/pdf (landing:
  https://myodfw.com/articles/2026-oregon-sport-fishing-regulations)
- **File:** `states/regs/or.pdf` (100 pp, PDF created 2025-11-21, sha256 `6392f01cfc1a…`)
- **Scripts:** `states/or_final.py` (PDF blocks in authored order, zone by page range
  `ZR` → `regs/or_draft.json`) → `regs_assemble.py` (adds `OR_STD[zone]`, typed in) → `states/apply.py`.
- **Feeds:** 41 rivers, fence "western state rivers", `region:"oregon"`; East Lake and
  Crane Prairie (`lakes/build.py`).
- **Year-specific constants:** `ZR` page ranges, the "May 22" opener in `OR_STD`.

### Washington — WDFW *Sport Fishing Rules, July 1, 2026 – June 30, 2027*
- **URL:** https://www.eregulations.com/assets/docs/guides/26WAFW_LR.pdf
- **File:** `states/regs/wa.pdf` (152 pp, PDF created 2026-06-03, sha256 `ef5328cf079d…`)
- **Text:** `states/regs/wa.col.txt` (column-ordered; command not saved).
- **Scripts:** `states/wa_final.py` → `regs/wa_draft.json` → `regs_assemble.py` (adds
  `WA_STD`, `SGR`, typed in) → `states/apply.py`.
- **Feeds:** 48 rivers, fence "western state rivers", `region:"washington"`.
- **Runs July to June**, so the 2027–28 pamphlet is the next one, around June 2027.
  WDFW also issues emergency rules in season, which the app does not carry.

### Colorado — CPW *2026 Colorado Fishing* brochure
- **URL:** https://cpw.widen.net/s/jh2qfkp7np/colorado-fishing-brochure (a share link;
  landing: https://cpw.state.co.us/fishing)
- **File:** `rockies/pdf/co2026.pdf` (45 pp, season March 1, 2026 – March 31, 2027, PDF
  created 2026-02-05, sha256 `776e88c15a1a…`); per-page text `rockies/pdf/co_pNN.txt`.
- **Scripts:** `rockies/regs/co_extract.py` (pp. 14–42, 8.5–9 pt body faces →
  `co_entries.json`, 482 entries) → `rockies/regs/assemble.py` (`CO_MAP`, `CO_STD`) →
  `ak_assemble.py` → `east_assemble.py` → `rockies/apply.py`. Rulebook streams:
  `west2/gen_co.py` → `build.py co` → `apply.py mt co ut`. Lakes: `lakes/build.py`.
- **Feeds:** 43 rivers `region:"colorado"` (fence "rockies & alaska rivers"); 181
  rivers with ids ending `co2` ("western rulebook streams"); Medano and Sand Creeks
  in Great Sand Dunes; Spinney Mountain, Eleven Mile and North Delaney Butte
  lakes; the CPW Gold Medal rows of `js/designations.js`.
- **Year-specific constants:** the page range in `co_extract.py`.

### Utah — DWR *2026 Utah Fishing Guidebook*
- **URL:** https://wildlife.utah.gov/guidebooks/fishing_guidebook.pdf — **always the
  current year at the same address**, so archive the old file before the new one
  replaces it. Mid-year emergency changes are posted under
  `wildlife.utah.gov/pdf/guidebooks/emergency-changes/`.
- **File:** `rockies/pdf/ut2026.pdf` (72 pp, PDF created 2025-10-28, sha256 `69576e1d7eac…`);
  per-page text `rockies/pdf/ut_pNN.txt` (= PyMuPDF `page.get_text()`, checked on p. 30).
- **Scripts:** `rockies/regs/ut_extract.py` ("Rules for specific waters", pp. 28–43 →
  `ut_entries.json`, 191 entries) → `assemble.py` (`UT_MAP`, `UT_PART`, `UT_STD`) →
  `ak_assemble.py` → `east_assemble.py` → `rockies/apply.py`. Rulebook streams:
  `west2/fetch_counties.py ut 49`, `index_rivers.py`, `gen_ut.py` (`SEASON`, `PART`
  tables) → `build.py ut` → `apply.py mt co ut`. Lakes: `lakes/build.py`.
- **Feeds:** 34 rivers `region:"utah"`; 39 rivers with ids ending `ut2`; Flaming Gorge
  and Strawberry Reservoir; Utah Blue Ribbon rows of `designations.js`; Utah season
  windows (`closed`, `partClosed`) in `tiers.js`.
- **Known pending change:** `provo` will change on the next rockies apply
  (`ut_entries.json` was re-extracted: "SR-113" for "SR- 113").

### Alaska — ADF&G *2026 Sport Fishing Regulations Summaries*
- **URLs:** Southcentral
  https://www.adfg.alaska.gov/static/regulations/fishregulations/PDFs/southcentral/2026sc_sfregs_regionalregs.pdf
  and Southeast
  https://www.adfg.alaska.gov/static/regulations/fishregulations/PDFs/southeast/2026se_sfregs_general_freshwater_saltwater.pdf
  were in the logs. These may be section files, not the whole books. Southwest and
  Northern: not recorded.
- **Files:** `rockies/pdf/ak_sc.pdf` (96 pp), `ak_sw.pdf` (40), `ak_se.pdf` (56,
  **112 MB**), `ak_nor.pdf` (48). Each says "Effective until the 2027 summary is
  issued". PDFs created April–May 2026.
- **Scripts:** `rockies/regs/ak_lines.py` → `ak_extract.py` (→ `ak_entries.json`) →
  `assemble.py` → `ak_assemble.py` (exact headings, page citations) →
  `east_assemble.py` → `rockies/apply.py`.
- **Feeds:** 79 rivers `region:"alaska"` plus the rivers of Katmai (8), Lake Clark (8),
  Denali (8), Wrangell-St. Elias (9), Gates of the Arctic (7), Kobuk Valley (4),
  Glacier Bay (5) and Kenai Fjords (1), which combine park text with the state entry.

### Michigan — DNR *2026 Michigan Fishing Regulations*
- **URL:** https://www.michigan.gov/dnr/-/media/Project/Websites/dnr/Documents/LED/digests/2026-Michigan-Fishing-Regulations_web_accessible.pdf
- **File:** `east/pdf/mi2026.pdf` (76 pp, April 1, 2026 – March 31, 2027, sha256 `d06e0072dac7…`)
- **Scripts:** `east/mi_regs.py` (Gear Restricted Streams pp. 44–46 by bold heading, plus
  the p. 43 stream-Type table → `mi_gr.json`) → `east/mi_build.py` → `east/mi_apply.py`.
  The stream Types come from EGLE's designated-trout-stream layer (`east/mi/*.json`,
  fetched by `mi_fetch.py`).
- **Feeds:** 23 rivers, fence "michigan trout streams", `region:"michigan"`; the
  October–April closed windows on Type 1/2-only rivers in `tiers.js`.
- **Year-specific constants:** the page numbers in `mi_regs.py`.

### South Dakota — GFP *2026 South Dakota Fishing Handbook*
- **URL:** https://gfp.sd.gov/UserDocs/nav/FishingHandbook_2026.pdf
- **File:** `east/pdf/sd2026.pdf` (76 pp; the file was rebuilt 2026-09-17, so GFP
  reissues in-year); per-page text `east/pdf/sd2026_pNN.txt`.
- **Scripts:** `rockies/regs/east_assemble.py` (Black Hills exceptions) → `rockies/apply.py`.
- **Feeds:** 6 rivers `region:"southdakota"`.

### New Mexico — DGF *2026–2027 Fishing Rules & Info*
- **URL:** https://wildlife.dgf.nm.gov/wp-content/uploads/2026/03/2026-2027-FISH-RIB_Online.pdf
- **File:** `east/pdf/nm2026.pdf` (52 pp, PDF created 2026-03-11); text `nm2026_pNN.txt`.
- **Scripts:** `east_assemble.py` (Special Trout Waters, pp. 20–22 as `_p20`–`_p22`,
  parsed into Red, Green and Xmas Chile designations) → `rockies/apply.py`.
- **Feeds:** 11 rivers `region:"newmexico"`.

### Arizona — AZGFD *2025 & 2026 Fishing Regulations*
- **URL:** https://azgfd-portal-wordpress-pantheon.s3.us-west-2.amazonaws.com/wp-content/uploads/2026/01/30111408/2025-26-Fishing-Regulations_260130.pdf
- **File:** `east/pdf/az2026.pdf` (68 pp, amended January 2026).
- **Two-year book.** The next one covers 2027 & 2028.
- **Scripts:** `east_assemble.py` (Commission Order 40 water list) → `rockies/apply.py`.
- **Feeds:** 7 rivers `region:"arizona"`, 2 Grand Canyon rivers; Arizona's row of
  `access-laws.js` (p. 55).

### Nevada — NDOW *CR 25-16 Fishing Seasons and Regulations*
- **URL:** https://www.ndow.org/wp-content/uploads/2025/09/24-A-CR-25-16-Fishing-Seasons-and-Regulations-for-January-1-2026-through-December-31-2027.pdf
- **File:** `east/pdf/nv2026.pdf` (12 pp; January 1, 2026 – December 31, 2027).
- **Two-year regulation.** The next one (2028–29) is adopted around September 2027.
- **Scripts:** `east_assemble.py` (county tables) → `rockies/apply.py`.
- **Feeds:** 5 rivers `region:"nevada"`, 3 Great Basin rivers.

### Idaho — IDFG *Idaho Fishing 2025–2027 Seasons & Rules*, 2nd edition (2026)
- **URL:** https://idfg.idaho.gov/sites/default/files/seasons-rules-fish-2025-2027.pdf
- **File:** `lakes/idfg.pdf` (80 pp, PDF created 2026-09-15).
- **Three-year book**, reprinted as editions. The next full set is 2028–2030.
- **Feeds:**
  - Henrys Lake: text typed into `lakes/build.py` (`HENRYS`, p. 43), fence "state lakes".
  - **Hand-entered:** the Teton Valley (21) and Swan Valley (12) rivers carry
    `parkRegs` with `parkRegsSrc:"idfg"`, Upper Snake Region, outside any fence.
  - Idaho's row of `access-laws.js` (p. 12).

### Wyoming — WGFD *Chapter 46 Fishing Regulations* (effective January 1, 2026)
- **URL:** https://wgfd.wyo.gov/media/32906/download?inline= (most-fetched in the logs;
  confirm it is Chapter 46). Landing: https://wgfd.wyo.gov/fishing-boating/fishing-regulations
- **File:** `wy/ch46.pdf` (41 pp, the Word original is dated 2025-03-31) and `wy/ch46.txt`.
- **Not yearly.** WGFD amends Chapter 46 every few years; its news page announces
  changes taking effect January 1.
- **Scripts:** the §16–17 Area 1 text is **quoted by hand in `wy/specs.py`**, so a new
  chapter means re-quoting there, then `wy/build.py` → `wy/apply.py`. Stream class
  (Blue/Red/Yellow Ribbon) comes from WGFD's Fishing Guide layer
  (`services6.arcgis.com/cWzdqIyxbijuhPLw/…/Streams_FishingGuide_PublicView`).
- **Feeds:** 41 rivers in fence "wyoming wgfd streams" (`parkRegsSrc:"wgfd"`, plus 11
  extended Grand Teton creeks); Soda Lake; WGFD Blue Ribbon rows of `designations.js`.

### Iowa — DNR *2026 Iowa Fishing Regulations*
- **URL:** https://www.iowadnr.gov/media/6063/download?inline (the media id changes
  yearly; landing https://www.iowadnr.gov/things-do/fishing/regulations-laws)
- **File:** `iowa/lakes/cache/regs/ia_fishing_regs_2026.pdf` (24 pp, PDF created 2025-10-31).
- **Scripts:** `iowa/lakes/build.py`. Every quoted fragment is asserted to appear on the
  page it cites, so a new booklet fails loudly rather than quietly.
- **Feeds:** Big Creek Lake, Saylorville Lake and Lake Halice `regs` (Lake Halice: the p. 6
  "Fishing Private Waters" section and statewide rows only), fences "iowa lakes" and "iowa
  lake access".

## Agency web data (no edition)

### Iowa DNR — Trout Stream Search
- **URL:** https://programs.iowadnr.gov/lakemanagement/FishIowa/TroutStreamDetails/&lt;CODE&gt;,
  plus the Fishing Atlas "Trout Streams" layer
  (`programs.iowadnr.gov/geospatial/rest/services/Recreation/fishing/MapServer/4`).
- **Cached:** `iowa/dnr_trout/` (`search.html`, `pages/<CODE>.html`, `layer4.json`),
  fetched 2026-10-08. Each page carries its own "last updated" date, which the blurb quotes.
- **Scripts:** `iowa/dnr_fetch.py`, `iowa/dnr_trout.py [--refetch]` (see its run order).
- **Feeds:** `troutRegs`, `troutClass`, `reachClass` on 72 NE Iowa trout streams: 61
  rewritten in place outside any fence, 11 in fence "ne iowa dnr trout streams".
- **There is no edition to wait for.** The DNR edits pages whenever it likes, so the
  check is a yearly `--refetch` into a staged run.

### Wisconsin DNR — trout regulation layer
- **URL:** https://dnrmaps.wi.gov/arcgis/rest/services/FM_Trout/FM_TROUT_REGS_WTM_Ext/MapServer/0/query
- **Cached:** `wi/f_*.json`, `wi/q_*.json` (fetched October 2026).
- **Scripts:** `wi/build.py` (fetches, then builds) → `wi/apply.py`.
- **Feeds:** 22 rivers in fence "wisconsin trout streams" (`wisouthshore`, `wicentralsands`).
- Wisconsin's regulations change with the season that opens the first Saturday in May,
  so re-fetch in spring.

### Wisconsin DNR — Door County (hand-entered)
- `troutRegs` on 8 Door County streams came from the `WY_FISHERIES_WATERS` layer 9
  (`FM_TROUT_REGS`). The script that wrote them is gone. They sit outside any fence.

## National parks

### Yellowstone — NPS *2026 Fishing Regulations* (hand-entered)
- **URL:** https://www.nps.gov/yell/planyourvisit/upload/2026-Fishing-Regulations-digital.pdf
  (page: https://www.nps.gov/yell/planyourvisit/fishing.htm)
- **Feeds:** `parkRegs` on 208 rivers (`region:"yellowstone"`), `regs` on 9 lakes,
  `CLOSURES` geometry (rebuilt by `closures.py`, which was in a scratchpad and is gone),
  and `PARK_INFO.yellowstone` in `js/app.js`. No local copy of the PDF is kept.
- The park publishes a new edition each spring, ahead of the Memorial Day opener.

### Grand Teton — NPS fishing page (hand-entered)
- **URL:** https://www.nps.gov/grte/planyourvisit/fish.htm
- **Feeds:** `parkRegs` on 10 park rivers, the Snake, Buffalo Fork and Gros Ventre
  (`parkRegsSrc:"grte"`), the "In Grand Teton" part of 11 extended creeks (via
  `wy/gt_originals.json`), 12 lakes, `PARK_INFO.grandteton`.

### Western national parks — 10 parks' own fishing pages, fetched 2026-10-01
- Olympic, Mount Rainier, North Cascades, Crater Lake, Glacier, Redwood, Lassen,
  Yosemite, Kings Canyon, Sequoia (`nps.gov/<code>/planyourvisit/fishing.htm`).
- **Scripts:** the text is typed into `parks/parkinfo.py` (`GENERAL`) and
  `parks/specs.py` (per-river rules) → `parks/apply.py`.
- **Feeds:** 112 rivers in fence "western national parks", Crater Lake (lake),
  `PARK_INFO` rows in `app.js`, and the park windows in `tiers.js`.

### Colorado, Utah, Alaska, Arizona and Nevada parks — fetched 2026-10-01
- Rocky Mountain, Black Canyon, Great Sand Dunes, Capitol Reef, Zion, Canyonlands,
  Katmai, Lake Clark, Denali, Wrangell-St. Elias, Gates of the Arctic, Kobuk Valley,
  Glacier Bay, Kenai Fjords, Grand Canyon, Great Basin.
- **Scripts:** typed into `rockies/parkinfo.py` (`GENERAL`) → `rockies/apply.py`.
- **Feeds:** 88 park rivers in fence "rockies & alaska rivers".

## Cross-cutting tables (hand-entered)

- **`js/access-laws.js`**: the stream-access law for 18 states, quoted from each
  2026 booklet or agency page. Sources and page numbers: `accesslaw/notes.md`.
  Minnesota's quote is from the **2025** eregulations edition. Re-check each state's
  row when its booklet is updated.
- **`js/designations.js`**: CPW Gold Medal (2026 brochure flags), Utah Blue Ribbon
  (2026 guidebook), WGFD Blue Ribbon (Fishing Guide layer), Montana's statutory
  Murphy Right streams. Update with each booklet.
- **`PARK_INFO` in `js/app.js`**: the licence, footer and note lines per region. They
  are derived from the same sources but typed by hand.
- **Season windows in `js/tiers.js`**: written by `states/seasons.py`, `west2/gen_ut.py`
  (`SEASON`, `PART`), `east/mi_apply.py` and the park apply scripts, plus hand rows.
  Each run regenerates the windows from that year's text.
