// Metro's grid, widened (metro.js).
//
//   node --experimental-detect-module tools/qa/metro_lanes_test.mjs
//
// The point of this is the CONSTRAINT, not the feature. Four lanes each way was
// only possible without moving a building because the blocks either side of
// every street sit a uniform 7 m back from the centreline. If that gap is ever
// eaten — by a wider carriageway, a kerb, a lamp column — the grid either clips
// a building or the lanes run over the pavement, and both look like "the city
// is broken" rather than "a constant is wrong".
//
// So these assert the clearance directly, from the same ROWS/COLS the builder
// uses, and that the paved width lands inside the tarmac that already existed.

import { makeRoadway, LANE_WIDTH } from "../../src/traffic.js";
import { readFileSync } from "node:fs";

// metro.js does not export its layout, and importing it would pull in three.js,
// the composer and a canvas. The constants are read out of the source instead,
// so this test fails when the file changes rather than when a copy of it does.
const src = readFileSync(new URL("../../src/metro.js", import.meta.url), "utf8");
// Grab the whole declaration line. A `[^\]]+` character class stops at the FIRST
// closing bracket, which for `ROWS = [[-101, -59], ...]` is the end of the first
// pair — so the parse silently returned one row instead of four and every
// downstream index was undefined.
const decl = (name) => {
  const m = src.match(new RegExp(`^const ${name} = .*$`, "m"));
  if (!m) throw new Error(`metro.js: no constant ${name}`);
  return m[0];
};
const num = (name) => {
  const body = decl(name).replace(/^const \w+ = /, "").replace(/;$/, "");
  // strip the enclosing brackets before splitting, or every element but the
  // middle parses as NaN and gets filtered out
  return body.slice(1, -1).split(",").map((s) => Number(s.trim())).filter((n) => !Number.isNaN(n));
};
const pairs = (name) => {
  const body = decl(name).replace(/^const \w+ = /, "").replace(/;$/, "");
  const inner = body.slice(1, -1);                       // drop the outer [ ]
  // split on the pair boundary, not on every comma: each element is itself [a, b]
  return inner.split(/\]\s*,\s*\[/).map((pair) => pair.replace(/[\[\]]/g, "").split(",").map((s) => Number(s.trim())));
};
const scalar = (name) => {
  // STREET_W and AVENUE_W are declared together on one line
  // (`const STREET_W = 10, AVENUE_W = 12;`), so the value is not immediately
  // after the `=`.
  const m = src.match(new RegExp(`\\b${name}\\s*=\\s*([\\d.]+)`));
  if (!m) throw new Error(`metro.js: no scalar constant ${name}`);
  return Number(m[1]);
};

const STREET_W = scalar("STREET_W");
const AVENUE_W = scalar("AVENUE_W");
const STREETS_Z = num("STREETS_Z");
const AVENUES_X = num("AVENUES_X");
const ROWS = pairs("ROWS");
const COLS = pairs("COLS");

let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : " FAIL " } ${label}${detail ? `  — ${detail}` : ""}`);
};

// ---------------------------------------------------------------- the gap
// The invariant the whole widening rests on.
//
// Measured geometrically — each street against the NEAREST edge of ANY row —
// rather than by pairing STREETS_Z[i] with ROWS[i]. That indexing was only
// ever right while every block sat between two streets. Metro now has an
// outboard strip north of the first street and south of the last (the grid has
// to reach METRO_BOUNDS or the city stops short of its own edge), and the
// pairing quietly read those strips as the wrong block's neighbour: it
// reported a clearance of -49 m for a grid where every street was 7 m from
// everything, which is the worst kind of test failure — a red line with no
// defect behind it.
{
  const gaps = STREETS_Z.map((z) => {
    let best = Infinity;
    for (const [r0, r1] of ROWS) best = Math.min(best, Math.abs(z - r0), Math.abs(z - r1));
    return best;
  });
  const min = Math.min(...gaps);
  check("every street keeps 7 m to the nearest block", min === 7, `min clearance ${min} m`);
}
// A row is a band BETWEEN two streets, or an outboard strip beyond the first
// and last. Either way no block may straddle a carriageway: that is what would
// put a building in the road, and it is the failure a pure clearance check
// cannot see.
{
  const straddling = ROWS.filter(([r0, r1]) => STREETS_Z.some((z) => z > r0 && z < r1));
  check("no block straddles a street", straddling.length === 0, straddling.map(([r0, r1]) => `z${r0}..${r1}`).join(" "));
}
{
  const gaps = AVENUES_X.map((x) => {
    let w = Infinity, e = Infinity;
    COLS.forEach(([x0, x1]) => { if (x1 <= x) w = Math.min(w, x - x1); if (x0 >= x) e = Math.min(e, x0 - x); });
    return Math.min(w, e);
  });
  check("every avenue keeps 7 m to the nearest block", gaps.every((g) => g === 7), gaps.join(", "));
}

// ---------------------------------------------------------------- the tarmac
// Paved width must land inside the road that was ALREADY there. If it does not,
// either the outer lane is on the pavement or the tarmac grew into a block.
const roadOf = (name) => {
  const line = decl(name);
  if (!line.includes("{")) throw new Error(`metro.js: ${name} is not a roadway constant`);
  const num2 = (k) => {
    const m = line.match(new RegExp(`\\b${k}: ([\\d.]+)`));
    if (!m) throw new Error(`metro.js: ${name} has no ${k}`);
    return Number(m[1]);
  };
  const cm = line.match(/cruise: \[([\d.]+), ([\d.]+)\]/);
  if (!cm) throw new Error(`metro.js: ${name} has no cruise range`);
  return { lanes: num2("lanes"), median: num2("median"), laneWidth: num2("laneWidth"), cruise: [Number(cm[1]), Number(cm[2])] };
};
// The composer's sidewalk width, read rather than assumed — the avenue's was
// reduced because 1.6 + half the width overlapped the block behind it.
const sidewalkFor = (name) => {
  const m = src.match(new RegExp(`width: ${name}[^\\n]*sidewalk: ([\\d.]+)`));
  return m ? Number(m[1]) : 1.6;                     // composer's default
};
for (const [name, allot] of [["STREET_ROAD", STREET_W], ["AVENUE_ROAD", AVENUE_W]]) {
  const r = roadOf(name);
  const paved = (r.median / 2 + r.lanes * r.laneWidth) * 2;
  check(`${name}: ${r.lanes} lanes each way fit the existing ${allot} m of tarmac`, paved <= allot,
    `paved ${paved.toFixed(1)} m vs ${allot} m allotted`);
  // the composer's claim is width/2 + sidewalk, and it must stay inside the 7 m
  const claim = allot / 2 + sidewalkFor(allot === STREET_W ? "STREET_W" : "AVENUE_W");
  check(`${name}: the road corridor does not reach a block`, claim <= 7,
    `claims ${claim.toFixed(1)} m of the 7 m gap`);
}

// ---------------------------------------------------------------- the lanes
// makeLane is where the roadway becomes driveable: every point must be finite,
// on the carriageway, and inside the map.
{
  const r = roadOf("STREET_ROAD");
  const built = makeRoadway({ ...r, name: "s", points: [[62, -108], [274, -108]] });
  check("a metro street makes four lanes", built.length === 4, `${built.length} lanes`);
  check("every metro lane has real cruise speeds", built.every((l) => l.cruise && l.cruise[0] < l.cruise[1]));
  // chained into a circuit, so a car never runs out of road
  check("the lanes chain into a circuit", built.every((l) => l.next && built.find((o) => o.name === l.next)));
  // both directions present
  check("two lanes each way", new Set(built.map((l) => l.dir)).size === 2);
  // and the inner lane is the fast one, which is what makes an overtake possible
  const inner = built.find((l) => l.dir === 1 && l.index === 0);
  const outer = built.find((l) => l.dir === 1 && l.index === 1);
  check("the median-side lane is the passing lane", inner.offset < outer.offset,
    `inner ${inner.offset} vs outer ${outer.offset}`);
  // no lane may sit on the opposite carriageway
  check("no lane crosses the median", built.every((l) => l.offset > 0));
}

// ---------------------------------------------------------------- not the old roads
// The single-lane definitions must be GONE. Leaving them in would put a second
// set of cars on the same tarmac — the exact bug that had two sets of traffic
// driving through the Crown Strip.
check("metro uses makeRoadway", /makeRoadway/.test(src));
check("no hand-placed metro lanes are left", !/points: \[\[\s*-?\d+\.?\d*\s*,\s*z\s*[+-]/.test(src),
  "an old-style hand-placed lane is still in metro.js");

if (failures) { console.error(`metro_lanes_test: ${failures} failure(s)`); process.exit(1); }
console.log("metro_lanes_test: all checks passed");
