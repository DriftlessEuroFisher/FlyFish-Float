/* ============================================================
   DATA — rivers, gauges, access points, floats.
   Split out of index.html so this is the one file you touch
   to add a river, fix a gauge ID, or set a goodFlow range.
   ============================================================ */
/* ============================================================
   DATA — Idaho & Wyoming rivers, gauges, access points, floats
   Coverage = the major fishable/floatable rivers of both states.
   River geometry is simplified hand-digitized polyline data in
   GeoJSON-style coordinate arrays — recognizable at state zoom,
   NOT navigation-grade. To upgrade, export reaches from the USGS
   National Hydrography Dataset (NHD) and swap the coords arrays.
   Gauge IDs are verified at runtime against the USGS
   monitoring-locations metadata collection; any that fail to
   resolve are flagged "(unverified)" in the UI.
   ============================================================ */

const GAUGES = {
  // --- Jackson Hole core ---
  mooseSnake:   { site:"USGS-13013650", label:"Snake River at Moose, WY" },
  damSnake:     { site:"USGS-13011000", label:"Snake River nr Moran (below Jackson Lake Dam)" },
  townSnake:    { site:"USGS-13018750", label:"Snake River below Flat Creek, nr Jackson" },
  alpineSnake:  { site:"USGS-13022500", label:"Snake River above reservoir, nr Alpine" },
  grosVentre:   { site:"USGS-13014500", label:"Gros Ventre River at Kelly, WY" },
  hoback:       { site:"USGS-13019300", label:"Hoback River above Cliff Creek, nr Bondurant" },
  flatCreek:    { site:"USGS-13018350", label:"Flat Creek below Cache Creek, nr Jackson" },
  buffaloFork:  { site:"USGS-13011900", label:"Buffalo Fork above Lava Creek, nr Moran" },
  salt:         { site:"USGS-13027500", label:"Salt River above reservoir, nr Etna" },
  greys:        { site:"USGS-13023000", label:"Greys River above reservoir, nr Alpine" },
  southFork:    { site:"USGS-13032500", label:"Snake River nr Irwin (below Palisades)" },
  heise:        { site:"USGS-13037500", label:"Snake River nr Heise, ID" },
  teton:        { site:"USGS-13052200", label:"Teton River above S. Leigh Creek, nr Driggs" },
  tetonStA:     { site:"USGS-13055000", label:"Teton River nr St. Anthony, ID" },
  // --- Eastern Idaho ---
  hfIslandPark: { site:"USGS-13042500", label:"Henrys Fork nr Island Park (Box Canyon)" },
  hfAshton:     { site:"USGS-13046000", label:"Henrys Fork nr Ashton, ID" },
  hfStAnthony:  { site:"USGS-13050500", label:"Henrys Fork at St. Anthony, ID" },
  fallRiver:    { site:"USGS-13047500", label:"Falls River nr Squirrel, ID" },
  snakeBlackfoot:{site:"USGS-13069500", label:"Snake River nr Blackfoot, ID" },
  blackfootId:  { site:"USGS-13063000", label:"Blackfoot River above reservoir, ID" },
  portneuf:     { site:"USGS-13075500", label:"Portneuf River at Pocatello, ID" },
  bearBorder:   { site:"USGS-10039500", label:"Bear River at Border, WY" },
  // --- South-central / southwest Idaho ---
  bigWood:      { site:"USGS-13139510", label:"Big Wood River at Hailey, ID" },
  silverCreek:  { site:"USGS-13150430", label:"Silver Creek at Sportsman Access nr Picabo" },
  bigLost:      { site:"USGS-13127000", label:"Big Lost River below Mackay Reservoir" },
  snakeKingHill:{ site:"USGS-13154500", label:"Snake River at King Hill, ID" },
  bruneau:      { site:"USGS-13168500", label:"Bruneau River nr Hot Spring, ID" },
  boiseTwinSpr: { site:"USGS-13185000", label:"Boise River nr Twin Springs, ID" },
  boiseGlenwood:{ site:"USGS-13206000", label:"Boise River at Glenwood Bridge, Boise" },
  sfBoise:      { site:"USGS-13190500", label:"SF Boise River at Anderson Ranch Dam" },
  sfPayette:    { site:"USGS-13235000", label:"SF Payette River at Lowman, ID" },
  nfPayette:    { site:"USGS-13246000", label:"NF Payette River nr Banks, ID" },
  payette:      { site:"USGS-13247500", label:"Payette River nr Horseshoe Bend, ID" },
  snakeWeiser:  { site:"USGS-13269000", label:"Snake River at Weiser, ID" },
  snakeHellsDam:{ site:"USGS-13290450", label:"Snake River at Hells Canyon Dam" },
  // --- Central / north Idaho ---
  salmonTown:   { site:"USGS-13302500", label:"Salmon River at Salmon, ID" },
  salmonWB:     { site:"USGS-13317000", label:"Salmon River at White Bird, ID" },
  mfSalmon:     { site:"USGS-13309220", label:"MF Salmon River at Middle Fork Lodge" },
  lemhi:        { site:"USGS-13305000", label:"Lemhi River nr Lemhi, ID" },
  littleSalmon: { site:"USGS-13316500", label:"Little Salmon River at Riggins, ID" },
  lochsa:       { site:"USGS-13337000", label:"Lochsa River nr Lowell, ID" },
  selway:       { site:"USGS-13336500", label:"Selway River nr Lowell, ID" },
  clearwater:   { site:"USGS-13342500", label:"Clearwater River at Spalding, ID" },
  sfClearwater: { site:"USGS-13338500", label:"SF Clearwater River at Stites, ID" },
  nfClearwater: { site:"USGS-13340600", label:"NF Clearwater nr Canyon Ranger Station" },
  stJoe:        { site:"USGS-12414500", label:"St. Joe River at Calder, ID" },
  cdaEnaville:  { site:"USGS-12413000", label:"NF Coeur d'Alene River at Enaville" },
  cdaCataldo:   { site:"USGS-12413500", label:"Coeur d'Alene River nr Cataldo" },
  kootenai:     { site:"USGS-12309500", label:"Kootenai River at Bonners Ferry, ID" },
  priest:       { site:"USGS-12395000", label:"Priest River nr Priest River, ID" },
  // --- Wyoming beyond Jackson ---
  npSaratoga:   { site:"USGS-06630000", label:"North Platte River nr Saratoga, WY" },
  npGreyReef:   { site:"USGS-06642000", label:"North Platte River below Grey Reef (Alcova)" },
  windCrowheart:{ site:"USGS-06225500", label:"Wind River nr Crowheart, WY" },
  windBoysen:   { site:"USGS-06259000", label:"Wind River below Boysen Reservoir" },
  nfShoshone:   { site:"USGS-06279940", label:"NF Shoshone River nr Wapiti, WY" },
  shoshoneBB:   { site:"USGS-06281000", label:"Shoshone River below Buffalo Bill Reservoir" },
  tongue:       { site:"USGS-06298000", label:"Tongue River nr Dayton, WY" },
  clarksFork:   { site:"USGS-06207500", label:"Clarks Fork Yellowstone nr Belfry, MT" },
  greenWarren:  { site:"USGS-09188500", label:"Green River at Warren Bridge, nr Daniel" },
  greenFont:    { site:"USGS-09211200", label:"Green River below Fontenelle Reservoir" },
  greenGR:      { site:"USGS-09217000", label:"Green River nr Green River, WY" },
  newFork:      { site:"USGS-09205000", label:"New Fork River nr Big Piney, WY" },
  encampment:   { site:"USGS-06623800", label:"Encampment River above Hog Park Creek" },
  laramie:      { site:"USGS-06659500", label:"Laramie River nr Woods Landing, WY" },
  // --- Central Iowa water trails (Des Moines area) ---
  dmSaylorville:  { site:"USGS-05481650", label:"Des Moines River near Saylorville, IA" },
  dmDesMoines:    { site:"USGS-05482000", label:"Des Moines River at 2nd Ave, Des Moines, IA" },
  dmBelowRaccoon: { site:"USGS-05485500", label:"Des Moines River below Raccoon River, Des Moines, IA" },
  raccoonWDM:     { site:"USGS-05484600", label:"Raccoon River near West Des Moines, IA" },
  raccoonVanMeter:{ site:"USGS-05484500", label:"Raccoon River at Van Meter, IA" },
  nRaccoonJefferson:{ site:"USGS-05482500", label:"North Raccoon River near Jefferson, IA" },
  nRaccoonSacCity:{ site:"USGS-05482300", label:"North Raccoon River near Sac City, IA" },
  mRaccoonPanora: { site:"USGS-05483600", label:"Middle Raccoon River at Panora, IA" },
  sRaccoonRedfield:{ site:"USGS-05484000", label:"South Raccoon River at Redfield, IA" },
  sSkunkAmes:     { site:"USGS-05470000", label:"South Skunk River near Ames, IA" },
  sSkunkAboveAmes:{ site:"USGS-05469995", label:"South Skunk River above Ames, IA" },
  beaverCreekJohnston:{ site:"USGS-05481950", label:"Beaver Creek near Johnston/Grimes, IA" },
  /* ---- DRIFTLESS AREA (NE Iowa / SE Minnesota / SW Wisconsin / NW Illinois) ----
     Only sites that actually publish DISCHARGE (parameter 00060) are listed.
     Several Driftless gauges are stage-only — Rush Creek and Crooked Creek in
     MN, Campbell Creek, Root River above Rushford — so those streams are
     carried as ungauged wade water rather than showing a number the status
     logic can't interpret. Verified live against USGS on 2026-09-21. */
  // --- Driftless: northeast Iowa ---
  uiBluffton:     { site:"USGS-05387440", label:"Upper Iowa River at Bluffton, IA" },
  uiDecorah:      { site:"USGS-05387500", label:"Upper Iowa River at Decorah, IA" },
  uiDorchester:   { site:"USGS-05388250", label:"Upper Iowa River near Dorchester, IA" },
  waterlooCr:     { site:"USGS-05388310", label:"Waterloo Creek near Dorchester, IA" },
  yellowIon:      { site:"USGS-05389000", label:"Yellow River near Ion, IA" },
  bloodyRun:      { site:"USGS-05389400", label:"Bloody Run Creek near Marquette, IA" },
  turkeySpillville:{ site:"USGS-05411600", label:"Turkey River at Spillville, IA" },
  turkeyEldorado: { site:"USGS-05411850", label:"Turkey River near Eldorado, IA" },
  turkeyElkader:  { site:"USGS-05412020", label:"Turkey River at Elkader, IA" },
  volgaLittleport:{ site:"USGS-05412400", label:"Volga River at Littleport, IA" },
  // --- Driftless: southeast Minnesota ---
  rootPilotMound: { site:"USGS-05383950", label:"Root River near Pilot Mound, MN" },
  rootHouston:    { site:"USGS-05385000", label:"Root River near Houston, MN" },
  sfRootHouston:  { site:"USGS-05385500", label:"South Fork Root River near Houston, MN" },
  // --- Driftless: Wisconsin ---
  kickOntario:    { site:"USGS-05407468", label:"Kickapoo River at Hwy 131, Ontario, WI" },
  kickLaFarge:    { site:"USGS-05408000", label:"Kickapoo River at La Farge, WI" },
  kickSteuben:    { site:"USGS-05410490", label:"Kickapoo River at Steuben, WI" },
  blackEarthCP:   { site:"USGS-05406457", label:"Black Earth Creek at Cross Plains, WI" },
  blackEarth:     { site:"USGS-05406500", label:"Black Earth Creek at Black Earth, WI" },
  laCrosseSparta: { site:"USGS-05382325", label:"La Crosse River at Sparta, WI" },
  silverAngelo:   { site:"USGS-05382284", label:"Silver Creek at Hwy 21 near Angelo, WI" },
  stillwellTomah: { site:"USGS-05382255", label:"Stillwell Creek near Tomah, WI" },
  kinniRiverFalls:{ site:"USGS-05342000", label:"Kinnickinnic River near River Falls, WI" },
  eauGalleSV:     { site:"USGS-05370000", label:"Eau Galle River at Spring Valley, WI" },
  grantBurton:    { site:"USGS-05413500", label:"Grant River at Burton, WI" },
  platteRockville:{ site:"USGS-05414000", label:"Platte River near Rockville, WI" },
  ebPecatonica:   { site:"USGS-05433000", label:"E. Br. Pecatonica River nr Blanchardville, WI" },
  trempArcadia:   { site:"USGS-05379400", label:"Trempealeau River at Arcadia, WI" },
};

// approximate gauge map positions [lat,lng]
const GAUGE_POS = {
  mooseSnake:[43.6565,-110.7146], damSnake:[43.8585,-110.5852], townSnake:[43.4380,-110.8030],
  alpineSnake:[43.2080,-110.9430], grosVentre:[43.6310,-110.5970], hoback:[43.2440,-110.4790],
  flatCreek:[43.4830,-110.7560], buffaloFork:[43.8390,-110.4400], salt:[43.0560,-111.0390],
  greys:[43.1430,-111.0080], southFork:[43.3517,-111.2186], heise:[43.6120,-111.6600],
  teton:[43.7800,-111.2330], tetonStA:[43.9300,-111.5500],
  hfIslandPark:[44.4150,-111.3950], hfAshton:[44.0700,-111.4500], hfStAnthony:[43.9660,-111.6840],
  fallRiver:[44.0680,-111.2200], snakeBlackfoot:[43.3100,-112.2700], blackfootId:[42.9300,-111.6300],
  portneuf:[42.8710,-112.4660], bearBorder:[42.2100,-111.0500],
  bigWood:[43.5190,-114.3190], silverCreek:[43.3170,-114.0900], bigLost:[43.9100,-113.6100],
  snakeKingHill:[42.9970,-115.2040], bruneau:[42.7700,-115.7200],
  boiseTwinSpr:[43.6590,-115.7270], boiseGlenwood:[43.6600,-116.2800], sfBoise:[43.3430,-115.4770],
  sfPayette:[44.0850,-115.6200], nfPayette:[44.0900,-116.1150], payette:[43.9430,-116.1970],
  snakeWeiser:[44.2460,-116.9790], snakeHellsDam:[45.2420,-116.6960],
  salmonTown:[45.1830,-113.8950], salmonWB:[45.7560,-116.3230], mfSalmon:[44.9800,-114.8400],
  lemhi:[44.9400,-113.6300], littleSalmon:[45.4140,-116.3140],
  lochsa:[46.1500,-115.5870], selway:[46.0870,-115.5140], clearwater:[46.4480,-116.8270],
  sfClearwater:[46.0860,-115.9750], nfClearwater:[46.8400,-115.6200],
  stJoe:[47.2750,-116.1880], cdaEnaville:[47.5700,-116.2530], cdaCataldo:[47.5550,-116.3270],
  kootenai:[48.6910,-116.3140], priest:[48.2100,-116.9100],
  npSaratoga:[41.4440,-106.8050], npGreyReef:[42.5610,-106.6420],
  windCrowheart:[43.2700,-109.1300], windBoysen:[43.4180,-108.1750],
  nfShoshone:[44.4680,-109.4300], shoshoneBB:[44.5200,-109.0600],
  tongue:[44.8700,-107.2600], clarksFork:[45.0300,-109.0600],
  greenWarren:[43.0190,-110.1180], greenFont:[42.0250,-110.0650], greenGR:[41.5160,-109.4480],
  newFork:[42.5800,-110.0900], encampment:[41.1500,-106.8200], laramie:[41.1000,-106.0100],
  // Central Iowa
  dmSaylorville:[41.6980,-93.6450], dmDesMoines:[41.6119,-93.6197], dmBelowRaccoon:[41.5800,-93.6350],
  raccoonWDM:[41.5650,-93.7450], raccoonVanMeter:[41.5340,-93.9498],
  nRaccoonJefferson:[42.0050,-94.3550], nRaccoonSacCity:[42.4230,-95.0100],
  mRaccoonPanora:[41.6942,-94.3700], sRaccoonRedfield:[41.5928,-94.1830],
  sSkunkAmes:[41.9900,-93.6280], sSkunkAboveAmes:[42.0450,-93.6100],
  beaverCreekJohnston:[41.6850,-93.7450],
  // Driftless — coordinates taken straight from USGS site metadata
  uiBluffton:[43.4069,-91.8990], uiDecorah:[43.3049,-91.7955], uiDorchester:[43.4211,-91.5088],
  waterlooCr:[43.4511,-91.5051], yellowIon:[43.1119,-91.2651], bloodyRun:[43.0408,-91.2065],
  turkeySpillville:[43.2073,-91.9503], turkeyEldorado:[43.0542,-91.8091],
  turkeyElkader:[42.8435,-91.4013], volgaLittleport:[42.7539,-91.3690],
  rootPilotMound:[43.7828,-92.0316], rootHouston:[43.7686,-91.5699], sfRootHouston:[43.7388,-91.5643],
  kickOntario:[43.7299,-90.5889], kickLaFarge:[43.5742,-90.6432], kickSteuben:[43.1828,-90.8583],
  blackEarthCP:[43.1097,-89.6408], blackEarth:[43.1342,-89.7322],
  laCrosseSparta:[43.9375,-90.8106], silverAngelo:[43.9672,-90.7650], stillwellTomah:[43.9939,-90.6572],
  kinniRiverFalls:[44.8308,-92.7331], eauGalleSV:[44.8528,-92.2383],
  grantBurton:[42.7203,-90.8192], platteRockville:[42.7311,-90.6403], ebPecatonica:[42.7856,-89.8611],
  trempArcadia:[44.2544,-91.5053],
};

const RIVERS = [
/* ================= JACKSON HOLE CORE (unchanged) ================= */
{
  id:"snake", name:"Snake River — Jackson Hole", color:"#1f6f8b",
  state:"WY", gauges:["damSnake","mooseSnake","townSnake","alpineSnake"], primaryGauge:"mooseSnake",
  goodFlow:{min:1000,max:3000}, // starting point from public guide reports (best wading window July-Sept, Jackson Hole float shops) — adjust to your own experience
  blurb:"The main artery of the valley: a big, braided freestone full of native Snake River fine-spotted cutthroat. Character changes hugely by reach — flat dam water up top, fast braids through the park, and genuine Class III whitewater in the canyon below Hoback Junction.",
  fish:"Dry-dropper from a drift boat is the classic program. Fishes best once runoff drops out (typically July) through October. Watch water temps mid-summer.",
  coords:[[43.8585,-110.5852],[43.8575,-110.5700],[43.8600,-110.5560],[43.8590,-110.5380],[43.8520,-110.5230],[43.8430,-110.5120],[43.8330,-110.5080],[43.8230,-110.5160],[43.8160,-110.5340],[43.8100,-110.5520],[43.8000,-110.5680],[43.7880,-110.5820],[43.7760,-110.5980],[43.7660,-110.6160],[43.7560,-110.6380],[43.7480,-110.6560],[43.7390,-110.6680],[43.7320,-110.6740],[43.7220,-110.6820],[43.7120,-110.6900],[43.7010,-110.6960],[43.6900,-110.7000],[43.6790,-110.7040],[43.6680,-110.7100],[43.6560,-110.7150],[43.6420,-110.7180],[43.6280,-110.7240],[43.6140,-110.7320],[43.6010,-110.7420],[43.5880,-110.7520],[43.5740,-110.7620],[43.5600,-110.7720],[43.5460,-110.7820],[43.5320,-110.7940],[43.5180,-110.8060],[43.5040,-110.8180],[43.4906,-110.8330],[43.4790,-110.8280],[43.4680,-110.8160],[43.4570,-110.8050],[43.4460,-110.7980],[43.4340,-110.7940],[43.4220,-110.7920],[43.4100,-110.7900],[43.3960,-110.7880],[43.3820,-110.7820],[43.3700,-110.7720],[43.3590,-110.7600],[43.3480,-110.7480],[43.3360,-110.7380],[43.3240,-110.7320],[43.3120,-110.7340],[43.3010,-110.7460],[43.2950,-110.7640],[43.2910,-110.7870],[43.2820,-110.8040],[43.2720,-110.8200],[43.2620,-110.8380],[43.2540,-110.8560],[43.2450,-110.8720],[43.2360,-110.8840],[43.2320,-110.8900],[43.2240,-110.9020],[43.2160,-110.9180],[43.2080,-110.9340],[43.2000,-110.9500],[43.1920,-110.9660],[43.1840,-110.9800],[43.1760,-110.9890],[43.1840,-111.0040],[43.1840,-111.0200],[43.1760,-111.0340]]
},
{
  id:"southfork", name:"South Fork of the Snake", color:"#0e7a6a",
  state:"ID", gauges:["southFork","heise"], primaryGauge:"southFork",
  goodFlow:{min:6000,max:9000}, // starting point from public guide reports (fall dry-fly/wade window per SF Snake guide reports) — adjust to your own experience
  blurb:"A blue-ribbon tailwater below Palisades Dam — flows are reservoir-controlled, so it stays fishable when the freestones blow out. Huge cottonwood corridor, big cutthroat, browns, and rainbows, famous salmonfly hatch in early July.",
  fish:"Because the Bureau of Reclamation sets releases, check the gauge the morning you float — releases can change quickly. Banks fish well at most flows; riffles open up as water drops.",
  coords:[[43.3370,-111.2100],[43.3400,-111.2180],[43.3460,-111.2280],[43.3540,-111.2380],[43.3640,-111.2480],[43.3760,-111.2560],[43.3880,-111.2640],[43.3960,-111.2780],[43.4006,-111.3050],[43.4060,-111.3240],[43.4140,-111.3420],[43.4240,-111.3560],[43.4360,-111.3680],[43.4450,-111.3820],[43.4501,-111.3984],[43.4560,-111.4180],[43.4660,-111.4360],[43.4760,-111.4500],[43.4900,-111.4600],[43.5040,-111.4680],[43.5160,-111.4820],[43.5240,-111.5020],[43.5300,-111.5240],[43.5320,-111.5460],[43.5380,-111.5660],[43.5480,-111.5840],[43.5600,-111.5980],[43.5720,-111.6120],[43.5840,-111.6280],[43.5960,-111.6420],[43.6080,-111.6520],[43.6160,-111.6580],[43.6226,-111.6653],[43.6180,-111.6840],[43.6120,-111.7020],[43.6060,-111.7200],[43.5980,-111.7380],[43.5880,-111.7560],[43.5760,-111.7720],[43.5620,-111.7860],[43.5500,-111.8020],[43.5440,-111.8220],[43.5440,-111.8440],[43.5500,-111.8640],[43.5480,-111.8840],[43.5380,-111.9020],[43.5280,-111.9220],[43.5160,-111.9420],[43.5020,-111.9620],[43.4900,-112.0040]]
},
{
  id:"teton", name:"Teton River (Teton Valley)", color:"#5b8c2a",
  state:"ID", gauges:["teton","tetonStA"], primaryGauge:"teton",
  goodFlow:{min:150,max:400}, // starting point from public guide reports (ideal wade flows per Teton Valley guide reports) — adjust to your own experience
  blurb:"A slow, clear spring-creek-style river meandering through the hay meadows of Teton Valley near Driggs and Victor, then dropping into a remote canyon. Glassy water, sighted fish, technical dry-fly fishing with the Tetons behind you.",
  fish:"PMDs, gray drakes, and terrestrials on long leaders. Valley floats are flat Class I — ideal for a first rowing day. The canyon below Harrops is committing; don't drift past your take-out.",
  coords:[[43.5780,-111.1380],[43.5900,-111.1520],[43.6020,-111.1660],[43.6140,-111.1780],[43.6280,-111.1880],[43.6420,-111.1960],[43.6560,-111.2020],[43.6700,-111.2080],[43.6840,-111.2140],[43.6980,-111.2180],[43.7050,-111.2220],[43.7180,-111.2260],[43.7320,-111.2300],[43.7460,-111.2330],[43.7540,-111.2320],[43.7660,-111.2320],[43.7780,-111.2330],[43.7900,-111.2340],[43.8000,-111.2350],[43.8120,-111.2380],[43.8240,-111.2420],[43.8360,-111.2460],[43.8480,-111.2500],[43.8600,-111.2550],[43.8720,-111.2660],[43.8820,-111.2800],[43.8900,-111.2960],[43.8960,-111.3140],[43.9040,-111.3320],[43.9140,-111.3480],[43.9260,-111.3640],[43.9360,-111.3820],[43.9420,-111.4020],[43.9460,-111.4240],[43.9480,-111.4460],[43.9460,-111.4680],[43.9400,-111.4880],[43.9320,-111.5080],[43.9240,-111.5280],[43.9180,-111.5480],[43.9220,-111.5680],[43.9300,-111.5860]]
},
{
  id:"grosventre", name:"Gros Ventre River", color:"#8c6a1d",
  state:"WY", gauges:["grosVentre"], primaryGauge:"grosVentre",
  goodFlow:{min:150,max:600}, // starting point from public guide reports (safe/productive wading range, Kelly gauge) — adjust to your own experience
  blurb:"A rowdy little freestone tumbling out of the Gros Ventre Range past the 1925 landslide and Slide Lake, then along the airport bench to the Snake. Mostly a wade fishery — pocket water cutthroat fishing once it clears.",
  fish:"Blows out hard in runoff and clears late (July). Hopper water in August. Flows drop fast late season as irrigation pulls water — check the Kelly gauge before driving out.",
  coords:[[43.6100,-110.4800],[43.6160,-110.4980],[43.6220,-110.5160],[43.6280,-110.5340],[43.6310,-110.5520],[43.6320,-110.5700],[43.6310,-110.5880],[43.6300,-110.5970],[43.6290,-110.6020],[43.6280,-110.6120],[43.6320,-110.6280],[43.6400,-110.6440],[43.6480,-110.6600],[43.6540,-110.6760],[43.6560,-110.6920],[43.6520,-110.7080],[43.6460,-110.7220],[43.6380,-110.7320],[43.6260,-110.7380],[43.6140,-110.7420],[43.6020,-110.7480],[43.5920,-110.7540],[43.5850,-110.7570]]
},
{
  id:"hoback", name:"Hoback River", color:"#7d4a8c",
  state:"WY", gauges:["hoback"], primaryGauge:"hoback",
  goodFlow:{min:150,max:700}, // starting point from public guide reports (optimal wadeable range per WY guide reports) — adjust to your own experience
  blurb:"A free-flowing Wild & Scenic tributary running 55 miles down a highway-accessible canyon to Hoback Junction. Spring runoff brings kayakers and packrafters; once it drops, it's a superb roadside wade fishery for cutthroat.",
  fish:"Small-water tactics: attractor dries and dry-dropper in pockets. Fishes mid-July through fall. At high water this is paddler terrain, not a beginner float.",
  coords:[[43.2300,-110.3950],[43.2360,-110.4120],[43.2420,-110.4300],[43.2450,-110.4500],[43.2450,-110.4640],[43.2440,-110.4790],[43.2500,-110.4960],[43.2580,-110.5120],[43.2660,-110.5280],[43.2740,-110.5440],[43.2820,-110.5600],[43.2900,-110.5780],[43.2960,-110.5960],[43.3000,-110.6140],[43.3040,-110.6320],[43.3080,-110.6500],[43.3120,-110.6680],[43.3140,-110.6860],[43.3160,-110.7040],[43.3180,-110.7250]]
},
{
  id:"flatcreek", name:"Flat Creek (Elk Refuge)", color:"#3a7d6e",
  state:"WY", gauges:["flatCreek"], primaryGauge:"flatCreek",
  goodFlow:{min:8,max:25}, // starting point from public guide reports (typical low, steady late-summer spring-creek flow) — adjust to your own experience
  blurb:"The valley's PhD water: a glassy spring creek winding through the National Elk Refuge minutes from Jackson's town square. Big, educated cutthroat in skinny water. Walk-in fishing only — no floating.",
  fish:"Open Aug 1 – Oct 31 on the refuge section; special regs apply. Long leaders, 5X–6X, crawl don't walk. One bad cast per pool is the rule.",
  coords:[[43.5450,-110.7000],[43.5360,-110.7060],[43.5280,-110.7120],[43.5180,-110.7180],[43.5080,-110.7240],[43.4980,-110.7320],[43.4900,-110.7420],[43.4830,-110.7560],[43.4760,-110.7640],[43.4700,-110.7700],[43.4620,-110.7800],[43.4550,-110.7900],[43.4490,-110.7980],[43.4440,-110.8060]]
},
{
  id:"buffalofork", name:"Buffalo Fork", color:"#a8552a",
  state:"WY", gauges:["buffaloFork"], primaryGauge:"buffaloFork",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A meadow-and-willow freestone draining the Teton Wilderness into the Snake at Moran. Classic cutthroat water with serious grizzly density — fish with a partner and bear spray.",
  fish:"Clears after the Snake's other tributaries; late July–September is prime. Mostly wade fishing from Turpin Meadow downstream; deadfall makes floating unpleasant.",
  coords:[[43.8570,-110.2550],[43.8560,-110.2740],[43.8540,-110.2940],[43.8520,-110.3140],[43.8500,-110.3340],[43.8470,-110.3540],[43.8450,-110.3740],[43.8420,-110.3940],[43.8400,-110.4140],[43.8390,-110.4400],[43.8400,-110.4600],[43.8410,-110.4800],[43.8420,-110.5000],[43.8425,-110.5125]]
},
{
  id:"salt", name:"Salt River (Star Valley)", color:"#2a7da8",
  state:"WY", gauges:["salt"], primaryGauge:"salt",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A gentle, spring-fed meadow river winding north through Star Valley ranchland to Palisades Reservoir. Brown trout water with undercut banks — and the area's friendliest beginner float in a canoe or small raft.",
  fish:"Streamers tight to the banks for browns; hoppers in late summer. Watch for barbed-wire fences and sweepers on outside bends — the one real hazard on an otherwise mellow river.",
  coords:[[42.6500,-110.9200],[42.6800,-110.9280],[42.7100,-110.9340],[42.7400,-110.9360],[42.7700,-110.9340],[42.8000,-110.9360],[42.8300,-110.9420],[42.8600,-110.9520],[42.8900,-110.9660],[42.9200,-110.9820],[42.9500,-110.9960],[42.9800,-111.0040],[43.0100,-111.0080],[43.0400,-111.0100],[43.0560,-111.0390],[43.0700,-111.0360],[43.0900,-111.0380],[43.1100,-111.0400],[43.1300,-111.0420],[43.1500,-111.0440],[43.1650,-111.0450]]
},
{
  id:"greys", name:"Greys River", color:"#5b6e3a",
  state:"WY", gauges:["greys"], primaryGauge:"greys",
  goodFlow:{min:200,max:600}, // starting point from public guide reports (optimal wading range near Alpine) — adjust to your own experience
  blurb:"Sixty miles of gravel-road freestone paralleling the Wyoming Range, emptying into Palisades Reservoir at Alpine. Camp-where-you-stop national forest water, eager cutthroat, almost no crowds.",
  fish:"A wade fishery for most of its length (kayak/packraft water up high in runoff). Attractor dries all summer. The lower few miles near Alpine hold the biggest fish.",
  coords:[[42.8800,-110.7000],[42.9100,-110.7320],[42.9400,-110.7640],[42.9700,-110.7960],[43.0000,-110.8280],[43.0300,-110.8600],[43.0600,-110.8920],[43.0840,-110.9240],[43.1020,-110.9540],[43.1200,-110.9840],[43.1340,-111.0000],[43.1430,-111.0080],[43.1540,-111.0140],[43.1650,-111.0200]]
},

/* ================= EASTERN IDAHO ================= */
{
  id:"henrysfork", name:"Henry's Fork", color:"#1d7a46",
  state:"ID", gauges:["hfIslandPark","hfAshton","hfStAnthony"], primaryGauge:"hfIslandPark",
  goodFlow:{min:800,max:1300}, // starting point from public guide reports (ideal window for Island Park Dam release) — adjust to your own experience
  blurb:"Arguably the most famous dry-fly river in America. Spring-creek flats at Harriman Ranch, the Box Canyon tailwater below Island Park Dam, big freestone water below Mesa Falls, and a rich lower river through Ashton and St. Anthony.",
  fish:"Green drakes at Harriman in late June are a pilgrimage. Box Canyon fishes big nymphs all season. Lower river (Warm River to Ashton, Ora to Chester) is superb dry-dropper float water.",
  coords:[[44.4990,-111.2630],[44.4400,-111.3400],[44.4150,-111.3950],[44.3600,-111.4450],[44.3300,-111.4600],[44.2500,-111.4000],[44.1800,-111.3300],[44.1200,-111.3150],[44.0700,-111.4500],[44.0400,-111.5300],[43.9660,-111.6840],[43.8700,-111.7700],[43.8300,-111.7900],[43.7900,-111.8800]]
},
{
  id:"fallriver", name:"Fall River", color:"#946000",
  state:"ID", gauges:["fallRiver"], primaryGauge:"fallRiver",
  goodFlow:{min:500,max:1400}, // starting point from public guide reports (fishable below the ~1,800cfs visibility threshold) — adjust to your own experience
  blurb:"A fast, cold freestone pouring off Yellowstone's Pitchstone Plateau to join the Henry's Fork near Ashton. Bouldery pocket water with wild rainbows and almost no pressure.",
  fish:"Wade fishing with attractor dries once runoff drops (July). Floating is limited and hazardous — diversions and ledges. Treat as a wade fishery.",
  coords:[[44.1300,-111.0500],[44.1000,-111.1300],[44.0680,-111.2200],[44.0500,-111.3200],[44.0450,-111.4200],[44.0550,-111.5000]]
},
{
  id:"snakeid", name:"Snake River — Southern Idaho", color:"#406a8c",
  state:"ID", gauges:["snakeBlackfoot","snakeKingHill","snakeWeiser"], primaryGauge:"snakeKingHill",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The big river itself, from Idaho Falls through the irrigated plain, the Hagerman/Thousand Springs reach, and on to Weiser. Heavily managed water with bright spots: trophy browns near Massacre Rocks, the spring-fed Hagerman stretch, and sturgeon below CJ Strike.",
  fish:"This is boat water — jet sleds and drift boats. Flows swing hard with irrigation season; the King Hill and Weiser gauges tell the story. Check ID F&G rules; they change reach by reach.",
  coords:[[43.4900,-112.0400],[43.3100,-112.2700],[43.0300,-112.5500],[42.7800,-112.8700],[42.6700,-112.9900],[42.6000,-113.4000],[42.5400,-113.7900],[42.5200,-114.0100],[42.6000,-114.4500],[42.8100,-114.9000],[42.9500,-115.0500],[42.9970,-115.2040],[42.9500,-115.6000],[42.9500,-115.9700],[43.2400,-116.3800],[43.5500,-116.8100],[43.8000,-117.0200],[44.0000,-116.9500],[44.2460,-116.9790]]
},
{
  id:"hellscanyon", name:"Snake River — Hells Canyon", color:"#8c2f1d",
  state:"ID", gauges:["snakeHellsDam"], primaryGauge:"snakeHellsDam",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"North America's deepest river gorge. Below Hells Canyon Dam the Snake is huge, green, and wild — Class III–IV rapids (Wild Sheep, Granite), smallmouth on every rock, and white sturgeon older than your grandfather.",
  fish:"Smallmouth fishing is absurd June–September; sturgeon is strictly catch-and-release. Floating requires a permit in the regulated-use season — most people go with an outfitter or jet boat.",
  coords:[[45.2420,-116.6960],[45.3500,-116.6200],[45.4500,-116.5500],[45.6300,-116.4700],[45.7500,-116.5300],[45.8600,-116.7900],[46.1000,-116.9500],[46.4200,-117.0300]]
},
{
  id:"blackfootid", name:"Blackfoot River (Idaho)", color:"#5b3a7d",
  state:"ID", gauges:["blackfootId"], primaryGauge:"blackfootId",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A high-desert cutthroat stream meandering through ranch country above Blackfoot Reservoir, with a rugged lava canyon below. One of Idaho's best native Yellowstone cutthroat fisheries.",
  fish:"Special regs protect spawning cutthroat — check season dates (typically opens July 1 above the reservoir). Hoppers and attractors; mostly wade fishing.",
  coords:[[42.8500,-111.4500],[42.9000,-111.5500],[42.9300,-111.6300],[43.0000,-111.8000],[43.0500,-112.0000],[43.1200,-112.2000],[43.1900,-112.3400]]
},
{
  id:"portneuf", name:"Portneuf River", color:"#3a6e8c",
  state:"ID", gauges:["portneuf"], primaryGauge:"portneuf",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"An overlooked brown trout stream sliding through ranchland and the lava narrows around Lava Hot Springs before reaching Pocatello. Tubing crowds in town; surprisingly good fishing above and below.",
  fish:"Browns to 20\"+ in the meadow water above Lava Hot Springs. Streamers in fall. Mostly wade access via ID F&G easements.",
  coords:[[42.5500,-111.9000],[42.6200,-112.0100],[42.6700,-112.1500],[42.7700,-112.3000],[42.8710,-112.4660]]
},
{
  id:"bear", name:"Bear River (WY/ID)", color:"#6e8c3a",
  state:"WY", gauges:["bearBorder"], primaryGauge:"bearBorder",
  goodFlow:{min:375,max:1150}, // starting point from public guide reports (optimal flow range, Bear River at Border) — adjust to your own experience
  blurb:"The longest river in North America that never reaches the sea, looping from the Uintas through Evanston, Cokeville, and Idaho's Bear Lake country on its way to the Great Salt Lake. Sleepy canoe water with chunky cutthroat and browns.",
  fish:"The Bonneville cutthroat restoration reaches near Cokeville and below Soda Springs fish well early and late. Heavy irrigation draw mid-summer — watch the Border gauge.",
  coords:[[41.2600,-110.9600],[41.5500,-110.9800],[41.8000,-110.9500],[42.0800,-110.9600],[42.2100,-111.0500],[42.3200,-111.3000],[42.5000,-111.4500],[42.6500,-111.6000],[42.5800,-111.7300],[42.3500,-111.8000],[42.1000,-111.8700]]
},

/* ================= SOUTH-CENTRAL & SOUTHWEST IDAHO ================= */
{
  id:"bigwood", name:"Big Wood River", color:"#a85e2a",
  state:"ID", gauges:["bigWood"], primaryGauge:"bigWood",
  goodFlow:{min:150,max:500}, // starting point from public guide reports (ideal flow for the Hailey section) — adjust to your own experience
  blurb:"Sun Valley's home water — a classic cottonwood-lined freestone running from Galena Summit through Ketchum, Hailey, and Bellevue. Rainbows that see flies all year and still eat dries.",
  fish:"Baetis and midges in winter (it's open year-round), green drakes in June, hoppers by August. A wade fishery throughout; access is excellent via public easements.",
  coords:[[43.8700,-114.6600],[43.7800,-114.5100],[43.6810,-114.3640],[43.6000,-114.3300],[43.5190,-114.3190],[43.4630,-114.2610],[43.3800,-114.3200],[43.3200,-114.3900]]
},
{
  id:"silvercreek", name:"Silver Creek", color:"#3a8c7d",
  state:"ID", gauges:["silverCreek"], primaryGauge:"silverCreek",
  goodFlow:{min:70,max:150}, // starting point from public guide reports (typical clear, wadeable spring-creek flow) — adjust to your own experience
  blurb:"The most famous spring creek in the West. Gin-clear, weed-waving flats at the Nature Conservancy's Silver Creek Preserve near Picabo, stuffed with large, deeply suspicious rainbows and browns.",
  fish:"Brown drakes in early June (a circus, in a good way), tricos at dawn all summer, the legendary harvest-moon mouse bite. Float tubes only on parts of the Preserve; no real boating.",
  coords:[[43.3500,-114.1500],[43.3300,-114.1100],[43.3170,-114.0900],[43.3100,-114.0400],[43.3150,-113.9700],[43.3000,-113.9000]]
},
{
  id:"biglost", name:"Big Lost River", color:"#8c5e3a",
  state:"ID", gauges:["bigLost"], primaryGauge:"bigLost",
  goodFlow:{min:100,max:300}, // starting point from public guide reports (comfortable wading below Mackay Dam) — adjust to your own experience
  blurb:"A tailwater oddity below Mackay Reservoir that literally disappears into the desert downstream. Wild rainbows in the canyon reach, framed by Idaho's tallest peaks.",
  fish:"Cranefly larvae and pale morning duns; technical when low. Flows swing with irrigation demand — the gauge matters more here than almost anywhere.",
  coords:[[44.0500,-113.8500],[43.9700,-113.7200],[43.9100,-113.6100],[43.8200,-113.5300],[43.7200,-113.4200],[43.6500,-113.3100]]
},
{
  id:"bruneau", name:"Bruneau River", color:"#7d3a5b",
  state:"ID", gauges:["bruneau"], primaryGauge:"bruneau",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A remote desert canyon river slicing 800-foot rhyolite gorges through the Owyhee high desert. A short, snowmelt-dependent whitewater season and redband trout in a genuinely wild setting.",
  fish:"Expedition water — Class III–IV self-support boating during spring runoff only; the window can be two weeks. Redbands and smallmouth for those who hike in. Not a casual destination.",
  coords:[[42.0500,-115.6200],[42.3500,-115.7000],[42.6000,-115.7300],[42.7700,-115.7200],[42.9500,-115.8000]]
},
{
  id:"boise", name:"Boise River", color:"#2a8ca0",
  state:"ID", gauges:["boiseTwinSpr","boiseGlenwood"], primaryGauge:"boiseGlenwood",
  goodFlow:{min:300,max:600}, // starting point from public guide reports (sweet spot at the Glenwood gauge) — adjust to your own experience
  blurb:"From wilderness water above Arrowrock to one of America's best urban trout floats through downtown Boise. The Middle Fork canyon above Twin Springs is a gem; the town reach holds wild trout under the tubers.",
  fish:"Town stretch fishes caddis on summer evenings and BWOs in fall; flows are dam-set, so check Glenwood before wading. Above Lucky Peak, the canyon water is classic pocket fishing.",
  coords:[[43.6600,-115.7270],[43.5900,-115.9200],[43.5300,-116.0600],[43.5600,-116.1300],[43.6100,-116.2200],[43.6600,-116.2800],[43.6900,-116.3500],[43.7300,-116.5500],[43.7600,-116.7500],[43.7800,-116.9700]]
},
{
  id:"sfboise", name:"South Fork Boise", color:"#1d6e5b",
  state:"ID", gauges:["sfBoise"], primaryGauge:"sfBoise",
  goodFlow:{min:1400,max:1800}, // starting point from public guide reports (prime tailwater flows below Anderson Ranch Dam) — adjust to your own experience
  blurb:"Idaho's other great tailwater: a canyon-bound rainbow fishery below Anderson Ranch Dam. Big-shouldered wild rainbows, a famous pink-albert hatch, and flows that double overnight when irrigation calls.",
  fish:"Fishes at almost any release, but wading is only sane below ~600 CFS — above that, float it. Watch the gauge: releases jump from 300 to 1,600+ CFS in spring.",
  coords:[[43.3430,-115.4770],[43.3300,-115.5700],[43.3150,-115.6600],[43.3500,-115.7700],[43.4300,-115.8700],[43.5400,-115.9300]]
},
{
  id:"payette", name:"Payette River (SF & Main)", color:"#a03a2a",
  state:"ID", gauges:["sfPayette","payette"], primaryGauge:"payette",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Idaho's whitewater playground. The South Fork drops from the Sawtooths through Lowman and Garden Valley to Banks, where the main Payette rolls on to the Snake. Summer-long boating on dam-augmented flows.",
  fish:"Better known for boating than fishing, but the SF above Lowman holds good rainbows and bull trout (release them). The Banks-to-Beehive 'Main' is the state's most-run whitewater stretch.",
  coords:[[44.1500,-115.1500],[44.0850,-115.6200],[44.0600,-115.9500],[44.0800,-116.1200],[43.9100,-116.1900],[43.8700,-116.5000],[43.9500,-116.7500],[44.0800,-116.9300]]
},
{
  id:"nfpayette", name:"North Fork Payette", color:"#c2452a",
  state:"ID", gauges:["nfPayette"], primaryGauge:"nfPayette",
  goodFlow:{min:250,max:400}, // starting point from public guide reports (good level once dam releases draw down) — adjust to your own experience
  blurb:"Two rivers in one: a friendly meadow float through Cascade and McCall country up top, and below Smiths Ferry, sixteen miles of nearly continuous Class V — some of the hardest commonly-run whitewater on Earth.",
  fish:"Fish the mellow water above Smiths Ferry (rainbows, the odd big bull trout). The lower NF is expert-kayaker-only; everyone else admires it from Highway 55.",
  coords:[[44.9100,-116.1200],[44.7500,-116.0800],[44.5200,-116.0400],[44.3000,-116.0900],[44.0900,-116.1150],[44.0800,-116.1200]]
},

/* ================= CENTRAL & NORTH IDAHO ================= */
{
  id:"salmon", name:"Salmon River", color:"#b05a1d",
  state:"ID", gauges:["salmonTown","salmonWB"], primaryGauge:"salmonTown",
  goodFlow:{min:500,max:1500}, // starting point from public guide reports (normal wadeable summer/fall range) — adjust to your own experience
  blurb:"The River of No Return: 400+ free-flowing miles from the Sawtooth Valley through the Frank Church Wilderness to the Snake. Cutthroat and rainbows all summer, then the famous fall and spring steelhead runs.",
  fish:"Day stretches near Stanley, Salmon, and Riggins fish well from a boat July–October. Steelhead from October (upper river) through April (Riggins area). Check ID F&G steelhead rules — they change in-season.",
  coords:[[43.9500,-114.8400],[44.1000,-114.9000],[44.2200,-114.9300],[44.2700,-114.7300],[44.4000,-114.4500],[44.5050,-114.2300],[44.7500,-114.1000],[45.0000,-113.9500],[45.1830,-113.8950],[45.4100,-113.9900],[45.3800,-114.3000],[45.3700,-114.6800],[45.3300,-115.2000],[45.4000,-115.6000],[45.3200,-116.0000],[45.4140,-116.3140],[45.7560,-116.3230],[45.8500,-116.6000],[45.8600,-116.7900]]
},
{
  id:"mfsalmon", name:"Middle Fork of the Salmon", color:"#d97706",
  state:"ID", gauges:["mfSalmon"], primaryGauge:"mfSalmon",
  goodFlow:{min:1000,max:2500}, // starting point from public guide reports (prime fishing flows, dropping/clearing) — adjust to your own experience
  blurb:"The crown jewel: 100 roadless miles of crystal water, hot springs, and Class III–IV rapids through the largest wilderness in the lower 48. Westslope cutthroat eat dries the entire way.",
  fish:"Permit-lottery multiday float (June–September launches from Boundary Creek). Barbless single hooks, all trout released. Book an outfitter or win the lottery — there's no day-trip version.",
  coords:[[44.4500,-115.2300],[44.6000,-115.1800],[44.7700,-115.0500],[44.9800,-114.8400],[45.1000,-114.7000],[45.3000,-114.5900]]
},
{
  id:"lemhi", name:"Lemhi River", color:"#8c7d3a",
  state:"ID", gauges:["lemhi"], primaryGauge:"lemhi",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A willow-lined ranch-valley stream following Lewis and Clark's route from Leadore to the town of Salmon. Wild rainbows, cutthroat, and recovering salmon runs in classic high-valley hay country.",
  fish:"Mostly private — fish the ID F&G access sites and ask permission elsewhere. Hoppers against the willows in August. Heavily dewatered in irrigation season; check the gauge.",
  coords:[[44.6800,-113.3600],[44.8000,-113.5000],[44.9400,-113.6300],[45.0600,-113.7600],[45.1830,-113.8900]]
},
{
  id:"littlesalmon", name:"Little Salmon River", color:"#a07d2a",
  state:"ID", gauges:["littleSalmon"], primaryGauge:"littleSalmon",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A steep, pocket-water tributary tumbling alongside US-95 from New Meadows to Riggins. In spring it's a chinook-fishing circus; the rest of the year it's quiet rainbow water.",
  fish:"The salmon season (when open) packs the lower river shoulder-to-shoulder — combat fishing, but genuinely fun. Trout fishing improves with every mile upstream.",
  coords:[[44.9700,-116.2800],[45.1000,-116.3200],[45.2500,-116.3200],[45.4140,-116.3140]]
},
{
  id:"lochsa", name:"Lochsa River", color:"#2a7d8c",
  state:"ID", gauges:["lochsa"], primaryGauge:"lochsa",
  goodFlow:{min:400,max:900}, // starting point from public guide reports (low-water dry-fly window, late summer/fall) — adjust to your own experience
  blurb:"Wild & Scenic whitewater paralleling US-12 over Lolo Pass — at runoff, one of the best continuous big-water Class IV runs anywhere. After the water drops: gorgeous westslope cutthroat dry-fly fishing.",
  fish:"Catch-and-release cutthroat water, July–October, all wade fishing off the highway. Whitewater season is May–June for experienced raft crews only.",
  coords:[[46.5100,-114.6900],[46.4500,-114.9000],[46.3500,-115.1500],[46.2500,-115.3800],[46.1500,-115.5870]]
},
{
  id:"selway", name:"Selway River", color:"#3a8c5b",
  state:"ID", gauges:["selway"], primaryGauge:"selway",
  goodFlow:{min:400,max:1200}, // starting point from public guide reports (fishable low-water window, Aug-Sept) — adjust to your own experience
  blurb:"The hardest river permit in America — one launch per day through the Selway-Bitterroot Wilderness. Below Selway Falls, a road-accessible reach offers the same emerald water without the lottery.",
  fish:"Westslope cutthroat on dries, catch-and-release. The lower 20 road miles above Lowell fish beautifully July–September and are wadeable; the wilderness reach is a once-in-a-lifetime float.",
  coords:[[45.8200,-114.9500],[45.9500,-115.1500],[46.0300,-115.3500],[46.0870,-115.5140],[46.1400,-115.5900]]
},
{
  id:"clearwater", name:"Clearwater River", color:"#1d5b8c",
  state:"ID", gauges:["clearwater"], primaryGauge:"clearwater",
  goodFlow:{min:5000,max:15000}, // starting point from public guide reports (ideal steelhead flow range at Spalding) — adjust to your own experience
  blurb:"Big, broad steelhead water from Kooskia to Lewiston. Home of Idaho's famous B-run steelhead — fish that average 10+ pounds and eat swung flies in October like they mean it.",
  fish:"Steelhead October–March (check ID F&G season status — runs vary year to year). Summer smallmouth fishing is excellent and ignored. Jet-boat and two-handed-rod country.",
  coords:[[46.1400,-115.5900],[46.1400,-115.9800],[46.2300,-116.0300],[46.3500,-116.1500],[46.4800,-116.2600],[46.4480,-116.8270],[46.4200,-117.0200]]
},
{
  id:"sfclearwater", name:"South Fork Clearwater", color:"#3a5b8c",
  state:"ID", gauges:["sfClearwater"], primaryGauge:"sfClearwater",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A roadside canyon river from Elk City to Kooskia that fishes like a small freestone but hosts full-size steelhead in early spring. Cutthroat and smallmouth the rest of the year.",
  fish:"March steelhead within roll-casting distance of Highway 14. Summer cutthroat in the upper reaches. All wade fishing.",
  coords:[[45.8300,-115.4400],[45.9000,-115.6500],[45.9800,-115.8500],[46.0860,-115.9750],[46.1400,-115.9800]]
},
{
  id:"nfclearwater", name:"North Fork Clearwater", color:"#2a6e7d",
  state:"ID", gauges:["nfClearwater"], primaryGauge:"nfClearwater",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A remote gem above Dworshak Reservoir: gin-clear water, giant westslope cutthroat, and the state's healthiest bull trout population, reached by long gravel roads through the cedar country.",
  fish:"Cutthroat to 20\" on dries, July–September. Catch-and-release; bull trout must not be targeted. Camp along the river — services are nonexistent, which is the point.",
  coords:[[46.8400,-115.3000],[46.7800,-115.5500],[46.8400,-115.6200],[46.7000,-115.8500],[46.6200,-116.0000],[46.5100,-116.1500],[46.5100,-116.2500]]
},
{
  id:"stjoe", name:"St. Joe River", color:"#1d8c6e",
  state:"ID", gauges:["stJoe"], primaryGauge:"stJoe",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The shadowy St. Joe: 100+ miles of cedar-lined cutthroat water from the Bitterroot crest to Lake Coeur d'Alene. The upper river above Avery is pure catch-and-release dry-fly heaven.",
  fish:"Westslope cutthroat rise eagerly July–October. Road parallels nearly the whole river. Light floating (rafts/kayaks) in the middle reaches at moderate flows; mostly a wade fishery.",
  coords:[[47.0600,-115.3600],[47.1500,-115.6000],[47.2500,-115.8100],[47.2750,-116.1880],[47.3000,-116.4000],[47.3140,-116.5600]]
},
{
  id:"cda", name:"Coeur d'Alene River", color:"#5b8c6e",
  state:"ID", gauges:["cdaEnaville","cdaCataldo"], primaryGauge:"cdaCataldo",
  goodFlow:{min:500,max:1500}, // starting point from public guide reports (normal summer / wade-friendly range at Cataldo) — adjust to your own experience
  blurb:"North Idaho's friendly cutthroat river: the North Fork's swimming-hole pools above Enaville, then a lazy lower river winding through the chain lakes to Lake Coeur d'Alene.",
  fish:"Westslope cutthroat on dries all summer (catch-and-release on much of the NF). Lower river holds northern pike in the sloughs — bring a wire bite guard and heavy streamers.",
  coords:[[47.7500,-115.9000],[47.6400,-115.9700],[47.5700,-116.2530],[47.5550,-116.3270],[47.5300,-116.5000],[47.4700,-116.7000]]
},
{
  id:"kootenai", name:"Kootenai River", color:"#3a7d8c",
  state:"ID", gauges:["kootenai"], primaryGauge:"kootenai",
  goodFlow:{min:4000,max:7500}, // starting point from public guide reports (wade fishing opens up below ~7,500cfs) — adjust to your own experience
  blurb:"A massive, moody tailwater (Libby Dam, upstream in Montana) sweeping through Idaho's panhandle farm country at Bonners Ferry. Big rainbows, endangered white sturgeon, and serious flow swings.",
  fish:"Flows can triple on a dam schedule — never anchor or wade without checking. Rainbows eat dries along the eddy lines; the sturgeon are federally protected, no targeting.",
  coords:[[48.6200,-116.0500],[48.6910,-116.3140],[48.8000,-116.4000],[48.9900,-116.5000]]
},
{
  id:"priest", name:"Priest River", color:"#6e3a8c",
  state:"ID", gauges:["priest"], primaryGauge:"priest",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The outlet of Priest Lake, dropping through timber country to the Pend Oreille. A summer canoe river with cutthroat up top and smallmouth toward the mouth.",
  fish:"Best early summer before it warms; the Upper Priest (above the lake) is a wild cutthroat sanctuary worth the drive. Mellow Class I–II floating at moderate flows.",
  coords:[[48.4500,-116.8800],[48.3500,-116.9000],[48.2100,-116.9100],[48.1800,-116.9000]]
},

/* ================= WYOMING BEYOND JACKSON ================= */
{
  id:"nplatteupper", name:"North Platte — Upper (Saratoga)", color:"#8c1d46",
  state:"WY", gauges:["npSaratoga"], primaryGauge:"npSaratoga",
  goodFlow:{min:300,max:600}, // starting point from public guide reports (ideal wading range, Saratoga) — adjust to your own experience
  blurb:"The freestone North Platte: from the Class III Northgate Canyon on the Colorado line through the ranch meadows around Saratoga. A premier wade-and-float brown and rainbow fishery with a hot spring in town.",
  fish:"Fishes best as runoff drops (late June) — big stoneflies, then hoppers. The Treasure Island to Saratoga float is the classic. Public access via WGFD walk-in areas.",
  coords:[[41.0000,-106.3400],[41.1500,-106.4500],[41.3000,-106.6500],[41.3440,-106.7900],[41.4550,-106.8060],[41.6000,-106.8700],[41.7700,-106.9400],[41.9500,-106.9000],[42.0500,-106.8600]]
},
{
  id:"nplattereef", name:"North Platte — Grey Reef & Miracle Mile", color:"#b01d5b",
  state:"WY", gauges:["npGreyReef"], primaryGauge:"npGreyReef",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Wyoming's trout factory. The Miracle Mile (between Kortes and Pathfinder) and the Grey Reef tailwater below Alcova grow rainbows that average 16–20 inches, fishable 365 days a year.",
  fish:"Grey Reef Dam to Government Bridge is the marquee float — nymph rigs under indicators, streamers on cloudy days. April's the famous month, but fall is quieter and just as good.",
  coords:[[42.1800,-106.8700],[42.3000,-106.8600],[42.4200,-106.8400],[42.5100,-106.7600],[42.5610,-106.6420],[42.6300,-106.5500],[42.7000,-106.4500],[42.7800,-106.3800],[42.8500,-106.3200]]
},
{
  id:"wind", name:"Wind River", color:"#8c4a1d",
  state:"WY", gauges:["windCrowheart","windBoysen"], primaryGauge:"windCrowheart",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"From Dubois down through the Wind River Reservation to Boysen, then through the spectacular Wind River Canyon — Class III–IV water between 2.5-billion-year-old walls — to become the Bighorn at Wedding of the Waters.",
  fish:"Upper river near Dubois is excellent freestone water (public access patchy). Reservation water and the canyon require tribal permits. The canyon holds genuinely large trout.",
  coords:[[43.5400,-109.6300],[43.4500,-109.4500],[43.3100,-109.2000],[43.2700,-109.1300],[43.1500,-108.8500],[43.0500,-108.6000],[43.0200,-108.3800],[43.1000,-108.2500],[43.1800,-108.1800],[43.4180,-108.1750],[43.5000,-108.2100],[43.5800,-108.2100]]
},
{
  id:"bighorn", name:"Bighorn River (WY)", color:"#a8702a",
  state:"WY", gauges:["windBoysen"], primaryGauge:"windBoysen",
  goodFlow:{min:1300,max:1600}, // starting point from public guide reports (median summer tailwater flows below Boysen) — adjust to your own experience
  blurb:"Born at Wedding of the Waters (where the Wind changes name), the Wyoming Bighorn runs through Thermopolis past the world's largest mineral hot spring. A year-round tailwater-style fishery with big browns, rainbows, and cutthroat.",
  fish:"The Wedding of the Waters to Thermopolis float is short, mellow, and stuffed with fish. Crowds are a fraction of the Montana Bighorn's. Winter midge fishing is legitimately good.",
  coords:[[43.5800,-108.2100],[43.6500,-108.2100],[43.7500,-108.1800],[43.8800,-108.1000],[44.0100,-107.9600],[44.2000,-108.0000],[44.3800,-108.0400],[44.4900,-108.0600]]
},
{
  id:"nfshoshone", name:"North Fork Shoshone", color:"#7d5b1d",
  state:"WY", gauges:["nfShoshone"], primaryGauge:"nfShoshone",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The grizzly-country freestone lining the 'most scenic 50 miles in America' between Yellowstone's East Entrance and Cody. Eager cutthroat, browns near the reservoir, and almost all of it roadside public land.",
  fish:"Clears late (mid-July most years), then fishes attractor dries until October. Carry bear spray without exception. Mostly wade fishing; some float it to the reservoir at moderate flows.",
  coords:[[44.5000,-109.9600],[44.4900,-109.7500],[44.4680,-109.4300],[44.4800,-109.3000],[44.5000,-109.2000]]
},
{
  id:"shoshone", name:"Shoshone River (Cody)", color:"#946e2a",
  state:"WY", gauges:["shoshoneBB"], primaryGauge:"shoshoneBB",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Below Buffalo Bill Dam the Shoshone roars through a short whitewater canyon at Cody, then mellows into a brown-trout tailwater toward Powell — fishable all winter when the rest of the state is frozen.",
  fish:"The DeMaris-to-Corbett reach below town is the prime float (Class I–II with one rowdy canyon above it). Dam releases swing with irrigation; check before launching.",
  coords:[[44.5200,-109.0600],[44.5260,-109.0100],[44.5500,-108.9000],[44.6500,-108.7500],[44.7900,-108.6500],[44.8400,-108.4500],[44.8400,-108.3100]]
},
{
  id:"clarksfork", name:"Clarks Fork of the Yellowstone", color:"#5b1d8c",
  state:"WY", gauges:["clarksFork"], primaryGauge:"clarksFork",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Wyoming's only designated Wild & Scenic river, falling off the Beartooth Plateau through 'The Box' — a 1,200-foot granite gorge with Class V+ water — before gentling into Montana ranchland.",
  fish:"Fish the upper meadows along the Chief Joseph Highway (cutthroat, brookies) or the lower river near Clark for browns. The Box is for elite kayakers and photographers only.",
  coords:[[44.8700,-109.6200],[44.9200,-109.4500],[44.9300,-109.2500],[44.9000,-109.1500],[45.0000,-109.0800],[45.0300,-109.0600]]
},
{
  id:"tonguewy", name:"Tongue River", color:"#1d8c5b",
  state:"WY", gauges:["tongue"], primaryGauge:"tongue",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Bighorn Mountains jewel: trout water in the canyon above Dayton (rainbows, browns, brook trout) before the river slides into the Montana prairie. The canyon hike-in water is special.",
  fish:"Tongue River Canyon (a short hike from the trailhead) fishes dries all summer in a limestone gorge. Lower meadows are private — ask first or stay in the canyon.",
  coords:[[44.7800,-107.5500],[44.8300,-107.4000],[44.8700,-107.2600],[44.9100,-107.1600],[44.9800,-107.0500]]
},
{
  id:"green", name:"Green River (WY)", color:"#1d7a8c",
  state:"WY", gauges:["greenWarren","greenFont","greenGR"], primaryGauge:"greenWarren",
  goodFlow:{min:700,max:1400}, // starting point from public guide reports (wade/float sweet spot at Warren Bridge) — adjust to your own experience
  blurb:"The upper Green: born under the Wind River Range at Green River Lakes, drifting through sagebrush ranch country past Warren Bridge and Daniel, then a tailwater reborn below Fontenelle Dam.",
  fish:"The Warren Bridge to Daniel floats are quintessential Wyoming — browns and rainbows on hoppers with the Winds on the horizon. Below Fontenelle is an underrated big-fish tailwater.",
  coords:[[43.3100,-109.8600],[43.2000,-109.9800],[43.1000,-110.0800],[43.0190,-110.1180],[42.8700,-110.0700],[42.7000,-110.1100],[42.5500,-110.1100],[42.2600,-110.2000],[42.0900,-110.1200],[42.0250,-110.0650],[41.8500,-109.9000],[41.6500,-109.6500],[41.5160,-109.4480]]
},
{
  id:"newfork", name:"New Fork River", color:"#2a5b8c",
  state:"WY", gauges:["newFork"], primaryGauge:"newFork",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The Green's big tributary, gathering at New Fork Lakes and winding past Pinedale through willowed ranch bottoms. Locally famous for large browns and the autumn streamer bite.",
  fish:"A genuine drift-boat fishery — local shops in Pinedale run floats through mostly private land (river itself is public). Hopper season and October streamers are the draws.",
  coords:[[43.0900,-109.9500],[42.9500,-109.8800],[42.8500,-109.8600],[42.7300,-109.9200],[42.6200,-110.0000],[42.5300,-110.0700],[42.4900,-110.0900]]
},
{
  id:"encampmentwy", name:"Encampment River", color:"#8c3a2a",
  state:"WY", gauges:["encampment"], primaryGauge:"encampment",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A wilderness-canyon tributary of the upper North Platte, tumbling out of the Sierra Madre past the old copper town of Encampment. Solitude, brook trout, browns, and rattlesnake-country hiking.",
  fish:"Hike the Encampment River Trail upstream from the campground — every mile of trail subtracts an angler. Attractor dries; nothing fancy required.",
  coords:[[41.0200,-106.8200],[41.0800,-106.8300],[41.1500,-106.8200],[41.2100,-106.7900],[41.3000,-106.7800]]
},
{
  id:"laramiewy", name:"Laramie River", color:"#5b8c2a",
  state:"WY", gauges:["laramie"], primaryGauge:"laramie",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"From the Colorado high country through the Laramie Plains — a meandering brown trout river with surprising fish in the public reaches near Woods Landing and through town.",
  fish:"The Monolith Ranch and Optimist Park access near Laramie city fish better than they have any right to. Hoppers in late summer; streamers in fall. Mostly wade fishing.",
  coords:[[41.0000,-105.9500],[41.1000,-106.0100],[41.2000,-105.8500],[41.3100,-105.5900],[41.5000,-105.4500],[41.7500,-105.2000],[42.0500,-104.9500]]
},
/* ================= CENTRAL IOWA WATER TRAILS (Des Moines area) ================= */
{
  id:"desmoines", name:"Des Moines River — Central Iowa", color:"#6b4a2a",
  state:"IA", gauges:["dmSaylorville","dmDesMoines","dmBelowRaccoon"], primaryGauge:"dmDesMoines",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Iowa's namesake river through the capital — big, brown, and slow-moving from below Saylorville Dam through downtown Des Moines toward Red Rock country. The state-designated Polk County water trail segment runs about 20 miles from Saylorville's Cottonwood Recreation Area down to Yellow Banks County Park, threading the Principal Riverwalk whitewater feature through downtown.",
  fish:"Channel and flathead catfish, walleye and saugeye running up from Saylorville and Red Rock, white bass in the spring run, plus carp and drum. Watch for low-head dams downtown — check current conditions before running any stretch you haven't floated before.",
  coords:[[41.7300,-93.6550],[41.6980,-93.6450],[41.6300,-93.6300],[41.6119,-93.6197],[41.5800,-93.6350],[41.5300,-93.5700],[41.4800,-93.4900]]
},
{
  id:"raccoon", name:"Raccoon River", color:"#a67c3d",
  state:"IA", gauges:["raccoonWDM","raccoonVanMeter"], primaryGauge:"raccoonWDM",
  goodFlow:{min:300,max:900}, // starting point from paddler reports ("nice water flow" cited around 400cfs; gets fast/wavy above ~1,300) — adjust to your own experience
  blurb:"The classic Des Moines paddle: a wide, slow prairie river from the North/South/Middle Raccoon confluence near Van Meter into downtown Des Moines, joining the Des Moines River at the Principal Riverwalk. Walnut Woods to Water Works Park is the standard half-day float.",
  fish:"Smallmouth bass in the rockier upstream riffles, channel catfish and walleye through the flatwater stretches, white bass in spring. The lower miles through Water Works Park are heavily bank-fished.",
  coords:[[41.5340,-93.9498],[41.5500,-93.8600],[41.5650,-93.7450],[41.5730,-93.6900],[41.5760,-93.6500],[41.5800,-93.6350]]
},
{
  id:"nraccoon", name:"North Raccoon River", color:"#7a5a3a",
  state:"IA", gauges:["nRaccoonSacCity","nRaccoonJefferson"], primaryGauge:"nRaccoonJefferson",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"At roughly 150 navigable miles, the longest water trail in Iowa — from Sac County farm country down through Jefferson, Dawson, Perry, and Adel before joining the Middle and South Raccoon near Van Meter. The Dallas County reaches near Dawson and Booneville are the closest stretch to Des Moines.",
  fish:"Smallmouth bass and channel catfish in the riffles near Jefferson and Perry, carp and flathead catfish in the deeper bends downstream — a quieter, more rural alternative to the mainstem Raccoon closer to town.",
  coords:[[42.4230,-95.0100],[42.2500,-94.7000],[42.0136,-94.3778],[41.8800,-94.2200],[41.6100,-94.0000],[41.5500,-93.9600],[41.5340,-93.9498]]
},
{
  id:"mraccoon", name:"Middle Raccoon River", color:"#9c7a4a",
  state:"IA", gauges:["mRaccoonPanora"], primaryGauge:"mRaccoonPanora",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A smaller, quicker Raccoon tributary out of Lake Panora, joining the South Raccoon a few miles below Panora before the combined river continues toward Van Meter as \"the Raccoon.\"",
  fish:"Smallmouth bass and rock bass in the riffles below the Panora dam; channel catfish downstream.",
  coords:[[41.6942,-94.3700],[41.6500,-94.2900],[41.6100,-94.2200]]
},
{
  id:"sraccoon", name:"South Raccoon River", color:"#6a8a4a",
  state:"IA", gauges:["sRaccoonRedfield"], primaryGauge:"sRaccoonRedfield",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The smallest of the three upper Raccoon forks, running from Guthrie County past Nations Bridge Park before joining the Middle Raccoon near Redfield.",
  fish:"Small-stream smallmouth bass and channel catfish; lightly fished compared to the mainstem.",
  coords:[[41.6800,-94.5000],[41.6400,-94.3800],[41.6100,-94.2200]]
},
{
  id:"sskunk", name:"South Skunk River", color:"#4a6a8a",
  state:"IA", gauges:["sSkunkAboveAmes","sSkunkAmes"], primaryGauge:"sSkunkAmes",
  goodFlow:{min:125,max:400}, // starting point from Skunk River Paddlers guidance (min ~125cfs, median ~209cfs is "really nice") — adjust to your own experience
  blurb:"Story County's water trail — 33 miles with 11 access points running from Story City through Ames. A \"non-meandered\" stream under Iowa law: the state owns the water, not always the banks.",
  fish:"Smallmouth bass and channel catfish in the riffle-pool sequences through Ames; carp and drum in the slower reaches. Popular with Iowa State students for after-class floats.",
  coords:[[42.1700,-93.5900],[42.0900,-93.6000],[42.0450,-93.6100],[41.9900,-93.6280],[41.9200,-93.5900]]
},
{
  id:"beavercreek", name:"Beaver Creek", color:"#8a5a6a",
  state:"IA", gauges:["beaverCreekJohnston"], primaryGauge:"beaverCreekJohnston",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Iowa's newest state water trail (designated May 2025) — 7 miles of small, winding creek through Johnston and Grimes before joining the Des Moines River near Saylorville. Kayak access at Lew Clarkson Park in Johnston.",
  fish:"A small-water creek fishery — panfish, channel catfish, and the occasional smallmouth. Better known as a quick urban paddle than a fishing destination.",
  coords:[[41.7100,-93.7900],[41.6950,-93.7600],[41.6850,-93.7450],[41.6900,-93.7100],[41.7000,-93.6700]]
},

/* ================= DRIFTLESS AREA — NORTHEAST IOWA =================
   Spring-fed limestone coulee country: cold, clear, hard-water streams
   with wild brown trout, stocked rainbows, and reintroduced brook trout.
   Nearly all of it is WALK-AND-WADE — these creeks are far too small and
   brushy to float. The Iowa DNR maintains signed parking at most public
   accesses, and much of the best water is on Public Fishing Easements
   across private land: you may fish and walk the stream corridor, but
   don't leave it. A trout fee stamp is required in addition to a license.
   Streams with no USGS gauge carry gauges:[] — the app shows a "no gauge"
   card rather than borrowing a number from a different watershed. */
{
  id:"upperiowa", name:"Upper Iowa River", color:"#2f7d5b",
  state:"IA", region:"driftless", gauges:["uiBluffton","uiDecorah","uiDorchester"], primaryGauge:"uiDecorah",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The backbone of Iowa's Driftless: a bluff-lined river running from Lime Springs past Bluffton and Decorah out to the Mississippi at New Albin. Trout water up high where the springs come in, smallmouth water as it warms downstream — and the only stream here that's genuinely floatable, with limestone palisades most people don't expect in Iowa.",
  fish:"The cold upper reaches near Bluffton and Kendallville hold trout; from Decorah down it becomes an excellent smallmouth river. Canoe-and-fish the Bluffton-to-Decorah stretch. Trout fishing is better in the spring-fed tributaries (Trout Run, Coldwater, Canoe, Bear) than in the mainstem itself.",
  coords:[[43.4500,-92.2800],[43.4300,-92.0500],[43.4069,-91.8990],[43.3500,-91.8400],[43.3049,-91.7955],[43.3300,-91.6800],[43.4211,-91.5088],[43.4800,-91.3200],[43.5030,-91.2700]]
},
{
  id:"waterloocreek", name:"Waterloo Creek", color:"#1d7a6e",
  state:"IA", region:"driftless", gauges:["waterlooCr"], primaryGauge:"waterlooCr",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A cold, fast limestone creek dropping out of Minnesota into Allamakee County at Dorchester — one of the very few small Iowa trout streams with its own live USGS discharge gauge, which makes it the best single read on how wet the northeast corner is right now.",
  fish:"Wild brown trout with stocked rainbows layered in. Tight quarters and heavy bank cover — short rod, roll casts, and a willingness to crawl. Fishes well after the water drops and clears post-rain.",
  coords:[[43.4900,-91.5500],[43.4700,-91.5250],[43.4511,-91.5051],[43.4300,-91.5050]]
},
{
  id:"troutrunia", name:"Trout Run Creek — Decorah", color:"#3a8c4a",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Decorah's home water, running past the Decorah Fish Hatchery to the Upper Iowa on the edge of town. Heavily stocked, very accessible, and paralleled by the Trout Run Trail bike path — the easiest place in Iowa to get a fly in trout water without a long drive or a long walk.",
  fish:"Stocked rainbows and browns plus holdovers; expect company on weekends and stocking days. Good for a first Driftless outing or an after-work hour. The hatchery stretch is pure put-and-take; walk away from the parking lots for better fish.",
  coords:[[43.2500,-91.7300],[43.2700,-91.7450],[43.2870,-91.7550],[43.2990,-91.7800]]
},
{
  id:"coldwaterIA", name:"Coldwater Creek", color:"#2a6e8c",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Winneshiek County spring creek fed by the Coldwater Cave system — one of the coldest, most stable flows in the state, which is why it holds trout through summers that shut other streams down.",
  fish:"Wild browns in the upper spring reaches, stocked fish lower. Cold and clear enough that the fish see you first — approach low and fish upstream. A strong hot-weather fallback when the rest of the region gets warm.",
  coords:[[43.4450,-91.8900],[43.4300,-91.8850],[43.4150,-91.8900],[43.4069,-91.8990]]
},
{
  id:"southbear", name:"South Bear Creek", color:"#6e8c2a",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The Highlandville classic — a small, beautiful coulee creek in northern Winneshiek County with a long history of habitat work and one of Iowa's better wild brown trout populations.",
  fish:"Wild browns that are genuinely wild-fish spooky. Terrestrials in late summer, small nymphs the rest of the year. Special regulations apply on parts of this stream — read the current Iowa DNR trout regs before you fish it.",
  coords:[[43.4400,-91.7600],[43.4250,-91.7400],[43.4122,-91.7290],[43.3950,-91.7100]]
},
{
  id:"northbear", name:"North Bear Creek", color:"#8c8c2a",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"South Bear's quieter twin, joining it near Highlandville. Smaller, brushier, and less trafficked — the kind of creek where you fish a quarter-mile in three hours and don't mind.",
  fish:"Wild brown trout in tight water. Bring a short rod and expect to lose flies in the canopy. Best in spring before the bankside growth closes in, and again in October.",
  coords:[[43.4650,-91.7800],[43.4500,-91.7550],[43.4350,-91.7350],[43.4122,-91.7290]]
},
{
  id:"canoecreek", name:"Canoe Creek", color:"#5b8c6e",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Winneshiek County tributary of the Upper Iowa northeast of Decorah, running through steep pasture and timber. Close to town, far less pressured than Trout Run.",
  fish:"Stocked and holdover trout with wild fish in the spring-fed upper reaches. Small water — a 7½-foot rod and a box of attractors covers it.",
  coords:[[43.4100,-91.7400],[43.3950,-91.7200],[43.3800,-91.7000],[43.3600,-91.6700]]
},
{
  id:"frenchcreek", name:"French Creek", color:"#1d8c7d",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Allamakee County's wild-trout showpiece, protected in the French Creek Wildlife Area northwest of Lansing. Managed for a self-sustaining wild brown trout population rather than a stocking truck — and it shows.",
  fish:"Wild browns, no stocking. Special catch-and-release / artificial-only regulations have historically applied here — check the current Iowa DNR trout regulations before fishing. Stealth matters more than fly choice.",
  coords:[[43.4650,-91.4200],[43.4500,-91.3900],[43.4400,-91.3600],[43.4300,-91.3300]]
},
{
  id:"paintcreek", name:"Paint Creek", color:"#8c5b2a",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The trout stream running through Yellow River State Forest between Waterville and Harpers Ferry — big timber, steep ridges, campgrounds, and miles of public bank. The most 'away from it all' feeling trout water in Iowa.",
  fish:"Stocked rainbows and browns with wild fish in the colder upper reaches. Combine it with a camp night in the state forest; the walk-in stretches away from the road crossings fish best.",
  coords:[[43.2550,-91.3600],[43.2300,-91.3100],[43.2172,-91.2905],[43.1950,-91.2200],[43.1800,-91.1700]]
},
{
  id:"villagecreek", name:"Village Creek", color:"#6e5b8c",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A short, cold Allamakee County creek dropping to the Mississippi near Lansing through some of the steepest country in Iowa.",
  fish:"Stocked trout with wild browns mixed in. Small water, big bluffs — an easy half-day paired with French or Clear Creek nearby.",
  coords:[[43.3900,-91.3800],[43.3750,-91.3300],[43.3600,-91.2800],[43.3450,-91.2200]]
},
{
  id:"clearcreekia", name:"Clear Creek — Allamakee", color:"#3a6e5b",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A spring-fed Allamakee County creek in the bluffs behind Lansing — named for exactly the reason you'd guess, and technical because of it.",
  fish:"Clear, cold, and unforgiving of a heavy approach. Wild browns plus stockers. Best on overcast days or in the low light at either end of the day.",
  coords:[[43.3200,-91.3600],[43.3100,-91.3200],[43.3000,-91.2800],[43.2900,-91.2400]]
},
{
  id:"yellowriver", name:"Yellow River", color:"#a07d2a",
  state:"IA", region:"driftless", gauges:["yellowIon"], primaryGauge:"yellowIon",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs from the Castalia/Volney farm country down through deep timber to the Mississippi at Effigy Mounds. The upper reaches and coldwater tributaries hold trout; the lower river is smallmouth water through a genuinely wild-feeling valley.",
  fish:"Trout in the spring-fed upper sections and side creeks; smallmouth bass below. The Ion gauge is a good general read on how much water the Allamakee/Clayton County trout creeks are carrying.",
  coords:[[43.1800,-91.6500],[43.1500,-91.5000],[43.1300,-91.3800],[43.1119,-91.2651],[43.0957,-91.2202]]
},
{
  id:"bloodyrun", name:"Bloody Run Creek", color:"#8c2a3a",
  state:"IA", region:"driftless", gauges:["bloodyRun"], primaryGauge:"bloodyRun",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"An Outstanding Iowa Water running through Bloody Run County Park near Marquette — cold, spring-fed, and one of the most celebrated (and most fought-over) trout streams in the state. It carries its own live USGS discharge gauge, which for a creek this size is rare and very useful.",
  fish:"Wild browns plus stocked fish, in water cold enough to fish through the hottest part of summer. County park access with parking right on the creek; walk upstream from the campground for the better fish.",
  coords:[[43.0900,-91.2900],[43.0700,-91.2500],[43.0408,-91.2065],[43.0350,-91.1900]]
},
{
  id:"snymagill", name:"Sny Magill Creek", color:"#2a8c6e",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Clayton County spring creek running to the Mississippi below McGregor, past the Sny Magill Mound Group. Consistently cold, heavily worked on for habitat, and a long-standing favorite of Iowa trout anglers.",
  fish:"Wild brown trout with stocking support. A good hot-weather stream — the springs keep it fishable when other creeks go warm and lethargic.",
  coords:[[42.9500,-91.2100],[42.9350,-91.1800],[42.9200,-91.1400],[42.9100,-91.1200]]
},
{
  id:"turkeyriver", name:"Turkey River", color:"#8c6e3a",
  state:"IA", region:"driftless", gauges:["turkeySpillville","turkeyEldorado","turkeyElkader"], primaryGauge:"turkeyEldorado",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The big river of the Iowa Driftless, running from Cresco and Spillville through Eldorado and Elkader to the Mississippi at Garber. Too warm for trout on the mainstem, but it drains the whole trout-country plateau — and it's a first-rate smallmouth float in its own right.",
  fish:"Smallmouth bass, walleye, and catfish on the mainstem; the trout are in the spring-fed tributaries feeding it. Use the three gauges as a wetness gradient across Winneshiek, Fayette, and Clayton counties.",
  coords:[[43.3400,-92.1200],[43.2073,-91.9503],[43.1200,-91.8800],[43.0542,-91.8091],[42.9500,-91.6000],[42.8435,-91.4013],[42.7400,-91.2618]]
},
{
  id:"volgariver", name:"Volga River", color:"#5b6e8c",
  state:"IA", region:"driftless", gauges:["volgaLittleport"], primaryGauge:"volgaLittleport",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Fayette and Clayton County river running past the Volga River State Recreation Area to join the Turkey at Littleport. Coldwater tributaries feed trout into the upper valley; the mainstem is smallmouth water.",
  fish:"Smallmouth on the river itself, trout in the feeder creeks (Grannis, Otter, and the spring branches). The state recreation area has good public bank and camping.",
  coords:[[42.8800,-91.9500],[42.8397,-91.8000],[42.8000,-91.5500],[42.7900,-91.4500],[42.7539,-91.3690]]
},
{
  id:"springbranchia", name:"Spring Branch Creek — Big Spring", color:"#2a8c8c",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The creek below Big Spring near Elkader, home of the Big Spring Fish Hatchery — one of the most reliably cold, steady flows in northeast Iowa because it comes straight out of the limestone.",
  fish:"Stocked trout in quantity near the hatchery, with better fish the further you walk. Very stable flows make this a dependable pick when rain has blown out the freestone-ier creeks.",
  coords:[[42.8700,-91.5100],[42.8550,-91.4700],[42.8450,-91.4300],[42.8435,-91.4013]]
},
{
  id:"grannis", name:"Grannis Creek", color:"#6e8c5b",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A small Fayette County trout creek near West Union, in the gentler western edge of the Driftless where the bluffs give way to rolling farm ground.",
  fish:"Stocked trout with some holdover browns. Short season of prime water — it fishes best in spring and fall when flows are up and temperatures are down.",
  coords:[[42.9900,-91.8600],[42.9750,-91.8350],[42.9611,-91.8118],[42.9450,-91.7900]]
},
{
  id:"ottercreekia", name:"Otter Creek — Fayette County", color:"#8c7d5b",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Fayette County trout stream near Elgin, feeding the Turkey River — quiet, rural water that rarely sees a crowd.",
  fish:"Stocked rainbows and browns. Pair it with Grannis Creek and the Volga for a day of small-water hopping through Fayette County.",
  coords:[[42.9900,-91.7000],[42.9750,-91.6700],[42.9575,-91.6379],[42.9400,-91.6100]]
},
{
  id:"richmondsprings", name:"Richmond Springs — Backbone", color:"#4a7d8c",
  state:"IA", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The spring-fed trout stretch inside Backbone State Park — Iowa's oldest state park — where Richmond Springs feeds cold water into the Maquoketa River in Delaware County. The southern anchor of Iowa trout country.",
  fish:"Stocked trout in a park setting with excellent, easy access and facilities. Family-friendly rather than technical; the Maquoketa below the springs warms quickly downstream.",
  coords:[[42.6500,-91.6100],[42.6350,-91.5900],[42.6203,-91.5697],[42.6000,-91.5500]]
},

/* ================= DRIFTLESS AREA — SOUTHEAST MINNESOTA =================
   The Root River system plus the Whitewater — over 700 miles of trout
   stream across Fillmore, Houston, Winona, Olmsted and Goodhue counties.
   Access is exceptionally good: Minnesota holds angling easements on
   hundreds of miles of private streambank, marked with brown-and-white
   signs and served by gravel pull-offs. Most of these creeks have no
   USGS discharge gauge — the Root mainstem gauges are the regional read. */
{
  id:"rootriver", name:"Root River", color:"#1d6e8c",
  state:"MN", region:"driftless", gauges:["rootPilotMound","rootHouston"], primaryGauge:"rootPilotMound",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The main stem of Minnesota's Driftless: formed where the North and Middle branches meet above Lanesboro, then running through Whalan, Rushford and Houston to the Mississippi. Bigger, warmer water than the branches — trout up high, smallmouth down low — with the Root River State Trail following it the whole way.",
  fish:"Trout in the upper mainstem and everywhere the cold tributaries come in; smallmouth from Rushford down. This is the one stretch of the Minnesota Driftless you can reasonably float in a canoe. Use the Pilot Mound gauge as the regional wetness read for all the Fillmore County creeks.",
  coords:[[43.7828,-92.0316],[43.7400,-91.9600],[43.7325,-91.9260],[43.7600,-91.8500],[43.8083,-91.7524],[43.7900,-91.6600],[43.7686,-91.5699],[43.7200,-91.4200],[43.6800,-91.3500]]
},
{
  id:"sbranchroot", name:"South Branch Root River", color:"#2a7d9c",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The marquee branch: from Forestville through Preston and on to Lanesboro. Bigger water than most Driftless creeks — wide enough to make a real cast — with strong wild brown trout numbers and excellent Blue-Winged Olive and caddis hatches.",
  fish:"Wild browns, with the densest fish counts in the reaches between Preston and Lanesboro. Big enough to fish a 9-foot 5-weight comfortably. Extensive state angling easements; look for the brown-and-white signs and gravel pull-offs.",
  coords:[[43.6300,-92.2000],[43.6500,-92.1400],[43.6702,-92.0824],[43.6950,-92.0200],[43.7183,-91.9762]]
},
{
  id:"nbranchroot", name:"North Branch Root River", color:"#3a8c9c",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs from Chatfield southeast toward Lanesboro through classic bluff-and-pasture country. Smaller and more intimate than the South Branch, with long meadow stretches and good spring input.",
  fish:"Wild brown trout with some stocking. Meadow water rewards a careful approach — the fish see the sky. Terrestrials from July on.",
  coords:[[43.8800,-92.2600],[43.8458,-92.1888],[43.8000,-92.1000],[43.7500,-92.0300],[43.7200,-91.9800]]
},
{
  id:"mbranchroot", name:"Middle Branch Root River", color:"#4a9cac",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The quiet one — from near Fountain down to the North Branch confluence above Lanesboro. Smaller water in a steep, wooded valley, and the branch people tend to skip.",
  fish:"Wild browns in tight, brushy water. Best in spring and fall when the canopy is open; bring a short rod and patience.",
  coords:[[43.7800,-92.2200],[43.7600,-92.1700],[43.7402,-92.1357],[43.7300,-92.0500],[43.7183,-91.9762]]
},
{
  id:"sfroot", name:"South Fork Root River", color:"#2a6e7d",
  state:"MN", region:"driftless", gauges:["sfRootHouston"], primaryGauge:"sfRootHouston",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Drains the Spring Grove and Caledonia country in Houston County before joining the mainstem Root near Houston. One of the few Minnesota Driftless streams with a live USGS discharge gauge — a useful proxy for the whole southeast corner.",
  fish:"Trout in the cold upper reaches and tributaries, warming as it approaches the Root. The gauge near Houston is the single best number for judging conditions across Houston and Fillmore counties.",
  coords:[[43.6200,-91.7000],[43.6700,-91.6500],[43.7100,-91.6000],[43.7388,-91.5643],[43.7600,-91.5600]]
},
{
  id:"troutrunmn", name:"Trout Run Creek — Fillmore County", color:"#3a9c6e",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Fillmore County spring creek in the Troy area feeding the Root system — long a showcase for stream restoration work and one of the better-known wild brown trout creeks in the Minnesota Driftless.",
  fish:"Wild browns in restored riffle-and-pool habitat. Clear, cold, and technical. Extensive public easement water; walk well away from the crossings.",
  coords:[[43.8200,-92.1600],[43.8000,-92.1300],[43.7800,-92.1000],[43.7600,-92.0700]]
},
{
  id:"duschee", name:"Duschee Creek", color:"#5bac8c",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A small, cold tributary entering the Root right at Lanesboro — close enough to town to fish before breakfast, and a reliable pick when the bigger branches are off-color after rain.",
  fish:"Wild brown trout in tight water. Its size makes it clear and fishable sooner than the South Branch after a storm.",
  coords:[[43.6800,-91.9900],[43.6950,-91.9850],[43.7100,-91.9800],[43.7183,-91.9762]]
},
{
  id:"canfield", name:"Canfield Creek", color:"#2a9c7d",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The spring creek inside Forestville / Mystery Cave State Park — fed by big karst springs, cold year-round, and set in one of the prettiest valleys in the state. Park facilities, marked trails, and a historic townsite thrown in.",
  fish:"Wild brown trout in gin-clear spring water. Very stable flows; a dependable choice in a dry summer or after heavy rain. State park vehicle permit required.",
  coords:[[43.6200,-92.2500],[43.6280,-92.2330],[43.6353,-92.2168],[43.6450,-92.2050]]
},
{
  id:"campcreekmn", name:"Camp Creek", color:"#6eac5b",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Fillmore County creek in the Forestville–Preston corridor, feeding the South Branch. Small, spring-influenced water in steep pasture country.",
  fish:"Wild browns in short pools and undercut banks. Easy to combine with Canfield Creek and the South Branch in one day.",
  coords:[[43.6100,-92.1500],[43.6250,-92.1200],[43.6400,-92.0950],[43.6550,-92.0800]]
},
{
  id:"whitewater", name:"Whitewater River", color:"#1d8c9c",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Minnesota's most famous trout river, centered on Whitewater State Park at Elba. Three branches converge in a spectacular bluff valley with 27,000 acres of surrounding state wildlife management area — more public trout water in one place than anywhere else in the Driftless.",
  fish:"Wild browns and stocked rainbows across the branches, with the biggest hatches of the Minnesota Driftless. The state park reach is busy; the WMA water above and below is not. The USGS gauge here was discontinued in 1993 — use the Root at Pilot Mound as a regional proxy, or read the water on arrival.",
  coords:[[43.9800,-92.1000],[44.0400,-92.0600],[44.0864,-92.0182],[44.1400,-91.9700],[44.2100,-91.9300]]
},
{
  id:"nfwhitewater", name:"North Fork Whitewater River", color:"#2a9cac",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The northern branch of the Whitewater, dropping through the Whitewater WMA to join the others near Elba. Steep, wooded, and colder than the mainstem.",
  fish:"Wild brown trout in pocket water and plunge pools. Less pressure than the state park stretch — the walk in is the filter.",
  coords:[[44.1300,-92.1400],[44.1100,-92.0900],[44.0950,-92.0500],[44.0864,-92.0182]]
},
{
  id:"mfwhitewater", name:"Middle Fork Whitewater River", color:"#3aacbc",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The middle branch of the Whitewater system, running through the WMA above Elba — the quietest of the three forks.",
  fish:"Wild browns in small, brushy water. Good early-season and late-season choice when the mainstem is crowded.",
  coords:[[44.0200,-92.1400],[44.0450,-92.1000],[44.0700,-92.0600],[44.0864,-92.0182]]
},
{
  id:"sfwhitewater", name:"South Fork Whitewater River", color:"#4abccc",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The southern branch, running from the St. Charles area northeast to the Whitewater confluence. More open and meadow-like than its siblings, with long glides.",
  fish:"Wild browns plus stocked fish. Open water means longer casts and spookier trout — a good stream for terrestrials in August.",
  coords:[[43.9700,-92.0800],[44.0100,-92.0600],[44.0500,-92.0400],[44.0864,-92.0182]]
},
{
  id:"garvinbrook", name:"Garvin Brook", color:"#5b9c3a",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Winona County spring creek running from Stockton down to Minnesota City and the Mississippi bottoms — the closest good trout water to Winona, and heavily worked on for habitat over the years.",
  fish:"Wild brown trout with stocking support. Easy access from the valley road; the restored riffle sections hold fish well.",
  coords:[[44.0100,-91.8600],[44.0250,-91.8100],[44.0322,-91.7793],[44.0600,-91.7400],[44.0900,-91.7100]]
},
{
  id:"beavercreekmn", name:"Beaver Creek — Houston County", color:"#3a7d4a",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The spring creek inside Beaver Creek Valley State Park near Caledonia, fed by Big Spring at the head of the valley. Cold, constant, and one of the prettiest small trout valleys anywhere in the Midwest.",
  fish:"Wild brown trout and a brook trout population in the upper spring water. Reliable in hot weather thanks to the spring input. State park vehicle permit required; camping on site.",
  coords:[[43.6700,-91.6100],[43.6550,-91.5900],[43.6425,-91.5722],[43.6250,-91.5500]]
},
{
  id:"rushcreekmn", name:"Rush Creek — Rushford", color:"#6e9c4a",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Fillmore County trout creek joining the Root at Rushford. The USGS site here is a stage-only gauge — it reports water level, not discharge — so this stream is carried as ungauged rather than showing a number the flow status can't use.",
  fish:"Wild brown trout in a mix of meadow and wooded water. Use the Root at Pilot Mound or the South Fork Root gauge as a regional wetness read.",
  coords:[[43.8800,-91.8500],[43.8600,-91.8100],[43.8324,-91.7767],[43.8083,-91.7524]]
},
{
  id:"crookedcreekmn", name:"Crooked Creek — Houston County", color:"#8c9c3a",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs through the Freeburg and Caledonia country in the far southeast corner of Minnesota, dropping to the Mississippi near Reno. Deep valleys, little traffic. Its USGS site is stage-only, so no CFS is available here.",
  fish:"Wild brown trout with good numbers in the upper branches. Among the least-pressured quality water in the Minnesota Driftless.",
  coords:[[43.6400,-91.4500],[43.6250,-91.4100],[43.6107,-91.3612],[43.5900,-91.3100]]
},
{
  id:"winnebagocr", name:"Winnebago Creek", color:"#9c8c4a",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A small Houston County creek near Eitzen in Minnesota's southeast corner, minutes from the Iowa line — closer to Decorah than most Minnesota trout water.",
  fish:"Wild browns in tight, brushy water. Worth pairing with Iowa's French Creek or Waterloo Creek on the same trip given how close the two are.",
  coords:[[43.5700,-91.4400],[43.5550,-91.3900],[43.5400,-91.3400],[43.5300,-91.2900]]
},
{
  id:"pinecreekmn", name:"Pine Creek — Houston County", color:"#4a8c6e",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A cold Houston County creek in the bluffs above the Mississippi between La Crescent and Hokah, dropping fast out of the ridge country.",
  fish:"Wild brown trout in steep, small water. Short but good — an easy stop when you're passing La Crosse.",
  coords:[[43.6700,-91.4200],[43.6850,-91.3900],[43.7000,-91.3600],[43.7150,-91.3300]]
},
{
  id:"haycreek", name:"Hay Creek", color:"#8c4a6e",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The northern outpost of the Driftless: a spring creek running north into the Mississippi at Red Wing, through the Hay Creek Unit of the Richard J. Dorer Memorial Hardwood State Forest. The closest quality trout water to the Twin Cities.",
  fish:"Wild brown trout with stocking support. Gets weekend traffic from the metro — go on a weekday or walk further than the first bend. State forest parking along the valley road.",
  coords:[[44.4800,-92.5600],[44.5100,-92.5500],[44.5400,-92.5400],[44.5625,-92.5338]]
},
{
  id:"vermillionmn", name:"Vermillion River", color:"#9c5b7d",
  state:"MN", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A spring-fed metro-edge trout stream running through Dakota County to the Mississippi at Hastings — not strictly inside the Driftless, but the same limestone spring-creek character and the closest wild brown trout to Minneapolis and St. Paul.",
  fish:"Wild brown trout in a stream squeezed by suburban development and defended hard by local conservation groups. Special regulations apply on parts of it — check current Minnesota DNR trout rules before fishing.",
  coords:[[44.7200,-93.1200],[44.7300,-93.0300],[44.7400,-92.9500],[44.7433,-92.8520],[44.7100,-92.8000]]
},

/* ================= DRIFTLESS AREA — WISCONSIN =================
   The largest share of the Driftless and its best-known trout water:
   Vernon County's coulees, the Kickapoo watershed, the Grant County
   spring creeks, and the Dane County limestone streams. Wisconsin's
   stream-bank easement program plus DNR Fishery Areas put a huge
   amount of this in reach on foot, with gravel parking pull-offs at
   most bridges. Nearly all of it is walk-and-wade; the Kickapoo
   mainstem is the one real paddling river in the group.
   Note Wisconsin's stream classification: Class I = wild, self-
   sustaining trout, no stocking needed; Class II = some natural
   reproduction plus stocking; Class III = stocked, no reproduction. */
{
  id:"timbercoulee", name:"Timber Coulee Creek", color:"#0e7a4a",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The crown jewel of Wisconsin trout streams and the birthplace of modern coldwater stream restoration — the Coon Valley watershed work that started here in the 1930s became the template for Driftless habitat projects everywhere since. A Class I spring creek running down Timber Coulee from the Westby ridge to Coon Valley.",
  fish:"Dense wild brown trout in restored riffle-pool-lunker-structure habitat. Summer caddis and Trico hatches bring excellent dry-fly fishing. Heavy roadside easement access along County P — and correspondingly heavy pressure, so walk past the first three pull-offs.",
  coords:[[43.6100,-90.8900],[43.5800,-90.9200],[43.5400,-90.9600],[43.5022,-90.9932]]
},
{
  id:"cooncreek", name:"Coon Creek", color:"#1d8c5b",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The main stem of the Coon Valley system, gathering Timber Coulee, Spring Coulee, Rullands Coulee and Bohemian Valley before running out to the Mississippi at Stoddard. Bigger water than its famous tributaries, and it holds bigger fish because of it.",
  fish:"Wild brown trout, with the best of it above Chaseburg where the coulee creeks come in cold. More room for a real cast than Timber Coulee, and noticeably fewer anglers.",
  coords:[[43.4700,-90.9300],[43.5022,-90.9932],[43.5700,-91.0100],[43.6469,-91.0335],[43.6600,-91.1300],[43.6608,-91.2185]]
},
{
  id:"springcoulee", name:"Spring Coulee Creek", color:"#2a9c6e",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"One of the restored Coon Valley tributaries above Coon Valley village — a small, cold, hard-working little creek that's had decades of habitat investment.",
  fish:"Wild browns in tight quarters. A good overflow option on a busy Saturday when the Timber Coulee pull-offs are full.",
  coords:[[43.5500,-90.9400],[43.5300,-90.9600],[43.5150,-90.9800],[43.5022,-90.9932]]
},
{
  id:"bohemianvalley", name:"Bohemian Valley Creek", color:"#3aac7d",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Coon Creek tributary in the valley above Chaseburg, in La Crosse County — steep-sided, wooded, and small.",
  fish:"Wild brown trout in brushy water. Short rod country. Best in spring and fall when the bankside cover is down.",
  coords:[[43.6300,-90.9400],[43.6350,-90.9700],[43.6420,-91.0000],[43.6469,-91.0335]]
},
{
  id:"rullandscoulee", name:"Rullands Coulee Creek", color:"#4abc8c",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Another of the small Coon Creek feeders near Chaseburg, tucked into its own coulee.",
  fish:"Wild browns in very small water. Rewarding if you like fishing creeks you can jump across; frustrating if you don't.",
  coords:[[43.6100,-91.0700],[43.6250,-91.0550],[43.6380,-91.0420],[43.6469,-91.0335]]
},
{
  id:"kickapoo", name:"Kickapoo River", color:"#8c6e2a",
  state:"WI", region:"driftless", gauges:["kickOntario","kickLaFarge","kickSteuben"], primaryGauge:"kickLaFarge",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The crookedest river in the world — 125 twisting miles from Wilton through Ontario, La Farge, Viola, Readstown, Gays Mills and Steuben to the Wisconsin River. Trout water in the cold upper reaches around Ontario; a superb smallmouth paddle below. The Kickapoo Valley Reserve protects 8,600 acres of the upper valley.",
  fish:"Trout above and around Ontario and in the cold tributaries; smallmouth bass from La Farge down. Three live gauges make this the best-instrumented river in the Wisconsin Driftless — it's the one here you'd actually float, and the flow number matters.",
  coords:[[43.8100,-90.5400],[43.7299,-90.5889],[43.6400,-90.6200],[43.5742,-90.6432],[43.5033,-90.6707],[43.4461,-90.7574],[43.3944,-90.7707],[43.3181,-90.8496],[43.1828,-90.8583],[43.0855,-90.8935]]
},
{
  id:"wforkkickapoo", name:"West Fork Kickapoo River", color:"#9c8c3a",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The best-known Driftless stream outside the region, running from the Cashton ridge through Bloomingdale and Avalanche to meet the Kickapoo at Readstown. Bigger water than Timber Coulee — 15 to 20 feet wide through the main sections — and it grows a bigger average fish. The West Fork Sports Club has stewarded the habitat work here for decades.",
  fish:"Wild brown trout with fish in the 12–18 inch range common, noticeably larger on average than the Coon Valley creeks. A long catch-and-release stretch runs through the Avalanche area — check current Wisconsin DNR regulations, which vary by reach. Its USGS gauge was discontinued in 2017, so this is a read-the-water stream now.",
  coords:[[43.6900,-90.8100],[43.6300,-90.7600],[43.5905,-90.7274],[43.5183,-90.7118],[43.4800,-90.7300],[43.4461,-90.7574]]
},
{
  id:"tainter", name:"Tainter Creek", color:"#7d9c2a",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Crawford/Vernon County creek running to the Kickapoo near Gays Mills, with an active watershed council driving habitat and farm-conservation work.",
  fish:"Wild brown trout in restored habitat. Less famous than the West Fork an easy drive away, which is exactly the appeal.",
  coords:[[43.4200,-90.9500],[43.4000,-90.9100],[43.3700,-90.8800],[43.3400,-90.8600]]
},
{
  id:"knappcreek", name:"Knapp Creek", color:"#6e8c3a",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Crawford County Kickapoo tributary in the Soldiers Grove area, running through a narrow wooded valley.",
  fish:"Wild browns in small water. A good add-on when you're already fishing the Kickapoo corridor.",
  coords:[[43.4400,-90.8900],[43.4250,-90.8500],[43.4100,-90.8100],[43.3944,-90.7707]]
},
{
  id:"badaxe", name:"Bad Axe River", color:"#8c3a2a",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Vernon County's west-slope river, running from the Viroqua ridge out to the Mississippi at Genoa through a set of forks that each hold trout.",
  fish:"Wild brown trout in the North and South forks and the upper mainstem, warming toward the Mississippi. Good easement access; more room to cast than the coulee creeks.",
  coords:[[43.5900,-90.9200],[43.5850,-91.0100],[43.5800,-91.1000],[43.5747,-91.2313]]
},
{
  id:"rushcreekwi", name:"Rush Creek — Crawford County", color:"#9c6e5b",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A cold creek dropping off the ridge to the Mississippi near Ferryville, below the Rush Creek State Natural Area's dry bluff prairies.",
  fish:"Wild brown trout in steep, small water. The bluff-prairie setting above it is worth the trip on its own.",
  coords:[[43.3400,-90.9700],[43.3300,-91.0200],[43.3200,-91.0700],[43.3050,-91.1100]]
},
{
  id:"blackearth", name:"Black Earth Creek", color:"#1d7a8c",
  state:"WI", region:"driftless", gauges:["blackEarthCP","blackEarth"], primaryGauge:"blackEarth",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Dane County's famous limestone spring creek, running from Cross Plains through Black Earth to Mazomanie — twenty-five minutes from Madison and one of the most heavily studied trout streams in the Midwest. Two live USGS gauges make it the best-instrumented small trout stream in the Driftless.",
  fish:"Wild brown trout, some of them large, in a stream that gets fished hard and stays good anyway. Classic spring-creek tactics: scuds, sowbugs, small BWOs, and a quiet approach. Urban pressure means educated fish.",
  coords:[[43.1050,-89.6150],[43.1097,-89.6408],[43.1147,-89.6641],[43.1342,-89.7322],[43.1772,-89.7943],[43.1900,-89.8300]]
},
{
  id:"mountvernon", name:"Mount Vernon Creek", color:"#2a8c9c",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Dane County limestone creek in the Mount Vernon valley south of Verona — spring-fed, clear, and close enough to Madison for an evening.",
  fish:"Wild brown trout in classic spring-creek water. Technical and clear; long leaders and small flies. DNR fishery area access in the valley.",
  coords:[[42.9400,-89.5200],[42.9550,-89.5300],[42.9700,-89.5400],[42.9900,-89.5500]]
},
{
  id:"castlerock", name:"Castle Rock Creek", color:"#3a9cac",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The Fennimore Fork of the Blue River in Grant County — a big-spring limestone creek with famously stable, cold flows and a reputation for growing large wild browns in a small stream. One of the marquee destinations of the Wisconsin Driftless.",
  fish:"Wild brown trout, with genuine trophy potential for a creek this size. Spring-creek fishing at its most technical: scuds, sowbugs, midges, and light tippet. A long catch-and-release stretch has historically applied — check current Wisconsin DNR regulations.",
  coords:[[42.9800,-90.5800],[43.0100,-90.5600],[43.0400,-90.5500],[43.0700,-90.5500]]
},
{
  id:"blueriver", name:"Blue River", color:"#2a6e9c",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs north through Grant and Iowa counties to the Wisconsin River at the village of Blue River, gathering Castle Rock Creek on the way. Cold spring input up high, warming as it goes.",
  fish:"Wild brown trout in the upper reaches and the spring-fed forks. Good easement access; a strong pairing with Castle Rock Creek in the same day.",
  coords:[[42.9900,-90.5700],[43.0500,-90.5700],[43.1100,-90.5800],[43.1836,-90.5896],[43.2000,-90.6000]]
},
{
  id:"biggreen", name:"Big Green River", color:"#3a8c5b",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Grant County spring creek in the Werley and Woodman country — remote-feeling, lightly travelled, and long regarded as one of the best wild brown trout streams in southwest Wisconsin.",
  fish:"Wild brown trout in cold, stable spring water. Meadow stretches with undercut banks; a careful approach pays. Gravel-road access with pull-offs at the crossings.",
  coords:[[42.9700,-90.7800],[43.0100,-90.7900],[43.0500,-90.8000],[43.0800,-90.8200]]
},
{
  id:"grantriver", name:"Grant River", color:"#5b8c2a",
  state:"WI", region:"driftless", gauges:["grantBurton"], primaryGauge:"grantBurton",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs from the Lancaster country down through Burton to the Mississippi at Potosi. Trout in the cold upper branches, smallmouth bass as it warms downstream — and a live USGS gauge, which is rare in this corner.",
  fish:"Trout in the upper river and its feeders; smallmouth below Burton. The Burton gauge is a useful regional wetness read for the whole Grant County spring-creek cluster including Big Green and Castle Rock.",
  coords:[[42.9200,-90.6800],[42.8467,-90.7107],[42.7800,-90.7700],[42.7203,-90.8192],[42.6800,-90.7100]]
},
{
  id:"platteriver", name:"Platte River", color:"#6e9c3a",
  state:"WI", region:"driftless", gauges:["platteRockville"], primaryGauge:"platteRockville",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Grant County river running past Platteville and Rockville to the Mississippi. Trout water in the upper branches, smallmouth downstream, with a live discharge gauge at Rockville.",
  fish:"Trout in the cold headwater branches; smallmouth bass in the lower river. Good DNR fishery area access around Platteville.",
  coords:[[42.8300,-90.4200],[42.7700,-90.4600],[42.7342,-90.4785],[42.7311,-90.6403],[42.6600,-90.7000]]
},
{
  id:"ebpecatonica", name:"East Branch Pecatonica River", color:"#8c9c4a",
  state:"WI", region:"driftless", gauges:["ebPecatonica"], primaryGauge:"ebPecatonica",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs through the Blanchardville and Hollandale country in Iowa and Lafayette counties, at the southeastern edge of the Driftless. Trout in the upper branches and the spring-fed feeder creeks.",
  fish:"Wild and stocked brown trout in the cold upper water, warming downstream toward the Pecatonica mainstem. A live gauge here is a good read for the whole southeast Driftless corner.",
  coords:[[42.9500,-89.8400],[42.8800,-89.8500],[42.7856,-89.8611],[42.7200,-89.8900]]
},
{
  id:"kinnickinnic", name:"Kinnickinnic River", color:"#1d8c8c",
  state:"WI", region:"driftless", gauges:["kinniRiverFalls"], primaryGauge:"kinniRiverFalls",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The Kinni — a spring-fed limestone river running through River Falls and down a deep gorge to the St. Croix at Kinnickinnic State Park. Extraordinarily dense wild brown trout numbers and a live USGS gauge; the best-known trout stream in the northern Driftless.",
  fish:"Wild brown trout in exceptional density, especially in the town and lower-gorge sections. Fishes well nearly year-round thanks to the springs. The gorge below town requires a real hike in — and holds the better fish.",
  coords:[[44.9000,-92.5300],[44.8800,-92.5800],[44.8613,-92.6237],[44.8308,-92.7331],[44.8069,-92.7469]]
},
{
  id:"rushriverwi", name:"Rush River — Pierce County", color:"#2a9c9c",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs south through Pierce County from the Baldwin area past El Paso to the Mississippi at Maiden Rock — the Kinni's quieter neighbour, with a long stretch of quality trout water and far fewer anglers.",
  fish:"Wild brown trout through most of its length. Extensive easement and DNR fishery area access along the valley road; the middle river fishes best.",
  coords:[[44.9000,-92.3400],[44.8300,-92.3200],[44.7500,-92.2900],[44.6500,-92.2600],[44.5600,-92.2900]]
},
{
  id:"trimbelle", name:"Trimbelle River", color:"#3aacac",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A small Pierce County trout stream running from near Ellsworth south to the Mississippi at Diamond Bluff, between the Kinni and the Rush.",
  fish:"Wild and stocked brown trout in small water. A good third stop on a Pierce County day with the Kinnickinnic and Rush.",
  coords:[[44.8000,-92.4600],[44.7314,-92.4877],[44.6700,-92.5100],[44.6200,-92.5500]]
},
{
  id:"eaugalle", name:"Eau Galle River", color:"#4abcbc",
  state:"WI", region:"driftless", gauges:["eauGalleSV"], primaryGauge:"eauGalleSV",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs through Spring Valley in the northern Driftless, above and below the Eau Galle Dam, to the Chippewa. Trout water in the upper river with a live USGS discharge gauge at Spring Valley.",
  fish:"Wild and stocked brown trout upstream of the reservoir. The gauge here is a useful proxy for the whole Pierce/St. Croix County cluster, including the ungauged Rush and Trimbelle.",
  coords:[[44.9400,-92.2100],[44.9000,-92.2200],[44.8528,-92.2383],[44.7800,-92.2200],[44.7200,-92.1900]]
},
{
  id:"lacrosseriver", name:"La Crosse River", color:"#6e5b9c",
  state:"WI", region:"driftless", gauges:["laCrosseSparta"], primaryGauge:"laCrosseSparta",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs from the Fort McCoy country through Sparta and West Salem to the Mississippi at La Crosse, paralleled by the La Crosse River State Trail. Trout in the upper river and the cold feeder creeks, warmer water below Sparta.",
  fish:"Trout upstream of Sparta and in Silver Creek and the other spring-fed tributaries; smallmouth and northern pike downstream. Live gauge at Sparta.",
  coords:[[44.0200,-90.6500],[43.9939,-90.7000],[43.9375,-90.8106],[43.9000,-90.9500],[43.8800,-91.0800],[43.8608,-91.2104]]
},
{
  id:"silvercreekwi", name:"Silver Creek — Angelo", color:"#5b6eac",
  state:"WI", region:"driftless", gauges:["silverAngelo"], primaryGauge:"silverAngelo",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A cold Monroe County tributary of the La Crosse River near Angelo, north of Sparta — one of the smallest streams in the Driftless with its own live discharge gauge, which makes it a precise read on local conditions.",
  fish:"Wild brown trout in small spring-fed water. Because the gauge is right on the creek, this is one of the few places here where the CFS number genuinely describes the water you'll be standing in.",
  coords:[[44.0100,-90.7300],[43.9900,-90.7450],[43.9672,-90.7650],[43.9500,-90.7900]]
},
{
  id:"stillwell", name:"Stillwell Creek", color:"#4a5b9c",
  state:"WI", region:"driftless", gauges:["stillwellTomah"], primaryGauge:"stillwellTomah",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A small Monroe County trout creek near Tomah in the La Crosse River watershed, on the sandy northeastern margin of the Driftless. It carries its own gauge — and the numbers are small enough (single-digit CFS at low water) to show just how little water a good trout creek needs.",
  fish:"Brook and brown trout in very small water. Tight casting; a 7-foot rod is plenty. A worthwhile stop if you're passing Tomah on I-90.",
  coords:[[44.0300,-90.6300],[44.0100,-90.6450],[43.9939,-90.6572],[43.9750,-90.6800]]
},
{
  id:"elkcreekwi", name:"Elk Creek — Trempealeau County", color:"#6e9c5b",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"A Trempealeau County trout creek near Independence, in the northern coulee country where the Driftless bluffs start to spread out.",
  fish:"Wild brown trout with brook trout in the cold headwaters. Quiet water — this corner sees a fraction of the Vernon County traffic.",
  coords:[[44.4300,-91.3400],[44.4000,-91.3700],[44.3800,-91.4000],[44.3597,-91.4204]]
},
{
  id:"trempealeau", name:"Trempealeau River", color:"#8c7d5b",
  state:"WI", region:"driftless", gauges:["trempArcadia"], primaryGauge:"trempArcadia",
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs from the Osseo country through Whitehall, Independence and Arcadia to the Mississippi. Too warm for trout on the lower mainstem, but it drains a whole set of trout coulees — and it's a good smallmouth paddle in its own right.",
  fish:"Smallmouth bass on the mainstem, trout in Elk Creek and the other cold feeders. Use the Arcadia gauge as the regional read for Trempealeau and Buffalo county creeks.",
  coords:[[44.5747,-91.2268],[44.4500,-91.2800],[44.3686,-91.3182],[44.3200,-91.4000],[44.2544,-91.5053],[44.1318,-91.5530]]
},
{
  id:"buffalowi", name:"Buffalo River", color:"#9c8c6e",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs west through Buffalo County past Mondovi toward the Chippewa, in the northern Driftless. Trout in the cold upper branches and tributary coulees; warmwater downstream.",
  fish:"Brown trout in the headwater branches; smallmouth in the lower river. The Buffalo County coulees are among the least-fished quality trout water in Wisconsin.",
  coords:[[44.6400,-91.4800],[44.6000,-91.5800],[44.5666,-91.6712],[44.5000,-91.8000],[44.4300,-91.9000]]
},
{
  id:"pineriverwi", name:"Pine River — Richland County", color:"#5b9c6e",
  state:"WI", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"Runs south through Richland Center to the Wisconsin River, gathering a set of trout tributaries out of the Richland County ridges along the way.",
  fish:"Trout in the upper river and the spring-fed feeder creeks; smallmouth below Richland Center. An overlooked corner of the Wisconsin Driftless.",
  coords:[[43.5000,-90.4200],[43.4400,-90.4000],[43.3800,-90.3900],[43.3336,-90.3862],[43.2600,-90.4100]]
},

/* ================= DRIFTLESS AREA — NORTHWEST ILLINOIS ================= */
{
  id:"appleriver", name:"Apple River", color:"#9c4a3a",
  state:"IL", region:"driftless", gauges:[], primaryGauge:null,
  goodFlow:null, // TODO: set {min:___,max:___} (CFS) for YOUR good-flow range on this river
  blurb:"The southern tip of the Driftless: a Jo Daviess County river cutting a limestone canyon through Apple River Canyon State Park before running down past Elizabeth and Hanover to the Mississippi. Illinois' only real piece of Driftless canyon country.",
  fish:"Illinois has no wild trout fishery here — the state runs a stocked catch-and-keep trout season in spring and fall at designated sites, and the river otherwise fishes for smallmouth bass. Check current Illinois DNR trout site listings and season dates before planning a trip around it.",
  coords:[[42.4700,-90.0200],[42.4408,-90.0447],[42.3800,-90.1400],[42.3192,-90.2262],[42.2542,-90.2871],[42.2200,-90.3300]]
},
];

/* ---------- Access points ---------- */
// role: launch | takeout | both | wade
const RAMPS = [
  // ---- Snake River (Jackson Hole) — full access set ----
  {id:"cattle", river:"snake", name:"Cattleman's Bridge",  role:"both",   pos:[43.8600,-110.5380], note:"In-park access near the Oxbow Bend; GTNP boat permit required."},
  {id:"schwab", river:"snake", name:"Schwabacher Landing", role:"both",   pos:[43.7000,-110.6960], note:"Iconic Teton-reflection access in GTNP; short, shallow ramp."},
  {id:"blm23",  river:"snake", name:"BLM Parcel 23 (Fall Creek Rd)", role:"wade", pos:[43.4300,-110.8100], note:"Carry-in only — swim hole and bank fishing south of Jackson."},
  {id:"kingsw", river:"snake", name:"King's Wave (kayak access)", role:"launch", pos:[43.2820,-110.8040], note:"Highway turnout for kayak surfers near Hoback Junction; no facilities."},
  {id:"tacoh",  river:"snake", name:"Taco Hole (kayak access)",  role:"launch", pos:[43.2540,-110.8560], note:"Steep trail/stairs to a play wave ~27 mi south of Jackson; no facilities."},
  {id:"pritch", river:"snake", name:"Pritchard",     role:"both",    pos:[43.2620,-110.8380], note:"BTNF permit ramp; start of the 8-mile braided run to West Table."},
  {id:"elbow",  river:"snake", name:"Elbow",         role:"both",    pos:[43.2450,-110.8720], note:"BTNF ramp with walk-in and drive-in access; restrooms, no camping."},
  {id:"etable", river:"snake", name:"East Table",    role:"launch",  pos:[43.2380,-110.8820], note:"BTNF permit ramp just above West Table; campground nearby."},
  {id:"kahuna", river:"snake", name:"Big Kahuna / Lunch Counter", role:"wade", pos:[43.2080,-110.9340], note:"Roadside surf access at the canyon's biggest waves; experts only."},
  // ---- South Fork of the Snake (Swan Valley) — full access set ----
  {id:"palcr",  river:"southfork", name:"Palisades Creek", role:"both",  pos:[43.3500,-111.2280], note:"Interagency access/campground just below the dam reach."},
  {id:"wolf",   river:"southfork", name:"Wolf Flat (Irwin)", role:"launch", pos:[43.3760,-111.2560], note:"Dirt/makeshift ramp near Irwin — 4WD recommended; a mellow jump-off above Spring Creek."},
  {id:"cott",   river:"southfork", name:"Cottonwood (Fullmer)", role:"both", pos:[43.5320,-111.5460], note:"Mid-canyon interagency access; common overnight-float camp zone."},
  {id:"heise",  river:"southfork", name:"Heise",      role:"both",    pos:[43.6120,-111.6850], note:"Popular lower-river access by the hot springs; below the canyon."},
  // ---- Teton River (Victor / Driggs) — full access set ----
  {id:"foxc",   river:"teton", name:"Fox Creek",     role:"wade",    pos:[43.5960,-111.1560], note:"Upstream F&G access; ~250-yard walk to slow, placid water."},
  {id:"sbates", river:"teton", name:"South Bates",   role:"both",    pos:[43.6560,-111.2020], note:"Quieter put-in just upstream of Bates Bridge."},
  {id:"horse",  river:"teton", name:"Horseshoe",     role:"both",    pos:[43.7780,-111.2330], note:"Mid-valley access between Rainey and Cache."},
  {id:"tcache",  river:"teton", name:"Cache Bridge",  role:"both",    pos:[43.8120,-111.2380], note:"The valley's most popular access — minutes from town; busy weekends."},
  {id:"buxton", river:"teton", name:"Buxton Bridge (Buxton River Park)", role:"both", pos:[43.8360,-111.2460], note:"Moderate pressure, decent parking; good first-timer option."},
  // Snake (Jackson)
  {id:"jld",   river:"snake", name:"Jackson Lake Dam", role:"launch",  pos:[43.8585,-110.5870], note:"Flat water below the dam; bald eagle alley."},
  {id:"pac",   river:"snake", name:"Pacific Creek",    role:"both",    pos:[43.8430,-110.5120], note:"GTNP permit required to launch in the park."},
  {id:"dead",  river:"snake", name:"Deadman's Bar",    role:"both",    pos:[43.7320,-110.6740], note:"Steep ramp; the classic Teton-view launch."},
  {id:"moose", river:"snake", name:"Moose",            role:"both",    pos:[43.6560,-110.7150], note:"Busy mid-summer — arrive early."},
  {id:"wils",  river:"snake", name:"Wilson Bridge (Hwy 22)", role:"both", pos:[43.4906,-110.8330], note:"County ramp on river left below the bridge."},
  {id:"spark", river:"snake", name:"South Park (Pritchard ramp)", role:"both", pos:[43.3960,-110.7880], note:"WGFD access; popular evening-float put-in."},
  {id:"astor", river:"snake", name:"Astoria",          role:"both",    pos:[43.2910,-110.7870], note:"Below Hoback Junction; last mellow access before the canyon."},
  {id:"wtab",  river:"snake", name:"West Table",       role:"launch",  pos:[43.2320,-110.8900], note:"Whitewater launch — Class III below here."},
  {id:"sheep", river:"snake", name:"Sheep Gulch",      role:"takeout", pos:[43.1760,-110.9890], note:"Canyon take-out. Do not miss it."},
  // South Fork
  {id:"pdam",  river:"southfork", name:"Palisades Dam",       role:"launch", pos:[43.3370,-111.2100], note:"Tailwater start; check release schedule."},
  {id:"sprcr", river:"southfork", name:"Spring Creek", role:"both",   pos:[43.4006,-111.3050], note:"Mid-Swan-Valley access near Irwin."},
  {id:"conan", river:"southfork", name:"Conant",              role:"both",   pos:[43.4501,-111.3984], note:"Last ramp before the canyon stretch."},
  {id:"bying", river:"southfork", name:"Byington",            role:"both",   pos:[43.6226,-111.6653], note:"Standard canyon take-out near Ririe."},
  {id:"loren", river:"southfork", name:"Lorenzo (Twin Bridges)", role:"takeout", pos:[43.5450,-111.9300], note:"Lower-river take-out off US-20."},
  // Teton
  {id:"bates", river:"teton", name:"Bates Bridge",   role:"both",    pos:[43.7100,-111.2230], note:"Meadow water upstream and down."},
  {id:"rain",  river:"teton", name:"Rainey (Big Eddy)",  role:"both",    pos:[43.7540,-111.2320], note:"Quiet mid-valley access."},
  {id:"harr",  river:"teton", name:"Harrops Bridge (Hwy 33)", role:"takeout", pos:[43.8600,-111.2550], note:"Last easy take-out before the canyon."},
  // Salt
  {id:"etna",  river:"salt", name:"Etna Bridge",  role:"launch",  pos:[43.0400,-111.0100], note:"Gentle launch into meadow bends."},
  {id:"saltm", river:"salt", name:"Salt River mouth (Alpine)", role:"takeout", pos:[43.1650,-111.0450], note:"Take out before the reservoir wind."},
  // Henry's Fork
  {id:"ipdam", river:"henrysfork", name:"Island Park Dam (Box Canyon)", role:"launch", pos:[44.4150,-111.3970], note:"Tailwater launch into the Box."},
  {id:"lastc", river:"henrysfork", name:"Last Chance",  role:"takeout", pos:[44.3600,-111.4450], note:"Take out above Harriman (no floating through the Ranch)."},
  {id:"warmr", river:"henrysfork", name:"Warm River",   role:"launch",  pos:[44.1200,-111.3150], note:"Campground launch; classic family float."},
  {id:"ashtr", river:"henrysfork", name:"Ashton Reservoir (Hwy 47)", role:"takeout", pos:[44.0850,-111.4200], note:"Flat-water finish — take out before the dam."},
  {id:"orab",  river:"henrysfork", name:"Ora Bridge",   role:"launch",  pos:[44.0500,-111.5200], note:"Below Ashton Dam; riffle water."},
  {id:"chest", river:"henrysfork", name:"Chester backwater", role:"takeout", pos:[43.9950,-111.5800], note:"Take out above Chester Dam."},
  // North Platte
  {id:"tisl",  river:"nplatteupper", name:"Treasure Island", role:"launch", pos:[41.3440,-106.7900], note:"WGFD access south of Saratoga."},
  {id:"sara",  river:"nplatteupper", name:"Saratoga (Foote access)", role:"takeout", pos:[41.4550,-106.8060], note:"Town take-out; hot springs two blocks away."},
  {id:"greef", river:"nplattereef", name:"Grey Reef Dam ramp", role:"launch", pos:[42.5550,-106.7100], note:"The famous tailwater launch below Alcova."},
  {id:"govbr", river:"nplattereef", name:"Government Bridge", role:"takeout", pos:[42.6300,-106.5500], note:"Standard Grey Reef day-float take-out."},
  // Bighorn / Wind
  {id:"wow",   river:"bighorn", name:"Wedding of the Waters", role:"launch", pos:[43.5800,-108.2100], note:"Where the Wind becomes the Bighorn."},
  {id:"thermo",river:"bighorn", name:"Hot Springs State Park (Thermopolis)", role:"takeout", pos:[43.6520,-108.2000], note:"Take out by the travertine terraces."},
  {id:"boysd", river:"wind", name:"Boysen Dam (canyon put-in)", role:"launch", pos:[43.4180,-108.1800], note:"Wind River Canyon — tribal permit + Class III–IV."},
  // Green
  {id:"warrb", river:"green", name:"Warren Bridge (Hwy 191)", role:"launch", pos:[43.0190,-110.1180], note:"BLM ramp; upper Green classic."},
  {id:"danl",  river:"green", name:"Daniel Bridge", role:"takeout", pos:[42.8700,-110.0700], note:"Take-out near the Daniel junction."},
  // Salmon
  {id:"shoupb",river:"salmon", name:"Shoup Bridge", role:"launch", pos:[45.1300,-113.8950], note:"ID F&G access south of Salmon."},
  {id:"islp",  river:"salmon", name:"Island Park ramp (Salmon)", role:"takeout", pos:[45.1830,-113.8950], note:"Town take-out in Salmon."},
  {id:"shorts",river:"salmon", name:"Shorts Bar (Riggins)", role:"launch", pos:[45.4300,-116.3000], note:"Riggins day-stretch put-in."},
  {id:"lucile",river:"salmon", name:"Lucile", role:"takeout", pos:[45.5300,-116.3000], note:"Take-out 9 miles downstream of Riggins."},
  // Middle Fork
  {id:"bndry", river:"mfsalmon", name:"Boundary Creek", role:"launch", pos:[44.5500,-115.2900], note:"Permit launch — ranger check-in required."},
  {id:"cache", river:"mfsalmon", name:"Cache Bar", role:"takeout", pos:[45.3000,-114.6000], note:"Take-out on the main Salmon, 100 miles later."},
  // Hells Canyon
  {id:"hcd",   river:"hellscanyon", name:"Hells Canyon Dam launch", role:"launch", pos:[45.2420,-116.6960], note:"Permit season applies; check Forest Service."},
  {id:"pitts", river:"hellscanyon", name:"Pittsburg Landing", role:"takeout", pos:[45.6300,-116.4700], note:"Road take-out on the Idaho side."},
  // Payette / Boise
  {id:"banks", river:"payette", name:"Banks", role:"launch", pos:[44.0800,-116.1200], note:"Confluence hub of Idaho whitewater."},
  {id:"beehi", river:"payette", name:"Beehive Bend", role:"takeout", pos:[43.9700,-116.1700], note:"Main Payette day-run take-out."},
  {id:"barbr", river:"boise", name:"Barber Park", role:"launch", pos:[43.5640,-116.1330], note:"Boise town-float launch (tube central)."},
  {id:"annm",  river:"boise", name:"Ann Morrison Park", role:"takeout", pos:[43.6080,-116.2200], note:"Downtown take-out."},
  {id:"ardam", river:"sfboise", name:"Anderson Ranch Dam", role:"launch", pos:[43.3430,-115.4770], note:"Canyon launch; rough road in."},
  {id:"dansk", river:"sfboise", name:"Danskin Bridge", role:"takeout", pos:[43.3150,-115.6600], note:"Take-out before Neal Bridge rapids."},
  // Shoshone
  {id:"demar", river:"shoshone", name:"DeMaris (Cody)", role:"launch", pos:[44.5230,-109.1000], note:"Below the canyon; check flows first."},
  {id:"corbt", river:"shoshone", name:"Corbett Bridge", role:"takeout", pos:[44.6100,-108.9500], note:"Standard Cody-area take-out."},
  // Wade-only access highlights
  {id:"fcref", river:"flatcreek", name:"Elk Refuge walk-in", role:"wade", pos:[43.4960,-110.7350], note:"Park along Refuge Rd; fishing Aug 1–Oct 31."},
  {id:"gvkel", river:"grosventre", name:"Kelly / Slide Lake stretch", role:"wade", pos:[43.6270,-110.6120], note:"Pocket water along Gros Ventre Rd."},
  {id:"bfturp",river:"buffalofork", name:"Turpin Meadow", role:"wade", pos:[43.8570,-110.2700], note:"Grizzly country — carry spray."},
  {id:"hobw",  river:"hoback", name:"Hoback Canyon pullouts", role:"wade", pos:[43.2750,-110.5600], note:"Dozens of US-191 pullouts."},
  {id:"greyw", river:"greys", name:"Lower Greys (FR 10138)", role:"wade", pos:[43.1200,-110.9900], note:"Gravel road parallels the whole river."},
  {id:"harrim",river:"henrysfork", name:"Harriman State Park (the Ranch)", role:"wade", pos:[44.3300,-111.4600], note:"Walk-in flats; opens June 15."},
  {id:"silvp", river:"silvercreek", name:"Silver Creek Preserve", role:"wade", pos:[43.3250,-114.1200], note:"Sign in at the visitor cabin; float tubes OK."},
  {id:"bwhail",river:"bigwood", name:"Hailey / Ketchum easements", role:"wade", pos:[43.6000,-114.3400], note:"Public access well-marked along Hwy 75."},
  {id:"joeav", river:"stjoe", name:"Avery upstream (FR 50)", role:"wade", pos:[47.2500,-115.8100], note:"C&R cutthroat water above Prospector Cr."},
  {id:"lochw", river:"lochsa", name:"US-12 pullouts (Lochsa)", role:"wade", pos:[46.3000,-115.2500], note:"Pick a pullout, drop to the river."},
  {id:"nfcw",  river:"nfclearwater", name:"Aquarius / Kelly Forks", role:"wade", pos:[46.7800,-115.5500], note:"Long gravel drive; worth it."},
  {id:"tongc", river:"tonguewy", name:"Tongue River Canyon trailhead", role:"wade", pos:[44.8500,-107.3500], note:"Hike-in limestone canyon."},
  {id:"nfsw",  river:"nfshoshone", name:"Wapiti Valley pullouts", role:"wade", pos:[44.4700,-109.5500], note:"US-14/16/20 roadside access for 40 miles."},
  {id:"dubw",  river:"wind", name:"Dubois town water", role:"wade", pos:[43.5350,-109.6300], note:"Public access through town; ask shops about leases."},
  {id:"encw",  river:"encampmentwy", name:"Encampment River Trail", role:"wade", pos:[41.1700,-106.8000], note:"Trail follows the canyon upstream."},
  {id:"larw",  river:"laramiewy", name:"Monolith Ranch / Optimist Park", role:"wade", pos:[41.2900,-105.6200], note:"City-managed public fishing water."},
  {id:"lemw",  river:"lemhi", name:"ID F&G Lemhi access sites", role:"wade", pos:[44.9400,-113.6300], note:"Signed sportsman accesses off Hwy 28."},
  {id:"cdaw",  river:"cda", name:"NF Coeur d'Alene (FR 9)", role:"wade", pos:[47.6400,-115.9700], note:"Road follows the NF; endless pullouts."},
  {id:"bohw",  river:"biglost", name:"Below Mackay Dam", role:"wade", pos:[43.9100,-113.6100], note:"Short canyon below the reservoir."},
  // ---- Central Iowa water trails ----
  {id:"cottonwood", river:"desmoines", name:"Cottonwood Recreation Area", role:"launch", pos:[41.6980,-93.6450], note:"Below Saylorville Dam — top of the Polk County water trail segment."},
  {id:"riverwalk", river:"desmoines", name:"Principal Riverwalk / Water Works Park", role:"both", pos:[41.5800,-93.6350], note:"Downtown whitewater park feature — scout it before running it."},
  {id:"yellowbanks", river:"desmoines", name:"Yellow Banks County Park", role:"takeout", pos:[41.4800,-93.4900], note:"Bottom of the 20-mile designated Polk County segment."},
  {id:"walnutwoods", river:"raccoon", name:"Walnut Woods State Park", role:"launch", pos:[41.5730,-93.6900], note:"Standard put-in for the classic town float."},
  {id:"waterworks", river:"raccoon", name:"Water Works Park / Fleur Drive", role:"takeout", pos:[41.5760,-93.6500], note:"~4-hour paddle from Walnut Woods at normal flows."},
  {id:"vanmeterr", river:"raccoon", name:"Van Meter access", role:"launch", pos:[41.5340,-93.9498], note:"Upstream put-in near the North/Middle/South Raccoon confluence."},
  {id:"dawson", river:"nraccoon", name:"Dawson Boat Ramp", role:"launch", pos:[41.7975,-94.1667], note:"1 mile north of Dawson, Dallas County."},
  {id:"booneville", river:"nraccoon", name:"Booneville Access", role:"takeout", pos:[41.7300,-94.0500], note:"8.1 miles downstream of Dawson."},
  {id:"lennonmill", river:"mraccoon", name:"Lennon Mill Park (Panora)", role:"launch", pos:[41.6942,-94.3700], note:"In-town put-in below Lake Panora."},
  {id:"mrconfl", river:"mraccoon", name:"Redfield confluence access", role:"takeout", pos:[41.6100,-94.2200], note:"Take out where the Middle and South Raccoon join."},
  {id:"nationsbridge", river:"sraccoon", name:"Nations Bridge Park", role:"launch", pos:[41.6400,-94.3800], note:"Guthrie County put-in."},
  {id:"srconfl", river:"sraccoon", name:"Redfield confluence access", role:"takeout", pos:[41.6100,-94.2200], note:"Same take-out as the Middle Raccoon, just below Redfield."},
  {id:"sleepyhollow", river:"sskunk", name:"Sleepy Hollow Access", role:"launch", pos:[42.0450,-93.6280], note:"646 W. Riverside Rd, Ames."},
  {id:"rivervalley", river:"sskunk", name:"River Valley Park (Ames)", role:"takeout", pos:[41.9900,-93.6200], note:"Standard in-town take-out."},
  {id:"lewclarkson", river:"beavercreek", name:"Lew Clarkson Park (Johnston)", role:"wade", pos:[41.6900,-93.7100], note:"Kayak access point; small creek, no formal second access confirmed."},

  /* ---- DRIFTLESS ACCESS ----
     Almost everything here is role:"wade" — park and walk. These are
     anchor points (state parks, DNR fishery/wildlife areas, county
     parks, hatcheries, bridge pull-offs), not an exhaustive list:
     Iowa, Minnesota and Wisconsin all run stream-bank easement
     programs that open many more miles than are marked here, signed
     at the road. Positions are approximate to the access area.
     Always confirm the current easement map and regulations with the
     state agency before you rely on a spot. */
  // ---- Iowa Driftless ----
  {id:"uibluff",  river:"upperiowa", name:"Bluffton access", role:"both", pos:[43.4069,-91.8990], note:"Canoe access and gauge site below the Bluffton bluffs; top of the classic float to Decorah."},
  {id:"uichimney",river:"upperiowa", name:"Chimney Rock / Kendallville area", role:"launch", pos:[43.4330,-91.9650], note:"Outfitter and canoe access on the upper river; the coldest, most trout-like reach."},
  {id:"uidecorah",river:"upperiowa", name:"Decorah — Twin Springs / city access", role:"both", pos:[43.3049,-91.7955], note:"In-town river access with parking; USGS gauge here. Smallmouth water through town."},
  {id:"uidorch",  river:"upperiowa", name:"Dorchester bridge access", role:"takeout", pos:[43.4211,-91.5088], note:"Lower-river access near the Waterloo Creek confluence; gauge at the bridge."},
  {id:"watcr1",   river:"waterloocreek", name:"Waterloo Creek — Dorchester", role:"wade", pos:[43.4511,-91.5051], note:"Roadside parking along the valley road north of Dorchester; gauge site. Walk upstream for better fish."},
  {id:"watcr2",   river:"waterloocreek", name:"Waterloo Creek — upper valley", role:"wade", pos:[43.4800,-91.5400], note:"Pull-offs toward the Minnesota line; tight brushy water, short rod."},
  {id:"trhatch",  river:"troutrunia", name:"Decorah Fish Hatchery", role:"wade", pos:[43.2870,-91.7550], note:"Hatchery parking on Trout Run; heavily stocked and heavily fished. Trout Run Trail parallels the creek."},
  {id:"trupper",  river:"troutrunia", name:"Trout Run — upper valley", role:"wade", pos:[43.2600,-91.7380], note:"Trail and roadside parking upstream of the hatchery; walk away from the lots for better water."},
  {id:"coldw1",   river:"coldwaterIA", name:"Coldwater Creek access", role:"wade", pos:[43.4200,-91.8870], note:"Iowa DNR access in the Coldwater valley; spring-fed and cold through summer."},
  {id:"sbear1",   river:"southbear", name:"South Bear — Highlandville", role:"wade", pos:[43.4122,-91.7290], note:"DNR parking at Highlandville; special regulations apply on parts of this stream — read the current trout regs."},
  {id:"sbear2",   river:"southbear", name:"South Bear — lower valley", role:"wade", pos:[43.3960,-91.7120], note:"Pull-off downstream toward the Upper Iowa confluence."},
  {id:"nbear1",   river:"northbear", name:"North Bear Creek access", role:"wade", pos:[43.4400,-91.7480], note:"Roadside parking in the North Bear valley; brushy small water."},
  {id:"canoe1",   river:"canoecreek", name:"Canoe Creek access", role:"wade", pos:[43.3860,-91.7080], note:"Bridge pull-off northeast of Decorah; quieter than Trout Run."},
  {id:"french1",  river:"frenchcreek", name:"French Creek Wildlife Area", role:"wade", pos:[43.4400,-91.3600], note:"DNR wildlife area parking; managed wild brown trout water — check current special regulations."},
  {id:"paint1",   river:"paintcreek", name:"Yellow River State Forest HQ", role:"wade", pos:[43.1800,-91.2420], note:"State forest parking and campground; miles of public bank on Paint Creek."},
  {id:"paint2",   river:"paintcreek", name:"Paint Creek — Waterville", role:"wade", pos:[43.2172,-91.2905], note:"Upper-valley access near Waterville; colder water, wild fish."},
  {id:"village1", river:"villagecreek", name:"Village Creek access", role:"wade", pos:[43.3600,-91.2800], note:"Roadside parking in the valley behind Lansing."},
  {id:"clearia1", river:"clearcreekia", name:"Clear Creek access", role:"wade", pos:[43.3000,-91.2800], note:"Bluff-valley pull-off near Lansing; clear, technical water."},
  {id:"yellow1",  river:"yellowriver", name:"Yellow River — Ion gauge", role:"wade", pos:[43.1119,-91.2651], note:"Bridge access at the gauge; smallmouth water here, trout in the upper valley."},
  {id:"yellow2",  river:"yellowriver", name:"Effigy Mounds / river mouth", role:"wade", pos:[43.0957,-91.2202], note:"National monument parking near the Mississippi confluence."},
  {id:"bloody1",  river:"bloodyrun", name:"Bloody Run County Park", role:"wade", pos:[43.0408,-91.2065], note:"Clayton County park with campground and creekside parking; gauge on site. Walk upstream from the campground."},
  {id:"snymag1",  river:"snymagill", name:"Sny Magill Creek access", role:"wade", pos:[42.9200,-91.1400], note:"Public access near the Sny Magill Mound Group; cold spring water, good in hot weather."},
  {id:"turkey1",  river:"turkeyriver", name:"Turkey River — Elkader", role:"both", pos:[42.8435,-91.4013], note:"In-town access and gauge; good smallmouth float water above and below."},
  {id:"turkey2",  river:"turkeyriver", name:"Turkey River — Spillville", role:"launch", pos:[43.2073,-91.9503], note:"Upper-river access and gauge in Winneshiek County."},
  {id:"volga1",   river:"volgariver", name:"Volga River State Recreation Area", role:"wade", pos:[42.8200,-91.7400], note:"State recreation area with camping, trails and public bank on the Volga."},
  {id:"volga2",   river:"volgariver", name:"Littleport gauge access", role:"takeout", pos:[42.7539,-91.3690], note:"Bridge access at the gauge near the Turkey confluence."},
  {id:"bigspr1",  river:"springbranchia", name:"Big Spring Fish Hatchery", role:"wade", pos:[42.8450,-91.4300], note:"Hatchery parking on Spring Branch; very stable spring flows — a dependable wet-weather fallback."},
  {id:"grannis1", river:"grannis", name:"Grannis Creek access", role:"wade", pos:[42.9611,-91.8118], note:"Roadside parking near West Union, Fayette County."},
  {id:"otteria1", river:"ottercreekia", name:"Otter Creek — Elgin", role:"wade", pos:[42.9575,-91.6379], note:"Fayette County access near Elgin; pairs well with Grannis Creek."},
  {id:"backbone1",river:"richmondsprings", name:"Backbone State Park — Richmond Springs", role:"wade", pos:[42.6203,-91.5697], note:"Iowa's oldest state park: paved parking, campground, trails, easy family access to the spring branch."},

  // ---- Minnesota Driftless ----
  {id:"rootlane", river:"rootriver", name:"Lanesboro river access", role:"both", pos:[43.7183,-91.9762], note:"Town access with outfitters and the Root River State Trail; canoe and wade water both directions."},
  {id:"rootrush", river:"rootriver", name:"Rushford access", role:"both", pos:[43.8083,-91.7524], note:"Trailhead town on the Root; canoe landing and bank access."},
  {id:"roothous", river:"rootriver", name:"Houston — gauge access", role:"wade", pos:[43.7686,-91.5699], note:"Bridge access at the USGS gauge; smallmouth water this far down."},
  {id:"sbrpreston",river:"sbranchroot", name:"Preston river access", role:"wade", pos:[43.6702,-92.0824], note:"In-town parking on the South Branch; extensive state easement water upstream and down."},
  {id:"sbrforest",river:"sbranchroot", name:"Forestville State Park", role:"wade", pos:[43.6353,-92.2168], note:"State park lot (vehicle permit required); the South Branch and Canfield Creek both run through here."},
  {id:"nbrchat",  river:"nbranchroot", name:"Chatfield river access", role:"wade", pos:[43.8458,-92.1888], note:"Town access on the North Branch; easement signs mark walk-in water down the valley."},
  {id:"mbrfount", river:"mbranchroot", name:"Fountain area access", role:"wade", pos:[43.7402,-92.1357], note:"Gravel pull-offs along the Middle Branch valley; small, brushy water."},
  {id:"sfroot1",  river:"sfroot", name:"South Fork — Houston gauge", role:"wade", pos:[43.7388,-91.5643], note:"Bridge access at the gauge; the best live number for the whole southeast corner."},
  {id:"troutmn1", river:"troutrunmn", name:"Trout Run Creek — Troy", role:"wade", pos:[43.7800,-92.1000], note:"State easement parking in the Troy valley; restored riffle-pool habitat."},
  {id:"duschee1", river:"duschee", name:"Duschee Creek access", role:"wade", pos:[43.7000,-91.9820], note:"Just south of Lanesboro; clears faster than the South Branch after rain."},
  {id:"canfield1",river:"canfield", name:"Forestville / Mystery Cave State Park", role:"wade", pos:[43.6353,-92.2168], note:"Spring-fed and cold year-round; park vehicle permit required. Historic townsite and campground on site."},
  {id:"campmn1",  river:"campcreekmn", name:"Camp Creek access", role:"wade", pos:[43.6400,-92.0950], note:"Fillmore County pull-off between Forestville and Preston."},
  {id:"wwpark",   river:"whitewater", name:"Whitewater State Park (Elba)", role:"wade", pos:[44.0864,-92.0182], note:"Park lots, campground and visitor center right on the river; vehicle permit required. Busy on weekends."},
  {id:"wwwma",    river:"whitewater", name:"Whitewater WMA — Elba north", role:"wade", pos:[44.1400,-91.9700], note:"27,000-acre wildlife management area: gravel lots, no permit needed, far fewer people than the park."},
  {id:"nfww1",    river:"nfwhitewater", name:"North Fork — WMA access", role:"wade", pos:[44.1100,-92.0900], note:"WMA parking above Elba; steep wooded valley, plunge-pool water."},
  {id:"mfww1",    river:"mfwhitewater", name:"Middle Fork — WMA access", role:"wade", pos:[44.0450,-92.1000], note:"Quietest of the three forks; gravel pull-off access."},
  {id:"sfww1",    river:"sfwhitewater", name:"South Fork — St. Charles area", role:"wade", pos:[44.0100,-92.0600], note:"Open meadow water; longer casts and spookier trout."},
  {id:"garvin1",  river:"garvinbrook", name:"Garvin Brook — Stockton", role:"wade", pos:[44.0322,-91.7793], note:"Valley-road parking near Stockton; restored habitat sections hold fish well."},
  {id:"bcvsp",    river:"beavercreekmn", name:"Beaver Creek Valley State Park", role:"wade", pos:[43.6425,-91.5722], note:"Big Spring at the head of the valley keeps it cold all summer; campground, vehicle permit required."},
  {id:"rushmn1",  river:"rushcreekmn", name:"Rush Creek access — Rushford", role:"wade", pos:[43.8324,-91.7767], note:"Stage-only USGS gauge here — no CFS. Easement water up the valley."},
  {id:"crookmn1", river:"crookedcreekmn", name:"Crooked Creek — Freeburg", role:"wade", pos:[43.6107,-91.3612], note:"Far southeast corner; stage-only gauge. Very lightly fished."},
  {id:"winne1",   river:"winnebagocr", name:"Winnebago Creek — Eitzen", role:"wade", pos:[43.5400,-91.3400], note:"Minutes from the Iowa line; pairs with French Creek or Waterloo Creek."},
  {id:"pinemn1",  river:"pinecreekmn", name:"Pine Creek access", role:"wade", pos:[43.7000,-91.3600], note:"Bluff-country creek between La Crescent and Hokah."},
  {id:"hay1",     river:"haycreek", name:"Hay Creek Unit — state forest", role:"wade", pos:[44.5200,-92.5450], note:"Dorer Memorial Hardwood State Forest parking south of Red Wing; closest quality trout water to the Twin Cities."},
  {id:"verm1",    river:"vermillionmn", name:"Vermillion River — Hastings area", role:"wade", pos:[44.7400,-92.9500], note:"Metro-edge spring creek; special regulations apply on parts — check current MN DNR trout rules."},

  // ---- Wisconsin Driftless ----
  {id:"timber1",  river:"timbercoulee", name:"Timber Coulee — County P pull-offs", role:"wade", pos:[43.5400,-90.9600], note:"A string of gravel easement pull-offs up the coulee. The first few fill early — keep driving."},
  {id:"timber2",  river:"timbercoulee", name:"Timber Coulee — upper valley", role:"wade", pos:[43.5850,-90.9080], note:"Upper reaches toward the Westby ridge; smaller water, fewer anglers."},
  {id:"coon1",    river:"cooncreek", name:"Coon Valley village access", role:"wade", pos:[43.5022,-90.9932], note:"Where Timber Coulee meets Coon Creek — the historic heart of Driftless stream restoration."},
  {id:"coon2",    river:"cooncreek", name:"Coon Creek — Chaseburg", role:"wade", pos:[43.6469,-91.0335], note:"Bigger water downstream; room for a real cast and bigger average fish."},
  {id:"springc1", river:"springcoulee", name:"Spring Coulee Creek access", role:"wade", pos:[43.5300,-90.9600], note:"Restored tributary above Coon Valley; good overflow when Timber Coulee is busy."},
  {id:"bohem1",   river:"bohemianvalley", name:"Bohemian Valley access", role:"wade", pos:[43.6380,-90.9900], note:"La Crosse County coulee above Chaseburg; brushy small water."},
  {id:"rulland1", river:"rullandscoulee", name:"Rullands Coulee access", role:"wade", pos:[43.6300,-91.0500], note:"Small Coon Creek feeder; jump-across water."},
  {id:"kickont",  river:"kickapoo", name:"Ontario canoe landing", role:"launch", pos:[43.7299,-90.5889], note:"Top of the Kickapoo Valley Reserve paddle; trout water in this cold upper reach. Gauge at the Hwy 131 bridge."},
  {id:"kickkvr",  river:"kickapoo", name:"Kickapoo Valley Reserve HQ", role:"both", pos:[43.6100,-90.6250], note:"8,600-acre reserve: visitor center, trails, multiple river accesses between Ontario and La Farge."},
  {id:"kicklaf",  river:"kickapoo", name:"La Farge landing", role:"both", pos:[43.5742,-90.6432], note:"Canoe landing and USGS gauge; smallmouth water from here down."},
  {id:"kickgays", river:"kickapoo", name:"Gays Mills river access", role:"both", pos:[43.3181,-90.8496], note:"Lower-valley landing; the crookedest miles of the crookedest river."},
  {id:"wfork1",   river:"wforkkickapoo", name:"Avalanche access", role:"wade", pos:[43.5183,-90.7118], note:"Heart of the catch-and-release stretch — check current WI DNR regs, they vary by reach. Campground nearby."},
  {id:"wfork2",   river:"wforkkickapoo", name:"Bloomingdale access", role:"wade", pos:[43.5905,-90.7274], note:"Upper West Fork; easement pull-offs along the valley road."},
  {id:"wfork3",   river:"wforkkickapoo", name:"West Fork Sports Club water", role:"wade", pos:[43.5500,-90.7180], note:"Club-stewarded habitat reaches; decades of lunker-structure and bank work."},
  {id:"tainter1", river:"tainter", name:"Tainter Creek access", role:"wade", pos:[43.3900,-90.9000], note:"Crawford/Vernon county line; active watershed council habitat work."},
  {id:"knapp1",   river:"knappcreek", name:"Knapp Creek access", role:"wade", pos:[43.4200,-90.8400], note:"Soldiers Grove area Kickapoo tributary."},
  {id:"badaxe1",  river:"badaxe", name:"Bad Axe — Viroqua ridge", role:"wade", pos:[43.5870,-90.9500], note:"Upper forks above Viroqua; easement access with more casting room than the coulee creeks."},
  {id:"badaxe2",  river:"badaxe", name:"Bad Axe — Genoa", role:"wade", pos:[43.5760,-91.1800], note:"Lower river toward the Mississippi; warms downstream."},
  {id:"rushwi1",  river:"rushcreekwi", name:"Rush Creek State Natural Area", role:"wade", pos:[43.3250,-91.0500], note:"Dry bluff prairie above Ferryville; steep walk down to cold small water."},
  {id:"bec1",     river:"blackearth", name:"Black Earth Creek — Cross Plains", role:"wade", pos:[43.1147,-89.6641], note:"Upper creek with two USGS gauges nearby; 25 minutes from Madison, so expect company."},
  {id:"bec2",     river:"blackearth", name:"Black Earth Creek — Black Earth", role:"wade", pos:[43.1342,-89.7322], note:"Gauge site with village access; classic spring-creek water, educated fish."},
  {id:"bec3",     river:"blackearth", name:"Black Earth Creek — Mazomanie", role:"wade", pos:[43.1772,-89.7943], note:"Lower creek toward the Wisconsin River; DNR fishery area water."},
  {id:"mtvern1",  river:"mountvernon", name:"Mount Vernon Creek fishery area", role:"wade", pos:[42.9700,-89.5400], note:"DNR fishery area south of Verona; clear, technical spring water."},
  {id:"castle1",  river:"castlerock", name:"Castle Rock Creek — Fennimore Fork", role:"wade", pos:[43.0300,-90.5550], note:"Marquee Grant County spring creek; long catch-and-release stretch historically applies — check current WI DNR regs."},
  {id:"blue1",    river:"blueriver", name:"Blue River access", role:"wade", pos:[43.1100,-90.5800], note:"Easement pull-offs along the valley; pairs naturally with Castle Rock Creek."},
  {id:"biggrn1",  river:"biggreen", name:"Big Green River — Werley", role:"wade", pos:[43.0300,-90.7950], note:"Gravel-road access with pull-offs at the crossings; meadow water with undercut banks."},
  {id:"grant1",   river:"grantriver", name:"Grant River — Burton gauge", role:"wade", pos:[42.7203,-90.8192], note:"USGS gauge at the bridge; smallmouth here, trout in the upper branches."},
  {id:"grant2",   river:"grantriver", name:"Grant River — Lancaster area", role:"wade", pos:[42.8467,-90.7107], note:"Upper river and cold feeder branches; the trout water of the system."},
  {id:"platte1",  river:"platteriver", name:"Platte River — Platteville", role:"wade", pos:[42.7342,-90.4785], note:"DNR fishery area access near town; trout in the headwater branches."},
  {id:"ebpec1",   river:"ebpecatonica", name:"East Branch — Blanchardville", role:"wade", pos:[42.7856,-89.8611], note:"USGS gauge site; trout upstream in the cold branches."},
  {id:"kinni1",   river:"kinnickinnic", name:"River Falls city water", role:"wade", pos:[44.8613,-92.6237], note:"In-town access with parking; exceptional wild brown trout density right through the city."},
  {id:"kinni2",   river:"kinnickinnic", name:"Kinnickinnic State Park (gorge)", role:"wade", pos:[44.8069,-92.7469], note:"Park lot at the top — the gorge is a real hike down and back. Bigger fish for the effort."},
  {id:"rushriv1", river:"rushriverwi", name:"Rush River — El Paso", role:"wade", pos:[44.7500,-92.2900], note:"Middle river fishery area; the Kinni's quieter neighbour."},
  {id:"rushriv2", river:"rushriverwi", name:"Rush River — lower valley", role:"wade", pos:[44.6200,-92.2700], note:"Valley-road pull-offs toward Maiden Rock."},
  {id:"trimb1",   river:"trimbelle", name:"Trimbelle River access", role:"wade", pos:[44.6700,-92.5100], note:"Small Pierce County stream between the Kinni and the Rush."},
  {id:"eaugal1",  river:"eaugalle", name:"Spring Valley — gauge access", role:"wade", pos:[44.8528,-92.2383], note:"USGS gauge in town; trout water upstream of the reservoir."},
  {id:"lacr1",    river:"lacrosseriver", name:"Sparta river access", role:"both", pos:[43.9375,-90.8106], note:"Gauge site and trail town; trout above Sparta, warmwater below."},
  {id:"silvwi1",  river:"silvercreekwi", name:"Silver Creek — Hwy 21, Angelo", role:"wade", pos:[43.9672,-90.7650], note:"Gauge is right on the creek — a rare case where the CFS describes the water you're standing in."},
  {id:"still1",   river:"stillwell", name:"Stillwell Creek — Tomah", role:"wade", pos:[43.9939,-90.6572], note:"Very small water with its own gauge; single-digit CFS at low flow. Short rod."},
  {id:"elkwi1",   river:"elkcreekwi", name:"Elk Creek — Independence", role:"wade", pos:[44.3800,-91.4000], note:"Trempealeau County coulee; brook trout in the cold headwaters."},
  {id:"tremp1",   river:"trempealeau", name:"Arcadia — gauge access", role:"both", pos:[44.2544,-91.5053], note:"USGS gauge and river access; smallmouth here, trout in the feeder coulees."},
  {id:"buffwi1",  river:"buffalowi", name:"Buffalo River — Mondovi", role:"wade", pos:[44.5666,-91.6712], note:"Northern Driftless; trout in the upper branches, among the least-fished quality water in the state."},
  {id:"pinewi1",  river:"pineriverwi", name:"Pine River — Richland Center", role:"wade", pos:[43.3336,-90.3862], note:"Town access; trout in the upper river and the ridge-country feeder creeks."},

  // ---- Illinois Driftless ----
  {id:"applesp",  river:"appleriver", name:"Apple River Canyon State Park", role:"wade", pos:[42.4408,-90.0447], note:"Limestone canyon, campground and trails. Illinois runs a stocked catch-and-keep trout season at designated sites — check current IDNR listings and dates."},
  {id:"appleeliz",river:"appleriver", name:"Apple River — Elizabeth area", role:"wade", pos:[42.3192,-90.2262], note:"Lower river; smallmouth bass water outside the stocked trout season."},
];

/* ---------- Float sections ---------- */
// typSpeed = typical float speed (mph) at around-average flow
const SECTIONS = [
  // --- added with expanded Jackson/Victor/Swan access set ---
  {id:"s8", river:"snake", name:"Pritchard → West Table", put:"pritch", take:"wtab",
   miles:8.0, klass:"II", beginner:false, typSpeed:4.3,
   notes:"The braided canyon-approach run below Astoria — fast, wood-strewn channels that re-converge. Take out at West Table unless you're committed to the Class III below.",
   shuttle:"BTNF permit required May 1–Nov 1; US-89 turnouts, Jackson/Alpine outfitters shuttle."},
  {id:"f5", river:"southfork", name:"Canyon (upper): Conant → Cottonwood", put:"conan", take:"cott",
   miles:13.0, klass:"II", beginner:false, typSpeed:4.2,
   notes:"First half of the roadless canyon — cliffs, side streams, and the 16 designated camps begin here. A common overnight put-in.",
   shuttle:"Interagency fee site; long shuttle via Swan Valley Hwy — book through a fly shop."},
  {id:"f6", river:"southfork", name:"Canyon (lower): Cottonwood → Byington", put:"cott", take:"bying",
   miles:12.0, klass:"II", beginner:false, typSpeed:4.2,
   notes:"Second half out of the canyon. Watch the 'Devils Kitchen' S-bend and an irrigation channel/boulders just above Byington.",
   shuttle:"~45 min via Ririe; Swan Valley shops run it."},
  {id:"f7", river:"southfork", name:"Lower river: Byington → Heise", put:"bying", take:"heise",
   miles:6.5, klass:"I", beginner:true, typSpeed:4.0,
   notes:"Mellow water below the canyon past the hot springs — cottonwood islands and easy banks, far fewer boats than the canyon.",
   shuttle:"Short shuttle on the Heise/Ririe roads."},
  {id:"t3", river:"teton", name:"Fox Creek → Bates Bridge", put:"foxc", take:"bates",
   miles:6.0, klass:"I", beginner:true, typSpeed:2.2,
   notes:"The quiet upper valley — placid, shallow, SUP-friendly water. Fox Creek is a short carry to the river.",
   shuttle:"Driggs/Victor rental shops shuttle the valley accesses."},
  {id:"t4", river:"teton", name:"Rainey (Big Eddy) → Cache Bridge", put:"rain", take:"tcache",
   miles:5.0, klass:"I", beginner:true, typSpeed:2.4,
   notes:"Glassy meadow bends with the Tetons on full display; moose are common. Slow current — budget more time than the miles imply.",
   shuttle:"Easy valley shuttle; Cache is the busiest access on weekends."},
  {id:"t5", river:"teton", name:"Cache Bridge → Harrops Bridge", put:"tcache", take:"harr",
   miles:4.0, klass:"I", beginner:true, typSpeed:2.5,
   notes:"The last mellow stretch. TAKE OUT AT HARROPS — below it the river drops into a Class IV–V canyon for experts only.",
   shuttle:"Hwy 33 two-car shuttle."},
  // Snake (Jackson)
  {id:"s1", river:"snake", name:"Jackson Lake Dam → Pacific Creek", put:"jld", take:"pac",
   miles:4.8, klass:"I", beginner:true, typSpeed:3.2,
   notes:"Flat, scenic dam water. Great first row and a solid wade/float fishery at the Oxbow. GTNP boat permit required.",
   shuttle:"Short shuttle along US-89/191; Signal Mountain area outfitters run this reach."},
  {id:"s2", river:"snake", name:"Pacific Creek → Deadman's Bar", put:"pac", take:"dead",
   miles:10.5, klass:"II", beginner:false, typSpeed:4.2,
   notes:"Braided channels and wood. Route-finding matters; channels move every spring.",
   shuttle:"GTNP concession shuttles or two-car; ~25 min drive."},
  {id:"s3", river:"snake", name:"Deadman's Bar → Moose", put:"dead", take:"moose",
   miles:10.2, klass:"II", beginner:false, typSpeed:4.5,
   notes:"The postcard float — and the park's most demanding rowing. Fast water, tight braids, strainers.",
   shuttle:"Triangle X and other park outfitters run scenic trips here."},
  {id:"s4", river:"snake", name:"Moose → Wilson Bridge", put:"moose", take:"wils",
   miles:13.0, klass:"II", beginner:false, typSpeed:4.5,
   notes:"Long braided reach leaving the park. Excellent fishing; still wood-hazard water.",
   shuttle:"~20 min via Moose-Wilson Rd (when open) or Hwy 89."},
  {id:"s5", river:"snake", name:"Wilson Bridge → South Park", put:"wils", take:"spark",
   miles:8.0, klass:"I-II", beginner:true, typSpeed:4.0,
   notes:"Mellower town stretch behind the levees. Evening caddis floats are a local ritual.",
   shuttle:"15 min on Hwy 89/22; several Jackson shops rent rafts for this reach."},
  {id:"s6", river:"snake", name:"South Park → Astoria", put:"spark", take:"astor",
   miles:9.5, klass:"I-II", beginner:true, typSpeed:4.0,
   notes:"Riffle-pool water past Hoback Junction. Take out at Astoria unless you mean to run the canyon.",
   shuttle:"US-26/89 follows the river; quick shuttle."},
  {id:"s7", river:"snake", name:"Snake River Canyon: West Table → Sheep Gulch", put:"wtab", take:"sheep",
   miles:8.1, klass:"III", beginner:false, typSpeed:5.0,
   notes:"Big Kahuna, Lunch Counter, Ropes — real whitewater, huge at high flows. Go commercial or go with someone who knows it.",
   shuttle:"Commercial outfitters in Jackson & Alpine run multiple daily trips."},
  // South Fork
  {id:"f1", river:"southfork", name:"Palisades Dam → Spring Creek Bridge", put:"pdam", take:"sprcr",
   miles:7.3, klass:"I", beginner:true, typSpeed:4.0,
   notes:"Classic upper tailwater: riffles, side channels, rising fish. Friendly rowing at normal releases.",
   shuttle:"US-26 parallels; Swan Valley fly shops run shuttles."},
  {id:"f2", river:"southfork", name:"Spring Creek → Conant", put:"sprcr", take:"conan",
   miles:7.0, klass:"I-II", beginner:true, typSpeed:4.0,
   notes:"More side channels and gravel bars. At high releases the water gets pushy — check CFS before committing.",
   shuttle:"Short hop on US-26."},
  {id:"f3", river:"southfork", name:"Canyon: Conant → Byington", put:"conan", take:"bying",
   miles:14.5, klass:"II", beginner:false, typSpeed:4.2,
   notes:"The famous roadless canyon. No bail-outs for 14 miles — commit to the full day.",
   shuttle:"Long shuttle (~45 min) via Ririe; book it through a Swan Valley shop."},
  {id:"f4", river:"southfork", name:"Byington → Lorenzo (Twin Bridges)", put:"bying", take:"loren",
   miles:8.5, klass:"I", beginner:true, typSpeed:4.0,
   notes:"The mellow lower river — cottonwood islands, big slow banks, fewer boats than the canyon.",
   shuttle:"Easy shuttle via Hwy 48/US-20."},
  // Teton
  {id:"t1", river:"teton", name:"Bates Bridge → Rainey Bridge", put:"bates", take:"rain",
   miles:6.0, klass:"I", beginner:true, typSpeed:2.4,
   notes:"Glassy meadow meanders — the best first-time rowing water in the region. Slow current; budget extra time.",
   shuttle:"10 min on valley back roads; Driggs/Victor shops shuttle."},
  {id:"t2", river:"teton", name:"Rainey → Harrops Bridge", put:"rain", take:"harr",
   miles:6.5, klass:"I", beginner:true, typSpeed:2.4,
   notes:"More spring-creek bends, rising fish on calm evenings. TAKE OUT AT HARROPS — Class IV–V canyon downstream.",
   shuttle:"Hwy 33 makes this an easy two-car shuttle."},
  // Salt
  {id:"sa1", river:"salt", name:"Etna → Salt River mouth (Alpine)", put:"etna", take:"saltm",
   miles:10.0, klass:"I", beginner:true, typSpeed:3.4,
   notes:"Gentle canoe water through ranchland. Mind fences and sweepers on outside bends.",
   shuttle:"US-89 through Star Valley; ~15 min."},
  // Henry's Fork
  {id:"h1", river:"henrysfork", name:"Box Canyon: Island Park Dam → Last Chance", put:"ipdam", take:"lastc",
   miles:3.2, klass:"II", beginner:false, typSpeed:3.8,
   notes:"Short, bouldery tailwater float over big fish. Take out at Last Chance — floating Harriman Ranch is prohibited.",
   shuttle:"Minutes along US-20; every Island Park shop shuttles it."},
  {id:"h2", river:"henrysfork", name:"Warm River → Ashton Reservoir", put:"warmr", take:"ashtr",
   miles:7.0, klass:"I-II", beginner:true, typSpeed:3.8,
   notes:"The classic family scenic float — riffles, wildlife, easy lines — that also fishes far better than the crowds suggest.",
   shuttle:"Hwy 47 'Mesa Falls Scenic Byway'; short shuttle."},
  {id:"h3", river:"henrysfork", name:"Ora Bridge → Chester backwater", put:"orab", take:"chest",
   miles:6.0, klass:"I", beginner:true, typSpeed:3.5,
   notes:"Lower-river riffle water below Ashton Dam — rainbow heaven during the early-season hatches.",
   shuttle:"Quick shuttle on Hwy 20 frontage roads."},
  // North Platte
  {id:"np1", river:"nplatteupper", name:"Treasure Island → Saratoga", put:"tisl", take:"sara",
   miles:9.0, klass:"I-II", beginner:true, typSpeed:3.6,
   notes:"Wyoming freestone classic — riffle corners, deep bends, browns on hoppers. Soak at the free hot springs after.",
   shuttle:"Hwy 130 south of town; local shops shuttle."},
  {id:"np2", river:"nplattereef", name:"Grey Reef Dam → Government Bridge", put:"greef", take:"govbr",
   miles:7.5, klass:"I", beginner:true, typSpeed:3.5,
   notes:"The marquee Wyoming tailwater float. Indicator nymphing factory; April crowds, October solitude.",
   shuttle:"Casper-area shops run daily shuttles."},
  // Bighorn / Wind
  {id:"bh1", river:"bighorn", name:"Wedding of the Waters → Thermopolis", put:"wow", take:"thermo",
   miles:4.5, klass:"I", beginner:true, typSpeed:3.5,
   notes:"Short, fishy, and forgiving — drift past the hot-spring terraces into town. Year-round fishery.",
   shuttle:"5-minute shuttle on US-20."},
  {id:"w1", river:"wind", name:"Wind River Canyon: Boysen Dam → Wedding of the Waters", put:"boysd", take:"wow",
   miles:10.0, klass:"III", beginner:false, typSpeed:4.5,
   notes:"Class III–IV through billion-year-old rock. Wind River Reservation — tribal fishing/floating permit AND guide requirements apply. Most go commercial.",
   shuttle:"US-20 runs the canyon rim."},
  // Green
  {id:"g1", river:"green", name:"Warren Bridge → Daniel", put:"warrb", take:"danl",
   miles:11.5, klass:"I", beginner:true, typSpeed:3.4,
   notes:"Sagebrush solitude with the Wind River Range filling the horizon. Browns, rainbows, the odd big fish on a hopper.",
   shuttle:"US-191/189; Pinedale shops shuttle."},
  // Salmon
  {id:"sl1", river:"salmon", name:"Shoup Bridge → Salmon (Island Park)", put:"shoupb", take:"islp",
   miles:5.5, klass:"I", beginner:true, typSpeed:3.8,
   notes:"Easy town float on the upper Salmon — cutthroat, rainbows, and Sacajawea history.",
   shuttle:"Minutes on Hwy 93."},
  {id:"sl2", river:"salmon", name:"Riggins day stretch: Shorts Bar → Lucile", put:"shorts", take:"lucile",
   miles:9.0, klass:"III", beginner:false, typSpeed:4.6,
   notes:"Big-water play rapids (Time Zone, Tight Squeeze) in the Riggins canyon. Raft country; great smallmouth in summer.",
   shuttle:"US-95 follows the river; outfitters everywhere in Riggins."},
  // Middle Fork
  {id:"mf1", river:"mfsalmon", name:"Middle Fork: Boundary Creek → Cache Bar", put:"bndry", take:"cache",
   miles:100, klass:"III", beginner:false, typSpeed:3.0,
   notes:"5–6 day permit-lottery wilderness expedition (Class III–IV). The float-time estimate below is river-time only — this is a multi-day trip, not a day float.",
   shuttle:"Outfitters handle logistics; private trips use Salmon-based shuttle services."},
  // Hells Canyon
  {id:"hc1", river:"hellscanyon", name:"Hells Canyon Dam → Pittsburg Landing", put:"hcd", take:"pitts",
   miles:32, klass:"III", beginner:false, typSpeed:4.5,
   notes:"Usually 2 days (camps on the beaches). Wild Sheep and Granite are Class IV at most flows. Permit required in the regulated season.",
   shuttle:"Long vehicle shuttle — most book jet-boat backhauls instead."},
  // Payette / Boise
  {id:"p1", river:"payette", name:"Main Payette: Banks → Beehive Bend", put:"banks", take:"beehi",
   miles:8.0, klass:"III", beginner:false, typSpeed:4.8,
   notes:"Idaho's most-floated whitewater day run — splashy, forgiving for a Class III, and dam-fed all summer. Commercial trips daily.",
   shuttle:"Hwy 55 shoulder shuttle; outfitters at Banks."},
  {id:"b1", river:"boise", name:"Boise town float: Barber Park → Ann Morrison", put:"barbr", take:"annm",
   miles:6.0, klass:"I", beginner:true, typSpeed:3.0,
   notes:"The famous summer tube float — and a legitimate trout fishery at the edges of it. Raft/tube rentals at Barber Park.",
   shuttle:"City shuttle bus runs the loop in summer."},
  {id:"sb1", river:"sfboise", name:"SF Boise: Anderson Ranch Dam → Danskin", put:"ardam", take:"dansk",
   miles:10.0, klass:"II", beginner:false, typSpeed:4.0,
   notes:"Canyon tailwater float over big rainbows. Below Danskin the river turns Class IV — take out here unless you know better.",
   shuttle:"Rough dirt roads; allow real time. Boise shops can arrange."},
  // Shoshone
  {id:"sh1", river:"shoshone", name:"DeMaris → Corbett Bridge (Cody)", put:"demar", take:"corbt",
   miles:11.0, klass:"I-II", beginner:true, typSpeed:4.0,
   notes:"Brown-trout tailwater below Cody's canyon. Irrigation-season releases change daily — check the gauge that morning.",
   shuttle:"Hwy 14A; Cody shops shuttle."},
  // ---- Central Iowa water trails ----
  {id:"dm1", river:"desmoines", name:"Cottonwood → Water Works Park (downtown)", put:"cottonwood", take:"riverwalk",
   miles:9.0, klass:"I", beginner:true, typSpeed:3.0,
   notes:"Flatwater through north Des Moines into downtown, finishing at the Riverwalk whitewater feature — scout it, or take out just above.",
   shuttle:"Short shuttle via 2nd Ave / I-235 corridor."},
  {id:"dm2", river:"desmoines", name:"Water Works Park → Yellow Banks County Park", put:"riverwalk", take:"yellowbanks",
   miles:11.0, klass:"I", beginner:true, typSpeed:3.0,
   notes:"Wide, slow water past Fort Des Moines and into rural Polk County — the quiet half of the water trail segment.",
   shuttle:"~20 min via County Hwy S6W."},
  {id:"rc1", river:"raccoon", name:"Walnut Woods → Water Works Park", put:"walnutwoods", take:"waterworks",
   miles:10.0, klass:"I", beginner:true, typSpeed:2.8,
   notes:"The standard Des Moines paddle — flat, wide, and easy, finishing at the confluence with the Des Moines River.",
   shuttle:"~15 min via Fleur Drive."},
  {id:"rc2", river:"raccoon", name:"Van Meter → Walnut Woods", put:"vanmeterr", take:"walnutwoods",
   miles:14.0, klass:"I", beginner:true, typSpeed:2.8,
   notes:"Rural run through Dallas County before the river enters West Des Moines.",
   shuttle:"~20 min via Hwy 6/Grand Ave."},
  {id:"nrc1", river:"nraccoon", name:"Dawson → Booneville", put:"dawson", take:"booneville",
   miles:8.1, klass:"I", beginner:true, typSpeed:2.5,
   notes:"The Dallas County stretch closest to Des Moines — quiet, rural, well-marked access.",
   shuttle:"Dallas County Conservation signs distance to the next access at every ramp."},
  {id:"mrc1", river:"mraccoon", name:"Lennon Mill → Redfield confluence", put:"lennonmill", take:"mrconfl",
   miles:9.0, klass:"I", beginner:true, typSpeed:2.6,
   notes:"Quick-moving water below the Panora dam, easing into flatwater toward the confluence.",
   shuttle:"~15 min via Hwy 44/141."},
  {id:"src1", river:"sraccoon", name:"Nations Bridge → Redfield confluence", put:"nationsbridge", take:"srconfl",
   miles:8.0, klass:"I", beginner:true, typSpeed:2.4,
   notes:"The smallest of the three forks — narrow, quiet, lightly used.",
   shuttle:"~15 min via county roads."},
  {id:"sk1", river:"sskunk", name:"Sleepy Hollow → River Valley Park", put:"sleepyhollow", take:"rivervalley",
   miles:5.0, klass:"I", beginner:true, typSpeed:2.3,
   notes:"The in-town Ames stretch — riffle-pool water, popular with ISU students.",
   shuttle:"Short shuttle within Ames."},
];

/* rivers with no float sections — floating note shown instead */
const WADE_ONLY = {
  flatcreek:"No floating — Flat Creek on the refuge is walk-in wade fishing only, open Aug 1–Oct 31 with special regulations.",
  grosventre:"Treated locally as a wade fishery. Kayakers run the upper canyon in runoff, but there are no maintained ramps — not a beginner float.",
  buffalofork:"Wade fishing from Turpin Meadow down. Deadfall and channel-spanning wood make floating a chore.",
  hoback:"Runoff-season paddling for experienced kayakers/packrafters; superb roadside wade fishing once flows drop.",
  greys:"Wade fishery along 60 miles of gravel road. Small-craft floating only at higher flows, with wood hazards.",
  fallriver:"Diversions and ledge drops make floating hazardous — fish it on foot.",
  silvercreek:"Float tubes only on parts of the Preserve; no boats. This is stalk-and-cast water.",
  bigwood:"A wade fishery end to end — narrow channels and irrigation diversions rule out real floating.",
  biglost:"Short wade-fishing canyon below the dam; the river dewaters downstream.",
  bruneau:"Class III–IV self-support expedition boating in a short spring window only. Not day-float water.",
  lemhi:"Small, brushy, and mostly private — a wade fishery via the signed F&G access sites.",
  littlesalmon:"Steep and rocky along US-95; expert kayak water at high flows, wade fishing otherwise.",
  lochsa:"Famous Class IV raft water at runoff (experienced crews only); a roadside wade fishery July–October.",
  selway:"Wilderness floating is by lottery permit (one launch/day). The road-accessible lower river is wade fishing.",
  clearwater:"Big water best covered by jet boat or drift boat with a steelhead guide; bank fishing is productive at the famous bars.",
  sfclearwater:"Roadside wade fishery; kayakers run it at spring flows.",
  nfclearwater:"Remote wade fishing; some raft the upper river in early summer — wood hazards, no services.",
  stjoe:"Wade fishery for most anglers; rafts and kayaks run the middle river at moderate flows.",
  cda:"Lazy lower-river paddling is possible (canoes/kayaks); the NF is a wade fishery with swimming holes.",
  kootenai:"Big, dam-controlled water — boat with someone who knows it; flows can triple on schedule.",
  priest:"Mellow canoe/kayak touring at moderate flows; no formal ramp network — plan your own access.",
  blackfootid:"Mostly a wade fishery; small rafts run the canyon at higher flows.",
  portneuf:"Town tubing at Lava Hot Springs aside, fish it on foot via the F&G easements.",
  bear:"Quiet canoe water in places, but diversion dams and fences make it a scout-first river. Most fish it on foot.",
  nfshoshone:"Some float it to the reservoir at moderate flows, but it's 90% a roadside wade fishery.",
  clarksfork:"The Box is Class V+ expert kayaking only. Everyone else wade-fishes the upper meadows and lower valley.",
  tonguewy:"A hike-in/wade fishery — the canyon is the draw.",
  newfork:"A genuine drift-boat river — Pinedale shops run guided floats; public ramps are limited, so most go guided.",
  encampmentwy:"Wilderness canyon — kayaks at runoff, boots the rest of the year.",
  laramiewy:"Wade fishery through the public reaches; canoe water east of town if you scout the diversions.",
  nfpayette:"Above Smiths Ferry: mellow floating. Below: 16 miles of Class V — among the hardest runnable whitewater anywhere. Know which half you're on.",
  snakeid:"Floatable in many reaches but dominated by reservoirs and diversions — go with local knowledge or a jet boat.",
  wind:"Above Boysen: wade fishing (permits on reservation water). The canyon float is listed below — permit and experience required.",
  beavercreek:"Only one confirmed formal access (Lew Clarkson Park in Johnston) — mostly an out-and-back paddle or a shuttle you arrange yourself. Small water; fishing is secondary to the paddle.",

  /* ---- Driftless ----
     The defining fact about Driftless trout water: it is walk-and-wade.
     These are spring creeks a few feet to a few yards wide, in tight
     wooded coulees, with fences, culverts and deadfall — you fish them
     on foot, from the bank or in the stream, working upstream. The only
     genuinely floatable water in the region is the handful of larger
     mainstems noted below. */
  upperiowa:"The one Iowa Driftless river you really can float — canoe/kayak the Bluffton→Decorah bluff run. Trout fishing is better on foot in the cold tributaries.",
  waterloocreek:"Wade only. A few feet wide in places; short rod, roll casts, and a willingness to crawl.",
  troutrunia:"Wade only, with the Trout Run Trail bike path paralleling the creek — easiest access in Iowa trout country.",
  coldwaterIA:"Wade only. Cold spring water; approach low and fish upstream.",
  southbear:"Wade only. Special regulations apply on parts of this stream — read the current Iowa DNR trout regs.",
  northbear:"Wade only. Brushy enough that spring and October are the comfortable windows.",
  canoecreek:"Wade only, despite the name — the canoe is historical, not practical.",
  frenchcreek:"Wade only. Managed wild-trout water; check the current special regulations before you fish it.",
  paintcreek:"Wade only. Yellow River State Forest gives you miles of public bank and a campground.",
  villagecreek:"Wade only. Short creek, steep bluffs, easy to pair with French or Clear Creek.",
  clearcreekia:"Wade only. Clear and technical — overcast days and low light are your friends.",
  yellowriver:"Canoeable in the lower reaches for smallmouth; the trout water upstream is wade fishing.",
  bloodyrun:"Wade only. County park parking right on the creek — walk upstream from the campground.",
  snymagill:"Wade only. Cold enough to fish through the hottest part of summer.",
  turkeyriver:"A legitimate smallmouth canoe river — the trout are in the spring-fed tributaries, fished on foot.",
  volgariver:"Smallmouth paddling on the mainstem; trout fishing on foot in the feeder creeks.",
  springbranchia:"Wade only. Very stable spring flows — the fallback when rain has blown out everything else.",
  grannis:"Wade only. Best in spring and fall.",
  ottercreekia:"Wade only. Quiet Fayette County small water.",
  richmondsprings:"Wade only. Easy, family-friendly state park access.",
  rootriver:"The one Minnesota Driftless stream you can reasonably canoe — the Root River State Trail follows it. The branches and tributaries are all wade fishing.",
  sbranchroot:"Wade only, but big enough to fish a 9-foot 5-weight comfortably — rare for the Driftless. Extensive state easement access.",
  nbranchroot:"Wade only. Long meadow stretches where the fish can see the sky — approach carefully.",
  mbranchroot:"Wade only. Tight and brushy; short rod, spring and fall.",
  sfroot:"Wade only. The gauge near Houston is the best live number for the southeast corner.",
  troutrunmn:"Wade only. Restored riffle-and-pool habitat with extensive public easement — walk well away from the crossings.",
  duschee:"Wade only. Clears faster than the South Branch after rain.",
  canfield:"Wade only, inside Forestville / Mystery Cave State Park. Vehicle permit required.",
  campcreekmn:"Wade only. Combine with Canfield Creek and the South Branch.",
  whitewater:"Wade only. State park plus a 27,000-acre WMA — more public trout water in one place than anywhere else in the Driftless.",
  nfwhitewater:"Wade only. The walk in from the WMA lots is the filter that keeps it quiet.",
  mfwhitewater:"Wade only. Quietest of the three Whitewater forks.",
  sfwhitewater:"Wade only. Open meadow water — longer casts, spookier trout, good terrestrial fishing in August.",
  garvinbrook:"Wade only. Restored riffle sections hold fish well; easy valley-road access.",
  beavercreekmn:"Wade only, inside Beaver Creek Valley State Park. Big Spring keeps it cold through summer; vehicle permit required.",
  rushcreekmn:"Wade only. The USGS site here reports stage, not discharge — use the Root at Pilot Mound for a flow read.",
  crookedcreekmn:"Wade only. Stage-only gauge, and among the least-pressured quality water in Minnesota.",
  winnebagocr:"Wade only. Minutes from the Iowa line — pair it with French or Waterloo Creek.",
  pinecreekmn:"Wade only. Short, steep, and easy to stop at when you're passing La Crosse.",
  haycreek:"Wade only, in the Dorer Memorial Hardwood State Forest. Weekday visits beat weekend metro traffic.",
  vermillionmn:"Wade only. Special regulations apply on parts — check current MN DNR trout rules.",
  timbercoulee:"Wade only. A string of County P easement pull-offs — the first few fill early, so keep driving.",
  cooncreek:"Wade only, but bigger than its famous tributaries: more room for a real cast and a bigger average fish.",
  springcoulee:"Wade only. Good overflow when the Timber Coulee pull-offs are full.",
  bohemianvalley:"Wade only. Brushy coulee water; short rod.",
  rullandscoulee:"Wade only. Jump-across water.",
  kickapoo:"The one real paddling river of the Wisconsin Driftless — 125 twisting miles, with the Kickapoo Valley Reserve protecting the upper valley. Trout fishing is on foot up around Ontario.",
  wforkkickapoo:"Wade only. A long catch-and-release stretch runs through the Avalanche area — check current WI DNR regs, which vary by reach.",
  tainter:"Wade only. Less famous than the West Fork a short drive away, which is the appeal.",
  knappcreek:"Wade only. A good add-on to a Kickapoo-corridor day.",
  badaxe:"Wade only. More casting room than the coulee creeks; good easement access.",
  rushcreekwi:"Wade only. Steep walk down from the bluff-prairie natural area.",
  blackearth:"Wade only. Two live gauges and heavy pressure — educated fish, classic spring-creek tactics.",
  mountvernon:"Wade only. Clear and technical; long leaders, small flies.",
  castlerock:"Wade only. Big-spring flows and genuine trophy potential for a creek this size. Check the current catch-and-release boundaries.",
  blueriver:"Wade only. Pairs naturally with Castle Rock Creek in the same day.",
  biggreen:"Wade only. Gravel-road access with pull-offs at the crossings.",
  grantriver:"Smallmouth paddling in the lower river; the trout water in the upper branches is wade fishing.",
  platteriver:"Smallmouth below, wade fishing for trout in the cold headwater branches.",
  ebpecatonica:"Wade only for the trout water in the upper branches.",
  kinnickinnic:"Wade only. The town water is easy; the gorge below is a real hike down and back — and holds the better fish.",
  rushriverwi:"Wade only. Extensive easement and DNR fishery area access along the valley road.",
  trimbelle:"Wade only. A good third stop on a Pierce County day.",
  eaugalle:"Wade only for the trout water above the reservoir.",
  lacrosseriver:"Canoeable below Sparta (and paralleled by the state trail); the trout water is upstream and in the feeder creeks, on foot.",
  silvercreekwi:"Wade only — and the gauge is right on the creek, so the CFS actually describes the water you're standing in.",
  stillwell:"Wade only. Single-digit CFS at low water; a 7-foot rod is plenty.",
  elkcreekwi:"Wade only. Brook trout in the cold headwaters.",
  trempealeau:"A decent smallmouth paddle; the trout are in Elk Creek and the other cold feeder coulees, fished on foot.",
  buffalowi:"Wade only for the trout in the upper branches; smallmouth downstream.",
  pineriverwi:"Smallmouth paddling below Richland Center; trout fishing on foot in the upper river and feeder creeks.",
  appleriver:"Wade only. Illinois runs a stocked catch-and-keep trout season at designated sites — check current IDNR listings and dates before planning around it.",
};
