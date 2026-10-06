// chatboro_crownstrip_gap.mjs — measure the dead ground between two districts.
//
//   node --experimental-detect-module tools/qa/chatboro_crownstrip_gap.mjs
//
// A human report (2026-10-01): "Between chatboro and the crown strip we have a
// bunch of empty space and a lot of trees which unfortunately completely takes
// away from the central inner city vibe completely."
//
// The complaint has three testable parts, and they are not the same thing:
//
//   1. EMPTY -- is there a hole in the built fabric, and how big?
//   2. TREES  -- is that hole classified as forest, and who is planting it?
//   3. VIBE   -- does the gap break the "inner city" continuity, i.e. does a
//                player driving between the two hit open sky?
//
// What makes this worth measuring rather than eyeballing: CrownStrip's WILD zone
// is { x0:-235, x1:235, z0:-435, z1:-135 } and composer's rule is that anything
// inside WILD and outside CORE is forest. Chatboro's BOUNDS are
// { x0:-96, x1:48, z0:-120, z1:100 }. Those two rects do not share an edge, so
// the strip between them belongs to NEITHER district -- and in this codebase an
// unowned strip is exactly what composer's wild-fill turns into trees.
//
// READ-ONLY. It reports; the threshold for "enough" is the human's call.
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const here = dirname(fileURLToPath(import.meta.url));
const src = join(here, "../../src");

function rects(file, names) {
  const text = readFileSync(join(src, file), "utf8");
  const out = {};
  for (const n of names) {
    const m = text.match(new RegExp(`const ${n} = \\{([^}]*)\\}`));
    if (!m) continue;
    const g = {};
    for (const [, k, v] of m[1].matchAll(/([A-Za-z0-9_]+)\s*:\s*(-?[\d.]+)/g)) g[k] = Number(v);
    out[n] = g;
  }
  return out;
}

const CS = rects("crownstrip.js", ["BOUNDS", "CORE", "WILD"]);
const CB = rects("chatboro.js", ["BOUNDS", "CORE"]);

console.log("=== the two districts ===");
for (const [k, v] of Object.entries(CS)) console.log(`  CrownStrip.${k.padEnd(6)} x[${v.x0}, ${v.x1}]  z[${v.z0}, ${v.z1}]`);
for (const [k, v] of Object.entries(CB)) console.log(`  Chatboro.${k.padEnd(7)} x[${v.x0}, ${v.x1}]  z[${v.z0}, ${v.z1}]`);

// ---- 1. the gap ----------------------------------------------------------
// CrownStrip's north edge is z1 = -135. Chatboro's south edge is z0 = -120.
const gapZ = CB.BOUNDS.z0 - CS.BOUNDS.z1;
console.log(`\n=== 1. the gap between them ===`);
console.log(`  CrownStrip ends at z ${CS.BOUNDS.z1}, Chatboro starts at z ${CB.BOUNDS.z0}`);
console.log(`  north-south gap: ${gapZ} m`);

// but the x extents differ wildly, so the empty ground is not a strip -- it is
// two wedges, and the west one is enormous.
const overlapX0 = Math.max(CS.BOUNDS.x0, CB.BOUNDS.x0);
const overlapX1 = Math.min(CS.BOUNDS.x1, CB.BOUNDS.x1);
console.log(`\n  x overlap: ${overlapX0} .. ${overlapX1}  (${overlapX1 - overlapX0} m wide)`);
console.log(`  CrownStrip is ${CS.BOUNDS.x1 - CS.BOUNDS.x0} m wide; Chatboro is only ${CB.BOUNDS.x1 - CB.BOUNDS.x0} m wide.`);
const westWedge = overlapX0 - CS.BOUNDS.x0;
const eastWedge = CS.BOUNDS.x1 - overlapX1;
console.log(`\n  so the unowned ground in that z band is:`);
console.log(`    WEST wedge: x ${CS.BOUNDS.x0} .. ${overlapX0}   ${westWedge} m wide`);
console.log(`    EAST wedge: x ${overlapX1} .. ${CS.BOUNDS.x1}   ${eastWedge} m wide`);
const bandArea = (westWedge + eastWedge) * Math.abs(gapZ);
console.log(`    combined area: ${Math.round(bandArea).toLocaleString()} m2 of nothing`);

// ---- 2. who plants the trees --------------------------------------------
// composer's own rule for what becomes forest.
const comp = readFileSync(join(src, "composer.js"), "utf8");
const wildLine = comp.split("\n").find((l) => /zones\.wild/.test(l) && /return/.test(l));
console.log(`\n=== 2. who turns unowned ground into forest ===`);
console.log(`  composer.js: ${(wildLine || "?").trim()}`);
console.log(`  => any ground inside a district's WILD but outside its CORE is forest by construction.`);
// and the spawn_emptiness zone classifier said "forest" across this exact row
console.log(`  CrownStrip.WILD z range is [${CS.WILD.z0}, ${CS.WILD.z1}] and its CORE stops at z ${CS.CORE.z1}.`);
console.log(`  So CrownStrip's own northern margin, z ${CS.CORE.z1} .. ${CS.WILD.z1}, is`);
console.log(`  ${Math.round((CS.WILD.z1 - CS.CORE.z1) * (CS.WILD.x1 - CS.WILD.x0)).toLocaleString()} m2 of deliberately planted forest`);

// ---- 3. does it break the drive? ----------------------------------------
// A player going between the two passes along US-167 at x = -6.
const DRIVE_X = -6;
console.log(`\n=== 3. the drive between them, along US-167 at x ${DRIVE_X} ===`);
const inCS = DRIVE_X >= CS.BOUNDS.x0 && DRIVE_X <= CS.BOUNDS.x1;
const inCB = DRIVE_X >= CB.BOUNDS.x0 && DRIVE_X <= CB.BOUNDS.x1;
console.log(`  x ${DRIVE_X} is inside CrownStrip's x span: ${inCS}`);
console.log(`  x ${DRIVE_X} is inside Chatboro's x span:  ${inCB}`);
// how far from the drive line is built stuff, in the gap?
console.log(`\n  in the ${Math.abs(gapZ)} m gap band, the nearest CORE edge on each side:`);
console.log(`    CrownStrip CORE north edge: z ${CS.CORE.z1}  (${Math.abs(CS.CORE.z1 - CB.CORE.z0)} m from Chatboro's core)`);
console.log(`    Chatboro CORE south edge:  z ${CB.CORE.z0}`);
console.log(`  Chatboro's CORE does not begin until z ${CB.CORE.z0}, and its WILD begins at z ${CB.BOUNDS.z0},`);
console.log(`  so between CrownStrip's wild edge (z ${CS.WILD.z1}) and Chatboro's core (z ${CB.CORE.z0}) there is`);
console.log(`  ${Math.round((CB.CORE.z0 - CS.WILD.z1) * (CB.BOUNDS.x1 - CB.BOUNDS.x0)).toLocaleString()} m2`);
console.log(`  of ground that is either forest or bare, with nothing built on it.`);

console.log(`
=== summary ===
  CrownStrip and Chatboro are ${Math.abs(gapZ)} m apart, but they are not the same size:
  CrownStrip is ${CS.BOUNDS.x1 - CS.BOUNDS.x0} m across, Chatboro ${CB.BOUNDS.x1 - CB.BOUNDS.x0} m.
  The result is a ${Math.round(bandArea).toLocaleString()} m2 unowned band with two large
  wedges either side, and composer's WILD rule fills exactly that kind of
  unowned ground with forest. The trees are not a bug in the tree code -- they
  are the fill for a hole in the district map, and the "inner city" reads as
  broken because the eye falls into it on the drive between the two.
`);
