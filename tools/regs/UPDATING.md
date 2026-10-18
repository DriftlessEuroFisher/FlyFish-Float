# Updating the regulations: runbooks

When a state publishes a new booklet, the job is **one session per state**:
download, run, read the change report, then promote or abort. Nothing reaches
`js/` until the owner has read the report.

Which source feeds which rivers: [SOURCES.md](SOURCES.md). The tool:
[`regreport.py`](regreport.py).

> **Rule zero.** Wrong but plausible regulation text is the worst bug this app
> can have. Never edit the app's regulation text by hand to "match" a
> booklet. Change the pipeline, run it into a stage, and read the report.

---

## The general procedure (every source)

Paths: `P=~/.cache/flyfish-osm`, `APP="/Users/mattdelanoit/Claude Projects/Fly Fishing App"`.
Run `regreport.py` with `python3 -I`. Pipeline scripts: use the commands
`begin` prints (`regreport.py sources` lists every chain). **Don't add `-I` to
`iowa/dnr_trout.py`, `driftless_parking.py` or `iowa/apply.py`**: it stops them
finding `common.py`. Scripts that read PDFs need `$P/venv/bin/python`.

### 1. Download, and keep the old file
- Download the new booklet to a **new name next to the old one**
  (`ut2027.pdf` beside `ut2026.pdf`), never over it. Utah, and others,
  reuse one URL every year, so the 2026 file can't be fetched again.
- Record it: `python3 -I kit/booklets.py manifest booklets-<year>` in the
  pipeline repo adds it to `booklets/MANIFEST.tsv`. Add the source URL by
  hand, then upload it with `gh release create booklets-<year> <pdf>` (or
  `gh release upload`).
- Open the PDF and note: the edition and the dates it is valid for, and the
  page range of the section the extractor reads ("Rules for specific waters",
  "District Exceptions", …). Page numbers move every year.

### 2. Open a run
```bash
cd "$APP" && python3 -I tools/regs/regreport.py begin ut
```
This snapshots every pipeline file that isn't a cache, copies `js/` and
`data/hazards/` to a stage, and prints the `export FLYFISH_APP=…` line and the
run order for that source. From now on every apply writes into the stage. The
live app is untouched.

### 3. Point the pipeline at the new edition
For the source's scripts (listed per source below):
- Change the PDF filename and the **page ranges**.
- `grep -n 2026` across the source's scripts. Every hit is either a filename
  or a **user-facing year** inside text the app shows ("No entry of its own
  in the 2026 District Exceptions", "— IDFG 2025–2027 …, p. 43"). Change both
  kinds. A stale year in copy is a small lie on every river.
- Re-check the **standard rules typed into scripts** (`MT_STD`, `CA_STD`,
  `OR_STD`, `WA_STD`, `SGR` in `states/regs_assemble.py`; `CO_STD`, `UT_STD`
  in `rockies/regs/assemble.py`; the Henrys and Hebgen text in
  `lakes/build.py`; the Chapter 46 quotes in `wy/specs.py`). They are
  verbatim text and won't change unless you change them. Compare each against
  the new booklet.

### 4. Run the chain into the stage
```bash
export FLYFISH_APP=<printed by begin>
python3 -I tools/regs/regreport.py run        # --print to paste by hand, --from N to resume, --only 5,6,7 for a subset
```
An extractor that throws (`assert len(m)==1`, a heading not found) has found
something real: a renamed or dropped entry. Fix the mapping, don't loosen the
assert.

### 5. Read the report
```bash
python3 -I tools/regs/regreport.py report     # writes report.md + report.html in the run dir
```
Open `report.html`. It has three parts:
- **A. What the app would show:** per river and lake, regulation text old
  against new (word-level), rivers added or removed, season windows changed,
  and other fields that changed. That last list should be empty on a pure
  regulation update. If geometry or gauges moved, something ran that
  shouldn't have.
- **B. Pipeline files the run changed.** Should be the extractor's own output
  files and the scripts you edited, nothing else.
- **C. Booklet entries:** entries whose text changed, entries new in the
  booklet (candidate new streams to map), entries gone (delisted, renamed, or
  the extractor missed them). A gone entry that is still in the PDF is an
  extractor bug, so look it up before believing it.

Check every changed river against the PDF page. "Markup only" changes can be
skimmed.

### 6. Owner review, then promote or abort
The owner reads `report.html`. Then:
```bash
python3 -I tools/regs/regreport.py promote    # copies staged files over js/, only if js/ hasn't changed since begin
python3 -I tools/regs/regreport.py abort      # or: restores the pipeline files and throws the stage away
```
After promote: check a few changed rivers in the browser preview (rules card
and Regulations fold), update SOURCES.md (edition, valid dates, sha256), and
commit when asked: the app repo, and the pipeline repo (`~/.cache/flyfish-osm`) for the edited scripts and the new extracted text.

### 7. Afterwards
- New entries the report flagged as candidate streams are a separate job:
  a `west2` rulebook-stream run for that state (see `west2/README.md`).
- Bump the edition in SOURCES.md and in the regulation-year table, once that
  exists (see IDEAS.md, "Regulation year in the app").

---

## Pipeline fixes made before the first 2027 run (2026-10-18)

Three apply-script side effects found when the kit was first tested are fixed
(backups at `<script>.prefix3`; details in the side-session note
`pipeline-fixes.md`):

1. **Zone counts.** `states/apply.py` and `rockies/apply.py` now change only
   their own share of each zone `count`: new = current − this script's rivers
   in the old block + its rivers in the new block. Hand bumps from other
   pipelines (west2's MT/CO/UT streams, wy/'s WGFD streams) survive.
   `rockies/zone_base.json` is still written but its numbers are no longer
   read. A rulebook stream added or dropped by west2 still needs a hand bump.
   `mi_apply.py`, `wi/apply.py` and `parks/apply.py` still set counts from
   their own rivers (correct today, since nothing else adds to those zones).
2. **Blocks stay put.** `states/apply.py`, `rockies/apply.py`,
   `lakes/build.py`, `east/mi_apply.py`, `wi/apply.py` and `parks/apply.py`
   use the MARK approach of `west2/apply.py`: the block goes back where it
   was, and only a brand-new fence goes at the end of the constant.
3. **`parks/apply.py` is idempotent.** It strips its own block before reading
   gauge keys and reuses each site's previous key, so `hohForks2` etc. keep
   their names (four state rivers and phone caches use them). It prints
   referenced against defined gauge keys; it should read
   "referenced-but-undefined none". `parks` is no longer registered as manual.

Proof, each `begin` → `run` → `report` → `abort` on the 2026 inputs:
**mt** and **parks** "NO CHANGES"; **ut** and **co** show only `provo`
"SR- 113" → "SR-113". That line is in `assembled.json` already, so every chain
that runs `rockies/apply.py` (co, ut, ak, nm-az-nv-sd) shows it until it is
promoted once. `regreport.py` now also leaves `.git/` out of the pipeline
snapshot, since `~/.cache/flyfish-osm` became a git repo.

Earlier results: `abort` restored all snapshotted files, and `promote` refused
when the live app had changed since `begin`. The AK, MI, CA, OR, WA, WY, WI, IA
and NM-AZ-NV-SD chains are registered but have not been run end to end yet.
Run each one on its 2026 inputs before relying on it for 2027.

## Text extraction (read this before the first 2027 run)

Two kinds of extracted text sit beside the PDFs:
- **Per-page `<book>_pNN.txt`** (`rockies/pdf/`, `east/pdf/`): PyMuPDF
  `page.get_text()` for page NN, zero-based. Checked: `ut_p30.txt` is
  byte-identical to `get_text()` on page index 30. Regenerate with
  ```python
  import fitz; d=fitz.open(pdf)
  for i,p in enumerate(d): open(f"{stem}_p{i:02d}.txt","w").write(p.get_text())
  ```
- **Whole-book text in `states/regs/`** (`mt2026.raw.txt`, `.txt`, `.mu.txt`;
  `ca.mu.txt`; `or.mu.txt`, `or.col.txt`; `wa.col.txt`, `wa.mu.txt`, `wa.txt`).
  These carry `=====PAGE n=====` separators. **The commands that made them were
  not saved.** PyMuPDF's `get_text()`, `sort=True`, blocks and the
  `pymupdf gettext` modes were tried against `mt2026.raw.txt`, and none
  reproduces it byte for byte. Before 2027: find the command that reproduces
  each 2026 file from its 2026 PDF, save it as a script here, and only then
  run it on the 2027 PDF. `mt2026.raw.txt` matters most: `mtregs.py`,
  `mt_final.py` and `west2/gen_mt.py` all read it. `ca_final.py` and
  `or_final.py` read their PDFs directly and don't need it.

---

## Per source

Each entry gives what to edit, the run order and what to check. Where a
`regreport.py` source key exists, `begin <key>` prints the same order.

### Montana (key `mt`): FWP booklet, usually December
- **Edit:** `states/regs/mt<year>.raw.txt` (see Text extraction);
  `states/mtregs.py` (`HEAD`: exact booklet headings per river, `DIST`);
  `states/mt_final.py` (reach cuts); `west2/gen_mt.py` (`LO,HI` line range
  of the District Exceptions in the raw text, the `district()` line
  thresholds, `RAW` path); `MT_STD` in `states/regs_assemble.py`; the Hebgen
  text in `lakes/build.py`.
- **Run:** `states/mtregs.py` → `states/mt_final.py` → `states/regs_assemble.py`
  →
  `states/apply.py` → `west2/gen_mt.py` → `west2/build.py mt` →
  `west2/apply.py mt co ut` (**always all three states**, or the others'
  rivers are dropped) → `lakes/build.py` → `encode_coords.py`.
- **Check:** `west2/skipped_mt.txt` (entries not mapped, with reasons); the
  District standard rules on a river with no entry of its own.

### California (key `ca`): CDFW booklet, effective March 1, reissued mid-year
- **Edit:** `states/ca_final.py` (PDF path; per-entry names in its table;
  the column detection reads each page's "Open"/"Daily" headers); `CA_STD`.
- **Run:** `states/ca_final.py` → `regs_assemble.py` →
  `states/apply.py` → `encode_coords.py`.
- **Check:** multi-period rows (each period keeps its own bag limit); the
  §7.40 tables are cited, not reproduced.

### Oregon (key `or`): ODFW booklet, usually late November
- **Edit:** `states/or_final.py` (PDF path, the `ZR` zone page ranges, the
  `B[i][0]>=27` start page); `OR_STD` (zone standards, the May 22 opener).
- **Run:** `states/or_final.py` → `regs_assemble.py` →
  `states/apply.py` → `lakes/build.py` (East Lake, Crane Prairie) →
  `encode_coords.py`.
- **Check:** the Willamette Zone is catch-and-release for trout, the opposite
  of every other zone. Confirm it still is. Clatsop County's John Day must
  not be matched for the real one.

### Washington (key `wa`): WDFW pamphlet, effective July 1
- **Edit:** `states/regs/wa.col.txt` (see Text extraction), `states/wa_final.py`
  (`HEAD`, `SPEC`, `JUNK` regexes), `WA_STD`, `SGR`, the Hanford Reach note.
- **Run:** `states/wa_final.py` → `regs_assemble.py` →
  `states/apply.py` → `encode_coords.py`.
- **Check:** the inline "Other game fish" split.

### Colorado (key `co`): CPW brochure, usually February
- **Edit:** `rockies/regs/co_extract.py` (PDF path, `range(13,42)` pages, the
  8.5–9 pt font filter); `CO_MAP`, `CO_STD` in `rockies/regs/assemble.py`;
  regenerate `rockies/pdf/co_pNN.txt`.
- **Run:** `co_extract.py` → `assemble.py` → `ak_assemble.py` →
  `east_assemble.py` → `rockies/apply.py` → `west2/gen_co.py` →
  `west2/build.py co` → `west2/apply.py mt co ut` → `lakes/build.py` →
  `encode_coords.py`.
- **Check:** Gold Medal marks (`gold`) against `js/designations.js`;
  `west2/skipped_co.txt`.

### Utah (key `ut`): DWR guidebook, usually October–December
- **Edit:** `rockies/regs/ut_extract.py` (PDF path, `range(27,43)` pages);
  `UT_MAP`, `UT_PART`, `UT_STD` in `assemble.py`; `west2/gen_ut.py`
  (`SEASON`, `PART`); regenerate `ut_pNN.txt`.
- **Run:** `ut_extract.py` → `assemble.py` → `ak_assemble.py` →
  `east_assemble.py` → `rockies/apply.py` → `west2/fetch_counties.py ut 49`
  (cached) → `west2/gen_ut.py` → `west2/build.py ut` →
  `west2/apply.py mt co ut` → `lakes/build.py` → `encode_coords.py`.
- **Check:** "See X" entries still resolve; Blue Ribbon marks; the
  partial-closure rivers (Otter Creek, Duck Fork); the emergency-changes
  folder for anything issued since.

### Alaska (key `ak`): ADF&G summaries, usually April–May
- **Edit:** the four PDF paths in `ak_lines.py`, `ak_extract.py`,
  `ak_assemble.py` (headings per river, page citations); regenerate
  `ak_<book>_pNN.txt` (`ak_assemble.py` falls back to them).
- **Run:** `ak_lines.py` → `ak_extract.py` → `assemble.py` →
  `ak_assemble.py` → `east_assemble.py` → `rockies/apply.py` →
  `encode_coords.py`.
- **Check:** the cited pages (Kenai mainstem, Gulkana) still hold the tables
  the text points at; the area general-regulation page numbers.

### Michigan (key `mi`): DNR booklet, effective April 1
- **Edit:** `east/mi_regs.py` (PDF path, pages `(45,46,47)` for Gear
  Restricted Streams, the p. 43 Type table).
- **Run:** `east/mi_regs.py` → `east/mi_build.py` → `east/mi_apply.py` →
  `encode_coords.py`. The EGLE Type layer (`mi_fetch.py`) changes rarely.
  Re-fetch only on purpose.
- **Check:** the October–April windows for Type 1/2-only rivers.

### South Dakota, New Mexico, Arizona, Nevada (key `east`): one script
- **Edit:** `rockies/regs/east_assemble.py`: the PDF stems, page files
  (`nm2026_p20`–`p22`, …) and the designation wording (`DES`); regenerate
  that book's `_pNN.txt`.
- **Run:** `east_assemble.py` (after `assemble.py` and `ak_assemble.py`,
  because it updates their `assembled.json`) → `rockies/apply.py` →
  `encode_coords.py`.
- **Note:** Arizona and Nevada books cover two years; Nevada's next is 2028–29.

### Wyoming (key `wy`): WGFD Chapter 46, when amended
- **Edit:** the verbatim §16–17 quotes in `wy/specs.py`, against the new
  chapter (`wy/ch46.txt`).
- **Run:** `wy/build.py` → `wy/apply.py` → `encode_coords.py`.
  The Fishing Guide layer (`fetch_fg.py`) is geometry and stream class.
  Re-fetch only to pick up a class change.
- **Check:** the extended Grand Teton creeks keep their "In Grand Teton" text
  (`wy/gt_originals.json`).

### Iowa trout streams (key `ia-trout`): DNR pages, any time (yearly check)
- **Run:** `iowa/dnr_trout.py --refetch` (re-downloads the Trout Stream
  Search and layer 4; needs the network), and only if it reports changed
  geometry `../flowdir.py --epqs --only <ids>` and `dnr_trout.py` again; then
  `driftless_parking.py` → `iowa/watertrails/build.py` →
  `iowa/watertrails/apply.py` (its docstring requires both after
  `dnr_trout.py`) → `../encode_coords.py`. Never a full `flowdir.py`.
- **Check:** each page's "last updated" date; SR_INFO wording on restrictive
  streams.

### Iowa lakes (key `ia-lakes`): DNR booklet, usually November
- **Edit:** `iowa/lakes/build.py`: `BOOKLET` URL, `PDF` path, every cited page
  number. Each quoted fragment is asserted on its page, so a moved rule fails
  the build.
- **Run:** `iowa/lakes/build.py` (venv python).

### Wisconsin trout streams (key `wi`): WDNR layer, before the May opener
- **Run:** `wi/build.py` (re-fetches each stream's box from WDNR; needs the
  network) → `wi/apply.py` → `encode_coords.py`.

### Western parks (key `parks`, manual) and the CO/UT/AK/AZ/NV parks
- **Edit:** re-read each park's fishing page and update `parks/parkinfo.py`
  `GENERAL`, `parks/specs.py` (per-river rules), `rockies/parkinfo.py`
  `GENERAL`, and the `PARK_INFO` rows in `js/app.js` (hand).
- **Run:** `parks/apply.py` and/or `rockies/apply.py` → `encode_coords.py`.

---

## Hand-entered sources

Yellowstone (208 rivers, 9 lakes, `CLOSURES`), Grand Teton (park rivers,
lakes, the three shared rivers), Teton Valley and Swan Valley (IDFG),
Door County (WDNR), `js/access-laws.js`, `js/designations.js`, and
`PARK_INFO` in `js/app.js` have no surviving generator. To update one:

1. `regreport.py begin <any key>`, or copy `js/` to a scratch folder.
2. Edit the **staged** copy by hand, quoting the new edition verbatim.
3. `regreport.py diff "$APP/js" <stage>/js` gives the same per-river
   old-against-new review.
4. Owner review, then promote.

The better fix, when one of these needs a real update: write the generator
first, as the other pipelines have (verbatim text in a spec file, a fenced
apply), so the next year is a run and not a retype.
