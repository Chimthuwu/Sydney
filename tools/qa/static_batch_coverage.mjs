// static_batch_coverage.mjs — pins the late-pass batching gap that left ~2,160
// meshes unbatchable at OrleaRouge spawn.
//
//   node --experimental-detect-module tools/qa/static_batch_coverage.mjs
//
// Human report 2026-10-02: "Orlearouge IS very laggy esp during spawn".
//
// THE DEFECT. main.js runs static batching twice:
//
//   runBatch()        eager, include: null                    -> sees every root
//   setInterval(..., runBatch(true))   late, include:
//       (root) => cullGroups.has(root) || root.userData.staticLandmark === true
//
// The late pass is the one that catches props added AFTER load (async GLB
// landmarks, district dressing). But it only ever looks at cullGroup children
// and roots explicitly tagged userData.staticLandmark. A static prop added
// straight to the scene root with no tag is therefore invisible to it -- not
// batched late, and (being added late) missed by the eager pass either. It then
// stays a separate draw call for the life of the world.
//
// MEASURED at OrleaRouge spawn (-6, 130), via tools/qa/orlearouge_spawn_density.mjs:
//
//   unattributed in frustum:  2160
//   late-pass eligible:          0
//   in a cullGroup:              0
//
//   scene-root children holding them:
//     1061  Mesh  |(unnamed)      | userData: (empty)
//      413  Object3D|(unnamed)    | userData: age      <- characters, animated
//      150  Group |(unnamed)      | userData: glows
//      115  Group |(unnamed)      | userData: (empty)
//
// and the most-repeated geometry appeared 244 times with ONE merge signature:
// colour 3a2f24, emissive/roughness/metalness/opacity/alphaTest all constant, 1
// distinct signature across 244 distinct material objects. merge.js's
// matSignature() would merge them instantly. They were never offered.
//
// Note the 413 userData.age roots are characters (characters.js:470) and are
// correctly never batched -- they animate. That is why the fix TAGS the static
// prop factories rather than widening runBatch's include to "any untagged root",
// which would have merged skinned NPCs.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, "../../src/", p), "utf8");
const main = read("main.js");
const orlearouge = read("orlearouge.js");

let fails = 0;
const ok = (m) => console.log(`  ok   ${m}`);
const bad = (m) => { console.log(`  FAIL ${m}`); fails++; };
const check = (c, m) => (c ? ok(m) : bad(m));

console.log("=== 1. the late pass still filters, and still excludes moving roots ===");
// Pin the shape of the filter so a future 'fix' cannot quietly batch skinned NPCs.
check(/include: *late *\? *\(root\) *=> *cullGroups\.has\(root\) *\|\| *root\.userData\.staticLandmark === true/.test(main),
  "runBatch's late include is unchanged: cullGroups + explicit staticLandmark tag");
check(/exclude: *\(root\) *=> *moving\.has\(root\) && !\(late && root\.userData\.staticLandmark\)/.test(main),
  "moving roots are still excluded (characters, vehicles, anything animated)");

console.log("\n=== 2. static prop factories opt in to the late pass ===");
// Each of these adds directly to the scene root, so the eager pass misses them if
// they are built after it, and the late pass misses them if untagged.
const factories = [
  ["main.js", main, /function makeBarrel\(x, z\) \{[\s\S]*?staticLandmark = true/, "makeBarrel (244 copies of one 40-tri cylinder, one signature, unmerged)"],
  ["main.js", main, /function makePallet\(x, z, ry = 0\) \{[\s\S]*?staticLandmark = true/, "makePallet"],
  ["main.js", main, /function makeShed\([\s\S]*?g\.userData\.staticLandmark = true/, "makeShed's group (the junkyard sheds)"],
  ["orlearouge.js", orlearouge, /function plane\(w, d, mat, x, y, z\) \{[\s\S]*?staticLandmark = true/, "orlearouge.js plane() -- 1061 untagged bare meshes came from here"],
];
for (const [file, src, re, what] of factories) {
  check(re.test(src), `${file}: ${what} is tagged staticLandmark`);
}

console.log("\n=== 3. the tag is set BEFORE the object is added, and on the added root ===");
// Setting userData after scene.add() still works, but setting it on a CHILD while
// tagging nothing on the scene-root child batchStatic actually iterates does not.
check(/m\.userData\.staticLandmark = true;\s*\n\s*scene\.add\(m\);/.test(main) ||
      /m\.userData\.staticLandmark = true;[\s\S]{0,40}scene\.add\(m\);/.test(main),
  "main.js sets the tag on the same object it adds, before/with scene.add");
check(/g\.userData\.staticLandmark = true;[^;]*;?\s*\n?\s*scene\.add\(g\);/.test(main),
  "the shed Group is tagged on the object added to the scene, not on one of its children");

console.log("\n=== 4. nothing animated got tagged ===");
// The whole reason for tagging instead of widening include.
check(!/userData\.age[\s\S]{0,120}staticLandmark/.test(main),
  "no character root (userData.age) is tagged staticLandmark");
check(!/skinned|SkinnedMesh[\s\S]{0,120}staticLandmark/.test(main),
  "no skinned mesh is tagged staticLandmark");

console.log(`\n${fails ? fails + " FAILURES -- static props are still invisible to the late batching pass" : "static props opt in to the late batching pass; animated roots still excluded"}`);
process.exit(fails ? 1 : 0);