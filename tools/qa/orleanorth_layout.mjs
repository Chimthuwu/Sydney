// orleanorth_layout.mjs — compute Orleanorth's site rects around its REAL neighbours.
//
//   node --experimental-detect-module tools/qa/orleanorth_layout.mjs [--write]
//
// Orleanorth (orleanorth.js) fills the 264 m band between OrleaRouge's north
// edge and the Crown Strip's south edge. It cannot simply own the whole band,
// because CHATBORO is already there: a live 144 x 220 m village at
// x -96..48, z -120..100, with US-167 (x -6) and Chatboro Main (x -44) running
// through it.
//
// The first version of this district laid its rects across the full band and put
// ten of them — including the motel, the lot and Memorial Green — on top of
// Chatboro. Both of the district's own tests passed while that was true, because
// orleanorth_test.mjs only compares Orleanorth's sites against EACH OTHER, and
// orleanorth_build.mjs instantiates Orleanorth alone. Neither can see a
// neighbour. Hence this file: allocation with the neighbours as input, and an
// assertion that no rect may touch one.
//
// Every rect is placed in the gaps between ROADS and NEIGHBOUR RECTS, then
// checked. Exit 1 if any collision survives, so it can gate the build.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "../..");

// ---- the neighbours, as fixed furniture ----------------------------------
// Chatboro's own numbers, from chatboro.js. Do not hand-copy: read them, so a
// change to Chatboro's rect shows up here as a failure rather than as buildings
// on top of a village.
const chat = readFileSync(join(root, "src/chatboro.js"), "utf8");
const grab = (name) => {
  const m = chat.match(new RegExp(`const ${name} = \\{ x0: (-?\\d+), x1: (-?\\d+), z0: (-?\\d+), z1: (-?\\d+) \\}`));
  if (!m) throw new Error(`chatboro.js: could not read ${name}`);
  const [x0, x1, z0, z1] = m.slice(1).map(Number);
  return { x0, x1, z0, z1 };
};
const CHATBORO = grab("BOUNDS");
const CHAT_CORE = grab("CORE");
const num = (name) => {
  const m = chat.match(new RegExp(`const ${name} = (-?[\\d.]+)`));
  if (!m) throw new Error(`chatboro.js: could not read ${name}`);
  return Number(m[1]);
};
const CHAT_MAIN_X = num("MAIN_X");
const CHAT_CHURCH_Z = num("CHURCH_Z");
const CHAT_PINE_Z = num("PINE_Z");

const ORLEA = { x0: -292, x1: 680, z0: 130, z1: 500 };      // orlearouge.js CITY
const CROWN = { x0: -240, x1: 240, z0: -440, z1: -134 };    // crownstrip.js
const BOUNDS = { x0: -248, x1: 122, z0: -140, z1: 134 };
const CORE = { x0: -244, x1: 118, z0: -136, z1: 130 };
const ROAD_X = -6;

// Chatboro's own street half-widths: Main 9 wide, Church/Pine 8 wide, plus 1.5
// sidewalk each side, matching how orlearouge lays them.
const chatLanes = [
  { n: "Chatboro Main", x0: CHAT_MAIN_X - 6, x1: CHAT_MAIN_X + 6, z0: -110, z1: 90 },
  { n: "Church St", x0: -96, x1: 48, z0: CHAT_CHURCH_Z - 5.5, z1: CHAT_CHURCH_Z + 5.5 },
  { n: "Pine St", x0: -96, x1: 48, z0: CHAT_PINE_Z - 5.5, z1: CHAT_PINE_Z + 5.5 },
];

// Orleanorth's own lanes. These are the ones it declares, with the widths
// composer reports (half the road width, plus the sidewalk).
const orlLanes = [
  { n: "US-167", x0: ROAD_X - 6.6, x1: ROAD_X + 6.6, z0: -140, z1: 134 },
  { n: "Millrace", x0: -198.5, x1: -187.5, z0: -138, z1: 120 },
  { n: "Foundry", x0: -144.5, x1: -133.5, z0: -138, z1: 120 },
  { n: "Tannery", x0: -63.5, x1: -52.5, z0: -138, z1: 130 },
  { n: "Bayou", x0: 8.5, x1: 19.5, z0: -138, z1: 130 },
  { n: "Carondelet", x0: 106.5, x1: 117.5, z0: -138, z1: 128 },
];

// A 2 m collar so a block never abuts a carriageway.
const COLLAR = 2;
const GAP = 4;

const hits = (a, b) => !(a.x1 + GAP <= b.x0 || a.x0 - GAP >= b.x1 || a.z1 + GAP <= b.z0 || a.z0 - GAP >= b.z1);
const hitsTight = (a, b) => !(a.x1 <= b.x0 || a.x0 >= b.x1 || a.z1 <= b.z0 || a.z0 >= b.z1);

const NEIGHBOURS = [
  { n: "Chatboro", r: CHATBORO },
  { n: "OrleaRouge", r: ORLEA },
  { n: "CrownStrip", r: CROWN },
  { n: "Chatboro Main", r: chatLanes[0] },
  { n: "Church St", r: chatLanes[1] },
  { n: "Pine St", r: chatLanes[2] },
  ...orlLanes.map((l) => ({ n: l.n, r: l })),
];

// ---- allocate ------------------------------------------------------------
// Walk the band in columns, and in each column take the z runs that clear every
// neighbour and lane, then chop those runs into blocks of a target height.
// Block size. Wide enough for a warehouse or a container yard, shallow enough to
// tile the odd gaps the lanes leave behind.
const COL_W = 34;
const ROWS = 56;

function freeRuns(x0, x1) {
  // z intervals inside the band where a rect at this x would clear everything
  const blocked = NEIGHBOURS.filter((nb) => !(x1 <= nb.r.x0 || x0 >= nb.r.x1))
    .map((nb) => [nb.r.z0, nb.r.z1, nb.n]);
  let runs = [[CORE.z0, CORE.z1]];
  for (const [bz0, bz1] of blocked) {
    const next = [];
    for (const [a, b] of runs) {
      if (bz1 <= a || bz0 >= b) { next.push([a, b]); continue; }
      if (bz0 - a > COLLAR) next.push([a, bz0 - COLLAR]);
      if (b - bz1 > COLLAR) next.push([bz1 + COLLAR, b]);
    }
    runs = next;
  }
  return runs;
}

// Greedy pack. Sweep x across the band, and at each position take the z runs that
// are actually free, placing a block wherever it clears every lane, every
// neighbour and every block already placed. This adapts to the gap widths the
// lanes leave, which a fixed column pitch cannot: an 11 m lane plus a 34 m block
// plus a 4 m gap needs 49 m of pitch, and the west side only offers 45 m gaps —
// so a fixed pitch reported most columns FULLY BLOCKED and cost the district two
// thirds of its fabric.
const allocated = [];
for (let x0 = CORE.x0; x0 + COL_W <= CORE.x1; x0 += COL_W + GAP) {
  const x1 = x0 + COL_W;
  for (const [z0, z1] of freeRuns(x0, x1)) {
    for (let a = z0; a + 28 <= z1; a += ROWS) {
      const b = Math.min(a + ROWS, z1);
      if (b - a < 28) continue;
      const cand = { x0, z0: a, x1, z1: b };
      if (allocated.some((q) => hitsTight(cand, q))) continue;
      allocated.push(cand);
      a = b;                       // this run is consumed up to here
    }
  }
}

// ---- the park, placed in the widest gap on the west side -----------------
// The park is the one green, so it goes where the city can least spare it: the
// widest free run west of the highway, sized generously.
// The park is the one green in the district, so it wants a real square rather
// than the leftover sliver at the end of a column: score candidates by how close
// they are to 46 x 46 m and take the best, west of the highway so it sits in the
// middle of the residential fabric rather than out by the industrial edge.
const PARK_W = 44, PARK_H = 44;
let park = null;
{
  let best = null;
  for (let x0 = CORE.x0; x0 + PARK_W <= ROAD_X - 10; x0 += 2) {
    for (const [z0, z1] of freeRuns(x0, x0 + PARK_W)) {
      for (let a = z0; a + PARK_H <= z1; a += 2) {
        // Prefer the run that centres the park best, so it is not jammed
        // against a carriageway at one end.
        const mid = a + PARK_H / 2, runMid = (z0 + z1) / 2;
        const score = -Math.abs(mid - runMid);
        if (!best || score > best.score) best = { x0, z0: a, x1: x0 + PARK_W, z1: a + PARK_H, score };
      }
    }
  }
  if (!best) throw new Error("no room for the park west of the highway");
  park = { x0: best.x0, z0: best.z0, x1: best.x1, z1: best.z1 };
}

// Clear the park out of whatever was allocated there.
const kept = allocated.filter((b) => !(hitsTight(b, park)));
// and reclaim the space for the park itself
allocated.length = 0;
allocated.push(...kept);

// Split the allocation into industrial (west of the highway) and east fabric.
const industrial = allocated.filter((b) => b.x1 <= ROAD_X - 8);
const east = allocated.filter((b) => b.x0 >= ROAD_X + 8);

// ---- verify --------------------------------------------------------------
const named = [
  ...industrial.map((b, i) => [`industrial ${i}`, b]),
  ...east.map((b, i) => [`east fabric ${i}`, b]),
  ["Memorial Green", park],
];
let bad = 0;
const all = named.map((n) => n[1]);
for (let i = 0; i < all.length; i++)
  for (let j = i + 1; j < all.length; j++)
    if (hitsTight(all[i], all[j])) {
      console.log(`  FAIL ${named[i][0]} overlaps ${named[j][0]}`);
      bad++;
    }
for (const [n, b] of named)
  for (const nb of NEIGHBOURS)
    if (hitsTight(b, nb.r)) {
      console.log(`  FAIL ${n} ${JSON.stringify(b)} overlaps ${nb.n} ${JSON.stringify(nb.r)}`);
      bad++;
    }
for (const [n, b] of named)
  for (const [k, ob] of [["OrleaRouge", ORLEA], ["CrownStrip", CROWN], ["Chatboro", CHATBORO]])
    if (hitsTight(b, ob)) { console.log(`  FAIL ${n} sits inside ${k}`); bad++; }

console.log("=== Chatboro, as read from chatboro.js ===");
console.log(`  BOUNDS x ${CHATBORO.x0}..${CHATBORO.x1}, z ${CHATBORO.z0}..${CHATBORO.z1}`);
console.log(`  CORE   x ${CHAT_CORE.x0}..${CHAT_CORE.x1}, z ${CHAT_CORE.z0}..${CHAT_CORE.z1}`);
console.log(`  Main x ${CHAT_MAIN_X}, Church z ${CHAT_CHURCH_Z}, Pine z ${CHAT_PINE_Z}`);
console.log(`  band x ${BOUNDS.x0}..${BOUNDS.x1}, z ${BOUNDS.z0}..${BOUNDS.z1}`);

console.log(`\n=== allocation ===`);
console.log(`  park: x ${park.x0}..${park.x1}, z ${park.z0}..${park.z1}  (${(park.x1 - park.x0)} x ${(park.z1 - park.z0)} m)`);
console.log(`  ${industrial.length} industrial blocks west of US-167`);
console.log(`  ${east.length} east fabric blocks east of US-167`);
console.log(`  ${named.length} sites total`);

console.log("\n=== free ground per column (z runs that clear every neighbour) ===");
for (let x0 = CORE.x0; x0 + COL_W <= CORE.x1; x0 += COL_W + GAP) {
  const runs = freeRuns(x0, x0 + COL_W);
  console.log(`  x ${String(x0).padStart(5)}..${String(x0 + COL_W).padEnd(5)}  ` +
    (runs.length ? runs.map(([a, b]) => `z ${a}..${b}`).join("   ") : "FULLY BLOCKED"));
}

console.log(`\n${bad ? bad + " COLLISIONS" : "no rect overlaps another, a lane, or a neighbour"}`);

if (process.argv.includes("--write") && !bad) {
  const fmt = (r) => `R(${r.x0}, ${r.z0}, ${r.x1}, ${r.z1})`;
  const lines = [];
  lines.push("  // ALLOCATED by tools/qa/orleanorth_layout.mjs -- do not hand-edit.");
  lines.push("  // Chatboro is a live village inside this band (x -96..48, z -120..100, read");
  lines.push("  // from chatboro.js) and keeps all of its ground, including US-167 and");
  lines.push("  // Chatboro Main running through it. The first version of this district");
  lines.push("  // ignored that and put ten rects, the motel and the park on top of it.");
  lines.push(`  const PARK = { x0: ${park.x0}, x1: ${park.x1}, z0: ${park.z0}, z1: ${park.z1} };`);
  lines.push("  const INDUSTRIAL = [");
  for (const b of industrial) lines.push(`    ${fmt(b)},`);
  lines.push("  ];");
  lines.push("  const EAST = [");
  for (const b of east) lines.push(`    ${fmt(b)},`);
  lines.push("  ];");
  writeFileSync(join(here, "orleanorth_layout.txt"), lines.join("\n") + "\n", "utf8");
  console.log(`\nwrote tools/qa/orleanorth_layout.txt (${lines.length} lines)`);
}

process.exit(bad ? 1 : 0);