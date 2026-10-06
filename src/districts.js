// ---------------------------------------------------------------------------
// districts.js — where each town IS. One place, so a town can be moved.
//
// Bayou Dixie is Louisiana with the names filed off, and the three settlements
// map onto three real ones:
//
//   Chatboro    ← Chatham, LA               north-CENTRAL (Jackson Parish)
//   Tusouxroe   ← Monroe, LA                north-EAST, on the river
//   Shruston    ← Shreveport + Ruston       north-WEST, on I-20
//   Charsoufre  ← Lake Charles + Sulphur    south-WEST, on I-10
//   OrleaRouge  ← New Orleans               south-EAST
//
// and that is the layout. Chatboro sits in the middle of the north with
// Tusouxroe north-east of it and Shruston north-west; Charsoufre is away down
// the south-west coast, and OrleaRouge holds the south-east. Driving the length
// of US-167 should feel like driving the length of the state, and the two
// east-west highways are the interstates: the Red Dust Pass is I-20 through
// Shruston, the Lakeshore Causeway is I-10 through Charsoufre. Shreveport,
// Ruston and Monroe really are strung along I-20 like that.
//
// AS BUILT, and how little room is left. The map is 2400 m square and most of it
// is already claimed, so the two northern towns are wedged between things that
// were there first:
//
// ORLEAROUGE IS THE BIGGEST, and on every measure — this table used to give the
// towns a tidy m2 each and OrleaRouge a sentence, which made Tusouxroe's 169,120
// look like the largest number on the map. Measured in a running build:
//
//                    territory     built       buildings   population
//   OrleaRouge        715,140 m2   67,292 m2      223        611,470
//   Tusouxroe         169,120 m2   18,260 m2       72         48,200
//     of which West Tusouxroe, across the river:
//                                    4,992 m2       32         12,458
//   Shruston          158,600 m2   16,013 m2       69        231,400
//   Charsoufre         78,000 m2    9,000 m2       42         81,210
//   Chatboro           31,680 m2    4,676 m2       31          4,083
//
// "territory" is the ground a district owns, "built" the footprint of what
// stands on it. OrleaRouge is 4.2x the next on territory, 3.7x on built
// footprint, 3.1x on buildings and 2.6x on people. Its own city grid (CITY,
// 656 x 186 = 122,016 m2) is only part of it: it also owns the US-167 strip
// north to z -440, the Crown Strip, Lafourchette on the east bank, West Parish,
// the riverfront and the Gulf front. (West Parish reports no building rects, so
// the 67,292 understates it.)
//
// pop. 611,470 is New Orleans plus Baton Rouge, which is what the name is.
//
//   Chatboro     x -102 .. 42,  z  -720 .. -500     31,680 m2  (chatboro.js)
//   Tusouxroe    x   85 .. 387, z -1152 .. -592    169,120 m2  (tusouxroe.js)
//   Shruston     x -370 ..-110, z -1080 .. -470    158,600 m2  (shruston.js)
//   Charsoufre   x -360 ..-100, z   600 ..  900     78,000 m2  (charsoufre.js)
//
// and the four corner regions, which were there first and set the walls:
//
//   Port Calypso  x  380 .. 1150, z -1100 .. -380  (content starts at x 450)
//   Red Dust      x -1150 ..-380, z -1100 .. -380
//   Lakeshore     x -1150 ..-380, z   380 .. 1150
//   Oyster Bay    x  380 .. 1150, z   380 .. 1150
//
// The gaps: 43 m Chatboro–Tusouxroe, 60 m Chatboro–the strip, 63 m
// Tusouxroe–the docks, 10 m Shruston–Red Dust and 20 m Charsoufre–Lakeshore.
// Those are the numbers a town has to grow into, and the QA scripts in
// tools/qa/ assert them.
//
// WHY THIS FILE EXISTS
// --------------------
// Every district used to hardcode its own world coordinates, and so did every
// story beat inside it — Act One's `NB`, the Nadia house, the street, the
// lamps. Moving a town therefore meant hand-editing hundreds of literals and
// hoping no mission had been missed, which is exactly how a story gets broken.
//
// Now a district declares an ORIGIN here, and everything inside it is written
// as an offset from that origin. Moving a town is changing two numbers in this
// file, and every building, street, lamp, mission waypoint and cutscene mark
// inside it moves with it. Keseme's story follows her town.
//
// RULES
// -----
//  * Nothing in a district may hardcode a world coordinate. Take the origin and
//    add to it. If you find yourself typing a number over ~100 in a district
//    module, it is probably an absolute coordinate that should be an offset.
//  * `ORLEAROUGE` is the origin the game was originally built around, so it is
//    (0, 0) and must stay there. Everything that already exists is OrleaRouge;
//    moving it would mean re-homing the entire built world.
//  * The map is STATE_BOUNDS, currently ±1200 (stateWorld.js). Keep a district's
//    whole extent inside it.
// ---------------------------------------------------------------------------

/** −z is north in this world (the causeway at z 136 is south of the city core). */
// The two cities whose extents KEEPOUTS below has to agree with. Imported so
// the keepout rects above are derived from the districts rather than restated
// by hand — see the note there.
import { CITY as ORLEA_CITY, CAUSEWAY } from "./orlearouge.js";
import { METRO_BOUNDS } from "./metro.js";

export const DISTRICTS = {
  // Everything that was already built. The original parish, the strip, the
  // riverfront, the Gulf. Origin (0, 0) by definition — see the rules above.
  orlearouge: { x: 0, z: 0, label: "OrleaRouge" },

  // Chatham: north-central. A village on the highway between the other two, so
  // you drive through it going north, which is what a state-highway village is.
  //
  // (-6, -600) is not a rounded-off guess: x -6 IS US-167 (main.js ROAD_X) and
  // z -600 IS the Port Highway (stateWorld.js). The origin is the crossroads
  // itself, which is the only junction on the way north — you cannot reach
  // Tusouxroe or the docks without driving through this village, which is the
  // relationship Chatham actually has with Monroe.
  chatboro: { x: -6, z: -600, label: "Chatboro" },

  // Shreveport + Ruston: the north-west, on I-20 (the Red Dust Pass, world
  // z -600 — it crosses local z 180). Louisiana's third city and its college
  // town are an hour apart on that road in real life; here they are one place.
  // West of Chatboro and clear of the Red Dust badlands at x -380.
  shruston: { x: -240, z: -780, label: "Shruston" },

  // Lake Charles + Sulphur: the south-west, on I-10 (the Lakeshore Causeway,
  // world z 750 — local z 0, which is the seam between the two halves). Ten
  // miles apart in real life and joined at the hip; the origin is the join.
  charsoufre: { x: -230, z: 750, label: "Charsoufre" },

  // Monroe: north-east, and a long way up. The drive from OrleaRouge to Mama's
  // door is meant to be a drive.
  //
  // One origin, TWO cities. Monroe and West Monroe are separately incorporated
  // and face each other across the Ouachita, and tusouxroe.js builds both: the
  // east bank downtown, and WEST TUSOUXROE (pop. 12,458) over the river with
  // its own city hall, its own water tower and Antique Alley up Trenton Street.
  // They share a composer grid because they are physically continuous — the
  // bridges are the only thing between them — not because one is a suburb.
  //
  // Sited in the EAST half of stateWorld.js's north wilderness band, between
  // Chatboro and the Port Calypso docks. The first attempt at this put the
  // origin at (560, -880), which dropped Mama's house into the middle of Port
  // Calypso's container yard (that region owns x 380..1150, z -1100..-380) and
  // left only 320 m of map north of the town — not enough for a city. From
  // here the metro runs north to z -1150 and stops short of the docks at
  // x 387, and Mama's neighbourhood lands on its south edge, where "South
  // Tusouxroe" belongs, one block off the Port Highway.
  tusouxroe: { x: 215, z: -580, label: "Tusouxroe" },
};

/**
 * The ground a district has claimed, in WORLD space, so state-scale scatter
 * knows to stay out of it.
 *
 * A district's own composer keeps trees off its own streets, but stateWorld.js
 * lays its wilderness bands down blind — a pine every ~600 m^2 and the odd
 * stilt hut with a 60 m pond under it. The north band covers x -350..350,
 * z -1050..-450, which is exactly where Chatboro and Tusouxroe now are, so
 * without this the city grows a forest through its own downtown.
 */
export const KEEPOUTS = [
  // ---- THE TWO BIG CITIES, which were missing here entirely -----------------
  //
  // "There are all these trees randomly popping up on the road on the outskirts
  // of OrleaRouge, and it randomly seems to become rural right near the Bayou
  // State Penitentiary." (human report)
  //
  // OrleaRouge and Metro are built by main.js out of modules that never
  // registered themselves as districts, so they appear nowhere in this list —
  // and the two checks that were meant to cover them both come up empty:
  // stateWorld's `held()` walks only its OWN composers, and the East wilderness
  // band (x 400..1050, z -350..350) runs straight across OrleaRouge's eastern
  // downtown. `nearLane` kept the pines off the asphalt, which is exactly why
  // it read as a rural strip rather than a broken one: trees in the verges and
  // behind the buildings, never in the road.
  //
  // The numbers are the cities' OWN bounds, imported rather than copied. A
  // duplicated rect is a rect that falls behind the moment a district grows,
  // and this is the third time this list has been the thing that was out of
  // date; tools/qa/urban_ground_test.mjs samples the real footprint and fails
  // if the two ever diverge again.
  { x0: ORLEA_CITY.minX - 8, x1: ORLEA_CITY.maxX + 8, z0: CAUSEWAY.minZ - 4, z1: ORLEA_CITY.maxZ + 8, label: "OrleaRouge" },
  { x0: METRO_BOUNDS.x0 - 6, x1: METRO_BOUNDS.x1 + 6, z0: METRO_BOUNDS.z0 - 6, z1: METRO_BOUNDS.z1 + 6, label: "Metro" },
  // Tusouxroe: the whole metro, both banks, Bastroux at the north end, and the
  // lake. Matches BOUNDS in tusouxroe.js, padded out to the district edge.
  { x0: 80, x1: 392, z0: -1160, z1: -586, label: "Tusouxroe" },
  // Chatboro: the village on the crossroads. Matches BOUNDS in chatboro.js.
  // Its west end reaches x -86, where the north band does scatter pines (the
  // band only spares the highway corridor, |x| < 100).
  { x0: -106, x1: 46, z0: -724, z1: -496, label: "Chatboro" },
  // Shruston, and the Red Dust approach corridor runs straight through it at
  // z -600: roadside.js claims this rect, which is what keeps I-20's motels and
  // pines out of the campuses.
  { x0: -376, x1: -104, z0: -1086, z1: -464, label: "Shruston" },
  // Charsoufre, with the Lakeshore approach corridor through it at z 750.
  { x0: -366, x1: -94, z0: 594, z1: 906, label: "Charsoufre" },
  // wonders.js: four set pieces off Delta Road (Belle Plantation and its oak alley, the Hot Bayou Pepper Works, Pelican
  // Petrochemical, the Bayou State Penitentiary and its rodeo), with their spurs. Delta Road's farmsteads and pines
  // keep out of them; the spurs' mouths are inside the rects.
  // Each is two rects, one either side of its spur: Delta's composer claims a keepout AFTER laying its roads, so a rect
  // across the spur (and Delta's own carriageway) would turn them into "building" ground. The spurs themselves are
  // registered with Delta as junctions instead (wonders.js SPURS).
  { x0: 470, x1: 746, z0: -312, z1: -264, label: "Belle Plantation" },
  { x0: 470, x1: 746, z0: -256, z1: -208, label: "Belle Plantation" },
  { x0: 809, x1: 1048, z0: 96, z1: 146, label: "Hot Bayou Pepper Works" },
  { x0: 809, x1: 1048, z0: 154, z1: 208, label: "Hot Bayou Pepper Works" },
  { x0: 809, x1: 1048, z0: -238, z1: -45, label: "Pelican Petrochemical" },
  // Angola is a hundred miles from New Orleans. It used to sit 28 m east of
  // OrleaRouge's last avenue, which stopped being true the moment the city's
  // grid grew past it — a state penitentary as the next block downtown is not a
  // place that exists anywhere. wonders.js moves the whole compound by
  // PRISON_OX; these follow it, and urban_ground_test fails if the city ever
  // reaches the prison again.
  { x0: 922, x1: 1181, z0: 230, z1: 296, label: "Bayou State Penitentiary" },
  { x0: 922, x1: 1181, z0: 304, z1: 372, label: "Bayou State Penitentiary" },
];

/**
 * WHERE KESEME'S STORY OPENS. The highway pull-off and the dirt road into the
 * woods: the hog chase, the Green Bravado, the crash site and the ledger.
 *
 * It used to be at z 130 on the OrleaRouge strip, which is how the establishing
 * card came to say CHATBORO over a place that is now plainly OrleaRouge. This
 * is Chatboro's own stretch of US-167, eighty metres north of the village — the
 * shoulder outside town, which is what the scene actually is.
 *
 * Only `z` moves. US-167 runs the length of the map at x -6, so every x in
 * prologue.js means the same thing here as it did there and none of them had to
 * change: the road is still the road, and the dirt track still runs east off it.
 */
export const PROLOGUE_SITE = Object.freeze({ x: -6, z: -800, label: "Chatboro — the north shoulder" });

/**
 * Ground a SET PIECE owns, that no district and no scatter may build or plant
 * on. Distinct from KEEPOUTS above: a keepout says "a town is here, keep the
 * wilderness out"; this says "a scene happens here, keep EVERYTHING out".
 *
 * The prologue's hog pen has a 32 m radius and its east end reaches x 118,
 * which is inside Tusouxroe's western tree line — so without this the opening
 * chase runs through a pine plantation and the hogs get stuck on the trunks.
 */
export const PROTECTED = [
  { x0: -20, x1: 100, z0: -915, z1: -790, label: "Keseme's prologue" },
];

/** True if (x, z) is on set-piece ground. Districts and scatter must not build here. */
export function inProtected(x, z, pad = 0) {
  for (const r of PROTECTED) {
    if (x > r.x0 - pad && x < r.x1 + pad && z > r.z0 - pad && z < r.z1 + pad) return true;
  }
  return false;
}

/** True if (x, z) falls inside a district's claimed ground. `pad` widens every rect. */
export function inKeepout(x, z, pad = 0) {
  for (const k of KEEPOUTS) {
    if (x > k.x0 - pad && x < k.x1 + pad && z > k.z0 - pad && z < k.z1 + pad) return true;
  }
  return false;
}

/** Offset a point into a district: `at("tusouxroe", 92, -100)`. */
export function at(district, dx, dz) {
  const d = DISTRICTS[district];
  if (!d) throw new Error(`districts.js: no district "${district}"`);
  return { x: d.x + dx, z: d.z + dz };
}

/** Which district a world point falls nearest, for zone/label lookups. */
export function districtAt(x, z) {
  let best = "orlearouge", bd = Infinity;
  for (const [key, d] of Object.entries(DISTRICTS)) {
    const dd = (x - d.x) ** 2 + (z - d.z) ** 2;
    if (dd < bd) { bd = dd; best = key; }
  }
  return best;
}
