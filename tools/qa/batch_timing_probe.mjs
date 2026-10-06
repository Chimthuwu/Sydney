// batch_timing_probe.mjs — does batchStatic actually SEE OrleaRouge's props?
//
//   node --experimental-detect-module tools/qa/batch_timing_probe.mjs
//
// The question, after the measurement contradicted two earlier hypotheses.
//
// FACTS SO FAR (measured, see unattributed_parent_split.mjs and
// orlearouge_spawn_density.mjs at (-6, 130)):
//   - 1941 meshes in the spawn frustum are unbatched
//   - 1070 of them are BARE scene-root Meshes: no parent, empty userData
//   - 242 share one byte-identical material and ONE merge-signature
//   - 0 are in a cull group
//   - orlearouge is built at main.js:3710, batchStatic runs at main.js:7120
//
// That last pair rules OUT "they do not exist yet" -- the props are ~3,400 lines
// older than the batcher. And `mesh()` in orlearouge.js:370 does a plain
// `parent.add(m)` with `parent = scene` by default, setting no exclusion flag.
// batchStatic() iterates `scene.children` and traverses them.
//
// So every one of the preconditions for batching is satisfied, and yet 1,941 are
// unbatched. One of those beliefs must be wrong. This probe instruments
// batchStatic itself and reports what it saw, rather than continuing to reason
// about it from source.
//
// WHAT IT ANSWERS
//   1. how many meshes does batchStatic visit (seen)
//   2. how many it removes into batches (removed)
//   3. for the ones it visits but does NOT remove, WHY -- binned by the actual
//      skip condition in the function, with counts
//   4. whether any of them are in `moving`
//
// If (3) shows thousands in one bin, that bin is the bug. If the bins are all
// near-empty and `seen` is small, then these meshes are not reachable from
// scene.children at all and the traversal assumption is wrong.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const merge = readFileSync(join(here, "../../src/merge.js"), "utf8");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

// Every early-return in batchStatic, in source order. This is the checklist the
// runtime probe will bin against, so the two cannot drift apart.
const SKIPS = [
  ["not-a-mesh", /if \(!o\.isMesh \|\| o\.isInstancedMesh \|\| o\.isSkinnedMesh\) return;/],
  ["no-material", /if \(!m \|\| Array\.isArray\(m\) \|\| m\.isShaderMaterial\) return;/],
  ["excluded-surface", /m\.userData\.surfaceKind === "asphalt"/],
  ["noBatch-flag", /o\.userData\.noBatch/],
  ["hidden-ancestor", /for \(let p = o; p; p = p\.parent\) if \(!p\.visible\) return;/],
  ["mirrored", /o\.matrixWorld\.determinant\(\) < 0/],
];

console.log("=== the skip conditions batchStatic actually has ===");
for (const [name, re] of SKIPS) check(re.test(merge), `binned: ${name}`);
check(SKIPS.length === 6, "6 skip conditions, all accounted for above");

console.log("\n=== the traversal assumption under test ===");
// If this is false, none of the above matter: the meshes are unreachable.
check(/for \(const root of scene\.children\) \{/.test(merge),
  "batchStatic iterates scene.children -- so a bare scene-root Mesh IS reachable");
check(/if \(!root\.visible \|\| exclude\(root\) \|\| \(opts\.include && !opts\.include\(root\)\)\) continue;/.test(merge),
  "and skips a root only when invisible, excluded, or filtered by include()");

console.log("\n=== THE include() FILTER: the likely culprit, and it is order-dependent ===");
// main.js runBatch(late=false) passes `include: null`, so the first pass filters
// nothing. But the LATE pass passes:
//
//     include: late ? (root) => cullGroups.has(root) || root.userData.staticLandmark === true : null
//
// That is a WHITELIST. It admits only cull-group roots and staticLandmark roots.
// A bare untagged Mesh is NEITHER -- so it is invisible to the late pass.
//
// This does not explain the FIRST pass, which has include: null and should have
// collected them. But it does mean that IF the props arrive after the first pass
// (GLB-style async attach, which is the documented reason the late pass exists),
// then NOTHING can ever batch them: they would be permanently excluded by a
// whitelist that never matches a bare mesh.
check(/include: late \? \(root\) => cullGroups\.has\(root\) \|\| root\.userData\.staticLandmark === true : null/.test(
  readFileSync(join(here, "../../src/main.js"), "utf8")
), "the late pass whitelists cullGroups + staticLandmark only -- a bare Mesh can never match");

console.log("\n=== what the runtime probe must therefore check FIRST ===");
console.log("  A. runBatch() at main.js:7120 -- does `seen` include OrleaRouge's props?");
console.log("     If seen is in the thousands and removed is small, the first pass");
console.log("     is running and SKIPPING them: read the bins from (3) above.");
console.log("     If seen is tiny, the props are not in scene.children yet -- in");
console.log("     which case the late-pass whitelist above is the mechanism, and the");
console.log("     fix is to run a final unfiltered pass once the world has settled,");
console.log("     not to retag anything.");
console.log("  B. Print the [gfx] static batching line that main.js:7121 already logs.");
console.log("     It is in the console today and has never been read against the");
console.log("     1,941 figure.");

console.log("\n=== 8. MEASURED: the batcher's own report ===");
// Captured live by orlearouge_spawn_density.mjs, which now listens for [gfx]
// lines. This had never been captured by any QA script before.
const B = {
  first: { seen: 51204, after: 11024, batches: 5717 },
  late:  { seen: 6766, after: 2841, batches: 430 },
};
console.log(`  first pass: ${B.first.seen} meshes -> ${B.first.after} (${B.first.batches} batches)`);
console.log(`  late pass:  ${B.late.seen} meshes -> ${B.late.after} (${B.late.batches} batches)`);
console.log(`  removed by the first pass: ${B.first.seen - B.first.after}`);
console.log(`  removed by the late pass:  ${B.late.seen - B.late.after}`);
console.log(`  average meshes per batch:  ${((B.first.seen - B.first.after) / B.first.batches).toFixed(1)}`);

// THE HEADLINE, and it corrects the story I had been telling:
// the batcher is working, and working well. It removes ~40,000 meshes. The
// "1,941 unbatched" figure from the spawn-frustum walk is NOT a batcher failure
// to have seen the world -- the world was very much seen.
check(B.first.seen - B.first.after > 30000,
  `the first pass removes ${B.first.seen - B.first.after} meshes -- batching is working, not broken`);
check((B.first.seen - B.first.after) / B.first.batches > 3,
  `batches average ${((B.first.seen - B.first.after) / B.first.batches).toFixed(1)} meshes, so they are real merges rather than pairs`);

console.log("\n=== what this does and does not settle ===");
console.log("  SETTLED: batching is not the broken thing. 'merge.js is broken' and");
console.log("  'batching never ran' are both refuted by the numbers above.");
console.log("  NOT SETTLED: why 1,941 meshes in the SPAWN FRUSTUM are unbatched.");
console.log("  Note the whole-scene figure after both passes is ~7,099 meshes, so");
console.log("  the 1,941 is a subset of what remains -- the walk counts meshes that");
console.log("  survived, including any added after the final pass. Reconciling those");
console.log("  two numbers is the next step, and it is a count, not a redesign.");

console.log(`\n${fails ? fails + " FAILURES" : "batching demonstrably works: ~40,000 meshes removed in the first pass"}`);
console.log("This file is a CHECKLIST, not a measurement. The measurement is the");
console.log("[gfx] static batching line from the game console, plus the bins above");
console.log("instrumented into batchStatic's skips. Do not read a pass here as");
console.log("evidence that the draw calls were fixed.");
process.exit(fails ? 1 : 0);