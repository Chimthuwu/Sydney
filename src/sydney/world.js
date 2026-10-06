// ---------------------------------------------------------------------------
// sydney/world.js — the Sydney world, as a drop-in for the Louisiana one.
//
// This is the entry point main.js calls when SYDNEY_MODE is on. It answers the
// only three questions the rest of the game asks of a world:
//
//   1. What is the ground like?          -> flat, at y = 0 (see below)
//   2. Where is the tarmac?              -> buildSydneyRoadSurface(), one draw call
//   3. Where does the player start?      -> on George Street, in the CBD
//
// WHY THE GROUND IS FLAT, AND WHY THAT IS NOT A SHORTCUT
//
// terrain.js bakes a height field that is zero everywhere within 64 m of
// anything built and rises smoothly beyond that - a deliberate design for a map
// that is 90% Louisiana wilderness with a highway through it. Sydney has the
// opposite problem: it is 100% built, so a height field keyed on "distance from
// something built" has nothing to key on and would either be uniformly zero (fine)
// or, worse, put a 40 m ridge through Bondi because Bondi is far from a
// landmark. Real Sydney is not flat - the CBD ridge, the North Shore escarpment
// and Pyrmont's rise are all real - but a height field cannot be invented from
// OSM road geometry, and faking one produces a city that is subtly, inexplicably
// wrong in a way that is much harder to debug than an honest flat plane.
//
// So: flat, and documented as flat. When the terrain comes, it comes from real
// elevation data (SRTM or similar) in the same pipeline as the roads, and it
// plugs into exactly this seam - the `surface` function below.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { buildSydneyLanes } from "./buildLanes.js";
import { buildSydneyContent } from "./content.js";
import { buildSydneyRoadSurface, makeRoadMask, ROAD_Y } from "./roadSurface.js";
import { SYDNEY_ROADS } from "./roads.js";
import { SYDNEY_BUILDINGS, SYDNEY_DISTRICTS, SYDNEY_LANDMARKS } from "./cityData.js";

export const SYDNEY_MAP = { minX: -1200, maxX: 1200, minZ: -1200, maxZ: 1200 };

/** Where the player starts: mid-Block on George Street, the spine of the CBD. */
const SPAWN = { x: -152, z: -455, heading: Math.PI };

/**
 * Build the Sydney world.
 *
 * @param {object} R  the same render context main.js passes every other world
 *   builder: { scene, asphalt, terrain, rng, addBlocker, ... }
 * @returns {{lanes: Array, props: Array, spawn: object, stats: object, onRoad: Function}}
 */
export function buildSydneyWorld(R) {
  const { scene, asphalt } = R;

  // ---- 1. the tarmac, as one mesh
  //
  // The asphalt material is the same one US-167 is built from, so the road looks
  // like the road everywhere else in the game. The texture repeat is set in
  // METRES here (the UVs in roadSurface.js are already metric), which is what
  // keeps the aggregate the same size on a back-lane as on the Western
  // Distributor - a 0..1 UV per road would make a 6 m lane and a 20 m road have
  // visibly different-sized stones.
  const roadMat = asphalt.material(1, { envMapIntensity: 0.9 });
  roadMat.normalScale.set(2.1, 2.1);
  for (const t of [roadMat.map, roadMat.normalMap, roadMat.roughnessMap]) {
    if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1); }
  }
  const kerbMat = asphalt.material(3, { color: 0x9a958c, envMapIntensity: 0.7 });

  const roads = buildSydneyRoadSurface(roadMat, kerbMat);
  scene.add(roads.surface, roads.kerb);

  // ---- 2. the traffic lanes
  const { lanes, stats: laneStats } = buildSydneyLanes();

  // ---- 3. where the player starts
  //
  // Snapped to the nearest real lane rather than a hardcoded point, so if the
  // generated data ever shifts the spawn moves with it instead of leaving the
  // player standing in a car park. George Street is chosen because it is the one
  // street in this slice that is unambiguously central, named, and long.
  const spawn = findSpawnOnRoad(SPAWN.x, SPAWN.z) || SPAWN;

  // ---- 4. the ground, answered through the same seam terrain.js uses
  //
  // terrain.at() returns 0 for an uninitialised field, and terrain.surface()
  // falls through to it, so simply NOT building the Louisiana hills leaves the
  // whole map at y = 0 already. That is relied on rather than forced: no deck
  // provider is registered, so freeway.js cannot accidentally raise something
  // over the top of Sydney.
  const mask = makeRoadMask();

  // ---- 5. the city: harbour, parks, buildings, districts
  //
  // Roads alone are a map, not a place. Sydney's tarmac with Louisiana's
  // content on top looked broken rather than unfinished, and with Louisiana's
  // content now gone entirely it would look like a grey grid on green grass.
  // This is the harbour the roads run beside, the parks between the blocks, and
  // the CBD's own skyline - 972 real OSM footprints, merged into one mesh.
  const content = buildSydneyContent();
  scene.add(content.group);
  for (const c of content.colliders) R.addBlocker && R.addBlocker(c.x, c.z, c.r);

  return {
    lanes,
    props: [roads.surface, roads.kerb, content.group],
    districts: content.districts,
    /** Real Sydney road geometry, in the shape the minimap wants. */
    minimap: buildMinimap(),
    spawn: { x: spawn.x, z: spawn.z, heading: spawn.heading, y: ROAD_Y },
    /** Is this point on tarmac? Used for off-road grip and for the minimap. */
    onRoad: (x, z, slack) => mask.on(x, z, slack),
    stats: {
      roadRuns: SYDNEY_ROADS.length,
      roadTriangles: roads.stats.triangles,
      roadKm: roads.stats.centreKm,
      drawCalls: roads.stats.drawCalls,
      lanes: laneStats.lanes,
      laneKm: laneStats.km,
      laneLinks: laneStats.links,
      deadEnds: laneStats.deadEnds,
      ...content.stats,
    },
  };
}

/**
 * The minimap's four layers, in the shape minimap.build() expects.
 *
 * The roads here are the SAME centrelines the tarmac is built from, so what the
 * player sees on the minimap is the road they are driving on - not Louisiana's
 * boulevard, which is what the minimap used to draw in Sydney mode.
 */
function buildMinimap() {
  const roads = SYDNEY_ROADS.map((r) => ({
    points: r.points.map((p) => [p[0], p[1]]),
    width: Math.max(3, r.width || 8),
  }));
  const areas = [];
  for (const d of SYDNEY_DISTRICTS) {
    areas.push({ x0: d.x - 220, x1: d.x + 220, z0: d.z - 220, z1: d.z + 220, color: "#2f3a2a" });
  }
  return { roads, areas, water: [], buildings: [], landmarks: SYDNEY_LANDMARKS };
}

/**
 * The point on the nearest road to (x, z), with a heading along it.
 *
 * Used for the spawn. Deliberately finds the nearest road of ANY kind: the
 * player starting in a driveway is better than the player starting inside a
 * building, and the alternative - insisting on a traffic-eligible road - can put
 * the spawn a block away from where anyone would stand.
 */
function findSpawnOnRoad(x, z) {
  // A point on the street centreline, scored by how far it is from the wanted
  // spot MINUS how boxed in it is.
  //
  // Distance alone is not enough, and this is not a hypothetical: George Street
  // at the literal coordinates asked for sits 13 m from a 42 m tower with 108
  // buildings inside 70 m and a 106 m one close by. The player spawned in a pit
  // with a wall of glass in front of them - technically the right street, and
  // the first thing anyone sees of Sydney.
  //
  // But the cure has to be measured against the city, not invented. Measured
  // over every road point within 350 m of the CBD, clearance to the nearest
  // footprint peaks at about 35 m and most of it is under 20: the Sydney CBD
  // is a genuine canyon, and a spawn that demanded open sky would be pushed
  // 400 m out to the suburbs to find it - trading a tight but real city
  // street for an empty field, which is not obviously better.
  //
  // So OPEN is set to the width of a real CBD intersection rather than to
  // "somewhere you can see the horizon": far enough from a wall that the
  // player is not spawning inside one, tight enough to stay in the city. The
  // distance cap does the rest - a wider street 300 m away is not the answer
  // either, because the player asked for George Street.
  const OPEN = 24;
  // 7275 footprint points scanned per candidate is 2.4M operations for a value
  // that is only ever compared against a constant, so the points go in a grid
  // once and each candidate only looks at its own cell and the eight around it.
  const CELL = OPEN * 2;
  const grid = new Map();
  const cellKey = (gx, gz) => gx * 100000 + gz;
  for (const b of SYDNEY_BUILDINGS) {
    if (!b.fp || b.fp.length < 3) continue;
    for (const [bx, bz] of b.fp) {
      const gx = Math.floor(bx / CELL), gz = Math.floor(bz / CELL);
      const k = cellKey(gx, gz);
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(bx, bz);
    }
  }
  const footprintClearance = (px, pz) => {
    const gx = Math.floor(px / CELL), gz = Math.floor(pz / CELL);
    let nearest = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        const list = grid.get(cellKey(gx + dx, gz + dz));
        if (!list) continue;
        for (let i = 0; i < list.length; i += 2) {
          const d = Math.hypot(px - list[i], pz - list[i + 1]);
          if (d < nearest) nearest = d;
        }
      }
    }
    return nearest;
  };

  let best = null, bestScore = -Infinity;
  for (const road of SYDNEY_ROADS) {
    const pts = road.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const abx = b[0] - a[0], abz = b[1] - a[1];
      const len = Math.hypot(abx, abz);
      if (len < 1) continue;
      // Sample along the segment, not just its ends: the clear spot on a long
      // block is rarely at the corner.
      for (let k = 0; k <= 4; k++) {
        const t = k / 4;
        const px = a[0] + abx * t, pz = a[1] + abz * t;
        const d = Math.hypot(x - px, z - pz);
        if (d > 250) continue;
        const clear = footprintClearance(px, pz);
        if (clear < OPEN) continue;              // boxed in: not a spawn
        // Close to the wanted spot dominates. Clearance only breaks ties
        // between candidates that are already near it, so the walk out of a
        // canyon can never become a trip to the suburbs.
        const score = -d + Math.min(clear, 60) * 0.5;
        if (score > bestScore) {
          bestScore = score;
          best = { x: px, z: pz, heading: Math.atan2(abx, abz), street: road.name, clearance: clear };
        }
      }
    }
  }
  return best;
}
