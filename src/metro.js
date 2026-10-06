// ---------------------------------------------------------------------------
// metro.js — Downtown Bayou: the city that grows up on both sides of US-167 around the spawn strip (human request, 2026-09-27:
// "the area around the Crown Strip and the spawn area is our city area — a very metropolis, very modern New Orleans vibe").
//
// The roadside stores along the highway stay where they are (their lots are claimed); behind them, east and west, a street grid of
// blocks: glass and art-deco towers near the highway, hotel slabs, plazas with live oaks, and French Quarter terraces (stucco, shutters,
// iron balconies, gaslights) out toward the edges — the skyline of the Crown Strip to the north and OrleaRouge to the south, joined up.
//
// Composed with composer.js like the other districts; the parts (towers, rowhouses, plazas) are in cityparts.js.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { createComposer } from "./composer.js";
import { createCityParts } from "./cityparts.js";
import { makeRoadway } from "./traffic.js";
import { createMarkings } from "./markings.js";
import { onParishHighway, onDirtRoad, HAMLET, REST } from "./westparish.js";
import { CROWN_STRIP } from "./crownstrip.js";

const ROAD_X = -6;
// z0 is -180, not -132, so that the northern ROWS[0] above is actually inside the
// district. Everything that reads METRO_BOUNDS.z0 — the composer's own bounds,
// the highway claim, the two parish-road scans, the verge frontage bands and
// zoneAt — then covers the seam in the same step, which is the point: a row
// outside its own district would be built and then classified as somebody else's
// ground by main.js's zone chain, and the trees would come straight back.
//
// But -180 overreaches: crownstrip.js's own BOUNDS are z0 -440, z1 -134, so the
// Strip already builds 46 m of the seam's ground. Claiming to -180 put 109
// CrownStrip cells and 8 orleanorth cells inside Metro's claim, which
// tools/qa/seam_collision_test.mjs reported as 118 contested cells (its printed
// "no inter-region collision" line disagreed with its own exit code — the check
// is process.exit(ok ? 0 : 1) on a different condition than the text).
//
// z0 is therefore -180 for the BUILD rows and -134 for the CLAIM, via
// METRO_CLAIM_Z0 below. Metro builds the whole seam and claims only the part no
// other district occupies, so the seam stays urban (nothing gets planted) while
// the districts keep non-overlapping claims.
export const METRO_BOUNDS = { x0: -292, x1: 292, z0: -180, z1: 128 };
// North edge of Metro's claim: one metre south of the Strip's z1 (-134), which is
// the furthest north the Strip actually builds. Everything that must be EXCLUDED
// from another district's ground uses this, not METRO_BOUNDS.z0.
export const METRO_CLAIM_Z0 = -135;
const STREETS_Z = [-108, -52, 4, 60, 112];
const AVENUES_X = [-168, 168];
const STREET_W = 10, AVENUE_W = 12;

// Multi-lane, and it fits without moving a single building.
//
// Both roads are 10 m and 12 m of tarmac today, and the blocks either side sit a
// uniform 7 m back from every centreline (the ROWS/COLS constants are built on a
// 56 m pitch with a 7 m half-gap). Two lanes each way of 2.4 m either side of a
// 0.4 m median is 0.2 + 4.8 = 5.0 m from the centre, so the paved width is 10.0 m
// — the existing street width exactly, with a metre of shoulder left over on the
// 12 m avenues.
//
// That is the whole reason this was worth doing rather than a rebuild: the
// carriageway was already the right size for four lanes and had been carrying
// two. Widening the tarmac instead would have pushed into the 7 m gap and moved
// every building on sixteen blocks.
const STREET_ROAD = { name: "Metro", lanes: 2, median: 0.4, laneWidth: 2.4, cruise: [8, 13] };
const AVENUE_ROAD = { name: "Bayou Ave", lanes: 2, median: 0.4, laneWidth: 2.4, cruise: [9, 14] };
// blocks: rows between the streets, columns between the avenues and the highway lots.
//
// The grid has to reach the district's own bounds, or the city stops short of
// them and leaves a fringe of nothing a player can stand in. ROWS[0] and ROWS[5]
// are the strips outboard of the first and last street, and COLS[0]/COLS[3] run
// from the outer avenue to the edge — measured by tools/qa/landuse.mjs, which
// counted the leftover 30 m fringe as open ground.
// ROWS[5] stops at 125, not at the district edge (128): OrleaRouge's z 130 street
// is 9 m wide, so its kerb is at 125.5, and a row to 128 put the terrace fronts
// on the westbound lane's line. The row is a 6 m frontage (see frontage()).
//
// ROWS[0] is new, and it is here because of a measured void rather than a plan.
// Metro used to start at z -132 and the Crown Strip's hand-written zoneAt
// answers "forest" over its own unbuilt margin, so z -179..-131 — 49 m deep and
// the full width of the corridor between the spawn and the Strip — classified as
// forest, classified nothing else, and got planted at the forest rate instead of
// being built on. Measured: 100% of that cross-section bare, on the one stretch
// of the drive that is nothing but drive. It is a seam between two districts'
// bounds, not ground anybody wanted green. Metro takes it, because metro is
// ahead of crownStrip in main.js's extraZone chain, so the claim also decides the
// zone answer: "urban", not "forest".
//
// The rows start at -167, not at the -180 the district now claims. The Strip's
// Civic Center Way and Industrial Drive both run down to z -160 and carry
// frontage filler on their last stretch; its own buildings reach z -168, and a
// terrace built to -180 grew through them (measured: a 9 m Strip building at
// x -159..-155, z -172..-168). So Metro claims the ground — which is what stops
// the planting — and builds on the part of it that is actually free. The 13 m
// between -180 and -167 stays the Strip's, and seam_build_test measures the band
// that is built rather than the band that is claimed.
//
// The seam is split in two rather than left as one 47 m block. A single deep row
// gets a tower, and a tower is placed at the block's CENTRE: measured, that left
// 8 m of bare ground at the top of the row and 8 m at the bottom of it, so the
// seam's two edges — the parts actually seen from the road — were the emptiest
// ground in the district while the middle was dense. frontage() is the file's own
// answer to a shallow row, and it fills the row edge to edge with Creole
// terraces instead of leaving a setback. So ROWS[0] is 9 m of frontage and
// ROWS[1] is the 38 m block behind it, and the visible edge of the seam is built
// to the pavement.
//
// No street is introduced between them, for the reason above: they are one
// superblock, and plots() splits the deep rank on its own.
const ROWS = [[-167, -158], [-158, -133], [-132, -115], [-101, -59], [-45, -3], [11, 53], [67, 105], [119, 125]];
const COLS = [[-290, -175], [-161, -73], [63, 161], [175, 290]];

// Ground west of the highway that was here before the grid: the Bayou Noir
// hamlet (church, general store, sheds) and the Hwy 9 rest stop, both built by
// westparish.js. The grid grew over them and ran two streets through the church
// and one through the gas station, so the city now builds AROUND them, the way
// OrleaRouge breaks its grid round the Superdome: no block, plot or street on
// this ground. Read from westparish.js, so they move together. REST_R holds the
// gas station, its parked cars and the apron out to the highway.
const REST_R = 30;
const KEEP = [
  { x: HAMLET.x, z: HAMLET.z, r: HAMLET.r + 4 },
  { x: REST.x, z: REST.z, r: REST_R },
];

// The Crown Strip's east and west frontage corridor. Its glass columns stand at
// x = +/-214 (w 28, d 30) and its street furniture runs down the same lines, and
// Metro's outer block column is x 175..290 — so the two districts' outermost
// blocks interlock along this boundary and the seam's terraces were measured
// growing straight through them: 73 intersecting box pairs, at x -220..-199,
// z -153..-134, from Crown Strip props as small as a 4 m planter as well as from
// the towers themselves.
//
// Keeping out the individual footprints was not enough and was not the right
// shape. Claiming the corridor as a band, once, is both simpler to reason about
// and honest about what it costs: a 30 m strip either side of the tower line is
// left as Crown Strip's frontage for the seam's depth, about 2,900 m2 of the
// 28,000 m2 band. That is reported rather than hidden — it is real remaining
// unclaimed ground, and it reads correctly, because it is where the Strip's own
// buildings are.
//
// These numbers are read from src/crownstrip.js's skyline statement, which is a
// local inside its buildSet and not exported. That is the weak link: if the Strip
// moves its columns this band is the thing that will be wrong, and
// seam_collision_test is what will say so. Exporting the skyline from
// crownstrip.js and deriving this is the proper fix and is left to whoever owns
// that file.
const CROWN_TOWER_X = 214, CROWN_TOWER_HW = 14;
const CROWN_FRONTAGE_X0 = CROWN_TOWER_X - CROWN_TOWER_HW - 16;   // 184
const CROWN_FRONTAGE_X1 = CROWN_TOWER_X + CROWN_TOWER_HW + 16;   // 244
const CROWN_FRONTAGE_Z1 = -133;
const CROWN_FRONTAGE_BANDS = [-1, 1].map((s) => (s < 0
  ? { x0: s * CROWN_FRONTAGE_X1, x1: s * CROWN_FRONTAGE_X0 }
  : { x0: CROWN_FRONTAGE_X0, x1: CROWN_FRONTAGE_X1 }));
/**
 * The runs of a west-side street, [[east, west], ...] from x `east` to `west`
 * (east > west), with the kept ground cut out and each cut end pulled back
 * `pad` metres from it. Runs shorter than 24 m are dropped.
 */
function westRuns(z, east, west, pad) {
  const cuts = [];
  for (const k of KEEP) {
    const dz = Math.max(0, Math.abs(z - k.z) - STREET_W / 2);
    if (dz >= k.r) continue;
    const half = Math.sqrt(k.r * k.r - dz * dz);
    cuts.push([k.x + half + pad, k.x - half - pad]);
  }
  cuts.sort((a, b) => b[0] - a[0]);
  const runs = [];
  let from = east;
  for (const [ce, cw] of cuts) {
    if (ce < from) runs.push([from, Math.max(ce, west)]);
    from = Math.min(from, cw);
  }
  if (from > west) runs.push([from, west]);
  return runs.filter(([a, b]) => a - b >= 24);
}

export function createMetro(ctx) {
  const { scene } = ctx;
  const occluders = [];
  const parts = createCityParts(ctx, { occluders });
  const hash = parts.hash;
  const C = createComposer(ctx, { name: "Metro", bounds: METRO_BOUNDS, zones: { core: METRO_BOUNDS, wild: METRO_BOUNDS }, seed: 4711 });
  const pois = [];
  let announced = false;

  // Four lanes each way, from the same makeRoadway the rest of the state uses,
  // so a Metro street gets the same overtaking, the same lane-change logic and
  // the same circuit chaining as US-167. Each carriageway is its own roadway
  // because the highway splits the grid: the east and west halves are joined by
  // a junction, not by tarmac.
  //
  // Every roadway is NAMED for itself. They were all "Metro" (and both avenues
  // "Bayou Ave"), and traffic.js resolves a lane's `next` by name, keeping only
  // the last lane of each name: a car reaching the end of any Metro street was
  // handed to the last street's return lane, somewhere else on the map.
  const lanes = [];
  for (const z of STREETS_Z) {
    lanes.push(...makeRoadway({ ...STREET_ROAD, name: `Metro ${z} E`, points: [[62, z], [274, z]] }));
    westRuns(z, -72, -274, 2).forEach(([e, w], k) =>
      lanes.push(...makeRoadway({ ...STREET_ROAD, name: `Metro ${z} W${k ? "~" + k : ""}`, points: [[e, z], [w, z]] })));
  }
  for (const x of AVENUES_X) {
    lanes.push(...makeRoadway({ ...AVENUE_ROAD, name: `Bayou Ave ${x}`, points: [[x, 118], [x, -118]] }));
  }

  function buildSet() {
    // ---- what is already there, claimed before anything is composed: the highway and its roadside lots (stores, gas, the trailer park and
    // the junkyard), and Parish Highway 9 swinging away to the south-west
    C.claim({ x0: -62, x1: 52, z0: METRO_BOUNDS.z0, z1: METRO_BOUNDS.z1 });
    // The highway keeps an 18 m corridor: the 14 m carriageway plus 2 m of
    // shoulder and verge each side. It used to be claimed with pad 30, which is
    // 37 m from the centreline — a 74 m exclusion for a 14 m road, half again as
    // wide as the avenue it crosses. See the block subdivision below for what
    // that cost.
    for (let x = -292; x < -60; x += 8) for (let z = METRO_BOUNDS.z0; z < METRO_BOUNDS.z1; z += 8) {
      if (onParishHighway(x + 4, z + 4, 4)) C.claim({ x0: x, x1: x + 8, z0: z, z1: z + 8 });
    }
    // Bayou Noir, the rest stop (KEEP above) and the dirt road between them: nothing of the city's on any of it
    for (let x = -292; x < -60; x += 4) for (let z = METRO_BOUNDS.z0; z < METRO_BOUNDS.z1; z += 4) {
      const cx = x + 2, cz = z + 2;
      if (KEEP.some((k) => Math.hypot(cx - k.x, cz - k.z) < k.r)) C.claim({ x0: x, x1: x + 4, z0: z, z1: z + 4 });
      else if (onDirtRoad(cx, cz, 3)) C.claimRoad({ x0: x, x1: x + 4, z0: z, z1: z + 4 });
    }
    // The Strip's east and west frontage corridor, claimed before the grid is
    // composed for the same reason KEEP exists: so plots() and the terrace pass
    // see the ground as taken and build around it, instead of the two districts'
    // meshes interpenetrating. Bounded at METRO_BOUNDS.z0 on the north, so the
    // claim does not reach past the seam into ground the Strip has not built.
    // Bounded at METRO_CLAIM_Z0 (-135), not METRO_BOUNDS.z0 (-180): reaching -180
    // claimed ground the Strip already builds on. See METRO_CLAIM_Z0.
    for (const t of CROWN_FRONTAGE_BANDS)
      C.claim({ x0: t.x0, x1: t.x1, z0: METRO_CLAIM_Z0, z1: CROWN_FRONTAGE_Z1 });

    // ---- roads. Streets stop at the highway lots and at the outer edge; the avenues run the full depth.
    for (const z of STREETS_Z) {
      C.road(`Metro Street ${z}`, [[56, z], [280, z]], { width: STREET_W, lampEvery: 38, y: 0.021 });
      westRuns(z, -66, -280, 0).forEach(([e, w], k) =>
        C.road(`Metro Street W ${z}${k ? "~" + k : ""}`, [[w, z], [e, z]], { width: STREET_W, lampEvery: 38, y: 0.021 }));
    }
    // sidewalk: 0.9, not composer's default 1.6. The blocks either side of an
    // avenue sit 7 m back from the centreline, and 12/2 + 1.6 = 7.6 meant the
    // claimed corridor overlapped the block by 0.6 m on every avenue — the
    // sidewalk was being drawn through the kerb of the building behind it. The
    // avenue is the widest road in the district and the one most likely to be
    // walked across, so it keeps a real footway; it just fits inside the gap.
    for (const x of AVENUES_X) C.road(`Bayou Avenue ${x}`, [[x, -120], [x, 120]], { width: AVENUE_W, sidewalk: 0.9, lampEvery: 34, y: 0.022 });

    // ---- the paint. Four lanes of traffic on a road with no lane markings is
    // the same invisible-work problem US-167 had: the cars are real and the
    // tarmac says nothing about them. Crossings go at the avenue/street
    // junctions and at the grid's edge, where the avenues run out of city.
    {
      const M = createMarkings({ y: 0.021 });
      for (const z of STREETS_Z) {
        M.roadway({ ...STREET_ROAD, points: [[62, z], [274, z]], y: 0.021 });
        for (const [e, w] of westRuns(z, -72, -274, 2)) M.roadway({ ...STREET_ROAD, points: [[e, z], [w, z]], y: 0.021 });
        for (const x of AVENUES_X) {
          M.junction(x, z, { alongX: true, half: STREET_W / 2, y0: 0.021 });
        }
      }
      for (const x of AVENUES_X) {
        M.roadway({ ...AVENUE_ROAD, points: [[x, 118], [x, -118]], y: 0.021 });
        // the avenue's far ends, where it leaves the grid
        for (const z of [-108, 112]) M.junction(x, z + (z < 0 ? -6 : 6), { alongX: false, half: AVENUE_W / 2, y0: 0.021 });
      }
      M.flush(scene);
    }

    // ---- the blocks
    //
    // A block the highway or the roadside lots have taken is not SKIPPED. The old
    // fallback cut it into three columns and built on whichever were free, and a
    // diagonal road crosses all three — so every block Parish Highway 9 touched
    // came out empty, six of sixteen, and 41% of the district read as open ground
    // (tools/qa/landuse.mjs). The fix is to cut in BOTH axes: the road is a
    // diagonal, so only a grid of plots finds the corners it leaves.
    //
    // What goes in the gap matters as much as that something does. The plots
    // beside a 14 m four-lane road at 60 mph are not where you put glass towers,
    // so this is the low-rise stock — parking decks, brick midrises, and a
    // terrace of shotgun/creole houses where the plot is wide enough — which is
    // also what a real city's edge looks like: the towers stop, the industry and
    // the houses start.
    const PLOT = 24;
    function plots(b) {
      const nx = Math.max(1, Math.round(b.w / PLOT)), nz = Math.max(1, Math.round(b.d / PLOT)), out = [];
      for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
        const r = {
          x0: b.x0 + (b.w * i) / nx + 1, x1: b.x0 + (b.w * (i + 1)) / nx - 1,
          z0: b.z0 + (b.d * j) / nz + 1, z1: b.z0 + (b.d * (j + 1)) / nz - 1,
        };
        r.w = r.x1 - r.x0; r.d = r.z1 - r.z0; r.cx = (r.x0 + r.x1) / 2; r.cz = (r.z0 + r.z1) / 2;
        // The floor is 6 m, not 9 m, and the difference is one whole block. A 9 m
        // row (ROWS[5]) is cut into one plot whose depth is b.d - 2 = 7 m, so a 9 m
        // test rejected EVERY plot in it and the block was left claimed and empty:
        // x -290..-175, z 119..128, 1035 m2 of bare ground inside the city that
        // counted as covered because the claim survived. 6 m is the depth a low
        // brick frontage actually needs, and lowRise() picks the stock by the
        // plot's own proportions, so a thin plot gets a terrace and not a tower.
        if (r.w < 6 || r.d < 6) continue;                          // too small to be a building, and too small to matter
        if (C.isFree(r)) out.push(r);
      }
      return out;
    }
    // ---- a block too shallow for a block is a street front, and must be built as one
    //
    // ROWS[5] is 9 m deep against 115 m wide. It used to be handed to the same
    // vocabulary as the 42 m downtown blocks, and every branch of that vocabulary
    // is written as `Math.min(<sensible depth>, b.d - <inset>)`, which on a 9 m row
    // is `Math.min(30, 1)` — the "twin towers" were two slabs ONE METRE deep, the
    // deco tower's plaza was a 1 m ribbon, and the French Quarter branch was worse:
    // it puts rowhouses at `b.z0 + 5` and `b.z1 - 5`, which on a 9 m row is z 124
    // and z 123 — two terraces one metre apart, overlapping — around a plaza
    // requested at `b.d - 26`, i.e. MINUS SEVENTEEN METRES.
    //
    // So the outboard row was not under-built, it was MALFORMED, and the measured
    // cost was 4 blocks producing 80 structures of nonsense geometry. The fix is
    // not to clamp the tower depth (that would push 30 m towers into the street and
    // through the SEAM) but to recognise the shape: too shallow to hold a block, it
    // holds a frontage. Creole is 8 m deep, so on a 9 m row it fills the row
    // honestly — front and back, no gap, nothing overlapping.
    //
    // 14 m is the cut, chosen from the measured row depths rather than guessed: the
    // real rows are 38..42 m, ROWS[0] is 17 m, ROWS[5] is 9 m. An aspect-ratio test
    // was tried first and was far too wide — at 2:1 it also caught the 42 m blocks
    // (115x42 is 2.7:1) and turned the whole city into 7 m terraces.
    const FRONTAGE_D = 14;
    function frontage(g, b, seed) {
      // One terrace, one depth, filling the row. The inset is asymmetric on purpose:
      // a frontage wants its face on the block edge, and the block edge is where the
      // sidewalk already is, so there is nothing to leave a gap for.
      // A Creole house is 8 m deep with a 1 m upper-floor overhang; on the 6 m
      // outboard row it is built shallower rather than out into the next street.
      const d = Math.min(8, b.d - 1);
      const z = b.z0 + d / 2 + 0.5;
      for (let x = b.x0 + 2; x < b.x1 - 5; x += 8) parts.creole(g, x + 3, z, 6, 1, seed + x, d);
      // a 9 m row has no back lot, but a 17 m one does, and leaving it bare is how
      // a terrace reads as a wall with a field behind it. Shotgun is 7 m deep.
      if (b.d >= 15) {
        for (let x = b.x0 + 2; x < b.x1 - 4; x += 5) parts.shotgun(g, x, b.z1 - 4, -1, seed + x);
        parts.garage(g, b.cx, b.cz, b.w * 0.3, Math.min(10, b.d - 4), 2, seed + 3);
      }
    }
    function lowRise(g, r, seed) {
      // A plot shallower than the stock's own inset is a frontage plot, not a
      // block. The branches below all ask for `r.d - 3` or `r.w - 1`, so on a 7 m
      // plot they return a 4 m deep "tower" or a 6 m wide "midrise" — shapes that
      // read as a mistake and contribute nothing. Creole is 8 m deep and rowhouses
      // 9 m, so at these depths the honest answer is the low frontage stock, and
      // this test has to come before the hash decides anything.
      if (r.d < 14) {
        for (let x = r.x0 + 1; x < r.x1 - 5; x += 8) parts.creole(g, x + 3, r.z0 + r.d / 2, 6, 1, seed + x);
        // parking off to one side, which is the ground-level texture that makes a
        // low street read as a city rather than as a row of boxes
        if (r.w >= 20) parts.garage(g, r.x1 - r.w * 0.18, r.cz, r.w * 0.3, Math.min(9, r.d - 1), 2, seed + 5);
        return;
      }
      const h = hash(r.cx, r.cz, 13);
      if (h < 0.26 && r.w >= 16 && r.d >= 16) parts.garage(g, r.cx, r.cz, r.w, r.d, 2 + Math.floor(hash(r.cx, r.cz, 14) * 3), seed);
      else if (h < 0.34) parts.tower(g, r.cx, r.cz, r.w - 2, r.d - 3, 16 + hash(r.cx, r.cz, 14) * 10, 2, seed);
      else if (h < 0.68) parts.midrise(g, r.cx, r.cz, r.w - 1, r.d - 1, 11 + hash(r.cx, r.cz, 15) * 13, seed);
      else if (r.w >= 15) {
        // a terrace of Creole houses facing +z, and shotguns down the back
        for (let x = r.x0 + 1; x < r.x1 - 4; x += 7) parts.creole(g, x + 3, r.z0 + 5, 6, 1, seed + x);
        if (r.d >= 26) for (let x = r.x0 + 2; x < r.x1 - 3; x += 4) parts.shotgun(g, x, r.z1 - 10, -1, seed + x);
      } else parts.midrise(g, r.cx, r.cz, r.w - 1, r.d - 1, 10 + hash(r.cx, r.cz, 15) * 9, seed);
    }

    let n = 0;
    for (let i = 0; i < COLS.length; i++) {
      for (let j = 0; j < ROWS.length; j++) {
        const [x0, x1] = COLS[i], [z0, z1] = ROWS[j];
        const b = { x0, x1, z0, z1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, w: x1 - x0, d: z1 - z0 };
        if (!C.isFree({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 })) {
          for (const r of plots(b)) {
            const seed = n * 31 + Math.round(r.cx) + Math.round(r.cz);
            C.cluster(`plot ${seed}`, () => {
              const g = new THREE.Group(); scene.add(g);
              lowRise(g, r, seed);
            });
            C.claim({ x0: r.x0, x1: r.x1, z0: r.z0, z1: r.z1 });
          }
          n++;
          continue;
        }
        const core = Math.abs(b.cx - ROAD_X) < 150;                                     // the two columns beside the highway are downtown
        const r = hash(b.cx, b.cz, 5);
        C.cluster(`block ${n}`, () => {
          const g = new THREE.Group(); scene.add(g);
          const mid = hash(b.cx, b.cz, 6);
          // A row too shallow to hold a block holds a frontage, and this test comes
          // FIRST so that no shallow row is ever decided by the hash below. Every
          // branch past this point subtracts a fixed inset from b.d, so on a 9 m row
          // they all produce degenerate or negative geometry — see frontage().
          if (b.d < FRONTAGE_D) frontage(g, b, n);
          else if (core ? r < 0.42 : r < 0.3) {
            // twin towers on a shared podium plaza
            const hA = core ? 78 + mid * 46 : 42 + mid * 26, hB = core ? 64 + hash(b.cx, b.cz, 7) * 44 : 36 + hash(b.cx, b.cz, 7) * 24;
            parts.tower(g, b.cx - b.w * 0.24, b.cz, Math.min(34, b.w * 0.34), Math.min(30, b.d - 8), hA, [0, 3, 1][n % 3], n);
            parts.tower(g, b.cx + b.w * 0.24, b.cz, Math.min(32, b.w * 0.32), Math.min(28, b.d - 10), hB, [1, 0, 3][n % 3], n + 1);
            parts.plaza(g, b.cx, b.cz, b.w * 0.2, b.d - 8, n);
          } else if (core ? r < 0.72 : r < 0.5) {
            // an art-deco tower with a live-oak plaza beside it
            const flip = hash(b.cx, b.cz, 8) < 0.5 ? -1 : 1;
            parts.tower(g, b.cx + flip * b.w * 0.2, b.cz, Math.min(36, b.w * 0.4), Math.min(32, b.d - 8), core ? 92 + mid * 34 : 50 + mid * 20, 1, n);
            parts.plaza(g, b.cx - flip * b.w * 0.26, b.cz, b.w * 0.38, b.d - 8, n);
          } else if (core ? r < 0.88 : r < 0.62) {
            // a long hotel slab
            parts.tower(g, b.cx, b.cz, Math.min(64, b.w - 14), Math.min(26, b.d - 14), core ? 48 + mid * 22 : 34 + mid * 14, 2, n);
          } else {
            // the French Quarter: terraces along the block's two long sides, a courtyard between
            parts.rowhouses(g, b.x0 + 2, b.x1 - 2, b.z0 + 5, -1, n);
            parts.rowhouses(g, b.x0 + 2, b.x1 - 2, b.z1 - 5, 1, n + 7);
            parts.plaza(g, b.cx, b.cz, b.w - 24, b.d - 26, n);
          }
          pois.push({ x: b.cx, z: b.z0 - 5, r: 8, label: "Downtown" });
        });
        C.claim({ x0: b.x0, x1: b.x1, z0: b.z0, z1: b.z1 });
        n++;
      }
    }

    // ---- the strip either side of US-167: the city's real frontage
    //
    // COLS stops at x -73 and x 63 and the highway reservation starts at x -62 and
    // ends at x 52, which leaves two strips 11 m wide running the full 260 m depth
    // of the district with no owner at all: measured 80% and 73% free, unclaimed
    // from end to end. The grid never looked at them because a grid only looks at
    // the rectangles it was handed, and no ROWS/COLS pair covers x -73..-62.
    //
    // This is the ground the highway note is about. A four-lane road with a bare
    // verge on both sides is a road through nowhere; the same road with a strip of
    // low commercial frontage and parking on either side is a road through a city,
    // and it costs nothing in depth because 11 m is exactly a shopfront and a car
    // park. What goes in is deliberately the low stock — midrise with a shop at
    // grade, garage decks, the occasional taller sign block — because that is what
    // faces a 60 mph road in the real world, and because towers here would crowd
    // a corridor that main.js keeps clear at |x - ROAD_X| < 38.
    //
    // The two strips are claimed as the band is built, and each unit re-checks
    // isFree() first, so this pass cannot land on a road, the highway reservation,
    // or anything a later block already put down. It runs LAST, after the grid, so
    // the grid always wins a contested square.
    const FRONTAGE_BANDS = [
      { x0: -73, x1: -62, z0: METRO_BOUNDS.z0, z1: METRO_BOUNDS.z1 },   // west verge
      { x0: 52, x1: 63, z0: METRO_BOUNDS.z0, z1: METRO_BOUNDS.z1 },     // east verge
    ];
    for (const band of FRONTAGE_BANDS) {
      const w = band.x1 - band.x0, cx = (band.x0 + band.x1) / 2;
      // cut the band into ~13 m units down its length: shallow enough that each one
      // is a distinct building and a distinct sign, long enough not to be confetti
      const units = Math.floor((band.z1 - band.z0) / 13);
      for (let i = 0; i < units; i++) {
        const z0 = band.z0 + (i * (band.z1 - band.z0)) / units;
        const z1 = band.z0 + ((i + 1) * (band.z1 - band.z0)) / units;
        const cz = (z0 + z1) / 2, d = z1 - z0;
        const unit = { x0: band.x0 + 0.5, x1: band.x1 - 0.5, z0, z1, cx, cz, w: w - 1, d };
        if (!C.isFree(unit)) continue;                                 // road, junction, or already built
        const seed = 7000 + i * 17 + Math.round(cx);
        C.cluster(`frontage ${seed}`, () => {
          const g = new THREE.Group(); scene.add(g);
          const h = hash(cx, cz, 21);
          if (h < 0.3) {
            // a parking deck: the cheapest thing that makes a road read as a place
            parts.garage(g, cx, cz, w - 2.5, d - 2.5, 2 + Math.floor(hash(cx, cz, 22) * 2), seed);
          } else if (h < 0.78) {
            // a low shop block with a sign band, set back from the road a little
            parts.midrise(g, cx, cz, w - 3, d - 3, 8 + hash(cx, cz, 23) * 7, seed);
          } else {
            // the occasional taller block, so the frontage has a skyline of its own
            // and the highway is not walled by one flat height for 260 m
            parts.tower(g, cx, cz, w - 3.5, d - 4, 22 + hash(cx, cz, 24) * 16, 2, seed);
          }
        });
        C.claim({ x0: unit.x0, x1: unit.x1, z0, z1 });
      }
    }
    return n;
  }

  return {
    BOUNDS: METRO_BOUNDS, lanes, composer: C, buildSet,
    zoneAt(x, z) {
      // Bound at METRO_CLAIM_Z0, NOT METRO_BOUNDS.z0.
      //
      // METRO_BOUNDS.z0 is -180 so the build rows are inside the district, but
      // crownstrip.js's BOUNDS are z0 -440 / z1 -134, so the Strip already builds
      // there. Metro sits AHEAD of the Strip in main.js's extraZone chain, so
      // zoneAt decides ownership: answering for the full -180 made Metro the
      // owner of ground the Strip stands on -- 125 CrownStrip cells plus 8
      // orleanorth cells at z -133, measured by seam_collision_test.mjs.
      //
      // Claiming only down to -135 keeps the seam urban (so CrownStrip's zoneAt
      // never gets to answer "forest" over it and the trees stay away) while
      // leaving the Strip's own ground the Strip's.
      if (x < METRO_BOUNDS.x0 || x > METRO_BOUNDS.x1 || z < METRO_CLAIM_Z0 || z > METRO_BOUNDS.z1) return null;
      const v = C.zoneAt(x, z);
      if (v === "building") return "building";
      if (v === "highway") return "highway";
      return "urban";                                    // the nightlife-and-office crowd (spawnzones.js "urban")
    },
    get pois() { return pois; },
    get props() { return C.props; },
    get minimap() { return C.minimap; },
    get occluders() { return occluders; },
    update(dt, playerPos) {
      const b = METRO_BOUNDS;
      if (!announced && playerPos.x > b.x0 && playerPos.x < b.x1 && playerPos.z > b.z0 && playerPos.z < b.z1 && !(ctx.storyBusy && ctx.storyBusy())) {
        announced = true;
        ctx.flashObjective("DOWNTOWN BAYOU · glass and gaslight. The Quarter is out to the edges.");
      }
      C.update(dt, ctx.camera ? ctx.camera.position : playerPos);
    },
  };
}
