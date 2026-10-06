// ---------------------------------------------------------------------------
// freeway.js — freeways: elevated decks, ramps, pillars, cuttings and tunnels (human request, 2026-09-27: "freeways, tunnels").
//
// A freeway is a centreline with an elevation profile: control points [x, z, y]. Where y > 0 it is a concrete DECK on pillars (or
// on a solid embankment while it is still low), four lanes wide plus shoulders, that ordinary roads pass underneath. Where it runs
// through the hills, terrain.js does the rest: the hill is cut back into a CUTTING, or — where it stays high for a long stretch —
// left standing with a TUNNEL under it, and this module builds the tunnel (floor, walls, ceiling, lights, two portals).
//
//   FREEWAYS                       the definitions; corridorSpecs() turns them into terrain.init({ roads })
//   buildFreeway(R)                after terrain.build: meshes, pillars, tunnels, traffic lanes (with heights), the deck-height query
//   terrain.surface(x, z, yRef)    (terrain.js) asks the deck provider registered here, so a car / a walker / a zombie stands on the deck
//
// Cars: traffic lanes carry `ys` (a height per point; traffic.js sets the car's height and pitch from them, and two lanes at different
// heights do not yield to each other), so traffic really drives up the ramp, across the deck, and the road below carries on underneath.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { terrain } from "./terrain.js";

export const DECK_HALF = 13;              // half the carriageway width: median, 2 lanes each way, shoulders
const SLAB = 1.4;                         // deck thickness
const STEP = 6;                           // resample spacing, metres
const LANE_OFFS = [3.3, 6.9];             // lane centres either side of the median
const TUNNEL_HALF = 10;                   // half the bore width
const ROOF_Y = 7.4;                       // tunnel ceiling

/**
 * I-49 NORTHWEST: leaves the ground south of the Red Dust Pass, climbs over it on a deck (the pass runs underneath), comes back down and
 * heads north-west through the Cypress Hills — cuttings through the low ground, tunnels under the high — to the state line.
 */
export const FREEWAYS = [
  {
    id: "i49nw", name: "I-49",
    points: [
      [-430, -500, 0], [-430, -580, 8.2], [-430, -645, 8.2], [-430, -725, 0],
      [-520, -805, 0], [-700, -905, 0], [-900, -960, 0], [-1120, -1000, 0],
    ],
  },
];

/** Chain length of a [x, z, y] polyline, and the [s0, s1] ranges where the deck is raised (a bore is never allowed there). */
function chain(points) {
  const acc = [0];
  for (let i = 1; i < points.length; i++) acc.push(acc[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  return acc;
}

/** The corridors terrain.init needs (centreline, width, and where a tunnel is out of the question). */
export function corridorSpecs() {
  return FREEWAYS.map((f) => {
    const acc = chain(f.points), noBore = [];
    let start = null;
    for (let i = 0; i < f.points.length; i++) {
      if (f.points[i][2] > 0.5 && start === null) start = Math.max(0, acc[i] - 90);
      if (f.points[i][2] <= 0.5 && start !== null) { noBore.push([start, acc[i]]); start = null; }
    }
    if (start !== null) noBore.push([start, acc[acc.length - 1]]);
    return { id: f.id, pts: f.points.map((p) => [p[0], p[1]]), half: DECK_HALF, bank: 28, boreAbove: 21, minBore: 50, roofY: ROOF_Y, noBore };
  });
}

// ---- a tiny geometry accumulator: positions / normals / uvs / indices per material key, chunked so a long road still culls -----------
class Acc {
  constructor() { this.parts = new Map(); }
  get(key) { let p = this.parts.get(key); if (!p) this.parts.set(key, (p = { pos: [], nrm: [], uv: [], idx: [] })); return p; }
  /** A quad a, b, c, d (counter-clockwise seen from the side the normal points to). */
  quad(key, a, b, c, d, uv = null) {
    const p = this.get(key), base = p.pos.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    for (const v of [a, b, c, d]) { p.pos.push(v[0], v[1], v[2]); p.nrm.push(nx, ny, nz); }
    const t = uv || [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (const q of t) p.uv.push(q[0], q[1]);
    p.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  meshes(mats, group, shadows = true) {
    for (const [key, p] of this.parts) {
      const [name] = key.split("|");
      const mat = mats[name];
      if (!mat || !p.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(p.pos, 3));
      g.setAttribute("normal", new THREE.Float32BufferAttribute(p.nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(p.uv, 2));
      g.setIndex(p.idx);
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat);
      m.castShadow = shadows && name !== "paint" && name !== "asphalt";
      m.receiveShadow = true;
      m.userData.noBatch = true;
      group.add(m);
    }
  }
}

/** Resample a freeway's control points every STEP metres with a smoothed vertical profile. */
function resample(points) {
  const acc = chain(points), total = acc[acc.length - 1], out = [];
  const n = Math.max(2, Math.round(total / STEP));
  const yAt = (s) => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < s) i++;
    const seg = acc[i] - acc[i - 1] || 1, t = Math.min(1, Math.max(0, (s - acc[i - 1]) / seg));
    return points[i - 1][2] + (points[i][2] - points[i - 1][2]) * t;
  };
  const pAt = (s) => {
    let i = 1;
    while (i < acc.length - 1 && acc[i] < s) i++;
    const a = points[i - 1], b = points[i], seg = acc[i] - acc[i - 1] || 1, t = Math.min(1, Math.max(0, (s - acc[i - 1]) / seg));
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (let k = 0; k <= n; k++) { const s = (total * k) / n, p = pAt(s); out.push({ s, x: p[0], z: p[1], y: yAt(s) }); }
  // smooth the profile (two passes of a 5-point average) so a ramp eases into the flat instead of kinking, pinning the ends
  for (let pass = 0; pass < 3; pass++) {
    const ys = out.map((o) => o.y);
    for (let k = 1; k < out.length - 1; k++) {
      let sum = 0, cnt = 0;
      for (let d = -2; d <= 2; d++) { const j = k + d; if (j >= 0 && j < out.length) { sum += ys[j]; cnt++; } }
      out[k].y = sum / cnt;
    }
  }
  // tangents and right-hand normals
  for (let k = 0; k < out.length; k++) {
    const a = out[Math.max(0, k - 1)], b = out[Math.min(out.length - 1, k + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
    out[k].tx = tx; out[k].tz = tz; out[k].rx = -tz; out[k].rz = tx;
  }
  return out;
}

const makeCanvasTexture = (text, w = 512, h = 128, bg = "#1c6b3a") => {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#ffffff"; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = "#ffffff"; g.font = "bold 46px Arial, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

/**
 * @param {object} R stateWorld's environment: { ctx, lanes, occluders? }
 * @returns {{ group, lanes, occluders, decks, tunnels }}
 */
export function buildFreeway(R) {
  const { ctx } = R;
  const { scene, addBlocker, addLitSpot } = ctx;
  const group = new THREE.Group();
  group.name = "freeways";
  const out = { group, lanes: [], occluders: [], tunnels: [], decks: 0, pillars: 0 };

  const roadMat = (() => {
    try {
      const m = ctx.roadMaterial().clone();
      for (const k of ["map", "normalMap", "roughnessMap"]) if (m[k]) { m[k] = m[k].clone(); m[k].wrapS = m[k].wrapT = THREE.RepeatWrapping; m[k].needsUpdate = true; }
      return m;
    } catch { return new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.92 }); }
  })();
  const std = (color, name, o = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness: 0.92, metalness: 0, name, ...o }); m.userData.gtbRealized = true; return m; };
  const paintMat = new THREE.MeshStandardMaterial({ color: 0xe8e6de, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: "freeway paint" });
  paintMat.userData.gtbRealized = true;
  const yellowMat = new THREE.MeshStandardMaterial({ color: 0xd9b545, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, name: "freeway paint" });
  yellowMat.userData.gtbRealized = true;
  const mats = {
    asphalt: roadMat,
    paint: paintMat,
    yellow: yellowMat,
    concrete: std(0x8f8c86, "concrete overpass", { side: THREE.DoubleSide }),
    barrier: std(0xb1aea6, "concrete barrier", { side: THREE.DoubleSide }),
    tile: std(0xb9b2a0, "tunnel tile", { side: THREE.DoubleSide }),
    ceiling: std(0x8b867c, "tunnel ceiling", { side: THREE.DoubleSide }),
    lamp: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb866).multiplyScalar(2.6), fog: false, side: THREE.DoubleSide }),      // (double-sided: the strips face the roof, and are seen from below)
  };
  mats.lamp.userData.gtbRealized = true;

  const acc = new Acc();
  const segs = [];                     // deck segments for the height query
  const grid = new Map();              // 32 m cells -> segment indices
  const CELLG = 32;
  const cellsOf = (x0, z0, x1, z1) => {
    const list = [];
    for (let cx = Math.floor(Math.min(x0, x1) / CELLG); cx <= Math.floor(Math.max(x0, x1) / CELLG); cx++)
      for (let cz = Math.floor(Math.min(z0, z1) / CELLG); cz <= Math.floor(Math.max(z0, z1) / CELLG); cz++) list.push(cx + "," + cz);
    return list;
  };
  const roadNear = (x, z, m) => {                                  // another road passes here (so no pillar): the shared lane list
    for (const l of (ctx.allLanes ? ctx.allLanes() : R.lanes)) {
      if (l.freeway) continue;
      for (let i = 1; i < l.points.length; i++) {
        const [ax, az] = l.points[i - 1], [bx, bz] = l.points[i];
        if (x < Math.min(ax, bx) - m || x > Math.max(ax, bx) + m || z < Math.min(az, bz) - m || z > Math.max(az, bz) + m) continue;
        const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / ((dx * dx + dz * dz) || 1)));
        if (Math.hypot(x - (ax + t * dx), z - (az + t * dz)) < m) return true;
      }
    }
    return false;
  };
  const pillarGeos = [];

  for (const f of FREEWAYS) {
    const S = resample(f.points);
    const corridor = terrain.corridors.find((c) => c.id === f.id);
    const bores = corridor ? corridor.bores : [];
    const inBore = (s) => bores.some((b) => s >= b.s0 && s <= b.s1);
    const lanesForF = { nb: [[], []], sb: [[], []] };            // [inner, outer] for each direction, forward = along the polyline

    for (let k = 0; k < S.length - 1; k++) {
      const a = S[k], b = S[k + 1];
      const chunk = (k / 20) | 0;
      const bore = inBore((a.s + b.s) / 2);
      const P = (o, s, dy = 0) => [s.x + s.rx * o, s.y + dy, s.z + s.rz * o];   // a point across the deck at offset o
      const raised = Math.min(a.y, b.y) > 0.25;
      const vLen = (b.s - a.s) / 8;

      // ---- the roadway (inside a bore the tunnel builds its own floor)
      if (!bore) {
        acc.quad("asphalt|" + chunk, P(-DECK_HALF, a, 0.02), P(DECK_HALF, a, 0.02), P(DECK_HALF, b, 0.02), P(-DECK_HALF, b, 0.02), [[0, a.s / 8], [DECK_HALF * 2 / 8, a.s / 8], [DECK_HALF * 2 / 8, b.s / 8], [0, b.s / 8]]);
        // paint: solid edge lines, a dashed line between the two lanes each way, and no centre line (there is a median barrier)
        const line = (o, w, dashed, key = "paint") => {
          if (dashed && (Math.round(a.s / STEP) % 2)) return;
          acc.quad(key + "|" + chunk, P(o - w / 2, a, 0.05), P(o + w / 2, a, 0.05), P(o + w / 2, b, 0.05), P(o - w / 2, b, 0.05));
        };
        for (const sgn of [-1, 1]) { line(sgn * 8.75, 0.2, false); line(sgn * 5.1, 0.16, true); line(sgn * 1.55, 0.18, false, "yellow"); }
        // Jersey barriers: the edges, and the median
        const wall = (o, w, h) => {
          const oL = o - w / 2, oR = o + w / 2;
          acc.quad("barrier|" + chunk, P(oL, a, h), P(oR, a, h), P(oR, b, h), P(oL, b, h));                    // top
          acc.quad("barrier|" + chunk, P(oL, a, 0), P(oL, b, 0), P(oL, b, h), P(oL, a, h));                    // side facing -offset
          acc.quad("barrier|" + chunk, P(oR, b, 0), P(oR, a, 0), P(oR, a, h), P(oR, b, h));                    // side facing +offset
        };
        wall(-DECK_HALF + 0.3, 0.6, 0.95); wall(DECK_HALF - 0.3, 0.6, 0.95); wall(0, 0.7, 0.95);
        // the slab below: sides and underside; a low deck is a solid embankment down to the ground, a high one shows the pillars
        const low = a.y < 3.6 && b.y < 3.6;
        const bot = (sp) => (low ? -0.4 - sp.y : -SLAB);            // (relative to the deck top)
        acc.quad("concrete|" + chunk, P(-DECK_HALF, a, bot(a)), P(-DECK_HALF, b, bot(b)), P(-DECK_HALF, b, 0), P(-DECK_HALF, a, 0));
        acc.quad("concrete|" + chunk, P(DECK_HALF, b, bot(b)), P(DECK_HALF, a, bot(a)), P(DECK_HALF, a, 0), P(DECK_HALF, b, 0));
        if (raised) acc.quad("concrete|" + chunk, P(-DECK_HALF, a, -SLAB), P(DECK_HALF, a, -SLAB), P(DECK_HALF, b, -SLAB), P(-DECK_HALF, b, -SLAB));
      }

      // ---- the deck as a query surface, and the camera's ceiling
      if (raised || Math.max(a.y, b.y) > 0.1) {          // (a ramp's foot counts too: it used to be missing from the query, so walkers and cars sank into it)
        const idx = segs.length;
        segs.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z, ay: a.y, by: b.y, len: Math.hypot(b.x - a.x, b.z - a.z) || 1 });
        for (const c of cellsOf(Math.min(a.x, b.x) - DECK_HALF, Math.min(a.z, b.z) - DECK_HALF, Math.max(a.x, b.x) + DECK_HALF, Math.max(a.z, b.z) + DECK_HALF)) {
          if (!grid.has(c)) grid.set(c, []);
          grid.get(c).push(idx);
        }
        if (a.y > 2.8 || b.y > 2.8) {
          out.occluders.push({
            minX: Math.min(a.x, b.x) - DECK_HALF, maxX: Math.max(a.x, b.x) + DECK_HALF, minZ: Math.min(a.z, b.z) - DECK_HALF, maxZ: Math.max(a.z, b.z) + DECK_HALF,
            minY: Math.min(a.y, b.y) - SLAB - 0.2, maxY: Math.max(a.y, b.y) + 0.5,
          });
        }
        out.decks++;
      }

      // ---- pillars every fourth sample while the deck is high enough to need them
      if (k % 4 === 2 && a.y > 2.8 && !bore) {
        if (!roadNear(a.x, a.z, 9)) {
          const h = a.y - SLAB;
          const col = new THREE.CylinderGeometry(1.0, 1.15, h, 12); col.translate(a.x, h / 2, a.z);
          const cap = new THREE.BoxGeometry(2 * DECK_HALF - 6, 1.1, 2.0); cap.rotateY(Math.atan2(a.rx, a.rz) + Math.PI / 2); cap.translate(a.x, a.y - SLAB - 0.55, a.z);
          pillarGeos.push(col, cap);
          if (addBlocker) addBlocker(a.x, a.z, 1.25);
          out.pillars++;
        }
      }

      // ---- traffic lanes: collected as chains along the polyline, with heights
      for (const [dir, sgn] of [["nb", 1], ["sb", -1]]) {
        LANE_OFFS.forEach((off, li) => {
          const o = sgn * off;
          if (k === 0) lanesForF[dir][li].push([a.x + a.rx * o, a.z + a.rz * o, a.y + 0.03]);
          lanesForF[dir][li].push([b.x + b.rx * o, b.z + b.rz * o, b.y + 0.03]);
        });
      }
    }

    // lanes: northbound = along the polyline (the right-hand side heading along it is +offset), southbound is the reverse
    const laneOut = (pts, name, cruise, reverse) => {
      const seq = reverse ? pts.slice().reverse() : pts;
      out.lanes.push({ name, points: seq.map((p) => [p[0], p[1]]), ys: seq.map((p) => p[2]), cruise, freeway: true, elevated: seq.some((p) => p[2] > 1) });
    };
    laneOut(lanesForF.nb[0], f.id + "-fwd-inner", [22, 30], false);
    laneOut(lanesForF.nb[1], f.id + "-fwd-outer", [17, 24], false);
    laneOut(lanesForF.sb[0], f.id + "-rev-inner", [22, 30], true);
    laneOut(lanesForF.sb[1], f.id + "-rev-outer", [17, 24], true);

    // ---------------------------------------------------------------- tunnels
    for (const b of bores) {
      const t = { s0: b.s0, s1: b.s1, length: b.s1 - b.s0 };
      const T = new Acc();
      const ss = S.filter((p) => p.s >= b.s0 - 1e-3 && p.s <= b.s1 + 1e-3);
      for (let k = 0; k < ss.length - 1; k++) {
        const a = ss[k], c = ss[k + 1], ch = (k / 16) | 0;
        const Q = (o, s, y) => [s.x + s.rx * o, y, s.z + s.rz * o];
        T.quad("asphalt|" + ch, Q(-TUNNEL_HALF, a, 0.03), Q(TUNNEL_HALF, a, 0.03), Q(TUNNEL_HALF, c, 0.03), Q(-TUNNEL_HALF, c, 0.03), [[0, a.s / 8], [2.5, a.s / 8], [2.5, c.s / 8], [0, c.s / 8]]);
        for (const sgn of [-1, 1]) {
          const o = sgn * TUNNEL_HALF;
          T.quad("tile|" + ch, Q(o, a, 0), Q(o, c, 0), Q(o, c, ROOF_Y), Q(o, a, ROOF_Y));
          if (!(Math.round(a.s / STEP) % 2)) T.quad("paint|" + ch, Q(sgn * 8.75 - 0.1, a, 0.05), Q(sgn * 8.75 + 0.1, a, 0.05), Q(sgn * 8.75 + 0.1, c, 0.05), Q(sgn * 8.75 - 0.1, c, 0.05));
        }
        T.quad("ceiling|" + ch, Q(-TUNNEL_HALF, a, ROOF_Y), Q(TUNNEL_HALF, a, ROOF_Y), Q(TUNNEL_HALF, c, ROOF_Y), Q(-TUNNEL_HALF, c, ROOF_Y));
        // the lane divider and the median barrier
        T.quad("paint|" + ch, Q(5.0, a, 0.05), Q(5.16, a, 0.05), Q(5.16, c, 0.05), Q(5.0, c, 0.05));
        T.quad("paint|" + ch, Q(-5.16, a, 0.05), Q(-5.0, a, 0.05), Q(-5.0, c, 0.05), Q(-5.16, c, 0.05));
        T.quad("barrier|" + ch, Q(-0.35, a, 0.95), Q(0.35, a, 0.95), Q(0.35, c, 0.95), Q(-0.35, c, 0.95));
        T.quad("barrier|" + ch, Q(-0.35, a, 0), Q(-0.35, c, 0), Q(-0.35, c, 0.95), Q(-0.35, a, 0.95));
        T.quad("barrier|" + ch, Q(0.35, c, 0), Q(0.35, a, 0), Q(0.35, a, 0.95), Q(0.35, c, 0.95));
        // light strips along the ceiling, over each lane pair
        for (const o of [-6.0, 6.0]) T.quad("lamp|" + ch, Q(o - 0.25, a, ROOF_Y - 0.05), Q(o + 0.25, a, ROOF_Y - 0.05), Q(o + 0.25, c, ROOF_Y - 0.05), Q(o - 0.25, c, ROOF_Y - 0.05));
        out.occluders.push({
          minX: Math.min(a.x, c.x) - TUNNEL_HALF - 1, maxX: Math.max(a.x, c.x) + TUNNEL_HALF + 1, minZ: Math.min(a.z, c.z) - TUNNEL_HALF - 1, maxZ: Math.max(a.z, c.z) + TUNNEL_HALF + 1,
          minY: ROOF_Y - 0.3, maxY: ROOF_Y + 60,
        });
      }
      T.meshes(mats, group, false);
      // a pool light every ~34 m, warm sodium
      for (let s = b.s0 + 14; s < b.s1; s += 34) { const p = terrain.pointAt(corridor, s); if (addLitSpot) addLitSpot({ x: p.x, y: ROOF_Y - 1, z: p.z, warm: 0xffc478, power: 90, range: 26 }); }
      // the portals: two piers and a lintel facing out, with a sign
      const signTex = makeCanvasTexture(f.name + " · CYPRESS HILLS TUNNEL", 768, 128);
      const signMat = new THREE.MeshBasicMaterial({ map: signTex, fog: true });
      signMat.userData.gtbRealized = true;
      for (const [s, sign] of [[b.s0, -1], [b.s1, 1]]) {
        const p = terrain.pointAt(corridor, s), yaw = Math.atan2(p.dx, p.dz);
        const box = (w, h, d, ox, oy, oz, m) => {
          const g = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
          const cy = Math.cos(yaw), sy = Math.sin(yaw);
          g.position.set(p.x + ox * cy + oz * sy, oy, p.z - ox * sy + oz * cy);
          g.rotation.y = yaw; g.castShadow = g.receiveShadow = true; g.userData.noBatch = true;
          group.add(g); return g;
        };
        box(3.0, ROOF_Y + 5, 4.5, -(TUNNEL_HALF + 1.5), (ROOF_Y + 5) / 2, 0, mats.concrete);
        box(3.0, ROOF_Y + 5, 4.5, TUNNEL_HALF + 1.5, (ROOF_Y + 5) / 2, 0, mats.concrete);
        box(2 * TUNNEL_HALF + 6, 5, 4.5, 0, ROOF_Y + 2.5, 0, mats.concrete);
        const sg = box(16, 2.6, 0.2, 0, ROOF_Y + 2.6, sign * 2.35, signMat);
        if (sign > 0) sg.rotation.y += Math.PI;
        // (the sign faces out of the tunnel at its own end: a driver reads it on the way in)
        if (addLitSpot) addLitSpot({ x: p.x + p.dx * sign * -8, y: 5, z: p.z + p.dz * sign * -8, warm: 0xffd6a0, power: 70, range: 24 });
      }
      out.tunnels.push(t);
    }
  }

  // pillars, merged into one mesh
  if (pillarGeos.length) {
    const g = mergeGeometries(pillarGeos, false);
    const m = new THREE.Mesh(g, mats.concrete);
    m.castShadow = m.receiveShadow = true; m.userData.noBatch = true;
    group.add(m);
  }
  acc.meshes(mats, group);
  scene.add(group);

  // ---- the deck-height query: the highest deck at (x, z) that a thing at yRef can stand on
  terrain.setDeckProvider((x, z, yRef) => {
    const list = grid.get(Math.floor(x / CELLG) + "," + Math.floor(z / CELLG));
    if (!list) return null;
    let best = null;
    for (const i of list) {
      const s = segs[i];
      const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz || 1;
      const t = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / l2));
      if (Math.hypot(x - (s.ax + dx * t), z - (s.az + dz * t)) > DECK_HALF - 0.2) continue;
      const y = s.ay + (s.by - s.ay) * t + 0.02;
      if (y <= yRef && (best === null || y > best)) best = y;
    }
    return best;
  });
  out.segments = segs.length;
  return out;
}
