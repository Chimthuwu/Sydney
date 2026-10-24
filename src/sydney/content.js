// ---------------------------------------------------------------------------
// sydney/content.js — the city around the roads.
//
// roads.js is Sydney's street network and roadSurface.js is its tarmac. Neither
// is a city: a grid of grey ribbons on green grass is a map of Sydney, and
// putting Louisiana's pine trees and bayou towns on top of it is worse than
// useless, because it looks broken rather than unfinished.
//
// This is the harbour, the parks, the buildings and the district names. It is
// the difference between driving through a road network and driving through
// Sydney.
//
// EVERYTHING IS ONE MESH PER LAYER. The whole city is four draw calls: water,
// parks, buildings, labels. 972 buildings as individual meshes would be 972 draw
// calls against a ~4.5k budget the rest of the world already spends, so they all
// go into one BufferGeometry - which is fine, because they never move.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import {
  SYDNEY_BUILDINGS,
  SYDNEY_DISTRICTS,
  SYDNEY_LANDMARKS,
  SYDNEY_PARKS,
  SYDNEY_WATER,
} from "./cityData.js";

/** The harbour sits BELOW the land, so the city's edge reads as a shoreline. */
const WATER_Y = -0.45;
const PARK_Y = 0.012;

function cross(ax, ay, bx, by, cx, cy) {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function signedArea(points) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length];
    total += a[0] * b[1] - b[0] * a[1];
  }
  return total / 2;
}

function pointInTriangle(px, py, ax, ay, bx, by, cx, cy) {
  const d1 = cross(ax, ay, bx, by, px, py);
  const d2 = cross(bx, by, cx, cy, px, py);
  const d3 = cross(cx, cy, ax, ay, px, py);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

/**
 * Ear clipping. A triangle fan only works on convex polygons, and Sydney's
 * coastline is the definition of concave - a fan on Port Jackson throws 90% of
 * its triangles outside the land and the harbour appears as a green sky.
 */
function triangulate(points) {
  const n = points.length;
  if (n < 3) return [];
  const indices = points.map((_, i) => i);
  if (signedArea(points) < 0) indices.reverse();

  const triangles = [];
  let guard = n * n;
  while (indices.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < indices.length; i++) {
      const size = indices.length;
      const ia = indices[(i - 1 + size) % size];
      const ib = indices[i];
      const ic = indices[(i + 1) % size];
      const a = points[ia], b = points[ib], c = points[ic];
      if (cross(a[0], a[1], b[0], b[1], c[0], c[1]) <= 0) continue;   // reflex or collinear
      let contains = false;
      for (const idx of indices) {
        if (idx === ia || idx === ib || idx === ic) continue;
        const p = points[idx];
        if (pointInTriangle(p[0], p[1], a[0], a[1], b[0], b[1], c[0], c[1])) { contains = true; break; }
      }
      if (contains) continue;
      triangles.push([ia, ib, ic]);
      indices.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;      // self-intersecting or degenerate: draw what we have
  }
  if (indices.length === 3) triangles.push([indices[0], indices[1], indices[2]]);
  return triangles;
}

/** Every ring of a layer into one flat, y-fixed geometry. */
function polygonGeometry(rings, y) {
  const pos = [];
  const index = [];
  for (const ring of rings) {
    if (!ring || ring.length < 3) continue;
    // Force negative signed area so the fixed-y plane's normal points up (+y)
    let r = ring.slice();
    if (signedArea(r) > 0) r = r.slice().reverse();
    const base = pos.length / 3;
    for (const [x, z] of r) pos.push(x, y, z);
    for (const [a, b, c] of triangulate(r)) index.push(base + a, base + b, base + c);
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Buildings as one geometry: each footprint is an extruded prism.
 *
 * Roofs get their own vertices with an upward normal, so a tower catches the
 * light on top and the CBD does not read as a field of grey card.
 */
function buildingGeometry(list) {
  const pos = [];
  const index = [];
  for (const b of list) {
    let fp = b.fp ? b.fp.slice() : [];
    if (!fp || fp.length < 3) continue;
    // 1. Remove duplicate closing point (first point repeated at end)
    const first = fp[0], last = fp[fp.length - 1];
    if (first && last && first[0] === last[0] && first[1] === last[1]) fp.pop();
    if (fp.length < 3) continue;
    const h = b.h || 6;
    const base = pos.length / 3;
    // 2. Normalise winding: reverse so signed area is negative (outward walls)
    if (signedArea(fp) > 0) fp = fp.slice().reverse();
    // Footprint ground + roof (each vertex gets its own copy, no shared normals)
    for (const [x, z] of fp) pos.push(x, 0, z);
    for (const [x, z] of fp) pos.push(x, h, z);
    const n = fp.length;
    // Wall quads: flat per-face (no smoothing)
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      index.push(base + i, base + j, base + n + i);
      index.push(base + j, base + n + j, base + n + i);
    }
    // 3. Roof via ear-clipping (handles concave footprints)
    const roofBase = base + n;
    const roofPoints = fp.map(([x, z]) => [x, z]);
    for (const [a, b, c] of triangulate(roofPoints)) {
      index.push(roofBase + a, roofBase + b, roofBase + c);
    }
  }
  if (!index.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(index);
  // Flat per-face normals: rely on computeVertexNormals (no smoothing)
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Build every layer of Sydney's content.
 *
 * @returns {{group: THREE.Group, colliders: Array, districts: Array, stats: object}}
 */
export function buildSydneyContent() {
  const group = new THREE.Group();
  group.name = "sydney-content";
  const colliders = [];
  const stats = {};

  // ---- the harbour --------------------------------------------------------
  const waterMat = new THREE.MeshStandardMaterial({
    color: 0x1d3f52, roughness: 0.22, metalness: 0.35, envMapIntensity: 1.1,
  });
  const waterRings = [];
  for (const w of SYDNEY_WATER) {
    if (w.beach) continue;                 // sand is land, drawn with the parks
    for (const ring of w.rings) waterRings.push(ring);
  }
  const waterGeom = polygonGeometry(waterRings, WATER_Y);
  if (waterGeom) {
    const water = new THREE.Mesh(waterGeom, waterMat);
    water.name = "sydney-water";
    water.receiveShadow = true;
    group.add(water);
    stats.waterTriangles = waterGeom.index.count / 3;
  }

  // ---- parks --------------------------------------------------------------
  const parkMat = new THREE.MeshStandardMaterial({ color: 0x3d5c2a, roughness: 1 });
  const parkRings = [];
  for (const p of SYDNEY_PARKS) for (const ring of p.rings) parkRings.push(ring);
  const parkGeom = polygonGeometry(parkRings, PARK_Y);
  if (parkGeom) {
    const parks = new THREE.Mesh(parkGeom, parkMat);
    parks.name = "sydney-parks";
    parks.receiveShadow = true;
    group.add(parks);
    stats.parkTriangles = parkGeom.index.count / 3;
  }

  // ---- buildings ----------------------------------------------------------
  const buildMat = new THREE.MeshStandardMaterial({ color: 0x8a8578, roughness: 0.78 });
  const buildGeom = buildingGeometry(SYDNEY_BUILDINGS);
  if (buildGeom) {
    const buildings = new THREE.Mesh(buildGeom, buildMat);
    buildings.name = "sydney-buildings";
    buildings.castShadow = true;
    buildings.receiveShadow = true;
    group.add(buildings);
    stats.buildingTriangles = buildGeom.index.count / 3;
    stats.buildings = SYDNEY_BUILDINGS.length;
    // A collider per building, so the player cannot drive through the CBD. The
    // game's blockers are 2D circles walked by the physics, so a tower is a
    // circle sized to its footprint - close enough at car speed, and one circle
    // instead of a convex hull.
    // Edge-circle colliders: one per footprint edge, radius = half edge length.
    // Hugs L-shapes far better than a single circumscribing circle.
    for (const b of SYDNEY_BUILDINGS) {
      if (!b.fp || b.fp.length < 3) continue;
      const fp = b.fp;
      // Deduplicate first point if repeated at end (same as in buildingGeometry)
      let pts = fp.slice();
      const first = pts[0], last = pts[pts.length - 1];
      if (first && last && first[0] === last[0] && first[1] === last[1]) pts.pop();
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const bpt = pts[(i + 1) % pts.length];
        const mx = (a[0] + bpt[0]) / 2;
        const mz = (a[1] + bpt[1]) / 2;
        const r = Math.hypot(a[0] - bpt[0], a[1] - bpt[1]) / 2;
        colliders.push({ x: mx, z: mz, r: Math.max(1.5, r) });
      }
    }
    stats.colliders = colliders.length;
  }

  // ---- district labels ----------------------------------------------------
  // Not decoration: these are the names the HUD shows, so "Surry Hills" is what
  // the player is told they are in rather than Louisiana's "Shinston".
  const districts = SYDNEY_DISTRICTS.map((d) => ({ name: d.name, x: d.x, z: d.z }));
  stats.districts = districts.length;
  stats.landmarks = SYDNEY_LANDMARKS.length;

  return { group, colliders, districts, stats };
}
