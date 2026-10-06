// ---------------------------------------------------------------------------
// terrain.js — hills, ridges and mountains in the wilderness (human request, 2026-09-27: "more hills / mountains / valleys around").
//
// The rest of the game was built flat: every road, town, blocker and lane sits at y = 0. So the relief lives ONLY where nothing was
// built: a height field that is zero everywhere near a road, a district, a lane or a set piece and rises smoothly with the distance
// from all of them (`mask`), shaped by noise. Roads and towns therefore never see a slope; you meet the hills when you leave them.
//
//   terrain.at(x, z)         ground height in metres (0 outside the hill pockets; safe to call before init — returns 0)
//   terrain.slope(x, z)      { x, z } gradient, for tilting a car
//   terrain.init({ blocked }) once, after every district exists: `blocked(x, z)` says whether that ground is built / road / reserved
//   terrain.build(scene)     the meshes: 64 m tiles that stand on the flat ground plane, only where the ground actually rises
//
// Hills are only ever above the flat ground plane (y >= 0), so a valley is the low ground between two rises. The height field is
// baked on a coarse grid and sampled bilinearly, so `at` is cheap enough to call per NPC per frame.
// ---------------------------------------------------------------------------

import * as THREE from "three";

const CELL = 8;                          // metres per height sample
const EXTENT = 1200;                     // half-size of the map (stateWorld STATE_BOUNDS)
const N = (EXTENT * 2) / CELL + 1;
const TILE = 64;                         // metres per mesh tile
const CLEAR_NEAR = 24, CLEAR_FAR = 64;   // no relief within CLEAR_NEAR of anything built; full relief beyond CLEAR_FAR
const MIN_RISE = 0.45;                   // anything lower than this is left flat (no ankle-high bumps on a road shoulder)

let heights = null;                      // Float32Array(N * N), row = z
let ready = false;
const pockets = [];                      // QA / minimap: { x, z, h } local maxima
const corridors = [];                    // road corridors bulldozed through the hills (see init): { id, pts, half, bank, bores: [{ s0, s1 }] }
let deckAt = null;                       // (x, z, yRef) => deck height or null — set by freeway.js

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- a small seeded value noise -------------------------------------------------------
function hash2(ix, iz, seed) {
  let h = (ix * 374761393 + iz * 668265263 + seed * 1442695041) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, z, seed) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz, seed), b = hash2(ix + 1, iz, seed), c = hash2(ix, iz + 1, seed), d = hash2(ix + 1, iz + 1, seed);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
const fbm = (x, z, seed) => 0.55 * vnoise(x, z, seed) + 0.3 * vnoise(x * 2.1, z * 2.1, seed + 7) + 0.15 * vnoise(x * 4.3, z * 4.3, seed + 13);

/** Bilinear read of the baked field. */
function sample(x, z) {
  if (!ready) return 0;
  const gx = (x + EXTENT) / CELL, gz = (z + EXTENT) / CELL;
  if (gx < 0 || gz < 0 || gx >= N - 1 || gz >= N - 1) return 0;
  const ix = gx | 0, iz = gz | 0, fx = gx - ix, fz = gz - iz;
  const i = iz * N + ix;
  const a = heights[i], b = heights[i + 1], c = heights[i + N], d = heights[i + N + 1];
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

/** The point at distance s along a corridor's centreline. */
function pointAt(c, s) {
  let i = 1;
  while (i < c.acc.length - 1 && c.acc[i] < s) i++;
  const a = c.pts[i - 1], b = c.pts[i], seg = c.acc[i] - c.acc[i - 1] || 1, t = Math.min(1, Math.max(0, (s - c.acc[i - 1]) / seg));
  return { x: a[0] + (b[0] - a[0]) * t, z: a[1] + (b[1] - a[1]) * t, dx: (b[0] - a[0]) / seg, dz: (b[1] - a[1]) / seg };
}

/** Nearest point on a corridor's centreline: { d, s } (distance from it, distance along it). */
function project(c, x, z) {
  let best = { d: Infinity, s: 0, nx: 0, nz: 0 };
  for (let i = 1; i < c.pts.length; i++) {
    const a = c.pts[i - 1], b = c.pts[i];
    const abx = b[0] - a[0], abz = b[1] - a[1], len2 = abx * abx + abz * abz || 1;
    const t = Math.min(1, Math.max(0, ((x - a[0]) * abx + (z - a[1]) * abz) / len2));
    const d = Math.hypot(x - (a[0] + abx * t), z - (a[1] + abz * t));
    if (d < best.d) best = { d, s: c.acc[i - 1] + Math.sqrt(len2) * t, nx: a[0] + abx * t, nz: a[1] + abz * t };
  }
  return best;
}
/** Lateral distance from the centreline, or Infinity when the nearest point is outside [s0, s1]. */
function corridorDist(c, x, z, s0, s1) {
  const p = project(c, x, z);
  return p.s >= s0 && p.s <= s1 ? p.d : Infinity;
}

export const terrain = {
  get ready() { return ready; },
  get pockets() { return pockets; },
  at: sample,
  get corridors() { return corridors; },
  /**
   * Keep a thing that is INSIDE a tunnel (below its roof) between the tunnel walls: pulls (p.x, p.z) back within `half - r` of the bore's axis.
   * The walls are not blockers (a blocker is a 2D circle and would also wall off the hilltop above the tunnel); without this, stepping sideways
   * out of the bore dropped surface() to the hill height and threw the player up onto the ridge. Returns true if it moved the point.
   */
  clampBore(p, yRef, r = 0.6) {
    for (const c of corridors) {
      for (const b of c.bores) {
        if (p.x < b.minX || p.x > b.maxX || p.z < b.minZ || p.z > b.maxZ) continue;
        if (yRef >= b.roofY + 0.3) continue;
        const q = project(c, p.x, p.z);
        if (q.s < b.s0 || q.s > b.s1) continue;
        const lim = c.half - r;
        if (q.d > lim && q.d > 1e-6) {
          const k = lim / q.d;
          p.x = q.nx + (p.x - q.nx) * k;
          p.z = q.nz + (p.z - q.nz) * k;
          return true;
        }
      }
    }
    return false;
  },
  pointAt,
  project,
  /** freeway.js registers a function answering "is there a road deck at (x, z) at or below yRef?". */
  setDeckProvider(fn) { deckAt = fn; },
  /**
   * The ground a thing at height `yRef` should stand on at (x, z): a road deck it is at or above, the floor of a tunnel it is inside,
   * or the hill. (`at` alone is the hill: what a thing standing ON TOP of it would use.)
   * @param {number} yRef  the thing's current height + the step it may climb (~0.9)
   */
  surface(x, z, yRef = 0) {
    if (deckAt) { const d = deckAt(x, z, yRef); if (d !== null) return d; }
    for (const c of corridors) {
      for (const b of c.bores) {
        if (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ) continue;
        if (yRef < b.roofY + 0.3 && corridorDist(c, x, z, b.s0, b.s1) < c.half) return 0;     // inside the bore, below its roof: the road
      }
    }
    return sample(x, z);
  },
  slope(x, z, out = { x: 0, z: 0 }) {
    const e = 2.5;
    out.x = (sample(x + e, z) - sample(x - e, z)) / (2 * e);
    out.z = (sample(x, z + e) - sample(x, z - e)) / (2 * e);
    return out;
  },

  /**
   * Bake the field.
   * @param {object} o
   * @param {(x:number, z:number)=>boolean} o.blocked  true where something is built, a road runs, or the ground is reserved
   * @param {number} [o.seed]
   * @param {number} [o.amplitude]  metres of hill in open country (mountains reach ~2x in the deepest interior)
   */
  init({ blocked, seed = 20260927, amplitude = 40, roads = [] }) {
    // 1. a coarse "built" raster (24 m cells) and, from it, each cell's distance to the nearest built ground (two-pass chamfer)
    const BC = 24, BN = Math.ceil((EXTENT * 2) / BC) + 1;
    const dist = new Float32Array(BN * BN);
    const BIG = 1e5;
    for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) dist[j * BN + i] = blocked(-EXTENT + i * BC, -EXTENT + j * BC) ? 0 : BIG;
    // the map edge counts as built: the last stretch before the fog wall stays flat
    for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) {
      const edge = Math.min(i, j, BN - 1 - i, BN - 1 - j);
      if (edge < 4) dist[j * BN + i] = 0;
    }
    const D1 = BC, D2 = BC * 1.4142;
    for (let j = 0; j < BN; j++) for (let i = 0; i < BN; i++) {
      let v = dist[j * BN + i];
      if (i > 0) v = Math.min(v, dist[j * BN + i - 1] + D1);
      if (j > 0) v = Math.min(v, dist[(j - 1) * BN + i] + D1);
      if (i > 0 && j > 0) v = Math.min(v, dist[(j - 1) * BN + i - 1] + D2);
      if (i < BN - 1 && j > 0) v = Math.min(v, dist[(j - 1) * BN + i + 1] + D2);
      dist[j * BN + i] = v;
    }
    for (let j = BN - 1; j >= 0; j--) for (let i = BN - 1; i >= 0; i--) {
      let v = dist[j * BN + i];
      if (i < BN - 1) v = Math.min(v, dist[j * BN + i + 1] + D1);
      if (j < BN - 1) v = Math.min(v, dist[(j + 1) * BN + i] + D1);
      if (i < BN - 1 && j < BN - 1) v = Math.min(v, dist[(j + 1) * BN + i + 1] + D2);
      if (i > 0 && j < BN - 1) v = Math.min(v, dist[(j + 1) * BN + i - 1] + D2);
      dist[j * BN + i] = v;
    }
    const distAt = (x, z) => {
      const gx = (x + EXTENT) / BC, gz = (z + EXTENT) / BC;
      const ix = Math.max(0, Math.min(BN - 2, gx | 0)), iz = Math.max(0, Math.min(BN - 2, gz | 0));
      const fx = gx - ix, fz = gz - iz, i = iz * BN + ix;
      return dist[i] * (1 - fx) * (1 - fz) + dist[i + 1] * fx * (1 - fz) + dist[i + BN] * (1 - fx) * fz + dist[i + BN + 1] * fx * fz;
    };

    // 2. the height field
    heights = new Float32Array(N * N);
    let max = 0;
    for (let j = 0; j < N; j++) {
      const z = -EXTENT + j * CELL;
      for (let i = 0; i < N; i++) {
        const x = -EXTENT + i * CELL;
        const m = smooth(CLEAR_NEAR, CLEAR_FAR, distAt(x, z));
        if (m <= 0) continue;
        // rolling hills (a long wavelength, so a hill is 150-250 m across), with ridges laid over the wider pockets
        const base = fbm(x / 210, z / 210, seed);
        const hills = Math.pow(Math.max(0, base - 0.24) / 0.76, 1.1) * amplitude;
        const ridge = 1 - Math.abs(2 * fbm(x / 520 + 9.3, z / 520 - 4.1, seed + 101) - 1);           // 0..1, sharp crests
        const mountains = Math.pow(ridge, 3.2) * m * m * m * amplitude * 1.15 * smooth(0.35, 0.75, fbm(x / 900, z / 900, seed + 55));
        const h = m * hills + mountains;
        const v = h < MIN_RISE ? 0 : h - MIN_RISE * 0.6;
        heights[j * N + i] = v;
        if (v > max) max = v;
      }
    }
    // 2b. road corridors (freeways): flat ground through the hills. Where the hill stays high for a long stretch the road goes
    // UNDER it (a bore: the hill is left standing and freeway.js builds the tunnel); everywhere else the hill is cut back into a cutting.
    ready = true;
    corridors.length = 0;
    for (const r of roads) {
      const pts = r.pts, acc = [0];
      for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const c = { id: r.id, pts, acc, length: acc[acc.length - 1], half: r.half || 10, bank: r.bank || 26, bores: [] };
      // where does the road sit on top of raw hill? sample the axis every 4 m
      const STEP = 4, samples = [];
      for (let s = 0; s <= c.length; s += STEP) {
        const p = pointAt(c, s);
        samples.push({ s, h: sample(p.x, p.z), noBore: (r.noBore || []).some(([a, b]) => s >= a - 30 && s <= b + 30) });
      }
      let run = null;
      const flush = (endS) => { if (run && endS - run.s0 >= (r.minBore || 56)) c.bores.push({ s0: Math.max(0, run.s0 - 6), s1: Math.min(c.length, endS + 6) }); run = null; };
      for (const sm of samples) {
        if (sm.h >= (r.boreAbove || 10) && !sm.noBore) { if (!run) run = { s0: sm.s }; }
        else flush(sm.s);
      }
      flush(c.length);
      for (const b of c.bores) {
        b.roofY = r.roofY || 7.4;
        let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
        for (let s = b.s0; s <= b.s1; s += 4) { const p = pointAt(c, s); mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
        b.minX = mnx - c.half - 2; b.maxX = mxx + c.half + 2; b.minZ = mnz - c.half - 2; b.maxZ = mxz + c.half + 2;
      }
      // carve: every height sample near the axis and outside a bore is pulled to the road, with a bank up to the hill
      const reach = c.half + c.bank + CELL;
      let minx = 1e9, maxx = -1e9, minz = 1e9, maxz = -1e9;
      for (const p of pts) { minx = Math.min(minx, p[0]); maxx = Math.max(maxx, p[0]); minz = Math.min(minz, p[1]); maxz = Math.max(maxz, p[1]); }
      const i0 = Math.max(0, Math.floor((minx - reach + EXTENT) / CELL)), i1 = Math.min(N - 1, Math.ceil((maxx + reach + EXTENT) / CELL));
      const j0 = Math.max(0, Math.floor((minz - reach + EXTENT) / CELL)), j1 = Math.min(N - 1, Math.ceil((maxz + reach + EXTENT) / CELL));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const v = heights[j * N + i];
        if (v <= 0) continue;
        const x = -EXTENT + i * CELL, z = -EXTENT + j * CELL;
        const p = project(c, x, z);
        if (p.d > c.half + c.bank) continue;
        if (c.bores.some((b) => p.s >= b.s0 && p.s <= b.s1)) continue;               // inside a bore the hill stays (the tunnel is under it)
        heights[j * N + i] = v * smooth(c.half + 2, c.half + c.bank, p.d);
      }
      corridors.push(c);
    }
    // 3. remember the summits (QA and the minimap)
    pockets.length = 0;
    for (let j = 2; j < N - 2; j += 3) for (let i = 2; i < N - 2; i += 3) {
      const v = heights[j * N + i];
      if (v < 6) continue;
      let top = true;
      for (let dj = -6; dj <= 6 && top; dj++) for (let di = -6; di <= 6; di++) { const jj = j + dj, ii = i + di; if (jj < 0 || ii < 0 || jj >= N || ii >= N) continue; if (heights[jj * N + ii] > v) { top = false; break; } }
      if (top) pockets.push({ x: -EXTENT + i * CELL, z: -EXTENT + j * CELL, h: v });
    }
    let cells = 0, tall = 0; for (let k = 0; k < heights.length; k++) { if (heights[k] > 1) cells++; if (heights[k] > 12) tall++; }
    return { max, summits: pockets.length, hillKm2: +(cells * CELL * CELL / 1e6).toFixed(2), tallKm2: +(tall * CELL * CELL / 1e6).toFixed(2) };
  },

  /**
   * Trees planted before the field existed (the composers' forests) were set at ground level: raise each one onto the hills.
   * Instanced meshes flagged `userData.treeInstances` (composer.js vegetation) are walked once; the matrices are world-space.
   */
  liftTrees(scene) {
    let lifted = 0;
    const m = new THREE.Matrix4();
    scene.traverse((o) => {
      if (!o.isInstancedMesh || !o.userData.treeInstances || o.userData.lifted) return;
      o.userData.lifted = true;
      let any = false;
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m);
        const e = m.elements, g = sample(e[12], e[14]);
        if (g > 0.01) { e[13] += g; o.setMatrixAt(i, m); any = true; lifted++; }
      }
      if (any) { o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere(); }
    });
    return lifted;
  },

  /** The meshes: one plane per 64 m tile that holds any rise, vertex-coloured by height and slope. Returns the group. */
  build(scene) {
    const group = new THREE.Group();
    group.name = "terrain";
    const mat = new THREE.MeshStandardMaterial({ name: "hill ground", vertexColors: true, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    mat.userData.gtbRealized = true;
    const grass = new THREE.Color(0x4f6234), dry = new THREE.Color(0x6d6a3c), rock = new THREE.Color(0x77705f), dark = new THREE.Color(0x384726), redDust = new THREE.Color(0x8e5637), redDark = new THREE.Color(0x6a3c26);
    const c = new THREE.Color(), s = { x: 0, z: 0 };
    let tiles = 0;
    const seg = TILE / CELL;                                   // 8 quads a side, on the height samples
    for (let tz = -EXTENT; tz < EXTENT; tz += TILE) {
      for (let tx = -EXTENT; tx < EXTENT; tx += TILE) {
        let hi = 0;
        for (let z = tz; z <= tz + TILE; z += CELL) for (let x = tx; x <= tx + TILE; x += CELL) hi = Math.max(hi, sample(x, z));
        if (hi < 0.3) continue;
        const geo = new THREE.PlaneGeometry(TILE, TILE, seg, seg);
        geo.rotateX(-Math.PI / 2);
        const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
        for (let k = 0; k < pos.count; k++) {
          const x = tx + TILE / 2 + pos.getX(k), z = tz + TILE / 2 + pos.getZ(k);
          const h = sample(x, z);
          pos.setY(k, h + 0.015);
          terrain.slope(x, z, s);
          const steep = Math.min(1, Math.hypot(s.x, s.z) * 1.4);
          const n = vnoise(x / 9, z / 9, 3);
          c.copy(grass).lerp(dry, 0.25 + 0.35 * n).lerp(dark, Math.min(1, Math.max(0, (1 - h / 4)) * 0.35));
          // the north-west corner is the Red Dust badlands: red earth, not pasture
          const badlands = smooth(-360, -470, Math.max(x, z));
          if (badlands > 0) c.lerp(redDust.clone().lerp(redDark, 0.3 * (1 - n)), badlands * 0.9);
          c.lerp(rock, Math.min(1, steep * 0.9 + Math.max(0, (h - 22) / 26)) * (1 - 0.4 * badlands));
          col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        }
        geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
        // normals from the height field itself (not per-tile computeVertexNormals): neighbouring tiles agree on their shared edge, so no seams
        const nrm = new Float32Array(pos.count * 3);
        for (let k = 0; k < pos.count; k++) {
          const x = tx + TILE / 2 + pos.getX(k), z = tz + TILE / 2 + pos.getZ(k);
          terrain.slope(x, z, s);
          const l = Math.hypot(s.x, 1, s.z);
          nrm[k * 3] = -s.x / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -s.z / l;
        }
        geo.setAttribute("normal", new THREE.BufferAttribute(nrm, 3));
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(tx + TILE / 2, 0, tz + TILE / 2);
        mesh.receiveShadow = true;
        mesh.castShadow = true;
        mesh.userData.noBatch = true;
        group.add(mesh);
        tiles++;
      }
    }
    scene.add(group);
    group.userData.tiles = tiles;
    return group;
  },
};
