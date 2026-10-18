#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""regreport.py: the change report for a yearly regulation update.

Every year each state publishes a new booklet, and the pipelines in ~/.cache/flyfish-osm turn it into the text
the app shows (parkRegs / troutRegs on RIVERS, regs on LAKES, season windows in TIERS). Wrong but plausible
regulation text is the worst bug this app can have, so an update never writes the app directly: the pipeline runs
into a staged copy of js/ and data/hazards/, and the owner reads a diff before anything is promoted.

  python3 -I tools/regs/regreport.py begin <source>   snapshot the pipeline, stage js/ + data/hazards/, print the
                                                       `export FLYFISH_APP=...` line and the run order
  python3 -I tools/regs/regreport.py run [--from N] [--to N] [--only N,N] [--print]
                                                       run the registered chain into the stage (--print: just
                                                       print the commands, to run them by hand)
  python3 -I tools/regs/regreport.py report           report.md + report.html in the run dir; exit 0 = no changes
  python3 -I tools/regs/regreport.py promote          copy the staged files that differ over the live ones (only if
                                                       the live files are as they were at begin and the report is
                                                       current), then close the run
  python3 -I tools/regs/regreport.py abort [--delete-new]
                                                       restore every pipeline file the run changed, delete the
                                                       stage, close the run
  python3 -I tools/regs/regreport.py diff <A> <B>     section A only, between two js/ folders (A old, B new)
  python3 -I tools/regs/regreport.py status | sources

Global options: --app DIR (the live app root; default: the repo this file sits in), --kit DIR (where runs live;
default ~/.cache/flyfish-osm/kit). FLYFISH_APP is never read as the live app: it names the stage.

How the stage works: every pipeline script reads the app root as
    os.environ.get("FLYFISH_APP") or "<the real app>"
so with FLYFISH_APP=<run>/stage it reads and writes the staged copy, and unset it behaves exactly as before.

Stdlib only. Runbooks: UPDATING.md. Which source feeds which rivers: SOURCES.md.
"""
import sys
sys.dont_write_bytecode = True        # -I ignores PYTHONDONTWRITEBYTECODE; keep __pycache__ out of the pipeline dir
import argparse, ast, datetime, difflib, hashlib, html, json, os, re, shutil, subprocess, time

PIPE = os.path.expanduser("~/.cache/flyfish-osm")
TOOL_APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))   # tools/regs/ -> app root
VENV_PY = os.path.join(PIPE, "venv", "bin", "python")
STAGED = ("js", "data/hazards")                  # what a run stages, and all that promote may copy back
BIG = 5 * 1024 * 1024                            # json over this is hashed, not copied, by the snapshot

sys.path.insert(0, PIPE)
try:
    from jsmatch import close as js_close        # the pipeline's own string-aware bracket matcher
except ImportError:                              # same algorithm, for a machine without the pipeline
    def js_close(t, i):
        o = t[i]; c = {"[": "]", "{": "}"}[o]; d = 0; j = i; n = len(t)
        while j < n:
            ch = t[j]
            if ch in "\"'`":
                q = ch; j += 1
                while j < n and t[j] != q:
                    if t[j] == "\\": j += 1
                    j += 1
            elif ch == "/" and j + 1 < n and t[j + 1] == "*": j = t.index("*/", j + 2) + 1
            elif ch == "/" and j + 1 < n and t[j + 1] == "/": j = t.index("\n", j)
            elif ch == o: d += 1
            elif ch == c:
                d -= 1
                if d == 0: return j
            j += 1
        raise ValueError("unbalanced")


# ====================================================================================================== registry
# One row per source: the manual steps before the chain (`pre`), the chain itself (`steps`), and what to check after
# (`notes`). Chains come from each pipeline's own docstrings/README, CLAUDE.md and UPDATING.md, and were read against
# the scripts (which file each step reads and writes). A step marked manual is printed and never run by `run`.

def S(d, script, *args, py="python3", isolate=False, net=False, manual=False, note=""):
    return dict(dir=d, script=script, args=list(args), py=py, isolate=isolate, net=net, manual=manual, note=note)

ASSEMBLE = [
    S("rockies/regs", "assemble.py", note="rebuilds assembled.json from scratch: Colorado and Utah blocks"),
    S("rockies/regs", "ak_assemble.py", note="adds Alaska to assembled.json"),
    S("rockies/regs", "east_assemble.py", note="adds SD, NM, AZ, NV to assembled.json"),
    S("rockies", "apply.py", note="fence 'rockies & alaska rivers' in rivers-data.js and tiers.js; zone counts in zones.js"),
]
STATES = [
    S("states", "regs_assemble.py", note="MT/CA/OR/WA -> states/regs/assembled.json, with the standard rules typed into it"),
    S("states", "apply.py", note="fence 'western state rivers'; imports seasons.py for the TIERS windows; zone counts"),
]
def WEST2(st): return [
    S("west2", "gen_%s.py" % st, note="specs_%s.json from the booklet entries" % st),
    S("west2", "build.py", st, note="built_%s.json (geometry from the cached osm/ tiles)" % st),
    S("west2", "apply.py", "mt", "co", "ut", note="always all three states: one fence holds all of them"),
]
LAKES_W = S("lakes", "build.py", note="fence 'state lakes': CO/UT lakes from the entries, Henrys/Hebgen/East/Crane typed in")
ENCODE = S(".", "encode_coords.py", note="coords -> cz; after every apply")

SOURCES = {
 "mt": dict(title="Montana FWP fishing regulations", adapter="mt",
    pre=["Put the new booklet next to the old one (states/regs/mt<year>.pdf) and re-create states/regs/mt<year>.raw.txt "
         "from it. The command that made mt2026.raw.txt was not saved (UPDATING.md, 'Text extraction').",
         "Point states/mtregs.py, states/mt_final.py and west2/gen_mt.py (RAW path, LO/HI, district() lines) at it; "
         "check MT_STD in states/regs_assemble.py and the Hebgen text in lakes/build.py."],
    steps=[S("states", "mtregs.py", note="headings per river -> states/regs/mt_regs.json (district)"),
           S("states", "mt_final.py", note="verbatim reach text -> states/regs/mt_final.json")]
          + STATES + WEST2("mt") + [LAKES_W, ENCODE],
    notes=["states/apply.py writes the whole MT/CA/OR/WA block and changes only its own share of the mt/ca/or/wa zone "
           "counts (Montana's 131 = its 38 + 93 west2 streams). A zones.js count change in section A should equal its "
           "rivers added or removed; west2/apply.py writes no counts, so a stream it adds or drops needs a hand bump.",
           "west2/skipped_mt.txt lists entries not mapped, with reasons."]),
 "ca": dict(title="California CDFW freshwater regulations", adapter=None,
    pre=["Put the new PDF at the path states/ca_final.py opens (states/regs/ca.pdf) and check CA_STD."],
    steps=[S("states", "ca_final.py", py="venv", note="reads the PDF by word position -> states/regs/ca_final.json")]
          + STATES + [ENCODE],
    notes=["The §7.40 salmon/steelhead tables are cited, not reproduced."]),
 "or": dict(title="Oregon ODFW sport fishing regulations", adapter=None,
    pre=["Put the new PDF at states/regs/or.pdf; check the zone page ranges in states/or_final.py and OR_STD."],
    steps=[S("states", "or_final.py", py="venv", note="-> states/regs/or_draft.json")] + STATES + [LAKES_W, ENCODE],
    notes=["The Willamette Zone is catch-and-release for trout, the opposite of every other zone."]),
 "wa": dict(title="Washington WDFW sport fishing rules", adapter=None,
    pre=["Re-create states/regs/wa.col.txt from the new pamphlet (the command was not saved), then check WA_STD."],
    steps=[S("states", "wa_final.py", note="reads wa.col.txt -> states/regs/wa_draft.json")] + STATES + [ENCODE],
    notes=[]),
 "co": dict(title="Colorado CPW fishing brochure", adapter="co",
    pre=["Put the new brochure next to the old one; point rockies/regs/co_extract.py at it (path, page range). "
         "Check CO_MAP and CO_STD in rockies/regs/assemble.py."],
    steps=[S("rockies/regs", "co_extract.py", py="venv", note="-> rockies/regs/co_entries.json")]
          + ASSEMBLE + WEST2("co") + [LAKES_W, ENCODE],
    notes=["rockies/apply.py changes only its own share of each zone count (Colorado's 224 = its 43 + 181 west2 "
           "streams). A zones.js count change in section A should equal its rivers added or removed; west2/apply.py "
           "writes no counts, so a stream it adds or drops needs a hand bump.",
           "Gold Medal marks against js/designations.js (hand-entered).",
           "west2/gen_co.py rewrites west2/co_parks.json (18 MB, not snapshotted) from rockies/parkrings.json."]),
 "ut": dict(title="Utah DWR fishing guidebook", adapter="ut",
    pre=["Put the new guidebook next to the old one; point rockies/regs/ut_extract.py at it (path, page range). "
         "Check UT_MAP, UT_PART, UT_STD in rockies/regs/assemble.py and SEASON/PART in west2/gen_ut.py."],
    steps=[S("rockies/regs", "ut_extract.py", py="venv", note="-> rockies/regs/ut_entries.json")] + ASSEMBLE
          + [S("west2", "fetch_counties.py", "ut", "49", note="exits at once while osm/aux/ut_counties.json exists")]
          + WEST2("ut") + [LAKES_W, ENCODE],
    notes=["'See X' entries must still resolve; Blue Ribbon marks against js/designations.js."]),
 "ak": dict(title="Alaska ADF&G regulation summaries", adapter="ak",
    pre=["Point ak_lines.py, ak_extract.py and ak_assemble.py at the four new PDFs, and regenerate "
         "rockies/pdf/ak_<book>_pNN.txt (ak_assemble.py falls back to them)."],
    steps=[S("rockies/regs", "ak_lines.py", py="venv", note="-> rockies/regs/ak_lines.json (what ak_assemble.py reads)"),
           S("rockies/regs", "ak_extract.py", py="venv", note="-> rockies/regs/ak_entries.json (the entry index for section C)")]
          + ASSEMBLE + [ENCODE],
    notes=["Cited pages (Kenai mainstem, Gulkana) and the area general-regulation pages are typed into ak_assemble.py."]),
 "nm-az-nv-sd": dict(title="New Mexico, Arizona, Nevada, South Dakota", adapter=None,
    pre=["Regenerate the page texts east_assemble.py reads (east/pdf/<book>_pNN.txt); the AZ, NV and SD entries "
         "are typed into rockies/regs/east_assemble.py."],
    steps=ASSEMBLE + [ENCODE], notes=[]),
 "mi": dict(title="Michigan DNR fishing regulations", adapter="mi",
    pre=["Point east/mi_regs.py at the new PDF and its Gear Restricted Streams pages; check the Type table in "
         "east/mi_build.py."],
    steps=[S("east", "mi_regs.py", py="venv", note="-> east/mi_gr.json"),
           S("east", "mi_build.py", note="-> east/mi_built.json (EGLE reaches from the cached east/mi/*.json)"),
           S("east", "mi_apply.py", note="fence 'michigan trout streams'; mi zone count"), ENCODE],
    notes=["Re-fetch the EGLE Type layer (east/mi_fetch.py, network) only on purpose."]),
 "wy": dict(title="Wyoming WGFD Chapter 46", adapter=None,
    pre=["Edit the verbatim Chapter 46 quotes in wy/specs.py against the new chapter (wy/ch46.txt)."],
    steps=[S("wy", "build.py", note="-> wy/built.json and wy/build.log (reads the staged rivers-data.js)"),
           S("wy", "apply.py", note="fence 'wyoming wgfd streams'"), ENCODE],
    notes=["Only if build.py reports changed geometry: ../flowdir.py --epqs --only <ids> (network), then this chain "
           "again. Never a full flowdir.py."]),
 "wi": dict(title="Wisconsin WDNR trout-regulation layer", adapter=None,
    pre=["wi/build.py re-fetches a stream only when its wi/f_<id>.json is missing: delete those files to pull the "
         "current WDNR layer (network)."],
    steps=[S("wi", "build.py", net=True, note="-> wi/built.json (network for any missing wi/f_*.json)"),
           S("wi", "apply.py", note="fence 'wisconsin trout streams'; wi zone count"), ENCODE],
    notes=[]),
 "ia-trout": dict(title="Iowa DNR Trout Stream Search", adapter=None,
    pre=[],
    steps=[S("iowa", "dnr_trout.py", "--refetch", net=True, note="re-downloads the stream pages and layer 4 (network)"),
           S("iowa", "driftless_parking.py", note="fence 'ne iowa dnr parking'"),
           S("iowa/watertrails", "build.py", note="dedupes against the pins above; reads the staged rivers-data.js"),
           S("iowa/watertrails", "apply.py", note="restores upperiowa's water-trail sentence that dnr_trout.py drops"),
           ENCODE],
    notes=["If dnr_trout.py says geometry changed: ../flowdir.py --epqs --only <ids> (network), then "
           "`run --from 1` again (it then keeps the computed FLOW_REV). Never a full flowdir.py.",
           "The water-trail steps are here because watertrails/apply.py's docstring says re-running dnr_trout.py "
           "means re-running build.py and apply.py there."]),
 "ia-lakes": dict(title="Iowa DNR fishing booklet (Big Creek, Saylorville)", adapter=None,
    pre=["Edit iowa/lakes/build.py: booklet URL, PDF path and every cited page; each quoted fragment is asserted on "
         "its page. Add --refetch to the step by hand for fresh DNR pages (network)."],
    steps=[S("iowa/lakes", "build.py", py="venv", isolate=True, note="fences 'iowa lakes' and 'iowa lake access'"), ENCODE],
    notes=[]),
 "parks": dict(title="Western national parks (parks/)", adapter=None,
    pre=["Re-read each park's fishing page; edit parks/parkinfo.py GENERAL and parks/specs.py."],
    steps=[S("parks", "apply.py", note="fence 'western national parks'; park zone counts and bounds. Each gauge site "
             "keeps its key from the last run (state rivers share four park keys)"), ENCODE],
    notes=["The apply step's log line 'gauge keys: ...' must read 'referenced-but-undefined none'.",
           "The CO/UT/AK/AZ/NV park lines live in rockies/parkinfo.py and go through rockies/apply.py (co/ut/ak chains)."]),
 "hand": dict(title="Hand-entered sources (Yellowstone, Grand Teton, IDFG, Door County, access law, designations)",
    adapter=None, pre=["Edit the staged files by hand (<stage>/js/...), quoting the new edition verbatim; then run report."],
    steps=[], notes=["No chain: `run` has nothing to do. The report compares the staged files with the live app."]),
}
ALIASES = {"east": "nm-az-nv-sd"}
NO_INDEX = ["CA", "OR", "WA", "NM", "AZ", "NV", "SD", "WY", "IA", "WI"]

def resolve_source(k):
    k = ALIASES.get(k, k)
    if k not in SOURCES: die("unknown source %r; known: %s" % (k, ", ".join(list(SOURCES) + list(ALIASES))))
    return k


# ====================================================================================================== small helpers
def die(msg, code=2):
    sys.stderr.write("regreport: " + msg + "\n"); sys.exit(code)

def now_iso(): return datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def sha1_file(p):
    h = hashlib.sha1()
    with open(p, "rb") as f:
        for b in iter(lambda: f.read(1 << 20), b""): h.update(b)
    return h.hexdigest()

def rjson(p):
    with open(p, encoding="utf-8") as f: return json.load(f)

def wjson(p, x):
    tmp = p + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f: json.dump(x, f, indent=1, ensure_ascii=False)
    os.replace(tmp, p)

def tree_files(root, sub):
    """relative paths ('js/app.js') of every file under root/sub"""
    out = []; base = os.path.join(root, sub)
    for dp, dn, fn in os.walk(base):
        dn.sort()
        for f in sorted(fn): out.append(os.path.relpath(os.path.join(dp, f), root))
    return out

def staged_hashes(root):
    return {r: sha1_file(os.path.join(root, r)) for sub in STAGED for r in tree_files(root, sub)}

def fmt_size(n):
    if n is None: return "-"
    return "%d B" % n if n < 10240 else "%.1f KB" % (n / 1024) if n < 1048576 else "%.2f MB" % (n / 1048576)

def q(p): return "'" + p.replace("'", "'\\''") + "'"       # shell quoting for printed commands


# ====================================================================================================== snapshot
def classify(rel, size):
    """'snap' = copied to before/; 'big' = json over 5 MB, hashed only; 'cache'/'pdf' = stat only (re-fetchable
    tiles, booklet PDFs); None = not tracked (venv/, kit/, .git/, bytecode). The pipeline is a git repo: a commit made
    during a run must not show as a change the run made, nor be rolled back by abort."""
    parts = rel.split("/")
    if parts[0] in ("venv", "kit", ".git") or "__pycache__" in parts or rel.endswith(".pyc"): return None
    if (parts[0] == "osm_cache" or "osm" in parts[:-1]
            or rel.startswith(("bridges/nbi/", "iowa/watertrails/cache/", "wy/fg/", "poi/osm/"))
            or (len(parts) == 2 and parts[0] == "access" and rel.endswith(".json"))): return "cache"
    if rel.lower().endswith(".pdf"): return "pdf"
    if rel.endswith(".json") and size > BIG: return "big"
    return "snap"

def scan_pipe(hash_snap=True):
    """{'snap': {rel: [sha1, size]}, 'big': {rel: [sha1, size]}, 'stat': {rel: [size, mtime_ns]}}"""
    out = {"snap": {}, "big": {}, "stat": {}}
    for dp, dn, fn in os.walk(PIPE):
        if dp == PIPE: dn[:] = [d for d in dn if d not in ("venv", "kit", ".git")]
        dn.sort()
        for f in sorted(fn):
            p = os.path.join(dp, f); rel = os.path.relpath(p, PIPE)
            st = os.stat(p); c = classify(rel, st.st_size)
            if c is None: continue
            if c == "snap": out["snap"][rel] = [sha1_file(p) if hash_snap else None, st.st_size]
            elif c == "big": out["big"][rel] = [sha1_file(p), st.st_size]
            else: out["stat"][rel] = [st.st_size, st.st_mtime_ns]
    return out


# ====================================================================================================== run state
class Ctx:
    def __init__(self, a):
        self.app = os.path.abspath(a.app or TOOL_APP)
        self.kit = os.path.abspath(a.kit or os.path.join(PIPE, "kit"))
        self.runs = os.path.join(self.kit, "runs"); self.cur = os.path.join(self.kit, "CURRENT")
    def open_run(self, required=True):
        if not os.path.exists(self.cur):
            if required: die("no run is open (begin <source> first)")
            return None, None
        rd = open(self.cur, encoding="utf-8").read().strip()
        if not os.path.isabs(rd): rd = os.path.join(self.runs, rd)
        if not os.path.exists(os.path.join(rd, "run.json")):
            die("%s names a run that isn't there (%s); remove that file to start over" % (self.cur, rd))
        run = rjson(os.path.join(rd, "run.json"))
        if os.path.abspath(run["app"]) != self.app:
            die("the open run belongs to the app at %s, not %s (use --app)" % (run["app"], self.app))
        return rd, run
    def save(self, rd, run): wjson(os.path.join(rd, "run.json"), run)
    def close(self, rd, run, status):
        run["status"] = status; run["closed"] = now_iso(); self.save(rd, run)
        if os.path.exists(self.cur) and open(self.cur, encoding="utf-8").read().strip() == rd: os.remove(self.cur)

def human_cmd(st, stage):
    py = VENV_PY if st["py"] == "venv" else "python3"
    return "cd %s && FLYFISH_APP=%s %s%s %s" % (q(os.path.normpath(os.path.join(PIPE, st["dir"]))),
            q(stage), q(py) if py != "python3" else py, " -I" if st["isolate"] else "",
            " ".join([st["script"]] + st["args"]))

def print_chain(key, stage):
    s = SOURCES[key]
    print("Source %s: %s%s" % (key, s["title"], "  (registered as MANUAL: `run` will not execute it)" if s.get("manual") else ""))
    if s["pre"]:
        print("\nBefore the chain (by hand):")
        for x in s["pre"]: print("  - " + x)
    if s["steps"]:
        print("\nRun order (each command can be pasted as is):")
        for n, st in enumerate(s["steps"], 1):
            flags = [f for f, on in (("network", st["net"]), ("manual", st["manual"])) if on]
            print("  %2d. %s%s" % (n, human_cmd(st, stage), ("   [" + ", ".join(flags) + "]") if flags else ""))
            if st["note"]: print("      %s" % st["note"])
    if s["notes"]:
        print("\nAfterwards:")
        for x in s["notes"]: print("  - " + x)


# ====================================================================================================== begin
def cmd_begin(a, ctx):
    key = resolve_source(a.source)
    if not os.path.exists(os.path.join(ctx.app, "js", "rivers-data.js")): die("no js/rivers-data.js under %s" % ctx.app)
    os.makedirs(ctx.runs, exist_ok=True)
    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M")
    rid = "%s-%s" % (key, stamp); n = 2
    while os.path.exists(os.path.join(ctx.runs, rid)): rid = "%s-%s-%d" % (key, stamp, n); n += 1
    rd = os.path.join(ctx.runs, rid)
    try:
        fd = os.open(ctx.cur, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)       # claim the one open slot atomically
    except FileExistsError:
        die("a run is already open: %s\n  report, promote or abort it first" % open(ctx.cur, encoding="utf-8").read().strip())
    os.write(fd, rd.encode("utf-8")); os.close(fd)
    try:
        os.makedirs(rd)
        t0 = time.time(); man = scan_pipe(); nb = 0
        for rel in man["snap"]:
            dst = os.path.join(rd, "before", rel); os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy2(os.path.join(PIPE, rel), dst); nb += man["snap"][rel][1]
        wjson(os.path.join(rd, "before.json"), man)
        live = staged_hashes(ctx.app)
        for sub in STAGED:
            for dst in ("stage", "live-at-begin"):
                shutil.copytree(os.path.join(ctx.app, sub), os.path.join(rd, dst, sub), copy_function=shutil.copy2)
        run = dict(id=rid, source=key, app=ctx.app, pipe=PIPE, stage=os.path.join(rd, "stage"), created=now_iso(),
                   status="open", live=live, steps={}, note=a.note or "")
        ctx.save(rd, run)
    except BaseException:
        if os.path.exists(ctx.cur): os.remove(ctx.cur)
        shutil.rmtree(rd, ignore_errors=True); raise
    print("Opened run %s" % rid)
    print("  run dir : %s" % rd)
    print("  snapshot: %d pipeline files, %s, in before/ (%.0f s); %d big json hashed, %d cache/PDF files stat'ed"
          % (len(man["snap"]), fmt_size(nb), time.time() - t0, len(man["big"]), len(man["stat"])))
    print("  stage   : %s  (js/ and data/hazards/, %d files; live sha1s recorded)" % (run["stage"], len(live)))
    print("\nEvery apply must write into the stage. In this shell:\n\n  export FLYFISH_APP=%s\n" % q(run["stage"]))
    print_chain(key, run["stage"])
    print("\nThen: regreport.py run   (or the commands above by hand), regreport.py report, and promote or abort.")
    return 0


# ====================================================================================================== run
def say(*args, **kw):
    """print that survives a closed stdout (the run piped into `head`): the chain must keep running and logging"""
    kw.setdefault("flush", True)
    try: print(*args, **kw)
    except BrokenPipeError:
        try: sys.stdout = open(os.devnull, "w")
        except OSError: pass

def cmd_run(a, ctx):
    rd, run = ctx.open_run()
    src = SOURCES[run["source"]]; steps = src["steps"]
    if not steps: print("Source %s has no chain: edit the stage by hand, then report." % run["source"]); return 0
    sel = list(range(1, len(steps) + 1))
    if a.only: sel = [int(x) for x in a.only.split(",") if x.strip()]
    else:
        lo = a.from_ or 1; hi = a.to or len(steps); sel = [n for n in sel if lo <= n <= hi]
    bad = [n for n in sel if not 1 <= n <= len(steps)]
    if bad: die("no step %s (the chain has %d)" % (bad, len(steps)))
    if a.print:
        say("export FLYFISH_APP=%s\n" % q(run["stage"]))
        for n in sel: print("%2d. %s" % (n, human_cmd(steps[n - 1], run["stage"])))
        return 0
    if src.get("manual"): die("source %s is registered as manual; print the steps with `run --print` and see the notes" % run["source"])
    env = dict(os.environ, FLYFISH_APP=run["stage"], PYTHONDONTWRITEBYTECODE="1")
    os.makedirs(os.path.join(rd, "logs"), exist_ok=True)
    py3 = shutil.which("python3") or sys.executable
    for n in sel:
        st = steps[n - 1]
        say("\n[%d/%d] %s" % (n, len(steps), human_cmd(st, run["stage"])))
        if st["manual"]:
            say("  manual step: %s\n  do it by hand, then resume with: run --from %d" % (st["note"], n + 1)); return 3
        exe = VENV_PY if st["py"] == "venv" else py3
        argv = [exe] + (["-I"] if st["isolate"] else []) + [st["script"]] + st["args"]
        log = os.path.join(rd, "logs", "%02d-%s-%s.log" % (n, st["dir"].replace("/", "_").strip("._") or "root",
                                                           os.path.basename(st["script"]).replace(".py", "")))
        t0 = time.time()
        with open(log, "w", encoding="utf-8") as lf:
            lf.write("$ %s\n" % human_cmd(st, run["stage"]))
            p = subprocess.Popen(argv, cwd=os.path.join(PIPE, st["dir"]), env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.STDOUT, text=True, encoding="utf-8", errors="replace", bufsize=1)
            for line in p.stdout:
                lf.write(line); say("    " + line, end="")
            rc = p.wait()
        run["steps"][str(n)] = dict(script=os.path.join(st["dir"], st["script"]), args=st["args"], rc=rc,
                                    seconds=round(time.time() - t0, 1), at=now_iso(), log=os.path.relpath(log, rd))
        ctx.save(rd, run)
        # a script that ignored FLYFISH_APP would have written the live app: stop the chain at once if so
        changed = [r for r, h in staged_hashes(ctx.app).items() if run["live"].get(r) != h]
        changed += [r for r in run["live"] if not os.path.exists(os.path.join(ctx.app, r))]
        if changed:
            die("STOP: the LIVE app changed during step %d: %s\n  The copy taken at begin is in %s"
                % (n, ", ".join(sorted(set(changed))[:10]), os.path.join(rd, "live-at-begin")))
        if rc:
            say("\nStep %d failed (exit %d). Log: %s\nFix the cause, then resume with: regreport.py run --from %d" % (n, rc, log, n))
            return 1
        say("  ok (%.1f s)" % (time.time() - t0))
    say("\nChain done. Next: regreport.py report")
    return 0


# ====================================================================================================== JS parsing
_STRRE = {qq: re.compile(qq + r"[^" + qq + r"\\]*(?:\\.[^" + qq + r"\\]*)*" + qq, re.S) for qq in ('"', "'", "`")}
_STRUCT = re.compile(r"[\"'`/\[\]{}(),]")
_NORM = re.compile(r"[\"'`]|/\*|//|\s+")
_IDCH = re.compile(r"[\w$]")
_KEY = re.compile(r"""(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([A-Za-z_$][\w$]*)|(-?\d+(?:\.\d+)?)):""", re.S)
_TOP = re.compile(r"(?m)^(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=[ \t]*|[\"'`]|/\*|//")
_STRVAL = re.compile(r"""(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')(?:\+(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))*\Z""", re.S)

def skip_str(t, j):
    m = _STRRE[t[j]].match(t, j)
    return m.end() if m else len(t)

def split_top(t, a, b):
    """t[a] opens a literal and t[b] closes it: spans of its top-level, comma-separated parts (strings, comments and
    nesting skipped by the same rules as jsmatch.close)."""
    parts, depth, s, j = [], 0, a + 1, a + 1
    while True:
        m = _STRUCT.search(t, j, b)
        if not m: break
        j = m.start(); c = t[j]
        if c in "\"'`": j = skip_str(t, j); continue
        if c == "/":
            if t.startswith("/*", j): k = t.find("*/", j + 2); j = b if k < 0 else k + 2; continue
            if t.startswith("//", j): k = t.find("\n", j); j = b if k < 0 else k; continue
            j += 1; continue
        if c in "[{(": depth += 1
        elif c in "]})": depth -= 1
        elif depth == 0: parts.append((s, j)); s = j + 1
        j += 1
    parts.append((s, b))
    return parts

def norm_js(s):
    """comments dropped, whitespace outside strings removed (kept as one space only between two word characters):
    two texts that differ only in layout or comments normalise to the same string"""
    out = []; j = 0; n = len(s); pend = False
    def emit(x):
        nonlocal pend
        if not x: return
        if pend and out and _IDCH.match(out[-1][-1]) and _IDCH.match(x[0]): out.append(" ")
        pend = False; out.append(x)
    while j < n:
        m = _NORM.search(s, j)
        if not m: emit(s[j:]); break
        emit(s[j:m.start()]); g = m.group(); j = m.start()
        if g in ('"', "'", "`"): k = skip_str(s, j); emit(s[j:k]); j = k
        elif g == "/*": k = s.find("*/", j + 2); j = n if k < 0 else k + 2; pend = True
        elif g == "//": k = s.find("\n", j); j = n if k < 0 else k; pend = True
        else: j = m.end(); pend = True
    return "".join(out)

def js_unquote(tok):
    """one JS string literal -> its value"""
    b = tok[1:-1]; out = []; i = 0; n = len(b)
    while i < n:
        c = b[i]
        if c != "\\": out.append(c); i += 1; continue
        i += 1; c = b[i] if i < n else ""
        if c in "nrtbfv": out.append({"n": "\n", "r": "\r", "t": "\t", "b": "\b", "f": "\f", "v": "\v"}[c])
        elif c == "0" and not (i + 1 < n and b[i + 1].isdigit()): out.append("\0")
        elif c == "x": out.append(chr(int(b[i + 1:i + 3], 16))); i += 2
        elif c == "u":
            if b[i + 1:i + 2] == "{": k = b.index("}", i); out.append(chr(int(b[i + 2:k], 16))); i = k
            else: out.append(chr(int(b[i + 1:i + 5], 16))); i += 4
        elif c in "\n\r": pass
        else: out.append(c)
        i += 1
    s = "".join(out)
    try: return s.encode("utf-16", "surrogatepass").decode("utf-16")
    except UnicodeError: return s

def js_value(nv):
    """a normalised value -> python str when it is a string literal (or a + of them), else None"""
    if nv is None or not _STRVAL.match(nv): return None
    return "".join(js_unquote(m.group()) for m in re.finditer(r'''"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*\'''', nv, re.S))

def key_of(nv):
    m = _KEY.match(nv)
    if not m: return nv, None
    k = m.group(3) or m.group(4)
    if k is None: k = js_unquote(nv[m.start():m.end() - 1])
    return k, nv[m.end():]

def fast_close(t, i):
    """jsmatch.close's rules (strings and comments skipped), driven by a regex so a 50 KB cz string isn't walked one
    character at a time; used inside entries, while the constants themselves are cut with jsmatch.close"""
    depth, j = 0, i
    while True:
        m = _STRUCT.search(t, j)
        if not m: raise ValueError("unbalanced")
        j = m.start(); c = t[j]
        if c in "\"'`": j = skip_str(t, j); continue
        if c == "/":
            if t.startswith("/*", j): j = t.index("*/", j + 2) + 2; continue
            if t.startswith("//", j): j = t.index("\n", j); continue
            j += 1; continue
        if c in "[{(": depth += 1
        elif c in "]})":
            depth -= 1
            if depth == 0: return j
        j += 1

def obj_fields(nv):
    """a normalised object literal -> (fields {name: normalised value}, names in order, duplicate names)"""
    if not nv.startswith("{"): return None
    try: e = fast_close(nv, 0)
    except Exception: return None
    fields, order, dups = {}, [], []
    for p, r in split_top(nv, 0, e):
        part = nv[p:r]
        if not part: continue
        k, v = key_of(part)
        if k in fields: dups.append(k)
        fields[k] = v; order.append(k)
    return fields, order, dups

class Entry:
    __slots__ = ("key", "raw", "norm", "fields", "order", "fdups", "index", "fence")

class Const:
    def __init__(self, name, kind): self.name, self.kind, self.entries, self.dups = name, kind, [], []

def parse_js(text):
    """{name: Const} for each top-level `const NAME = [...]` / `{...}`, and the text outside those literals (each
    literal replaced by «NAME»), so a change anywhere in the file is accounted for"""
    consts, resid, j, last, n = {}, [], 0, 0, len(text)
    while True:
        m = _TOP.search(text, j)
        if not m: break
        g = m.group()
        if g in ('"', "'", "`"): j = skip_str(text, m.start()); continue
        if g == "/*": k = text.find("*/", m.end()); j = n if k < 0 else k + 2; continue
        if g == "//": k = text.find("\n", m.end()); j = n if k < 0 else k; continue
        name, k = m.group(1), m.end()
        if k < n and text[k] in "[{":
            e = js_close(text, k)
            consts[name] = parse_const(text, name, k, e)
            resid.append(text[last:k]); resid.append("«%s»" % name); last = e + 1; j = e + 1
        else: j = k
    resid.append(text[last:])
    return consts, "".join(resid)

_FENCE = re.compile(r"/\* (>>>|<<<) ([^(*]+?)\s*(?:\(generated|\*/)")

def parse_const(t, name, a, b):
    c = Const(name, "array" if t[a] == "[" else "object"); seen = {}; fence = None
    for i, (p, r) in enumerate(split_top(t, a, b)):
        raw = t[p:r]
        for m in _FENCE.finditer(raw):    # "/* >>> name (generated by …) */" opens a pipeline's block, "/* <<< name */" closes it
            fence = m.group(2) if m.group(1) == ">>>" else None
        nv = norm_js(raw)
        if not nv: continue
        e = Entry(); e.raw = raw; e.index = i; e.fields = e.order = e.fdups = None; e.fence = fence
        if c.kind == "object":
            k, v = key_of(nv); e.norm = v if v is not None else nv
        else:
            e.norm = nv; k = None
        of = obj_fields(e.norm) if e.norm else None
        if of: e.fields, e.order, e.fdups = of
        if c.kind == "array":
            k = None
            if e.fields:
                for f in ("id", "name", "text"):
                    k = js_value(e.fields.get(f))
                    if k: break
            k = k or "#%d" % i
        if k in seen:
            seen[k] += 1; c.dups.append(k); k = "%s #%d" % (k, seen[k])
        else: seen[k] = 1
        e.key = k; c.entries.append(e)
    return c


# ====================================================================================================== section A
REG_FIELDS = ("name", "region", "parkRegsSrc", "parkRegs", "troutRegs", "regs", "park")
DETAIL = ("rivers-data.js", "tiers.js", "zones.js", "designations.js", "access-laws.js")   # parsed, not just hashed

def read(p):
    with open(p, encoding="utf-8") as f: return f.read()

def strip_tags(s):
    s = re.sub(r"(?i)<br\s*/?>", "\n", s)
    s = re.sub(r"(?i)</(p|div|li|summary|details|tr|h\d)>", "\n", s)
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t ]+", " ", s); s = re.sub(r" *\n *", "\n", s); s = re.sub(r"\n{3,}", "\n\n", s)
    return s.strip()

def shown(nv):
    """what a field holds, as text: the string for a string literal, else the normalised source"""
    v = js_value(nv)
    return v if v is not None else ("" if nv is None else nv)

def diff_const(old, new):
    om = {e.key: e for e in old.entries}; nm = {e.key: e for e in new.entries}
    added = [e.key for e in new.entries if e.key not in om]
    removed = [e.key for e in old.entries if e.key not in nm]
    changed, layout = [], []
    for e in new.entries:
        o = om.get(e.key)
        if o is None: continue
        if o.norm != e.norm:
            if o.fields is not None and e.fields is not None:
                fs = [f for f in list(dict.fromkeys(o.order + e.order)) if o.fields.get(f) != e.fields.get(f)]
                if not fs: fs = ["(field order)"]
            else: fs = None
            changed.append((e.key, fs))
        elif o.raw.strip() != e.raw.strip(): layout.append(e.key)
    common_o = [e.key for e in old.entries if e.key in nm]; common_n = [e.key for e in new.entries if e.key in om]
    moved = []
    if common_o != common_n:
        sm = difflib.SequenceMatcher(None, common_o, common_n, autojunk=False)
        keep = set()
        for blk in sm.get_matching_blocks(): keep.update(common_o[blk.a:blk.a + blk.size])
        moved = [k for k in common_n if k not in keep]
    blocks = []                            # a re-inserted generated block reads as one line: the block whose position
    def border(c):                         # among the blocks changed most is the one that moved (the others just shift)
        seen = []
        for e in c.entries:
            if e.fence and e.fence not in seen: seen.append(e.fence)
        return seen
    bo, bn = border(old), border(new)
    if moved and bo != bn and set(bo) == set(bn):
        dz = {f: bn.index(f) - bo.index(f) for f in bo}; mx = max(abs(v) for v in dz.values())
        blocks = [(f, bo.index(f) + 1, bn.index(f) + 1, len(bn), sum(1 for e in new.entries if e.fence == f)) for f in bo if abs(dz[f]) == mx]
    return dict(added=added, removed=removed, changed=changed, layout=layout, moved=moved, blocks=blocks,
                dups=sorted(set(new.dups) | set(old.dups)))

def compare_app(old_root, new_root, subs=STAGED):
    """Section A: what the app would show. old_root/new_root hold js/ (and data/hazards/)."""
    A = dict(rivers=dict(regs=[], other=[], added=[], removed=[]), lakes=dict(regs=[], other=[], added=[], removed=[]),
             tiers=dict(changed=[], added=[], removed=[]), consts=[], files=[], resid=[], layout=[], warnings=[],
             extra=[])
    of = {r for s in subs for r in tree_files(old_root, s)}; nf = {r for s in subs for r in tree_files(new_root, s)}
    for r in sorted(of | nf):
        po, pn = os.path.join(old_root, r), os.path.join(new_root, r)
        if r not in nf: A["files"].append(dict(path=r, status="removed", old=os.path.getsize(po), new=None)); continue
        if r not in of: A["files"].append(dict(path=r, status="added", old=None, new=os.path.getsize(pn))); continue
        if os.path.getsize(po) == os.path.getsize(pn) and sha1_file(po) == sha1_file(pn): continue
        A["files"].append(dict(path=r, status="changed", old=os.path.getsize(po), new=os.path.getsize(pn)))
    for f in A["files"]:
        base = os.path.basename(f["path"])
        if not (f["path"].startswith("js/") and base in DETAIL and f["status"] == "changed"): continue
        to, tn = read(os.path.join(old_root, f["path"])), read(os.path.join(new_root, f["path"]))
        try:
            co, ro = parse_js(to); cn, rn = parse_js(tn)
        except Exception as ex:               # a half-written or broken file is exactly what the report must show
            A["warnings"].append("%s could not be parsed (%s: %s); a line diff is shown instead" % (f["path"], type(ex).__name__, ex))
            dl = list(difflib.unified_diff(to.splitlines(), tn.splitlines(), "live/" + f["path"], "stage/" + f["path"], n=1, lineterm=""))
            A["resid"].append(dict(file=base, diff=[x[:400] for x in dl[:80]], more=max(0, len(dl) - 80))); continue
        for name in sorted(set(co) | set(cn), key=lambda x: (x not in ("RIVERS", "LAKES", "TIERS"), x)):
            if name not in cn or name not in co:
                A["consts"].append(dict(file=base, const=name, note="constant %s" % ("removed" if name not in cn else "added")))
                continue
            d = diff_const(co[name], cn[name])
            for k in d["dups"]: A["warnings"].append("%s: %s has more than one entry %r (the last one wins in an object)" % (base, name, k))
            if base == "rivers-data.js" and name in ("RIVERS", "LAKES"):
                tgt = A["rivers" if name == "RIVERS" else "lakes"]
                om = {e.key: e for e in co[name].entries}; nm = {e.key: e for e in cn[name].entries}
                for k in d["added"]:
                    e = nm[k]; fl = e.fields or {}
                    tgt["added"].append(dict(id=k, name=shown(fl.get("name")), region=shown(fl.get("region") or fl.get("park")),
                                             state=shown(fl.get("state")), regs={x: shown(fl[x]) for x in REG_FIELDS if x in fl}))
                for k in d["removed"]:
                    e = om[k]; fl = e.fields or {}
                    tgt["removed"].append(dict(id=k, name=shown(fl.get("name")), region=shown(fl.get("region") or fl.get("park")),
                                               state=shown(fl.get("state")), regs={x: shown(fl[x]) for x in REG_FIELDS if x in fl}))
                for k, fs in d["changed"]:
                    o, e = om[k], nm[k]; fo, fn = o.fields or {}, e.fields or {}
                    fs = fs or ["(whole entry)"]
                    rf = [x for x in fs if x in REG_FIELDS]; other = [x for x in fs if x not in REG_FIELDS]
                    label = dict(id=k, name=shown(fn.get("name") or fo.get("name")),
                                 region=shown(fn.get("region") or fn.get("park") or fo.get("region") or fo.get("park")))
                    if rf:
                        items = []
                        for x in rf:
                            a, b = shown(fo.get(x)), shown(fn.get(x))
                            items.append(dict(field=x, old=a if x in fo else None, new=b if x in fn else None,
                                              markup_only=(x in fo and x in fn and strip_tags(a) == strip_tags(b))))
                        tgt["regs"].append(dict(label, fields=items))
                    if other: tgt["other"].append(dict(label, fields=other))
                if d["moved"] or d["layout"]:
                    A["layout"].append(dict(file=base, const=name, moved=d["moved"], layout=d["layout"], blocks=d["blocks"]))
            elif base == "tiers.js" and name == "TIERS":
                om = {e.key: e for e in co[name].entries}; nm = {e.key: e for e in cn[name].entries}
                A["tiers"]["added"] += [dict(key=k, new=nm[k].norm) for k in d["added"]]
                A["tiers"]["removed"] += [dict(key=k, old=om[k].norm) for k in d["removed"]]
                A["tiers"]["changed"] += [dict(key=k, old=om[k].norm, new=nm[k].norm) for k, _ in d["changed"]]
                if d["moved"] or d["layout"]:
                    A["layout"].append(dict(file=base, const=name, moved=d["moved"], layout=d["layout"], blocks=d["blocks"]))
            else:
                if d["added"] or d["removed"] or d["changed"]:
                    om = {e.key: e for e in co[name].entries}; nm = {e.key: e for e in cn[name].entries}
                    ch = []
                    for k, fs in d["changed"]:
                        det = []
                        for x in (fs or []):
                            if x.startswith("("): det.append(x); continue
                            a, b = (om[k].fields or {}).get(x), (nm[k].fields or {}).get(x)
                            det.append("%s %s -> %s" % (x, clip(a), clip(b)) if len((a or "") + (b or "")) < 120 else x)
                        ch.append(dict(key=k, fields=det or None, old=None if fs else clip(om[k].norm, 300),
                                       new=None if fs else clip(nm[k].norm, 300)))
                    A["consts"].append(dict(file=base, const=name, added=d["added"], removed=d["removed"], changed=ch))
                if d["moved"] or d["layout"]:
                    A["layout"].append(dict(file=base, const=name, moved=d["moved"], layout=d["layout"], blocks=d["blocks"]))
        if ro != rn:
            dl = list(difflib.unified_diff(ro.splitlines(), rn.splitlines(), "live/" + f["path"], "stage/" + f["path"], n=1, lineterm=""))
            A["resid"].append(dict(file=base, diff=dl[:80], more=max(0, len(dl) - 80)))
        f["detail"] = True
    for sub in ("", "data"):                        # anything a script wrote into the stage outside js/ and data/hazards/
        d0 = os.path.join(new_root, sub)
        if not os.path.isdir(d0): continue
        for x in sorted(os.listdir(d0)):
            r = os.path.join(sub, x) if sub else x
            if r in ("js", "data", "data/hazards") or x.startswith("."): continue
            A["extra"].append(r)
    return A

def clip(s, n=60):
    s = "" if s is None else s
    return s if len(s) <= n else s[:n - 1] + "…"

def a_counts(A):
    R, L, T = A["rivers"], A["lakes"], A["tiers"]
    return dict(river_regs=len(R["regs"]), river_added=len(R["added"]), river_removed=len(R["removed"]), river_other=len(R["other"]),
                lake_regs=len(L["regs"]), lake_added=len(L["added"]), lake_removed=len(L["removed"]), lake_other=len(L["other"]),
                tiers=len(T["changed"]) + len(T["added"]) + len(T["removed"]),
                consts=len(A["consts"]), layout=len(A["layout"]), resid=len(A["resid"]), files=len(A["files"]),
                extra=len(A["extra"]))


# ====================================================================================================== section B
def compare_pipe(rd):
    before = rjson(os.path.join(rd, "before.json")); now = scan_pipe()
    B = dict(changed=[], added=[], removed=[], big=[], stat=dict(changed=[], added=[], removed=[]))
    for rel, (h, sz) in before["snap"].items():
        if rel not in now["snap"]:
            if rel in now["big"]: B["changed"].append(dict(path=rel, old=sz, new=now["big"][rel][1], note="grew past 5 MB"))
            else: B["removed"].append(dict(path=rel, old=sz))
        elif now["snap"][rel][0] != h: B["changed"].append(dict(path=rel, old=sz, new=now["snap"][rel][1]))
    for rel, (h, sz) in now["snap"].items():
        if rel not in before["snap"] and rel not in before["big"]: B["added"].append(dict(path=rel, new=sz))
    for rel in sorted(set(before["big"]) | set(now["big"])):
        o, n = before["big"].get(rel), now["big"].get(rel)
        if o and n and o[0] == n[0]: continue
        if rel in before["snap"]: continue
        B["big"].append(dict(path=rel, old=o and o[1], new=n and n[1], status="removed" if not n else "added" if not o else "changed"))
    for rel in sorted(set(before["stat"]) | set(now["stat"])):
        o, n = before["stat"].get(rel), now["stat"].get(rel)
        if o == n: continue
        B["stat"]["removed" if not n else "added" if not o else "changed"].append(rel)
    return B

def b_count(B): return len(B["changed"]) + len(B["added"]) + len(B["removed"]) + len(B["big"])


# ====================================================================================================== section C
class Side:
    """one side of a comparison: the before/ snapshot or the live pipeline dir"""
    def __init__(self, root, label): self.root, self.label = root, label
    def path(self, rel): return os.path.join(self.root, rel)
    def text(self, rel):
        p = self.path(rel)
        return read(p) if os.path.exists(p) else None
    def json(self, rel):
        t = self.text(rel)
        return json.loads(t) if t is not None else None

def py_literal(src, name):
    """the literal assigned to NAME at module level, without running the module"""
    if src is None: return None
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == name for t in node.targets):
            try: return ast.literal_eval(node.value)
            except ValueError: return None
    return None

def lake_names(side, field):
    """{booklet name: [lake ids]} from lakes/build.py's dict(id=..., coname=/utname=...) rows"""
    src = side.text("lakes/build.py"); out = {}
    if not src: return out
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "dict":
            kw = {k.arg: k.value for k in node.keywords if k.arg}
            if "id" in kw and field in kw and isinstance(kw[field], ast.Constant) and isinstance(kw["id"], ast.Constant):
                out.setdefault(kw[field].value, []).append(kw["id"].value)
    return out

def by_name_county(entries, mapping):
    """assemble.py's find(): name equal, and the county (when given) inside the entry's county text"""
    used = {}
    for rid, keys in (mapping or {}).items():
        for nm, cty in (keys or []):
            for k, e in entries.items():
                if e["name"] == nm and (cty is None or cty in e["county"]): used.setdefault(k, set()).add(rid)
    return used

def specs_heads(side, rel, entries, see=False):
    used = {}; S_ = side.json(rel) or []
    byhead = {}
    for k, e in entries.items(): byhead.setdefault(e.get("head"), []).append(k)
    for sp in S_:
        for k in byhead.get(sp.get("head"), []): used.setdefault(k, set()).add(sp["id"])
        if see and sp.get("see"):
            for k, e in entries.items():
                if e["name"] == sp["see"]: used.setdefault(k, set()).add(sp["id"])
    return used

def merge_used(*ds):
    out = {}
    for d in ds:
        for k, v in d.items(): out.setdefault(k, set()).update(v)
    return out

def keyed(rows, keyf):
    out = {}; seen = {}
    for r in rows:
        k = keyf(r)
        if k in seen: seen[k] += 1; k = "%s #%d" % (k, seen[k])
        else: seen[k] = 1
        out[k] = r
    return out

def load_ut(side):
    E = side.json("rockies/regs/ut_entries.json")
    if E is None: return None, {}
    ent = keyed([dict(head=e["head"], name=e["name"], county=e.get("county", ""),
                      text=("[Blue Ribbon] " if e.get("blue") else "") + "\n".join(e["body"])) for e in E], lambda r: r["head"])
    asm = side.text("rockies/regs/assemble.py")
    used = merge_used(by_name_county(ent, py_literal(asm, "UT_MAP")),
                      specs_heads(side, "west2/specs_ut.json", ent, see=True),
                      {k: set(ids) for nm, ids in lake_names(side, "utname").items() for k, e in ent.items() if e["name"] == nm})
    return ent, used

def load_co(side):
    E = side.json("rockies/regs/co_entries.json")
    if E is None: return None, {}
    ent = keyed([dict(head=e["head"], name=e["name"], county=e.get("county", ""),
                      text=("[Gold Medal] " if e.get("gold") else "") + "\n".join(e["body"])) for e in E], lambda r: r["head"])
    asm = side.text("rockies/regs/assemble.py")
    used = merge_used(by_name_county(ent, py_literal(asm, "CO_MAP")),
                      specs_heads(side, "west2/specs_co.json", ent),
                      {k: set(ids) for nm, ids in lake_names(side, "coname").items() for k, e in ent.items() if e["name"] == nm})
    return ent, used

def load_ak(side):
    E = side.json("rockies/regs/ak_entries.json")
    if E is None: return None, {}
    rows = [dict(book=b, head=e["head"], name=e.get("name", ""), page=e.get("page"), text="\n".join(e["body"]))
            for b, es in E.items() for e in es]
    ent = keyed(rows, lambda r: "%s | %s" % (r["book"], r["head"]))
    used = {}
    for rid, v in (py_literal(side.text("rockies/regs/ak_assemble.py"), "M") or {}).items():
        if not v: continue
        book, head = v                     # ak_assemble.grab(): the first line in that book starting with the heading
        k = next((k for k, e in ent.items() if e["book"] == book and e["head"].startswith(head)), None)
        if k: used.setdefault(k, set()).add(rid)
    return ent, used

def mt_parser(side):
    """hd()/grab()/is_stream() taken from this side's west2/gen_mt.py (its own year's parser) and the raw text it reads"""
    src = side.text("west2/gen_mt.py")
    if src is None: return None
    tree = ast.parse(src)
    want = {"sq", "JUNK", "hd", "is_new_water", "grab", "clean_name", "is_stream", "STREAM", "STILL"}
    nodes = [n for n in tree.body if (isinstance(n, ast.FunctionDef) and n.name in want)
             or (isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id in want for t in n.targets))]
    m = re.search(r"states/regs/(mt\d{4}\.raw\.txt)", src)
    raw_rel = "states/regs/" + (m.group(1) if m else "mt2026.raw.txt")
    raw = side.text(raw_rel)
    if raw is None: return None
    ns = {"re": re, "RAW": [l.rstrip("\n") for l in raw.split("\n")]}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "gen_mt.py (hd/grab)", "exec"), ns)
    lohi = None
    for n in tree.body:                    # gen_mt's own fixed line range, the fallback when the markers aren't found
        if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Tuple) and [getattr(t, "id", "") for t in n.targets[0].elts] == ["LO", "HI"]:
            lohi = ast.literal_eval(n.value)
    return ns, raw_rel, lohi

def mt_sections(RAW, lohi):
    """[(district, first line, end line)] of the District Exceptions listings: from the 'X District Exceptions To
    Standard Regulations' line to the end of the run of listing pages ('Waterbody/Section' header) it starts"""
    pages = [i for i, l in enumerate(RAW) if re.match(r"^=====PAGE \d+=====$", l)] + [len(RAW)]
    starts = [(i, m.group(1)) for i, l in enumerate(RAW)
              for m in [re.match(r"^\s*(Western|Central|Eastern) District Exceptions [Tt]o Standard Regulations\s*$", l)] if m]
    secs = []
    for n, (s, dist) in enumerate(starts):
        nxt = starts[n + 1][0] if n + 1 < len(starts) else len(RAW)
        end = nxt
        for pi, p0 in enumerate(pages[:-1]):
            if p0 <= s: continue
            body = RAW[p0:pages[pi + 1]]
            if not any("Waterbody/Section" in x for x in body): end = min(end, p0); break
        secs.append((dist, s + 1, end))
    if secs: return secs, "markers"
    if lohi:
        lo, hi = lohi
        return [("District", lo, hi)], "gen_mt.py LO/HI"
    return [], "none"

def load_mt(side):
    P = mt_parser(side)
    if P is None: return None, {}
    ns, raw_rel, lohi = P; RAW = ns["RAW"]; hd, grab = ns["hd"], ns["grab"]
    secs, how = mt_sections(RAW, lohi)
    rows, heads = [], []                  # heads: (line, key) for the containing-entry lookup
    for dist, lo, hi in secs:
        i = lo
        while i < hi:
            h = hd(RAW[i])
            if not h: i += 1; continue
            head, j = h, i + 1             # gen_mt: a wrapped heading's "( ... )" line belongs to it
            while j < len(RAW) and RAW[j].strip().startswith("(") and hd(RAW[j]) and j - i < 3: head += " " + hd(RAW[j]); j += 1
            try: body = grab(i)
            except Exception as ex: body = ["(grab failed: %s)" % ex]
            stream = None
            if "clean_name" in ns and "is_stream" in ns:
                try: stream = bool(ns["is_stream"](ns["clean_name"](head)))
                except Exception: stream = None
            rows.append(dict(district=dist, head=head, line=i, text="\n".join(body), raw=RAW[i].strip(), stream=stream, hi=hi))
            i = j
    ent = keyed(rows, lambda r: "%s | %s" % (r["district"], r["head"]))
    order = sorted((e["line"], k, e["hi"]) for k, e in ent.items())
    def containing(line):
        best = None
        for ln, k, hi in order:
            if ln <= line < hi: best = k
            elif ln > line: break
        return best
    used = {}
    HEAD = py_literal(side.text("states/mtregs.py"), "HEAD") or {}
    for rid, h in HEAD.items():           # mtregs.py's own heading test
        if not h: continue
        for k, e in ent.items():
            l = re.sub(r"^\s*(per child\.)?", "", RAW[e["line"]])
            if l.startswith(h + " ") or l.strip() == h or l.startswith(h + "–") or l.startswith(h + "  "):
                used.setdefault(k, set()).add(rid)
    fin = side.text("states/mt_final.py")
    if fin:                               # mt_final.py's grab(start): the first line starting with it
        for node in ast.parse(fin).body:
            if not (isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Subscript)): continue
            sl = node.targets[0].slice
            if isinstance(sl, getattr(ast, "Index", ())): sl = sl.value          # Python 3.8 wraps it
            try: rid = ast.literal_eval(sl)
            except ValueError: continue
            for c in ast.walk(node.value):
                if isinstance(c, ast.Call) and getattr(c.func, "id", None) == "grab" and c.args and isinstance(c.args[0], ast.Constant):
                    st = c.args[0].value
                    line = next((i for i, l in enumerate(RAW) if l.strip().startswith(st)), None)
                    k = containing(line) if line is not None else None
                    if k: used.setdefault(k, set()).add(rid)
    for k, v in specs_heads(side, "west2/specs_mt.json", ent).items(): used.setdefault(k, set()).update(v)
    for e in ent.values(): e["src"] = "%s, line %d (%s)" % (raw_rel, e["line"] + 1, how)
    return ent, used

def load_mi(side):
    G = side.json("east/mi_gr.json")
    if G is None: return None, {}
    ent = {k: dict(head=k, name=k, text="\n\n".join(v)) for k, v in G.items()}
    used = {}
    src = side.text("east/mi_fetch.py")
    if src:
        for node in ast.walk(ast.parse(src)):
            if isinstance(node, ast.Call) and getattr(node.func, "id", None) == "R" and len(node.args) >= 2:
                try: rid, name = ast.literal_eval(node.args[0]), ast.literal_eval(node.args[1])
                except ValueError: continue
                kw = {k.arg: ast.literal_eval(k.value) for k in node.keywords if k.arg in ("gnis", "branch")}
                g = kw.get("gnis") or name
                if g in ent: used.setdefault(g, set()).add(rid + (" (%s)" % kw["branch"] if kw.get("branch") else ""))
    return ent, used

ADAPTERS = [
    ("ut", "Utah DWR, Rules for specific waters", "rockies/regs/ut_entries.json", load_ut),
    ("co", "Colorado CPW, Special Regulations: Fishing Waters", "rockies/regs/co_entries.json", load_co),
    ("ak", "Alaska ADF&G regulation summaries", "rockies/regs/ak_entries.json", load_ak),
    ("mt", "Montana FWP, District Exceptions", "states/regs/mt<year>.raw.txt via west2/gen_mt.py", load_mt),
    ("mi", "Michigan DNR, Gear Restricted Streams", "east/mi_gr.json", load_mi),
]
STREAMY = re.compile(r"\b(creek|river|fork|branch|run|gulch|brook|slough|drainage)\b", re.I)
STILLY = re.compile(r"\b(lake|lakes|reservoir|pond|ponds|pit)\b", re.I)

def compare_entries(rd, first=None):
    bs, ns = Side(os.path.join(rd, "before"), "before"), Side(PIPE, "now")
    out = []
    order = sorted(ADAPTERS, key=lambda x: x[0] != first)
    for key, title, rel, fn in order:
        try:
            eo, uo = fn(bs); en, un = fn(ns)
        except Exception as ex:
            out.append(dict(key=key, title=title, file=rel, error="%s: %s" % (type(ex).__name__, ex))); continue
        if eo is None or en is None:
            out.append(dict(key=key, title=title, file=rel, error="entry file missing on the %s side" % ("before" if eo is None else "current")))
            continue
        res = dict(key=key, title=title, file=rel, n_before=len(eo), n_after=len(en), changed=[], new=[], gone=[])
        def ub(k): return sorted(un.get(k, set()) | uo.get(k, set()))
        for k, e in en.items():
            if k in eo and eo[k]["text"] != e["text"]:
                res["changed"].append(dict(key=k, old=eo[k]["text"], new=e["text"], used=ub(k), src=e.get("src")))
        gone = [k for k in eo if k not in en]; new = [k for k in en if k not in eo]
        for k in new:
            e = en[k]; st = e.get("stream")
            if st is None: st = bool(STREAMY.search(e.get("head", k))) and not STILLY.search(e.get("head", k))
            res["new"].append(dict(key=k, text=e["text"], used=sorted(un.get(k, set())), stream=st, src=e.get("src")))
        for k in gone:
            res["gone"].append(dict(key=k, text=eo[k]["text"], used=sorted(uo.get(k, set()) | un.get(k, set())), src=eo[k].get("src")))
        if gone and new and len(gone) * len(new) <= 40000:          # "possibly renamed": similar key, or near-same text
            nk = {k: re.sub(r"[^a-z0-9]", "", k.lower()) for k in new}
            for g in res["gone"]:
                gk = re.sub(r"[^a-z0-9]", "", g["key"].lower()); best = None
                for n in res["new"]:
                    r1 = difflib.SequenceMatcher(None, gk, nk[n["key"]]).ratio()
                    sm = difflib.SequenceMatcher(None, g["text"][:600], n["text"][:600], autojunk=False)
                    r2 = sm.ratio() if sm.quick_ratio() >= 0.85 else 0
                    sc = max(r1, r2)
                    if (r1 >= 0.8 or r2 >= 0.9) and (best is None or sc > best[0]): best = (sc, n, r1, r2)
                if best:
                    g["renamed"] = "%s (name %.0f%%, text %.0f%%)" % (best[1]["key"], 100 * best[2], 100 * best[3])
                    best[1].setdefault("renamed_from", []).append(g["key"])
        out.append(res)
    return out

def c_counts(C):
    ch = sum(len(c.get("changed", [])) for c in C); nw = sum(len(c.get("new", [])) for c in C)
    gn = sum(len(c.get("gone", [])) for c in C); er = sum(1 for c in C if c.get("error"))
    return ch, nw, gn, er


# ====================================================================================================== rendering
TOK = re.compile(r"\n|[^\S\n]+|\w+|[^\w\s]", re.U)

def opcodes(a, b):
    ta, tb = TOK.findall(a or ""), TOK.findall(b or "")
    return ta, tb, difflib.SequenceMatcher(None, ta, tb, autojunk=False).get_opcodes()

def md_worddiff(a, b, ctx=14):
    """git --word-diff style: [-gone-]{+new+}, long unchanged stretches elided"""
    ta, tb, ops = opcodes(a, b); out = []
    for n, (op, i1, i2, j1, j2) in enumerate(ops):
        if op == "equal":
            seg = ta[i1:i2]
            if len(seg) > 2 * ctx + 6:
                head = "" if n == 0 else "".join(seg[:ctx]); tail = "" if n == len(ops) - 1 else "".join(seg[-ctx:])
                out.append(head + " … " + tail)
            else: out.append("".join(seg))
            continue
        if i2 > i1: out.append("[-" + visible_ws("".join(ta[i1:i2])) + "-]")
        if j2 > j1: out.append("{+" + visible_ws("".join(tb[j1:j2])) + "+}")
    return "".join(out).replace("\n", " ¶ ").strip()

def h(s): return html.escape("" if s is None else str(s), quote=True)

def visible_ws(s):
    """a deletion or insertion that is only whitespace would be invisible: draw it"""
    return s.replace(" ", "\u2423").replace("\n", "\u21b5\n").replace("\t", "\u2192") if s and not s.strip() else s

def html_sides(a, b):
    ta, tb, ops = opcodes(a, b); L, R = [], []
    for op, i1, i2, j1, j2 in ops:
        x, y = h("".join(ta[i1:i2])), h("".join(tb[j1:j2]))
        if op != "equal": x, y = visible_ws(x), visible_ws(y)
        if op == "equal": L.append(x); R.append(y)
        else:
            if x: L.append("<del>" + x + "</del>")
            if y: R.append("<ins>" + y + "</ins>")
    return "".join(L).replace("\n", "<br>"), "".join(R).replace("\n", "<br>")

def md_block(s, n=1200):
    s = (s or "").replace("\n", " ¶ ")
    return s if len(s) <= n else s[:n] + " … (%d more characters)" % (len(s) - n)

def verdict(A, B, C):
    """clean = the stage is byte-identical to the live app, no snapshotted pipeline file changed, and every entry
    index compared equal (an index that couldn't be read is not a clean result)"""
    ac = a_counts(A); ch, nw, gn, er = c_counts(C) if C is not None else (0, 0, 0, 0)
    bc = b_count(B) if B is not None else 0
    return not (ac["files"] or ac["extra"] or bc or ch or nw or gn or er)

def summary_lines(A, B, C, run=None):
    ac = a_counts(A); L = []
    L.append("A. Rivers: regulation text changed %d, added %d, removed %d, other fields changed %d"
             % (ac["river_regs"], ac["river_added"], ac["river_removed"], ac["river_other"]))
    L.append("   Lakes: regulation text changed %d, added %d, removed %d, other fields changed %d"
             % (ac["lake_regs"], ac["lake_added"], ac["lake_removed"], ac["lake_other"]))
    L.append("   Season windows (TIERS): %d changed/added/removed" % ac["tiers"])
    L.append("   Other data: %d constant(s) with changed entries; order/layout-only: %d; text outside constants: %d"
             % (ac["consts"], ac["layout"], ac["resid"]))
    L.append("   Files differing under js/ and data/hazards/: %d%s" % (ac["files"], (", plus %d unexpected item(s) in the stage" % ac["extra"]) if ac["extra"] else ""))
    if B is not None:
        L.append("B. Pipeline files changed by the run: %d changed, %d added, %d removed, %d big json changed "
                 "(re-fetchable caches/PDFs touched: %d)" % (len(B["changed"]), len(B["added"]), len(B["removed"]), len(B["big"]),
                  sum(len(v) for v in B["stat"].values())))
    if C is not None:
        parts = []
        for c in C:
            if c.get("error"): parts.append("%s: ERROR" % c["key"])
            else: parts.append("%s %d changed/%d new/%d gone" % (c["key"], len(c["changed"]), len(c["new"]), len(c["gone"])))
        L.append("C. Booklet entries: " + "; ".join(parts))
        L.append("   No entry index yet (section A only): " + ", ".join(NO_INDEX))
    if A["warnings"]: L.append("Warnings: %d (see report)" % len(A["warnings"]))
    return L

# ---------------------------------------------------------------------------------------------------- markdown
def render_md(meta, A, B, C):
    o = []; w = o.append
    w("# Regulation change report: %s" % meta["title"]); w("")
    for k, v in meta["rows"]: w("- **%s:** %s" % (k, v))
    w(""); w("**Verdict: %s**" % ("NO CHANGES: the stage is byte-identical to the live app, and nothing else changed" if meta["clean"] else "CHANGES (details below)")); w("")
    w("```"); o.extend(summary_lines(A, B, C)); w("```"); w("")
    if A["warnings"]:
        w("## Warnings"); [w("- " + x) for x in A["warnings"]]; w("")
    w("## A. What the app would show (live app vs stage)"); w("")
    w("Word-level diffs are on the text with HTML tags stripped: `[-removed-]{+added+}`, ¶ = line break, … = unchanged text left out. "
      "**markup only** = the tag-stripped text is identical."); w("")
    for kind, title in (("rivers", "Rivers"), ("lakes", "Lakes")):
        R = A[kind]
        w("### A%s. %s: regulation text changed (%d)" % ("1" if kind == "rivers" else "2", title, len(R["regs"]))); w("")
        for r in R["regs"]:
            w("#### `%s` %s%s" % (r["id"], r["name"], (" (%s)" % r["region"]) if r["region"] else ""))
            for f in r["fields"]:
                if f["old"] is None: w("- **%s** added: %s" % (f["field"], md_block(strip_tags(f["new"])))); continue
                if f["new"] is None: w("- **%s** removed (was: %s)" % (f["field"], md_block(strip_tags(f["old"])))); continue
                if f["markup_only"]: w("- **%s**: markup only. Source: %s" % (f["field"], md_worddiff(f["old"], f["new"])))
                else: w("- **%s**: %s" % (f["field"], md_worddiff(strip_tags(f["old"]), strip_tags(f["new"]))))
            w("")
        def where(r): return ", ".join(x for x in (r["state"], r["region"]) if x)
        w("%s added (%d)%s" % (title, len(R["added"]), ":" if R["added"] else ".")); w("")
        for r in R["added"]:
            w("- `%s` %s (%s)" % (r["id"], r["name"], where(r)))
            for x, v in r["regs"].items():
                if x in ("parkRegs", "troutRegs", "regs"): w("  - %s: %s" % (x, md_block(strip_tags(v), 400)))
        if R["added"]: w("")
        w("%s removed (%d)%s" % (title, len(R["removed"]), ":" if R["removed"] else ".")); w("")
        for r in R["removed"]: w("- `%s` %s (%s)" % (r["id"], r["name"], where(r)))
        if R["removed"]: w("")
        w("%s with other fields changed (%d)%s" % (title, len(R["other"]), ":" if R["other"] else ".")); w("")
        for r in R["other"]: w("- `%s` %s: %s" % (r["id"], r["name"], ", ".join(r["fields"])))
        w("")
    T = A["tiers"]
    w("### A3. Season windows and classes (TIERS in tiers.js): %d changed, %d added, %d removed" % (len(T["changed"]), len(T["added"]), len(T["removed"]))); w("")
    for t in T["changed"]: w("- `%s`: `%s` -> `%s`" % (t["key"], t["old"], t["new"]))
    for t in T["added"]: w("- `%s` added: `%s`" % (t["key"], t["new"]))
    for t in T["removed"]: w("- `%s` removed (was `%s`)" % (t["key"], t["old"]))
    w("")
    w("### A4. Other data that changed (%d)" % len(A["consts"])); w("")
    for c in A["consts"]:
        if c.get("note"): w("- %s %s: %s" % (c["file"], c["const"], c["note"])); continue
        w("- **%s %s**: %d added, %d removed, %d changed" % (c["file"], c["const"], len(c["added"]), len(c["removed"]), len(c["changed"])))
        if c["added"]: w("  - added: %s" % ", ".join("`%s`" % k for k in c["added"][:60]) + (" …" if len(c["added"]) > 60 else ""))
        if c["removed"]: w("  - removed: %s" % ", ".join("`%s`" % k for k in c["removed"][:60]) + (" …" if len(c["removed"]) > 60 else ""))
        for x in c["changed"][:80]:
            w("  - `%s`: %s" % (x["key"], "; ".join(x["fields"]) if x["fields"] else "`%s` -> `%s`" % (x["old"], x["new"])))
        if len(c["changed"]) > 80: w("  - … %d more" % (len(c["changed"]) - 80))
    w("")
    w("### A5. Order and layout only (%d)" % len(A["layout"])); w("")
    w("Entries that moved, or whose comments/whitespace changed, with no change in value. Harmless to the app (except "
      "where an object holds a key twice), but it means a script rewrote a block it should have left in place."); w("")
    for x in A["layout"]:
        for f, a1, b1, nb, ne in x.get("blocks", []):
            w("- **%s %s**: generated block '%s' (%d entries) moved from block %d to block %d of %d" % (x["file"], x["const"], f, ne, a1, b1, nb))
        w("- **%s %s**: %d moved%s; %d with comment/whitespace changes%s" % (x["file"], x["const"], len(x["moved"]),
          (" (" + ", ".join(x["moved"][:12]) + (" …" if len(x["moved"]) > 12 else "") + ")") if x["moved"] else "",
          len(x["layout"]), (" (" + ", ".join(x["layout"][:8]) + (" …" if len(x["layout"]) > 8 else "") + ")") if x["layout"] else ""))
    for r in A["resid"]:
        w(""); w("Text outside the data constants changed in %s:" % r["file"]); w(""); w("```diff"); o.extend(r["diff"])
        if r["more"]: w("… %d more lines" % r["more"])
        w("```")
    w("")
    w("### A6. Files that differ (%d)" % len(A["files"])); w("")
    if A["files"]:
        w("| file | status | live | stage |"); w("|---|---|---|---|")
        for f in A["files"]: w("| %s | %s%s | %s | %s |" % (f["path"], f["status"], " (detailed above)" if f.get("detail") else "", fmt_size(f["old"]), fmt_size(f["new"])))
    if A["extra"]: w(""); w("Not promotable (outside js/ and data/hazards/ in the stage): " + ", ".join(A["extra"]))
    w("")
    if B is not None:
        w("## B. Pipeline files the run changed (before/ snapshot vs now)"); w("")
        w("A file rewritten with identical bytes doesn't appear. `abort` restores everything in this table except big json."); w("")
        rows = [("changed", x["path"], x.get("old"), x.get("new")) for x in B["changed"]] + \
               [("added", x["path"], None, x.get("new")) for x in B["added"]] + \
               [("removed", x["path"], x.get("old"), None) for x in B["removed"]] + \
               [("%s (big json, not snapshotted)" % x["status"], x["path"], x.get("old"), x.get("new")) for x in B["big"]]
        if rows:
            w("| status | file | before | after |"); w("|---|---|---|---|")
            for st, p, a1, b1 in rows: w("| %s | %s | %s | %s |" % (st, p, fmt_size(a1), fmt_size(b1)))
        else: w("None.")
        sc = B["stat"]
        if any(sc.values()):
            w(""); w("Re-fetchable caches and PDFs touched (not snapshotted, not restored by abort): %d changed, %d added, %d removed"
                     % (len(sc["changed"]), len(sc["added"]), len(sc["removed"])))
            for k in ("added", "changed", "removed"):
                for p in sc[k][:40]: w("- %s: %s" % (k, p))
        w("")
    if C is not None:
        w("## C. Booklet entries (before vs after, by entry)"); w("")
        w("No entry index yet for %s: those sources get section A only." % ", ".join(NO_INDEX)); w("")
        for c in C:
            w("### %s: %s" % (c["key"], c["title"]))
            if c.get("error"): w(""); w("Not compared: %s (%s)" % (c["error"], c["file"])); w(""); continue
            w(""); w("%s: %d entries before, %d after; %d changed, %d new, %d gone." % (c["file"], c["n_before"], c["n_after"], len(c["changed"]), len(c["new"]), len(c["gone"]))); w("")
            for e in c["changed"]:
                w("- **%s** (used by: %s): %s" % (e["key"], ", ".join(e["used"]) or "no mapped water", md_worddiff(e["old"], e["new"])))
            for e in c["new"]:
                w("- NEW **%s**%s (used by: %s)%s: %s" % (e["key"], " (candidate new stream)" if e["stream"] and not e["used"] else "",
                  ", ".join(e["used"]) or "nothing yet", ("; possibly renamed from " + ", ".join(e["renamed_from"])) if e.get("renamed_from") else "",
                  md_block(e["text"], 300)))
            for e in c["gone"]:
                w("- GONE **%s** (used by: %s)%s: %s" % (e["key"], ", ".join(e["used"]) or "no mapped water",
                  ("; possibly renamed to " + e["renamed"]) if e.get("renamed") else "", md_block(e["text"], 300)))
            w("")
    return "\n".join(o) + "\n"

# ---------------------------------------------------------------------------------------------------- html
CSS = """
:root{--bg:#fbfcfc;--fg:#1c2428;--mut:#5d6a71;--line:#d6dde1;--card:#fff;--ins:#d4f2da;--insf:#0d5a20;--del:#f9dada;--delf:#8b1d1d;--chip:#e9eff2;--warn:#fff3cd;--accent:#1f6f8b}
@media (prefers-color-scheme:dark){:root{--bg:#121719;--fg:#e2e8eb;--mut:#97a5ac;--line:#2b3438;--card:#192023;--ins:#173b22;--insf:#9fe2b0;--del:#4b1e1e;--delf:#f3b4b4;--chip:#232c30;--warn:#3a3214;--accent:#6fb7d0}}
*{box-sizing:border-box}body{background:var(--bg);color:var(--fg);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;margin:0 auto;max-width:1280px;padding:16px}
h1{font-size:22px;margin:4px 0 8px}h2{font-size:18px;margin:28px 0 8px;border-bottom:1px solid var(--line);padding-bottom:4px}h3{font-size:16px;margin:20px 0 6px}
a{color:var(--accent)}code{font:13px ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--chip);padding:0 4px;border-radius:4px}
.meta{color:var(--mut);font-size:13px}.meta b{color:var(--fg)}
.verdict{display:inline-block;font-weight:600;padding:6px 12px;border-radius:6px;margin:8px 0;background:var(--chip)}
.verdict.ok{background:var(--ins);color:var(--insf)}.verdict.bad{background:var(--warn)}
table{border-collapse:collapse;width:100%;margin:8px 0;background:var(--card)}th,td{border:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}
th{background:var(--chip);font-weight:600}td.n{text-align:right;font-variant-numeric:tabular-nums}
details{border:1px solid var(--line);border-radius:6px;margin:6px 0;background:var(--card)}summary{cursor:pointer;padding:6px 10px}
details>div{padding:4px 10px 10px}.side{width:100%;table-layout:fixed}.side td{width:50%;font-size:14px;overflow-wrap:anywhere}
ins{background:var(--ins);color:var(--insf);text-decoration:none}del{background:var(--del);color:var(--delf)}
.chip{display:inline-block;font-size:12px;padding:0 6px;border-radius:9px;background:var(--chip);margin-left:6px;color:var(--mut)}
.chip.m{background:var(--warn);color:var(--fg)}.mut{color:var(--mut)}pre{overflow-x:auto;background:var(--card);border:1px solid var(--line);padding:8px;font-size:12px}
.tools button{font:inherit;font-size:13px;margin-right:6px;padding:2px 10px;border:1px solid var(--line);border-radius:5px;background:var(--card);color:var(--fg);cursor:pointer}
@media (max-width:700px){.side td{display:block;width:100%}}
"""

def render_html(meta, A, B, C):
    o = []; w = o.append
    w("<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>")
    w("<title>Regulation changes: %s</title><style>%s</style></head><body>" % (h(meta["short"]), CSS))
    w("<h1>Regulation change report: %s</h1><div class='meta'>%s</div>" % (h(meta["title"]),
      "<br>".join("<b>%s:</b> %s" % (h(k), h(v)) for k, v in meta["rows"])))
    w("<div class='verdict %s'>%s</div>" % ("ok" if meta["clean"] else "bad",
      "No changes: the stage is byte-identical to the live app, and nothing else changed" if meta["clean"] else "Changes: read every section below before promoting"))
    w("<div class='tools'><button onclick=\"document.querySelectorAll('details').forEach(d=>d.open=true)\">Open all</button>"
      "<button onclick=\"document.querySelectorAll('details').forEach(d=>d.open=false)\">Close all</button></div>")
    ac = a_counts(A)
    rows = [("A1", "Rivers: regulation text changed", ac["river_regs"]), ("A1", "Rivers added / removed", "%d / %d" % (ac["river_added"], ac["river_removed"])),
            ("A1", "Rivers: other fields changed", ac["river_other"]), ("A2", "Lakes: regulation text changed", ac["lake_regs"]),
            ("A2", "Lakes added / removed / other fields", "%d / %d / %d" % (ac["lake_added"], ac["lake_removed"], ac["lake_other"])),
            ("A3", "Season windows (TIERS) changed / added / removed", "%d / %d / %d" % (len(A["tiers"]["changed"]), len(A["tiers"]["added"]), len(A["tiers"]["removed"]))),
            ("A4", "Other data constants with changes", ac["consts"]), ("A5", "Order / layout only", ac["layout"] + ac["resid"]),
            ("A6", "Files differing (js/, data/hazards/)", ac["files"])]
    if B is not None:
        rows.append(("B", "Pipeline files changed / added / removed / big json", "%d / %d / %d / %d" % (len(B["changed"]), len(B["added"]), len(B["removed"]), len(B["big"]))))
    if C is not None:
        for c in C:
            rows.append(("C", "%s (%s)" % (c["title"], c["key"]), "error" if c.get("error") else "%d changed / %d new / %d gone" % (len(c["changed"]), len(c["new"]), len(c["gone"]))))
    w("<h2>Summary</h2><table><tr><th>Section</th><th>What</th><th>Count</th></tr>")
    for s, t, n in rows: w("<tr><td><a href='#%s'>%s</a></td><td>%s</td><td class='n'>%s</td></tr>" % (s[:2].lower(), s, h(t), h(n)))
    w("</table>")
    if A["warnings"]: w("<h3>Warnings</h3><ul>%s</ul>" % "".join("<li>%s</li>" % h(x) for x in A["warnings"]))
    w("<h2 id='a'>A. What the app would show <span class='mut'>(live app, left, vs stage, right)</span></h2>")
    w("<p class='mut'>Word-level diff on the text with HTML tags stripped. <span class='chip m'>markup only</span> means the "
      "tag-stripped text is identical; the raw source diff is inside.</p>")
    for kind, sid, title in (("rivers", "a1", "Rivers"), ("lakes", "a2", "Lakes")):
        R = A[kind]
        w("<h3 id='%s'>%s. %s: regulation text changed (%d)</h3>" % (sid, sid.upper(), title, len(R["regs"])))
        for r in R["regs"]:
            tags = "".join("<span class='chip%s'>%s%s</span>" % (" m" if f["markup_only"] else "", h(f["field"]), " · markup only" if f["markup_only"] else "") for f in r["fields"])
            w("<details><summary><code>%s</code> %s <span class='mut'>%s</span>%s</summary><div>" % (h(r["id"]), h(r["name"]), h(r["region"]), tags))
            for f in r["fields"]:
                if f["old"] is None:            # the field is new on this river
                    a1, b1 = "", "<ins>%s</ins>" % h(strip_tags(f["new"])).replace("\n", "<br>")
                elif f["new"] is None:          # the field is gone from it
                    a1, b1 = "<del>%s</del>" % h(strip_tags(f["old"])).replace("\n", "<br>"), ""
                else:
                    a1, b1 = html_sides(strip_tags(f["old"]), strip_tags(f["new"]))
                w("<p><b>%s</b>%s</p><table class='side'><tr><th>Live</th><th>Stage</th></tr><tr><td>%s</td><td>%s</td></tr></table>"
                  % (h(f["field"]), " <span class='chip m'>markup only</span>" if f["markup_only"] else "", a1, b1))
                if f["markup_only"] or (f["old"] and f["new"] and f["old"] != f["new"] and len(f["old"]) < 20000):
                    a2, b2 = html_sides(f["old"], f["new"])
                    w("<details><summary class='mut'>raw source (with tags)</summary><div><table class='side'><tr><td><code>%s</code></td><td><code>%s</code></td></tr></table></div></details>" % (a2, b2))
            w("</div></details>")
        for lst, word in (("added", "added"), ("removed", "removed")):
            w("<p><b>%s %s (%d)</b></p>" % (title, word, len(R[lst])))
            for r in R[lst]:
                w("<details><summary><code>%s</code> %s <span class='mut'>%s</span></summary><div>" % (h(r["id"]), h(r["name"]),
                  h(" · ".join(x for x in (r["state"], r["region"]) if x))))
                for x, v in r["regs"].items(): w("<p><b>%s</b>: %s</p>" % (h(x), h(strip_tags(v)).replace("\n", "<br>")))
                w("</div></details>")
        w("<p><b>%s with other fields changed (%d)</b></p>" % (title, len(R["other"])))
        if R["other"]:
            w("<table><tr><th>id</th><th>name</th><th>fields</th></tr>%s</table>" % "".join(
                "<tr><td><code>%s</code></td><td>%s</td><td>%s</td></tr>" % (h(r["id"]), h(r["name"]), h(", ".join(r["fields"]))) for r in R["other"]))
    T = A["tiers"]
    w("<h3 id='a3'>A3. Season windows and classes (TIERS) (%d)</h3>" % (len(T["changed"]) + len(T["added"]) + len(T["removed"])))
    if T["changed"] or T["added"] or T["removed"]:
        w("<table class='side'><tr><th>Live</th><th>Stage</th></tr>")
        for t in T["changed"]:
            a1, b1 = html_sides(t["old"], t["new"]); w("<tr><td><code>%s</code>: %s</td><td>%s</td></tr>" % (h(t["key"]), a1, b1))
        for t in T["added"]: w("<tr><td><code>%s</code> (not there)</td><td><ins>%s</ins></td></tr>" % (h(t["key"]), h(t["new"])))
        for t in T["removed"]: w("<tr><td><code>%s</code>: <del>%s</del></td><td>(removed)</td></tr>" % (h(t["key"]), h(t["old"])))
        w("</table>")
    w("<h3 id='a4'>A4. Other data that changed (%d)</h3>" % len(A["consts"]))
    for c in A["consts"]:
        if c.get("note"): w("<p>%s %s: %s</p>" % (h(c["file"]), h(c["const"]), h(c["note"]))); continue
        w("<details><summary><b>%s %s</b>: %d added, %d removed, %d changed</summary><div>" % (h(c["file"]), h(c["const"]), len(c["added"]), len(c["removed"]), len(c["changed"])))
        if c["added"]: w("<p>Added: %s</p>" % ", ".join("<code>%s</code>" % h(k) for k in c["added"]))
        if c["removed"]: w("<p>Removed: %s</p>" % ", ".join("<code>%s</code>" % h(k) for k in c["removed"]))
        if c["changed"]:
            w("<table><tr><th>entry</th><th>change</th></tr>%s</table>" % "".join(
                "<tr><td><code>%s</code></td><td>%s</td></tr>" % (h(x["key"]), h("; ".join(x["fields"])) if x["fields"] else "%s<br>%s" % html_sides(x["old"], x["new"]))
                for x in c["changed"]))
        w("</div></details>")
    w("<h3 id='a5'>A5. Order and layout only (%d)</h3>" % (len(A["layout"]) + len(A["resid"])))
    w("<p class='mut'>Entries that moved, or whose comments or whitespace changed, with no change in value. Harmless to the app, but it means a script rewrote a block it should have left in place.</p>")
    for x in A["layout"]:
        bl = "; ".join("block '%s' (%d entries) moved from block %d to %d of %d" % (f, ne, a1, b1, nb) for f, a1, b1, nb, ne in x.get("blocks", []))
        w("<details><summary><b>%s %s</b>: %s%s%d comment/whitespace</summary><div><p>Moved: %s</p><p>Comments/whitespace: %s</p></div></details>"
          % (h(x["file"]), h(x["const"]), h(bl), "; " if bl else "%d moved, " % len(x["moved"]), len(x["layout"]),
             h(", ".join(x["moved"]) or "none"), h(", ".join(x["layout"]) or "none")))
    for r in A["resid"]:
        w("<details><summary>Text outside the data constants changed in <b>%s</b></summary><div><pre>%s%s</pre></div></details>"
          % (h(r["file"]), h("\n".join(r["diff"])), h("\n… %d more lines" % r["more"]) if r["more"] else ""))
    w("<h3 id='a6'>A6. Files that differ (%d)</h3>" % len(A["files"]))
    if A["files"]:
        w("<table><tr><th>file</th><th>status</th><th>live</th><th>stage</th></tr>%s</table>" % "".join(
            "<tr><td>%s</td><td>%s%s</td><td class='n'>%s</td><td class='n'>%s</td></tr>" % (h(f["path"]), h(f["status"]), " (detailed above)" if f.get("detail") else "", fmt_size(f["old"]), fmt_size(f["new"])) for f in A["files"]))
    if A["extra"]: w("<p><b>Not promotable</b> (written into the stage outside js/ and data/hazards/): %s</p>" % h(", ".join(A["extra"])))
    if B is not None:
        w("<h2 id='b'>B. Pipeline files the run changed</h2><p class='mut'>before/ snapshot against the pipeline now. A file rewritten with identical bytes doesn't appear. <code>abort</code> restores all of these except big json.</p>")
        rows = [("changed", x["path"], x.get("old"), x.get("new")) for x in B["changed"]] + [("added", x["path"], None, x.get("new")) for x in B["added"]] + \
               [("removed", x["path"], x.get("old"), None) for x in B["removed"]] + [("%s (big json, not snapshotted)" % x["status"], x["path"], x.get("old"), x.get("new")) for x in B["big"]]
        if rows:
            w("<table><tr><th>status</th><th>file</th><th>before</th><th>after</th></tr>%s</table>" % "".join(
                "<tr><td>%s</td><td>%s</td><td class='n'>%s</td><td class='n'>%s</td></tr>" % (h(s), h(p), fmt_size(a1), fmt_size(b1)) for s, p, a1, b1 in rows))
        else: w("<p>None.</p>")
        sc = B["stat"]
        if any(sc.values()):
            w("<details><summary>Re-fetchable caches and PDFs touched: %d changed, %d added, %d removed</summary><div><p>%s</p></div></details>"
              % (len(sc["changed"]), len(sc["added"]), len(sc["removed"]), "<br>".join(h(k + ": " + p) for k in ("added", "changed", "removed") for p in sc[k])))
    if C is not None:
        w("<h2 id='c'>C. Booklet entries (before vs after)</h2><p class='mut'>No entry index yet for %s: section A only.</p>" % h(", ".join(NO_INDEX)))
        for c in C:
            w("<h3>%s <span class='mut'>(%s)</span></h3>" % (h(c["title"]), h(c["key"])))
            if c.get("error"): w("<p>Not compared: %s <span class='mut'>%s</span></p>" % (h(c["error"]), h(c["file"]))); continue
            w("<p class='mut'>%s: %d entries before, %d after.</p>" % (h(c["file"]), c["n_before"], c["n_after"]))
            for e in c["changed"]:
                a1, b1 = html_sides(e["old"], e["new"])
                w("<details><summary><b>%s</b> <span class='chip'>text changed</span> <span class='mut'>used by %s</span></summary><div><table class='side'><tr><th>Before</th><th>After</th></tr><tr><td>%s</td><td>%s</td></tr></table></div></details>"
                  % (h(e["key"]), h(", ".join(e["used"]) or "no mapped water"), a1, b1))
            for e in c["new"]:
                w("<details><summary><b>%s</b> <span class='chip m'>new%s</span> <span class='mut'>used by %s%s</span></summary><div>%s</div></details>"
                  % (h(e["key"]), " · candidate new stream" if e["stream"] and not e["used"] else "", h(", ".join(e["used"]) or "nothing yet"),
                     h("; possibly renamed from " + ", ".join(e["renamed_from"])) if e.get("renamed_from") else "", h(e["text"]).replace("\n", "<br>")))
            for e in c["gone"]:
                w("<details><summary><b>%s</b> <span class='chip m'>gone</span> <span class='mut'>used by %s%s</span></summary><div>%s</div></details>"
                  % (h(e["key"]), h(", ".join(e["used"]) or "no mapped water"), h("; possibly renamed to " + e["renamed"]) if e.get("renamed") else "",
                     h(e["text"]).replace("\n", "<br>")))
            if not (c["changed"] or c["new"] or c["gone"]): w("<p>No changes.</p>")
    w("<p class='mut'>Written by tools/regs/regreport.py at %s.</p></body></html>" % h(now_iso()))
    return "\n".join(o)


# ====================================================================================================== report / diff
def cmd_report(a, ctx):
    rd, run = ctx.open_run()
    t0 = time.time()
    A = compare_app(ctx.app, run["stage"]); B = compare_pipe(rd)
    C = compare_entries(rd, first=SOURCES[run["source"]].get("adapter"))
    live_now = staged_hashes(ctx.app)
    live_ok = live_now == run["live"]
    clean = verdict(A, B, C)
    meta = dict(title="%s (%s)" % (run["source"], SOURCES[run["source"]]["title"]), short=run["id"], clean=clean, rows=[
        ("Run", "%s, begun %s" % (run["id"], run["created"])), ("Report written", now_iso()),
        ("Live app", "%s (%s)" % (ctx.app, "unchanged since begin" if live_ok else "CHANGED since begin: promote will refuse")),
        ("Stage", run["stage"]),
        ("Steps run", ", ".join("%s %s%s" % (n, s["script"], "" if s["rc"] == 0 else " (exit %d)" % s["rc"])
                                for n, s in sorted(run["steps"].items(), key=lambda x: int(x[0]))) or "none")])
    with open(os.path.join(rd, "report.md"), "w", encoding="utf-8") as f: f.write(render_md(meta, A, B, C))
    with open(os.path.join(rd, "report.html"), "w", encoding="utf-8") as f: f.write(render_html(meta, A, B, C))
    wjson(os.path.join(rd, "report.json"), dict(written=now_iso(), clean=clean, stage=staged_hashes(run["stage"]),
                                                live_unchanged=live_ok, counts=a_counts(A), b=b_count(B), c=c_counts(C)))
    print("Regulation change report: %s" % run["id"])
    for l in summary_lines(A, B, C): print(l)
    if not live_ok: print("WARNING: the live app changed since begin; promote will refuse")
    print("Verdict: %s" % ("NO CHANGES" if clean else "CHANGES"))
    print("report: %s\n        %s  (%.1f s)" % (os.path.join(rd, "report.md"), os.path.join(rd, "report.html"), time.time() - t0))
    return 0 if clean else 1

def js_dir(p):
    p = os.path.abspath(p)
    if not os.path.exists(os.path.join(p, "rivers-data.js")) and os.path.exists(os.path.join(p, "js", "rivers-data.js")): p = os.path.join(p, "js")
    if not os.path.isdir(p): die("not a folder: %s" % p)
    return p

def cmd_diff(a, ctx):
    pa, pb = js_dir(a.a), js_dir(a.b)
    A = compare_dirs(pa, pb)
    out = os.path.abspath(a.out or os.path.join(ctx.kit, "diffs", datetime.datetime.now().strftime("%Y%m%d-%H%M%S")))
    os.makedirs(out, exist_ok=True)
    clean = verdict(A, None, None)
    meta = dict(title="diff", short="diff", clean=clean, rows=[("Old (left)", pa), ("New (right)", pb), ("Written", now_iso())])
    with open(os.path.join(out, "diff-report.md"), "w", encoding="utf-8") as f: f.write(render_md(meta, A, None, None))
    with open(os.path.join(out, "diff-report.html"), "w", encoding="utf-8") as f: f.write(render_html(meta, A, None, None))
    print("Section A, %s -> %s" % (pa, pb))
    for l in summary_lines(A, None, None): print(l)
    print("Verdict: %s" % ("NO CHANGES" if clean else "CHANGES"))
    print("report: %s\n        %s" % (os.path.join(out, "diff-report.md"), os.path.join(out, "diff-report.html")))
    return 0 if clean else 1

def compare_dirs(pa, pb):
    """section A between two js/ folders: lay them out as <root>/js through a temporary view so compare_app's
    paths read the same as in a run"""
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        for side, p in (("a", pa), ("b", pb)):
            os.makedirs(os.path.join(tmp, side)); os.symlink(p, os.path.join(tmp, side, "js"))
        return compare_app(os.path.join(tmp, "a"), os.path.join(tmp, "b"), subs=("js",))


# ====================================================================================================== promote / abort
def cmd_promote(a, ctx):
    rd, run = ctx.open_run()
    live = staged_hashes(ctx.app)
    moved = sorted(r for r in set(live) | set(run["live"]) if live.get(r) != run["live"].get(r))
    if moved:
        die("REFUSED: the live app changed since begin (another session?): %s\n  Nothing was copied. Abort this run and "
            "begin again from the current files." % ", ".join(moved[:20]))
    rp = os.path.join(rd, "report.json")
    if not os.path.exists(rp): die("REFUSED: no report for this run yet. Run `report` and read it first.")
    stage = staged_hashes(run["stage"])
    if rjson(rp)["stage"] != stage: die("REFUSED: the stage changed after the last report. Run `report` again and read it.")
    gone = sorted(r for r in live if r not in stage)
    if gone: die("REFUSED: the stage is missing live files (%s); promote never deletes live files." % ", ".join(gone[:20]))
    todo = sorted(r for r in stage if live.get(r) != stage[r])
    for r in todo:
        src, dst = os.path.join(run["stage"], r), os.path.join(ctx.app, r)
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        if os.path.exists(dst): shutil.copyfile(src, dst)          # content only: the live file keeps its mode
        else: shutil.copy2(src, dst)
        if sha1_file(dst) != stage[r]: die("copy check failed for %s" % r)
        print("copied %s" % r)
    run["promoted"] = todo
    shutil.rmtree(run["stage"], ignore_errors=True)            # a stale FLYFISH_APP must not write a closed run's stage
    ctx.close(rd, run, "promoted")
    print("Promoted %d file(s)%s. Run %s closed; the stage is deleted (unset FLYFISH_APP in your shell)."
          % (len(todo), "" if todo else " (the stage was identical to the live app)", run["id"]))
    return 0

def cmd_abort(a, ctx):
    rd, run = ctx.open_run()
    before = rjson(os.path.join(rd, "before.json")); now = scan_pipe()
    restored, recreated, problems = [], [], []
    for rel, (h1, sz) in before["snap"].items():
        p = os.path.join(PIPE, rel); src = os.path.join(rd, "before", rel)
        cur = now["snap"].get(rel) or now["big"].get(rel)
        if cur and cur[0] == h1: continue
        os.makedirs(os.path.dirname(p), exist_ok=True)
        shutil.copy2(src, p)
        (restored if cur else recreated).append(rel)
    new = sorted(r for r in now["snap"] if r not in before["snap"] and r not in before["big"])
    deleted = []
    if a.delete_new:
        for r in new: os.remove(os.path.join(PIPE, r)); deleted.append(r)
    big = [r for r in set(before["big"]) | set(now["big"]) if before["big"].get(r, [None])[0] != now["big"].get(r, [None])[0] and r not in before["snap"]]
    check = scan_pipe()
    bad = [r for r, (h1, _) in before["snap"].items() if check["snap"].get(r, [None])[0] != h1]
    for r in restored: print("restored %s" % r)
    for r in recreated: print("re-created %s" % r)
    for r in deleted: print("deleted (new since begin) %s" % r)
    if new and not a.delete_new:
        print("left in place (new since begin; abort --delete-new removes them): %s" % ", ".join(new))
    if big: print("WARNING: big json not snapshotted changed and could not be restored: %s" % ", ".join(sorted(big)))
    if bad: die("abort could not restore: %s (the run stays open)" % ", ".join(bad))
    shutil.rmtree(run["stage"], ignore_errors=True)
    run["aborted"] = dict(restored=restored, recreated=recreated, deleted=deleted, left=new if not a.delete_new else [], big=big)
    ctx.close(rd, run, "aborted")
    print("Aborted %s: %d pipeline file(s) restored, all %d snapshotted files match before/; stage deleted; run closed."
          % (run["id"], len(restored) + len(recreated), len(before["snap"])))
    return 0


# ====================================================================================================== status / sources
def cmd_status(a, ctx):
    rd, run = ctx.open_run(required=False)
    if not run: print("No run open. Runs: %s" % ctx.runs); return 0
    print("Open run %s (%s), begun %s\n  dir   %s\n  stage %s" % (run["id"], run["source"], run["created"], rd, run["stage"]))
    env = os.environ.get("FLYFISH_APP")
    print("  FLYFISH_APP in this shell: %s" % ("matches the stage" if env and os.path.abspath(env) == run["stage"] else (env or "not set")))
    for n, s in sorted(run["steps"].items(), key=lambda x: int(x[0])):
        print("  step %s %s %s (%.0f s, %s)" % (n, s["script"], "ok" if s["rc"] == 0 else "FAILED %d" % s["rc"], s["seconds"], s["at"]))
    live_ok = staged_hashes(ctx.app) == run["live"]
    print("  live app %s since begin" % ("unchanged" if live_ok else "CHANGED"))
    print("  report: %s" % ("written" if os.path.exists(os.path.join(rd, "report.json")) else "not yet"))
    return 0

def cmd_sources(a, ctx):
    stage = "<stage>"
    for k in SOURCES:
        print("=" * 100); print_chain(k, stage)
    print("=" * 100); print("Aliases: %s" % ", ".join("%s -> %s" % x for x in ALIASES.items()))
    return 0


# ====================================================================================================== main
def main(argv=None):
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--app", default=argparse.SUPPRESS, help="live app root (default: the repo holding this tool)")
    common.add_argument("--kit", default=argparse.SUPPRESS, help="where runs live (default ~/.cache/flyfish-osm/kit)")
    ap = argparse.ArgumentParser(prog="regreport.py", parents=[common], description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd", required=True)
    p = sp.add_parser("begin", parents=[common], help="open a run for a source"); p.add_argument("source"); p.add_argument("--note")
    p = sp.add_parser("run", parents=[common], help="run the registered chain into the stage")
    p.add_argument("--from", dest="from_", type=int); p.add_argument("--to", type=int); p.add_argument("--only")
    p.add_argument("--print", action="store_true", help="print the commands instead of running them")
    sp.add_parser("report", parents=[common], help="write report.md/report.html; exit 0 when nothing changed")
    sp.add_parser("promote", parents=[common], help="copy the differing staged files over the live app; close the run")
    p = sp.add_parser("abort", parents=[common], help="restore the pipeline files, delete the stage, close the run")
    p.add_argument("--delete-new", action="store_true", help="also delete pipeline files created since begin")
    p = sp.add_parser("diff", parents=[common], help="section A only, between two js/ folders")
    p.add_argument("a"); p.add_argument("b"); p.add_argument("--out")
    sp.add_parser("status", parents=[common], help="show the open run")
    sp.add_parser("sources", parents=[common], help="print every registered chain")
    a = ap.parse_args(argv)
    for k in ("app", "kit"):
        if not hasattr(a, k): setattr(a, k, None)
    ctx = Ctx(a)
    return {"begin": cmd_begin, "run": cmd_run, "report": cmd_report, "promote": cmd_promote, "abort": cmd_abort,
            "diff": cmd_diff, "status": cmd_status, "sources": cmd_sources}[a.cmd](a, ctx)

if __name__ == "__main__":
    sys.exit(main())
