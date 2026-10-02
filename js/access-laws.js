/* State stream-access law, one entry per state on the map.

   Whether you may wade a streambed, touch it from a boat or walk the bank
   changes at the state line, and getting it wrong is how anglers end up
   cited. So every entry quotes the state's own source: its 2026 fishing
   booklet where the booklet says it, otherwise the agency's own web page.
   Nothing here is from memory. Fetched 2026-10-02; the working notes with
   every quote and page number are in ~/.cache/flyfish-osm/accesslaw/notes.md.

   `head` is the one-line summary shown in the river panel. It is written
   to say no more than the quote under it. `quote` is verbatim. `src` names
   the document and `url` links to it. Where a state publishes no
   stream-access rule (AZ, NV, IL), the entry says that plainly rather
   than filling the gap with a guess. */
const ACCESS_LAW = {
  MT: {head:"Wade and fish up to the ordinary high-water mark — but reach the river from public land, a public bridge or a county road.",
       quote:"Under the Montana Stream Access Law, the public may use rivers and streams for recreational purposes up to the ordinary high-water marks. Although the law gives recreationists the right to use rivers and streams for water- related recreation, it does not give them the right to enter private lands bordering those streams or to cross private lands to gain access to streams without landowner permission.",
       src:"Montana FWP 2026 Fishing Regulations, p. 18", url:"https://fwp.mt.gov/fish/stream-access"},
  WY: {head:"Float through private land, but the bed is private: no wading, anchoring or getting out without the landowner's permission.",
       quote:"If the land adjacent to a stream, river or lake is privately owned, anglers and boaters must have permission from the landowner to wade, drop their anchor or get out of their boats. … Wyoming law allows boaters to float across private lands and portage around features such as logjams, fences and diversion structures.",
       src:"Wyoming Game & Fish", url:"https://wgfd.wyo.gov/Ask-Game-and-Fish/span-id-docs-internal-guid-e06514ae-7fff-e5a7-686c"},
  CO: {head:"Touching private land — the bed or the bank, on foot or by boat — without permission is trespass, posted or not.",
       quote:"It is illegal to go onto private land to fish without permission, including touching any part of private land by person or watercraft. Private land is not required to be posted or fenced. Trespassers may be suspended for up to five years.",
       src:"CPW 2026 Colorado Fishing, p. 11", url:"https://cpw.state.co.us/fishing"},
  ID: {head:"On navigable streams, stay below the normal high-water mark, and get in and out at a public right of way such as a county road bridge.",
       quote:"Navigable streams are recognized as public transportation corridors, thus members of the public have the right to use the corridor provided they enter and exit the corridor at a public right of way, and remain within the corridor. … YOU MUST STAY BELOW THE NORMAL HIGH-WATER MARK.",
       src:"IDFG 2025–2027 Fishing Seasons & Rules, p. 12", url:"https://idfg.idaho.gov/fish/rules"},
  UT: {head:"Float and fish from the boat over private land, but don't walk on a private bed. Touch it only as needed for safe passage.",
       quote:"The law does not allow recreational water users (including anglers, kayakers, tubers, hunters and others) to walk on the private bed of a public waterbody. … You may incidentally touch the private bed as required for safe passage and continued movement of you and your vessel.",
       src:"Utah DWR, Stream access", url:"https://wildlife.utah.gov/streamaccess"},
  WA: {head:"Trespass rules cover the streambed too: it is often private property.",
       quote:"Trespass on private property (which often includes the bed of a stream) regardless of whether there is an open season.",
       src:"WDFW 2026–27 Sport Fishing Rules, p. 10 (\"You May Not\")", url:"https://wdfw.wa.gov/fishing/regulations"},
  OR: {head:"On state-owned waterways you may use the bed and banks up to ordinary high water. Waterways that aren't state-owned or navigable are generally closed.",
       quote:"Use the riverbank below the line of ordinary high water for lawful activities like fishing, walking, collecting rocks, or birdwatching. … Waterways that are not Oregon-owned and not navigable-for-public-use are generally closed to the public.",
       src:"Oregon Department of State Lands, Public Use of Waterways", url:"https://www.oregon.gov/dsl/waterways/pages/public-use.aspx"},
  CA: {head:"On navigable water you may navigate and fish below the high-water mark, but not cross private land to reach it.",
       quote:"members of the public have the right to navigate and to exercise the incidents of navigation in a lawful manner at any point below high water mark on waters of this state which are capable of being navigated by oar or motor-propelled small craft. … This right to navigate does not include the right to trespass on private property along the waterway or to cross private lands uninvited in order to access the water.",
       src:"California State Lands Commission, FAQ", url:"https://www.slc.ca.gov/faqs/"},
  AK: {head:"On navigable and public waters you may use the water and the land below ordinary high water without permission, but not the private uplands.",
       quote:"While permission from the adjacent upland owner is not required for use of the water or land below the ordinary high water mark, the right to use the water does not include the right to enter, cross, or use private uplands except as minimally necessary to portage around obstacles or obstructions.",
       src:"ADF&G, Public Access to Alaska Waters", url:"https://www.adfg.alaska.gov/index.cfm?adfg=wildlifenews.view_article&articles_id=477"},
  WI: {head:"\"Keep your feet wet\": wade the stream. Use the bank only to get around an obstruction, by the shortest route.",
       quote:"Members of the public may use any exposed shore area of a stream without the permission of the riparian (i.e., landowner) only if it is necessary to exit the body of water to bypass an obstruction. … a member of the public may not enter the exposed shore area except: from the water, from a point of public access on the stream, or with the permission of the riparian (i.e., landowner).",
       src:"Wisconsin DNR, Stream access laws", url:"https://dnr.wisconsin.gov/topic/Fishing/questions/access.html"},
  MN: {head:"Walk in the water whoever owns the bed, as long as you reached it lawfully: public access, public land, a road right-of-way, or permission.",
       quote:"This includes walking in the water or on the ice regardless of who owns the land beneath the surface of the water. … A stream or lake is lawfully accessible if there is a public access, or if public land or a public road right-of-way borders the surface of the water, or if you have permission to cross private land to reach the surface of the water.",
       src:"Minnesota DNR Fishing Regulations, Trespass Law", url:"https://www.eregulations.com/minnesota/fishing/trespass-law"},
  MI: {head:"On a navigable public stream you may wade within the clearly defined banks, even through posted land.",
       quote:"On fenced or posted property or farm property, an angler wading or floating a navigable public stream … may, without written or oral consent, enter upon property within the clearly defined banks of the stream, or without damaging farm products, walk a route as closely proximate to the clearly defined bank as possible when necessary to avoid a natural or artificial hazard or obstruction.",
       src:"Michigan DNR 2026 Fishing Regulations, p. 35", url:"https://www.michigan.gov/dnr/-/media/Project/Websites/dnr/Documents/LED/digests/2026-Michigan-Fishing-Regulations_web_accessible.pdf"},
  IA: {head:"Meandered rivers are public below high water. On most rivers (non-meandered) the bed is private, and wading and fishing are allowed only where the river is navigable.",
       quote:"A non-meandered river, on the other hand, is one in which private landowners own all the land adjacent to and underneath the water-including the bottom, sandbars, and banks. … A 1996 attorney general opinion, however, permits activities incidental to navigation on non-meandered rivers, such as, fishing, swimming, and wading when the river is considered navigable.",
       src:"Iowa DNR, Paddling safety & regulations", url:"https://www.iowadnr.gov/things-do/paddling-river-recreation/safety-regulations"},
  NM: {head:"Since 2022, every watercourse you can reach legally is open to recreation. Fishing on private land still needs written permission.",
       quote:"By means of this Court order, all watercourses in the state, that can be legally accessed, are open for public recreational use. Public recreationists are reminded that private property damage remains illegal.",
       src:"New Mexico 2026 Fishing Rules & Info, p. 5", url:"https://wildlife.dgf.nm.gov/fishing/"},
  SD: {head:"In the Black Hills, unposted private land may be crossed to reach water.",
       quote:"Private land in the Black Hills Fire Protection District can be crossed to access waters for fishing unless posted as \"no trespassing.\"",
       src:"SD GFP 2026 Fishing Handbook, p. 35", url:"https://gfp.sd.gov/fishing/"},
  AZ: {head:"Arizona's regulations publish no stream-access rule. Private land posted closed is closed, so get permission.",
       quote:"Landowners or lessees of private land who desire to prohibit hunting, fishing or trapping on their lands without their written permission shall post such lands closed to hunting, fishing or trapping using notices or signboards.",
       src:"AZGFD 2026 Fishing Regulations, p. 55", url:"https://www.azgfd.com/"},
  NV: {head:"Nevada's fishing regulations publish no stream-access rule. Treat streambeds through private land as private, and ask first.",
       quote:null, src:"NDOW 2026 Fishing Guide (no access section)", url:"https://www.ndow.org/fish/"},
  IL: {head:"The Illinois DNR publishes no current stream-access rule. Treat streambeds through private land as private, and ask first.",
       quote:null, src:"Illinois DNR", url:"https://dnr.illinois.gov/fishing.html"},
};
