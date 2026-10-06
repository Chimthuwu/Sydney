// ---------------------------------------------------------------------------
// markings.js — the paint on the road.
//
//   const M = createMarkings({ y: 0.031 })
//   M.roadway(parent, { points, lanes: 2, median: 0.4, laneWidth: 2.4 })
//   M.crosswalk(parent, x, z, { alongX: true, half: 4.85, stripes: 7 })
//   M.stopBar(parent, x, z, { alongX: true, half: 4.85, side: 1 })
//
// This exists because of a specific hole. US-167 was widened to four lanes and
// two lanes of cars now pass each other in each direction — but the road still
// had exactly one dashed yellow line down its middle, drawn where the CENTRE of
// the carriageway is. The work was real and completely invisible, because
// nothing on the tarmac said four lanes existed.
//
// The geometry here is deliberately the SAME arithmetic makeRoadway() uses for
// lane offsets, read from the same numbers rather than a second copy of them: a
// dashed line painted 0.3 m off from where the traffic actually drives is worse
// than no line, because it tells the player the cars are wrong.
// ---------------------------------------------------------------------------

import * as THREE from "three";

// Everything below is laid flat in XZ and merged into one geometry per colour,
// so a 2.4 km arterial is two draw calls rather than four thousand meshes.
// Y is the single `y` the whole system is built at: markings live a centimetre
// or so above the tarmac, and everything in this game stacks in small positive
// increments for exactly that reason (GROUND_Y in main.js).

/** Build one flat geometry from a list of axis-aligned-or-yawed rectangles. */
function quadsGeometry(items) {
  const n = items.length;
  // Four corners are WRITTEN per rectangle but only six are INDEXED (two
  // triangles share two of them). Allocating for six corners and writing four
  // leaves the tail of every buffer as zeroes — which reads as a degenerate
  // quad at the origin, sitting in the middle of the road. Sizes are n * 12.
  const pos = new Float32Array(n * 4 * 3);
  const nor = new Float32Array(n * 4 * 3);
  const uv = new Float32Array(n * 4 * 2);
  const idx = new Uint32Array(n * 6);
  let p = 0, u = 0;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const hw = it.w / 2, hd = it.d / 2;
    const c = Math.cos(it.ry || 0), s = Math.sin(it.ry || 0);
    // the four corners of a rectangle, rotated about its own centre
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]];
    const base = p / 3;
    for (let k = 0; k < 4; k++) {
      const [lx, lz] = corners[k];
      pos[p] = it.x + lx * c - lz * s;
      pos[p + 1] = it.y;
      pos[p + 2] = it.z + lx * s + lz * c;
      nor[p] = 0; nor[p + 1] = 1; nor[p + 2] = 0;
      p += 3;
      uv[u] = k === 1 || k === 2 ? 1 : 0;
      uv[u + 1] = k >= 2 ? 1 : 0;
      u += 2;
    }
    idx.set([base, base + 2, base + 1, base, base + 3, base + 2], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}

// American convention, and the reason a New Orleans road reads as a Louisiana
// road: a warm white for lane and edge lines, a yellow for the median, and a
// white for everything else.
const WHITE = 0xf2f0e6;
const YELLOW = 0xd9b93a;
const CROSSWALK = 0xf6f4ea;

/**
 * How much road a single junction's paint actually covers, measured from the
 * junction centre out to the furthest paint of any kind — the crossings at
 * `half + depth/2 + 1.2 ± depth/2`, and the stop bars beyond those.
 *
 * Exported because the value is a hard constraint on where junctions may be
 * placed, and the constraint was being violated silently: two junctions closer
 * together than this draw their paint on top of each other. Coplanar paint at
 * the same Y is not an ugly overlap, it is a DEPTH FIGHT — the two quads
 * z-fight and the GPU shreds both into a ragged, half-eaten mess. That is what
 * a US-167 crossing looked like (human report, 2026-09-28: "pedestrian
 * crossings look like shit, look really lazily painted").
 *
 * @returns {number} metres from the centre; two junctions need twice this
 *   between them to avoid overlapping at all.
 */
export function junctionEnvelope(half = 5, D = MARKING_DEFAULTS) {
  const crossingCentre = half + D.crosswalkDepth / 2 + 1.2;
  const crossing = crossingCentre + D.crosswalkDepth / 2;
  // the stop bars now straddle the crossing's centre by depth/2 + gap, so the
  // far one is that far out again, plus half a bar's own depth
  const bar = crossingCentre + (D.crosswalkDepth / 2 + 1.0) + D.stopBarWidth / 2;
  return Math.max(crossing, bar);
}

/**
 * Drop the junctions that cannot fit, keeping the first of each crowded run.
 *
 * `US167_JUNCTIONS` was authored as "every z where a district road meets the
 * boulevard", and two districts' roads turned out to be 14 m apart — nearer
 * than one junction's paint envelope (24.3 m), so they painted over each other.
 * Both roads still exist and neither is wrong; there is simply not room for a
 * crossing at each. The lower-numbered junction is kept, deterministically, so
 * this does not reshuffle frame to frame.
 *
 * @param {number[]} zs
 * @param {number} half  carriageway half-width, matching the `junction()` call
 * @returns {{kept:number[], dropped:number[]}}
 */
export function spaceJunctions(zs, half = 5, D = MARKING_DEFAULTS) {
  const minGap = junctionEnvelope(half, D) * 2;
  const sorted = [...zs].sort((a, b) => a - b);
  const kept = [], dropped = [];
  for (const z of sorted) {
    if (kept.length && z - kept[kept.length - 1] < minGap) { dropped.push(z); continue; }
    kept.push(z);
  }
  return { kept, dropped };
}

export const MARKING_DEFAULTS = Object.freeze({
  laneWidth: 2.4,
  median: 0.4,
  edgeInset: 0.18,      // white edge line, in from the kerb
  dashLength: 2.6,
  dashGap: 3.4,         // 6 m pitch, so a dash reads at speed without strobing
  lineWidth: 0.16,
  medianGap: 0.22,      // the two yellow lines are this far apart, centre to centre
  crosswalkStripe: 0.55,
  crosswalkGap: 0.55,
  crosswalkDepth: 3.0,
  stopBarWidth: 0.45,
});

export function createMarkings({ y = 0.031, material = null } = {}) {
  const D = MARKING_DEFAULTS;
  const mats = new Map();
  const mat = (color) => {
    if (material) return material;
    if (!mats.has(color)) {
      const m = new THREE.MeshStandardMaterial({
        color, roughness: 0.62, metalness: 0, envMapIntensity: 1.1, name: "road paint",
      });
      m.userData.gtbRealized = true;
      mats.set(color, m);
    }
    return mats.get(color);
  };

  const whites = [], yellows = [], bars = [];
  // One mesh per colour per parent, created lazily and flushed by flush().
  const meshes = new Map();

  const push = (bucket, it) => (it ? bucket.push(it) : null);

  /**
   * A dashed line running alongside a straight or gently-curved centreline.
   * `offset` is signed and measured to the RIGHT of travel, matching
   * makeRoadway's right-hand convention so a left turn crosses the oncoming
   * lines and a right turn crosses its own.
   */
  function dashedAlong(bucket, pts, offset, { dash, gap, width, colour = null, y0 = y, alongX = true }) {
    // `travelled` runs across segments so the dash pattern is continuous round a
    // curve instead of restarting at every vertex. It starts at `dash` so the
    // first dash is not flush with the end of the road.
    const period = dash + gap;
    // Phase is worked out by SUBTRACTION from the next multiple, never by
    // taking a remainder of a large running total: `travelled` reaches hundreds
    // of metres on a state-long arterial, and at that magnitude a float
    // remainder lands a hair under `dash` instead of on it, which makes the run
    // 6.6e-16 long and the loop below never advance. It hung the level build
    // with a 4 GB heap before this was found.
    let travelled = dash, edge = dash;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      let dx = bx - ax, dz = bz - az;
      const seg = Math.hypot(dx, dz);
      if (seg < 0.01) continue;
      dx /= seg; dz /= seg;
      const rx = dz, rz = -dx;                  // right of travel
      let s = 0;
      while (s < seg) {
        const at = travelled + s;               // distance along the whole road
        if (at < edge) {
          // inside a dash: paint it
          const run = Math.min(edge - at, seg - s);
          const mid = s + run / 2;
          // Swap w/d rather than rotating. quadsGeometry lays corners out in
          // world XZ, so swapping the extents and ALSO passing ry: PI/2 turns
          // the mark through 90 degrees twice and every dash ends up lying
          // across the carriageway instead of along it.
          const w = alongX ? run : width;
          const d = alongX ? width : run;
          push(bucket, {
            x: ax + dx * mid + rx * offset, y: y0, z: az + dz * mid + rz * offset,
            w, d, ry: 0, colour,
          });
          s += run;
        }
        // `edge` is the end of this dash, then the gap, then the next one. It is
        // always strictly greater than `at`, so this always makes progress.
        edge = edge + (at < edge ? gap : period);
        if (s >= seg) break;
      }
      travelled += seg;
      if (edge < travelled) edge = travelled + dash;    // never fall behind
    }
  }

  /** A continuous line. Broken up per segment so it follows a curve. */
  function solidAlong(bucket, pts, offset, { width, alongX = true, colour = null, y0 = y }) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      let dx = bx - ax, dz = bz - az;
      const seg = Math.hypot(dx, dz);
      if (seg < 0.01) continue;
      dx /= seg; dz /= seg;
      // `offset` is measured to the right of travel, exactly as in dashedAlong.
      // Applying it here is the whole point: without it every solid line — both
      // edge lines and both median lines — lands on the road's centreline and
      // stacks there, which is a road with one stripe down the middle again.
      push(bucket, {
        x: (ax + bx) / 2 + dz * offset, y: y0, z: (az + bz) / 2 - dx * offset,
        w: alongX ? seg : width, d: alongX ? width : seg, ry: 0, colour,
      });
    }
  }

  /**
   * Everything a carriageway needs, derived from the same numbers the traffic
   * uses. `road.lanes` is lanes PER DIRECTION.
   *
   *   median | lane | lane | median | lane | lane
   *      ||  ------  ------  ||  ------  ------
   *   yellow   dashed white    yellow   dashed white   <- edge line at the kerb
   */
  function roadway(road) {
    const n = Math.max(1, road.lanes || 1);
    const median = road.median != null ? road.median : n > 1 ? 1.2 : 0;
    const lw = road.laneWidth || D.laneWidth;
    const pts = road.points;
    const alongX = Math.abs(pts[pts.length - 1][0] - pts[0][0]) > Math.abs(pts[pts.length - 1][1] - pts[0][1]);
    const y0 = road.y != null ? road.y + 0.011 : y;
    // offsets are signed, so a negative offset is the same distance to the left
    const at = (i) => median / 2 + (i + 0.5) * lw;

    // the outside of the outermost lane, which is where the kerb is
    const outer = at(n - 1) + lw / 2;
    for (const s of [1, -1]) {
      // edge line: hard against the outside of the outermost lane
      solidAlong(whites, pts, s * (outer - D.edgeInset), { width: D.lineWidth, alongX, y0 });
      // lane dividers between the lanes of this direction
      for (let i = 0; i < n - 1; i++) {
        dashedAlong(whites, pts, s * (at(i) + lw / 2), {
          dash: D.dashLength, gap: D.dashGap, width: D.lineWidth, alongX, y0,
        });
      }
      // a single-lane road gets a broken yellow down the middle instead
      if (n === 1) {
        dashedAlong(yellows, pts, 0, { dash: D.dashLength * 1.5, gap: D.dashGap * 1.5, width: D.lineWidth * 2.2, alongX, y0 });
      }
    }
    // the median: two solid yellows, which is how a divided road is signed
    if (n > 1 && median > 0.1) {
      for (const s of [1, -1]) {
        solidAlong(yellows, pts, s * D.medianGap, { width: D.lineWidth * 1.5, alongX, y0 });
      }
    }
    return { alongX, y0, outer, half: outer };
  }

  /**
   * A zebra crossing. `alongX` is the direction OF TRAFFIC it serves, so the
   * stripes are bars across the carriageway and the pedestrian walks along it.
   * Returns the box it occupies, so a stop bar can be placed against it.
   */
  function crosswalk(x, z, { alongX = true, half = 5, stripes = 7, y0 = y, ry = 0 } = {}) {
    const pitch = D.crosswalkStripe + D.crosswalkGap;
    const span = stripes * pitch - D.crosswalkGap;
    for (let i = 0; i < stripes; i++) {
      const off = -span / 2 + pitch * (i + 0.5);
      const w = alongX ? D.crosswalkDepth : D.crosswalkStripe;
      const d = alongX ? D.crosswalkStripe : D.crosswalkDepth;
      const dx = alongX ? 0 : off, dz = alongX ? off : 0;
      const c = Math.cos(ry), s = Math.sin(ry);
      bars.push({ x: x + dx * c - dz * s, y: y0 + 0.002, z: z + dx * s + dz * c, w, d, ry });
    }
    return { x, z, half, alongX, ry, depth: D.crosswalkDepth, span };
  }

  /**
   * A stop bar across the approaching lanes, one per direction of travel, set
   * back from the crossing on BOTH sides of it.
   *
   * `z` is the CENTRE of the crossing this bar belongs to, and `gap` is how far
   * back each bar sits from the zebra's edge. It used to be called with a site
   * already pushed past the crossing and then offset by only `depth/2 + inset`,
   * which put the near bar at 7.7 m — dead centre of a crossing that spans
   * 6.2–9.2. A white stop bar painted straight across the zebra it belongs to,
   * coplanar with it, at the same height: the same depth fight as two
   * junctions too close together, and the same shredded crossing on screen.
   */
  function stopBar(x, z, { alongX = true, half = 5, y0 = y, ry = 0, gap = 1.0 } = {}) {
    const c = Math.cos(ry), s = Math.sin(ry);
    const push2 = (ox, oz) => bars.push({
      x: x + ox * c - oz * s, y: y0 + 0.002, z: z + ox * s + oz * c,
      w: alongX ? D.stopBarWidth : half * 2, d: alongX ? half * 2 : D.stopBarWidth, ry,
    });
    const back = D.crosswalkDepth / 2 + gap;
    if (alongX) { push2(-back, 0); push2(back, 0); } else { push2(0, -back); push2(0, back); }
  }

  /** Everything that belongs to one junction: four crossings and their bars. */
  function junction(x, z, { alongX = true, half = 5, y0 = y, striped = true, bars: withBars = true } = {}) {
    const ends = [];
    for (const s of [1, -1]) {
      const c = crosswalk(x, z + s * (half + D.crosswalkDepth / 2 + 1.2), {
        alongX, half, stripes: 7, y0, ry: 0,
      });
      ends.push(c);
      // the bar goes against THIS crossing, measured from the crossing's own
      // centre, so it can only ever clear the zebra rather than cross it
      if (withBars) stopBar(x, c.z, { alongX, half, y0 });
    }
    if (striped) {
      for (const s of [1, -1]) {
        crosswalk(x + s * (half + D.crosswalkDepth / 2 + 1.2), z, {
          alongX: !alongX, half, stripes: 7, y0,
        });
      }
    }
    return ends;
  }

  /** Build the meshes and add them to `parent`. Call once, after all painting. */
  function flush(parent) {
    const out = [];
    for (const [bucket, colour] of [[whites, WHITE], [yellows, YELLOW], [bars, CROSSWALK]]) {
      if (!bucket.length) continue;
      const m = new THREE.Mesh(quadsGeometry(bucket), mat(colour));
      m.receiveShadow = true;
      m.castShadow = false;
      m.userData.gtbPaint = true;              // flat on the ground: never an occluder
      parent.add(m);
      out.push(m);
    }
    whites.length = yellows.length = bars.length = 0;
    return out;
  }

  return { roadway, crosswalk, stopBar, junction, flush, get pending() { return whites.length + yellows.length + bars.length; }, D, y };
}

/**
 * The far edge of the paved width, matching makeRoadway's outermost lane
 * boundary. Districts need this to place kerbs, crossings and lamps against
 * the tarmac rather than guessing.
 *
 * makeRoadway puts lane i's CENTRELINE at median/2 + (i + 0.5) * laneWidth, so
 * the far edge of the outermost lane is a further half-lane out. Getting this
 * wrong by a lane width is invisible on a straight road and obvious at a
 * junction, which is why it is exported rather than inlined.
 */
export function roadwayHalf({ lanes = 1, median = null, laneWidth = 2.4 } = {}) {
  const n = Math.max(1, lanes);
  const m = median != null ? median : n > 1 ? 1.2 : 0;
  return m / 2 + n * laneWidth;
}
