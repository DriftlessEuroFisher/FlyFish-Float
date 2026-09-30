/* ============================================================
   RIVER TIERS — the file to edit when you disagree with a ranking.

   Every river gets a quality class:

     gold  the destination water — recognised blue-ribbon fisheries
     "1"   very good, worth a drive
     "2"   good, worth it if you're already nearby
     "3"   the rest. Hidden by default; the "All rivers" chip shows them.

   A river that is not listed here is Class 3. That is the safe default:
   a new river never clutters the map until someone decides it deserves to.

   The scale is RELATIVE TO ITS REGION, on purpose. The West has far more
   blue-ribbon water than the Midwest, so it has more Gold; a Driftless
   creek that is Class 1 is a great stream *for the Driftless*, not a claim
   that it matches the Madison. These are researched starting points, not
   official ratings — overrule them from experience. The Driftless list in
   particular is a draft.

   `season` (all optional) shifts the class by the calendar month:
     best:[[a,b],...]   in-window → one class better (Class 3 → 2, 2 → 1, 1 → Gold)
     poor:[[a,b],...]   in-window → one class worse (Gold → 1 … 2 → 3)
     closed:[[a,b],...] in-window → the water is shut; treated as Class 3
   Months are 1–12 and a window may wrap the new year ([11,4] = Nov–Apr).
   `why` is the one line the sheet shows. It states the reason, never a
   made-up number — this is a window table, not a forecast. A river with
   live flow data still shows its real CFS status beside the tier.
   ============================================================ */
const TIER_ORDER = ["3","2","1","gold"];          // worst → best
const TIERS = {
  /* ---- Jackson Hole / Snake ---- */
  snake:        {t:"gold", season:{best:[[8,10]], poor:[[4,6]],
                  why:"Runoff keeps the Snake high and off-colour through June; it clears and fishes best Aug–Oct."}},
  southfork:    {t:"gold", season:{best:[[4,5],[9,11]],
                  why:"Dam-controlled, so it stays clear when the freestones blow out in spring; big fall browns and BWOs Sept–Nov."}},
  grosventre:   {t:"1", season:{best:[[7,10]], poor:[[4,6]], why:"Snowmelt-muddy until early July."}},
  hoback:       {t:"2", season:{best:[[7,9]],  poor:[[4,6]], why:"Snowmelt-muddy until early July."}},
  buffalofork:  {t:"2", season:{best:[[7,9]],  poor:[[4,6]], why:"Snowmelt-muddy until early July."}},
  flatcreek:    {t:"2"},
  salt:         {t:"2", season:{best:[[7,10]], poor:[[4,6]], why:"Runoff through June."}},
  greys:        {t:"2", season:{best:[[7,10]], poor:[[4,6]], why:"Runoff through June."}},
  snakeflagg:   {t:"2", season:{best:[[7,9]], poor:[[4,6]], why:"Runoff through June."}},

  /* ---- Eastern Idaho, Henry's Fork country ---- */
  henrysfork:   {t:"gold", season:{best:[[6,10]], why:"Salmonflies and green drakes in June; fishes well all summer and fall."}},
  fallriver:    {t:"1", season:{best:[[6,10]]}},
  silvercreek:  {t:"gold", season:{best:[[5,6],[9,10]], why:"Spring-creek hatches peak late spring and early fall."}},
  bigwood:      {t:"1", season:{best:[[6,10]], poor:[[4,5]], why:"Runoff in May."}},
  teton:        {t:"gold", season:{best:[[7,10]], poor:[[4,6]],
                  why:"Runoff muddies the valley in spring; it clears later than the South Fork and fishes best July–Oct."}},
  boise:        {t:"1"},
  sfboise:      {t:"1", season:{best:[[4,5],[9,11]]}},

  /* ---- Central Idaho ---- */
  salmon:       {t:"1", season:{best:[[7,9]], poor:[[4,6]], why:"High, cold and off-colour through June."}},
  mfsalmon:     {t:"1", season:{best:[[7,9]], poor:[[4,6]], why:"Wilderness cutthroat water; fishable after runoff."}},
  lemhi:        {t:"2"},
  selway:       {t:"1", season:{best:[[7,8]], poor:[[4,6]], why:"Runoff through June."}},
  lochsa:       {t:"2", season:{best:[[7,9]], poor:[[4,6]]}},
  clearwater:   {t:"2"},
  nfclearwater: {t:"2", season:{best:[[7,9]], poor:[[4,6]]}},
  stjoe:        {t:"1", season:{best:[[7,9]], poor:[[4,6]], why:"Runoff through June; dry-fly cutthroat July–Sept."}},
  cda:          {t:"2"},
  kootenai:     {t:"2"},
  snakeid:      {t:"2"},
  hellscanyon:  {t:"2"},

  /* ---- Wyoming ---- */
  nplattereef:  {t:"gold"},
  nplatteupper: {t:"1", season:{poor:[[5,6]], why:"Runoff in May–June."}},
  green:        {t:"1", season:{best:[[7,9]], poor:[[5,6]], why:"Runoff in May–June."}},
  newfork:      {t:"2", season:{poor:[[5,6]]}},
  nfshoshone:   {t:"2", season:{best:[[7,9]], poor:[[5,6]]}},
  shoshone:     {t:"2"},
  clarksfork:   {t:"2", season:{best:[[8,10]], poor:[[5,7]]}},
  encampmentwy: {t:"2"},

  /* ---- Yellowstone (the 166 unnamed-by-anyone creeks stay Class 3) ---- */
  madisonriver:     {t:"gold", season:{best:[[5,6],[9,10]], closed:[[11,4]],
                      why:"Opens May 1; fly-fishing only. Best in early summer and the fall brown run."}},
  fireholeriver:    {t:"gold", season:{best:[[5,6],[9,10]], poor:[[7,8]], closed:[[11,4]],
                      why:"Opens May 1. Thermal water runs too warm in July–August; best early summer and fall."}},
  gibbonriver:      {t:"1",    season:{best:[[5,6],[9,10]], closed:[[11,4]], why:"Opens May 1."}},
  yellowstoneriver: {t:"gold", season:{best:[[7,9]], closed:[[11,6]],
                      why:"Yellowstone below the lake opens July 1."}},
  lamarriver:       {t:"gold", season:{best:[[7,9]], poor:[[5,6]], closed:[[11,4]],
                      why:"Runoff-high until early July; season opens Memorial Day weekend."}},
  sloughcreek:      {t:"gold", season:{best:[[7,9]], poor:[[5,6]], closed:[[11,4]],
                      why:"Runoff-high until early July; season opens Memorial Day weekend."}},
  sodabuttecreek:   {t:"1",    season:{best:[[7,9]], poor:[[5,6]], closed:[[11,4]]}},
  gardnerriver:     {t:"2",    season:{best:[[8,10]], poor:[[4,6]], why:"Runoff through June."}},
  lewisriver:       {t:"2",    season:{best:[[9,10]], closed:[[11,6]], why:"Fall brown trout run out of Lewis Lake."}},
  bechlerriver:     {t:"2",    season:{best:[[7,9]], closed:[[11,5]]}},
  gallatinyell:     {t:"2",    season:{best:[[7,9]], closed:[[11,5]]}},
  specimencreek:    {t:"2",    season:{best:[[7,9]], closed:[[11,5]]}},
  hellroaringcreek: {t:"2",    season:{best:[[7,9]], closed:[[11,5]]}},
  pelicancreek:     {t:"2",    season:{closed:[[11,7]], why:"Lake tributary: opens July 15."}},

  /* ---- Grand Teton — most park streams closed Dec 1–Jul 31 ---- */
  pacificcreek: {t:"2", season:{best:[[8,10]], poor:[[4,6]], why:"Runoff through June (open year-round under park exemption)."}},
  spreadcreek:  {t:"2", season:{best:[[8,9]], closed:[[12,7]], why:"Park streams open August 1."}},

  /* ---- Teton Valley & Swan Valley: tributaries close June 1–30 ---- */
  tv_bitchcreek:      {t:"2", season:{best:[[8,10]], poor:[[4,5]], closed:[[6,6]]}},
  tv_darbycreek:      {t:"2", season:{best:[[7,10]], poor:[[4,5]], closed:[[6,6]]}},
  sv_palisadescreek:  {t:"2", season:{best:[[7,10]], poor:[[4,5]], closed:[[6,6]]}},
  sv_raineycreek:     {t:"2", season:{best:[[7,10]], poor:[[4,5]], closed:[[6,6]]}},
  sv_bigelkcreek:     {t:"2", season:{best:[[7,10]], poor:[[4,5]], closed:[[6,6]]}},

  /* ---- Central Iowa (warmwater float rivers) ---- */
  desmoines:    {t:"2"},

  /* ---- Driftless — DRAFT: please review, this is the region you know best ---- */
  kinnickinnic: {t:"gold"},
  timbercoulee: {t:"gold"},
  // Iowa
  waterloocreek:{t:"1"}, bloodyrun:{t:"1"}, yellowriver:{t:"1"}, frenchcreek:{t:"1"},
  paintcreek:{t:"1"}, springbranchia:{t:"1"},
  upperiowa:{t:"2"}, troutrunia:{t:"2"}, coldwaterIA:{t:"2"}, canoecreek:{t:"2"},
  iaCaseySprings:{t:"2"}, iaEnsignHollowCreek:{t:"2"}, iaFalconSpringBranch:{t:"2"},
  iaPineSpringCreek:{t:"2"}, iaSouthPineCreek:{t:"2"}, iaWestFrenchCreek:{t:"2"},
  // Minnesota
  whitewater:{t:"1"},
  rootriver:{t:"2"}, sfroot:{t:"2"}, mfwhitewater:{t:"2"}, garvinbrook:{t:"2"},
  troutrunmn:{t:"2"}, beavercreekmn:{t:"2"}, duschee:{t:"2"}, haycreek:{t:"2"},
  crookedcreekmn:{t:"2"}, vermillionmn:{t:"2"},
  // Wisconsin
  cooncreek:{t:"1"}, blackearth:{t:"1"}, rushriverwi:{t:"1"}, trimbelle:{t:"1"},
  kickapoo:{t:"2"}, wforkkickapoo:{t:"2"}, tainter:{t:"2"}, badaxe:{t:"2"},
  rushcreekwi:{t:"2"}, mountvernon:{t:"2"}, castlerock:{t:"2"}, biggreen:{t:"2"},
  grantriver:{t:"2"}, ebpecatonica:{t:"2"}, silvercreekwi:{t:"2"}, stillwell:{t:"2"},

  /* ---- North Shore — steelhead run in spring and fall ---- */
  boisbrulewi:    {t:"gold", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  kniferiverns:   {t:"1", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  gooseberryriver:{t:"1", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  baptismriver:   {t:"1", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  splitrockriver: {t:"1", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  temperanceriver:{t:"1", season:{best:[[4,5],[9,10]], why:"Steelhead run in spring and fall."}},
  cascaderiver:   {t:"2", season:{best:[[4,5],[9,10]]}},
  lesterriver:    {t:"2", season:{best:[[4,5],[9,10]]}},
  frenchriverns:  {t:"2", season:{best:[[4,5],[9,10]]}},
  suckerriver:    {t:"2", season:{best:[[4,5],[9,10]]}},
  stewartriver:   {t:"2", season:{best:[[4,5],[9,10]]}},
  deviltrackriver:{t:"2", season:{best:[[4,5],[9,10]]}},
  brulerivermn:   {t:"2", season:{best:[[4,5],[9,10]]}},
  pigeonriver:    {t:"2"},
  stlouisriver:   {t:"2"},

  /* ---- Door Peninsula ---- */
  hibbardscr:   {t:"2"},
  logancr:      {t:"2"},

  /* ---- East-central MN / St. Croix & Northwoods (warmwater; frozen in winter) ---- */
  stcroix:        {t:"1", season:{best:[[6,9]], poor:[[12,3]], why:"Smallmouth season; ice-bound in winter."}},
  namekagonriver: {t:"1", season:{best:[[6,9]], poor:[[12,3]], why:"Smallmouth and trout; ice-bound in winter."}},
  crowwing:       {t:"1", season:{best:[[6,9]], poor:[[12,3]]}},
  rumriver:       {t:"2", season:{poor:[[12,3]]}},
  kettleriver:    {t:"2", season:{poor:[[12,3]]}},
  cannonriver:    {t:"2", season:{poor:[[12,3]]}},
  mississippiTC:  {t:"2", season:{poor:[[12,3]]}},
  straightmn:     {t:"2"},
  prairiewi:      {t:"2"},
  chippewawi:     {t:"2", season:{poor:[[12,3]]}},
  flambeau:       {t:"2", season:{poor:[[12,3]]}},
  sfflambeau:     {t:"2", season:{poor:[[12,3]]}},
  wisconsinriver: {t:"2", season:{poor:[[12,3]]}},
  wolfriverwi:    {t:"2", season:{poor:[[12,3]]}},
};

const TIER_INFO = {
  gold:{label:"Gold",    short:"Gold", color:"#c79a1c", blurb:"Destination water"},
  "1": {label:"Class 1", short:"1",    color:"#0e6f7d", blurb:"Very good"},
  "2": {label:"Class 2", short:"2",    color:"#5a8a8f", blurb:"Good"},
  "3": {label:"Class 3", short:"3",    color:"#8b9690", blurb:"The rest"},
};

const inWindow = (m, wins) => !!wins && wins.some(([a,b]) => a<=b ? (m>=a && m<=b) : (m>=a || m<=b));
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const winText = wins => wins.map(([a,b]) => a===b ? MONTHS[a-1] : MONTHS[a-1]+"–"+MONTHS[b-1]).join(", ");

/* The class a river holds in a given month.
   Returns {tier, base, state, why}: `state` is "best" | "poor" | "closed" | null. */
function tierOf(r, date){
  const e = TIERS[r.id];
  const base = e ? e.t : "3";
  const m = (date || new Date()).getMonth() + 1;
  const s = e && e.season;
  if(!s) return {tier:base, base, state:null, why:""};
  if(inWindow(m, s.closed)) return {tier:"3", base, state:"closed", why:s.why||"", wins:s.closed};
  let i = TIER_ORDER.indexOf(base), state = null;
  if(inWindow(m, s.best)){ i = Math.min(3, i+1); state = "best"; }
  else if(inWindow(m, s.poor)){ i = Math.max(0, i-1); state = "poor"; }
  return {tier:TIER_ORDER[i], base, state, why:s.why||"", wins: state==="best"?s.best : state==="poor"?s.poor : null};
}
