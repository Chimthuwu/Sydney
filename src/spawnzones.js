// ---------------------------------------------------------------------------
// spawnzones.js — spawn NPC types based on world context.
//
// Every candidate spawn point is classified into a zone, and the zone decides
// what (if anything) appears there:
//
//   urban        OrleaRouge streets         people, at hangouts; no hogs
//   town         the villages and town edges  people; no hogs
//   commercial   the US-167 strip frontage  people; no hogs
//   residential  trailer park, junkyard     mostly rednecks; no hogs
//   entertainment the Crown Strip           casino/nightclub patrons and staff; no hogs
//   rural        Bayou Noir, cane fields    rednecks, the odd hog along the fields
//   forest       the pines                  an occasional hog, the odd redneck
//   highway      any carriageway            nobody stands on the highway
//   water        the bayou causeway         nobody lives there
//
// Hogs are also capped (HOG_CAP alive at once), so the woods feel wild without
// the parish filling up with them. Regions can override the classification
// (`extraZone`, e.g. westparish.js for Parish Highway 9 and the rural west).
// ---------------------------------------------------------------------------

export const ZONE_MIX = Object.freeze({
  // OrleaRouge is the state's neon crime capital: nightlife regulars, escorts,
  // street crews, and ordinary bar traffic share the same blocks. Keep everyone
  // civilian by default; NPC aggression still only starts after provocation.
  urban: { hoodrat: 0.26, prostitute: 0.22, gayman: 0.09, lesbian: 0.09,
           thug: 0.14, tuxedo: 0.12, highendescort: 0.1, redneck: 0.03 },
  town: { hoodrat: 0.56, redneck: 0.23, hobo: 0.13, gayman: 0.04, lesbian: 0.04 },
  // The US-167 strip frontage, and the ground either side of it between the spawn
  // point and OrleaRouge — which is what the player actually drives through first.
  //
  // This mix used to be a generic "small town main street" (44% redneck, 32%
  // hoodrat, 18% prostitute, 3% each) and it was wrong for a place whose whole
  // reason to exist is that people are PASSING THROUGH it. A highway strip is
  // gas stations, diners, motels, a used-lot or two and a parking apron, so the
  // crowd is people who work there and people stopping there: mechanics and
  // dockworkers on shift, suits and off-highway tourists coming off the road,
  // and the locals who live at the end of it. Prostitutes still work the lot,
  // but they are working a parade ground, not holding court.
  //
  // Every kind here is a real ENEMY_TYPES entry in main.js — a strip that asks
  // for a body the game cannot build is a strip full of holes.
  commercial: { redneck: 0.24, hoodrat: 0.20, mechanic: 0.14, dockworker: 0.10,
                prostitute: 0.12, hobo: 0.06, suit: 0.05, tourist: 0.05,
                gayman: 0.02, lesbian: 0.02 },
  border_strip: { hoodrat: 0.36, redneck: 0.46, prostitute: 0.18, border: true },
  border_market: { hoodrat: 0.42, redneck: 0.43, prostitute: 0.15, border: true },
  residential: { redneck: 0.60, hoodrat: 0.08, hobo: 0.32 },
  market_row: { hoodrat: 0.25, redneck: 0.75 },
  // Tusouxroe's two named areas (tusouxroe.js). A zone name with no entry here
  // makes pickKind() return null, which is silence rather than an error: the
  // levee park and the Bastroux yard would have been the only empty ground in
  // the metro and nothing would have said why.
  riverfront: { hoodrat: 0.3, redneck: 0.2, hobo: 0.2, gayman: 0.15, lesbian: 0.15 },
  // Shruston's two campuses (shruston.js). Young, mixed and out in numbers —
  // which is the point of a college town and the reason the district exists.
  campus: { hoodrat: 0.34, prostitute: 0.06, gayman: 0.16, lesbian: 0.16, redneck: 0.14, tourist: 0.14 },
  bastroux_yard: { redneck: 0.62, hobo: 0.22, hoodrat: 0.16 },
  rural: { redneck: 0.6, hoodrat: 0.15, hog: 0.25 },
  forest: { hog: 0.5, redneck: 0.5 },
  highway: null,
  water: null,
  // New Zones
  industrial: { dockworker: 0.6, mechanic: 0.2, thug: 0.1, prostitute: 0.1 },
  corporate: { suit: 0.8, tourist: 0.1, hoodrat: 0.1 },
  resort: { tourist: 0.6, suit: 0.2, redneck: 0.1, prostitute: 0.1 },
  // The Crown Strip (crownstrip.js): five casinos and nine bars and clubs
  // down North Ave 2, so the crowd is whoever a casino row draws — patrons in
  // jackets, tourists off the highway, escorts working the doors, and street
  // crews. Still civilian until provoked, exactly like OrleaRouge's blocks.
  entertainment: { tuxedo: 0.2, tourist: 0.16, hoodrat: 0.16, highendescort: 0.14, prostitute: 0.2,
                   gayman: 0.08, lesbian: 0.08, suit: 0.08 }
});
export const HOG_CAP = 18;      // was 4 while the woods were one 272 m square; the state has pine country by the km

// ---------------------------------------------------------------------------
// ZOMBIE_DENSITY — how eagerly the zombie-mode horde fills each zone
// (TASK-078/079 wave; consumed by main.js's updateZombiePopulation — see the
// Integration notes there). One multiplier per zone name in ZONE_MIX, 1 = the
// TASK-077 baseline spawn rate, 0 = zombies never spawn there.
//
// The shape mirrors WANDER above: a parallel per-zone table next to the one
// it mirrors. Reasoning per zone:
//
//   entertainment 1.6  the Crown Strip — dense crowds, nightlife, "high-risk
//                      outbreak" is the whole fantasy; the Strip pays for
//                      being the signature location
//   urban         1.5  OrleaRouge — the same logic, the city that never sleeps
//                      now literally doesn't
//   commercial    1.2  the US-167 strip frontage — shops, some crowds
//   industrial    1.2  docks and yards: plenty of cover, few witnesses
//   border_strip  1.1  the Chatboro crossroads — where everyone passes
//   border_market 1.1  the Saturday market and its edges
//   market_row    1.0  East Bank's market row — ordinary street density
//   town          0.9  villages — spread out, slower to fall
//   residential   0.8  trailer park and junkyard patches — people kept to
//                      themselves out here; the horde is thinner
//   corporate     0.8  glass and plazas — sparse foot traffic even at the best
//                      of times
//   resort        0.7  tourists fled; those left make stories, not hordes
//   rural         0.4  cane fields and Bayou Noir — the outbreak is a city
//                      thing; out here you meet one, not fifteen
//   forest        0.3  the pines — almost nothing; the woods should feel
//                      empty and watchful, not crawling
//   highway       0    MUTUALLY REQUIRED (main.js spawns nothing here; a
//                      zombie shuffling down the carriageway is a bug, not
//                      atmosphere — same rule as the civilians' null mix)
//   water         0    the bayou causeway — same rule; nothing stands in the
//                      water
// ---------------------------------------------------------------------------
export const ZOMBIE_DENSITY = Object.freeze({
  entertainment: 1.6,
  urban: 1.5,
  commercial: 1.2,
  industrial: 1.2,
  border_strip: 1.1,
  border_market: 1.1,
  market_row: 1.0,
  riverfront: 0.8,
  campus: 1.15,
  bastroux_yard: 0.7,
  town: 0.9,
  residential: 0.8,
  corporate: 0.8,
  resort: 0.7,
  rural: 0.4,
  forest: 0.3,
  highway: 1.0,
  water: 1.0,
  building: 1.0,
});

const DEFAULT_ZOMBIE_DENSITY = 0.5;   // unknown zone: sparse, never dense

/**
 * The zombie density multiplier at a world position. Safe to call anywhere —
 * a zone with no table entry falls back to the sparse default rather than
 * `undefined` silently multiplying into NaN. The main.js integration is a
 * one-liner: multiply updateZombiePopulation's respawn cooldown (or its
 * per-attempt accept rate) by this.
 * @param {number} x
 * @param {number} z
 * @returns {number} 0 (never spawns) … 1 (baseline) … >1 (denser)
 */
export function zombieDensityAt(x, z, zoneAtFn = null) {
  const zone = zoneAtFn ? zoneAtFn(x, z) : null;
  if (zone == null) return DEFAULT_ZOMBIE_DENSITY;
  const d = ZOMBIE_DENSITY[zone];
  return d == null ? DEFAULT_ZOMBIE_DENSITY : d;
}

/**
 * Convenience wrapper so main.js's updateZombiePopulation stays one line:
 * accepts the spawn-system object spawnzones.createSpawnZones() returns and
 * reads zones through its own zoneAt (respects extraZone and OrleaRouge).
 * @param {{ zoneAt: Function }} spawnZones
 * @param {number} x
 * @param {number} z
 */
export function zombieDensityAtSpawn(spawnZones, x, z) {
  return zombieDensityAt(x, z, spawnZones && spawnZones.zoneAt);
}

// How NPCs cover ground, per zone: `r` scales the radius they wander around
// their hangout (multiplied into the POI's own radius), `speed` scales their
// stroll. Downtown blocks are tight and busy — short trips, quick steps —
// while the parish spreads out: nobody hurries, and a trip is a long one.
export const WANDER = Object.freeze({
  // `r` scales a POI's own radius to make the disc an NPC mills inside. Read it
  // with the POI radii in mind, not on its own: downtown's median POI is 6 m,
  // so urban at 0.55 was a 3 m disc — a person who spawns once and then stands
  // still, forever, on the kerb they spawned on. 0.9 puts the same person on a
  // ~5 m walk of their own block.
  urban:        { r: 0.9,  speed: 1.25 },
  town:         { r: 0.8,  speed: 1.1 },
  // A strip frontage is not a pavement. The old 0.9 was OrleaRouge's kerb value
  // applied to a zone whose POIs are parking aprons and motel forecourts tens of
  // metres deep, so a mechanic spawned in one and stood in it. 1.35 lets somebody
  // walk from the diner to their car, which is the whole observable behaviour of a
  // highway strip — and speed drops below 1 because nobody hurries across a parking
  // lot, they amble looking for their keys.
  commercial:   { r: 1.35, speed: 0.9 },
  border_strip: { r: 0.85, speed: 1.05 },
  border_market:{ r: 0.85, speed: 1.05 },
  residential:  { r: 1.0,  speed: 1.0 },
  market_row:   { r: 0.45, speed: 0.9 },
  riverfront:   { r: 0.7,  speed: 0.95 },   // the levee walk: people out for a stroll
  campus:       { r: 0.5,  speed: 1.15 },   // short hops between buildings, and briskly
  bastroux_yard:{ r: 1.1,  speed: 0.9 },
  rural:        { r: 1.6,  speed: 0.85 },
  forest:       { r: 1.6,  speed: 0.85 },
  highway:      null,
  water:        null,
  // New Zones
  industrial:   { r: 0.6,  speed: 1.0 },
  corporate:    { r: 0.4,  speed: 1.3 },
  resort:       { r: 0.8,  speed: 0.8 },
  entertainment:{ r: 0.8,  speed: 1.2 }        // the Strip: short trips between doors
});
const DEFAULT_WANDER = { r: 1, speed: 1 };

/**
 * @param {object} o
 * @param {object} o.MAP         { minX, maxX, minZ, maxZ }
 * @param {number} o.ROAD_X, o.ROAD_HALF, o.LOT_X
 * @param {Function} o.getOrlea  () => orlearouge module or null
 * @param {Array}  o.residential [{ x, z, r }] patches of homes
 * @param {Function} o.extraZone (x, z) => zone name or null, checked first
 * @param {number} o.coreMinX    the original map's west edge: town / city zones stop here
 * @param {Array}  o.gatherPois  [{ x, z, r }] crowd sinks (Market Row's square): a
 *   sample that lands near one is pulled onto it, so small busy places actually fill
 */
/**
 * Venue footprints, injected by main.js after crownstrip.js has built them.
 *
 * Deliberately NOT imported: crownstrip.js calls zoneAt() from spawnzones.js, so
 * importing it back here would be an import cycle. And deliberately NOT copied --
 * a hand-typed copy of four venue boxes would silently drift the first time a venue
 * moved, at which point the exclusion would be excluding the wrong place, which is
 * worse than having no exclusion.
 */
let venueBoxes = [];
// 6 m of padding. A spawn exactly on the boundary walks through the door in a couple
// of seconds, which makes an exact box test useless; 6 m means a rejected point is
// clearly outside the forecourt. The player is unaffected -- the strip stays walkable.
const VENUE_PAD = 6;

export function createSpawnZones({ MAP, ROAD_X, ROAD_HALF, LOT_X, getOrlea, residential = [], extraZone = null, coreMinX = -Infinity, gatherPois = [], worldTime = null }) {
  const rand = (lo, hi) => lo + (hi - lo) * Math.random();
  const WARNED = new Set();
  let silentRing = 0;   // pick() calls that exhausted every retry — QA reads this

  // ONE constant and ONE predicate for "is this inside the city".
//
// The first spawn-density fix (3ecfde9) widened the city margin in TWO of its three
// readers -- pick() and main.js's `busy` test -- and left the third, zoneAt(), on the
// strict inCity() call. The result looked correct: the roads filled with people, which
// is all that fix was checked for. Meanwhile a 40 m band around the city's south edge
// still classified as forest through zoneAt(), and everything downstream of the
// classification read that: 165 hogs offered inside OrleaRouge again, four commits
// after fe0f848 fixed it. Fixing a symptom in two of three readers is how that
// happened, and the only durable answer is one definition that all three call.
const SPAWN_MARGIN_Z = 40;

// orlea.inCity() is EXCLUSIVE on the south edge (z > CITY.minZ) and the city starts at
// z = 130, so the spawn corridor is "not the city" by arithmetic -- a test that
// excludes the one place the player always is. The margin is generous on purpose: the
// whole first minute of the game happens in that band, and classifying it as city costs
// at most a few peds near the causeway mouth.
function inCityWide(x, z) {
  const o = getOrlea();
  if (!o) return false;
  if (o.inCity(x, z)) return true;
  const c = (o.grid && o.grid.city) || { minX: -292, maxX: 680, minZ: 130, maxZ: 500 };
  const minZ = c.minZ, maxZ = c.maxZ;
  // THE MARGIN IS A STRIP, NOT A HALF-PLANE. My first version tested ONLY z, so
  // "inside the city" became true for every x across the map's whole width -- it widened
  // a strip the height of the city and infinite length. Measured consequence
  // (tools/qa/city_vegetation_probe.mjs): the count of rural/forest cells barely moved
  // (36 -> 28) while their coordinates showed x = -252..348, i.e. points far west of the
  // block grid were being called city by a test that never looked at x.
  //
  // The margin exists to cover the SPAWN CORRIDOR -- the causeway mouth on the south
  // edge. So it applies to the z edges only, and x must still satisfy inCity(), which
  // checks all four bounds against CITY (orlearouge.js:73).
  if (x < c.minX || x > c.maxX) return false;
  return z >= minZ - SPAWN_MARGIN_Z && z <= maxZ + SPAWN_MARGIN_Z;
}

function zoneAt(x, z) {
    const extra = extraZone && extraZone(x, z);
    if (extra) return extra;
    const orlea = getOrlea();
    //
    // THE MARGIN BELOW IS NOT OPTIONAL, AND FORGETTING IT BROUGHT THE HOGS BACK
    // (tools/qa/city_vegetation_probe.mjs: "hogs offered inside OrleaRouge: 165").
    //
    // inCity() tests z > CITY.minZ, and the city's south edge is z = 130. So a strip
    // of the city 40 m deep -- which includes the spawn point, ROAD_X/SPAWN_Z -- was
    // answering "not the city" to every question asked of it. The first spawn-density
    // fix (3ecfde9) widened the margin in pick() and in main.js's `busy` test and the
    // roads filled with people, which is why the regression was invisible: the game
    // LOOKED right. But zoneAt() is the classification everything else reads, and it
    // kept the strict test, so a band around the edge still fell through to the
    // trailing `return "forest"` -- hog country, on the frontage, 165 offers.
    //
    // Fixing a symptom in two of three readers is how that happened. This is the
    // third reader, and the margin is now written ONCE and shared.
    if (orlea && x >= coreMinX && inCityWide(x, z)) return "urban";
    if (z > 136 && z < 196) return "water";
    if (Math.abs(x - ROAD_X) < ROAD_HALF + 4) return "highway";
    if (z < -50 && x >= coreMinX) return "town";
    for (const r of residential) if (Math.hypot(x - r.x, z - r.z) < r.r) return "residential";
    // The strip frontage. `LOT_X + 14` is 38 m from the centreline, which is one
    // lot either side of the carriageway — it was sized for the OLD map, where the
    // strip was a row of shops between two streets and 38 m was genuinely all of
    // it. It is badly wrong for the spawn corridor, and the error was invisible
    // from inside spawnzones.js because the tests only ever asked whether the map
    // classified CORRECTLY, never whether the corridor classified POPULATED.
    //
    // Measured over the ground the player drives first (x -126..114, z 60..142,
    // 2 m cells, tools/qa/spawn_emptiness.mjs's corridor): at 38 m the whole strip
    // was 38 m of commercial either side of a 14 m road, and everything past it
    // fell through to the trailing `return "forest"` — hog country, on the
    // frontage. Metro's own claim is x -62..52 (metro.js:76), i.e. the district
    // already reserves ~58 m either side of US-167 as roadside, so 58 m is not an
    // invention here; it is the width the rest of the world already agrees on.
    // Below that width the strip frontage simply stops existing as far as the
    // crowd is concerned, and the player drives a highway through open ground with
    // nobody on it.
    //
    // This widens the strip, it does not pave the swamp: the bayou causeway is
    // decided above by the z 136..192 `water` band, and this test only ever
    // reaches ground that reached the end of the function as `forest` or
    // `commercial`, both of which are dry, buildable parish.
    if (Math.abs(x - ROAD_X) < LOT_X + 34) {
      if (z >= -40 && z <= 40) return "border_strip";
      return "commercial";
    }
    if (x >= 115 && x <= 180 && z >= -30 && z <= 50) return "border_market";
    return "forest";
  }

  function isBorder(x, z) {
    const zName = zoneAt(x, z);
    const mix = ZONE_MIX[zName];
    return !!(mix && mix.border);
  }

  function pickKind(zone, hogsAlive) {
    const mix = ZONE_MIX[zone];
    if (!mix) {
      // A zone name with no mix is a whole district that silently spawns
      // nobody, and it cost 0.43 km2 of the state before anyone noticed
      // (stateWorld.js was passing the composer's "building" through). Say it
      // out loud, once, instead of returning null and looking like an empty
      // field. Deliberately NOT a fallback mix: a wrong crowd is a bug that
      // hides itself, and the warning is the point.
      if (!WARNED.has(zone)) { WARNED.add(zone); console.warn(`[spawnzones] no crowd for zone "${zone}" — nothing will spawn there`); }
      return null;
    }
    let r = Math.random(), kind = null;
    for (const [k, w] of Object.entries(mix)) {
      if (k === "border") continue;
      if (r < w) { kind = k; break; }
      r -= w;
    }
    kind = kind || Object.keys(mix).find(k => k !== "border");
    if (kind === "hog" && hogsAlive >= HOG_CAP) kind = mix.redneck ? "redneck" : null;
    return kind;
  }

    /**
   * THE CROWN STRIP EXCLUSION (human, 2026-10-03): "we just need slightly more
   * zombies, uh, but they should never enter those venues on the Crown Strip, uh, but
   * anywhere outside is fine".
   *
   * This sits here rather than in updateZombiePopulation because pick() is the ONE
   * place every spawn position passes through -- the ordinary population included.
   * `forZombie` is already the flag that separates the horde from the crowd, so this
   * is one conditional deeper and cannot be bypassed by a caller that forgot.
   *
   * MARGIN, not an exact box test. A zombie spawned exactly outside the wall walks in
   * two seconds later and the exclusion is worthless; the box is grown by VENUE_PAD so
   * a spawn lands clear of the door. Nobody can tell the difference at a doorway --
   * the strip stays walkable for the player, it just doesn't spawn indoors.
   *
   * The boxes are INJECTED (setVenueBoxes) rather than imported: crownstrip.js imports
   * spawnzones.js's zoneAt(), so importing it back would be a cycle. A copy of the
   * avenue geometry typed out by hand would drift the moment a venue moved, which is
   * a worse failure than no exclusion at all.
   */
  function insideVenue(x, z, pad = VENUE_PAD) {
    for (const b of venueBoxes) {
      if (x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad) return true;
    }
    return false;
  }


  return {
    insideVenue,
    setVenueBoxes(boxes) { venueBoxes = Array.isArray(boxes) ? boxes : []; },
    zoneAt,
    isBorder,

    /**
     * A spawn { x, z, kind, zone, border } near `focus` (out of sight, between minDist
     * and maxDist), or null if this attempt landed somewhere nobody should
     * appear. `living`: current NPC records.
     *
     * THE RING IS THE WHOLE BALLGAME, and it was 65–105 m for the life of this
     * function, which is why downtown OrleaRouge looked abandoned (human report,
     * 2026-09-28, with a screenshot of an empty boulevard: "hardly any NPCs
     * appearing at all ... hardly any traffic or pedestrians").
     *
     * Measured in the city at (272, 348), 4000 attempts, every one successful —
     * so nothing was FAILING. Nobody was simply ever close:
     *
     *     spawn distance   min 52 m · median 93 m · p90 108 m
     *     nearest anyone could EVER get, given where they land and how far they
     *     then wander: 9.8 m — and only 6 of the 36 POIs within 140 m could
     *     manage even that
     *     expected people within the 50 m you can actually see: 9.3
     *
     * The compounding mistake: an NPC's wander disc is `poi.r * WANDER[zone].r`
     * (npc.js) and downtown's median POI radius is 6 m at urban r 0.55 — a 3 m
     * disc. So they spawned 52–108 m away, snapped to a POI, and milled inside
     * three metres of it forever. Meanwhile CIV_CULL (180 m) sits OUTSIDE the
     * whole ring, so nothing was ever culled and the population never turned
     * over: the same static ring followed you around the map and never once
     * refreshed into the street you were standing on.
     *
     * Raising ENEMY_CAP, which is what the last report on this was answered
     * with, could not have fixed any of it. The cap was never the constraint.
     */
    pick(focus, living, opts = {}) {
      // A silent zone used to be a silent TICK. pick() drew one ring position,
      // found `water` or `highway` (both deliberately null in ZONE_MIX), warned
      // once, and returned null — and the caller does `if (!spot) return`, so
      // that whole tick produced nobody. At the free-roam spawn (-6, 130) 48%
      // of the first ring is one of those two zones, because the spawn sits on
      // the US-167 centre line with the causeway water 6 m north of it: measured
      // 284/400 attempts returned a spot, so one NPC in six was silently lost
      // every single tick, forever, in the one place every player starts.
      //
      // One draw is not a verdict on whether the ring contains anybody. Retry a
      // bounded number of times, and COUNT the failures rather than hiding
      // them — a caller that gets null after 6 tries genuinely is standing
      // somewhere with no crowd, and that should stay visible.
      const MAX_TRIES = 6;
      let last = null;
      for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
        last = placeOnce(focus, living, opts);
        if (last) return last;
      }
      silentRing++;
      return null;
    },
    /** How many pick() calls exhausted every retry. Read by QA, never by the game. */
    get silentRingCount() { return silentRing; },
  };

  /** One draw: pick a spot in the ring and work out who lives there. */
  function placeOnce(focus, living, { minDist = 25, maxDist = 80, forZombie = false } = {}) {
      let hogs = 0;
      for (const e of living) if (!e.dead && e.type === "hog") hogs++;

      let x, z;
      if (!forZombie && Math.abs(focus.x - ROAD_X) < 60) {
        // along US-167: ahead of / behind the player, roadside most of the time
        const sign = Math.random() < 0.62 ? -1 : 1;
        z = focus.z + sign * rand(minDist, maxDist);
        const side = Math.random() < 0.5 ? -1 : 1;
        x = ROAD_X + side * (Math.random() < 0.72 ? rand(10, 30) : rand(LOT_X + 10, LOT_X + 34));
        // The ring is a CONTRACT on distance, and this branch honours it only on
        // z: x is thrown up to LOT_X + 34 = 58 m off the centre line
        // independently, so an "80 m ring" spawn can still land at
        // hypot(58, 80) = 99 m. Measured at the free-roam spawn, p90 was 104 m
        // before this clamp — a chunk of the population spawning past where
        // anybody could see it, and outside CIV_CULL (180 m) so never recycled
        // either. Bring the true radial distance back inside maxDist.
        {
          const dx = x - focus.x, dz = z - focus.z, dd = Math.hypot(dx, dz);
          if (dd > maxDist) {
            const k = maxDist / dd;
            x = focus.x + dx * k;
            z = focus.z + dz * k;
          }
        }
      } else {
        // out in the parish: anywhere around the player
        const a = Math.random() * Math.PI * 2, d = rand(minDist, maxDist);
        x = focus.x + Math.cos(a) * d;
        z = focus.z + Math.sin(a) * d;
      }
      x = Math.min(MAP.maxX - 8, Math.max(MAP.minX + 8, x));
      z = Math.min(MAP.maxZ - 12, Math.max(MAP.minZ + 12, z));

      const orlea = getOrlea();
      //
      // THE SPAWN POINT IS THE CITY (human, 2026-10-03: "there's like no NPCs at all in
      // the spawn location. That's fucking lame." / "we need to make orlearouge feel like
      // a proper city!").
      //
      // This branch is what gives an NPC a hangout instead of a random frontage spot,
      // and it was unreachable at the spawn point -- because orlea.inCity() tests
      // z > CITY.minZ and SPAWN_Z is exactly minZ (130, orlearouge.js:73). Measured live
      // with tools/qa/spawn_npc_density.mjs: only 4 of OrleaRouge's 260 POIs lie within
      // 30 m of spawn, pick() at that point succeeded just 142/400 times, and the
      // population stalled at 75 of a possible 195 -- the respawn loop was asking for
      // someone, being told "that is not the city", and getting a highway verge back.
      //
      // The margin is generous on purpose. Spawn sits ON the city's south edge and the
      // whole first minute of the game happens there; classifying the boundary strip as
      // city costs at most a few NPCs loitering near the causeway mouth, which is what a
      // city looks like anyway. orlea.cityBounds is used when the district exposes it,
      // with the current literal as the fallback -- see the note on orleaInCity() in
      // westparish.js about duplicating this rect.
      if (orlea && x >= coreMinX && inCityWide(x, z)) {
        // city: people at a hangout rather than inside a building
        const spots = orlea.pois.filter((p) => {
          const d = Math.hypot(p.x - focus.x, p.z - focus.z);
          return d > minDist * 0.8 && d < maxDist * 1.05;
        });
        // NO POI IN THE RING IS NOT A REASON TO SPAWN NOBODY.
        //
        // This used to `return null`, which is a hard stop: one missed ring and
        // the whole tick produced nothing, every tick, forever. Measured on the
        // live grid, the Crown Strip and the new east arterial have ZERO POIs
        // inside the ring at any distance, so standing anywhere on them meant no
        // ambient NPC could ever appear. The ring position `x`/`z` were already
        // computed above and is a perfectly good spot — the POI snap is an
        // improvement, not a precondition.
        // A hangout beat, NOT an override. It used to fire on every spawn, and
        // with only ~36 POIs inside 140 m downtown that made the nearest
        // qualifying hangout the ONLY place anybody could be — which pushed the
        // whole population back out to 46 m and undid the ring fix below. Half
        // the time, take the plain ring position, which the comment below has
        // always said is a perfectly good spot.
        if (spots.length && Math.random() < 0.5) {
          const p = spots[(Math.random() * spots.length) | 0];
          x = p.x + rand(-p.r, p.r);
          z = p.z + rand(-p.r, p.r);
        }
      } else {
        // crowd sinks: the Saturday market, and places like it, are too small
        // for the spawn ring to hit on its own — pull nearby samples onto them
        for (const p of gatherPois) {
          if (Math.hypot(p.x - x, p.z - z) < 55 + (p.r || 0)) {
            const a = Math.random() * Math.PI * 2, rr = Math.random() * (p.r || 5) * 0.8;
            x = p.x + Math.cos(a) * rr;
            z = p.z + Math.sin(a) * rr;
            break;
          }
        }
      }
      // Nothing is ever placed inside the ring, whichever of the paths above
      // chose the spot — and this has to sit AFTER the POI snap, not before it.
      // (It sat before, and the snap walked samples straight back inside: the
      // measured minimum was 15.8 m against a 25 m ring.)
      //
      // This is the guarantee that used to be implied and was not: a POI offset
      // of ±p.r could walk a sample from 22 m back inside to 6 m, which is a
      // person materialising on the pavement in front of you. Clamping radially
      // costs nothing — the snap is a nicety, the ring is the contract.
      {
        const dx = x - focus.x, dz = z - focus.z, dd = Math.hypot(dx, dz);
        if (dd < minDist) {
          if (dd > 0.001) { x = focus.x + (dx / dd) * minDist; z = focus.z + (dz / dd) * minDist; }
          else { x = focus.x + minDist; z = focus.z; }
        }
      }

      // A zombie must not be placed inside a Crown Strip venue (human, 2026-10-03:
      // "they should never enter those venues on the Crown Strip, uh, but anywhere
      // outside is fine"). REJECT AND RETRY rather than return null: returning null
      // would quietly shrink the horde specifically near the strip, and the player
      // would read that as "zombies vanish outside the venues" -- the same complaint,
      // inverted. Six attempts, then give up and let this one go rather than loop
      // forever if the player is standing on the forecourt.
      if (forZombie && venueBoxes.length) {
        let tries = 0;
        while (insideVenue(x, z) && tries < 6) {
          const a2 = Math.random() * Math.PI * 2;
          const r2 = minDist + Math.random() * (maxDist - minDist);
          x = focus.x + Math.cos(a2) * r2;
          z = focus.z + Math.sin(a2) * r2;
          tries++;
        }
        if (insideVenue(x, z)) return null;      // boxed in: no legal spawn this frame
      }

      const zone = zoneAt(x, z);
      let kind = pickKind(zone, hogs);
      if (forZombie) {
        kind = "zombie";
      }

      if (kind === "hoodrat" && worldTime && (worldTime.isNight() || worldTime.dusk >= 0.6) && Math.random() < 0.35) {
        if (["urban", "commercial", "border_strip", "border_market", "town"].includes(zone)) {
          kind = "prostitute";
        }
      }
      const border = isBorder(x, z);
      // the wander profile rides along so npc.js doesn't re-derive the zone
      const w = WANDER[zone] || DEFAULT_WANDER;
      return kind ? { x, z, kind, zone, border, wanderR: w.r, wanderSpeed: w.speed } : null;
  }
}
