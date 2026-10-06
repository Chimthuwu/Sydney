// ---------------------------------------------------------------------------
// orleanorth.js — ORLEANORTH: the connective city between OrleaRouge and the
// Crown Strip. Not a district anybody arrives at. The thing you drive THROUGH.
//
// A human request (cunthuwu, 2026-10-01): "Literally what I want is like the new
// Orleans busy city vibe to extend well beyond the crown strip. We shouldn't be
// entering rural areas so quickly right after we just going north of the crown
// strip so soon. That's some bullshit man." Then, on how to achieve it: OrleaRouge
// grows to swallow the strip, the strip becomes its northern neighbourhoods,
// one continuous city, no seam.
//
// WHY THIS IS A MODULE AND NOT A BOUNDS CHANGE
//
// Growing OrleaRouge's rect north would not fill anything. OrleaRouge
// (orlearouge.js) builds its own street grid from a hardcoded STREETS array and
// a CITY rect, and it has no composer at all — it exports no zoneAt, so
// main.js:3079's zone chain does not even include it. There is no infill pass to
// widen, and widening the rect would only change what the city KEEPS OUT of.
// This module is the missing fabric.
//
// WHAT WAS ACTUALLY MISSING
//
// Measuring the chain (tools/qa/urban_chain.mjs) found the Crown Strip is an
// island rather than a cutoff. Tusouxroe IS urban north of it. The real defect
// is the 264 m band between OrleaRouge's north edge (z 130) and the Crown
// Strip's south edge (z −134), of which 69,550 m2 — 37% of the sampled band —
// belongs to no district at all:
//
//   z   130  .##################################
//   z    90  ...........#######....############.
//   z   -10  ...........#######....############.
//   z  -130  .........#########################.
//
// The west half is bare the whole way down, and a notch sits mid-band where
// Chatboro's 144 m of width stands in the middle of nowhere. In a map full of
// unowned ground — which composer's WILD rule and main.js's keepout both turn
// into trees — this reads as a wood in the middle of a metropolis, which is
// exactly the "rural areas so quickly" complaint.
//
// SO WHAT THIS BUILDS
//
// Urban connective tissue in the visual language of a working Louisiana
// industrial corridor rather than a second downtown: low warehouses and
// container yards on the industrial flats, strip and brick frontage along the
// highway, a motel and a diner where the two districts' traffic meets, parking
// lots, and ONE deliberate green — a small park, because a metropolis is a
// place whose trees are somewhere chosen rather than everywhere by default.
//
// urban: true, so composer.js fills not one unclaimed square metre of this with
// pines. parks: one rect. That is the mechanism the no-green-wedge change gave
// Chatboro, Tusouxroe and the Crown Strip, and it is why this module reads as
// city rather than as the gap it replaces.
//
// Laid out by composer.js in its six stages, in WORLD coordinates: this district
// has no DISTRICTS entry because it is a seam filler, not a place you arrive at,
// so it takes the highway's x directly instead of a local origin.
// ---------------------------------------------------------------------------

import { createComposer } from "./composer.js";
import { createTownKit } from "./townkit.js";

// US-167 runs at x = −6 for the length of the map (stateWorld.js). This band
// sits either side of it.
const ROAD_X = -6;

// The band, overlapping a little into each neighbour so the fabric actually
// MEETS them rather than butting up. North reaches past the Crown Strip's
// southern approach, south runs under OrleaRouge's grid, west past Chatboro,
// east toward the East Bank's frontage.
const BOUNDS = { x0: -248, x1: 122, z0: -140, z1: 134 };
const CORE = { x0: -244, x1: 118, z0: -136, z1: 130 };

// Furthest north this district may BUILD, as opposed to BOUNDS.z0 (-140), which
// is how far it CLAIMS. Metro.js claims everything north of METRO_CLAIM_Z0 (-135)
// and sits ahead of Orleanorth in main.js's extraZone chain, so ground at
// z >= -135 belongs to Metro. The Crown Strip's own z1 is -134, so -134 is the
// one line that is neither Metro's nor a gap: everything Orleanorth builds lands
// on ground it is also the owner of, while BOUNDS still covers the seam band up
// to -140 so the trees stay off it. See C.road("US-167 Orleanorth") and the
// cross streets below.
const NORTH_LIMIT = -134;

// The ONE green in this district. Its rect is allocated below, alongside the
// blocks, because it has to fit between Chatboro and the lanes like everything
// else. "No trees except in city parks" needs an actual park to point at.

const R = (x0, z0, x1, z1) => ({ x0, z0, x1, z1 });

export function createOrleanorth(ctx) {
  const T = createTownKit(ctx);

  // ALLOCATED by tools/qa/orleanorth_layout.mjs -- do not hand-edit.
  // Chatboro is a live village inside this band (x -96..48, z -120..100, read
  // from chatboro.js) and keeps all of its ground, including US-167 and
  // Chatboro Main running through it. The first version of this district
  // ignored that and put ten rects, the motel and the park on top of it.
  const PARK = { x0: -244, x1: -200, z0: -24, z1: 20 };
  const INDUSTRIAL = [
    R(-244, -132, -210, -76),
    R(-244, 92, -210, 130),
    R(-130, -132, -96, -76),
    R(-130, -20, -96, 36),
    R(-130, 92, -96, 130),
  ];
  const EAST = [
    R(22, 102, 56, 130),
    R(60, -132, 94, -76),
    R(60, -20, 94, 36),
    R(60, 92, 94, 130),
  ];

  const C = createComposer(ctx, {
    name: "Orleanorth",
    bounds: BOUNDS,
    zones: { core: CORE, wild: BOUNDS },
    seed: 60412,
    // No green wedge (human request, 2026-10-01). This is the middle of a
    // metropolis: its unclaimed ground is unbuilt CITY ground, developed by the
    // fabric below, not forest.
    urban: true,
    parks: [PARK],
  });



  // Claim every allocated rect before laying a single road. composer.site()
  // warns when a rect is not free, and the lanes below cut through this band, so
  // claiming after them produced a chain of overlap warnings. The allocator
  // already guarantees these rects clear every lane and neighbour.
  INDUSTRIAL.forEach((r, i) => C.site(`industrial ${i}`, r));
  EAST.forEach((r, i) => C.site(`east fabric ${i}`, r));
  C.site("Memorial Green", PARK);

  // The highway the frontage hangs off. stateWorld already paves US-167, so
  // this only marks it on our own grid to keep us off it (`paved: false`).
  //
  // North end: NORTH_LIMIT, not BOUNDS.z0 (-140). BOUNDS is where this district
  // CLAIMS; NORTH_LIMIT (-134) is the furthest north it may STAND anything. The
  // two differ on purpose. Metro sits AHEAD of Orleanorth in main.js's extraZone
  // chain and metro.js claims everything north of METRO_CLAIM_Z0 (-135), so
  // anything Orleanorth builds at z >= -135 is standing on Metro's claim.
  // Measured by tools/qa/seam_collision_test.mjs: with the road starting at -140
  // the first two highway-frontage slots (x -28..12, z -133, eight 4 m cells)
  // sat inside Metro's claim. Starting the road at -134 moves every frontage
  // slot south of that line. The claim still reaches -140 so the 5 m strip
  // between the Crown Strip's z1 (-134) and Metro's claim stays urban ground
  // rather than falling through to forest.
  C.road("US-167 Orleanorth", [[ROAD_X, NORTH_LIMIT], [ROAD_X, 134]], { width: 10, paved: false, lampEvery: 40 });
  // The park drive. Also a road, so it has to be laid before the frontage too.
  // Along the park's SOUTH edge (z -12), not across it: at z 13 this drive ran
  // straight through the lawn rectangle, so the road and the park claimed the
  // same ground and the composer warned about it.
  C.road("Memorial Green drive", [[-118, -12], [-76, -12]], { width: 6, sidewalk: 1 });

  // Highway frontage: strip malls and brick blocks shoulder to shoulder, the
  // way they do on a US-167 exit, because this is the ground people actually
  // enter the city on.
  C.frontage("US-167 Orleanorth", {
    label: "highway frontage",
    setback: 14,
    spacing: 26,
    footprint: { w: 20, d: 16 },
    // startAt/endAt are distances ALONG the road from its start, not world z.
    // The road already spans z -140..134, so both are 0: walk it end to end.
    startAt: 0,
    endAt: 0,
    build: (slot) => {
      const kind = T.hash(slot.x, slot.z, 11);
      if (kind < 0.40) return T.shops.strip({ names: ["GAS & GO", "CHECK CASHING", "LAUNDRY", "BEER & LIQUOR", "AUTO PARTS", "PAWN"] })(slot);
      if (kind < 0.72) return T.shops.brickBlock({ names: ["FURNITURE", "HARDWARE", "APOTHECARY", "BOOKS", "RADIO"] })(slot);
      if (kind < 0.88) return T.shops.gasStop()(slot);
      return T.houses.mixed(["shotgun", "bungalow"])(slot);
    },
  });

  // Cross streets, so the band reads as a grid rather than a strip either side
  // of the highway.
  // Each street sits in a GAP between blocks, never through one. At x -120 and
  // x 40/90 they ran straight through Memorial Green, the motel, the diner and
  // the east fabric, which the composer reported as sites overlapping ground
  // already taken. Roads are laid before the sites are built, so a street across
  // a lot means the lot loses.
  // NORTH_LIMIT, not -138, for the same reason as US-167 above: a road reaching
  // past -135 puts its frontage (and any lot either side of it) on Metro's claim.
  for (const [name, x, zEnd] of [["Millrace", -193, 120], ["Foundry", -139, 120], ["Tannery", -58, 130], ["Bayou", 14, 130], ["Carondelet", 112, 128]])
    C.road(name, [[x, NORTH_LIMIT], [x, zEnd]], { width: 8, sidewalk: 1.5, stage: "sideStreets", lampEvery: 44 });

  for (const [i, r] of INDUSTRIAL.entries()) {
    C.openArea(`industrial ${i}`, {
      build: (rect, c) => {
        const slot = { ...c, rect, x: c.x, z: c.z, index: i, side: 1, rot: 0 };
        const kind = T.hash(r.x0, r.z0, 21 + i);
        if (kind < 0.45) return T.shops.warehouse({ tone: [0x8a8f96, 0x7a6f62, 0x6f7a80][i % 3], w: Math.min(c.w - 6, 34), d: Math.min(c.d - 6, 24) })(slot);
        if (kind < 0.80) return T.areas.containerYard(C, { seed: 60412 + i * 7, fill: 0.5 + (i % 3) * 0.15 })(rect, c);
        return T.shops.barn()(slot);
      },
    });
  }
  for (const [i] of EAST.entries()) {
    C.openArea(`east fabric ${i}`, {
      build: (rect, c) => (i === 1
        ? T.shops.brickBlock({ names: ["SUPPLY CO", "LAUNDROMAT", "TACOS"] })({ ...c, rect, index: i, side: 1, rot: 0 })
        : T.areas.containerYard(C, { seed: 61100 + i * 5, fill: 0.5 })(rect, c)),
    });
  }

  // The seam landmarks: cheap, lit, and exactly what is on a state highway
  // where the city changes its name without changing its character.
  C.openArea("Memorial Green", { color: "#3f6b34", build: T.areas.green(C) });

  return {
    buildSet: () => C.report(),
    zoneAt: (x, z) => C.zoneAt(x, z),
    zoneRects: C.zoneRects,
    get report() { return C.report(); },
  };
}