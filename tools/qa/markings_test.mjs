// markings_test.mjs — the paint has to agree with the traffic.
//
// The failure this guards against is specific and has already happened once:
// US-167 was four lanes with a single dashed line down the middle of the
// carriageway, and nobody could see the lanes because nothing on the road said
// they existed. A marking system that silently stops painting, or that paints
// somewhere other than where the cars are, reproduces exactly that — silently.
//
// So these assert the GEOMETRY, not that "something was created": a dash's
// offset is compared against makeRoadway's own lane offset, and they have to be
// the same number.

import * as THREE from "three";
import { createMarkings, roadwayHalf, MARKING_DEFAULTS } from "../../src/markings.js";
import { makeRoadway } from "../../src/traffic.js";

const sb = { THREE };

let fails = 0;
const ok = (cond, msg) => { if (!cond) { console.error("  FAIL: " + msg); fails++; } };

// ---------------------------------------------------------------- geometry
{
  const parent = new sb.THREE.Group();
  const M = createMarkings({ y: 0.03 });
  const road = { points: [[0, 0], [0, 400]], lanes: 2, median: 0.4, laneWidth: 2.4 };
  M.roadway(road);
  M.flush(parent);
  ok(parent.children.length === 2, `expected white + yellow meshes, got ${parent.children.length}`);

  // A quad is 4 corners x 3 floats = 12 floats, NOT 6 x 3: the geometry writes
  // four corners and indexes six of them, so the stride is 12 and reading it as
  // 18 walks off the end of the buffer into whatever is allocated next.
  const readQuads = (mesh) => {
    const p = mesh.geometry.attributes.position.array;
    const out = [];
    for (let i = 0; i + 11 < p.length; i += 12) {
      const xs = [p[i], p[i + 3], p[i + 6], p[i + 9]];
      const zs = [p[i + 2], p[i + 5], p[i + 8], p[i + 11]];
      out.push({ x0: Math.min(...xs), x1: Math.max(...xs), z0: Math.min(...zs), z1: Math.max(...zs) });
    }
    return out;
  };
  const white = readQuads(parent.children[0]);
  const yellow = readQuads(parent.children[1]);
  ok(white.length > 100, `expected many white dashes, got ${white.length}`);
  // the median is SOLID, so it is one long quad per side per segment, not dashes
  ok(yellow.length >= 2, `expected two solid median lines, got ${yellow.length}`);
  for (const q of yellow) {
    // the road runs along z, so a median line must be long in z and thin in x
    ok(q.z1 - q.z0 > 100, `a median line should run the length of the road, got ${(q.z1 - q.z0).toFixed(1)} m long`);
    ok(q.x1 - q.x0 < 1, `a median line should be a line, not a stripe ${(q.x1 - q.x0).toFixed(1)} m wide`);
  }
  // ...and the white dashes must be long in z too. This is the assertion that
  // catches the double-rotation: swapping w/d AND passing ry: PI/2 lays every
  // dash ACROSS the carriageway, which still looks plausible in a vertex count
  // and is completely wrong on the ground.
  for (const q of white) {
    if (q.z1 - q.z0 > 1) { ok(q.z1 - q.z0 > q.x1 - q.x0, "a dash should be long along the road, not across it"); break; }
  }

  // every white line sits at a lane-boundary offset makeRoadway agrees with
  const lanes = makeRoadway({ name: "t", points: [[0, 0], [0, 400]], lanes: 2, median: 0.4, laneWidth: 2.4 });
  const boundary = [];
  for (const l of lanes) {
    boundary.push(Math.abs(l.offset));
    boundary.push(Math.abs(l.offset) + 2.4 / 2);          // the lane's far edge
    boundary.push(Math.abs(l.offset) - 2.4 / 2);
  }
  const seen = new Set();
  for (const q of white) seen.add(Math.abs((q.x0 + q.x1) / 2).toFixed(2));
  ok(seen.size >= 2, `expected lines on both sides of the road, got offsets ${[...seen].join(",")}`);
  for (const o of seen) {
    const v = Number(o);
    const near = boundary.some((b) => Math.abs(v - b) < 0.3);
    ok(near, `white line at |x|=${v} is not on any makeRoadway lane boundary (${boundary.map((b) => b.toFixed(2)).join(",")})`);
  }
  // the median yellows are INSIDE the median, between the two directions
  for (const q of yellow) {
    const cx = (q.x0 + q.x1) / 2;
    ok(Math.abs(cx) <= 0.4, `median paint at |x|=${Math.abs(cx).toFixed(2)} is outside the 0.4 m median`);
  }
  // dashes are dashed: real gaps, not a continuous stripe
  const zs = white.map((q) => q.z0).sort((a, b) => a - b);
  let gapFound = false;
  for (let i = 1; i < zs.length; i++) if (zs[i] - zs[i - 1] > MARKING_DEFAULTS.dashGap * 0.5) gapFound = true;
  ok(gapFound, "no gap found between dashes — they are not dashed");
}

// ---------------------------------------------------------------- one lane
{
  const parent = new sb.THREE.Group();
  const M = createMarkings({ y: 0.03 });
  M.roadway({ points: [[0, 0], [300, 0]], lanes: 1 });
  M.flush(parent);
  ok(parent.children.length === 2, "a one-lane road should still get white edges and a yellow centre");
}

// ---------------------------------------------------------------- junction
{
  const parent = new sb.THREE.Group();
  const M = createMarkings({ y: 0.03 });
  M.junction(0, 100, { alongX: false, half: 5 });
  M.flush(parent);
  // four crossings of 7 stripes, plus four stop bars of 2 quads each. Counted
  // per CORNER (4 per quad), not per index (6) — the geometry writes four and
  // indexes six, so dividing by 6 gives a third of the real answer.
  const total = parent.children.reduce((n, c) => n + c.geometry.attributes.position.count / 4, 0);
  ok(total >= 7 * 4, `junction should paint four crossings (28 stripes), got ${total}`);
  // everything belongs at the junction: nothing may be painted a block away.
  // The box is 20 m, not 12: a crossing sits half a carriageway back from the
  // kerb and its own stripes are 4.4 m wide, so a 5 m half-width puts the far
  // stripe at 10.6 m out.
  let beyond = 0;
  parent.children.forEach((c) => {
    const p = c.geometry.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) if (Math.abs(p[i]) > 20 || Math.abs(p[i + 2] - 100) > 20) beyond++;
  });
  ok(beyond === 0, `junction paint escaped its 20 m box (${beyond} verts outside)`);
}

// ---------------------------------------------------------------- half width
// This one is load-bearing twice over: US-167's four lanes were laid out to land
// the outer edge exactly on ROAD_HALF (5), so a lane width of error here would
// put a white edge line under the kerb.
{
  const half = roadwayHalf({ lanes: 2, median: 0.4, laneWidth: 2.4 });
  ok(Math.abs(half - 5) < 1e-9, `four lanes should span exactly 10 m, got ${half * 2}`);
  // one lane each way with no median: 2.4 m either side of the centre line
  ok(Math.abs(roadwayHalf({ lanes: 1, laneWidth: 2.4 }) - 2.4) < 1e-9, "one lane each way should be 2.4 m either side");
}

if (fails) { console.error(`markings_test: ${fails} failure(s)`); process.exit(1); }
console.log("markings_test: all checks passed");
