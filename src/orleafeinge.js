// ---------------------------------------------------------------------------
// orleafeinge.js — the road out of OrleaRouge, and the overpass done properly.
//
// WHY THIS EXISTS
//
// The city was grown east to x = 680 and the measurement is blunt: at
// x = 720 there is not one mesh, and nothing at all between there and the edge
// of the map at 1200. The easternmost avenue (674) ran 40 m and stopped in open
// ground. A metropolis that ends in a cliff is not a metropolis with an edge —
// it is a set, and the set is 590 m short of the map boundary the rest of the
// world lives in.
//
// And the elevated crossing was worse. It was ONE 150 × 1.2 × 9 m concrete
// box at y = 8 with five posts under it: a slab. No deck surface (so it read
// as raw concrete from above, which is the angle you approach an overpass
// from), no markings, no parapet to stop you driving off the edge, no ramp, and
// a camp pitched under it for no reason anyone could see. The brief was "the
// roads should be finished", and this is the part that was not.
//
// WHAT IS HERE
//
//   EAST HIGHWAY   a real four-lane divided arterial running east out of the
//                  city grid and off toward the parish: painted lanes, a raised
//                  median, shoulders, an on/off ramp pair that ties into the
//                  last avenue, lighting and signage. This is the thing that
//                  makes the grid read as a city that continues rather than
//                  one that was cut off.
//
//   OVERPASS       the existing crossing, finished: a tarmac deck with lane
//                  markings over the top, a crash barrier down both sides, a
//                  curb, and ramps at each end so it is a road you can get on
//                  rather than a ledge you can look at.
//
// Neither is decoration. Both are the difference between "the world is bigger
// than the city" and "the city is bigger than the world".
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { createMarkings, roadwayHalf } from "./markings.js";

// The arterial: a 4-lane divided road, 2 each way, on a 0.4 m median. The same
// geometry as the US-167 arterial in main.js, so the fringe road and the
// highway the player has been driving are the same kind of road.
export const EAST_HWY = Object.freeze({
  lanes: 4,
  median: 0.4,
  laneWidth: 2.4,
  shoulder: 2.2,
  // where it starts (the last city avenue, 674) and how far east it runs
  x0: 674,
  x1: 1180,
  // the north-south position: it leaves on the middle of the city's z span,
  // which is where a bypass would actually be routed
  z: 348,
});

/** The full paved width, median included. */
export const EAST_HALF = roadwayHalf(EAST_HWY) + EAST_HWY.shoulder;

const RAMP_LEN = 90;          // how long the on/off ramps take to lift
const RAMP_RISE = 5.6;        // the height the elevated crossing sits at

/**
 * @param {object} ctx
 *   scene, addBlocker(x, z, r), surface(kind, size), addLitSpot(spot),
 *   poolLight(...), makeBillboard(...), flashObjective(m)
 * @param {object} opts
 *   mark      — an existing createMarkings() to share, so the fringe's paint
 *               batches with the city's rather than becoming its own draw call
 */
export function createOrleaFringe(ctx, opts = {}) {
  const {
    addBlocker = () => {},
    surface,
    addLitSpot = () => {},
    poolLight = () => {},
    makeBillboard = () => {},
    flashObjective = () => {},
  } = ctx;
  const root = new THREE.Group();
  root.name = "orleafeinge";
  // The road itself is unbatched (see build()): its carriageway planes each set
  // their own texture repeat, and merging them would tile one road's asphalt
  // across another. The edge strip is a different matter — hundreds of small
  // boxes sharing six materials — so it goes in its own group and is left
  // batchable. It is the difference between one draw call and seven hundred.
  const edge = new THREE.Group();
  edge.name = "orleafeinge:edge";
  root.add(edge);
  // what box()/plane()/the wire meshes attach to. buildEdgeStrip() aims it at the
  // edge group; everything else builds into the root.
  let out = root;
  const M = opts.mark || createMarkings({ y: 0.028 });
  const ownsMarkings = !opts.mark;
  const moving = [];

  const asphalt = surface ? surface("asphalt", 1024) : null;
  const concrete = surface ? surface("concrete", 1024) : null;
  const deckMat = (rep, extra) => (asphalt ? asphalt.material(rep, extra) : new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.93 }));
  const concMat = (rep, extra) => (concrete ? concrete.material(rep, extra) : new THREE.MeshStandardMaterial({ color: 0x8f8c86, roughness: 0.9 }));

  function box(w, h, d, mat, x, y, z, name) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true; m.receiveShadow = true;
    if (name) m.name = name;
    out.add(m);
    return m;
  }
  function plane(w, d, mat, x, y, z, name = "fringe tarmac") {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    m.name = name;
    out.add(m);
    return m;
  }

  // ---------------------------------------------------------------- the road
  /**
   * The carriageway. Built as separate carriageways either side of a raised
   * median rather than one wide plane, because a divided road that is a single
   * slab is exactly what makes an arterial read as a parking lot: the median
   * is what tells you which way the traffic goes.
   */
  /**
   * One carriageway of tarmac. `mat` is an already-built material (see
   * deckMat/deckMat callers), not a surface — a `surface()` is the thing that
   * HAS a `.material()` method, and passing one in and calling it again is how
   * this threw on the first build.
   */
  function carriageway(x0, x1, z, halfW, mat, y = 0.02) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    if (w <= 0) return null;
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) {
      if (t) t.repeat.set(Math.max(1, w / 10), Math.max(1, (halfW * 2) / 10));
    }
    return plane(w, halfW * 2, mat, cx, y, z);
  }

  function buildEastHighway() {
    const { x0, x1, z, lanes, median, laneWidth, shoulder } = EAST_HWY;
    const half = lanes * laneWidth / 2;                 // centre to the outer lane edge
    const inner = median / 2;                          // half the median
    const pave = half + shoulder;                      // out to the shoulder edge

    // two carriageways, the median gap between them left for the kerb
    carriageway(x0, x1, z - (inner + half + shoulder) / 2 - inner / 2, (half + shoulder), deckMat(1, { color: 0x2b2b30 }));
    carriageway(x0, x1, z + (inner + half + shoulder) / 2 + inner / 2, (half + shoulder), deckMat(2, { color: 0x2b2b30 }));

    // the raised median: kerbed, grassed, with a barrier down the middle
    box(x1 - x0, 0.22, median + 0.6, concMat(1, { color: 0x8a877f }), (x0 + x1) / 2, 0.11, z, "median kerb");
    box(x1 - x0 - 4, 0.30, median - 0.2, concMat(1, { color: 0x4a5a34 }), (x0 + x1) / 2, 0.30, z, "median planting");
    const rail = concMat(1, { color: 0x9aa0a6, metalness: 0.75, roughness: 0.45 });
    for (let x = x0 + 6; x < x1 - 6; x += 8) {
      box(0.16, 0.75, 0.16, rail, x, 0.72, z, "median barrier post");
    }
    box(x1 - x0 - 12, 0.34, 0.12, rail, (x0 + x1) / 2, 0.95, z, "median barrier rail");

    // The paint. `M.roadway` draws the whole cross-section itself — edge line,
    // lane divider, and a solid line down the middle of a divided road — from a
    // centreline and a lane count, which is the same call US-167 makes. Each
    // carriageway is therefore its own two-lane roadway, offset either side of
    // the median: without these the widest road in the game reads as a runway,
    // which is the other thing the screenshot showed.
    const laneCentre = (dir) => z + dir * (inner + laneWidth);   // the middle of the two lanes
    for (const dir of [-1, 1]) {
      M.roadway({
        lanes: lanes / 2, median: 0, laneWidth,
        points: [[x0, laneCentre(dir)], [x1, laneCentre(dir)]],
        y: 0.02,
      });
    }

    // shoulders, slightly different surface so the road has an edge to read
    const sh = concMat(1, { color: 0x6f6c66, roughness: 0.96 });
    for (const dir of [-1, 1]) {
      plane(x1 - x0, shoulder, sh, (x0 + x1) / 2, 0.016, z + dir * (inner + half + shoulder / 2));
    }

    // blockers down both outer edges: you cannot drive off the side of the
    // world's biggest road
    for (const dir of [-1, 1]) {
      const ex = z + dir * (inner + half + shoulder);
      for (let x = x0; x <= x1; x += 4) addBlocker(x, ex, 0.7);
    }

    // lighting, on the outside of the carriageways, alternating sides the way a
    // real arterial does so the light does not all come from one kerb
    for (let x = x0 + 20; x < x1; x += 44) {
      const dir = ((x / 44) | 0) % 2 ? 1 : -1;
      const lx = x, lz = z + dir * (pave + 1.4);
      addLitSpot({ x: lx, y: 9, z: lz, warm: 0xffd9a0, power: 150, range: 34, pole: true });
      // the pole itself, so the light has a source
      box(0.22, 9, 0.22, concMat(1, { color: 0x4a4740 }), lx, 4.5, lz, "highway light pole");
      box(1.6, 0.14, 0.3, concMat(1, { color: 0x3a3833 }), lx, 8.9, lz + dir * 0.7, "highway light arm");
    }

    // signage at the city end: this is the road out, and it says so
    makeBillboard(EAST_HWY.x0 + 26, 7.5, EAST_HWY.z - EAST_HALF - 5, Math.PI / 2, "EAST  ·  US-11", "CAUSEWAY  12 mi   ·   PARISH  40 mi", "THE CITY STOPS HERE. THE ROAD DOESN'T.");
  }

  // ---------------------------------------------------------------- the ramps
  /**
   * The ramps are what make it a road rather than a runway: a highway that
   * starts in the middle of a field cannot be entered or left, and a city with
   * no way out of it is a diorama. Each is a wedge of tarmac from the last
   * avenue up (or down) to the carriageway, with a barrier on the outside.
   */
  /**
   * A strip of tarmac running from one point to another — the primitive every
   * ramp is made of. Built as a row of quads rather than one rotated plane so
   * a curve is a curve and not a polygon with a visible corner in it.
   *
   * `channel` is the fraction of the run over which the sides are blocked in,
   * as [from, to] along the strip. It is deliberately not the whole run: a
   * ramp's merge end is INSIDE the carriageway it joins, and a channel wall
   * carried that far puts a row of blockers across the running lane of the
   * biggest road in the game. An off-ramp has the same problem at the OTHER
   * end, which is why this is a range and not a single number.
   */
  function strip(from, to, width, mat, name = "ramp", y = 0.028, channel = [0, 1]) {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) return [];
    const STEPS = Math.max(6, Math.round(len / 6));
    // NOT `out`: that is the group the edge strip is built into, and shadowing
    // it here with an array of meshes put the driveways in the wrong place.
    const built = [];
    for (let i = 0; i < STEPS; i++) {
      const t0 = i / STEPS, t1 = (i + 1) / STEPS;
      const ax = from[0] + dx * t0, az = from[1] + dz * t0;
      const bx = from[0] + dx * t1, bz = from[1] + dz * t1;
      const segLen = Math.hypot(bx - ax, bz - az);
      const g = new THREE.PlaneGeometry(segLen * 1.06, width, 1, 1);
      g.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(g, mat);
      m.position.set((ax + bx) / 2, y, (az + bz) / 2);
      // face along the segment
      m.rotation.y = -Math.atan2(bz - az, bx - ax);
      m.receiveShadow = true;
      m.name = name;
      out.add(m);
      built.push(m);
      // blockers either side, so the ramp is a channel you drive down rather
      // than a stripe you can drive across — but only over `channel`
      const mid = (t0 + t1) / 2;
      if (mid >= channel[0] && mid <= channel[1]) {
        const px = -(bz - az) / segLen, pz = (bx - ax) / segLen;
        addBlocker((ax + bx) / 2 + px * width / 2, (az + bz) / 2 + pz * width / 2, 0.7);
        addBlocker((ax + bx) / 2 - px * width / 2, (az + bz) / 2 - pz * width / 2, 0.7);
      }
    }
    return built;
  }

  /**
   * How far along `from -> to` the line stays more than `clear` metres from
   * z = `roadZ`. A ramp's channel walls may only exist inside that range:
   * outside it, a wall is standing in the running lane of the road the ramp is
   * joining, and no car gets past it.
   */
  function clearOf(from, to, roadZ, clear) {
    const dx = to[0] - from[0], dz = to[1] - from[1];
    for (let t = 0; t <= 1.0001; t += 0.01) {
      const z = from[1] + dz * t;
      if (Math.abs(z - roadZ) < clear) return Math.max(0, t - 0.02);
    }
    return 1;
  }

  /**
   * The slip roads. These are the difference between a road and a runway: a
   * highway that begins at the edge of a city with nothing joining it up cannot
   * be entered or left, and a city you cannot drive out of is a diorama.
   *
   * Two on-ramps off the cross streets and two off-ramps back down, each a
   * curve from a city street onto the correct carriageway — north side of the
   * road for eastbound, south for westbound, which is right-hand traffic and is
   * what makes the pair read as a junction rather than two random strips.
   */
  function buildRamps() {
    const { x0, x1, z, lanes, median, laneWidth, shoulder } = EAST_HWY;
    const half = lanes * laneWidth / 2;
    const inner = median / 2;
    const tarmac = concMat(1, { color: 0x2e2e33, roughness: 0.94 });
    const W = 6.4;
    // the two cross streets the ramps come off, and the x they start from
    const joins = [
      { z: 370, dir: 1 },      // north cross street → eastbound (north carriageway)
      { z: 330, dir: -1 },     // south cross street → westbound (south carriageway)
    ];
    for (const j of joins) {
      const laneZ = z + j.dir * (inner + laneWidth * 0.5);   // merge into the inner lane
      // starts on the city street, curves out and joins the carriageway
      const from = [x0 - 30, j.z];
      const to = [x0 + 110, laneZ];
      // The channel stops where the ramp is still clearly OUTSIDE the
      // carriageway. The band is measured, not guessed: the ramp is 6.4 m wide,
      // so its wall has to be more than half a carriageway away from the
      // centreline before it is allowed to exist, and this loop finds that
      // point on the actual line rather than picking a fraction of it.
      // The clearance is the ramp's own half-width PLUS the carriageway's half
      // plus a margin — the wall is W/2 off the ramp's centreline, and it is
      // only "clear of the road" once that wall is outside the carriageway's
      // own half-width. Measuring the ramp CENTRE against the centreline is the
      // version that leaves a row of bollards in the running lane.
      const clear = W / 2 + half + 1.5;
      strip(from, to, W, tarmac, "on-ramp", 0.028, [0, clearOf(from, to, z, clear)]);
      // the merge nose: a gore triangle of paint where the two surfaces meet
      M.roadway({
        lanes: 1, median: 0, laneWidth: W,
        points: [[from[0], from[1]], [to[0], to[1]]],
        y: 0.03,
      });
      // a sign, because a slip road with no sign is how you end up on one
      makeBillboard(from[0] - 16, 6.5, from[1] + j.dir * 7, 0, "EAST  US-11", "KEEP RIGHT", "THE ROAD OUT");
    }
    // and the off-ramps, on the far side of the same junction
    for (const j of joins) {
      const laneZ = z + j.dir * (inner + laneWidth * 1.5);   // the OUTER lane, so you can leave
      const from = [x0 + 190, laneZ];
      const to = [x0 + 70, j.z];
      // ...and the off-ramp's channel starts at the same kind of measured
      // point, for the same reason
      const clear2 = W / 2 + half + 1.5;
      strip(from, to, W, tarmac, "off-ramp", 0.028, [1 - clearOf(from, to, z, clear2), 1]);
    }
  }

  // ---------------------------------------------------------------- the overpass
  /**
   * The crossing at z = 172, finished.
   *
   * It was one 150 × 1.2 × 9 m box. What made it read as unfinished from the
   * ground was not its size but its EDGES: a raw box has no parapet, so you
   * can see the deck is a slab; it has no surface, so from the approach — which
   * is the only angle anyone gets — it is untextured concrete. And it has no
   * ramp, so it is a ledge.
   */
  function buildOverpass() {
    const z = 172, y = 8, len = 150, deckW = 9;
    const tarmac = concMat(1, { color: 0x2a2a2e, roughness: 0.93 });
    const barrier = concMat(1, { color: 0xa8a49c, metalness: 0.3, roughness: 0.6 });

    // the deck: tarmac ON TOP of the structure, which is the part that was
    // missing. This is the surface you actually see.
    plane(len, deckW - 1.6, tarmac, 0, y + 0.62, z);
    // the kerb, either side of the running surface
    for (const s of [-1, 1]) {
      box(len, 0.28, 0.5, concMat(1, { color: 0x8f8c86 }), 0, y + 0.72, z + s * (deckW / 2 - 0.35), "overpass kerb");
    }
    // a crash barrier down each side — the thing that makes it a road
    for (const s of [-1, 1]) {
      box(len, 0.85, 0.3, barrier, 0, y + 1.25, z + s * (deckW / 2 - 0.15), "overpass parapet");
      for (let x = -len / 2 + 2; x < len / 2; x += 4) {
        box(0.14, 0.9, 0.14, barrier, x, y + 1.2, z + s * (deckW / 2 - 0.15), "parapet post");
      }
      // Solid ON THE DECK ONLY. addBlocker is two-dimensional, so these used to
      // be a wall on the ground as well: a 150 m invisible one lying across
      // US-167 and everything else passing under the crossing, which is what
      // shut the road from Chatboro to OrleaRouge. The height band keeps the
      // parapet doing its job up here and lets the highway through underneath.
      for (let x = -len / 2; x <= len / 2; x += 4) {
        addBlocker(x, z + s * (deckW / 2), 0.8, y - 1, y + 5);
      }
    }
    // lane markings along the deck: a two-lane one-way carriageway, which is
    // what the deck actually is, sitting on the structure's own height
    M.roadway({
      lanes: 2, median: 0, laneWidth: 2.4,
      points: [[-len / 2 + 2, z], [len / 2 - 2, z]],
      y: y + 0.62,
    });

    // Ramps at both ends, so it can be driven onto and off. Same primitive as
    // the slip roads, but with a drop: each segment sits lower than the last,
    // which is what turns a ledge into a road you can actually get up.
    for (const s of [-1, 1]) {
      const rx = s * (len / 2);
      const RUN = 34;
      const STEPS = 12;
      for (let i = 0; i < STEPS; i++) {
        const t0 = i / STEPS, t1 = (i + 1) / STEPS;
        const xa = rx + s * RUN * t0, xb = rx + s * RUN * t1;
        const w = deckW - 1.6;
        const g = new THREE.PlaneGeometry(Math.abs(xb - xa) * 1.08, w, 1, 1);
        g.rotateX(-Math.PI / 2);
        const m = new THREE.Mesh(g, tarmac);
        // the fall starts gentle and steepens, so the join to the deck is level
        const yHere = y + 0.62 - RAMP_RISE * Math.pow(t1, 1.4);
        m.position.set((xa + xb) / 2, yHere, z);
        // tilt to match the gradient of this segment
        const slope = (RAMP_RISE * 1.4 * Math.pow(t1, 0.4)) / RUN;
        m.rotation.z = s * Math.atan(slope);
        m.receiveShadow = true;
        m.name = "overpass ramp";
        root.add(m);
      }
      // a landing where the ramp meets the ground
      plane(12, deckW - 1.6, tarmac, rx + s * (RUN + 6), 0.03, z);
    }
  }

  // ---------------------------------------------------------------- the edge
  //
  // WHY THIS IS HERE
  //
  // The road survey (tools/qa/road_ends.mjs) says the network is finished: 46.5
  // km of lane, reaching all four edges of the map, only 12% of the state empty
  // and most of that bayou. What it cannot see is the ground BESIDE the road,
  // and that is the thing the screenshot was actually complaining about. A four
  // lane divided arterial running 500 m east of a city with nothing on either
  // side of it is not the edge of a city, it is a runway with a city behind it.
  //
  // So: the strip development every American city grows out along its arterial.
  // A service road, a drainage ditch, a row of motels and car lots and a truck
  // stop under a power line, thinning out to nothing at the map edge. It is
  // deliberately NOT more city — the point of an edge is that it is the place
  // where the city stops and the parish starts, and a fringe that looks like
  // OrleaRouge again would erase the boundary the player is driving toward.
  //
  // Every piece of it sits more than 9 m off the arterial's centreline. The
  // running lane of the widest road in the game runs out to 5 m, and a bollard
  // in it is the same bug the ramp channels used to have.
  const EDGE = Object.freeze({
    from: 712,            // where the strip starts, clear of the ramps at x0 + 190
    to: 1176,             // and where it gives up, just short of the map edge
    // 40 m out, not 26. The ramps come off the cross streets at z = 330 and 370,
    // so a service road at 26 sits four metres from one of them and reads as a
    // mistake. At 40 it is its own road, with its own driveways.
    frontage: 40,
    frontageW: 6.4,
    lotFrom: 48,          // building setback
    lotTo: 76,
    // where the cross streets reach the service road, per side. The strip is
    // drivable: without these it is a set you can only look at, and the whole
    // point of an edge is that you drive out along it.
    driveways: [
      { streetZ: 370, side: 1, at: 786 },
      { streetZ: 330, side: -1, at: 877 },
    ],
  });

  function buildEdgeStrip() {
    const { z } = EAST_HWY;
    out = edge;
    const pave = EAST_HALF;                    // the edge of the tarmac
    const len = EDGE.to - EDGE.from;
    const midX = (EDGE.from + EDGE.to) / 2;
    const grass = concMat(1, { color: 0x46512f, roughness: 0.98 });
    const ditchMat = concMat(1, { color: 0x3a4230, roughness: 1 });
    const kerbMat = concMat(1, { color: 0x9d9a92, roughness: 0.9 });
    const dirtMat = concMat(1, { color: 0x6b6152, roughness: 0.99 });
    const wallMat = concMat(1, { color: 0xb9b2a4, roughness: 0.85 });
    const trimMat = concMat(1, { color: 0x6d5a48, roughness: 0.8 });
    const steel = concMat(1, { color: 0x8b9095, metalness: 0.7, roughness: 0.5 });
    const roofMat = concMat(1, { color: 0x4a4b4e, roughness: 0.9 });

    for (const side of [-1, 1]) {
      // ---- the ground between the highway and the frontage road, in three
      // bands, because a verge of one flat colour is what makes a road look
      // like it was placed rather than that anything grew there
      plane(len, EAST_HALF + 2 - pave, dirtMat, midX, 0.006, z + side * (pave + 2), "edge shoulder dust");   // shoulder dust
      plane(len, 8, ditchMat, midX, 0.004, z + side * (pave + 6), "edge ditch");                            // the ditch
      plane(len, EDGE.frontage - pave - 10, grass, midX, 0.008, z + side * ((pave + 10 + EDGE.frontage) / 2), "edge verge");

      // ---- the service road, with its own paint so it is a road and not a strip
      const fz = z + side * EDGE.frontage;
      plane(len, EDGE.frontageW, deckMat(3, { color: 0x33333a }), midX, 0.02, fz, "edge frontage road");
      M.roadway({
        lanes: 2, median: 0, laneWidth: 2.4,
        points: [[EDGE.from + 4, fz], [EDGE.to - 4, fz]],
        y: 0.022,
      });
      // and it is drivable ground: blocked only at its own kerb, never in a lane.
      // The kerb has GAPS, cut where a driveway comes through it, so the service
      // road is reachable from the city rather than merely visible from it.
      const GAPS = EDGE.driveways.filter((d) => d.side === side).map((d) => d.at);
      const inGap = (x) => GAPS.some((gx) => Math.abs(x - gx) < 7);
      for (let x = EDGE.from; x <= EDGE.to; x += 5) {
        if (inGap(x)) continue;
        addBlocker(x, fz + side * (EDGE.frontageW / 2 + 0.4), 0.5);
      }

      // ---- the driveways themselves: a short flare of tarmac off the cross
      // street and onto the service road, so the two surfaces actually meet
      for (const d of EDGE.driveways) {
        if (d.side !== side) continue;
        // The channel stops short of the service road. Carried all the way to
        // the end, the flare's side walls sit 3.2 m either side of the driveway
        // centreline at the very point where the two surfaces meet — which is a
        // row of bollards across the mouth of the only way onto the strip.
        strip([d.at - 9, d.streetZ], [d.at + 9, fz - side * (EDGE.frontageW / 2)], 7,
          deckMat(5, { color: 0x33333a }), "edge driveway", 0.024, [0.1, 0.62]);
      }

      // ---- the power line. This is the silhouette of the American edge of town
      // more than any building is: a line of poles marching off to the horizon
      // with the wires sagging between them.
      const pz = z + side * (pave + 10);
      const POLE_STEP = 42;
      const poleCount = Math.floor(len / POLE_STEP);
      for (let i = 0; i <= poleCount; i++) {
        const x = EDGE.from + i * POLE_STEP;
        box(0.26, 9.2, 0.26, trimMat, x, 4.6, pz, "edge power pole");
        // the crossarm, and the three insulators on it
        box(0.14, 0.14, 2.4, trimMat, x, 8.7, pz, "edge power crossarm");
        for (const o of [-0.9, 0, 0.9]) box(0.1, 0.16, 0.1, wallMat, x, 8.86, pz + o, "edge power insulator");
        addBlocker(x, pz, 0.4);
        if (i === poleCount) break;
        // the three spans to the next pole, each drooping
        for (const o of [-0.9, 0, 0.9]) {
          const SEGS = 5;
          for (let k = 0; k < SEGS; k++) {
            const t0 = k / SEGS, t1 = (k + 1) / SEGS;
            const sag = (t) => -Math.sin(t * Math.PI) * 0.75;   // catenary, near enough
            const x0 = x + POLE_STEP * t0, x1 = x + POLE_STEP * t1;
            const y0 = 8.94 + sag(t0), y1 = 8.94 + sag(t1);
            const g = new THREE.BoxGeometry(Math.hypot(x1 - x0, y1 - y0), 0.06, 0.06);
            const m = new THREE.Mesh(g, steel);
            m.position.set((x0 + x1) / 2, (y0 + y1) / 2, pz + o);
            m.rotation.z = Math.atan2(y1 - y0, x1 - x0);
            m.name = "edge power wire";
            out.add(m);
          }
        }
      }

      // ---- the lots. Alternating sides, uneven depth, and a gap at the far end
      // so the strip thins into the parish instead of stopping at a wall.
      const LOTS = [
        { x: 748, w: 54, d: 20, h: 7.5, kind: "motel" },
        { x: 828, w: 62, d: 24, h: 9, kind: "carLot" },
        { x: 918, w: 46, d: 18, h: 6.5, kind: "shop" },
        { x: 1002, w: 58, d: 22, h: 8, kind: "motel" },
        { x: 1086, w: 66, d: 26, h: 10, kind: "truckStop" },
      ];
      for (const lot of LOTS) {
        if (lot.x - lot.w / 2 > EDGE.to) continue;
        buildLot(lot, z, side, { wallMat, trimMat, roofMat, steel, deckMat, M, kerbMat });
      }
    }

    // ---- one landmark, so the strip is not just a row of boxes: a water tower
    // on the north side, the thing you can see from the arterial two kilometres
    // out and use to know where you are.
    {
      const tx = 964, tz = z - (EDGE.lotTo + 8);
      for (const [dx, dz] of [[-2.6, -2.6], [2.6, -2.6], [-2.6, 2.6], [2.6, 2.6]]) {
        box(0.44, 16, 0.44, steel, tx + dx, 8, tz + dz, "water tower leg");
        addBlocker(tx + dx, tz + dz, 0.5);
      }
      // the cross bracing, which is most of what a water tower looks like
      for (let y = 2; y < 15; y += 2.6) {
        box(5.2, 0.16, 0.16, steel, tx, y, tz - 2.6, "water tower brace");
        box(5.2, 0.16, 0.16, steel, tx, y, tz + 2.6, "water tower brace");
        box(0.16, 0.16, 5.2, steel, tx - 2.6, y, tz, "water tower brace");
        box(0.16, 0.16, 5.2, steel, tx + 2.6, y, tz, "water tower brace");
      }
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.2, 6.4, 16), roofMat);
      tank.position.set(tx, 19.4, tz);
      tank.name = "water tower tank";
      out.add(tank);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(4.3, 1.8, 16), roofMat);
      cap.position.set(tx, 23.4, tz);
      cap.name = "water tower cap";
      out.add(cap);
      addLitSpot({ x: tx, y: 23, z: tz, warm: 0xff4444, power: 30, range: 14 });
    }
    out = root;
  }

  /**
   * One lot on the service road. Five kinds, because a strip that is the same
   * building five times reads as a copy-paste, and the specific mix is the
   * point: a motel and a car lot are what actually line an American arterial.
   */
  function buildLot(lot, roadZ, side, mat) {
    const { x, w, d, h, kind } = lot;
    const fz = roadZ + side * EDGE.frontage;
    // set back off the service road by its own depth, and a little further for
    // the big boxes, so the line of buildings is broken rather than ruled
    const setback = kind === "truckStop" ? EDGE.frontageW / 2 + 4 : EDGE.frontageW / 2 + 8;
    const cz = fz + side * (setback + d / 2);
    const w2 = w / 2, d2 = d / 2;

    // the apron: tarmac from the building's door out to the service road
    plane(w, setback + 1, mat.deckMat(4, { color: 0x3a3a40 }), x, 0.014, fz + side * (EDGE.frontageW / 2 + (setback + 1) / 2 - 0.5), "edge lot apron");
    // and the building is solid to walk into
    const corners = [[-w2, -d2], [w2, -d2], [w2, d2], [-w2, d2]];
    for (const [dx, dz] of corners) addBlocker(x + dx, cz + dz, 0.9);

    if (kind === "motel") {
      // a two-storey walkway down the front, which is the whole look of a
      // roadside motel: one long box, a balcony, a stair at each end
      box(w, h, d, mat.wallMat, x, h / 2, cz, "edge motel");
      box(w + 0.6, 0.3, d + 0.6, mat.roofMat, x, h + 0.15, cz, "edge motel roof");
      box(w, 0.22, 2.4, mat.trimMat, x, h * 0.5, cz - side * (d2 + 1.2), "edge motel walkway");
      for (let dx = -w2 + 2; dx <= w2 - 2; dx += 3.2) {
        box(0.14, h * 0.5, 0.14, mat.trimMat, x + dx, h * 0.25, cz - side * (d2 + 2.1), "edge motel post");
      }
      // and a stair at each end, because a walkway with no way up is a ledge
      for (const s of [-1, 1]) {
        for (let i = 0; i < 7; i++) {
          box(2.2, 0.18, 0.5, mat.trimMat, x + s * (w2 - 1.6), 0.2 + i * (h * 0.5 / 7), cz - side * (d2 + 3.4 - i * 0.42), "edge motel stair");
        }
      }
      makeBillboard(x, h + 5.5, cz - side * (d2 + 1), side > 0 ? Math.PI : 0, "EDGE MOTEL", "VACANCY · TV · POOL", "AIR COOLED");
      addLitSpot({ x, y: h + 3, z: cz, warm: 0xffc98a, power: 90, range: 26, pole: true });
      return;
    }

    if (kind === "carLot") {
      // a low showroom with a glazed front, and a light mast in the yard
      box(w, h, d, mat.trimMat, x, h / 2, cz, "edge showroom");
      box(w + 0.8, 0.35, d + 0.8, mat.roofMat, x, h + 0.18, cz, "edge showroom roof");
      box(w - 2, h * 0.55, 0.2, mat.steel, x, h * 0.42, cz - side * (d2 + 0.1), "edge showroom glass");
      // the mast: four of them, which is what a car lot is at night
      for (const s of [-1, 1]) {
        const mx = x + s * (w2 - 3);
        box(0.2, 11, 0.2, mat.trimMat, mx, 5.5, cz - side * (d2 + 5), "edge lot mast");
        box(1.4, 0.3, 0.5, mat.trimMat, mx, 11, cz - side * (d2 + 5), "edge lot mast head");
        addLitSpot({ x: mx, y: 11, z: cz - side * (d2 + 5), warm: 0xfff0d0, power: 130, range: 30, pole: true });
        addBlocker(mx, cz - side * (d2 + 5), 0.4);
      }
      // a row of flags, because it is a car lot
      for (let dx = -w2 + 5; dx <= w2 - 5; dx += 7) {
        box(0.1, 6, 0.1, mat.trimMat, x + dx, 3, cz - side * (d2 + 1.6), "edge lot flagpole");
      }
      makeBillboard(x, h + 5, cz - side * (d2 + 2), side > 0 ? Math.PI : 0, "AUTO", "EVERYBODY APPROVED", "0%  ·  60 MONTHS");
      return;
    }

    if (kind === "truckStop") {
      // the big one: a shed, a fuel canopy over the pumps, and a lit apron
      box(w * 0.62, h, d, mat.wallMat, x - w * 0.19, h / 2, cz, "edge truck shed");
      box(w * 0.62 + 0.6, 0.4, d + 0.6, mat.roofMat, x - w * 0.19, h + 0.2, cz, "edge truck shed roof");
      // the canopy: a slab on four columns, over the pumps, on the road side
      const canopyZ = fz + side * (EDGE.frontageW / 2 + 9);
      box(w * 0.5, 0.7, 12, mat.wallMat, x + w * 0.24, 7.4, canopyZ, "edge fuel canopy");
      for (const dx of [-w * 0.22, 0, w * 0.22]) {
        for (const dz of [-5, 5]) {
          box(0.6, 7, 0.6, mat.trimMat, x + w * 0.24 + dx, 3.5, canopyZ + dz, "edge fuel column");
          addBlocker(x + w * 0.24 + dx, canopyZ + dz, 0.6);
        }
      }
      addLitSpot({ x: x + w * 0.24, y: 7, z: canopyZ, warm: 0xfff4e0, power: 170, range: 34 });
      makeBillboard(x, h + 6, canopyZ, side > 0 ? Math.PI : 0, "TRUCK STOP", "DIESEL · PROPANE · SHOWERS", "OPEN 24 HOURS");
      addLitSpot({ x, y: h + 3, z: cz, warm: 0xffd9a0, power: 110, range: 28, pole: true });
      return;
    }

    // a shop: a plain box, a fascia, and a neon sign, which is the default and
    // should be rare enough that it is not what you see first
    box(w, h, d, mat.wallMat, x, h / 2, cz, "edge shop");
    box(w + 0.5, 0.3, d + 0.5, mat.roofMat, x, h + 0.15, cz, "edge shop roof");
    box(w, 0.9, 0.25, mat.trimMat, x, h - 0.7, cz - side * (d2 + 0.1), "edge shop fascia");
    makeBillboard(x, h + 4, cz - side * (d2 + 1.2), side > 0 ? Math.PI : 0, "OPEN", "COLD BEER · CIGARETTES", "SOUTHERN BYRD");
    addLitSpot({ x, y: h + 2.5, z: cz, warm: 0xffd0a0, power: 80, range: 22, pole: true });
  }

  // ---------------------------------------------------------------- build
  function build() {
    buildEastHighway();
    buildRamps();
    buildEdgeStrip();
    buildOverpass();
    // The road is noBatch; the edge strip is not, and must not be swept up in
    // this — the sweep runs after the group is in the world, so anything marked
    // here is excluded from merging forever.
    root.traverse((o) => { if (o.isMesh && !isInEdge(o)) o.userData.noBatch = true; });
    // the paint is its own geometry, added straight to the scene by the caller
    return root;
  }

  const isInEdge = (o) => { for (let a = o; a; a = a.parent) if (a === edge) return true; return false; };

  return {
    root, M, build, EAST_HWY, EAST_HALF, EDGE,
    get props() { return moving; },
    /** Flush the queued paint into the scene once the group is in the world. */
    flushMarkings(scene) { if (ownsMarkings) M.flush(scene); },
  };
}

export default createOrleaFringe;
