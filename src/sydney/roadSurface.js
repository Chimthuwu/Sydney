// ---------------------------------------------------------------------------
// sydney/roadSurface.js — the tarmac the player drives on.
//
// The traffic lanes in buildLanes.js are for CARS: thin polylines a pooled
// traffic car follows. They are not something a player can drive, because the
// player's car is not on rails - it has physics, and it needs an actual surface
// under its wheels, a surface the terrain code agrees about, and a collision
// story. This file is that surface.
//
// It is deliberately boring: one merged triangle strip per road run, at ground
// level, with a kerb. Real Sydney has hills (the CBD ridge, North Shore) and
// elevated motorways that cross over each other; none of that is here yet, and
// pretending otherwise would be worse than a flat city that drives. What IS here
// is correct at ground level, which is the thing that has to be right before
// anything can be layered on top.
//
// WHY A MERGED MESH, NOT ONE MESH PER ROAD
//
// Sydney is 2386 runs. A mesh each is 2386 draw calls before anything else in the
// game draws, against a ~4.5k budget the rest of the world already spends. So
// every run's strip goes into ONE BufferGeometry, with all the carriageways in it
// ordered so the transparent-free opaque sort is trivial, and the whole city
// costs one draw call.
//
// WHY THE KERB EXISTS
//
// A road with no edge is a road you can drive off sideways into the void, and the
// terrain under Sydney is going to be flat ground until that is built. A kerb is
// a strip of vertical quads along both edges: it is what stops a car sliding off
// the tarmac, and it is what makes a street read as a street from a distance.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { SYDNEY_ROADS } from "./roads.js";

/** Ground height every Sydney road sits at. Flat, and honest about being flat. */
export const ROAD_Y = 0.02;

/** How far the kerb stands above the tarmac, in metres. */
const KERB_H = 0.16;

/**
 * Build the whole road surface as one geometry.
 *
 * @param {THREE.Material} roadMat  tarmac material (asphalt)
 * @param {THREE.Material} kerbMat  kerb / footway material (concrete)
 * @returns {{surface: THREE.Mesh, kerb: THREE.Mesh, lanes: Array, stats: object}}
 */
export function buildSydneyRoadSurface(roadMat, kerbMat) {
  // ---- 1. the tarmac strip
  //
  // Each run becomes a quad strip: for every segment of the centreline, two
  // vertices offset to the left and right by the run's paved half-width, joined
  // to the next segment's. Offsetting along the RIGHT of travel matches
  // makeRoadway's convention so the tarmac and the traffic lanes agree about
  // which side is which, but for a symmetric strip it only affects winding.
  const pos = [];
  const uv = [];
  const index = [];
  let km = 0;

  for (const road of SYDNEY_ROADS) {
    const pts = road.points;
    if (pts.length < 2) continue;
    const half = road.half || 6;
    const base = pos.length / 3;
    let along = 0;

    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      // Right of travel is (-dz, dx) in this world (world.js: north is -z).
      const nx = -dz * half, nz = dx * half;
      if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      pos.push(pts[i][0] + nx, ROAD_Y, pts[i][1] + nz);
      pos.push(pts[i][0] - nx, ROAD_Y, pts[i][1] - nz);
      // UVs in METRES, not 0..1, so the asphalt texture tiles at a constant
      // physical size. Scaling by the texture's repeat is the caller's job; what
      // matters here is that a lane's width in the texture is the same on a
      // back-lane as it is on the Western Distributor.
      uv.push(0, along, 1, along);
    }
    km += along;
    for (let i = 0; i < pts.length - 1; i++) {
      const v = base + i * 2;
      index.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geom.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geom.setIndex(index);
  geom.computeVertexNormals();
  const surface = new THREE.Mesh(geom, roadMat);
  surface.name = "sydney-roads";
  surface.receiveShadow = true;
  // The tarmac is flat and the ground under it is flat, so it must not be
  // frustum-culled against its own bounding sphere computed from a strip that
  // spans the whole map - cull it by the camera's far plane instead, which is
  // what the rest of the world does.
  surface.frustumCulled = false;

  // ---- 2. the kerbs
  //
  // A vertical quad down each edge. Not a wall the car bounces off - there is no
  // collision on it yet, because a 2D blocker per kerb vertex for 2386 roads is
  // tens of thousands of circles and the game's blocker list is a flat array the
  // physics walks. It is visual, and it is what stops the tarmac reading as a
  // grey ribbon painted on the grass.
  const kpos = [], kuv = [], kindex = [];
  let kbase = 0;
  for (const road of SYDNEY_ROADS) {
    const pts = road.points;
    if (pts.length < 2) continue;
    const half = road.half || 6;
    let along = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      let dx = b[0] - a[0], dz = b[1] - a[1];
      const len = Math.hypot(dx, dz) || 1;
      dx /= len; dz /= len;
      const nx = -dz * half, nz = dx * half;
      if (i > 0) along += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      // top of kerb, bottom of kerb, one pair per side
      kpos.push(pts[i][0] + nx, ROAD_Y, pts[i][1] + nz);
      kpos.push(pts[i][0] + nx, ROAD_Y - KERB_H, pts[i][1] + nz);
      kpos.push(pts[i][0] - nx, ROAD_Y, pts[i][1] - nz);
      kpos.push(pts[i][0] - nx, ROAD_Y - KERB_H, pts[i][1] - nz);
      kuv.push(0, along, 0, along, 1, along, 1, along);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const v = kbase + i * 4;
      // left side (normal facing -normal), right side (facing +normal)
      kindex.push(v, v + 4, v + 1, v + 1, v + 4, v + 5);
      kindex.push(v + 2, v + 3, v + 6, v + 3, v + 7, v + 6);
    }
    kbase += pts.length * 4;
  }
  const kgeom = new THREE.BufferGeometry();
  kgeom.setAttribute("position", new THREE.Float32BufferAttribute(kpos, 3));
  kgeom.setAttribute("uv", new THREE.Float32BufferAttribute(kuv, 2));
  kgeom.setIndex(kindex);
  kgeom.computeVertexNormals();
  const kerb = new THREE.Mesh(kgeom, kerbMat);
  kerb.name = "sydney-kerbs";
  kerb.frustumCulled = false;

  return {
    surface,
    kerb,
    stats: {
      runs: SYDNEY_ROADS.length,
      triangles: index.length / 3 + kindex.length / 3,
      centreKm: Math.round(km / 100) / 10,
      drawCalls: 2,
    },
  };
}

/**
 * Is (x, z) on tarmac? A grid of run bounding boxes, so this is a lookup rather
 * than a scan of 2386 polylines.
 *
 * The player needs this: off-road the car should be slow and rough, on-road it
 * should not be. It is a coarse test (bounding box, then distance to the
 * centreline within the box), which is right for a "am I on the road" question
 * and is deliberately not a claim about exact carriageway polygons.
 */
export function makeRoadMask(cell = 40) {
  const grid = new Map();
  SYDNEY_ROADS.forEach((road, index) => {
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of road.points) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    for (let cx = Math.floor(minX / cell); cx <= Math.floor(maxX / cell); cx++) {
      for (let cz = Math.floor(minZ / cell); cz <= Math.floor(maxZ / cell); cz++) {
        const k = `${cx},${cz}`;
        let bucket = grid.get(k);
        if (!bucket) grid.set(k, (bucket = []));
        bucket.push({ index, minX, maxX, minZ, maxZ, half: road.half || 6 });
      }
    }
  });

  return {
    /** True when (x, z) is within `slack` metres of a road's paved surface. */
    on(x, z, slack = 2) {
      const bucket = grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`);
      if (!bucket) return false;
      for (const box of bucket) {
        if (x < box.minX - slack || x > box.maxX + slack) continue;
        if (z < box.minZ - slack || z > box.maxZ + slack) continue;
        const road = SYDNEY_ROADS[box.index];
        if (distanceToPolyline(x, z, road.points) <= box.half + slack) return true;
      }
      return false;
    },
  };
}

function distanceToPolyline(x, z, points) {
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const abx = b[0] - a[0], abz = b[1] - a[1];
    const l2 = abx * abx + abz * abz || 1;
    let t = ((x - a[0]) * abx + (z - a[1]) * abz) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < best) best = d;
  }
  return best;
}
