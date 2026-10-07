/* Official fishery designations: a state's own "this is top water" label,
   which is a different thing from this app's Gold tier (a personal ranking).
   Each entry names the agency, the designation, and the reach in the
   agency's own words. A designation often covers only part of a mapped
   river, and the reach line is what keeps that honest.

   Sources (fetched 2026-10-06):
   - Colorado: CPW 2026 Colorado Fishing, Special Regulations, entries marked
     Gold Medal (parsed in ~/.cache/flyfish-osm/rockies/regs/co_entries.json).
   - Utah: DWR 2026 Utah Fishing Guidebook, Blue Ribbon Fisheries markers
     (ut_entries.json).
   - Wyoming: WGFD, "what is a blue ribbon stream, and where are Wyoming's
     located?" (2018): more than 600 lb of trout per mile.
   - Montana: FWP Instream Flows page. The 1969 statute reserved water in
     "twelve blue ribbon streams" (the Murphy Rights), each by reach.
   Designated water that isn't on this map yet (Utah's East Fork Boulder
   Creek and Lower Fish Creek, Wyoming's Middle Fork Powder River and Sand
   Creek, Colorado's Standley Lake) is simply absent. */
const DESIG_SRC = {
  cpw:  {label:"Gold Medal Water", by:"Colorado Parks & Wildlife", url:"https://cpw.state.co.us/fishing"},
  udwr: {label:"Blue Ribbon Fishery", by:"Utah DWR", url:"https://wildlife.utah.gov/fishing"},
  wgfd: {label:"Blue Ribbon stream", by:"Wyoming Game & Fish", url:"https://wgfd.wyo.gov/Ask-Game-and-Fish/Mark,-what-is-a-blue-ribbon-stream,-and-where-are"},
  mfwp: {label:"Blue ribbon stream (Murphy Right)", by:"Montana FWP", url:"https://fwp.mt.gov/conservation/fisheries-management/water-management/instream-flows"},
};
const D_ = (src, reach) => ({src, reach});
const DESIGNATIONS = {
  // Colorado: reach is the one the booklet's Gold Medal marker sits on
  animas:        D_("cpw", "the reach marked Gold Medal in the rules"),
  arkansasco:    D_("cpw", "the reach marked Gold Medal in the rules"),
  blueriverco:   D_("cpw", "the reach marked Gold Medal in the rules"),
  coloradoco:    D_("cpw", "the reach marked Gold Medal in the rules"),
  fryingpan:     D_("cpw", "the reach CPW marks Gold Medal"),
  gorecreek:     D_("cpw", "the reach CPW marks Gold Medal"),
  gunnisonblca:  D_("cpw", "the reach marked Gold Medal in the rules"),
  gunnisonupper: D_("cpw", "the reach marked Gold Medal in the rules"),
  gunnisongorge: D_("cpw", "the reach marked Gold Medal in the rules"),
  northplatteco: D_("cpw", "the reach CPW marks Gold Medal"),
  riograndeco:   D_("cpw", "the reach CPW marks Gold Medal"),
  roaringforkco: D_("cpw", "the reach marked Gold Medal in the rules"),
  southplatte:   D_("cpw", "the reaches CPW marks Gold Medal"),
  mfsouthplatte: D_("cpw", "the reach CPW marks Gold Medal"),
  sfsouthplatte: D_("cpw", "the reach CPW marks Gold Medal"),
  taylorriver:   D_("cpw", "the reach marked Gold Medal in the rules"),
  northdelaney:  D_("cpw", "Delaney Butte Lakes (North, South & East)"),
  // Utah
  currantcreek:  D_("udwr", "Wasatch County"),
  greenut:       D_("udwr", "Green River"),
  logan:         D_("udwr", "Cache County"),
  provo:         D_("udwr", "Summit, Utah and Wasatch counties"),
  weberut:       D_("udwr", "Summit County"),
  wfduchesne:    D_("udwr", "Duchesne and Wasatch counties"),
  flaminggorge:  D_("udwr", "Daggett County"),
  strawberryres: D_("udwr", "Wasatch County"),
  // Wyoming, in WGFD's words
  nplatteupper:  D_("wgfd", "North Platte River, Colorado line to Casper"),
  nplattereef:   D_("wgfd", "North Platte River, Colorado line to Casper"),
  bighorn:       D_("wgfd", "near Thermopolis"),
  shoshone:      D_("wgfd", "near Cody"),
  snake:         D_("wgfd", "Jackson Lake to Idaho"),
  encampmentwy:  D_("wgfd", "near Riverside"),
  wind:          D_("wgfd", "near Dubois"),
  salt:          D_("wgfd", "near Alpine"),
  newfork:       D_("wgfd", "near Pinedale"),
  // Montana, the statute's reaches
  bigspring:     D_("mfwp", "mouth to the state fish hatchery"),
  blackfootmt:   D_("mfwp", "mouth to the North Fork"),
  flatheadmt:    D_("mfwp", "mouth to the Canadian border on the North Fork"),
  nfflathead:    D_("mfwp", "Flathead River, mouth to the Canadian border on the North Fork"),
  mfflathead:    D_("mfwp", "mouth to Cox Creek"),
  sfflatheadmt:  D_("mfwp", "Hungry Horse Reservoir to the Danaher and Youngs Creeks junction"),
  gallatinmt:    D_("mfwp", "Gallatin and West Gallatin, mouth to Yellowstone National Park"),
  madisonmt:     D_("mfwp", "mouth to Hebgen Dam"),
  missourimt:    D_("mfwp", "Toston Dam to the Smith River junction"),
  rockcreekmt:   D_("mfwp", "mouth to the East and West Forks junction"),
  smithmt:       D_("mfwp", "Fort Logan bridge to the Hound Creek mouth"),
  yellowstonemt: D_("mfwp", "Yellowstone National Park to the Stillwater County line"),
};
