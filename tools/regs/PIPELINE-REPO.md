# Proposal: put the data pipelines in a private GitHub repo

**Status: done, 2026-10-18, on the owner's OK.** Private repo
`DriftlessEuroFisher/flyfish-pipeline`, checked out at `~/.cache/flyfish-osm`.
First commit `0b4d3c4` is about 35 MB. The booklets are in release
`booklets-2026`, indexed by `booklets/MANIFEST.tsv` and restored with
`kit/booklets.py`. The rest of this page is the proposal as approved.

## Why

`~/.cache/flyfish-osm` holds every script that turns an agency booklet into the
app's regulation text. It exists only on this Mac and is in no repo. It is
also under `~/.cache`, which cleanup tools treat as disposable. Losing it would
mean rebuilding twenty extractors from scratch. Some of the 2026 inputs could
not be fetched again: Utah publishes each year's guidebook at the same URL,
and the DNR web pages change without notice.

## Inventory (2026-10-18, 997 MB)

| Bucket | Files | Size | Where it goes |
|---|---|---|---|
| Code and notes: `*.py`, `*.md` (README, BRIEFs, accesslaw notes) | 110 | 0.9 MB | **git** |
| Regulation text and agency snapshots: extracted booklet text (`*.txt`, per-page `_pNN.txt`), entry indexes (`*_entries.json`, `assembled.json`, `*_final.json`, `*_draft.json`, `mi_gr.json`), Iowa Trout Stream Search pages, WDNR trout-regs fetches, EGLE layer per river, Iowa lake pages | 843 | 24.9 MB | **git**. This is the 2026 baseline every future diff runs against. |
| Built outputs and expensive small inputs: `built*.json` (the Overpass and NHD work, needed by every apply), `specs_*.json`, `state_*.json`, `flowrev_osm.json`, `elev_cache.json` (elevations bought against a daily allowance), `goodflow.json`, zone bases | 54 | 7.2 MB | **git** |
| Logs (skip lists and build reports) | 39 | 0.3 MB | **git** |
| Booklet PDFs (20 booklets, 24 Iowa water-trail brochures) | 44 | 578 MB | **release assets**, not git (see below) |
| OSM and NHD tiles (`*/osm/`, `osm_cache/`, `poi/osm/`, `access/` tiles, lake outlines) | 1,111 | 166 MB | ignored; re-fetchable from Overpass and NHD |
| Boundaries and agency layers used only for geometry (park rings, Census states, WGFD Fishing Guide pages, Iowa trail layers, hazards, CO DWR stations) | 93 | 118 MB | ignored; re-fetchable |
| FHWA National Bridge Inventory 2025 (`bridges/nbi/`) | 18 | 73 MB | ignored; re-download from FHWA |
| `venv/` | 757 | 61 MB | ignored; rebuild with `python3 -m venv venv && venv/bin/pip install pymupdf==1.26.5` |
| Old snapshots (`*.bak`, `*.before.*`, `dump.json`, `rivers_dump.json`) and screenshots | 31 | 6.6 MB | ignored |

**Repo size: about 33 MB of git**, growing by a few MB per yearly update (new
extracted text and entry files). The classifier that produced these numbers is
the `.gitignore` below.

## Why the PDFs don't go in git

`ak_se.pdf` is 112 MB, over GitHub's 100 MB hard limit per file. The rest
would make every clone 600 MB, and a PDF never changes once published. So:

- **One GitHub Release per edition year** in the private repo, e.g.
  `booklets-2026`, with every PDF attached as an asset (2 GB limit per file,
  so `ak_se.pdf` fits). Created with `gh release create booklets-2026 …`.
- **`booklets/MANIFEST.tsv` in git:** path, sha256, size, source URL, date
  fetched. This is how a fresh checkout knows which file goes where, and how
  a re-downloaded file is checked against the archived one.
- **Restore:** `gh release download booklets-2026 -D <dir>`, then a small
  script moves each file to its manifest path and checks the hash.

Git LFS was the alternative. It would put the PDFs on a quota and a bandwidth
meter, for files that are written once and read almost never.

## Layout

The repo **is** `~/.cache/flyfish-osm` as it stands. Every script hardcodes that
path (and, until the kit's `FLYFISH_APP` change, the app's path), so moving
files around would break them all. The only additions:

```
~/.cache/flyfish-osm/            (repo root, private: DriftlessEuroFisher/flyfish-pipeline)
  .gitignore
  README.md                      one page: what this is, venv setup, where SOURCES/UPDATING live
  booklets/MANIFEST.tsv          the PDF index
  kit/                           change-report runs (kit/runs/ ignored)
  states/ rockies/ west2/ wy/ east/ wi/ iowa/ lakes/ parks/ accesslaw/ …   unchanged
```

Later, optionally: move the folder to `~/Code/flyfish-pipeline` and leave a
symlink at `~/.cache/flyfish-osm`, so nothing that cleans caches can touch it.
That changes no script.

SOURCES.md, UPDATING.md and `regreport.py` stay in the **app** repo under
`tools/regs/`. Every session starts there and they are versioned already.

## Draft `.gitignore`

```gitignore
# environment
venv/
__pycache__/
*.pyc

# booklets live in GitHub Releases, indexed by booklets/MANIFEST.tsv
*.pdf

# change-report runs (snapshots and staged app copies)
kit/runs/

# re-fetchable OSM / NHD tiles
*/osm/
osm_cache/
poi/osm/
access/*.json
lakes/osm_*.json
lakes/nhd_*.json
iowa/osm_*.json
iowa/lakes/cache/nhd_*.json

# re-fetchable boundaries and geometry-only agency layers
rockies/parkrings.json
rockies/states.json
west2/co_parks.json
west2/ut_parks.json
states/parks.json
states/states.json
parks/bounds.json
parks/craterlake_lake.json
iowa/watertrails/cache/
iowa/dnr_paddling_dsm.json
iowa/layer5.json
iowa/dnr_ne_iowa_*.json
iowa/ogc_latest.json
iowa/lakes/cache/dnr_l*.json
wy/fg/
wy/layer0.json
wy/ner_padus.json
wy/soda_wgfd.json
wy/salt_access.json
wy/jodr.json
hazards/*.json
codwr/stations.json
bridges/nbi/

# gauge fetches (NWIS is the source of truth, fetched fresh)
*nwis_iv*.json
*.rdb
*/gauges.json

# old snapshots and screenshots
*.bak
*.prekit
*.before.js
*.before.json
dump.json
rivers_dump.json
_dump.js
_jump.js
states/regs/_tmp.json
ui/
iowa/screens/
y:*
```

## What the owner is asked to approve

1. Create **private** repo `DriftlessEuroFisher/flyfish-pipeline` (name is a
   suggestion).
2. `git init` in `~/.cache/flyfish-osm` with the `.gitignore` above, a first
   commit (~33 MB), and push.
3. Create release `booklets-2026` and upload the 44 PDFs (578 MB), with
   `booklets/MANIFEST.tsv` committed alongside.
