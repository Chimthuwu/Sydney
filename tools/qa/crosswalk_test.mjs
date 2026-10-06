// ---------------------------------------------------------------------------
// crosswalk_test.mjs — is the road paint actually clean?
//
//   node --experimental-detect-module tools/qa/crosswalk_test.mjs
//
// A human report with a close-up screenshot: "pedestrian crossings look like
// shit, look really lazily painted". The screenshot shows a zebra whose
// stripes are ragged, irregular, and shot through with chevron shapes where
// they should be straight-edged parallel bars.
//
// None of that is the crosswalk BUILDER — that code writes a uniform pitch and
// a uniform stripe width, and the quad builder is correct. The paint was fine
// and there were two lots of it.
//
// `US167_JUNCTIONS` is "every z where a district road meets the boulevard", and
// two districts' roads turned out to be 14 m apart. One junction's paint
// envelope is 24.3 m, so those two junctions drew their crossings AND their
// stop bars on top of each other — coplanar, at exactly the same Y. Two
// surfaces at identical depth are not an ugly overlap, they are a depth fight:
// the GPU shreds both into a speckled, half-eaten mess, and where one quad
// wins part of the other's edge you get exactly the chevrons in the shot.
//
// So the check is on the GEOMETRY, not on the input list: no two painted quads
// may overlap in plan at the same height. That catches the defect wherever it
// comes from, rather than asserting one hardcoded list stays tidy.
// ---------------------------------------------------------------------------

import * as THREE from "three";
import { createMarkings, spaceJunctions, junctionEnvelope, MARKING_DEFAULTS } from "../../src/markings.js";

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? `  — ${detail}` : ""}`);
};

const ROAD_X = -6, ROAD_HALF = 5, GROUND_HWY = 0.02;
const US167 = { lanes: 2, median: 0.4, laneWidth: 2.4 };
// the real list, copied from main.js so this test fails if the fix is reverted
const US167_JUNCTIONS = [207, 247, 287, 327, 367, -52, 4, 60, 112, -78, -10];

/** Build a junction set and return every painted quad, in world plan. */
function quadsFor(zs) {
  const scene = new THREE.Scene();
  const M = createMarkings({ y: GROUND_HWY + 0.011 });
  M.roadway({ ...US167, points: [[ROAD_X, 900], [ROAD_X, -900]], y: GROUND_HWY });
  for (const z of zs) M.junction(ROAD_X, z, { alongX: false, half: ROAD_HALF });
  const out = [];
  for (const m of M.flush(scene)) {
    const a = m.geometry.attributes.position.array;
    for (let i = 0; i < a.length / 12; i++) {
      const o = i * 12, xs = [], zs2 = [];
      let y = 0;
      for (let k = 0; k < 4; k++) { xs.push(a[o + k * 3]); zs2.push(a[o + k * 3 + 2]); y = a[o + k * 3 + 1]; }
      out.push({
        minx: Math.min(...xs), maxx: Math.max(...xs),
        minz: Math.min(...zs2), maxz: Math.max(...zs2), y,
      });
    }
  }
  return out;
}

/** Pairs of quads that overlap in plan AND sit at the same height. */
function coplanarOverlaps(quads) {
  let n = 0, worst = 0;
  for (let a = 0; a < quads.length; a++) {
    for (let b = a + 1; b < quads.length; b++) {
      const p = quads[a], q = quads[b];
      if (Math.abs(p.y - q.y) > 1e-6) continue;
      const ox = Math.min(p.maxx, q.maxx) - Math.max(p.minx, q.minx);
      const oz = Math.min(p.maxz, q.maxz) - Math.max(p.minz, q.minz);
      if (ox > 0.01 && oz > 0.01) { n++; worst = Math.max(worst, ox * oz); }
    }
  }
  return { n, worst };
}

// ---------------------------------------------------------------- the defect
{
  const before = quadsFor(US167_JUNCTIONS);
  const b = coplanarOverlaps(before);
  // With the stop-bar fix in place the only remaining source is two junctions
  // too close together, so this is a much smaller number than it was: 21, not
  // the 175 that included every bar painted across its own zebra.
  check("the raw junction list DOES produce fighting paint (the bug is real)",
    b.n > 0, `${b.n} coplanar overlapping quads, worst ${b.worst.toFixed(2)} m²`);
}

// ---------------------------------------------------------------- the fix
{
  const { kept, dropped } = spaceJunctions(US167_JUNCTIONS, ROAD_HALF);
  const need = (junctionEnvelope(ROAD_HALF) * 2).toFixed(1);
  check("the crowded junctions are identified, not silently ignored",
    dropped.length > 0, `dropped z=${dropped.join(", ")} — they need ${need} m between them`);
  check("spacing keeps the junctions that fit", kept.length > 0 && kept.length < US167_JUNCTIONS.length,
    `${kept.length} kept of ${US167_JUNCTIONS.length}`);

  const after = quadsFor(kept);
  const a = coplanarOverlaps(after);
  check("no two painted quads overlap in plan at the same height", a.n === 0,
    a.n ? `${a.n} coplanar overlaps remain, worst ${a.worst.toFixed(2)} m²` : "clean");
}

// ---------------------------------------------------------------- the rule
{
  const env = junctionEnvelope(ROAD_HALF);
  check("the envelope is the real reach of a junction's paint, not a guess",
    env > 10 && env < 16, `${env.toFixed(1)} m from the centre each way`);

  // The rule has to hold for any list, not just this one — a future district
  // adding a road at an awkward distance is the same bug with a new number.
  let worstGap = Infinity;
  for (let i = 0; i < 400; i++) {
    const zs = [];
    for (let k = 0; k < 9; k++) zs.push(Math.round((Math.random() - 0.5) * 2000));
    const { kept } = spaceJunctions(zs, ROAD_HALF);
    const s = [...kept].sort((x, y) => x - y);
    for (let j = 1; j < s.length; j++) worstGap = Math.min(worstGap, s[j] - s[j - 1]);
  }
  check("no random list of junctions can produce a too-close pair",
    worstGap >= env * 2 - 1e-9, `tightest surviving gap ${worstGap.toFixed(1)} m vs required ${(env * 2).toFixed(1)} m`);

  // and it must never drop something that would have fitted
  const spread = [0, 100, 200, 300];
  const s2 = spaceJunctions(spread, ROAD_HALF);
  check("well-spaced junctions are all kept", s2.dropped.length === 0 && s2.kept.length === 4,
    `dropped ${s2.dropped.length}`);

  // determinism: the same input must give the same output, or the paint
  // changes between frames
  const a1 = spaceJunctions(US167_JUNCTIONS, ROAD_HALF).kept.join(",");
  const a2 = spaceJunctions(US167_JUNCTIONS, ROAD_HALF).kept.join(",");
  check("spacing is deterministic", a1 === a2);

  // the defaults the envelope is derived from are the ones in use
  check("the envelope is computed from the shipped defaults",
    Math.abs(junctionEnvelope(ROAD_HALF) - junctionEnvelope(ROAD_HALF, MARKING_DEFAULTS)) < 1e-9);
}

console.log(failures ? `\n${failures} FAILURE(S)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
