# Adding a state, and updating one each year, without wasting credits

Written 2026-10-21, after the first Pennsylvania build. That build used **56 million
re-read tokens to write about 6,000**, because four commands printed 440–610 KB
each into one 200-turn agent's conversation. Every later turn re-read about
400,000 tokens. The writing and the thinking were cheap; the repetition was not.

## Rules
1. **Raw output goes to files, and the screen gets a summary under 2 KB.** Fetched
   JSON, PDF text and built rivers stay on disk. Scripts print counts, skips and a
   few sample lines. Read a booklet page by pulling the lines you need, never by
   printing the page.
2. **The files carry state, not the conversation.** Each stage reads from and
   writes to `~/.cache/flyfish-osm/<state>/`, so any stage restarts cold.
3. **One stage per agent, at the level that stage needs** (table below). If an
   agent's context passes ~150k tokens, it stops and reports, and the next stage
   starts fresh.
4. **Copy the nearest pipeline.** An agency trout layer → `east/` (Michigan).
   OSM by name → `states/` or `rockies/`. Only the state's own quirks are new
   work.
5. **Plan once.** The planning session checks the sources live, drafts
   `specs.py` and writes the brief. Builders don't research or re-plan.

## New state: the stages
| # | Stage | Agent | In → out |
|---|---|---|---|
| 0 | Plan: check agency layers and booklet URL, draft river list, list traps and checks | planning session | web, CLAUDE.md → brief, `specs.py` |
| 1 | Fetch layers, cache every page to disk | `build-sonnet-high` | `specs.py` → `cache/` |
| 2a | Geometry: weld sections, reach classes | `build-opus-max` | `cache/` → `built.json` |
| 2b | Gauges and access pins (pin must name the same water) | `build-opus-high` | `built.json`, `cache/` → `built.json` |
| 2c | Fenced `apply.py`, run twice, encode, `flowdir --only`, verify table | `build-opus-high` | `built.json`, `regs.json` → the app's fenced blocks |
| 3 | Booklet: PDF → text files → verbatim regs per river | `build-opus-xhigh` | PDF text, `built.json` → `regs.json` |
| 4 | App wiring: `PARK_INFO` row, `ACCESS_LAW`, `REGIONS`, legend | `build-sonnet-high` | `regs.json` → app.js, access-laws.js, app.html |
| 5 | State zone | `build-sonnet-medium` | latest `zones_add*.py` → zones.js |
| 6 | Browser check, then CLAUDE.md, `SOURCES.md`, `booklets/MANIFEST.tsv` | planning session | — |

Each brief names its input files, its output files, and the summary it must
print. Stages 3 and 5 don't depend on each other, so they can run in parallel.

### What Pennsylvania actually cost, stage by stage
| Run | Re-read tokens | Peak context |
|---|---|---|
| First single max-effort agent (fetch, regs, build drafts; stopped) | ~99M | 564k |
| Stage 2, fresh `build-opus-max` (verify, fix pins, apply) | 65M | 386k |
| Stage 4, `build-sonnet-high` (app wiring) | — | ~154k |
| Stage 5, `build-sonnet-medium` (zone) | — | ~125k |

**Lesson: a max-effort agent ignores a "stop at 150k" rule** over 200+ turns.
Split its stage before it starts: geometry/apply, then gauges and pins, then
verification, each as its own agent with a narrow brief. The Sonnet stages
stayed small without being told twice.

## Next year's update
The steps are in `UPDATING.md` (`regreport.py begin → re-run → report →
promote/abort`). To keep the cost down:
- **The booklet layout hasn't changed:** a `build-sonnet-medium` agent re-runs the
  state's existing scripts on the new PDF. The owner reads the `report` diff.
- **The layout changed** (garbled text, entries missing): `build-opus-xhigh` fixes
  only that state's reading script. Give it the failing pages, not the whole
  booklet.
- **Hand-entered sources** (Yellowstone, Grand Teton, Teton/Swan Valley, Door,
  `PARK_INFO`, access laws, designations): check the agency page and edit only
  what changed. Review with `regreport.py diff`.
- One state per agent. A yearly update is mostly reading a diff, as long as each
  state's scripts print short summaries and give the same result on a re-run.
